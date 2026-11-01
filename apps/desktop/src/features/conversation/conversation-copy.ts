import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineTranscriptItem } from "../../../contracts/timeline-types";

const ACTIVE_BRANCH_SCOPE =
  "complete Markdown for the currently loaded active branch. Deleted branches and unloaded history are not included. Image data, binary payloads, recognized credential/secret structured fields, and non-plain runtime objects are excluded from structured tool data.";
const CREDENTIAL_FIELD_NAMES = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "auth",
  "authentication",
  "authorization",
  "authorizationheader",
  "authtoken",
  "bearertoken",
  "clientsecret",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "env",
  "environment",
  "header",
  "headers",
  "idtoken",
  "identitytoken",
  "password",
  "passphrase",
  "passwd",
  "privatekey",
  "proxyauthorization",
  "refreshtoken",
  "runtime",
  "secret",
  "secretkey",
  "secrets",
  "securitytoken",
  "sessionkey",
  "sessiontoken",
  "setcookie",
  "setcookies",
  "token",
  "xapikey",
]);
const IMAGE_DATA_URL = /^data:image\/[^;,]+(?:;[^,]*)?,/i;
const COPY_FAILURE = "Couldn't copy. Check clipboard access and try again.";
const RUNTIME_VALUE_OMITTED = "[runtime value omitted]";
const MAX_STRUCTURED_DEPTH = 64;

export type ConversationCopyState = "idle" | "success" | "error";

export interface ConversationClipboard {
  readonly state: ConversationCopyState;
  readonly announcement: string;
  readonly copyText: (text: string) => void;
}

/** Response copy is intentionally the source Markdown without a label or fence. */
export function conversationCopyResponseMarkdown(text: string): string {
  return text;
}

/**
 * Serialize structured tool input/output for the expanded tool copy control.
 * Plain strings remain opaque, so prose and source code are never rewritten.
 */
export function conversationCopyToolContent(input: unknown, output: unknown): string {
  const parts: string[] = [];
  if (input !== undefined) parts.push(conversationCopyStructuredText(input));
  if (output !== undefined) parts.push(conversationCopyStructuredText(output));
  return parts.join("\n\n");
}

/**
 * Serialize only the transcript supplied to the timeline, in its current order.
 * This includes tool rows, summaries and extension transcript messages, while
 * deliberately excluding image payloads and values whose names mark runtime or
 * credential state.
 */
export function conversationCopyTranscriptMarkdown(
  transcript: readonly TimelineTranscriptItem[],
): string {
  const sections = [
    "# Active branch transcript",
    `> Scope: ${ACTIVE_BRANCH_SCOPE}`,
    ...transcript.map(conversationCopyTimelineItem),
  ];
  return `${sections.join("\n\n").trimEnd()}\n`;
}

/** Shared clipboard state for every conversation copy control. */
export function useConversationClipboard(): ConversationClipboard {
  const [state, setState] = useState<ConversationCopyState>("idle");
  const [announcement, setAnnouncement] = useState("");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  const copyText = useCallback(
    (text: string): void => {
      clearResetTimer();
      setState("idle");
      setAnnouncement("");
      const fail = () => {
        setState("error");
        setAnnouncement(COPY_FAILURE);
      };
      const clipboard = navigator.clipboard;
      if (!clipboard || typeof clipboard.writeText !== "function") {
        fail();
        return;
      }
      clipboard.writeText(text).then(() => {
        setState("success");
        setAnnouncement("Copied to clipboard.");
        resetTimer.current = setTimeout(() => {
          setState("idle");
          setAnnouncement("");
          resetTimer.current = null;
        }, 1_800);
      }, fail);
    },
    [clearResetTimer],
  );

  return { state, announcement, copyText };
}

function conversationCopyTimelineItem(item: TimelineTranscriptItem): string {
  switch (item.kind) {
    case "message":
      return conversationCopyMessage(item);
    case "tool":
      return conversationCopyTool(item);
    case "summary":
      return conversationCopySummary(item);
    case "activity":
      return conversationCopyActivity(item);
    case "custom":
      return `## Extension message: ${item.customType}\n\n${item.text}`;
    case "card":
      return conversationCopyCard(item);
    default:
      return unhandledTimelineCopyItem(item);
  }
}

function conversationCopyMessage(
  item: Extract<TimelineTranscriptItem, { readonly kind: "message" }>,
): string {
  const label =
    item.role === "user"
      ? "User"
      : item.role === "assistant"
        ? "Assistant"
        : item.role === "branchSummary"
          ? "Branch summary"
          : "Compaction summary";
  const attachments = item.attachments?.map((attachment) =>
    attachment.kind === "image"
      ? `- Image attachment omitted: ${attachment.name ?? "unnamed"} (${attachment.mimeType})`
      : `- File attachment: ${escapeInline(attachment.name)} (${escapeInline(attachment.mimeType)}) \`${escapeCode(attachment.fsPath)}\``,
  );
  const body = item.text.length > 0 ? item.text : "_No text content._";
  return [`## ${label}`, ...(attachments?.length ? [attachments.join("\n")] : []), body].join(
    "\n\n",
  );
}

function conversationCopyTool(
  item: Extract<TimelineTranscriptItem, { readonly kind: "tool" }>,
): string {
  const metadata = [
    `- Status: ${item.status}`,
    `- Tool: ${escapeInline(item.toolName)}`,
    ...(item.label ? [`- Activity: ${escapeInline(item.label)}`] : []),
    ...(item.detail ? [`- Detail: ${item.detail}`] : []),
    ...(item.metadata ? [`- Metadata: ${item.metadata}`] : []),
  ];
  const sections = [`## Tool: ${escapeInline(item.label || item.toolName)}`, metadata.join("\n")];

  if (item.input !== undefined) {
    sections.push(
      `### Input\n\n${conversationCopyFencedValue(conversationCopySafeToolValue(item.input))}`,
    );
  }
  if (item.output !== undefined) {
    sections.push(
      `### Output\n\n${conversationCopyFencedValue(conversationCopySafeToolValue(item.output))}`,
    );
  }
  return sections.join("\n\n");
}

function conversationCopySummary(
  item: Extract<TimelineTranscriptItem, { readonly kind: "summary" }>,
): string {
  return [
    `## Status: ${item.label}`,
    ...(item.metadata ? [`- Metadata: ${item.metadata}`] : []),
    ...(item.presentation === "divider" ? ["- Presentation: divider"] : []),
  ].join("\n\n");
}

function conversationCopyActivity(
  item: Extract<TimelineTranscriptItem, { readonly kind: "activity" }>,
): string {
  return [
    `## Activity: ${item.label}`,
    ...(item.tone ? [`- Tone: ${item.tone}`] : []),
    ...(item.detail ? [`- Detail: ${item.detail}`] : []),
    ...(item.metadata ? [`- Metadata: ${item.metadata}`] : []),
  ].join("\n\n");
}

function conversationCopyCard(
  item: Extract<TimelineTranscriptItem, { readonly kind: "card" }>,
): string {
  const rows = item.card.rows.map((row) => `- ${row.label}: ${row.value}`);
  const actions = item.card.actions.map((action) => {
    const reference =
      action.type === "url"
        ? action.url
        : action.type === "openFile"
          ? action.path
          : action.type === "composer"
            ? action.text
            : action.type === "command"
              ? action.command
              : action.sessionId;
    return `- Action: ${action.label} (${action.type}) \`${escapeCode(reference)}\``;
  });
  return [
    `## ${item.card.title}`,
    ...(item.card.subtitle ? [item.card.subtitle] : []),
    ...(rows.length ? [rows.join("\n")] : []),
    ...(actions.length ? [actions.join("\n")] : []),
  ].join("\n\n");
}

function conversationCopySafeToolValue(value: unknown): unknown {
  return sanitizeStructuredValue(value, new WeakSet<object>(), 0);
}

function conversationCopyStructuredText(value: unknown): string {
  const safe = conversationCopySafeToolValue(value);
  if (typeof safe === "string") return safe;
  return JSON.stringify(safe, null, 2) ?? RUNTIME_VALUE_OMITTED;
}

function sanitizeStructuredValue(value: unknown, active: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_STRUCTURED_DEPTH) return "[depth limit omitted]";
  if (typeof value === "string") {
    return IMAGE_DATA_URL.test(value) ? "[image data omitted]" : value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return RUNTIME_VALUE_OMITTED;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return "[binary omitted]";
  }
  if (Array.isArray(value)) {
    return sanitizeStructuredArray(value, active, depth);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (!isPlainStructuredObject(value)) {
    return RUNTIME_VALUE_OMITTED;
  }
  if (active.has(value)) {
    return "[circular data omitted]";
  }
  active.add(value);

  let keys: readonly string[];
  try {
    keys = Object.keys(value).sort();
  } catch {
    active.delete(value);
    return RUNTIME_VALUE_OMITTED;
  }

  const safe = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (isCredentialFieldName(key)) continue;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      safe[key] = RUNTIME_VALUE_OMITTED;
      continue;
    }
    if (!descriptor || !("value" in descriptor)) {
      safe[key] = RUNTIME_VALUE_OMITTED;
      continue;
    }
    safe[key] = sanitizeStructuredValue(descriptor.value, active, depth + 1);
  }
  active.delete(value);

  if (
    (safe.kind === "image" || safe.type === "image") &&
    (Object.hasOwn(safe, "data") || Object.hasOwn(safe, "src"))
  ) {
    delete safe.src;
    safe.data = "[image data omitted]";
  }
  return safe;
}

function sanitizeStructuredArray(
  value: readonly unknown[],
  active: WeakSet<object>,
  depth: number,
): readonly unknown[] {
  if (active.has(value)) return ["[circular data omitted]"];
  active.add(value);
  const safe: unknown[] = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      } catch {
        safe[index] = RUNTIME_VALUE_OMITTED;
        continue;
      }
      safe[index] =
        descriptor && "value" in descriptor
          ? sanitizeStructuredValue(descriptor.value, active, depth + 1)
          : descriptor
            ? RUNTIME_VALUE_OMITTED
            : undefined;
    }
  } finally {
    active.delete(value);
  }
  return safe;
}

function isPlainStructuredObject(value: object): boolean {
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isCredentialFieldName(name: string): boolean {
  return CREDENTIAL_FIELD_NAMES.has(name.replace(/[^A-Za-z0-9]/g, "").toLowerCase());
}

function conversationCopyFencedValue(value: unknown): string {
  const text =
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2) ?? String(value)}`;
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

function escapeInline(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, " ");
}

function escapeCode(text: string): string {
  return text.replace(/`/g, "\\`").replace(/\n/g, " ");
}

function unhandledTimelineCopyItem(item: never): never {
  void item;
  throw new Error("Unsupported transcript item for copy");
}
