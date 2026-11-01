import { expect, test } from "@playwright/test";
import type { SessionRef } from "@pi-gui/session-driver/types";
import {
  pendingComposerDraft_aggregateCaptureHandlers,
  pendingComposerDraft_aggregateFlushHandlers,
  pendingComposerDraft_decodeCaptureRequest,
  pendingComposerDraft_decodeCaptureResponse,
  pendingComposerDraft_decodeFlushRequest,
  pendingComposerDraft_decodeFlushResponse,
  type PendingComposerDraftCaptureHandler,
  type PendingComposerDraftFlushHandler,
} from "../../contracts/ipc";
import type {
  DraftFlushExpectation,
  DraftFlushOutcome,
  LifecycleRequestKey,
} from "../../contracts/lifecycle";
import {
  ComposerDraftResultCoordinator,
  type ComposerDraftResultRuntime,
  type ComposerDraftResultSnapshot,
} from "../../src/features/conversation/hooks/use-composer-draft-sync";

const requestKey = {
  intent: "app-quit",
  target: { kind: "application" },
  effectScope: { kind: "application", revision: 9 },
} as const satisfies LifecycleRequestKey;

const target = {
  workspaceId: "workspace-1",
  sessionId: "session-1",
} as const satisfies SessionRef;

const captureRequest = {
  requestId: 1,
  operationId: "operation-1",
  requestKey,
  windowId: "window-1",
} as const;

const expectation = {
  operationId: captureRequest.operationId,
  requestKey,
  windowId: captureRequest.windowId,
  editGeneration: 5,
} as const satisfies DraftFlushExpectation;

const flushRequest = {
  requestId: 2,
  expectation,
} as const;

const savedOutcome = {
  ...expectation,
  status: "saved",
} as const satisfies DraftFlushOutcome;

function snapshot(
  overrides: Partial<ComposerDraftResultSnapshot> = {},
): ComposerDraftResultSnapshot {
  return {
    draft: "hello",
    generation: 5,
    sessionKey: "workspace-1:session-1",
    target,
    hydratedSessionKey: "workspace-1:session-1",
    persistedDraft: "",
    hasPendingWrite: true,
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

test("strictly decodes the complete capture and flush exchange", () => {
  expect(pendingComposerDraft_decodeCaptureRequest(structuredClone(captureRequest))).toEqual(
    captureRequest,
  );
  expect(
    pendingComposerDraft_decodeCaptureResponse(
      {
        requestId: 1,
        status: "captured",
        expectation,
      },
      captureRequest,
    ),
  ).toEqual({ requestId: 1, status: "captured", expectation });
  expect(pendingComposerDraft_decodeFlushRequest(structuredClone(flushRequest))).toEqual(
    flushRequest,
  );
  expect(
    pendingComposerDraft_decodeFlushResponse(
      {
        requestId: 2,
        outcome: savedOutcome,
      },
      expectation,
    ),
  ).toEqual({ requestId: 2, outcome: savedOutcome });
});

test("rejects getters, symbols, sparse arrays, foreign objects, and oversized identities recursively", () => {
  const getterPayload = structuredClone(captureRequest) as Record<string, unknown>;
  Object.defineProperty(getterPayload, "operationId", {
    enumerable: true,
    get: () => "operation-1",
  });
  expect(() => pendingComposerDraft_decodeCaptureRequest(getterPayload)).toThrow("data property");

  const nestedGetter = structuredClone(captureRequest) as {
    requestKey: Record<string, unknown>;
  };
  Object.defineProperty(nestedGetter.requestKey, "intent", {
    enumerable: true,
    get: () => "app-quit",
  });
  expect(() => pendingComposerDraft_decodeCaptureRequest(nestedGetter)).toThrow("data property");

  const symbolPayload = structuredClone(captureRequest) as Record<PropertyKey, unknown>;
  symbolPayload[Symbol("hidden")] = "not-json";
  expect(() => pendingComposerDraft_decodeCaptureRequest(symbolPayload)).toThrow("symbol");

  const sparsePayload = {
    ...captureRequest,
    extra: new Array(2),
  };
  expect(() => pendingComposerDraft_decodeCaptureRequest(sparsePayload)).toThrow("dense array");

  const accessorArray = {
    ...captureRequest,
    extra: [] as unknown[],
  };
  Object.defineProperty(accessorArray.extra, "0", {
    enumerable: true,
    get: () => "value",
  });
  accessorArray.extra.length = 1;
  expect(() => pendingComposerDraft_decodeCaptureRequest(accessorArray)).toThrow("accessor");

  const datePayload = {
    ...captureRequest,
    requestKey: { ...requestKey, target: new Date() },
  };
  expect(() => pendingComposerDraft_decodeCaptureRequest(datePayload)).toThrow("plain JSON");

  expect(() =>
    pendingComposerDraft_decodeCaptureRequest({
      ...captureRequest,
      operationId: `operation-${"x".repeat(250)}`,
    }),
  ).toThrow("bounded identifier");
});

test("preload aggregation accepts exactly one exact capture handler", async () => {
  const handlers = new Set<PendingComposerDraftCaptureHandler>([async () => expectation]);
  await expect(
    pendingComposerDraft_aggregateCaptureHandlers(captureRequest, handlers),
  ).resolves.toEqual({
    requestId: 1,
    status: "captured",
    expectation,
  });

  await expect(
    pendingComposerDraft_aggregateCaptureHandlers(captureRequest, new Set()),
  ).resolves.toEqual({ requestId: 1, status: "rejected" });
  await expect(
    pendingComposerDraft_aggregateCaptureHandlers(
      captureRequest,
      new Set([async () => expectation, async () => expectation]),
    ),
  ).resolves.toEqual({ requestId: 1, status: "rejected" });
  await expect(
    pendingComposerDraft_aggregateCaptureHandlers(
      captureRequest,
      new Set([async () => ({ ...expectation, windowId: "window-2" })]),
    ),
  ).resolves.toEqual({ requestId: 1, status: "rejected" });
});

test("preload aggregation preserves explicit rejection instead of erasing handler failures", async () => {
  await expect(
    pendingComposerDraft_aggregateFlushHandlers(
      flushRequest,
      new Set<PendingComposerDraftFlushHandler>([
        async () => {
          throw new Error("renderer save failed");
        },
      ]),
    ),
  ).resolves.toEqual({
    requestId: 2,
    outcome: { ...expectation, status: "rejected" },
  });
  await expect(
    pendingComposerDraft_aggregateFlushHandlers(
      flushRequest,
      new Set<PendingComposerDraftFlushHandler>([
        async () => ({ ...savedOutcome, editGeneration: 6 }),
      ]),
    ),
  ).resolves.toEqual({
    requestId: 2,
    outcome: { ...expectation, status: "rejected" },
  });
  await expect(
    pendingComposerDraft_aggregateFlushHandlers(
      flushRequest,
      new Set<PendingComposerDraftFlushHandler>([
        async () => savedOutcome,
        async () => ({ ...expectation, status: "no-pending" }),
      ]),
    ),
  ).resolves.toEqual({
    requestId: 2,
    outcome: { ...expectation, status: "rejected" },
  });
});

test("renderer coordinator capture records identity without writing and pauses debounce", () => {
  const coordinator = new ComposerDraftResultCoordinator();
  let pauseCount = 0;
  expect(
    coordinator.capture(captureRequest, snapshot(), () => {
      pauseCount += 1;
    }),
  ).toEqual(expectation);
  expect(pauseCount).toBe(1);
  expect(() => coordinator.capture(captureRequest, snapshot(), () => {})).toThrow("already owned");
});

test("renderer coordinator returns saved only when the exact captured edit remains current", async () => {
  const coordinator = new ComposerDraftResultCoordinator();
  coordinator.capture(captureRequest, snapshot(), () => {});
  let state = snapshot();
  let savedCount = 0;
  let markedGeneration = -1;
  const runtime: ComposerDraftResultRuntime = {
    snapshot: () => state,
    pauseDebounce: () => {},
    waitForEarlierWrites: async () => {},
    save: async (savedTarget, draft, generation, sessionKey) => {
      savedCount += 1;
      expect(savedTarget).toEqual(target);
      expect({ draft, generation, sessionKey }).toEqual({
        draft: "hello",
        generation: 5,
        sessionKey: "workspace-1:session-1",
      });
      state = snapshot({ persistedDraft: "hello", hasPendingWrite: false });
    },
    markSaved: (generation) => {
      markedGeneration = generation;
    },
  };

  await expect(coordinator.flush(flushRequest, runtime)).resolves.toEqual(savedOutcome);
  expect(savedCount).toBe(1);
  expect(markedGeneration).toBe(5);
});

test("renderer coordinator reports no-pending only when the exact captured edit is already persisted", async () => {
  const coordinator = new ComposerDraftResultCoordinator();
  coordinator.capture(captureRequest, snapshot(), () => {});
  let savedCount = 0;
  const runtime: ComposerDraftResultRuntime = {
    snapshot: () => snapshot({ persistedDraft: "hello", hasPendingWrite: false }),
    pauseDebounce: () => {},
    waitForEarlierWrites: async () => {},
    save: async () => {
      savedCount += 1;
    },
    markSaved: () => {},
  };
  await expect(coordinator.flush(flushRequest, runtime)).resolves.toEqual({
    ...expectation,
    status: "no-pending",
  });
  expect(savedCount).toBe(0);
});

test("renderer coordinator rejects edit-before-flush and session-change races without writing", async () => {
  for (const raced of [
    snapshot({ generation: 6, draft: "hello!" }),
    snapshot({ sessionKey: "workspace-1:session-2" }),
    snapshot({ hydratedSessionKey: "workspace-1:session-2" }),
  ]) {
    const coordinator = new ComposerDraftResultCoordinator();
    coordinator.capture(captureRequest, snapshot(), () => {});
    let savedCount = 0;
    const runtime: ComposerDraftResultRuntime = {
      snapshot: () => raced,
      pauseDebounce: () => {},
      waitForEarlierWrites: async () => {},
      save: async () => {
        savedCount += 1;
      },
      markSaved: () => {},
    };
    await expect(coordinator.flush(flushRequest, runtime)).resolves.toEqual({
      ...expectation,
      status: "rejected",
    });
    expect(savedCount).toBe(0);
  }
});

test("renderer coordinator rejects an edit that lands while the captured write is in flight", async () => {
  const coordinator = new ComposerDraftResultCoordinator();
  coordinator.capture(captureRequest, snapshot(), () => {});
  let state = snapshot();
  const write = deferred();
  const runtime: ComposerDraftResultRuntime = {
    snapshot: () => state,
    pauseDebounce: () => {},
    waitForEarlierWrites: async () => {},
    save: async () => write.promise,
    markSaved: () => {},
  };
  const run = coordinator.flush(flushRequest, runtime);
  await expect.poll(() => state.generation).toBe(5);
  state = snapshot({ generation: 6, draft: "hello later" });
  write.resolve();
  await expect(run).resolves.toEqual({
    ...expectation,
    status: "rejected",
  });
});

test("renderer coordinator rejects save failures and unmount races, then removes ownership", async () => {
  const failedCoordinator = new ComposerDraftResultCoordinator();
  failedCoordinator.capture(captureRequest, snapshot(), () => {});
  await expect(
    failedCoordinator.flush(flushRequest, {
      snapshot: () => snapshot(),
      pauseDebounce: () => {},
      waitForEarlierWrites: async () => {},
      save: async () => {
        throw new Error("provider error stays local");
      },
      markSaved: () => {},
    }),
  ).resolves.toEqual({ ...expectation, status: "rejected" });
  await expect(
    failedCoordinator.flush(flushRequest, {
      snapshot: () => snapshot(),
      pauseDebounce: () => {},
      waitForEarlierWrites: async () => {},
      save: async () => {},
      markSaved: () => {},
    }),
  ).resolves.toEqual({ ...expectation, status: "rejected" });

  const disposedCoordinator = new ComposerDraftResultCoordinator();
  disposedCoordinator.capture(captureRequest, snapshot(), () => {});
  const write = deferred();
  const run = disposedCoordinator.flush(flushRequest, {
    snapshot: () => snapshot(),
    pauseDebounce: () => {},
    waitForEarlierWrites: async () => {},
    save: async () => write.promise,
    markSaved: () => {},
  });
  disposedCoordinator.dispose();
  write.resolve();
  await expect(run).resolves.toEqual({ ...expectation, status: "rejected" });
});

test("renderer coordinator rejects duplicate, unknown, and late flushes", async () => {
  const coordinator = new ComposerDraftResultCoordinator();
  coordinator.capture(captureRequest, snapshot(), () => {});
  const write = deferred();
  const runtime: ComposerDraftResultRuntime = {
    snapshot: () => snapshot(),
    pauseDebounce: () => {},
    waitForEarlierWrites: async () => {},
    save: async () => write.promise,
    markSaved: () => {},
  };
  const first = coordinator.flush(flushRequest, runtime);
  await expect(coordinator.flush(flushRequest, runtime)).resolves.toEqual({
    ...expectation,
    status: "rejected",
  });
  write.resolve();
  await expect(first).resolves.toEqual(savedOutcome);
  await expect(coordinator.flush(flushRequest, runtime)).resolves.toEqual({
    ...expectation,
    status: "rejected",
  });
  await expect(
    coordinator.flush(
      {
        requestId: 3,
        expectation: { ...expectation, operationId: "operation-unknown" },
      },
      runtime,
    ),
  ).resolves.toEqual({
    ...expectation,
    operationId: "operation-unknown",
    status: "rejected",
  });
});

test("successive generations and a remounted coordinator remain flushable after stale rejection", async () => {
  const coordinator = new ComposerDraftResultCoordinator();
  coordinator.capture(captureRequest, snapshot(), () => {});
  let state = snapshot({ generation: 6, draft: "hello later" });
  await expect(
    coordinator.flush(flushRequest, {
      snapshot: () => state,
      pauseDebounce: () => {},
      waitForEarlierWrites: async () => {},
      save: async () => {},
      markSaved: () => {},
    }),
  ).resolves.toEqual({ ...expectation, status: "rejected" });

  const newerExpectation = {
    ...expectation,
    editGeneration: 6,
  } as const satisfies DraftFlushExpectation;
  coordinator.capture({ ...captureRequest, requestId: 8 }, state, () => {});
  await expect(
    coordinator.flush(
      { requestId: 9, expectation: newerExpectation },
      {
        snapshot: () => state,
        pauseDebounce: () => {},
        waitForEarlierWrites: async () => {},
        save: async () => {
          state = snapshot({
            generation: 6,
            draft: "hello later",
            persistedDraft: "hello later",
            hasPendingWrite: false,
          });
        },
        markSaved: () => {},
      },
    ),
  ).resolves.toEqual({ ...newerExpectation, status: "saved" });

  coordinator.dispose();
  const remounted = new ComposerDraftResultCoordinator();
  const remountedExpectation = {
    ...expectation,
    editGeneration: 7,
  } as const satisfies DraftFlushExpectation;
  remounted.capture(
    { ...captureRequest, requestId: 10 },
    snapshot({ generation: 7, draft: "hello after remount" }),
    () => {},
  );
  await expect(
    remounted.flush(
      { requestId: 11, expectation: remountedExpectation },
      {
        snapshot: () =>
          snapshot({
            generation: 7,
            draft: "hello after remount",
            persistedDraft: "hello after remount",
            hasPendingWrite: false,
          }),
        pauseDebounce: () => {},
        waitForEarlierWrites: async () => {},
        save: async () => {},
        markSaved: () => {},
      },
    ),
  ).resolves.toEqual({ ...remountedExpectation, status: "no-pending" });
});

test("concurrent flushes for different sessions remain isolated", async () => {
  const coordinator = new ComposerDraftResultCoordinator();
  const secondTarget = {
    workspaceId: "workspace-1",
    sessionId: "session-2",
  } as const satisfies SessionRef;
  const secondExpectation = {
    ...expectation,
    windowId: "window-2",
  } as const satisfies DraftFlushExpectation;
  coordinator.capture(captureRequest, snapshot(), () => {});
  coordinator.capture(
    { ...captureRequest, requestId: 4, windowId: "window-2" },
    snapshot({
      sessionKey: "workspace-1:session-2",
      hydratedSessionKey: "workspace-1:session-2",
      target: secondTarget,
    }),
    () => {},
  );
  const saves: string[] = [];
  const runtime = (state: ComposerDraftResultSnapshot): ComposerDraftResultRuntime => ({
    snapshot: () => state,
    pauseDebounce: () => {},
    waitForEarlierWrites: async () => {},
    save: async (savedTarget) => {
      saves.push(`${savedTarget.workspaceId}:${savedTarget.sessionId}`);
    },
    markSaved: () => {},
  });

  await expect(
    Promise.all([
      coordinator.flush(flushRequest, runtime(snapshot())),
      coordinator.flush(
        { requestId: 5, expectation: secondExpectation },
        runtime(
          snapshot({
            sessionKey: "workspace-1:session-2",
            hydratedSessionKey: "workspace-1:session-2",
            target: secondTarget,
          }),
        ),
      ),
    ]),
  ).resolves.toEqual([savedOutcome, { ...secondExpectation, status: "saved" }]);
  expect(saves).toEqual(["workspace-1:session-1", "workspace-1:session-2"]);
});
