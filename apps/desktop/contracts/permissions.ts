/**
 * Browser-safe permission contracts.
 *
 * Every exported value is bounded JSON data. This module performs no native
 * calls, I/O, discovery, timing, or feature execution. In particular, an
 * interaction receipt can never stand in for authorization or feature success.
 */

export const permission_schemaVersion = 1 as const;

export const permission_maxIdentifierLength = 128;
export const permission_maxTextLength = 512;
export const permission_maxPathLength = 1_024;
export const permission_maxCollectionLength = 64;

export const permission_platforms = ["macos", "windows", "linux"] as const;
export type PermissionPlatform = (typeof permission_platforms)[number];

export const permission_capabilityIds = [
  "notifications",
  "selected-files",
  "accessibility",
  "automation",
  "screen-capture",
  "camera",
  "microphone",
  "full-disk-access",
  "privilege-elevation",
  "inbound-firewall",
  "service-lifecycle",
  "portal-session",
  "remote-control",
] as const;
export type PermissionCapabilityId = (typeof permission_capabilityIds)[number];

export const permission_scopeKinds = [
  "app-default",
  "notification-categories",
  "selected-resource",
  "target-application",
  "capture-source",
  "media-stream",
  "named-operation",
  "network-endpoint",
  "service-session",
] as const;
export type PermissionScopeKind = (typeof permission_scopeKinds)[number];

export const permission_capabilityScopeKinds = {
  notifications: ["app-default", "notification-categories"],
  "selected-files": ["selected-resource"],
  accessibility: ["app-default", "named-operation"],
  automation: ["target-application"],
  "screen-capture": ["capture-source", "media-stream"],
  camera: ["media-stream"],
  microphone: ["media-stream"],
  "full-disk-access": ["app-default"],
  "privilege-elevation": ["named-operation"],
  "inbound-firewall": ["network-endpoint"],
  "service-lifecycle": ["service-session"],
  "portal-session": ["capture-source", "media-stream", "named-operation"],
  "remote-control": ["target-application", "service-session"],
} as const satisfies Readonly<Record<PermissionCapabilityId, readonly PermissionScopeKind[]>>;

export const permission_recipientKinds = ["main-app", "helper", "browser", "companion"] as const;
export type PermissionRecipientKind = (typeof permission_recipientKinds)[number];

export const permission_recipientStatuses = [
  "verified",
  "ambiguous",
  "unavailable",
  "unsupported",
] as const;
export type PermissionRecipientStatus = (typeof permission_recipientStatuses)[number];

export const permission_identitySources = [
  "installed-package",
  "explicit-parent-bundle",
  "unverified",
] as const;
export type PermissionIdentitySource = (typeof permission_identitySources)[number];

export const permission_authorizationKinds = [
  "not-determined",
  "denied",
  "authorized",
  "provisional",
  "ephemeral",
  "restricted-managed",
  "unsupported",
  "unavailable",
  "unknown",
] as const;
export type PermissionAuthorizationKind = (typeof permission_authorizationKinds)[number];

export const permission_authorizationSources = [
  "native",
  "browser",
  "capability-probe",
  "fixture",
] as const;
export type PermissionAuthorizationSource = (typeof permission_authorizationSources)[number];

export const permission_settingsOpenStates = [
  "not-attempted",
  "accepted",
  "failed",
  "unknown",
] as const;
export type PermissionSettingsOpenState = (typeof permission_settingsOpenStates)[number];

export const permission_requestStates = [
  "not-attempted",
  "accepted",
  "denied",
  "cancelled",
  "failed",
  "unsupported",
  "unavailable",
  "unknown",
] as const;
export type PermissionRequestState = (typeof permission_requestStates)[number];

export const permission_revealStates = ["not-attempted", "accepted", "failed", "unknown"] as const;
export type PermissionRevealState = (typeof permission_revealStates)[number];

export const permission_dragResults = [
  "unavailable",
  "started",
  "unsupported",
  "failed",
  "unknown",
] as const;
export type PermissionDragResult = (typeof permission_dragResults)[number];

export const permission_featureStates = [
  "succeeded",
  "denied",
  "cancelled",
  "failed",
  "unsupported",
  "unavailable",
  "unknown",
] as const;
export type PermissionFeatureState = (typeof permission_featureStates)[number];

export const permission_reasonCodes = [
  "access-denied",
  "cancelled",
  "identity-ambiguous",
  "identity-unavailable",
  "managed-restriction",
  "not-implemented",
  "pane-evidence-unavailable",
  "package-unverified",
  "probe-failed",
  "revoked",
  "stale-scope",
  "unsupported-platform",
  "unknown",
] as const;
export type PermissionReasonCode = (typeof permission_reasonCodes)[number];

export const permission_panes = [
  "accessibility",
  "automation",
  "files-and-folders",
  "camera",
  "microphone",
  "notifications",
  "screen-and-system-audio-recording",
  "full-disk-access",
] as const;
export type PermissionPane = (typeof permission_panes)[number];

export const permission_paneCapabilityIds = {
  accessibility: "accessibility",
  automation: "automation",
  "files-and-folders": "selected-files",
  camera: "camera",
  microphone: "microphone",
  notifications: "notifications",
  "screen-and-system-audio-recording": "screen-capture",
  "full-disk-access": "full-disk-access",
} as const satisfies Readonly<Record<PermissionPane, PermissionCapabilityId>>;

export const permission_manualAddStates = ["documented", "not-documented", "prohibited"] as const;
export type PermissionManualAddState = (typeof permission_manualAddStates)[number];

export const permission_dragAcceptanceStates = ["available", "unavailable", "prohibited"] as const;
export type PermissionDragAcceptanceState = (typeof permission_dragAcceptanceStates)[number];

export const permission_windowsReservedDeviceNames = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
] as const;

export const permission_paneDragEvidenceStates = [
  "verified",
  "unsupported",
  "unavailable",
] as const;
export type PermissionPaneDragEvidenceState = (typeof permission_paneDragEvidenceStates)[number];

export const permission_recoveryTriggers = [
  "denied",
  "unknown",
  "restricted-managed",
  "returned-from-settings",
  "revoked",
  "stale-scope",
  "restart",
] as const;
export type PermissionRecoveryTrigger = (typeof permission_recoveryTriggers)[number];

export const permission_recoveryInstructions = [
  "inspect-authorization",
  "open-settings",
  "show-in-finder",
  "reselect-scope",
  "feature-triggered-request",
  "keep-feature-fallback",
  "administrator-guidance",
  "select-narrower-resource",
] as const;
export type PermissionRecoveryInstruction = (typeof permission_recoveryInstructions)[number];

export const permission_evidenceKinds = [
  "settings-open-attempt",
  "permission-request",
  "reported-authorization",
  "installed-app-reveal",
  "installed-app-drag",
  "feature-operation",
] as const;
export type PermissionEvidenceKind = (typeof permission_evidenceKinds)[number];

export interface PermissionScope {
  readonly kind: PermissionScopeKind;
  readonly scopeKey: string;
  readonly generation: number;
}

export interface PermissionSupportTuple {
  readonly platform: PermissionPlatform;
  readonly osVersion: string;
  readonly osBuild: string;
  readonly architecture: string;
  readonly packageFormat: string;
  readonly installerIdentity: string;
  readonly signerIdentity: string;
  readonly installedIdentityKey: string;
  readonly apiVersion: string;
  readonly desktopSession: string;
  readonly scopeKey: string;
}

export interface InstalledRecipient {
  readonly kind: PermissionRecipientKind;
  readonly status: PermissionRecipientStatus;
  readonly platform: PermissionPlatform;
  readonly displayName: string | null;
  readonly bundleIdentifier: string | null;
  readonly bundlePath: string | null;
  readonly identitySource: PermissionIdentitySource;
  readonly identityKey: string;
  readonly reasonCode: PermissionReasonCode | null;
}

export interface PermissionBinding {
  readonly capabilityId: PermissionCapabilityId;
  readonly platform: PermissionPlatform;
  readonly support: PermissionSupportTuple;
  readonly scope: PermissionScope;
  readonly recipient: InstalledRecipient;
  readonly generation: number;
}

export interface PermissionSupportClassification {
  readonly support: PermissionSupportTuple;
  readonly status: "supported" | "unsupported" | "unavailable" | "unknown";
}

export interface PermissionCapabilityDescriptor {
  readonly capabilityId: PermissionCapabilityId;
  readonly platform: PermissionPlatform;
  readonly scopeKinds: readonly PermissionScopeKind[];
  readonly support: readonly PermissionSupportClassification[];
}

interface PermissionEvidenceBase {
  readonly schemaVersion: typeof permission_schemaVersion;
  readonly evidenceId: string;
  readonly recordedAt: number;
  readonly binding: PermissionBinding;
}

export interface PermissionSettingsOpenAttempt extends PermissionEvidenceBase {
  readonly kind: "settings-open-attempt";
  readonly state: PermissionSettingsOpenState;
  readonly source: "application" | "fixture";
  readonly reasonCode: PermissionReasonCode | null;
}

export interface PermissionRequestOutcome extends PermissionEvidenceBase {
  readonly kind: "permission-request";
  readonly state: PermissionRequestState;
  readonly source: "native" | "application" | "fixture";
  readonly reasonCode: PermissionReasonCode | null;
}

export interface PermissionAuthorizationObservation extends PermissionEvidenceBase {
  readonly kind: "reported-authorization";
  readonly authorization: PermissionAuthorizationKind;
  readonly source: PermissionAuthorizationSource;
  readonly reasonCode: PermissionReasonCode | null;
}

export interface PermissionRevealAttempt extends PermissionEvidenceBase {
  readonly kind: "installed-app-reveal";
  readonly action: "show-in-finder";
  readonly pane: PermissionPane | null;
  readonly state: PermissionRevealState;
  readonly source: "application" | "fixture";
  readonly reasonCode: PermissionReasonCode | null;
}

export interface PermissionDragOutcome extends PermissionEvidenceBase {
  readonly kind: "installed-app-drag";
  readonly pane: PermissionPane;
  readonly result: PermissionDragResult;
  readonly source: "native" | "application" | "fixture";
  readonly reasonCode: PermissionReasonCode | null;
}

export interface PermissionFeatureOperation extends PermissionEvidenceBase {
  readonly kind: "feature-operation";
  readonly state: PermissionFeatureState;
  readonly source: "native" | "application" | "fixture";
  readonly reasonCode: PermissionReasonCode | null;
}

export interface PermissionPaneEvidence {
  readonly schemaVersion: typeof permission_schemaVersion;
  readonly evidenceId: string;
  readonly recordedAt: number;
  readonly pane: PermissionPane;
  readonly dragEvidence: PermissionPaneDragEvidenceState;
  readonly source: "native" | "fixture";
  readonly binding: PermissionBinding;
}

export type PermissionEvidence =
  | PermissionSettingsOpenAttempt
  | PermissionRequestOutcome
  | PermissionAuthorizationObservation
  | PermissionRevealAttempt
  | PermissionDragOutcome
  | PermissionFeatureOperation;

export interface PermissionRecoveryInput {
  readonly schemaVersion: typeof permission_schemaVersion;
  readonly trigger: PermissionRecoveryTrigger;
  readonly occurredAt: number;
  readonly evidence: PermissionEvidence;
}

export interface PermissionRecoveryDecision {
  readonly trigger: PermissionRecoveryTrigger;
  readonly occurredAt: number;
  readonly evidenceId: string;
  readonly instructions: readonly PermissionRecoveryInstruction[];
  readonly requiresInspection: true;
  readonly grantsAuthorization: false;
  readonly reportsFeatureSuccess: false;
  readonly requestsPermissionAction: false;
  readonly requestsFeatureAction: false;
}

/** Typed failure used only to withhold installed-app actions safely. */
export class PermissionInstalledIdentityError extends TypeError {
  readonly code = "invalid-installed-bundle-path" as const;

  constructor(message: string) {
    super(message);
    this.name = "PermissionInstalledIdentityError";
  }
}

function permission_isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function permission_hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownNames = Object.getOwnPropertyNames(value);
  return (
    ownNames.length === keys.length &&
    ownNames.every(
      (key) =>
        keys.includes(key) &&
        Object.prototype.propertyIsEnumerable.call(value, key) &&
        "value" in (Object.getOwnPropertyDescriptor(value, key) ?? {}),
    )
  );
}

function permission_assertJsonData(
  value: unknown,
  location = "$",
  ancestors = new WeakSet<object>(),
  depth = 0,
): void {
  if (depth > 20) throw new TypeError(`${location} exceeds the nesting limit.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${location} must be finite JSON data.`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${location} is not JSON data.`);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${location} cannot contain symbol keys.`);
  }
  if (ancestors.has(value)) throw new TypeError(`${location} cannot contain cycles.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(`${location} must use the standard array prototype.`);
    }
    if (value.length > permission_maxCollectionLength) {
      throw new TypeError(`${location} exceeds the collection limit.`);
    }
    const names = Object.getOwnPropertyNames(value).filter((name) => name !== "length");
    if (names.length !== value.length || names.some((name, index) => name !== String(index))) {
      throw new TypeError(`${location} must be a dense array without extra properties.`);
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${location}[${index}] must be an enumerable data property.`);
      }
      permission_assertJsonData(descriptor.value, `${location}[${index}]`, ancestors, depth + 1);
    }
  } else {
    if (!permission_isRecord(value)) {
      throw new TypeError(`${location} must be a plain JSON object.`);
    }
    const names = Object.getOwnPropertyNames(value);
    if (names.length > permission_maxCollectionLength) {
      throw new TypeError(`${location} has too many fields.`);
    }
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${location}.${name} must be an enumerable data property.`);
      }
      permission_assertJsonData(descriptor.value, `${location}.${name}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function permission_requireShape(
  value: unknown,
  keys: readonly string[],
  location: string,
): Record<string, unknown> {
  permission_assertJsonData(value, location);
  if (!permission_isRecord(value) || !permission_hasOnlyKeys(value, keys)) {
    throw new TypeError(`${location} has an unsupported shape.`);
  }
  return value;
}

function permission_decodeLiteral<T extends string>(
  value: unknown,
  accepted: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !accepted.includes(value as T)) {
    throw new TypeError(`${field} is not an accepted value.`);
  }
  return value as T;
}

function permission_isBoundedString(
  value: unknown,
  maximum = permission_maxIdentifierLength,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function permission_decodeString(
  value: unknown,
  field: string,
  maximum = permission_maxIdentifierLength,
): string {
  if (!permission_isBoundedString(value, maximum)) {
    throw new TypeError(`${field} must be a bounded string.`);
  }
  return value;
}

function permission_decodeNullableString(
  value: unknown,
  field: string,
  maximum = permission_maxTextLength,
): string | null {
  if (value === null) return null;
  return permission_decodeString(value, field, maximum);
}

function permission_decodeSafeInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${field} must be a bounded integer.`);
  }
  return value as number;
}

function permission_decodeTimestamp(value: unknown, field: string): number {
  return permission_decodeSafeInteger(value, field);
}

function permission_decodeNullableReason(
  value: unknown,
  field: string,
): PermissionReasonCode | null {
  if (value === null) return null;
  return permission_decodeLiteral(value, permission_reasonCodes, field);
}

function permission_decodeOpaqueKey(value: unknown, field: string): string {
  if (
    !permission_isBoundedString(value) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ||
    /^(?:sk-|pk-|ghp_|github_pat_|bearer-)/i.test(value)
  ) {
    throw new TypeError(`${field} must be a bounded opaque identifier.`);
  }
  return value;
}

/**
 * Check the path form required for a verified installed macOS parent app.
 *
 * This is representation validation, not filesystem resolution. A future native
 * adapter must still prove mount, bundle, and signature identity.
 */
export function permission_isStableInstalledBundlePath(value: unknown): value is string {
  if (!permission_isBoundedString(value, permission_maxPathLength)) return false;
  if (
    !value.startsWith("/") ||
    !value.toLowerCase().endsWith(".app") ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("//") ||
    value !== value.trim()
  ) {
    return false;
  }
  const parts = value.split("/").slice(1);
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) return false;
  const lowerPath = value.toLowerCase();
  if (
    lowerPath.startsWith("/tmp/") ||
    lowerPath.startsWith("/private/tmp/") ||
    lowerPath.startsWith("/var/tmp/") ||
    lowerPath.startsWith("/private/var/tmp/") ||
    lowerPath.startsWith("/var/folders/") ||
    lowerPath.startsWith("/private/var/folders/") ||
    lowerPath.startsWith("/net/") ||
    /^\/volumes\/(?:network|remote)(?:\s|\/|$)/i.test(value)
  ) {
    return false;
  }
  if (/^\/Applications\/[^/]+\.app$/i.test(value)) return true;
  if (/^\/System\/Applications\/[^/]+\.app$/i.test(value)) return true;
  if (/^\/System\/Applications\/Utilities\/[^/]+\.app$/i.test(value)) return true;
  if (/^\/Users\/[^/]+\/Applications\/[^/]+\.app$/i.test(value)) return true;
  return false;
}

/** Apply Windows reserved DOS-device semantics to one path component. */
export function permission_isWindowsReservedDeviceComponent(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const withoutTrailingDotsAndSpaces = value.replace(/[ .]+$/g, "");
  const basename = withoutTrailingDotsAndSpaces.split(".", 1)[0]?.replace(/ +$/g, "").toUpperCase();
  return (
    basename !== undefined &&
    permission_windowsReservedDeviceNames.includes(
      basename as (typeof permission_windowsReservedDeviceNames)[number],
    )
  );
}

/** Validate a local Windows drive-absolute executable path. UNC/device paths are unsupported. */
export function permission_isWindowsInstalledExecutablePath(value: unknown): value is string {
  if (
    !permission_isBoundedString(value, permission_maxPathLength) ||
    !/^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\") ||
    value.includes("//") ||
    value.includes("\\\\") ||
    value !== value.trim()
  ) {
    return false;
  }
  const separator = value.includes("\\") ? "\\" : "/";
  if (value.includes("\\") && value.includes("/")) return false;
  const parts = value.split(separator);
  if (parts.length < 2 || parts[0]?.length !== 2) return false;
  for (const part of parts.slice(1)) {
    if (
      part.length === 0 ||
      part === "." ||
      part === ".." ||
      /[<>:"|?*\u0000-\u001f]/.test(part) ||
      /[. ]$/.test(part) ||
      permission_isWindowsReservedDeviceComponent(part)
    ) {
      return false;
    }
  }
  const filename = parts.at(-1);
  return filename !== undefined && filename.length > 4 && /\.exe$/i.test(filename);
}

/** Validate a local Linux executable/file path under a native package installation root. */
export function permission_isLinuxNativeExecutablePath(value: unknown): value is string {
  if (
    !permission_isBoundedString(value, permission_maxPathLength) ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes("%") ||
    value !== value.trim() ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  const parts = value.split("/").slice(1);
  if (
    parts.length === 0 ||
    parts.some((part) => part.length === 0 || part === "." || part === "..") ||
    parts.at(-1)?.toLowerCase().endsWith(".app")
  ) {
    return false;
  }
  if (
    /^\/(?:bin|usr\/bin|usr\/local\/bin)\/[^/]+$/.test(value) ||
    /^\/(?:opt|usr\/lib|usr\/libexec)\/(?:[^/]+\/)+[^/]+$/.test(value) ||
    /^\/snap\/[^/]+\/current\/(?:[^/]+\/)*[^/]+$/.test(value) ||
    /^\/app\/(?:[^/]+\/)*[^/]+$/.test(value)
  ) {
    return true;
  }
  return false;
}

function permission_decodeUnique<T extends string>(
  value: unknown,
  accepted: readonly T[],
  field: string,
): readonly T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty bounded array.`);
  }
  const decoded = value.map((item, index) =>
    permission_decodeLiteral(item, accepted, `${field}[${index}]`),
  );
  if (new Set(decoded).size !== decoded.length) throw new TypeError(`${field} must be unique.`);
  return decoded;
}

export function permission_decodeCapabilityId(value: unknown): PermissionCapabilityId {
  permission_assertJsonData(value);
  return permission_decodeLiteral(value, permission_capabilityIds, "capabilityId");
}

export function permission_decodePlatform(value: unknown): PermissionPlatform {
  permission_assertJsonData(value);
  return permission_decodeLiteral(value, permission_platforms, "platform");
}

export function permission_decodePane(value: unknown): PermissionPane {
  permission_assertJsonData(value);
  return permission_decodeLiteral(value, permission_panes, "pane");
}

export function permission_decodeScope(value: unknown): PermissionScope {
  const record = permission_requireShape(value, ["kind", "scopeKey", "generation"], "scope");
  return {
    kind: permission_decodeLiteral(record.kind, permission_scopeKinds, "scope.kind"),
    scopeKey: permission_decodeOpaqueKey(record.scopeKey, "scope.scopeKey"),
    generation: permission_decodeSafeInteger(record.generation, "scope.generation", 1),
  };
}

export function permission_decodeSupportTuple(value: unknown): PermissionSupportTuple {
  const keys = [
    "platform",
    "osVersion",
    "osBuild",
    "architecture",
    "packageFormat",
    "installerIdentity",
    "signerIdentity",
    "installedIdentityKey",
    "apiVersion",
    "desktopSession",
    "scopeKey",
  ] as const;
  const record = permission_requireShape(value, keys, "support");
  return {
    platform: permission_decodePlatform(record.platform),
    osVersion: permission_decodeString(record.osVersion, "support.osVersion"),
    osBuild: permission_decodeString(record.osBuild, "support.osBuild"),
    architecture: permission_decodeString(record.architecture, "support.architecture"),
    packageFormat: permission_decodeString(record.packageFormat, "support.packageFormat"),
    installerIdentity: permission_decodeString(
      record.installerIdentity,
      "support.installerIdentity",
    ),
    signerIdentity: permission_decodeString(record.signerIdentity, "support.signerIdentity"),
    installedIdentityKey: permission_decodeOpaqueKey(
      record.installedIdentityKey,
      "support.installedIdentityKey",
    ),
    apiVersion: permission_decodeString(record.apiVersion, "support.apiVersion"),
    desktopSession: permission_decodeString(record.desktopSession, "support.desktopSession"),
    scopeKey: permission_decodeOpaqueKey(record.scopeKey, "support.scopeKey"),
  };
}

export function permission_decodeInstalledRecipient(value: unknown): InstalledRecipient {
  const keys = [
    "kind",
    "status",
    "platform",
    "displayName",
    "bundleIdentifier",
    "bundlePath",
    "identitySource",
    "identityKey",
    "reasonCode",
  ] as const;
  const record = permission_requireShape(value, keys, "recipient");
  const kind = permission_decodeLiteral(record.kind, permission_recipientKinds, "recipient.kind");
  const status = permission_decodeLiteral(
    record.status,
    permission_recipientStatuses,
    "recipient.status",
  );
  const platform = permission_decodePlatform(record.platform);
  const displayName = permission_decodeNullableString(record.displayName, "recipient.displayName");
  const bundleIdentifier = permission_decodeNullableString(
    record.bundleIdentifier,
    "recipient.bundleIdentifier",
    permission_maxIdentifierLength,
  );
  const bundlePath = permission_decodeNullableString(
    record.bundlePath,
    "recipient.bundlePath",
    permission_maxPathLength,
  );
  const identitySource = permission_decodeLiteral(
    record.identitySource,
    permission_identitySources,
    "recipient.identitySource",
  );
  const identityKey = permission_decodeOpaqueKey(record.identityKey, "recipient.identityKey");
  const reasonCode = permission_decodeNullableReason(record.reasonCode, "recipient.reasonCode");

  if (status !== "verified" && reasonCode === null) {
    throw new TypeError("non-verified recipients require an explicit reason code.");
  }
  if (status === "verified") {
    if (
      identitySource === "unverified" ||
      displayName === null ||
      bundlePath === null ||
      reasonCode !== null
    ) {
      throw new TypeError("verified recipients require bounded verified identity evidence.");
    }
    if (bundleIdentifier !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bundleIdentifier)) {
      throw new TypeError("verified recipient identifiers use a bounded application ID.");
    }
    switch (platform) {
      case "macos":
        if (!bundlePath.startsWith("/")) {
          throw new TypeError("verified macOS recipient paths must be absolute.");
        }
        if (kind === "helper" && bundlePath.endsWith(".app")) {
          throw new TypeError("helper recipients cannot present as an installed app bundle.");
        }
        if (kind === "main-app" && bundlePath.includes("/Contents/MacOS/")) {
          throw new TypeError("an executable inside Contents/MacOS cannot stand in for the app.");
        }
        if (kind === "main-app") {
          if (bundleIdentifier === null) {
            throw new TypeError("verified macOS parent apps require a bundle identifier.");
          }
          if (!permission_isStableInstalledBundlePath(bundlePath)) {
            throw new PermissionInstalledIdentityError(
              "verified macOS app recipients require a stable installed parent .app bundle path.",
            );
          }
        }
        break;
      case "windows":
        if (kind === "main-app" && bundlePath.toLowerCase().endsWith(".app")) {
          throw new TypeError("a macOS app bundle cannot stand in for a Windows executable.");
        }
        if (!permission_isWindowsInstalledExecutablePath(bundlePath)) {
          throw new PermissionInstalledIdentityError(
            "verified Windows recipients require a local drive-absolute executable path.",
          );
        }
        break;
      case "linux":
        if (!permission_isLinuxNativeExecutablePath(bundlePath)) {
          throw new PermissionInstalledIdentityError(
            "verified Linux recipients require a bounded native installation path.",
          );
        }
        break;
    }
  }
  return {
    kind,
    status,
    platform,
    displayName,
    bundleIdentifier,
    bundlePath,
    identitySource,
    identityKey,
    reasonCode,
  };
}

export function permission_sameScope(left: PermissionScope, right: PermissionScope): boolean {
  return (
    left.kind === right.kind &&
    left.scopeKey === right.scopeKey &&
    left.generation === right.generation
  );
}

export function permission_sameRecipient(
  left: InstalledRecipient,
  right: InstalledRecipient,
): boolean {
  return (
    left.kind === right.kind &&
    left.status === right.status &&
    left.platform === right.platform &&
    left.displayName === right.displayName &&
    left.bundleIdentifier === right.bundleIdentifier &&
    left.bundlePath === right.bundlePath &&
    left.identitySource === right.identitySource &&
    left.identityKey === right.identityKey &&
    left.reasonCode === right.reasonCode
  );
}

export function permission_sameSupport(
  left: PermissionSupportTuple,
  right: PermissionSupportTuple,
): boolean {
  return (
    left.platform === right.platform &&
    left.osVersion === right.osVersion &&
    left.osBuild === right.osBuild &&
    left.architecture === right.architecture &&
    left.packageFormat === right.packageFormat &&
    left.installerIdentity === right.installerIdentity &&
    left.signerIdentity === right.signerIdentity &&
    left.installedIdentityKey === right.installedIdentityKey &&
    left.apiVersion === right.apiVersion &&
    left.desktopSession === right.desktopSession &&
    left.scopeKey === right.scopeKey
  );
}

export function permission_decodeBinding(value: unknown): PermissionBinding {
  const keys = ["capabilityId", "platform", "support", "scope", "recipient", "generation"] as const;
  const record = permission_requireShape(value, keys, "binding");
  const capabilityId = permission_decodeCapabilityId(record.capabilityId);
  const platform = permission_decodePlatform(record.platform);
  const support = permission_decodeSupportTuple(record.support);
  const scope = permission_decodeScope(record.scope);
  const recipient = permission_decodeInstalledRecipient(record.recipient);
  const generation = permission_decodeSafeInteger(record.generation, "binding.generation", 1);
  const allowedScopeKinds: readonly PermissionScopeKind[] =
    permission_capabilityScopeKinds[capabilityId];
  const supportDisclaimsVerifiedIdentity =
    recipient.status === "verified" && /^(?:unknown|unverified)$/i.test(support.signerIdentity);
  if (
    support.platform !== platform ||
    recipient.platform !== platform ||
    support.installedIdentityKey !== recipient.identityKey ||
    support.scopeKey !== scope.scopeKey ||
    generation !== scope.generation ||
    !allowedScopeKinds.includes(scope.kind) ||
    supportDisclaimsVerifiedIdentity
  ) {
    throw new TypeError("binding capability, support, recipient, scope, and generation differ.");
  }
  return { capabilityId, platform, support, scope, recipient, generation };
}

export function permission_sameBinding(left: PermissionBinding, right: PermissionBinding): boolean {
  return (
    left.capabilityId === right.capabilityId &&
    left.platform === right.platform &&
    left.generation === right.generation &&
    permission_sameSupport(left.support, right.support) &&
    permission_sameScope(left.scope, right.scope) &&
    permission_sameRecipient(left.recipient, right.recipient)
  );
}

export function permission_decodeCapabilityDescriptor(
  value: unknown,
): PermissionCapabilityDescriptor {
  const keys = ["capabilityId", "platform", "scopeKinds", "support"] as const;
  const record = permission_requireShape(value, keys, "capabilityDescriptor");
  const capabilityId = permission_decodeCapabilityId(record.capabilityId);
  const platform = permission_decodePlatform(record.platform);
  const scopeKinds = permission_decodeUnique(
    record.scopeKinds,
    permission_scopeKinds,
    "capabilityDescriptor.scopeKinds",
  );
  const capabilityScopeKinds: readonly PermissionScopeKind[] =
    permission_capabilityScopeKinds[capabilityId];
  if (scopeKinds.some((scopeKind) => !capabilityScopeKinds.includes(scopeKind))) {
    throw new TypeError("capabilityDescriptor scope kinds conflict with its capability.");
  }
  if (
    !Array.isArray(record.support) ||
    record.support.length === 0 ||
    record.support.length > permission_maxCollectionLength
  ) {
    throw new TypeError("capabilityDescriptor.support must be a bounded non-empty array.");
  }
  const support = record.support.map((item, index) => {
    const entry = permission_requireShape(
      item,
      ["support", "status"],
      `capabilityDescriptor.support[${index}]`,
    );
    const tuple = permission_decodeSupportTuple(entry.support);
    if (tuple.platform !== platform) {
      throw new TypeError("capability support tuple platform differs from its descriptor.");
    }
    return {
      support: tuple,
      status: permission_decodeLiteral(
        entry.status,
        ["supported", "unsupported", "unavailable", "unknown"] as const,
        `capabilityDescriptor.support[${index}].status`,
      ),
    };
  });
  const identities = support.map((entry) => JSON.stringify(entry.support));
  if (new Set(identities).size !== identities.length) {
    throw new TypeError("capability support tuples must be unique.");
  }
  return { capabilityId, platform, scopeKinds, support };
}

function permission_decodeEvidenceCommon(
  record: Record<string, unknown>,
  expectedKind: PermissionEvidenceKind,
): {
  readonly schemaVersion: typeof permission_schemaVersion;
  readonly evidenceId: string;
  readonly recordedAt: number;
  readonly binding: PermissionBinding;
} {
  const schemaVersion = permission_decodeSafeInteger(
    record.schemaVersion,
    "evidence.schemaVersion",
  );
  if (schemaVersion !== permission_schemaVersion) {
    throw new TypeError("evidence.schemaVersion is unsupported.");
  }
  if (record.kind !== expectedKind) throw new TypeError("evidence.kind is inconsistent.");
  return {
    schemaVersion: permission_schemaVersion,
    evidenceId: permission_decodeOpaqueKey(record.evidenceId, "evidence.evidenceId"),
    recordedAt: permission_decodeTimestamp(record.recordedAt, "evidence.recordedAt"),
    binding: permission_decodeBinding(record.binding),
  };
}

export function permission_decodeSettingsOpenAttempt(
  value: unknown,
): PermissionSettingsOpenAttempt {
  const record = permission_requireShape(
    value,
    [
      "schemaVersion",
      "kind",
      "evidenceId",
      "recordedAt",
      "binding",
      "state",
      "source",
      "reasonCode",
    ],
    "settingsOpenAttempt",
  );
  const common = permission_decodeEvidenceCommon(record, "settings-open-attempt");
  const state = permission_decodeLiteral(
    record.state,
    permission_settingsOpenStates,
    "settingsOpenAttempt.state",
  );
  const source = permission_decodeLiteral(
    record.source,
    ["application", "fixture"] as const,
    "settingsOpenAttempt.source",
  );
  const reasonCode = permission_decodeNullableReason(
    record.reasonCode,
    "settingsOpenAttempt.reasonCode",
  );
  if ((state === "failed" || state === "unknown") && reasonCode === null) {
    throw new TypeError("failed or unknown Settings attempts require a reason code.");
  }
  if ((state === "not-attempted" || state === "accepted") && reasonCode !== null) {
    throw new TypeError("non-failed Settings attempts cannot carry a failure reason.");
  }
  return { ...common, kind: "settings-open-attempt", state, source, reasonCode };
}

export function permission_decodeRequestOutcome(value: unknown): PermissionRequestOutcome {
  const record = permission_requireShape(
    value,
    [
      "schemaVersion",
      "kind",
      "evidenceId",
      "recordedAt",
      "binding",
      "state",
      "source",
      "reasonCode",
    ],
    "requestOutcome",
  );
  const common = permission_decodeEvidenceCommon(record, "permission-request");
  const state = permission_decodeLiteral(
    record.state,
    permission_requestStates,
    "requestOutcome.state",
  );
  const source = permission_decodeLiteral(
    record.source,
    ["native", "application", "fixture"] as const,
    "requestOutcome.source",
  );
  const reasonCode = permission_decodeNullableReason(
    record.reasonCode,
    "requestOutcome.reasonCode",
  );
  if (
    ["denied", "cancelled", "failed", "unsupported", "unavailable", "unknown"].includes(state) &&
    reasonCode === null
  ) {
    throw new TypeError("non-accepted request outcomes require a reason code.");
  }
  if ((state === "not-attempted" || state === "accepted") && reasonCode !== null) {
    throw new TypeError("non-failed request outcomes cannot carry a failure reason.");
  }
  return { ...common, kind: "permission-request", state, source, reasonCode };
}

export function permission_decodeAuthorizationObservation(
  value: unknown,
): PermissionAuthorizationObservation {
  const record = permission_requireShape(
    value,
    [
      "schemaVersion",
      "kind",
      "evidenceId",
      "recordedAt",
      "binding",
      "authorization",
      "source",
      "reasonCode",
    ],
    "authorizationObservation",
  );
  const common = permission_decodeEvidenceCommon(record, "reported-authorization");
  const authorization = permission_decodeLiteral(
    record.authorization,
    permission_authorizationKinds,
    "authorizationObservation.authorization",
  );
  const source = permission_decodeLiteral(
    record.source,
    permission_authorizationSources,
    "authorizationObservation.source",
  );
  const reasonCode = permission_decodeNullableReason(
    record.reasonCode,
    "authorizationObservation.reasonCode",
  );
  if (
    (authorization === "unsupported" ||
      authorization === "unavailable" ||
      authorization === "unknown") &&
    reasonCode === null
  ) {
    throw new TypeError("non-authoritative authorization states require a reason code.");
  }
  if (
    ["not-determined", "authorized", "provisional", "ephemeral"].includes(authorization) &&
    reasonCode !== null
  ) {
    throw new TypeError("non-failure authorization states cannot carry a failure reason.");
  }
  if (authorization === "denied" && reasonCode === null) {
    throw new TypeError("denied authorization requires a reason code.");
  }
  if (
    source === "capability-probe" &&
    !["unsupported", "unavailable", "unknown"].includes(authorization)
  ) {
    throw new TypeError("capability-probe evidence cannot report a grant or denial.");
  }
  if (
    (authorization === "unsupported" || authorization === "unavailable") &&
    source !== "capability-probe" &&
    source !== "fixture"
  ) {
    throw new TypeError("unsupported and unavailable states require capability-probe evidence.");
  }
  if (
    source === "browser" &&
    ["ephemeral", "restricted-managed", "unsupported", "unavailable"].includes(authorization)
  ) {
    throw new TypeError("browser authorization cannot report a native-only state.");
  }
  return {
    ...common,
    kind: "reported-authorization",
    authorization,
    source,
    reasonCode,
  };
}

export function permission_decodeRevealAttempt(value: unknown): PermissionRevealAttempt {
  permission_assertJsonData(value, "revealAttempt");
  if (!permission_isRecord(value)) {
    throw new TypeError("revealAttempt must be a plain JSON object.");
  }
  const baseKeys = [
    "schemaVersion",
    "kind",
    "evidenceId",
    "recordedAt",
    "binding",
    "action",
    "state",
    "source",
    "reasonCode",
  ] as const;
  const keys = Object.prototype.hasOwnProperty.call(value, "pane")
    ? [...baseKeys, "pane"]
    : baseKeys;
  if (!permission_hasOnlyKeys(value, keys)) {
    throw new TypeError("revealAttempt has an unsupported shape.");
  }
  const record = value;
  const common = permission_decodeEvidenceCommon(record, "installed-app-reveal");
  if (record.action !== "show-in-finder") {
    throw new TypeError("revealAttempt.action is unsupported.");
  }
  const state = permission_decodeLiteral(
    record.state,
    permission_revealStates,
    "revealAttempt.state",
  );
  const source = permission_decodeLiteral(
    record.source,
    ["application", "fixture"] as const,
    "revealAttempt.source",
  );
  const reasonCode = permission_decodeNullableReason(record.reasonCode, "revealAttempt.reasonCode");
  if ((state === "failed" || state === "unknown") && reasonCode === null) {
    throw new TypeError("failed or unknown reveal attempts require a reason code.");
  }
  if ((state === "not-attempted" || state === "accepted") && reasonCode !== null) {
    throw new TypeError("non-failed reveal attempts cannot carry a failure reason.");
  }
  const pane = Object.prototype.hasOwnProperty.call(record, "pane")
    ? permission_decodePane(record.pane)
    : null;
  if (pane !== null && common.binding.capabilityId !== permission_paneCapabilityIds[pane]) {
    throw new TypeError("reveal pane and binding capability differ.");
  }
  return {
    ...common,
    kind: "installed-app-reveal",
    action: "show-in-finder",
    pane,
    state,
    source,
    reasonCode,
  };
}

export function permission_decodeDragOutcome(value: unknown): PermissionDragOutcome {
  const record = permission_requireShape(
    value,
    [
      "schemaVersion",
      "kind",
      "evidenceId",
      "recordedAt",
      "binding",
      "pane",
      "result",
      "source",
      "reasonCode",
    ],
    "dragOutcome",
  );
  const common = permission_decodeEvidenceCommon(record, "installed-app-drag");
  const pane = permission_decodePane(record.pane);
  if (common.binding.capabilityId !== permission_paneCapabilityIds[pane]) {
    throw new TypeError("drag pane and binding capability differ.");
  }
  const result = permission_decodeLiteral(
    record.result,
    permission_dragResults,
    "dragOutcome.result",
  );
  const source = permission_decodeLiteral(
    record.source,
    ["native", "application", "fixture"] as const,
    "dragOutcome.source",
  );
  const reasonCode = permission_decodeNullableReason(record.reasonCode, "dragOutcome.reasonCode");
  if (result !== "started" && reasonCode === null) {
    throw new TypeError("non-started drag results require a reason code.");
  }
  if (result === "started" && reasonCode !== null) {
    throw new TypeError("started drag results cannot carry a failure reason.");
  }
  return {
    ...common,
    kind: "installed-app-drag",
    pane,
    result,
    source,
    reasonCode,
  };
}

export function permission_decodeFeatureOperation(value: unknown): PermissionFeatureOperation {
  const record = permission_requireShape(
    value,
    [
      "schemaVersion",
      "kind",
      "evidenceId",
      "recordedAt",
      "binding",
      "state",
      "source",
      "reasonCode",
    ],
    "featureOperation",
  );
  const common = permission_decodeEvidenceCommon(record, "feature-operation");
  const state = permission_decodeLiteral(
    record.state,
    permission_featureStates,
    "featureOperation.state",
  );
  const source = permission_decodeLiteral(
    record.source,
    ["native", "application", "fixture"] as const,
    "featureOperation.source",
  );
  const reasonCode = permission_decodeNullableReason(
    record.reasonCode,
    "featureOperation.reasonCode",
  );
  if (state !== "succeeded" && reasonCode === null) {
    throw new TypeError("unsuccessful feature operations require a reason code.");
  }
  if (state === "succeeded" && reasonCode !== null) {
    throw new TypeError("successful feature operations cannot carry a failure reason.");
  }
  return { ...common, kind: "feature-operation", state, source, reasonCode };
}

export function permission_decodePaneEvidence(value: unknown): PermissionPaneEvidence {
  const record = permission_requireShape(
    value,
    ["schemaVersion", "evidenceId", "recordedAt", "pane", "dragEvidence", "source", "binding"],
    "paneEvidence",
  );
  const schemaVersion = permission_decodeSafeInteger(
    record.schemaVersion,
    "paneEvidence.schemaVersion",
  );
  if (schemaVersion !== permission_schemaVersion) {
    throw new TypeError("paneEvidence.schemaVersion is unsupported.");
  }
  const dragEvidence = permission_decodeLiteral(
    record.dragEvidence,
    permission_paneDragEvidenceStates,
    "paneEvidence.dragEvidence",
  );
  const source = permission_decodeLiteral(
    record.source,
    ["native", "fixture"] as const,
    "paneEvidence.source",
  );
  if (source === "fixture" && dragEvidence === "verified") {
    throw new TypeError("fixture evidence cannot prove native pane drag acceptance.");
  }
  const pane = permission_decodePane(record.pane);
  const binding = permission_decodeBinding(record.binding);
  if (binding.capabilityId !== permission_paneCapabilityIds[pane]) {
    throw new TypeError("pane evidence pane and binding capability differ.");
  }
  return {
    schemaVersion: permission_schemaVersion,
    evidenceId: permission_decodeOpaqueKey(record.evidenceId, "paneEvidence.evidenceId"),
    recordedAt: permission_decodeTimestamp(record.recordedAt, "paneEvidence.recordedAt"),
    pane,
    dragEvidence,
    source,
    binding,
  };
}

export function permission_decodeEvidence(value: unknown): PermissionEvidence {
  permission_assertJsonData(value);
  if (!permission_isRecord(value)) throw new TypeError("evidence must be a plain JSON object.");
  const kind = permission_decodeLiteral(value.kind, permission_evidenceKinds, "evidence.kind");
  switch (kind) {
    case "settings-open-attempt":
      return permission_decodeSettingsOpenAttempt(value);
    case "permission-request":
      return permission_decodeRequestOutcome(value);
    case "reported-authorization":
      return permission_decodeAuthorizationObservation(value);
    case "installed-app-reveal":
      return permission_decodeRevealAttempt(value);
    case "installed-app-drag":
      return permission_decodeDragOutcome(value);
    case "feature-operation":
      return permission_decodeFeatureOperation(value);
  }
}

export function permission_decodeRecoveryInput(value: unknown): PermissionRecoveryInput {
  const record = permission_requireShape(
    value,
    ["schemaVersion", "trigger", "occurredAt", "evidence"],
    "recoveryInput",
  );
  const schemaVersion = permission_decodeSafeInteger(
    record.schemaVersion,
    "recoveryInput.schemaVersion",
  );
  if (schemaVersion !== permission_schemaVersion) {
    throw new TypeError("recoveryInput.schemaVersion is unsupported.");
  }
  return {
    schemaVersion: permission_schemaVersion,
    trigger: permission_decodeLiteral(
      record.trigger,
      permission_recoveryTriggers,
      "recoveryInput.trigger",
    ),
    occurredAt: permission_decodeTimestamp(record.occurredAt, "recoveryInput.occurredAt"),
    evidence: permission_decodeEvidence(record.evidence),
  };
}
