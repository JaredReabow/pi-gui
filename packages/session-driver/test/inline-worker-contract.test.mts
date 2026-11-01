import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  InlineWorkerDriverCapability,
  InlineWorkerResultBounds,
  SessionDriver,
  SessionDriverEvent,
} from "../dist/index.js";
import {
  inlineWorker_decodeRequest,
  inlineWorker_decodeResult,
  inlineWorker_isTerminal,
} from "../dist/index.js";

const requestBounds = { maxPromptBytes: 16 } as const;
const resultBounds: InlineWorkerResultBounds = {
  maxWorkerIdBytes: 32,
  maxWorkerRunIdBytes: 32,
  maxTextBytes: 32,
  maxErrorBytes: 32,
};

type SessionDriverInlineWorkerMethod = Extract<
  keyof SessionDriver,
  "runInlineWorker" | "startInlineWorker"
>;
const sessionDriverHasNoInlineWorkerMethod: SessionDriverInlineWorkerMethod extends never
  ? true
  : false = true;
void sessionDriverHasNoInlineWorkerMethod;

type InlineWorkerEvent = Extract<SessionDriverEvent, { type: "inlineWorkerUpdated" }>;
const inlineWorkerEventIsAbsent: InlineWorkerEvent extends never ? true : false = true;
void inlineWorkerEventIsAbsent;

const capabilitySeparatesFromSessionDriver: InlineWorkerDriverCapability = {
  startInlineWorker() {
    throw new Error("compile-only contract fixture");
  },
};
void capabilitySeparatesFromSessionDriver;

await test("the request decoder accepts only a bounded prompt DTO", () => {
  const decoded = inlineWorker_decodeRequest({ prompt: "Inspect only" }, requestBounds);
  assert.deepEqual(decoded, { ok: true, value: { prompt: "Inspect only" } });
  assert.equal(inlineWorker_decodeRequest({ prompt: "   " }, requestBounds).ok, false);
  assert.equal(inlineWorker_decodeRequest({ prompt: "x".repeat(17) }, requestBounds).ok, false);
  assert.equal(
    inlineWorker_decodeRequest({ prompt: "ééééééééé" }, { maxPromptBytes: 16 }).ok,
    false,
    "the bound is measured in UTF-8 bytes",
  );
  assert.equal(inlineWorker_decodeRequest({ prompt: "éééééééé" }, { maxPromptBytes: 16 }).ok, true);
});

await test("the request decoder fails closed on caller authority and unknown fields", () => {
  const forbidden = [
    "sessionRef",
    "parentRef",
    "parentRunId",
    "parentGeneration",
    "parentBranchId",
    "parentToolCallId",
    "pendingSdkToolCallIds",
    "workerId",
    "workerRunId",
    "origin",
    "status",
    "result",
    "tools",
    "environment",
    "auth",
    "model",
    "thinking",
    "thinkingLevel",
    "unknown",
  ];
  for (const field of forbidden) {
    const decoded = inlineWorker_decodeRequest(
      { prompt: "valid", [field]: "forged" },
      requestBounds,
    );
    assert.deepEqual(
      decoded,
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Inline-worker request accepts only the prompt field.",
        },
      },
      field,
    );
  }
  assert.equal(inlineWorker_decodeRequest(["prompt"], requestBounds).ok, false);
  assert.equal(inlineWorker_decodeRequest(null, requestBounds).ok, false);
  assert.equal(
    inlineWorker_decodeRequest({ prompt: "x", [Symbol("forged")]: true }, requestBounds).ok,
    false,
  );
});

await test("the request decoder rejects accessors, malformed Unicode and absent bounds", () => {
  let readGetter = false;
  const accessor = Object.defineProperty({}, "prompt", {
    enumerable: true,
    get() {
      readGetter = true;
      return "forged";
    },
  });
  assert.equal(inlineWorker_decodeRequest(accessor, requestBounds).ok, false);
  assert.equal(readGetter, false);

  assert.deepEqual(inlineWorker_decodeRequest({ prompt: "\ud800" }, requestBounds), {
    ok: false,
    error: {
      code: "INVALID_TEXT_ENCODING",
      message: "prompt must contain valid Unicode.",
    },
  });
  assert.equal(
    inlineWorker_decodeRequest({ prompt: "valid" }, {} as { maxPromptBytes: number }).ok,
    false,
  );
  assert.equal(inlineWorker_decodeRequest({ prompt: "valid" }, { maxPromptBytes: 0 }).ok, false);
});

await test("status/result decoding enforces discriminated payloads", () => {
  const results = [
    { status: "queued", workerId: "worker", workerRunId: "run" },
    { status: "running", workerId: "worker", workerRunId: "run" },
    { status: "succeeded", workerId: "worker", workerRunId: "run", text: "final" },
    {
      status: "failed",
      workerId: "worker",
      workerRunId: "run",
      error: { code: "PROVIDER_ERROR", message: "provider failed" },
    },
    { status: "cancelled", workerId: "worker", workerRunId: "run" },
    { status: "timedOut", workerId: "worker", workerRunId: "run" },
  ];
  for (const result of results) {
    const decoded = inlineWorker_decodeResult(result, resultBounds);
    assert.equal(decoded.ok, true, result.status);
    if (decoded.ok) {
      assert.equal(
        inlineWorker_isTerminal(decoded.value),
        !["queued", "running"].includes(decoded.value.status),
      );
    }
  }

  const invalid = [
    { status: "interrupted", workerId: "worker", workerRunId: "run" },
    { status: "succeeded", workerId: "worker", workerRunId: "run" },
    {
      status: "succeeded",
      workerId: "worker",
      workerRunId: "run",
      text: "final",
      error: { code: "PROVIDER_ERROR", message: "forged" },
    },
    {
      status: "failed",
      workerId: "worker",
      workerRunId: "run",
      error: { code: "PROVIDER_ERROR", message: "failed" },
      text: "forged",
    },
    {
      status: "queued",
      workerId: "worker",
      workerRunId: "run",
      result: "forged",
    },
    {
      status: "failed",
      workerId: "worker",
      workerRunId: "run",
      error: { code: "INTERRUPTED", message: "forged" },
    },
  ];
  for (const result of invalid) {
    assert.equal(inlineWorker_decodeResult(result, resultBounds).ok, false);
  }
});

await test("result text, errors and generated IDs are UTF-8 bounded", () => {
  assert.equal(
    inlineWorker_decodeResult(
      { status: "succeeded", workerId: "worker", workerRunId: "run", text: "x".repeat(33) },
      resultBounds,
    ).ok,
    false,
  );
  assert.equal(
    inlineWorker_decodeResult(
      {
        status: "failed",
        workerId: "worker",
        workerRunId: "run",
        error: { code: "PROVIDER_ERROR", message: "x".repeat(33) },
      },
      resultBounds,
    ).ok,
    false,
  );
  assert.equal(
    inlineWorker_decodeResult(
      { status: "running", workerId: "worker".repeat(6), workerRunId: "run" },
      resultBounds,
    ).ok,
    false,
  );
  assert.equal(
    inlineWorker_decodeResult(
      { status: "running", workerId: "\ud800", workerRunId: "run" },
      resultBounds,
    ).ok,
    false,
  );
});

await test("contract source remains browser-safe and outside the session event surface", () => {
  const contractSource = readFileSync(new URL("../src/inline-worker.ts", import.meta.url), "utf8");
  const typeSurface = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.doesNotMatch(contractSource, /\bfrom\s+["'](?:node:|electron|@earendil-works\/)/);
  assert.doesNotMatch(contractSource, /\bSessionDriverEvent\b/);
  assert.doesNotMatch(typeSurface, /\binlineWorkerUpdated\b/);
  assert.doesNotMatch(typeSurface, /\bstartInlineWorker\b/);
});
