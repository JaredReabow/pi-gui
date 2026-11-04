import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedNamedTextSessionFixture,
  selectSession,
  waitForTimelineLayout,
} from "../helpers/electron-app";
import { sessionFilePathFromCatalog } from "../helpers/session-file";

const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;

const EDIT_TITLE = "Editable transcript fixture";
const DELETE_TITLE = "Deletable transcript fixture";
const ORIGINAL_USER = "Original user prompt";
const EDITED_USER = "Edited user prompt";
const ORIGINAL_ASSISTANT = "Original assistant reply";
const EDITED_ASSISTANT = "Edited assistant reply";
const DELETE_USER = "Delete this user prompt";
const DELETE_ASSISTANT = "Delete this assistant reply";

test("edits and deletes user messages and assistant replies across restart", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir("pi-gui-transcript-history-");
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace("transcript-history-workspace");
  await seedAgentDir(agentDir);
  const editable = await seedNamedTextSessionFixture(agentDir, workspacePath, {
    title: EDIT_TITLE,
    userText: ORIGINAL_USER,
    assistantText: ORIGINAL_ASSISTANT,
  });
  const deletable = await seedNamedTextSessionFixture(agentDir, workspacePath, {
    title: DELETE_TITLE,
    userText: DELETE_USER,
    assistantText: DELETE_ASSISTANT,
  });

  const first = await launch(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await first.firstWindow();
    await selectSession(window, EDIT_TITLE);
    await waitForTimelineLayout(window);

    const userRow = window.locator(".timeline-item--user").first();
    await expect(userRow).toHaveCount(1);
    await userRow.hover();
    await userRow.getByRole("button", { name: "Edit user message" }).click();
    const userEditor = userRow.getByRole("textbox", { name: "Edit user message" });
    await expect(userEditor).toBeFocused();
    await userEditor.fill(EDITED_USER);
    await userRow.getByTestId("save-message").click();
    await expect(userRow.getByTestId("user-message-bubble")).toContainText(EDITED_USER);
    await expect(window.getByText(ORIGINAL_USER, { exact: true })).toHaveCount(0);

    const assistantRow = window.locator(".timeline-item--assistant").first();
    await expect(assistantRow).toHaveCount(1);
    await assistantRow.hover();
    await assistantRow.getByRole("button", { name: "Edit assistant reply" }).click();
    const assistantEditor = assistantRow.getByRole("textbox", { name: "Edit assistant reply" });
    await expect(assistantEditor).toBeFocused();
    await assistantEditor.fill(EDITED_ASSISTANT);
    await assistantRow.getByTestId("save-message").click();
    await expect(assistantRow).toContainText(EDITED_ASSISTANT);
    await expect(window.getByText(ORIGINAL_ASSISTANT, { exact: true })).toHaveCount(0);

    await selectSession(window, DELETE_TITLE);
    await waitForTimelineLayout(window);
    const deleteUserRow = window.locator(".timeline-item--user").first();
    await deleteUserRow.hover();
    await deleteUserRow.getByRole("button", { name: "Delete user message" }).click();
    await deleteUserRow.getByRole("button", { name: "Confirm delete user message" }).click();
    await expect(window.getByText(DELETE_USER, { exact: true })).toHaveCount(0);

    const deleteAssistantRow = window.locator(".timeline-item--assistant").first();
    await deleteAssistantRow.hover();
    await deleteAssistantRow.getByRole("button", { name: "Delete assistant reply" }).click();
    await deleteAssistantRow
      .getByRole("button", { name: "Confirm delete assistant reply" })
      .click();
    await expect(window.getByText(DELETE_ASSISTANT, { exact: true })).toHaveCount(0);
    await expect(window.getByTestId("transcript-empty")).toBeVisible();

    for (const [fixture, expectedMarkers] of [
      [editable, 2],
      [deletable, 2],
    ] as const) {
      const state = await getDesktopState(window);
      const workspace = state.workspaces.find((entry) =>
        entry.sessions.some((session) => session.title === fixture.title),
      );
      const session = workspace?.sessions.find((entry) => entry.title === fixture.title);
      if (!workspace || !session) throw new Error(`Missing fixture session ${fixture.title}`);
      const filePath = await sessionFilePathFromCatalog(userDataDir, {
        workspaceId: workspace.id,
        sessionId: session.id,
      });
      const entries = (await readFile(filePath, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type?: string; customType?: string });
      expect(entries.some((entry) => entry.type === "context_edit")).toBe(true);
      expect(
        entries.filter(
          (entry) => entry.type === "custom" && entry.customType === "pi-gui.transcript-history",
        ),
      ).toHaveLength(expectedMarkers);
      expect(entries.some((entry) => entry.type === "message")).toBe(true);
    }
  } finally {
    await first.close();
  }

  const restarted = await launch(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await restarted.firstWindow();
    await selectSession(window, EDIT_TITLE);
    await waitForTimelineLayout(window);
    await expect(window.getByTestId("user-message-bubble")).toContainText(EDITED_USER);
    await expect(window.locator(".timeline-item--assistant")).toContainText(EDITED_ASSISTANT);

    await selectSession(window, DELETE_TITLE);
    await expect(window.getByText(DELETE_USER, { exact: true })).toHaveCount(0);
    await expect(window.getByText(DELETE_ASSISTANT, { exact: true })).toHaveCount(0);
    await expect(window.getByTestId("transcript-empty")).toBeVisible();
  } finally {
    await restarted.close();
  }
});
