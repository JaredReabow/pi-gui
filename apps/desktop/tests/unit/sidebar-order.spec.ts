import { expect, test } from "@playwright/test";
import type { SessionInitiatingOrigin } from "../../contracts/child-selection";
import type { SessionRecord } from "../../contracts/desktop-state";
import {
  sidebarPreferences_markReadLimit,
  type AllThreadsSort,
  type FolderPreference,
} from "../../contracts/sidebar-preferences";
import {
  sidebarOrder_childModelLabel,
  sidebarOrder_compareThreads,
  sidebarOrder_creationTooltip,
  sidebarOrder_dedupeBySession,
  sidebarOrder_elapsed,
  sidebarOrder_sessionAge,
} from "../../src/features/threads/sidebar-order";
import {
  sidebarPreferences_childOriginGroup,
  sidebarPreferences_cycleFolder,
  sidebarPreferences_executeMarkReadPlan,
  sidebarPreferences_folderState,
  sidebarPreferences_markReadPlan,
  sidebarPreferences_markReadTargets,
  sidebarPreferences_previewTree,
  type SidebarTreeEntry,
} from "../../src/features/threads/sidebar-preferences";

function session(id: string, title: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    title,
    preview: "",
    status: "idle",
    hasUnseenUpdate: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function entry(
  id: string,
  title: string,
  extra: Partial<SessionRecord> = {},
  workspaceId = "ws",
): SidebarTreeEntry {
  return {
    workspaceId,
    session: session(id, title, extra),
  };
}

function keys(entries: readonly SidebarTreeEntry[]): string[] {
  return entries.map((item) => `${item.workspaceId}:${item.session.id}`);
}

const orderingFixture = [
  entry("old-unread", "Zulu", {
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastInteractedAt: "2026-01-05T00:00:00.000Z",
    createdAt: "2026-01-04T00:00:00.000Z",
    hasUnseenUpdate: true,
  }),
  entry("new", "Alpha", {
    updatedAt: "2026-01-05T12:00:00.000Z",
    lastInteractedAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-05T00:00:00.000Z",
  }),
  entry("middle", "Bravo", {
    updatedAt: "2026-01-03T00:00:00.000Z",
    lastInteractedAt: "2026-01-04T00:00:00.000Z",
    createdAt: "2026-01-03T00:00:00.000Z",
  }),
  entry("legacy", "Delta", {
    updatedAt: "2026-01-06T00:00:00.000Z",
    lastInteractedAt: "2026-01-01T00:00:00.000Z",
  }),
];

test("all five All Threads sorts are deterministic for forward and reverse inputs", () => {
  const expected: Record<AllThreadsSort, string[]> = {
    activity: ["ws:legacy", "ws:new", "ws:middle", "ws:old-unread"],
    "latest-human-input": ["ws:old-unread", "ws:middle", "ws:new", "ws:legacy"],
    "unread-first": ["ws:old-unread", "ws:legacy", "ws:new", "ws:middle"],
    created: ["ws:new", "ws:old-unread", "ws:middle", "ws:legacy"],
    title: ["ws:new", "ws:middle", "ws:legacy", "ws:old-unread"],
  };

  for (const sort of Object.keys(expected) as AllThreadsSort[]) {
    const forward = [...orderingFixture].sort((left, right) =>
      sidebarOrder_compareThreads(left, right, sort),
    );
    const reverse = [...orderingFixture]
      .reverse()
      .sort((left, right) => sidebarOrder_compareThreads(left, right, sort));
    expect(keys(forward), sort).toEqual(expected[sort]);
    expect(keys(reverse), sort).toEqual(expected[sort]);
  }
});

test("created and title ties terminate on canonical session identity", () => {
  const entries = [
    entry("b", "same", { createdAt: "2026-01-01T00:00:00.000Z" }),
    entry("a", "same", { createdAt: "2026-01-01T00:00:00.000Z" }),
    entry("c", "Alpha", { createdAt: "not-a-date" }),
  ];
  expect(
    keys([...entries].sort((left, right) => sidebarOrder_compareThreads(left, right, "created"))),
  ).toEqual(["ws:a", "ws:b", "ws:c"]);
  expect(
    keys([...entries].sort((left, right) => sidebarOrder_compareThreads(left, right, "title"))),
  ).toEqual(["ws:c", "ws:a", "ws:b"]);
});

test("deduplication keeps the first navigation context for each session", () => {
  const first = entry("same", "First", {}, "alpha");
  const duplicate = { ...entry("same", "Duplicate", {}, "alpha"), folderId: "other" };
  expect(sidebarOrder_dedupeBySession([first, duplicate])).toEqual([first]);
});

test("open, partial, and closed trees reveal unread and selected descendants without mutation", () => {
  const roots: SidebarTreeEntry[] = Array.from({ length: 7 }, (_, index) =>
    entry(`root-${index}`, `Root ${index}`, {
      hasUnseenUpdate: index === 6,
      updatedAt: `2026-01-0${7 - index}T00:00:00.000Z`,
    }),
  );
  roots[5] = {
    ...roots[5]!,
    children: [entry("selected-child", "Selected child")],
  };
  const preferences: Record<string, FolderPreference> = { ws: "closed" };
  const before = JSON.stringify(preferences);

  expect(
    keys(
      sidebarPreferences_previewTree(
        roots,
        sidebarPreferences_folderState("ws", preferences, []),
        new Set(["ws:selected-child"]),
      ).visible,
    ),
  ).toEqual(["ws:root-5", "ws:root-6"]);
  expect(JSON.stringify(preferences)).toBe(before);

  const partial = sidebarPreferences_previewTree(roots, "partial");
  expect(partial.overflow).toBe(true);
  expect(partial.visibleCount).toBeLessThan(partial.totalCount);
  const expanded = sidebarPreferences_previewTree(roots, "partial", new Set(), true);
  expect(expanded.visible).toEqual(roots);
  expect(expanded.overflow).toBe(true);
  expect(sidebarPreferences_previewTree(roots, "open").overflow).toBe(false);
  expect(sidebarPreferences_cycleFolder("partial")).toBe("closed");
  expect(sidebarPreferences_cycleFolder("closed")).toBe("open");
});

test("tree previews count descendants and never split a parent tree", () => {
  const parent: SidebarTreeEntry = {
    ...entry("parent", "Parent"),
    children: Array.from({ length: 6 }, (_, index) => entry(`child-${index}`, `Child ${index}`)),
  };
  const sibling = entry("sibling", "Sibling");
  const preview = sidebarPreferences_previewTree([parent, sibling], "partial");
  expect(preview.visible).toEqual([parent]);
  expect(preview.visibleCount).toBe(7);
  expect(preview.totalCount).toBe(8);
  expect(preview.overflow).toBe(true);
});

test("mark-all-read targets only unique unread snapshots", () => {
  const entries = [
    entry("unread", "Unread", { hasUnseenUpdate: true }),
    { ...entry("unread", "Duplicate", { hasUnseenUpdate: true }) },
    entry("read", "Read"),
  ];
  expect(sidebarPreferences_markReadTargets(entries)).toEqual([
    { workspaceId: "ws", sessionId: "unread" },
  ]);
});

test("explicit initiating origins map to four groups and absence remains unknown", () => {
  const explicit = (kind: SessionInitiatingOrigin["kind"]): SessionInitiatingOrigin => ({
    kind,
    source: "desktop-host",
  });
  expect(sidebarPreferences_childOriginGroup(explicit("human"))).toBe("human");
  expect(sidebarPreferences_childOriginGroup(explicit("tool"))).toBe("tool");
  expect(sidebarPreferences_childOriginGroup(explicit("scheduled"))).toBe("scheduled");
  expect(sidebarPreferences_childOriginGroup(undefined)).toBe("unknown");

  expect(
    sidebarOrder_childModelLabel({
      session: session("child", "Child"),
      childSelectedConfig: { provider: "provider-a", modelId: "model-b" },
    }),
  ).toBe("provider-a / model-b");
  expect(
    sidebarOrder_childModelLabel({
      session: session("child", "Child", {
        config: { provider: "fallback", modelId: "default" },
      }),
    }),
  ).toBe("fallback / default");
  expect(sidebarOrder_childModelLabel({ session: session("child", "Child") })).toBe(
    "Default model",
  );
});

test("legacy timestamps remain honestly unknown", () => {
  const oldCreation = "2000-01-01T00:00:00.000Z";
  expect(
    sidebarOrder_sessionAge(
      session("old", "Old", {
        createdAt: oldCreation,
        updatedAt: new Date().toISOString(),
      }),
    ),
  ).not.toBe("now");
  expect(sidebarOrder_creationTooltip(oldCreation)).toBe(`Created ${oldCreation}`);
  expect(
    sidebarOrder_sessionAge(
      session("legacy", "Legacy", {
        createdAt: undefined,
        updatedAt: new Date().toISOString(),
      }),
    ),
  ).toBe("Unknown");
  expect(sidebarOrder_creationTooltip(undefined)).toBe("Creation time unavailable");
  expect(
    sidebarOrder_sessionAge(
      session("invalid", "Invalid", {
        createdAt: "not-a-date",
        updatedAt: new Date().toISOString(),
      }),
    ),
  ).toBe("Unknown");
  expect(sidebarOrder_creationTooltip("not-a-date")).toBe("Creation time unavailable");
  expect(sidebarOrder_elapsed(undefined, undefined)).toBe("Unknown");
  expect(sidebarOrder_elapsed("2026-01-01T00:00:00.000Z", "2026-01-01T01:02:03.000Z")).toBe("1h");
});

test("mark-read plans bound 0, 500, 501 and 1001 targets and deduplicate aliases", () => {
  const targets = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      workspaceId: "ws",
      sessionId: `session-${index}`,
    }));

  expect(sidebarPreferences_markReadPlan([], sidebarPreferences_markReadLimit).batches).toEqual([]);
  expect(
    sidebarPreferences_markReadPlan(targets(500), sidebarPreferences_markReadLimit).batches.map(
      (batch) => batch.length,
    ),
  ).toEqual([500]);
  expect(
    sidebarPreferences_markReadPlan(targets(501), sidebarPreferences_markReadLimit).batches.map(
      (batch) => batch.length,
    ),
  ).toEqual([500, 1]);
  expect(
    sidebarPreferences_markReadPlan(targets(1001), sidebarPreferences_markReadLimit).batches.map(
      (batch) => batch.length,
    ),
  ).toEqual([500, 500, 1]);

  const aliases = [
    { workspaceId: "workspace-a", sessionId: "same" },
    { workspaceId: "workspace-b", sessionId: "same" },
    { workspaceId: "workspace-a", sessionId: "other" },
  ];
  expect(sidebarPreferences_markReadPlan(aliases, sidebarPreferences_markReadLimit)).toEqual({
    targets: [
      { workspaceId: "workspace-a", sessionId: "same" },
      { workspaceId: "workspace-a", sessionId: "other" },
    ],
    batches: [
      [
        { workspaceId: "workspace-a", sessionId: "same" },
        { workspaceId: "workspace-a", sessionId: "other" },
      ],
    ],
    total: 2,
  });
});

test("mark-read keeps the confirmed snapshot and reports partial failure honestly", async () => {
  const mutableTargets = Array.from({ length: 501 }, (_, index) => ({
    workspaceId: "ws",
    sessionId: `session-${index}`,
  }));
  const plan = sidebarPreferences_markReadPlan(mutableTargets, sidebarPreferences_markReadLimit);
  mutableTargets.push({ workspaceId: "later", sessionId: "late-unread" });
  expect(plan.total).toBe(501);

  const attempted: number[] = [];
  const partial = await sidebarPreferences_executeMarkReadPlan(plan, async (batch) => {
    attempted.push(batch.length);
    if (attempted.length === 2) throw new Error("second batch failed");
  });
  expect(attempted).toEqual([500, 1]);
  expect(partial).toEqual({
    status: "partial",
    completed: 500,
    total: 501,
    error: "second batch failed",
  });

  const failed = await sidebarPreferences_executeMarkReadPlan(plan, async () => {
    throw new Error("first batch failed");
  });
  expect(failed.status).toBe("failed");
  expect(failed.completed).toBe(0);

  let calls = 0;
  const empty = await sidebarPreferences_executeMarkReadPlan(
    sidebarPreferences_markReadPlan([], sidebarPreferences_markReadLimit),
    async () => {
      calls += 1;
    },
  );
  expect(empty).toEqual({ status: "complete", completed: 0, total: 0 });
  expect(calls).toBe(0);
});
