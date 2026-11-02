import { expect, test } from "@playwright/test";
import type {
  DisplayTimelineItem,
  TimelineToolCall,
  TimelineToolStatus,
} from "../../contracts/timeline-types";
import { compactCompletedToolGroups } from "../../src/features/conversation/timeline-tool-groups";

function tool(
  id: string,
  toolName: string,
  status: TimelineToolStatus = "success",
): TimelineToolCall {
  return {
    kind: "tool",
    id,
    callId: id,
    toolName,
    status,
    label: `Ran ${toolName}`,
    createdAt: "2026-11-02T00:00:00.000Z",
    ...(status === "running" ? {} : { output: `${id} output` }),
  };
}

test("adjacent completed tools collapse into a stable summary", () => {
  const items = [
    tool("one", "bash"),
    tool("two", "read"),
    tool("three", "bash"),
  ] satisfies readonly DisplayTimelineItem[];

  const compacted = compactCompletedToolGroups(items);
  expect(compacted).toHaveLength(1);
  expect(compacted[0]).toMatchObject({
    kind: "tool-group",
    id: "tool-group:one",
    label: "3 actions completed",
    metadata: "bash \u00d7 2 \u00b7 read",
    items,
  });
});

test("running calls, failures, singleton actions and other rows remain visible boundaries", () => {
  const items = [
    tool("one", "bash"),
    tool("two", "read"),
    { kind: "activity", id: "reason", createdAt: "2026-11-02T00:00:00.000Z", label: "Reasoning" },
    tool("failed", "bash", "error"),
    tool("running", "bash", "running"),
    {
      ...tool("image", "read"),
      output: {
        content: [{ type: "image", mimeType: "image/png", src: "pi-gui-image://fixture" }],
      },
    },
    tool("single", "edit"),
    { kind: "activity", id: "boundary", createdAt: "2026-11-02T00:00:00.000Z", label: "Next" },
    tool("three", "bash"),
    tool("four", "bash"),
    {
      kind: "summary",
      id: "summary",
      createdAt: "2026-11-02T00:00:00.000Z",
      label: "New activity",
      presentation: "divider",
    },
  ] satisfies readonly DisplayTimelineItem[];

  const compacted = compactCompletedToolGroups(items);
  expect(compacted.map((item) => [item.kind, item.id])).toEqual([
    ["tool-group", "tool-group:one"],
    ["activity", "reason"],
    ["tool", "failed"],
    ["tool", "running"],
    ["tool", "image"],
    ["tool", "single"],
    ["activity", "boundary"],
    ["tool-group", "tool-group:three"],
    ["summary", "summary"],
  ]);
});

test("the summary caps tool names while retaining an accurate overflow count", () => {
  const items = [
    tool("one", "bash"),
    tool("two", "bash"),
    tool("three", "read"),
    tool("four", "edit"),
    tool("five", "search"),
    tool("six", "other"),
  ] satisfies readonly DisplayTimelineItem[];
  const [group] = compactCompletedToolGroups(items);
  expect(group).toMatchObject({
    kind: "tool-group",
    metadata: "bash \u00d7 2 \u00b7 edit \u00b7 other \u00b7 +2 more",
  });
});
