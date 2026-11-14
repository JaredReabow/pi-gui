import { expect, test } from "@playwright/test";
import { ownsSlashCommandResult } from "../../src/features/conversation/hooks/use-slash-menu";

const submitted = { sessionKey: "workspace:thread", request: 1, draft: "/compact" };

test("an unchanged immediate command can adopt its result", () => {
  expect(ownsSlashCommandResult({ ...submitted }, submitted)).toBe(true);
});

test("a delayed command never owns newly typed or deliberately cleared text", () => {
  expect(ownsSlashCommandResult({ ...submitted, draft: "NEW_UNSAVED_DRAFT" }, submitted)).toBe(
    false,
  );
  expect(ownsSlashCommandResult({ ...submitted, draft: "" }, submitted)).toBe(false);
});

test("a delayed result never owns a different selected session", () => {
  expect(ownsSlashCommandResult({ ...submitted, sessionKey: "workspace:other" }, submitted)).toBe(
    false,
  );
});

test("an older command does not overwrite a newer request with identical text", () => {
  expect(ownsSlashCommandResult({ ...submitted, request: 2 }, submitted)).toBe(false);
});
