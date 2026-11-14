import { useEffect, useRef, useState } from "react";
import { defaultCompletionChimePreferences } from "../../../contracts/completion-chime";
import { useTranslation } from "../../i18n";
import { BellIcon } from "../../ui/icons";

export function ChimeToggle() {
  const { t } = useTranslation();
  const api = window.piApp;
  const [enabled, setEnabled] = useState(defaultCompletionChimePreferences.chimeEnabled);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const revision = useRef(-1);
  useEffect(() => {
    if (!api) return;
    let live = true;
    const apply = (state: {
      revision: number;
      notificationPreferences: { chimeEnabled: boolean };
    }) => {
      if (!live || state.revision < revision.current) return;
      revision.current = state.revision;
      setEnabled(state.notificationPreferences.chimeEnabled);
      setReady(true);
    };
    const unsubscribe = api.onStateChanged(apply);
    void api
      .getState()
      .then(apply)
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [api]);
  const label = t(enabled ? "settings.chime.mute" : "settings.chime.unmute");
  return (
    <span className="chime-toggle">
      <button
        aria-label={label}
        aria-pressed={enabled}
        className="icon-button composer__chime"
        title={label}
        disabled={!ready || pending}
        type="button"
        onClick={() => {
          if (!api) return;
          setPending(true);
          setFailed(false);
          void api
            .setNotificationPreferences({ chimeEnabled: !enabled })
            .catch(() => setFailed(true))
            .finally(() => setPending(false));
        }}
      >
        <BellIcon muted={!enabled} />
      </button>
      {failed ? (
        <span className="chime-toggle__error" role="alert">
          {t("settings.chime.saveError")}
        </span>
      ) : null}
    </span>
  );
}
