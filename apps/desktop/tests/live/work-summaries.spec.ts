import { expect, test } from "@playwright/test";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForTimelineLayout,
} from "../helpers/electron-app";

test("real provider generates a collapsed work summary through the visible Electron UI", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const auth = getRealAuthConfig();
  test.skip(!auth.enabled, auth.skipReason);
  const userDataDir = await makeUserDataDir("pi-summary-live-");
  await chmod(userDataDir, 0o700);
  const workspace = await makeWorkspace("summary-live-workspace");
  await writeFile(
    join(workspace, "SUMMARY_FIXTURE.md"),
    "Summary verification fixture: the orchid counter is 17.\n",
  );
  const model = process.env.PI_GUI_SUMMARY_PROOF_MODEL || "deepseek/deepseek-flash";
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspace],
    realAuthSourceDir: auth.sourceDir,
    enabledModels: [model],
    // Current distribution policy only accepts isolated profile overrides in
    // explicit test mode. Hooks exist but this proof never calls/injects them.
    testMode: "foreground",
  });
  try {
    await harness.focusWindow();
    const identity = await harness.inspectIdentity();
    expect(identity.visible).toBe(true);
    expect(identity.testMode).toBe("foreground");
    await testInfo.attach("identity", {
      body: JSON.stringify(identity),
      contentType: "application/json",
    });
    const window = await harness.firstWindow();
    await window
      .getByRole("complementary")
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    await window
      .getByLabel("New thread prompt", { exact: true })
      .fill(
        "Read SUMMARY_FIXTURE.md using the read tool, then run bash command 'printf summary-check' exactly once. Do not modify any files. Finish with one sentence describing the observation.",
      );
    await window.getByRole("button", { name: "Start thread", exact: true }).click();
    const summary = window.getByTestId("timeline-work-summary");
    await expect(summary).toBeVisible({ timeout: 90_000 });
    await expect(summary.getByTestId("work-summary-text")).not.toHaveText(
      /Summarizing work|unavailable|Completed work/,
      { timeout: 90_000 },
    );
    await expect(summary.getByTestId("work-summary-text")).toContainText(
      /SUMMARY_FIXTURE|orchid|17|summary-check/i,
    );
    await waitForTimelineLayout(window);
    await window.screenshot({ path: testInfo.outputPath("real-ai-summary-collapsed.png") });
    await summary.locator(".timeline-tool-group__header").click();
    await expect(summary.locator(".timeline-tool")).toHaveCount(2);
    await window.screenshot({ path: testInfo.outputPath("real-ai-summary-expanded.png") });
  } finally {
    await harness.close();
  }
});
