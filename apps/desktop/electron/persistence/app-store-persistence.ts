import {
  childSelection_decodeInitiatingOrigin,
  type SessionInitiatingOrigin,
} from "../../contracts/child-selection";
import {
  childSelection_decodeOrigin,
  childSelection_decodeSelectedConfig,
} from "../../contracts/child-selection";
import {
  sidebarPreferences_isFolder,
  sidebarPreferences_isSort,
  sidebarPreferences_decodeDurableActivityPreference,
  type FolderPreference,
  type AllThreadsSort,
  type PersistedActivityIndicatorPreference,
} from "../../contracts/sidebar-preferences";
import {
  projectIdentity_decodeAccentColors,
  type ProjectAccentColor,
} from "../../contracts/project-identity";
import type {
  AppView,
  ExtensionCommandCompatibilityRecord,
  ModelSettingsScopeMode,
  NotificationPreferences,
  OrchestrationEvidenceRecord,
  OrchestrationChildThread,
  OrchestrationChildTranscriptMessage,
  OrchestrationSupervisionLoop,
  ThemeMode,
  ThemePresetId,
  ThreadGrouping,
} from "../../contracts/desktop-state";
import { isThemeMode, isThemePresetId, isThreadGrouping } from "../../contracts/desktop-state";
import type { ExtensionFlagValues } from "@pi-gui/session-driver";
import type { ModelSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";
import { readJsonWithBackup, writeFileAtomicQueued } from "./atomic-file-write";
import { decodeAttachments } from "./attachment-store";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { decodeTaskWorkbenchTemplate, type TaskWorkbenchTemplate } from "../../contracts/workbench";

export interface PersistedUiState {
  readonly version?:
    2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20;
  readonly taskWorkbenchTemplatesBySession?: Record<string, TaskWorkbenchTemplate>;
  readonly selectedWorkspaceId?: string;
  readonly selectedSessionId?: string;
  readonly activeView?: AppView;
  readonly composerDraft?: string;
  readonly composerDraftsBySession?: Record<string, string>;
  readonly extensionCommandCompatibilityByWorkspace?: Record<
    string,
    readonly ExtensionCommandCompatibilityRecord[]
  >;
  /** Flag values last chosen for a new thread, by root workspace. */
  readonly extensionFlagsByWorkspace?: Record<string, ExtensionFlagValues>;
  /** Flag values each thread's pi session started with, by session key. */
  readonly extensionFlagsBySession?: Record<string, ExtensionFlagValues>;
  readonly notificationPreferences?: Partial<NotificationPreferences>;
  /** Names of pi-gui built-in extensions the user switched off. */
  readonly disabledBuiltinExtensions?: readonly string[];
  readonly integratedTerminalShell?: string;
  readonly lastViewedAtBySession?: Record<string, string>;
  readonly lastInteractedAtBySession?: Record<string, string>;
  readonly pinnedAtBySession?: Record<string, string>;
  readonly pinnedSessionOrder?: readonly string[];
  readonly workspaceOrder?: readonly string[];
  readonly modelSettingsScopeMode?: ModelSettingsScopeMode;
  readonly appGlobalModelSettings?: ModelSettingsSnapshot;
  readonly sidebarCollapsed?: boolean;
  readonly threadGrouping?: ThreadGrouping;
  readonly collapsedWorkspaceIds?: readonly string[];
  readonly folderPreferencesByWorkspace?: Readonly<Record<string, FolderPreference>>;
  readonly allThreadsSort?: AllThreadsSort;
  readonly initiatingOriginBySession?: Readonly<Record<string, SessionInitiatingOrigin>>;
  readonly createdAtBySession?: Readonly<Record<string, string>>;
  readonly allowMultiple?: boolean;
  readonly enableTransparency?: boolean;
  readonly themeMode?: ThemeMode;
  readonly themePresetId?: ThemePresetId;
  readonly orchestrationChildren?: readonly OrchestrationChildThread[];
  readonly workspaceAccentColors?: Readonly<Record<string, ProjectAccentColor>>;
  readonly activityIndicatorPreference?: PersistedActivityIndicatorPreference;
  /**
   * Compatibility fields emitted by the installed 1.0.14 repair build.
   * They remain in the private persistence state so unrelated saves do not
   * discard values or child parentage that this source does not yet own.
   */
  readonly preventSleep?: boolean;
  readonly allowCrossProjectThreadCommands?: boolean;
  readonly lastHumanInputAtBySession?: Record<string, string>;
  readonly sessionOrigins?: Record<string, LegacySessionOrigin>;
  readonly legacyRepairUiStateImported?: true;
}

export interface LegacyPersistedUiState extends PersistedUiState {
  readonly composerAttachmentsBySession?: Record<string, readonly unknown[]>;
  readonly transcripts?: Record<string, readonly unknown[]>;
}

export interface LegacySessionOrigin {
  readonly kind: "human" | "scheduled" | "subagent" | "tool";
  readonly parentWorkspaceId?: string;
  readonly parentSessionId?: string;
}

export async function readPersistedUiState(
  uiStateFilePath: string,
): Promise<LegacyPersistedUiState> {
  const result = await readJsonWithBackup(uiStateFilePath);
  if (result.corrupted && !result.recovered) {
    throw new Error(
      `Invalid ui-state at ${uiStateFilePath}; original data was retained. Repair or restore the file before continuing.`,
    );
  }
  if (result.corrupted) {
    // Surface corruption instead of silently returning `{}` (which the next
    // write would then persist over the last good state, losing pins, drafts,
    // workspace order, etc.). A recovery from `.bak` still counts as corrupt so
    // the operator sees that the primary file needs attention.
    console.error(
      `[app-store] corrupt ui-state at ${uiStateFilePath}` +
        (result.recovered ? " — recovered from backup" : " — no usable backup"),
    );
  }
  return result.value === undefined ? {} : decodePersistedUiState(result.value);
}

export function decodePersistedUiState(parsed: unknown): LegacyPersistedUiState {
  const candidate = validateUiState(parsed);

  return {
    version: toPersistedVersion(candidate.version),
    taskWorkbenchTemplatesBySession:
      candidate.taskWorkbenchTemplatesBySession === undefined
        ? undefined
        : decodeWorkbenchTemplates(candidate.taskWorkbenchTemplatesBySession),
    selectedWorkspaceId: stringValue(candidate.selectedWorkspaceId),
    selectedSessionId: stringValue(candidate.selectedSessionId),
    activeView: toAppView(candidate.activeView),
    composerDraft: stringValue(candidate.composerDraft) ?? "",
    composerDraftsBySession: toStringRecord(candidate.composerDraftsBySession),
    extensionCommandCompatibilityByWorkspace: toPersistedCompatibilityByWorkspace(
      candidate.extensionCommandCompatibilityByWorkspace,
    ),
    extensionFlagsByWorkspace: toExtensionFlagRecords(candidate.extensionFlagsByWorkspace),
    extensionFlagsBySession: toExtensionFlagRecords(candidate.extensionFlagsBySession),
    notificationPreferences: toNotificationPreferences(candidate.notificationPreferences),
    disabledBuiltinExtensions: toStringArray(candidate.disabledBuiltinExtensions),
    integratedTerminalShell:
      typeof candidate.integratedTerminalShell === "string"
        ? candidate.integratedTerminalShell
        : undefined,
    lastViewedAtBySession: toStringRecord(candidate.lastViewedAtBySession),
    lastInteractedAtBySession: mergeStringRecords(
      candidate.lastHumanInputAtBySession,
      candidate.lastInteractedAtBySession,
    ),
    pinnedAtBySession: toStringRecord(candidate.pinnedAtBySession),
    pinnedSessionOrder: toStringArray(candidate.pinnedSessionOrder),
    workspaceOrder: toStringArray(candidate.workspaceOrder),
    modelSettingsScopeMode:
      candidate.modelSettingsScopeMode === "per-repo" ||
      candidate.modelSettingsScopeMode === "app-global"
        ? candidate.modelSettingsScopeMode
        : undefined,
    appGlobalModelSettings: toPersistedModelSettingsSnapshot(candidate.appGlobalModelSettings),
    sidebarCollapsed:
      typeof candidate.sidebarCollapsed === "boolean" ? candidate.sidebarCollapsed : undefined,
    threadGrouping: isThreadGrouping(candidate.threadGrouping)
      ? candidate.threadGrouping
      : undefined,
    collapsedWorkspaceIds: toStringArray(candidate.collapsedWorkspaceIds),
    folderPreferencesByWorkspace:
      candidate.folderPreferencesByWorkspace as PersistedUiState["folderPreferencesByWorkspace"],
    allThreadsSort: candidate.allThreadsSort as AllThreadsSort | undefined,
    initiatingOriginBySession: mergeInitiatingOrigins(
      candidate.sessionOrigins,
      candidate.initiatingOriginBySession,
    ),
    createdAtBySession: toStringRecord(candidate.createdAtBySession),
    allowMultiple:
      typeof candidate.allowMultiple === "boolean" ? candidate.allowMultiple : undefined,
    enableTransparency:
      typeof candidate.enableTransparency === "boolean" ? candidate.enableTransparency : undefined,
    themeMode: toThemeMode(candidate.themeMode),
    themePresetId: toThemePresetId(candidate.themePresetId),
    orchestrationChildren: toPersistedOrchestrationChildren(candidate.orchestrationChildren),
    workspaceAccentColors:
      candidate.workspaceAccentColors === undefined
        ? undefined
        : projectIdentity_decodeAccentColors(candidate.workspaceAccentColors),
    activityIndicatorPreference:
      candidate.activityIndicatorPreference === undefined
        ? undefined
        : sidebarPreferences_decodeDurableActivityPreference(candidate.activityIndicatorPreference),
    preventSleep: typeof candidate.preventSleep === "boolean" ? candidate.preventSleep : undefined,
    allowCrossProjectThreadCommands:
      typeof candidate.allowCrossProjectThreadCommands === "boolean"
        ? candidate.allowCrossProjectThreadCommands
        : undefined,
    lastHumanInputAtBySession: toStringRecord(candidate.lastHumanInputAtBySession),
    sessionOrigins: toLegacySessionOrigins(candidate.sessionOrigins),
    legacyRepairUiStateImported: candidate.legacyRepairUiStateImported === true ? true : undefined,
    composerAttachmentsBySession: toObjectArrayRecord(candidate.composerAttachmentsBySession),
    transcripts: toObjectArrayRecord(candidate.transcripts),
  };
}

export async function writePersistedUiState(
  uiStateFilePath: string,
  payload: PersistedUiState,
): Promise<void> {
  decodePersistedUiState(payload);
  const serialized = `${JSON.stringify(
    {
      ...payload,
      version: 20,
    } satisfies PersistedUiState,
    null,
    2,
  )}\n`;
  await writeFileAtomicQueued(uiStateFilePath, serialized, decodePersistedUiState, {
    preserveExistingAs: (validated) => {
      const existing = validated as LegacyPersistedUiState;
      if (existing.version === 20) {
        if (!requiresInstalledRepairMigrationSnapshot(existing)) return undefined;
        return join(
          dirname(uiStateFilePath),
          `${basename(uiStateFilePath, ".json")}.pre-repair-v1.0.14.${randomUUID()}.json`,
        );
      }
      return join(
        dirname(uiStateFilePath),
        `${basename(uiStateFilePath, ".json")}.pre-workbench-v${existing.version ?? "legacy"}.${randomUUID()}.json`,
      );
    },
  });
}

/** Detect the exact repair-build shape once, even though it already used version 20. */
function requiresInstalledRepairMigrationSnapshot(existing: LegacyPersistedUiState): boolean {
  return (
    existing.legacyRepairUiStateImported !== true &&
    (existing.preventSleep !== undefined ||
      existing.allowCrossProjectThreadCommands !== undefined ||
      existing.lastHumanInputAtBySession !== undefined ||
      existing.sessionOrigins !== undefined)
  );
}

/** Atomic JSON persistence entry point for other app-owned private stores. */
export async function writeJsonAtomicForAppStore(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomicQueued(filePath, `${JSON.stringify(value)}\n`, (stored) => stored);
}

/** Layouts are per-task conveniences: one bad layout must not block the rest of saved UI state. */
function decodeWorkbenchTemplates(value: unknown): Record<string, TaskWorkbenchTemplate> {
  const records = objectRecord(value);
  if (!records) {
    console.warn("[app-store] dropped invalid ui-state taskWorkbenchTemplatesBySession");
    return {};
  }
  return Object.fromEntries(
    Object.entries(records).flatMap(([key, template]) => {
      try {
        if (!key || key.length > 8192) throw new Error("Invalid workbench task reference");
        return [[key, decodeTaskWorkbenchTemplate(template)] as const];
      } catch (error) {
        console.warn(
          `[app-store] dropped invalid ui-state workbench layout for ${key.slice(0, 200)}:`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
    }),
  );
}

function validateUiState(value: unknown): Record<string, unknown> {
  const root = objectRecord(value);
  if (!root) throw new Error("Invalid ui-state: expected an object; original data was retained.");
  const fail = (field: string): never => {
    throw new Error(`Invalid ui-state field ${field}; original data was retained.`);
  };
  if (
    (Object.getPrototypeOf(root) !== Object.prototype && Object.getPrototypeOf(root) !== null) ||
    Object.getOwnPropertySymbols(root).length > 0
  ) {
    fail("ui-state (expected a plain object with data properties)");
  }
  const knownKeys = (record: Record<string, unknown>, keys: readonly string[], path: string) => {
    for (const key of Object.keys(record))
      if (!keys.includes(key)) fail(`${path}.${key} (unsupported field)`);
  };
  const optionalDataProperty = (
    object: Record<string, unknown>,
    key: string,
  ): unknown | undefined => {
    if (!Object.hasOwn(object, key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return fail(`${key} (expected an enumerable data property)`);
    }
    return descriptor.value;
  };
  knownKeys(
    root,
    [
      "version",
      "taskWorkbenchTemplatesBySession",
      "selectedWorkspaceId",
      "selectedSessionId",
      "activeView",
      "composerDraft",
      "composerDraftsBySession",
      "extensionCommandCompatibilityByWorkspace",
      "extensionFlagsByWorkspace",
      "extensionFlagsBySession",
      "notificationPreferences",
      "disabledBuiltinExtensions",
      "integratedTerminalShell",
      "lastViewedAtBySession",
      "lastInteractedAtBySession",
      "lastHumanInputAtBySession",
      "pinnedAtBySession",
      "pinnedSessionOrder",
      "workspaceOrder",
      "modelSettingsScopeMode",
      "appGlobalModelSettings",
      "sidebarCollapsed",
      "threadGrouping",
      "collapsedWorkspaceIds",
      "folderPreferencesByWorkspace",
      "allThreadsSort",
      "createdAtBySession",
      "initiatingOriginBySession",
      "sessionOrigins",
      "allowMultiple",
      "allowCrossProjectThreadCommands",
      "enableTransparency",
      "preventSleep",
      "themeMode",
      "themePresetId",
      "orchestrationChildren",
      "workspaceAccentColors",
      "activityIndicatorPreference",
      "legacyRepairUiStateImported",
      "composerAttachmentsBySession",
      "transcripts",
    ],
    "ui-state",
  );
  const optional = (
    object: Record<string, unknown>,
    key: string,
    valid: (v: unknown) => boolean,
    path = key,
  ) => {
    if (object[key] !== undefined && !valid(object[key])) fail(path);
  };
  const string = (v: unknown) => typeof v === "string";
  const boolean = (v: unknown) => typeof v === "boolean";
  const strings = (v: unknown) => Array.isArray(v) && v.every(string);
  const stringRecord = (v: unknown) => {
    const r = objectRecord(v);
    return !!r && Object.values(r).every(string);
  };
  optional(root, "version", (v) => toPersistedVersion(v) !== undefined);
  if (
    root.taskWorkbenchTemplatesBySession !== undefined &&
    typeof root.version === "number" &&
    root.version < 18
  )
    fail("workbench templates before v18");
  for (const key of [
    "selectedWorkspaceId",
    "selectedSessionId",
    "composerDraft",
    "integratedTerminalShell",
  ])
    optional(root, key, string);
  for (const key of [
    "composerDraftsBySession",
    "lastViewedAtBySession",
    "lastInteractedAtBySession",
    "lastHumanInputAtBySession",
    "pinnedAtBySession",
  ])
    optional(root, key, stringRecord);
  for (const key of [
    "pinnedSessionOrder",
    "workspaceOrder",
    "disabledBuiltinExtensions",
    "collapsedWorkspaceIds",
  ])
    optional(root, key, strings);
  for (const key of [
    "sidebarCollapsed",
    "allowMultiple",
    "allowCrossProjectThreadCommands",
    "enableTransparency",
    "legacyRepairUiStateImported",
    "preventSleep",
  ])
    optional(root, key, boolean);
  optional(root, "activeView", (v) => toAppView(v) !== undefined);
  optional(root, "threadGrouping", isThreadGrouping);
  optional(root, "allThreadsSort", sidebarPreferences_isSort);
  optional(root, "folderPreferencesByWorkspace", (v) => {
    const r = objectRecord(v);
    return !!r && Object.values(r).every(sidebarPreferences_isFolder);
  });
  optional(root, "initiatingOriginBySession", (v) => {
    const r = objectRecord(v);
    if (!r) return false;
    try {
      for (const value of Object.values(r)) childSelection_decodeInitiatingOrigin(value);
    } catch {
      return false;
    }
    return true;
  });
  optional(root, "sessionOrigins", (v) => {
    const r = objectRecord(v);
    if (!r) return false;
    return Object.values(r).every((value) => {
      const origin = objectRecord(value);
      if (!origin) return false;
      const keys = Object.keys(origin);
      return (
        keys.every((key) => ["kind", "parentWorkspaceId", "parentSessionId"].includes(key)) &&
        ["human", "scheduled", "subagent", "tool"].includes(origin.kind as string) &&
        (origin.parentWorkspaceId === undefined || typeof origin.parentWorkspaceId === "string") &&
        (origin.parentSessionId === undefined || typeof origin.parentSessionId === "string")
      );
    });
  });
  optional(root, "createdAtBySession", (v) => {
    const r = objectRecord(v);
    return (
      !!r &&
      Object.values(r).every((at) => typeof at === "string" && Number.isFinite(Date.parse(at)))
    );
  });
  optional(root, "themeMode", isThemeMode);
  optional(root, "themePresetId", isThemePresetId);
  const workspaceAccentColors = optionalDataProperty(root, "workspaceAccentColors");
  if (workspaceAccentColors !== undefined) {
    if (typeof root.version === "number" && root.version < 20)
      fail("workspaceAccentColors before v20");
    try {
      projectIdentity_decodeAccentColors(workspaceAccentColors);
    } catch {
      fail("workspaceAccentColors");
    }
  }
  const activityIndicatorPreference = optionalDataProperty(root, "activityIndicatorPreference");
  if (activityIndicatorPreference !== undefined) {
    if (typeof root.version === "number" && root.version < 20)
      fail("activityIndicatorPreference before v20");
    try {
      sidebarPreferences_decodeDurableActivityPreference(activityIndicatorPreference);
    } catch {
      fail("activityIndicatorPreference");
    }
  }
  optional(root, "modelSettingsScopeMode", (v) => v === "per-repo" || v === "app-global");
  if (root.notificationPreferences !== undefined) {
    const preferences =
      objectRecord(root.notificationPreferences) ?? fail("notificationPreferences");
    knownKeys(
      preferences,
      ["backgroundCompletion", "backgroundFailure", "attentionNeeded"],
      "notificationPreferences",
    );
    for (const key of ["backgroundCompletion", "backgroundFailure", "attentionNeeded"])
      optional(preferences, key, boolean, `notificationPreferences.${key}`);
  }
  if (root.appGlobalModelSettings !== undefined) {
    const settings = objectRecord(root.appGlobalModelSettings) ?? fail("appGlobalModelSettings");
    knownKeys(
      settings,
      ["defaultProvider", "defaultModelId", "defaultThinkingLevel", "enabledModelPatterns"],
      "appGlobalModelSettings",
    );
    for (const key of ["defaultProvider", "defaultModelId"])
      optional(settings, key, string, `appGlobalModelSettings.${key}`);
    optional(
      settings,
      "defaultThinkingLevel",
      (v) =>
        ["off", "minimal", "low", "medium", "high", "xhigh", "max"].some((level) => level === v),
      "appGlobalModelSettings.defaultThinkingLevel",
    );
    optional(
      settings,
      "enabledModelPatterns",
      strings,
      "appGlobalModelSettings.enabledModelPatterns",
    );
  }
  for (const key of ["extensionFlagsByWorkspace", "extensionFlagsBySession"]) {
    if (root[key] === undefined) continue;
    const records = objectRecord(root[key]) ?? fail(key);
    for (const [id, flags] of Object.entries(records)) {
      const values = objectRecord(flags);
      if (
        !id ||
        !values ||
        !Object.entries(values).every(
          ([name, value]) => name && (typeof value === "boolean" || typeof value === "string"),
        )
      )
        fail(`${key}.${id}`);
    }
  }
  if (root.extensionCommandCompatibilityByWorkspace !== undefined) {
    const records =
      objectRecord(root.extensionCommandCompatibilityByWorkspace) ??
      fail("extensionCommandCompatibilityByWorkspace");
    for (const [key, entries] of Object.entries(records))
      if (
        !key ||
        !Array.isArray(entries) ||
        !entries.every((entry) => toPersistedCompatibilityRecord(entry) !== undefined)
      )
        fail(`extensionCommandCompatibilityByWorkspace.${key}`);
    for (const entries of Object.values(records)) {
      for (const entry of entries as unknown[])
        knownKeys(
          objectRecord(entry)!,
          ["commandName", "extensionPath", "status", "message", "capability", "updatedAt"],
          "extensionCommandCompatibilityByWorkspace",
        );
    }
  }
  for (const key of ["composerAttachmentsBySession", "transcripts"]) {
    if (root[key] === undefined) continue;
    const records = objectRecord(root[key]) ?? fail(key);
    for (const [id, entries] of Object.entries(records))
      if (
        !id ||
        !Array.isArray(entries) ||
        !entries.every((entry) => objectRecord(entry) !== undefined)
      )
        fail(`${key}.${id}`);
    if (key === "composerAttachmentsBySession")
      for (const entries of Object.values(records)) decodeAttachments(entries);
  }
  if (root.orchestrationChildren !== undefined) {
    if (!Array.isArray(root.orchestrationChildren)) fail("orchestrationChildren");
    const children = root.orchestrationChildren as unknown[];
    for (const [index, child] of children.entries()) {
      const path = `orchestrationChildren[${index}]`;
      const record = objectRecord(child) ?? fail(path);
      knownKeys(
        record,
        [
          "id",
          "sourceToolCallId",
          "origin",
          "selectedConfig",
          "modelProvider",
          "modelId",
          "thinkingLevel",
          "parentWorkspaceId",
          "parentSessionId",
          "childWorkspaceId",
          "childSessionId",
          "title",
          "goal",
          "status",
          "latestTranscript",
          "transcript",
          "evidence",
          "supervisionLoop",
          "createdAt",
          "updatedAt",
        ],
        path,
      );
      if (toPersistedOrchestrationChildren([child])?.length !== 1) fail(path);
      if (record.origin !== undefined) {
        const origin = childSelection_decodeOrigin(record.origin);
        if (
          origin.parentWorkspaceId !== record.parentWorkspaceId ||
          origin.parentSessionId !== record.parentSessionId ||
          origin.sourceToolCallId !== record.sourceToolCallId
        )
          fail(`${path}.origin`);
      }
      if (record.selectedConfig !== undefined)
        childSelection_decodeSelectedConfig(record.selectedConfig);
      for (const key of ["modelProvider", "modelId", "thinkingLevel"])
        optional(record, key, string, `${path}.${key}`);
      for (const key of [
        "id",
        "sourceToolCallId",
        "parentWorkspaceId",
        "parentSessionId",
        "childWorkspaceId",
        "childSessionId",
        "title",
        "goal",
        "latestTranscript",
        "createdAt",
        "updatedAt",
      ])
        optional(record, key, string, `${path}.${key}`);
      optional(
        record,
        "status",
        (v) => toOptionalOrchestrationStatus(v) !== undefined,
        `${path}.status`,
      );
      if (record.transcript !== undefined) {
        if (!Array.isArray(record.transcript)) fail(`${path}.transcript`);
        for (const message of record.transcript as unknown[]) {
          const m = objectRecord(message) ?? fail(`${path}.transcript`);
          knownKeys(m, ["id", "role", "text", "createdAt"], `${path}.transcript`);
          if (
            !["parent", "child", "system"].some((role) => role === m.role) ||
            ![m.id, m.text, m.createdAt].every(string)
          )
            fail(`${path}.transcript`);
        }
      }
      if (record.evidence !== undefined) {
        if (!Array.isArray(record.evidence)) fail(`${path}.evidence`);
        for (const entry of record.evidence as unknown[]) {
          if (toPersistedEvidence([entry], String(record.id)).length !== 1)
            fail(`${path}.evidence`);
          const evidence = objectRecord(entry) ?? fail(`${path}.evidence`);
          knownKeys(
            evidence,
            [
              "id",
              "childThreadId",
              "kind",
              "source",
              "status",
              "title",
              "detail",
              "command",
              "toolName",
              "severity",
              "parentSessionId",
              "childSessionId",
              "git",
              "createdAt",
              "updatedAt",
            ],
            `${path}.evidence`,
          );
          for (const key of [
            "detail",
            "command",
            "toolName",
            "parentSessionId",
            "childSessionId",
            "updatedAt",
          ])
            optional(evidence, key, string, `${path}.evidence.${key}`);
          optional(
            evidence,
            "severity",
            (v) => toEvidenceSeverity(v) !== undefined,
            `${path}.evidence.severity`,
          );
          if (evidence.git !== undefined) {
            const git = objectRecord(evidence.git) ?? fail(`${path}.evidence.git`);
            knownKeys(git, ["workspaceId", "branchName", "headSha"], `${path}.evidence.git`);
            if (!toEvidenceGit(git)) fail(`${path}.evidence.git`);
            for (const key of ["branchName", "headSha"])
              optional(git, key, string, `${path}.evidence.git.${key}`);
          }
        }
      }
      if (
        record.supervisionLoop !== undefined &&
        !toPersistedSupervisionLoop(record.supervisionLoop, toOrchestrationStatus(record.status))
      )
        fail(`${path}.supervisionLoop`);
      if (record.supervisionLoop !== undefined) {
        const loop = objectRecord(record.supervisionLoop) ?? fail(`${path}.supervisionLoop`);
        knownKeys(
          loop,
          [
            "id",
            "status",
            "gate",
            "intervalMs",
            "iterationCount",
            "lastCheckedAt",
            "nextRunAt",
            "reason",
            "lastChildStatus",
            "stoppedAt",
          ],
          `${path}.supervisionLoop`,
        );
        for (const key of ["nextRunAt", "stoppedAt"])
          optional(loop, key, string, `${path}.supervisionLoop.${key}`);
        optional(
          loop,
          "lastChildStatus",
          (v) => toOptionalOrchestrationStatus(v) !== undefined,
          `${path}.supervisionLoop.lastChildStatus`,
        );
      }
    }
  }
  return root;
}

function toThemeMode(value: unknown): ThemeMode | undefined {
  return isThemeMode(value) ? value : undefined;
}

function toThemePresetId(value: unknown): ThemePresetId | undefined {
  return isThemePresetId(value) ? value : undefined;
}

function toAppView(value: unknown): AppView | undefined {
  return value === "threads" ||
    value === "new-thread" ||
    value === "scheduled" ||
    value === "skills" ||
    value === "extensions" ||
    value === "settings"
    ? value
    : undefined;
}

function toPersistedVersion(value: unknown): NonNullable<PersistedUiState["version"]> | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 20
    ? (value as NonNullable<PersistedUiState["version"]>)
    : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toPersistedOrchestrationChildren(value: unknown): OrchestrationChildThread[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((entry): OrchestrationChildThread[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    const id = stringValue(candidate.id);
    const parentWorkspaceId = stringValue(candidate.parentWorkspaceId);
    const parentSessionId = stringValue(candidate.parentSessionId);
    const childWorkspaceId = stringValue(candidate.childWorkspaceId) ?? parentWorkspaceId ?? "";
    const childSessionId = stringValue(candidate.childSessionId) ?? "";
    const title = stringValue(candidate.title);
    const goal = stringValue(candidate.goal);
    const createdAt = stringValue(candidate.createdAt);
    const updatedAt = stringValue(candidate.updatedAt);
    if (
      !id ||
      !parentWorkspaceId ||
      !parentSessionId ||
      !title ||
      !goal ||
      !createdAt ||
      !updatedAt
    ) {
      return [];
    }

    const transcript = Array.isArray(candidate.transcript)
      ? candidate.transcript.flatMap((message): OrchestrationChildTranscriptMessage[] => {
          if (!message || typeof message !== "object") {
            return [];
          }
          const record = message as Record<string, unknown>;
          const messageId = stringValue(record.id);
          const role =
            record.role === "parent" || record.role === "child" || record.role === "system"
              ? record.role
              : undefined;
          const text = stringValue(record.text);
          const messageCreatedAt = stringValue(record.createdAt);
          if (!messageId || !role || !text || !messageCreatedAt) {
            return [];
          }
          return [{ id: messageId, role, text, createdAt: messageCreatedAt }];
        })
      : [];
    const retainedTranscript = transcript.slice(-MAX_PERSISTED_ORCHESTRATION_TRANSCRIPT_MESSAGES);

    const sourceToolCallId = stringValue(candidate.sourceToolCallId);
    const status = toOrchestrationStatus(candidate.status);
    const supervisionLoop = toPersistedSupervisionLoop(candidate.supervisionLoop, status);
    const legacySelectedConfig =
      candidate.modelProvider !== undefined ||
      candidate.modelId !== undefined ||
      candidate.thinkingLevel !== undefined
        ? childSelection_decodeSelectedConfig({
            provider: candidate.modelProvider,
            modelId: candidate.modelId,
            thinkingLevel: candidate.thinkingLevel,
          })
        : undefined;
    return [
      {
        id,
        ...(sourceToolCallId ? { sourceToolCallId } : {}),
        ...(candidate.origin === undefined
          ? {}
          : { origin: childSelection_decodeOrigin(candidate.origin) }),
        ...(candidate.selectedConfig === undefined
          ? legacySelectedConfig
            ? { selectedConfig: legacySelectedConfig }
            : {}
          : { selectedConfig: childSelection_decodeSelectedConfig(candidate.selectedConfig) }),
        parentWorkspaceId,
        parentSessionId,
        childWorkspaceId,
        childSessionId,
        title,
        goal,
        status,
        latestTranscript:
          stringValue(candidate.latestTranscript) || retainedTranscript.at(-1)?.text || goal,
        transcript: retainedTranscript,
        evidence: toPersistedEvidence(candidate.evidence, id),
        ...(supervisionLoop ? { supervisionLoop } : {}),
        createdAt,
        updatedAt,
      },
    ];
  });
}

function toPersistedEvidence(value: unknown, childThreadId: string): OrchestrationEvidenceRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const records = value.flatMap((entry): OrchestrationEvidenceRecord[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    const id = stringValue(candidate.id);
    const kind = toEvidenceKind(candidate.kind);
    const source = toEvidenceSource(candidate.source);
    const status = toEvidenceStatus(candidate.status);
    const title = stringValue(candidate.title);
    const createdAt = stringValue(candidate.createdAt);
    if (!id || !kind || !source || !status || !title || !createdAt) {
      return [];
    }

    const gitCandidate = candidate.git;
    const git =
      gitCandidate && typeof gitCandidate === "object"
        ? toEvidenceGit(gitCandidate as Record<string, unknown>)
        : undefined;

    return [
      {
        id,
        childThreadId,
        kind,
        source,
        status,
        title,
        ...(stringValue(candidate.detail) ? { detail: stringValue(candidate.detail) } : {}),
        ...(stringValue(candidate.command) ? { command: stringValue(candidate.command) } : {}),
        ...(stringValue(candidate.toolName) ? { toolName: stringValue(candidate.toolName) } : {}),
        ...(toEvidenceSeverity(candidate.severity)
          ? { severity: toEvidenceSeverity(candidate.severity) }
          : {}),
        ...(stringValue(candidate.parentSessionId)
          ? { parentSessionId: stringValue(candidate.parentSessionId) }
          : {}),
        ...(stringValue(candidate.childSessionId)
          ? { childSessionId: stringValue(candidate.childSessionId) }
          : {}),
        ...(git ? { git } : {}),
        createdAt,
        ...(stringValue(candidate.updatedAt)
          ? { updatedAt: stringValue(candidate.updatedAt) }
          : {}),
      },
    ];
  });
  return records.slice(0, MAX_PERSISTED_ORCHESTRATION_EVIDENCE_RECORDS);
}

function toEvidenceGit(
  value: Record<string, unknown>,
): OrchestrationEvidenceRecord["git"] | undefined {
  const workspaceId = stringValue(value.workspaceId);
  if (!workspaceId) {
    return undefined;
  }
  return {
    workspaceId,
    ...(stringValue(value.branchName) ? { branchName: stringValue(value.branchName) } : {}),
    ...(stringValue(value.headSha) ? { headSha: stringValue(value.headSha) } : {}),
  };
}

function toEvidenceKind(value: unknown): OrchestrationEvidenceRecord["kind"] | undefined {
  return value === "worker_report" ||
    value === "orchestrator_acceptance" ||
    value === "orchestrator_observation" ||
    value === "orchestrator_action" ||
    value === "command" ||
    value === "review_finding" ||
    value === "blocker"
    ? value
    : undefined;
}

function toEvidenceSource(value: unknown): OrchestrationEvidenceRecord["source"] | undefined {
  return value === "worker-reported" ||
    value === "orchestrator-accepted" ||
    value === "orchestrator-observed" ||
    value === "orchestrator-action" ||
    value === "command" ||
    value === "review" ||
    value === "blocker"
    ? value
    : undefined;
}

function toEvidenceStatus(value: unknown): OrchestrationEvidenceRecord["status"] | undefined {
  return value === "reported" ||
    value === "accepted" ||
    value === "running" ||
    value === "passed" ||
    value === "failed" ||
    value === "blocked"
    ? value
    : undefined;
}

function toEvidenceSeverity(value: unknown): OrchestrationEvidenceRecord["severity"] | undefined {
  return value === "P0" || value === "P1" || value === "P2" || value === "P3" ? value : undefined;
}

function toPersistedSupervisionLoop(
  value: unknown,
  lastChildStatus: OrchestrationChildThread["status"],
): OrchestrationSupervisionLoop | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const id = stringValue(candidate.id);
  const status = toSupervisionStatus(candidate.status);
  const gate = toSupervisionGate(candidate.gate);
  const intervalMs = numberValue(candidate.intervalMs);
  const iterationCount = numberValue(candidate.iterationCount);
  const lastCheckedAt = stringValue(candidate.lastCheckedAt);
  const reason = stringValue(candidate.reason);
  if (
    !id ||
    !status ||
    !gate ||
    !intervalMs ||
    iterationCount === undefined ||
    !lastCheckedAt ||
    !reason
  ) {
    return undefined;
  }
  return {
    id,
    status,
    gate,
    intervalMs,
    iterationCount,
    lastCheckedAt,
    ...(stringValue(candidate.nextRunAt) ? { nextRunAt: stringValue(candidate.nextRunAt) } : {}),
    reason,
    lastChildStatus: toOptionalOrchestrationStatus(candidate.lastChildStatus) ?? lastChildStatus,
    ...(stringValue(candidate.stoppedAt) ? { stoppedAt: stringValue(candidate.stoppedAt) } : {}),
  };
}

function toSupervisionStatus(value: unknown): OrchestrationSupervisionLoop["status"] | undefined {
  return value === "monitoring" || value === "attention" || value === "stopped" ? value : undefined;
}

function toSupervisionGate(value: unknown): OrchestrationSupervisionLoop["gate"] | undefined {
  return value === "continue" || value === "stop" || value === "wake" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toNotificationPreferences(value: unknown): Partial<NotificationPreferences> | undefined {
  const candidate = objectRecord(value);
  if (!candidate) {
    return undefined;
  }
  const preferences = {
    ...(typeof candidate.backgroundCompletion === "boolean"
      ? { backgroundCompletion: candidate.backgroundCompletion }
      : {}),
    ...(typeof candidate.backgroundFailure === "boolean"
      ? { backgroundFailure: candidate.backgroundFailure }
      : {}),
    ...(typeof candidate.attentionNeeded === "boolean"
      ? { attentionNeeded: candidate.attentionNeeded }
      : {}),
  };
  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  const candidate = objectRecord(value);
  if (!candidate) {
    return undefined;
  }

  const entries = Object.entries(candidate).filter(
    (entry): entry is [string, string] =>
      Boolean(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1]),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Prefer the current activity field while importing the installed 1.0.14 name. */
function mergeStringRecords(
  legacyValue: unknown,
  currentValue: unknown,
): Record<string, string> | undefined {
  const legacy = toStringRecord(legacyValue);
  const current = toStringRecord(currentValue);
  if (!legacy && !current) {
    return undefined;
  }
  const merged = Object.create(null) as Record<string, string>;
  for (const source of [legacy, current]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      merged[key] = value;
    }
  }
  return merged;
}

function toLegacySessionOrigins(value: unknown): Record<string, LegacySessionOrigin> | undefined {
  const entries = Object.entries(objectRecord(value) ?? {}).flatMap(
    ([key, value]): [string, LegacySessionOrigin][] => {
      if (!key) return [];
      const origin = objectRecord(value);
      if (!origin) return [];
      const kind = origin.kind;
      if (kind !== "human" && kind !== "scheduled" && kind !== "subagent" && kind !== "tool") {
        return [];
      }
      const parentWorkspaceId =
        typeof origin.parentWorkspaceId === "string" ? origin.parentWorkspaceId : undefined;
      const parentSessionId =
        typeof origin.parentSessionId === "string" ? origin.parentSessionId : undefined;
      return [
        [
          key,
          {
            kind,
            ...(parentWorkspaceId === undefined ? {} : { parentWorkspaceId }),
            ...(parentSessionId === undefined ? {} : { parentSessionId }),
          },
        ],
      ];
    },
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** Merge legacy child origins with the current host-authored initiating-origin projection. */
function mergeInitiatingOrigins(
  legacyValue: unknown,
  currentValue: unknown,
): Record<string, SessionInitiatingOrigin> | undefined {
  const legacy = toLegacySessionOrigins(legacyValue);
  const current = objectRecord(currentValue);
  if (!legacy && !current) {
    return undefined;
  }
  const merged = Object.create(null) as Record<string, SessionInitiatingOrigin>;
  for (const [key, origin] of Object.entries(legacy ?? {})) {
    merged[key] = {
      kind: origin.kind === "subagent" ? "tool" : origin.kind,
      source: "desktop-host",
    };
  }
  for (const [key, origin] of Object.entries(current ?? {})) {
    merged[key] = childSelection_decodeInitiatingOrigin(origin);
  }
  return merged;
}

/** Shape is checked by validateUiState; empty records are dropped. */
function toExtensionFlagRecords(value: unknown): Record<string, ExtensionFlagValues> | undefined {
  const entries = Object.entries(objectRecord(value) ?? {}).flatMap(([id, flags]) => {
    const values = objectRecord(flags);
    return values && Object.keys(values).length > 0
      ? [[id, values as ExtensionFlagValues] as const]
      : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toPersistedCompatibilityByWorkspace(
  value: unknown,
): Record<string, readonly ExtensionCommandCompatibilityRecord[]> | undefined {
  const candidate = objectRecord(value);
  if (!candidate) {
    return undefined;
  }

  const entries = Object.entries(candidate).flatMap(([workspaceId, records]) => {
    if (!workspaceId || !Array.isArray(records)) {
      return [];
    }
    const validRecords = records.flatMap((record) => {
      const parsed = toPersistedCompatibilityRecord(record);
      return parsed ? [parsed] : [];
    });
    return validRecords.length > 0 ? [[workspaceId, validRecords] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toPersistedCompatibilityRecord(
  value: unknown,
): ExtensionCommandCompatibilityRecord | undefined {
  const candidate = objectRecord(value);
  if (
    !candidate ||
    typeof candidate.commandName !== "string" ||
    typeof candidate.extensionPath !== "string" ||
    (candidate.status !== "supported" && candidate.status !== "terminal-only") ||
    typeof candidate.message !== "string" ||
    typeof candidate.capability !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    commandName: candidate.commandName,
    extensionPath: candidate.extensionPath,
    status: candidate.status,
    message: candidate.message,
    capability: candidate.capability,
    updatedAt: candidate.updatedAt,
  };
}

function toObjectArrayRecord(value: unknown): Record<string, readonly unknown[]> | undefined {
  const candidate = objectRecord(value);
  if (!candidate) {
    return undefined;
  }

  const entries = Object.entries(candidate).flatMap(([key, values]) => {
    if (!key || !Array.isArray(values)) {
      return [];
    }
    const objectValues = values.filter((entry) => Boolean(objectRecord(entry)));
    return objectValues.length > 0 ? [[key, objectValues] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toOrchestrationStatus(value: unknown): OrchestrationChildThread["status"] {
  return toOptionalOrchestrationStatus(value) ?? "running";
}

function toOptionalOrchestrationStatus(
  value: unknown,
): OrchestrationChildThread["status"] | undefined {
  return value === "queued" ||
    value === "waiting" ||
    value === "complete" ||
    value === "cancelled" ||
    value === "failed" ||
    value === "running"
    ? value
    : undefined;
}

function toPersistedModelSettingsSnapshot(value: unknown): ModelSettingsSnapshot | undefined {
  const candidate = objectRecord(value);
  if (!candidate) {
    return undefined;
  }
  const enabledModelPatterns = Array.isArray(candidate.enabledModelPatterns)
    ? candidate.enabledModelPatterns.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    ...(typeof candidate.defaultProvider === "string"
      ? { defaultProvider: candidate.defaultProvider }
      : {}),
    ...(typeof candidate.defaultModelId === "string"
      ? { defaultModelId: candidate.defaultModelId }
      : {}),
    ...(typeof candidate.defaultThinkingLevel === "string"
      ? {
          defaultThinkingLevel:
            candidate.defaultThinkingLevel as ModelSettingsSnapshot["defaultThinkingLevel"],
        }
      : {}),
    enabledModelPatterns,
  };
}
const MAX_PERSISTED_ORCHESTRATION_TRANSCRIPT_MESSAGES = 40;
const MAX_PERSISTED_ORCHESTRATION_EVIDENCE_RECORDS = 80;
