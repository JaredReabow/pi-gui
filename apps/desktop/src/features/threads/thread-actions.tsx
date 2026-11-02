import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { SessionRecord } from "../../../contracts/desktop-state";
import { formatShortcut } from "../../../contracts/ipc";
import { trapDialogFocus } from "../../ui/dialog-focus";
import {
  ArchiveIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  ForkIcon,
  PencilIcon,
  PinIcon,
  RestoreIcon,
} from "../../ui/icons";

/**
 * The one list of things a thread can do. The thread header menu, the sidebar
 * row's right-click menu and the command palette all render this list, so they
 * cannot drift apart.
 */
export type ThreadActionId =
  | "rename-thread"
  | "branch-same-project"
  | "branch-existing-project"
  | "pin-thread"
  | "archive-thread"
  | "restore-thread"
  | "mark-read"
  | "scheduled-task"
  | "copy-session-id";

export interface ThreadAction {
  readonly id: ThreadActionId;
  readonly title: string;
  readonly icon: ReactNode;
  readonly hint?: string;
  readonly run: () => void;
}

/** The thread an action applies to. Sidebar entries and the open thread both fit. */
export interface ThreadActionSubject {
  readonly workspaceId: string;
  readonly session: SessionRecord;
}

export interface ThreadActionHandlers {
  readonly platform: NodeJS.Platform;
  readonly hasScheduledTask: (subject: ThreadActionSubject) => boolean;
  readonly startRename: (subject: ThreadActionSubject) => void;
  readonly branchSameProject: (subject: ThreadActionSubject) => void;
  readonly chooseBranchProject: (subject: ThreadActionSubject) => void;
  readonly setPinned: (subject: ThreadActionSubject, pinned: boolean) => void;
  readonly archive: (subject: ThreadActionSubject) => void;
  readonly restore: (subject: ThreadActionSubject) => void;
  readonly markRead: (subject: ThreadActionSubject) => void;
  readonly openScheduledTask: (subject: ThreadActionSubject) => void;
  readonly copySessionId: (subject: ThreadActionSubject) => void;
}

export function renameThreadShortcut(platform: NodeJS.Platform): string {
  return formatShortcut(platform, "R", { shift: true });
}

export function archiveThreadShortcut(platform: NodeJS.Platform): string {
  return formatShortcut(platform, "A", { shift: true });
}

export function buildThreadActions(
  subject: ThreadActionSubject,
  handlers: ThreadActionHandlers,
): readonly ThreadAction[] {
  const { session } = subject;
  const archived = Boolean(session.archivedAt);
  const pinned = Boolean(session.pinnedAt);
  const actions: ThreadAction[] = [
    {
      id: "rename-thread",
      title: "Rename thread",
      icon: <PencilIcon />,
      hint: renameThreadShortcut(handlers.platform),
      run: () => handlers.startRename(subject),
    },
    {
      id: "branch-same-project",
      title: "Branch in same project",
      icon: <ForkIcon />,
      run: () => handlers.branchSameProject(subject),
    },
    {
      id: "branch-existing-project",
      title: "Branch into existing project…",
      icon: <ForkIcon />,
      run: () => handlers.chooseBranchProject(subject),
    },
  ];
  if (archived) {
    actions.push({
      id: "restore-thread",
      title: "Restore thread",
      icon: <RestoreIcon />,
      run: () => handlers.restore(subject),
    });
  } else {
    actions.push(
      {
        id: "pin-thread",
        title: pinned ? "Unpin thread" : "Pin thread",
        icon: <PinIcon filled={pinned} />,
        run: () => handlers.setPinned(subject, !pinned),
      },
      {
        id: "archive-thread",
        title: "Archive thread",
        icon: <ArchiveIcon />,
        hint: archiveThreadShortcut(handlers.platform),
        run: () => handlers.archive(subject),
      },
    );
  }
  if (session.hasUnseenUpdate) {
    actions.push({
      id: "mark-read",
      title: "Mark as read",
      icon: <CheckIcon />,
      run: () => handlers.markRead(subject),
    });
  }
  actions.push(
    {
      id: "scheduled-task",
      title: handlers.hasScheduledTask(subject) ? "Edit scheduled task…" : "Add scheduled task…",
      icon: <ClockIcon />,
      run: () => handlers.openScheduledTask(subject),
    },
    {
      id: "copy-session-id",
      title: "Copy session ID",
      icon: <CopyIcon />,
      run: () => handlers.copySessionId(subject),
    },
  );
  return actions;
}

interface ThreadActionsMenuProps {
  readonly actions: readonly ThreadAction[];
  readonly className: string;
}

export function ThreadActionsMenu({ actions, className }: ThreadActionsMenuProps) {
  return (
    <div className={`workspace-menu ${className}`} role="menu">
      {actions.map((action) => (
        <button
          key={action.id}
          className="workspace-menu__item"
          data-thread-action={action.id}
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            action.run();
          }}
        >
          <span>{action.title}</span>
          {action.hint ? (
            <span className="workspace-menu__shortcut" aria-hidden="true">
              {action.hint}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export interface BranchProjectOption {
  readonly workspaceId: string;
  readonly name: string;
  readonly path: string;
  readonly isWorktree: boolean;
}

export interface BranchProjectPickerState {
  readonly sourceTitle: string;
  readonly projects: readonly BranchProjectOption[];
  readonly submittingWorkspaceId?: string;
  readonly error?: string;
}

interface BranchProjectPickerProps {
  readonly state: BranchProjectPickerState;
  readonly onClose: () => void;
  readonly onSelect: (workspaceId: string) => void;
}

export function BranchProjectPicker({ state, onClose, onSelect }: BranchProjectPickerProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const submitting = state.submittingWorkspaceId !== undefined;

  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLButtonElement>("[data-branch-project]:not(:disabled)")
      ?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      trapDialogFocus(event, dialogRef.current);
      return;
    }
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="tree-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        aria-label="Branch into existing project"
        aria-modal="true"
        className="tree-modal tree-modal--compact"
        data-testid="branch-project-picker"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="tree-modal__header">
          <div>
            <div className="tree-modal__eyebrow">Branch conversation</div>
            <h2 className="tree-modal__title">Choose a project</h2>
          </div>
          <button
            aria-label="Close project picker"
            className="tree-modal__close"
            disabled={submitting}
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {state.error ? (
          <div className="tree-modal__error error-banner" data-testid="branch-project-error">
            {state.error}
          </div>
        ) : null}

        <div className="tree-modal__summary-step">
          <div className="tree-modal__summary-copy">
            Copy “{state.sourceTitle}” and its current conversation into another project. The
            original thread remains unchanged.
          </div>
          {state.projects.length > 0 ? (
            <div
              aria-label="Projects"
              className="tree-modal__list branch-project-picker__list"
              data-testid="branch-project-options"
              role="listbox"
            >
              {state.projects.map((project) => {
                const projectSubmitting = state.submittingWorkspaceId === project.workspaceId;
                return (
                  <button
                    key={project.workspaceId}
                    aria-label={`Branch into ${project.name}`}
                    className="tree-modal__node branch-project-picker__option"
                    data-branch-project="true"
                    data-workspace-id={project.workspaceId}
                    disabled={submitting}
                    aria-selected="false"
                    role="option"
                    type="button"
                    onClick={() => onSelect(project.workspaceId)}
                  >
                    <span className="branch-project-picker__name">
                      {project.name}
                      {project.isWorktree ? " · Worktree" : ""}
                    </span>
                    <span className="branch-project-picker__path">{project.path}</span>
                    <span className="branch-project-picker__action">
                      {projectSubmitting ? "Branching…" : "Branch here"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="tree-modal__empty" data-testid="branch-project-empty">
              Open another project folder before branching this thread.
            </div>
          )}

          <div className="tree-modal__footer">
            <div className="tree-modal__hint">
              The selected project becomes the active thread after the branch is created.
            </div>
            <div className="tree-modal__actions">
              <button
                className="button button--secondary"
                disabled={submitting}
                type="button"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
