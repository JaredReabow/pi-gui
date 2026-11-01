import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  type DesktopHarness,
} from "../helpers/electron-app";

const EXPECTED_URLS = [
  "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
  "https://donate.stripe.com/bJe7sLbEC3ZHgtQc6JgA801",
  "https://donate.stripe.com/00w3cv4cadAh4L82w9gA802",
  "https://donate.stripe.com/aFa3cv5ge3ZH7Xk2w9gA803",
  "https://paypal.me/reabowpayment",
] as const;

async function readOpenedUrls(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function openSettingsSupport(
  window: Awaited<ReturnType<DesktopHarness["firstWindow"]>>,
  expectedState: "open" | "hidden" = "open",
) {
  const settingsButton = window.getByRole("button", { name: "Settings", exact: true });
  if (await settingsButton.isVisible()) {
    await settingsButton.click();
  }
  await expect(window.getByTestId("settings-surface")).toBeVisible();
  const panel = window.getByTestId("support-development-panel");
  await expect(panel).toHaveAttribute("data-state", expectedState);
  return panel;
}

async function protectedUiState(window: Awaited<ReturnType<DesktopHarness["firstWindow"]>>) {
  return window.evaluate(async () => {
    const state = await globalThis.window.piApp!.getState();
    return {
      composerDraft: state.composerDraft,
      composerAttachments: state.composerAttachments,
      queuedComposerMessages: state.queuedComposerMessages,
      globalModelSettings: state.globalModelSettings,
      modelSettingsScopeMode: state.modelSettingsScopeMode,
      runtimeByWorkspace: state.runtimeByWorkspace,
      workspaces: state.workspaces,
    };
  });
}

test("manual support panel is exact, narrow, theme-safe, pending-safe and Main-allowlisted", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("support-development-panel-workspace");
  const openLogPath = join(userDataDir, "support-open.log");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: {
      PI_APP_TEST_SUPPORT_OPEN_LOG_PATH: openLogPath,
      PI_APP_TEST_SUPPORT_OPEN_DELAY_MS: "180",
      PI_APP_TEST_SUPPORT_FAIL_ONCE_OPTION_ID: "monthly-aud-10",
    },
  });

  try {
    const window = await harness.firstWindow();
    await expect(window.getByTestId("support-development-panel")).toHaveCount(0);
    const draft = "D11 support interaction must preserve this draft";
    await window.evaluate(
      async ({ draftText, workspace }) => {
        const app = globalThis.window.piApp!;
        const before = await app.getState();
        const selectedWorkspace = before.workspaces.find((entry) => entry.path === workspace);
        if (!selectedWorkspace) throw new Error("Support fixture workspace is unavailable");
        const withSession = await app.createSession({
          workspaceId: selectedWorkspace.id,
          title: "D11 support draft",
        });
        const session = withSession.workspaces
          .find((entry) => entry.id === selectedWorkspace.id)
          ?.sessions.find((entry) => entry.title === "D11 support draft");
        if (!session) throw new Error("Support fixture session was not created");
        await app.selectSession({
          workspaceId: selectedWorkspace.id,
          sessionId: session.id,
        });
        await app.updateComposerDraft(draftText, {
          workspaceId: selectedWorkspace.id,
          sessionId: session.id,
        });
        await app.setActiveView("threads");
      },
      { draftText: draft, workspace: workspacePath },
    );
    await expect(window.getByTestId("composer")).toHaveValue(draft);
    await expect
      .poll(() => protectedUiState(window).then((state) => state.composerDraft))
      .toBe(draft);
    const panel = await openSettingsSupport(window);
    const beforeSupportInteraction = await protectedUiState(window);
    expect(beforeSupportInteraction.composerDraft).toBe(draft);
    const panelText = await panel.innerText();

    for (const label of [
      "A$5 per month",
      "A$10 per month",
      "A$20 per month",
      "One-off, you choose",
      "One-off, you choose (PayPal)",
    ]) {
      await expect(panel).toContainText(label);
    }
    await expect(panel).toContainText("PayPal recipient: Leo Software");
    await expect(panel).toContainText("Stripe (AUD)");
    await expect(panel).not.toContainText(/\b(?:tier|unlock|charity|tax-deductible)\b/i);
    await expect(panel).not.toContainText(/payment (?:complete|successful|verified)/i);

    const hostileResults = await window.evaluate(async () => {
      const open = globalThis.window.piApp!.openSupportDevelopment as (
        optionId: unknown,
      ) => Promise<void>;
      const hostile = [
        "constructor",
        "__proto__",
        "toString",
        "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
        { id: "monthly-aud-5" },
      ];
      const results: string[] = [];
      for (const value of hostile) {
        try {
          await open(value);
          results.push("resolved");
        } catch {
          results.push("rejected");
        }
      }
      return results;
    });
    expect(hostileResults).toEqual(Array(5).fill("rejected"));
    expect(await readOpenedUrls(openLogPath)).toEqual([]);

    const firstOffer = panel.locator('[data-option-id="monthly-aud-5"]');
    await firstOffer.click();
    await expect(firstOffer).toBeDisabled();
    await firstOffer.evaluate((button) => (button as HTMLButtonElement).click());
    await expect.poll(() => readOpenedUrls(openLogPath)).toEqual([EXPECTED_URLS[0]]);
    await expect(firstOffer).toBeEnabled();

    await panel.locator('[data-option-id="monthly-aud-10"]').click();
    await expect(panel.getByRole("alert")).toContainText(
      "This option could not be opened. Try again.",
    );
    expect(await readOpenedUrls(openLogPath)).toEqual([EXPECTED_URLS[0]]);
    await panel.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => readOpenedUrls(openLogPath)).toEqual(EXPECTED_URLS.slice(0, 2));

    const remainingOffers = ["monthly-aud-20", "one-off-stripe", "one-off-paypal"];
    for (const [index, optionId] of remainingOffers.entries()) {
      await panel.locator(`[data-option-id="${optionId}"]`).click();
      await expect.poll(() => readOpenedUrls(openLogPath)).toHaveLength(index + 3);
    }
    expect(await readOpenedUrls(openLogPath)).toEqual([...EXPECTED_URLS]);

    await window.evaluate(() => globalThis.window.piApp!.setThemeMode("dark"));
    await expect(window.locator("html")).toHaveClass(/dark/);
    await expect(panel).toBeVisible();
    await window.evaluate(() => globalThis.window.piApp!.setThemeMode("light"));
    await expect(window.locator("html")).not.toHaveClass(/dark/);
    await expect(panel).toBeVisible();

    await window.setViewportSize({ width: 640, height: 760 });
    await expect.poll(() => window.viewportSize()?.width ?? 0).toBe(640);
    const dimensions = await panel.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    const monthlyLabels = panel.locator(
      ".support-development__offers--monthly .support-development__offer-label",
    );
    const firstBox = await monthlyLabels.nth(0).boundingBox();
    const secondBox = await monthlyLabels.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(secondBox!.y).toBeGreaterThan(firstBox!.y);

    await expect(firstOffer).toBeEnabled();
    await firstOffer.focus();
    await expect(firstOffer).toBeFocused();
    await expect(firstOffer).toHaveJSProperty("tagName", "BUTTON");
    expect(panelText).not.toMatch(/automatically|after you send|checkout opened/i);
    expect(await protectedUiState(window)).toEqual(beforeSupportInteraction);
  } finally {
    await harness.close();
  }
});

test("Not now is session-local while Don't ask again survives restart and keeps manual Settings available", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("support-development-dismissal-workspace");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: {
      PI_APP_TEST_SUPPORT_OPEN_LOG_PATH: join(userDataDir, "support-open.log"),
    },
  });

  try {
    let window = await harness.firstWindow();
    let panel = await openSettingsSupport(window);
    await panel.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(panel).toHaveAttribute("data-state", "hidden");
    await expect(
      panel.getByRole("button", { name: "Show support options", exact: true }),
    ).toBeVisible();
    await expect(panel.getByText("Support options are hidden in this window.")).toBeVisible();

    await window.reload();
    await window.waitForFunction(() => Boolean(globalThis.window.piApp));
    panel = await openSettingsSupport(window, "hidden");
    await expect(panel).toHaveAttribute("data-state", "hidden");
    await panel.getByRole("button", { name: "Show support options", exact: true }).click();
    await expect(panel).toHaveAttribute("data-state", "hidden");
    await expect(panel).toContainText("A$5 per month");
    await panel.getByRole("button", { name: "Don't ask again", exact: true }).click();
    await expect(
      panel.getByText("Support options are hidden by your saved preference."),
    ).toBeVisible();

    await harness.close();
    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      scrubProviderEnv: true,
      testMode: "background",
      envOverrides: {
        PI_APP_TEST_SUPPORT_OPEN_LOG_PATH: join(userDataDir, "support-open.log"),
      },
    });
    window = await harness.firstWindow();
    panel = await openSettingsSupport(window, "hidden");
    await expect(panel).toHaveAttribute("data-state", "hidden");
    await expect(window.getByRole("heading", { name: "Support development" })).toBeVisible();
    await panel.getByRole("button", { name: "Show support options", exact: true }).click();
    await expect(panel.locator('[data-option-id="monthly-aud-20"]')).toBeVisible();
  } finally {
    await harness.close();
  }
});
