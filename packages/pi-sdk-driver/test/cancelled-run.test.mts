import assert from "node:assert/strict";
import test from "node:test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { SessionSupervisor } from "../dist/index.js";

await test("requested abort emits only idle state, without completion or failure notifications", () => {
  const record = {
    ref: { workspaceId: "workspace", sessionId: "session" },
    workspace: { workspaceId: "workspace", path: "/synthetic/workspace" },
    title: "Cancelled turn",
    status: "running",
    updatedAt: new Date().toISOString(),
    runningRunId: "run",
    cancellationRequested: true,
    queuedMessages: [],
  };
  // Exercise the runtime-event translation directly; no live session, provider,
  // disk state or credentials are needed to prove the emitted event contract.
  const supervisor = new SessionSupervisor() as unknown as {
    mapAgentEvent(input: typeof record, event: unknown): SessionDriverEvent[];
  };
  supervisor.mapAgentEvent(record, {
    type: "agent_end",
    messages: [{ role: "assistant", stopReason: "aborted", errorMessage: "Request was aborted" }],
  });
  const events = supervisor.mapAgentEvent(record, { type: "agent_settled" });
  assert.deepEqual(
    events.map((event) => event.type),
    ["sessionUpdated"],
  );
  assert.equal(record.status, "idle");
  assert.equal(record.runningRunId, undefined);
  assert.equal(record.cancellationRequested, false);
  supervisor.mapAgentEvent(record, { type: "agent_start" });
  supervisor.mapAgentEvent(record, {
    type: "agent_end",
    messages: [{ role: "assistant", stopReason: "aborted", errorMessage: "Unexpected abort" }],
  });
  const nextEvents = supervisor.mapAgentEvent(record, { type: "agent_settled" });
  assert.equal(nextEvents[0]?.type, "runFailed", "the cancellation marker is consumed once");
});

await test("authoritative no-assistant settlement retains captured identity after visible running id clears", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { JsonCatalogStore } = await import("@pi-gui/catalogs/node");
  const { buildSnapshot } = await import("../dist/session-supervisor-utils.js");
  const root = await mkdtemp(join(tmpdir(), "zero-assistant-terminal-"));
  const catalog = new JsonCatalogStore({ catalogFilePath: join(root, "catalog.json") });
  const ref = { workspaceId: "workspace", sessionId: "native" };
  await catalog.sessions.upsertSession({
    sessionRef: ref,
    workspaceId: ref.workspaceId,
    title: "No assistant",
    status: "idle",
    updatedAt: "2026-10-31T00:00:00Z",
  });
  const generation = await catalog.sessions.beginRun(ref, "captured-run");
  const record = {
    ref,
    workspace: { workspaceId: ref.workspaceId, path: root },
    title: "No assistant",
    status: "idle",
    updatedAt: "2026-10-31T00:00:00Z",
    queuedMessages: [],
    runningRunId: undefined,
    activeTerminalRun: {
      runId: "captured-run",
      generation,
      sessionRef: ref,
      nativeSessionId: ref.sessionId,
    },
    cancellationRequested: true,
    stopBeforeSettle: true,
    runAwaitingSettle: true,
    session: {
      sessionId: ref.sessionId,
      messages: [{ role: "user", content: "Input" }],
      sessionManager: {
        getBranch: () => [{ type: "message", id: "input", message: { role: "user" } }],
      },
    },
  };
  const supervisor = new SessionSupervisor({ catalogStorage: catalog });
  // Runtime boundary injection exercises the missing representation without rewriting history.
  const boundary = supervisor as unknown as {
    refreshUsage(): void;
    collectSessionCommands(): unknown[];
    mapAgentEvent(record: unknown, event: unknown): SessionDriverEvent[];
  };
  boundary.refreshUsage = () => undefined;
  boundary.collectSessionCommands = () => [];
  const events = boundary.mapAgentEvent(record, { type: "agent_settled", aborted: true });
  await (record as typeof record & { terminalWrite: Promise<void> }).terminalWrite;
  assert.deepEqual(
    events.map((event) => event.type),
    ["sessionUpdated"],
  );
  const terminal = (await catalog.sessions.getSession(ref))?.terminalRun;
  assert.equal(terminal?.runId, "captured-run");
  assert.equal(terminal?.outcome, "stopped");
  assert.equal(buildSnapshot(record).lastRunOutcome, "stopped");
});
