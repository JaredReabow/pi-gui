import type {
  InlineWorkerErrorCode,
  InlineWorkerFailedResult,
  InlineWorkerHostAssociation,
  InlineWorkerHostCapability,
  InlineWorkerRunHandle,
  InlineWorkerTerminalResult,
} from "@pi-gui/session-driver";
import { sessionKey, type SessionRef } from "@pi-gui/session-driver";
import {
  InlineWorkerExecution,
  type InlineWorkerExecutionContext,
  type InlineWorkerExecutorOptions,
} from "./inline-worker.js";
import {
  InlineWorkerCapacityLedger,
  inlineWorkerPolicy_errorResult,
  inlineWorkerPolicy_resolve,
  type InlineWorkerCapacitySnapshot,
  type InlineWorkerPolicy,
} from "./inline-worker-policy.js";

export interface InlineWorkerSupervisorOptions {
  /** Explicit internal override for focused tests; defaults remain in the policy module. */
  readonly policy?: Partial<InlineWorkerPolicy>;
  /** Test seam delegating to the pinned SDK implementation unless supplied. */
  readonly createAgentSessionImpl?: InlineWorkerExecutorOptions["createAgentSessionImpl"];
}

function associationKey(association: InlineWorkerHostAssociation): string {
  return [
    sessionKey(association.parent),
    association.parentRunId,
    String(association.parentGeneration),
    association.parentNativeSessionId,
    association.parentBranchId ?? "",
    association.parentToolCallId,
  ].join("\u0000");
}

function failedResult(
  association: InlineWorkerHostAssociation,
  code: InlineWorkerErrorCode,
  error: unknown,
  policy: InlineWorkerPolicy,
): InlineWorkerFailedResult {
  return {
    status: "failed",
    workerId: association.workerId,
    workerRunId: association.workerRunId,
    error: inlineWorkerPolicy_errorResult(code, error, policy),
  };
}

function completedHandle(
  association: InlineWorkerHostAssociation,
  result: InlineWorkerTerminalResult,
): InlineWorkerRunHandle {
  return {
    initial: {
      status: "queued",
      workerId: association.workerId,
      workerRunId: association.workerRunId,
    },
    completion: Promise.resolve(result),
  };
}

const REJECTED_HOST_ASSOCIATION: InlineWorkerHostAssociation = Object.freeze({
  parent: Object.freeze({
    workspaceId: "rejected-workspace",
    sessionId: "rejected-session",
  }),
  parentRunId: "rejected-run",
  parentGeneration: 1,
  parentNativeSessionId: "rejected-native-session",
  parentToolCallId: "rejected-tool-call",
  pendingSdkToolCallIds: Object.freeze([]),
  workerId: "rejected-worker",
  workerRunId: "rejected-worker-run",
});

function validResultIdentity(value: string, fallback: string): string {
  if (value.trim().length === 0 || new TextEncoder().encode(value).byteLength > 128) {
    return fallback;
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return fallback;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return fallback;
    }
  }
  return value;
}

function trustedFailureAssociation(
  association: InlineWorkerHostAssociation,
): InlineWorkerHostAssociation {
  // This association came from the SessionSupervisor WeakMap, not from the
  // caller-shaped capability. Generated UUIDs are already valid result IDs.
  return {
    ...association,
    workerId: validResultIdentity(association.workerId, REJECTED_HOST_ASSOCIATION.workerId),
    workerRunId: validResultIdentity(
      association.workerRunId,
      REJECTED_HOST_ASSOCIATION.workerRunId,
    ),
  };
}

/**
 * In-memory owner of active workers and consumed parent run/tool associations.
 *
 * Capacity is reserved synchronously before any SDK construction. Completed or
 * failed handles stay in the association table for this process so replay of a
 * live parent tool call is idempotent; a process restart starts with no workers
 * and cannot recover a missing result.
 */
export class InlineWorkerSupervisor {
  readonly policy: InlineWorkerPolicy;

  private readonly capacity: InlineWorkerCapacityLedger;
  private readonly options: InlineWorkerSupervisorOptions;
  private readonly activeByAssociation = new Map<string, InlineWorkerExecution>();
  private readonly handlesByAssociation = new Map<string, InlineWorkerRunHandle>();

  constructor(options: InlineWorkerSupervisorOptions = {}) {
    this.policy = inlineWorkerPolicy_resolve(options.policy);
    this.options = options;
    this.capacity = new InlineWorkerCapacityLedger(this.policy);
  }

  start(context: InlineWorkerExecutionContext): InlineWorkerRunHandle {
    const key = associationKey(context.association);
    const existing = this.handlesByAssociation.get(key);
    if (existing) return existing;

    if (context.parentSignal.aborted) {
      const result: InlineWorkerTerminalResult = {
        status: "cancelled",
        workerId: context.association.workerId,
        workerRunId: context.association.workerRunId,
      };
      const handle = completedHandle(context.association, result);
      this.handlesByAssociation.set(key, handle);
      return handle;
    }

    const reservation = this.capacity.reserve(sessionKey(context.association.parent), 1);
    if (!reservation) {
      const association = context.association;
      const active = this.capacity.snapshot(sessionKey(association.parent));
      const reason =
        active.activeForOwner >= this.policy.maxActivePerOwner ||
        active.activeForParent >= this.policy.maxActivePerParent
          ? "Inline-worker capacity is exhausted."
          : "Inline-worker nesting exceeds the allowed depth.";
      const handle = completedHandle(
        association,
        failedResult(association, "CAPACITY_EXCEEDED", reason, this.policy),
      );
      this.handlesByAssociation.set(key, handle);
      return handle;
    }

    const execution = new InlineWorkerExecution(context, {
      policy: this.policy,
      ...(this.options.createAgentSessionImpl
        ? { createAgentSessionImpl: this.options.createAgentSessionImpl }
        : {}),
    });
    this.activeByAssociation.set(key, execution);
    const completion = execution.completion.finally(() => {
      if (this.activeByAssociation.get(key) === execution) {
        this.activeByAssociation.delete(key);
      }
      reservation.released();
    });
    const handle: InlineWorkerRunHandle = {
      initial: {
        status: "queued",
        workerId: context.association.workerId,
        workerRunId: context.association.workerRunId,
      },
      completion,
    };
    this.handlesByAssociation.set(key, handle);
    return handle;
  }

  /** Reject an untrusted or stale capability without reserving or touching the SDK. */
  reject(_host: unknown, code: InlineWorkerErrorCode, error: unknown): InlineWorkerRunHandle {
    const association = REJECTED_HOST_ASSOCIATION;
    return completedHandle(association, failedResult(association, code, error, this.policy));
  }

  /** Reject a capability that this supervisor issued and which later became stale. */
  rejectTrusted(
    association: InlineWorkerHostAssociation,
    code: InlineWorkerErrorCode,
    error: unknown,
  ): InlineWorkerRunHandle {
    const trusted = trustedFailureAssociation(association);
    return completedHandle(trusted, failedResult(trusted, code, error, this.policy));
  }

  /** Cancel matching active workers and await their authoritative completion. */
  async cancelParent(parent: SessionRef): Promise<void> {
    const parentKey = sessionKey(parent);
    const tasks: Promise<unknown>[] = [];
    for (const execution of this.activeByAssociation.values()) {
      if (sessionKey(execution.parentRef) === parentKey) {
        execution.cancel("parent");
        tasks.push(execution.completion);
      }
    }
    await Promise.allSettled(tasks);
  }

  async cancelAll(): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    for (const execution of this.activeByAssociation.values()) {
      execution.cancel("parent");
      tasks.push(execution.completion);
    }
    await Promise.allSettled(tasks);
  }

  capacityFor(parent: SessionRef): InlineWorkerCapacitySnapshot {
    return this.capacity.snapshot(sessionKey(parent));
  }

  get activeCount(): number {
    return this.activeByAssociation.size;
  }
}
