import type { ScheduledTaskRecord } from "../../../contracts/desktop-state";
import { formatScheduledTaskRowMeta } from "../../../contracts/scheduled-tasks";
import {
  scheduledTaskStatusActionsActionWords,
  type ScheduledTaskStatusActionsController,
} from "./scheduled-task-status-actions";
import { useScheduledTaskStatusActions } from "./use-scheduled-task-status-actions";

interface ScheduledTaskChipProps {
  readonly task: ScheduledTaskRecord;
  readonly tasks?: readonly ScheduledTaskRecord[];
  readonly onOpen: () => void;
  readonly statusActions?: ScheduledTaskStatusActionsController;
}

export function ScheduledTaskChip({ task, tasks, onOpen, statusActions }: ScheduledTaskChipProps) {
  const statusAction = useScheduledTaskStatusActions({
    controller: statusActions,
    task,
    tasks,
  });
  const effectiveTask = statusAction.task;
  const isPending = statusAction.state.phase === "pending";
  const isPaused = effectiveTask.status === "paused";
  const canToggleStatus = effectiveTask.status !== "completed";
  const targetStatus = isPaused ? "active" : "paused";
  const verb = isPaused ? "Resume" : "Pause";
  const actionWords = statusAction.state.targetStatus
    ? scheduledTaskStatusActionsActionWords(statusAction.state.targetStatus)
    : scheduledTaskStatusActionsActionWords(targetStatus);
  const errorVerb = actionWords.verb;
  const pendingVerb = actionWords.pendingVerb;
  const errorId = `scheduled-task-chip-status-error-${effectiveTask.id}`;

  return (
    <div
      className="scheduled-task-chip"
      data-task-id={effectiveTask.id}
      data-testid="scheduled-task-chip"
    >
      <div className="scheduled-task-chip__summary">
        <span>{formatScheduledTaskRowMeta(effectiveTask)}</span>
        {statusAction.state.phase === "error" ? (
          <span
            className="scheduled-task-status-action__error"
            data-testid="scheduled-task-chip-status-error"
            id={errorId}
            role="alert"
          >
            {errorVerb} failed: {statusAction.state.error}
          </span>
        ) : null}
      </div>
      <div className="scheduled-task-chip__actions">
        {canToggleStatus ? (
          <button
            className="button button--secondary scheduled-task-status-action"
            data-phase={statusAction.state.phase}
            data-task-id={effectiveTask.id}
            data-testid="scheduled-task-chip-status-action"
            type="button"
            aria-busy={isPending}
            aria-describedby={statusAction.state.phase === "error" ? errorId : undefined}
            aria-label={
              isPending
                ? `${pendingVerb} scheduled task ${effectiveTask.title}`
                : `${verb} scheduled task ${effectiveTask.title}`
            }
            disabled={isPending}
            onClick={() => {
              void statusAction.requestStatus(targetStatus).catch((error: unknown) => {
                console.error("[renderer] scheduled task status action failed", error);
              });
            }}
          >
            {isPending ? `${pendingVerb}...` : verb}
          </button>
        ) : null}
        <button className="button button--secondary" type="button" onClick={onOpen}>
          Open
        </button>
      </div>
    </div>
  );
}
