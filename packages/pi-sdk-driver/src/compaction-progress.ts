import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SessionCompactionProgress } from "@pi-gui/session-driver";
import { safeRequestError } from "./summary-request.js";

export class CompactionInProgressError extends Error {
  readonly code = "COMPACTION_IN_PROGRESS";
  constructor() {
    super(
      "Context summarization is in progress. Your message was not sent. Wait for it to finish or stop it before sending.",
    );
    this.name = "CompactionInProgressError";
  }
}

export function isCompactionAdmissionError(error: unknown): boolean {
  return (
    error instanceof CompactionInProgressError ||
    (error instanceof Error &&
      /Cannot submit a prompt while compaction is in progress/i.test(error.message))
  );
}

/** Projection only: retry timing and execution remain owned by the released SDK. */
export function compactionProgressForEvent(
  current: SessionCompactionProgress | undefined,
  event: AgentSessionEvent,
  timestamp: string,
): SessionCompactionProgress | undefined {
  switch (event.type) {
    case "compaction_start":
      return {
        phase: "summarizing",
        reason: event.reason,
        startedAt: timestamp,
        updatedAt: timestamp,
      };
    case "summarization_retry_scheduled":
      if (!current || (current.phase !== "summarizing" && current.phase !== "retrying"))
        return current;
      return {
        ...current,
        phase: "retrying",
        updatedAt: timestamp,
        retry: {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          retryAt: new Date(Date.parse(timestamp) + event.delayMs).toISOString(),
        },
        errorMessage: safeRequestError(event.errorMessage),
      };
    case "summarization_retry_attempt_start":
      if (event.source !== "compaction" || !current) return current;
      return {
        ...current,
        phase: "summarizing",
        updatedAt: timestamp,
        ...(current.retry
          ? { retry: { attempt: current.retry.attempt, maxAttempts: current.retry.maxAttempts } }
          : {}),
      };
    case "summarization_retry_finished": {
      if (!current?.retry || (current.phase !== "summarizing" && current.phase !== "retrying"))
        return current;
      // A split-turn compaction can start another summary call after this retry
      // cycle. Do not mislabel that new call as the previous call's retry.
      const active = { ...current };
      delete active.retry;
      delete active.errorMessage;
      return { ...active, phase: "summarizing", updatedAt: timestamp };
    }
    case "compaction_end": {
      if (event.result) return undefined;
      const base = current ?? { reason: event.reason, startedAt: timestamp };
      // The custom hook deliberately cancels on provider/config failure to prevent
      // silent model fallback. Keep its actual error instead of calling it a user Stop.
      if (current?.phase === "failed") return current;
      return {
        ...base,
        phase: event.aborted ? "stopped" : "failed",
        updatedAt: timestamp,
        ...(event.errorMessage ? { errorMessage: safeRequestError(event.errorMessage) } : {}),
      };
    }
    case "agent_start":
      return current?.phase === "failed" || current?.phase === "stopped" ? undefined : current;
    default:
      return current;
  }
}
