import {
  childSelection_initiatingKind,
  type SessionInitiatingKind,
  type SessionInitiatingOrigin,
} from "../../../contracts/child-selection";
import type {
  AllThreadsSort,
  FolderPreference,
  MarkAllThreadsReadInput,
} from "../../../contracts/sidebar-preferences";
import { sidebarOrder_sessionKey, type SidebarOrderEntry } from "./sidebar-order";

export const SIDEBAR_PARTIAL_TREE_LIMIT = 5;

export interface SidebarTreeEntry extends SidebarOrderEntry {
  readonly children?: readonly SidebarTreeEntry[];
}

export interface SidebarTreePreview<T extends SidebarTreeEntry> {
  readonly visible: readonly T[];
  readonly overflow: boolean;
  readonly visibleCount: number;
  readonly totalCount: number;
}

export type SidebarChildOriginGroup = SessionInitiatingKind;
export type MarkReadTarget = MarkAllThreadsReadInput["targets"][number];
export interface MarkReadBatchPlan {
  readonly targets: readonly MarkReadTarget[];
  readonly batches: readonly (readonly MarkReadTarget[])[];
  readonly total: number;
}
export interface MarkReadExecutionResult {
  readonly status: "complete" | "partial" | "failed";
  readonly completed: number;
  readonly total: number;
  readonly error?: string;
}

export const sidebarPreferences_sortOptions: readonly {
  readonly value: AllThreadsSort;
  readonly label: string;
}[] = [
  { value: "activity", label: "Activity" },
  { value: "latest-human-input", label: "Latest input" },
  { value: "unread-first", label: "Unread first" },
  { value: "created", label: "Created" },
  { value: "title", label: "Title" },
];

export function sidebarPreferences_folderState(
  workspaceId: string,
  preferences: Readonly<Record<string, FolderPreference>> | undefined,
  legacyCollapsedWorkspaceIds: readonly string[],
): FolderPreference {
  return (
    preferences?.[workspaceId] ??
    (legacyCollapsedWorkspaceIds.includes(workspaceId) ? "closed" : "partial")
  );
}

export function sidebarPreferences_cycleFolder(current: FolderPreference): FolderPreference {
  return current === "closed" ? "open" : "closed";
}

export function sidebarPreferences_treeSize(entry: SidebarTreeEntry): number {
  return (
    1 +
    (entry.children ?? []).reduce((total, child) => total + sidebarPreferences_treeSize(child), 0)
  );
}

export function sidebarPreferences_threadCount(roots: readonly SidebarTreeEntry[]): number {
  return roots.reduce((total, entry) => total + sidebarPreferences_treeSize(entry), 0);
}

function sidebarPreferences_treeContains(
  entry: SidebarTreeEntry,
  revealKeys: ReadonlySet<string>,
): boolean {
  return (
    revealKeys.has(sidebarOrder_sessionKey(entry)) ||
    (entry.children ?? []).some((child) => sidebarPreferences_treeContains(child, revealKeys))
  );
}

function sidebarPreferences_treeHasUnread(entry: SidebarTreeEntry): boolean {
  return (
    entry.session.hasUnseenUpdate ||
    (entry.children ?? []).some((child) => sidebarPreferences_treeHasUnread(child))
  );
}

/**
 * Computes the transient on-screen tree. A saved closed preference still reveals
 * unread and selected descendants; reveal never mutates the preference.
 */
export function sidebarPreferences_previewTree<T extends SidebarTreeEntry>(
  roots: readonly T[],
  preference: FolderPreference,
  revealKeys: ReadonlySet<string> = new Set(),
  expanded = false,
): SidebarTreePreview<T> {
  const totalCount = sidebarPreferences_threadCount(roots);
  if (preference === "open") {
    return { visible: roots, overflow: false, visibleCount: totalCount, totalCount };
  }

  const included = new Set<T>();
  if (preference === "partial") {
    let count = 0;
    for (const root of roots) {
      const size = sidebarPreferences_treeSize(root);
      if (count >= SIDEBAR_PARTIAL_TREE_LIMIT) break;
      included.add(root);
      count += size;
    }
  }
  for (const root of roots) {
    if (
      sidebarPreferences_treeContains(root, revealKeys) ||
      sidebarPreferences_treeHasUnread(root)
    ) {
      included.add(root);
    }
  }
  const visible = roots.filter((root) => included.has(root));
  const visibleCount = sidebarPreferences_threadCount(visible);
  const overflow = visible.length < roots.length;
  if (expanded) {
    return {
      visible: roots,
      overflow,
      visibleCount: totalCount,
      totalCount,
    };
  }
  return {
    visible,
    overflow,
    visibleCount,
    totalCount,
  };
}

export function sidebarPreferences_revealKeys(
  targetKey: string | undefined,
  ancestors: Iterable<string> = [],
): ReadonlySet<string> {
  return new Set([...(targetKey ? [targetKey] : []), ...ancestors]);
}

export function sidebarPreferences_markReadTargets<T extends SidebarOrderEntry>(
  entries: readonly T[],
): readonly { readonly workspaceId: string; readonly sessionId: string }[] {
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    if (!entry.session.hasUnseenUpdate) return [];
    if (seen.has(entry.session.id)) return [];
    seen.add(entry.session.id);
    return [{ workspaceId: entry.workspaceId, sessionId: entry.session.id }];
  });
}

/** Freeze and deduplicate the confirmed snapshot before constructing bounded calls. */
export function sidebarPreferences_markReadPlan(
  targets: readonly MarkReadTarget[],
  limit: number,
): MarkReadBatchPlan {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Mark-read limit must be a positive integer");
  }
  const seen = new Set<string>();
  const deduplicated: MarkReadTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.sessionId)) continue;
    seen.add(target.sessionId);
    deduplicated.push({ workspaceId: target.workspaceId, sessionId: target.sessionId });
  }
  const batches: MarkReadTarget[][] = [];
  for (let offset = 0; offset < deduplicated.length; offset += limit) {
    batches.push(deduplicated.slice(offset, offset + limit));
  }
  return { targets: deduplicated, batches, total: deduplicated.length };
}

/** Run captured batches in order so UI reporting can distinguish complete and partial writes. */
export async function sidebarPreferences_executeMarkReadPlan(
  plan: MarkReadBatchPlan,
  markBatch: (batch: readonly MarkReadTarget[]) => Promise<void>,
): Promise<MarkReadExecutionResult> {
  let completed = 0;
  try {
    for (const batch of plan.batches) {
      await markBatch(batch);
      completed += batch.length;
    }
    return { status: "complete", completed, total: plan.total };
  } catch (error) {
    return {
      status: completed > 0 ? "partial" : "failed",
      completed,
      total: plan.total,
      error: error instanceof Error ? error.message : "Mark-read request failed",
    };
  }
}

/** Only the explicit host projection determines the displayed group. */
export function sidebarPreferences_childOriginGroup(
  origin: SessionInitiatingOrigin | undefined,
): SidebarChildOriginGroup {
  return childSelection_initiatingKind(origin);
}

export function sidebarPreferences_groupChildren<T extends SidebarTreeEntry>(
  children: readonly T[],
): Readonly<Record<SidebarChildOriginGroup, readonly T[]>> {
  const grouped: Record<SidebarChildOriginGroup, T[]> = {
    human: [],
    tool: [],
    scheduled: [],
    unknown: [],
  };
  for (const child of children) {
    grouped[sidebarPreferences_childOriginGroup(child.session.initiatingOrigin)].push(child);
  }
  return grouped;
}
