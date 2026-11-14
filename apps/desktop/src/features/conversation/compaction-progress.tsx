import { useEffect, useId, useState } from "react";
import type { SessionCompactionProgress } from "@pi-gui/session-driver";
import { useTranslation } from "../../i18n";
import "../../styles/context-compaction.css";

export function CompactionProgress({
  progress,
  onStop,
  onRetry,
}: {
  readonly progress: SessionCompactionProgress | undefined;
  readonly onStop: () => void;
  readonly onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  const [dismissed, setDismissed] = useState(false);
  const descriptionId = useId();
  const active = progress?.phase === "summarizing" || progress?.phase === "retrying";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!progress || dismissed) return null;
  const elapsed = Math.max(0, Math.floor((now - Date.parse(progress.startedAt)) / 1000));
  const wait = progress.retry?.retryAt
    ? Math.max(0, Math.ceil((Date.parse(progress.retry.retryAt) - now) / 1000))
    : 0;
  const stage =
    progress.phase === "retrying"
      ? progress.retry
        ? t("compaction.retryScheduled", {
            attempt: progress.retry.attempt,
            total: progress.retry.maxAttempts,
          })
        : t("compaction.waiting")
      : progress.phase === "failed"
        ? t("compaction.failed")
        : progress.phase === "stopped"
          ? t("compaction.stopped")
          : progress.retry
            ? t("compaction.retryRunning", {
                attempt: progress.retry.attempt,
                total: progress.retry.maxAttempts,
              })
            : t("compaction.running");
  return (
    <section
      className="compaction-progress"
      data-phase={progress.phase}
      data-testid="compaction-progress"
      aria-label={t("compaction.title")}
    >
      <div className="compaction-progress__header">
        <p role="status" aria-live="polite">
          {stage}
        </p>
        {active ? (
          <button type="button" className="text-button" onClick={onStop}>
            {t("compaction.stop")}
          </button>
        ) : (
          <button type="button" className="text-button" onClick={() => setDismissed(true)}>
            {t("compaction.dismiss")}
          </button>
        )}
      </div>
      {active ? (
        <div
          className="compaction-progress__bar"
          role="progressbar"
          aria-label={t("compaction.title")}
          aria-valuetext={stage}
          aria-describedby={descriptionId}
        />
      ) : null}
      <p className="compaction-progress__detail" id={descriptionId}>
        {active ? t("compaction.draftKept") : t("compaction.historyKept")}
      </p>
      {active ? (
        <small aria-live="off">
          {t("compaction.elapsed", { seconds: elapsed })}
          {progress.phase === "retrying" ? ` · ${t("compaction.retryIn", { seconds: wait })}` : ""}
        </small>
      ) : null}
      {progress.request ? (
        <small data-testid="compaction-request-mode">
          {t("compaction.request", {
            model: `${progress.request.provider}/${progress.request.modelId}`,
            api: progress.request.api,
            thinking: progress.request.thinkingLevel,
          })}
        </small>
      ) : null}
      {!active && onRetry ? (
        <button className="text-button" type="button" onClick={onRetry}>
          {t("compaction.retry")}
        </button>
      ) : null}
      {progress.errorMessage ? (
        <details className="compaction-progress__error">
          <summary>{t("compaction.details")}</summary>
          <p>{progress.errorMessage}</p>
        </details>
      ) : null}
    </section>
  );
}
