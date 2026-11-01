import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test } from "@playwright/test";
import { launchDesktop, launchDesktopByExecutable, makeUserDataDir } from "../helpers/electron-app";

/** Background-only startup proof. The bootstrap changes platform appData before loading real main. */
test("candidate startup ignores hostile ambient paths and accepts an explicit isolated fixture root", async ({}, testInfo) => {
  test.skip(
    process.platform === "win32",
    "The scratch appData bootstrap uses a POSIX executable wrapper; Windows runtime proof is separate.",
  );
  const root = await realpath(await makeUserDataDir("pi-gui-d07-profile-proof-"));
  const appData = join(root, "platform-app-data");
  const stable = join(appData, "pi-gui-candidate");
  const legacy = join(root, "synthetic-legacy");
  await mkdir(stable, { recursive: true });
  await mkdir(legacy);
  const marker = join(legacy, "sessions.json");
  await writeFile(marker, '{"synthetic":"must-remain-unchanged"}');
  const digest = async () =>
    createHash("sha256")
      .update(await readFile(marker))
      .digest("hex");
  const before = await digest();
  const beforeFiles = await readdir(legacy);
  const desktop = resolve("apps/desktop");
  const bootstrap = join(root, "bootstrap.cjs");
  await writeFile(
    bootstrap,
    `const { app } = require("electron");\napp.setPath("appData", ${JSON.stringify(appData)});\napp.setAppPath(${JSON.stringify(desktop)});\nrequire(${JSON.stringify(join(desktop, "out/main/main.js"))});\n`,
  );
  const executable = createRequire(__filename)("electron") as string;
  const wrapper = join(root, "launch-electron.sh");
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(wrapper, `#!/bin/sh\nexec ${quote(executable)} "$@" ${quote(bootstrap)}\n`);
  await chmod(wrapper, 0o700);
  const receipts: unknown[] = [];
  const normal = await launchDesktopByExecutable(wrapper, stable, {
    testMode: "background",
    scrubProviderEnv: true,
    envOverrides: {
      PI_APP_TEST_DATA_ROOT: undefined,
      PI_APP_USER_DATA_DIR: legacy,
      PI_CODING_AGENT_DIR: legacy,
    },
  });
  try {
    await normal.firstWindow();
    const identity = await normal.inspectIdentity();
    const agentData = await normal.electronApp.evaluate(() => process.env.PI_CODING_AGENT_DIR);
    assert.equal(identity.userData, stable);
    assert.equal(identity.visible, false);
    assert.equal(identity.focused, false);
    assert.equal(agentData, join(stable, "agent"));
    receipts.push({
      kind: "normal-resolution-with-hostile-ambient-overrides",
      identity,
      agentData,
    });
  } finally {
    receipts.push({ cleanup: await normal.close() });
  }
  const fixture = join(root, "explicit-fixture");
  await mkdir(fixture);
  const explicit = await launchDesktop(fixture, { testMode: "background", scrubProviderEnv: true });
  try {
    await explicit.firstWindow();
    const identity = await explicit.inspectIdentity();
    const agentData = await explicit.electronApp.evaluate(() => process.env.PI_CODING_AGENT_DIR);
    assert.equal(identity.userData, fixture);
    assert.equal(agentData, join(fixture, "agent"));
    receipts.push({ kind: "explicit-fixture-root", identity, agentData });
  } finally {
    receipts.push({ cleanup: await explicit.close() });
  }
  const after = await digest();
  assert.equal(after, before);
  const afterFiles = await readdir(legacy);
  assert.deepEqual(afterFiles, beforeFiles);
  const receiptPath = testInfo.outputPath("background-profile-receipts.json");
  await writeFile(
    receiptPath,
    JSON.stringify({ root, before, after, beforeFiles, afterFiles, receipts }, null, 2) + "\n",
  );
  await testInfo.attach("background-profile-receipts.json", {
    path: receiptPath,
    contentType: "application/json",
  });
});
