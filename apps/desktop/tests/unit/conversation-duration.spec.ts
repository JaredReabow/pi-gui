import { expect, test } from "@playwright/test";
import {
  conversationDurationBetween,
  conversationDurationFormat,
  conversationDurationRunningLabel,
} from "../../src/features/conversation/conversation-duration";

test("formats completed and running conversation durations across day boundaries", () => {
  const cases = [
    [0, "1s"],
    [59_000, "59s"],
    [60_000, "1m"],
    [3_599_000, "59m 59s"],
    [3_600_000, "1h"],
    [86_399_000, "23h 59m 59s"],
    [86_400_000, "1d"],
    [183_845_000, "2d 3h 4m 5s"],
  ] as const;

  for (const [durationMs, expected] of cases) {
    expect(conversationDurationFormat(durationMs), `${durationMs}ms`).toBe(expected);
  }
});

test("preserves completed rounding and the running one-second floor", () => {
  expect(conversationDurationFormat(59_400)).toBe("59s");
  expect(conversationDurationFormat(59_500)).toBe("1m");
  expect(conversationDurationFormat(59_999)).toBe("1m");

  const startedAt = "2026-10-31T00:00:00.000Z";
  const startedMs = Date.parse(startedAt);
  expect(conversationDurationRunningLabel(startedAt, startedMs)).toBe("Working for 1s");
  expect(conversationDurationRunningLabel(startedAt, startedMs + 59_999)).toBe("Working for 59s");
  expect(conversationDurationRunningLabel(startedAt, startedMs + 60_000)).toBe("Working for 1m");
  expect(conversationDurationRunningLabel(startedAt, startedMs + 86_400_000)).toBe(
    "Working for 1d",
  );
});

test("does not fabricate duration for missing, invalid, negative, or future timestamps", () => {
  expect(conversationDurationFormat(undefined)).toBeNull();
  expect(conversationDurationFormat(null)).toBeNull();
  expect(conversationDurationFormat(Number.NaN)).toBeNull();
  expect(conversationDurationFormat(Number.POSITIVE_INFINITY)).toBeNull();
  expect(conversationDurationFormat(-1)).toBeNull();

  expect(conversationDurationBetween(undefined, "2026-10-31T00:00:01.000Z")).toBeNull();
  expect(conversationDurationBetween("not-a-date", "2026-10-31T00:00:01.000Z")).toBeNull();
  expect(
    conversationDurationBetween("2026-10-31T00:00:02.000Z", "2026-10-31T00:00:01.000Z"),
  ).toBeNull();

  const future = "2026-10-31T00:00:01.000Z";
  expect(conversationDurationRunningLabel(undefined, Date.parse(future))).toBe("Working…");
  expect(conversationDurationRunningLabel("not-a-date", Date.parse(future))).toBe("Working…");
  expect(conversationDurationRunningLabel(future, Date.parse(future) - 1)).toBe("Working…");
});

test("formats a completed timestamp interval in transcript order", () => {
  expect(conversationDurationBetween("2026-10-29T00:00:00.000Z", "2026-10-31T03:04:05.000Z")).toBe(
    "2d 3h 4m 5s",
  );
});
