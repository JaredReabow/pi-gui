import type {
  DisplayTimelineItem,
  TimelineToolCall,
  TimelineToolGroup,
} from "../../../contracts/timeline-types";
import { toolOutputImages } from "./tool-output-images";

const MIN_GROUP_SIZE = 2;
const MAX_SUMMARY_TOOL_TYPES = 3;

/**
 * Collapse adjacent successfully completed tool calls into one scan-friendly row.
 *
 * Running calls, failures and image results remain individual rows so current activity,
 * errors and rendered media are never hidden. Anything that is not a completed text tool
 * also ends the group, preserving the visible boundary between work, prose and turn markers.
 */
export function compactCompletedToolGroups(
  items: readonly DisplayTimelineItem[],
): readonly DisplayTimelineItem[] {
  const result: DisplayTimelineItem[] = [];
  let completed: TimelineToolCall[] = [];

  const flush = () => {
    if (completed.length >= MIN_GROUP_SIZE) {
      result.push(createToolGroup(completed));
    } else {
      result.push(...completed);
    }
    completed = [];
  };

  for (const item of items) {
    if (
      item.kind === "tool" &&
      item.status === "success" &&
      toolOutputImages(item.output).length === 0
    ) {
      completed.push(item);
      continue;
    }
    flush();
    result.push(item);
  }
  flush();
  return result;
}

export function createToolGroup(items: readonly TimelineToolCall[]): TimelineToolGroup {
  if (items.length === 0) {
    throw new Error("A tool group requires at least one tool call.");
  }
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = item.toolName.trim() || "tool";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const entries = [...counts].sort(
    ([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || leftName.localeCompare(rightName),
  );
  const visibleEntries = entries.slice(0, MAX_SUMMARY_TOOL_TYPES);
  const hiddenTypeCount = entries.length - visibleEntries.length;
  const metadata = [
    ...visibleEntries.map(([name, count]) => (count === 1 ? name : `${name} \u00d7 ${count}`)),
    ...(hiddenTypeCount > 0 ? [`+${hiddenTypeCount} more`] : []),
  ].join(" \u00b7 ");
  return {
    kind: "tool-group",
    id: `tool-group:${items[0]!.id}`,
    createdAt: items.at(-1)!.createdAt,
    label: `${items.length} actions completed`,
    metadata,
    items,
  };
}
