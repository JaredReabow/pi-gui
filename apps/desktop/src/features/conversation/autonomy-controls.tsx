import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentAutonomyPreferences, AgentAccessMode, SessionRef } from "@pi-gui/session-driver";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { decodeAgentAccessMode } from "@pi-gui/session-driver";
import { ModelSelector } from "./model-selector";
import { trapDialogFocus } from "../../ui/dialog-focus";
import { SettingsRow } from "../settings/settings-utils";
import "../../styles/conversation-model-switch.css";

const CHANGED = "pi-autonomy-changed";
const EXPLANATION =
  "Read only permits project reads; edits and commands need approval per action. Project only also permits ordinary project-file edits; commands, external access, protected paths and custom tools still need approval per action. Auto uses a reviewer AI and a project/network sandbox. Full access removes tool approvals and sandboxing, within your OS privileges. Changing permissions stops the current run. Trusted installed extensions are not sandboxed.";
export function AutonomyControls({
  target,
  runtime,
  global = false,
}: {
  target?: SessionRef;
  runtime?: RuntimeSnapshot;
  global?: boolean;
}) {
  const api = window.piApp;
  const key = JSON.stringify(target ?? null);
  const current = useRef(key);
  current.current = key;
  const [saved, setSaved] = useState<{ key: string; value: AgentAutonomyPreferences }>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<string>();
  const dialog = useRef<HTMLDivElement>(null);
  const value = saved?.key === key ? saved.value : undefined;
  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      if (!api) return;
      api
        .getAutonomyPreferences(target)
        .then((value) => {
          if (!cancelled && request === generation) {
            setSaved((previous) =>
              previous?.key === key && previous.value.revision > value.revision
                ? previous
                : { key, value },
            );
            setError(undefined);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(String(e));
        });
    };
    refresh();
    setConfirm(undefined);
    window.addEventListener(CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [api, key]);
  useEffect(() => {
    if (confirm === key)
      dialog.current?.querySelector<HTMLButtonElement>("[data-cancel-access]")?.focus();
  }, [confirm]);
  const update = async (patch: {
    mode?: AgentAccessMode;
    reviewModel?: AgentAutonomyPreferences["reviewModel"];
    confirmFullAccess?: boolean;
  }) => {
    try {
      if (!api) return;
      const next = await api.setAutonomyPreferences({ ...patch, ...(target ? { target } : {}) });
      if (current.current === key) {
        setSaved((previous) =>
          previous?.key === key && previous.value.revision > next.revision
            ? previous
            : { key, value: next },
        );
        setError(undefined);
      }
      window.dispatchEvent(new Event(CHANGED));
    } catch (e) {
      // A durable policy change can succeed even if stopping an old run fails.
      // Display the effective authority rather than reverting to a stale badge.
      try {
        const effective = await api?.getAutonomyPreferences(target);
        if (effective && current.current === key)
          setSaved((previous) =>
            previous?.key === key && previous.value.revision > effective.revision
              ? previous
              : { key, value: effective },
          );
      } catch {
        /* Keep the previous value and visible error if even the read fails. */
      }
      if (current.current === key) setError(String(e));
    }
  };
  const controls = (
    <span className="autonomy-controls" title={EXPLANATION}>
      <select
        aria-label={global ? "Default agent access" : "Access mode"}
        className="model-selector__badge"
        value={value?.mode ?? "read-only"}
        disabled={!value || (!global && !target)}
        onChange={(event) => {
          const mode = decodeAgentAccessMode(event.target.value);
          if (mode === "full-access") setConfirm(key);
          else update({ mode }).catch(console.error);
        }}
      >
        <option value="read-only">Read only</option>
        <option value="project-only">Project only</option>
        <option value="auto">Auto access</option>
        <option value="full-access">Full access</option>
      </select>
      {!global && value?.mode === "auto" ? (
        <ModelSelector
          runtime={runtime}
          provider={value.reviewModel?.provider}
          modelId={value.reviewModel?.modelId}
          thinkingLevel={undefined}
          showEmptyModelControl
          modelLabelPrefix="Approval review"
          unselectedModelLabel="Review: Same as chat"
          emptyModelLabel="Review: Same as chat"
          onFollowChat={() => {
            update({ reviewModel: null }).catch(console.error);
          }}
          onSetThinking={() => {}}
          onSetModel={(provider, modelId) => {
            update({ reviewModel: { provider, modelId } }).catch(console.error);
          }}
        />
      ) : null}
      {error ? <span role="alert">Access settings unavailable: {error}</span> : null}
      {confirm === key
        ? createPortal(
            <div className="model-switch-confirmation__backdrop">
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="access-warning-title"
                className="model-switch-confirmation"
                ref={dialog}
                tabIndex={-1}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setConfirm(undefined);
                  if (event.key === "Tab") trapDialogFocus(event, dialog.current);
                }}
              >
                <h2 id="access-warning-title">Enable full access?</h2>
                <p>
                  The AI can edit files and run commands anywhere your OS account permits, with
                  network access and no per-action approval. This can delete data, expose
                  credentials or change system settings. Installed extensions also run with your
                  account permissions.
                </p>
                <p>
                  {global
                    ? "This becomes the default for threads without an explicit access choice."
                    : "This applies to this thread and is remembered after restart."}{" "}
                  Changing access stops any current run.
                </p>
                <div className="model-switch-confirmation__actions">
                  <button
                    type="button"
                    className="button"
                    data-cancel-access
                    onClick={() => setConfirm(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => {
                      setConfirm(undefined);
                      update({ mode: "full-access", confirmFullAccess: true }).catch(console.error);
                    }}
                  >
                    Enable full access
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
  return global ? (
    <SettingsRow title="Default agent autonomy" description={EXPLANATION}>
      {controls}
    </SettingsRow>
  ) : (
    controls
  );
}
