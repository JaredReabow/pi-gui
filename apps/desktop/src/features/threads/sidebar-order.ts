import type { SessionRecord } from "../../../contracts/desktop-state";
import type { AllThreadsSort } from "../../../contracts/sidebar-preferences";
import { formatRelativeTime } from "../../lib/string-utils";

export interface SidebarOrderEntry {
  readonly workspaceId: string;
  readonly session: SessionRecord;
}

function sidebarOrder_textCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sidebarOrder_timestamp(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function sidebarOrder_compareTimestampDesc(
  left: string | undefined,
  right: string | undefined,
): number {
  const leftTimestamp = sidebarOrder_timestamp(left);
  const rightTimestamp = sidebarOrder_timestamp(right);
  if (leftTimestamp === Number.NEGATIVE_INFINITY) {
    return rightTimestamp === Number.NEGATIVE_INFINITY ? 0 : 1;
  }
  if (rightTimestamp === Number.NEGATIVE_INFINITY) return -1;
  return rightTimestamp - leftTimestamp;
}

export function sidebarOrder_sessionKey(entry: SidebarOrderEntry): string {
  return `${entry.workspaceId}:${entry.session.id}`;
}

/** Stable final ordering, including malformed ids that share a display title. */
function sidebarOrder_compareTie(left: SidebarOrderEntry, right: SidebarOrderEntry): number {
  return (
    sidebarOrder_textCompare(
      left.session.title.toLocaleLowerCase("en"),
      right.session.title.toLocaleLowerCase("en"),
    ) ||
    sidebarOrder_textCompare(left.session.title, right.session.title) ||
    sidebarOrder_textCompare(sidebarOrder_sessionKey(left), sidebarOrder_sessionKey(right))
  );
}

export function sidebarOrder_compareThreads(
  left: SidebarOrderEntry,
  right: SidebarOrderEntry,
  sort: AllThreadsSort,
): number {
  if (sort === "title") return sidebarOrder_compareTie(left, right);

  if (sort === "created") {
    const created = sidebarOrder_compareTimestampDesc(
      left.session.createdAt,
      right.session.createdAt,
    );
    return created || sidebarOrder_compareTie(left, right);
  }

  if (sort === "latest-human-input") {
    const human = sidebarOrder_compareTimestampDesc(
      left.session.lastInteractedAt,
      right.session.lastInteractedAt,
    );
    return human || sidebarOrder_compareTie(left, right);
  }

  if (sort === "unread-first") {
    const unread = Number(right.session.hasUnseenUpdate) - Number(left.session.hasUnseenUpdate);
    if (unread !== 0) return unread;
    const activity = sidebarOrder_compareTimestampDesc(
      left.session.updatedAt,
      right.session.updatedAt,
    );
    return activity || sidebarOrder_compareTie(left, right);
  }

  if (sort === "activity") {
    const activity = sidebarOrder_compareTimestampDesc(
      left.session.updatedAt,
      right.session.updatedAt,
    );
    return activity || sidebarOrder_compareTie(left, right);
  }

  return sidebarOrder_compareTie(left, right);
}

export function sidebarOrder_sortThreads<T extends SidebarOrderEntry>(
  entries: readonly T[],
  sort: AllThreadsSort,
): T[] {
  return [...entries].sort((left, right) => sidebarOrder_compareThreads(left, right, sort));
}

export function sidebarOrder_dedupeBySession<T extends SidebarOrderEntry>(
  entries: readonly T[],
): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = sidebarOrder_sessionKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** All Threads treats an identical host session id as one logical conversation. */
export function sidebarOrder_dedupeBySessionId<T extends SidebarOrderEntry>(
  entries: readonly T[],
): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.session.id)) return false;
    seen.add(entry.session.id);
    return true;
  });
}

/** Honest creation display: activity timestamps never substitute for creation. */
export function sidebarOrder_creationAge(createdAt: string | undefined): string {
  const timestamp = createdAt;
  return sidebarOrder_timestamp(timestamp) === Number.NEGATIVE_INFINITY
    ? "Unknown"
    : `Age ${formatRelativeTime(timestamp!)}`;
}

export function sidebarOrder_sessionAge(session: SessionRecord): string {
  return sidebarOrder_creationAge(session.createdAt);
}

export function sidebarOrder_creationTooltip(createdAt: string | undefined): string {
  return sidebarOrder_timestamp(createdAt) === Number.NEGATIVE_INFINITY
    ? "Creation time unavailable"
    : `Created ${createdAt}`;
}

export function sidebarOrder_elapsed(
  createdAt: string | undefined,
  endAt: string | undefined,
  nowMs: number = Date.now(),
): string {
  const start = sidebarOrder_timestamp(createdAt);
  const end = endAt ? sidebarOrder_timestamp(endAt) : nowMs;
  if (start === Number.NEGATIVE_INFINITY || end === Number.NEGATIVE_INFINITY) return "Unknown";
  const elapsedSeconds = Math.max(0, Math.floor((Math.max(end, start) - start) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function sidebarOrder_childModelLabel(entry: {
  readonly session: Pick<SessionRecord, "config">;
  readonly childSelectedConfig?: {
    readonly provider?: string;
    readonly modelId?: string;
  };
}): string {
  const provider = entry.childSelectedConfig?.provider ?? entry.session.config?.provider;
  const modelId = entry.childSelectedConfig?.modelId ?? entry.session.config?.modelId;
  if (!provider && !modelId) return "Default model";
  if (!provider) return modelId ?? "Default model";
  if (!modelId) return provider;
  return `${provider} / ${modelId}`;
}
