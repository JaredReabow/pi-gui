import { expect, test } from "@playwright/test";
import type { OrchestrationChildThread, TranscriptMessage } from "../../contracts/desktop-state";
import { createOrchestrationOwner } from "../../electron/orchestration/app-store-orchestration";

const timestamp = "2026-10-31T00:00:00.000Z";
const parentRef = { workspaceId: "ws", sessionId: "parent" };

/** Model the immutable child replacement that occurs while a cold session opens. */
function fixture(
  options: {
    reply?: boolean;
    removeOnHydrate?: boolean;
    replaceOnHydrate?: boolean;
    stopped?: boolean;
  } = {},
) {
  let children: readonly OrchestrationChildThread[] = [
    {
      id: "child-link",
      parentWorkspaceId: "ws",
      parentSessionId: "parent",
      childWorkspaceId: "ws",
      childSessionId: "child",
      title: "Cold child",
      goal: "Work",
      status: "queued",
      latestTranscript: "",
      transcript: [],
      evidence: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  let transcript: readonly TranscriptMessage[] = [];
  let opens = 0;
  const host = {
    orchestrationState: () => ({ workspaces: [], orchestrationChildren: children }),
    sessionFromState: () => ({ title: "Hydrated child", status: "idle", updatedAt: timestamp }),
    ensureSessionReady: async () => {
      opens++;
      if (options.reply)
        transcript = [
          {
            kind: "message",
            id: "reply",
            role: "assistant",
            text: "Cold completion",
            createdAt: timestamp,
          },
        ];
      if (options.removeOnHydrate) children = [];
      else if (options.replaceOnHydrate)
        children = children.map((child) => ({
          ...child,
          title: "Current child",
          status: "complete",
        }));
      return undefined;
    },
    transcriptFor: () => transcript,
    lastRunOutcome: () => (options.stopped ? "stopped" : undefined),
    getQueuedComposerMessages: () => [],
  };
  return {
    owner: createOrchestrationOwner(
      host as unknown as Parameters<typeof createOrchestrationOwner>[0],
    ),
    opens: () => opens,
  };
}

test("first cold read derives complete from the hydrated transcript even if child projection remains queued", async () => {
  const f = fixture({ reply: true });
  const result = await f.owner.readThreadToolResult(parentRef, "child-link");
  expect(result.details).toMatchObject({
    status: "complete",
    messages: [{ text: "Cold completion" }],
  });
  expect(f.opens()).toBe(1);
});

test("cold read re-resolves the child replaced during hydration", async () => {
  const f = fixture({ reply: true, replaceOnHydrate: true });
  expect((await f.owner.readThreadToolResult(parentRef, "child-link")).details?.status).toBe(
    "complete",
  );
});

test("a never-started idle child remains queued", async () => {
  const f = fixture();
  expect((await f.owner.readThreadToolResult(parentRef, "child-link")).details).toMatchObject({
    status: "queued",
    messages: [],
  });
});

test("missing target retains its established error without hydrating", async () => {
  const f = fixture();
  const result = await f.owner.readThreadToolResult(parentRef, "missing");
  expect(result.details?.error).toBe("Unknown thread: " + (f.opens() ? "child-link" : "missing"));
  expect(f.opens()).toBe(0);
});

test("a target removed during hydration is rechecked before transcript disclosure", async () => {
  const f = fixture({ reply: true, removeOnHydrate: true });
  const result = await f.owner.readThreadToolResult(parentRef, "child-link");
  expect(result.details?.error).toBe("Unknown thread: " + (f.opens() ? "child-link" : "missing"));
  expect(result.details?.messages).toBeUndefined();
});

test("identified stopped run without assistant entry reads cancelled", async () => {
  const f = fixture({ stopped: true });
  expect((await f.owner.readThreadToolResult(parentRef, "child-link")).details).toMatchObject({
    status: "cancelled",
    messages: [],
  });
});

test("parent fan-out requests each child independently when one abort fails", async () => {
  const calls: string[] = [];
  const children = ["a", "b", "c"].map((id) => ({
    id,
    parentWorkspaceId: "ws",
    parentSessionId: "parent",
    childWorkspaceId: "ws",
    childSessionId: id,
  }));
  const host = {
    orchestrationState: () => ({ orchestrationChildren: children }),
    driver: {
      cancelCurrentRun: async (ref: { sessionId: string }) => {
        calls.push(ref.sessionId);
        if (ref.sessionId === "b") throw new Error("abort failed");
      },
    },
  };
  const owner = createOrchestrationOwner(
    host as unknown as Parameters<typeof createOrchestrationOwner>[0],
  );
  await owner.cancelChildRunsForParent(parentRef);
  expect(calls.sort()).toEqual(["a", "b", "c"]);
  expect(children.every((child) => !("status" in child))).toBe(true);
});
