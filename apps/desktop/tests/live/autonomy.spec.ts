import { expect, test } from "@playwright/test";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getRealAuthConfig,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
test("real reviewer approves a bounded project action through visible Electron UI", async ({}, info) => {
  test.setTimeout(180000);
  const auth = getRealAuthConfig();
  test.skip(!auth.enabled, auth.skipReason);
  const userDataDir = await makeUserDataDir("pi-autonomy-live-");
  await chmod(userDataDir, 0o700);
  const workspace = await makeWorkspace("autonomy-live-workspace");
  await writeFile(
    join(userDataDir, "autonomy.json"),
    JSON.stringify({ version: 2, revision: 0, defaultMode: "read-only", sessions: {} }),
  );
  const model = process.env.PI_GUI_REVIEW_PROOF_MODEL || "deepseek/deepseek-flash";
  const modelId = model.slice(model.indexOf("/") + 1);
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspace],
    realAuthSourceDir: auth.sourceDir,
    enabledModels: [model],
    testMode: "foreground",
  });
  try {
    await harness.focusWindow();
    const identity = await harness.inspectIdentity();
    expect(identity.visible).toBe(true);
    await info.attach("identity", {
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
      .fill("Reply with READY only. Do not call tools.");
    await window.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect(window.getByTestId("transcript").getByText("READY", { exact: true })).toBeVisible({
      timeout: 90000,
    });
    await expect(window.getByRole("button", { name: "Stop run", exact: true })).toHaveCount(0, {
      timeout: 90000,
    });
    await window.getByLabel("Access mode", { exact: true }).selectOption("auto");
    const picker = window.getByRole("button", { name: "Approval review model", exact: true });
    await picker.click();
    const option = window.locator(
      ".composer .model-selector__dropdown button:has(.model-selector__item-label)",
    );
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(picker).toContainText(modelId);
    const composer = window.getByTestId("composer");
    await composer.fill(
      "Use the bash tool exactly once to execute the command between these backticks: `printf '%s' 'autonomy-live-approved' > AUTONOMY_MARKER.txt`. The file is inside this scratch project and this creation is authorized. Do not run any other command or use a different tool. Finish with EXECUTED only.",
    );
    await composer.press("Enter");
    await expect
      .poll(async () => readFile(join(workspace, "AUTONOMY_MARKER.txt"), "utf8").catch(() => ""), {
        timeout: 90000,
      })
      .toBe("autonomy-live-approved");
    await expect(window.getByTestId("extension-dialog")).toHaveCount(0);
    await expect(
      window
        .getByText(
          new RegExp("Auto-review approved bash: " + model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        )
        .first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(window.getByRole("button", { name: "Stop run", exact: true })).toHaveCount(0, {
      timeout: 90000,
    });
    await window.screenshot({ path: info.outputPath("real-reviewer-approved.png") });
    const saved = JSON.parse(await readFile(join(userDataDir, "autonomy.json"), "utf8")) as {
      sessions: Record<string, { mode?: string; reviewModel?: { modelId: string } }>;
    };
    expect(
      Object.values(saved.sessions).some(
        (entry) => entry.mode === "auto" && entry.reviewModel?.modelId === modelId,
      ),
    ).toBe(true);
  } finally {
    await harness.close();
  }
});
