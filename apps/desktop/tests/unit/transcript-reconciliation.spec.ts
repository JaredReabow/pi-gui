import { test, expect } from "@playwright/test";
import { sessionKey, type SessionDriverEvent } from "@pi-gui/session-driver";
import type { TranscriptMessage } from "../../contracts/desktop-state";
import {
  appendAssistantDelta,
  applyTimelineEvent,
} from "../../electron/conversation/app-store-timeline";
import { reconcileAssistantMessages } from "../../electron/conversation/transcript-reconciliation";

const ref = { workspaceId: "workspace", sessionId: "thread" };
const key = sessionKey(ref);
const timestamp = "2026-11-08T12:00:00Z";
const message = (id: string, role: "user" | "assistant", text: string): TranscriptMessage => ({
  kind: "message",
  id,
  role,
  text,
  createdAt: timestamp,
});
function fixture() {
  const cache = new Map<string, readonly TranscriptMessage[]>();
  const state: Parameters<typeof applyTimelineEvent>[2] = {
    activeAssistantMessageBySession: new Map(),
    pendingAssistantMessageBySession: new Map(),
    runMetricsBySession: new Map(),
    runningSinceBySession: new Map(),
    extensionToolLabels: () => new Map(),
  };
  const send = (event: SessionDriverEvent) => applyTimelineEvent(cache, event, state);
  const end = () => send({ type: "assistantMessageEnded", sessionRef: ref, timestamp });
  const persist = (sourceMessageId: string, text: string) =>
    send({ type: "assistantMessagePersisted", sessionRef: ref, timestamp, sourceMessageId, text });
  const delta = (text: string) =>
    appendAssistantDelta(cache, state.activeAssistantMessageBySession, ref, text);
  return { cache, state, send, end, persist, delta };
}

test("final-only providers create one visible canonical answer without streaming deltas", () => {
  const h = fixture();
  h.end();
  h.persist("native-final", "COMPLETE_ANSWER");
  h.persist("native-final", "COMPLETE_ANSWER");
  expect(h.cache.get(key)).toEqual([
    { ...message("native-final", "assistant", "COMPLETE_ANSWER"), sourceMessageId: "native-final" },
  ]);
});

test("complete persisted text replaces truncated or mismatched deltas, preserving display identity", () => {
  const h = fixture();
  h.delta("incorrect partial");
  const id = h.cache.get(key)![0]!.id;
  h.end();
  h.persist("native-final", "Correct complete answer");
  expect(h.cache.get(key)).toHaveLength(1);
  expect(h.cache.get(key)![0]).toMatchObject({
    id,
    text: "Correct complete answer",
    sourceMessageId: "native-final",
  });
});

test("message completion repairs text before its tools and persisted identity follows the same row", () => {
  const h = fixture();
  h.send({
    type: "assistantMessageEnded",
    sessionRef: ref,
    timestamp,
    text: "Before tool, without deltas",
  });
  h.send({ type: "toolStarted", sessionRef: ref, timestamp, toolName: "read", callId: "read" });
  h.persist("native-commentary", "Before tool, without deltas");
  h.send({ type: "toolFinished", sessionRef: ref, timestamp, callId: "read", success: true });
  h.send({ type: "assistantMessageEnded", sessionRef: ref, timestamp, text: "Final answer" });
  h.persist("native-final", "Final answer");
  expect(h.cache.get(key)?.map((row) => (row.kind === "message" ? row.text : row.kind))).toEqual([
    "Before tool, without deltas",
    "tool",
    "Final answer",
  ]);
});

test("a replay cannot consume the next response's pending association", () => {
  const h = fixture();
  h.delta("commentary");
  h.end();
  h.persist("native-first", "commentary");
  h.delta("partial final");
  h.end();
  h.persist("native-first", "commentary");
  h.persist("native-final", "complete final");
  expect(
    h.cache.get(key)?.map((row) => row.kind === "message" && [row.sourceMessageId, row.text]),
  ).toEqual([
    ["native-first", "commentary"],
    ["native-final", "complete final"],
  ]);
});

test("a tool-only persisted message cannot erase partial stopped output or create an empty answer", () => {
  const h = fixture();
  h.delta("partial stopped text");
  h.end();
  h.persist("stopped", "");
  h.end();
  h.persist("tool-only", "");
  expect(h.cache.get(key)).toHaveLength(1);
  expect(h.cache.get(key)![0]).toMatchObject({ text: "partial stopped text" });
});

test("settled read inserts missing answers in native order across repeated prompts, retaining ephemeral rows", () => {
  const first = message("live-u1", "user", "same prompt");
  const next = message("live-u2", "user", "same prompt");
  const notice: TranscriptMessage = {
    kind: "activity",
    id: "notice",
    label: "Notice",
    createdAt: timestamp,
  };
  const queued = message("queued", "user", "not started");
  const live = [first, notice, next, queued];
  const saved = [
    message("u1", "user", "same prompt"),
    message("a1", "assistant", "first answer"),
    message("u2", "user", "same prompt"),
    message("a2", "assistant", "second answer"),
  ];
  const recovered = reconcileAssistantMessages(live, saved);
  expect(recovered.map((row) => row.id)).toEqual([
    "live-u1",
    "a1",
    "notice",
    "live-u2",
    "a2",
    "queued",
  ]);
  expect(recovered).toContain(notice);
  expect(recovered).toContain(queued);
  expect(reconcileAssistantMessages(recovered, saved)).toBe(recovered);
});

test("settled canonical read corrects existing and provisional rows without duplicating text", () => {
  const live = [
    message("user", "user", "prompt"),
    { ...message("display", "assistant", "answer pre"), sourceMessageId: "a" },
  ];
  const saved = [
    message("user", "user", "prompt"),
    message("a", "assistant", "answer preserved fully"),
  ];
  const recovered = reconcileAssistantMessages(live, saved);
  expect(recovered[1]).toMatchObject({
    id: "display",
    sourceMessageId: "a",
    text: "answer preserved fully",
  });
  const provisional = [
    message("user", "user", "prompt"),
    message("display", "assistant", "answer pre"),
  ];
  expect(reconcileAssistantMessages(provisional, saved)).toHaveLength(2);
});

test("canonical branch order moves a late persisted reply ahead of its tools and next prompt", () => {
  const tool: TranscriptMessage = {
    kind: "tool",
    id: "tool",
    callId: "tool",
    toolName: "read",
    label: "Read",
    status: "success",
    createdAt: timestamp,
  };
  const live = [
    message("live-user", "user", "first"),
    tool,
    message("live-next", "user", "second"),
    { ...message("display", "assistant", "first reply"), sourceMessageId: "native-first" },
    { ...message("display-next", "assistant", "second reply"), sourceMessageId: "native-next" },
  ];
  const saved = [
    message("native-user", "user", "first"),
    message("native-first", "assistant", "first reply"),
    tool,
    message("native-user-next", "user", "second"),
    message("native-next", "assistant", "second reply"),
  ];
  const fixed = reconcileAssistantMessages(live, saved);
  expect(fixed.map((row) => row.id)).toEqual([
    "live-user",
    "display",
    "tool",
    "live-next",
    "display-next",
  ]);
  expect(reconcileAssistantMessages(fixed, saved)).toBe(fixed);
});

test("empty canonical history preserves stopped partials and no-op recovery keeps array identity", () => {
  const live = [message("partial", "assistant", "partial retained")];
  expect(reconcileAssistantMessages(live, [])).toBe(live);
});
