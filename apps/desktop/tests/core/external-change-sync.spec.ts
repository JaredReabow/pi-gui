import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  triggerWindowActivation,
} from "../helpers/electron-app";
import {
  appendMessagesToSessionFile,
  createSessionFileBeside,
  sessionFilePathFromCatalog,
} from "../helpers/session-file";

const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;

/**
 * Acceptance test for CLI ↔ GUI sync in the Codex-style model (no live file
 * watcher). With the app running and a session selected, an external writer (the
 * pi CLI) appends a turn straight to the pi session JSONL. On the next window
 * focus, the app reconciles from disk and re-renders the selected transcript —
 * WITHOUT the user re-selecting the workspace or session.
 */
test("reflects an external append to the selected session's JSONL on window focus", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("cli-sync-workspace");

  const harness = await launch(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "CLI sync session");

    const state = await getDesktopState(window);
    const workspaceId = state.selectedWorkspaceId;
    const sessionId = state.selectedSessionId;
    expect(workspaceId).toBeTruthy();
    expect(sessionId).toBeTruthy();

    // Resolve the pi JSONL path from the catalog once the running app has written it.
    let sessionFilePath = "";
    await expect
      .poll(
        async () => {
          try {
            sessionFilePath = await sessionFilePathFromCatalog(userDataDir, {
              workspaceId,
              sessionId,
            });
            const contents = await readFile(sessionFilePath, "utf8");
            return contents.split("\n").filter(Boolean).length;
          } catch {
            return 0;
          }
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    // Append a turn exactly as the pi CLI would, chaining off the current leaf.
    // No workspace/session re-selection happens after this point.
    await appendMessagesToSessionFile(sessionFilePath, [
      { role: "user", text: "external CLI turn appears on focus" },
    ]);

    // The append alone must not update the view — sync is focus-driven now.
    await expect(window.getByTestId("transcript")).not.toContainText(
      "external CLI turn appears on focus",
    );

    // Returning focus to the window reconciles from disk and republishes the transcript.
    await triggerWindowActivation(harness);

    await expect(window.getByTestId("transcript")).toContainText(
      "external CLI turn appears on focus",
      {
        timeout: 20_000,
      },
    );

    // The selection must be untouched — the update came from the focus reconcile, not a reselect.
    const afterState = await getDesktopState(window);
    expect(afterState.selectedWorkspaceId).toBe(workspaceId);
    expect(afterState.selectedSessionId).toBe(sessionId);
  } finally {
    await harness.close();
  }
});

/**
 * A CLI-created session (a brand-new JSONL the GUI has never seen) must surface
 * in the sidebar after the next window focus, without a workspace re-select.
 */
test("surfaces a CLI-created session on window focus", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("cli-new-session-workspace");

  const harness = await launch(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    // Seed one GUI session so the workspace has a resolvable pi session dir.
    await createNamedThread(window, "Seed session");

    const state = await getDesktopState(window);
    const workspaceId = state.selectedWorkspaceId;
    const sessionId = state.selectedSessionId;
    expect(workspaceId).toBeTruthy();

    let seedFilePath = "";
    await expect
      .poll(
        async () => {
          try {
            seedFilePath = await sessionFilePathFromCatalog(userDataDir, {
              workspaceId,
              sessionId,
            });
            return (await readFile(seedFilePath, "utf8")).split("\n").filter(Boolean).length;
          } catch {
            return 0;
          }
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    // Fabricate a second session's JSONL beside the seed, exactly as the pi CLI would.
    await createSessionFileBeside(seedFilePath, "cli-created-session.jsonl", [
      { role: "user", text: "hello from the pi CLI" },
    ]);

    await triggerWindowActivation(harness);

    await expect
      .poll(
        async () => {
          const next = await getDesktopState(window);
          const workspace = next.workspaces.find((entry) => entry.id === workspaceId);
          return workspace?.sessions.length ?? 0;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(1);
  } finally {
    await harness.close();
  }
});

test("reads Codex Router's shared model catalog on startup and refresh", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir("pi-gui-shared-catalog-focus-");
  const agentDir = join(userDataDir, "private-agent");
  const sharedAgentDir = join(userDataDir, "shared-pi-agent");
  const workspacePath = await makeWorkspace("shared-model-catalog-workspace");
  const sharedModelsPath = join(sharedAgentDir, "models.json");
  await seedAgentDir(agentDir, {
    enabledModels: ["router-focus/initial", "router-focus/added"],
  });
  await mkdir(sharedAgentDir, { recursive: true });

  const writeCatalog = async (modelIds: readonly string[], futureMs = 0) => {
    await writeFile(
      sharedModelsPath,
      JSON.stringify({
        providers: {
          "router-focus": {
            baseUrl: "http://127.0.0.1:9/v1",
            api: "openai-completions",
            apiKey: "shared-catalog-key",
            models: modelIds.map((id) => ({
              id,
              name: id,
              reasoning: false,
              input: ["text"],
            })),
          },
        },
      }),
    );
    if (futureMs > 0) {
      const stamp = new Date(Date.now() + futureMs);
      await utimes(sharedModelsPath, stamp, stamp);
    }
  };
  await writeCatalog(["initial"]);

  const harness = await launch(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_GUI_SHARED_PI_AGENT_DIR: sharedAgentDir,
    },
  });

  try {
    const window = await harness.firstWindow();
    const state = await getDesktopState(window);
    const workspaceId = state.selectedWorkspaceId;
    if (!workspaceId) throw new Error("Expected a selected workspace");
    const privateSettingsPath = join(agentDir, "settings.json");
    const privateAuthPath = join(agentDir, "auth.json");
    const privateSettings = await readFile(privateSettingsPath, "utf8");
    const privateAuth = await readFile(privateAuthPath, "utf8");

    const modelIds = async () =>
      (await getDesktopState(window)).runtimeByWorkspace[workspaceId]?.models
        .filter((model) => model.providerId === "router-focus")
        .map((model) => model.modelId) ?? [];
    await expect.poll(modelIds).toEqual(["initial"]);

    await writeCatalog(["initial", "added"], 2_000);
    await expect.poll(modelIds).toEqual(["initial"]);

    await triggerWindowActivation(harness);
    await expect.poll(modelIds).toEqual(["added", "initial"]);

    expect(await readFile(privateSettingsPath, "utf8")).toBe(privateSettings);
    expect(await readFile(privateAuthPath, "utf8")).toBe(privateAuth);
  } finally {
    await harness.close();
  }
});
