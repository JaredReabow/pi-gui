import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { PiSdkDriver } from "@pi-gui/pi-sdk-driver";
import {
  createNamedThread,
  fireDueScheduledTasks,
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";
import { SCHEDULED_TASK_INTERVIEW_PROMPT } from "../../contracts/scheduled-tasks";

const OPEN_REPLY_PROVIDER = "scheduled-open-reply";
const openReplyProvider = (calledFile: string) => String.raw`
import { writeFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function openReplyProvider(pi) {
  pi.registerProvider("${OPEN_REPLY_PROVIDER}", {
    baseUrl: "http://127.0.0.1:9/never-contact",
    apiKey: "LOCAL_TEST_CANARY",
    api: "${OPEN_REPLY_PROVIDER}",
    models: [{
      id: "open",
      name: "Open reply",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 4096,
    }],
    streamSimple(model, _context, options) {
      const stream = createAssistantMessageEventStream();
      writeFileSync(${JSON.stringify(calledFile)}, "called");
      options?.signal?.addEventListener("abort", () => {
        const aborted = {
          role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "aborted", timestamp: Date.now(),
        };
        stream.push({ type: "error", reason: "aborted", error: aborted });
      });
      return stream;
    },
  });
}
`;

test("manual create, tabs, pause, and restart keep scheduled tasks", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-tasks-list");
  const first = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await first.firstWindow();
    await window.getByTestId("sidebar-scheduled").click();
    await expect(window.getByTestId("scheduled-tasks-view")).toBeVisible();
    await window.getByTestId("scheduled-task-create").click();
    await window.getByTestId("scheduled-task-setup-manually").click();
    await expect(window.getByTestId("scheduled-task-editor")).toBeVisible();
    await window.getByTestId("scheduled-task-title").fill("Standup ping");
    await window.getByTestId("scheduled-task-instruction").fill("Ask for yesterday's work");
    await window.getByTestId("scheduled-task-frequency").selectOption("interval");
    await window.getByTestId("scheduled-task-interval").fill("10");
    await window.getByTestId("scheduled-task-save").click();
    await expect(window.getByTestId("scheduled-task-editor")).toHaveCount(0);
    await expect(window.getByTestId("scheduled-task-row")).toContainText("Standup ping");
    await expect(window.getByTestId("scheduled-task-row")).toContainText("Every 10 minutes");
    await window.getByTestId("scheduled-task-filter-active").click();
    await expect(window.getByTestId("scheduled-task-row")).toBeVisible();

    const created = await getDesktopState(window);
    expect(created.scheduledTasks).toHaveLength(1);
    await window.getByRole("button", { name: "Actions for Standup ping" }).click();
    await window.getByRole("button", { name: "Pause" }).click();
    await expect
      .poll(async () => (await getDesktopState(window)).scheduledTasks[0]?.status)
      .toBe("paused");
  } finally {
    await first.close();
  }

  const second = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await second.firstWindow();
    await window.getByTestId("sidebar-scheduled").click();
    await expect(window.getByTestId("scheduled-task-row")).toContainText("Standup ping");
    await expect(window.getByTestId("scheduled-task-row")).toContainText("Paused");
    expect((await getDesktopState(window)).scheduledTasks[0]?.status).toBe("paused");
  } finally {
    await second.close();
  }
});

test("create with pi prefills the interview draft and does not send", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-interview");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await window.getByTestId("sidebar-scheduled").click();
    await window.getByTestId("scheduled-task-create").click();
    await window.getByTestId("scheduled-task-create-with-pi").click();
    await expect(window.getByTestId("composer")).toHaveValue(SCHEDULED_TASK_INTERVIEW_PROMPT, {
      timeout: 15_000,
    });
    const transcript = await getSelectedTranscript(window);
    expect(
      transcript?.transcript.some((item) => item.kind === "message" && item.role === "assistant"),
    ).toBe(false);
    expect((await getDesktopState(window)).activeView).toBe("threads");
  } finally {
    await harness.close();
  }
});

test("firing a due existing-thread task labels the user bubble and shows a chip", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-fire");
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Fire target");
    const composerDraft = "keep this unsent draft";
    await window.getByTestId("composer").fill(composerDraft);
    await expect
      .poll(async () => (await getDesktopState(window)).composerDraft)
      .toBe(composerDraft);
    const before = await getDesktopState(window);
    const workspaceId = before.selectedWorkspaceId;
    const sessionId = before.selectedSessionId;
    expect(workspaceId).toBeTruthy();
    expect(sessionId).toBeTruthy();
    await window.evaluate(
      async ({ targetWorkspaceId, targetSessionId }) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        await app.createScheduledTask({
          title: "Due ping",
          instruction: "Say ping from scheduled task",
          schedule: { kind: "interval", everyMs: 60_000 },
          target: {
            kind: "existing-thread",
            workspaceId: targetWorkspaceId,
            sessionId: targetSessionId,
          },
        });
      },
      { targetWorkspaceId: workspaceId, targetSessionId: sessionId },
    );
    await expect.poll(async () => (await getDesktopState(window)).scheduledTasks).toHaveLength(1);
    await fireDueScheduledTasks(harness, new Date(Date.now() + 10 * 60_000).toISOString());
    await expect(window.getByTestId("sent-by-scheduled-task")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId("transcript")).toContainText("Say ping from scheduled task");
    await expect(window.getByTestId("composer")).toHaveValue(composerDraft);
    await expect(window.getByTestId("scheduled-task-chip")).toBeVisible();
    const after = await getDesktopState(window);
    expect(after.selectedSessionId).toBe(sessionId);
    expect(after.composerDraft).toBe(composerDraft);
    expect(after.scheduledTasks[0]?.runs[0]?.sessionId).toBe(sessionId);
  } finally {
    await harness.close();
  }
});

test("a due scheduled message waits while another message is queued", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-queue-dedupe");
  const agentDir = join(userDataDir, "agent");
  const called = join(userDataDir, "scheduled-queue-model-called");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: OPEN_REPLY_PROVIDER,
      defaultModel: "open",
      enabledModels: [`${OPEN_REPLY_PROVIDER}/open`],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspacePath, "scheduled-open-reply.ts", openReplyProvider(called));
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window
      .getByRole("complementary")
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    await window.getByLabel("New thread prompt", { exact: true }).fill("Keep this reply running");
    await window.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect.poll(() => existsSync(called)).toBe(true);
    const initial = await getDesktopState(window);
    const workspace = initial.workspaces.find((entry) => entry.id === initial.selectedWorkspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === initial.selectedSessionId);
    if (!workspace || !session) {
      throw new Error("Expected a selected scheduled-task target");
    }
    const sessionRef = { workspaceId: workspace.id, sessionId: session.id };
    await window.evaluate(async (target) => {
      const app = globalThis.window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.createScheduledTask({
        title: "Queue once",
        instruction: "Run the queued chronological task",
        schedule: { kind: "interval", everyMs: 60_000 },
        target: { kind: "existing-thread", ...target },
      });
    }, sessionRef);

    await fireDueScheduledTasks(harness, new Date(Date.now() + 10 * 60_000).toISOString());
    await expect
      .poll(async () => (await getDesktopState(window)).queuedComposerMessages.length)
      .toBe(1);
    const afterFirst = await getDesktopState(window);
    const firstQueueId = afterFirst.queuedComposerMessages[0]?.id;
    const firstNextRunAt = afterFirst.scheduledTasks[0]?.nextRunAt;
    expect(firstQueueId).toBeTruthy();
    expect(afterFirst.scheduledTasks[0]?.runs).toHaveLength(1);

    await fireDueScheduledTasks(harness, new Date(Date.now() + 20 * 60_000).toISOString());
    const afterSecond = await getDesktopState(window);
    expect(afterSecond.queuedComposerMessages.map((message) => message.id)).toEqual([firstQueueId]);
    expect(afterSecond.scheduledTasks[0]?.runs).toHaveLength(1);
    expect(afterSecond.scheduledTasks[0]?.nextRunAt).toBe(firstNextRunAt);

    await window.evaluate(async (messageId) => {
      const app = globalThis.window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.removeQueuedComposerMessage(messageId);
    }, firstQueueId!);
    await expect
      .poll(async () => (await getDesktopState(window)).queuedComposerMessages.length)
      .toBe(0);

    await fireDueScheduledTasks(harness, new Date(Date.now() + 21 * 60_000).toISOString());
    await expect
      .poll(async () => (await getDesktopState(window)).queuedComposerMessages.length)
      .toBe(1);
    const afterDrain = await getDesktopState(window);
    expect(afterDrain.queuedComposerMessages[0]?.id).not.toBe(firstQueueId);
    expect(afterDrain.scheduledTasks[0]?.runs).toHaveLength(2);
  } finally {
    await harness.close();
  }
});

test("a scheduled run can use the scheduled-task tools while it is still running", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-fire-tools");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Fire target");
    const state = await getDesktopState(window);
    await window.evaluate(
      async (target) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        await app.createScheduledTask({
          title: "Self-checking task",
          instruction: "List your scheduled tasks",
          schedule: { kind: "interval", everyMs: 60_000 },
          target: { kind: "existing-thread", ...target },
        });
      },
      { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId },
    );
    // The fired run calls list_scheduled_tasks before it finishes, as an agent would.
    const listedDuringRun = await harness.electronApp.evaluate(
      async (_, input) => {
        type ToolHook = (input: {
          toolName: string;
          sessionRef: { workspaceId: string; sessionId: string };
          params: Record<string, unknown>;
        }) => Promise<{ content: readonly { text?: string }[] }>;
        const hooks = (
          globalThis as {
            __PI_APP_TEST_HOOKS?: {
              runScheduledTaskRuntimeTool?: ToolHook;
              fireDueScheduledTasks?: (nowIso?: string) => Promise<unknown>;
            };
          }
        ).__PI_APP_TEST_HOOKS;
        const runTool = hooks?.runScheduledTaskRuntimeTool;
        const fire = hooks?.fireDueScheduledTasks;
        if (!runTool || !fire) {
          throw new Error("Scheduled-task test hooks are unavailable");
        }
        const { createRequire } = process.getBuiltinModule("module");
        const { PiSdkDriver: Driver } = createRequire(input.entry)("@pi-gui/pi-sdk-driver") as {
          PiSdkDriver: typeof PiSdkDriver;
        };
        let listed = "";
        Driver.prototype.sendUserMessage = async function (ref) {
          const result = await runTool({
            toolName: "list_scheduled_tasks",
            sessionRef: ref,
            params: {},
          });
          listed = result.content[0]?.text ?? "";
        };
        await Promise.race([
          fire(input.nowIso),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Scheduled run blocked on its own tools")), 10_000),
          ),
        ]);
        return listed;
      },
      {
        entry: resolve("apps/desktop/out/main/main.js"),
        nowIso: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    );
    expect(listedDuringRun).toContain("Self-checking task");
    const after = await getDesktopState(window);
    expect(after.scheduledTasks[0]?.runs.map((run) => run.outcome)).toEqual(["started"]);
  } finally {
    await harness.close();
  }
});

test("a second active bind to the same thread is rejected", async () => {
  test.setTimeout(45_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-bind");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Bind target");
    const state = await getDesktopState(window);
    const payload = {
      title: "First bind",
      instruction: "First",
      schedule: { kind: "interval" as const, everyMs: 60_000 },
      target: {
        kind: "existing-thread" as const,
        workspaceId: state.selectedWorkspaceId,
        sessionId: state.selectedSessionId,
      },
    };
    await window.evaluate(async (input) => {
      const app = globalThis.window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.createScheduledTask(input);
    }, payload);
    const second = await window.evaluate(async (input) => {
      const app = globalThis.window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      return app.createScheduledTask({ ...input, title: "Second bind", instruction: "Second" });
    }, payload);
    expect(second.lastError).toMatch(/already has a scheduled task/i);
    expect(second.scheduledTasks).toHaveLength(1);
  } finally {
    await harness.close();
  }
});

test("past once create is rejected and title-only edit keeps timezone and nextRunAt", async () => {
  test.setTimeout(45_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-edit-timing");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Edit target");
    const state = await getDesktopState(window);
    const past = await window.evaluate(
      async (input) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        return app.createScheduledTask(input);
      },
      {
        title: "Late ping",
        instruction: "Should not fire now",
        schedule: { kind: "once" as const, at: "2020-01-01T00:00:00.000Z" },
        target: {
          kind: "existing-thread" as const,
          workspaceId: state.selectedWorkspaceId,
          sessionId: state.selectedSessionId,
        },
      },
    );
    expect(past.lastError).toMatch(/future/i);
    expect(past.scheduledTasks).toHaveLength(0);

    const created = await window.evaluate(
      async (input) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        return app.createScheduledTask(input);
      },
      {
        title: "Morning ping",
        instruction: "Ask for yesterday",
        schedule: {
          kind: "daily" as const,
          hour: 9,
          minute: 0,
          timeZone: "America/Los_Angeles",
        },
        target: {
          kind: "existing-thread" as const,
          workspaceId: state.selectedWorkspaceId,
          sessionId: state.selectedSessionId,
        },
      },
    );
    expect(created.lastError).toBeUndefined();
    expect(created.scheduledTasks).toHaveLength(1);
    const nextRunAt = created.scheduledTasks[0]?.nextRunAt;
    expect(nextRunAt).toBeTruthy();

    const renamed = await window.evaluate(
      async ({ id }) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        return app.updateScheduledTask(id, { title: "Renamed morning ping" });
      },
      { id: created.scheduledTasks[0]!.id },
    );
    expect(renamed.lastError).toBeUndefined();
    expect(renamed.scheduledTasks[0]?.title).toBe("Renamed morning ping");
    expect(renamed.scheduledTasks[0]?.nextRunAt).toBe(nextRunAt);
    expect(renamed.scheduledTasks[0]?.schedule).toEqual({
      kind: "daily",
      hour: 9,
      minute: 0,
      timeZone: "America/Los_Angeles",
    });

    await window.getByTestId("sidebar-scheduled").click();
    await window.getByTestId("scheduled-task-row").click();
    await expect(window.getByTestId("scheduled-task-editor")).toBeVisible();
    await window.getByTestId("scheduled-task-title").fill("Editor renamed morning ping");
    await window.getByTestId("scheduled-task-save").click();
    await expect(window.getByTestId("scheduled-task-editor")).toHaveCount(0);
    const afterEditor = await getDesktopState(window);
    expect(afterEditor.scheduledTasks[0]?.title).toBe("Editor renamed morning ping");
    expect(afterEditor.scheduledTasks[0]?.nextRunAt).toBe(nextRunAt);
    expect(afterEditor.scheduledTasks[0]?.schedule).toEqual({
      kind: "daily",
      hour: 9,
      minute: 0,
      timeZone: "America/Los_Angeles",
    });
  } finally {
    await harness.close();
  }
});
