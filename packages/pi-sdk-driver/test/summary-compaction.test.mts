import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionRuntime, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { PiSdkDriver } from "../dist/pi-sdk-driver.js";
import { createAgentSessionRuntimeWithNpmFallback } from "../dist/npm-package-fallback.js";

for (const automatic of [false, true]) {
  await test(`${automatic ? "automatic threshold" : "manual"} compaction uses chosen model without switching chat model`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pi-summary-compaction-"));
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(cwd);
    await mkdir(agentDir);
    await writeFile(join(agentDir, "auth.json"), "{}");
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        packages: [],
        retry: { enabled: false },
        cacheWarming: "off",
        compaction: { enabled: automatic, reserveTokens: 1000, keepRecentTokens: 0 },
      }),
    );
    const calls: string[] = [];
    const extension: ExtensionFactory = (pi) => {
      pi.registerProvider("compact-proof", {
        baseUrl: "http://127.0.0.1:9/never-contact",
        apiKey: "TEST_ONLY",
        api: "compact-proof",
        models: ["chat", "summary"].map((id) => ({
          id,
          name: id,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 10000,
          maxTokens: 1500,
        })),
        streamSimple(model) {
          calls.push(model.id);
          const text =
            model.id === "summary"
              ? "## Goal\nPreserve test goal.\n## Progress\nInspected fixture.\n## Next Steps\nContinue test."
              : "Completed fixture inspection.";
          const message: AssistantMessage = {
            role: "assistant",
            content: [{ type: "text", text }],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: model.id === "chat" ? 9500 : 100,
              output: 10,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 9510,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
          };
          const stream = createAssistantMessageEventStream();
          stream.push({ type: "start", partial: { ...message, content: [] } });
          stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
          stream.push({ type: "done", reason: "stop", message });
          return stream;
        },
      });
    };
    let runtime!: AgentSessionRuntime;
    const driver = new PiSdkDriver({
      agentDir,
      catalogFilePath: join(root, "catalogs.json"),
      summaryModelForSession: async () => ({ provider: "compact-proof", modelId: "summary" }),
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
      { workspaceId: "proof", path: cwd },
      { initialModel: { provider: "compact-proof", modelId: "chat" } },
    );
    t.after(async () => {
      await driver.closeSession(ref);
    });
    await driver.sendUserMessage(ref, { text: "Inspect fixture. ".repeat(50) });
    if (automatic) await driver.sendUserMessage(ref, { text: "Continue fixture." });
    else await driver.compactSession(ref);
    assert.ok(calls.includes("summary"), `summary model used, observed ${calls.join(", ")}`);
    assert.equal(runtime.session.model?.id, "chat");
    const compactions = runtime.session.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "compaction");
    assert.ok(compactions.length > 0);
    assert.ok(compactions.at(-1)?.summary.includes("Preserve test goal"));
    assert.ok(compactions.at(-1)?.usage);
  });
}
