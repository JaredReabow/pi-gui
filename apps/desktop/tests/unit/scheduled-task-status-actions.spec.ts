import { expect, test } from "@playwright/test";
import type { DesktopAppState, ScheduledTaskRecord } from "../../contracts/desktop-state";
import {
  scheduledTaskStatusActionsActionWords,
  scheduledTaskStatusActionsCreateController,
} from "../../src/features/scheduled-tasks/scheduled-task-status-actions";

function scheduledTask(
  id: string,
  status: ScheduledTaskRecord["status"],
  title = id,
): ScheduledTaskRecord {
  return {
    id,
    title,
    instruction: `Instruction for ${title}`,
    status,
    schedule: { kind: "interval", everyMs: 60_000 },
    target: { kind: "new-thread", workspaceId: "workspace-1" },
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: status === "active" ? "2026-10-31T00:00:00.000Z" : "2026-10-31T00:01:00.000Z",
    runs: [],
  };
}

function revisedTask(
  task: ScheduledTaskRecord,
  overrides: Partial<ScheduledTaskRecord>,
): ScheduledTaskRecord {
  return { ...task, ...overrides };
}

function snapshot(
  tasks: readonly ScheduledTaskRecord[],
  lastError?: string,
  revision = 2,
): DesktopAppState {
  return {
    revision,
    scheduledTasks: tasks,
    ...(lastError ? { lastError } : {}),
  } as DesktopAppState;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createController(
  updateScheduledTask: (
    taskId: string,
    patch: { status: "active" | "paused" },
  ) => Promise<DesktopAppState>,
  tasks: readonly ScheduledTaskRecord[],
) {
  const applied: DesktopAppState[] = [];
  let currentTasks = tasks;
  const controller = scheduledTaskStatusActionsCreateController({
    updateScheduledTask,
    applySnapshot: (next) => {
      applied.push(next);
      return true;
    },
    getCurrentTasks: () => currentTasks,
  });
  controller.syncTasks(tasks);
  return {
    controller,
    applied,
    setCurrentTasks(next: readonly ScheduledTaskRecord[]) {
      currentTasks = next;
      controller.syncTasks(next);
    },
  };
}

function createRevisionFixture(
  initial: DesktopAppState,
  updateScheduledTask: (
    taskId: string,
    patch: { status: "active" | "paused" },
  ) => Promise<DesktopAppState>,
) {
  let live = initial;
  const applied: DesktopAppState[] = [];
  const controller = scheduledTaskStatusActionsCreateController({
    updateScheduledTask,
    applySnapshot: (next) => {
      applied.push(next);
      if (next.revision < live.revision) {
        return false;
      }
      live = next;
      return true;
    },
    getCurrentTasks: () => live.scheduledTasks,
  });
  controller.syncTasks(initial.scheduledTasks);
  return {
    controller,
    applied,
    live: () => live,
  };
}

test("status actions remain pending once, then apply the exact returned task", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  const pendingReply = deferred<DesktopAppState>();
  const updates: Array<{ taskId: string; status: string }> = [];
  const fixture = createController(
    async (taskId, patch) => {
      updates.push({ taskId, status: patch.status });
      return pendingReply.promise;
    },
    [active],
  );

  const first = fixture.controller.requestStatus(active, "paused");
  expect(fixture.controller.getState(active.id)).toMatchObject({
    phase: "pending",
    targetStatus: "paused",
  });
  const duplicate = await fixture.controller.requestStatus(active, "paused");
  expect(duplicate).toMatchObject({ success: false });
  expect(updates).toEqual([{ taskId: active.id, status: "paused" }]);

  const paused = scheduledTask(active.id, "paused", active.title);
  pendingReply.resolve(snapshot([paused]));
  await expect(first).resolves.toMatchObject({ success: true, task: paused });
  expect(fixture.controller.getState(active.id)).toMatchObject({
    phase: "idle",
    authoritativeTask: paused,
  });
  expect(fixture.applied).toHaveLength(1);
  expect(fixture.applied[0]?.scheduledTasks[0]?.status).toBe("paused");
});

test("resolved error and unchanged snapshots are failures and preserve prior state", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  const errorFixture = createController(
    async () => snapshot([active], "Could not save scheduled task"),
    [active],
  );
  await expect(errorFixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: false,
    error: "Could not save scheduled task",
  });
  expect(errorFixture.controller.getState(active.id).phase).toBe("error");
  expect(errorFixture.applied).toHaveLength(0);

  const unchangedFixture = createController(async () => snapshot([active]), [active]);
  await expect(unchangedFixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: false,
    error: "The scheduled task snapshot did not change.",
  });
  expect(unchangedFixture.controller.getState(active.id).phase).toBe("error");
  expect(unchangedFixture.applied).toHaveLength(0);

  const mismatchFixture = createController(
    async () => snapshot([scheduledTask(active.id, "completed", active.title)]),
    [active],
  );
  await expect(mismatchFixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: false,
    error: "The scheduled task returned completed instead of paused.",
  });
  expect(mismatchFixture.applied).toHaveLength(0);
});

test("rejected updates retain the last authoritative task and allow retry", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  let attempt = 0;
  const fixture = createController(async () => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error("transport failed");
    }
    return snapshot([scheduledTask(active.id, "paused", active.title)]);
  }, [active]);

  await expect(fixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: false,
    error: "transport failed",
  });
  expect(fixture.controller.getState(active.id)).toMatchObject({
    phase: "error",
    error: "transport failed",
  });
  expect(fixture.applied).toHaveLength(0);

  await expect(fixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: true,
  });
  expect(attempt).toBe(2);
  expect(fixture.controller.getState(active.id).authoritativeTask?.status).toBe("paused");
});

test("completed tasks cannot be reactivated and removed requests cannot change another task", async () => {
  const completed = scheduledTask("completed", "completed", "Finished");
  const activeA = scheduledTask("task-a", "active", "Alpha");
  const activeB = scheduledTask("task-b", "active", "Bravo");
  let updateCalls = 0;
  const firstReply = deferred<DesktopAppState>();
  const fixture = createController(async () => {
    updateCalls += 1;
    return firstReply.promise;
  }, [completed, activeA, activeB]);

  await expect(fixture.controller.requestStatus(completed, "active")).resolves.toMatchObject({
    success: false,
    error: "Completed scheduled tasks cannot be reactivated.",
  });
  expect(updateCalls).toBe(0);

  const first = fixture.controller.requestStatus(activeA, "paused");
  fixture.setCurrentTasks([activeB]);
  expect(fixture.controller.getState(activeA.id)).toMatchObject({
    phase: "error",
    error: "The scheduled task was removed before the update completed.",
  });

  firstReply.resolve(snapshot([scheduledTask(activeA.id, "paused", activeA.title), activeB]));
  await expect(first).resolves.toMatchObject({ success: false });
  expect(fixture.applied).toHaveLength(0);
  expect(fixture.controller.getState(activeB.id).phase).toBe("idle");
});

test("out-of-order replies stay scoped to their captured task ids", async () => {
  const activeA = scheduledTask("task-a", "active", "Alpha");
  const activeB = scheduledTask("task-b", "active", "Bravo");
  const replies = new Map<string, ReturnType<typeof deferred<DesktopAppState>>>();
  const fixture = createController(
    async (taskId) => {
      const reply = deferred<DesktopAppState>();
      replies.set(taskId, reply);
      return reply.promise;
    },
    [activeA, activeB],
  );

  const pauseA = fixture.controller.requestStatus(activeA, "paused");
  const pauseB = fixture.controller.requestStatus(activeB, "paused");
  expect(replies.size).toBe(2);

  const pausedB = scheduledTask(activeB.id, "paused", activeB.title);
  replies.get(activeB.id)?.resolve(snapshot([activeA, pausedB]));
  await expect(pauseB).resolves.toMatchObject({ success: true, task: pausedB });

  const pausedA = scheduledTask(activeA.id, "paused", activeA.title);
  const finalSnapshot = fixture.applied[0] ?? snapshot([pausedA, pausedB]);
  replies
    .get(activeA.id)
    ?.resolve(
      snapshot([pausedA, ...finalSnapshot.scheduledTasks.filter((task) => task.id !== activeA.id)]),
    );
  await expect(pauseA).resolves.toMatchObject({ success: true, task: pausedA });

  expect(fixture.controller.getState(activeA.id).authoritativeTask?.status).toBe("paused");
  expect(fixture.controller.getState(activeB.id).authoritativeTask?.status).toBe("paused");
  expect(fixture.applied).toHaveLength(2);
});

test("pending and error transitions expose the target without replacing prior state", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  const failedReply = deferred<DesktopAppState>();
  const fixture = createController(async () => failedReply.promise, [active]);

  const request = fixture.controller.requestStatus(active, "paused");
  expect(fixture.controller.getState(active.id)).toEqual({
    taskId: active.id,
    phase: "pending",
    targetStatus: "paused",
  });
  expect(active.status).toBe("active");

  failedReply.reject(new Error("fixture transport failed"));
  await expect(request).resolves.toMatchObject({
    success: false,
    error: "fixture transport failed",
  });
  expect(fixture.controller.getState(active.id)).toMatchObject({
    phase: "error",
    targetStatus: "paused",
    error: "fixture transport failed",
  });
  expect(active.status).toBe("active");
});

test("a successful action is superseded by an authoritative resume or completion", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  const paused = scheduledTask(active.id, "paused", active.title);
  const resumed = revisedTask(paused, {
    title: "Alpha resumed",
    status: "active",
    updatedAt: "2026-10-31T00:02:00.000Z",
  });
  const fixture = createController(async () => snapshot([paused]), [active]);

  await expect(fixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: true,
  });
  fixture.setCurrentTasks([resumed]);
  expect(fixture.controller.getState(active.id)).toMatchObject({
    phase: "idle",
    authoritativeTask: {
      status: "active",
      title: "Alpha resumed",
    },
  });

  const completed = revisedTask(resumed, {
    status: "completed",
    title: "Alpha complete",
    updatedAt: "2026-10-31T00:03:00.000Z",
    completedAt: "2026-10-31T00:03:00.000Z",
  });
  fixture.setCurrentTasks([completed]);
  expect(fixture.controller.getState(active.id)).toMatchObject({
    phase: "idle",
    authoritativeTask: {
      status: "completed",
      title: "Alpha complete",
      completedAt: "2026-10-31T00:03:00.000Z",
    },
  });
});

test("authoritative title and metadata updates supersede cached action results", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  const paused = scheduledTask(active.id, "paused", active.title);
  const metadataUpdate = revisedTask(paused, {
    title: "Renamed Alpha",
    instruction: "Updated authoritative instruction",
    nextRunAt: "2026-11-01T01:00:00.000Z",
    updatedAt: "2026-10-31T00:04:00.000Z",
  });
  const fixture = createController(async () => snapshot([paused]), [active]);

  await fixture.controller.requestStatus(active, "paused");
  fixture.controller.observeTask(metadataUpdate);

  expect(fixture.controller.getState(active.id)).toMatchObject({
    phase: "idle",
    authoritativeTask: {
      title: "Renamed Alpha",
      instruction: "Updated authoritative instruction",
      nextRunAt: "2026-11-01T01:00:00.000Z",
    },
  });
});

test("older partial observations cannot replace the newer fallback action result", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  const paused = revisedTask(scheduledTask(active.id, "paused", active.title), {
    updatedAt: "2026-10-31T00:02:00.000Z",
  });
  const resumed = revisedTask(active, {
    title: "Alpha resumed",
    updatedAt: "2026-10-31T00:04:00.000Z",
  });
  const requests: Array<{ taskId: string; target: "active" | "paused" }> = [];
  let attempt = 0;
  const controller = scheduledTaskStatusActionsCreateController({
    updateScheduledTask: async (taskId, patch) => {
      requests.push({ taskId, target: patch.status });
      attempt += 1;
      return snapshot([attempt === 1 ? paused : resumed]);
    },
    applySnapshot: () => true,
  });
  controller.syncTasks([active]);

  await expect(controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: true,
    task: { status: "paused" },
  });
  const olderPartial = revisedTask(active, {
    title: "Older partial",
    updatedAt: "2026-10-31T00:01:00.000Z",
  });
  controller.observeTask(olderPartial);
  expect(controller.getState(active.id)).toMatchObject({
    phase: "idle",
    authoritativeTask: {
      status: "paused",
      title: "Alpha",
      updatedAt: "2026-10-31T00:02:00.000Z",
    },
  });

  await expect(controller.requestStatus(olderPartial, "active")).resolves.toMatchObject({
    success: true,
    task: { status: "active" },
  });
  expect(requests).toEqual([
    { taskId: active.id, target: "paused" },
    { taskId: active.id, target: "active" },
  ]);
});

test("pending and error feedback survive newer authoritative task data", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  const pendingReply = deferred<DesktopAppState>();
  const pendingFixture = createController(async () => pendingReply.promise, [active]);
  const pendingRequest = pendingFixture.controller.requestStatus(active, "paused");
  const pendingUpdate = revisedTask(active, {
    title: "Alpha while pending",
    updatedAt: "2026-10-31T00:05:00.000Z",
  });

  pendingFixture.setCurrentTasks([pendingUpdate]);
  expect(pendingFixture.controller.getState(active.id)).toMatchObject({
    phase: "pending",
    targetStatus: "paused",
    authoritativeTask: { title: "Alpha while pending", status: "active" },
  });
  pendingReply.resolve(
    snapshot([
      revisedTask(pendingUpdate, {
        status: "paused",
        updatedAt: "2026-10-31T00:06:00.000Z",
      }),
    ]),
  );
  await expect(pendingRequest).resolves.toMatchObject({ success: true });

  const errorFixture = createController(async () => {
    throw new Error("fixture transport failed");
  }, [active]);
  await expect(errorFixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: false,
    error: "fixture transport failed",
  });
  const errorUpdate = revisedTask(active, {
    title: "Alpha while failed",
    instruction: "Current instruction after failure",
    updatedAt: "2026-10-31T00:07:00.000Z",
  });
  errorFixture.setCurrentTasks([errorUpdate]);
  expect(errorFixture.controller.getState(active.id)).toMatchObject({
    phase: "error",
    targetStatus: "paused",
    error: "fixture transport failed",
    authoritativeTask: {
      title: "Alpha while failed",
      instruction: "Current instruction after failure",
    },
  });
});

test("failed Resume wording remains Resume after authoritative completion", async () => {
  const paused = revisedTask(scheduledTask("task-a", "paused", "Alpha"), {
    updatedAt: "2026-10-31T00:01:00.000Z",
  });
  const completed = revisedTask(scheduledTask(paused.id, "completed", "Alpha complete"), {
    updatedAt: "2026-10-31T00:03:00.000Z",
    completedAt: "2026-10-31T00:03:00.000Z",
  });
  const failedReply = deferred<DesktopAppState>();
  const fixture = createController(async () => failedReply.promise, [paused]);
  const request = fixture.controller.requestStatus(paused, "active");
  fixture.setCurrentTasks([completed]);

  failedReply.reject(new Error("fixture transport failed"));
  await expect(request).resolves.toMatchObject({
    success: false,
    error: "fixture transport failed",
  });
  const state = fixture.controller.getState(paused.id);
  expect(state).toMatchObject({
    phase: "error",
    targetStatus: "active",
    error: "fixture transport failed",
    authoritativeTask: {
      status: "completed",
      title: "Alpha complete",
    },
  });
  expect(state.targetStatus && scheduledTaskStatusActionsActionWords(state.targetStatus).verb).toBe(
    "Resume",
  );
});

test("a stale first reply fails and preserves the newer active task", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  let attempt = 0;
  const fixture = createRevisionFixture(snapshot([active], undefined, 40), async () => {
    attempt += 1;
    return snapshot(
      [scheduledTask(active.id, "paused", active.title)],
      undefined,
      attempt === 1 ? 39 : 41,
    );
  });

  await expect(fixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: false,
    error: "A newer scheduled task snapshot was already applied; retry from the current state.",
  });
  expect(fixture.live().revision).toBe(40);
  expect(fixture.live().scheduledTasks[0]?.status).toBe("active");
  expect(fixture.controller.getState(active.id)).toMatchObject({
    phase: "error",
    authoritativeTask: { status: "active" },
  });

  await expect(fixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: true,
    task: { status: "paused" },
  });
  expect(fixture.live().revision).toBe(41);
  expect(fixture.live().scheduledTasks[0]?.status).toBe("paused");
});

test("out-of-order replies reject the older task while retaining the newer task", async () => {
  const alpha = scheduledTask("task-a", "active", "Alpha");
  const bravo = scheduledTask("task-b", "active", "Bravo");
  const replies = new Map<string, ReturnType<typeof deferred<DesktopAppState>>>();
  const fixture = createRevisionFixture(snapshot([alpha, bravo], undefined, 50), async (taskId) => {
    const reply = deferred<DesktopAppState>();
    replies.set(taskId, reply);
    return reply.promise;
  });

  const pauseAlpha = fixture.controller.requestStatus(alpha, "paused");
  const pauseBravo = fixture.controller.requestStatus(bravo, "paused");

  const pausedBravo = scheduledTask(bravo.id, "paused", bravo.title);
  replies.get(bravo.id)?.resolve(snapshot([alpha, pausedBravo], undefined, 51));
  await expect(pauseBravo).resolves.toMatchObject({ success: true, task: pausedBravo });

  replies
    .get(alpha.id)
    ?.resolve(
      snapshot(
        [
          scheduledTask(alpha.id, "paused", alpha.title),
          scheduledTask(bravo.id, "active", bravo.title),
        ],
        undefined,
        50,
      ),
    );
  await expect(pauseAlpha).resolves.toMatchObject({
    success: false,
    error: "A newer scheduled task snapshot was already applied; retry from the current state.",
  });

  expect(fixture.live().revision).toBe(51);
  expect(fixture.live().scheduledTasks.map((task) => [task.id, task.status])).toEqual([
    [alpha.id, "active"],
    [bravo.id, "paused"],
  ]);
  expect(fixture.controller.getState(alpha.id)).toMatchObject({
    phase: "error",
    authoritativeTask: { status: "active" },
  });
  expect(fixture.controller.getState(bravo.id).authoritativeTask?.status).toBe("paused");
});

test("equal and higher revisions remain accepted successes", async () => {
  const active = scheduledTask("task-a", "active", "Alpha");
  let attempt = 0;
  const fixture = createRevisionFixture(snapshot([active], undefined, 60), async () => {
    attempt += 1;
    if (attempt === 1) {
      return snapshot([scheduledTask(active.id, "paused", active.title)], undefined, 60);
    }
    return snapshot([scheduledTask(active.id, "active", active.title)], undefined, 61);
  });

  const paused = scheduledTask(active.id, "paused", active.title);
  await expect(fixture.controller.requestStatus(active, "paused")).resolves.toMatchObject({
    success: true,
    task: paused,
  });
  expect(fixture.live().revision).toBe(60);

  fixture.controller.syncTasks([paused]);
  await expect(fixture.controller.requestStatus(paused, "active")).resolves.toMatchObject({
    success: true,
    task: { status: "active" },
  });
  expect(fixture.live().revision).toBe(61);
  expect(fixture.applied.map((state) => state.revision)).toEqual([60, 61]);
});
