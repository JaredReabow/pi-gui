import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  WorkSummaryOwner,
  decodeSavedSummaries,
} from "../../electron/conversation/work-summary-owner";
import type { TimelineTranscriptItem } from "../../contracts/timeline-types";

const model = { provider: "test", modelId: "summary" };
const target = { workspaceId: "workspace", sessionId: "thread" };
const transcript: TimelineTranscriptItem[] = [
  {
    kind: "message",
    id: "prompt",
    role: "user",
    text: "Inspect",
    createdAt: "2026-11-08T12:00:00Z",
  },
  {
    kind: "tool",
    id: "tool",
    callId: "tool",
    toolName: "read",
    label: "Read",
    status: "success",
    createdAt: "2026-11-08T12:00:01Z",
  },
];
const base = { target, promptId: "prompt", transcript, running: false, chatModel: model };
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}
async function setup(delays: readonly [number, number, number] = [5, 10, 15]) {
  const dir = await mkdtemp(join(tmpdir(), "pi-summary-retries-"));
  const file = join(dir, "summaries.json");
  const owner = new WorkSummaryOwner(file, 1000, delays);
  await owner.preferences();
  return { owner, file };
}

test("three delayed retries recover on fourth attempt and deduplicate into a durable result", async () => {
  const { owner, file } = await setup();
  const times: number[] = [];
  const request = {
    ...base,
    generate: async () => {
      times.push(performance.now());
      if (times.length < 4) throw new Error("transient provider failure");
      return { text: "Recovered on fourth", model };
    },
  };
  const [a, b] = await Promise.all([owner.summarize(request), owner.summarize(request)]);
  expect(a.text).toBe("Recovered on fourth");
  expect(b).toEqual(a);
  expect(times).toHaveLength(4);
  for (const [i, delay] of [5, 10, 15].entries())
    expect(times[i + 1]! - times[i]!).toBeGreaterThanOrEqual(delay - 1);
  expect((await new WorkSummaryOwner(file).summarize(request)).text).toBe(a.text);
  expect(times).toHaveLength(4);
});

test("exhaustion is cached; manual Retry starts one fresh bounded cycle", async () => {
  const { owner } = await setup();
  let calls = 0;
  const request = {
    ...base,
    generate: async () => {
      calls++;
      throw new Error("unavailable");
    },
  };
  expect((await owner.summarize(request)).error).toContain("unavailable");
  await owner.summarize(request);
  expect(calls).toBe(4);
  await owner.summarize({ ...request, retry: true });
  expect(calls).toBe(8);
});

test("disable and close cancel delayed retries without waiting or saving failures", async () => {
  for (const close of [false, true]) {
    const { owner, file } = await setup([60_000, 60_000, 60_000]);
    const first = gate();
    let calls = 0;
    const pending = owner.summarize({
      ...base,
      generate: async () => {
        calls++;
        first.release();
        throw new Error("transient");
      },
    });
    await first.promise;
    await nextTurn();
    if (close) await owner.close();
    else await owner.update({ enabled: false });
    expect((await pending).error).toContain("cancelled");
    expect(calls).toBe(1);
    if (!close)
      expect(
        Object.keys(decodeSavedSummaries(JSON.parse(await readFile(file, "utf8"))).cache),
      ).toHaveLength(0);
    else
      expect(
        (
          await owner.summarize({
            ...base,
            generate: async () => ({ text: "should not run", model }),
          })
        ).error,
      ).toContain("closed");
  }
});

test("fair queued summaries never exceed two active requests and cancellation drains admission", async () => {
  const { owner } = await setup();
  const entered = [gate(), gate(), gate(), gate()];
  const exits = [gate(), gate(), gate(), gate()];
  let active = 0,
    peak = 0,
    calls = 0;
  const requests = entered.map((start, i) =>
    owner.summarize({
      ...base,
      target: { ...target, sessionId: String(i) },
      generate: async () => {
        calls++;
        active++;
        peak = Math.max(active, peak);
        start.release();
        await exits[i]!.promise;
        active--;
        return { text: "summary", model };
      },
    }),
  );
  await entered[0]!.promise;
  await entered[1]!.promise;
  expect(calls).toBe(2);
  exits[0]!.release();
  await entered[2]!.promise;
  exits[1]!.release();
  await entered[3]!.promise;
  exits[2]!.release();
  exits[3]!.release();
  expect((await Promise.all(requests)).every((result) => result.text === "summary")).toBe(true);
  expect(peak).toBe(2);
  const blocked = [gate(), gate()];
  let invoked = 0;
  const abandoned = [0, 1, 2].map((i) =>
    owner.summarize({
      ...base,
      retry: true,
      target: { ...target, sessionId: "blocked" + i },
      generate: async () => {
        invoked++;
        blocked[invoked - 1]?.release();
        return new Promise<never>(() => {});
      },
    }),
  );
  await blocked[0]!.promise;
  await blocked[1]!.promise;
  await owner.close();
  expect(
    (await Promise.all(abandoned)).every((result) => result.error?.includes("cancelled")),
  ).toBe(true);
  expect(invoked).toBe(2);
});

test("chat changes cancel Same-as-chat work but not an explicit summary-model override", async () => {
  const { owner } = await setup();
  const entered = gate();
  const pending = owner.summarize({
    ...base,
    generate: async () => {
      entered.release();
      return new Promise<never>(() => {});
    },
  });
  await entered.promise;
  owner.chatModelChanged(target);
  expect((await pending).error).toContain("cancelled");
  await owner.update({ target, model });
  const ready = gate();
  const finish = gate();
  const explicit = owner.summarize({
    ...base,
    generate: async () => {
      ready.release();
      await finish.promise;
      return { text: "explicit model retained", model };
    },
  });
  await ready.promise;
  owner.chatModelChanged(target);
  finish.release();
  expect((await explicit).text).toBe("explicit model retained");
});

test("a durable cache-write error cannot trigger extra paid generation or become a fake memory success", async () => {
  const { owner, file } = await setup();
  await mkdir(file);
  let calls = 0;
  const request = {
    ...base,
    generate: async () => {
      calls++;
      return { text: "generated once", model };
    },
  };
  expect((await owner.summarize(request)).error).toBeTruthy();
  expect((await owner.summarize(request)).text).toBeUndefined();
  expect(calls).toBe(1);
});
