import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  getDesktopState,
  getTimelineScrollMetrics,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
  streamAssistantDeltas,
  waitForSelectedSessionReady,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { appendMessagesToSessionFile, sessionFilePathFromCatalog } from "../helpers/session-file";

const TURN_COUNT = 6;
const WIDE_WINDOW = { width: 1500, height: 950 } as const;
const NARROW_WINDOW = { width: 800, height: 900 } as const;
const LONG_PROMPT = `PROMPT 0 unique-marker-0 USER_${"unbroken_segment".repeat(180)}`;

interface ContextRailProof {
  readonly promptId: string | null;
  readonly promptText: string | null;
  readonly promptRowId: string | null;
  readonly scrollTop: number;
  readonly visibleRows: readonly {
    readonly id: string;
    readonly top: number;
    readonly bottom: number;
  }[];
  readonly promptBounds: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly paneBounds: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly cornerRadii: {
    readonly topLeft: string;
    readonly topRight: string;
    readonly bottomRight: string;
    readonly bottomLeft: string;
  };
  readonly promptInsideViewport: boolean;
  readonly promptBeforePane: boolean;
  readonly draft: string;
}

async function setWindowSize(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  window: Page,
  size: { readonly width: number; readonly height: number },
): Promise<void> {
  await harness.electronApp.evaluate(({ BrowserWindow }, bounds) => {
    const appWindow = BrowserWindow.getAllWindows()[0];
    if (!appWindow) throw new Error("Expected an owned app window");
    appWindow.setSize(bounds.width, bounds.height);
  }, size);
  await expect
    .poll(() =>
      window.evaluate(() => ({
        width: globalThis.window.innerWidth,
        height: globalThis.window.innerHeight,
      })),
    )
    .toEqual(size);
}

async function setZoom(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  factor: number,
): Promise<void> {
  await harness.electronApp.evaluate(({ BrowserWindow }, zoomFactor) => {
    BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(zoomFactor);
  }, factor);
}

async function captureContextRail(
  window: Page,
  proofDir: string | undefined,
  label: string,
): Promise<ContextRailProof> {
  const proof = await window.evaluate(() => {
    const prompt = document.querySelector<HTMLElement>('[data-testid="timeline-pinned-prompt"]');
    const pane = document.querySelector<HTMLElement>('[data-testid="timeline-pane"]');
    const draft = document.querySelector<HTMLTextAreaElement>('[data-testid="composer"]');
    if (!pane) throw new Error("Expected the timeline pane");
    const paneRect = pane.getBoundingClientRect();
    const promptRect = prompt?.getBoundingClientRect();
    const style = prompt ? getComputedStyle(prompt) : null;

    return {
      promptId: prompt?.dataset.promptId ?? null,
      promptText: prompt?.dataset.promptText ?? null,
      promptRowId: prompt?.dataset.promptRowId ?? null,
      scrollTop: pane.scrollTop,
      visibleRows: [...pane.querySelectorAll<HTMLElement>("[data-message-id]")]
        .map((row) => {
          const rect = row.getBoundingClientRect();
          return {
            id: row.dataset.messageId ?? "",
            top: rect.top - paneRect.top + pane.scrollTop,
            bottom: rect.bottom - paneRect.top + pane.scrollTop,
          };
        })
        .filter(
          (row) => row.bottom >= pane.scrollTop && row.top <= pane.scrollTop + pane.clientHeight,
        ),
      promptBounds: promptRect
        ? {
            top: promptRect.top,
            right: promptRect.right,
            bottom: promptRect.bottom,
            left: promptRect.left,
          }
        : { top: -1, right: -1, bottom: -1, left: -1 },
      paneBounds: {
        top: paneRect.top,
        right: paneRect.right,
        bottom: paneRect.bottom,
        left: paneRect.left,
      },
      cornerRadii: {
        topLeft: style?.borderTopLeftRadius ?? "",
        topRight: style?.borderTopRightRadius ?? "",
        bottomRight: style?.borderBottomRightRadius ?? "",
        bottomLeft: style?.borderBottomLeftRadius ?? "",
      },
      promptInsideViewport:
        Boolean(promptRect) &&
        promptRect!.left >= -1 &&
        promptRect!.right <= globalThis.window.innerWidth + 1 &&
        promptRect!.top >= -1 &&
        promptRect!.bottom <= globalThis.window.innerHeight + 1,
      promptBeforePane: Boolean(promptRect) && promptRect!.bottom <= paneRect.top + 1,
      draft: draft?.value ?? "",
    };
  });

  if (proofDir) {
    await writeFile(join(proofDir, `${label}.json`), `${JSON.stringify(proof, null, 2)}\n`);
    await window.screenshot({ path: join(proofDir, `${label}.png`), fullPage: false });
    const prompt = window.getByTestId("timeline-pinned-prompt");
    if ((await prompt.count()) > 0) {
      await writeFile(join(proofDir, `${label}.aria.yml`), await prompt.ariaSnapshot());
    }
  }
  return proof;
}

async function writeProofJson(
  proofDir: string | undefined,
  name: string,
  value: unknown,
): Promise<void> {
  if (proofDir) {
    await writeFile(join(proofDir, name), `${JSON.stringify(value, null, 2)}\n`);
  }
}

async function scrollToTurn(window: Page, turn: number): Promise<void> {
  const pane = window.getByTestId("timeline-pane");
  const bounds = await pane.boundingBox();
  if (!bounds) throw new Error("Expected visible timeline pane");
  await pane.focus();
  if (turn === 0) {
    await pane.press("Home");
  } else {
    await window.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + Math.min(120, bounds.height / 2),
    );
    const expected = `PROMPT ${turn} unique-marker-${turn}`;
    for (let step = 0; step < 100; step += 1) {
      const text =
        (await window.getByTestId("timeline-pinned-prompt").getAttribute("data-prompt-text")) ?? "";
      if (text.startsWith(expected)) break;
      await window.mouse.wheel(0, 300);
    }
  }
  await expect(window.getByTestId("timeline-pinned-prompt")).toHaveAttribute(
    "data-prompt-text",
    new RegExp(`^PROMPT ${turn} unique-marker-${turn}`),
  );
  // Let already-queued wheel input flush before the caller freezes the current
  // scroll position for a streaming or search assertion.
  await window.waitForTimeout(400);
}

test("contextual prompt follows six virtualized turns across scroll, search, switching and reload", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(150_000);
  const proofDir = process.env.PI_APP_CONTEXT_RAIL_PROOF_DIR?.trim();
  if (proofDir) await mkdir(proofDir, { recursive: true });

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("context-rail-workspace");

  const setupRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  let firstRef: { workspaceId: string; sessionId: string } | null = null;
  let secondRef: { workspaceId: string; sessionId: string } | null = null;
  let setupCleanup: Awaited<ReturnType<typeof setupRun.close>> | null = null;
  try {
    const window = await setupRun.firstWindow();
    const identity = await setupRun.inspectIdentity();
    await writeProofJson(proofDir, "setup-process.json", identity);
    await info.attach("setup-process", {
      body: Buffer.from(JSON.stringify(identity, null, 2)),
      contentType: "application/json",
    });
    await createNamedThread(window, "Context rail A");
    let state = await getDesktopState(window);
    firstRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };
    await waitForSelectedSessionReady(window, firstRef);

    await createNamedThread(window, "Context rail B");
    state = await getDesktopState(window);
    secondRef = {
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    };
    await waitForSelectedSessionReady(window, secondRef);
  } finally {
    setupCleanup = await setupRun.close();
  }
  await writeProofJson(proofDir, "setup-cleanup.json", setupCleanup);
  await info.attach("setup-cleanup", {
    body: Buffer.from(JSON.stringify(setupCleanup, null, 2)),
    contentType: "application/json",
  });
  expect(firstRef).not.toBeNull();
  expect(secondRef).not.toBeNull();

  const firstSessionFile = await sessionFilePathFromCatalog(userDataDir, firstRef!);
  const firstMessages = Array.from({ length: TURN_COUNT }, (_, turn) => {
    const turnStart = Date.parse("2026-10-31T00:00:00.000Z") + turn * 60_000;
    return [
      {
        role: "user" as const,
        text: turn === 0 ? LONG_PROMPT : `PROMPT ${turn} unique-marker-${turn}`,
        timestampMs: turnStart,
      },
      {
        role: "assistant" as const,
        text: `Answer for turn ${turn}. ${"padding paragraph ".repeat(150)}`,
        timestampMs: turnStart + 8_000,
      },
    ];
  }).flat();
  await appendMessagesToSessionFile(firstSessionFile, firstMessages);

  const secondSessionFile = await sessionFilePathFromCatalog(userDataDir, secondRef!);
  await appendMessagesToSessionFile(secondSessionFile, [
    {
      role: "user",
      text: "PROMPT B unique-thread-B",
      timestampMs: Date.parse("2026-10-31T01:00:00.000Z"),
    },
    {
      role: "assistant",
      text: "Answer B. ".repeat(80),
      timestampMs: Date.parse("2026-10-31T01:00:08.000Z"),
    },
  ]);

  const run = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  let runCleanup: Awaited<ReturnType<typeof run.close>> | null = null;
  try {
    const window = await run.firstWindow();
    const identity = await run.inspectIdentity();
    await writeProofJson(proofDir, "acceptance-process.json", identity);
    await info.attach("acceptance-process", {
      body: Buffer.from(JSON.stringify(identity, null, 2)),
      contentType: "application/json",
    });
    await setWindowSize(run, window, WIDE_WINDOW);
    await waitForWorkspaceByPath(window, workspacePath);
    await selectSession(window, "Context rail A");
    await waitForSelectedSessionReady(window, firstRef!);
    await expect(window.getByTestId("timeline-pinned-prompt")).toHaveAttribute(
      "data-prompt-text",
      /^PROMPT 5 unique-marker-5/,
      { timeout: 30_000 },
    );

    await expect(window.getByTestId("timeline-turn-marker").first()).toContainText(
      "Worked for 8s",
      {
        timeout: 10_000,
      },
    );
    await expect(window.getByRole("button", { name: /prompt navigation/i })).toHaveCount(0);
    expect(await window.locator("[data-message-id]").count()).toBeLessThan(30);

    const anchors: Array<{ readonly id: string; readonly text: string; readonly rowId: string }> =
      [];
    for (let turn = 0; turn < TURN_COUNT; turn += 1) {
      await scrollToTurn(window, turn);
      const prompt = window.getByTestId("timeline-pinned-prompt");
      anchors.push({
        id: (await prompt.getAttribute("data-prompt-id")) ?? "",
        text: (await prompt.getAttribute("data-prompt-text")) ?? "",
        rowId: (await prompt.getAttribute("data-prompt-row-id")) ?? "",
      });
      expect(await window.locator("[data-message-id]").count()).toBeLessThan(30);
    }
    expect(new Set(anchors.map(({ id }) => id)).size).toBe(TURN_COUNT);
    expect(
      anchors.every(({ id, rowId, text }, index) =>
        Boolean(id && rowId && text.includes(`PROMPT ${index}`)),
      ),
    ).toBe(true);

    const prompt = window.getByTestId("timeline-pinned-prompt");
    await expect
      .poll(() =>
        prompt.evaluate((element) => {
          const style = getComputedStyle(element);
          return [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ];
        }),
      )
      .toEqual(["14px", "14px", "14px", "14px"]);

    await scrollToTurn(window, 0);
    const overflow = await prompt.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
    await prompt.focus();
    await expect(prompt).toBeFocused();
    await prompt.press("End");
    await expect.poll(() => prompt.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await prompt.press("Home");
    await expect.poll(() => prompt.evaluate((element) => element.scrollLeft)).toBe(0);
    await prompt.hover();
    await window.mouse.wheel(500, 0);
    await expect.poll(() => prompt.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    if (proofDir) {
      await window.screenshot({
        path: join(proofDir, "wide-prompt-horizontal.png"),
        fullPage: false,
      });
    }
    await prompt.press("Tab");
    await expect(prompt).not.toBeFocused();
    await prompt.evaluate((element) => {
      element.scrollLeft = 0;
    });

    const wideProof = await captureContextRail(window, proofDir, "wide-prompt");
    expect(wideProof.promptId).toBe(anchors[0]!.id);
    expect(wideProof.promptText).toContain("PROMPT 0 unique-marker-0");
    expect(wideProof.promptRowId).toBe(anchors[0]!.rowId);
    expect(wideProof.visibleRows.length).toBeGreaterThan(0);
    expect(wideProof.promptInsideViewport).toBe(true);
    expect(wideProof.promptBeforePane).toBe(true);
    expect(wideProof.draft).toBe("");

    await setWindowSize(run, window, NARROW_WINDOW);
    const narrowProof = await captureContextRail(window, proofDir, "narrow-prompt");
    expect(narrowProof.promptInsideViewport).toBe(true);
    expect(narrowProof.promptBeforePane).toBe(true);
    expect(narrowProof.cornerRadii).toEqual(wideProof.cornerRadii);

    await setZoom(run, 2);
    const zoomProof = await captureContextRail(window, proofDir, "zoom-prompt");
    expect(zoomProof.promptInsideViewport).toBe(true);
    expect(zoomProof.promptBeforePane).toBe(true);
    await setZoom(run, 1);
    await setWindowSize(run, window, WIDE_WINDOW);

    const draft = "DRAFT_PRESERVED_CONTEXT_RAIL";
    await window.getByTestId("composer").fill(draft);
    await scrollToTurn(window, 4);
    const beforeStream = await captureContextRail(window, undefined, "before-stream");
    await streamAssistantDeltas(run, window, ["STREAMED_AFTER_CONTEXT_ANCHOR"]);
    await expect(window.getByTestId("timeline-pinned-prompt")).toHaveAttribute(
      "data-prompt-id",
      beforeStream.promptId!,
    );
    await expect(window.getByTestId("composer")).toHaveValue(draft);
    await expect
      .poll(async () => (await getTimelineScrollMetrics(window)).scrollTop)
      .toBeCloseTo(beforeStream.scrollTop, 0);

    await window.keyboard.press(desktopShortcut("f"));
    const search = window.getByPlaceholder("Search thread...");
    await search.fill("unique-marker-4");
    await expect(window.locator("mark.thread-find-active")).toBeVisible();
    await expect(prompt).toHaveAttribute("data-prompt-text", /^PROMPT 4 unique-marker-4/, {
      timeout: 15_000,
    });
    await search.press("Escape");
    await expect(search).toHaveCount(0);

    await selectSession(window, "Context rail B");
    await expect(window.getByTestId("timeline-pinned-prompt")).toHaveAttribute(
      "data-prompt-text",
      "PROMPT B unique-thread-B",
    );
    await selectSession(window, "Context rail A");
    await expect(window.getByTestId("composer")).toHaveValue(draft);
    await expect(prompt).toHaveAttribute("data-prompt-row-id", /.+/);
    await expect
      .poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom)
      .toBeGreaterThan(2);

    await createNamedThread(window, "Context rail empty");
    await expect(window.getByTestId("timeline-context-rail")).toHaveCount(0);
    await expect(window.getByTestId("timeline-pinned-prompt")).toHaveCount(0);
    if (proofDir) {
      await writeFile(
        join(proofDir, "no-prompt.json"),
        `${JSON.stringify(
          await window.evaluate(() => ({
            railCount: document.querySelectorAll('[data-testid="timeline-context-rail"]').length,
            promptCount: document.querySelectorAll('[data-testid="timeline-pinned-prompt"]').length,
            panePresent: Boolean(document.querySelector('[data-testid="timeline-pane"]')),
          })),
          null,
          2,
        )}\n`,
      );
      await window.screenshot({ path: join(proofDir, "no-prompt.png"), fullPage: false });
    }

    await info.attach("context-rail-anchors", {
      body: Buffer.from(JSON.stringify(anchors, null, 2)),
      contentType: "application/json",
    });
  } finally {
    runCleanup = await run.close();
  }
  await writeProofJson(proofDir, "acceptance-cleanup.json", runCleanup);
  await info.attach("acceptance-cleanup", {
    body: Buffer.from(JSON.stringify(runCleanup, null, 2)),
    contentType: "application/json",
  });

  const reload = await launchDesktop(userDataDir, { testMode: "background" });
  let reloadCleanup: Awaited<ReturnType<typeof reload.close>> | null = null;
  try {
    const window = await reload.firstWindow();
    const identity = await reload.inspectIdentity();
    await writeProofJson(proofDir, "reload-process.json", identity);
    await info.attach("reload-process", {
      body: Buffer.from(JSON.stringify(identity, null, 2)),
      contentType: "application/json",
    });
    await setWindowSize(reload, window, WIDE_WINDOW);
    await waitForWorkspaceByPath(window, workspacePath);
    await selectSession(window, "Context rail A");
    await waitForSelectedSessionReady(window, firstRef!);
    await expect(window.getByTestId("timeline-pinned-prompt")).toHaveAttribute(
      "data-prompt-text",
      /^PROMPT 5 unique-marker-5/,
    );
    await captureContextRail(window, proofDir, "reload-latest");
  } finally {
    reloadCleanup = await reload.close();
  }
  await writeProofJson(proofDir, "reload-cleanup.json", reloadCleanup);
  await info.attach("reload-cleanup", {
    body: Buffer.from(JSON.stringify(reloadCleanup, null, 2)),
    contentType: "application/json",
  });
});
