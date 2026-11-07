import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ModelSettingsScopeMode } from "../../../contracts/desktop-state";
import type { ActivityIndicatorStyle } from "../../../contracts/sidebar-preferences";
import { useTranslation, type MessageKey } from "../../i18n";
import { ActivityIndicator } from "../../ui/activity-indicator";
import { SettingsSegmented, SettingsSelect, SettingsSwitch } from "./settings-controls";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import { SummarySettingsRow } from "../conversation/summary-controls";

interface SettingsGeneralSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly activityIndicatorStyle: ActivityIndicatorStyle;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onSetActivityIndicatorStyle: (style: ActivityIndicatorStyle) => void;
}

const ACTIVITY_INDICATOR_OPTIONS: readonly {
  readonly value: ActivityIndicatorStyle;
  readonly label: MessageKey;
}[] = [
  { value: "moonwalk", label: "settings.general.activityIndicator.moonwalk" },
  { value: "stick", label: "settings.general.activityIndicator.stick" },
  { value: "wheel", label: "settings.general.activityIndicator.wheel" },
  { value: "ball", label: "settings.general.activityIndicator.ball" },
  { value: "wave", label: "settings.general.activityIndicator.wave" },
  { value: "spiral", label: "settings.general.activityIndicator.spiral" },
];

export function SettingsGeneralSection({
  runtime,
  modelSettingsScopeMode,
  integratedTerminalShell,
  activityIndicatorStyle,
  onSetModelSettingsScopeMode,
  onSetIntegratedTerminalShell,
  onToggleSkillCommands,
  onSetActivityIndicatorStyle,
}: SettingsGeneralSectionProps) {
  const { t } = useTranslation();
  const [terminalShellDraft, setTerminalShellDraft] = useState(integratedTerminalShell);

  useEffect(() => {
    setTerminalShellDraft(integratedTerminalShell);
  }, [integratedTerminalShell]);

  const commitTerminalShellDraft = () => {
    if (terminalShellDraft !== integratedTerminalShell) {
      onSetIntegratedTerminalShell(terminalShellDraft);
    }
  };

  return (
    <>
      <SettingsGroup title={t("settings.general.groupAgent")}>
        <SummarySettingsRow api={window.piApp} />
        <SettingsRow
          title={t("settings.general.modelScope.title")}
          description={t("settings.general.modelScope.description")}
        >
          <SettingsSegmented
            label={t("settings.general.modelScope.label")}
            options={[
              { value: "app-global", label: t("settings.general.modelScope.appGlobal") },
              { value: "per-repo", label: t("settings.general.modelScope.perRepo") },
            ]}
            value={modelSettingsScopeMode}
            onChange={onSetModelSettingsScopeMode}
          />
        </SettingsRow>
        <SettingsRow
          title={t("settings.general.skillCommands.title")}
          description={t("settings.general.skillCommands.description")}
        >
          <SettingsSwitch
            checked={runtime?.settings.enableSkillCommands ?? true}
            label={t("settings.general.skillCommands.label")}
            onChange={onToggleSkillCommands}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.general.groupRuntime")}>
        <SettingsRow
          title={t("settings.general.activityIndicator.title")}
          description={t("settings.general.activityIndicator.description")}
        >
          <span className="settings-activity-control">
            <SettingsSelect
              label={t("settings.general.activityIndicator.label")}
              options={ACTIVITY_INDICATOR_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.label),
              }))}
              value={activityIndicatorStyle}
              onChange={onSetActivityIndicatorStyle}
            />
            <ActivityIndicator style={activityIndicatorStyle} />
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.general.groupTerminal")}>
        <SettingsRow
          title={t("settings.general.shell.title")}
          description={t("settings.general.shell.description")}
        >
          <input
            aria-label={t("settings.general.shell.label")}
            className="settings-text-input"
            placeholder="/bin/zsh"
            spellCheck={false}
            type="text"
            value={terminalShellDraft}
            onBlur={commitTerminalShellDraft}
            onChange={(event) => setTerminalShellDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
