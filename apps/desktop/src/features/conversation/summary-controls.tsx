import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDisplayTimelineItems } from "./timeline-turns";
import type { TimelineTranscriptItem } from "../../../contracts/timeline-types";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type { SummaryPreferences, SummaryTarget } from "../../../contracts/work-summaries";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { ModelSelector } from "./model-selector";
import { SettingsSwitch } from "../settings/settings-controls";
import { SettingsRow } from "../settings/settings-utils";

export function useSummaryTimeline({
  api,
  target,
  transcript,
  chatModelKey,
  session,
  ...options
}: {
  api: PiDesktopApi | undefined;
  target: SummaryTarget | undefined;
  transcript: readonly TimelineTranscriptItem[];
  chatModelKey: string;
  session?: { readonly status: string; readonly runningSince?: string };
} & NonNullable<Parameters<typeof buildDisplayTimelineItems>[1]>) {
  const { preferences } = useSummaryPreferences(api, target);
  const summaryModelKey = JSON.stringify(preferences.model ?? chatModelKey);
  const running = session?.status === "running";
  const runningSince = running ? session?.runningSince : undefined;
  const changes = options?.turnChanges;
  return useMemo(
    () =>
      buildDisplayTimelineItems(transcript, {
        lastTurnRunning: running,
        runningSince,
        turnChanges: changes,
        summaryTarget: preferences.enabled ? target : undefined,
        summaryModelKey,
      }),
    [transcript, running, runningSince, changes, preferences.enabled, target, summaryModelKey],
  );
}

const CHANGED = "pi-summary-preferences-changed";
export function useSummaryPreferences(api: PiDesktopApi | undefined, target?: SummaryTarget) {
  const key = JSON.stringify(target ?? null);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [saved, setSaved] = useState<{ key: string; value: SummaryPreferences }>();
  const preferences: SummaryPreferences =
    saved?.key === key ? saved.value : { enabled: false, model: null };
  const [error, setError] = useState<string>();
  const workspaceId = target?.workspaceId;
  const sessionId = target?.sessionId;
  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      if (!api) return;
      void api
        .getSummaryPreferences(workspaceId && sessionId ? { workspaceId, sessionId } : undefined)
        .then((value) => {
          if (!cancelled && request === generation) {
            setSaved({ key, value });
            setError(undefined);
          }
        })
        .catch((reason: unknown) => {
          if (!cancelled && request === generation) setError(String(reason));
        });
    };
    refresh();
    window.addEventListener(CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [api, workspaceId, sessionId, key]);
  const update = useCallback(
    async (patch: { enabled?: boolean; model?: SummaryPreferences["model"] }) => {
      try {
        if (!api) return;
        const value = await api.setSummaryPreferences({
          ...patch,
          ...(workspaceId && sessionId ? { target: { workspaceId, sessionId } } : {}),
        });
        if (currentKey.current === key) {
          setSaved({ key, value });
          setError(undefined);
        }
        window.dispatchEvent(new Event(CHANGED));
      } catch (reason) {
        if (currentKey.current === key) setError(String(reason));
      }
    },
    [api, workspaceId, sessionId, key],
  );
  return { preferences, update, error, ready: saved?.key === key };
}

export function SummarySettingsRow({ api }: { api: PiDesktopApi | undefined }) {
  const { preferences, update, error } = useSummaryPreferences(api);
  return (
    <SettingsRow
      title="AI work summaries"
      description="Collapse completed work into an AI-generated summary. Uses the thread’s Summary model and may incur provider usage. Does not disable context compaction."
    >
      <SettingsSwitch
        label="AI work summaries"
        checked={preferences.enabled}
        onChange={(enabled) => {
          update({ enabled }).catch(console.error);
        }}
      />
      {error ? <span role="alert">{error}</span> : null}
    </SettingsRow>
  );
}

export function SummaryModelSelector({
  api,
  target,
  runtime,
}: {
  api: PiDesktopApi | undefined;
  target?: SummaryTarget;
  runtime?: RuntimeSnapshot;
}) {
  const { preferences, update, error, ready } = useSummaryPreferences(api, target);
  return (
    <span title={error ?? "Model for work summaries and context compaction"}>
      <ModelSelector
        runtime={runtime}
        provider={preferences.model?.provider}
        modelId={preferences.model?.modelId}
        thinkingLevel={undefined}
        disabled={!target || !ready}
        showEmptyModelControl
        unselectedModelLabel="Summary: Same as chat"
        emptyModelLabel="Summary: Same as chat"
        modelLabelPrefix="Summary"
        onFollowChat={() => {
          update({ model: null }).catch(console.error);
        }}
        onSetModel={(provider, modelId) => {
          update({ model: { provider, modelId } }).catch(console.error);
        }}
        onSetThinking={() => {}}
      />
      {error ? <span role="alert">Summary model unavailable</span> : null}
    </span>
  );
}
