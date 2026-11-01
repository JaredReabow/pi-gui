import type { BrowserWindow, WebContents } from "electron";
import {
  desktopIpc,
  pendingComposerDraft_decodeCaptureResponse,
  pendingComposerDraft_decodeFlushResponse,
  type PendingComposerDraftCaptureRequest,
  type PendingComposerDraftCaptureResponse,
  type PendingComposerDraftFlushRequest,
  type PendingComposerDraftFlushResponse,
} from "../../contracts/ipc";
import {
  lifecycle_decodeDraftFlushBatch,
  lifecycle_decodeRequestKey,
  type DraftFlushExpectation,
  type DraftFlushOutcome,
  type LifecycleRequestKey,
} from "../../contracts/lifecycle";

interface WaitingFlush {
  readonly contents: WebContents;
  readonly done: () => void;
}

interface WaitingCapture {
  readonly contents: WebContents;
  readonly request: PendingComposerDraftCaptureRequest;
  readonly done: (response: PendingComposerDraftCaptureResponse) => void;
}

interface WaitingResultFlush {
  readonly contents: WebContents;
  readonly expectation: DraftFlushExpectation;
  readonly done: (response: PendingComposerDraftFlushResponse) => void;
}

type CaptureSettlement =
  | {
      readonly status: "captured";
      readonly window: BrowserWindow;
      readonly expectation: DraftFlushExpectation;
    }
  | {
      readonly status: "rejected" | "timeout" | "renderer-gone";
      readonly window: BrowserWindow;
      readonly operationId: string;
      readonly requestKey: LifecycleRequestKey;
      readonly windowId: string;
    };

/**
 * Asks renderers to send their debounced composer drafts before their window goes away, or
 * before main switches a window's thread on an extension's behalf: the renderer drops a
 * pending draft when the selection changes under it. Call it outside the window's action
 * queue, since the draft save goes through that queue.
 * Each request resolves when the window's main frame acknowledges it after its draft
 * writes settled, or when the window dies or the bound elapses, so shutdown never waits
 * on an unresponsive renderer.
 */
export class PendingComposerDraftFlusher {
  private nextRequestId = 1;
  private readonly waiting = new Map<number, WaitingFlush>();
  private readonly waitingCaptures = new Map<number, WaitingCapture>();
  private readonly waitingResults = new Map<number, WaitingResultFlush>();

  constructor(private readonly timeoutMs: number) {}

  flush(windows: readonly BrowserWindow[]): Promise<void> {
    return Promise.all(windows.map((window) => this.flushWindow(window))).then(() => undefined);
  }

  /** Called for the owning window's main frame only, through the main-frame IPC helper. */
  acknowledge(contents: WebContents, requestId: number): void {
    const entry = this.waiting.get(requestId);
    if (entry?.contents === contents) entry.done();
  }

  /**
   * Performs a distinct capture request followed by an exact-generation flush request.
   * The legacy `flush` above remains the current Main close/quit entry point.
   */
  async captureAndFlush(
    windows: readonly BrowserWindow[],
    operationIdValue: unknown,
    requestKeyValue: unknown,
  ): Promise<readonly DraftFlushOutcome[]> {
    if (
      typeof operationIdValue !== "string" ||
      operationIdValue.length === 0 ||
      operationIdValue.length > 256 ||
      operationIdValue.trim() !== operationIdValue ||
      /[\u0000-\u001f\u007f]/.test(operationIdValue)
    ) {
      throw new TypeError("draft operationId must be a bounded identifier.");
    }
    const operationId = operationIdValue;
    const requestKey = lifecycle_decodeRequestKey(requestKeyValue);
    const windowIds = windows.map((window) => String(window.id));
    if (new Set(windowIds).size !== windowIds.length) {
      throw new TypeError("draft flush windows must be unique.");
    }
    if (requestKey.intent === "window-close") {
      if (windows.length !== 1) {
        throw new TypeError("window-close draft flush requires exactly one owning window.");
      }
      const actualWindowId = windowIds[0];
      if (
        requestKey.target.kind !== "window" ||
        requestKey.effectScope.kind !== "window" ||
        actualWindowId === undefined ||
        requestKey.target.windowId !== actualWindowId ||
        requestKey.effectScope.windowId !== actualWindowId
      ) {
        throw new TypeError(
          "window-close request target and effect scope must match the owning window.",
        );
      }
    }
    return Promise.all(
      windows.map(async (window) => {
        const capture = await this.captureWindow(window, operationId, requestKey);
        if (capture.status === "captured") {
          return this.flushCapturedWindow(capture.window, capture.expectation);
        }
        return {
          operationId: capture.operationId,
          requestKey: capture.requestKey,
          windowId: capture.windowId,
          editGeneration: 0,
          status: capture.status,
        } satisfies DraftFlushOutcome;
      }),
    );
  }

  /** Called for one window's main frame after a typed capture request. */
  acknowledgeCaptureResult(contents: WebContents, raw: unknown): boolean {
    let response: PendingComposerDraftCaptureResponse;
    try {
      response = pendingComposerDraft_decodeCaptureResponse(raw);
    } catch {
      return false;
    }
    const entry = this.waitingCaptures.get(response.requestId);
    if (entry?.contents !== contents) return false;
    if (
      response.status === "captured" &&
      (response.expectation.operationId !== entry.request.operationId ||
        JSON.stringify(response.expectation.requestKey) !==
          JSON.stringify(entry.request.requestKey) ||
        response.expectation.windowId !== entry.request.windowId)
    ) {
      return false;
    }
    entry.done(response);
    return true;
  }

  /** Called for one window's main frame after a typed flush request. */
  acknowledgeFlushResult(contents: WebContents, raw: unknown): boolean {
    let response: PendingComposerDraftFlushResponse;
    try {
      response = pendingComposerDraft_decodeFlushResponse(raw);
    } catch {
      return false;
    }
    const entry = this.waitingResults.get(response.requestId);
    if (entry?.contents !== contents) return false;
    if (
      response.outcome.operationId !== entry.expectation.operationId ||
      JSON.stringify(response.outcome.requestKey) !==
        JSON.stringify(entry.expectation.requestKey) ||
      response.outcome.windowId !== entry.expectation.windowId ||
      response.outcome.editGeneration !== entry.expectation.editGeneration
    ) {
      return false;
    }
    entry.done(response);
    return true;
  }

  private flushWindow(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isCrashed())
      return Promise.resolve();
    const contents = window.webContents;
    const requestId = this.nextRequestId++;
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        contents.off("destroyed", done);
        contents.off("render-process-gone", done);
        this.waiting.delete(requestId);
        resolve();
      };
      const timer = setTimeout(() => {
        console.warn("pi-gui: a window did not save its composer draft in time.");
        done();
      }, this.timeoutMs);
      contents.once("destroyed", done);
      contents.once("render-process-gone", done);
      this.waiting.set(requestId, { contents, done });
      contents.send(desktopIpc.flushPendingComposerDraft, requestId);
    });
  }

  private captureWindow(
    window: BrowserWindow,
    operationId: string,
    requestKey: LifecycleRequestKey,
  ): Promise<CaptureSettlement> {
    const windowId = String(window.id);
    const failed = (
      status: Exclude<CaptureSettlement["status"], "captured">,
    ): CaptureSettlement => ({
      status,
      window,
      operationId,
      requestKey,
      windowId,
    });
    if (
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      window.webContents.isCrashed()
    ) {
      return Promise.resolve(failed("renderer-gone"));
    }
    const contents = window.webContents;
    const requestId = this.nextRequestId++;
    const request = {
      requestId,
      operationId,
      requestKey,
      windowId,
    } satisfies PendingComposerDraftCaptureRequest;
    return new Promise<CaptureSettlement>((resolve) => {
      const done = (response: PendingComposerDraftCaptureResponse) => {
        clearTimeout(timer);
        contents.off("destroyed", onGone);
        contents.off("render-process-gone", onGone);
        this.waitingCaptures.delete(requestId);
        resolve(
          response.status === "captured"
            ? { status: "captured", window, expectation: response.expectation }
            : failed("rejected"),
        );
      };
      const onGone = () => {
        clearTimeout(timer);
        contents.off("destroyed", onGone);
        contents.off("render-process-gone", onGone);
        this.waitingCaptures.delete(requestId);
        resolve(failed("renderer-gone"));
      };
      const timer = setTimeout(() => {
        contents.off("destroyed", onGone);
        contents.off("render-process-gone", onGone);
        this.waitingCaptures.delete(requestId);
        resolve(failed("timeout"));
      }, this.timeoutMs);
      contents.once("destroyed", onGone);
      contents.once("render-process-gone", onGone);
      this.waitingCaptures.set(requestId, { contents, request, done });
      try {
        contents.send(desktopIpc.capturePendingComposerDraft, request);
      } catch {
        contents.off("destroyed", onGone);
        contents.off("render-process-gone", onGone);
        clearTimeout(timer);
        this.waitingCaptures.delete(requestId);
        resolve(failed("rejected"));
      }
    });
  }

  private flushCapturedWindow(
    window: BrowserWindow,
    expectation: DraftFlushExpectation,
  ): Promise<DraftFlushOutcome> {
    const failure = (status: "rejected" | "timeout" | "renderer-gone"): DraftFlushOutcome => ({
      ...expectation,
      status,
    });
    if (
      expectation.windowId !== String(window.id) ||
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      window.webContents.isCrashed()
    ) {
      return Promise.resolve(failure("renderer-gone"));
    }
    const contents = window.webContents;
    const requestId = this.nextRequestId++;
    const request = { requestId, expectation } satisfies PendingComposerDraftFlushRequest;
    return new Promise<DraftFlushOutcome>((resolve) => {
      const done = (response: PendingComposerDraftFlushResponse) => {
        clearTimeout(timer);
        contents.off("destroyed", onGone);
        contents.off("render-process-gone", onGone);
        this.waitingResults.delete(requestId);
        resolve(response.outcome);
      };
      const onGone = () => {
        clearTimeout(timer);
        contents.off("destroyed", onGone);
        contents.off("render-process-gone", onGone);
        this.waitingResults.delete(requestId);
        resolve(failure("renderer-gone"));
      };
      const timer = setTimeout(() => {
        contents.off("destroyed", onGone);
        contents.off("render-process-gone", onGone);
        this.waitingResults.delete(requestId);
        resolve(failure("timeout"));
      }, this.timeoutMs);
      contents.once("destroyed", onGone);
      contents.once("render-process-gone", onGone);
      this.waitingResults.set(requestId, { contents, expectation, done });
      try {
        contents.send(desktopIpc.flushPendingComposerDraftResult, request);
      } catch {
        contents.off("destroyed", onGone);
        contents.off("render-process-gone", onGone);
        clearTimeout(timer);
        this.waitingResults.delete(requestId);
        resolve(failure("rejected"));
      }
    });
  }
}
