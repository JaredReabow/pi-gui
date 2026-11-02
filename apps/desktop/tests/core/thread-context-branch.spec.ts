import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  getDesktopState,
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedForkSessionFixture,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;

test("branches a thread at its current head into the same project", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir("thread-context-branch-local-");
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("thread-context-branch-local");
  await seedAgentDir(agentDir);
  const fixture = await seedForkSessionFixture(agentDir, workspacePath);
  const harness = await launch(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);
    const row = window.locator(`.session-row[data-session-id="${fixture.sessionId}"]`);
    await expect(row).toBeVisible();

    await row.click({ button: "right" });
    const menu = row.getByRole("menu");
    await expect(menu.getByRole("button", { name: "Branch in same project" })).toBeVisible();
    await menu.getByRole("button", { name: "Branch in same project" }).click();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.find((entry) => entry.id === workspace.id)?.sessions.length ?? 0;
      })
      .toBe(2);

    const state = await getDesktopState(window);
    expect(state.selectedWorkspaceId).toBe(workspace.id);
    expect(state.selectedSessionId).not.toBe(fixture.sessionId);
    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("First fork question");
    await expect(transcript).toContainText("Third fork answer");
    await expect(window.getByTestId("composer")).toHaveValue("");
  } finally {
    await harness.close();
  }
});

test("branches a thread into a project selected from the workspace catalog", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir("thread-context-branch-existing-");
  const agentDir = join(userDataDir, "agent");
  const sourcePath = await makeWorkspace("thread-context-branch-source");
  const targetPath = await makeWorkspace("thread-context-branch-target");
  await seedAgentDir(agentDir);
  const fixture = await seedForkSessionFixture(agentDir, sourcePath);
  const harness = await launch(userDataDir, {
    agentDir,
    initialWorkspaces: [sourcePath, targetPath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const source = await waitForWorkspaceByPath(window, sourcePath);
    const target = await waitForWorkspaceByPath(window, targetPath);
    const row = window.locator(`.session-row[data-session-id="${fixture.sessionId}"]`);
    await expect(row).toBeVisible();

    await row.click({ button: "right" });
    await row
      .getByRole("menu")
      .getByRole("button", { name: "Branch into existing project…" })
      .click();

    const picker = window.getByTestId("branch-project-picker");
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("option", { name: `Branch into ${target.name}` })).toBeVisible();
    await expect(picker.getByRole("option", { name: `Branch into ${source.name}` })).toHaveCount(0);

    await picker.getByRole("option", { name: `Branch into ${target.name}` }).click();
    await expect(picker).toHaveCount(0);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const targetSessions =
          state.workspaces.find((entry) => entry.id === target.id)?.sessions.length ?? 0;
        const sourceSessions =
          state.workspaces.find((entry) => entry.id === source.id)?.sessions.length ?? 0;
        return [sourceSessions, targetSessions];
      })
      .toEqual([1, 1]);

    const state = await getDesktopState(window);
    expect(state.selectedWorkspaceId).toBe(target.id);
    expect(state.selectedSessionId).not.toBe(fixture.sessionId);
    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("First fork question");
    await expect(transcript).toContainText("Third fork answer");
    await expect(window.getByTestId("composer")).toHaveValue("");
  } finally {
    await harness.close();
  }
});
