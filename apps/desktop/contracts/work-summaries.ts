import type { SessionModelSelection, SessionRef } from "@pi-gui/session-driver";
import type { TimelineTranscriptItem } from "./timeline-types";

export interface SummaryPreferences {
  readonly enabled: boolean;
  /** null follows the chat's model, including future model switches. */
  readonly model: SessionModelSelection | null;
}
export interface WorkSummaryResult {
  readonly text?: string;
  readonly error?: string;
  readonly model?: SessionModelSelection;
  readonly truncated?: boolean;
  /** Effective SDK request policy; absent in older cached summaries. */
  readonly request?: { readonly api: string; readonly thinkingLevel: string };
  /** Auxiliary summary usage; kept out of the chat context. */
  readonly usage?: { readonly totalTokens: number; readonly cost: number };
}
export interface SummaryTarget extends SessionRef {}
export interface SummaryPreferenceUpdate {
  readonly target?: SummaryTarget;
  readonly enabled?: boolean;
  readonly model?: SessionModelSelection | null;
}
export interface WorkSummaryRequest {
  readonly target: SummaryTarget;
  readonly promptId: string;
  readonly retry?: boolean;
}
export interface CompletedWork {
  readonly promptId: string;
  readonly prompt: string;
  readonly items: readonly TimelineTranscriptItem[];
}

/** Shared selection contract: host generates exactly the work the renderer folds. */
export function completedWork(
  transcript: readonly TimelineTranscriptItem[],
  running: boolean,
): readonly CompletedWork[] {
  const spans: CompletedWork[] = [];
  for (let start = 0; start < transcript.length; start++) {
    const prompt = transcript[start];
    if (prompt?.kind !== "message" || prompt.role !== "user") continue;
    let end = start + 1;
    while (end < transcript.length) {
      const item = transcript[end];
      if (item?.kind === "message" && item.role === "user") break;
      end++;
    }
    if (running && end === transcript.length) continue;
    const body = transcript.slice(start + 1, end);
    const tools = body.filter((item) => item.kind === "tool");
    if (tools.length === 0 || tools.some((item) => item.status === "running")) continue;
    let lastTool = -1;
    let lastReply = -1;
    body.forEach((item, index) => {
      if (item.kind === "tool") lastTool = index;
      if (item.kind === "message" && item.role === "assistant") lastReply = index;
    });
    // A reply before the final tool is commentary, not a final answer.
    const finalIndex = lastReply > lastTool ? lastReply : -1;
    const items = body.filter(
      (item, index) =>
        index !== finalIndex &&
        (item.kind === "tool" ||
          item.kind === "activity" ||
          (item.kind === "message" && item.role === "assistant") ||
          (item.kind === "summary" && item.presentation !== "divider")),
    );
    spans.push({ promptId: prompt.sourceMessageId ?? prompt.id, prompt: prompt.text, items });
  }
  return spans;
}
