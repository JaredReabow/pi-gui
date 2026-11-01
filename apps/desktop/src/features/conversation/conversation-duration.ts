const SECOND_MS = 1_000;

/**
 * Format a non-negative conversation duration. Missing, invalid, future and
 * non-finite inputs have no duration to report. The one-second floor and
 * completed-duration rounding match the values used before this formatter was
 * shared by completed turns and running turns.
 */
export function conversationDurationFormat(durationMs: number | null | undefined): string | null {
  if (
    durationMs === null ||
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / SECOND_MS));
  let remaining = totalSeconds;

  const days = Math.floor(remaining / 86_400);
  remaining %= 86_400;
  const hours = Math.floor(remaining / 3_600);
  remaining %= 3_600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return [
    days > 0 ? `${days}d` : "",
    hours > 0 ? `${hours}h` : "",
    minutes > 0 ? `${minutes}m` : "",
    seconds > 0 ? `${seconds}s` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Format the completed interval between two persisted timestamps. */
export function conversationDurationBetween(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): string | null {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return conversationDurationFormat(end - start);
}

/**
 * A running label for a persisted start timestamp. A future or unparseable
 * timestamp has no elapsed evidence, so it retains the existing "Working..."
 * fallback instead of inventing a duration.
 */
export function conversationDurationRunningLabel(
  startedAt: string | null | undefined,
  nowMs = Date.now(),
): string {
  if (!startedAt || !Number.isFinite(nowMs)) return "Working…";
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || nowMs < started) return "Working…";

  const elapsedMs = Math.floor((nowMs - started) / SECOND_MS) * SECOND_MS;
  const duration = conversationDurationFormat(elapsedMs);
  return duration ? `Working for ${duration}` : "Working…";
}
