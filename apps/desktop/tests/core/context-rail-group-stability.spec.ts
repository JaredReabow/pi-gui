import { expect, test } from "@playwright/test";
import { join } from "node:path";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvents,
  getDesktopState,
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
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

function toolEvents(
  sessionRef: SessionRef,
  prefix: string,
  count: number,
  startIndex = 0,
): SessionDriverEvent[] {
  const events: SessionDriverEvent[] = [];
  for (let index = startIndex; index < startIndex + count; index += 1) {
    const callId = `${prefix}-${index}`;
    const timestamp = new Date(Date.now() + index * 10).toISOString();
    events.push({
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId,
      toolName: index % 3 === 0 ? "read" : "bash",
      input: { command: `command-${index}` },
    });
    events.push({
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId,
      success: true,
      output: `output-${index}`,
    });
  }
  return events;
}

test("the pinned prompt remains mounted over an expanded work summary at the latest messages", async ({}, testInfo) => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("context-rail-group-stability");
  const agentDir = join(userDataDir, "agent");
  // Injected tools need no provider. The summary's missing-model state must not
  // make a fixture-backed viewport test contact an external model endpoint.
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;
  const harness = await launch(userDataDir, {
    initialWorkspaces: [workspacePath],
    agentDir,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Stable prompt");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();
    await emitTestSessionEvents(harness, [
      {
        type: "queuedMessageStarted",
        sessionRef,
        timestamp,
        message: {
          id: "stable-user",
          mode: "followUp",
          text: "Keep this prompt pinned while the long tool sequence runs.",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      ...toolEvents(sessionRef, "stable-tool", 45),
    ]);

    const transcript = window.getByTestId("transcript");
    const group = transcript.getByTestId("timeline-work-summary");
    await expect(group).toHaveCount(1);
    await group.locator(".timeline-tool-group__header").click();
    await expect(group.locator(".timeline-tool")).toHaveCount(45);

    const pane = window.getByTestId("timeline-pane");
    await window.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(pane).toHaveAttribute("data-layout", "settled");
    await pane.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(pane).toHaveAttribute("data-layout", "settled");
    const prompt = window.getByTestId("timeline-pinned-prompt");
    await expect(prompt).toHaveAttribute(
      "data-prompt-text",
      "Keep this prompt pinned while the long tool sequence runs.",
    );
    await window.screenshot({ path: testInfo.outputPath("pinned-prompt-over-group.png") });

    const promptHandle = await prompt.evaluateHandle((element) => element);
    await window.evaluate(() => {
      const key = "__piPromptRemovalCount";
      (globalThis as typeof globalThis & Record<string, unknown>)[key] = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const removed of record.removedNodes) {
            if (
              removed instanceof HTMLElement &&
              (removed.matches('[data-testid="timeline-pinned-prompt"]') ||
                removed.querySelector('[data-testid="timeline-pinned-prompt"]'))
            ) {
              (globalThis as typeof globalThis & Record<string, number>)[key] =
                ((globalThis as typeof globalThis & Record<string, number>)[key] ?? 0) + 1;
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      (globalThis as typeof globalThis & Record<string, MutationObserver>).__piPromptObserver =
        observer;
    });

    await emitTestSessionEvents(harness, toolEvents(sessionRef, "stable-tool", 2, 45));
    await expect(group.locator(".timeline-tool")).toHaveCount(47);
    await expect(prompt).toHaveAttribute(
      "data-prompt-text",
      "Keep this prompt pinned while the long tool sequence runs.",
    );
    expect(await promptHandle.evaluate((element) => element.isConnected)).toBe(true);
    expect(
      await window.evaluate(
        () =>
          (globalThis as typeof globalThis & Record<string, number>).__piPromptRemovalCount ?? 0,
      ),
    ).toBe(0);
    await window.evaluate(() => {
      (
        globalThis as typeof globalThis & Record<string, MutationObserver | undefined>
      ).__piPromptObserver?.disconnect();
    });
  } finally {
    await harness.close();
  }
});
