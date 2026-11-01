import { expect, test } from "@playwright/test";
import type { DisplayTimelineItem, TimelineTranscriptItem } from "../../contracts/timeline-types";
import {
  resolveContextualPrompt,
  type ContextualPrompt,
} from "../../src/features/conversation/contextual-prompt-model";
import { formatAnnotatedPrompt } from "../../src/features/conversation/annotations/annotation-prompt";

const createdAt = "2026-10-31T00:00:00.000Z";

function message(
  id: string,
  role: "user" | "assistant" | "branchSummary" | "compactionSummary",
  text: string,
  sourceMessageId?: string,
): TimelineTranscriptItem {
  return {
    kind: "message",
    id,
    role,
    text,
    createdAt,
    ...(sourceMessageId ? { sourceMessageId } : {}),
  };
}

function tool(id: string): TimelineTranscriptItem {
  return {
    kind: "tool",
    id,
    callId: id,
    toolName: "read",
    status: "success",
    label: `Read ${id}`,
    createdAt,
  };
}

function row(item: DisplayTimelineItem, top: number) {
  return { item, top, height: 80 };
}

const prompt = (resolved: ContextualPrompt | null) =>
  resolved ? { id: resolved.id, rowId: resolved.rowId, text: resolved.text } : null;

test("assistant continuations and tools retain the human prompt that owns the turn", () => {
  const transcript = [
    message("user-live-1", "user", "Older prompt", "user-persisted-1"),
    message("assistant-1", "assistant", "Older answer"),
    tool("tool-1"),
    message("assistant-1-continuation", "assistant", "Continuation"),
    message("user-live-2", "user", "Newer prompt", "user-persisted-2"),
    message("assistant-2", "assistant", "Newer answer"),
  ];

  expect(
    prompt(
      resolveContextualPrompt(
        transcript,
        [
          row(transcript[0]!, 0),
          row(transcript[1]!, 100),
          row(transcript[2]!, 200),
          row(transcript[3]!, 300),
          row(transcript[4]!, 400),
        ],
        310,
      ),
    ),
  ).toEqual({
    id: "user-persisted-1",
    rowId: "user-live-1",
    text: "Older prompt",
  });

  expect(
    prompt(
      resolveContextualPrompt(
        transcript,
        [row(transcript[4]!, 400), row(transcript[5]!, 500)],
        500,
      ),
    ),
  ).toEqual({
    id: "user-persisted-2",
    rowId: "user-live-2",
    text: "Newer prompt",
  });
});

test("the first row at the viewport top selects the owning turn, including an exact boundary", () => {
  const transcript = [
    message("user-1", "user", "First"),
    message("assistant-1", "assistant", "Answer one"),
    tool("tool-1"),
    message("user-2", "user", "Second"),
    message("assistant-2", "assistant", "Answer two"),
  ];
  const rows = [
    row(transcript[1]!, 120),
    row(transcript[2]!, 240),
    row(transcript[3]!, 320),
    row(transcript[4]!, 420),
  ];

  expect(resolveContextualPrompt(transcript, rows, 250)?.id).toBe("user-1");
  expect(resolveContextualPrompt(transcript, rows, 320)?.id).toBe("user-2");
});

test("offscreen overscan rows and inserted turn markers do not select the previous turn", () => {
  const transcript = [
    message("user-1", "user", "Previous"),
    message("assistant-1", "assistant", "Previous answer"),
    message("user-2", "user", "Visible"),
    message("assistant-2", "assistant", "Visible answer"),
  ];
  const marker: DisplayTimelineItem = {
    kind: "turn-marker",
    id: "turn-marker:user-2",
    durationMs: 8_000,
  };
  const rows = [row(transcript[1]!, 0), row(marker, 120), row(transcript[3]!, 160)];

  expect(resolveContextualPrompt(transcript, rows, 120)?.id).toBe("user-2");
});

test("missing rows and positions before the first human return no invented prompt", () => {
  const transcript = [
    message("assistant-before-first", "assistant", "Imported prelude"),
    message("user-latest", "user", "Do not substitute the newest prompt"),
    message("assistant-latest", "assistant", "Latest answer"),
  ];

  expect(resolveContextualPrompt(transcript, [row(transcript[0]!, 0)], 0)).toBeNull();
  expect(resolveContextualPrompt(transcript, [], 0)).toBeNull();
  expect(
    resolveContextualPrompt(
      transcript,
      [row({ ...transcript[1]!, id: "missing-during-reload" }, 100)],
      100,
    ),
  ).toBeNull();
});

test("assistant-only and tool-only imports do not invent a human anchor", () => {
  const assistantOnly = [message("assistant", "assistant", "Imported answer")];
  const toolOnly = [tool("tool")];

  expect(resolveContextualPrompt(assistantOnly, [row(assistantOnly[0]!, 0)], 0)).toBeNull();
  expect(resolveContextualPrompt(toolOnly, [row(toolOnly[0]!, 0)], 0)).toBeNull();
});

test("a replacement transcript resolves only identities and order from that replacement", () => {
  const replaced = [
    message("replacement-user", "user", "Replacement branch prompt", "replacement-persisted"),
    message("replacement-assistant", "assistant", "Replacement answer"),
  ];

  expect(prompt(resolveContextualPrompt(replaced, [row(replaced[1]!, 0)], 0))).toEqual({
    id: "replacement-persisted",
    rowId: "replacement-user",
    text: "Replacement branch prompt",
  });
  expect(
    resolveContextualPrompt(
      replaced,
      [row({ kind: "activity", id: "old-row", createdAt, label: "old" }, 0)],
      0,
    ),
  ).toBeNull();
});

test("the rail displays prompt body text without leaking annotations or whitespace controls", () => {
  const transcript = [
    message(
      "user",
      "user",
      formatAnnotatedPrompt(
        [{ quote: "selected source", note: "review this" }],
        "Body line one\n\nBody line two",
      ),
    ),
    message("assistant", "assistant", "Answer"),
  ];

  expect(resolveContextualPrompt(transcript, [row(transcript[1]!, 0)], 0)?.text).toBe(
    "Body line one Body line two",
  );
});

test("prompts with no visible text do not produce an empty rail", () => {
  const transcript = [
    message("empty-user", "user", " \n "),
    message("assistant", "assistant", "Answer to attachments"),
  ];

  expect(resolveContextualPrompt(transcript, [row(transcript[1]!, 0)], 0)).toBeNull();
});
