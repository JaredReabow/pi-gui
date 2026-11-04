import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { SessionSupervisor } from "../dist/session-supervisor.js";
import { createAgentSessionRuntimeWithNpmFallback } from "../dist/npm-package-fallback.js";
import { forcePersistPiSession } from "../dist/compat/pi-session-persistence.js";

const assistant = (content: unknown) => ({
  role: "assistant" as const,
  content,
  api: "openai-completions" as const,
  provider: "fixture",
  model: "fixture",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
  timestamp: Date.now(),
});

await test("edits and deletions update visible history and model context across reopen", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-transcript-message-actions-"));
  const agentDir = join(root, "agent");
  const workspacePath = join(root, "workspace");
  await mkdir(agentDir);
  await mkdir(workspacePath);
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const runtimes: AgentSessionRuntime[] = [];
  const supervisor = new SessionSupervisor({
    agentDir,
    catalogFilePath: join(root, "catalogs.json"),
    createAgentSessionRuntimeImpl: async (options) => {
      const runtime = await createAgentSessionRuntimeWithNpmFallback(options);
      runtimes.push(runtime);
      return runtime;
    },
  });
  const workspace = await supervisor.registerWorkspace(workspacePath);
  const snapshot = await supervisor.createSession(workspace);
  const runtimeSession = runtimes[0]!.session;
  const manager = runtimeSession.sessionManager;
  const userId = manager.appendMessage({
    role: "user",
    content: "Original user prompt",
    timestamp: Date.now(),
  });
  const answerId = manager.appendMessage(
    assistant([
      { type: "text", text: "Original assistant reply" },
      {
        type: "toolCall",
        id: "lookup-1",
        name: "read",
        arguments: { path: "notes.txt" },
      },
    ]),
  );
  const toolResultId = manager.appendMessage({
    role: "toolResult",
    toolCallId: "lookup-1",
    toolName: "read",
    content: [{ type: "text", text: "Original tool output" }],
    isError: false,
    timestamp: Date.now(),
  });
  runtimeSession.refreshContext();
  forcePersistPiSession(manager);

  await supervisor.editTranscriptMessage(snapshot.ref, userId, "Edited user prompt");
  await supervisor.editTranscriptMessage(snapshot.ref, answerId, "Edited assistant reply");

  const visibleAfterEdit = (await supervisor.getTranscript(snapshot.ref)).filter(
    (item) => item.kind === "message",
  );
  assert.deepEqual(
    visibleAfterEdit.map((item) => ({ id: item.id, text: item.text })),
    [
      { id: userId, text: "Edited user prompt" },
      { id: answerId, text: "Edited assistant reply" },
    ],
  );
  assert.match(JSON.stringify(runtimeSession.messages), /Edited user prompt/);
  assert.match(JSON.stringify(runtimeSession.messages), /Edited assistant reply/);
  assert.match(JSON.stringify(runtimeSession.messages), /lookup-1/);

  await supervisor.closeSession(snapshot.ref);
  assert.deepEqual(
    (await supervisor.getTranscript(snapshot.ref))
      .filter((item) => item.kind === "message")
      .map((item) => ({ id: item.id, text: item.text })),
    [
      { id: userId, text: "Edited user prompt" },
      { id: answerId, text: "Edited assistant reply" },
    ],
  );

  await supervisor.openSession(snapshot.ref);
  await supervisor.deleteTranscriptMessage(snapshot.ref, userId);
  await supervisor.deleteTranscriptMessage(snapshot.ref, answerId);

  const transcriptAfterDelete = await supervisor.getTranscript(snapshot.ref);
  assert.deepEqual(
    transcriptAfterDelete.filter((item) => item.kind === "message"),
    [],
  );
  assert.equal(
    transcriptAfterDelete.some((item) => item.kind === "tool"),
    false,
    "deleting a reply also removes its tool rows",
  );
  const liveMessages = runtimes.at(-1)?.session.messages ?? [];
  assert.equal(
    liveMessages.some((message) => message.role === "user"),
    false,
  );
  assert.equal(
    liveMessages.some((message) => message.role === "assistant"),
    false,
  );
  assert.equal(
    liveMessages.some(
      (message) => message.role === "toolResult" && message.toolCallId === "lookup-1",
    ),
    false,
  );

  const branch = runtimes.at(-1)!.session.sessionManager.getBranch();
  assert.equal(
    branch.some(
      (entry) =>
        entry.type === "message" &&
        (entry.id === userId || entry.id === answerId || entry.id === toolResultId),
    ),
    true,
    "the append-only file retains the original entries",
  );
  assert.equal(
    branch.filter(
      (entry) => entry.type === "custom" && entry.customType === "pi-gui.transcript-history",
    ).length,
    4,
    "each edit and delete has a branch-local history marker",
  );
});
