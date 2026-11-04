import type {
  ContextEditableContent,
  CustomEntry,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export const TRANSCRIPT_HISTORY_CUSTOM_TYPE = "pi-gui.transcript-history";
export const PI_GUI_FILE_ATTACHMENT_BLOCK_START = "<pi-gui-file-attachments>";
export const PI_GUI_FILE_ATTACHMENT_BLOCK_END = "</pi-gui-file-attachments>";

export interface TranscriptHistoryEdit {
  readonly version: 1;
  readonly targetId: string;
  readonly action: "edit";
  readonly text: string;
}

export interface TranscriptHistoryDelete {
  readonly version: 1;
  readonly targetId: string;
  readonly action: "delete";
}

export type TranscriptHistoryMutation = TranscriptHistoryEdit | TranscriptHistoryDelete;

/**
 * Decode one pi-gui history marker. Malformed or future-version entries are ignored so an
 * older desktop never reinterprets a shape it does not understand.
 */
export function transcriptHistory_decodeEntry(
  entry: Pick<CustomEntry, "type" | "customType" | "data"> | SessionEntry,
): TranscriptHistoryMutation | undefined {
  if (entry.type !== "custom" || entry.customType !== TRANSCRIPT_HISTORY_CUSTOM_TYPE) {
    return undefined;
  }
  const data = entry.data;
  if (!isRecord(data) || data.version !== 1 || typeof data.targetId !== "string") {
    return undefined;
  }
  const targetId = data.targetId.trim();
  if (!targetId) return undefined;
  if (data.action === "delete") {
    return { version: 1, targetId, action: "delete" };
  }
  if (data.action === "edit" && typeof data.text === "string" && data.text.trim()) {
    return { version: 1, targetId, action: "edit", text: data.text };
  }
  return undefined;
}

/** Latest valid history mutation for each target on the active branch. */
export function transcriptHistory_overlays(
  branch: readonly SessionEntry[],
): ReadonlyMap<string, TranscriptHistoryMutation> {
  const overlays = new Map<string, TranscriptHistoryMutation>();
  for (const entry of branch) {
    const mutation = transcriptHistory_decodeEntry(entry);
    if (mutation) overlays.set(mutation.targetId, mutation);
  }
  return overlays;
}

/** Tool calls owned by an assistant reply whose history overlay deletes the reply. */
export function transcriptHistory_hiddenToolCallIds(
  branch: readonly SessionEntry[],
  overlays: ReadonlyMap<string, TranscriptHistoryMutation>,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const entry of branch) {
    if (
      entry.type !== "message" ||
      entry.message.role !== "assistant" ||
      overlays.get(entry.id)?.action !== "delete" ||
      !Array.isArray(entry.message.content)
    ) {
      continue;
    }
    for (const part of entry.message.content) {
      if (isRecord(part) && part.type === "toolCall" && typeof part.id === "string") {
        hidden.add(part.id);
      }
    }
  }
  return hidden;
}

/**
 * Replace the model-visible text while preserving pi-gui's prompt envelopes. File-attachment
 * metadata, cross-project provenance, and annotation blocks remain attached to the edited body.
 */
export function transcriptHistory_mergeEditedText(
  originalText: string,
  editedText: string,
): string {
  const normalized = editedText.trim();
  let rest = originalText;
  let prefix = "";

  if (rest.startsWith(PI_GUI_FILE_ATTACHMENT_BLOCK_START)) {
    const endIndex = rest.indexOf(
      PI_GUI_FILE_ATTACHMENT_BLOCK_END,
      PI_GUI_FILE_ATTACHMENT_BLOCK_START.length,
    );
    if (endIndex >= 0) {
      const prefixEnd = endIndex + PI_GUI_FILE_ATTACHMENT_BLOCK_END.length;
      prefix += rest.slice(0, prefixEnd);
      rest = rest.slice(prefixEnd).replace(/^\n+/, "");
      if (rest) prefix += "\n";
    }
  }

  const crossProject =
    /^\[Message from project ("(?:[^"\\\n]|\\.)*") in thread ("(?:[^"\\\n]|\\.)*")\]\n\n/.exec(
      rest,
    );
  if (crossProject) {
    prefix += crossProject[0];
    rest = rest.slice(crossProject[0].length);
  }

  const annotationBlock =
    /^<annotation>\n<quote>\n[\s\S]*?\n<\/quote>(?:\n<note>\n[\s\S]*?\n<\/note>)?\n<\/annotation>(?:\n\n|$)/;
  for (let match = annotationBlock.exec(rest); match; match = annotationBlock.exec(rest)) {
    prefix += match[0];
    rest = rest.slice(match[0].length);
  }

  return `${prefix}${normalized}`;
}

/** Replace only text contributions, retaining image, thinking, and tool-call content blocks. */
export function transcriptHistory_replacementContent(
  originalContent: unknown,
  editedText: string,
): ContextEditableContent {
  if (typeof originalContent === "string") {
    return transcriptHistory_mergeEditedText(originalContent, editedText);
  }
  if (!Array.isArray(originalContent)) {
    return editedText.trim();
  }

  const content: readonly unknown[] = originalContent;
  const textParts = content.filter(isTextPart);
  const originalText = textParts.map((part) => part.text).join("\n\n");
  const replacementText = transcriptHistory_mergeEditedText(originalText, editedText);
  const firstTextIndex = content.findIndex(isTextPart);
  if (firstTextIndex < 0) {
    return [...content, { type: "text" as const, text: replacementText }] as ContextEditableContent;
  }

  return content.flatMap((part, index) => {
    if (!isTextPart(part)) return [part];
    if (index !== firstTextIndex) return [];
    return [{ ...part, text: replacementText }];
  }) as ContextEditableContent;
}

function isTextPart(value: unknown): value is { readonly type: "text"; readonly text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
