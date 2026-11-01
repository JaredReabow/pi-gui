import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  childSelection_decode,
  childSelection_decodeOrigin,
} from "../../contracts/child-selection";
import {
  sidebarPreferences_decodeFolder,
  sidebarPreferences_decodeSort,
  sidebarPreferences_decodeMarkRead,
  sidebarPreferences_markReadLimit,
} from "../../contracts/sidebar-preferences";
import {
  desktopState_humanInputHistory,
  childThreadLinksOf,
  type OrchestrationChildThread,
  type TranscriptMessage,
} from "../../contracts/desktop-state";
import { createOrchestrationRuntimeTools } from "../../electron/orchestration/orchestration-runtime";
import {
  decodePersistedUiState,
  readPersistedUiState,
  writePersistedUiState,
} from "../../electron/persistence/app-store-persistence";

const at = "2026-10-31T00:00:00.000Z";
const child: OrchestrationChildThread = {
  id: "link",
  parentWorkspaceId: "ws",
  parentSessionId: "parent",
  childWorkspaceId: "ws",
  childSessionId: "child",
  title: "Child",
  goal: "Task",
  status: "queued",
  latestTranscript: "Task",
  transcript: [],
  evidence: [],
  createdAt: at,
  updatedAt: at,
};

test("child selection requires an atomic identity and rejects forged host metadata", () => {
  expect(childSelection_decode({ provider: "p", modelId: "m", thinkingLevel: "high" })).toEqual({
    provider: "p",
    modelId: "m",
    thinkingLevel: "high",
  });
  for (const invalid of [
    null,
    [],
    {},
    { provider: "p" },
    { provider: "", modelId: "m" },
    { provider: "p", modelId: "m", thinkingLevel: "extreme" },
    { provider: "p", modelId: "m", origin: "trusted" },
    { provider: "p", modelId: "m", available: true },
  ]) {
    expect(() => childSelection_decode(invalid)).toThrow();
  }
  expect(() =>
    childSelection_decodeOrigin({
      kind: "child-thread",
      source: "tool",
      parentWorkspaceId: "ws",
      parentSessionId: "parent",
    }),
  ).toThrow();
});

test("sidebar request decoders reject invalid preferences and bound the complete read batch", () => {
  for (const value of ["open", "partial", "closed"])
    expect(sidebarPreferences_decodeFolder(value)).toBe(value);
  for (const value of ["activity", "latest-human-input", "unread-first", "created", "title"])
    expect(sidebarPreferences_decodeSort(value)).toBe(value);
  expect(() => sidebarPreferences_decodeFolder("auto")).toThrow();
  expect(() => sidebarPreferences_decodeSort("age")).toThrow();
  const target = { workspaceId: "ws", sessionId: "child" };
  expect(
    sidebarPreferences_decodeMarkRead({
      targets: Array(sidebarPreferences_markReadLimit).fill(target),
    }).targets,
  ).toHaveLength(500);
  for (const value of [
    null,
    { targets: [{ ...target, archive: true }] },
    { targets: [{ workspaceId: "ws" }] },
    { targets: Array(501).fill(target) },
    { targets: [], all: true },
  ])
    expect(() => sidebarPreferences_decodeMarkRead(value)).toThrow();
});

test("composer history projects human messages in branch order without changing source rows", () => {
  const transcript: readonly TranscriptMessage[] = [
    { kind: "message", id: "u1", role: "user", text: "first\nline", createdAt: at },
    { kind: "message", id: "a1", role: "assistant", text: "private assistant", createdAt: at },
    { kind: "message", id: "s1", role: "branchSummary", text: "summary", createdAt: at },
    {
      kind: "tool",
      id: "t1",
      callId: "call",
      toolName: "bash",
      status: "success",
      label: "tool",
      createdAt: at,
    },
    { kind: "message", id: "u2", role: "user", text: "second", createdAt: at },
  ];
  const before = structuredClone(transcript);
  expect(desktopState_humanInputHistory(transcript)).toEqual(["first\nline", "second"]);
  expect(desktopState_humanInputHistory([])).toEqual([]);
  expect(transcript).toEqual(before);
});

test("legacy records remain unknown and optional preferences/config round-trip", async () => {
  const legacy = decodePersistedUiState({ version: 15, orchestrationChildren: [child] });
  expect(legacy.createdAtBySession).toBeUndefined();
  expect(legacy.folderPreferencesByWorkspace).toBeUndefined();
  expect(legacy.orchestrationChildren?.[0]?.origin).toBeUndefined();
  const path = join(await mkdtemp(join(tmpdir(), "d08-contract-")), "ui-state.json");
  const payload = {
    folderPreferencesByWorkspace: {
      ws: "partial" as const,
      other: "open" as const,
      third: "closed" as const,
    },
    allThreadsSort: "created" as const,
    createdAtBySession: { "ws:child": at },
    orchestrationChildren: [
      {
        ...child,
        origin: {
          kind: "child-thread" as const,
          source: "desktop-host" as const,
          parentWorkspaceId: "ws",
          parentSessionId: "parent",
        },
        selectedConfig: { provider: "actual", modelId: "driver-model", thinkingLevel: "medium" },
      },
    ],
  };
  await writePersistedUiState(path, payload);
  const decoded = await readPersistedUiState(path);
  expect(decoded).toMatchObject(payload);
});

for (const invalid of [
  { folderPreferencesByWorkspace: { ws: "auto" } },
  { allThreadsSort: "age" },
  { createdAtBySession: { "ws:child": "unknown" } },
  { orchestrationChildren: [{ ...child, selectedConfig: { credential: "must not cross" } }] },
  {
    orchestrationChildren: [
      {
        ...child,
        origin: {
          kind: "child-thread",
          source: "desktop-host",
          parentWorkspaceId: "other",
          parentSessionId: "parent",
        },
      },
    ],
  },
]) {
  test(`malformed additive state is preserved: ${JSON.stringify(invalid)}`, async () => {
    const path = join(await mkdtemp(join(tmpdir(), "d08-invalid-")), "ui-state.json");
    const original = JSON.stringify({ version: 19, ...invalid });
    await writeFile(path, original);
    await expect(readPersistedUiState(path)).rejects.toThrow();
    await expect(writePersistedUiState(path, { composerDraft: "replacement" })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(original);
  });
}

test("bounded read backend has no archive, select, transcript or driver operation", async () => {
  const source = await readFile(join(__dirname, "../../electron/application/app-store.ts"), "utf8");
  const method = source.slice(
    source.indexOf("  async markAllThreadsRead("),
    source.indexOf("  async setFolderPreference("),
  );
  expect(method.indexOf("sidebarPreferences_decodeMarkRead(input)")).toBeLessThan(
    method.indexOf("await this.initialize()"),
  );
  expect(method.indexOf("targets.some(")).toBeLessThan(method.indexOf("this.markSessionViewed("));
  expect(method).toContain("this.markSessionViewed(toSessionRef(target))");
  expect(method.match(/await this.persistUiState\(\)/g)).toHaveLength(1);
  expect(method).not.toMatch(
    /archiveSession|selectSession|transcript|this\.driver|selectedSessionId\s*:/,
  );
});

test("creation metadata uses only known new-session seeds, never updatedAt", async () => {
  const source = await readFile(join(__dirname, "../../electron/application/app-store.ts"), "utf8");
  const assignments = source.match(/createdAtBySession\.set\([^;]+/g) ?? [];
  expect(assignments).toHaveLength(2); // one trusted creation helper and persisted restore.
  for (const kind of ["human", "tool", "scheduled"])
    expect(source).toContain(`this.recordCreatedSession(snapshot.ref, "${kind}")`);
  expect(assignments.join("\n")).not.toContain("updatedAt");
  expect(source).toContain("createdAt: this.sessionState.createdAtBySession.get(");
  const map = await readFile(
    join(__dirname, "../../electron/conversation/session-state-map.ts"),
    "utf8",
  );
  expect(map.match(/this\.createdAtBySession,/g)).toHaveLength(2); // all keys and persisted-state pruning.
  expect(map).toContain("this.createdAtBySession.delete(key)");
});

test("new IPC capabilities use the main-frame boundary with decoders", async () => {
  const source = await readFile(
    join(__dirname, "../../electron/ipc/register-desktop-ipc.ts"),
    "utf8",
  );
  for (const channel of [
    "markAllThreadsRead",
    "setFolderPreference",
    "setAllThreadsSort",
    "getEffectiveChildModelSettings",
  ]) {
    expect(source).toMatch(new RegExp(`handleMainFrame\\(\\s*desktopIpc\\.${channel},`));
    expect(source).not.toMatch(new RegExp(`ipcMain\\.handle\\(\\s*desktopIpc\\.${channel}`));
  }
});

test("child links carry only additive host metadata and refresh when configuration changes", () => {
  const actual = { provider: "p", modelId: "m", thinkingLevel: "high" };
  const origin = {
    kind: "child-thread" as const,
    source: "desktop-host" as const,
    parentWorkspaceId: "ws",
    parentSessionId: "parent",
  };
  const records = [{ ...child, selectedConfig: actual, origin }];
  const links = childThreadLinksOf(records);
  expect(links[0]).toMatchObject({ selectedConfig: actual, origin, createdAt: at });
  expect(links[0]).not.toHaveProperty("transcript");
  expect(links[0]).not.toHaveProperty("goal");
  expect(childThreadLinksOf(records, links)).toBe(links);
  expect(
    childThreadLinksOf([{ ...records[0]!, selectedConfig: { ...actual, modelId: "new" } }], links),
  ).not.toBe(links);
});

test("initiating origin is explicit or unknown, and tool requests cannot forge host metadata", async () => {
  const {
    childSelection_initiatingKind,
    childSelection_decodeInitiatingOrigin,
    childSelection_rejectOriginInput,
  } = await import("../../contracts/child-selection");
  expect(childSelection_initiatingKind(undefined)).toBe("unknown");
  for (const kind of ["human", "tool", "scheduled"] as const) {
    const origin = childSelection_decodeInitiatingOrigin({ kind, source: "desktop-host" });
    expect(childSelection_initiatingKind(origin)).toBe(kind);
  }
  for (const key of ["origin", "initiatingOrigin", "initiatingOriginBySession"])
    expect(() =>
      childSelection_rejectOriginInput({
        prompt: "work",
        [key]: { kind: "human", source: "desktop-host" },
      }),
    ).toThrow(/host-authored/);
  const tool = createOrchestrationRuntimeTools({
    createChildThread: () => {
      throw new Error("Forged request reached host");
    },
  } as unknown as Parameters<typeof createOrchestrationRuntimeTools>[0])[0]!;
  await expect(
    tool.execute(
      "call",
      { prompt: "work", initiatingOrigin: { kind: "human", source: "desktop-host" } },
      undefined,
      undefined,
      {} as never,
    ),
  ).rejects.toThrow(/host-authored/);
});

test("the public mark-read limit remains the exact authoritative backend bound", () => {
  const target = { workspaceId: "ws", sessionId: "thread" };
  expect(
    sidebarPreferences_decodeMarkRead({
      targets: Array(sidebarPreferences_markReadLimit).fill(target),
    }).targets,
  ).toHaveLength(sidebarPreferences_markReadLimit);
  expect(() =>
    sidebarPreferences_decodeMarkRead({
      targets: Array(sidebarPreferences_markReadLimit + 1).fill(target),
    }),
  ).toThrow();
});

test("stage 2 retains persisted appearance privately without consumer adoption", async () => {
  const source = await readFile(join(__dirname, "../../electron/application/app-store.ts"), "utf8");
  expect(source).toContain(
    "private workspaceAccentColors: Readonly<Record<string, ProjectAccentColor>>",
  );
  expect(source).toContain(
    "private activityIndicatorPreference: PersistedActivityIndicatorPreference | undefined",
  );
  expect(source).toContain("workspaceAccentColors:");
  expect(source).toContain("activityIndicatorPreference: this.activityIndicatorPreference");
  expect(source).not.toMatch(
    /sidebarAppearance\s*:|projectByWorkspaceId\s*:|WorkspaceRecord[^\n]*accent/i,
  );
});
