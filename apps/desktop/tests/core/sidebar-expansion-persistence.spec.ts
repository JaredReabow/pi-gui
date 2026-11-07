import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PiDesktopApi } from "../../contracts/ipc";
import type { OrchestrationChildThread } from "../../contracts/desktop-state";
import {
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedNamedTextSessionFixture,
  waitForWorkspaceByPath,
  getDesktopState,
  selectSession,
  desktopShortcut,
} from "../helpers/electron-app";

test("sidebar folders, nested folds, history and archive visibility survive restart", async ({}, info) => {
  test.setTimeout(150000);
  const userDataDir = await makeUserDataDir("pi-sidebar-folds-");
  const agentDir = join(userDataDir, "agent");
  const alphaPath = await makeWorkspace("folds-alpha");
  const betaPath = await makeWorkspace("folds-beta");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  const seed = async (path: string, title: string) =>
    seedNamedTextSessionFixture(agentDir, path, {
      title,
      userText: "Sidebar persistence fixture",
      assistantText: "Saved fixture reply",
    });
  const parent = await seed(alphaPath, "Fold parent");
  const child = await seed(alphaPath, "Fold child");
  const grandchild = await seed(alphaPath, "Fold grandchild");
  const openParent = await seed(alphaPath, "Keep open parent");
  const openChild = await seed(alphaPath, "Keep open child");
  const archived = await seed(alphaPath, "Archive visibility sample");
  for (let i = 0; i < 7; i++) await seed(alphaPath, `History ${i}`);
  for (let i = 0; i < 7; i++) await seed(betaPath, `Beta sample ${i}`);
  const now = new Date().toISOString();
  const links: OrchestrationChildThread[] = [
    [parent, child],
    [child, grandchild],
    [openParent, openChild],
  ].map(([p, c], index) => ({
    id: `fold-link-${index}`,
    parentWorkspaceId: alphaPath,
    parentSessionId: p!.sessionId,
    childWorkspaceId: alphaPath,
    childSessionId: c!.sessionId,
    title: c!.title,
    goal: "Sidebar fixture",
    status: "complete",
    latestTranscript: "Saved fixture reply",
    transcript: [],
    evidence: [],
    createdAt: now,
    updatedAt: now,
  }));
  await writeFile(
    join(userDataDir, "ui-state.json"),
    JSON.stringify({
      version: 20,
      selectedWorkspaceId: alphaPath,
      selectedSessionId: grandchild.sessionId,
      threadGrouping: "workspace",
      orchestrationChildren: links,
    }),
  );
  const launch = () =>
    (process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop)(userDataDir, {
      agentDir,
      initialWorkspaces: [alphaPath, betaPath],
      testMode: "foreground",
      scrubProviderEnv: true,
    });
  let harness = await launch();
  try {
    let window = await harness.firstWindow();
    const alpha = await waitForWorkspaceByPath(window, alphaPath);
    const beta = await waitForWorkspaceByPath(window, betaPath);
    // Only synthetic fixture setup uses IPC; all fold changes and restoration checks use UI.
    await window.evaluate(
      async (target) => {
        await (
          window as unknown as { piApp: Pick<PiDesktopApi, "archiveSession"> }
        ).piApp.archiveSession(target);
      },
      { workspaceId: alpha.id, sessionId: archived.sessionId },
    );
    const alphaGroup = () => window.locator(`.workspace-group[data-workspace-id="${alpha.id}"]`);
    const betaFolder = () =>
      window.locator(`.workspace-group[data-workspace-id="${beta.id}"] .workspace-row__select`);
    const parentGroup = () =>
      window.getByRole("group", { name: "Children of Fold parent", exact: true });
    const childGroup = () =>
      window.getByRole("group", { name: "Children of Fold child", exact: true });
    const openGroup = () =>
      window.getByRole("group", { name: "Children of Keep open parent", exact: true });
    const history = () => alphaGroup().locator(".thread-history-toggle");
    const archives = () => window.locator(".archived-thread-group__toggle");
    await expect(parentGroup()).toBeVisible();
    await expect(childGroup()).toBeVisible();
    await history().click();
    await expect(history()).toHaveAttribute("aria-expanded", "true");
    await window
      .getByRole("button", { name: "Collapse children of Fold child", exact: true })
      .click();
    await window
      .getByRole("button", { name: "Collapse children of Fold parent", exact: true })
      .click();
    await expect(parentGroup()).toHaveCount(0);
    await expect(openGroup()).toBeVisible();
    const betaHistory = window.locator(
      `.workspace-group[data-workspace-id="${beta.id}"] .thread-history-toggle`,
    );
    await betaHistory.click();
    await expect(betaHistory).toHaveAttribute("aria-expanded", "true");
    await betaFolder().click();
    await expect(betaFolder()).toHaveAttribute("aria-expanded", "false");
    await archives().click();
    await expect(window.locator(".session-list--archived")).toBeVisible();
    expect((await getDesktopState(window)).selectedSessionId).toBe(grandchild.sessionId);
    await window.screenshot({ path: info.outputPath("before-restart.png") });
    // Settings unmounts Sidebar too; restoration must not depend on app lifetime.
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(parentGroup()).toHaveCount(0);
    await expect(history()).toHaveAttribute("aria-expanded", "true");
    await expect(window.locator(".session-list--archived")).toBeVisible();
    await harness.close();
    harness = await launch();
    window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await expect(betaFolder()).toHaveAttribute("aria-expanded", "false");
    await expect(history()).toHaveAttribute("aria-expanded", "true");
    await expect(parentGroup()).toHaveCount(0);
    await expect(openGroup()).toBeVisible();
    await expect(window.locator(".session-list--archived")).toBeVisible();
    expect((await getDesktopState(window)).selectedSessionId).toBe(grandchild.sessionId);
    // The hidden selected descendant must not force its parents open during startup.
    await window
      .getByRole("button", { name: "Expand children of Fold parent", exact: true })
      .click();
    await expect(parentGroup()).toBeVisible();
    await expect(childGroup()).toHaveCount(0);
    await window
      .getByRole("button", { name: "Expand children of Fold child", exact: true })
      .click();
    await expect(childGroup()).toBeVisible();
    for (let attempt = 0; attempt < 2; attempt++) {
      await window
        .getByRole("button", { name: "Collapse children of Fold parent", exact: true })
        .click();
      await window.keyboard.press(desktopShortcut("Shift+R"));
      await expect(window.getByLabel("Rename thread Fold grandchild")).toBeFocused();
      await window.keyboard.press("Escape");
      await expect(childGroup()).toBeVisible();
    }
    await window.screenshot({ path: info.outputPath("restored-and-explicit-reveal.png") });
    await history().click();
    await expect(history()).toHaveAttribute("aria-expanded", "false");
    await archives().click();
    await expect(window.locator(".session-list--archived")).toHaveCount(0);
    await betaFolder().click();
    await expect(betaFolder()).toHaveAttribute("aria-expanded", "true");
    await harness.close();
    harness = await launch();
    window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await expect(history()).toHaveAttribute("aria-expanded", "false");
    await expect(betaFolder()).toHaveAttribute("aria-expanded", "true");
    await expect(childGroup()).toBeVisible();
    await expect(window.locator(".session-list--archived")).toHaveCount(0);
    await window.screenshot({ path: info.outputPath("inverse-choices-restored.png") });
  } finally {
    await harness.close();
  }
});
