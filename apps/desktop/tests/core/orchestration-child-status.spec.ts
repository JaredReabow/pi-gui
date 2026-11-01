import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { OrchestrationChildThread } from "../../contracts/desktop-state";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  runOrchestrationRuntimeTool,
  seedAgentDir,
  seedNamedTextSessionFixture,
} from "../helpers/electron-app";

/** Fixture-backed tool proof: no visible read_thread product surface exists. */
test("the first read_thread after a two-process restart returns hydrated completion", async ({}, testInfo) => {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("child-cold-read");
  await seedAgentDir(agentDir, { withOpenAiAuth: false });
  const completed = await seedNamedTextSessionFixture(agentDir, workspacePath, {
    title: "Completed cold child",
    userText: "Work",
    assistantText: "S01B cold completion",
  });
  const options = { agentDir, scrubProviderEnv: true, testMode: "background" as const };
  const first = await launchDesktop(userDataDir, {
    ...options,
    initialWorkspaces: [workspacePath],
  });
  const proof: Record<string, unknown> = { userDataDir, workspacePath };
  let parentRef = { workspaceId: "", sessionId: "" };
  let queuedSessionId = "";
  try {
    const window = await first.firstWindow();
    proof.firstIdentity = await first.inspectIdentity();
    await createNamedThread(window, "Never started child");
    queuedSessionId = (await getDesktopState(window)).selectedSessionId;
    await createNamedThread(window, "Cold read parent");
    const state = await getDesktopState(window);
    parentRef = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
  } finally {
    proof.firstCleanup = await first.close();
  }
  // Persist only scratch-profile child links between processes; the transcript is
  // native Pi session data. Neither child is selected or read in process one.
  const uiPath = join(userDataDir, "ui-state.json");
  const ui = JSON.parse(await readFile(uiPath, "utf8")) as Record<string, unknown>;
  const timestamp = new Date().toISOString();
  ui.orchestrationChildren = [completed.sessionId, queuedSessionId].map(
    (childSessionId, index) =>
      ({
        id: index === 0 ? "cold-completed" : "cold-queued",
        parentWorkspaceId: parentRef.workspaceId,
        parentSessionId: parentRef.sessionId,
        childWorkspaceId: parentRef.workspaceId,
        childSessionId,
        title: "Cold child",
        goal: "Work",
        status: "queued",
        latestTranscript: "",
        transcript: [],
        evidence: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }) satisfies OrchestrationChildThread,
  );
  await writeFile(uiPath, JSON.stringify(ui));
  const second = await launchDesktop(userDataDir, options);
  try {
    await second.firstWindow();
    proof.secondIdentity = await second.inspectIdentity();
    const read = (threadId: string) =>
      runOrchestrationRuntimeTool(second, {
        toolName: "read_thread",
        sessionRef: parentRef,
        params: { thread_id: threadId },
      });
    // Exactly one read: a warming call must never make this regression pass.
    const cold = await read("cold-completed");
    proof.firstColdRead = cold;
    expect(cold.details).toMatchObject({ status: "complete" });
    expect(cold.details?.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "S01B cold completion" })]),
    );
    const queued = await read("cold-queued");
    proof.queuedControl = queued;
    expect(queued.details).toMatchObject({ status: "queued", messages: [] });
    const missing = await read("missing-s01b");
    proof.missingControl = missing;
    expect(missing.details?.error).toBe("Unknown thread: missing-s01b");
  } finally {
    proof.secondCleanup = await second.close();
    const json = JSON.stringify(proof, null, 2);
    await testInfo.attach("cold-read-proof", { body: json, contentType: "application/json" });
    if (process.env.PI_APP_ORCHESTRATION_PROOF_DIR) {
      await writeFile(
        join(process.env.PI_APP_ORCHESTRATION_PROOF_DIR, "cold-read-proof.json"),
        json,
      );
    }
  }
});

/** Real Pi execution against loopback, isolated profile, hidden owned Electron processes. */
test("identified cancellation survives two hidden processes and a later loopback run supersedes it", async ({}, testInfo) => {
  const { createServer } = await import("node:http");
  let requests = 0;
  let respond = false;
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    if (!respond) return; // First request is held before any assistant byte.
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = { id: "local-proof", object: "chat.completion.chunk", created: 1, model: "slow" };
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "RECOVERED_LOCAL_RUN" }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("identified-cancellation");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["slow-test/slow"],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "slow-test",
      defaultModel: "slow",
      enabledModels: ["slow-test/slow"],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "slow-test": {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: "openai-completions",
          apiKey: "unused",
          models: [{ id: "slow" }],
        },
      },
    }),
  );
  const options = { agentDir, scrubProviderEnv: true, testMode: "background" as const };
  const proof: Record<string, unknown> = { userDataDir, workspacePath, loopbackPort: port };
  let first: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  let second: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  let childId = "";
  let childSessionId = "";
  let queuedSessionId = "";
  let parentRef = { workspaceId: "", sessionId: "" };
  try {
    first = await launchDesktop(userDataDir, { ...options, initialWorkspaces: [workspacePath] });
    const window = await first.firstWindow();
    proof.firstIdentity = await first.inspectIdentity();
    await createNamedThread(window, "Never started cancellation control");
    queuedSessionId = (await getDesktopState(window)).selectedSessionId;
    await createNamedThread(window, "Cancellation parent");
    const state = await getDesktopState(window);
    parentRef = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
    const created = await runOrchestrationRuntimeTool(first, {
      toolName: "create_child_thread",
      toolCallId: "identified-stop",
      sessionRef: parentRef,
      params: { prompt: "Hold until stopped." },
    });
    proof.createTool = created;
    await expect.poll(() => requests).toBe(1);
    const child = (await getDesktopState(window)).orchestrationChildren.find(
      (c) => c.sourceToolCallId === "identified-stop",
    )!;
    childId = child.id;
    childSessionId = child.childSessionId!;
    await window.evaluate(async (childThreadId) => {
      await globalThis.window.piApp!.setChildSupervisionLoop({ childThreadId, gate: "stop" });
    }, childId);
    await expect
      .poll(
        async () =>
          (await getDesktopState(window)).childThreadLinks.find((c) => c.id === childId)?.status,
      )
      .toBe("cancelled");
    proof.afterStop = await runOrchestrationRuntimeTool(first, {
      toolName: "read_thread",
      sessionRef: parentRef,
      params: { thread_id: childId },
    });
    proof.requestsBeforeRestart = requests;
    proof.firstCleanup = await first.close();
    first = undefined;
    const uiPath = join(userDataDir, "ui-state.json");
    const ui = JSON.parse(await readFile(uiPath, "utf8")) as {
      orchestrationChildren: OrchestrationChildThread[];
    };
    const timestamp = new Date().toISOString();
    ui.orchestrationChildren.push({
      id: "cancel-queued-control",
      parentWorkspaceId: parentRef.workspaceId,
      parentSessionId: parentRef.sessionId,
      childWorkspaceId: parentRef.workspaceId,
      childSessionId: queuedSessionId,
      title: "Never started",
      goal: "Control",
      status: "queued",
      latestTranscript: "",
      transcript: [],
      evidence: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await writeFile(uiPath, JSON.stringify(ui));
    const catalog = JSON.parse(await readFile(join(userDataDir, "catalogs.json"), "utf8")) as {
      sessions: { sessionRef: { sessionId: string }; sessionFilePath: string }[];
      runs: Record<string, unknown>;
    };
    proof.persistedRuns = catalog.runs;
    const sessionFile = catalog.sessions.find(
      (s) => s.sessionRef.sessionId === childSessionId,
    )!.sessionFilePath;
    const nativeEntries = (await readFile(sessionFile, "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            message?: { role: string; content?: unknown; stopReason?: string };
          },
      );
    proof.nativeAssistantEntries = nativeEntries.filter(
      (entry) => entry.type === "message" && entry.message?.role === "assistant",
    );
    second = await launchDesktop(userDataDir, options);
    const reopened = await second.firstWindow();
    proof.secondIdentity = await second.inspectIdentity();
    const cold = await runOrchestrationRuntimeTool(second, {
      toolName: "read_thread",
      sessionRef: parentRef,
      params: { thread_id: childId },
    });
    proof.firstColdRead = cold;
    expect(cold.details?.status).toBe("cancelled");
    expect(cold.details?.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "worker" })]),
    );
    proof.firstList = await runOrchestrationRuntimeTool(second, {
      toolName: "list_threads",
      sessionRef: parentRef,
      params: {},
    });
    expect((proof.firstList as { details: { threads: unknown[] } }).details.threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threadId: childId, status: "cancelled" }),
        expect.objectContaining({ threadId: "cancel-queued-control", status: "queued" }),
      ]),
    );
    const queued = await runOrchestrationRuntimeTool(second, {
      toolName: "read_thread",
      sessionRef: parentRef,
      params: { thread_id: "cancel-queued-control" },
    });
    proof.queuedControl = queued;
    expect(queued.details?.status).toBe("queued");
    const row = reopened.locator(`.session-row[data-session-id="${childSessionId}"]`);
    await expect(row).toHaveAttribute("data-child-status", "cancelled");
    await expect(row).toHaveAttribute("aria-description", /^Child thread cancelled(?:,|$)/);
    proof.sidebarAccessible = await row.ariaSnapshot();
    proof.sidebarAttributes = await row.evaluate((node) => ({
      status: node.getAttribute("data-child-status"),
      description: node.getAttribute("aria-description"),
    }));
    expect(requests).toBe(1);
    proof.requestsAfterColdReads = requests;
    respond = true;
    proof.laterRun = await runOrchestrationRuntimeTool(second, {
      toolName: "send_message_to_thread",
      sessionRef: parentRef,
      params: { thread_id: childId, message: "Recover now." },
    });
    await expect
      .poll(
        async () =>
          (await getDesktopState(reopened)).childThreadLinks.find((c) => c.id === childId)?.status,
      )
      .toBe("complete");
    const recovered = await runOrchestrationRuntimeTool(second, {
      toolName: "read_thread",
      sessionRef: parentRef,
      params: { thread_id: childId },
    });
    proof.recovered = recovered;
    expect(JSON.stringify(recovered)).toContain("RECOVERED_LOCAL_RUN");
    expect(requests).toBe(2);
    proof.requestsAfterRecovery = requests;
  } finally {
    if (first) proof.firstCleanup = await first.close();
    if (second) proof.secondCleanup = await second.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const json = JSON.stringify(proof, null, 2);
    await testInfo.attach("identified-cancellation-proof", {
      body: json,
      contentType: "application/json",
    });
    if (process.env.PI_APP_ORCHESTRATION_PROOF_DIR)
      await writeFile(
        join(process.env.PI_APP_ORCHESTRATION_PROOF_DIR, "identified-cancellation-proof.json"),
        json,
      );
  }
});

/** Synthetic authoritative settlement: native Pi input only, no runtime-generated cancellation. */
test("synthetic zero-assistant settlement reads cancelled on the first read/list/sidebar after restart", async ({}, testInfo) => {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { JsonCatalogStore } = await import("@pi-gui/catalogs/node");
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("synthetic-zero-assistant");
  await seedAgentDir(agentDir, { withOpenAiAuth: false });
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  let manager: ReturnType<typeof SessionManager.create>;
  try {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    manager = SessionManager.create(workspacePath);
    manager.appendMessage({
      role: "user",
      content: "Synthetic input with no assistant entry",
      timestamp: Date.now(),
    });
    manager.appendSessionInfo("Synthetic zero assistant");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
  const options = { agentDir, scrubProviderEnv: true, testMode: "background" as const };
  const proof: Record<string, unknown> = {
    kind: "synthetic authoritative-settlement fixture; not runtime-generated",
    userDataDir,
    workspacePath,
    nativeAssistantEntries: 0,
  };
  const first = await launchDesktop(userDataDir, {
    ...options,
    initialWorkspaces: [workspacePath],
  });
  let parentRef = { workspaceId: "", sessionId: "" };
  let queuedSessionId = "";
  try {
    const window = await first.firstWindow();
    proof.firstIdentity = await first.inspectIdentity();
    await createNamedThread(window, "Synthetic never-started control");
    queuedSessionId = (await getDesktopState(window)).selectedSessionId;
    await createNamedThread(window, "Synthetic settlement parent");
    const state = await getDesktopState(window);
    parentRef = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
  } finally {
    proof.firstCleanup = await first.close();
  }
  const ref = { workspaceId: parentRef.workspaceId, sessionId: manager.getSessionId() };
  const catalog = new JsonCatalogStore({ catalogFilePath: join(userDataDir, "catalogs.json") });
  const generation = await catalog.sessions.beginRun(ref, "synthetic-authoritative-run");
  const terminal = {
    runId: "synthetic-authoritative-run",
    generation,
    nativeSessionId: ref.sessionId,
    branchLeafId: SessionManager.open(manager.getSessionFile()!).getBranch().at(-1)!.id,
    settledAt: new Date().toISOString(),
    outcome: "stopped" as const,
  };
  expect(await catalog.sessions.settleRun(ref, terminal)).toBe(true);
  proof.terminalRun = terminal;
  const entries = (await readFile(manager.getSessionFile()!, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; message?: { role: string } });
  expect(
    entries.filter((entry) => entry.type === "message" && entry.message?.role === "assistant"),
  ).toHaveLength(0);
  proof.nativeEntries = entries;
  const uiPath = join(userDataDir, "ui-state.json");
  const ui = JSON.parse(await readFile(uiPath, "utf8")) as {
    orchestrationChildren: OrchestrationChildThread[];
  };
  const at = new Date().toISOString();
  ui.orchestrationChildren = [ref.sessionId, queuedSessionId].map((childSessionId, index) => ({
    id: index === 0 ? "zero-assistant" : "zero-queued",
    parentWorkspaceId: parentRef.workspaceId,
    parentSessionId: parentRef.sessionId,
    childWorkspaceId: parentRef.workspaceId,
    childSessionId,
    title: index === 0 ? "Synthetic zero assistant" : "Never started",
    goal: "Synthetic control",
    status: "queued",
    latestTranscript: "",
    transcript: [],
    evidence: [],
    createdAt: at,
    updatedAt: at,
  }));
  await writeFile(uiPath, JSON.stringify(ui));
  const second = await launchDesktop(userDataDir, options);
  try {
    const window = await second.firstWindow();
    proof.secondIdentity = await second.inspectIdentity();
    const read = await runOrchestrationRuntimeTool(second, {
      toolName: "read_thread",
      sessionRef: parentRef,
      params: { thread_id: "zero-assistant" },
    });
    proof.firstColdRead = read;
    expect(read.details?.status).toBe("cancelled");
    const list = await runOrchestrationRuntimeTool(second, {
      toolName: "list_threads",
      sessionRef: parentRef,
      params: {},
    });
    proof.firstList = list;
    expect(list.details?.threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threadId: "zero-assistant", status: "cancelled" }),
        expect.objectContaining({ threadId: "zero-queued", status: "queued" }),
      ]),
    );
    const row = window.locator(`.session-row[data-session-id="${ref.sessionId}"]`);
    await expect(row).toHaveAttribute("data-child-status", "cancelled");
    await expect(row).toHaveAttribute("aria-description", /^Child thread cancelled(?:,|$)/);
    proof.sidebarAccessible = await row.ariaSnapshot();
    proof.queuedControl = await runOrchestrationRuntimeTool(second, {
      toolName: "read_thread",
      sessionRef: parentRef,
      params: { thread_id: "zero-queued" },
    });
    expect((proof.queuedControl as { details: { status: string } }).details.status).toBe("queued");
  } finally {
    proof.secondCleanup = await second.close();
    const json = JSON.stringify(proof, null, 2);
    await testInfo.attach("synthetic-zero-assistant-proof", {
      body: json,
      contentType: "application/json",
    });
    if (process.env.PI_APP_ORCHESTRATION_PROOF_DIR)
      await writeFile(
        join(process.env.PI_APP_ORCHESTRATION_PROOF_DIR, "synthetic-zero-assistant-proof.json"),
        json,
      );
  }
});
