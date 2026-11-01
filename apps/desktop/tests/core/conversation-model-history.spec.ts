import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  pasteTinyPng,
  seedAgentDir,
  selectSession,
} from "../helpers/electron-app";
import { startScriptedOpenAiServer } from "../helpers/scripted-openai-server";

const FIRST_PROMPT = "Earlier request\nwith a second line";
const IMMEDIATE_MODEL_DRAFT = "Immediate draft: preserve this exact unsent text";
const SECOND_PROMPT = "Most recent request";
const UNSENT_DRAFT = "Unsaved draft\nwith its own line";
const GUI_EVIDENCE_DIR = process.env.D08_C1_GUI_EVIDENCE_DIR;

async function selectedTarget(window: Page) {
  const state = await getDesktopState(window);
  if (!state.selectedWorkspaceId || !state.selectedSessionId) {
    throw new Error("Expected a selected thread");
  }
  return { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
}

test("prompt recall and model switches stay bound to the visible thread", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("conversation-model-history");
  const server = await startScriptedOpenAiServer((request) => {
    const prompt =
      [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    return { text: `Scripted reply to: ${prompt}` };
  });

  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["scripted-test/scripted", "scripted-test/scripted-alt"],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "scripted-test",
      defaultModel: "scripted",
      enabledModels: ["scripted-test/scripted", "scripted-test/scripted-alt"],
    }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "scripted-test": {
          baseUrl: server.baseUrl,
          api: "openai-completions",
          apiKey: "unused",
          models: [
            { id: "scripted", name: "Scripted" },
            { id: "scripted-alt", name: "Scripted Alt" },
          ],
        },
      },
    }),
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Recall primary");
    const historyTarget = await selectedTarget(window);
    const composer = window.getByTestId("composer");
    const transcript = window.getByTestId("transcript");

    await pasteTinyPng(window, "historical-image.png");
    await composer.fill(FIRST_PROMPT);
    await composer.press("Enter");
    await expect(transcript).toContainText(`Scripted reply to: ${FIRST_PROMPT}`);
    await expect(window.locator(".composer-attachment")).toHaveCount(0);

    await composer.fill(SECOND_PROMPT);
    await composer.press("Enter");
    await expect(transcript).toContainText(`Scripted reply to: ${SECOND_PROMPT}`);
    const generationRequestsBeforeModelChanges = server.requests.length;

    await createNamedThread(window, "Model isolation peer");
    const otherTarget = await selectedTarget(window);
    await composer.fill("draft owned by the other thread");
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("draft owned by the other thread");

    await selectSession(window, "Recall primary");
    await composer.fill(UNSENT_DRAFT);
    await composer.evaluate((element: HTMLTextAreaElement) => {
      element.setSelectionRange(0, 0);
    });
    await pasteTinyPng(window, "current-draft.png");
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue(SECOND_PROMPT);
    await expect(window.locator(".composer-attachment")).toHaveCount(1);
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue(FIRST_PROMPT);
    await composer.press("ArrowDown");
    await composer.press("ArrowDown");
    await expect(composer).toHaveValue(UNSENT_DRAFT);
    await expect(window.locator(".composer-attachment")).toHaveCount(1);
    await expect.poll(async () => (await getDesktopState(window)).composerDraft).toBe(UNSENT_DRAFT);
    await expect
      .poll(async () => (await getDesktopState(window)).composerAttachments?.length ?? 0)
      .toBe(1);

    await window.getByRole("button", { name: "Remove current-draft.png" }).click();
    await composer.press("ArrowUp");
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue(FIRST_PROMPT);
    await expect(window.locator(".composer-attachment")).toHaveCount(0);

    await composer.fill("/");
    await expect(window.getByTestId("slash-menu")).toBeVisible();
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("/");
    await composer.fill("@");
    await expect(window.getByTestId("mention-menu")).toBeVisible();
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("@");

    await composer.fill("first line\nmiddle line\nlast line");
    await composer.evaluate((element: HTMLTextAreaElement) => {
      const caret = element.value.indexOf("middle") + 2;
      element.setSelectionRange(caret, caret);
    });
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("first line\nmiddle line\nlast line");

    await composer.fill("selected draft");
    await composer.evaluate((element: HTMLTextAreaElement) => {
      element.setSelectionRange(0, 8);
    });
    await composer.press("ArrowUp");
    await expect(composer).toHaveValue("selected draft");

    await composer.fill("IME draft");
    await composer.evaluate((element: HTMLTextAreaElement) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          code: "ArrowUp",
          bubbles: true,
          isComposing: true,
        }),
      );
    });
    await expect(composer).toHaveValue("IME draft");

    await composer.fill("Modified draft");
    await composer.press("Shift+ArrowUp");
    await expect(composer).toHaveValue("Modified draft");

    const footer = window.locator(".composer__bar");
    await composer.fill(UNSENT_DRAFT);
    await pasteTinyPng(window, "confirmation-draft.png");
    await footer.getByRole("button", { name: "scripted-test:scripted" }).click();
    await footer.getByRole("button", { name: "Scripted Alt" }).click();
    const confirmation = window.getByTestId("model-switch-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("Costs and context limits can differ by model.");
    await expect(confirmation).toContainText("draft and attachments stay in place");
    await expect(confirmation).not.toContainText("$");
    await expect(confirmation).not.toContainText(/transcript.*(erased|deleted|lost)/i);
    await expect(composer).toHaveValue(UNSENT_DRAFT);
    await expect(window.locator(".composer-attachment")).toHaveCount(1);
    await testInfo.attach("model-confirmation-aria.txt", {
      body: await confirmation.ariaSnapshot(),
      contentType: "text/plain",
    });
    await testInfo.attach("model-confirmation.png", {
      body: await confirmation.screenshot(),
      contentType: "image/png",
    });
    if (GUI_EVIDENCE_DIR) {
      await mkdir(GUI_EVIDENCE_DIR, { recursive: true });
      await confirmation.screenshot({
        path: join(GUI_EVIDENCE_DIR, "model-confirmation.png"),
      });
      await writeFile(
        join(GUI_EVIDENCE_DIR, "model-confirmation-aria.txt"),
        await confirmation.ariaSnapshot(),
        "utf8",
      );
    }
    await window.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "scripted-test:scripted" })).toBeVisible();
    await expect(window.locator(".composer-attachment")).toHaveCount(1);

    await footer.getByRole("button", { name: "scripted-test:scripted" }).click();
    await footer.getByRole("button", { name: "Scripted Alt" }).click();
    await expect(confirmation).toBeVisible();
    await window.evaluate(
      async ({ target }) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        await app.selectSession(target);
      },
      { target: otherTarget },
    );
    await expect(confirmation).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "scripted-test:scripted" })).toBeVisible();

    await selectSession(window, "Recall primary");
    await footer.getByRole("button", { name: "scripted-test:scripted" }).click();
    await footer.getByRole("button", { name: "Scripted Alt" }).click();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(footer.getByRole("button", { name: "scripted-test:scripted" })).toBeVisible();

    await footer.getByRole("button", { name: "scripted-test:scripted" }).click();
    await footer.getByRole("button", { name: "Scripted Alt" }).click();
    await confirmation.getByRole("button", { name: "Switch model" }).click();
    await expect(footer.getByRole("button", { name: "scripted-test:scripted-alt" })).toBeVisible();
    await expect(composer).toHaveValue(UNSENT_DRAFT);
    await expect(window.locator(".composer-attachment")).toHaveCount(1);

    await footer.getByRole("button", { name: "scripted-test:scripted-alt" }).click();
    await footer.getByRole("button", { name: "Scripted Alt" }).click();
    await expect(confirmation).toHaveCount(0);
    expect(historyTarget).not.toEqual(otherTarget);

    await composer.fill("Palette draft");
    await window.keyboard.press(desktopShortcut("K"));
    const palette = window.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await window.keyboard.type("switch model");
    await window.keyboard.press("Enter");
    await expect(palette).toHaveAttribute("aria-label", "Switch model");
    await palette.getByRole("option").filter({ hasText: "Scripted" }).first().click();
    await expect(confirmation).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "scripted-test:scripted-alt" })).toBeVisible();
    await expect(composer).toHaveValue("Palette draft");

    await window.keyboard.press(desktopShortcut("K"));
    await window.keyboard.type("switch model");
    await window.keyboard.press("Enter");
    await palette.getByRole("option").filter({ hasText: "Scripted" }).first().click();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(footer.getByRole("button", { name: "scripted-test:scripted-alt" })).toBeVisible();

    await window.keyboard.press(desktopShortcut("K"));
    await window.keyboard.type("switch model");
    await window.keyboard.press("Enter");
    await palette.getByRole("option").filter({ hasText: "Scripted" }).first().click();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Switch model" }).click();
    await expect(footer.getByRole("button", { name: "scripted-test:scripted" })).toBeVisible();
    await expect(composer).toHaveValue("Palette draft");

    await composer.fill("/model");
    const slashOptions = window.getByTestId("slash-options-menu");
    await expect(slashOptions).toBeVisible();
    await slashOptions.getByRole("button", { name: /Scripted Alt/ }).click();
    await expect(confirmation).toBeVisible();
    await expect(composer).toHaveValue("/model");
    await window.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(composer).toHaveValue("/model");
    await expect(footer.getByRole("button", { name: "scripted-test:scripted" })).toBeVisible();

    await slashOptions.getByRole("button", { name: /Scripted Alt/ }).click();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Switch model" }).click();
    await expect(composer).toHaveValue("");
    await expect(footer.getByRole("button", { name: "scripted-test:scripted-alt" })).toBeVisible();

    await composer.fill("/model");
    await slashOptions.getByRole("button", { name: /Scripted Alt/ }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(composer).toHaveValue("");
    await expect(footer.getByRole("button", { name: "scripted-test:scripted-alt" })).toBeVisible();

    const threadHeader = window.locator(".topbar__actions");
    await expect(threadHeader.locator(".model-selector")).toHaveCount(1);
    const headerModel = threadHeader.locator(".model-selector__badge").first();
    const footerModel = footer.locator(".model-selector__badge").first();
    await expect(headerModel).toHaveText("scripted-test:scripted-alt");
    await expect(footerModel).toHaveText("scripted-test:scripted-alt");
    const threadHeaderAria = await threadHeader.ariaSnapshot();
    await testInfo.attach("thread-header-aria.txt", {
      body: threadHeaderAria,
      contentType: "text/plain",
    });
    if (GUI_EVIDENCE_DIR) {
      await mkdir(GUI_EVIDENCE_DIR, { recursive: true });
      await writeFile(join(GUI_EVIDENCE_DIR, "thread-header-aria.txt"), threadHeaderAria, "utf8");
      await window.screenshot({
        path: join(GUI_EVIDENCE_DIR, "thread-header-model.png"),
      });
    }
    await headerModel.click();
    await threadHeader
      .locator(".model-selector__item")
      .filter({ hasText: "Scripted" })
      .filter({ hasNotText: "Scripted Alt" })
      .click();
    await expect(confirmation).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(headerModel).toHaveText("scripted-test:scripted-alt");
    await expect(footerModel).toHaveText("scripted-test:scripted-alt");

    await headerModel.click();
    await threadHeader
      .locator(".model-selector__item")
      .filter({ hasText: "Scripted" })
      .filter({ hasNotText: "Scripted Alt" })
      .click();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(headerModel).toHaveText("scripted-test:scripted-alt");
    await expect(footerModel).toHaveText("scripted-test:scripted-alt");

    await headerModel.click();
    await threadHeader
      .locator(".model-selector__item")
      .filter({ hasText: "Scripted" })
      .filter({ hasNotText: "Scripted Alt" })
      .click();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Switch model" }).click();
    await expect(headerModel).toHaveText("scripted-test:scripted");
    await expect(footerModel).toHaveText("scripted-test:scripted");

    await headerModel.click();
    await threadHeader
      .locator(".model-selector__item")
      .filter({ hasText: "Scripted" })
      .filter({ hasNotText: "Scripted Alt" })
      .click();
    await expect(confirmation).toHaveCount(0);
    await expect(headerModel).toHaveText("scripted-test:scripted");
    await expect(footerModel).toHaveText("scripted-test:scripted");
    expect(server.requests).toHaveLength(generationRequestsBeforeModelChanges);
  } finally {
    await server.close();
    await harness.close();
  }
});

test("an immediate model confirmation keeps a fresh draft and attachment", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("immediate-model-draft");
  const server = await startScriptedOpenAiServer(() => ({ text: "Unused" }));

  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["scripted-test/scripted", "scripted-test/scripted-alt"],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "scripted-test",
      defaultModel: "scripted",
      enabledModels: ["scripted-test/scripted", "scripted-test/scripted-alt"],
    }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "scripted-test": {
          baseUrl: server.baseUrl,
          api: "openai-completions",
          apiKey: "unused",
          models: [
            { id: "scripted", name: "Scripted" },
            { id: "scripted-alt", name: "Scripted Alt" },
          ],
        },
      },
    }),
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Immediate confirmation");
    const composer = window.getByTestId("composer");
    const footer = window.locator(".composer__bar");

    await composer.fill(IMMEDIATE_MODEL_DRAFT);
    await pasteTinyPng(window, "immediate-model-draft.png");
    await footer.getByRole("button", { name: "scripted-test:scripted" }).click();
    await footer.getByRole("button", { name: "Scripted Alt" }).click();
    const confirmation = window.getByTestId("model-switch-confirmation");
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Switch model" }).click();

    await expect(footer.getByRole("button", { name: "scripted-test:scripted-alt" })).toBeVisible();
    await expect(composer).toHaveValue(IMMEDIATE_MODEL_DRAFT);
    await expect(window.locator(".composer-attachment--image")).toHaveCount(1);
    await expect(window.locator(".composer-attachment__preview")).toHaveAttribute(
      "title",
      "immediate-model-draft.png",
    );
    await expect
      .poll(async () => (await getDesktopState(window)).composerDraft)
      .toBe(IMMEDIATE_MODEL_DRAFT);
    await expect
      .poll(async () =>
        (await getDesktopState(window)).composerAttachments?.map((attachment) => attachment.name),
      )
      .toContain("immediate-model-draft.png");
  } finally {
    await server.close();
    await harness.close();
  }
});
