import { expect, test, type Page } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  desktopShortcut,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import {
  createThread,
  setSessionVisibilityOverride,
  type SessionContext,
} from "../helpers/session-event-test-helpers";

async function emitRunStarted(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  session: SessionContext,
  runId: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const event: Extract<SessionDriverEvent, { type: "sessionUpdated" }> = {
    type: "sessionUpdated",
    sessionRef: session.sessionRef,
    timestamp: startedAt,
    runId,
    snapshot: {
      ref: session.sessionRef,
      workspace: session.workspace,
      title: session.title,
      status: "running",
      updatedAt: startedAt,
      preview: `${session.title} running`,
      runningRunId: runId,
    },
  };
  await emitTestSessionEvent(harness, event);
}

async function openGeneralSettings(window: Page): Promise<void> {
  await window.keyboard.press(desktopShortcut(","));
  await expect(window.getByTestId("settings-surface")).toBeVisible();
  await window.getByRole("button", { name: "General", exact: true }).click();
}

test("renders and persists the selected running indicator", async ({}, testInfo) => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("activity-indicator");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await openGeneralSettings(window);

    const selector = window.getByLabel("Activity indicator");
    await expect(selector).toHaveValue("moonwalk");
    await expect(selector.locator("option")).toHaveCount(6);
    await selector.selectOption("wave");

    await expect
      .poll(
        async () => (await getDesktopState(window)).sidebarAppearance?.activityIndicatorPreference,
      )
      .toMatchObject({ style: "wave", source: "user" });

    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    const session = await createThread(window, "Animated running thread");
    await setSessionVisibilityOverride(harness, "active");
    await emitRunStarted(harness, session, `activity-wave-${Date.now()}`);

    const row = window.locator(`.session-row[data-session-id="${session.sessionRef.sessionId}"]`);
    const indicator = row.getByTestId("activity-indicator");
    await expect(indicator).toHaveAttribute("data-activity-style", "wave");
    await expect
      .poll(() =>
        indicator.locator(".activity-wave").evaluate((node) => {
          return getComputedStyle(node).animationName;
        }),
      )
      .toBe("activity-wave");

    await window.getByRole("button", { name: "Customize Sidebar" }).click();
    await window.getByRole("menuitem", { name: "Grouping" }).click();
    await window.getByRole("menuitemradio", { name: "Workspace" }).click();

    const state = await getDesktopState(window);
    const rootWorkspace = state.workspaces.find(
      (workspace) => workspace.rootWorkspaceId === undefined,
    );
    expect(rootWorkspace).toBeDefined();
    const accent = state.sidebarAppearance?.projectByWorkspaceId[rootWorkspace!.id]?.accentColor;
    expect(accent).toMatch(/^#[0-9a-f]{6}$/i);
    await expect(window.getByTestId("app-shell")).toHaveCSS("--workspace-accent", accent!);
    const bridge = window.getByTestId("project-accent-bridge");
    await expect(bridge).toBeVisible();
    await expect(bridge).toHaveAttribute("data-workspace-accent", accent!);
    await expect(window.locator(".sidebar")).toHaveCSS("border-radius", "8px");
    await expect(window.locator(".main")).toHaveCSS("border-radius", "8px");
    await expect
      .poll(() =>
        window
          .locator(".workspace-row--active")
          .evaluate((row) => getComputedStyle(row).backgroundColor),
      )
      .toBe(
        await window.locator(".shell").evaluate((shell) => getComputedStyle(shell).backgroundColor),
      );
    await window.screenshot({ path: testInfo.outputPath("activity-indicator.png") });
  } finally {
    await harness.close();
  }

  harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await openGeneralSettings(window);
    await expect(window.getByLabel("Activity indicator")).toHaveValue("wave");
  } finally {
    await harness.close();
  }
});
