import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("packaged app exposes and persists all running-indicator choices", async () => {
  const userDataDir = await makeUserDataDir("pi-gui-packaged-activity-");
  const workspacePath = await makeWorkspace("packaged-activity-workspace");
  let harness = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();

    const selector = window.getByLabel("Activity indicator");
    await expect(selector.locator("option")).toHaveCount(6);
    for (const style of ["moonwalk", "stick", "wheel", "ball", "wave", "spiral"]) {
      await selector.selectOption(style);
      await expect(window.getByTestId("activity-indicator")).toHaveAttribute(
        "data-activity-style",
        style,
      );
    }
    await selector.selectOption("spiral");
    await expect
      .poll(
        async () => (await getDesktopState(window)).sidebarAppearance?.activityIndicatorPreference,
      )
      .toMatchObject({ style: "spiral", source: "user" });
  } finally {
    await harness.close();
  }

  harness = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();
    await expect(window.getByLabel("Activity indicator")).toHaveValue("spiral");
  } finally {
    await harness.close();
  }
});
