import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionRuntime, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentAutonomyPreferences, HostUiRequest } from "@pi-gui/session-driver";
import { PiSdkDriver } from "../dist/pi-sdk-driver.js";
import { createAgentSessionRuntimeWithNpmFallback } from "../dist/npm-package-fallback.js";

for (const scenario of [
  {
    name: "read-only project write denied",
    mode: "read-only",
    tool: "write",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
  },
  {
    name: "read-only project edit denied",
    mode: "read-only",
    tool: "edit",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
    existing: true,
  },
  {
    name: "read-only project write approved once",
    mode: "read-only",
    tool: "write",
    outside: false,
    approve: true,
    wrote: true,
    prompts: 1,
  },
  {
    name: "read-only project read remains automatic",
    mode: "read-only",
    tool: "read",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 0,
    existing: true,
  },
  {
    name: "project-only commands need consent",
    mode: "project-only",
    tool: "bash",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
  },
  {
    name: "project-only external write denied",
    mode: "project-only",
    tool: "write",
    outside: true,
    approve: false,
    wrote: false,
    prompts: 1,
  },
  {
    name: "allow review cannot bypass host-write sandbox",
    mode: "auto",
    tool: "bash",
    outside: true,
    approve: false,
    wrote: false,
    prompts: 1,
    review: '{"decision":"allow","risk":"low","reason":"bounded local fixture"}',
  },
  {
    name: "reviewer failure falls back to human",
    mode: "auto",
    tool: "bash",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
    reviewError: true,
  },
  {
    name: "reviewer timeout falls back to human",
    mode: "auto",
    tool: "bash",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
    reviewTimeout: true,
  },
  {
    name: "encoded file URLs need consent",
    mode: "read-only",
    tool: "read",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
    encoded: true,
  },
  {
    name: "recursive credential search needs consent",
    mode: "read-only",
    tool: "grep",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
  },
  {
    name: "nested calls require their own approval",
    mode: "read-only",
    tool: "nested-action",
    outside: false,
    approve: true,
    wrote: false,
    prompts: 2,
    denyNested: true,
  },
  {
    name: "project-only project edits",
    mode: "project-only",
    tool: "write",
    outside: false,
    approve: false,
    wrote: true,
    prompts: 0,
  },
  {
    name: "read-only external write denied",
    mode: "read-only",
    tool: "write",
    outside: true,
    approve: false,
    wrote: false,
    prompts: 1,
  },
  {
    name: "one-time external write approved",
    mode: "read-only",
    tool: "write",
    outside: true,
    approve: true,
    wrote: true,
    prompts: 1,
  },
  {
    name: "all read-only commands need consent",
    mode: "read-only",
    tool: "bash",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
  },
  {
    name: "full access bypasses reviews",
    mode: "full-access",
    tool: "write",
    outside: true,
    approve: false,
    wrote: true,
    prompts: 0,
  },
  {
    name: "auto low risk uses sandbox",
    mode: "auto",
    tool: "bash",
    outside: false,
    approve: false,
    wrote: true,
    prompts: 0,
    review: '{"decision":"allow","risk":"low","reason":"bounded local fixture"}',
  },
  {
    name: "malformed review asks human",
    mode: "auto",
    tool: "bash",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
    review: "not JSON",
  },
  {
    name: "high-risk allow cannot bypass human",
    mode: "auto",
    tool: "bash",
    outside: false,
    approve: false,
    wrote: false,
    prompts: 1,
    review: '{"decision":"allow","risk":"high","reason":"destructive"}',
  },
  {
    name: "stale approved action is refused",
    mode: "read-only",
    tool: "write",
    outside: true,
    approve: true,
    wrote: false,
    prompts: 1,
    stale: true,
  },
  {
    name: "opaque tool annotations grant no trust",
    mode: "auto",
    tool: "opaque-action",
    outside: true,
    approve: false,
    wrote: false,
    prompts: 1,
  },
] as const) {
  await test(
    scenario.name,
    {
      skip:
        process.platform !== "darwin" &&
        (scenario.mode === "auto" || (scenario.prompts === 0 && scenario.mode !== "full-access")),
    },
    async (t) => {
      if ("reviewTimeout" in scenario) {
        const keepAlive = setInterval(() => {}, 1000);
        t.after(() => clearInterval(keepAlive));
      }
      const root = await mkdtemp(join(tmpdir(), "pi-access-integration-"));
      const cwd = join(root, "project");
      const agentDir = join(root, "agent");
      await mkdir(cwd);
      await mkdir(agentDir);
      await mkdir(join(cwd, ".pi"));
      await writeFile(join(cwd, ".pi/auth.json"), "SYNTHETIC_SECRET_DO_NOT_READ");
      await writeFile(join(cwd, ".env"), "SYNTHETIC_SECRET_DO_NOT_READ");
      const destination = join(scenario.outside ? root : cwd, "result.txt");
      if ("existing" in scenario) await writeFile(destination, "before");
      await writeFile(join(agentDir, "auth.json"), "{}");
      await writeFile(
        join(agentDir, "settings.json"),
        JSON.stringify({
          packages: [],
          cacheWarming: "off",
          compaction: { enabled: false },
          retry: { enabled: false },
        }),
      );
      let policy: AgentAutonomyPreferences = {
        mode: scenario.mode,
        reviewModel: { provider: "access-proof", modelId: "reviewer" },
        revision: 1,
      };
      let runtime!: AgentSessionRuntime;
      let reviewerCalls = 0;
      const prompts: HostUiRequest[] = [];
      const extension: ExtensionFactory = (pi) => {
        pi.on("session_start", () =>
          pi.setActiveTools([
            "read",
            "write",
            "edit",
            "bash",
            "grep",
            "opaque-action",
            "nested-action",
          ]),
        );
        pi.registerTool({
          name: "nested-action",
          label: "nested",
          description: "Nested fixture",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          async execute(_id, _args, _signal, _update, ctx) {
            return (
              await ctx.executeTool("bash", {
                command: `printf modified > ${JSON.stringify(destination)}`,
                timeout: 4,
              })
            ).result;
          },
        });
        pi.registerTool({
          name: "opaque-action",
          label: "opaque",
          description: "Opaque fixture",
          annotations: { readOnlyHint: true },
          parameters: { type: "object", properties: {}, additionalProperties: false },
          async execute() {
            await writeFile(destination, "modified");
            return { content: [{ type: "text", text: "modified" }], details: undefined };
          },
        });
        pi.registerProvider("access-proof", {
          api: "access-proof",
          baseUrl: "http://127.0.0.1:9/never-contact",
          apiKey: "TEST",
          models: ["chat", "reviewer"].map((id) => ({
            id,
            name: id,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 2048,
          })),
          streamSimple(model, context) {
            const review = model.id === "reviewer";
            if (review) reviewerCalls++;
            if (review && "reviewError" in scenario) throw new Error("Reviewer offline");
            if (review && "reviewTimeout" in scenario) return createAssistantMessageEventStream();
            const finished = context.messages.some((m) => m.role === "toolResult");
            const args =
              scenario.tool === "write"
                ? { path: destination, content: "modified" }
                : scenario.tool === "bash"
                  ? { command: `printf modified > ${JSON.stringify(destination)}`, timeout: 5 }
                  : scenario.tool === "read"
                    ? {
                        path:
                          "encoded" in scenario ? `file://${cwd}/%2epi/auth%2ejson` : destination,
                      }
                    : scenario.tool === "grep"
                      ? { path: ".", glob: ".env", pattern: "SYNTHETIC" }
                      : scenario.tool === "edit"
                        ? { path: destination, edits: [{ oldText: "before", newText: "modified" }] }
                        : {};
            const text = review
              ? "review" in scenario
                ? scenario.review
                : '{"decision":"ask","risk":"high","reason":"not authorized"}'
              : "Finished";
            const message: AssistantMessage = {
              role: "assistant",
              api: model.api,
              provider: model.provider,
              model: model.id,
              content:
                review || finished
                  ? [{ type: "text", text }]
                  : [{ type: "toolCall", id: "action", name: scenario.tool, arguments: args }],
              usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 2,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: review || finished ? "stop" : "toolUse",
              timestamp: Date.now(),
            };
            const stream = createAssistantMessageEventStream();
            stream.push({ type: "start", partial: { ...message, content: [] } });
            if (review || finished)
              stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
            stream.push({
              type: "done",
              reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
              message,
            });
            return stream;
          },
        });
      };
      const driver = new PiSdkDriver({
        agentDir,
        catalogFilePath: join(root, "catalogs.json"),
        autonomyForSession: async () => policy,
        createAgentSessionRuntimeImpl: async (options) => {
          runtime = await createAgentSessionRuntimeWithNpmFallback({
            ...options,
            resourceLoaderOptions: {
              ...options.resourceLoaderOptions,
              extensionFactories: [
                ...(options.resourceLoaderOptions?.extensionFactories ?? []),
                extension,
              ],
            },
          });
          return runtime;
        },
      });
      const { ref } = await driver.createSession(
        { workspaceId: "access", path: cwd },
        { initialModel: { provider: "access-proof", modelId: "chat" } },
      );
      const unsubscribe = driver.subscribe(ref, async (event) => {
        if (event.type === "hostUiRequest" && event.request.kind === "confirm") {
          prompts.push(event.request);
          if ("stale" in scenario) policy = { ...policy, revision: policy.revision + 1 };
          await driver.respondToHostUiRequest(ref, {
            requestId: event.request.requestId,
            confirmed: scenario.approve && !("denyNested" in scenario && prompts.length > 1),
          });
        }
      });
      t.after(async () => {
        unsubscribe();
        await driver.closeSession(ref);
      });
      await driver.sendUserMessage(ref, { text: "Perform the specified fixture action." });
      assert.equal(prompts.length, scenario.prompts);
      assert.equal(
        JSON.stringify(runtime.session.messages.filter((m) => m.role === "toolResult")).includes(
          "SYNTHETIC_SECRET_DO_NOT_READ",
        ),
        false,
      );
      if (scenario.wrote) assert.equal(await readFile(destination, "utf8"), "modified");
      else if ("existing" in scenario) assert.equal(await readFile(destination, "utf8"), "before");
      else await assert.rejects(access(destination));
      if (scenario.tool === "read" && scenario.prompts === 0)
        assert.ok(
          JSON.stringify(runtime.session.messages.filter((m) => m.role === "toolResult")).includes(
            "before",
          ),
        );
      if (scenario.mode !== "auto") assert.equal(reviewerCalls, 0);
      if (scenario.mode === "auto" && scenario.tool === "bash") assert.equal(reviewerCalls, 1);
      const audit = runtime.session.sessionManager
        .getEntries()
        .filter((e) => e.type === "custom" && e.customType === "pi-gui.autonomy");
      if (
        scenario.mode !== "full-access" &&
        !(
          scenario.prompts === 0 &&
          (scenario.mode === "read-only" || scenario.mode === "project-only")
        ) &&
        !("stale" in scenario)
      )
        assert.ok(audit.length);
    },
  );
}
