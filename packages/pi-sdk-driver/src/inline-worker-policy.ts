import type {
  InlineWorkerError,
  InlineWorkerErrorCode,
  InlineWorkerRequestBounds,
  InlineWorkerResultBounds,
} from "@pi-gui/session-driver";
import { inlineWorker_decodeRequest } from "@pi-gui/session-driver";

/** Conservative first-core limits. These are not a promise about provider throughput. */
export const INLINE_WORKER_DEFAULT_POLICY = Object.freeze({
  maxActivePerParent: 4,
  maxActivePerOwner: 8,
  maxNestingDepth: 1,
  deadlineMs: 180_000,
  maxPromptBytes: 65_536,
  maxResultBytes: 131_072,
  maxErrorBytes: 8_192,
});

export interface InlineWorkerPolicy {
  readonly maxActivePerParent: number;
  readonly maxActivePerOwner: number;
  readonly maxNestingDepth: number;
  readonly deadlineMs: number;
  readonly maxPromptBytes: number;
  readonly maxResultBytes: number;
  readonly maxErrorBytes: number;
}

export interface InlineWorkerCapacitySnapshot {
  readonly activeForParent: number;
  readonly activeForOwner: number;
}

export interface InlineWorkerCapacityReservation {
  readonly parentKey: string;
  readonly released: () => void;
}

const POLICY_NUMBER_KEYS = [
  "maxActivePerParent",
  "maxActivePerOwner",
  "maxNestingDepth",
  "deadlineMs",
  "maxPromptBytes",
  "maxResultBytes",
  "maxErrorBytes",
] as const;

function validPolicyNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Resolve defaults and accept only explicit positive integer test/runtime overrides. */
export function inlineWorkerPolicy_resolve(
  overrides: Partial<InlineWorkerPolicy> = {},
): InlineWorkerPolicy {
  const policy = { ...INLINE_WORKER_DEFAULT_POLICY, ...overrides };
  if (!POLICY_NUMBER_KEYS.every((key) => validPolicyNumber(policy[key]))) {
    throw new Error("Inline-worker policy values must be positive safe integers.");
  }
  return Object.freeze(policy);
}

export function inlineWorkerPolicy_requestBounds(
  policy: InlineWorkerPolicy,
): InlineWorkerRequestBounds {
  return { maxPromptBytes: policy.maxPromptBytes };
}

export function inlineWorkerPolicy_resultBounds(
  policy: InlineWorkerPolicy,
): InlineWorkerResultBounds {
  return {
    // Generated UUIDs fit comfortably; these bounds also constrain hostile snapshots.
    maxWorkerIdBytes: 128,
    maxWorkerRunIdBytes: 128,
    maxTextBytes: policy.maxResultBytes,
    maxErrorBytes: policy.maxErrorBytes,
  };
}

export type InlineWorkerPromptValidation =
  | { readonly ok: true; readonly prompt: string }
  | { readonly ok: false; readonly error: InlineWorkerError };

export function inlineWorkerPolicy_validatePrompt(
  request: unknown,
  policy: InlineWorkerPolicy,
): InlineWorkerPromptValidation {
  const decoded = inlineWorker_decodeRequest(request, inlineWorkerPolicy_requestBounds(policy));
  if (!decoded.ok) {
    return {
      ok: false,
      error: {
        code: "INVALID_RESULT",
        message: inlineWorkerPolicy_sanitizeError(decoded.error.message, policy),
      },
    };
  }
  return { ok: true, prompt: decoded.value.prompt };
}

function wellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function trimUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  let end = low;
  if (end > 0 && end < value.length) {
    const unit = value.charCodeAt(end - 1);
    if (unit >= 0xd800 && unit <= 0xdbff) end -= 1;
  }
  return end > 0 ? value.slice(0, end) : ".";
}

/**
 * Produce a bounded, visibly marked diagnostic. The implementation intentionally
 * removes common credential shapes and control characters before UTF-8 truncation.
 */
export function inlineWorkerPolicy_sanitizeError(
  error: unknown,
  policy: InlineWorkerPolicy,
): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalized = (raw || "Worker failed.")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      (_match, name: string) => `${name}=[redacted]`,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi, "$1[redacted]@")
    .trim();

  const suffix = " [truncated]";
  const suffixBytes = new TextEncoder().encode(suffix).byteLength;
  const valid = wellFormedUnicode(normalized)
    ? normalized
    : normalized.replace(/[\ud800-\udfff]/g, "\ufffd");
  if (new TextEncoder().encode(valid).byteLength <= policy.maxErrorBytes) return valid;
  if (policy.maxErrorBytes <= suffixBytes) {
    return trimUtf8(valid, policy.maxErrorBytes);
  }
  return `${trimUtf8(valid, policy.maxErrorBytes - suffixBytes)}${suffix}`;
}

export function inlineWorkerPolicy_errorResult(
  code: InlineWorkerErrorCode,
  error: unknown,
  policy: InlineWorkerPolicy,
): InlineWorkerError {
  return {
    code,
    message: inlineWorkerPolicy_sanitizeError(error, policy),
  };
}

/** Synchronous reservation ledger. There is deliberately no waiting queue. */
export class InlineWorkerCapacityLedger {
  private readonly activeByParent = new Map<string, number>();
  private activeForOwner = 0;

  constructor(readonly policy: InlineWorkerPolicy) {}

  snapshot(parentKey: string): InlineWorkerCapacitySnapshot {
    return {
      activeForParent: this.activeByParent.get(parentKey) ?? 0,
      activeForOwner: this.activeForOwner,
    };
  }

  reserve(parentKey: string, nestingDepth: number): InlineWorkerCapacityReservation | undefined {
    if (nestingDepth > this.policy.maxNestingDepth) return undefined;
    const activeForParent = this.activeByParent.get(parentKey) ?? 0;
    if (activeForParent >= this.policy.maxActivePerParent) return undefined;
    if (this.activeForOwner >= this.policy.maxActivePerOwner) return undefined;

    this.activeByParent.set(parentKey, activeForParent + 1);
    this.activeForOwner += 1;
    let released = false;
    return {
      parentKey,
      released: () => {
        if (released) return;
        released = true;
        this.activeForOwner -= 1;
        const current = this.activeByParent.get(parentKey) ?? 0;
        if (current <= 1) this.activeByParent.delete(parentKey);
        else this.activeByParent.set(parentKey, current - 1);
      },
    };
  }
}
