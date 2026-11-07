import type { SessionTranscriptMessage } from "@pi-gui/session-driver";
import type {
  DisplayTimelineItem,
  TimelineTranscriptItem,
} from "../../../contracts/timeline-types";
import { parseCrossProjectMessage } from "../../../contracts/thread-message";
import type { TimelineRow } from "./timeline-layout";
import { parseAnnotatedPrompt } from "./annotations/annotation-prompt";

export interface ContextualPrompt {
  /** Persisted message identity when available; the live row id is only a transport detail. */
  readonly id: string;
  /** Current display row that owns this prompt in the turn index. */
  readonly rowId: string;
  readonly text: string;
}

interface ContextualPromptRow {
  readonly item: DisplayTimelineItem;
  readonly top: number;
  readonly height?: number;
}

function isHumanMessage(item: TimelineTranscriptItem): item is SessionTranscriptMessage {
  return item.kind === "message" && item.role === "user";
}

function sourceMessageId(item: TimelineTranscriptItem): string | undefined {
  return item.kind === "message" ? item.sourceMessageId : undefined;
}

/**
 * A prompt rail belongs to the turn containing the first row at the viewport top.
 * Transcript order, not timestamps or the newest composer state, decides ownership.
 */
function visibleRowAt(rows: readonly ContextualPromptRow[], viewportTop: number) {
  const hasGeometry = rows.some((row) => row.height !== undefined);
  const intersecting = rows
    .filter((row) =>
      row.height === undefined
        ? row.top <= viewportTop + 0.5
        : row.top <= viewportTop + 0.5 && row.top + row.height > viewportTop + 0.5,
    )
    .sort((a, b) => a.top - b.top)
    .at(-1);
  if (intersecting) return intersecting;

  // Timeline rows have visual gaps. Keep the prompt owned by the row immediately
  // above a gap instead of unmounting the rail while the viewport sits between rows.
  const preceding = rows
    .filter((row) => row.top <= viewportTop + 0.5)
    .sort((a, b) => b.top - a.top)
    .at(0);
  if (preceding) return preceding;

  return [...rows].sort((a, b) => a.top - b.top).at(0);
}

function transcriptIndexForItem(
  transcript: readonly TimelineTranscriptItem[],
  item: DisplayTimelineItem,
): number {
  const direct = transcript.findIndex(
    (entry) => entry.id === item.id || sourceMessageId(entry) === item.id,
  );
  if (direct >= 0) return direct;
  if (item.kind !== "tool-group" && item.kind !== "work-summary") return -1;

  const indices = item.items
    .map((tool) =>
      transcript.findIndex((entry) => entry.id === tool.id || sourceMessageId(entry) === tool.id),
    )
    .filter((index) => index >= 0);
  return indices.length > 0 ? Math.min(...indices) : -1;
}

function transcriptIndexForVisibleRow(
  transcript: readonly TimelineTranscriptItem[],
  rows: readonly ContextualPromptRow[],
  visible: ContextualPromptRow,
): number {
  const direct = transcriptIndexForItem(transcript, visible.item);
  if (direct >= 0) return direct;

  if (visible.item.id === "working-indicator") return transcript.length - 1;
  if (visible.item.id.startsWith("turn-marker:")) {
    const promptId = visible.item.id.slice("turn-marker:".length);
    return transcript.findIndex(
      (item) => item.id === promptId || sourceMessageId(item) === promptId,
    );
  }

  const visibleTop = visible.top;
  const preceding = rows.filter((row) => row.top <= visibleTop).sort((a, b) => b.top - a.top);
  for (const row of preceding) {
    const index = transcriptIndexForItem(transcript, row.item);
    if (index >= 0) return index;
  }
  return -1;
}

function displayPromptText(text: string): string {
  const parsed = parseAnnotatedPrompt(text);
  return (parsed?.body ?? parseCrossProjectMessage(text)?.body ?? text)
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve the human prompt that owns the visible transcript row.
 *
 * A missing row or a position before the first human message intentionally returns null.
 * Using the newest human prompt there would attribute a response to a draft, a later turn,
 * or a different branch that the visible response does not prove.
 */
export function resolveContextualPrompt(
  transcript: readonly TimelineTranscriptItem[],
  rows: readonly ContextualPromptRow[],
  viewportTop: number,
): ContextualPrompt | null {
  const visible = visibleRowAt(rows, viewportTop);
  if (!visible) return null;

  const ownerIndex = transcriptIndexForVisibleRow(transcript, rows, visible);
  if (ownerIndex < 0) return null;

  for (let index = ownerIndex; index >= 0; index -= 1) {
    const item = transcript[index];
    if (!item || !isHumanMessage(item)) continue;
    const text = displayPromptText(item.text);
    if (!text) return null;
    return {
      id: item.sourceMessageId ?? item.id,
      rowId: item.id,
      text,
    };
  }

  return null;
}

export function contextualPromptFromViewport(
  transcript: readonly TimelineTranscriptItem[],
  visibleRows: readonly TimelineRow[],
  viewportTop: number,
): ContextualPrompt | null {
  return resolveContextualPrompt(transcript, visibleRows, viewportTop);
}
