import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  seedAgentDir,
} from "../helpers/electron-app";

test("first launch can deterministically import a detected project and does not ask again", async () => {
  test.setTimeout(90_000);
  const root = await makeUserDataDir("project-import-onboarding-");
  const agentDir = join(root, "agent");
  const homeDir = join(root, "home");
  const appDataDir = join(root, "app-data");
  const documentsDir = join(root, "documents");
  const projectPath = join(documentsDir, "ChatGPT", "Imported project");
  await seedAgentDir(agentDir);
  await mkdir(join(projectPath, ".git"), { recursive: true });
  await writeFile(join(projectPath, "package.json"), '{"name":"imported-project"}\n');

  const launchOptions = {
    agentDir,
    testMode: "background" as const,
    suppressProjectImportOnboarding: false,
    envOverrides: {
      PI_GUI_PROJECT_IMPORT_HOME: homeDir,
      PI_GUI_PROJECT_IMPORT_APP_DATA: appDataDir,
      PI_GUI_PROJECT_IMPORT_DOCUMENTS: documentsDir,
    },
  };
  let harness = await launchDesktop(root, launchOptions);
  try {
    const window = await harness.firstWindow();
    const onboarding = window.getByTestId("project-import-onboarding");
    await expect(onboarding).toBeVisible();
    await expect(window.getByTestId("project-import-prompt")).toBeVisible();
    await window.getByRole("button", { name: "Scan projects" }).click();

    const review = window.getByTestId("project-import-review");
    await expect(review).toBeVisible();
    await expect(review).toContainText("ChatGPT");
    await expect(window.getByTestId("project-import-candidates")).toContainText("Imported project");
    await expect(window.getByTestId("project-import-model")).not.toHaveValue("");
    await expect
      .poll(() =>
        window.evaluate(
          async (path) =>
            globalThis.window.piApp?.monitorProjectImport({
              model: { provider: "missing", modelId: "missing" },
              cwd: path,
              candidatesFound: 1,
              imported: 0,
              alreadyPresent: 0,
              failures: [{ name: "Imported project", status: "failed", error: "fixture" }],
            }),
          projectPath,
        ),
      )
      .toMatchObject({ status: "unavailable", action: "continue" });
    await window.getByRole("button", { name: "Import selected" }).click();

    await expect(window.getByTestId("project-import-complete")).toBeVisible();
    await expect(window.getByTestId("project-import-monitor-result")).toContainText("not needed");
    await window.getByRole("button", { name: "Done" }).click();
    await expect(onboarding).toHaveCount(0);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.map((workspace) => workspace.path);
      })
      .toContain(projectPath);
    await window.getByTestId("sidebar-import-projects").click();
    await expect(onboarding).toBeVisible();
    await window.getByRole("button", { name: "Not now" }).click();
    await expect(onboarding).toHaveCount(0);
  } finally {
    await harness.close();
  }

  harness = await launchDesktop(root, launchOptions);
  try {
    const window = await harness.firstWindow();
    await expect(window.getByTestId("project-import-onboarding")).toHaveCount(0);
    await expect.poll(async () => (await getDesktopState(window)).workspaces.length).toBe(1);
  } finally {
    await harness.close();
  }
});
