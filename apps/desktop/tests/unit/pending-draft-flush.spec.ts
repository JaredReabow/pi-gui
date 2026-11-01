import { EventEmitter } from "node:events";
import { expect, test } from "@playwright/test";
import type { BrowserWindow, WebContents } from "electron";
import {
  desktopIpc,
  type PendingComposerDraftCaptureRequest,
  type PendingComposerDraftFlushRequest,
} from "../../contracts/ipc";
import type {
  DraftFlushExpectation,
  DraftFlushOutcome,
  LifecycleDraftStatus,
  LifecycleRequestKey,
} from "../../contracts/lifecycle";
import { PendingComposerDraftFlusher } from "../../electron/windows/pending-draft-flush";

interface SentMessage {
  readonly channel: string;
  readonly payload: unknown;
}

class FakeContents extends EventEmitter {
  readonly sent: SentMessage[] = [];
  private destroyed = false;
  private crashed = false;
  sendFailure: Error | null = null;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isCrashed(): boolean {
    return this.crashed;
  }

  send(channel: string, payload: unknown): void {
    if (this.sendFailure) throw this.sendFailure;
    this.sent.push({ channel, payload });
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("destroyed");
  }

  crash(): void {
    this.crashed = true;
    this.emit("render-process-gone");
  }

  asElectron(): WebContents {
    return this as unknown as WebContents;
  }
}

class FakeWindow {
  readonly webContents = new FakeContents();
  private destroyed = false;

  constructor(readonly id: number) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.webContents.destroy();
  }

  asElectron(): BrowserWindow {
    return this as unknown as BrowserWindow;
  }
}

const applicationRequestKey = {
  intent: "app-quit",
  target: { kind: "application" },
  effectScope: { kind: "application", revision: 12 },
} as const satisfies LifecycleRequestKey;

const relaunchRequestKey = {
  intent: "app-relaunch",
  target: { kind: "application" },
  effectScope: { kind: "application", revision: 12 },
} as const satisfies LifecycleRequestKey;

const windowRequestKey = {
  intent: "window-close",
  target: { kind: "window", windowId: "42" },
  effectScope: { kind: "window", windowId: "42", revision: 4 },
} as const satisfies LifecycleRequestKey;

async function sentAt(contents: FakeContents, index: number): Promise<SentMessage> {
  await expect.poll(() => contents.sent.length).toBeGreaterThan(index);
  const message = contents.sent[index];
  if (!message) throw new Error(`missing message ${index}`);
  return message;
}

function expectation(
  request: PendingComposerDraftCaptureRequest,
  editGeneration = 7,
): DraftFlushExpectation {
  return {
    operationId: request.operationId,
    requestKey: request.requestKey,
    windowId: request.windowId,
    editGeneration,
  };
}

function outcome(expected: DraftFlushExpectation, status: LifecycleDraftStatus): DraftFlushOutcome {
  return { ...expected, status };
}

function pendingOwnership(flusher: PendingComposerDraftFlusher): {
  readonly captures: number;
  readonly results: number;
} {
  const inspectable = flusher as unknown as {
    readonly waitingCaptures: ReadonlyMap<number, unknown>;
    readonly waitingResults: ReadonlyMap<number, unknown>;
  };
  return {
    captures: inspectable.waitingCaptures.size,
    results: inspectable.waitingResults.size,
  };
}

async function captureReply(
  flusher: PendingComposerDraftFlusher,
  contents: FakeContents,
  request: PendingComposerDraftCaptureRequest,
  editGeneration = 7,
): Promise<DraftFlushExpectation> {
  const expected = expectation(request, editGeneration);
  expect(
    flusher.acknowledgeCaptureResult(contents.asElectron(), {
      requestId: request.requestId,
      status: "captured",
      expectation: expected,
    }),
  ).toBe(true);
  return expected;
}

test("binds capture and flush to the exact operation, request, window, frame, and generation", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const target = new FakeWindow(42);
  const run = flusher.captureAndFlush([target.asElectron()], "operation-17", windowRequestKey);

  const captureMessage = await sentAt(target.webContents, 0);
  expect(captureMessage.channel).toBe(desktopIpc.capturePendingComposerDraft);
  const captureRequest = captureMessage.payload as PendingComposerDraftCaptureRequest;
  expect(captureRequest).toMatchObject({
    operationId: "operation-17",
    requestKey: windowRequestKey,
    windowId: "42",
  });

  const expected = await captureReply(flusher, target.webContents, captureRequest, 19);
  const flushMessage = await sentAt(target.webContents, 1);
  expect(flushMessage.channel).toBe(desktopIpc.flushPendingComposerDraftResult);
  const flushRequest = flushMessage.payload as PendingComposerDraftFlushRequest;
  expect(flushRequest.expectation).toEqual(expected);

  expect(
    flusher.acknowledgeFlushResult(target.webContents.asElectron(), {
      requestId: flushRequest.requestId,
      outcome: outcome(expected, "saved"),
    }),
  ).toBe(true);
  await expect(run).resolves.toEqual([outcome(expected, "saved")]);
});

test("rejects mismatched window-close target and effect scope before renderer IPC", async () => {
  for (const requestKey of [
    {
      intent: "window-close",
      target: { kind: "window", windowId: "99" },
      effectScope: { kind: "window", windowId: "99", revision: 4 },
    },
    {
      intent: "window-close",
      target: { kind: "window", windowId: "99" },
      effectScope: { kind: "window", windowId: "42", revision: 4 },
    },
    {
      intent: "window-close",
      target: { kind: "window" },
      effectScope: { kind: "window", windowId: "42", revision: 4 },
    },
    {
      intent: "window-close",
      target: { kind: "window", windowId: "42" },
      effectScope: { kind: "window", revision: 4 },
    },
  ]) {
    const flusher = new PendingComposerDraftFlusher(10_000);
    const target = new FakeWindow(42);
    await expect(
      flusher.captureAndFlush([target.asElectron()], "operation-wrong-window", requestKey),
    ).rejects.toThrow();
    expect(target.webContents.sent).toEqual([]);
    expect(pendingOwnership(flusher)).toEqual({ captures: 0, results: 0 });
  }
});

test("requires exactly one owning window for window-close and keeps quit independent", async () => {
  const closeFlusher = new PendingComposerDraftFlusher(10_000);
  const first = new FakeWindow(42);
  const second = new FakeWindow(43);
  await expect(
    closeFlusher.captureAndFlush(
      [first.asElectron(), second.asElectron()],
      "operation-multi-close",
      windowRequestKey,
    ),
  ).rejects.toThrow("exactly one");
  expect(first.webContents.sent).toEqual([]);
  expect(second.webContents.sent).toEqual([]);
  expect(pendingOwnership(closeFlusher)).toEqual({ captures: 0, results: 0 });

  const quitFlusher = new PendingComposerDraftFlusher(10_000);
  const quitRun = quitFlusher.captureAndFlush(
    [first.asElectron(), second.asElectron()],
    "operation-quit",
    applicationRequestKey,
  );
  const firstCapture = (await sentAt(first.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  const secondCapture = (await sentAt(second.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  const firstExpected = await captureReply(quitFlusher, first.webContents, firstCapture, 20);
  const secondExpected = await captureReply(quitFlusher, second.webContents, secondCapture, 21);
  const firstFlush = (await sentAt(first.webContents, 1))
    .payload as PendingComposerDraftFlushRequest;
  const secondFlush = (await sentAt(second.webContents, 1))
    .payload as PendingComposerDraftFlushRequest;
  expect(
    quitFlusher.acknowledgeFlushResult(first.webContents.asElectron(), {
      requestId: firstFlush.requestId,
      outcome: outcome(firstExpected, "saved"),
    }),
  ).toBe(true);
  expect(
    quitFlusher.acknowledgeFlushResult(second.webContents.asElectron(), {
      requestId: secondFlush.requestId,
      outcome: outcome(secondExpected, "no-pending"),
    }),
  ).toBe(true);
  await expect(quitRun).resolves.toEqual([
    outcome(firstExpected, "saved"),
    outcome(secondExpected, "no-pending"),
  ]);
  expect(pendingOwnership(quitFlusher)).toEqual({ captures: 0, results: 0 });
});

test("settles a window-close only from the same owning sender and rejects duplicate or late replies", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const target = new FakeWindow(42);
  const wrongSender = new FakeContents();
  const run = flusher.captureAndFlush(
    [target.asElectron()],
    "operation-close-sender",
    windowRequestKey,
  );
  const captureMessage = await sentAt(target.webContents, 0);
  expect(captureMessage.channel).toBe(desktopIpc.capturePendingComposerDraft);
  expect(Object.keys(captureMessage.payload as object).sort()).toEqual([
    "operationId",
    "requestId",
    "requestKey",
    "windowId",
  ]);
  const capture = captureMessage.payload as PendingComposerDraftCaptureRequest;
  const expected = expectation(capture, 22);
  expect(
    flusher.acknowledgeCaptureResult(wrongSender.asElectron(), {
      requestId: capture.requestId,
      status: "captured",
      expectation: expected,
    }),
  ).toBe(false);
  expect(
    flusher.acknowledgeCaptureResult(target.webContents.asElectron(), {
      requestId: capture.requestId,
      status: "captured",
      expectation: expected,
    }),
  ).toBe(true);

  const flushMessage = await sentAt(target.webContents, 1);
  expect(flushMessage.channel).toBe(desktopIpc.flushPendingComposerDraftResult);
  const flush = flushMessage.payload as PendingComposerDraftFlushRequest;
  const response = {
    requestId: flush.requestId,
    outcome: outcome(expected, "saved"),
  };
  expect(flusher.acknowledgeFlushResult(wrongSender.asElectron(), response)).toBe(false);
  expect(flusher.acknowledgeFlushResult(target.webContents.asElectron(), response)).toBe(true);
  expect(flusher.acknowledgeFlushResult(target.webContents.asElectron(), response)).toBe(false);
  expect(
    flusher.acknowledgeFlushResult(wrongSender.asElectron(), {
      requestId: flush.requestId,
      outcome: outcome(expected, "no-pending"),
    }),
  ).toBe(false);
  await expect(run).resolves.toEqual([outcome(expected, "saved")]);
  expect(pendingOwnership(flusher)).toEqual({ captures: 0, results: 0 });
  expect(JSON.stringify(captureMessage.payload)).not.toContain("draft");
});

test("preserves every accepted terminal draft status", async () => {
  for (const status of ["saved", "no-pending", "rejected", "renderer-gone"] as const) {
    const flusher = new PendingComposerDraftFlusher(10_000);
    const target = new FakeWindow(80);
    const run = flusher.captureAndFlush(
      [target.asElectron()],
      `operation-${status}`,
      applicationRequestKey,
    );
    const capture = (await sentAt(target.webContents, 0))
      .payload as PendingComposerDraftCaptureRequest;
    const expected = await captureReply(flusher, target.webContents, capture, 3);
    const flush = (await sentAt(target.webContents, 1)).payload as PendingComposerDraftFlushRequest;
    expect(
      flusher.acknowledgeFlushResult(target.webContents.asElectron(), {
        requestId: flush.requestId,
        outcome: outcome(expected, status),
      }),
    ).toBe(true);
    await expect(run).resolves.toEqual([outcome(expected, status)]);
  }
});

test("returns timeout when capture or flush never produces an exact reply", async () => {
  const captureTimeoutFlusher = new PendingComposerDraftFlusher(5);
  const captureTarget = new FakeWindow(1);
  const captureRun = captureTimeoutFlusher.captureAndFlush(
    [captureTarget.asElectron()],
    "operation-capture-timeout",
    applicationRequestKey,
  );
  const capture = (await sentAt(captureTarget.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  await expect(captureRun).resolves.toEqual([
    {
      operationId: "operation-capture-timeout",
      requestKey: applicationRequestKey,
      windowId: "1",
      editGeneration: 0,
      status: "timeout",
    },
  ]);
  expect(captureTarget.webContents.listenerCount("destroyed")).toBe(0);
  expect(captureTarget.webContents.listenerCount("render-process-gone")).toBe(0);
  expect(
    (
      captureTimeoutFlusher as unknown as {
        waitingCaptures: ReadonlyMap<number, unknown>;
      }
    ).waitingCaptures.size,
  ).toBe(0);
  expect(
    captureTimeoutFlusher.acknowledgeCaptureResult(captureTarget.webContents.asElectron(), {
      requestId: capture.requestId,
      status: "captured",
      expectation: expectation(capture, 2),
    }),
  ).toBe(false);

  const flushTimeoutFlusher = new PendingComposerDraftFlusher(5);
  const flushTarget = new FakeWindow(2);
  const flushRun = flushTimeoutFlusher.captureAndFlush(
    [flushTarget.asElectron()],
    "operation-flush-timeout",
    applicationRequestKey,
  );
  const flushCapture = (await sentAt(flushTarget.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  const expected = await captureReply(flushTimeoutFlusher, flushTarget.webContents, flushCapture);
  await expect(flushRun).resolves.toEqual([outcome(expected, "timeout")]);
  expect(flushTarget.webContents.listenerCount("destroyed")).toBe(0);
  expect(flushTarget.webContents.listenerCount("render-process-gone")).toBe(0);
  expect(
    (
      flushTimeoutFlusher as unknown as {
        waitingResults: ReadonlyMap<number, unknown>;
      }
    ).waitingResults.size,
  ).toBe(0);
});

test("reports renderer loss during both capture and flush and removes waiting state", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const captureTarget = new FakeWindow(10);
  const captureRun = flusher.captureAndFlush(
    [captureTarget.asElectron()],
    "operation-capture-gone",
    applicationRequestKey,
  );
  await sentAt(captureTarget.webContents, 0);
  captureTarget.webContents.crash();
  await expect(captureRun).resolves.toEqual([
    {
      operationId: "operation-capture-gone",
      requestKey: applicationRequestKey,
      windowId: "10",
      editGeneration: 0,
      status: "renderer-gone",
    },
  ]);

  const flushTarget = new FakeWindow(11);
  const flushRun = flusher.captureAndFlush(
    [flushTarget.asElectron()],
    "operation-flush-gone",
    applicationRequestKey,
  );
  const capture = (await sentAt(flushTarget.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  const expected = await captureReply(flusher, flushTarget.webContents, capture);
  await sentAt(flushTarget.webContents, 1);
  flushTarget.webContents.destroy();
  await expect(flushRun).resolves.toEqual([outcome(expected, "renderer-gone")]);
});

test("rejects wrong-frame and mismatched capture replies without consuming the request", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const target = new FakeWindow(42);
  const other = new FakeContents();
  const run = flusher.captureAndFlush(
    [target.asElectron()],
    "operation-wrong-capture",
    windowRequestKey,
  );
  const capture = (await sentAt(target.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  const exact = expectation(capture, 8);

  expect(
    flusher.acknowledgeCaptureResult(other.asElectron(), {
      requestId: capture.requestId,
      status: "captured",
      expectation: exact,
    }),
  ).toBe(false);
  expect(
    flusher.acknowledgeCaptureResult(target.webContents.asElectron(), {
      requestId: capture.requestId,
      status: "captured",
      expectation: { ...exact, requestKey: relaunchRequestKey },
    }),
  ).toBe(false);
  expect(
    flusher.acknowledgeCaptureResult(target.webContents.asElectron(), {
      requestId: capture.requestId,
      status: "captured",
      expectation: { ...exact, windowId: "999" },
    }),
  ).toBe(false);
  expect(
    flusher.acknowledgeCaptureResult(target.webContents.asElectron(), {
      requestId: capture.requestId,
      status: "captured",
      expectation: exact,
    }),
  ).toBe(true);

  const flush = (await sentAt(target.webContents, 1)).payload as PendingComposerDraftFlushRequest;
  expect(
    flusher.acknowledgeFlushResult(target.webContents.asElectron(), {
      requestId: flush.requestId,
      outcome: { ...outcome(exact, "saved"), editGeneration: 9 },
    }),
  ).toBe(false);
  expect(
    flusher.acknowledgeFlushResult(target.webContents.asElectron(), {
      requestId: flush.requestId,
      outcome: outcome(exact, "no-pending"),
    }),
  ).toBe(true);
  await expect(run).resolves.toEqual([outcome(exact, "no-pending")]);
});

test("rejects malformed replies, duplicate acknowledgement, and late replies", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const target = new FakeWindow(21);
  const run = flusher.captureAndFlush(
    [target.asElectron()],
    "operation-malformed",
    applicationRequestKey,
  );
  const capture = (await sentAt(target.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  expect(
    flusher.acknowledgeCaptureResult(target.webContents.asElectron(), {
      requestId: capture.requestId,
    }),
  ).toBe(false);
  const expected = await captureReply(flusher, target.webContents, capture, 12);
  const flush = (await sentAt(target.webContents, 1)).payload as PendingComposerDraftFlushRequest;
  const response = {
    requestId: flush.requestId,
    outcome: outcome(expected, "saved"),
  };
  expect(flusher.acknowledgeFlushResult(target.webContents.asElectron(), response)).toBe(true);
  expect(flusher.acknowledgeFlushResult(target.webContents.asElectron(), response)).toBe(false);
  await expect(run).resolves.toEqual([outcome(expected, "saved")]);
});

test("turns a synchronous send failure into rejected and leaves no pending reply", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const target = new FakeWindow(30);
  target.webContents.sendFailure = new Error("IPC unavailable");
  await expect(
    flusher.captureAndFlush([target.asElectron()], "operation-send-failure", applicationRequestKey),
  ).resolves.toEqual([
    {
      operationId: "operation-send-failure",
      requestKey: applicationRequestKey,
      windowId: "30",
      editGeneration: 0,
      status: "rejected",
    },
  ]);
});

test("reports renderer-gone before sending to a destroyed window", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const target = new FakeWindow(31);
  target.destroy();
  await expect(
    flusher.captureAndFlush([target.asElectron()], "operation-destroyed", applicationRequestKey),
  ).resolves.toEqual([
    {
      operationId: "operation-destroyed",
      requestKey: applicationRequestKey,
      windowId: "31",
      editGeneration: 0,
      status: "renderer-gone",
    },
  ]);
  expect(target.webContents.sent).toEqual([]);
});

test("captures and flushes multiple windows independently", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const first = new FakeWindow(40);
  const second = new FakeWindow(41);
  const run = flusher.captureAndFlush(
    [first.asElectron(), second.asElectron()],
    "operation-multiple",
    applicationRequestKey,
  );

  const firstCapture = (await sentAt(first.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  const secondCapture = (await sentAt(second.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  const firstExpected = await captureReply(flusher, first.webContents, firstCapture, 4);
  const secondExpected = await captureReply(flusher, second.webContents, secondCapture, 8);

  const secondFlush = (await sentAt(second.webContents, 1))
    .payload as PendingComposerDraftFlushRequest;
  const firstFlush = (await sentAt(first.webContents, 1))
    .payload as PendingComposerDraftFlushRequest;
  expect(
    flusher.acknowledgeFlushResult(second.webContents.asElectron(), {
      requestId: secondFlush.requestId,
      outcome: outcome(secondExpected, "no-pending"),
    }),
  ).toBe(true);
  expect(
    flusher.acknowledgeFlushResult(first.webContents.asElectron(), {
      requestId: firstFlush.requestId,
      outcome: outcome(firstExpected, "saved"),
    }),
  ).toBe(true);

  await expect(run).resolves.toEqual([
    outcome(firstExpected, "saved"),
    outcome(secondExpected, "no-pending"),
  ]);
});

test("keeps overlapping window-close and quit attempts independent at the protocol layer", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const target = new FakeWindow(42);
  const closeRun = flusher.captureAndFlush(
    [target.asElectron()],
    "operation-close",
    windowRequestKey,
  );
  const closeCapture = (await sentAt(target.webContents, 0))
    .payload as PendingComposerDraftCaptureRequest;
  const quitRun = flusher.captureAndFlush(
    [target.asElectron()],
    "operation-quit",
    applicationRequestKey,
  );
  const quitCapture = (await sentAt(target.webContents, 1))
    .payload as PendingComposerDraftCaptureRequest;

  const closeExpectation = await captureReply(flusher, target.webContents, closeCapture, 13);
  const quitExpectation = await captureReply(flusher, target.webContents, quitCapture, 14);
  const closeFlush = (await sentAt(target.webContents, 2))
    .payload as PendingComposerDraftFlushRequest;
  const quitFlush = (await sentAt(target.webContents, 3))
    .payload as PendingComposerDraftFlushRequest;
  expect(closeFlush.expectation.requestKey.intent).toBe("window-close");
  expect(quitFlush.expectation.requestKey.intent).toBe("app-quit");

  expect(
    flusher.acknowledgeFlushResult(target.webContents.asElectron(), {
      requestId: quitFlush.requestId,
      outcome: outcome(quitExpectation, "saved"),
    }),
  ).toBe(true);
  expect(
    flusher.acknowledgeFlushResult(target.webContents.asElectron(), {
      requestId: closeFlush.requestId,
      outcome: outcome(closeExpectation, "no-pending"),
    }),
  ).toBe(true);

  await expect(Promise.all([closeRun, quitRun])).resolves.toEqual([
    [outcome(closeExpectation, "no-pending")],
    [outcome(quitExpectation, "saved")],
  ]);
});

test("rejects duplicate windows and malformed operation or request identity before IPC", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const target = new FakeWindow(50);
  await expect(
    flusher.captureAndFlush(
      [target.asElectron(), target.asElectron()],
      "operation-duplicate-window",
      applicationRequestKey,
    ),
  ).rejects.toThrow("unique");
  await expect(
    flusher.captureAndFlush([target.asElectron()], "", applicationRequestKey),
  ).rejects.toThrow("operationId");
  await expect(
    flusher.captureAndFlush([target.asElectron()], "operation-bad-request", {
      ...applicationRequestKey,
      effectScope: { kind: "application", revision: -1 },
    }),
  ).rejects.toThrow();
  expect(target.webContents.sent).toEqual([]);
});

test("keeps the legacy void flush path isolated from typed result channels", async () => {
  const flusher = new PendingComposerDraftFlusher(10_000);
  const target = new FakeWindow(60);
  const run = flusher.flush([target.asElectron()]);
  const request = await sentAt(target.webContents, 0);
  expect(request.channel).toBe(desktopIpc.flushPendingComposerDraft);
  expect(typeof request.payload).toBe("number");
  flusher.acknowledge(target.webContents.asElectron(), request.payload as number);
  await expect(run).resolves.toBeUndefined();
  expect(target.webContents.sent.map((message) => message.channel)).toEqual([
    desktopIpc.flushPendingComposerDraft,
  ]);
});
