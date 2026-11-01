import { expect, test } from "@playwright/test";
import {
  chooseThreadGrouping,
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { appendMessagesToSessionFile, sessionFilePathFromCatalog } from "../helpers/session-file";
import {
  projectIdentity_accentInk,
  projectIdentity_presetColors,
} from "../../contracts/project-identity";

function rgb(hex: string): string {
  return `rgb(${Number.parseInt(hex.slice(1, 3), 16)}, ${Number.parseInt(
    hex.slice(3, 5),
    16,
  )}, ${Number.parseInt(hex.slice(5, 7), 16)})`;
}

test("new projects keep their random colours and colour their user messages", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir("project-colours-");
  const alphaPath = await makeWorkspace("project-colours-alpha");
  const betaPath = await makeWorkspace("project-colours-beta");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [alphaPath, betaPath],
    testMode: "background",
  });
  let workspaceId = "";
  let sessionId = "";

  try {
    const window = await firstRun.firstWindow();
    const alpha = await waitForWorkspaceByPath(window, alphaPath);
    await waitForWorkspaceByPath(window, betaPath);
    workspaceId = alpha.id;
    const state = await getDesktopState(window);
    const colors = state.sidebarAppearance?.projectByWorkspaceId;
    if (!colors) throw new Error("Project colour projection is missing");
    const alphaColor = colors[workspaceId]?.accentColor;
    const otherColor = Object.entries(colors).find(([id]) => id !== workspaceId)?.[1].accentColor;
    expect(alphaColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(projectIdentity_presetColors).toContain(alphaColor);
    expect(otherColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(otherColor).not.toBe(alphaColor);

    await createNamedThread(window, "Project colour transcript", {
      workspaceName: alpha.name,
    });
    const selected = await getDesktopState(window);
    sessionId = selected.selectedSessionId;
    expect(sessionId).toBeTruthy();
  } finally {
    await firstRun.close();
  }

  const sessionPath = await sessionFilePathFromCatalog(userDataDir, { workspaceId, sessionId });
  await appendMessagesToSessionFile(sessionPath, [
    { role: "user", text: "Colour this user message" },
    { role: "assistant", text: "The user message should inherit the project colour." },
  ]);

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  let selectedColor = "";
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await chooseThreadGrouping(window, "workspace");
    const group = window.locator(`.workspace-group[data-workspace-id="${workspaceId}"]`);
    const row = group.locator(".workspace-row");
    const initialColor = (await getDesktopState(window)).sidebarAppearance.projectByWorkspaceId[
      workspaceId
    ]!.accentColor;
    selectedColor =
      initialColor === projectIdentity_presetColors[5]
        ? projectIdentity_presetColors[6]!
        : projectIdentity_presetColors[5]!;

    await row.getByTestId("workspace-menu-trigger").click();
    await expect(row.getByTestId("workspace-accent-picker")).toBeVisible();
    await row.getByTestId("workspace-accent-rose").click();
    if (selectedColor !== projectIdentity_presetColors[5]) {
      await row.getByTestId("workspace-accent-violet").click();
    }
    await expect
      .poll(
        async () =>
          (await getDesktopState(window)).sidebarAppearance?.projectByWorkspaceId[workspaceId]
            ?.accentColor,
      )
      .toBe(selectedColor);
    await expect(row).toHaveAttribute("data-workspace-accent", selectedColor);

    const bubble = window.getByTestId("user-message-bubble").filter({
      hasText: "Colour this user message",
    });
    await expect(bubble).toBeVisible();
    await expect
      .poll(() =>
        bubble.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            accent: style.getPropertyValue("--workspace-accent").trim(),
            background: style.backgroundColor,
            text: style.color,
          };
        }),
      )
      .toEqual({
        accent: selectedColor,
        background: rgb(selectedColor),
        text: rgb(projectIdentity_accentInk(selectedColor)),
      });
    await testInfo.attach("project-coloured user message", {
      body: await bubble.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await secondRun.close();
  }

  const thirdRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await thirdRun.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await expect
      .poll(
        async () =>
          (await getDesktopState(window)).sidebarAppearance?.projectByWorkspaceId[workspaceId]
            ?.accentColor,
      )
      .toBe(selectedColor);
  } finally {
    await thirdRun.close();
  }
});
