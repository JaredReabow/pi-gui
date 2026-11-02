import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import type { DesktopAppState } from "../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type {
  ProjectImportCandidate,
  ProjectImportItemResult,
  ProjectImportMonitorResult,
  ProjectImportScanResult,
} from "../../../contracts/project-import";
import { applySnapshotIfNewer } from "../../app/desktop-app-state";
import { trapDialogFocus } from "../../ui/dialog-focus";
import { projectImport_run } from "./project-import-runner";

export const PROJECT_IMPORT_ONBOARDING_STORAGE_KEY = "pi-gui.project-import-onboarding.v1";

export function projectImportOnboarding_shouldPrompt(): boolean {
  try {
    return localStorage.getItem(PROJECT_IMPORT_ONBOARDING_STORAGE_KEY) === null;
  } catch {
    return true;
  }
}

export function projectImportOnboarding_markSeen(): void {
  try {
    localStorage.setItem(PROJECT_IMPORT_ONBOARDING_STORAGE_KEY, new Date().toISOString());
  } catch {
    // The prompt can reappear when storage is unavailable; import itself is unaffected.
  }
}

type ImportStep = "prompt" | "scanning" | "review" | "importing" | "monitoring" | "complete";

interface ProjectImportOnboardingProps {
  readonly open: boolean;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly existingWorkspacePaths: readonly string[];
  readonly onClose: () => void;
  readonly onComplete: () => void;
}

export function ProjectImportOnboarding({
  open,
  api,
  setSnapshot,
  existingWorkspacePaths,
  onClose,
  onComplete,
}: ProjectImportOnboardingProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState<ImportStep>("prompt");
  const [scan, setScan] = useState<ProjectImportScanResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedModel, setSelectedModel] = useState("");
  const [results, setResults] = useState<readonly ProjectImportItemResult[]>([]);
  const [monitorResult, setMonitorResult] = useState<ProjectImportMonitorResult | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setStep("prompt");
    setScan(null);
    setSelectedIds(new Set());
    setSelectedModel("");
    setResults([]);
    setMonitorResult(null);
    setError(undefined);
    requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLButtonElement>("[data-import-primary]")?.focus(),
    );
  }, [open]);

  const selectedCandidates = useMemo(
    () => scan?.candidates.filter((candidate) => selectedIds.has(candidate.id)) ?? [],
    [scan, selectedIds],
  );
  const busy = step === "scanning" || step === "importing" || step === "monitoring";

  const scanForProjects = async () => {
    setStep("scanning");
    setError(undefined);
    try {
      const next = await api.scanProjectImports();
      setScan(next);
      setSelectedIds(new Set(next.candidates.map((candidate) => candidate.id)));
      setSelectedModel(
        next.models[0] ? `${next.models[0].provider}\u0000${next.models[0].modelId}` : "",
      );
      setStep("review");
    } catch (scanError) {
      setError(errorMessage(scanError));
      setStep("prompt");
    }
  };

  const importProjects = async () => {
    if (selectedCandidates.length === 0) return;
    setStep("importing");
    setError(undefined);
    setMonitorResult(null);
    const run = await projectImport_run({
      api,
      candidates: selectedCandidates,
      existingWorkspacePaths,
      model: parseModel(selectedModel),
      onSnapshot: (state) => applySnapshotIfNewer(setSnapshot, state),
      onProgress: setResults,
      onMonitorStart: () => setStep("monitoring"),
    });
    setResults(run.results);
    setMonitorResult(run.monitorResult);
    setStep("complete");
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      trapDialogFocus(event, dialogRef.current);
      return;
    }
    if (event.key === "Escape" && !busy) onClose();
  };

  if (!open) return null;
  return (
    <div className="tree-modal-backdrop" data-testid="project-import-onboarding">
      <div
        aria-label="Import projects"
        aria-modal="true"
        className="tree-modal project-import-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="tree-modal__header">
          <div>
            <div className="tree-modal__eyebrow">First-time setup</div>
            <h2 className="tree-modal__title">Import your projects</h2>
          </div>
          <button
            aria-label="Close project import"
            className="tree-modal__close"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="tree-modal__error error-banner" role="alert">
            {error}
          </div>
        ) : null}

        {step === "prompt" ? (
          <div className="project-import-step" data-testid="project-import-prompt">
            <p className="tree-modal__summary-copy">
              Scan local metadata from Cursor, Claude and ChatGPT for projects used on this
              computer. No project files are uploaded. If an import fails, the selected monitoring
              model receives only a short failure summary. You will review every detected project
              before it is added.
            </p>
            <div className="project-import-sources" aria-label="Supported sources">
              <span>Cursor</span>
              <span>Claude</span>
              <span>ChatGPT</span>
            </div>
            <div className="tree-modal__footer">
              <div className="tree-modal__hint">
                Existing pi projects are detected and left unchanged.
              </div>
              <div className="tree-modal__actions">
                <button className="button button--secondary" type="button" onClick={onClose}>
                  Not now
                </button>
                <button
                  className="button button--primary"
                  data-import-primary="true"
                  type="button"
                  onClick={() => {
                    scanForProjects().catch((scanError: unknown) => {
                      setError(errorMessage(scanError));
                      setStep("prompt");
                    });
                  }}
                >
                  Scan projects
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {step === "scanning" ? (
          <div className="project-import-progress" role="status">
            <span className="project-import-spinner" />
            Scanning Cursor, Claude and ChatGPT metadata…
          </div>
        ) : null}

        {step === "review" && scan ? (
          <ProjectImportReview
            scan={scan}
            selectedIds={selectedIds}
            selectedModel={selectedModel}
            onSelectedModel={setSelectedModel}
            onToggle={(id) =>
              setSelectedIds((current) => {
                const next = new Set(current);
                if (!next.delete(id)) next.add(id);
                return next;
              })
            }
            onSelectAll={(selected) =>
              setSelectedIds(
                selected ? new Set(scan.candidates.map((candidate) => candidate.id)) : new Set(),
              )
            }
            onCancel={onClose}
            onImport={() => {
              importProjects().catch((importError: unknown) => {
                setError(errorMessage(importError));
                setStep("review");
              });
            }}
          />
        ) : null}

        {step === "importing" || step === "monitoring" ? (
          <div className="project-import-step">
            <div className="project-import-progress" role="status">
              <span className="project-import-spinner" />
              {step === "monitoring"
                ? "Importing complete. Asking the selected model to assess the remaining errors…"
                : `Importing ${results.length} of ${selectedCandidates.length} projects…`}
            </div>
            <ProjectImportResults results={results} />
          </div>
        ) : null}

        {step === "complete" ? (
          <div className="project-import-step" data-testid="project-import-complete">
            <h3 className="project-import-result-title">Import finished</h3>
            <ProjectImportResults results={results} />
            <div className="project-import-monitor" data-testid="project-import-monitor-result">
              <strong>AI monitor:</strong>{" "}
              {monitorResult
                ? `${monitorResult.status === "completed" ? monitorResult.action : "not available"} · ${monitorResult.message}`
                : "not needed — all selected projects imported without an intervention."}
            </div>
            <div className="tree-modal__footer">
              <div className="tree-modal__hint">
                You can run this importer again from the sidebar at any time.
              </div>
              <div className="tree-modal__actions">
                <button
                  className="button button--primary"
                  data-import-primary="true"
                  type="button"
                  onClick={onComplete}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProjectImportReview({
  scan,
  selectedIds,
  selectedModel,
  onSelectedModel,
  onToggle,
  onSelectAll,
  onCancel,
  onImport,
}: {
  readonly scan: ProjectImportScanResult;
  readonly selectedIds: ReadonlySet<string>;
  readonly selectedModel: string;
  readonly onSelectedModel: (value: string) => void;
  readonly onToggle: (id: string) => void;
  readonly onSelectAll: (selected: boolean) => void;
  readonly onCancel: () => void;
  readonly onImport: () => void;
}) {
  const allSelected = scan.candidates.length > 0 && selectedIds.size === scan.candidates.length;
  return (
    <div className="project-import-step" data-testid="project-import-review">
      <div className="project-import-source-summary">
        {scan.sources.map((source) => (
          <span key={source.source} data-detected={source.detected}>
            <strong>{sourceLabel(source.source)}</strong>{" "}
            {source.detected ? `${source.candidateCount} found` : "not found"}
          </span>
        ))}
      </div>
      <label className="project-import-model">
        <span>Model for import monitoring</span>
        <select
          aria-label="Model for import monitoring"
          data-testid="project-import-model"
          value={selectedModel}
          onChange={(event) => onSelectedModel(event.currentTarget.value)}
        >
          {scan.models.length === 0 ? (
            <option value="">No connected model — deterministic import only</option>
          ) : null}
          {scan.models.map((model) => (
            <option
              key={`${model.provider}:${model.modelId}`}
              value={`${model.provider}\u0000${model.modelId}`}
            >
              {model.provider} · {model.label}
            </option>
          ))}
        </select>
        <small>
          The model is called only if an import fails and a retry or skip decision is needed.
        </small>
      </label>
      {scan.candidates.length > 0 ? (
        <>
          <label className="project-import-select-all">
            <input
              checked={allSelected}
              type="checkbox"
              onChange={(event) => onSelectAll(event.currentTarget.checked)}
            />
            Select all projects
          </label>
          <div className="project-import-candidate-list" data-testid="project-import-candidates">
            {scan.candidates.map((candidate) => (
              <label key={candidate.id} className="project-import-candidate">
                <input
                  checked={selectedIds.has(candidate.id)}
                  type="checkbox"
                  onChange={() => onToggle(candidate.id)}
                />
                <span>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.path}</small>
                </span>
                <em>{candidate.sources.map(sourceLabel).join(" · ")}</em>
              </label>
            ))}
          </div>
        </>
      ) : (
        <div className="tree-modal__empty" data-testid="project-import-empty">
          No supported local projects were found. You can add a folder directly with the sidebar
          folder button.
        </div>
      )}
      <div className="tree-modal__footer">
        <div className="tree-modal__hint">
          {selectedIds.size} of {scan.candidates.length} projects selected.
        </div>
        <div className="tree-modal__actions">
          <button className="button button--secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="button button--primary"
            data-import-primary="true"
            disabled={selectedIds.size === 0}
            type="button"
            onClick={onImport}
          >
            Import selected
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectImportResults({
  results,
}: {
  readonly results: readonly ProjectImportItemResult[];
}) {
  if (results.length === 0) return null;
  return (
    <div className="project-import-results">
      {results.map((result) => (
        <div key={result.candidateId} data-status={result.status}>
          <span>{result.name}</span>
          <strong>{result.status.replace("-", " ")}</strong>
          {result.error ? <small>{result.error}</small> : null}
        </div>
      ))}
    </div>
  );
}

function parseModel(
  value: string,
): { readonly provider: string; readonly modelId: string } | undefined {
  const separator = value.indexOf("\u0000");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return {
    provider: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  };
}

function sourceLabel(source: ProjectImportCandidate["sources"][number]): string {
  if (source === "cursor") return "Cursor";
  if (source === "claude") return "Claude";
  return "ChatGPT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
