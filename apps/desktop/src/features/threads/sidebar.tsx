import {
  Fragment,
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  AppView,
  SessionRecord,
  ThreadGrouping,
  WorkspaceRecord,
  WorktreeRecord,
} from "../../../contracts/desktop-state";
import {
  sidebarPreferences_markReadLimit,
  sidebarPreferences_defaultActivityStyle,
  type ActivityIndicatorStyle,
  type AllThreadsSort,
  type FolderPreference,
} from "../../../contracts/sidebar-preferences";
import {
  projectIdentity_accentInk,
  projectIdentity_decodeColor,
  projectIdentity_fallbackAccent,
  projectIdentity_presetColors,
  type ProjectAccentColor,
} from "../../../contracts/project-identity";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CustomizeSidebarIcon,
  ExtensionIcon,
  FolderIcon,
  HiddenThreadsIcon,
  ImportProjectsIcon,
  PinIcon,
  PlusIcon,
  RestoreIcon,
  SettingsIcon,
  SkillIcon,
  ClockIcon,
  WorktreeIcon,
} from "../../ui/icons";
import {
  getDesktopShortcutLabel,
  THREAD_SHORTCUT_SLOT_COUNT,
  type PiDesktopApi,
} from "../../../contracts/ipc";
import { PaneResizeHandle, type PaneWidthBounds } from "../../ui/pane-resize-handle";
import { usePersistedPaneWidth } from "../../ui/use-persisted-pane-width";
import { useSidebarExpansion } from "./use-sidebar-expansion";
import { ActivityIndicator } from "../../ui/activity-indicator";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import type { ThreadMenuState } from "./hooks/use-thread-actions";
import { ProjectAccentBridge } from "./project-accent-bridge";
import { archiveThreadShortcut, ThreadActionsMenu } from "./thread-actions";
import {
  recencyHistoryExpansionKey,
  flattenThreadTrees,
  sessionThreadKey,
  threadHistoryPreview,
  visibleThreadShortcutOrder,
  workspaceHistoryExpansionKey,
  type RecencyThreadSection,
  type ThreadSidebarModel,
  type ThreadListEntry,
  type WorkspaceThreadGroup,
} from "./thread-groups";
import {
  sidebarOrder_creationAge,
  sidebarOrder_creationTooltip,
  sidebarOrder_childModelLabel,
  sidebarOrder_elapsed,
} from "./sidebar-order";
import {
  sidebarPreferences_cycleFolder,
  sidebarPreferences_executeMarkReadPlan,
  sidebarPreferences_folderState,
  sidebarPreferences_groupChildren,
  sidebarPreferences_markReadPlan,
  sidebarPreferences_previewTree,
  sidebarPreferences_revealKeys,
  sidebarPreferences_sortOptions,
  type MarkReadExecutionResult,
} from "./sidebar-preferences";
import { useThreadShortcutHintsVisible } from "./thread-shortcut-hints";
import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState } from "../../../contracts/desktop-state";
import { applySnapshotIfNewer } from "../../app/desktop-app-state";

interface SidebarProps {
  readonly activeView: AppView;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  /** Canonical selection before session/tree metadata has finished hydrating. */
  readonly selectionWorkspaceId?: string;
  readonly selectionSessionId?: string;
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
  readonly activityIndicatorStyle?: ActivityIndicatorStyle;
  readonly threadSidebarModel: ThreadSidebarModel;
  readonly threadGrouping: ThreadGrouping;
  readonly collapsedWorkspaceIds: readonly string[];
  readonly linkedWorktreeByWorkspaceId: ReadonlyMap<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly threadMenu: ThreadMenuState;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly onNewThread: (workspaceId?: string) => void;
  readonly onImportProjects: () => void;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onOpenSkills: (workspaceId?: string) => void;
  readonly onOpenExtensions: (workspaceId?: string) => void;
  readonly onOpenSettings: (workspaceId?: string) => void;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly threadShortcutOrderRef: MutableRefObject<readonly ThreadListEntry[] | null>;
}

const SIDEBAR_WIDTH_RANGE = { min: 200, max: 520 } as const;

function sidebarWidthBounds(_sidebar: HTMLElement, shell: HTMLElement): PaneWidthBounds {
  return {
    min: SIDEBAR_WIDTH_RANGE.min,
    max: Math.floor(Math.min(SIDEBAR_WIDTH_RANGE.max, shell.clientWidth * 0.45)),
  };
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

const WORKSPACE_ACCENT_OPTIONS = Object.freeze([
  { id: "blue", label: "Blue", color: projectIdentity_presetColors[0] },
  { id: "teal", label: "Teal", color: projectIdentity_presetColors[1] },
  { id: "green", label: "Green", color: projectIdentity_presetColors[2] },
  { id: "gold", label: "Gold", color: projectIdentity_presetColors[3] },
  { id: "orange", label: "Orange", color: projectIdentity_presetColors[4] },
  { id: "rose", label: "Rose", color: projectIdentity_presetColors[5] },
  { id: "violet", label: "Violet", color: projectIdentity_presetColors[6] },
  { id: "slate", label: "Slate", color: projectIdentity_presetColors[7] },
] as const);

type WorkspaceAccentStyle = CSSProperties & {
  readonly "--workspace-accent": ProjectAccentColor;
  readonly "--workspace-accent-ink": "#111318" | "#ffffff";
};

function workspaceAccentStyle(color: ProjectAccentColor): WorkspaceAccentStyle {
  return {
    "--workspace-accent": color,
    "--workspace-accent-ink": projectIdentity_accentInk(color),
  };
}

type MarkReadReport =
  { readonly status: "running"; readonly total: number } | MarkReadExecutionResult;

interface ThreadShortcutBadge {
  readonly slot: number;
  readonly label: string;
}

const ThreadListContext = createContext<
  | {
      readonly shortcuts: ReadonlyMap<string, ThreadShortcutBadge> | undefined;
      readonly props: SidebarProps;
      readonly collapsed: ReadonlySet<string>;
      readonly toggle: (key: string) => void;
    }
  | undefined
>(undefined);

export function Sidebar(props: SidebarProps) {
  const {
    activeView,
    selectedWorkspace,
    selectedSession,
    selectionWorkspaceId,
    selectionSessionId,
    visibleWorkspaces,
    activityIndicatorStyle = sidebarPreferences_defaultActivityStyle,
    threadSidebarModel,
    threadGrouping,
    collapsedWorkspaceIds,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    threadMenu,
    api,
    setSnapshot,
    updateSnapshot,
    onNewThread,
    onImportProjects,
    onSetActiveView,
    onOpenSkills,
    onOpenExtensions,
    onOpenSettings,
    onArchiveSession,
    onSelectSession,
    onSetSessionPinned,
    onUnarchiveSession,
    threadShortcutOrderRef,
  } = props;

  const [sidebarWidth, setSidebarWidth] = usePersistedPaneWidth(
    "pi-gui.sidebar-width",
    SIDEBAR_WIDTH_RANGE,
  );
  const sidebarWidthStyle: (CSSProperties & { "--sidebar-width": string }) | undefined =
    sidebarWidth === undefined ? undefined : { "--sidebar-width": `${sidebarWidth}px` };
  const [activeId, setActiveId] = useState<string | null>(null);
  const {
    archivedOpen,
    setArchivedOpen,
    expandedHistory,
    setExpandedHistory,
    collapsedThreads,
    setCollapsedThreads,
  } = useSidebarExpansion();
  const selectedThreadKey =
    (selectionWorkspaceId && selectionSessionId
      ? `${selectionWorkspaceId}:${selectionSessionId}`
      : undefined) ??
    (selectedWorkspace && selectedSession
      ? `${selectedWorkspace.id}:${selectedSession.id}`
      : undefined);
  const selectionRevealRef = useRef({ key: selectedThreadKey, allow: false });
  const [markReadReport, setMarkReadReport] = useState<MarkReadReport | undefined>();
  const toggleThread = (key: string) => {
    // A user's manual fold wins over later catalog/parent-link refreshes.
    selectionRevealRef.current = { key: selectedThreadKey, allow: false };
    setCollapsedThreads((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const commandHeld = useThreadShortcutHintsVisible(api.platform);
  const folderPreference = (workspaceId: string) =>
    sidebarPreferences_folderState(
      workspaceId,
      threadSidebarModel.folderPreferencesByWorkspace,
      collapsedWorkspaceIds,
    );
  const setSavedFolderPreference = (workspaceId: string, preference: FolderPreference) => {
    // An explicit folder fold wins over an older Show more override.
    if (preference !== "open")
      setExpandedHistory((current) => {
        const key = workspaceHistoryExpansionKey(workspaceId);
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    void updateSnapshot(setSnapshot, async () => {
      await api.setFolderPreference(workspaceId, preference);
      // Keep the legacy ids aligned for older persisted-state readers and rollback.
      return api.setWorkspaceCollapsed(workspaceId, preference === "closed");
    }).catch((error: unknown) => {
      console.error("[renderer] setFolderPreference failed", error);
    });
  };
  const setWorkspaceAccent = (workspaceId: string, color: ProjectAccentColor) => {
    void updateSnapshot(setSnapshot, () => api.setProjectAccentColor({ workspaceId, color })).catch(
      (error: unknown) => {
        console.error("[renderer] setProjectAccentColor failed", error);
      },
    );
  };
  const sidebarEntriesByKey = new Map(
    threadSidebarModel.recencyOrder.map((entry) => [sessionThreadKey(entry), entry]),
  );
  const revealPath = (key: string | undefined): ReadonlySet<string> => {
    let cursor = key ? sidebarEntriesByKey.get(key) : undefined;
    const ancestors: string[] = [];
    const seen = new Set<string>();
    while (cursor?.parentKey && !seen.has(cursor.parentKey)) {
      seen.add(cursor.parentKey);
      ancestors.push(cursor.parentKey);
      cursor = sidebarEntriesByKey.get(cursor.parentKey);
    }
    return sidebarPreferences_revealKeys(key, ancestors);
  };
  const selectedRevealKeys = revealPath(selectedThreadKey);
  const renameTargetKey = threadMenu.renameSessionId
    ? [...sidebarEntriesByKey.values()].find(
        (entry) => entry.session.id === threadMenu.renameSessionId,
      )
    : undefined;
  const revealKeys = new Set([
    ...selectedRevealKeys,
    ...revealPath(renameTargetKey ? sessionThreadKey(renameTargetKey) : undefined),
  ]);
  const shortcutOrder = visibleThreadShortcutOrder({
    grouping: threadGrouping,
    model: threadSidebarModel,
    expandedHistory,
    archivedOpen,
    collapsedWorkspaceIds,
    collapsedThreadKeys: collapsedThreads,
    folderPreferencesByWorkspace: threadSidebarModel.folderPreferencesByWorkspace,
    revealKeys,
  });
  threadShortcutOrderRef.current = shortcutOrder;
  const shortcutByKey = commandHeld
    ? new Map(
        shortcutOrder.slice(0, THREAD_SHORTCUT_SLOT_COUNT).map((thread, index) => {
          const slot = index + 1;
          return [
            sessionThreadKey(thread),
            { slot, label: getDesktopShortcutLabel(api.platform, String(slot)) },
          ] as const;
        }),
      )
    : undefined;

  useEffect(() => {
    return () => {
      threadShortcutOrderRef.current = null;
    };
  }, [threadShortcutOrderRef]);

  // Rename can start from the header, Cmd-K or its shortcut, so reveal the
  // row that holds the rename field when it sits in a collapsed group.
  const renameSessionId = threadMenu.renameSessionId;
  useEffect(() => {
    if (!renameSessionId) return;
    const holds = (threads: readonly ThreadListEntry[]) =>
      flattenThreadTrees(threads).some((thread) => thread.session.id === renameSessionId);
    if (holds(threadSidebarModel.archivedThreads)) {
      setArchivedOpen(true);
      return;
    }
    const keys = [
      ...threadSidebarModel.recencySections
        .filter((section) => holds(section.threads))
        .map((section) => recencyHistoryExpansionKey(section.bucket)),
      ...threadSidebarModel.workspaceGroups
        .filter((group) => holds(group.threads))
        .map((group) => workspaceHistoryExpansionKey(group.workspace.id)),
    ];
    setExpandedHistory((current) =>
      keys.every((key) => current.has(key)) ? current : new Set([...current, ...keys]),
    );
    // Reveal once per rename; later list changes should not reopen groups.
  }, [renameSessionId]);

  // Reveal on actual selection changes/rename, not on initial restoration. A saved
  // fold of the selected child's ancestors must survive startup/remount and late
  // parent metadata. Explicit navigation still reveals the newly selected path.
  const revealedPathRef = useRef<{ select?: string; rename?: string }>({});
  useEffect(() => {
    const entries = new Map(
      threadSidebarModel.recencyOrder.map((entry) => [sessionThreadKey(entry), entry]),
    );
    let entry = renameSessionId
      ? threadSidebarModel.recencyOrder.find((item) => item.session.id === renameSessionId)
      : entries.get(selectedThreadKey ?? "");
    const target = entry ? sessionThreadKey(entry) : "";
    const ancestors = new Set<string>();
    while (entry?.parentKey && !ancestors.has(entry.parentKey)) {
      ancestors.add(entry.parentKey);
      entry = entries.get(entry.parentKey);
    }
    // Rename and selection reveal separately: renaming the selected thread needs its row
    // mounted, and ending a rename must not reopen what the user collapsed since.
    const path = [target, ...ancestors].join("\n");
    const kind = renameSessionId ? "rename" : "select";
    // Clear rename tracking even when initial selection restoration skips reveal.
    if (!renameSessionId) revealedPathRef.current = { select: revealedPathRef.current.select };
    if (selectionRevealRef.current.key !== selectedThreadKey) {
      selectionRevealRef.current = { key: selectedThreadKey, allow: true };
    }
    if (!renameSessionId && !selectionRevealRef.current.allow) {
      revealedPathRef.current.select = path;
      return;
    }
    if (revealedPathRef.current[kind] === path) return;
    revealedPathRef.current = { ...revealedPathRef.current, [kind]: path };
    setCollapsedThreads((current) => {
      if (![...ancestors].some((key) => current.has(key))) return current;
      return new Set([...current].filter((key) => !ancestors.has(key)));
    });
  }, [selectedThreadKey, renameSessionId, threadSidebarModel.recencyOrder]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const pinnedSortableId = (thread: ThreadListEntry) => `pinned:${sessionThreadKey(thread)}`;
  const pinnedSessionKeyFromSortableId = (id: string) =>
    id.startsWith("pinned:") ? id.slice("pinned:".length) : id;

  // Collision detection based on workspace row headers only (~30px top of each group),
  // not the full group height including all sessions.
  const headerCollision: CollisionDetection = (args) => {
    if (String(args.active.id).startsWith("pinned:")) {
      const pointerY = args.pointerCoordinates?.y;
      if (pointerY == null) return [];
      let closest: { id: string; distance: number } | null = null;
      for (const container of args.droppableContainers) {
        const containerId = String(container.id);
        if (!containerId.startsWith("pinned:") || containerId === String(args.active.id)) {
          continue;
        }
        const rect = container.rect.current;
        if (!rect) continue;
        const rowCenter = rect.top + rect.height / 2;
        const distance = Math.abs(pointerY - rowCenter);
        if (!closest || distance < closest.distance) {
          closest = { id: containerId, distance };
        }
      }
      return closest
        ? [
            {
              id: closest.id,
              data: {
                droppableContainer: args.droppableContainers.find(
                  (c) => String(c.id) === closest!.id,
                )!,
              },
            },
          ]
        : [];
    }
    const pointerY = args.pointerCoordinates?.y;
    if (pointerY == null) return [];

    let closest: { id: string; distance: number } | null = null;
    for (const container of args.droppableContainers) {
      if (String(container.id).startsWith("pinned:")) {
        continue;
      }
      const rect = container.rect.current;
      if (!rect) continue;
      const headerCenter = rect.top + 15; // center of the ~30px workspace row header
      const distance = Math.abs(pointerY - headerCenter);
      if (!closest || distance < closest.distance) {
        closest = { id: String(container.id), distance };
      }
    }
    return closest
      ? [
          {
            id: closest.id,
            data: {
              droppableContainer: args.droppableContainers.find(
                (c) => String(c.id) === closest!.id,
              )!,
            },
          },
        ]
      : [];
  };

  // recencyOrder holds every unarchived thread, including children nested under another folder's parent.
  const folderHasThreads = (folderId: string) =>
    threadSidebarModel.recencyOrder.some((thread) => thread.folderId === folderId) ||
    threadSidebarModel.archivedThreads.some((thread) => thread.folderId === folderId);
  const showFolderRow = (group: WorkspaceThreadGroup) =>
    threadGrouping === "workspace" || !folderHasThreads(group.workspace.id);
  const rootGroups = threadSidebarModel.workspaceGroups.filter(
    (group) => group.workspace.kind === "primary" && showFolderRow(group),
  );
  const orphanGroups = threadSidebarModel.workspaceGroups.filter(
    (group) => group.workspace.kind !== "primary" && showFolderRow(group),
  );
  const pinnedThreads = threadSidebarModel.pinnedThreads;
  const pinnedSortableIds = pinnedThreads.map(pinnedSortableId);
  const rootGroupIds = rootGroups.map((group) => group.workspace.id);
  const canDrag = rootGroups.length > 1;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    if (String(active.id).startsWith("pinned:")) {
      const oldIndex = pinnedSortableIds.indexOf(String(active.id));
      const newIndex = pinnedSortableIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const newOrder = arrayMove(pinnedSortableIds, oldIndex, newIndex).map(
        pinnedSessionKeyFromSortableId,
      );
      applyOptimisticReorder("pinnedSessionOrder", newOrder, () =>
        api.reorderPinnedSessions(newOrder),
      );
      return;
    }

    const oldIndex = rootGroupIds.indexOf(String(active.id));
    const newIndex = rootGroupIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const newOrder = arrayMove(rootGroupIds, oldIndex, newIndex);
    applyOptimisticReorder("workspaceOrder", newOrder, () => api.reorderWorkspaces(newOrder));
  }

  // Optimistically update local state to avoid snap-back animation, then reconcile with the
  // authoritative state the IPC call returns; on rejection, put back only the previous order.
  // Neither path may restore an older whole snapshot: pushes only carry the model catalog when
  // it changes, so an older snapshot would leave an old catalog in the window.
  function applyOptimisticReorder(
    field: "workspaceOrder" | "pinnedSessionOrder",
    order: readonly string[],
    commit: () => Promise<DesktopAppState>,
  ) {
    let previousOrder: readonly string[] | undefined;
    setSnapshot((prev) => {
      previousOrder = prev?.[field];
      return prev ? { ...prev, [field]: order } : prev;
    });
    void commit().then(
      (state) => applySnapshotIfNewer(setSnapshot, state),
      () =>
        setSnapshot((current) =>
          current && previousOrder && current[field] === order
            ? { ...current, [field]: previousOrder }
            : current,
        ),
    );
  }

  const activeFolder = activeId
    ? rootGroups.find((group) => group.workspace.id === activeId)?.workspace
    : undefined;
  const activePinnedThread = activeId?.startsWith("pinned:")
    ? pinnedThreads.find((thread) => pinnedSortableId(thread) === activeId)
    : undefined;

  function toggleHistoryExpanded(key: string) {
    setExpandedHistory((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const markAllRead = () => {
    const plan = sidebarPreferences_markReadPlan(
      threadSidebarModel.markReadTargets,
      sidebarPreferences_markReadLimit,
    );
    if (
      plan.total === 0 ||
      !window.confirm(
        `Mark ${plan.total} unread ${plan.total === 1 ? "thread" : "threads"} as read?`,
      )
    ) {
      return;
    }
    setMarkReadReport({ status: "running", total: plan.total });
    void sidebarPreferences_executeMarkReadPlan(plan, async (batch) => {
      const state = await api.markAllThreadsRead({ targets: batch });
      applySnapshotIfNewer(setSnapshot, state);
    }).then(setMarkReadReport, (error: unknown) => {
      console.error("[renderer] markAllThreadsRead failed", error);
      setMarkReadReport({
        status: "failed",
        completed: 0,
        total: plan.total,
        error: error instanceof Error ? error.message : "Mark-read request failed",
      });
    });
  };

  const markReadMessage =
    markReadReport?.status === "running"
      ? `Marking ${markReadReport.total} unread ${markReadReport.total === 1 ? "thread" : "threads"} as read...`
      : markReadReport?.status === "complete"
        ? `Marked all ${markReadReport.total} unread ${markReadReport.total === 1 ? "thread" : "threads"} as read.`
        : markReadReport
          ? `Marked ${markReadReport.completed} of ${markReadReport.total} unread threads as read.${markReadReport.error ? ` ${markReadReport.error}` : ""}`
          : "";

  return (
    <aside
      className="sidebar"
      id="primary-sidebar"
      data-testid="sidebar-surface"
      style={sidebarWidthStyle}
    >
      <PaneResizeHandle
        className="sidebar__resize-handle"
        label="Sidebar width"
        controls="primary-sidebar"
        edge="right"
        bounds={sidebarWidthBounds}
        onResize={setSidebarWidth}
        onReset={() => setSidebarWidth(undefined)}
      />
      <div className="sidebar__top">
        <button
          className="sidebar__new"
          type="button"
          disabled={!selectedWorkspace}
          onClick={() => onNewThread()}
        >
          <PlusIcon />
          <span>New thread</span>
        </button>

        <div className="sidebar__nav">
          <button
            className={`sidebar__nav-item ${activeView === "threads" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => onSetActiveView("threads")}
          >
            <FolderIcon />
            <span>Threads</span>
          </button>
          <button
            className="sidebar__nav-item"
            data-testid="sidebar-import-projects"
            type="button"
            onClick={onImportProjects}
          >
            <ImportProjectsIcon />
            <span>Import projects</span>
          </button>
          <button
            className={`sidebar__nav-item ${activeView === "scheduled" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            data-testid="sidebar-scheduled"
            onClick={() => onSetActiveView("scheduled")}
          >
            <ClockIcon />
            <span>Scheduled</span>
          </button>
          <button
            className="sidebar__nav-item"
            type="button"
            onClick={() =>
              onOpenSkills(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)
            }
          >
            <SkillIcon />
            <span>Skills</span>
          </button>
          <button
            className="sidebar__nav-item"
            type="button"
            onClick={() =>
              onOpenExtensions(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)
            }
          >
            <ExtensionIcon />
            <span>Extensions</span>
          </button>
          <button
            className="sidebar__nav-item"
            type="button"
            onClick={() =>
              onOpenSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)
            }
          >
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </div>
      </div>

      <div className="sidebar__section">
        <div className="section__head">
          <span>Threads</span>
          <div className="section__tools">
            <ThreadGroupingControl
              grouping={threadGrouping}
              onChange={(grouping) => {
                void updateSnapshot(setSnapshot, () => api.setThreadGrouping(grouping)).catch(
                  (error: unknown) => {
                    console.error("[renderer] setThreadGrouping failed", error);
                  },
                );
              }}
            />
            <button
              aria-label="Mark all threads read"
              className="icon-button sidebar__mark-read"
              data-testid="mark-all-threads-read"
              disabled={
                threadSidebarModel.markReadTargets.length === 0 ||
                markReadReport?.status === "running"
              }
              title="Mark all read"
              type="button"
              onClick={markAllRead}
            >
              <CheckIcon />
            </button>
            <button
              aria-label="Open folder"
              className="icon-button"
              type="button"
              onClick={() => {
                void updateSnapshot(setSnapshot, () => api.pickWorkspace()).catch(
                  (error: unknown) => {
                    console.error("[renderer] pickWorkspace failed", error);
                  },
                );
              }}
            >
              <FolderIcon />
            </button>
          </div>
        </div>
        {markReadMessage ? (
          <div
            className={`sidebar__mark-read-report sidebar__mark-read-report--${markReadReport?.status}`}
            data-testid="mark-all-threads-read-report"
            role={
              markReadReport?.status === "failed" || markReadReport?.status === "partial"
                ? "alert"
                : "status"
            }
          >
            {markReadMessage}
          </div>
        ) : null}

        {visibleWorkspaces.length === 0 ? (
          <div className="empty-state" data-testid="empty-state">
            <h2>No folders yet</h2>
            <p>Open a project folder to start building a workspace and session list.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                void updateSnapshot(setSnapshot, () => api.pickWorkspace()).catch(
                  (error: unknown) => {
                    console.error("[renderer] pickWorkspace failed", error);
                  },
                );
              }}
            >
              Open first folder
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={headerCollision}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <ThreadListContext.Provider
              value={{
                shortcuts: shortcutByKey,
                props,
                collapsed: collapsedThreads,
                toggle: toggleThread,
              }}
            >
              <div className="workspace-list" data-testid="workspace-list">
                <SortableContext items={rootGroupIds} strategy={verticalListSortingStrategy}>
                  {rootGroups.map((group) => (
                    <SortableWorkspaceFolder
                      key={group.workspace.id}
                      workspace={group.workspace}
                      threads={threadGrouping === "workspace" ? group.threads : undefined}
                      historyExpanded={expandedHistory.has(
                        workspaceHistoryExpansionKey(group.workspace.id),
                      )}
                      onToggleHistory={() =>
                        toggleHistoryExpanded(workspaceHistoryExpansionKey(group.workspace.id))
                      }
                      folderPreference={folderPreference(group.workspace.id)}
                      workspaceAccent={threadSidebarModel.accentColors[group.workspace.id]}
                      revealKeys={revealKeys}
                      onSetFolderPreference={(preference) =>
                        setSavedFolderPreference(group.workspace.id, preference)
                      }
                      onSetWorkspaceAccent={(color) =>
                        setWorkspaceAccent(group.workspace.id, color)
                      }
                      canDrag={canDrag}
                      selectedWorkspace={selectedWorkspace}
                      selectedSession={selectedSession}
                      linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                      wsMenu={wsMenu}
                      api={api}
                      threadMenu={threadMenu}
                      onNewThread={onNewThread}
                      onArchiveSession={onArchiveSession}
                      onSelectSession={onSelectSession}
                      onSetSessionPinned={onSetSessionPinned}
                    />
                  ))}
                </SortableContext>
                {orphanGroups.map((group) => (
                  <section
                    key={group.workspace.id}
                    className="workspace-group"
                    data-workspace-id={group.workspace.id}
                  >
                    <WorkspaceFolderContent
                      workspace={group.workspace}
                      threads={threadGrouping === "workspace" ? group.threads : undefined}
                      historyExpanded={expandedHistory.has(
                        workspaceHistoryExpansionKey(group.workspace.id),
                      )}
                      onToggleHistory={() =>
                        toggleHistoryExpanded(workspaceHistoryExpansionKey(group.workspace.id))
                      }
                      folderPreference={folderPreference(group.workspace.id)}
                      workspaceAccent={threadSidebarModel.accentColors[group.workspace.id]}
                      revealKeys={revealKeys}
                      onSetFolderPreference={(preference) =>
                        setSavedFolderPreference(group.workspace.id, preference)
                      }
                      onSetWorkspaceAccent={(color) =>
                        setWorkspaceAccent(group.workspace.id, color)
                      }
                      canDrag={false}
                      selectedWorkspace={selectedWorkspace}
                      selectedSession={selectedSession}
                      linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                      wsMenu={wsMenu}
                      api={api}
                      threadMenu={threadMenu}
                      onNewThread={onNewThread}
                      onArchiveSession={onArchiveSession}
                      onSelectSession={onSelectSession}
                      onSetSessionPinned={onSetSessionPinned}
                    />
                  </section>
                ))}
                {pinnedThreads.length > 0 ? (
                  <PinnedThreadsSection
                    pinnedThreads={pinnedThreads}
                    sortableIds={pinnedSortableIds}
                    sortableIdForThread={pinnedSortableId}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    threadMenu={threadMenu}
                    onArchiveSession={onArchiveSession}
                    onSelectSession={onSelectSession}
                    onSetSessionPinned={onSetSessionPinned}
                  />
                ) : null}
                {threadGrouping === "time" ? (
                  <AllThreadsSection
                    model={threadSidebarModel}
                    revealKeys={revealKeys}
                    historyExpanded={expandedHistory}
                    onToggleHistory={toggleHistoryExpanded}
                    onSortChange={(sort) => {
                      void updateSnapshot(setSnapshot, () => api.setAllThreadsSort(sort)).catch(
                        (error: unknown) => {
                          console.error("[renderer] setAllThreadsSort failed", error);
                        },
                      );
                    }}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    threadMenu={threadMenu}
                    onArchiveSession={onArchiveSession}
                    onSelectSession={onSelectSession}
                    onSetSessionPinned={onSetSessionPinned}
                  />
                ) : null}
                {threadSidebarModel.archivedThreads.length > 0 ? (
                  <ArchivedThreadsSection
                    archivedThreads={threadSidebarModel.archivedThreads}
                    open={archivedOpen}
                    onToggle={() => setArchivedOpen((current) => !current)}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    threadMenu={threadMenu}
                    onUnarchiveSession={onUnarchiveSession}
                    onSelectSession={onSelectSession}
                    onSetSessionPinned={onSetSessionPinned}
                  />
                ) : null}
              </div>
              <DragOverlay>
                {activePinnedThread ? (
                  <ThreadSessionRow
                    active={
                      activePinnedThread.workspaceId === selectedWorkspace?.id &&
                      activePinnedThread.session.id === selectedSession?.id
                    }
                    thread={activePinnedThread}
                    showContext
                    overlay
                    onAction={() => undefined}
                    onSelect={() => undefined}
                    onTogglePinned={() => undefined}
                  />
                ) : activeFolder ? (
                  <div className="workspace-group workspace-group--overlay">
                    <WorkspaceFolderContent
                      workspace={activeFolder}
                      canDrag={false}
                      selectedWorkspace={selectedWorkspace}
                      linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                      wsMenu={wsMenu}
                      api={api}
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </ThreadListContext.Provider>
          </DndContext>
        )}
      </div>
    </aside>
  );
}

/* ── Sortable workspace folder ─────────────────────────── */

interface WorkspaceFolderProps {
  readonly workspace: WorkspaceRecord;
  readonly threads?: readonly ThreadListEntry[];
  readonly historyExpanded?: boolean;
  readonly onToggleHistory?: () => void;
  readonly folderPreference?: FolderPreference;
  readonly workspaceAccent?: ProjectAccentColor;
  readonly revealKeys?: ReadonlySet<string>;
  readonly onSetFolderPreference?: (preference: FolderPreference) => void;
  readonly onSetWorkspaceAccent?: (color: ProjectAccentColor) => void;
  readonly canDrag: boolean;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession?: SessionRecord;
  readonly linkedWorktreeByWorkspaceId: ReadonlyMap<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly threadMenu?: ThreadMenuState;
  readonly onNewThread?: (workspaceId: string) => void;
  readonly onArchiveSession?: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession?: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned?: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}

function SortableWorkspaceFolder(props: WorkspaceFolderProps) {
  const { workspace, wsMenu } = props;
  const isRenaming = wsMenu.workspaceRenameId === workspace.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.id,
    disabled: isRenaming,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`workspace-group ${isDragging ? "workspace-group--dragging" : ""}`}
      data-workspace-id={workspace.id}
    >
      <WorkspaceFolderContent
        {...props}
        dragHandleProps={props.canDrag && !isRenaming ? { attributes, listeners } : undefined}
      />
    </section>
  );
}

interface DragHandleProps {
  readonly attributes: DraggableAttributes;
  readonly listeners: DraggableSyntheticListeners;
}

function WorkspaceAccentPicker({
  workspaceId,
  value,
  onChange,
}: {
  readonly workspaceId: string;
  readonly value: ProjectAccentColor;
  readonly onChange: (color: ProjectAccentColor) => void;
}) {
  const normalized = value || projectIdentity_fallbackAccent(workspaceId);
  return (
    <fieldset className="workspace-accent-picker" data-testid="workspace-accent-picker">
      <legend>Project colour</legend>
      <div className="workspace-accent-picker__swatches">
        {WORKSPACE_ACCENT_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="workspace-accent-picker__swatch"
            style={
              {
                "--swatch-color": option.color,
                "--swatch-ink": projectIdentity_accentInk(option.color),
              } as CSSProperties
            }
            aria-label={`${option.label} project colour`}
            aria-pressed={normalized === option.color}
            data-testid={`workspace-accent-${option.id}`}
            title={option.label}
            onClick={() => onChange(option.color)}
          >
            {normalized === option.color ? <CheckIcon /> : null}
          </button>
        ))}
      </div>
      <label className="workspace-accent-picker__custom">
        <span>Custom</span>
        <input
          type="color"
          data-testid="workspace-accent-custom"
          aria-label="Custom project colour"
          value={normalized}
          onChange={(event) => onChange(projectIdentity_decodeColor(event.currentTarget.value))}
        />
      </label>
    </fieldset>
  );
}

function WorkspaceFolderContent(
  props: WorkspaceFolderProps & { readonly dragHandleProps?: DragHandleProps },
) {
  const {
    workspace,
    threads,
    historyExpanded = false,
    onToggleHistory,
    folderPreference = "open",
    workspaceAccent,
    revealKeys = new Set(),
    onSetFolderPreference,
    onSetWorkspaceAccent,
    selectedWorkspace,
    selectedSession,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    threadMenu,
    onNewThread,
    onArchiveSession,
    onSelectSession,
    onSetSessionPinned,
    dragHandleProps,
  } = props;
  // Folder grouping lists threads under each folder, so the row folds them
  // like Codex; with no threads to fold, the row just selects the folder.
  const collapsible = Boolean(threads?.length && onSetFolderPreference);
  const history = threads
    ? sidebarPreferences_previewTree(threads, folderPreference, revealKeys, historyExpanded)
    : undefined;
  const collapsedPreview =
    threads && folderPreference !== "open"
      ? sidebarPreferences_previewTree(threads, folderPreference, revealKeys, false)
      : undefined;
  const hiddenThreadCount = collapsedPreview
    ? collapsedPreview.totalCount - collapsedPreview.visibleCount
    : 0;
  const folderVisible = Boolean(history && history.visible.length > 0);
  const effectiveFolderState =
    history && history.visible.length
      ? folderPreference === "open" || historyExpanded
        ? "open"
        : "partial"
      : "closed";

  const workspaceActive =
    workspace.id === selectedWorkspace?.id || workspace.id === selectedWorkspace?.rootWorkspaceId;
  const linkedWorktree = linkedWorktreeByWorkspaceId.get(workspace.id);
  const accentColor = workspaceAccent ?? projectIdentity_fallbackAccent(workspace.id);

  return (
    <>
      <div
        className={`workspace-row ${workspaceActive ? "workspace-row--active" : ""}`}
        data-workspace-accent={accentColor}
        style={workspaceAccentStyle(accentColor)}
      >
        <ProjectAccentBridge active={workspaceActive} color={accentColor} />
        <button
          className={`workspace-row__select ${dragHandleProps ? "workspace-row__select--draggable" : ""}`}
          onClick={() => {
            if (collapsible && onSetFolderPreference) {
              onSetFolderPreference(sidebarPreferences_cycleFolder(folderPreference));
            } else {
              wsMenu.selectWorkspace(workspace.id);
            }
          }}
          type="button"
          {...(dragHandleProps
            ? { ...dragHandleProps.attributes, ...dragHandleProps.listeners }
            : {})}
          aria-expanded={collapsible ? folderVisible : undefined}
          aria-description={
            collapsible ? `${workspace.name} folder ${effectiveFolderState}` : undefined
          }
          data-folder-state={collapsible ? effectiveFolderState : undefined}
          data-folder-preference={collapsible ? folderPreference : undefined}
        >
          <span
            className="workspace-row__icon"
            aria-hidden="true"
            data-state={collapsible ? (folderVisible ? "expanded" : "collapsed") : undefined}
          >
            <span className="workspace-row__icon-folder">
              <FolderIcon />
            </span>
            {collapsible ? (
              <span className="workspace-row__icon-chevron">
                {folderVisible ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </span>
            ) : null}
          </span>
          <span className="workspace-row__name">{workspace.name}</span>
        </button>
        <span className="workspace-row__actions">
          {onNewThread ? (
            <button
              aria-label={`New thread in ${workspace.name}`}
              className="icon-button workspace-row__action-button"
              title="New thread"
              type="button"
              onClick={() => {
                // The new thread lands in this folder, so open it to keep the row in view.
                // Gate on folder grouping, not on toggleCollapsed: a folder saved as
                // folded may be empty now, and its new thread would land hidden.
                if (threads && folderPreference !== "open") {
                  onSetFolderPreference?.("open");
                }
                onNewThread(workspace.id);
              }}
            >
              <PlusIcon />
            </button>
          ) : null}
          <span
            className="workspace-row__menu-wrap"
            ref={wsMenu.workspaceMenuId === workspace.id ? wsMenu.workspaceMenuWrapRef : undefined}
          >
            <button
              aria-label={`Workspace actions for ${workspace.name}`}
              aria-haspopup="menu"
              className="icon-button workspace-row__menu-button"
              aria-expanded={wsMenu.workspaceMenuId === workspace.id}
              data-testid="workspace-menu-trigger"
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                wsMenu.openWorkspaceMenu(workspace.id);
              }}
            >
              …
            </button>
            {wsMenu.workspaceMenuId === workspace.id ? (
              <div className="workspace-menu">
                {onSetWorkspaceAccent ? (
                  <WorkspaceAccentPicker
                    workspaceId={workspace.id}
                    value={accentColor}
                    onChange={onSetWorkspaceAccent}
                  />
                ) : null}
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () => {
                      void api.openWorkspaceInFinder(workspace.id).catch((error: unknown) => {
                        console.error("[renderer] openWorkspaceInFinder failed", error);
                      });
                    })
                  }
                >
                  Open folder
                </button>
                {linkedWorktree ? (
                  <button
                    className="workspace-menu__item workspace-menu__item--danger"
                    type="button"
                    onClick={(event) =>
                      wsMenu.runWorkspaceMenuAction(event, () =>
                        wsMenu.removeWorktree(
                          linkedWorktree.rootWorkspaceId || workspace.id,
                          linkedWorktree,
                        ),
                      )
                    }
                  >
                    Remove worktree
                  </button>
                ) : (
                  <button
                    className="workspace-menu__item"
                    type="button"
                    onClick={(event) =>
                      wsMenu.runWorkspaceMenuAction(event, () =>
                        wsMenu.createWorktree(workspace.id),
                      )
                    }
                  >
                    Create permanent worktree
                  </button>
                )}
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () => wsMenu.startRename(workspace))
                  }
                >
                  Edit name
                </button>
                <span
                  className="workspace-menu__label"
                  role="group"
                  aria-label={`${workspace.name} folder state`}
                >
                  <span>Folder view</span>
                  {(["open", "partial", "closed"] as const).map((preference) => (
                    <button
                      key={preference}
                      aria-pressed={folderPreference === preference}
                      className="workspace-menu__item workspace-menu__folder-option"
                      data-testid={`folder-state-${preference}`}
                      type="button"
                      onClick={(event) =>
                        wsMenu.runWorkspaceMenuAction(event, () =>
                          onSetFolderPreference?.(preference),
                        )
                      }
                    >
                      <span>{preference[0]!.toUpperCase() + preference.slice(1)}</span>
                      {folderPreference === preference ? <CheckIcon /> : null}
                    </button>
                  ))}
                </span>
                <button
                  className="workspace-menu__item workspace-menu__item--danger"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () => wsMenu.removeWorkspace(workspace))
                  }
                >
                  Remove
                </button>
              </div>
            ) : null}
          </span>
        </span>
      </div>
      {wsMenu.workspaceRenameId === workspace.id ? (
        <form
          className="workspace-rename"
          ref={wsMenu.workspaceRenamePanelRef}
          onSubmit={(event) => {
            event.preventDefault();
            wsMenu.submitRename(workspace);
          }}
        >
          <input
            aria-label={`Rename ${workspace.name}`}
            className="workspace-rename__input"
            ref={wsMenu.workspaceRenameInputRef}
            value={wsMenu.workspaceRenameDraft}
            onChange={(event) => {
              wsMenu.setWorkspaceRenameDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                wsMenu.cancelRename();
              }
            }}
          />
          <div className="workspace-rename__actions">
            <button
              className="workspace-rename__button"
              type="button"
              onClick={wsMenu.cancelRename}
            >
              Cancel
            </button>
            <button
              className="workspace-rename__button workspace-rename__button--primary"
              type="submit"
            >
              Save
            </button>
          </div>
        </form>
      ) : null}
      {history && onSelectSession && onArchiveSession && onSetSessionPinned ? (
        <>
          <div className="session-list session-list--history">
            {history.visible.map((thread) => (
              <HistoryThreadRow
                key={`${thread.workspaceId}:${thread.session.id}`}
                thread={thread}
                selectedWorkspace={selectedWorkspace}
                selectedSession={selectedSession}
                threadMenu={threadMenu}
                onArchiveSession={onArchiveSession}
                onSelectSession={onSelectSession}
                onSetSessionPinned={onSetSessionPinned}
              />
            ))}
          </div>
          {history.overflow && onToggleHistory ? (
            <HistoryToggle
              expanded={historyExpanded}
              label={workspace.name}
              onToggle={onToggleHistory}
              hiddenCount={workspaceActive ? hiddenThreadCount : undefined}
              accentColor={workspaceActive ? accentColor : undefined}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function AllThreadsSection({
  model,
  revealKeys,
  historyExpanded,
  onToggleHistory,
  onSortChange,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onArchiveSession,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly model: ThreadSidebarModel;
  readonly revealKeys: ReadonlySet<string>;
  readonly historyExpanded: ReadonlySet<string>;
  readonly onToggleHistory: (key: string) => void;
  readonly onSortChange: (sort: AllThreadsSort) => void;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}) {
  const allThreadsExpanded = historyExpanded.has("all-threads");
  const allPreview = sidebarPreferences_previewTree(
    model.allThreadsRoots,
    "partial",
    revealKeys,
    allThreadsExpanded,
  );
  return (
    <section className="all-threads" aria-label="All threads" data-testid="all-threads">
      <div className="all-threads__head">
        <span>All threads</span>
        <label className="all-threads__sort">
          <span className="sr-only">Sort all threads</span>
          <select
            aria-label="Sort all threads"
            value={model.allThreadsSort}
            onChange={(event) => onSortChange(event.target.value as AllThreadsSort)}
          >
            {sidebarPreferences_sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {model.allThreadsSort === "activity" ? (
        model.recencySections.map((section) => (
          <RecencyThreadSectionView
            key={section.bucket}
            section={section}
            historyExpanded={historyExpanded.has(recencyHistoryExpansionKey(section.bucket))}
            onToggleHistory={() => onToggleHistory(recencyHistoryExpansionKey(section.bucket))}
            selectedWorkspace={selectedWorkspace}
            selectedSession={selectedSession}
            threadMenu={threadMenu}
            onArchiveSession={onArchiveSession}
            onSelectSession={onSelectSession}
            onSetSessionPinned={onSetSessionPinned}
          />
        ))
      ) : (
        <>
          <div className="session-list session-list--history all-threads__list">
            {allPreview.visible.map((thread) => (
              <HistoryThreadRow
                key={sessionThreadKey(thread)}
                showContext
                thread={thread}
                selectedWorkspace={selectedWorkspace}
                selectedSession={selectedSession}
                threadMenu={threadMenu}
                onArchiveSession={onArchiveSession}
                onSelectSession={onSelectSession}
                onSetSessionPinned={onSetSessionPinned}
              />
            ))}
          </div>
          {allPreview.overflow ? (
            <HistoryToggle
              expanded={allThreadsExpanded}
              label="All threads"
              onToggle={() => onToggleHistory("all-threads")}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function RecencyThreadSectionView({
  section,
  historyExpanded,
  onToggleHistory,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onArchiveSession,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly section: RecencyThreadSection;
  readonly historyExpanded: boolean;
  readonly onToggleHistory: () => void;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}) {
  const history = threadHistoryPreview(section.threads, historyExpanded);
  return (
    <section
      className="recency-thread-group"
      aria-label={section.label}
      data-recency-bucket={section.bucket}
    >
      <div className="recency-thread-group__head">{section.label}</div>
      <div className="session-list session-list--history">
        {history.visible.map((thread) => (
          <HistoryThreadRow
            key={`${thread.workspaceId}:${thread.session.id}`}
            showContext
            thread={thread}
            selectedWorkspace={selectedWorkspace}
            selectedSession={selectedSession}
            threadMenu={threadMenu}
            onArchiveSession={onArchiveSession}
            onSelectSession={onSelectSession}
            onSetSessionPinned={onSetSessionPinned}
          />
        ))}
      </div>
      {history.overflow ? (
        <HistoryToggle
          expanded={historyExpanded}
          label={section.label}
          onToggle={onToggleHistory}
        />
      ) : null}
    </section>
  );
}

function HistoryThreadRow({
  thread,
  showContext = false,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onArchiveSession,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly thread: ThreadListEntry;
  readonly showContext?: boolean;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState | undefined;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}) {
  const active =
    thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
  return (
    <ThreadSessionRow
      active={active}
      showContext={showContext}
      thread={thread}
      threadMenu={threadMenu}
      onAction={() =>
        onArchiveSession({
          workspaceId: thread.workspaceId,
          sessionId: thread.session.id,
        })
      }
      onSelect={() =>
        onSelectSession({
          workspaceId: thread.workspaceId,
          sessionId: thread.session.id,
        })
      }
      onTogglePinned={() =>
        onSetSessionPinned(
          { workspaceId: thread.workspaceId, sessionId: thread.session.id },
          !thread.session.pinnedAt,
        )
      }
    />
  );
}

function HistoryToggle({
  expanded,
  label,
  onToggle,
  hiddenCount,
  accentColor,
}: {
  readonly expanded: boolean;
  readonly label: string;
  readonly onToggle: () => void;
  readonly hiddenCount?: number;
  readonly accentColor?: ProjectAccentColor;
}) {
  const counted = !expanded && hiddenCount !== undefined && hiddenCount > 0;
  const reportedCount = hiddenCount ?? 0;
  const hiddenLabel = `${reportedCount} ${reportedCount === 1 ? "Thread" : "Threads"} hidden`;
  const text = expanded ? "Show less" : counted ? hiddenLabel : "Show more";
  const accessibleLabel = expanded
    ? `Show less ${label}`
    : counted
      ? `Show ${reportedCount} hidden ${reportedCount === 1 ? "thread" : "threads"} in ${label}`
      : `Show more ${label}`;
  return (
    <button
      aria-expanded={expanded}
      aria-label={accessibleLabel}
      className={`thread-history-toggle ${
        counted ? "thread-history-toggle--hidden-count" : ""
      }`.trim()}
      data-testid={counted ? "threads-hidden-toggle" : undefined}
      style={
        counted && accentColor
          ? ({ "--thread-reveal-accent": accentColor } as CSSProperties)
          : undefined
      }
      title={counted ? hiddenLabel : undefined}
      type="button"
      onClick={onToggle}
    >
      {counted ? <HiddenThreadsIcon /> : null}
      {text}
    </button>
  );
}

function ThreadGroupingControl({
  grouping,
  onChange,
}: {
  readonly grouping: ThreadGrouping;
  readonly onChange: (grouping: ThreadGrouping) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [submenuStyle, setSubmenuStyle] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const groupingRef = useRef<HTMLButtonElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const submenuTimer = useRef<number | null>(null);

  const closeSubmenuSoon = () => {
    if (submenuTimer.current !== null) {
      window.clearTimeout(submenuTimer.current);
    }
    submenuTimer.current = window.setTimeout(() => {
      submenuTimer.current = null;
      setSubmenuOpen(false);
    }, 140);
  };

  const keepSubmenu = () => {
    if (submenuTimer.current !== null) {
      window.clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
    setSubmenuOpen(true);
  };

  const closeMenu = () => {
    if (submenuTimer.current !== null) {
      window.clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
    setSubmenuOpen(false);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (submenuTimer.current !== null) {
        window.clearTimeout(submenuTimer.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuStyle({
      top: rect.bottom + 6,
      left: rect.right,
      right: "auto",
      width: "max-content",
      transform: "translateX(-100%)",
    });
  }, [open]);

  useLayoutEffect(() => {
    if (!submenuOpen || !groupingRef.current) {
      return;
    }
    const rect = groupingRef.current.getBoundingClientRect();
    const gap = 6;
    const width = submenuRef.current?.offsetWidth ?? 0;
    const openRight = rect.right + gap;
    const left =
      width > 0 && openRight + width > window.innerWidth - 8
        ? Math.max(8, rect.left - gap - width)
        : openRight;
    setSubmenuStyle({
      top: rect.top - 6,
      left,
      right: "auto",
      width: "max-content",
    });
  }, [submenuOpen]);

  return (
    <span className="shortcut-tooltip-wrap thread-grouping" ref={wrapRef}>
      <button
        ref={buttonRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Customize Sidebar"
        className="icon-button"
        type="button"
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }
          setOpen(true);
        }}
      >
        <CustomizeSidebarIcon />
      </button>
      {open ? null : (
        <span className="shortcut-tooltip" role="tooltip">
          Customize Sidebar
        </span>
      )}
      {open
        ? createPortal(
            <div ref={menuRef}>
              <div
                aria-label="Customize Sidebar"
                className="workspace-menu thread-grouping__menu"
                role="menu"
                style={menuStyle}
              >
                <button
                  ref={groupingRef}
                  aria-expanded={submenuOpen}
                  aria-haspopup="menu"
                  className={`workspace-menu__item${submenuOpen ? " thread-grouping__parent--open" : ""}`}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    keepSubmenu();
                  }}
                  onMouseEnter={keepSubmenu}
                  onMouseLeave={closeSubmenuSoon}
                >
                  <span>Grouping</span>
                  <ChevronRightIcon />
                </button>
              </div>
              {submenuOpen ? (
                <div
                  ref={submenuRef}
                  aria-label="Grouping"
                  className="workspace-menu thread-grouping__submenu"
                  role="menu"
                  style={submenuStyle}
                  onMouseEnter={keepSubmenu}
                  onMouseLeave={closeSubmenuSoon}
                >
                  {(
                    [
                      ["time", "Time"],
                      ["workspace", "Workspace"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      aria-checked={grouping === value}
                      className="workspace-menu__item thread-grouping__option"
                      role="menuitemradio"
                      type="button"
                      onClick={() => {
                        closeMenu();
                        if (value !== grouping) {
                          onChange(value);
                        }
                      }}
                    >
                      <span aria-hidden="true" className="thread-grouping__check">
                        {grouping === value ? <CheckIcon /> : null}
                      </span>
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function ArchivedThreadsSection({
  archivedThreads,
  open,
  onToggle,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onUnarchiveSession,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly archivedThreads: readonly ThreadListEntry[];
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}) {
  return (
    <div className="archived-thread-group">
      <button
        aria-expanded={open}
        className="archived-thread-group__toggle"
        type="button"
        onClick={onToggle}
      >
        <span
          aria-hidden="true"
          className={`archived-thread-group__chevron ${open ? "archived-thread-group__chevron--open" : ""}`}
        >
          <ChevronDownIcon />
        </span>
        <span>Archived</span>
        <span className="archived-thread-group__count">{archivedThreads.length}</span>
      </button>
      {open ? (
        <div className="session-list session-list--archived">
          {archivedThreads.map((thread) => {
            const active =
              thread.workspaceId === selectedWorkspace?.id &&
              thread.session.id === selectedSession?.id;
            return (
              <ThreadSessionRow
                key={`${thread.workspaceId}:${thread.session.id}`}
                active={active}
                archived
                thread={thread}
                showContext
                threadMenu={threadMenu}
                onAction={() =>
                  onUnarchiveSession({
                    workspaceId: thread.workspaceId,
                    sessionId: thread.session.id,
                  })
                }
                onSelect={() =>
                  onSelectSession({
                    workspaceId: thread.workspaceId,
                    sessionId: thread.session.id,
                  })
                }
                onTogglePinned={() =>
                  onSetSessionPinned(
                    { workspaceId: thread.workspaceId, sessionId: thread.session.id },
                    !thread.session.pinnedAt,
                  )
                }
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PinnedThreadsSection({
  pinnedThreads,
  sortableIds,
  sortableIdForThread,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onArchiveSession,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly pinnedThreads: readonly ThreadListEntry[];
  readonly sortableIds: readonly string[];
  readonly sortableIdForThread: (thread: ThreadListEntry) => string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}) {
  return (
    <section className="pinned-thread-group" aria-label="Pinned threads">
      <div className="pinned-thread-group__head">
        <PinIcon filled />
        <span>Pinned</span>
      </div>
      <SortableContext items={[...sortableIds]} strategy={verticalListSortingStrategy}>
        <div className="session-list session-list--pinned">
          {pinnedThreads.map((thread) => {
            const active =
              thread.workspaceId === selectedWorkspace?.id &&
              thread.session.id === selectedSession?.id;
            return (
              <SortablePinnedThreadRow
                key={`${thread.workspaceId}:${thread.session.id}`}
                id={sortableIdForThread(thread)}
                active={active}
                thread={thread}
                threadMenu={threadMenu}
                onAction={() =>
                  onArchiveSession({
                    workspaceId: thread.workspaceId,
                    sessionId: thread.session.id,
                  })
                }
                onSelect={() =>
                  onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })
                }
                onTogglePinned={() =>
                  onSetSessionPinned(
                    { workspaceId: thread.workspaceId, sessionId: thread.session.id },
                    !thread.session.pinnedAt,
                  )
                }
              />
            );
          })}
        </div>
      </SortableContext>
    </section>
  );
}

/* ── Thread session row ────────────────────────────────── */

function SortablePinnedThreadRow({
  id,
  active,
  thread,
  threadMenu,
  onAction,
  onSelect,
  onTogglePinned,
}: {
  readonly id: string;
  readonly active: boolean;
  readonly thread: ThreadListEntry;
  readonly threadMenu: ThreadMenuState;
  readonly onAction: () => void;
  readonly onSelect: () => void;
  readonly onTogglePinned: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };
  return (
    <ThreadSessionRow
      ref={setNodeRef}
      style={style}
      active={active}
      thread={thread}
      threadMenu={threadMenu}
      showContext
      dragging={isDragging}
      dragAttributes={attributes}
      dragListeners={listeners}
      onAction={onAction}
      onSelect={onSelect}
      onTogglePinned={onTogglePinned}
    />
  );
}

function sessionIndicatorVariant(
  thread: ThreadListEntry,
): "running" | "failed" | "unseen" | "none" {
  if (thread.session.status === "running") {
    return "running";
  }
  if (thread.session.status === "failed") {
    return "failed";
  }
  if (thread.session.hasUnseenUpdate) {
    return "unseen";
  }
  return "none";
}

interface ThreadSessionRowProps {
  readonly active: boolean;
  readonly archived?: boolean;
  readonly showContext?: boolean;
  readonly overlay?: boolean;
  readonly dragging?: boolean;
  readonly style?: CSSProperties;
  readonly dragAttributes?: DraggableAttributes;
  readonly dragListeners?: DraggableSyntheticListeners;
  readonly thread: ThreadListEntry;
  readonly threadMenu?: ThreadMenuState;
  readonly onAction: () => void;
  readonly onSelect: () => void;
  readonly onTogglePinned: () => void;
}

const ThreadSessionRow = forwardRef<HTMLDivElement, ThreadSessionRowProps>(
  function ThreadSessionRow(
    {
      active,
      archived = false,
      showContext = false,
      overlay = false,
      dragging = false,
      style,
      dragAttributes,
      dragListeners,
      thread,
      threadMenu,
      onAction,
      onSelect,
      onTogglePinned,
    },
    ref,
  ) {
    const indicatorVariant = sessionIndicatorVariant(thread);
    const tree = useContext(ThreadListContext);
    const threadKey = sessionThreadKey(thread);
    const children = thread.children ?? [];
    const childrenOpen = !tree?.collapsed.has(threadKey);
    const pinned = Boolean(thread.session.pinnedAt);
    const actionContext = showContext ? ` in ${thread.contextLabel}` : "";
    const shortcut = tree?.shortcuts?.get(sessionThreadKey(thread));
    const shortcutBadge = overlay ? undefined : shortcut;
    const creationTimestamp = thread.session.createdAt;
    const age = sidebarOrder_creationAge(creationTimestamp);
    const childModel = sidebarOrder_childModelLabel(thread);
    const childStartedAt = thread.childCreatedAt ?? thread.session.createdAt;
    const childEndedAt =
      thread.childStatus === "complete" ||
      thread.childStatus === "failed" ||
      thread.childStatus === "cancelled"
        ? thread.session.updatedAt
        : undefined;
    const childDuration = sidebarOrder_elapsed(childStartedAt, childEndedAt);
    const childAge = sidebarOrder_creationAge(thread.childCreatedAt ?? thread.session.createdAt);
    const groupedChildren = sidebarPreferences_groupChildren(children);
    const accentColor = thread.accentColor ?? projectIdentity_fallbackAccent(thread.workspaceId);
    const threadOrigin = !thread.parentKey
      ? "human"
      : thread.childOriginGroup === "tool"
        ? "agent"
        : (thread.childOriginGroup ?? "unknown");
    const rowStyle: WorkspaceAccentStyle = {
      ...style,
      ...workspaceAccentStyle(accentColor),
    };
    const menuOpen =
      !overlay &&
      threadMenu?.openMenu?.surface === "sidebar" &&
      threadMenu.openMenu.sessionId === thread.session.id;
    const classes = [
      "session-row",
      children.length > 0 && !overlay ? "session-row--parent" : "",
      (thread.childStatus || showContext) && !overlay ? "session-row--with-meta" : "",
      active ? "session-row--active" : "",
      pinned ? "session-row--pinned" : "",
      dragging ? "session-row--dragging" : "",
      overlay ? "session-row--overlay" : "",
      shortcutBadge ? "session-row--shortcut" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <>
        <div
          ref={ref}
          style={rowStyle}
          className={classes}
          data-workspace-accent={accentColor}
          data-sidebar-indicator={indicatorVariant}
          data-thread-origin={threadOrigin}
          data-session-pinned={pinned ? "true" : "false"}
          data-session-id={thread.session.id}
          data-session-created-at={thread.session.createdAt ?? "unknown"}
          data-child-status={thread.childStatus}
          data-child-origin-group={thread.childOriginGroup}
          data-child-model={thread.childStatus ? childModel : undefined}
          data-child-duration={thread.childStatus ? childDuration : undefined}
          aria-description={
            thread.childStatus
              ? `Child thread ${thread.childStatus}, ${childModel}, ${childDuration}`
              : undefined
          }
          data-parent-thread={thread.parentKey}
          data-thread-shortcut={shortcutBadge ? String(shortcutBadge.slot) : undefined}
          aria-keyshortcuts={
            shortcutBadge ? `${IS_MAC ? "Meta" : "Control"}+${shortcutBadge.slot}` : undefined
          }
          onClick={() => {
            if (!dragging) onSelect();
          }}
          onContextMenu={(event) => {
            if (!threadMenu || overlay) return;
            event.preventDefault();
            event.stopPropagation();
            threadMenu.openSidebarMenu(thread.session.id);
          }}
        >
          {children.length > 0 && !overlay ? (
            <button
              type="button"
              className="session-row__tree-toggle"
              aria-label={`${childrenOpen ? "Collapse" : "Expand"} children of ${thread.session.title}`}
              aria-expanded={childrenOpen}
              onClick={(event) => {
                event.stopPropagation();
                tree?.toggle(threadKey);
              }}
            >
              {childrenOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </button>
          ) : null}
          <button
            className="session-row__select"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            type="button"
            {...dragAttributes}
            {...dragListeners}
          >
            <span className="session-row__leading" aria-hidden="true">
              {indicatorVariant === "running" ? (
                <ActivityIndicator
                  className="session-row__status session-row__status--running"
                  style={
                    tree?.props.activityIndicatorStyle ?? sidebarPreferences_defaultActivityStyle
                  }
                />
              ) : null}
              {indicatorVariant === "failed" ? (
                <span className="session-row__status session-row__status--failed" />
              ) : null}
              {indicatorVariant === "unseen" ? (
                <span className="session-row__status session-row__status--unseen" />
              ) : null}
            </span>
            <span className="session-row__body">
              <span className="session-row__title-line">
                <span className="session-row__title">{thread.session.title}</span>
                {thread.descendantCount ? (
                  <span
                    className="session-row__child-count"
                    aria-label={`${thread.descendantCount} child threads`}
                  >
                    {thread.descendantCount}
                  </span>
                ) : null}
                <span
                  className="session-row__time"
                  title={sidebarOrder_creationTooltip(creationTimestamp)}
                >
                  {age}
                </span>
              </span>
              {thread.childStatus ? (
                <span className="session-row__child-meta">
                  <span
                    className={`session-row__child-status session-row__child-status--${thread.childStatus}`}
                  >
                    {thread.childStatus}
                  </span>
                  <span className="session-row__child-model">{childModel}</span>
                  <span className="session-row__child-history">
                    {childEndedAt ? `${childDuration}` : `${childDuration} · ${childAge}`}
                  </span>
                </span>
              ) : null}
              {showContext ? (
                <span className="session-row__context">{thread.contextLabel}</span>
              ) : null}
            </span>
          </button>
          <span className="session-row__trailing">
            {thread.environment.kind === "worktree" ? (
              <span className="session-row__workspace-icon" aria-hidden="true" title="Worktree">
                <WorktreeIcon />
              </span>
            ) : null}
            {shortcutBadge ? (
              <span className="session-row__shortcut" aria-hidden="true">
                {shortcutBadge.label}
              </span>
            ) : null}
            <span className="session-row__action-cluster">
              {!archived ? (
                <button
                  aria-label={`${pinned ? "Unpin" : "Pin"} ${thread.session.title}${actionContext}`}
                  aria-pressed={pinned}
                  className="icon-button session-row__action session-row__pin-action"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePinned();
                  }}
                >
                  <PinIcon filled={pinned} />
                </button>
              ) : null}
              <span className="shortcut-tooltip-wrap session-row__tooltip-wrap">
                <button
                  aria-label={`${archived ? "Restore" : "Archive"} ${thread.session.title}${actionContext}`}
                  className="icon-button session-row__action"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction();
                  }}
                >
                  {archived ? <RestoreIcon /> : <ArchiveIcon />}
                </button>
                {threadMenu && !overlay && !menuOpen ? (
                  <span className="shortcut-tooltip session-row__tooltip" role="tooltip">
                    <span>{archived ? "Restore thread" : "Archive thread"}</span>
                    {archived ? null : <kbd>{archiveThreadShortcut(threadMenu.platform)}</kbd>}
                  </span>
                ) : null}
              </span>
            </span>
            {threadMenu && menuOpen ? (
              <div className="session-row__menu-wrap" ref={threadMenu.menuWrapRef}>
                <ThreadActionsMenu
                  actions={threadMenu.actionsFor(thread)}
                  className="session-row__menu"
                />
              </div>
            ) : null}
          </span>
        </div>
        {threadMenu?.renameSessionId === thread.session.id ? (
          <form
            className="workspace-rename session-rename"
            ref={threadMenu.renamePanelRef}
            onSubmit={(event) => {
              event.preventDefault();
              threadMenu.submitRename(thread);
            }}
          >
            <input
              aria-label={`Rename thread ${thread.session.title}`}
              className="workspace-rename__input"
              // Mounts when a rename starts, including after the sidebar or a
              // collapsed group opens to reveal the row.
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              value={threadMenu.renameDraft}
              onChange={(event) => threadMenu.setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  threadMenu.cancelRename();
                }
              }}
            />
            <div className="workspace-rename__actions">
              <button
                className="workspace-rename__button"
                type="button"
                onClick={threadMenu.cancelRename}
              >
                Cancel
              </button>
              <button
                className="workspace-rename__button workspace-rename__button--primary"
                type="submit"
              >
                Save
              </button>
            </div>
          </form>
        ) : null}
        {tree && !overlay && childrenOpen && children.length > 0 ? (
          <div
            className="session-tree__children"
            data-parent-session-id={thread.session.id}
            role="group"
            aria-label={`Children of ${thread.session.title}`}
          >
            {(["human", "tool", "scheduled", "unknown"] as const).map((originGroup) => {
              const group = groupedChildren[originGroup] as readonly ThreadListEntry[];
              return group.length ? (
                <Fragment key={originGroup}>
                  <span className="session-tree__origin" data-child-origin-group={originGroup}>
                    {originGroup === "human"
                      ? "Human-created"
                      : originGroup === "tool"
                        ? "Agent / tool"
                        : originGroup === "scheduled"
                          ? "Scheduled"
                          : "Origin unknown"}
                  </span>
                  {group.map((child) => (
                    <HistoryThreadRow
                      key={sessionThreadKey(child)}
                      thread={child}
                      showContext={showContext}
                      selectedWorkspace={tree.props.selectedWorkspace}
                      selectedSession={tree.props.selectedSession}
                      threadMenu={tree.props.threadMenu}
                      onArchiveSession={tree.props.onArchiveSession}
                      onSelectSession={tree.props.onSelectSession}
                      onSetSessionPinned={tree.props.onSetSessionPinned}
                    />
                  ))}
                </Fragment>
              ) : null;
            })}
          </div>
        ) : null}
      </>
    );
  },
);
