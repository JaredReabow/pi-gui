import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { SessionRef } from "@pi-gui/session-driver";
import type { SessionDriverEvent, SessionSnapshot } from "@pi-gui/session-driver";
import {
  chooseThreadGrouping,
  createSessionViaIpc,
  desktopShortcut,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  persistedSessionDataPaths,
  waitForWorkspaceByPath,
  type DesktopHarness,
} from "../helpers/electron-app";
import { appendMessagesToSessionFile, sessionFilePathFromCatalog } from "../helpers/session-file";
import { sidebarPreferences_markReadLimit } from "../../contracts/sidebar-preferences";
import { desktopIpc } from "../../contracts/ipc";

type FolderPreference = "open" | "partial" | "closed";
type ChildStatus = "queued" | "running" | "waiting" | "complete" | "failed" | "cancelled";

type PersistedChild = {
  readonly id: string;
  readonly sourceToolCallId?: string;
  readonly origin?: {
    readonly kind: "child-thread";
    readonly source: "desktop-host";
    readonly parentWorkspaceId: string;
    readonly parentSessionId: string;
    readonly sourceToolCallId?: string;
  };
  readonly selectedConfig?: {
    readonly provider: string;
    readonly modelId: string;
  };
  readonly parentWorkspaceId: string;
  readonly parentSessionId: string;
  readonly childWorkspaceId: string;
  readonly childSessionId: string;
  readonly title: string;
  readonly goal: string;
  readonly status: ChildStatus;
  readonly latestTranscript: string;
  readonly transcript: readonly unknown[];
  readonly evidence: readonly unknown[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

type PersistedSidebarState = Record<string, unknown> & {
  readonly lastViewedAtBySession?: Record<string, string>;
  readonly lastInteractedAtBySession?: Record<string, string>;
  readonly createdAtBySession?: Record<string, string>;
  readonly initiatingOriginBySession?: Record<
    string,
    { readonly kind: "human" | "tool" | "scheduled"; readonly source: "desktop-host" }
  >;
  readonly folderPreferencesByWorkspace?: Record<string, FolderPreference>;
  readonly orchestrationChildren?: readonly PersistedChild[];
};

interface PersistedSessionCatalog {
  readonly version: number;
  readonly workspaces: readonly unknown[];
  readonly worktrees: readonly unknown[];
  readonly sessions: Array<Record<string, unknown> & { readonly sessionRef: SessionRef }>;
  readonly sessionFiles: Record<string, string>;
}

interface MarkReadCapture {
  readonly batches: readonly (readonly string[])[];
  readonly starts: readonly (readonly string[])[];
  readonly finishes: readonly (readonly string[])[];
  readonly errors: readonly string[];
  readonly invokeCount: number;
}

function refKey(ref: SessionRef): string {
  return `${ref.workspaceId}:${ref.sessionId}`;
}

function refsByTitle(
  state: Awaited<ReturnType<typeof getDesktopState>>,
): ReadonlyMap<string, SessionRef> {
  return new Map(
    state.workspaces.flatMap((workspace) =>
      workspace.sessions.map(
        (session) => [session.title, { workspaceId: workspace.id, sessionId: session.id }] as const,
      ),
    ),
  );
}

async function createSessions(
  window: Page,
  workspacePath: string,
  titles: readonly string[],
): Promise<void> {
  for (const title of titles) {
    await createSessionViaIpc(window, workspacePath, title);
  }
}

async function setFolderPreference(
  window: Page,
  workspaceId: string,
  preference: FolderPreference,
): Promise<void> {
  await window.evaluate(
    async ({ id, state }) => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.setFolderPreference(id, state);
      await app.setWorkspaceCollapsed(id, state === "closed");
    },
    { id: workspaceId, state: preference },
  );
}

async function updateUiState(
  userDataDir: string,
  update: (state: PersistedSidebarState) => PersistedSidebarState,
): Promise<void> {
  const path = join(userDataDir, "ui-state.json");
  const state = JSON.parse(await readFile(path, "utf8")) as PersistedSidebarState;
  await writeFile(path, `${JSON.stringify(update(state), null, 2)}\n`, "utf8");
}

async function markSessionUnread(
  userDataDir: string,
  ref: SessionRef,
  text: string,
  timestampMs: number,
): Promise<void> {
  await appendMessagesToSessionFile(await sessionFilePathFromCatalog(userDataDir, ref), [
    { role: "assistant", text, timestampMs },
  ]);
  await updateUiState(userDataDir, (state) => {
    const key = persistedSessionDataPaths(userDataDir, ref).rawSessionKey;
    return {
      ...state,
      lastViewedAtBySession: {
        ...(state.lastViewedAtBySession ?? {}),
        [key]: new Date(timestampMs - 1_000).toISOString(),
      },
    };
  });
}

async function seedLargeUnreadSessions(
  userDataDir: string,
  baseRef: SessionRef,
  count: number,
): Promise<readonly SessionRef[]> {
  const catalogsPath = join(userDataDir, "catalogs.json");
  const catalogs = JSON.parse(await readFile(catalogsPath, "utf8")) as PersistedSessionCatalog;
  const base = catalogs.sessions.find((session) => refKey(session.sessionRef) === refKey(baseRef));
  if (!base) throw new Error(`Missing base catalog session ${refKey(baseRef)}`);
  const baseSessionFilePath =
    (typeof base.sessionFilePath === "string" ? base.sessionFilePath : undefined) ??
    catalogs.sessionFiles[refKey(baseRef)];
  if (!baseSessionFilePath) throw new Error(`Missing base session file ${refKey(baseRef)}`);
  const firstLine = (await readFile(baseSessionFilePath, "utf8"))
    .split("\n")
    .find((line) => line.trim());
  const header = JSON.parse(firstLine ?? "{}") as { readonly type?: string };
  if (header.type !== "session") throw new Error("Base session file has no session header");

  const refs: SessionRef[] = [];
  const baseTimestamp = Date.now() + 60_000;
  for (let index = 0; index < count; index += 1) {
    const sessionId = randomUUID();
    const updatedAt = new Date(baseTimestamp + index * 1_000).toISOString();
    const sessionFilePath = join(
      dirname(baseSessionFilePath),
      `${updatedAt.replaceAll(":", "-")}_${sessionId}.jsonl`,
    );
    const ref = { workspaceId: base.sessionRef.workspaceId, sessionId };
    const title = `Large unread ${String(index + 1).padStart(3, "0")}`;
    await writeFile(
      sessionFilePath,
      `${JSON.stringify({ ...header, id: sessionId, timestamp: updatedAt })}\n`,
      "utf8",
    );
    catalogs.sessions.push({
      ...base,
      sessionRef: ref,
      workspaceId: ref.workspaceId,
      title,
      updatedAt,
      sessionFilePath,
      previewSnippet: "(no messages)",
    });
    catalogs.sessionFiles[refKey(ref)] = sessionFilePath;
    refs.push(ref);
  }
  await writeFile(catalogsPath, `${JSON.stringify(catalogs, null, 2)}\n`, "utf8");

  const unreadBefore = "2000-01-01T00:00:00.000Z";
  await updateUiState(userDataDir, (state) => ({
    ...state,
    lastViewedAtBySession: {
      ...(state.lastViewedAtBySession ?? {}),
      ...Object.fromEntries(refs.map((ref) => [refKey(ref), unreadBefore])),
    },
  }));
  return refs;
}

async function setLargeSessionsUnread(
  userDataDir: string,
  refs: readonly SessionRef[],
  readRefs: readonly SessionRef[] = [],
): Promise<void> {
  const unreadBefore = "2000-01-01T00:00:00.000Z";
  const readAfter = new Date(Date.now() + 86_400_000).toISOString();
  await updateUiState(userDataDir, (state) => {
    const lastViewedAtBySession = { ...(state.lastViewedAtBySession ?? {}) };
    for (const ref of refs) lastViewedAtBySession[refKey(ref)] = unreadBefore;
    for (const ref of readRefs) lastViewedAtBySession[refKey(ref)] = readAfter;
    return { ...state, lastViewedAtBySession };
  });
}

async function installMarkReadCapture(
  harness: DesktopHarness,
  options: {
    readonly holdFirstBatch?: boolean;
    readonly failAfterBatch?: number;
  } = {},
): Promise<void> {
  await harness.electronApp.evaluate(
    ({ ipcMain }, payload) => {
      type InvokeHandler = (event: unknown, ...args: unknown[]) => unknown;
      type Capture = {
        readonly batches: string[][];
        readonly starts: string[][];
        readonly finishes: string[][];
        readonly errors: string[];
        readonly original: InvokeHandler;
        holdFirstBatch: boolean;
        failAfterBatch?: number;
      };
      const invokeHandlers = (
        ipcMain as typeof ipcMain & { readonly _invokeHandlers?: Map<string, InvokeHandler> }
      )._invokeHandlers;
      const original = invokeHandlers?.get(payload.channel);
      if (!original) throw new Error(`No IPC handler registered for ${payload.channel}`);
      const store = globalThis as typeof globalThis & {
        __PI_D1_MARK_READ_CAPTURE__?: Record<string, Capture>;
      };
      const releaseStore = globalThis as typeof globalThis & {
        __PI_D1_MARK_READ_RELEASE__?: Record<string, (() => void) | undefined>;
      };
      store.__PI_D1_MARK_READ_CAPTURE__ ??= {};
      releaseStore.__PI_D1_MARK_READ_RELEASE__ ??= {};
      if (store.__PI_D1_MARK_READ_CAPTURE__[payload.channel]) {
        throw new Error("Mark-read capture is already installed");
      }
      const capture: Capture = {
        batches: [],
        starts: [],
        finishes: [],
        errors: [],
        original,
        holdFirstBatch: payload.holdFirstBatch,
        failAfterBatch: payload.failAfterBatch,
      };
      store.__PI_D1_MARK_READ_CAPTURE__[payload.channel] = capture;
      ipcMain.removeHandler(payload.channel);
      ipcMain.handle(payload.channel, async (event, input: unknown) => {
        const record =
          input && typeof input === "object" ? (input as Record<string, unknown>) : undefined;
        const targets: readonly unknown[] = Array.isArray(record?.targets) ? record.targets : [];
        const ids = targets.map((target: unknown) =>
          target && typeof target === "object" && "sessionId" in target
            ? (target as Record<string, unknown>).sessionId
            : "<invalid>",
        ) as string[];
        capture.batches.push(ids);
        capture.starts.push(ids);
        if (capture.starts.length === 1 && capture.holdFirstBatch) {
          await new Promise<void>((resolve) => {
            releaseStore.__PI_D1_MARK_READ_RELEASE__![payload.channel] = resolve;
          });
          delete releaseStore.__PI_D1_MARK_READ_RELEASE__![payload.channel];
        }
        if (
          capture.failAfterBatch !== undefined &&
          capture.starts.length > capture.failAfterBatch
        ) {
          const message = "Injected sidebar partial failure";
          capture.errors.push(message);
          throw new Error(message);
        }
        const state = await capture.original(event, input);
        capture.finishes.push(ids);
        return state;
      });
    },
    {
      channel: desktopIpc.markAllThreadsRead,
      holdFirstBatch: options.holdFirstBatch ?? false,
      failAfterBatch: options.failAfterBatch,
    },
  );
}

async function releaseMarkReadCapture(harness: DesktopHarness): Promise<void> {
  await harness.electronApp.evaluate((_electron, channel) => {
    const store = globalThis as typeof globalThis & {
      __PI_D1_MARK_READ_RELEASE__?: Record<string, (() => void) | undefined>;
    };
    const release = store.__PI_D1_MARK_READ_RELEASE__?.[channel];
    if (!release) throw new Error(`Mark-read capture is not waiting: ${channel}`);
    release();
  }, desktopIpc.markAllThreadsRead);
}

async function readMarkReadCapture(harness: DesktopHarness): Promise<MarkReadCapture> {
  return harness.electronApp.evaluate((_electron, channel) => {
    type Capture = {
      readonly batches: string[][];
      readonly starts: string[][];
      readonly finishes: string[][];
      readonly errors: string[];
    };
    const store = globalThis as typeof globalThis & {
      __PI_D1_MARK_READ_CAPTURE__?: Record<string, Capture>;
    };
    const capture = store.__PI_D1_MARK_READ_CAPTURE__?.[channel];
    if (!capture) throw new Error(`No mark-read capture installed for ${channel}`);
    return {
      batches: capture.batches,
      starts: capture.starts,
      finishes: capture.finishes,
      errors: capture.errors,
      invokeCount: capture.starts.length,
    };
  }, desktopIpc.markAllThreadsRead);
}

function childRecord(input: {
  readonly id: string;
  readonly parent: SessionRef;
  readonly child: SessionRef;
  readonly title: string;
  readonly status: ChildStatus;
  readonly origin: "human" | "tool" | "unknown";
  readonly createdAt: string;
  readonly modelId?: string;
}): PersistedChild {
  const sourceToolCallId = input.origin === "tool" ? `tool:${input.id}` : undefined;
  return {
    id: input.id,
    ...(sourceToolCallId ? { sourceToolCallId } : {}),
    ...(input.origin === "unknown"
      ? {}
      : {
          origin: {
            kind: "child-thread" as const,
            source: "desktop-host" as const,
            parentWorkspaceId: input.parent.workspaceId,
            parentSessionId: input.parent.sessionId,
            ...(sourceToolCallId ? { sourceToolCallId } : {}),
          },
        }),
    selectedConfig: {
      provider: "provider-a",
      modelId: input.modelId ?? "model-a",
    },
    parentWorkspaceId: input.parent.workspaceId,
    parentSessionId: input.parent.sessionId,
    childWorkspaceId: input.child.workspaceId,
    childSessionId: input.child.sessionId,
    title: input.title,
    goal: input.title,
    status: input.status,
    latestTranscript: input.title,
    transcript: [],
    evidence: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

async function emitChildOutcome(
  harness: DesktopHarness,
  state: Awaited<ReturnType<typeof getDesktopState>>,
  ref: SessionRef,
  status: ChildStatus,
): Promise<void> {
  if (status === "queued") return;
  const workspace = state.workspaces.find((entry) => entry.id === ref.workspaceId);
  const session = workspace?.sessions.find((entry) => entry.id === ref.sessionId);
  if (!workspace || !session) throw new Error(`Unknown child session ${refKey(ref)}`);
  const timestamp = new Date().toISOString();
  const runId = `sidebar-status-${session.id}`;
  const snapshot: SessionSnapshot = {
    ref,
    workspace: {
      workspaceId: workspace.id,
      path: workspace.path,
      displayName: workspace.name,
    },
    title: session.title,
    status:
      status === "failed"
        ? "failed"
        : status === "running" || status === "waiting"
          ? "running"
          : "idle",
    updatedAt: timestamp,
    preview: `Sidebar ${status} fixture`,
    ...(status === "running" || status === "waiting" ? { runningRunId: runId } : {}),
    ...(status === "waiting"
      ? {
          queuedMessages: [
            {
              id: `queued-${session.id}`,
              mode: "followUp" as const,
              text: "Waiting fixture",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        }
      : {}),
    ...(status === "complete" ? { lastRunOutcome: "completed" as const } : {}),
    ...(status === "cancelled" ? { lastRunOutcome: "stopped" as const } : {}),
  };

  if (status === "failed") {
    await emitTestSessionEvent(harness, {
      type: "runFailed",
      sessionRef: ref,
      timestamp,
      runId,
      error: { message: "Sidebar failure fixture" },
    });
    return;
  }
  if (status === "running" || status === "waiting") {
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef: ref,
      timestamp,
      runId,
      snapshot,
    });
    return;
  }
  await emitTestSessionEvent(harness, {
    type: "sessionUpdated",
    sessionRef: ref,
    timestamp,
    runId,
    snapshot: { ...snapshot, status: "running", lastRunOutcome: undefined },
  });
  await emitTestSessionEvent(harness, {
    type: "assistantDelta",
    sessionRef: ref,
    timestamp: new Date(Date.now() + 1).toISOString(),
    runId,
    text: `Sidebar ${status} response`,
  });
  await emitTestSessionEvent(harness, {
    type: "runCompleted",
    sessionRef: ref,
    timestamp: new Date(Date.now() + 2).toISOString(),
    runId,
    snapshot,
  });
}

async function captureSidebarEvidence(
  window: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const outputDirectory = testInfo.outputPath("sidebar-evidence");
  await mkdir(outputDirectory, { recursive: true });
  const sidebar = window.locator(".sidebar");
  await sidebar.screenshot({ path: join(outputDirectory, `${label}.png`) });
  const aria = await sidebar.ariaSnapshot();
  await writeFile(join(outputDirectory, `${label}.aria.yml`), `${aria}\n`, "utf8");
  const bounds = await sidebar.evaluate((element) => {
    const sidebarRect = element.getBoundingClientRect();
    const selectors = [
      ".section__head",
      ".all-threads__head",
      ".workspace-row",
      ".session-row",
      ".session-row__select",
      ".session-row__trailing",
      ".thread-history-toggle",
      ".archived-thread-group__toggle",
    ];
    const elements = [...element.querySelectorAll<HTMLElement>(selectors.join(","))].map(
      (candidate) => {
        const rect = candidate.getBoundingClientRect();
        return {
          selector: candidate.className,
          text: candidate.textContent?.trim().slice(0, 120) ?? "",
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          clientWidth: candidate.clientWidth,
          scrollWidth: candidate.scrollWidth,
        };
      },
    );
    const rows = [...element.querySelectorAll<HTMLElement>(".session-row")].map((row) => {
      const select = row
        .querySelector<HTMLElement>(".session-row__select")
        ?.getBoundingClientRect();
      const trailing = row
        .querySelector<HTMLElement>(".session-row__trailing")
        ?.getBoundingClientRect();
      return {
        sessionId: row.dataset.sessionId,
        left: row.getBoundingClientRect().left,
        right: row.getBoundingClientRect().right,
        selectRight: select?.right,
        trailingLeft: trailing?.left,
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      sidebar: {
        left: sidebarRect.left,
        top: sidebarRect.top,
        right: sidebarRect.right,
        bottom: sidebarRect.bottom,
        width: sidebarRect.width,
        height: sidebarRect.height,
      },
      elements,
      rows,
    };
  });
  await writeFile(
    join(outputDirectory, `${label}.bounds.json`),
    `${JSON.stringify(bounds, null, 2)}\n`,
    "utf8",
  );
  expect(bounds.sidebar.width).toBeGreaterThan(0);
  expect(bounds.sidebar.height).toBeGreaterThan(0);
  for (const element of bounds.elements) {
    expect(element.left).toBeGreaterThanOrEqual(bounds.sidebar.left - 1);
    expect(element.right).toBeLessThanOrEqual(bounds.sidebar.right + 1);
  }
  for (const row of bounds.rows) {
    if (row.selectRight !== undefined && row.trailingLeft !== undefined) {
      expect(row.selectRight).toBeLessThanOrEqual(row.trailingLeft + 1);
    }
  }
}

async function closeHarness(
  harness: DesktopHarness,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const pid = harness.electronApp.process()?.pid ?? null;
  const cleanup = await harness.close();
  const outputDirectory = testInfo.outputPath("processes");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, `${label}.json`),
    `${JSON.stringify({ pid, cleanup }, null, 2)}\n`,
    "utf8",
  );
}

test("folder states preserve unread reveal and complete trees across pushes and restart", async ({}, testInfo) => {
  test.setTimeout(150_000);
  const userDataDir = await makeUserDataDir("sidebar-parity-folders-");
  const alphaPath = await makeWorkspace("sidebar-parity-folders-alpha");
  const betaPath = await makeWorkspace("sidebar-parity-folders-beta");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [alphaPath, betaPath],
    testMode: "background",
  });
  let alphaId = "";
  let betaId = "";
  let refs = new Map<string, SessionRef>();

  try {
    const window = await firstRun.firstWindow();
    alphaId = (await waitForWorkspaceByPath(window, alphaPath)).id;
    betaId = (await waitForWorkspaceByPath(window, betaPath)).id;
    await createSessions(
      window,
      alphaPath,
      Array.from({ length: 9 }, (_, index) => `Folder thread ${index}`),
    );
    await createSessions(window, betaPath, ["Other project thread"]);
    refs = refsByTitle(await getDesktopState(window));
    await setFolderPreference(window, alphaId, "partial");
  } finally {
    await closeHarness(firstRun, testInfo, "folders-initial");
  }

  const alpha = Array.from({ length: 9 }, (_, index) => refs.get(`Folder thread ${index}`)!);
  await updateUiState(userDataDir, (state) => ({
    ...state,
    orchestrationChildren: [
      childRecord({
        id: "folder-root-child",
        parent: alpha[0]!,
        child: alpha[1]!,
        title: "Folder thread 1",
        status: "complete",
        origin: "human",
        createdAt: "2026-10-01T00:00:00.000Z",
      }),
      childRecord({
        id: "folder-root-grandchild",
        parent: alpha[1]!,
        child: alpha[2]!,
        title: "Folder thread 2",
        status: "cancelled",
        origin: "tool",
        createdAt: "2026-10-01T00:01:00.000Z",
      }),
    ],
  }));
  await markSessionUnread(userDataDir, alpha[1]!, "Nested unread reveal", Date.now() + 60_000);

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await waitForWorkspaceByPath(window, betaPath);
    await chooseThreadGrouping(window, "workspace");
    const alphaGroup = window.locator(`.workspace-group[data-workspace-id="${alphaId}"]`);
    const folderRow = alphaGroup.locator(".workspace-row__select");
    await expect(folderRow).toHaveAttribute("data-folder-preference", "partial");
    await expect(alphaGroup.locator(".session-row")).toHaveCount(8);
    const nestedFolderTree = alphaGroup.locator(
      `.session-tree__children[data-parent-session-id="${alpha[0]!.sessionId}"]`,
    );
    await expect(nestedFolderTree).toContainText("Folder thread 1");
    await expect(nestedFolderTree).toContainText("Folder thread 2");

    await alphaGroup.getByRole("button", { name: /^Show more / }).click();
    await expect(alphaGroup.locator(".session-row")).toHaveCount(9);
    await expect(folderRow).toHaveAttribute("data-folder-preference", "partial");
    await alphaGroup.getByRole("button", { name: /^Show less / }).click();

    await window.evaluate(async (ref) => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.selectSession(ref);
    }, refs.get("Other project thread")!);
    await setFolderPreference(window, alphaId, "closed");
    await expect(folderRow).toHaveAttribute("data-folder-preference", "closed");
    await expect(folderRow).toHaveAttribute("data-folder-state", "partial");
    await expect(alphaGroup.locator(".session-row")).toHaveCount(3);
    await expect
      .poll(async () => (await getDesktopState(window)).folderPreferencesByWorkspace?.[alphaId])
      .toBe("closed");

    await alphaGroup.getByRole("button", { name: /^Show more / }).click();
    await expect(alphaGroup.locator(".session-row")).toHaveCount(9);
    await expect(folderRow).toHaveAttribute("data-folder-preference", "closed");
    await alphaGroup.getByRole("button", { name: /^Show less / }).click();
    await expect(alphaGroup.locator(".session-row")).toHaveCount(3);
    await expect
      .poll(async () => (await getDesktopState(window)).folderPreferencesByWorkspace?.[alphaId])
      .toBe("closed");
    await captureSidebarEvidence(window, testInfo, "folders-closed-reveal");
  } finally {
    await closeHarness(secondRun, testInfo, "folders-closed");
  }

  const thirdRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await thirdRun.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    const group = window.locator(`.workspace-group[data-workspace-id="${alphaId}"]`);
    await expect(group.locator(".workspace-row__select")).toHaveAttribute(
      "data-folder-preference",
      "closed",
    );
    await expect(group.locator(".session-row")).toHaveCount(3);

    await group.getByRole("button", { name: "Workspace actions for" }).click();
    await group.getByTestId("folder-state-open").click();
    await expect(group.locator(".workspace-row__select")).toHaveAttribute(
      "data-folder-preference",
      "open",
    );
    await expect(group.locator(".session-row")).toHaveCount(9);
    await group.getByRole("button", { name: "Workspace actions for" }).click();
    await group.getByTestId("folder-state-partial").click();
    await expect(group.locator(".workspace-row__select")).toHaveAttribute(
      "data-folder-preference",
      "partial",
    );
    expect(betaId).not.toBe("");
  } finally {
    await closeHarness(thirdRun, testInfo, "folders-restart");
  }
});

test("five All Threads sorts are deterministic and keyboard order matches narrow and wide layouts", async ({}, testInfo) => {
  test.setTimeout(150_000);
  const userDataDir = await makeUserDataDir("sidebar-parity-sort-");
  const workspacePath = await makeWorkspace("sidebar-parity-sort");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  let refs = new Map<string, SessionRef>();

  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessions(window, workspacePath, [
      "Alpha",
      "Bravo",
      "Charlie",
      "Legacy",
      "Tie A",
      "Tie B",
    ]);
    refs = refsByTitle(await getDesktopState(window));
  } finally {
    await closeHarness(firstRun, testInfo, "sorts-initial");
  }

  const activityAt = {
    Charlie: "2026-10-06T10:00:00.000Z",
    Alpha: "2026-10-05T10:00:00.000Z",
    Bravo: "2026-10-04T10:00:00.000Z",
    Legacy: "2026-10-10T10:00:00.000Z",
    "Tie A": "2026-10-02T10:00:00.000Z",
    "Tie B": "2026-10-02T10:00:00.000Z",
  } as const;

  await updateUiState(userDataDir, (state) => ({
    ...state,
    allThreadsSort: "title",
    createdAtBySession: {
      ...(state.createdAtBySession ?? {}),
      [refKey(refs.get("Legacy")!)]: "2026-10-09T00:00:00.000Z",
      [refKey(refs.get("Bravo")!)]: "2026-10-08T00:00:00.000Z",
      [refKey(refs.get("Alpha")!)]: "2026-10-07T00:00:00.000Z",
      [refKey(refs.get("Tie A")!)]: "2026-10-06T00:00:00.000Z",
      [refKey(refs.get("Tie B")!)]: "2026-10-06T00:00:00.000Z",
    },
    lastInteractedAtBySession: {
      ...(state.lastInteractedAtBySession ?? {}),
      [refKey(refs.get("Legacy")!)]: "2026-10-10T00:00:00.000Z",
      [refKey(refs.get("Charlie")!)]: "2026-10-09T00:00:00.000Z",
      [refKey(refs.get("Bravo")!)]: "2026-10-08T00:00:00.000Z",
      [refKey(refs.get("Alpha")!)]: "2026-10-07T00:00:00.000Z",
    },
  }));
  await markSessionUnread(
    userDataDir,
    refs.get("Legacy")!,
    "Legacy unread timestamp",
    Date.now() + 60_000,
  );
  // catalogs.json is a derived cache. Seed the production activity source:
  // session messages. Pi derives the session's modified time from the latest
  // persisted message, so this exercises the real loader after relaunch.
  for (const [title, timestamp] of Object.entries(activityAt)) {
    if (title === "Legacy") continue;
    await appendMessagesToSessionFile(
      await sessionFilePathFromCatalog(userDataDir, refs.get(title)!),
      [
        {
          role: "assistant",
          text: `${title} activity`,
          timestampMs: Date.parse(timestamp),
        },
      ],
    );
  }
  await updateUiState(userDataDir, (state) => {
    const createdAtBySession = { ...(state.createdAtBySession ?? {}) };
    delete createdAtBySession[refKey(refs.get("Charlie")!)];
    return { ...state, createdAtBySession };
  });

  const expected: Record<string, readonly string[]> = {
    activity: ["Legacy", "Charlie", "Alpha", "Bravo", "Tie A", "Tie B"],
    "latest-human-input": ["Legacy", "Charlie", "Bravo", "Alpha", "Tie A", "Tie B"],
    "unread-first": ["Legacy", "Charlie", "Alpha", "Bravo", "Tie A", "Tie B"],
    created: ["Legacy", "Bravo", "Alpha", "Tie A", "Tie B", "Charlie"],
    title: ["Alpha", "Bravo", "Charlie", "Legacy", "Tie A", "Tie B"],
  };

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect
      .poll(
        async () =>
          (await getDesktopState(window)).workspaces.flatMap((workspace) => workspace.sessions)
            .length,
      )
      .toBe(6);
    const allThreads = window.getByTestId("all-threads");
    const select = allThreads.getByRole("combobox", { name: "Sort all threads" });
    for (const [sort, titles] of Object.entries(expected)) {
      await select.selectOption(sort);
      await expect(select).toHaveValue(sort);
      const more = allThreads.getByRole("button", { name: /^Show more / });
      if (await more.count()) await more.click();
      await expect(allThreads.locator(".session-row__title")).toHaveText([...titles]);
    }

    await select.selectOption("created");
    await expect(
      allThreads.locator(`.session-row[data-session-id="${refs.get("Charlie")!.sessionId}"]`),
    ).toHaveAttribute("data-session-created-at", "unknown");

    await select.selectOption("title");
    for (const width of [720, 1440]) {
      await window.setViewportSize({ width, height: 900 });
      await expect(allThreads.locator(".session-row__title")).toHaveText(expected.title!);
      await captureSidebarEvidence(window, testInfo, `sort-title-${width}`);
    }

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await window.keyboard.down(modifier);
    try {
      for (const [index, title] of expected.title!.entries()) {
        await expect(
          window.locator(`[data-thread-shortcut="${index + 1}"] .session-row__title`),
        ).toHaveText(title);
      }
    } finally {
      await window.keyboard.up(modifier);
    }
    await window.keyboard.press(desktopShortcut("1"));
    await expect(window.locator(".chat-header__title")).toHaveText("Alpha");
  } finally {
    await closeHarness(secondRun, testInfo, "sorts-final");
  }
});

test("mark all read drives bounded real IPC, keeps a captured snapshot and reports partial failure", async ({}, testInfo) => {
  test.setTimeout(600_000);
  const userDataDir = await makeUserDataDir("sidebar-parity-mark-read-");
  const workspacePath = await makeWorkspace("sidebar-parity-mark-read");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  let lateRef: SessionRef | undefined;
  let anchorRef: SessionRef | undefined;

  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessions(window, workspacePath, ["Late unread", "Selection anchor"]);
    const refs = refsByTitle(await getDesktopState(window));
    lateRef = refs.get("Late unread");
    anchorRef = refs.get("Selection anchor");
  } finally {
    await closeHarness(firstRun, testInfo, "mark-read-initial");
  }
  if (!lateRef || !anchorRef) throw new Error("Mark-read fixtures were not created");

  const largeRefs = await seedLargeUnreadSessions(
    userDataDir,
    lateRef,
    sidebarPreferences_markReadLimit + 2,
  );
  const readBaseline = new Date().toISOString();
  await updateUiState(userDataDir, (state) => ({
    ...state,
    lastViewedAtBySession: {
      ...(state.lastViewedAtBySession ?? {}),
      [refKey(lateRef)]: readBaseline,
      [refKey(anchorRef)]: readBaseline,
    },
  }));

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.evaluate(async (ref) => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.selectSession(ref);
    }, anchorRef);
    const loaded = await getDesktopState(window);
    const unreadRefs = loaded.workspaces.flatMap((workspace) =>
      workspace.sessions
        .filter((session) => session.hasUnseenUpdate)
        .map((session) => ({ workspaceId: workspace.id, sessionId: session.id })),
    );
    expect(unreadRefs).toHaveLength(sidebarPreferences_markReadLimit + 2);
    await installMarkReadCapture(secondRun, { holdFirstBatch: true });

    const beforeCancel = (await getDesktopState(window)).lastViewedAtBySession;
    let dialogAction: "accept" | "dismiss" = "dismiss";
    const dialogMessages: string[] = [];
    window.on("dialog", async (dialog) => {
      dialogMessages.push(dialog.message());
      if (dialogAction === "accept") {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    await window.getByTestId("mark-all-threads-read").click();
    await expect.poll(() => dialogMessages.length).toBe(1);
    expect(dialogMessages[0]).toContain(`${sidebarPreferences_markReadLimit + 2} unread threads`);
    await window.keyboard.press("Escape");
    const afterCancel = (await getDesktopState(window)).lastViewedAtBySession;
    const anchorKey = refKey(anchorRef);
    const { [anchorKey]: _activeSessionBeforeCancel, ...inactiveBeforeCancel } = beforeCancel;
    const { [anchorKey]: _activeSessionAfterCancel, ...inactiveAfterCancel } = afterCancel;
    expect(inactiveAfterCancel).toEqual(inactiveBeforeCancel);
    expect((await readMarkReadCapture(secondRun)).invokeCount).toBe(0);

    dialogAction = "accept";
    await window.getByTestId("mark-all-threads-read").click();
    await expect.poll(async () => (await readMarkReadCapture(secondRun)).starts.length).toBe(1);
    const lateUpdatedAt = new Date(Date.now() + 120_000).toISOString();
    await emitTestSessionEvent(secondRun, {
      type: "sessionUpdated",
      sessionRef: lateRef,
      timestamp: lateUpdatedAt,
      runId: "late-unread-push",
      snapshot: {
        ref: lateRef,
        workspace: {
          workspaceId: lateRef.workspaceId,
          path: workspacePath,
          displayName: "sidebar-parity-mark-read",
        },
        title: "Late unread",
        status: "idle",
        updatedAt: lateUpdatedAt,
        preview: "Later unread update",
      },
    });
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces
          .flatMap((workspace) => workspace.sessions)
          .find((session) => session.id === lateRef!.sessionId)?.updatedAt;
      })
      .toBe(lateUpdatedAt);
    await releaseMarkReadCapture(secondRun);
    await expect(window.getByTestId("mark-all-threads-read-report")).toHaveText(
      `Marked all ${sidebarPreferences_markReadLimit + 2} unread threads as read.`,
    );
    await expect.poll(async () => (await readMarkReadCapture(secondRun)).finishes.length).toBe(2);
    const completeCapture = await readMarkReadCapture(secondRun);
    expect(completeCapture.starts.map((batch) => batch.length)).toEqual([
      sidebarPreferences_markReadLimit,
      2,
    ]);
    expect(completeCapture.finishes).toEqual(completeCapture.starts);
    expect(completeCapture.errors).toEqual([]);
    const afterComplete = await getDesktopState(window);
    const lateSession = afterComplete.workspaces
      .flatMap((workspace) => workspace.sessions)
      .find((session) => session.id === lateRef!.sessionId);
    expect(lateSession?.hasUnseenUpdate).toBe(true);
    expect(
      afterComplete.lastViewedAtBySession?.[
        persistedSessionDataPaths(userDataDir, lateRef).rawSessionKey
      ],
    ).toBe(beforeCancel[persistedSessionDataPaths(userDataDir, lateRef).rawSessionKey]);
    await expect(window.getByTestId("mark-all-threads-read")).toBeEnabled();
    await captureSidebarEvidence(window, testInfo, "mark-read-500-complete");
  } finally {
    await closeHarness(secondRun, testInfo, "mark-read-complete-final");
  }

  await setLargeSessionsUnread(userDataDir, largeRefs, [lateRef, anchorRef]);
  const thirdRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await thirdRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.evaluate(async (ref) => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.selectSession(ref);
    }, anchorRef);
    const loaded = await getDesktopState(window);
    const initialUnread = loaded.workspaces.flatMap((workspace) =>
      workspace.sessions
        .filter((session) => session.hasUnseenUpdate)
        .map((session) => ({ workspaceId: workspace.id, sessionId: session.id })),
    );
    expect(initialUnread).toHaveLength(sidebarPreferences_markReadLimit + 2);
    await installMarkReadCapture(thirdRun, { failAfterBatch: 1 });
    window.once("dialog", (dialog) => dialog.accept());
    await window.getByTestId("mark-all-threads-read").click();
    await expect(window.getByTestId("mark-all-threads-read-report")).toContainText(
      `Marked ${sidebarPreferences_markReadLimit} of ${sidebarPreferences_markReadLimit + 2} unread threads as read.`,
    );
    await expect(window.getByTestId("mark-all-threads-read-report")).toContainText(
      "Injected sidebar partial failure",
    );
    await expect(window.getByTestId("mark-all-threads-read-report")).toHaveAttribute(
      "role",
      "alert",
    );
    const partialCapture = await readMarkReadCapture(thirdRun);
    expect(partialCapture.starts.map((batch) => batch.length)).toEqual([
      sidebarPreferences_markReadLimit,
      2,
    ]);
    expect(partialCapture.finishes.map((batch) => batch.length)).toEqual([
      sidebarPreferences_markReadLimit,
    ]);
    expect(partialCapture.errors).toEqual(["Injected sidebar partial failure"]);
    const remainingUnreadIds = new Set(
      (await getDesktopState(window)).workspaces.flatMap((workspace) =>
        workspace.sessions
          .filter((session) => session.hasUnseenUpdate)
          .map((session) => session.id),
      ),
    );
    expect(remainingUnreadIds).toEqual(new Set(partialCapture.starts[1]));
    await captureSidebarEvidence(window, testInfo, "mark-read-500-partial");
  } finally {
    await closeHarness(thirdRun, testInfo, "mark-read-partial-final");
  }
});

test("forest reachability, all child outcomes, origins, Age and history survive hidden Electron", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir("sidebar-parity-forest-");
  const alphaPath = await makeWorkspace("sidebar-parity-forest-alpha");
  const betaPath = await makeWorkspace("sidebar-parity-forest-beta");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [alphaPath, betaPath],
    testMode: "background",
  });
  let refs = new Map<string, SessionRef>();

  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await waitForWorkspaceByPath(window, betaPath);
    await createSessions(window, alphaPath, [
      "Chief",
      "Agent grandchild",
      "Queued child",
      "Running child",
      "Waiting child",
      "Complete child",
      "Failed child",
      "Cancelled child",
      "Pinned parent",
      "Pinned child",
      "Archived parent",
      "Archived child",
      "Orphan",
      "Cycle A",
      "Cycle B",
    ]);
    await createSessions(window, betaPath, ["Cross project child"]);
    refs = refsByTitle(await getDesktopState(window));
  } finally {
    await closeHarness(firstRun, testInfo, "forest-initial");
  }

  const relation = (
    id: string,
    parent: string,
    childTitle: string,
    status: ChildStatus,
    origin: "human" | "tool" | "unknown",
  ) =>
    childRecord({
      id,
      parent: refs.get(parent)!,
      child: refs.get(childTitle)!,
      title: childTitle,
      status,
      origin,
      createdAt: "2026-10-01T00:00:00.000Z",
      modelId: `model-${status}`,
    });
  await updateUiState(userDataDir, (state) => {
    const createdAtBySession = { ...(state.createdAtBySession ?? {}) };
    createdAtBySession[refKey(refs.get("Orphan")!)] = "2000-01-01T00:00:00.000Z";
    delete createdAtBySession[refKey(refs.get("Cycle A")!)];
    const initiatingOriginBySession = { ...(state.initiatingOriginBySession ?? {}) };
    delete initiatingOriginBySession[refKey(refs.get("Cancelled child")!)];
    return {
      ...state,
      allThreadsSort: "title",
      createdAtBySession,
      initiatingOriginBySession: {
        ...initiatingOriginBySession,
        [refKey(refs.get("Cross project child")!)]: {
          kind: "human",
          source: "desktop-host",
        },
        [refKey(refs.get("Running child")!)]: {
          kind: "tool",
          source: "desktop-host",
        },
        [refKey(refs.get("Waiting child")!)]: {
          kind: "scheduled",
          source: "desktop-host",
        },
      },
      orchestrationChildren: [
        relation("cross", "Chief", "Cross project child", "running", "human"),
        relation("grandchild", "Cross project child", "Agent grandchild", "complete", "tool"),
        relation("queued", "Chief", "Queued child", "queued", "tool"),
        relation("running", "Chief", "Running child", "running", "human"),
        relation("waiting", "Chief", "Waiting child", "waiting", "tool"),
        relation("complete", "Chief", "Complete child", "complete", "human"),
        relation("failed", "Chief", "Failed child", "failed", "tool"),
        relation("cancelled", "Chief", "Cancelled child", "cancelled", "tool"),
        relation("pin-link", "Pinned parent", "Pinned child", "complete", "human"),
        relation("archive-link", "Archived parent", "Archived child", "failed", "tool"),
        childRecord({
          id: "orphan-link",
          parent: { workspaceId: refs.get("Chief")!.workspaceId, sessionId: "missing" },
          child: refs.get("Orphan")!,
          title: "Orphan",
          status: "waiting",
          origin: "unknown",
          createdAt: "2026-10-01T00:02:00.000Z",
        }),
        relation("cycle-a", "Cycle A", "Cycle B", "complete", "human"),
        relation("cycle-b", "Cycle B", "Cycle A", "complete", "human"),
      ],
    };
  });

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await waitForWorkspaceByPath(window, betaPath);
    const previsualState = await getDesktopState(window);
    const sessionByTitle = new Map(
      previsualState.workspaces.flatMap((workspace) =>
        workspace.sessions.map((session) => [session.title, session] as const),
      ),
    );
    expect(sessionByTitle.get("Cancelled child")?.initiatingOrigin).toBeUndefined();
    expect(sessionByTitle.get("Cross project child")?.initiatingOrigin).toEqual({
      kind: "human",
      source: "desktop-host",
    });
    expect(sessionByTitle.get("Running child")?.initiatingOrigin).toEqual({
      kind: "tool",
      source: "desktop-host",
    });
    expect(sessionByTitle.get("Waiting child")?.initiatingOrigin).toEqual({
      kind: "scheduled",
      source: "desktop-host",
    });
    expect(sessionByTitle.get("Orphan")?.createdAt).toBe("2000-01-01T00:00:00.000Z");
    expect(sessionByTitle.get("Cycle A")?.createdAt).toBeUndefined();

    await window.evaluate(async (ref) => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.setSessionPinned(ref, true);
    }, refs.get("Pinned child")!);
    await window.evaluate(async (ref) => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.archiveSession(ref);
    }, refs.get("Archived child")!);
    const state = await getDesktopState(window);
    const statusFixtures: readonly [string, ChildStatus][] = [
      ["Running child", "running"],
      ["Waiting child", "waiting"],
      ["Complete child", "complete"],
      ["Failed child", "failed"],
      ["Cancelled child", "cancelled"],
    ];
    for (const [title, status] of statusFixtures) {
      await emitChildOutcome(secondRun, state, refs.get(title)!, status);
    }
    await expect
      .poll(async () => {
        const links = (await getDesktopState(window)).childThreadLinks;
        return statusFixtures.map(
          ([title, status]) =>
            links.find((link) => link.childSessionId === refs.get(title)!.sessionId)?.status ===
            status,
        );
      })
      .toEqual([true, true, true, true, true]);

    const allThreads = window.getByTestId("all-threads");
    const showMore = allThreads.getByRole("button", { name: /^Show more / });
    await expect(showMore).toBeVisible();
    await showMore.click();
    await expect(allThreads).toContainText("Chief");

    const chiefRow = window.locator(
      `.session-row[data-session-id="${refs.get("Chief")!.sessionId}"]`,
    );
    await expect(chiefRow.getByLabel("8 child threads")).toBeVisible();
    for (const status of ["queued", "running", "waiting", "complete", "failed", "cancelled"]) {
      await expect(
        window.locator(`.session-row[data-child-status="${status}"]`).first(),
      ).toBeVisible();
    }
    await expect(window.getByText("Human-created", { exact: true }).first()).toBeVisible();
    await expect(window.getByText("Agent / tool", { exact: true }).first()).toBeVisible();
    await expect(window.getByText("Scheduled", { exact: true }).first()).toBeVisible();
    await expect(window.getByText("Origin unknown", { exact: true }).first()).toBeVisible();

    const orphanRow = window.locator(
      `.session-row[data-session-id="${refs.get("Orphan")!.sessionId}"]`,
    );
    await expect(orphanRow.locator(".session-row__time")).not.toHaveText("now");
    await expect(orphanRow.locator(".session-row__time")).toHaveAttribute(
      "title",
      "Created 2000-01-01T00:00:00.000Z",
    );
    const missingCreationRow = window.locator(
      `.session-row[data-session-id="${refs.get("Cycle A")!.sessionId}"]`,
    );
    await expect(missingCreationRow.locator(".session-row__time")).toHaveText("Unknown");
    await expect(missingCreationRow.locator(".session-row__time")).toHaveAttribute(
      "title",
      "Creation time unavailable",
    );

    const pinnedSection = window.getByRole("region", { name: "Pinned threads" });
    await expect(pinnedSection).toContainText("Pinned child");
    const archivedToggle = window.locator(".archived-thread-group__toggle");
    await archivedToggle.click();
    await expect(window.locator(".session-list--archived")).toContainText("Archived child");

    const cancelledRow = window.locator(
      `.session-row[data-session-id="${refs.get("Cancelled child")!.sessionId}"]`,
    );
    await expect(cancelledRow).toHaveAttribute("data-child-origin-group", "unknown");
    await expect(cancelledRow.locator(".session-row__child-status")).toHaveText("cancelled");
    await expect(cancelledRow.locator(".session-row__child-model")).toContainText(
      "model-cancelled",
    );
    await expect(cancelledRow.locator(".session-row__child-history")).toContainText(/\d+[smhd]/);
    await expect(cancelledRow.locator(".session-row__time")).toHaveText(/\w+/);
    await cancelledRow.locator(".session-row__select").click();
    await expect(window.locator(".chat-header__title")).toHaveText("Cancelled child");

    const renderedIds = await window
      .locator(".session-row")
      .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.sessionId ?? ""));
    expect(new Set(renderedIds).size).toBe(renderedIds.length);
    for (const title of [
      "Orphan",
      "Cycle A",
      "Cycle B",
      "Cross project child",
      "Agent grandchild",
    ]) {
      await expect(
        window.locator(`.session-row[data-session-id="${refs.get(title)!.sessionId}"]`),
      ).toHaveCount(1);
    }

    await captureSidebarEvidence(window, testInfo, "forest-wide");
    await window.setViewportSize({ width: 720, height: 900 });
    await captureSidebarEvidence(window, testInfo, "forest-narrow");
  } finally {
    await closeHarness(secondRun, testInfo, "forest-final");
  }
});
