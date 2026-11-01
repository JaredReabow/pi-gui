import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { DesktopAppState } from "../../contracts/desktop-state";
import { desktopIpc } from "../../contracts/ipc";
import type { DesktopCleanupResult, DesktopHarness } from "../helpers/electron-app";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
} from "../helpers/electron-app";

const evidenceDirectory = process.env.PI_APP_SCHEDULED_ACTIONS_EVIDENCE_DIR
  ? resolve(process.env.PI_APP_SCHEDULED_ACTIONS_EVIDENCE_DIR)
  : undefined;
const cleanupReceipts: Array<{
  readonly launch: string;
  readonly cleanup: DesktopCleanupResult;
}> = [];

async function writeEvidence(name: string, contents: string): Promise<void> {
  if (!evidenceDirectory) {
    return;
  }
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, name), contents, "utf8");
}

async function captureEvidence(page: Page, name: string): Promise<void> {
  if (!evidenceDirectory) {
    return;
  }
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: join(evidenceDirectory, name),
    fullPage: true,
  });
}

async function closeHarness(
  launch: string,
  harness: DesktopHarness,
): Promise<DesktopCleanupResult> {
  const cleanup = await harness.close();
  cleanupReceipts.push({ launch, cleanup });
  await writeEvidence("cleanup.json", `${JSON.stringify(cleanupReceipts, null, 2)}\n`);
  return cleanup;
}

async function openScheduledView(window: Page): Promise<void> {
  await window.getByTestId("sidebar-scheduled").click();
  await expect(window.getByTestId("scheduled-tasks-view")).toBeVisible();
}

async function sendStatePush(harness: DesktopHarness, state: DesktopAppState): Promise<void> {
  await harness.electronApp.evaluate(
    ({ BrowserWindow }, payload) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) {
        throw new Error("No BrowserWindow available for fixture state push");
      }
      window.webContents.send(payload.channel, payload.state);
    },
    { channel: desktopIpc.stateChanged, state },
  );
}

test("scheduled task status actions are direct, keyboard accessible, and restart-safe", async () => {
  test.setTimeout(150_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-task-controls");
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
  });

  let first: DesktopHarness | undefined;
  try {
    first = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    const window = await first.firstWindow();
    const identity = await first.inspectIdentity();
    expect(identity.visible).toBe(false);
    expect(identity.focused).toBe(false);
    expect(identity.telemetry).toEqual({
      doNotTrack: "1",
      otelSdkDisabled: "true",
      testTransport: "disabled",
    });
    await writeEvidence("identity-paused-launch.json", `${JSON.stringify(identity, null, 2)}\n`);

    await createNamedThread(window, "Bound scheduled task");
    const before = await getDesktopState(window);
    const created = await window.evaluate(
      async (target) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        return app.createScheduledTask({
          title: "Direct status action",
          instruction: "Fixture-only scheduled instruction",
          schedule: { kind: "interval", everyMs: 60_000 },
          target: {
            kind: "existing-thread",
            workspaceId: target.workspaceId,
            sessionId: target.sessionId,
          },
        });
      },
      {
        workspaceId: before.selectedWorkspaceId,
        sessionId: before.selectedSessionId,
      },
    );
    expect(created.lastError).toBeUndefined();
    expect(created.scheduledTasks[0]?.status).toBe("active");

    const chip = window.getByTestId("scheduled-task-chip");
    await expect(chip).toBeVisible();
    const pause = chip.getByRole("button", {
      name: "Pause scheduled task Direct status action",
    });
    await pause.focus();
    await expect(pause).toBeFocused();
    await pause.press("Enter");
    await expect(
      chip.getByRole("button", {
        name: "Resume scheduled task Direct status action",
      }),
    ).toBeVisible();
    await expect
      .poll(async () => (await getDesktopState(window)).scheduledTasks[0]?.status)
      .toBe("paused");
    await captureEvidence(window, "chip-paused.png");
  } finally {
    if (first) {
      await closeHarness("paused", first);
    }
  }

  let second: DesktopHarness | undefined;
  try {
    second = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    const window = await second.firstWindow();
    const identity = await second.inspectIdentity();
    expect(identity.visible).toBe(false);
    expect(identity.focused).toBe(false);
    await writeEvidence("identity-resume-launch.json", `${JSON.stringify(identity, null, 2)}\n`);

    await openScheduledView(window);
    const row = window.getByTestId("scheduled-task-row").filter({
      hasText: "Direct status action",
    });
    const resume = row.getByRole("button", {
      name: "Resume scheduled task Direct status action",
    });
    await expect(resume).toBeVisible();
    await captureEvidence(window, "scheduled-paused-after-restart.png");
    await resume.focus();
    await expect(resume).toBeFocused();
    await resume.press("Enter");
    await expect(
      row.getByRole("button", {
        name: "Pause scheduled task Direct status action",
      }),
    ).toBeVisible();
    await expect
      .poll(async () => (await getDesktopState(window)).scheduledTasks[0]?.status)
      .toBe("active");
    await captureEvidence(window, "scheduled-resumed.png");
  } finally {
    if (second) {
      await closeHarness("resume", second);
    }
  }

  let third: DesktopHarness | undefined;
  try {
    third = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    const window = await third.firstWindow();
    const identity = await third.inspectIdentity();
    expect(identity.visible).toBe(false);
    expect(identity.focused).toBe(false);
    await writeEvidence("identity-resumed-restart.json", `${JSON.stringify(identity, null, 2)}\n`);

    await openScheduledView(window);
    const row = window.getByTestId("scheduled-task-row").filter({
      hasText: "Direct status action",
    });
    await expect(
      row.getByRole("button", {
        name: "Pause scheduled task Direct status action",
      }),
    ).toBeVisible();
    expect((await getDesktopState(window)).scheduledTasks[0]?.status).toBe("active");
    await captureEvidence(window, "scheduled-active-after-restart.png");
  } finally {
    if (third) {
      await closeHarness("resumed-restart", third);
    }
  }
});

test("authoritative task pushes supersede cached actions across chip and row", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-authoritative-refresh");
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
  });

  let harness: DesktopHarness | undefined;
  try {
    harness = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    const window = await harness.firstWindow();
    const identity = await harness.inspectIdentity();
    expect(identity.visible).toBe(false);
    expect(identity.focused).toBe(false);
    expect(identity.telemetry).toEqual({
      doNotTrack: "1",
      otelSdkDisabled: "true",
      testTransport: "disabled",
    });
    await writeEvidence(
      "identity-authoritative-refresh.json",
      `${JSON.stringify(identity, null, 2)}\n`,
    );

    await createNamedThread(window, "Authoritative target");
    const before = await getDesktopState(window);
    const created = await window.evaluate(
      async (target) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        return app.createScheduledTask({
          title: "Authoritative task",
          instruction: "Fixture-only authoritative instruction",
          schedule: { kind: "interval", everyMs: 60_000 },
          target: {
            kind: "existing-thread",
            workspaceId: target.workspaceId,
            sessionId: target.sessionId,
          },
        });
      },
      {
        workspaceId: before.selectedWorkspaceId,
        sessionId: before.selectedSessionId,
      },
    );
    expect(created.lastError).toBeUndefined();
    const taskId = created.scheduledTasks[0]?.id;
    if (!taskId) {
      throw new Error("Scheduled task id was unavailable");
    }

    const chip = window.getByTestId("scheduled-task-chip");
    await chip.getByRole("button", { name: "Pause scheduled task Authoritative task" }).click();
    await expect(
      chip.getByRole("button", {
        name: "Resume scheduled task Authoritative task",
      }),
    ).toBeVisible();

    const resumed = await window.evaluate(
      async ({ id }) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        return app.updateScheduledTask(id, {
          title: "Authoritative resumed",
          status: "active",
        });
      },
      { id: taskId },
    );
    expect(resumed.lastError).toBeUndefined();
    await expect(
      chip.getByRole("button", {
        name: "Pause scheduled task Authoritative resumed",
      }),
    ).toBeVisible();
    await expect(chip).toContainText("Next run in under a minute");
    await captureEvidence(window, "chip-authoritative-resume.png");

    await openScheduledView(window);
    const resumedRow = window.getByTestId("scheduled-task-row").filter({
      hasText: "Authoritative resumed",
    });
    await expect(resumedRow).toBeVisible();
    await expect(
      resumedRow.getByRole("button", {
        name: "Pause scheduled task Authoritative resumed",
      }),
    ).toBeVisible();

    const completed = await window.evaluate(
      async ({ id }) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        return app.updateScheduledTask(id, {
          title: "Authoritative completed",
          instruction: "Completed authoritative instruction",
          status: "completed",
        });
      },
      { id: taskId },
    );
    expect(completed.lastError).toBeUndefined();
    const completedRow = window.getByTestId("scheduled-task-row").filter({
      hasText: "Authoritative completed",
    });
    await expect(completedRow).toBeVisible();
    await expect(completedRow.getByTestId("scheduled-task-status-action")).toHaveCount(0);
    await expect(completedRow).not.toContainText("Next run");
    await captureEvidence(window, "row-authoritative-completed.png");

    await selectSession(window, "Authoritative target");
    await expect(window.getByTestId("scheduled-task-chip")).toHaveCount(0);
  } finally {
    if (harness) {
      await closeHarness("authoritative-refresh", harness);
    }
  }
});

test("failed Resume remains labelled correctly after authoritative completion", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("scheduled-resume-error-label");
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
  });

  let harness: DesktopHarness | undefined;
  try {
    harness = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    const window = await harness.firstWindow();
    const identity = await harness.inspectIdentity();
    expect(identity.visible).toBe(false);
    expect(identity.focused).toBe(false);
    expect(identity.telemetry).toEqual({
      doNotTrack: "1",
      otelSdkDisabled: "true",
      testTransport: "disabled",
    });
    await writeEvidence(
      "identity-resume-error-label.json",
      `${JSON.stringify(identity, null, 2)}\n`,
    );

    await createNamedThread(window, "Resume error target");
    const before = await getDesktopState(window);
    const created = await window.evaluate(
      async (target) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        return app.createScheduledTask({
          title: "Resume error task",
          instruction: "Fixture-only resume error instruction",
          schedule: { kind: "interval", everyMs: 60_000 },
          target: {
            kind: "existing-thread",
            workspaceId: target.workspaceId,
            sessionId: target.sessionId,
          },
        });
      },
      {
        workspaceId: before.selectedWorkspaceId,
        sessionId: before.selectedSessionId,
      },
    );
    expect(created.lastError).toBeUndefined();

    await openScheduledView(window);
    const row = window.getByTestId("scheduled-task-row").filter({
      hasText: "Resume error task",
    });
    await row.getByRole("button", { name: "Pause scheduled task Resume error task" }).click();
    await expect(
      row.getByRole("button", { name: "Resume scheduled task Resume error task" }),
    ).toBeVisible();
    const pausedState = await getDesktopState(window);

    await harness.electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(
        channel,
        () =>
          new Promise((_resolve, reject) => {
            (
              globalThis as typeof globalThis & {
                __rejectResumeFixture?: (error: Error) => void;
              }
            ).__rejectResumeFixture = reject;
          }),
      );
    }, desktopIpc.updateScheduledTask);

    await row.getByRole("button", { name: "Resume scheduled task Resume error task" }).click();
    await expect(
      row.getByRole("button", {
        name: "Resuming scheduled task Resume error task",
      }),
    ).toBeDisabled();

    const completedAt = new Date(Date.now() + 1_000).toISOString();
    const completedState: DesktopAppState = {
      ...pausedState,
      revision: pausedState.revision + 1,
      scheduledTasks: pausedState.scheduledTasks.map((task) =>
        task.title === "Resume error task"
          ? {
              ...task,
              title: "Completed after resume failure",
              instruction: "Current completed instruction",
              status: "completed",
              schedule: { kind: "interval", everyMs: 10_800_000 },
              updatedAt: completedAt,
              completedAt,
              nextRunAt: undefined,
            }
          : task,
      ),
    };
    await sendStatePush(harness, completedState);
    const completedRow = window.getByTestId("scheduled-task-row").filter({
      hasText: "Completed after resume failure",
    });
    await expect(completedRow).toBeVisible();
    await expect(completedRow).toContainText("Every 3 hours");
    await expect(completedRow.getByTestId("scheduled-task-status-action")).toHaveCount(0);

    await harness.electronApp.evaluate(() => {
      const reject = (
        globalThis as typeof globalThis & {
          __rejectResumeFixture?: (error: Error) => void;
        }
      ).__rejectResumeFixture;
      if (!reject) {
        throw new Error("Resume failure fixture was unavailable");
      }
      reject(new Error("fixture transport failed"));
    });
    const alert = completedRow.getByRole("alert");
    await expect(alert).toContainText("Resume failed:");
    await expect(alert).not.toContainText("Pause failed:");
    await expect(alert).toContainText("fixture transport failed");
    await captureEvidence(window, "row-resume-error-after-completion.png");
  } finally {
    if (harness) {
      await closeHarness("resume-error-label", harness);
    }
  }
});
