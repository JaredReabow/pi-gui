import type { DesktopAppState, ScheduledTaskRecord } from "../../../contracts/desktop-state";

export type ScheduledTaskStatusActionTarget = "active" | "paused";
export type ScheduledTaskStatusActionPhase = "idle" | "pending" | "error";
/**
 * `false` means App kept a newer snapshot. `void` is retained only for the
 * bounded pre-shell fallback; the D07 App wrapper must return a boolean.
 */
export type ScheduledTaskSnapshotApplyResult = boolean | void;

export interface ScheduledTaskStatusActionState {
  readonly taskId: string;
  readonly phase: ScheduledTaskStatusActionPhase;
  readonly targetStatus?: ScheduledTaskStatusActionTarget;
  readonly error?: string;
  readonly authoritativeTask?: ScheduledTaskRecord;
}

export interface ScheduledTaskStatusActionResult {
  readonly success: boolean;
  readonly task?: ScheduledTaskRecord;
  readonly error?: string;
}

export function scheduledTaskStatusActionsActionWords(
  targetStatus: ScheduledTaskStatusActionTarget,
): { readonly verb: "Pause" | "Resume"; readonly pendingVerb: "Pausing" | "Resuming" } {
  return targetStatus === "active"
    ? { verb: "Resume", pendingVerb: "Resuming" }
    : { verb: "Pause", pendingVerb: "Pausing" };
}

/**
 * Shared status-action owner for scheduled task rows and bound-thread chips.
 *
 * Requests are scoped by task id and held pending until the returned snapshot
 * proves the exact intended status change. The controller owns policy; views
 * only render its state and invoke its public methods.
 */
export interface ScheduledTaskStatusActionsController {
  getState(taskId: string): ScheduledTaskStatusActionState;
  observeTask(task: ScheduledTaskRecord): void;
  syncTasks(tasks: readonly ScheduledTaskRecord[]): void;
  requestStatus(
    task: ScheduledTaskRecord,
    targetStatus: ScheduledTaskStatusActionTarget,
  ): Promise<ScheduledTaskStatusActionResult>;
  subscribe(listener: () => void): () => void;
}

export interface ScheduledTaskStatusActionsDependencies {
  updateScheduledTask(
    taskId: string,
    patch: { status: ScheduledTaskStatusActionTarget },
  ): Promise<DesktopAppState>;
  applySnapshot(snapshot: DesktopAppState): ScheduledTaskSnapshotApplyResult;
  /**
   * App integration should read the latest full task list here. Keeping this
   * as a getter lets removal invalidate an in-flight reply without rebuilding
   * the controller.
   */
  getCurrentTasks?: () => readonly ScheduledTaskRecord[];
}

interface PendingRequest {
  readonly taskId: string;
  readonly previousStatus: ScheduledTaskStatusActionTarget | "completed";
  readonly targetStatus: ScheduledTaskStatusActionTarget;
  readonly token: number;
}

const IDLE_PHASE = "idle" as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function taskStatusForAction(
  task: ScheduledTaskRecord,
): ScheduledTaskStatusActionTarget | "completed" {
  return task.status;
}

/**
 * App task records are ordered by their host-stamped update time. Equal times
 * still prefer the incoming App record so metadata changes are not hidden by a
 * cached action response.
 */
export function scheduledTaskStatusActionsTaskAtLeastAsNew(
  candidate: ScheduledTaskRecord,
  cached: ScheduledTaskRecord,
): boolean {
  const candidateTime = Date.parse(candidate.updatedAt);
  const cachedTime = Date.parse(cached.updatedAt);
  if (!Number.isNaN(candidateTime) && !Number.isNaN(cachedTime)) {
    return candidateTime >= cachedTime;
  }
  return candidate.updatedAt >= cached.updatedAt;
}

/**
 * Creates the one controller that scheduled-task surfaces should share.
 */
export function scheduledTaskStatusActionsCreateController(
  dependencies: ScheduledTaskStatusActionsDependencies,
): ScheduledTaskStatusActionsController {
  const listeners = new Set<() => void>();
  const states = new Map<string, ScheduledTaskStatusActionState>();
  const idleStates = new Map<string, ScheduledTaskStatusActionState>();
  const knownTasks = new Map<string, ScheduledTaskRecord>();
  const pendingRequests = new Map<string, PendingRequest>();
  const removedTaskIds = new Set<string>();
  let nextToken = 1;

  const notify = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const setState = (taskId: string, state: ScheduledTaskStatusActionState) => {
    states.set(taskId, state);
    notify();
  };

  const idleState = (taskId: string) => {
    let state = idleStates.get(taskId);
    if (!state) {
      state = { taskId, phase: IDLE_PHASE };
      idleStates.set(taskId, state);
    }
    return state;
  };

  const currentTask = (taskId: string) => {
    const appTask = dependencies.getCurrentTasks?.().find((task) => task.id === taskId);
    if (appTask) {
      return appTask;
    }
    const cachedTask = states.get(taskId)?.authoritativeTask;
    const knownTask = knownTasks.get(taskId);
    if (cachedTask && knownTask) {
      return scheduledTaskStatusActionsTaskAtLeastAsNew(cachedTask, knownTask)
        ? cachedTask
        : knownTask;
    }
    return cachedTask ?? knownTask;
  };

  const reconcileAuthoritativeTask = (task: ScheduledTaskRecord): boolean => {
    const previousState = states.get(task.id);
    if (!previousState) {
      return false;
    }
    const previousTask = previousState.authoritativeTask;
    if (previousTask) {
      if (
        previousTask === task ||
        !scheduledTaskStatusActionsTaskAtLeastAsNew(task, previousTask)
      ) {
        return false;
      }
    } else if (previousState.phase === IDLE_PHASE) {
      return false;
    }

    states.set(task.id, {
      ...previousState,
      authoritativeTask: task,
    });
    return true;
  };

  const finishError = (request: PendingRequest, error: string) => {
    if (pendingRequests.get(request.taskId)?.token !== request.token) {
      return;
    }
    pendingRequests.delete(request.taskId);
    const previous = states.get(request.taskId);
    const current = currentTask(request.taskId);
    setState(request.taskId, {
      taskId: request.taskId,
      phase: "error",
      targetStatus: request.targetStatus,
      error,
      ...((current ?? previous?.authoritativeTask)
        ? { authoritativeTask: current ?? previous?.authoritativeTask }
        : {}),
    });
  };

  const controller: ScheduledTaskStatusActionsController = {
    getState(taskId) {
      return states.get(taskId) ?? idleState(taskId);
    },

    observeTask(task) {
      const current = currentTask(task.id);
      if (current && !scheduledTaskStatusActionsTaskAtLeastAsNew(task, current)) {
        return;
      }
      const previousTask = knownTasks.get(task.id);
      knownTasks.set(task.id, task);
      const reconciled = reconcileAuthoritativeTask(task);
      if (previousTask !== task || reconciled) {
        notify();
      }
    },

    syncTasks(tasks) {
      const nextIds = new Set(tasks.map((task) => task.id));
      for (const task of tasks) {
        knownTasks.set(task.id, task);
        removedTaskIds.delete(task.id);
        reconcileAuthoritativeTask(task);
      }
      for (const taskId of [...knownTasks.keys()]) {
        if (!nextIds.has(taskId)) {
          knownTasks.delete(taskId);
          removedTaskIds.add(taskId);
          const pending = pendingRequests.get(taskId);
          if (pending) {
            pendingRequests.delete(taskId);
            const previous = states.get(taskId);
            states.set(taskId, {
              taskId,
              phase: "error",
              targetStatus: pending.targetStatus,
              error: "The scheduled task was removed before the update completed.",
              ...(previous?.authoritativeTask
                ? { authoritativeTask: previous.authoritativeTask }
                : {}),
            });
          } else {
            states.delete(taskId);
          }
        }
      }
      notify();
    },

    requestStatus(task, targetStatus) {
      const existing = pendingRequests.get(task.id);
      if (existing) {
        return Promise.resolve({
          success: false,
          error: "A status update is already pending for this scheduled task.",
        });
      }

      const authoritativeTask = currentTask(task.id) ?? task;
      if (authoritativeTask.status === "completed" || task.status === "completed") {
        const error = "Completed scheduled tasks cannot be reactivated.";
        setState(task.id, {
          taskId: task.id,
          phase: "error",
          targetStatus,
          error,
        });
        return Promise.resolve({ success: false, error });
      }
      if (authoritativeTask.status === targetStatus) {
        const error = `The scheduled task is already ${targetStatus}.`;
        setState(task.id, {
          taskId: task.id,
          phase: "error",
          targetStatus,
          error,
        });
        return Promise.resolve({ success: false, error });
      }

      const request: PendingRequest = {
        taskId: task.id,
        previousStatus: taskStatusForAction(authoritativeTask),
        targetStatus,
        token: nextToken++,
      };
      knownTasks.set(task.id, authoritativeTask);
      pendingRequests.set(task.id, request);
      const previousState = states.get(task.id);
      setState(task.id, {
        taskId: task.id,
        phase: "pending",
        targetStatus,
        ...(previousState?.authoritativeTask
          ? { authoritativeTask: previousState.authoritativeTask }
          : {}),
      });

      return dependencies
        .updateScheduledTask(task.id, { status: targetStatus })
        .then((snapshot) => {
          if (pendingRequests.get(task.id)?.token !== request.token) {
            return {
              success: false,
              error: "The scheduled task changed before the update completed.",
            } satisfies ScheduledTaskStatusActionResult;
          }
          if (snapshot.lastError) {
            finishError(request, snapshot.lastError);
            return { success: false, error: snapshot.lastError };
          }

          const current = currentTask(task.id);
          if (!current) {
            const error = "The scheduled task was removed before the update completed.";
            finishError(request, error);
            return { success: false, error };
          }

          const returnedTask = snapshot.scheduledTasks.find((entry) => entry.id === task.id);
          if (!returnedTask) {
            const error = "The update response did not include the scheduled task.";
            finishError(request, error);
            return { success: false, error };
          }
          if (returnedTask.status === request.previousStatus) {
            const error = "The scheduled task snapshot did not change.";
            finishError(request, error);
            return { success: false, error };
          }
          if (returnedTask.status !== targetStatus) {
            const error = `The scheduled task returned ${returnedTask.status} instead of ${targetStatus}.`;
            finishError(request, error);
            return { success: false, error };
          }

          const safeSnapshot =
            removedTaskIds.size === 0
              ? snapshot
              : {
                  ...snapshot,
                  scheduledTasks: snapshot.scheduledTasks.filter(
                    (entry) => !removedTaskIds.has(entry.id),
                  ),
                };
          const snapshotAccepted = dependencies.applySnapshot(safeSnapshot);
          if (snapshotAccepted === false) {
            const error =
              "A newer scheduled task snapshot was already applied; retry from the current state.";
            finishError(request, error);
            return { success: false, error };
          }
          knownTasks.set(task.id, returnedTask);
          pendingRequests.delete(task.id);
          setState(task.id, {
            taskId: task.id,
            phase: IDLE_PHASE,
            targetStatus,
            authoritativeTask: returnedTask,
          });
          return { success: true, task: returnedTask };
        })
        .catch((error: unknown) => {
          const message = errorMessage(error);
          finishError(request, message);
          return { success: false, error: message };
        });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return Object.freeze(controller);
}
