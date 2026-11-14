import { useEffect, useRef, useState } from "react";
import { completionChimeSounds } from "../../../contracts/completion-chime";
import type { NotificationPreferences } from "../../../contracts/desktop-state";
import { useTranslation } from "../../i18n";
import { SettingsSelect, SettingsSwitch } from "../settings/settings-controls";
import { SettingsGroup, SettingsRow } from "../settings/settings-utils";
import { playCompletionChime } from "./chime-player";

export function ChimeSettings({
  preferences,
  onChange,
}: {
  readonly preferences: NotificationPreferences;
  readonly onChange: (input: Partial<NotificationPreferences>) => void;
}) {
  const { t } = useTranslation();
  const [volume, setVolume] = useState(preferences.chimeVolume);
  const [failed, setFailed] = useState(false);
  const editing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    if (!editing.current) setVolume(preferences.chimeVolume);
  }, [preferences.chimeVolume]);
  const saveVolume = (value: number) => {
    if (value !== preferences.chimeVolume) onChange({ chimeVolume: value });
  };
  return (
    <SettingsGroup title={t("settings.chime.title")} description={t("settings.chime.description")}>
      <SettingsRow
        title={t("settings.chime.enabled")}
        description={t("settings.chime.enabledDescription")}
      >
        <SettingsSwitch
          label={t("settings.chime.enabled")}
          checked={preferences.chimeEnabled}
          onChange={(chimeEnabled) => onChange({ chimeEnabled })}
        />
      </SettingsRow>
      <SettingsRow
        title={t("settings.chime.sound")}
        description={t("settings.chime.soundDescription")}
      >
        <div className="chime-settings__sound">
          <SettingsSelect
            label={t("settings.chime.sound")}
            value={preferences.chimeSound}
            options={completionChimeSounds.map((sound) => ({
              value: sound.id,
              label: `${t(`settings.chime.sound.${sound.id}`)} · ${t(`settings.chime.intensity.${sound.intensity}`)}`,
            }))}
            onChange={(chimeSound) => {
              setFailed(false);
              onChange({ chimeSound });
            }}
          />
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setFailed(false);
              void playCompletionChime({ sound: preferences.chimeSound, volume }).catch(() =>
                setFailed(true),
              );
            }}
          >
            {t("settings.chime.preview")}
          </button>
        </div>
      </SettingsRow>
      <SettingsRow
        title={t("settings.chime.volume")}
        description={t("settings.chime.volumeDescription")}
      >
        <label className="chime-settings__volume">
          <input
            aria-label={t("settings.chime.volume")}
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(event) => {
              dirty.current = true;
              setVolume(Number(event.currentTarget.value));
            }}
            onPointerUp={(event) => {
              if (dirty.current) saveVolume(Number(event.currentTarget.value));
            }}
            onBlur={(event) => {
              editing.current = false;
              if (dirty.current) saveVolume(Number(event.currentTarget.value));
              else setVolume(preferences.chimeVolume);
              dirty.current = false;
            }}
          />
          <output>{volume}%</output>
        </label>
      </SettingsRow>
      {failed ? <p role="alert">{t("settings.chime.playError")}</p> : null}
    </SettingsGroup>
  );
}
