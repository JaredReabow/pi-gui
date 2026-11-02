import type { DesktopAppState } from "../../../contracts/desktop-state";
import {
  projectImport_sanitizeMonitorText,
  type ProjectImportCandidate,
  type ProjectImportItemResult,
  type ProjectImportMonitorRequest,
  type ProjectImportMonitorResult,
} from "../../../contracts/project-import";

export interface ProjectImportRunnerApi {
  readonly platform: NodeJS.Platform;
  addWorkspacePath(path: string): Promise<DesktopAppState>;
  monitorProjectImport(request: ProjectImportMonitorRequest): Promise<ProjectImportMonitorResult>;
}

export interface ProjectImportModel {
  readonly provider: string;
  readonly modelId: string;
}

export interface ProjectImportRunInput {
  readonly api: ProjectImportRunnerApi;
  readonly candidates: readonly ProjectImportCandidate[];
  readonly existingWorkspacePaths: readonly string[];
  readonly model: ProjectImportModel | undefined;
  readonly onSnapshot: (state: DesktopAppState) => void;
  readonly onProgress: (results: readonly ProjectImportItemResult[]) => void;
  readonly onMonitorStart: () => void;
}

export interface ProjectImportRunResult {
  readonly results: readonly ProjectImportItemResult[];
  readonly monitorResult: ProjectImportMonitorResult | null;
}

/**
 * Runs the deterministic import first. The model receives only a bounded failure
 * summary and is not contacted when every selected project imports successfully.
 */
export async function projectImport_run(
  input: ProjectImportRunInput,
): Promise<ProjectImportRunResult> {
  const presentPaths = new Set(
    input.existingWorkspacePaths.map((path) => projectImport_pathKey(path, input.api.platform)),
  );
  let results = await projectImport_importCandidates(
    input.api,
    input.candidates,
    presentPaths,
    input.onSnapshot,
    input.onProgress,
  );
  let monitorResult: ProjectImportMonitorResult | null = null;
  const failed = results.filter((item) => item.status === "failed");

  if (failed.length > 0 && input.model) {
    input.onMonitorStart();
    monitorResult = await input.api
      .monitorProjectImport({
        model: input.model,
        cwd:
          results.find((item) => item.status !== "failed")?.path ??
          input.existingWorkspacePaths[0] ??
          "/",
        candidatesFound: input.candidates.length,
        imported: results.filter((item) => item.status === "imported").length,
        alreadyPresent: results.filter((item) => item.status === "already-present").length,
        failures: failed.slice(0, 100).map((item) => ({
          name: item.name,
          status: "failed",
          error: projectImport_sanitizeMonitorText(item.error ?? "Project import failed."),
        })),
      })
      .catch((error: unknown): ProjectImportMonitorResult => ({
        status: "unavailable",
        action: "continue",
        message: projectImport_errorMessage(error),
      }));

    if (monitorResult.status === "completed" && monitorResult.action === "retry") {
      const failedIds = new Set(failed.map((item) => item.candidateId));
      const retryCandidates = input.candidates.filter((candidate) => failedIds.has(candidate.id));
      const retried = await projectImport_importCandidates(
        input.api,
        retryCandidates,
        presentPaths,
        input.onSnapshot,
        input.onProgress,
      );
      const retriedById = new Map(retried.map((item) => [item.candidateId, item]));
      results = results.map((item) => retriedById.get(item.candidateId) ?? item);
      input.onProgress(results);
    }
  }

  return { results, monitorResult };
}

export function projectImport_pathKey(path: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? path.replaceAll("\\", "/").toLowerCase() : path;
}

async function projectImport_importCandidates(
  api: ProjectImportRunnerApi,
  candidates: readonly ProjectImportCandidate[],
  presentPaths: Set<string>,
  onSnapshot: (state: DesktopAppState) => void,
  onProgress: (results: readonly ProjectImportItemResult[]) => void,
): Promise<ProjectImportItemResult[]> {
  const results: ProjectImportItemResult[] = [];
  for (const candidate of candidates) {
    const base = {
      candidateId: candidate.id,
      name: candidate.name,
      path: candidate.path,
    };
    const pathKey = projectImport_pathKey(candidate.path, api.platform);
    if (presentPaths.has(pathKey)) {
      results.push({ ...base, status: "already-present" });
      onProgress([...results]);
      continue;
    }
    try {
      const state = await api.addWorkspacePath(candidate.path);
      onSnapshot(state);
      presentPaths.add(pathKey);
      results.push({ ...base, status: "imported" });
    } catch (error) {
      results.push({
        ...base,
        status: "failed",
        error: projectImport_errorMessage(error),
      });
    }
    onProgress([...results]);
  }
  return results;
}

function projectImport_errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
