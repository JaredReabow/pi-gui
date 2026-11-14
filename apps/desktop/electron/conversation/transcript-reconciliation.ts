import type { TranscriptMessage } from "../../contracts/desktop-state";

/**
 * Repair missing persisted assistant rows without replacing live-only notices,
 * queued prompts, partial stopped output, cards or display identities. Native
 * projection supplies branch order; user/tool rows serve as insertion anchors.
 */
export function reconcileAssistantMessages(
  live: readonly TranscriptMessage[],
  saved: readonly TranscriptMessage[],
): readonly TranscriptMessage[] {
  const rows = [...live];
  const anchors = new Map<string, string>();
  const knownById = new Map(
    rows.flatMap((row) => [
      [row.id, row] as const,
      ...(row.kind === "message" && row.sourceMessageId
        ? [[row.sourceMessageId, row] as const]
        : []),
    ]),
  );
  let userCursor = 0;
  for (const item of saved) {
    const known = knownById.get(item.id);
    if (known) {
      anchors.set(item.id, known.id);
      if (item.kind === "message" && item.role === "user") userCursor = rows.indexOf(known) + 1;
    } else if (item.kind === "message" && item.role === "user") {
      // Live user rows predate native persistence; align repeated prompts in order.
      const index = rows.findIndex(
        (row, i) =>
          i >= userCursor &&
          row.kind === "message" &&
          row.role === "user" &&
          row.text === item.text,
      );
      if (index >= 0) {
        anchors.set(item.id, rows[index]!.id);
        userCursor = index + 1;
      }
    }
  }
  const position = (id: string | undefined) =>
    id === undefined ? -1 : rows.findIndex((row) => row.id === id);
  for (let n = 0; n < saved.length; n++) {
    const item = saved[n]!;
    if (item.kind !== "message" || item.role !== "assistant" || !item.text) continue;
    const knownIndex = position(anchors.get(item.id));
    let before = -1,
      after = rows.length;
    for (let i = n - 1; i >= 0; i--) {
      const index = position(anchors.get(saved[i]!.id));
      if (index >= 0) {
        before = index;
        break;
      }
    }
    for (let i = n + 1; i < saved.length; i++) {
      const index = position(anchors.get(saved[i]!.id));
      if (index >= 0) {
        after = index;
        break;
      }
    }
    if (knownIndex >= 0) {
      const old = rows[knownIndex]!;
      const updated =
        old.kind === "message" && (old.text !== item.text || old.sourceMessageId !== item.id)
          ? { ...old, text: item.text, sourceMessageId: item.id }
          : old;
      rows[knownIndex] = updated;
      // If message_end was lost, persisted text may have arrived after its tools
      // or the next user prompt. Canonical branch order repairs that too.
      if (knownIndex <= before || knownIndex >= after) {
        const anchor = rows[before]?.id;
        const nextAnchor = rows[after]?.id;
        rows.splice(knownIndex, 1);
        const previous = position(anchor),
          next = position(nextAnchor);
        rows.splice(previous >= 0 ? previous + 1 : next >= 0 ? next : rows.length, 0, updated);
      }
      continue;
    }
    // A lost identity event may leave its provisional text behind. Match only
    // within this native interval, never steal another turn's assistant row.
    const provisional = rows.findIndex(
      (row, i) =>
        i > before &&
        i < after &&
        row.kind === "message" &&
        row.role === "assistant" &&
        !row.sourceMessageId &&
        (row.text === item.text || item.text.startsWith(row.text)),
    );
    if (provisional >= 0) {
      const old = rows[provisional]!;
      rows[provisional] = { ...item, id: old.id, sourceMessageId: item.id };
      anchors.set(item.id, old.id);
    } else {
      const inserted = { ...item, sourceMessageId: item.id };
      rows.splice(before >= 0 ? before + 1 : after, 0, inserted);
      anchors.set(item.id, item.id);
    }
  }
  return rows.length === live.length && rows.every((row, i) => row === live[i]) ? live : rows;
}
