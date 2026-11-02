export type ProjectImportSource = "cursor" | "claude" | "chatgpt";

export interface ProjectImportCandidate {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly sources: readonly ProjectImportSource[];
}

export interface ProjectImportSourceStatus {
  readonly source: ProjectImportSource;
  readonly detected: boolean;
  readonly candidateCount: number;
}

export interface ProjectImportModelOption {
  readonly provider: string;
  readonly modelId: string;
  readonly label: string;
  readonly reasoning: boolean;
}

export interface ProjectImportScanResult {
  readonly scannedAt: string;
  readonly candidates: readonly ProjectImportCandidate[];
  readonly sources: readonly ProjectImportSourceStatus[];
  readonly models: readonly ProjectImportModelOption[];
}

export type ProjectImportItemStatus = "imported" | "already-present" | "failed";

export interface ProjectImportItemResult {
  readonly candidateId: string;
  readonly name: string;
  readonly path: string;
  readonly status: ProjectImportItemStatus;
  readonly error?: string;
}

export interface ProjectImportMonitorRequest {
  readonly model: {
    readonly provider: string;
    readonly modelId: string;
  };
  readonly cwd: string;
  readonly candidatesFound: number;
  readonly imported: number;
  readonly alreadyPresent: number;
  readonly failures: readonly {
    readonly name: string;
    readonly status: "failed";
    readonly error: string;
  }[];
}

export interface ProjectImportMonitorResult {
  readonly status: "completed" | "unavailable";
  readonly action: "continue" | "retry" | "skip";
  readonly message: string;
}

/**
 * Removes local paths and common credential values before failure text is sent
 * to an optional monitoring model.
 */
export function projectImport_sanitizeMonitorText(value: string, maxLength = 240): string {
  return value
    .replace(/\bfile:\/\/[^\s"'`]+/gi, "[path]")
    .replace(/[\"'](?:[A-Za-z]:\\|\/)[^\"']*[\"']/g, "[path]")
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'`:;,)]+/g, "[path]")
    .replace(/(^|[\s"'=:(])\/(?:[^/\s"'`:()]+\/)*[^/\s"'`:()]+/g, "$1[path]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
