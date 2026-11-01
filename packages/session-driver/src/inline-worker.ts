import type { RunId, SessionRef } from "./types.js";

/**
 * The only model-authored inline-worker input in the first contract phase.
 *
 * Parent, run, tool-call, worker, runtime and model-selection facts are host
 * state. They must never be accepted from this request object.
 */
export interface InlineWorkerModelRequest {
  readonly prompt: string;
}

/** Runtime policy supplies these values; this contract does not define defaults. */
export interface InlineWorkerRequestBounds {
  readonly maxPromptBytes: number;
}

/** Runtime policy supplies these values for untrusted result validation. */
export interface InlineWorkerResultBounds {
  readonly maxWorkerIdBytes: number;
  readonly maxWorkerRunIdBytes: number;
  readonly maxTextBytes: number;
  readonly maxErrorBytes: number;
}

export type InlineWorkerValidationCode =
  | "INVALID_BOUNDS"
  | "INVALID_REQUEST"
  | "EMPTY_PROMPT"
  | "PROMPT_TOO_LONG"
  | "INVALID_TEXT_ENCODING"
  | "INVALID_RESULT"
  | "INVALID_STATUS"
  | "INVALID_ID"
  | "TEXT_TOO_LONG"
  | "INVALID_ERROR";

export interface InlineWorkerDecodeSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export interface InlineWorkerDecodeFailure {
  readonly ok: false;
  readonly error: {
    readonly code: InlineWorkerValidationCode;
    readonly message: string;
  };
}

export type InlineWorkerDecodeResult<T> = InlineWorkerDecodeSuccess<T> | InlineWorkerDecodeFailure;

export interface InlineWorkerIdentity {
  readonly workerId: string;
  readonly workerRunId: RunId;
}

export interface InlineWorkerQueuedResult extends InlineWorkerIdentity {
  readonly status: "queued";
}

export interface InlineWorkerRunningResult extends InlineWorkerIdentity {
  readonly status: "running";
}

export interface InlineWorkerSucceededResult extends InlineWorkerIdentity {
  readonly status: "succeeded";
  /** Visible final assistant text only; reasoning is never part of this DTO. */
  readonly text: string;
}

export type InlineWorkerErrorCode =
  | "INVALID_ASSOCIATION"
  | "CAPACITY_EXCEEDED"
  | "WORKER_START_FAILED"
  | "PROVIDER_ERROR"
  | "RESULT_TOO_LARGE"
  | "INVALID_RESULT"
  | "CLEANUP_FAILED"
  | "UNKNOWN_FAILURE";

export interface InlineWorkerError {
  readonly code: InlineWorkerErrorCode;
  readonly message: string;
}

export interface InlineWorkerFailedResult extends InlineWorkerIdentity {
  readonly status: "failed";
  readonly error: InlineWorkerError;
}

export interface InlineWorkerCancelledResult extends InlineWorkerIdentity {
  readonly status: "cancelled";
}

export interface InlineWorkerTimedOutResult extends InlineWorkerIdentity {
  readonly status: "timedOut";
}

export type InlineWorkerTerminalResult =
  | InlineWorkerSucceededResult
  | InlineWorkerFailedResult
  | InlineWorkerCancelledResult
  | InlineWorkerTimedOutResult;

export type InlineWorkerResult =
  InlineWorkerQueuedResult | InlineWorkerRunningResult | InlineWorkerTerminalResult;

/**
 * Facts captured by the trusted host and revalidated against live SessionSupervisor
 * state by the driver. Possessing this shape or matching strings grants no authority.
 */
export interface InlineWorkerHostAssociation {
  readonly parent: SessionRef;
  readonly parentRunId: RunId;
  readonly parentGeneration: number;
  /** Pi's native session identity paired with the branch below. */
  readonly parentNativeSessionId: string;
  /** Current native branch leaf at capture time, when the host has one. */
  readonly parentBranchId?: string;
  /** ID of the top-level SDK tool call that invoked the future inline-worker tool. */
  readonly parentToolCallId: string;
  /** Exact private pending top-level SDK tool-call set captured for this invocation. */
  readonly pendingSdkToolCallIds: readonly string[];
  readonly workerId: string;
  readonly workerRunId: RunId;
}

declare const inlineWorkerHostCapabilityBrand: unique symbol;

/**
 * Host-only, non-serializable runtime context. Implementations must validate the
 * captured association against the live parent record before starting any work.
 */
export interface InlineWorkerHostCapability {
  readonly [inlineWorkerHostCapabilityBrand]: true;
  readonly association: InlineWorkerHostAssociation;
  readonly signal: AbortSignal;
}

/** The host observes the initial state and awaits the eventual terminal state. */
export interface InlineWorkerRunHandle {
  readonly initial: InlineWorkerQueuedResult | InlineWorkerRunningResult;
  readonly completion: Promise<InlineWorkerTerminalResult>;
}

/**
 * Separate opt-in driver capability. It intentionally adds no required
 * SessionDriver method and no driver event arm.
 */
export interface InlineWorkerDriverCapability {
  startInlineWorker(
    request: InlineWorkerModelRequest,
    host: InlineWorkerHostCapability,
  ): InlineWorkerRunHandle;
}

function decodeFailure(
  code: InlineWorkerValidationCode,
  message: string,
): InlineWorkerDecodeFailure {
  return { ok: false, error: { code, message } };
}

function isValidBound(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(
  value: Record<PropertyKey, unknown>,
  key: string,
): { readonly present: boolean; readonly value?: unknown; readonly valid: boolean } {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) {
    return { present: false, valid: true };
  }
  if (!descriptor.enumerable || !("value" in descriptor)) {
    return { present: true, valid: false };
  }
  return { present: true, value: descriptor.value, valid: true };
}

function hasExactStringKeys(
  value: Record<PropertyKey, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function decodeBoundedText(
  value: unknown,
  maxBytes: number,
  tooLongCode: InlineWorkerValidationCode,
  label: string,
  allowEmpty: boolean,
): InlineWorkerDecodeResult<string> {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    return decodeFailure("INVALID_RESULT", `${label} must be a string.`);
  }
  if (!isWellFormedUtf16(value)) {
    return decodeFailure("INVALID_TEXT_ENCODING", `${label} must contain valid Unicode.`);
  }
  if (value.length > maxBytes || utf8ByteLength(value) > maxBytes) {
    return decodeFailure(tooLongCode, `${label} exceeds its configured UTF-8 byte bound.`);
  }
  return { ok: true, value };
}

/**
 * Strictly decode the model-authorable request. Caller identities, tool/selection
 * policy and unknown fields fail closed.
 */
export function inlineWorker_decodeRequest(
  value: unknown,
  bounds: InlineWorkerRequestBounds,
): InlineWorkerDecodeResult<InlineWorkerModelRequest> {
  if (!isValidBound(bounds?.maxPromptBytes)) {
    return decodeFailure(
      "INVALID_BOUNDS",
      "maxPromptBytes must be an explicitly supplied positive safe integer.",
    );
  }
  if (!isPlainObject(value)) {
    return decodeFailure("INVALID_REQUEST", "Inline-worker request must be a plain object.");
  }
  if (!hasExactStringKeys(value, ["prompt"])) {
    return decodeFailure("INVALID_REQUEST", "Inline-worker request accepts only the prompt field.");
  }
  const prompt = ownDataValue(value, "prompt");
  if (!prompt.present || !prompt.valid || typeof prompt.value !== "string") {
    return decodeFailure("INVALID_REQUEST", "prompt must be an enumerable data property.");
  }
  if (prompt.value.trim().length === 0) {
    return decodeFailure("EMPTY_PROMPT", "prompt must not be empty.");
  }
  if (!isWellFormedUtf16(prompt.value)) {
    return decodeFailure("INVALID_TEXT_ENCODING", "prompt must contain valid Unicode.");
  }
  if (
    prompt.value.length > bounds.maxPromptBytes ||
    utf8ByteLength(prompt.value) > bounds.maxPromptBytes
  ) {
    return decodeFailure("PROMPT_TOO_LONG", "prompt exceeds the configured UTF-8 byte bound.");
  }
  return { ok: true, value: { prompt: prompt.value } };
}

const INLINE_WORKER_ERROR_CODES = new Set<InlineWorkerErrorCode>([
  "INVALID_ASSOCIATION",
  "CAPACITY_EXCEEDED",
  "WORKER_START_FAILED",
  "PROVIDER_ERROR",
  "RESULT_TOO_LARGE",
  "INVALID_RESULT",
  "CLEANUP_FAILED",
  "UNKNOWN_FAILURE",
]);

/**
 * Strictly decode a browser-safe status/result DTO. This rejects the reserved
 * interrupted state and every success/error field combination outside its arm.
 */
export function inlineWorker_decodeResult(
  value: unknown,
  bounds: InlineWorkerResultBounds,
): InlineWorkerDecodeResult<InlineWorkerResult> {
  if (
    !isValidBound(bounds?.maxWorkerIdBytes) ||
    !isValidBound(bounds?.maxWorkerRunIdBytes) ||
    !isValidBound(bounds?.maxTextBytes) ||
    !isValidBound(bounds?.maxErrorBytes)
  ) {
    return decodeFailure(
      "INVALID_BOUNDS",
      "Inline-worker result bounds must be explicit positive safe integers.",
    );
  }
  if (!isPlainObject(value)) {
    return decodeFailure("INVALID_RESULT", "Inline-worker result must be a plain object.");
  }
  const status = ownDataValue(value, "status");
  if (!status.present || !status.valid || typeof status.value !== "string") {
    return decodeFailure("INVALID_STATUS", "status must be an enumerable data property.");
  }
  if (
    status.value !== "queued" &&
    status.value !== "running" &&
    status.value !== "succeeded" &&
    status.value !== "failed" &&
    status.value !== "cancelled" &&
    status.value !== "timedOut"
  ) {
    return decodeFailure(
      "INVALID_STATUS",
      "status must be queued, running, succeeded, failed, cancelled or timedOut.",
    );
  }

  const expectedKeys =
    status.value === "succeeded"
      ? ["status", "workerId", "workerRunId", "text"]
      : status.value === "failed"
        ? ["status", "workerId", "workerRunId", "error"]
        : ["status", "workerId", "workerRunId"];
  if (!hasExactStringKeys(value, expectedKeys)) {
    return decodeFailure(
      "INVALID_RESULT",
      `Inline-worker ${status.value} result has missing or unknown fields.`,
    );
  }

  const workerId = ownDataValue(value, "workerId");
  if (!workerId.present || !workerId.valid) {
    return decodeFailure("INVALID_ID", "workerId must be an enumerable data property.");
  }
  const decodedWorkerId = decodeBoundedText(
    workerId.value,
    bounds.maxWorkerIdBytes,
    "TEXT_TOO_LONG",
    "workerId",
    false,
  );
  if (!decodedWorkerId.ok) {
    return decodedWorkerId;
  }

  const workerRunId = ownDataValue(value, "workerRunId");
  if (!workerRunId.present || !workerRunId.valid) {
    return decodeFailure("INVALID_ID", "workerRunId must be an enumerable data property.");
  }
  const decodedWorkerRunId = decodeBoundedText(
    workerRunId.value,
    bounds.maxWorkerRunIdBytes,
    "TEXT_TOO_LONG",
    "workerRunId",
    false,
  );
  if (!decodedWorkerRunId.ok) {
    return decodedWorkerRunId;
  }

  const identity = {
    workerId: decodedWorkerId.value,
    workerRunId: decodedWorkerRunId.value,
  };
  if (status.value === "queued") {
    return { ok: true, value: { ...identity, status: "queued" } };
  }
  if (status.value === "running") {
    return { ok: true, value: { ...identity, status: "running" } };
  }
  if (status.value === "cancelled") {
    return { ok: true, value: { ...identity, status: "cancelled" } };
  }
  if (status.value === "timedOut") {
    return { ok: true, value: { ...identity, status: "timedOut" } };
  }
  if (status.value === "succeeded") {
    const text = ownDataValue(value, "text");
    if (!text.present || !text.valid) {
      return decodeFailure("INVALID_RESULT", "text must be an enumerable data property.");
    }
    const decodedText = decodeBoundedText(
      text.value,
      bounds.maxTextBytes,
      "TEXT_TOO_LONG",
      "text",
      true,
    );
    if (!decodedText.ok) {
      return decodedText;
    }
    return {
      ok: true,
      value: { ...identity, status: "succeeded", text: decodedText.value },
    };
  }

  const error = ownDataValue(value, "error");
  if (!error.present || !error.valid || !isPlainObject(error.value)) {
    return decodeFailure("INVALID_ERROR", "error must be a plain object.");
  }
  if (!hasExactStringKeys(error.value, ["code", "message"])) {
    return decodeFailure("INVALID_ERROR", "error accepts only the code and message fields.");
  }
  const code = ownDataValue(error.value, "code");
  if (
    !code.present ||
    !code.valid ||
    typeof code.value !== "string" ||
    !INLINE_WORKER_ERROR_CODES.has(code.value as InlineWorkerErrorCode)
  ) {
    return decodeFailure("INVALID_ERROR", "error.code is not a supported stable code.");
  }
  const message = ownDataValue(error.value, "message");
  if (!message.present || !message.valid) {
    return decodeFailure("INVALID_ERROR", "error.message must be an enumerable data property.");
  }
  const decodedMessage = decodeBoundedText(
    message.value,
    bounds.maxErrorBytes,
    "TEXT_TOO_LONG",
    "error.message",
    false,
  );
  if (!decodedMessage.ok) {
    return decodedMessage;
  }
  return {
    ok: true,
    value: {
      ...identity,
      status: "failed",
      error: {
        code: code.value as InlineWorkerErrorCode,
        message: decodedMessage.value,
      },
    },
  };
}

export function inlineWorker_isTerminal(
  result: InlineWorkerResult,
): result is InlineWorkerTerminalResult {
  return (
    result.status === "succeeded" ||
    result.status === "failed" ||
    result.status === "cancelled" ||
    result.status === "timedOut"
  );
}
