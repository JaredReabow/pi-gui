import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutonomyStore, decodeAutonomy } from "../../electron/conversation/autonomy-store";
const target = { workspaceId: "workspace", sessionId: "one" };
const setup = async () =>
  join(await mkdtemp(join(tmpdir(), "pi-autonomy-store-")), "autonomy.json");
test("restrictive default, per-thread reviewer isolation and restart", async () => {
  const path = await setup();
  const store = new AutonomyStore(path);
  expect(await store.get(target)).toEqual({ mode: "read-only", reviewModel: null, revision: 0 });
  await store.set({ target, mode: "auto", reviewModel: { provider: "test", modelId: "reviewer" } });
  const reopened = new AutonomyStore(path);
  expect(await reopened.get(target)).toEqual({
    mode: "auto",
    reviewModel: { provider: "test", modelId: "reviewer" },
    revision: 1,
  });
  expect((await reopened.get({ ...target, sessionId: "two" })).mode).toBe("read-only");
  await reopened.set({ target, reviewModel: null });
  expect((await new AutonomyStore(path).get(target)).reviewModel).toBeNull();
});
test("full access needs explicit confirmation, default changes do not overwrite explicit thread choices", async () => {
  const path = await setup();
  const store = new AutonomyStore(path);
  await expect(store.set({ target, mode: "full-access" })).rejects.toThrow("confirmation");
  expect((await store.get(target)).mode).toBe("read-only");
  await store.set({ target, mode: "auto" });
  await store.set({ mode: "full-access", confirmFullAccess: true });
  expect((await store.get(target)).mode).toBe("auto");
  expect((await store.get({ ...target, sessionId: "two" })).mode).toBe("full-access");
  await expect(store.set({ reviewModel: null })).rejects.toThrow("thread");
});
test("queued writes preserve independent sessions and monotonically revoke stale decisions", async () => {
  const path = await setup();
  const store = new AutonomyStore(path);
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      store.set({ target: { ...target, sessionId: String(index) }, mode: "auto" }),
    ),
  );
  expect((await store.get()).revision).toBe(12);
  const saved = JSON.parse(await readFile(path, "utf8")) as { sessions: Record<string, unknown> };
  expect(Object.keys(saved.sessions)).toHaveLength(12);
  expect((await new AutonomyStore(path).get({ ...target, sessionId: "11" })).mode).toBe("auto");
});
test("legacy project-edit permissions migrate without reinterpreting new Read only", async () => {
  const path = await setup();
  const key = JSON.stringify([target.workspaceId, target.sessionId]);
  const full = { ...target, sessionId: "full" };
  const auto = { ...target, sessionId: "auto" };
  const reviewer = { provider: "test", modelId: "reviewer" };
  const legacy = JSON.stringify({
    version: 1,
    revision: 7,
    defaultMode: "read-only",
    sessions: {
      [key]: { mode: "read-only", reviewModel: reviewer },
      [JSON.stringify([full.workspaceId, full.sessionId])]: { mode: "full-access" },
      [JSON.stringify([auto.workspaceId, auto.sessionId])]: { mode: "auto", reviewModel: reviewer },
    },
  });
  await writeFile(path, legacy);
  const store = new AutonomyStore(path);
  expect((await store.get()).mode).toBe("project-only");
  expect(await store.get(target)).toEqual({
    mode: "project-only",
    reviewModel: reviewer,
    revision: 7,
  });
  expect((await store.get(full)).mode).toBe("full-access");
  expect((await store.get(auto)).reviewModel).toEqual(reviewer);
  expect(await readFile(path, "utf8")).toBe(legacy);
  await store.set({ target, mode: "read-only" });
  await store.set({ mode: "read-only" });
  const reopened = new AutonomyStore(path);
  expect((await reopened.get()).mode).toBe("read-only");
  expect(await reopened.get(target)).toEqual({
    mode: "read-only",
    reviewModel: reviewer,
    revision: 9,
  });
  expect((await reopened.get(full)).mode).toBe("full-access");
  expect((await reopened.get(auto)).mode).toBe("auto");
  const saved = JSON.parse(await readFile(path, "utf8")) as { version: number };
  expect(saved.version).toBe(2);
  await reopened.set({ target, mode: "project-only" });
  expect((await new AutonomyStore(path).get(target)).mode).toBe("project-only");
});
test("new schema distinguishes all four modes and rejects unknown versions", () => {
  for (const mode of ["read-only", "project-only", "auto", "full-access"])
    expect(
      decodeAutonomy({ version: 2, revision: 0, defaultMode: mode, sessions: {} }).defaultMode,
    ).toBe(mode);
  for (const version of [0, 3])
    expect(() =>
      decodeAutonomy({ version, revision: 0, defaultMode: "read-only", sessions: {} }),
    ).toThrow();
});
test("corruption and invalid persisted modes fail closed", async () => {
  const path = await setup();
  await writeFile(path, "{corrupted");
  await expect(new AutonomyStore(path).get()).rejects.toThrow();
  expect(() =>
    decodeAutonomy({ version: 1, revision: 0, defaultMode: "unrestricted", sessions: {} }),
  ).toThrow();
  expect(() =>
    decodeAutonomy({ version: 1, revision: -1, defaultMode: "full-access", sessions: {} }),
  ).toThrow();
  expect(() =>
    decodeAutonomy({
      version: 1,
      revision: 0,
      defaultMode: "read-only",
      sessions: {},
      extra: true,
    }),
  ).toThrow();
});
