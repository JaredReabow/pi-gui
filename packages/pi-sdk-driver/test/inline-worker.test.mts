import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test, { type TestContext } from "node:test";
import { setImmediate as nextEventLoopTurn } from "node:timers/promises";
import {
  createAgentSession,
  type AgentSession,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import { PiSdkDriver } from "../dist/index.js";
import {
  inlineWorkerPolicy_resolve,
  inlineWorkerPolicy_resultBounds,
  inlineWorkerPolicy_sanitizeError,
  inlineWorkerPolicy_validatePrompt,
  type InlineWorkerPolicy,
} from "../dist/inline-worker-policy.js";
import type {
  InlineWorkerHostCapability,
  InlineWorkerModelSelection,
  InlineWorkerRunHandle,
  InlineWorkerTerminalResult,
  SessionDriverEvent,
  SessionRef,
} from "@pi-gui/session-driver";
import { inlineWorker_decodeResult, sessionKey } from "@pi-gui/session-driver";

interface LoopbackRequest {
  readonly model: string;
  readonly prompt: string;
  readonly temperature: number | undefined;
  readonly path: string | undefined;
  closedBy?: string;
}

interface TestRecord {
  readonly ref: SessionRef;
  readonly workspace: { readonly workspaceId: string; readonly path: string };
  readonly session: AgentSession;
  runningRunId: string | undefined;
  pendingSdkToolCallIds: Set<string>;
  activeTerminalRun:
    | {
        runId: string;
        generation: number;
        nativeSessionId: string;
        allocation?: Promise<number | undefined>;
      }
    | undefined;
}

interface TestSupervisor {
  readonly records: Map<string, TestRecord>;
  mapAgentEvent(record: TestRecord, event: unknown): SessionDriverEvent[];
  readonly inlineWorkerSupervisor: {
    readonly activeCount: number;
    capacityFor(parent: SessionRef): {
      readonly activeForParent: number;
      readonly activeForOwner: number;
    };
  };
}

interface LoopbackHarness {
  readonly driver: PiSdkDriver;
  readonly ref: SessionRef;
  readonly root: string;
  readonly cwd: string;
  readonly requests: LoopbackRequest[];
  createCalls(): number;
  createSession(): Promise<SessionRef>;
  activateRun(parent: SessionRef): Promise<string>;
  startTool(parent: SessionRef, toolCallId: string): void;
  endTool(parent: SessionRef, toolCallId: string): void;
  host(
    parent: SessionRef,
    runId: string,
    toolCallId: string,
    signal?: AbortSignal,
  ): Promise<InlineWorkerHostCapability>;
  startWorker(
    parent: SessionRef,
    runId: string,
    toolCallId: string,
    prompt: string,
    signal?: AbortSignal,
    selection?: InlineWorkerModelSelection,
  ): Promise<{ readonly host: InlineWorkerHostCapability; readonly handle: InlineWorkerRunHandle }>;
  workerOptions(): readonly CreateAgentSessionOptions[];
  workerSessions(): readonly AgentSession[];
}

function sseChunk(
  response: http.ServerResponse,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): void {
  response.write(
    `data: ${JSON.stringify({
      id: `chatcmpl-${Math.random().toString(16).slice(2)}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`,
  );
}

function successfulResponse(response: http.ServerResponse, model: string, text: string): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/event-stream",
  });
  sseChunk(response, model, {
    role: "assistant",
    reasoning_content: `HIDDEN_THINKING_${model}`,
  });
  sseChunk(response, model, { content: text });
  sseChunk(response, model, {}, "stop");
  response.end("data: [DONE]\n\n");
}

function heldResponse(
  response: http.ServerResponse,
  model: string,
  request: LoopbackRequest,
): Promise<void> {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/event-stream",
  });
  sseChunk(response, model, {
    role: "assistant",
    reasoning_content: "HIDDEN_PARTIAL_THINKING",
    content: "PARTIAL",
  });
  return new Promise((resolve) => {
    let settled = false;
    const done = (reason: string) => {
      if (settled) return;
      settled = true;
      request.closedBy = reason;
      resolve();
    };
    response.once("close", () => done("response-close"));
    response.once("error", () => done("response-error"));
  });
}

function promptText(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return "";
  const user = [...(messages as unknown[])]
    .reverse()
    .find(
      (message): message is { content: unknown } =>
        typeof message === "object" &&
        message !== null &&
        (message as { role?: unknown }).role === "user",
    );
  if (typeof user?.content === "string") return user.content;
  if (!Array.isArray(user?.content)) return "";
  return user.content
    .flatMap((part) =>
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? [(part as { text: string }).text]
        : [],
    )
    .join("");
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function policy(overrides: Partial<InlineWorkerPolicy> = {}): InlineWorkerPolicy {
  return inlineWorkerPolicy_resolve(overrides);
}

async function createHarness(
  t: TestContext,
  overrides: Partial<InlineWorkerPolicy> = {},
): Promise<LoopbackHarness> {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-inline-worker-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  await mkdir(agentDir);
  await mkdir(cwd);
  const requests: LoopbackRequest[] = [];
  const heldResponses: Promise<void>[] = [];

  const server = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      const record: LoopbackRequest = {
        model: String(body.model),
        prompt: promptText(body),
        temperature: typeof body.temperature === "number" ? body.temperature : undefined,
        path: request.url,
      };
      requests.push(record);

      if (record.prompt === "provider-error") {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              message: `provider-secret=do-not-return ${"E".repeat(20_000)}`,
            },
          }),
        );
        return;
      }
      if (record.prompt.startsWith("slow-")) {
        heldResponses.push(heldResponse(response, record.model, record));
        return;
      }
      if (record.prompt === "delayed-success") {
        setTimeout(() => successfulResponse(response, record.model, `RESULT:${record.model}`), 50);
        return;
      }
      if (record.prompt === "large-exact") {
        successfulResponse(response, record.model, "x".repeat(131_072));
        return;
      }
      if (record.prompt === "large-over") {
        successfulResponse(response, record.model, "x".repeat(131_073));
        return;
      }
      successfulResponse(response, record.model, `RESULT:${record.model}`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  await writeFile(join(agentDir, "auth.json"), "{}\n");
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify({
      providers: {
        "inline-loopback": {
          baseUrl,
          apiKey: "LOCAL_ONLY_NOT_A_SECRET",
          api: "openai-completions",
          models: [
            {
              id: "alpha",
              input: ["text"],
              reasoning: true,
              contextWindow: 65_536,
              maxTokens: 2_048,
              samplingParams: { temperature: 0.5 },
              samplingParamsByThinkingLevel: {
                low: { temperature: 0.11 },
                high: { temperature: 0.77 },
              },
            },
            {
              id: "beta",
              input: ["text"],
              reasoning: true,
              contextWindow: 65_536,
              maxTokens: 2_048,
              samplingParams: { temperature: 0.5 },
              samplingParamsByThinkingLevel: {
                low: { temperature: 0.11 },
                high: { temperature: 0.77 },
              },
            },
          ],
        },
      },
    })}\n`,
  );

  let workerCreateCalls = 0;
  const capturedOptions: CreateAgentSessionOptions[] = [];
  const capturedSessions: AgentSession[] = [];
  const driver = new PiSdkDriver({
    agentDir,
    catalogFilePath: join(root, "catalogs.json"),
    inlineWorkerOptions: {
      policy: overrides,
      createAgentSessionImpl: async (options) => {
        workerCreateCalls += 1;
        capturedOptions.push(options);
        const result = await createAgentSession(options);
        capturedSessions.push(result.session);
        return result;
      },
    },
  });
  const supervisor = (driver as unknown as { supervisor: TestSupervisor }).supervisor;
  const { workspace } = await driver.syncWorkspace(cwd, "Inline Loopback");
  const parent = await driver.createSession(workspace, {
    initialModel: { provider: "inline-loopback", modelId: "alpha" },
  });
  const parentRefs = [parent.ref];

  t.after(async () => {
    await Promise.all(
      parentRefs.map((parentRef) =>
        driver.cancelInlineWorkersForParent(parentRef).catch(() => undefined),
      ),
    );
    await Promise.all(
      parentRefs.map((parentRef) => driver.closeSession(parentRef).catch(() => undefined)),
    );
    server.closeAllConnections?.();
    await Promise.allSettled(heldResponses);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  function recordFor(parentRef: SessionRef): TestRecord {
    const record = supervisor.records.get(sessionKey(parentRef));
    assert(record, `live parent ${sessionKey(parentRef)}`);
    return record;
  }

  async function activateRun(parentRef: SessionRef): Promise<string> {
    const record = recordFor(parentRef);
    if (!record.runningRunId) {
      supervisor.mapAgentEvent(record, { type: "agent_start" });
      await record.activeTerminalRun?.allocation;
    }
    assert(record.runningRunId);
    return record.runningRunId;
  }

  function startTool(parentRef: SessionRef, toolCallId: string): void {
    supervisor.mapAgentEvent(recordFor(parentRef), {
      type: "tool_execution_start",
      toolCallId,
      toolName: "inline_task",
      args: {},
    });
  }

  function endTool(parentRef: SessionRef, toolCallId: string): void {
    supervisor.mapAgentEvent(recordFor(parentRef), {
      type: "tool_execution_end",
      toolCallId,
      toolName: "inline_task",
      result: {},
      isError: false,
    });
  }

  async function host(
    parentRef: SessionRef,
    runId: string,
    toolCallId: string,
    signal = new AbortController().signal,
  ): Promise<InlineWorkerHostCapability> {
    return driver.createInlineWorkerHostCapability(parentRef, runId, toolCallId, signal);
  }

  async function startWorker(
    parentRef: SessionRef,
    runId: string,
    toolCallId: string,
    prompt: string,
    signal?: AbortSignal,
    selection?: InlineWorkerModelSelection,
  ) {
    const capability = await host(parentRef, runId, toolCallId, signal);
    const handle = driver.startInlineWorker({ prompt }, capability, selection);
    return { host: capability, handle };
  }

  return {
    driver,
    ref: parent.ref,
    root,
    cwd,
    requests,
    createCalls: () => workerCreateCalls,
    createSession: async () => {
      const snapshot = await driver.createSession(workspace, {
        initialModel: { provider: "inline-loopback", modelId: "alpha" },
      });
      parentRefs.push(snapshot.ref);
      return snapshot.ref;
    },
    activateRun,
    startTool,
    endTool,
    host,
    startWorker,
    workerOptions: () => capturedOptions,
    workerSessions: () => capturedSessions,
  };
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(path: string) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(relative(directory, child));
    }
  }
  await visit(directory);
  return files.sort();
}

await test(
  "actual core inherits two live loopback models/thinking and isolates all resources",
  { timeout: 15_000 },
  async (t) => {
    const h = await createHarness(t);
    const cases = [
      { prompt: "success-alpha", modelId: "alpha", thinking: "low", temperature: 0.11 },
      { prompt: "success-beta", modelId: "beta", thinking: "high", temperature: 0.77 },
    ] as const;
    const parentRefs: SessionRef[] = [];

    for (const [index, sample] of cases.entries()) {
      const parent = index === 0 ? h.ref : await h.createSession();
      parentRefs.push(parent);
      await h.driver.setSessionModel(parent, {
        provider: "inline-loopback",
        modelId: sample.modelId,
      });
      await h.driver.setSessionThinkingLevel(parent, sample.thinking);
      const runId = await h.activateRun(parent);
      const toolCallId = `resource-tool-${index}`;
      h.startTool(parent, toolCallId);
      const { handle } = await h.startWorker(parent, runId, toolCallId, sample.prompt);
      const result = await handle.completion;
      assert.equal(result.status, "succeeded");
      if (result.status === "succeeded") {
        assert.equal(result.text, `RESULT:${sample.modelId}`);
        assert.doesNotMatch(result.text, /HIDDEN_THINKING/);
      }

      const request = h.requests.find((entry) => entry.prompt === sample.prompt);
      assert.equal(request?.model, sample.modelId);
      assert.equal(request?.temperature, sample.temperature);
      assert.equal(request?.path, "/v1/chat/completions");
    }

    const options = h.workerOptions();
    assert.equal(options.length, 2);
    for (const [index, sample] of cases.entries()) {
      const captured = options[index]!;
      assert.equal(captured.cwd, await realpath(h.cwd));
      assert.equal(captured.model?.id, sample.modelId);
      assert.equal(captured.thinkingLevel, sample.thinking);
      const supervisor = (h.driver as unknown as { supervisor: TestSupervisor }).supervisor;
      const parentRecord = supervisor.records.get(sessionKey(parentRefs[index]!));
      assert(parentRecord);
      assert.equal(captured.model, parentRecord.session.model);
      assert.equal(captured.modelRuntime, parentRecord.session.modelRuntime);
      assert.deepEqual(captured.tools, []);
      assert.equal(captured.noTools, "all");
      assert.deepEqual(captured.customTools, []);
      assert.equal(captured.sessionManager?.getSessionFile(), undefined);
      const loader = captured.resourceLoader;
      assert(loader);
      assert.deepEqual(loader.getExtensions().extensions, []);
      assert.deepEqual(loader.getSkills().skills, []);
      assert.deepEqual(loader.getPrompts().prompts, []);
      assert.deepEqual(loader.getThemes().themes, []);
      assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
    }
    for (const session of h.workerSessions()) {
      assert.equal(session.sessionFile, undefined);
      assert.deepEqual(session.getActiveToolNames(), []);
    }
  },
);

await test(
  "explicit worker selection overrides the parent model and thinking level",
  { timeout: 15_000 },
  async (t) => {
    const h = await createHarness(t);
    const runId = await h.activateRun(h.ref);
    h.startTool(h.ref, "selected-worker-tool");
    const { handle } = await h.startWorker(
      h.ref,
      runId,
      "selected-worker-tool",
      "selected-worker",
      undefined,
      {
        provider: "inline-loopback",
        modelId: "beta",
        thinkingLevel: "high",
      },
    );
    const result = await handle.completion;
    assert.equal(result.status, "succeeded");
    if (result.status === "succeeded") {
      assert.equal(result.text, "RESULT:beta");
    }
    const request = h.requests.find((entry) => entry.prompt === "selected-worker");
    assert.equal(request?.model, "beta");
    assert.equal(request?.temperature, 0.77);
    const worker = h.workerOptions()[0];
    assert.equal(worker?.model?.id, "beta");
    assert.equal(worker?.thinkingLevel, "high");
  },
);

await test("policy owns prompt, nesting and sanitized UTF-8 limits", () => {
  const defaults = policy();
  assert.equal(defaults.maxActivePerParent, 4);
  assert.equal(defaults.maxActivePerOwner, 8);
  assert.equal(defaults.maxNestingDepth, 1);
  assert.equal(defaults.deadlineMs, 180_000);
  assert.equal(defaults.maxPromptBytes, 65_536);
  assert.equal(defaults.maxResultBytes, 131_072);
  assert.equal(defaults.maxErrorBytes, 8_192);

  assert.equal(
    inlineWorkerPolicy_validatePrompt({ prompt: "é".repeat(32_768) }, defaults).ok,
    true,
  );
  assert.equal(
    inlineWorkerPolicy_validatePrompt({ prompt: `${"é".repeat(32_768)}x` }, defaults).ok,
    false,
  );
  const nested = policy({ maxNestingDepth: 1 });
  assert.throws(() => inlineWorkerPolicy_resolve({ maxActivePerOwner: 0 }));
  assert.equal(nested.maxNestingDepth, 1);

  const sanitized = inlineWorkerPolicy_sanitizeError(
    "provider-secret=abc token: xyz https://user:pass@example.test Bearer abcdef",
    policy({ maxErrorBytes: 60 }),
  );
  assert.doesNotMatch(sanitized, /abc|xyz|user:pass|abcdef/);
  assert.ok(new TextEncoder().encode(sanitized).byteLength <= 60);
});

await test(
  "unissued capabilities reject without accessors, mutation, timers or SDK work",
  { timeout: 10_000 },
  async (t) => {
    const h = await createHarness(t);
    const supervisor = (h.driver as unknown as { supervisor: TestSupervisor }).supervisor;
    const record = supervisor.records.get(sessionKey(h.ref));
    assert(record);
    const capacityBefore = supervisor.inlineWorkerSupervisor.capacityFor(h.ref);
    const recordKeysBefore = [...supervisor.records.keys()];
    const pendingBefore = [...record.pendingSdkToolCallIds];
    const activeRunBefore = record.activeTerminalRun;
    const messageCountBefore = record.session.messages.length;
    const sessionIdBefore = record.session.sessionId;
    const timeoutsBefore = process
      .getActiveResourcesInfo()
      .filter((resource) => resource === "Timeout").length;

    function plainForgedHost(workerId: string, workerRunId: string): InlineWorkerHostCapability {
      return {
        association: {
          parent: { workspaceId: "forged-workspace", sessionId: "forged-session" },
          parentRunId: "forged-run",
          parentGeneration: 1,
          parentNativeSessionId: "forged-native-session",
          parentToolCallId: "forged-tool",
          pendingSdkToolCallIds: ["forged-tool"],
          workerId,
          workerRunId,
        },
        signal: new AbortController().signal,
      } as unknown as InlineWorkerHostCapability;
    }

    const calls = {
      association: 0,
      parent: 0,
      workspaceId: 0,
      workerId: 0,
      workerRunId: 0,
      signal: 0,
    };
    const associationGetterHost = {};
    Object.defineProperty(associationGetterHost, "association", {
      get() {
        calls.association += 1;
        throw new Error("association getter must not run");
      },
    });
    const parentGetterAssociation: Record<string, unknown> = {};
    Object.defineProperty(parentGetterAssociation, "parent", {
      get() {
        calls.parent += 1;
        throw new Error("parent getter must not run");
      },
    });
    const workspaceGetterParent: Record<string, unknown> = {};
    Object.defineProperty(workspaceGetterParent, "workspaceId", {
      get() {
        calls.workspaceId += 1;
        throw new Error("workspace identity getter must not run");
      },
    });
    const workerIdGetterAssociation: Record<string, unknown> = {};
    Object.defineProperty(workerIdGetterAssociation, "workerId", {
      get() {
        calls.workerId += 1;
        throw new Error("worker identity getter must not run");
      },
    });
    const workerRunIdGetterAssociation: Record<string, unknown> = {};
    Object.defineProperty(workerRunIdGetterAssociation, "workerRunId", {
      get() {
        calls.workerRunId += 1;
        throw new Error("worker run identity getter must not run");
      },
    });
    const signalGetterHost: Record<string, unknown> = { association: {} };
    Object.defineProperty(signalGetterHost, "signal", {
      get() {
        calls.signal += 1;
        throw new Error("signal getter must not run");
      },
    });

    const cases: Array<{ readonly label: string; readonly host: unknown }> = [
      { label: "null", host: null },
      { label: "undefined", host: undefined },
      { label: "number", host: 42 },
      { label: "string", host: "forged" },
      { label: "ordinary-empty", host: {} },
      { label: "association-getter", host: associationGetterHost },
      {
        label: "parent-getter",
        host: { association: parentGetterAssociation },
      },
      {
        label: "parent-workspace-id-getter",
        host: { association: { parent: workspaceGetterParent } },
      },
      {
        label: "worker-id-getter",
        host: { association: workerIdGetterAssociation },
      },
      {
        label: "worker-run-id-getter",
        host: { association: workerRunIdGetterAssociation },
      },
      { label: "signal-getter", host: signalGetterHost },
      { label: "unpaired-high-surrogate", host: plainForgedHost("\ud800worker", "run") },
      { label: "unpaired-low-surrogate", host: plainForgedHost("worker", "\udc00run") },
      { label: "astral-exact-128-bytes", host: plainForgedHost("😀".repeat(32), "run") },
      {
        label: "astral-crossing-128-byte-boundary",
        host: plainForgedHost(`${"x".repeat(127)}😀`, "run"),
      },
      {
        label: "truncated-surrogate-pair",
        host: plainForgedHost(`${"x".repeat(126)}\ud83d`, "run"),
      },
      {
        label: "oversized-identities",
        host: plainForgedHost("w".repeat(65_536), "r".repeat(65_536)),
      },
    ];
    const resultBounds = inlineWorkerPolicy_resultBounds(policy());

    for (const sample of cases) {
      let handle: InlineWorkerRunHandle | undefined;
      assert.doesNotThrow(() => {
        handle = h.driver.startInlineWorker(
          { prompt: "must-not-run" },
          sample.host as InlineWorkerHostCapability,
        );
      }, sample.label);
      assert(handle, sample.label);
      const result = await handle.completion;
      assert.equal(result.status, "failed", sample.label);
      assert.equal(
        result.status === "failed" && result.error.code,
        "INVALID_ASSOCIATION",
        sample.label,
      );
      assert.equal(result.workerId, "rejected-worker", sample.label);
      assert.equal(result.workerRunId, "rejected-worker-run", sample.label);
      const decoded = inlineWorker_decodeResult(result, resultBounds);
      assert.equal(decoded.ok, true, sample.label);
      if (decoded.ok) assert.deepEqual(decoded.value, result);
    }

    assert.deepEqual(calls, {
      association: 0,
      parent: 0,
      workspaceId: 0,
      workerId: 0,
      workerRunId: 0,
      signal: 0,
    });
    assert.equal(h.createCalls(), 0);
    assert.equal(h.requests.length, 0);
    assert.deepEqual(supervisor.inlineWorkerSupervisor.capacityFor(h.ref), capacityBefore);
    assert.equal(supervisor.inlineWorkerSupervisor.activeCount, 0);
    assert.deepEqual([...supervisor.records.keys()], recordKeysBefore);
    assert.deepEqual([...record.pendingSdkToolCallIds], pendingBefore);
    assert.equal(record.activeTerminalRun, activeRunBefore);
    assert.equal(record.session.messages.length, messageCountBefore);
    assert.equal(record.session.sessionId, sessionIdBefore);
    assert.equal(supervisor.records.get(sessionKey(h.ref)), record);

    await nextEventLoopTurn();
    const timeoutsAfter = process
      .getActiveResourcesInfo()
      .filter((resource) => resource === "Timeout").length;
    assert.equal(timeoutsAfter, timeoutsBefore);
  },
);

await test(
  "forged, stale, closed and branch-changed associations fail before SDK creation",
  { timeout: 10_000 },
  async (t) => {
    const h = await createHarness(t);
    const runId = await h.activateRun(h.ref);
    h.startTool(h.ref, "oversized-prompt");
    const oversizedPromptHost = await h.host(h.ref, runId, "oversized-prompt");
    const oversizedPrompt = await h.driver.startInlineWorker(
      { prompt: "é".repeat(32_769) },
      oversizedPromptHost,
    ).completion;
    assert.equal(oversizedPrompt.status, "failed");
    assert.equal(
      oversizedPrompt.status === "failed" && oversizedPrompt.error.code,
      "INVALID_RESULT",
    );

    const forged = {
      association: {
        parent: h.ref,
        parentRunId: runId,
        parentGeneration: 1,
        parentNativeSessionId: "forged",
        parentToolCallId: "forged-tool",
        pendingSdkToolCallIds: ["forged-tool"],
        workerId: "forged-worker",
        workerRunId: "forged-run",
      },
      signal: new AbortController().signal,
    } as unknown as InlineWorkerHostCapability;
    const forgedResult = await h.driver.startInlineWorker({ prompt: "must-not-run" }, forged)
      .completion;
    assert.equal(forgedResult.status, "failed");
    assert.equal(
      forgedResult.status === "failed" && forgedResult.error.code,
      "INVALID_ASSOCIATION",
    );

    h.startTool(h.ref, "ended-tool");
    const endedHost = await h.host(h.ref, runId, "ended-tool");
    h.endTool(h.ref, "ended-tool");
    const endedResult = await h.driver.startInlineWorker({ prompt: "must-not-run" }, endedHost)
      .completion;
    assert.equal(endedResult.status, "failed");
    assert.equal(endedResult.status === "failed" && endedResult.error.code, "INVALID_ASSOCIATION");
    assert.equal(endedResult.workerId, endedHost.association.workerId);
    assert.equal(endedResult.workerRunId, endedHost.association.workerRunId);
    assert.equal(
      inlineWorker_decodeResult(endedResult, inlineWorkerPolicy_resultBounds(policy())).ok,
      true,
    );

    h.startTool(h.ref, "snapshot-tool");
    const snapshotHost = await h.host(h.ref, runId, "snapshot-tool");
    h.startTool(h.ref, "later-tool");
    const snapshotResult = await h.driver.startInlineWorker(
      { prompt: "must-not-run" },
      snapshotHost,
    ).completion;
    assert.equal(snapshotResult.status, "failed");

    const supervisor = (h.driver as unknown as { supervisor: TestSupervisor }).supervisor;
    const record = supervisor.records.get(sessionKey(h.ref));
    assert(record);
    record.session.sessionManager.appendThinkingLevelChange("high");
    const branchResult = await h.driver.startInlineWorker({ prompt: "must-not-run" }, snapshotHost)
      .completion;
    assert.equal(branchResult.status, "failed");

    await assert.rejects(
      h.driver.createInlineWorkerHostCapability(
        { workspaceId: "absent", sessionId: "absent" },
        "absent-run",
        "absent-tool",
        new AbortController().signal,
      ),
      /not live/,
    );
    const closedParent = await h.createSession();
    const closedRun = await h.activateRun(closedParent);
    h.startTool(closedParent, "closed-tool");
    const closedHost = await h.host(closedParent, closedRun, "closed-tool");
    await h.driver.closeSession(closedParent);
    const closedResult = await h.driver.startInlineWorker({ prompt: "must-not-run" }, closedHost)
      .completion;
    assert.equal(closedResult.status, "failed");
    assert.equal(
      closedResult.status === "failed" && closedResult.error.code,
      "INVALID_ASSOCIATION",
    );

    assert.equal(h.createCalls(), 0);
    assert.equal(h.requests.length, 0);
  },
);

await test(
  "single-flight replay is idempotent and completion before Stop remains success",
  { timeout: 10_000 },
  async (t) => {
    const h = await createHarness(t);
    const runId = await h.activateRun(h.ref);
    h.startTool(h.ref, "single-flight");
    const { host, handle } = await h.startWorker(h.ref, runId, "single-flight", "success-alpha");
    const replay = h.driver.startInlineWorker({ prompt: "success-alpha" }, host);
    assert.equal(replay, handle);
    const completed = await handle.completion;
    assert.equal(completed.status, "succeeded");
    const terminalSnapshot = { ...completed };

    await h.driver.cancelInlineWorkersForParent(h.ref);
    await h.driver.cancelInlineWorkersForParent(h.ref);
    assert.deepEqual(completed, terminalSnapshot);
    assert.equal(h.requests.length, 1);
    assert.equal(h.createCalls(), 1);
  },
);

await test(
  "caller, parent and deadline cancellation await authoritative settlement",
  { timeout: 10_000 },
  async (t) => {
    const h = await createHarness(t);
    const runId = await h.activateRun(h.ref);

    const caller = new AbortController();
    h.startTool(h.ref, "caller-cancel");
    const callerHandle = (
      await h.startWorker(h.ref, runId, "caller-cancel", "slow-caller", caller.signal)
    ).handle;
    await waitFor(() => h.requests.some((request) => request.prompt === "slow-caller"), "caller");
    caller.abort();
    assert.equal((await callerHandle.completion).status, "cancelled");
    await waitFor(
      () => Boolean(h.requests.find((request) => request.prompt === "slow-caller")?.closedBy),
      "caller response close",
    );

    h.startTool(h.ref, "parent-cancel");
    const parentHandle = (await h.startWorker(h.ref, runId, "parent-cancel", "slow-parent")).handle;
    await waitFor(() => h.requests.some((request) => request.prompt === "slow-parent"), "parent");
    await h.driver.cancelInlineWorkersForParent(h.ref);
    assert.equal((await parentHandle.completion).status, "cancelled");

    const deadlineHarness = await createHarness(t, { deadlineMs: 25 });
    const deadlineRun = await deadlineHarness.activateRun(deadlineHarness.ref);
    deadlineHarness.startTool(deadlineHarness.ref, "deadline");
    const deadlineHandle = (
      await deadlineHarness.startWorker(
        deadlineHarness.ref,
        deadlineRun,
        "deadline",
        "slow-deadline",
      )
    ).handle;
    assert.equal((await deadlineHandle.completion).status, "timedOut");
  },
);

await test(
  "abort rejection does not overwrite the eventual authoritative success",
  { timeout: 10_000 },
  async (t) => {
    const h = await createHarness(t);
    const originalCreate = h.workerOptions();
    void originalCreate;
    const runId = await h.activateRun(h.ref);
    h.startTool(h.ref, "abort-reject");
    const { handle } = await h.startWorker(h.ref, runId, "abort-reject", "delayed-success");
    await waitFor(
      () => h.requests.some((request) => request.prompt === "delayed-success"),
      "abort",
    );
    const worker = h.workerSessions()[0];
    assert(worker);
    t.mock.method(worker, "abort", async () => {
      throw new Error("synthetic abort rejection");
    });
    await h.driver.cancelInlineWorkersForParent(h.ref);
    assert.equal((await handle.completion).status, "succeeded");
  },
);

await test(
  "capacity rejects the fifth parent worker and ninth process worker before SDK creation",
  { timeout: 20_000 },
  async (t) => {
    const h = await createHarness(t);
    const second = await h.createSession();
    const third = await h.createSession();
    const runOne = await h.activateRun(h.ref);
    const runTwo = await h.activateRun(second);
    const runThree = await h.activateRun(third);
    const handles: InlineWorkerRunHandle[] = [];

    for (let index = 0; index < 4; index += 1) {
      const tool = `parent-one-${index}`;
      h.startTool(h.ref, tool);
      handles.push((await h.startWorker(h.ref, runOne, tool, `slow-one-${index}`)).handle);
    }
    await waitFor(() => h.createCalls() === 4, "four parent worker constructions");
    h.startTool(h.ref, "parent-one-excess");
    const fifth = (await h.startWorker(h.ref, runOne, "parent-one-excess", "slow-excess")).handle;
    const fifthResult = await fifth.completion;
    assert.equal(fifthResult.status, "failed");
    assert.equal(fifthResult.status === "failed" && fifthResult.error.code, "CAPACITY_EXCEEDED");
    assert.equal(h.createCalls(), 4);

    for (let index = 0; index < 4; index += 1) {
      const tool = `parent-two-${index}`;
      h.startTool(second, tool);
      handles.push((await h.startWorker(second, runTwo, tool, `slow-two-${index}`)).handle);
    }
    await waitFor(() => h.createCalls() === 8, "eight process worker constructions");
    h.startTool(third, "process-excess");
    const ninth = (await h.startWorker(third, runThree, "process-excess", "slow-process-excess"))
      .handle;
    const ninthResult = await ninth.completion;
    assert.equal(ninthResult.status, "failed");
    assert.equal(ninthResult.status === "failed" && ninthResult.error.code, "CAPACITY_EXCEEDED");
    assert.equal(h.createCalls(), 8);
    await waitFor(
      () => h.requests.filter((request) => request.prompt.startsWith("slow-")).length === 8,
      "eight active model requests",
    );

    await Promise.all([
      h.driver.cancelInlineWorkersForParent(h.ref),
      h.driver.cancelInlineWorkersForParent(second),
    ]);
    const results = await Promise.all(handles.map((handle) => handle.completion));
    assert.equal(results.filter((result) => result.status === "cancelled").length, 8);
  },
);

await test(
  "provider errors, exact/oversized results and storage boundaries are bounded",
  { timeout: 20_000 },
  async (t) => {
    const h = await createHarness(t);
    const runId = await h.activateRun(h.ref);
    const prompts = ["provider-error", "large-exact", "large-over"];
    const results: InlineWorkerTerminalResult[] = [];
    for (const [index, prompt] of prompts.entries()) {
      const tool = `limits-${index}`;
      h.startTool(h.ref, tool);
      const { handle } = await h.startWorker(h.ref, runId, tool, prompt);
      results.push(await handle.completion);
    }

    assert.equal(results[0]?.status, "failed");
    if (results[0]?.status === "failed") {
      assert.equal(results[0].error.code, "PROVIDER_ERROR");
      assert.ok(new TextEncoder().encode(results[0].error.message).byteLength <= 8_192);
      assert.doesNotMatch(results[0].error.message, /do-not-return/);
    }
    assert.equal(results[1]?.status, "succeeded");
    if (results[1]?.status === "succeeded") {
      assert.equal(new TextEncoder().encode(results[1].text).byteLength, 131_072);
    }
    assert.equal(results[2]?.status, "failed");
    assert.equal(results[2]?.status === "failed" && results[2].error.code, "RESULT_TOO_LARGE");

    const workerIds = h.workerSessions().map((session) => session.sessionId);
    const files = await listFiles(h.root);
    assert.equal(
      files.some((file) => file.endsWith(".jsonl")),
      false,
    );
    assert.equal(
      files.some((file) => file.includes("lease")),
      false,
    );
    const catalog = await readFile(join(h.root, "catalogs.json"), "utf8");
    for (const workerId of workerIds) assert.doesNotMatch(catalog, new RegExp(workerId));
    assert.doesNotMatch(catalog, /provider-error|large-exact|large-over/);

    const workerSource = await readFile(
      new URL("../src/inline-worker.ts", import.meta.url),
      "utf8",
    );
    const supervisorSource = await readFile(
      new URL("../src/inline-worker-supervisor.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(workerSource, /SessionSupervisor/);
    assert.doesNotMatch(workerSource, /spawn_worker/);
    assert.doesNotMatch(supervisorSource, /DesktopAppState|SessionDriverEvent|registerTool/);
  },
);

await test(
  "a restarted driver admits no old worker and replay stays inside the live process",
  { timeout: 10_000 },
  async (t) => {
    const h = await createHarness(t);
    const runId = await h.activateRun(h.ref);
    h.startTool(h.ref, "restart-tool");
    const { host, handle } = await h.startWorker(h.ref, runId, "restart-tool", "success-alpha");
    assert.equal((await handle.completion).status, "succeeded");

    const restarted = new PiSdkDriver({
      agentDir: join(h.root, "agent"),
      catalogFilePath: join(h.root, "catalogs.json"),
      inlineWorkerOptions: {
        createAgentSessionImpl: async (options) => createAgentSession(options),
      },
    });
    t.after(() => restarted.closeSession(h.ref));
    const stale = await restarted.startInlineWorker({ prompt: "success-beta" }, host).completion;
    assert.equal(stale.status, "failed");
    assert.equal(stale.status === "failed" && stale.error.code, "INVALID_ASSOCIATION");
  },
);
