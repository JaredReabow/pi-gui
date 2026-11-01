import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  type DesktopCleanupResult,
  type DesktopHarness,
  type DesktopLaunchIdentity,
} from "../helpers/electron-app";

test("background Electron proof uses hidden isolated ownership and verified teardown", async () => {
  const evidenceDirectory =
    process.env.PI_DISTRIBUTION_ELECTRON_EVIDENCE_DIR ?? test.info().outputPath();
  await mkdir(evidenceDirectory, { recursive: true });
  const userDataDir = await makeUserDataDir("pi-gui-distribution-background-");
  const agentDir = join(userDataDir, "agent");
  const workspace = await makeWorkspace("distribution-background-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
  });

  let harness: DesktopHarness | undefined;
  let identity: DesktopLaunchIdentity | undefined;
  let cleanup: DesktopCleanupResult | undefined;
  try {
    harness = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspace],
      scrubProviderEnv: true,
      testMode: "background",
    });
    const page = await harness.firstWindow();
    identity = await harness.inspectIdentity();

    expect(identity.pid).toBe(harness.electronApp.process().pid);
    expect(identity.userData).toBe(userDataDir);
    expect(identity.visible).toBe(false);
    expect(identity.focused).toBe(false);
    expect(identity.testMode).toBe("background");
    expect(identity.telemetry).toEqual({
      doNotTrack: "1",
      otelSdkDisabled: "true",
      testTransport: "disabled",
    });
    expect(identity.windows).not.toHaveLength(0);
    for (const window of identity.windows) {
      expect(window).toMatchObject({
        visible: false,
        focused: false,
        destroyed: false,
      });
    }
    await expect.poll(() => page.evaluate(() => Boolean(window.piApp))).toBe(true);

    await writeFile(
      join(evidenceDirectory, "background-doctor.json"),
      `${JSON.stringify({ identity, userDataDir, workspace }, null, 2)}\n`,
      "utf8",
    );
  } finally {
    if (harness) {
      const ownedPid = harness.electronApp.process().pid;
      cleanup = await harness.close();
      expect(cleanup.pid).toBe(ownedPid);
      expect(cleanup.closed).toBe(true);
      expect(cleanup.exitCode !== null || cleanup.signalCode !== null).toBe(true);
      await writeFile(
        join(evidenceDirectory, "background-cleanup.json"),
        `${JSON.stringify(cleanup, null, 2)}\n`,
        "utf8",
      );
    }
  }
  expect(identity).toBeDefined();
  expect(cleanup).toBeDefined();
});
