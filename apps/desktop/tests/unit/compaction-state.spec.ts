import { expect, test } from "@playwright/test";
import type { SessionCompactionProgress } from "@pi-gui/session-driver";
import type { SessionRecord } from "../../contracts/desktop-state";
import { updateSessionRecord } from "../../electron/conversation/app-store-session-state";

const active: SessionCompactionProgress = {
  phase: "summarizing",
  reason: "manual",
  startedAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:01.000Z",
};
const session: SessionRecord = {
  id: "thread",
  title: "Fixture",
  updatedAt: active.startedAt,
  preview: "",
  status: "idle",
  hasUnseenUpdate: false,
};
const base = {
  transcript: [],
  preview: undefined,
  runningSince: undefined,
  lastViewedAt: undefined,
};

test("late idle hydration cannot hide ordered active compaction", () => {
  const result = updateSessionRecord(
    { ...session, status: "running", compaction: active },
    {
      ...base,
      snapshot: { status: "idle", compaction: undefined },
      compactionObservation: { value: active },
    },
  );
  expect(result.status).toBe("running");
  expect(result.compaction).toEqual(active);
});

test("ordered absence prevents an old active hydration snapshot from reviving a finished job", () => {
  const result = updateSessionRecord(session, {
    ...base,
    snapshot: { status: "running", compaction: active },
    compactionObservation: { value: undefined },
  });
  expect(result.status).toBe("idle");
  expect(result.compaction).toBeUndefined();
});

test("stale pre-compaction hydration cannot replace the current failure", () => {
  const failed = { ...active, phase: "failed" as const, errorMessage: "HTTP 400 rejected" };
  const result = updateSessionRecord(
    { ...session, status: "failed", compaction: failed },
    {
      ...base,
      snapshot: { status: "idle", compaction: undefined },
      compactionObservation: { value: failed },
    },
  );
  expect(result.status).toBe("failed");
  expect(result.compaction).toEqual(failed);
});

test("absence does not suppress an ordinary non-compaction running snapshot", () => {
  const result = updateSessionRecord(session, {
    ...base,
    snapshot: { status: "running" },
    compactionObservation: { value: undefined },
  });
  expect(result.status).toBe("running");
  expect(result.compaction).toBeUndefined();
});
