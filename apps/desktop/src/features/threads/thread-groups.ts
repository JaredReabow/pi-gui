import type {
  ChildThreadLink,
  DesktopAppState,
  OrchestrationChildThreadStatus,
  SessionRecord,
  ThreadGrouping,
  WorkspaceRecord,
} from "../../../contracts/desktop-state";
import type { ChildSelectedConfiguration } from "../../../contracts/child-selection";
import type { AllThreadsSort, FolderPreference } from "../../../contracts/sidebar-preferences";
import {
  projectIdentity_fallbackAccent,
  type ProjectAccentColor,
} from "../../../contracts/project-identity";
import {
  compareByRecency,
  RECENCY_BUCKET_LABELS,
  RECENCY_BUCKET_ORDER,
  recencyBucketer,
  sessionLastInteractedAt,
  type RecencyBucketId,
} from "../../../contracts/thread-recency";
import {
  sidebarOrder_compareThreads,
  sidebarOrder_dedupeBySession,
  sidebarOrder_dedupeBySessionId,
  sidebarOrder_sortThreads,
} from "./sidebar-order";
import {
  sidebarPreferences_childOriginGroup,
  sidebarPreferences_folderState,
  sidebarPreferences_markReadTargets,
  sidebarPreferences_previewTree,
  type SidebarChildOriginGroup,
} from "./sidebar-preferences";

export interface ThreadEnvironmentMeta {
  readonly kind: "local" | "worktree";
  readonly label: string;
  readonly branchName?: string;
  readonly detached?: boolean;
}

export interface ThreadListEntry {
  readonly folderId: string;
  readonly workspaceId: string;
  readonly session: SessionRecord;
  readonly accentColor: ProjectAccentColor;
  readonly environment: ThreadEnvironmentMeta;
  readonly contextLabel: string;
  /** Set when this row is drawn nested under its parent thread's row. */
  readonly parentKey?: string;
  readonly childStatus?: OrchestrationChildThreadStatus;
  /** Explicit host initiating identity; absent or correlation-only data stays unknown. */
  readonly childOriginGroup?: SidebarChildOriginGroup;
  readonly childSelectedConfig?: ChildSelectedConfiguration;
  readonly childCreatedAt?: string;
  /** Number of all descendants, not including this row. */
  readonly descendantCount?: number;
  /** Child threads drawn nested under this row in the selected All Threads order. */
  readonly children?: readonly ThreadListEntry[];
}

export interface WorkspaceThreadGroup {
  readonly workspace: WorkspaceRecord;
  readonly threads: readonly ThreadListEntry[];
}

export const THREAD_HISTORY_PREVIEW_LIMIT = 5;

export function threadHistoryPreview<T>(
  threads: readonly T[],
  expanded: boolean,
): { readonly visible: readonly T[]; readonly overflow: boolean } {
  const sizeOf = (thread: T): number => {
    const children = (thread as T & { readonly children?: readonly T[] }).children ?? [];
    return 1 + children.reduce((total, child) => total + sizeOf(child), 0);
  };
  const totalCount = threads.reduce((total, thread) => total + sizeOf(thread), 0);
  if (totalCount <= THREAD_HISTORY_PREVIEW_LIMIT) {
    return { visible: threads, overflow: false };
  }
  const visible: T[] = [];
  let visibleCount = 0;
  for (const thread of threads) {
    const treeSize = sizeOf(thread);
    if (visible.length > 0 && visibleCount + treeSize > THREAD_HISTORY_PREVIEW_LIMIT) break;
    visible.push(thread);
    visibleCount += treeSize;
  }
  const collapsed = {
    // Keep the first tree complete even when the tree itself exceeds the preview budget.
    visible: visible.length > 0 ? visible : threads.slice(0, 1),
    overflow: true,
  };
  return expanded ? { visible: threads, overflow: collapsed.overflow } : collapsed;
}

export interface RecencyThreadSection {
  readonly bucket: RecencyBucketId;
  readonly label: string;
  readonly threads: readonly ThreadListEntry[];
}

export interface ThreadSidebarModel {
  readonly folders: readonly WorkspaceRecord[];
  readonly accentColors: Readonly<Record<string, ProjectAccentColor>>;
  readonly workspaceGroups: readonly WorkspaceThreadGroup[];
  readonly pinnedThreads: readonly ThreadListEntry[];
  readonly recencySections: readonly RecencyThreadSection[];
  readonly archivedThreads: readonly ThreadListEntry[];
  readonly recencyOrder: readonly ThreadListEntry[];
  readonly allThreadsRoots: readonly ThreadListEntry[];
  readonly markReadTargets: readonly {
    readonly workspaceId: string;
    readonly sessionId: string;
  }[];
  readonly allThreadsSort: AllThreadsSort;
  readonly folderPreferencesByWorkspace?: Readonly<Record<string, FolderPreference>>;
}

export function buildThreadSidebarModel(
  state: DesktopAppState,
  nowMs: number = Date.now(),
): ThreadSidebarModel {
  const allThreadsSort = state.allThreadsSort ?? "activity";
  const entries = nestThreads(
    sidebarOrder_dedupeBySession(collectThreadEntries(state)),
    state.childThreadLinks,
    allThreadsSort,
  );
  const roots = entries.filter((entry) => !entry.parentKey);
  const pinnedThreads = roots
    .filter((entry) => !entry.session.archivedAt && Boolean(entry.session.pinnedAt))
    .sort((left, right) => comparePinnedThreads(left, right, state.pinnedSessionOrder));
  const workspaceHistoryThreads = roots
    .filter((entry) => !entry.session.archivedAt && !entry.session.pinnedAt && !entry.parentKey)
    .sort((left, right) => compareByRecency(left.session, right.session));
  const activityHistoryThreads = sidebarOrder_dedupeBySessionId(
    roots
      .filter((entry) => !entry.session.archivedAt && !entry.session.pinnedAt && !entry.parentKey)
      .sort((left, right) => sidebarOrder_compareThreads(left, right, "activity")),
  );
  const archivedThreads = roots
    .filter((entry) => Boolean(entry.session.archivedAt))
    .sort((left, right) => compareByRecency(left.session, right.session));
  const activeRoots = roots.filter((entry) => !entry.session.archivedAt);
  const recencyOrder = flattenThreadTrees(activeRoots).sort((left, right) =>
    compareByRecency(left.session, right.session),
  );
  const allThreadsRoots = sidebarOrder_sortThreads(
    sidebarOrder_dedupeBySessionId(
      roots.filter((entry) => !entry.session.archivedAt && !entry.session.pinnedAt),
    ),
    allThreadsSort,
  );
  const markReadEntries = sidebarOrder_dedupeBySessionId([
    ...flattenThreadTrees(activeRoots),
    ...flattenThreadTrees(archivedThreads),
  ]);
  const markReadTargets = sidebarPreferences_markReadTargets(markReadEntries);
  // Bucket each thread once, in recency order, instead of re-checking every thread per bucket.
  const bucketOf = recencyBucketer(nowMs);
  const historyByBucket = new Map<RecencyBucketId, ThreadListEntry[]>();
  for (const entry of activityHistoryThreads) {
    const bucket = bucketOf(sessionLastInteractedAt(entry.session));
    const threads = historyByBucket.get(bucket);
    if (threads) {
      threads.push(entry);
    } else {
      historyByBucket.set(bucket, [entry]);
    }
  }

  const folders = listFolders(state);
  return {
    folders,
    accentColors: Object.fromEntries(
      folders.map((workspace) => [
        workspace.id,
        state.sidebarAppearance?.projectByWorkspaceId[workspace.id]?.accentColor ??
          projectIdentity_fallbackAccent(workspace.id),
      ]),
    ),
    workspaceGroups: folders.map((workspace) => ({
      workspace,
      threads: workspaceHistoryThreads.filter((entry) => entry.folderId === workspace.id),
    })),
    pinnedThreads,
    recencySections: RECENCY_BUCKET_ORDER.flatMap((bucket) => {
      const threads = historyByBucket.get(bucket);
      return threads ? [{ bucket, label: RECENCY_BUCKET_LABELS[bucket], threads }] : [];
    }),
    archivedThreads,
    recencyOrder,
    allThreadsRoots,
    markReadTargets,
    allThreadsSort,
    folderPreferencesByWorkspace: state.folderPreferencesByWorkspace,
  };
}

/**
 * Nests each child thread under its parent's row. A child stays a top-level row when
 * it is pinned or archived, its parent is archived or missing, or the saved
 * links form a cycle, so every thread stays reachable. View-only: no transcript reads.
 */
function nestThreads(
  entries: readonly ThreadListEntry[],
  links: readonly ChildThreadLink[],
  sort: NonNullable<DesktopAppState["allThreadsSort"]>,
): ThreadListEntry[] {
  const byKey = new Map(entries.map((entry) => [sessionThreadKey(entry), entry]));
  const linkByChild = new Map<string, ChildThreadLink>();
  for (const link of links) {
    const key = `${link.childWorkspaceId}:${link.childSessionId}`;
    if (!linkByChild.has(key)) linkByChild.set(key, link);
  }
  const parentOf = new Map<string, string>();
  for (const link of linkByChild.values()) {
    const key = `${link.childWorkspaceId}:${link.childSessionId}`;
    const parentKey = `${link.parentWorkspaceId}:${link.parentSessionId}`;
    const child = byKey.get(key);
    const parent = byKey.get(parentKey);
    if (!child || !parent || key === parentKey || parentOf.has(key)) continue;
    if (child.session.archivedAt || child.session.pinnedAt) continue;
    if (parent.session.archivedAt) continue;
    parentOf.set(key, parentKey);
  }
  for (const start of [...parentOf.keys()]) {
    const path = new Set<string>();
    for (let cursor: string | undefined = start; cursor; cursor = parentOf.get(cursor)) {
      if (path.has(cursor)) {
        parentOf.delete(cursor);
        break;
      }
      path.add(cursor);
    }
  }
  const childKeys = new Map<string, string[]>();
  for (const [key, parentKey] of parentOf) {
    const siblings = childKeys.get(parentKey);
    if (siblings) siblings.push(key);
    else childKeys.set(parentKey, [key]);
  }
  const built = new Map<string, ThreadListEntry>();
  const originRank = (entry: ThreadListEntry): number => {
    if (entry.childOriginGroup === "human") return 0;
    if (entry.childOriginGroup === "tool") return 1;
    if (entry.childOriginGroup === "scheduled") return 2;
    return 3;
  };
  const build = (key: string): ThreadListEntry => {
    const done = built.get(key);
    if (done) return done;
    const entry = byKey.get(key)!;
    const children = (childKeys.get(key) ?? [])
      .map(build)
      .sort(
        (left, right) =>
          originRank(left) - originRank(right) || sidebarOrder_compareThreads(left, right, sort),
      );
    const parentKey = parentOf.get(key);
    const link = linkByChild.get(key);
    const descendantCount = children.reduce(
      (total, child) => total + 1 + (child.descendantCount ?? 0),
      0,
    );
    const next: ThreadListEntry = {
      ...entry,
      ...(link?.status ? { childStatus: link.status } : {}),
      ...(link
        ? {
            childOriginGroup: sidebarPreferences_childOriginGroup(entry.session.initiatingOrigin),
          }
        : {}),
      ...(link?.selectedConfig ? { childSelectedConfig: link.selectedConfig } : {}),
      ...(link?.createdAt ? { childCreatedAt: link.createdAt } : {}),
      ...(descendantCount ? { descendantCount } : {}),
      ...(parentKey ? { parentKey } : {}),
      ...(children.length ? { children } : {}),
    };
    built.set(key, next);
    return next;
  };
  return entries.map((entry) => build(sessionThreadKey(entry)));
}

export function flattenThreadTrees(
  roots: readonly ThreadListEntry[],
  collapsed: ReadonlySet<string> = new Set(),
): ThreadListEntry[] {
  const result: ThreadListEntry[] = [];
  const pending = [...roots].reverse();
  while (pending.length) {
    const entry = pending.pop()!;
    result.push(entry);
    if (!collapsed.has(sessionThreadKey(entry))) {
      const children = entry.children ?? [];
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!);
    }
  }
  return result;
}

function listFolders(state: DesktopAppState): readonly WorkspaceRecord[] {
  const workspacesById = new Map(
    state.workspaces.map((workspace) => [workspace.id, workspace] as const),
  );
  const rootWorkspaces = state.workspaces.filter((workspace) => workspace.kind === "primary");
  const orphanWorktrees = state.workspaces.filter(
    (workspace) =>
      workspace.kind === "worktree" && !workspacesById.has(workspace.rootWorkspaceId ?? ""),
  );
  const order = state.workspaceOrder;
  const sortedRoots = [...rootWorkspaces].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return -1;
    if (bi === -1) return 1;
    return ai - bi;
  });
  return [...sortedRoots, ...orphanWorktrees];
}

function collectThreadEntries(state: DesktopAppState): ThreadListEntry[] {
  const workspacesById = new Map(
    state.workspaces.map((workspace) => [workspace.id, workspace] as const),
  );
  const folders = listFolders(state);
  return folders.flatMap((folder) => {
    const accentColor =
      state.sidebarAppearance?.projectByWorkspaceId[folder.id]?.accentColor ??
      projectIdentity_fallbackAccent(folder.id);
    if (folder.kind !== "primary") {
      return folder.sessions.map((session) => ({
        folderId: folder.id,
        workspaceId: folder.id,
        session,
        accentColor,
        environment: {
          kind: "worktree" as const,
          label: folder.name,
          branchName: folder.branchName,
          detached: !folder.branchName,
        },
        contextLabel: folder.name,
      }));
    }

    const linkedWorkspaces = (state.worktreesByWorkspace[folder.id] ?? [])
      .map((worktree) => ({
        worktree,
        workspace: worktree.linkedWorkspaceId
          ? workspacesById.get(worktree.linkedWorkspaceId)
          : undefined,
      }))
      .filter(
        (
          entry,
        ): entry is {
          worktree: NonNullable<(typeof state.worktreesByWorkspace)[string][number]>;
          workspace: WorkspaceRecord;
        } => Boolean(entry.workspace),
      );

    return [
      ...folder.sessions.map((session) => ({
        folderId: folder.id,
        workspaceId: folder.id,
        session,
        accentColor,
        environment: {
          kind: "local" as const,
          label: "Local",
        },
        contextLabel: folder.name,
      })),
      ...linkedWorkspaces.flatMap(({ workspace, worktree }) =>
        workspace.sessions.map((session) => ({
          folderId: folder.id,
          workspaceId: workspace.id,
          session,
          accentColor,
          environment: {
            kind: "worktree" as const,
            label: worktree.name,
            branchName: worktree.branchName,
            detached: !worktree.branchName,
          },
          contextLabel: `${folder.name} / ${worktree.name}`,
        })),
      ),
    ];
  });
}

export function sessionThreadKey(thread: ThreadListEntry): string {
  return `${thread.workspaceId}:${thread.session.id}`;
}

const EMPTY_EXPANDED_HISTORY: ReadonlySet<string> = new Set();

export function workspaceHistoryExpansionKey(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

export function recencyHistoryExpansionKey(bucket: RecencyBucketId): string {
  return `bucket:${bucket}`;
}

export interface VisibleThreadShortcutOptions {
  readonly grouping: ThreadGrouping;
  readonly model: ThreadSidebarModel;
  readonly expandedHistory?: ReadonlySet<string>;
  readonly archivedOpen?: boolean;
  /** Folder groups folded shut in the sidebar; their rows are not on screen. */
  readonly collapsedWorkspaceIds?: readonly string[];
  readonly collapsedThreadKeys?: ReadonlySet<string>;
  readonly folderPreferencesByWorkspace?: Readonly<Record<string, FolderPreference>>;
  readonly revealKeys?: ReadonlySet<string>;
}

export function visibleThreadShortcutOrder(
  options: VisibleThreadShortcutOptions,
): readonly ThreadListEntry[] {
  const expandedHistory = options.expandedHistory ?? EMPTY_EXPANDED_HISTORY;
  const collapsedWorkspaceIds = options.collapsedWorkspaceIds ?? [];
  const unpinned =
    options.grouping === "workspace"
      ? options.model.workspaceGroups.flatMap((group) => {
          const expanded = expandedHistory.has(workspaceHistoryExpansionKey(group.workspace.id));
          const preference = sidebarPreferences_folderState(
            group.workspace.id,
            options.folderPreferencesByWorkspace ?? options.model.folderPreferencesByWorkspace,
            collapsedWorkspaceIds,
          );
          return sidebarPreferences_previewTree(
            group.threads,
            preference,
            options.revealKeys,
            expanded,
          ).visible;
        })
      : options.model.allThreadsSort === "activity"
        ? options.model.recencySections.flatMap(
            (section) =>
              threadHistoryPreview(
                section.threads,
                expandedHistory.has(recencyHistoryExpansionKey(section.bucket)),
              ).visible,
          )
        : sidebarPreferences_previewTree(
            options.model.allThreadsRoots,
            "partial",
            options.revealKeys,
            expandedHistory.has("all-threads"),
          ).visible;
  return flattenThreadTrees(
    [
      ...options.model.pinnedThreads,
      ...unpinned,
      ...(options.archivedOpen ? options.model.archivedThreads : []),
    ],
    options.collapsedThreadKeys,
  );
}

export function comparePinnedThreads(
  left: ThreadListEntry,
  right: ThreadListEntry,
  pinnedSessionOrder: readonly string[] = [],
): number {
  const order = new Map(pinnedSessionOrder.map((key, index) => [key, index] as const));
  const leftIndex = order.get(sessionThreadKey(left));
  const rightIndex = order.get(sessionThreadKey(right));
  if (leftIndex !== undefined || rightIndex !== undefined) {
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  }
  const leftPinnedAt = left.session.pinnedAt ?? "";
  const rightPinnedAt = right.session.pinnedAt ?? "";
  if (leftPinnedAt !== rightPinnedAt) {
    return rightPinnedAt.localeCompare(leftPinnedAt);
  }
  return compareByRecency(left.session, right.session);
}
