import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchPackagedDesktop,
  makeUserDataDir,
  seedAgentDir,
} from "../helpers/electron-app";

test("imports a detected project through the packaged first-launch flow", async () => {
  test.setTimeout(120_000);
  const root = await makeUserDataDir("project-import-packaged-");
  const agentDir = join(root, "agent");
  const homeDir = join(root, "home");
  const appDataDir = join(root, "app-data");
  const documentsDir = join(root, "documents");
  const projectPath = join(documentsDir, "ChatGPT", "Packaged import");
  await seedAgentDir(agentDir);
  await mkdir(join(projectPath, ".git"), { recursive: true });
  await writeFile(join(projectPath, "package.json"), '{"name":"packaged-import"}\n');

  const harness = await launchPackagedDesktop(root, {
    agentDir,
    testMode: "background",
    suppressProjectImportOnboarding: false,
    envOverrides: {
      PI_GUI_PROJECT_IMPORT_HOME: homeDir,
      PI_GUI_PROJECT_IMPORT_APP_DATA: appDataDir,
      PI_GUI_PROJECT_IMPORT_DOCUMENTS: documentsDir,
    },
  });

  try {
    const window = await harness.firstWindow();
    await expect(window.getByTestId("project-import-onboarding")).toBeVisible();
    await window.getByRole("button", { name: "Scan projects" }).click();
    await expect(window.getByTestId("project-import-review")).toContainText("Packaged import");
    await expect(window.getByTestId("project-import-model")).not.toHaveValue("");
    await window.getByRole("button", { name: "Import selected" }).click();
    await expect(window.getByTestId("project-import-complete")).toBeVisible();
    await expect(window.getByTestId("project-import-monitor-result")).toContainText("not needed");
    await window.getByRole("button", { name: "Done" }).click();
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.map((workspace) => workspace.path);
      })
      .toContain(projectPath);
  } finally {
    await harness.close();
  }
});
