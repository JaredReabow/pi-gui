import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorkSummaryOwner,
  decodeSavedSummaries,
} from "../../electron/conversation/work-summary-owner";
import { completedWork } from "../../contracts/work-summaries";
import type { TimelineTranscriptItem } from "../../contracts/timeline-types";
import { buildDisplayTimelineItems } from "../../src/features/conversation/timeline-turns";

const target = { workspaceId: "workspace", sessionId: "thread" };
const model = { provider: "test", modelId: "summary" };
const createdAt = "2026-11-07T12:00:00Z";
const transcript: TimelineTranscriptItem[] = [
  { kind: "message", id: "user", role: "user", text: "Fix it", createdAt },
  { kind: "message", id: "comment", role: "assistant", text: "Checking the change", createdAt },
  {
    kind: "tool",
    id: "first",
    callId: "first",
    toolName: "edit",
    status: "error",
    label: "edit failed",
    output: "old text not found",
    createdAt,
  },
  { kind: "custom", id: "notice", customType: "status", text: "Keep this visible", createdAt },
  {
    kind: "tool",
    id: "second",
    callId: "second",
    toolName: "read",
    status: "success",
    label: "Read source",
    createdAt,
  },
  { kind: "message", id: "final", role: "assistant", text: "Could not apply the patch", createdAt },
];
const setup = async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-work-summaries-"));
  const file = join(dir, "work-summaries.json");
  return { owner: new WorkSummaryOwner(file), file };
};

test("one work group includes failures/commentary and preserves prompt/final/extensions", () => {
  const work = completedWork(transcript, false);
  expect(work[0]?.items.map((item) => item.id)).toEqual(["comment", "first", "second"]);
  const rows = buildDisplayTimelineItems(transcript, { summaryTarget: target });
  expect(rows.map((row) => row.id)).toEqual(["user", "work-summary:user", "notice", "final"]);
  expect(completedWork(transcript, true)).toHaveLength(0);
  expect(buildDisplayTimelineItems(transcript).some((row) => row.kind === "work-summary")).toBe(
    false,
  );
});

test("default follows chat; explicit thread override and toggle survive reopen", async () => {
  const { owner, file } = await setup();
  expect(await owner.preferences(target)).toEqual({ enabled: true, model: null });
  await owner.update({ target, model });
  await owner.update({ enabled: false });
  const reopened = new WorkSummaryOwner(file);
  expect(await reopened.preferences(target)).toEqual({ enabled: false, model });
  expect((await reopened.preferences({ ...target, sessionId: "another" })).model).toBe(null);
  await reopened.update({ target, model: null });
  expect((await new WorkSummaryOwner(file).preferences(target)).model).toBe(null);
});

test("deduplicates concurrent work, persists summary, reuses semantic cache across row-id changes", async () => {
  const { owner, file } = await setup();
  let calls = 0;
  const generate = async (prompt: string) => {
    calls++;
    expect(prompt).toContain("old text not found");
    return { text: "Read source after a failed edit; patch remains unapplied.", model };
  };
  const request = {
    target,
    promptId: "user",
    transcript,
    running: false,
    chatModel: model,
    generate,
  };
  const [first, second] = await Promise.all([owner.summarize(request), owner.summarize(request)]);
  expect(calls).toBe(1);
  expect(first).toEqual(second);
  const renamed = transcript.map((item) => ({ ...item, id: `${item.id}-reopen` }));
  const reopened = new WorkSummaryOwner(file);
  expect(
    await reopened.summarize({ ...request, transcript: renamed, promptId: "user-reopen" }),
  ).toEqual(first);
  expect(calls).toBe(1);
  await reopened.update({ target, model: { ...model, modelId: "other" } });
  await reopened.summarize(request);
  expect(calls).toBe(2);
  const editedPrompt = transcript.map((item) =>
    item.kind === "message" && item.role === "user" ? { ...item, text: "Updated goal" } : item,
  );
  await reopened.summarize({ ...request, transcript: editedPrompt });
  expect(calls).toBe(3);
});

test("off makes no requests; errors are visible and not retried in a render loop", async () => {
  const { owner } = await setup();
  let calls = 0;
  const generate = () => {
    calls++;
    throw new Error("provider unavailable");
  };
  const request = {
    target,
    promptId: "user",
    transcript,
    running: false,
    chatModel: model,
    generate,
  };
  await owner.update({ enabled: false });
  expect((await owner.summarize(request)).error).toContain("off");
  expect(calls).toBe(0);
  await owner.update({ enabled: true });
  expect((await owner.summarize(request)).error).toContain("provider unavailable");
  await owner.summarize(request);
  expect(calls).toBe(1);
});

test("settings changes cancel stale work even if provider ignores its signal", async () => {
  const { owner } = await setup();
  let started!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  const promise = owner.summarize({
    target,
    promptId: "user",
    transcript,
    running: false,
    chatModel: model,
    generate: () => {
      started();
      return new Promise(() => {});
    },
  });
  await start;
  await owner.update({ enabled: false });
  expect((await promise).error).toContain("cancelled");
});

test("summary deadline terminates silent providers; retry is explicit and usage is retained", async () => {
  const { file } = await setup();
  const owner = new WorkSummaryOwner(file, 15);
  const request = { target, promptId: "user", transcript, running: false, chatModel: model };
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const failure = await owner.summarize({ ...request, generate: () => new Promise(() => {}) });
    expect(failure.error).toContain("timed out");
    const success = await owner.summarize({
      ...request,
      retry: true,
      generate: async () => ({
        text: "Read source; edit remains blocked.",
        model,
        usage: { totalTokens: 42, cost: { total: 0.001 } },
      }),
    });
    expect(success.usage).toEqual({ totalTokens: 42, cost: 0.001 });
    const cached = await new WorkSummaryOwner(file).summarize({
      ...request,
      generate: () => {
        throw new Error("Cache miss");
      },
    });
    expect(cached.usage).toEqual(success.usage);
  } finally {
    clearTimeout(keepAlive);
  }
});

test("invalid persisted configuration is rejected without replacing saved bytes", async () => {
  const { file } = await setup();
  const invalid = '{"version":999,"enabled":false,"models":{},"cache":{}}';
  await writeFile(file, invalid);
  const owner = new WorkSummaryOwner(file);
  await expect(owner.preferences()).rejects.toThrow("version");
  expect(await readFile(file, "utf8")).toBe(invalid);
  expect(() =>
    decodeSavedSummaries({
      version: 1,
      enabled: true,
      models: { a: { provider: "x" } },
      cache: {},
    }),
  ).toThrow();
});
