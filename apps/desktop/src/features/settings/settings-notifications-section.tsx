import type { DesktopNotificationPermissionStatus } from "../../../contracts/ipc";
import type { NotificationPreferences } from "../../../contracts/desktop-state";
import { useTranslation, type Translate } from "../../i18n";
import { SettingsSwitch } from "./settings-controls";
import { ChimeSettings } from "../notifications/chime-settings";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsNotificationsSectionProps {
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
}

export function SettingsNotificationsSection({
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  onSetNotificationPreferences,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
}: SettingsNotificationsSectionProps) {
  const { t } = useTranslation();
  const mac = window.piApp?.platform === "darwin";
  const statusLabel = labelForPermissionStatus(t, notificationPermissionStatus);
  const statusDescription = descriptionForPermissionStatus(t, notificationPermissionStatus, mac);
  const showAskMacOs = notificationPermissionStatus === "default";
  const showOpenSystemSettings = notificationPermissionStatus === "denied";
  const showRecoveryActions = showAskMacOs || showOpenSystemSettings;

  return (
    <>
      <ChimeSettings
        preferences={notificationPreferences}
        onChange={onSetNotificationPreferences}
      />
      <SettingsGroup
        title={t("settings.notifications.groupSystem")}
        description={t(
          mac
            ? "settings.notifications.groupSystem.description"
            : "settings.notifications.system.description",
        )}
      >
        <SettingsRow
          title={t(
            mac ? "settings.notifications.access.title" : "settings.notifications.system.access",
          )}
          description={statusDescription}
        >
          <span className="settings-row__value">{statusLabel}</span>
        </SettingsRow>
        {showRecoveryActions ? (
          <SettingsRow
            title={t("settings.notifications.turnOn.title")}
            description={
              showAskMacOs
                ? t(
                    mac
                      ? "settings.notifications.turnOn.descriptionAsk"
                      : "settings.notifications.system.requestDescription",
                  )
                : t(
                    mac
                      ? "settings.notifications.turnOn.descriptionOpen"
                      : "settings.notifications.system.openDescription",
                  )
            }
          >
            <div className="settings-row__actions">
              {showAskMacOs ? (
                <button
                  className="button button--secondary"
                  disabled={notificationPermissionPending}
                  type="button"
                  onClick={onRequestNotificationPermission}
                >
                  {t(
                    mac
                      ? "settings.notifications.turnOn.ask"
                      : "settings.notifications.system.request",
                  )}
                </button>
              ) : null}
              {showOpenSystemSettings ? (
                <button
                  className="button button--secondary"
                  disabled={notificationPermissionPending}
                  type="button"
                  onClick={onOpenSystemNotificationSettings}
                >
                  {t("settings.notifications.turnOn.openSettings")}
                </button>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.notifications.groupInApp")}
        description={t(
          mac
            ? "settings.notifications.groupInApp.description"
            : "settings.notifications.system.alertDescription",
        )}
      >
        <SettingsRow
          title={t("settings.notifications.completion.title")}
          description={t("settings.notifications.completion.description")}
        >
          <SettingsSwitch
            checked={notificationPreferences.backgroundCompletion}
            label={t("settings.notifications.completion.title")}
            onChange={(checked) => onSetNotificationPreferences({ backgroundCompletion: checked })}
          />
        </SettingsRow>
        <SettingsRow
          title={t("settings.notifications.failures.title")}
          description={t("settings.notifications.failures.description")}
        >
          <SettingsSwitch
            checked={notificationPreferences.backgroundFailure}
            label={t("settings.notifications.failures.title")}
            onChange={(checked) => onSetNotificationPreferences({ backgroundFailure: checked })}
          />
        </SettingsRow>
        <SettingsRow
          title={t("settings.notifications.attention.title")}
          description={t("settings.notifications.attention.description")}
        >
          <SettingsSwitch
            checked={notificationPreferences.attentionNeeded}
            label={t("settings.notifications.attention.title")}
            onChange={(checked) => onSetNotificationPreferences({ attentionNeeded: checked })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function labelForPermissionStatus(
  t: Translate,
  status: DesktopNotificationPermissionStatus,
): string {
  switch (status) {
    case "granted":
      return t("settings.notifications.access.enabled");
    case "denied":
      return t("settings.notifications.access.turnedOff");
    case "default":
      return t("settings.notifications.access.notEnabled");
    case "unsupported":
      return t("settings.notifications.access.unavailable");
    default:
      return t("settings.notifications.access.checking");
  }
}

function descriptionForPermissionStatus(
  t: Translate,
  status: DesktopNotificationPermissionStatus,
  mac: boolean,
): string {
  switch (status) {
    case "granted":
      return t(
        mac
          ? "settings.notifications.access.descriptionGranted"
          : "settings.notifications.system.granted",
      );
    case "denied":
      return t(
        mac
          ? "settings.notifications.access.descriptionDenied"
          : "settings.notifications.system.denied",
      );
    case "default":
      return t(
        mac
          ? "settings.notifications.access.descriptionDefault"
          : "settings.notifications.system.default",
      );
    case "unsupported":
      return t("settings.notifications.access.descriptionUnsupported");
    default:
      return t(
        mac
          ? "settings.notifications.access.descriptionChecking"
          : "settings.notifications.system.checking",
      );
  }
}
