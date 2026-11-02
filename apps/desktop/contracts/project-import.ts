import {
  projectImport_sanitizeMonitorText,
  type ProjectImportMonitorRequest,
  type ProjectImportMonitorResult,
} from "@pi-gui/session-driver";

export { projectImport_sanitizeMonitorText } from "@pi-gui/session-driver";
export type {
  ProjectImportCandidate,
  ProjectImportItemResult,
  ProjectImportItemStatus,
  ProjectImportModelOption,
  ProjectImportMonitorRequest,
  ProjectImportMonitorResult,
  ProjectImportScanResult,
  ProjectImportSource,
  ProjectImportSourceStatus,
} from "@pi-gui/session-driver";

export function projectImport_decodeMonitorRequest(value: unknown): ProjectImportMonitorRequest {
  const record = requireRecord(value, "request");
  const model = requireRecord(record.model, "request.model");
  const failures = record.failures;
  if (!Array.isArray(failures) || failures.length > 100) {
    throw new TypeError("request.failures must be an array with at most 100 entries");
  }
  return {
    model: {
      provider: requireString(model.provider, "request.model.provider", 200),
      modelId: requireString(model.modelId, "request.model.modelId", 300),
    },
    cwd: requireString(record.cwd, "request.cwd", 4096),
    candidatesFound: requireCount(record.candidatesFound, "request.candidatesFound"),
    imported: requireCount(record.imported, "request.imported"),
    alreadyPresent: requireCount(record.alreadyPresent, "request.alreadyPresent"),
    failures: failures.map((item, index) => {
      const failure = requireRecord(item, `request.failures[${index}]`);
      if (failure.status !== "failed") {
        throw new TypeError(`request.failures[${index}].status must be failed`);
      }
      return {
        name: requireString(failure.name, `request.failures[${index}].name`, 200),
        status: "failed" as const,
        error: projectImport_sanitizeMonitorText(
          requireString(failure.error, `request.failures[${index}].error`, 500),
        ),
      };
    }),
  };
}

export function projectImport_decodeMonitorResult(value: unknown): ProjectImportMonitorResult {
  const record = requireRecord(value, "result");
  if (record.status !== "completed" && record.status !== "unavailable") {
    throw new TypeError("result.status must be completed or unavailable");
  }
  if (record.action !== "continue" && record.action !== "retry" && record.action !== "skip") {
    throw new TypeError("result.action must be continue, retry, or skip");
  }
  return {
    status: record.status,
    action: record.action,
    message: requireString(record.message, "result.message", 500),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function requireCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value as number;
}
