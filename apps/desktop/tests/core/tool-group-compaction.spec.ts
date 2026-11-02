import { expect, test } from "@playwright/test";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvents,
  getDesktopState,
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

async function selectedSessionRef(
  window: Parameters<typeof getDesktopState>[0],
): Promise<SessionRef> {
  const state = await getDesktopState(window);
  if (!state.selectedWorkspaceId || !state.selectedSessionId) {
    throw new Error("Expected a selected session");
  }
  return { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
}

test("completed tool sequences compact by default and expand without hiding failures or running work", async ({}, testInfo) => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("tool-group-compaction");
  const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;
  const harness = await launch(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Tool compaction");
    const sessionRef = await selectedSessionRef(window);
    const events: SessionDriverEvent[] = [];
    const addTool = (
      callId: string,
      toolName: string,
      input: unknown,
      options: {
        readonly finish?: boolean;
        readonly success?: boolean;
        readonly output?: unknown;
      } = {},
    ) => {
      const timestamp = new Date(Date.now() + events.length * 10).toISOString();
      events.push({
        type: "toolStarted",
        sessionRef,
        timestamp,
        callId,
        toolName,
        input,
      });
      if (options.finish !== false) {
        events.push({
          type: "toolFinished",
          sessionRef,
          timestamp,
          callId,
          success: options.success ?? true,
          output: options.output ?? `${callId} output`,
        });
      }
    };

    addTool("group-one-bash", "bash", { command: "pwd" });
    addTool("group-one-read", "read", { path: "README.md" });
    addTool("group-one-edit", "edit", { path: "README.md" });
    addTool(
      "visible-failure",
      "bash",
      { command: "false" },
      {
        success: false,
        output: "command failed",
      },
    );
    addTool("visible-running", "bash", { command: "sleep 30" }, { finish: false });
    addTool("group-two-bash-a", "bash", { command: "ls" });
    addTool("group-two-bash-b", "bash", { command: "git status --short" });
    await emitTestSessionEvents(harness, events);

    const transcript = window.getByTestId("transcript");
    const groups = transcript.getByTestId("timeline-tool-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toContainText("3 actions completed");
    await expect(groups.nth(0)).toContainText("bash · edit · read");
    await expect(groups.nth(1)).toContainText("2 actions completed");
    await expect(groups.nth(1)).toContainText("bash × 2");

    const directTools = transcript.locator(".timeline-tool");
    await expect(directTools).toHaveCount(2);
    await expect(transcript.locator(".timeline-tool--error")).toHaveCount(1);
    await expect(transcript.locator(".timeline-tool--running")).toHaveCount(1);
    await window.screenshot({ path: testInfo.outputPath("tool-groups-collapsed.png") });

    const firstGroup = groups.nth(0);
    const groupToggle = firstGroup.locator(".timeline-tool-group__header");
    await expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    await groupToggle.click();
    await expect(groupToggle).toHaveAttribute("aria-expanded", "true");
    await expect(firstGroup.locator(".timeline-tool")).toHaveCount(3);
    await expect(transcript.locator(".timeline-tool")).toHaveCount(5);
    await window.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(window.getByTestId("timeline-pane")).toHaveAttribute("data-layout", "settled");

    const expandedTool = firstGroup.locator(".timeline-tool").first();
    await expandedTool.locator(".timeline-tool__header").click();
    await expect(expandedTool.locator(".timeline-tool__pre")).toContainText(
      "group-one-bash output",
    );
    await window.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(window.getByTestId("timeline-pane")).toHaveAttribute("data-layout", "settled");
    await window.screenshot({ path: testInfo.outputPath("tool-groups-expanded.png") });

    await groupToggle.click();
    await expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    await expect(firstGroup.locator(".timeline-tool")).toHaveCount(0);
    await expect(transcript.locator(".timeline-tool--error")).toBeVisible();
    await expect(transcript.locator(".timeline-tool--running")).toBeVisible();
  } finally {
    await harness.close();
  }
});
