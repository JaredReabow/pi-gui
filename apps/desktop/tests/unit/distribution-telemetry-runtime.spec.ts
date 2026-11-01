import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir } from "../helpers/electron-app";

test("candidate Electron startup initializes telemetry without identity or state before consent", async () => {
  const userDataDir = await makeUserDataDir("pi-gui-d07-telemetry-runtime-");
  const harness = await launchDesktop(userDataDir, {
    testMode: "background",
    scrubProviderEnv: true,
  });
  try {
    await harness.firstWindow();
    const identity = await harness.inspectIdentity();
    expect(identity.telemetry).toEqual({
      doNotTrack: "1",
      otelSdkDisabled: "true",
      testTransport: "disabled",
    });
    await expect(access(join(userDataDir, "telemetry", "state.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await harness.close();
  }
});
