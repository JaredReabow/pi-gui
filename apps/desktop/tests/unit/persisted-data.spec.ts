import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  decodePersistedUiState,
  readPersistedUiState,
  writePersistedUiState,
} from "../../electron/persistence/app-store-persistence";
import {
  projectIdentity_maxAccentEntries,
  projectIdentity_maxWorkspaceIdLength,
} from "../../contracts/project-identity";
import { AttachmentStore } from "../../electron/persistence/attachment-store";

for (const invalid of [
  { version: 99, composerDraft: "future data" },
  { version: 15, composerDraftsBySession: { one: 42 } },
  { version: 15, workspaceOrder: ["valid", null] },
  { version: 15, orchestrationChildren: [null] },
  { version: 15, appGlobalModelSettings: { defaultThinkingLevel: "unknown" } },
  { version: 15, futureData: "retain" },
  { version: 15, notificationPreferences: { futureSetting: true } },
  { version: 16, lastInteractedAtBySession: { one: 42 } },
  { version: 17, threadGrouping: "priority" },
  { version: 19, extensionFlagsByWorkspace: { ws: { retries: 3 } } },
  { version: 19, extensionFlagsBySession: { "ws:sess": ["plan"] } },
  { version: 19, collapsedWorkspaceIds: ["alpha", 42] },
  { version: 19, workspaceAccentColors: { project: "#123456" } },
  { version: 19, activityIndicatorPreference: { style: "spiral", source: "user" } },
  { version: 20, workspaceAccentColors: { project: "#1234567" } },
  { version: 20, activityIndicatorPreference: { style: "spiral", source: "provisional" } },
  {
    version: 20,
    activityIndicatorPreference: { style: "spiral", source: "user", credential: "forbidden" },
  },
  [],
]) {
  test(`preserves invalid UI state ${JSON.stringify(invalid)}`, async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ui-state-validation-")), "ui-state.json");
    const original = JSON.stringify(invalid);
    await writeFile(path, original);
    await expect(readPersistedUiState(path)).rejects.toThrow(/Invalid ui-state/);
    await expect(writePersistedUiState(path, { composerDraft: "replacement" })).rejects.toThrow(
      /Invalid ui-state/,
    );
    expect(await readFile(path, "utf8")).toBe(original);
  });
}

test("reads v15 ui-state without lastInteractedAt and writes v20", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ui-state-recency-")), "ui-state.json");
  await writeFile(path, JSON.stringify({ version: 15, composerDraft: "kept" }));
  const decoded = await readPersistedUiState(path);
  expect(decoded.version).toBe(15);
  expect(decoded.lastInteractedAtBySession).toBeUndefined();
  await writePersistedUiState(path, {
    composerDraft: "kept",
    lastInteractedAtBySession: { "ws:sess": "2026-09-21T12:00:00.000Z" },
  });
  const written = JSON.parse(await readFile(path, "utf8")) as {
    version: number;
    lastInteractedAtBySession: Record<string, string>;
  };
  expect(written.version).toBe(20);
  expect(written.lastInteractedAtBySession).toEqual({ "ws:sess": "2026-09-21T12:00:00.000Z" });
});

test("reads v16 ui-state without threadGrouping and writes the saved choice as v20", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ui-state-grouping-")), "ui-state.json");
  await writeFile(path, JSON.stringify({ version: 16, composerDraft: "kept" }));
  const decoded = await readPersistedUiState(path);
  expect(decoded.version).toBe(16);
  expect(decoded.threadGrouping).toBeUndefined();
  await writePersistedUiState(path, {
    composerDraft: "kept",
    threadGrouping: "workspace",
  });
  const written = JSON.parse(await readFile(path, "utf8")) as {
    version: number;
    threadGrouping: string;
  };
  expect(written.version).toBe(20);
  expect(written.threadGrouping).toBe("workspace");
});

test("extension flag defaults and per-thread flags round-trip through ui-state", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ui-state-flags-")), "ui-state.json");
  await writePersistedUiState(path, {
    extensionFlagsByWorkspace: { ws: { plan: true, "dry-run": false, env: "" } },
    extensionFlagsBySession: { "ws:sess": { plan: true }, "ws:empty": {} },
  });
  const decoded = await readPersistedUiState(path);
  expect(decoded.extensionFlagsByWorkspace).toEqual({
    ws: { plan: true, "dry-run": false, env: "" },
  });
  expect(decoded.extensionFlagsBySession).toEqual({ "ws:sess": { plan: true } });
});

test("reads ui-state without folded folders and writes the collapsed ids", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ui-state-collapsed-")), "ui-state.json");
  await writeFile(path, JSON.stringify({ version: 15, composerDraft: "kept" }));
  expect((await readPersistedUiState(path)).collapsedWorkspaceIds).toBeUndefined();
  await writePersistedUiState(path, { composerDraft: "kept", collapsedWorkspaceIds: ["alpha"] });
  const written = JSON.parse(await readFile(path, "utf8")) as {
    version: number;
    collapsedWorkspaceIds: readonly string[];
  };
  expect(written.version).toBe(20);
  expect(written.collapsedWorkspaceIds).toEqual(["alpha"]);
  expect((await readPersistedUiState(path)).collapsedWorkspaceIds).toEqual(["alpha"]);
});

test("strict appearance decode rejects unknown fields and does not invoke accessors", () => {
  let getterCalls = 0;
  const rootAccessor = { version: 20 };
  Object.defineProperty(rootAccessor, "workspaceAccentColors", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { project: "#123456" };
    },
  });
  expect(() => decodePersistedUiState(rootAccessor)).toThrow(/data property/);
  expect(getterCalls).toBe(0);

  const inheritedRoot: unknown = Object.create({
    version: 20,
    workspaceAccentColors: { project: "#123456" },
  });
  expect(() => decodePersistedUiState(inheritedRoot)).toThrow(/plain object/);

  const accentMap = {};
  Object.defineProperty(accentMap, "project", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "#123456";
    },
  });
  expect(() => decodePersistedUiState({ version: 20, workspaceAccentColors: accentMap })).toThrow(
    /Invalid ui-state/,
  );
  expect(getterCalls).toBe(0);

  const activity = { source: "user" };
  Object.defineProperty(activity, "style", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "spiral";
    },
  });
  expect(() =>
    decodePersistedUiState({ version: 20, activityIndicatorPreference: activity }),
  ).toThrow(/Invalid ui-state/);
  expect(getterCalls).toBe(0);

  const inheritedAccentMap: unknown = Object.create({ project: "#123456" });
  expect(() =>
    decodePersistedUiState({ version: 20, workspaceAccentColors: inheritedAccentMap }),
  ).toThrow(/Invalid ui-state/);

  const prototypeNamedMap: unknown = JSON.parse(
    '{"version":20,"workspaceAccentColors":{"__proto__":"#123456"}}',
  );
  const decoded = decodePersistedUiState(prototypeNamedMap).workspaceAccentColors;
  expect(Object.getPrototypeOf(decoded)).toBeNull();
  expect(Object.hasOwn(decoded ?? {}, "__proto__")).toBe(true);
});

test("strict appearance decode enforces map entry and project-id bounds", () => {
  const atLimit = Object.fromEntries(
    Array.from({ length: projectIdentity_maxAccentEntries }, (_, index) => [
      `project-${index}`,
      "#123456",
    ]),
  );
  expect(
    Object.keys(
      decodePersistedUiState({ version: 20, workspaceAccentColors: atLimit })
        .workspaceAccentColors ?? {},
    ),
  ).toHaveLength(projectIdentity_maxAccentEntries);
  expect(() =>
    decodePersistedUiState({
      version: 20,
      workspaceAccentColors: { ...atLimit, overflow: "#abcdef" },
    }),
  ).toThrow(/Invalid ui-state/);

  const maximumId = "p".repeat(projectIdentity_maxWorkspaceIdLength);
  expect(
    decodePersistedUiState({
      version: 20,
      workspaceAccentColors: { [maximumId]: "#ABCDEF" },
    }).workspaceAccentColors,
  ).toEqual({ [maximumId]: "#abcdef" });
  expect(() =>
    decodePersistedUiState({
      version: 20,
      workspaceAccentColors: { [`${maximumId}p`]: "#abcdef" },
    }),
  ).toThrow(/Invalid ui-state/);
  expect(() =>
    decodePersistedUiState({
      version: 20,
      workspaceAccentColors: { "bad\0project": "#abcdef" },
    }),
  ).toThrow(/Invalid ui-state/);
});

test("v19 to v20 writes one immutable first-migration copy and retains exact appearance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ui-state-v20-appearance-"));
  const path = join(dir, "ui-state.json");
  const v19 = JSON.stringify({ version: 19, composerDraft: "retained" });
  await writeFile(path, v19);

  const payload = {
    composerDraft: "retained",
    workspaceAccentColors: {
      "present-root": "#123456" as const,
      "absent-project": "#abcdef" as const,
    },
    activityIndicatorPreference: { style: "spiral" as const, source: "user" as const },
  };
  await writePersistedUiState(path, payload);
  const first = JSON.parse(await readFile(path, "utf8")) as {
    version: number;
    workspaceAccentColors: Record<string, string>;
    activityIndicatorPreference: { style: string; source: string };
  };
  expect(first.version).toBe(20);
  expect(first.workspaceAccentColors).toEqual(payload.workspaceAccentColors);
  expect(first.activityIndicatorPreference).toEqual(payload.activityIndicatorPreference);
  expect(await readFile(`${path}.bak`, "utf8")).toBe(v19);

  const migrationCopies = (await readdir(dir)).filter((name) =>
    name.startsWith("ui-state.pre-workbench-v19."),
  );
  expect(migrationCopies).toHaveLength(1);
  expect(await readFile(join(dir, migrationCopies[0]!), "utf8")).toBe(v19);

  await writePersistedUiState(path, {
    ...payload,
    composerDraft: "second write",
  });
  expect(
    (await readdir(dir)).filter((name) => name.startsWith("ui-state.pre-workbench-v19.")),
  ).toHaveLength(1);
});

test("backup recovery retains damaged bytes and the good backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ui-state-backup-"));
  const path = join(dir, "ui-state.json");
  const good = JSON.stringify({ version: 15, composerDraft: "retained draft" });
  await writeFile(`${path}.bak`, good);
  await writeFile(path, "{damaged");
  expect((await readPersistedUiState(path)).composerDraft).toBe("retained draft");
  await writePersistedUiState(path, { composerDraft: "retained draft" });
  expect(await readFile(`${path}.bak`, "utf8")).toBe(good);
  const preserved = (await readdir(dir)).filter((name) =>
    name.startsWith("ui-state.json.corrupt."),
  );
  expect(preserved).toHaveLength(1);
  expect(await readFile(join(dir, preserved[0]!), "utf8")).toBe("{damaged");
});

test("unrecoverable syntax errors cannot be overwritten", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ui-state-broken-")), "ui-state.json");
  await writeFile(path, "{damaged");
  await expect(readPersistedUiState(path)).rejects.toThrow(/original data was retained/);
  await expect(writePersistedUiState(path, {})).rejects.toThrow(/Cannot overwrite/);
  expect(await readFile(path, "utf8")).toBe("{damaged");
});

test("attachment owner rejects malformed entries before read, replacement or pruning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "attachment-validation-"));
  const store = new AttachmentStore(dir);
  const valid = {
    id: "one",
    kind: "image" as const,
    name: "image.png",
    mimeType: "image/png",
    data: "eA==",
  };
  await store.write("session", [valid]);
  const path = join(dir, "attachments", "session.json");
  const original = JSON.stringify([valid, null]);
  await writeFile(path, original);
  await expect(store.read("session")).rejects.toThrow(/Invalid saved attachment/);
  await expect(store.write("session", [])).rejects.toThrow(/Invalid saved attachment/);
  await expect(store.remove("session")).rejects.toThrow(/Invalid saved attachment/);
  expect(await readFile(path, "utf8")).toBe(original);
  await writeFile(
    path,
    JSON.stringify([
      { id: valid.id, name: valid.name, mimeType: valid.mimeType, data: valid.data },
    ]),
  );
  expect(await store.read("session")).toEqual([valid]);
});

test("unknown attachment fields survive rejected replacement and pruning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "attachment-unknown-"));
  const store = new AttachmentStore(dir);
  await store.write("session", []);
  const path = join(dir, "attachments", "session.json");
  const original = JSON.stringify([
    { id: "one", name: "image.png", mimeType: "image/png", data: "eA==", futureData: "retain" },
  ]);
  await writeFile(path, original);
  await expect(store.read("session")).rejects.toThrow(/unsupported field/);
  await expect(store.write("session", [])).rejects.toThrow(/unsupported field/);
  await expect(store.remove("session")).rejects.toThrow(/unsupported field/);
  expect(await readFile(path, "utf8")).toBe(original);
});

test("cancelled child and terminal supervision status survive persistence without changing legacy queued records", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "cancelled-ui-state-")), "ui-state.json");
  const at = "2026-10-31T00:00:00Z";
  const child = {
    id: "cancelled",
    parentWorkspaceId: "ws",
    parentSessionId: "parent",
    childWorkspaceId: "ws",
    childSessionId: "child",
    title: "Stopped",
    goal: "Work",
    status: "cancelled" as const,
    latestTranscript: "",
    transcript: [],
    evidence: [],
    createdAt: at,
    updatedAt: at,
    supervisionLoop: {
      id: "loop",
      status: "stopped" as const,
      gate: "stop" as const,
      intervalMs: 60000,
      iterationCount: 0,
      lastCheckedAt: at,
      lastChildStatus: "cancelled" as const,
      reason: "Child run cancelled.",
    },
  };
  await writePersistedUiState(path, {
    orchestrationChildren: [
      child,
      { ...child, id: "legacy", status: "queued", supervisionLoop: undefined },
    ],
  });
  const decoded = await readPersistedUiState(path);
  expect(decoded.orchestrationChildren?.[0]?.status).toBe("cancelled");
  expect(decoded.orchestrationChildren?.[0]?.supervisionLoop?.lastChildStatus).toBe("cancelled");
  expect(decoded.orchestrationChildren?.[1]?.status).toBe("queued");
});

test("explicit initiating origins round-trip while legacy child correlation stays unknown", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ui-state-origin-")), "ui-state.json");
  const initiatingOriginBySession = {
    "ws:human": { kind: "human" as const, source: "desktop-host" as const },
    "ws:tool": { kind: "tool" as const, source: "desktop-host" as const },
    "ws:scheduled": { kind: "scheduled" as const, source: "desktop-host" as const },
  };
  await writePersistedUiState(path, { initiatingOriginBySession });
  expect((await readPersistedUiState(path)).initiatingOriginBySession).toEqual(
    initiatingOriginBySession,
  );
  await writeFile(
    path,
    JSON.stringify({
      version: 15,
      createdAtBySession: { "ws:legacy": "2026-10-31T00:00:00.000Z" },
      orchestrationChildren: [
        {
          id: "legacy-child",
          sourceToolCallId: "legacy-correlation",
          parentWorkspaceId: "ws",
          parentSessionId: "parent",
          childWorkspaceId: "ws",
          childSessionId: "legacy",
          title: "Old child",
          goal: "Work",
          status: "queued",
          latestTranscript: "Work",
          transcript: [],
          evidence: [],
          createdAt: "2026-10-31T00:00:00.000Z",
          updatedAt: "2026-10-31T00:00:00.000Z",
        },
      ],
    }),
  );
  expect((await readPersistedUiState(path)).initiatingOriginBySession).toBeUndefined();
});

for (const origin of [
  null,
  [],
  { kind: "human", source: "model" },
  { kind: "unknown", source: "desktop-host" },
  { kind: "scheduled", source: "desktop-host", credential: "forbidden" },
]) {
  test(`malformed initiating origin is preserved ${JSON.stringify(origin)}`, async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ui-state-origin-invalid-")), "ui-state.json");
    const original = JSON.stringify({
      version: 19,
      initiatingOriginBySession: { "ws:thread": origin },
    });
    await writeFile(path, original);
    await expect(readPersistedUiState(path)).rejects.toThrow(/Invalid ui-state/);
    await expect(writePersistedUiState(path, { composerDraft: "replacement" })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(original);
  });
}
