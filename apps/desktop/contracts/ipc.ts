import type { AutonomyUpdate } from "./autonomy";
import type { AgentAutonomyPreferences } from "@pi-gui/session-driver";
import type {
  SummaryTarget,
  SummaryPreferenceUpdate,
  SummaryPreferences,
  WorkSummaryRequest,
  WorkSummaryResult,
} from "./work-summaries";
import type { EffectiveChildModelSettings } from "./child-selection";
import type {
  ActivityIndicatorStyle,
  FolderPreference,
  AllThreadsSort,
  MarkAllThreadsReadInput,
} from "./sidebar-preferences";
import type {
  ExtensionViewOpenFile,
  DesktopExtensionViewInfo,
  OpenExtensionViewInput,
  ExtensionViewConnection,
  ExtensionViewMessage,
  ExtensionViewCatalogChange,
} from "./extension-views";
import type { RuntimeSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionActionEffect, ExtensionActionRequest } from "./extension-actions";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type { ClipboardImageRead } from "./composer-attachments";
import type { DesktopEditorList } from "./editors";
import type { SessionRef } from "@pi-gui/session-driver/types";
import {
  telemetryConsent_decodeRequest,
  telemetryConsent_decodeStatus,
  type TelemetryConsentRequest,
  type TelemetryConsentStatusSnapshot,
} from "./telemetry-consent";
import type { SaveTaskWorkbenchTemplateInput, TaskWorkbenchTemplate } from "./workbench";
import type { SetProjectAccentColorInput } from "./project-identity";
import type {
  ProjectImportMonitorRequest,
  ProjectImportMonitorResult,
  ProjectImportScanResult,
} from "./project-import";
import type {
  TurnChangesInput,
  TurnChangesResult,
  GetReviewInput,
  ReviewResult,
  ReviewFileInput,
  ReviewFileResult,
  SetReviewFileReviewedInput,
  SetReviewFileReviewedResult,
  ChangeReviewFileStageInput,
  ChangeReviewFileStageResult,
} from "./review";
import type {
  AppView,
  ComposerAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  DesktopAppState,
  ForkThreadInput,
  ModelSettingsScopeMode,
  NotificationPreferences,
  RemoveWorktreeInput,
  SendChildThreadFollowUpInput,
  SetChildSupervisionLoopInput,
  SelectedTranscriptPatch,
  SelectedTranscriptRecord,
  SessionExtensionUiUpdate,
  StartThreadInput,
  ThemePresetId,
  ThreadGrouping,
  WorkspaceSessionTarget,
  CreateScheduledTaskInput,
  UpdateScheduledTaskInput,
} from "./desktop-state";
import {
  lifecycle_decodeDraftFlushOutcome,
  lifecycle_decodeRequestKey,
  type DraftFlushExpectation,
  type DraftFlushOutcome,
  type LifecycleRequestKey,
} from "./lifecycle";

export type DesktopNotificationPermissionStatus =
  "granted" | "denied" | "default" | "unsupported" | "unknown";

export interface CustomProviderModelConfig {
  readonly id: string;
  readonly contextWindow?: number;
}

export interface CustomProviderConfig {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly models: readonly CustomProviderModelConfig[];
}

export interface CustomProviderProbeInput {
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export type CustomProviderProbeResult =
  | { readonly ok: true; readonly models: readonly string[] }
  | { readonly ok: false; readonly error: string };

export type McpServerScope = "global" | "project";

/** An `mcp.json` server as Settings shows it; `env`, `headers` and `oauth` never leave main. */
export interface McpServerRecord {
  readonly name: string;
  readonly scope: McpServerScope;
  readonly transport: "stdio" | "http";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  /** What the server offers, in a sentence; pi shows it to the model with the server. */
  readonly description?: string;
  readonly enabled: boolean;
  /** Environment variables, headers or sign-in config are set; their values never leave main. */
  readonly hasHiddenSettings: boolean;
}

export interface McpServersSnapshot {
  /** The global mcp.json new servers are saved to, with the home directory shown as `~`. */
  readonly globalConfigPath: string;
  readonly servers: readonly McpServerRecord[];
  /** mcp.json files that could not be read, and servers pi skips, with why. */
  readonly errors: readonly string[];
  /** Whether pi's global `defaultTools` switches code mode on. */
  readonly codemodeAlwaysOn: boolean;
}

export type NewMcpServerInput = { readonly name: string; readonly description?: string } & (
  { readonly command: string; readonly args: readonly string[] } | { readonly url: string }
);

export const desktopIpc = {
  extensionViewOpenFile: "pi-gui:extension-view-open-file",
  listExtensionViews: "pi-gui:list-extension-views",
  openExtensionView: "pi-gui:open-extension-view",
  sendExtensionViewMessage: "pi-gui:send-extension-view-message",
  closeExtensionView: "pi-gui:close-extension-view",
  runExtensionAction: "pi-gui:run-extension-action",
  extensionViewMessage: "pi-gui:extension-view-message",
  extensionViewCatalogChanged: "pi-gui:extension-view-catalog-changed",
  stateRequest: "pi-gui:state-request",
  stateChanged: "pi-gui:state-changed",
  getTaskWorkbenchTemplate: "pi-gui:get-task-workbench-template",
  saveTaskWorkbenchTemplate: "pi-gui:save-task-workbench-template",
  selectedTranscriptRequest: "pi-gui:selected-transcript-request",
  selectedTranscriptChanged: "pi-gui:selected-transcript-changed",
  selectedTranscriptResend: "pi-gui:selected-transcript-resend",
  extensionUiChanged: "pi-gui:extension-ui-changed",
  appCommand: "pi-gui:app-command",
  workspacePicked: "pi-gui:workspace-picked",
  clipboardImagePasted: "pi-gui:clipboard-image-pasted",
  addWorkspacePath: "pi-gui:add-workspace-path",
  scanProjectImports: "pi-gui:scan-project-imports",
  monitorProjectImport: "pi-gui:monitor-project-import",
  pickWorkspace: "pi-gui:pick-workspace",
  selectWorkspace: "pi-gui:select-workspace",
  renameWorkspace: "pi-gui:rename-workspace",
  removeWorkspace: "pi-gui:remove-workspace",
  reorderWorkspaces: "pi-gui:reorder-workspaces",
  reorderPinnedSessions: "pi-gui:reorder-pinned-sessions",
  openWorkspaceInFinder: "pi-gui:open-workspace-in-finder",
  listEditors: "pi-gui:list-editors",
  setPreferredEditor: "pi-gui:set-preferred-editor",
  openWorkspaceInEditor: "pi-gui:open-workspace-in-editor",
  createWorktree: "pi-gui:create-worktree",
  removeWorktree: "pi-gui:remove-worktree",
  openSkillInFinder: "pi-gui:open-skill-in-finder",
  openExtensionInFinder: "pi-gui:open-extension-in-finder",
  syncCurrentWorkspace: "pi-gui:sync-current-workspace",
  selectSession: "pi-gui:select-session",
  renameSession: "pi-gui:rename-session",
  editTranscriptMessage: "pi-gui:edit-transcript-message",
  deleteTranscriptMessage: "pi-gui:delete-transcript-message",
  archiveSession: "pi-gui:archive-session",
  unarchiveSession: "pi-gui:unarchive-session",
  markSessionRead: "pi-gui:mark-session-read",
  markAllThreadsRead: "pi-gui:mark-all-threads-read",
  setFolderPreference: "pi-gui:set-folder-preference",
  setAllThreadsSort: "pi-gui:set-all-threads-sort",
  setProjectAccentColor: "pi-gui:set-project-accent-color",
  setActivityIndicatorStyle: "pi-gui:set-activity-indicator-style",
  getEffectiveChildModelSettings: "pi-gui:get-effective-child-model-settings",
  setSessionPinned: "pi-gui:set-session-pinned",
  createSession: "pi-gui:create-session",
  startThread: "pi-gui:start-thread",
  forkThread: "pi-gui:fork-thread",
  sendChildThreadFollowUp: "pi-gui:send-child-thread-follow-up",
  setChildSupervisionLoop: "pi-gui:set-child-supervision-loop",
  createScheduledTask: "pi-gui:create-scheduled-task",
  updateScheduledTask: "pi-gui:update-scheduled-task",
  deleteScheduledTask: "pi-gui:delete-scheduled-task",
  beginScheduledTaskInterview: "pi-gui:begin-scheduled-task-interview",
  cancelCurrentRun: "pi-gui:cancel-current-run",
  setActiveView: "pi-gui:set-active-view",
  setSidebarCollapsed: "pi-gui:set-sidebar-collapsed",
  setThreadGrouping: "pi-gui:set-thread-grouping",
  setWorkspaceCollapsed: "pi-gui:set-workspace-collapsed",
  refreshRuntime: "pi-gui:refresh-runtime",
  setModelSettingsScopeMode: "pi-gui:set-model-settings-scope-mode",
  setDefaultModel: "pi-gui:set-default-model",
  setDefaultThinkingLevel: "pi-gui:set-default-thinking-level",
  getAutonomyPreferences: "pi-gui:get-autonomy-preferences",
  setAutonomyPreferences: "pi-gui:set-autonomy-preferences",
  getSummaryPreferences: "pi-gui:get-summary-preferences",
  setSummaryPreferences: "pi-gui:set-summary-preferences",
  summarizeTurn: "pi-gui:summarize-turn",
  setSessionModel: "pi-gui:set-session-model",
  setSessionThinkingLevel: "pi-gui:set-session-thinking-level",
  loginProvider: "pi-gui:login-provider",
  logoutProvider: "pi-gui:logout-provider",
  setProviderApiKey: "pi-gui:set-provider-api-key",
  listCustomProviders: "pi-gui:list-custom-providers",
  setCustomProvider: "pi-gui:set-custom-provider",
  deleteCustomProvider: "pi-gui:delete-custom-provider",
  probeCustomProviderModels: "pi-gui:probe-custom-provider-models",
  setEnableSkillCommands: "pi-gui:set-enable-skill-commands",
  setScopedModelPatterns: "pi-gui:set-scoped-model-patterns",
  setSkillEnabled: "pi-gui:set-skill-enabled",
  setExtensionEnabled: "pi-gui:set-extension-enabled",
  listMcpServers: "pi-gui:list-mcp-servers",
  addMcpServer: "pi-gui:add-mcp-server",
  removeMcpServer: "pi-gui:remove-mcp-server",
  setMcpServerEnabled: "pi-gui:set-mcp-server-enabled",
  setCodemodeAlwaysOn: "pi-gui:set-codemode-always-on",
  respondToHostUiRequest: "pi-gui:respond-to-host-ui-request",
  setNotificationPreferences: "pi-gui:set-notification-preferences",
  setIntegratedTerminalShell: "pi-gui:set-integrated-terminal-shell",
  setEnableTransparency: "pi-gui:set-enable-transparency",
  terminalEnsurePanel: "pi-gui:terminal-ensure-panel",
  terminalCreateSession: "pi-gui:terminal-create-session",
  terminalSetActiveSession: "pi-gui:terminal-set-active-session",
  terminalWrite: "pi-gui:terminal-write",
  terminalResize: "pi-gui:terminal-resize",
  terminalRestartSession: "pi-gui:terminal-restart-session",
  terminalCloseSession: "pi-gui:terminal-close-session",
  terminalSetTitle: "pi-gui:terminal-set-title",
  terminalSetFocused: "pi-gui:terminal-set-focused",
  sidePanelSetFocused: "pi-gui:side-panel-set-focused",
  terminalData: "pi-gui:terminal-data",
  terminalExit: "pi-gui:terminal-exit",
  terminalError: "pi-gui:terminal-error",
  getNotificationPermissionStatus: "pi-gui:get-notification-permission-status",
  requestNotificationPermission: "pi-gui:request-notification-permission",
  openSystemNotificationSettings: "pi-gui:open-system-notification-settings",
  notificationPermissionStatusChanged: "pi-gui:notification-permission-status-changed",
  pickComposerAttachments: "pi-gui:pick-composer-attachments",
  readClipboardImage: "pi-gui:read-clipboard-image",
  addComposerAttachments: "pi-gui:add-composer-attachments",
  removeComposerAttachment: "pi-gui:remove-composer-attachment",
  editQueuedComposerMessage: "pi-gui:edit-queued-composer-message",
  cancelQueuedComposerEdit: "pi-gui:cancel-queued-composer-edit",
  removeQueuedComposerMessage: "pi-gui:remove-queued-composer-message",
  steerQueuedComposerMessage: "pi-gui:steer-queued-composer-message",
  persistComposerDraft: "pi-gui:persist-composer-draft",
  updateComposerDraft: "pi-gui:update-composer-draft",
  flushPendingComposerDraft: "pi-gui:flush-pending-composer-draft",
  pendingComposerDraftFlushed: "pi-gui:pending-composer-draft-flushed",
  capturePendingComposerDraft: "pi-gui:capture-pending-composer-draft",
  pendingComposerDraftCaptured: "pi-gui:pending-composer-draft-captured",
  flushPendingComposerDraftResult: "pi-gui:flush-pending-composer-draft-result",
  pendingComposerDraftFlushedResult: "pi-gui:pending-composer-draft-flushed-result",
  submitComposer: "pi-gui:submit-composer",
  getSessionTree: "pi-gui:get-session-tree",
  navigateSessionTree: "pi-gui:navigate-session-tree",
  toggleWindowMaximize: "pi-gui:toggle-window-maximize",
  minimizeWindow: "pi-gui:minimize-window",
  closeWindow: "pi-gui:close-window",
  listWorkspaceFiles: "pi-gui:list-workspace-files",
  readWorkspaceFile: "pi-gui:read-workspace-file",
  revealWorkspaceFile: "pi-gui:reveal-workspace-file",
  getChangedFiles: "pi-gui:get-changed-files",
  getFileDiff: "pi-gui:get-file-diff",
  stageFile: "pi-gui:stage-file",
  getTurnChanges: "pi-gui:get-turn-changes",
  getReview: "pi-gui:get-review",
  getReviewFile: "pi-gui:get-review-file",
  setReviewFileReviewed: "pi-gui:set-review-file-reviewed",
  changeReviewFileStage: "pi-gui:change-review-file-stage",
  getThemeMode: "pi-gui:get-theme-mode",
  getResolvedTheme: "pi-gui:get-resolved-theme",
  setThemeMode: "pi-gui:set-theme-mode",
  setThemePresetId: "pi-gui:set-theme-preset-id",
  themeChanged: "pi-gui:theme-changed",
  windowFocused: "pi-gui:window-focused",
  getSupportDevelopment: "pi-gui:get-support-development",
  openSupportDevelopment: "pi-gui:open-support-development",
  dismissSupportDevelopment: "pi-gui:dismiss-support-development",
  getTelemetryConsentStatus: "pi-gui:get-telemetry-consent-status",
  setTelemetryConsent: "pi-gui:set-telemetry-consent",
  telemetryConsentChanged: "pi-gui:telemetry-consent-changed",
  ping: "app:ping",
  openExternal: "app:open-external",
  relaunchApplication: "pi-gui:relaunch-application",
} as const;

export type TelemetryConsentIpcUpdate = TelemetryConsentRequest;
export type TelemetryConsentIpcStatus = TelemetryConsentStatusSnapshot;

const TELEMETRY_CONSENT_IPC_MAX_STATUS_BYTES = 8_192;

/** Strictly decode a no-payload telemetry status request. */
export function telemetryConsentIpc_decodeEmpty(value: unknown): undefined {
  if (value !== undefined) {
    throw new TypeError("Telemetry consent status request must not include a payload.");
  }
  return undefined;
}

/** Strictly decode a renderer consent update without widening provenance fields. */
export function telemetryConsentIpc_decodeUpdate(value: unknown): TelemetryConsentIpcUpdate {
  return telemetryConsent_decodeRequest(value);
}

/** Strictly bound a public telemetry status snapshot before it crosses IPC. */
export function telemetryConsentIpc_decodeStatus(value: unknown): TelemetryConsentIpcStatus {
  const status = telemetryConsent_decodeStatus(value);
  const bytes = new TextEncoder().encode(JSON.stringify(status)).byteLength;
  if (bytes > TELEMETRY_CONSENT_IPC_MAX_STATUS_BYTES) {
    throw new TypeError("Telemetry consent status exceeds the IPC byte bound.");
  }
  return status;
}

export interface SupportDevelopmentState {
  readonly options: readonly SupportDevelopmentOption[];
  readonly currentPromptDismissed: boolean;
  readonly dontAskAgain: boolean;
}

declare const supportDevelopmentOptionIdBrand: unique symbol;

export type SupportDevelopmentOptionId = string & {
  readonly [supportDevelopmentOptionIdBrand]: true;
};
export type SupportDevelopmentDismissal = "not-now" | "dont-ask-again";

export interface SupportDevelopmentAmount {
  readonly currency: "AUD";
  readonly minorUnits: number;
}

export interface SupportDevelopmentOption {
  readonly id: SupportDevelopmentOptionId;
  readonly label: string;
  readonly cadence: "monthly" | "one-off";
  readonly cadenceLabel: "Monthly" | "One-off";
  readonly provider: "stripe" | "paypal";
  readonly providerLabel: "Stripe" | "PayPal";
  readonly amount: SupportDevelopmentAmount | null;
  readonly recipient?: "Leo Software";
}

/** Validate the no-argument support status request. */
export function supportDevelopment_decodeEmpty(value: unknown): undefined {
  if (value !== undefined) {
    throw new TypeError("Support development request must not include a payload.");
  }
  return undefined;
}

export function supportDevelopment_decodeDismissal(value: unknown): SupportDevelopmentDismissal {
  if (value !== "not-now" && value !== "dont-ask-again") {
    throw new TypeError("Support development dismissal must be not-now or dont-ask-again.");
  }
  return value;
}

export const desktopCommands = {
  openSettings: "open-settings",
  openNewThread: "open-new-thread",
  toggleTerminal: "toggle-terminal",
  toggleSidePanel: "toggle-side-panel",
  toggleReview: "toggle-review",
  newSidePanelTab: "new-side-panel-tab",
  closeFocusedSurface: "close-focused-surface",
  toggleSidebar: "toggle-sidebar",
  openCommandPalette: "open-command-palette",
  openFilePalette: "open-file-palette",
  renameThread: "rename-thread",
  archiveThread: "archive-thread",
  selectRecentThread1: "select-recent-thread-1",
  selectRecentThread2: "select-recent-thread-2",
  selectRecentThread3: "select-recent-thread-3",
  selectRecentThread4: "select-recent-thread-4",
  selectRecentThread5: "select-recent-thread-5",
  selectRecentThread6: "select-recent-thread-6",
  selectRecentThread7: "select-recent-thread-7",
  selectRecentThread8: "select-recent-thread-8",
  selectRecentThread9: "select-recent-thread-9",
  selectSidePanelTab1: "select-side-panel-tab-1",
  selectSidePanelTab2: "select-side-panel-tab-2",
  selectSidePanelTab3: "select-side-panel-tab-3",
  selectSidePanelTab4: "select-side-panel-tab-4",
  selectSidePanelTab5: "select-side-panel-tab-5",
  selectSidePanelTab6: "select-side-panel-tab-6",
  selectSidePanelTab7: "select-side-panel-tab-7",
  selectSidePanelTab8: "select-side-panel-tab-8",
  selectSidePanelTab9: "select-side-panel-tab-9",
} as const;

const RECENT_THREAD_COMMANDS = [
  desktopCommands.selectRecentThread1,
  desktopCommands.selectRecentThread2,
  desktopCommands.selectRecentThread3,
  desktopCommands.selectRecentThread4,
  desktopCommands.selectRecentThread5,
  desktopCommands.selectRecentThread6,
  desktopCommands.selectRecentThread7,
  desktopCommands.selectRecentThread8,
  desktopCommands.selectRecentThread9,
] as const;

export const THREAD_SHORTCUT_SLOT_COUNT = RECENT_THREAD_COMMANDS.length;

export function isRecentThreadCommand(command: PiDesktopCommand | undefined): boolean {
  return (RECENT_THREAD_COMMANDS as readonly (PiDesktopCommand | undefined)[]).includes(command);
}

const SIDE_PANEL_TAB_COMMANDS = [
  desktopCommands.selectSidePanelTab1,
  desktopCommands.selectSidePanelTab2,
  desktopCommands.selectSidePanelTab3,
  desktopCommands.selectSidePanelTab4,
  desktopCommands.selectSidePanelTab5,
  desktopCommands.selectSidePanelTab6,
  desktopCommands.selectSidePanelTab7,
  desktopCommands.selectSidePanelTab8,
  desktopCommands.selectSidePanelTab9,
] as const;

export const SIDE_PANEL_TAB_SHORTCUT_SLOT_COUNT = SIDE_PANEL_TAB_COMMANDS.length;

/** The zero-based side panel tab a command selects, or undefined for other commands. */
export function sidePanelTabIndex(command: PiDesktopCommand | undefined): number | undefined {
  const index = (SIDE_PANEL_TAB_COMMANDS as readonly (PiDesktopCommand | undefined)[]).indexOf(
    command,
  );
  return index < 0 ? undefined : index;
}

/**
 * The side panel tab modifier: Control on macOS, where Command switches threads,
 * and Alt elsewhere, where Control does. It must be the only modifier held.
 */
export function sidePanelTabModifierHeld(
  platform: NodeJS.Platform,
  input: {
    readonly meta: boolean;
    readonly control: boolean;
    readonly alt: boolean;
    readonly shift: boolean;
  },
): boolean {
  if (input.shift || input.meta) return false;
  return platform === "darwin" ? input.control && !input.alt : input.alt && !input.control;
}

/**
 * Control+1-9 on macOS and Alt+1-9 elsewhere select side panel tab N. Keypad
 * digits are left alone so Windows Alt codes keep typing characters.
 */
export function getSidePanelTabCommand(
  platform: NodeJS.Platform,
  input: {
    readonly meta: boolean;
    readonly control: boolean;
    readonly alt: boolean;
    readonly shift: boolean;
    readonly key: string;
    readonly code?: string;
  },
): PiDesktopCommand | undefined {
  if (!sidePanelTabModifierHeld(platform, input) || input.code?.startsWith("Numpad")) {
    return undefined;
  }
  const digit = input.code?.match(/^Digit([1-9])$/)?.[1] ?? input.key.match(/^[1-9]$/)?.[0];
  return digit ? SIDE_PANEL_TAB_COMMANDS[Number(digit) - 1] : undefined;
}

export function getSidePanelTabShortcutLabel(platform: NodeJS.Platform, slot: number): string {
  return `${platform === "darwin" ? "⌃" : "Alt+"}${slot}`;
}

export function getDesktopShortcutLabel(platform: NodeJS.Platform, key: string): string {
  return `${platform === "darwin" ? "⌘" : "Ctrl+"}${key.toUpperCase()}`;
}

export function formatShortcut(
  platform: NodeJS.Platform,
  key: string,
  modifiers: { readonly shift?: boolean; readonly alt?: boolean } = {},
): string {
  if (platform === "darwin") {
    return `${modifiers.alt ? "⌥" : ""}${modifiers.shift ? "⇧" : ""}⌘${key.toUpperCase()}`;
  }
  return `Ctrl+${modifiers.alt ? "Alt+" : ""}${modifiers.shift ? "Shift+" : ""}${key.toUpperCase()}`;
}

export function getSidePanelToggleShortcutLabel(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "⌘⌥B" : "Ctrl+Alt+B";
}

// A state push leaves out the model catalog (`runtimeByWorkspace`) when it is unchanged
// since the last push to that window; the window keeps the one it has.
export type PiDesktopStatePush = Omit<DesktopAppState, "runtimeByWorkspace"> & {
  readonly runtimeByWorkspace?: DesktopAppState["runtimeByWorkspace"];
};
export type PiDesktopStateListener = (state: PiDesktopStatePush) => void;
export type PiDesktopSelectedTranscriptListener = (
  payload: SelectedTranscriptRecord | SelectedTranscriptPatch | null,
) => void;
export type PiDesktopExtensionUiListener = (update: SessionExtensionUiUpdate) => void;
export type PiDesktopCommand = (typeof desktopCommands)[keyof typeof desktopCommands];

export type ChangedFileStatus =
  "added" | "copied" | "deleted" | "modified" | "renamed" | "untracked";

export interface ChangedFileEntry {
  readonly path: string;
  readonly previousPath?: string;
  readonly stagingSourcePath?: string;
  readonly status: ChangedFileStatus;
  readonly staged: boolean;
}

export type ChangedFilesErrorCode =
  "git-status-failed" | "git-status-invalid" | "workspace-unavailable";

export interface ChangedFilesError {
  readonly code: ChangedFilesErrorCode;
  readonly message: string;
}

export type ChangedFilesResult =
  | {
      readonly state: "available";
      readonly files: readonly ChangedFileEntry[];
    }
  | {
      readonly state: "unavailable";
      readonly error: ChangedFilesError;
    };

export interface WorkspaceFilePreview {
  readonly path: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly binary: boolean;
  readonly sizeBytes: number;
}

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export type TerminalSessionStatus = "running" | "exited" | "error";

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly cwd: string;
  readonly shell: string;
  readonly title: string;
  readonly status: TerminalSessionStatus;
  readonly replay: string;
  readonly truncated: boolean;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalPanelSnapshot {
  readonly workspaceId: string;
  readonly rootKey: string;
  readonly activeSessionId: string;
  readonly sessions: readonly TerminalSessionSnapshot[];
}

export interface TerminalDataEvent {
  readonly terminalId: string;
  readonly data: string;
}

export interface TerminalExitEvent {
  readonly terminalId: string;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalErrorEvent {
  readonly terminalId: string;
  readonly message: string;
}

export interface DesktopShortcutInput {
  readonly modifier: boolean;
  readonly alt?: boolean;
  readonly shift: boolean;
  readonly key: string;
  readonly code?: string;
}

/** Command on macOS, Control on Windows and Linux. */
export function platformShortcutModifier(
  platform: NodeJS.Platform,
  input: { readonly meta: boolean; readonly control: boolean },
): boolean {
  return platform === "darwin" ? input.meta : input.control;
}

const MAX_QUEUED_DESKTOP_COMMANDS = 16;

/**
 * Delivers main-process shortcuts to the renderer.
 * A chord can arrive before React subscribes, or in the gap while a listener
 * is swapped. Those commands are kept until the next subscriber.
 */
export function createDesktopCommandSubscription() {
  let listener: ((command: PiDesktopCommand) => void) | null = null;
  const queued: PiDesktopCommand[] = [];
  return {
    subscribe(next: (command: PiDesktopCommand) => void): () => void {
      listener = next;
      const pending = queued.splice(0, queued.length);
      for (const command of pending) next(command);
      return () => {
        if (listener === next) listener = null;
      };
    },
    deliver(command: PiDesktopCommand): void {
      if (listener) {
        listener(command);
        return;
      }
      queued.push(command);
      if (queued.length > MAX_QUEUED_DESKTOP_COMMANDS) queued.shift();
    },
  };
}

/** Collapses a repeated keydown from one physical chord so a toggle stays open. */
export const SEARCH_CHORD_TOGGLE_MS = 200;
export const REVIEW_TOGGLE_DEDUPE_MS = 8;

export type ChordSource = "main" | "renderer";

/**
 * Collapses one chord that reaches the renderer twice, once forwarded by the main
 * process and once as a keydown. Repeats from the same source are separate presses.
 */
export function createChordPairGate(windowMs = REVIEW_TOGGLE_DEDUPE_MS) {
  let last: { readonly source: ChordSource; readonly at: number } | undefined;
  return (source: ChordSource, now: number): boolean => {
    if (last && last.source !== source && now - last.at < windowMs) {
      last = undefined;
      return false;
    }
    last = { source, at: now };
    return true;
  };
}

export function createChordToggleGate(windowMs = SEARCH_CHORD_TOGGLE_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return (now: number): boolean => {
    if (now - last < windowMs) return false;
    last = now;
    return true;
  };
}

export interface EarlyModifierChord {
  readonly key: string;
  readonly code: string;
}

function isBufferedModifierChord(key: string, code?: string): boolean {
  const lower = key.toLowerCase();
  if (lower === "f" || code === "KeyF") return true;
  if (lower === "," || code === "Comma") return true;
  if (lower === "r" || code === "KeyR") return true;
  return /^[1-9]$/.test(key) || /^Digit[1-9]$/.test(code ?? "");
}

/**
 * Keeps Command/Ctrl chords that arrive before the React shortcut listener
 * exists. Search, settings, Review, and thread digits are replayed.
 */
export function createEarlyModifierChordBuffer() {
  const pending: EarlyModifierChord[] = [];
  let ready = false;
  return {
    note(
      input: EarlyModifierChord & { readonly modifier: boolean; readonly shift: boolean },
    ): void {
      if (ready || !input.modifier || input.shift) return;
      if (!isBufferedModifierChord(input.key, input.code)) return;
      pending.push({ key: input.key, code: input.code });
      if (pending.length > 8) pending.shift();
    },
    arm(): readonly EarlyModifierChord[] {
      ready = true;
      return pending.splice(0, pending.length);
    },
  };
}

export const earlyModifierChords = createEarlyModifierChordBuffer();

export function getDesktopCommandFromShortcut(
  input: DesktopShortcutInput,
): PiDesktopCommand | undefined {
  if (!input.modifier) {
    return undefined;
  }

  const lowerKey = input.key.toLowerCase();
  const isComma = input.key === "," || input.code === "Comma";
  const isB = lowerKey === "b" || input.code === "KeyB";
  const isJ = lowerKey === "j" || input.code === "KeyJ";
  const isR = lowerKey === "r" || input.code === "KeyR";
  const isK = lowerKey === "k" || input.code === "KeyK";
  const isP = lowerKey === "p" || input.code === "KeyP";
  const isN = lowerKey === "n" || input.code === "KeyN";
  const isT = lowerKey === "t" || input.code === "KeyT";
  const isShiftO = input.shift && (lowerKey === "o" || input.code === "KeyO");
  const isShiftR = input.shift && isR;
  const isShiftA = input.shift && (lowerKey === "a" || input.code === "KeyA");

  if (input.alt) {
    if (!input.shift && isB) {
      return desktopCommands.toggleSidePanel;
    }
    return undefined;
  }

  if (!input.shift && isComma) {
    return desktopCommands.openSettings;
  }

  if (!input.shift && isJ) {
    return desktopCommands.toggleTerminal;
  }

  if (!input.shift && isR) {
    return desktopCommands.toggleReview;
  }

  if (!input.shift && isB) {
    return desktopCommands.toggleSidebar;
  }

  if (!input.shift && isK) {
    return desktopCommands.openCommandPalette;
  }

  if (!input.shift && isP) {
    return desktopCommands.openFilePalette;
  }

  if (!input.shift && isT) {
    return desktopCommands.newSidePanelTab;
  }

  if ((!input.shift && isN) || isShiftO) {
    return desktopCommands.openNewThread;
  }

  if (isShiftR) {
    return desktopCommands.renameThread;
  }

  if (isShiftA) {
    return desktopCommands.archiveThread;
  }

  if (!input.shift) {
    const digitFromKey = /^[1-9]$/.test(input.key) ? input.key : undefined;
    const digitFromCode = input.code?.match(/^Digit([1-9])$/)?.[1];
    const digit = digitFromKey ?? digitFromCode;
    if (digit) {
      return RECENT_THREAD_COMMANDS[Number(digit) - 1];
    }
  }

  return undefined;
}

/**
 * Callers accept palette commands only from the platform modifier, so macOS
 * Control+K and Control+P stay with text fields, and only from a first press.
 */
export function isPaletteCommand(command: PiDesktopCommand | undefined): boolean {
  return (
    command === desktopCommands.openCommandPalette || command === desktopCommands.openFilePalette
  );
}

/**
 * Commands that act once per press and only from the platform modifier. macOS
 * Control chords stay with text fields, and off macOS the terminal keeps Control
 * chords. Holding Archive would otherwise archive each next thread in turn, and
 * holding Review would flicker the panel. New Tab is the exception in the terminal,
 * where the shell keeps it to open another terminal.
 */
export function isSinglePressCommand(command: PiDesktopCommand | undefined): boolean {
  return (
    isPaletteCommand(command) ||
    command === desktopCommands.toggleReview ||
    command === desktopCommands.newSidePanelTab ||
    command === desktopCommands.renameThread ||
    command === desktopCommands.archiveThread
  );
}

export function isCloseFocusedSurfaceShortcut(input: {
  readonly meta: boolean;
  readonly control: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly key: string;
  readonly code?: string;
  readonly platform: NodeJS.Platform;
}): boolean {
  if (input.alt || input.shift) {
    return false;
  }
  const platformModifier = input.platform === "darwin" ? input.meta : input.control;
  const otherModifier = input.platform === "darwin" ? input.control : input.meta;
  if (!platformModifier || otherModifier) {
    return false;
  }
  return input.key.toLowerCase() === "w" || input.code === "KeyW";
}

/**
 * Main passes this to the renderer when the window is frameless and the app
 * must draw its own title bar with minimize, maximize and close (Linux).
 */
export const drawWindowControlsArgument = "--pi-draw-window-controls";

export interface PendingComposerDraftCaptureRequest {
  readonly requestId: number;
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly windowId: string;
}

export type PendingComposerDraftCaptureResponse =
  | {
      readonly requestId: number;
      readonly status: "captured";
      readonly expectation: DraftFlushExpectation;
    }
  | {
      readonly requestId: number;
      readonly status: "rejected";
    };

export interface PendingComposerDraftFlushRequest {
  readonly requestId: number;
  readonly expectation: DraftFlushExpectation;
}

export interface PendingComposerDraftFlushResponse {
  readonly requestId: number;
  readonly outcome: DraftFlushOutcome;
}

export type PendingComposerDraftCaptureHandler = (
  request: PendingComposerDraftCaptureRequest,
) => Promise<DraftFlushExpectation>;
export type PendingComposerDraftFlushHandler = (
  request: PendingComposerDraftFlushRequest,
) => Promise<DraftFlushOutcome>;

function pendingComposerDraft_assertJsonValue(
  value: unknown,
  location = "$",
  ancestors = new WeakSet<object>(),
  depth = 0,
): void {
  if (depth > 20) {
    throw new TypeError(`${location} exceeds the nesting limit.`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${location} must be a finite number.`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${location} is not JSON data.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${location} cannot contain symbol keys.`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${location} cannot contain a cycle.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 256) {
        throw new TypeError(`${location} exceeds the collection limit.`);
      }
      const names = Object.getOwnPropertyNames(value).filter((name) => name !== "length");
      if (names.length !== value.length || names.some((name, index) => name !== String(index))) {
        throw new TypeError(`${location} must be a dense array with no extra properties.`);
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError(
            `${location}[${index}] must be an enumerable data property with no accessor.`,
          );
        }
        pendingComposerDraft_assertJsonValue(
          descriptor.value,
          `${location}[${index}]`,
          ancestors,
          depth + 1,
        );
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype) {
      throw new TypeError(`${location} must be a plain JSON object.`);
    }
    const names = Object.getOwnPropertyNames(value);
    if (names.length > 64) {
      throw new TypeError(`${location} has too many fields.`);
    }
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${location}.${name} must be an enumerable data property.`);
      }
      pendingComposerDraft_assertJsonValue(
        descriptor.value,
        `${location}.${name}`,
        ancestors,
        depth + 1,
      );
    }
  } finally {
    ancestors.delete(value);
  }
}

function pendingComposerDraft_isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function pendingComposerDraft_hasOnlyDataKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const names = Object.getOwnPropertyNames(value);
  return (
    names.length === keys.length &&
    names.every((name) => keys.includes(name)) &&
    keys.every((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      return descriptor?.enumerable === true && "value" in descriptor;
    })
  );
}

function pendingComposerDraft_identifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${field} must be a bounded identifier.`);
  }
  return value;
}

function pendingComposerDraft_requestId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError("draft requestId must be a positive safe integer.");
  }
  return value as number;
}

function pendingComposerDraft_decodeExpectation(value: unknown): DraftFlushExpectation {
  pendingComposerDraft_assertJsonValue(value, "draft expectation");
  if (!pendingComposerDraft_isRecord(value)) {
    throw new TypeError("draft expectation must be a plain object.");
  }
  const keys = ["operationId", "requestKey", "windowId", "editGeneration"] as const;
  if (!pendingComposerDraft_hasOnlyDataKeys(value, keys)) {
    throw new TypeError("draft expectation has an unsupported shape.");
  }
  const outcome = lifecycle_decodeDraftFlushOutcome({
    operationId: value.operationId,
    requestKey: value.requestKey,
    windowId: value.windowId,
    editGeneration: value.editGeneration,
    status: "saved",
  });
  return {
    operationId: outcome.operationId,
    requestKey: outcome.requestKey,
    windowId: outcome.windowId,
    editGeneration: outcome.editGeneration,
  };
}

export function pendingComposerDraft_decodeCaptureRequest(
  value: unknown,
): PendingComposerDraftCaptureRequest {
  pendingComposerDraft_assertJsonValue(value, "draft capture request");
  if (!pendingComposerDraft_isRecord(value)) {
    throw new TypeError("draft capture request must be a plain object.");
  }
  const keys = ["requestId", "operationId", "requestKey", "windowId"] as const;
  if (!pendingComposerDraft_hasOnlyDataKeys(value, keys)) {
    throw new TypeError("draft capture request has an unsupported shape.");
  }
  return {
    requestId: pendingComposerDraft_requestId(value.requestId),
    operationId: pendingComposerDraft_identifier(value.operationId, "operationId"),
    requestKey: lifecycle_decodeRequestKey(value.requestKey),
    windowId: pendingComposerDraft_identifier(value.windowId, "windowId"),
  };
}

export function pendingComposerDraft_decodeCaptureResponse(
  value: unknown,
  request?: PendingComposerDraftCaptureRequest,
): PendingComposerDraftCaptureResponse {
  pendingComposerDraft_assertJsonValue(value, "draft capture response");
  if (!pendingComposerDraft_isRecord(value)) {
    throw new TypeError("draft capture response must be a plain object.");
  }
  const requestId = pendingComposerDraft_requestId(value.requestId);
  if (value.status === "rejected") {
    if (!pendingComposerDraft_hasOnlyDataKeys(value, ["requestId", "status"])) {
      throw new TypeError("rejected draft capture response has an unsupported shape.");
    }
    if (request && request.requestId !== requestId) {
      throw new TypeError("draft capture response does not match its request.");
    }
    return { requestId, status: "rejected" };
  }
  if (value.status !== "captured") {
    throw new TypeError("draft capture response status is not accepted.");
  }
  if (!pendingComposerDraft_hasOnlyDataKeys(value, ["requestId", "status", "expectation"])) {
    throw new TypeError("captured draft response has an unsupported shape.");
  }
  const expectation = pendingComposerDraft_decodeExpectation(value.expectation);
  if (
    request &&
    (request.requestId !== requestId ||
      request.operationId !== expectation.operationId ||
      !pendingComposerDraft_sameRequestKey(request.requestKey, expectation.requestKey) ||
      request.windowId !== expectation.windowId)
  ) {
    throw new TypeError("draft capture response does not match its request.");
  }
  return { requestId, status: "captured", expectation };
}

export function pendingComposerDraft_decodeFlushRequest(
  value: unknown,
): PendingComposerDraftFlushRequest {
  pendingComposerDraft_assertJsonValue(value, "draft flush request");
  if (!pendingComposerDraft_isRecord(value)) {
    throw new TypeError("draft flush request must be a plain object.");
  }
  if (!pendingComposerDraft_hasOnlyDataKeys(value, ["requestId", "expectation"])) {
    throw new TypeError("draft flush request has an unsupported shape.");
  }
  return {
    requestId: pendingComposerDraft_requestId(value.requestId),
    expectation: pendingComposerDraft_decodeExpectation(value.expectation),
  };
}

function pendingComposerDraft_decodeOutcomeForExpectation(
  value: unknown,
  expectation: DraftFlushExpectation,
): DraftFlushOutcome {
  const outcome = lifecycle_decodeDraftFlushOutcome(value);
  if (
    outcome.operationId !== expectation.operationId ||
    !pendingComposerDraft_sameRequestKey(outcome.requestKey, expectation.requestKey) ||
    outcome.windowId !== expectation.windowId ||
    outcome.editGeneration !== expectation.editGeneration
  ) {
    throw new TypeError("draft outcome does not match its captured expectation.");
  }
  return outcome;
}

export function pendingComposerDraft_decodeFlushResponse(
  value: unknown,
  expectation?: DraftFlushExpectation,
): PendingComposerDraftFlushResponse {
  pendingComposerDraft_assertJsonValue(value, "draft flush response");
  if (!pendingComposerDraft_isRecord(value)) {
    throw new TypeError("draft flush response must be a plain object.");
  }
  if (!pendingComposerDraft_hasOnlyDataKeys(value, ["requestId", "outcome"])) {
    throw new TypeError("draft flush response has an unsupported shape.");
  }
  const requestId = pendingComposerDraft_requestId(value.requestId);
  const outcome = expectation
    ? pendingComposerDraft_decodeOutcomeForExpectation(value.outcome, expectation)
    : lifecycle_decodeDraftFlushOutcome(value.outcome);
  return { requestId, outcome };
}

function pendingComposerDraft_sameRequestKey(
  left: LifecycleRequestKey,
  right: LifecycleRequestKey,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function pendingComposerDraft_rejectedOutcome(
  expectation: DraftFlushExpectation,
): DraftFlushOutcome {
  return { ...expectation, status: "rejected" };
}

export async function pendingComposerDraft_aggregateCaptureHandlers(
  request: PendingComposerDraftCaptureRequest,
  handlers: ReadonlySet<PendingComposerDraftCaptureHandler>,
): Promise<PendingComposerDraftCaptureResponse> {
  if (handlers.size !== 1) return { requestId: request.requestId, status: "rejected" };
  try {
    const handler = handlers.values().next().value;
    if (!handler) return { requestId: request.requestId, status: "rejected" };
    const expectation = pendingComposerDraft_decodeExpectation(await handler(request));
    if (
      expectation.operationId !== request.operationId ||
      !pendingComposerDraft_sameRequestKey(expectation.requestKey, request.requestKey) ||
      expectation.windowId !== request.windowId
    ) {
      throw new TypeError("captured draft expectation does not match its request.");
    }
    return {
      requestId: request.requestId,
      status: "captured",
      expectation,
    };
  } catch {
    return { requestId: request.requestId, status: "rejected" };
  }
}

export async function pendingComposerDraft_aggregateFlushHandlers(
  request: PendingComposerDraftFlushRequest,
  handlers: ReadonlySet<PendingComposerDraftFlushHandler>,
): Promise<PendingComposerDraftFlushResponse> {
  if (handlers.size !== 1) {
    return {
      requestId: request.requestId,
      outcome: pendingComposerDraft_rejectedOutcome(request.expectation),
    };
  }
  try {
    const handler = handlers.values().next().value;
    if (!handler) {
      return {
        requestId: request.requestId,
        outcome: pendingComposerDraft_rejectedOutcome(request.expectation),
      };
    }
    return {
      requestId: request.requestId,
      outcome: pendingComposerDraft_decodeOutcomeForExpectation(
        await handler(request),
        request.expectation,
      ),
    };
  } catch {
    return {
      requestId: request.requestId,
      outcome: pendingComposerDraft_rejectedOutcome(request.expectation),
    };
  }
}

export interface PiDesktopApi {
  platform: NodeJS.Platform;
  /** True when the window has no native title bar and the app draws its own. */
  drawsWindowControls: boolean;
  versions: NodeJS.ProcessVersions;
  ping(): Promise<string>;
  getState(): Promise<DesktopAppState>;
  getTaskWorkbenchTemplate(target: SessionRef): Promise<TaskWorkbenchTemplate | null>;
  saveTaskWorkbenchTemplate(input: SaveTaskWorkbenchTemplateInput): Promise<void>;
  onStateChanged(listener: PiDesktopStateListener): () => void;
  getSelectedTranscript(): Promise<SelectedTranscriptRecord | null>;
  onSelectedTranscriptChanged(listener: PiDesktopSelectedTranscriptListener): () => void;
  resendSelectedTranscript(): void;
  onExtensionUiChanged(listener: PiDesktopExtensionUiListener): () => void;
  onCommand(listener: (command: PiDesktopCommand) => void): () => void;
  onWorkspacePicked(listener: (workspaceId: string) => void): () => void;
  onClipboardImagePasted(listener: (result: ClipboardImageRead) => void): () => void;
  getPathForFile(file: File): string;
  addWorkspacePath(path: string): Promise<DesktopAppState>;
  scanProjectImports(): Promise<ProjectImportScanResult>;
  monitorProjectImport(request: ProjectImportMonitorRequest): Promise<ProjectImportMonitorResult>;
  pickWorkspace(): Promise<DesktopAppState>;
  selectWorkspace(workspaceId: string): Promise<DesktopAppState>;
  renameWorkspace(workspaceId: string, displayName: string): Promise<DesktopAppState>;
  removeWorkspace(workspaceId: string): Promise<DesktopAppState>;
  reorderWorkspaces(workspaceOrder: readonly string[]): Promise<DesktopAppState>;
  reorderPinnedSessions(pinnedSessionOrder: readonly string[]): Promise<DesktopAppState>;
  openWorkspaceInFinder(workspaceId: string): Promise<void>;
  listEditors(): Promise<DesktopEditorList>;
  setPreferredEditor(editorId: string): Promise<DesktopEditorList>;
  openWorkspaceInEditor(workspaceId: string, editorId: string): Promise<DesktopEditorList>;
  createWorktree(input: CreateWorktreeInput): Promise<DesktopAppState>;
  removeWorktree(input: RemoveWorktreeInput): Promise<DesktopAppState>;
  openSkillInFinder(workspaceId: string, filePath: string): Promise<void>;
  openExtensionInFinder(workspaceId: string, filePath: string): Promise<void>;
  syncCurrentWorkspace(): Promise<DesktopAppState>;
  selectSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  renameSession(target: WorkspaceSessionTarget, title: string): Promise<DesktopAppState>;
  editTranscriptMessage(
    target: WorkspaceSessionTarget,
    messageId: string,
    text: string,
  ): Promise<DesktopAppState>;
  deleteTranscriptMessage(
    target: WorkspaceSessionTarget,
    messageId: string,
  ): Promise<DesktopAppState>;
  archiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  unarchiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  markSessionRead(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  markAllThreadsRead(input: MarkAllThreadsReadInput): Promise<DesktopAppState>;
  setFolderPreference(workspaceId: string, preference: FolderPreference): Promise<DesktopAppState>;
  setAllThreadsSort(sort: AllThreadsSort): Promise<DesktopAppState>;
  setProjectAccentColor(input: SetProjectAccentColorInput): Promise<DesktopAppState>;
  setActivityIndicatorStyle(style: ActivityIndicatorStyle): Promise<DesktopAppState>;
  getEffectiveChildModelSettings(workspaceId: string): Promise<EffectiveChildModelSettings>;
  setSessionPinned(target: WorkspaceSessionTarget, pinned: boolean): Promise<DesktopAppState>;
  createSession(input: CreateSessionInput): Promise<DesktopAppState>;
  startThread(input: StartThreadInput): Promise<DesktopAppState>;
  forkThread(input: ForkThreadInput): Promise<DesktopAppState>;
  sendChildThreadFollowUp(input: SendChildThreadFollowUpInput): Promise<DesktopAppState>;
  setChildSupervisionLoop(input: SetChildSupervisionLoopInput): Promise<DesktopAppState>;
  createScheduledTask(input: CreateScheduledTaskInput): Promise<DesktopAppState>;
  updateScheduledTask(id: string, patch: UpdateScheduledTaskInput): Promise<DesktopAppState>;
  deleteScheduledTask(id: string): Promise<DesktopAppState>;
  beginScheduledTaskInterview(): Promise<DesktopAppState>;
  cancelCurrentRun(): Promise<DesktopAppState>;
  setActiveView(view: AppView): Promise<DesktopAppState>;
  setSidebarCollapsed(collapsed: boolean): Promise<DesktopAppState>;
  setThreadGrouping(grouping: ThreadGrouping): Promise<DesktopAppState>;
  setWorkspaceCollapsed(workspaceId: string, collapsed: boolean): Promise<DesktopAppState>;
  refreshRuntime(workspaceId?: string): Promise<DesktopAppState>;
  setModelSettingsScopeMode(mode: ModelSettingsScopeMode): Promise<DesktopAppState>;
  setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<DesktopAppState>;
  setDefaultThinkingLevel(
    workspaceId: string,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<DesktopAppState>;
  getAutonomyPreferences(target?: SummaryTarget): Promise<AgentAutonomyPreferences>;
  setAutonomyPreferences(input: AutonomyUpdate): Promise<AgentAutonomyPreferences>;
  getSummaryPreferences(target?: SummaryTarget): Promise<SummaryPreferences>;
  setSummaryPreferences(input: SummaryPreferenceUpdate): Promise<SummaryPreferences>;
  summarizeTurn(input: WorkSummaryRequest): Promise<WorkSummaryResult>;
  setSessionModel(
    workspaceId: string,
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<DesktopAppState>;
  setSessionThinkingLevel(
    workspaceId: string,
    sessionId: string,
    thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
  ): Promise<DesktopAppState>;
  loginProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  logoutProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  setProviderApiKey(
    workspaceId: string,
    providerId: string,
    apiKey: string,
  ): Promise<DesktopAppState>;
  listCustomProviders(): Promise<readonly CustomProviderConfig[]>;
  setCustomProvider(workspaceId: string, config: CustomProviderConfig): Promise<DesktopAppState>;
  deleteCustomProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  probeCustomProviderModels(input: CustomProviderProbeInput): Promise<CustomProviderProbeResult>;
  setEnableSkillCommands(workspaceId: string, enabled: boolean): Promise<DesktopAppState>;
  setScopedModelPatterns(
    workspaceId: string,
    patterns: readonly string[],
  ): Promise<DesktopAppState>;
  setSkillEnabled(
    workspaceId: string,
    filePath: string,
    enabled: boolean,
  ): Promise<DesktopAppState>;
  setExtensionEnabled(
    workspaceId: string,
    filePath: string,
    enabled: boolean,
  ): Promise<DesktopAppState>;
  listMcpServers(workspaceId: string): Promise<McpServersSnapshot>;
  addMcpServer(workspaceId: string, server: NewMcpServerInput): Promise<DesktopAppState>;
  removeMcpServer(workspaceId: string, name: string): Promise<DesktopAppState>;
  setMcpServerEnabled(
    workspaceId: string,
    scope: McpServerScope,
    name: string,
    enabled: boolean,
  ): Promise<DesktopAppState>;
  setCodemodeAlwaysOn(workspaceId: string, alwaysOn: boolean): Promise<DesktopAppState>;
  respondToHostUiRequest(
    workspaceId: string,
    sessionId: string,
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ): Promise<DesktopAppState>;
  setNotificationPreferences(
    preferences: Partial<NotificationPreferences>,
  ): Promise<DesktopAppState>;
  setIntegratedTerminalShell(shell: string): Promise<DesktopAppState>;
  setEnableTransparency(enabled: boolean): Promise<DesktopAppState>;
  setThemePresetId(presetId: ThemePresetId): Promise<DesktopAppState>;
  ensureTerminalPanel(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  createTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  setActiveTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    terminalId: string,
  ): Promise<TerminalPanelSnapshot>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, size: TerminalSize): Promise<void>;
  restartTerminalSession(
    terminalId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  closeTerminalSession(terminalId: string): Promise<TerminalPanelSnapshot | null>;
  setTerminalTitle(terminalId: string, title: string): Promise<void>;
  setTerminalFocused(focused: boolean): Promise<void>;
  setSidePanelFocused(focused: boolean): Promise<void>;
  onTerminalData(listener: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void;
  onTerminalError(listener: (event: TerminalErrorEvent) => void): () => void;
  getNotificationPermissionStatus(): Promise<DesktopNotificationPermissionStatus>;
  requestNotificationPermission(): Promise<DesktopNotificationPermissionStatus>;
  openSystemNotificationSettings(): Promise<void>;
  onNotificationPermissionStatusChanged(
    callback: (status: DesktopNotificationPermissionStatus) => void,
  ): () => void;
  pickComposerAttachments(): Promise<DesktopAppState>;
  readClipboardImage(): ClipboardImageRead;
  addComposerAttachments(attachments: readonly ComposerAttachment[]): Promise<DesktopAppState>;
  removeComposerAttachment(attachmentId: string): Promise<DesktopAppState>;
  editQueuedComposerMessage(messageId: string, currentDraft?: string): Promise<DesktopAppState>;
  cancelQueuedComposerEdit(): Promise<DesktopAppState>;
  removeQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  steerQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  persistComposerDraft(input: {
    readonly target: SessionRef;
    readonly draft: string;
  }): Promise<void>;
  /** Saves the draft typed in `target`, even if another task is selected by the time it lands. */
  updateComposerDraft(composerDraft: string, target: SessionRef): Promise<DesktopAppState>;
  /**
   * Runs `handler` when the window is about to close or the app to quit; it should resolve
   * once the debounced draft has been saved. Main waits a bounded time for it.
   */
  onPendingComposerDraftFlush(handler: () => Promise<void>): () => void;
  /** Captures the current bounded draft identity without writing it. */
  onPendingComposerDraftCapture(handler: PendingComposerDraftCaptureHandler): () => void;
  /** Persists one previously captured draft identity and preserves its typed result. */
  onPendingComposerDraftFlushResult(handler: PendingComposerDraftFlushHandler): () => void;
  submitComposer(
    text: string,
    options?: { readonly deliverAs?: "steer" | "followUp" },
  ): Promise<DesktopAppState>;
  getSessionTree(target: WorkspaceSessionTarget): Promise<SessionTreeSnapshot>;
  navigateSessionTree(
    target: WorkspaceSessionTarget,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<{ readonly state: DesktopAppState; readonly result: NavigateSessionTreeResult }>;
  listWorkspaceFiles(
    workspaceId: string,
    options?: { readonly force?: boolean },
  ): Promise<string[]>;
  readWorkspaceFile(workspaceId: string, filePath: string): Promise<WorkspaceFilePreview>;
  revealWorkspaceFile(workspaceId: string, filePath: string): Promise<void>;
  getChangedFiles(workspaceId: string): Promise<ChangedFilesResult>;
  getFileDiff(workspaceId: string, filePath: string): Promise<string>;
  stageFile(workspaceId: string, filePath: string, stagingSourcePath?: string): Promise<void>;
  onExtensionViewOpenFile(listener: (event: ExtensionViewOpenFile) => void): () => void;
  /** Runs a card button's action for its thread, which must be the window's selected one. */
  runExtensionAction(request: ExtensionActionRequest): Promise<ExtensionActionEffect | null>;
  listExtensionViews(target: SessionRef): Promise<readonly DesktopExtensionViewInfo[]>;
  openExtensionView(input: OpenExtensionViewInput): Promise<ExtensionViewConnection>;
  sendExtensionViewMessage(input: ExtensionViewMessage): Promise<void>;
  closeExtensionView(connectionId: string): Promise<void>;
  onExtensionViewMessage(listener: (event: ExtensionViewMessage) => void): () => void;
  onExtensionViewCatalogChanged(listener: (event: ExtensionViewCatalogChange) => void): () => void;
  getTurnChanges(input: TurnChangesInput): Promise<TurnChangesResult>;
  getReview(input: GetReviewInput): Promise<ReviewResult>;
  getReviewFile(input: ReviewFileInput): Promise<ReviewFileResult>;
  setReviewFileReviewed(input: SetReviewFileReviewedInput): Promise<SetReviewFileReviewedResult>;
  changeReviewFileStage(input: ChangeReviewFileStageInput): Promise<ChangeReviewFileStageResult>;
  toggleWindowMaximize(): Promise<void>;
  minimizeWindow(): void;
  closeWindow(): void;
  getSupportDevelopment(): Promise<SupportDevelopmentState>;
  openSupportDevelopment(optionId: SupportDevelopmentOptionId): Promise<void>;
  dismissSupportDevelopment(choice: SupportDevelopmentDismissal): Promise<SupportDevelopmentState>;
  getTelemetryConsentStatus(): Promise<TelemetryConsentIpcStatus>;
  setTelemetryConsent(request: TelemetryConsentIpcUpdate): Promise<TelemetryConsentIpcStatus>;
  onTelemetryConsentChanged(listener: (status: TelemetryConsentIpcStatus) => void): () => void;
  openExternal(url: string): Promise<void>;
  getThemeMode(): Promise<"system" | "light" | "dark">;
  getResolvedTheme(): Promise<"light" | "dark">;
  setThemeMode(mode: "system" | "light" | "dark"): Promise<DesktopAppState>;
  onThemeChanged(callback: (theme: "light" | "dark") => void): () => void;
  /** The window came back to the foreground, so outside changes (edits, git) may need rereading. */
  onWindowFocused(listener: () => void): () => void;
  relaunchApplication(): Promise<void>;
}
