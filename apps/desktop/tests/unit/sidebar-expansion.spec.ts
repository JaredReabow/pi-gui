import { expect, test } from "@playwright/test";
import {
  decodeSidebarExpansion,
  readSidebarExpansion,
  saveSidebarExpansion,
  SIDEBAR_EXPANSION_KEY,
} from "../../src/features/threads/use-sidebar-expansion";

test("sidebar expansion round trip preserves independent nested folds and other fields", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  saveSidebarExpansion(
    {
      collapsedThreads: new Set(["workspace:parent", "workspace:child"]),
      expandedHistory: new Set(["workspace:one", "recency:today", "all-threads"]),
      archivedOpen: true,
    },
    storage,
  );
  const reopened = readSidebarExpansion(storage);
  expect([...reopened.collapsedThreads]).toEqual(["workspace:parent", "workspace:child"]);
  expect([...reopened.expandedHistory]).toEqual(["workspace:one", "recency:today", "all-threads"]);
  expect(reopened.archivedOpen).toBe(true);
  saveSidebarExpansion({ ...reopened, collapsedThreads: new Set(), archivedOpen: false }, storage);
  expect([...readSidebarExpansion(storage).expandedHistory]).toEqual([...reopened.expandedHistory]);
  expect(readSidebarExpansion(storage).collapsedThreads.size).toBe(0);
  expect(readSidebarExpansion(storage).archivedOpen).toBe(false);
  expect(values.has(SIDEBAR_EXPANSION_KEY)).toBe(true);
});
test("missing, malformed and future preferences fall back without rewriting saved bytes", () => {
  for (const raw of [
    null,
    "{broken",
    "null",
    "[]",
    "true",
    JSON.stringify({
      version: 2,
      collapsedThreads: ["keep"],
      expandedHistory: [],
      archivedOpen: true,
    }),
    JSON.stringify({ version: 1, collapsedThreads: [5], expandedHistory: [], archivedOpen: true }),
    JSON.stringify({
      version: 1,
      collapsedThreads: [],
      expandedHistory: [],
      archivedOpen: "false",
    }),
  ]) {
    const decoded = decodeSidebarExpansion(raw);
    expect(decoded.collapsedThreads.size).toBe(0);
    expect(decoded.expandedHistory.size).toBe(0);
    expect(decoded.archivedOpen).toBe(false);
  }
  let writes = 0;
  const storage = {
    getItem: () => "{broken",
    setItem: () => {
      writes++;
    },
  };
  readSidebarExpansion(storage);
  expect(writes).toBe(0);
});
test("blocked storage remains non-fatal and duplicate keys decode as a set", () => {
  const denied = {
    getItem: (): string | null => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  expect(readSidebarExpansion(denied).collapsedThreads.size).toBe(0);
  expect(() =>
    saveSidebarExpansion(
      { collapsedThreads: new Set(["keep"]), expandedHistory: new Set(), archivedOpen: true },
      denied,
    ),
  ).not.toThrow();
  expect([
    ...decodeSidebarExpansion(
      JSON.stringify({
        version: 1,
        collapsedThreads: ["keep", "keep"],
        expandedHistory: [],
        archivedOpen: false,
      }),
    ).collapsedThreads,
  ]).toEqual(["keep"]);
});
