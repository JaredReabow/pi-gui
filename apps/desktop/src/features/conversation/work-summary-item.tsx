import { useEffect, useState, type ReactNode } from "react";
import type { TimelineWorkSummary } from "../../../contracts/timeline-types";
import type { WorkSummaryResult } from "../../../contracts/work-summaries";
import { ChevronRightIcon, SparkIcon } from "../../ui/icons";
import "../../styles/work-summaries.css";

export function WorkSummaryItem({
  item,
  expanded,
  onToggle,
  renderItem,
}: {
  item: TimelineWorkSummary;
  expanded: boolean;
  onToggle?: (id: string) => void;
  renderItem: (entry: TimelineWorkSummary["items"][number]) => ReactNode;
}) {
  const [result, setResult] = useState<WorkSummaryResult>();
  const [requested, setRequested] = useState(item.autoGenerate);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  // A content revision or model switch invalidates the view. Host fingerprints
  // include full content and model and return persisted results without inference.
  const contentKey = JSON.stringify(item.items);
  useEffect(() => {
    let cancelled = false;
    setResult(undefined);
    setLoading(requested);
    if (requested && window.piApp) {
      void window.piApp
        .summarizeTurn({ target: item.target, promptId: item.promptId, retry: attempt > 0 })
        .then((value) => {
          if (!cancelled) {
            setResult(value);
            setLoading(false);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setResult({ error: String(error) });
            setLoading(false);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [
    item.target.workspaceId,
    item.target.sessionId,
    item.promptId,
    item.prompt,
    item.modelKey,
    contentKey,
    requested,
    attempt,
  ]);
  const tools = item.items.filter((entry) => entry.kind === "tool");
  const failed = tools.filter((entry) => entry.status === "error").length;
  const label =
    result?.text ??
    (loading
      ? "Summarizing work…"
      : result?.error
        ? `AI summary unavailable — ${result.error.split("\n")[0]}`
        : "Completed work — expand for details");
  return (
    <section
      className="timeline-tool-group timeline-work-summary"
      data-testid="timeline-work-summary"
    >
      <button
        type="button"
        className="timeline-tool-group__header timeline-work-summary__header"
        aria-expanded={expanded}
        title={result?.error}
        onClick={() => onToggle?.(item.id)}
      >
        <span
          className={`timeline-tool-group__chevron ${expanded ? "timeline-tool-group__chevron--expanded" : ""}`}
        >
          <ChevronRightIcon />
        </span>
        <span className="timeline-tool-group__glyph">
          <SparkIcon />
        </span>
        <span className="timeline-work-summary__text" data-testid="work-summary-text">
          {label}
        </span>
        <span className="timeline-tool-group__metadata">
          {tools.length} actions{failed ? ` · ${failed} failed` : ""}
        </span>
      </button>
      {result?.truncated ? (
        <small className="timeline-work-summary__note">
          Summary based on bounded excerpts of this turn.
        </small>
      ) : null}
      {result?.error && !loading ? (
        <button
          type="button"
          className="timeline-work-summary__generate"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry AI summary
        </button>
      ) : null}
      {!requested ? (
        <button
          type="button"
          className="timeline-work-summary__generate"
          onClick={() => setRequested(true)}
        >
          Generate AI summary
        </button>
      ) : null}
      {expanded ? (
        <div className="timeline-tool-group__body">
          {result?.usage ? (
            <small>
              Summary usage: {result.usage.totalTokens.toLocaleString()} tokens · $
              {result.usage.cost.toFixed(4)}
            </small>
          ) : null}
          {result?.model ? (
            <small>
              Summary model: {result.model.provider}/{result.model.modelId}
            </small>
          ) : null}
          {result?.request ? (
            <small data-testid="work-summary-request-mode">
              Summary API: {result.request.api} · Reasoning: {result.request.thinkingLevel}
            </small>
          ) : null}
          {result?.error ? (
            <p role="status" data-testid="work-summary-error">
              {result.error}
            </p>
          ) : null}
          {item.items.map((entry) => (
            <div key={entry.id}>{renderItem(entry)}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
