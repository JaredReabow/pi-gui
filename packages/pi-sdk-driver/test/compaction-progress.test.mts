import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionRuntime, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { JsonCatalogStore } from "@pi-gui/catalogs/node";
import { PiSdkDriver } from "../dist/pi-sdk-driver.js";
import { createAgentSessionRuntimeWithNpmFallback } from "../dist/npm-package-fallback.js";

type SummaryMode = "success" | "gated" | "transient" | "bad-request";
async function fixture(
  t: TestContext,
  { automatic = false, delayMs = 5, selectedSummary = "summary", keepRecentTokens = 0 } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "pi-compaction-progress-"));
  const agentDir = join(root, "agent"),
    cwd = join(root, "workspace");
  await mkdir(agentDir);
  await mkdir(cwd);
  const prior = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prior;
  });
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No network allowed");
  });
  t.after(() => assert.equal(fetch.mock.callCount(), 0));
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: automatic, reserveTokens: 1000, keepRecentTokens },
      retry: { enabled: true, maxRetries: 3, baseDelayMs: delayMs },
    }),
  );
  let runtime!: AgentSessionRuntime;
  let compacting = false,
    summaryCalls = 0,
    chatCalls = 0,
    failures = 0,
    overflow = false;
  let mode: SummaryMode = "success";
  let release: (() => void) | undefined;
  let onSummary: (() => void) | undefined;
  const changed = new Set<() => void>();
  const notify = () => {
    for (const fn of changed) fn();
  };
  const events: SessionDriverEvent[] = [];
  const extension: ExtensionFactory = (pi) =>
    pi.registerProvider("progress-proof", {
      api: "progress-proof",
      apiKey: "TEST_ONLY",
      baseUrl: "http://127.0.0.1:9/never-contact",
      models: ["chat", "summary"].map((id) => ({
        id,
        name: id,
        reasoning: true,
        input: ["text"],
        contextWindow: 10000,
        maxTokens: 1500,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
      streamSimple(model, _context, options) {
        const summary = compacting;
        if (summary) {
          summaryCalls++;
          assert.equal(options?.reasoning, "medium");
          onSummary?.();
        } else chatCalls++;
        const error =
          summary && mode === "bad-request"
            ? 'codex-router API error (400): 400 {"detail":"Bad Request"}'
            : summary && mode === "transient" && failures-- > 0
              ? "HTTP 503: provider temporarily unavailable"
              : !summary && overflow
                ? "400 context_length_exceeded: maximum context length exceeded"
                : undefined;
        if (!summary && overflow) overflow = false;
        const text = summary
          ? "## Goal\nPreserve fixture goal.\n## Progress\nInspected fixture.\n## Next Steps\nContinue."
          : "FIXTURE_ANSWER";
        const message: AssistantMessage = {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: error ? [] : [{ type: "text", text }],
          stopReason: error ? "error" : "stop",
          ...(error ? { errorMessage: error } : {}),
          usage: {
            input: 100,
            output: 10,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 110,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          timestamp: Date.now(),
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "start", partial: { ...message, content: [] } });
        let finished = false;
        const done = (aborted = false) => {
          if (finished) return;
          finished = true;
          const result = aborted
            ? {
                ...message,
                content: [],
                stopReason: "aborted" as const,
                errorMessage: "Operation aborted",
              }
            : message;
          stream.push(
            result.stopReason === "error" || result.stopReason === "aborted"
              ? { type: "error", reason: result.stopReason, error: result }
              : { type: "done", reason: "stop", message: result },
          );
        };
        if (summary && mode === "gated") {
          release = () => done();
          if (options?.signal?.aborted) done(true);
          else options?.signal?.addEventListener("abort", () => done(true), { once: true });
        } else done(options?.signal?.aborted === true);
        notify();
        return stream;
      },
    });
  const catalog = new JsonCatalogStore({ catalogFilePath: join(root, "catalogs.json") });
  const begin = t.mock.method(catalog.sessions, "beginRun");
  const driver = new PiSdkDriver({
    agentDir,
    catalogStorage: catalog,
    summaryModelForSession: async () => ({ provider: "progress-proof", modelId: selectedSummary }),
    createAgentSessionRuntimeImpl: async (options) => {
      runtime = await createAgentSessionRuntimeWithNpmFallback({
        ...options,
        tools: [],
        resourceLoaderOptions: {
          ...options.resourceLoaderOptions,
          extensionFactories: [
            ...(options.resourceLoaderOptions?.extensionFactories ?? []),
            extension,
          ],
        },
      });
      runtime.session.subscribe((event) => {
        if (event.type === "compaction_start") compacting = true;
        if (event.type === "compaction_end") compacting = false;
      });
      return runtime;
    },
  });
  const { ref } = await driver.createSession(
    { workspaceId: "fixture", path: cwd },
    { initialModel: { provider: "progress-proof", modelId: "chat" } },
  );
  const unsubscribe = driver.subscribe(ref, (event) => {
    events.push(event);
    notify();
  });
  t.after(async () => {
    unsubscribe();
    await driver.closeSession(ref);
  });
  runtime.session.setThinkingLevel("high");
  function until(predicate: () => boolean) {
    if (predicate()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const check = () => {
        if (predicate()) {
          changed.delete(check);
          resolve();
        }
      };
      changed.add(check);
    });
  }
  await driver.sendUserMessage(ref, { text: "Inspect this synthetic fixture. ".repeat(30) });
  await until(() => events.some((e) => e.type === "runCompleted"));
  return {
    driver,
    ref,
    runtime,
    catalog,
    begin,
    events,
    until,
    mode(value: SummaryMode, count = 0) {
      mode = value;
      failures = count;
    },
    overflow() {
      overflow = true;
    },
    release() {
      release?.();
    },
    onSummary(callback: () => void) {
      onSummary = callback;
    },
    summaryCalls: () => summaryCalls,
    chatCalls: () => chatCalls,
    snapshot: () => driver.openSession(ref),
  };
}

await test(
  "manual compaction is visible/busy before accepting a send; Stop preserves native history and allows the next prompt",
  { timeout: 10000 },
  async (t) => {
    const h = await fixture(t);
    h.mode("gated");
    const before = h.runtime.session.sessionManager.getEntries().length;
    const generations = h.begin.mock.callCount();
    const compact = h.driver.compactSession(h.ref);
    await h.until(() => h.summaryCalls() === 1);
    const snapshot = await h.snapshot();
    assert.equal(snapshot.status, "running");
    assert.equal(snapshot.compaction?.phase, "summarizing");
    assert.deepEqual(snapshot.compaction?.request, {
      provider: "progress-proof",
      modelId: "summary",
      api: "progress-proof",
      thinkingLevel: "medium",
    });
    await assert.rejects(
      h.driver.sendUserMessage(h.ref, { text: "MUST_NOT_SEND" }),
      (error) =>
        error instanceof Error && "code" in error && error.code === "COMPACTION_IN_PROGRESS",
    );
    assert.equal(
      h.begin.mock.callCount(),
      generations,
      "rejection happens before durable run allocation",
    );
    assert.equal(h.runtime.session.sessionManager.getEntries().length, before);
    await h.driver.cancelCurrentRun(h.ref);
    await compact;
    assert.equal(h.runtime.session.isCompacting, false);
    assert.equal((await h.snapshot()).compaction?.phase, "stopped");
    assert.equal(h.runtime.session.sessionManager.getEntries().length, before);
    assert.equal(h.events.filter((e) => e.type === "runFailed").length, 0);
    assert.equal(h.events.filter((e) => e.type === "runCompleted").length, 1);
    await h.driver.sendUserMessage(h.ref, { text: "AFTER_STOP" });
    await h.until(() => h.events.filter((e) => e.type === "runCompleted").length === 2);
    assert.equal((await h.snapshot()).compaction, undefined);
  },
);

await test(
  "genuine SDK summary retries project their backoff and recover without changing chat effort",
  { timeout: 10000 },
  async (t) => {
    const h = await fixture(t);
    h.mode("transient", 2);
    await h.driver.compactSession(h.ref);
    assert.equal(h.summaryCalls(), 3);
    const firstRetry = h.events.findIndex(
      (e) => e.type === "sessionUpdated" && e.snapshot.compaction?.phase === "retrying",
    );
    await h.until(() =>
      h.events
        .slice(firstRetry + 1)
        .some(
          (e) =>
            e.type === "sessionUpdated" &&
            e.snapshot.compaction?.phase === "summarizing" &&
            !e.snapshot.compaction.retry,
        ),
    );
    const retries = h.events.flatMap((e) =>
      e.type === "sessionUpdated" && e.snapshot.compaction?.phase === "retrying"
        ? [e.snapshot.compaction]
        : [],
    );
    assert.ok(retries.some((p) => p.retry?.attempt === 1));
    assert.ok(retries.some((p) => p.retry?.attempt === 2));
    for (const p of retries) {
      assert.ok(p.retry && p.retry.maxAttempts >= p.retry.attempt);
      assert.ok(Date.parse(p.retry.retryAt!) > Date.parse(p.updatedAt));
    }
    assert.equal((await h.snapshot()).compaction, undefined);
    assert.equal(h.runtime.session.model?.id, "chat");
    assert.equal(h.runtime.session.thinkingLevel, "high");
    assert.ok(h.runtime.session.sessionManager.getEntries().some((e) => e.type === "compaction"));
  },
);

await test(
  "generic400 is distinct from Stop and leaves history intact with model/API/mode details",
  { timeout: 10000 },
  async (t) => {
    const h = await fixture(t);
    h.mode("bad-request");
    const before = h.runtime.session.sessionManager.getEntries().length;
    await assert.rejects(
      h.driver.compactSession(h.ref),
      /provider rejected this request \(HTTP 400\)/,
    );
    assert.equal(h.summaryCalls(), 1, "native policy does not retry deterministic400");
    const progress = (await h.snapshot()).compaction;
    assert.equal(progress?.phase, "failed");
    assert.ok(progress?.errorMessage?.includes("Reasoning: medium"));
    assert.ok(progress?.errorMessage?.includes("API: progress-proof"));
    assert.equal(h.runtime.session.sessionManager.getEntries().length, before);
    assert.equal(h.runtime.session.isCompacting, false);
    h.mode("success");
    await h.driver.sendUserMessage(h.ref, { text: "RECOVER_AFTER_FAILED_SUMMARY" });
    assert.equal((await h.snapshot()).compaction, undefined);
  },
);

await test(
  "Stop cancels a genuine long SDK retry wait without starting another request",
  { timeout: 10000 },
  async (t) => {
    const h = await fixture(t, { delayMs: 60000 });
    h.mode("transient", 20);
    const compact = h.driver.compactSession(h.ref);
    await h.until(() =>
      h.events.some(
        (e) => e.type === "sessionUpdated" && e.snapshot.compaction?.phase === "retrying",
      ),
    );
    await h.driver.cancelCurrentRun(h.ref);
    await compact;
    assert.equal(h.summaryCalls(), 1);
    assert.equal(h.runtime.session.isCompacting, false);
    assert.equal((await h.snapshot()).compaction?.phase, "stopped");
  },
);

await test(
  "Pi-generated file operation details survive repeated hook-based compaction",
  { timeout: 10000 },
  async (t) => {
    const h = await fixture(t);
    const manager = h.runtime.session.sessionManager;
    const leaf = manager.getBranch().at(-1)!;
    manager.appendCompaction(
      "Previous fixture goal.",
      leaf.id,
      100,
      { readFiles: ["kept-read.ts"], modifiedFiles: ["kept-edit.ts"], piGuiSummaryVersion: 1 },
      true,
    );
    await h.driver.sendUserMessage(h.ref, { text: "Continue the synthetic fixture." });
    await h.driver.compactSession(h.ref);
    const last = manager
      .getEntries()
      .filter((e) => e.type === "compaction")
      .at(-1)!;
    const details = last.details as {
      readFiles: string[];
      modifiedFiles: string[];
      piGuiSummaryVersion: number;
    };
    assert.deepEqual(details.readFiles, ["kept-read.ts"]);
    assert.deepEqual(details.modifiedFiles, ["kept-edit.ts"]);
    assert.equal(details.piGuiSummaryVersion, 1);
  },
);

await test(
  "an unavailable selected summary model fails closed and retains the manual retry focus",
  { timeout: 10000 },
  async (t) => {
    const h = await fixture(t, { selectedSummary: "missing" });
    const before = h.runtime.session.sessionManager.getEntries().length;
    await assert.rejects(
      h.driver.compactSession(h.ref, "KEEP_FOCUS"),
      /Summary model unavailable: progress-proof\/missing/,
    );
    const snapshot = await h.snapshot();
    assert.equal(snapshot.compaction?.phase, "failed");
    assert.equal(snapshot.compaction?.customInstructions, "KEEP_FOCUS");
    assert.equal(h.summaryCalls(), 0);
    assert.equal(h.chatCalls(), 1, "do not fall back to a paid chat-model request");
    assert.equal(h.runtime.session.sessionManager.getEntries().length, before);
  },
);

await test(
  "failed overflow summarization does not loop or replay the original request",
  { timeout: 10000 },
  async (t) => {
    const h = await fixture(t, { automatic: true });
    h.mode("bad-request");
    h.overflow();
    await h.driver.sendUserMessage(h.ref, { text: "OVERFLOW_WITH_FAILED_COMPACTION" });
    assert.equal(h.summaryCalls(), 1);
    assert.equal(h.chatCalls(), 2);
    assert.equal(h.runtime.session.isCompacting, false);
    assert.equal((await h.snapshot()).compaction?.phase, "failed");
    assert.equal(
      h.runtime.session.sessionManager.getEntries().filter((e) => e.type === "compaction").length,
      0,
    );
  },
);

for (const exhaustBudget of [false, true]) {
  await test(
    `split-turn compaction ${exhaustBudget ? "still stops at its whole-operation deadline without a partial checkpoint" : "allows both native summaries to exceed two minutes combined"}`,
    { timeout: 10000 },
    async (t) => {
      const h = await fixture(t, { keepRecentTokens: 32 });
      const manager = h.runtime.session.sessionManager;
      const prior = manager
        .getEntries()
        .find((e) => e.type === "message" && e.message.role === "assistant");
      assert.ok(prior?.type === "message" && prior.message.role === "assistant");
      manager.appendMessage({ role: "user", content: "SPLIT_TURN_FIXTURE", timestamp: Date.now() });
      for (const text of ["EARLIER_IN_TURN ".repeat(300), "KEPT_TURN_TAIL ".repeat(300)])
        manager.appendMessage({ ...prior.message, content: [{ type: "text", text }] });
      const before = manager.getEntries().map((entry) => entry.id);
      // Virtualize only the hook's deadline, not SDK execution or its compaction
      // preparation. No 165-second wall-clock sleep or provider request is involved.
      let elapsed = 0;
      let deadline = Infinity;
      const controller = new AbortController();
      const timeouts = t.mock.method(AbortSignal, "timeout", (ms: number) => {
        deadline = elapsed + ms;
        return controller.signal;
      });
      h.onSummary(() => {
        elapsed += h.summaryCalls() === 1 ? 105000 : exhaustBudget ? 505000 : 60000;
        if (elapsed >= deadline)
          controller.abort(
            new DOMException("The operation was aborted due to timeout", "TimeoutError"),
          );
      });
      if (exhaustBudget) await assert.rejects(h.driver.compactSession(h.ref), /timed out/);
      else await h.driver.compactSession(h.ref);
      assert.equal(
        timeouts.mock.callCount(),
        1,
        "one bounded budget covers both calls and retries",
      );
      assert.equal(deadline, 600000);
      assert.equal(
        h.summaryCalls(),
        2,
        "native split preparation makes two real SDK summary calls",
      );
      const checkpoints = manager.getEntries().filter((entry) => entry.type === "compaction");
      assert.equal(checkpoints.length, exhaustBudget ? 0 : 1);
      if (!exhaustBudget) assert.ok(checkpoints[0]?.summary.includes("Turn Context (split turn)"));
      assert.deepEqual(
        manager
          .getEntries()
          .slice(0, before.length)
          .map((entry) => entry.id),
        before,
      );
      assert.equal(h.runtime.session.isCompacting, false);
      assert.equal(h.runtime.session.model?.id, "chat");
      assert.equal(h.runtime.session.thinkingLevel, "high");
      assert.equal(h.chatCalls(), 1, "no chat or tool replay");
      assert.equal((await h.snapshot()).compaction?.phase, exhaustBudget ? "failed" : undefined);
    },
  );
}

for (const stop of [false, true]) {
  await test(
    `automatic overflow compaction ${stop ? "stops without retrying the interrupted turn" : "continues once using native boundaries"}`,
    { timeout: 10000 },
    async (t) => {
      const h = await fixture(t, { automatic: true });
      h.mode("gated");
      h.overflow();
      const run = h.driver.sendUserMessage(h.ref, { text: "OVERFLOW_FIXTURE" });
      await h.until(() => h.summaryCalls() === 1);
      assert.equal((await h.snapshot()).compaction?.reason, "overflow");
      if (stop) await h.driver.cancelCurrentRun(h.ref);
      else {
        h.mode("success");
        h.release();
      }
      await run;
      assert.equal(h.runtime.session.isCompacting, false);
      assert.equal(h.chatCalls(), stop ? 2 : 3);
      assert.equal(
        h.runtime.session.sessionManager
          .getEntries()
          .filter((e) => e.type === "message" && e.message.role === "user").length,
        2,
      );
      if (!stop) assert.equal((await h.snapshot()).compaction, undefined);
    },
  );
}
