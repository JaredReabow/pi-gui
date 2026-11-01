import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import type { ScheduledTaskRecord } from "../../../contracts/desktop-state";
import {
  scheduledTaskStatusActionsCreateController,
  scheduledTaskStatusActionsTaskAtLeastAsNew,
  type ScheduledTaskStatusActionState,
  type ScheduledTaskStatusActionsController,
  type ScheduledTaskStatusActionTarget,
} from "./scheduled-task-status-actions";

interface UseScheduledTaskStatusActionsInput {
  readonly controller?: ScheduledTaskStatusActionsController;
  readonly task: ScheduledTaskRecord;
  /**
   * Pass the full task list when the surface has it. A partial surface can
   * observe its own task and rely on App's controller getter for removal checks.
   */
  readonly tasks?: readonly ScheduledTaskRecord[];
}

export interface UseScheduledTaskStatusActionsResult {
  readonly task: ScheduledTaskRecord;
  readonly state: ScheduledTaskStatusActionState;
  readonly requestStatus: (targetStatus: ScheduledTaskStatusActionTarget) => Promise<unknown>;
}

let fallbackController: ScheduledTaskStatusActionsController | undefined;

function getFallbackController(): ScheduledTaskStatusActionsController {
  if (!fallbackController) {
    fallbackController = scheduledTaskStatusActionsCreateController({
      updateScheduledTask: (taskId, patch) => {
        const api = globalThis.window?.piApp;
        if (!api) {
          return Promise.reject(new Error("Desktop IPC bridge is unavailable."));
        }
        return api.updateScheduledTask(taskId, patch);
      },
      applySnapshot: () => {
        // The fallback keeps its own authoritative task record until D07
        // supplies App's one controller and snapshot applier.
        return true;
      },
    });
  }
  return fallbackController;
}

/**
 * Subscribes a scheduled-task surface to the shared status-action controller.
 */
export function useScheduledTaskStatusActions({
  controller,
  task,
  tasks,
}: UseScheduledTaskStatusActionsInput): UseScheduledTaskStatusActionsResult {
  const activeController = controller ?? getFallbackController();
  const taskId = task.id;
  const getState = useCallback(() => activeController.getState(taskId), [activeController, taskId]);
  const subscribe = useCallback(
    (listener: () => void) => activeController.subscribe(listener),
    [activeController],
  );
  const state = useSyncExternalStore(subscribe, getState, getState);

  useLayoutEffect(() => {
    if (tasks) {
      activeController.syncTasks(tasks);
    } else {
      activeController.observeTask(task);
    }
  }, [activeController, task, tasks]);

  const requestStatus = useCallback(
    (targetStatus: ScheduledTaskStatusActionTarget) =>
      activeController.requestStatus(task, targetStatus),
    [activeController, task],
  );

  const effectiveTask =
    state.authoritativeTask &&
    !scheduledTaskStatusActionsTaskAtLeastAsNew(task, state.authoritativeTask)
      ? state.authoritativeTask
      : task;

  return {
    task: effectiveTask,
    state,
    requestStatus,
  };
}
