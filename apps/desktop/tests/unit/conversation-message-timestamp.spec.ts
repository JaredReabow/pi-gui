import { expect, test } from "@playwright/test";
import { conversationMessageTimestamp_format } from "../../src/features/conversation/conversation-message-timestamp";

test("user message timestamps include both locale date and time", () => {
  const createdAt = "2026-11-02T04:05:00.000Z";
  const english = conversationMessageTimestamp_format(createdAt, "en", "UTC");
  const chinese = conversationMessageTimestamp_format(createdAt, "zh-CN", "UTC");

  expect(english).toContain("2026");
  expect(english).toMatch(/4:05/i);
  expect(english).toContain("·");
  expect(chinese).toContain("2026");
  expect(chinese).toContain("·");
});

test("invalid user message timestamps do not render a misleading caption", () => {
  expect(conversationMessageTimestamp_format("not-a-date", "en", "UTC")).toBeUndefined();
});
