import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  DesktopAppState,
  ForkThreadInput,
  WorkspaceRecord,
  WorkspaceSessionTarget,
} from "../../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../../contracts/ipc";
import {
  nonCompletedBindingForSession,
  type ScheduledTaskRecord,
} from "../../../../contracts/scheduled-tasks";
import type { ScheduledEditorState } from "../../scheduled-tasks/scheduled-task-editor";
import {
  buildThreadActions,
  type BranchProjectPickerState,
  type ThreadAction,
  type ThreadActionHandlers,
  type ThreadActionSubject,
} from "../thread-actions";

interface UseThreadActionsParams {
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly scheduledTasks: readonly ScheduledTaskRecord[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly sidebarCollapsed: boolean;
  readonly openScheduledEditor: (editor: ScheduledEditorState) => void;
  /** Sends the open thread's debounced draft now, before an action can deselect that thread. */
  readonly flushComposerDraft: () => void;
  readonly focusComposer: () => void;
}

/** Where a thread menu is open: a sidebar row's right-click menu, or the thread header. */
type OpenThreadMenu =
  { readonly surface: "sidebar"; readonly sessionId: string } | { readonly surface: "header" };

export interface ThreadMenuState {
  readonly platform: NodeJS.Platform;
  readonly openMenu: OpenThreadMenu | null;
  readonly renameSessionId: string | null;
  readonly renameDraft: string;
  readonly setRenameDraft: Dispatch<SetStateAction<string>>;
  readonly menuWrapRef: RefObject<HTMLDivElement | null>;
  readonly renamePanelRef: RefObject<HTMLFormElement | null>;
  readonly openSidebarMenu: (sessionId: string) => void;
  readonly toggleHeaderMenu: () => void;
  readonly submitRename: (subject: ThreadActionSubject) => void;
  readonly cancelRename: () => void;
  readonly branchProjectPicker: BranchProjectPickerState | null;
  readonly closeBranchProjectPicker: () => void;
  readonly selectBranchProject: (workspaceId: string) => void;
  /**
   * The shared action list every thread menu, shortcut and the command palette
   * use. Running an action closes any open thread menu first.
   */
  readonly actionsFor: (subject: ThreadActionSubject) => readonly ThreadAction[];
  readonly archive: (target: WorkspaceSessionTarget) => void;
  readonly restore: (target: WorkspaceSessionTarget) => void;
  readonly setPinned: (target: WorkspaceSessionTarget, pinned: boolean) => void;
}

export function useThreadActions({
  api,
  setSnapshot,
  updateSnapshot,
  scheduledTasks,
  workspaces,
  sidebarCollapsed,
  openScheduledEditor,
  flushComposerDraft,
  focusComposer,
}: UseThreadActionsParams): ThreadMenuState {
  const [openMenu, setOpenMenu] = useState<OpenThreadMenu | null>(null);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [branchPicker, setBranchPicker] = useState<{
    readonly subject: ThreadActionSubject;
    readonly state: BranchProjectPickerState;
  } | null>(null);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const renamePanelRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!menuWrapRef.current?.contains(target) && !renamePanelRef.current?.contains(target)) {
        setOpenMenu(null);
        setRenameSessionId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setRenameSessionId(null);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const targetFor = (subject: ThreadActionSubject): WorkspaceSessionTarget => ({
    workspaceId: subject.workspaceId,
    sessionId: subject.session.id,
  });
  const mutate = (action: (desktopApi: PiDesktopApi) => Promise<DesktopAppState>) => {
    if (!api) return;
    void updateSnapshot(setSnapshot, () => action(api)).catch((error: unknown) => {
      console.error("[renderer] updateSnapshot failed", error);
    });
  };
  // Archiving the open thread selects another one, which drops a draft still in its debounce.
  const archive = (target: WorkspaceSessionTarget) => {
    flushComposerDraft();
    mutate((desktopApi) => desktopApi.archiveSession(target));
  };
  const restore = (target: WorkspaceSessionTarget) =>
    mutate((desktopApi) => desktopApi.unarchiveSession(target));
  const setPinned = (target: WorkspaceSessionTarget, pinned: boolean) =>
    mutate((desktopApi) => desktopApi.setSessionPinned(target, pinned));
  const branchThread = async (
    subject: ThreadActionSubject,
    targetWorkspaceId?: string,
  ): Promise<DesktopAppState> => {
    if (!api) throw new Error("Desktop API is unavailable");
    flushComposerDraft();
    const target = targetWorkspaceId
      ? workspaces.find((workspace) => workspace.id === targetWorkspaceId)
      : workspaces.find((workspace) => workspace.id === subject.workspaceId);
    if (!target) throw new Error(`Unknown workspace: ${targetWorkspaceId}`);
    const input: ForkThreadInput = {
      sourceWorkspaceId: subject.workspaceId,
      sourceSessionId: subject.session.id,
      rootWorkspaceId: target.rootWorkspaceId ?? target.id,
      environment: "local",
      ...(targetWorkspaceId ? { targetWorkspaceId } : {}),
      position: "head",
    };
    const state = await updateSnapshot(setSnapshot, () => api.forkThread(input));
    focusComposer();
    return state;
  };
  const branchProjectOptions = (subject: ThreadActionSubject) =>
    workspaces
      .filter((workspace) => workspace.id !== subject.workspaceId)
      .map((workspace) => ({
        workspaceId: workspace.id,
        name: workspace.name,
        path: workspace.path,
        isWorktree: workspace.rootWorkspaceId !== undefined,
      }))
      .sort(
        (left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
      );

  const platform = api?.platform ?? "linux";
  const handlers: ThreadActionHandlers = {
    platform,
    hasScheduledTask: (subject) =>
      Boolean(nonCompletedBindingForSession(scheduledTasks, subject.session.id)),
    startRename: (subject) => {
      // The rename field lives in the sidebar row, so show the sidebar first.
      if (sidebarCollapsed) mutate((desktopApi) => desktopApi.setSidebarCollapsed(false));
      setRenameSessionId(subject.session.id);
      setRenameDraft(subject.session.title);
    },
    branchSameProject: (subject) => {
      void branchThread(subject).catch((error: unknown) => {
        console.error("[renderer] branchThread failed", error);
      });
    },
    chooseBranchProject: (subject) => {
      setBranchPicker({
        subject,
        state: {
          sourceTitle: subject.session.title,
          projects: branchProjectOptions(subject),
        },
      });
    },
    setPinned: (subject, pinned) => setPinned(targetFor(subject), pinned),
    archive: (subject) => archive(targetFor(subject)),
    restore: (subject) => restore(targetFor(subject)),
    markRead: (subject) => mutate((desktopApi) => desktopApi.markSessionRead(targetFor(subject))),
    openScheduledTask: (subject) => {
      const binding = nonCompletedBindingForSession(scheduledTasks, subject.session.id);
      openScheduledEditor(
        binding
          ? { mode: "edit", taskId: binding.id }
          : {
              mode: "create",
              prefill: {
                target: {
                  kind: "existing-thread",
                  workspaceId: subject.workspaceId,
                  sessionId: subject.session.id,
                },
              },
            },
      );
    },
    copySessionId: (subject) => {
      void navigator.clipboard.writeText(subject.session.id).catch((error: unknown) => {
        console.error("[renderer] navigator.clipboard.writeText failed", error);
      });
    },
  };

  return {
    platform,
    openMenu,
    renameSessionId,
    renameDraft,
    setRenameDraft,
    menuWrapRef,
    renamePanelRef,
    openSidebarMenu: (sessionId) => {
      setRenameSessionId(null);
      setOpenMenu({ surface: "sidebar", sessionId });
    },
    toggleHeaderMenu: () => {
      setRenameSessionId(null);
      setOpenMenu((current) => (current?.surface === "header" ? null : { surface: "header" }));
    },
    submitRename: (subject) => {
      const nextTitle = renameDraft.trim();
      setRenameSessionId(null);
      setRenameDraft("");
      if (!nextTitle || nextTitle === subject.session.title) return;
      mutate((desktopApi) => desktopApi.renameSession(targetFor(subject), nextTitle));
    },
    cancelRename: () => {
      setRenameSessionId(null);
      setRenameDraft("");
    },
    branchProjectPicker: branchPicker?.state ?? null,
    closeBranchProjectPicker: () => {
      setBranchPicker((current) => (current?.state.submittingWorkspaceId ? current : null));
    },
    selectBranchProject: (workspaceId) => {
      if (!branchPicker || branchPicker.state.submittingWorkspaceId) return;
      setBranchPicker((current) =>
        current
          ? {
              ...current,
              state: {
                ...current.state,
                submittingWorkspaceId: workspaceId,
                error: undefined,
              },
            }
          : current,
      );
      void branchThread(branchPicker.subject, workspaceId)
        .then(() => setBranchPicker(null))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setBranchPicker((current) =>
            current
              ? {
                  ...current,
                  state: {
                    ...current.state,
                    submittingWorkspaceId: undefined,
                    error: message,
                  },
                }
              : current,
          );
        });
    },
    actionsFor: (subject) =>
      buildThreadActions(subject, handlers).map((action) => ({
        ...action,
        run: () => {
          setOpenMenu(null);
          action.run();
        },
      })),
    archive,
    restore,
    setPinned,
  };
}
