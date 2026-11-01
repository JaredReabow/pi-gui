/**
 * Browser-safe MCP Stage 0 contracts and pure domain helpers.
 *
 * This module accepts and returns bounded JSON data only. It owns no file
 * discovery, configuration merge, process, network, credential, approval,
 * Browser, SSH, or Skills behavior. Runtime owners must supply observations;
 * possessing or decoding one of these values grants no authority.
 */

export const mcp_schemaVersion = 1 as const;

export const mcp_maxIdentifierBytes = 160;
export const mcp_maxLabelBytes = 512;
export const mcp_maxCollectionLength = 128;
export const mcp_maxJsonDepth = 12;
export const mcp_maxJsonNodes = 2_048;
export const mcp_maxJsonFields = 32;
export const mcp_maxTimestamp = 253_402_300_799_999;

export const mcp_lifecycleStates = [
  "missing",
  "disabled",
  "starting",
  "ready",
  "degraded",
  "disconnected",
  "auth-required",
  "approval-pending",
  "denied",
  "cancelled",
  "unknown",
] as const;
export type McpLifecycleState = (typeof mcp_lifecycleStates)[number];

export const mcp_readinessFacts = [
  "configured",
  "transport-alive",
  "protocol-initialized",
  "authenticated",
  "tool-available",
  "operation-verified",
] as const;
export type McpReadinessFactName = (typeof mcp_readinessFacts)[number];

export const mcp_factStates = ["unknown", "met", "not-met", "not-applicable"] as const;
export type McpFactState = (typeof mcp_factStates)[number];

export const mcp_factProvenance = {
  configured: "config-owner",
  "transport-alive": "transport-observer",
  "protocol-initialized": "lifecycle-observer",
  authenticated: "auth-owner",
  "tool-available": "catalog-owner",
  "operation-verified": "operation-observer",
} as const satisfies Readonly<Record<McpReadinessFactName, string>>;
export type McpFactProvenance =
  (typeof mcp_factProvenance)[McpReadinessFactName] | "checkpoint-inspector";

export const mcp_reasonCodes = [
  "none",
  "configuration-missing",
  "configuration-invalid",
  "project-trust-unknown",
  "process-not-observed",
  "transport-unreachable",
  "protocol-unavailable",
  "authentication-required",
  "capability-unavailable",
  "harmless-check-not-defined",
  "harmless-check-failed",
  "approval-required",
  "operation-denied",
  "operation-cancelled",
  "outcome-unknown",
  "stale-observation",
  "generation-mismatch",
  "configuration-changed",
  "restart-inspection-required",
  "unsupported",
] as const;
export type McpReasonCode = (typeof mcp_reasonCodes)[number];

export const mcp_configSourceKinds = ["user", "project"] as const;
export type McpConfigSourceKind = (typeof mcp_configSourceKinds)[number];

export const mcp_configSourceStates = ["absent", "invalid", "present"] as const;
export type McpConfigSourceState = (typeof mcp_configSourceStates)[number];

export const mcp_projectTrustStates = [
  "trusted",
  "untrusted",
  "not-applicable",
  "unknown",
] as const;
export type McpProjectTrustState = (typeof mcp_projectTrustStates)[number];

export const mcp_definitionKinds = ["full", "override"] as const;
export type McpDefinitionKind = (typeof mcp_definitionKinds)[number];

export const mcp_exposureKinds = ["codemode", "deferred", "direct", "hidden"] as const;
export type McpExposureKind = (typeof mcp_exposureKinds)[number];

export const mcp_transportKinds = ["stdio", "streamable-http"] as const;
export type McpTransportKind = (typeof mcp_transportKinds)[number];

export const mcp_ownershipKinds = [
  "owned-stdio-process",
  "external-http-service",
  "external-process",
  "external-application",
] as const;
export type McpOwnershipKind = (typeof mcp_ownershipKinds)[number];

export const mcp_authStates = ["not-applicable", "unknown", "required", "authenticated"] as const;
export type McpAuthState = (typeof mcp_authStates)[number];

export const mcp_authOwners = [
  "pi-credential-store",
  "pi-provider",
  "external-application",
  "stdio-server",
] as const;
export type McpAuthOwner = (typeof mcp_authOwners)[number];

export const mcp_handoffKinds = [
  "sign-in",
  "native-approval",
  "browser-pairing",
  "ssh-enrollment",
  "ssh-host-key",
] as const;
export type McpHandoffKind = (typeof mcp_handoffKinds)[number];

export const mcp_handoffOwners = ["pi", "browser-companion", "global-ssh-connect"] as const;
export type McpHandoffOwner = (typeof mcp_handoffOwners)[number];

export const mcp_operationPhases = [
  "requested",
  "policy-checking",
  "approval-pending",
  "approved-before-dispatch",
  "dispatch-started",
  "result-known",
  "denied",
  "cancelled-before-dispatch",
  "outcome-unknown",
] as const;
export type McpOperationPhase = (typeof mcp_operationPhases)[number];

export const mcp_dispatchStates = [
  "not-dispatched",
  "possibly-dispatched",
  "confirmed-dispatched",
] as const;
export type McpDispatchState = (typeof mcp_dispatchStates)[number];

export const mcp_approvalStates = [
  "not-required",
  "pending",
  "approved",
  "denied",
  "cancelled",
  "stale",
] as const;
export type McpApprovalState = (typeof mcp_approvalStates)[number];

export const mcp_approvalOwners = [
  "pi",
  "browser-companion",
  "global-ssh-connect",
  "pi-gui-policy",
] as const;
export type McpApprovalOwner = (typeof mcp_approvalOwners)[number];

export const mcp_cancellationStates = [
  "requested",
  "confirmed-before-dispatch",
  "possibly-after-dispatch",
] as const;
export type McpCancellationState = (typeof mcp_cancellationStates)[number];

export const mcp_terminalKinds = ["success", "tool-error", "denied", "cancelled"] as const;
export type McpTerminalKind = (typeof mcp_terminalKinds)[number];

export const mcp_persistenceStates = [
  "unsaved",
  "saved-and-active",
  "saved-not-active",
  "saved-partial",
  "conflict",
] as const;
export type McpPersistenceState = (typeof mcp_persistenceStates)[number];

export const mcp_probeKinds = ["browser_status", "ssh_status", "declared-harmless"] as const;
export type McpProbeKind = (typeof mcp_probeKinds)[number];

export const mcp_harmlessCapabilityIds = [
  "browser-status",
  "ssh-status",
  "server-declared-harmless",
] as const;
export type McpHarmlessCapabilityId = (typeof mcp_harmlessCapabilityIds)[number];

export const mcp_skillsStates = [
  "required",
  "observed-restored",
  "unavailable",
  "unknown",
] as const;
export type McpSkillsState = (typeof mcp_skillsStates)[number];

export const mcp_restartTriggers = ["timeout", "disconnect", "reconnect", "restart"] as const;
export type McpRestartTrigger = (typeof mcp_restartTriggers)[number];

export const mcp_operationPhaseDispatchTable = {
  requested: ["not-dispatched"],
  "policy-checking": ["not-dispatched"],
  "approval-pending": ["not-dispatched"],
  "approved-before-dispatch": ["not-dispatched"],
  "dispatch-started": ["possibly-dispatched", "confirmed-dispatched"],
  "result-known": ["not-dispatched", "possibly-dispatched", "confirmed-dispatched"],
  denied: ["not-dispatched"],
  "cancelled-before-dispatch": ["not-dispatched"],
  "outcome-unknown": ["possibly-dispatched", "confirmed-dispatched"],
} as const satisfies Readonly<Record<McpOperationPhase, readonly McpDispatchState[]>>;

export const mcp_operationApprovalPhaseTable = {
  "not-required": [
    "requested",
    "policy-checking",
    "approved-before-dispatch",
    "dispatch-started",
    "result-known",
    "denied",
    "cancelled-before-dispatch",
    "outcome-unknown",
  ],
  pending: ["approval-pending"],
  approved: [
    "approved-before-dispatch",
    "dispatch-started",
    "result-known",
    "cancelled-before-dispatch",
    "outcome-unknown",
  ],
  denied: ["denied"],
  cancelled: ["cancelled-before-dispatch"],
  stale: [
    "approved-before-dispatch",
    "dispatch-started",
    "result-known",
    "cancelled-before-dispatch",
    "outcome-unknown",
  ],
} as const satisfies Readonly<Record<McpApprovalState, readonly McpOperationPhase[]>>;

export const mcp_operationCancellationPhaseTable = {
  requested: [
    "requested",
    "policy-checking",
    "approval-pending",
    "approved-before-dispatch",
    "dispatch-started",
    "result-known",
    "outcome-unknown",
  ],
  "confirmed-before-dispatch": ["cancelled-before-dispatch"],
  "possibly-after-dispatch": ["result-known", "outcome-unknown"],
} as const satisfies Readonly<Record<McpCancellationState, readonly McpOperationPhase[]>>;

export interface McpSessionScope {
  readonly kind: "global" | "workspace" | "session";
  readonly workspaceId: string | null;
  readonly sessionId: string | null;
}

export interface McpServerScope extends McpSessionScope {
  readonly serverId: string;
}

export interface McpReadinessFact {
  readonly fact: McpReadinessFactName;
  readonly state: McpFactState;
  readonly provenance: McpFactProvenance;
  readonly scope: McpServerScope;
  readonly configRevision: number;
  readonly generation: number;
  readonly observedAt: number;
  readonly freshUntil: number;
  readonly reasonCode: McpReasonCode;
}

export interface McpSecretPresence {
  readonly environment: boolean;
  readonly headers: boolean;
  readonly oauth: boolean;
  readonly providerAuth: boolean;
  readonly credentialLikeArguments: boolean;
  readonly unknownFields: boolean;
}

export interface McpOwnershipDescriptor {
  readonly kind: McpOwnershipKind;
  readonly cleanupOwner: "pi-session" | "external-owner";
  readonly externalStateOwner:
    "none" | "pi" | "external-application" | "browser-companion" | "global-ssh-connect";
}

export interface McpStdioTransportDescriptor {
  readonly kind: "stdio";
  readonly executableLabel: string;
  readonly workingDirectoryLabel: string | null;
  readonly argumentCount: number;
}

export interface McpHttpTransportDescriptor {
  readonly kind: "streamable-http";
  readonly endpoint: string;
  readonly headerNameCount: number;
}

export type McpTransportDescriptor = McpStdioTransportDescriptor | McpHttpTransportDescriptor;

export interface McpConfigSourceDescriptor {
  readonly source: McpConfigSourceKind;
  readonly state: McpConfigSourceState;
  readonly trust: McpProjectTrustState;
  readonly revision: number;
  readonly entryCount: number;
}

export interface McpEffectiveServerDescriptor {
  readonly serverId: string;
  readonly source: McpConfigSourceKind;
  readonly definition: McpDefinitionKind;
  readonly overridden: boolean;
  readonly enabled: boolean;
  readonly exposure: McpExposureKind;
  readonly transport: McpTransportDescriptor;
  readonly ownership: McpOwnershipDescriptor;
  readonly toolCount: number | null;
  readonly secretPresence: McpSecretPresence;
  readonly reasonCode: McpReasonCode;
}

export interface McpConfigDiagnostic {
  readonly source: McpConfigSourceKind;
  readonly serverId: string | null;
  readonly reasonCode: McpReasonCode;
}

export interface McpConfigDescriptor {
  readonly schemaVersion: typeof mcp_schemaVersion;
  readonly scope: McpSessionScope;
  readonly revision: number;
  readonly autoEnableCodeMode: boolean;
  readonly sources: readonly McpConfigSourceDescriptor[];
  readonly servers: readonly McpEffectiveServerDescriptor[];
  readonly diagnostics: readonly McpConfigDiagnostic[];
}

export interface McpTransportObservation {
  readonly transport: McpTransportKind;
  readonly httpEndpointReachable: boolean;
  readonly ownedStdioProcessAlive: boolean;
  readonly externalProcessObserved: boolean;
  readonly observedAt: number;
  readonly freshUntil: number;
}

export interface McpAuthenticationDescriptor {
  readonly state: McpAuthState;
  readonly owner: McpAuthOwner;
  readonly credentialKinds: readonly ("static-header" | "oauth" | "provider" | "environment")[];
  readonly scope: McpServerScope;
  readonly configRevision: number;
  readonly generation: number;
  readonly observedAt: number;
  readonly freshUntil: number;
  readonly reasonCode: McpReasonCode;
}

export interface McpAuthHandoff {
  readonly handoffId: string;
  readonly operationId: string | null;
  readonly kind: McpHandoffKind;
  readonly owner: McpHandoffOwner;
  readonly scope: McpServerScope;
  readonly configRevision: number;
  readonly generation: number;
  readonly approvalGeneration: number;
  readonly requestedAt: number;
  readonly automaticDecision: false;
  readonly grantsCapability: false;
}

export interface McpLifecycleObservation {
  readonly schemaVersion: typeof mcp_schemaVersion;
  readonly state: McpLifecycleState;
  readonly observerPresent: boolean;
  readonly scope: McpServerScope;
  readonly configRevision: number;
  readonly generation: number;
  readonly observedAt: number;
  readonly freshUntil: number;
  readonly transportObservation: McpTransportObservation;
  readonly authentication: McpAuthenticationDescriptor;
  readonly readiness: readonly McpReadinessFact[];
}

export const mcp_projectionLabels = [
  ...mcp_lifecycleStates,
  "configured",
  "available-no-harmless-check",
] as const;
export type McpProjectionLabel = (typeof mcp_projectionLabels)[number];

export interface McpStatusProjection {
  readonly state: McpLifecycleState;
  readonly label: McpProjectionLabel;
  readonly ready: boolean;
  readonly missingFacts: readonly McpReadinessFactName[];
  readonly reasonCode: McpReasonCode;
  readonly automaticAction: false;
}

export interface McpApprovalDescriptor {
  readonly state: McpApprovalState;
  readonly owner: McpApprovalOwner;
  readonly approvalGeneration: number | null;
  readonly current: boolean;
}

export interface McpCancellationDescriptor {
  readonly state: McpCancellationState;
  readonly requestedAt: number;
  readonly confirmedAt: number | null;
}

export interface McpTerminalDescriptor {
  readonly kind: McpTerminalKind;
  readonly settledAt: number;
  readonly resultRef: string | null;
}

export interface McpOperationRecord {
  readonly schemaVersion: typeof mcp_schemaVersion;
  readonly operationId: string;
  readonly parentToolCallId: string | null;
  readonly scope: McpServerScope;
  readonly configRevision: number;
  readonly generation: number;
  readonly toolName: string;
  readonly argumentDigest: string;
  readonly phase: McpOperationPhase;
  readonly dispatchState: McpDispatchState;
  readonly approval: McpApprovalDescriptor | null;
  readonly cancellation: McpCancellationDescriptor | null;
  readonly terminal: McpTerminalDescriptor | null;
  readonly transportReplaced: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface McpOperationRecoveryContext {
  readonly trigger: McpRestartTrigger | "configuration-change";
  readonly observedAt: number;
  readonly generation: number;
  readonly configRevision: number;
}

export interface McpOperationRecovery {
  readonly operationId: string;
  readonly phase: McpOperationPhase;
  readonly dispatchState: McpDispatchState;
  readonly terminal: McpTerminalDescriptor | null;
  readonly approvalPreserved: McpApprovalDescriptor | null;
  readonly approvalCurrent: boolean;
  readonly automaticReplay: false;
  readonly requiresUserReconciliation: boolean;
  readonly requiresFreshApproval: boolean;
  readonly reasonCode: McpReasonCode;
}

export interface McpPersistenceSessionObservation {
  readonly sessionId: string;
  readonly generation: number;
  readonly observedConfigRevision: number | null;
  readonly reobserved: boolean;
}

export interface McpPersistenceObservation {
  readonly schemaVersion: typeof mcp_schemaVersion;
  readonly status: "unsaved" | "saved" | "conflict";
  readonly baseConfigRevision: number;
  readonly savedConfigRevision: number | null;
  readonly sessions: readonly McpPersistenceSessionObservation[];
}

export interface McpPersistenceOverlay {
  readonly state: McpPersistenceState;
  readonly savedConfigRevision: number | null;
  readonly activeSessionCount: number;
  readonly affectedSessionCount: number;
  readonly reasonCode: McpReasonCode;
}

export interface McpSkillsObservation {
  readonly schemaVersion: typeof mcp_schemaVersion;
  readonly state: McpSkillsState;
  readonly provenance: "runtime-supervisor";
  readonly scope: McpSessionScope;
  readonly configRevision: number;
  readonly generation: number;
  readonly observedAt: number;
  readonly freshUntil: number;
  readonly automaticReload: false;
  readonly registryRead: false;
}

export interface McpCheckpoint {
  readonly schemaVersion: typeof mcp_schemaVersion;
  readonly checkpointId: string;
  readonly createdAt: number;
  readonly scope: McpSessionScope;
  readonly configRevision: number;
  readonly generation: number;
  readonly config: McpConfigDescriptor;
  readonly persistence: McpPersistenceObservation;
  readonly lifecycles: readonly McpLifecycleObservation[];
  readonly operations: readonly McpOperationRecord[];
  readonly skills: McpSkillsObservation;
}

export interface McpRestartServerInspection {
  readonly serverId: string;
  readonly previousGeneration: number;
  readonly state: "unknown";
  readonly observerPresent: false;
  readonly reasonCode: "restart-inspection-required";
  readonly automaticAction: false;
}

export interface McpRestartOperationInspection {
  readonly operationId: string;
  readonly parentToolCallId: string | null;
  readonly serverId: string;
  readonly toolName: string;
  readonly argumentDigest: string;
  readonly phase: McpOperationPhase;
  readonly dispatchState: McpDispatchState;
  readonly terminal: McpTerminalDescriptor | null;
  readonly approvalPreserved: McpApprovalDescriptor | null;
  readonly approvalCurrent: false;
  readonly automaticReplay: false;
  readonly requiresUserReconciliation: boolean;
  readonly reasonCode: McpReasonCode;
}

export interface McpRestartInspection {
  readonly checkpointId: string;
  readonly previousGeneration: number;
  readonly nextGeneration: number;
  readonly scope: McpSessionScope;
  readonly persistence: McpPersistenceOverlay;
  readonly servers: readonly McpRestartServerInspection[];
  readonly operations: readonly McpRestartOperationInspection[];
  readonly skills: McpSkillsObservation;
  readonly automaticActions: readonly [];
}

interface JsonWalk {
  nodes: number;
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertSafeString(value: string, location: string): void {
  if (!isWellFormedUtf16(value)) {
    throw new TypeError(`${location} must contain valid Unicode.`);
  }
  if (utf8ByteLength(value) > mcp_maxLabelBytes) {
    throw new TypeError(`${location} exceeds the UTF-8 string limit.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${location} cannot contain control characters.`);
  }
}

function assertJsonValue(
  value: unknown,
  walk: JsonWalk,
  ancestors: WeakSet<object>,
  depth = 0,
  location = "$",
): void {
  walk.nodes += 1;
  if (walk.nodes > mcp_maxJsonNodes)
    throw new TypeError(`${location} exceeds the JSON node limit.`);
  if (depth > mcp_maxJsonDepth) throw new TypeError(`${location} exceeds the nesting limit.`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertSafeString(value, location);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${location} must be finite.`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${location} is not JSON data.`);
  if (ancestors.has(value)) throw new TypeError(`${location} cannot be cyclic.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (value.length > mcp_maxCollectionLength) {
      throw new TypeError(`${location} exceeds the collection limit.`);
    }
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
      throw new TypeError(`${location} cannot contain symbol fields.`);
    }
    const ownNames = Object.getOwnPropertyNames(value).filter((name) => name !== "length");
    if (ownNames.length !== value.length) {
      throw new TypeError(`${location} must be a dense array.`);
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${location}[${index}] must be enumerable data.`);
      }
      assertJsonValue(descriptor.value, walk, ancestors, depth + 1, `${location}[${index}]`);
    }
  } else {
    if (!isPlainRecord(value)) throw new TypeError(`${location} must be a plain JSON object.`);
    const keys = Reflect.ownKeys(value);
    if (keys.length > mcp_maxJsonFields) {
      throw new TypeError(`${location} has too many fields.`);
    }
    for (const key of keys) {
      if (typeof key === "symbol") {
        throw new TypeError(`${location} cannot contain symbol fields.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${location}.${key} must be enumerable data.`);
      }
      assertJsonValue(descriptor.value, walk, ancestors, depth + 1, `${location}.${key}`);
    }
  }
  ancestors.delete(value);
}

function prepareJson(value: unknown): void {
  assertJsonValue(value, { nodes: 0 }, new WeakSet<object>());
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.getOwnPropertyNames(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function record(
  value: unknown,
  location: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) {
    throw new TypeError(`${location} has an unsupported shape.`);
  }
  return value;
}

function arrayValue(value: unknown, location: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${location} must be a bounded array.`);
  }
  return value;
}

function decodeLiteral<T extends string>(
  value: unknown,
  accepted: readonly T[],
  location: string,
): T {
  if (typeof value !== "string") throw new TypeError(`${location} must be a string.`);
  const found = accepted.find((candidate) => candidate === value);
  if (found === undefined) throw new TypeError(`${location} is not an accepted value.`);
  return found;
}

function decodeIdentifier(value: unknown, location: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    utf8ByteLength(value) > mcp_maxIdentifierBytes ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)
  ) {
    throw new TypeError(`${location} must be a bounded opaque identifier.`);
  }
  assertSafeString(value, location);
  if (value.includes("://")) {
    throw new TypeError(`${location} cannot contain an opaque URL.`);
  }
  assertNoCredentialMaterial(value, location, mcp_maxIdentifierBytes);
  return value;
}

function decodeLabel(value: unknown, location: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`${location} must be a bounded non-empty label.`);
  }
  assertSafeString(value, location);
  assertNoCredentialMaterial(value, location, mcp_maxLabelBytes);
  return value;
}

function assertNoCredentialMaterial(value: string, location: string, bound: number): void {
  if (utf8ByteLength(value) > bound) {
    throw new TypeError(`${location} exceeds its UTF-8 string limit.`);
  }
  if (
    /(?:bearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-[A-Za-z0-9_-]{8,}|\bghp_[A-Za-z0-9_-]{8,}|\beyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}|\bapi[_-]?key\s*[:=]\s*\S{8,})/i.test(
      value,
    )
  ) {
    throw new TypeError(`${location} cannot contain credential material.`);
  }
}

function decodeNullableIdentifier(value: unknown, location: string): string | null {
  return value === null ? null : decodeIdentifier(value, location);
}

function decodeNullableLabel(value: unknown, location: string): string | null {
  return value === null ? null : decodeLabel(value, location);
}

function decodeBoolean(value: unknown, location: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${location} must be boolean.`);
  return value;
}

function decodeNonNegativeInteger(
  value: unknown,
  location: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${location} must be a bounded non-negative safe integer.`);
  }
  return value;
}

function decodePositiveInteger(
  value: unknown,
  location: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${location} must be a bounded positive safe integer.`);
  }
  return value;
}

function decodeTimestamp(value: unknown, location: string): number {
  return decodeNonNegativeInteger(value, location, mcp_maxTimestamp);
}

function decodeFreshness(
  value: Record<string, unknown>,
  location: string,
): { readonly observedAt: number; readonly freshUntil: number } {
  const observedAt = decodeTimestamp(value.observedAt, `${location}.observedAt`);
  const freshUntil = decodeTimestamp(value.freshUntil, `${location}.freshUntil`);
  if (freshUntil < observedAt) {
    throw new TypeError(`${location}.freshUntil cannot precede observedAt.`);
  }
  return { observedAt, freshUntil };
}

function decodeReasonCode(value: unknown, location: string): McpReasonCode {
  return decodeLiteral(value, mcp_reasonCodes, location);
}

function decodeEndpoint(value: unknown, location: string): string {
  const label = decodeLabel(value, location);
  let endpoint: URL;
  try {
    endpoint = new URL(label);
  } catch {
    throw new TypeError(`${location} must be an HTTP(S) endpoint.`);
  }
  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new TypeError(`${location} must not carry userinfo, query, or fragment data.`);
  }
  return `${endpoint.origin}${endpoint.pathname}`;
}

function decodeDigest(value: unknown, location: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${location} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

export function mcp_decodeSessionScope(value: unknown): McpSessionScope {
  prepareJson(value);
  const input = record(value, "scope", ["kind", "workspaceId", "sessionId"]);
  const kind = decodeLiteral(input.kind, ["global", "workspace", "session"] as const, "scope.kind");
  const workspaceId =
    input.workspaceId === null ? null : decodeIdentifier(input.workspaceId, "scope.workspaceId");
  const sessionId =
    input.sessionId === null ? null : decodeIdentifier(input.sessionId, "scope.sessionId");
  const valid =
    (kind === "global" && workspaceId === null && sessionId === null) ||
    (kind === "workspace" && workspaceId !== null && sessionId === null) ||
    (kind === "session" && workspaceId !== null && sessionId !== null);
  if (!valid) throw new TypeError("scope identity is cross-associated.");
  return { kind, workspaceId, sessionId };
}

export function mcp_decodeServerScope(value: unknown): McpServerScope {
  prepareJson(value);
  const input = record(value, "serverScope", ["kind", "workspaceId", "sessionId", "serverId"]);
  const sessionScope = mcp_decodeSessionScope({
    kind: input.kind,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
  });
  return {
    ...sessionScope,
    serverId: decodeIdentifier(input.serverId, "serverScope.serverId"),
  };
}

function scopesEqual(left: McpSessionScope, right: McpSessionScope): boolean {
  return (
    left.kind === right.kind &&
    left.workspaceId === right.workspaceId &&
    left.sessionId === right.sessionId
  );
}

function serverScopesEqual(left: McpServerScope, right: McpServerScope): boolean {
  return scopesEqual(left, right) && left.serverId === right.serverId;
}

export function mcp_decodeReadinessFact(value: unknown): McpReadinessFact {
  prepareJson(value);
  const input = record(value, "readinessFact", [
    "fact",
    "state",
    "provenance",
    "scope",
    "configRevision",
    "generation",
    "observedAt",
    "freshUntil",
    "reasonCode",
  ]);
  const fact = decodeLiteral(input.fact, mcp_readinessFacts, "readinessFact.fact");
  const provenance = decodeLiteral(
    input.provenance,
    [mcp_factProvenance[fact], "checkpoint-inspector"] as const,
    "readinessFact.provenance",
  );
  if (provenance === "checkpoint-inspector") {
    throw new TypeError("runtime readiness facts cannot use checkpoint provenance.");
  }
  const freshness = decodeFreshness(input, "readinessFact");
  return {
    fact,
    state: decodeLiteral(input.state, mcp_factStates, "readinessFact.state"),
    provenance,
    scope: mcp_decodeServerScope(input.scope),
    configRevision: decodePositiveInteger(input.configRevision, "readinessFact.configRevision"),
    generation: decodePositiveInteger(input.generation, "readinessFact.generation"),
    ...freshness,
    reasonCode: decodeReasonCode(input.reasonCode, "readinessFact.reasonCode"),
  };
}

export function mcp_decodeTransportObservation(value: unknown): McpTransportObservation {
  prepareJson(value);
  const input = record(value, "transportObservation", [
    "transport",
    "httpEndpointReachable",
    "ownedStdioProcessAlive",
    "externalProcessObserved",
    "observedAt",
    "freshUntil",
  ]);
  const transport = decodeLiteral(input.transport, mcp_transportKinds, "transportObservation");
  const observation = {
    transport,
    httpEndpointReachable: decodeBoolean(
      input.httpEndpointReachable,
      "transportObservation.httpEndpointReachable",
    ),
    ownedStdioProcessAlive: decodeBoolean(
      input.ownedStdioProcessAlive,
      "transportObservation.ownedStdioProcessAlive",
    ),
    externalProcessObserved: decodeBoolean(
      input.externalProcessObserved,
      "transportObservation.externalProcessObserved",
    ),
    ...decodeFreshness(input, "transportObservation"),
  };
  if (transport === "stdio" && observation.httpEndpointReachable) {
    throw new TypeError("stdio transport cannot claim HTTP reachability.");
  }
  if (transport === "streamable-http" && observation.ownedStdioProcessAlive) {
    throw new TypeError("HTTP transport cannot claim an owned stdio process.");
  }
  return observation;
}

function decodeCredentialKinds(
  value: unknown,
): readonly ("static-header" | "oauth" | "provider" | "environment")[] {
  const entries = arrayValue(value, "authentication.credentialKinds", 4);
  const decoded = entries.map((entry, index) =>
    decodeLiteral(
      entry,
      ["static-header", "oauth", "provider", "environment"] as const,
      `authentication.credentialKinds[${index}]`,
    ),
  );
  if (new Set(decoded).size !== decoded.length) {
    throw new TypeError("authentication credential kinds must be unique.");
  }
  return decoded;
}

export function mcp_decodeAuthentication(value: unknown): McpAuthenticationDescriptor {
  prepareJson(value);
  const input = record(value, "authentication", [
    "state",
    "owner",
    "credentialKinds",
    "scope",
    "configRevision",
    "generation",
    "observedAt",
    "freshUntil",
    "reasonCode",
  ]);
  return {
    state: decodeLiteral(input.state, mcp_authStates, "authentication.state"),
    owner: decodeLiteral(input.owner, mcp_authOwners, "authentication.owner"),
    credentialKinds: decodeCredentialKinds(input.credentialKinds),
    scope: mcp_decodeServerScope(input.scope),
    configRevision: decodePositiveInteger(input.configRevision, "authentication.configRevision"),
    generation: decodePositiveInteger(input.generation, "authentication.generation"),
    ...decodeFreshness(input, "authentication"),
    reasonCode: decodeReasonCode(input.reasonCode, "authentication.reasonCode"),
  };
}

export function mcp_decodeAuthHandoff(value: unknown): McpAuthHandoff {
  prepareJson(value);
  const input = record(value, "authHandoff", [
    "handoffId",
    "operationId",
    "kind",
    "owner",
    "scope",
    "configRevision",
    "generation",
    "approvalGeneration",
    "requestedAt",
    "automaticDecision",
    "grantsCapability",
  ]);
  if (
    decodeBoolean(input.automaticDecision, "authHandoff.automaticDecision") ||
    decodeBoolean(input.grantsCapability, "authHandoff.grantsCapability")
  ) {
    throw new TypeError("an auth handoff cannot approve itself or grant capability.");
  }
  return {
    handoffId: decodeIdentifier(input.handoffId, "authHandoff.handoffId"),
    operationId: decodeNullableIdentifier(input.operationId, "authHandoff.operationId"),
    kind: decodeLiteral(input.kind, mcp_handoffKinds, "authHandoff.kind"),
    owner: decodeLiteral(input.owner, mcp_handoffOwners, "authHandoff.owner"),
    scope: mcp_decodeServerScope(input.scope),
    configRevision: decodePositiveInteger(input.configRevision, "authHandoff.configRevision"),
    generation: decodePositiveInteger(input.generation, "authHandoff.generation"),
    approvalGeneration: decodePositiveInteger(
      input.approvalGeneration,
      "authHandoff.approvalGeneration",
    ),
    requestedAt: decodeTimestamp(input.requestedAt, "authHandoff.requestedAt"),
    automaticDecision: false,
    grantsCapability: false,
  };
}

export function mcp_decodeLifecycleObservation(value: unknown): McpLifecycleObservation {
  prepareJson(value);
  const input = record(value, "lifecycle", [
    "schemaVersion",
    "state",
    "observerPresent",
    "scope",
    "configRevision",
    "generation",
    "observedAt",
    "freshUntil",
    "transportObservation",
    "authentication",
    "readiness",
  ]);
  if (input.schemaVersion !== mcp_schemaVersion) {
    throw new TypeError("lifecycle schemaVersion is unsupported.");
  }
  const scope = mcp_decodeServerScope(input.scope);
  const configRevision = decodePositiveInteger(input.configRevision, "lifecycle.configRevision");
  const generation = decodePositiveInteger(input.generation, "lifecycle.generation");
  const freshness = decodeFreshness(input, "lifecycle");
  const transportObservation = mcp_decodeTransportObservation(input.transportObservation);
  const authentication = mcp_decodeAuthentication(input.authentication);
  const entries = arrayValue(input.readiness, "lifecycle.readiness", mcp_readinessFacts.length);
  if (entries.length !== mcp_readinessFacts.length) {
    throw new TypeError("lifecycle readiness must contain exactly six facts.");
  }
  const readiness = entries.map(mcp_decodeReadinessFact);
  if (
    readiness.length !== mcp_readinessFacts.length ||
    new Set(readiness.map((fact) => fact.fact)).size !== mcp_readinessFacts.length ||
    readiness.some((fact, index) => fact.fact !== mcp_readinessFacts[index])
  ) {
    throw new TypeError("lifecycle readiness facts must be unique and canonically ordered.");
  }
  for (const fact of readiness) {
    if (
      !serverScopesEqual(fact.scope, scope) ||
      fact.configRevision !== configRevision ||
      fact.generation !== generation
    ) {
      throw new TypeError("lifecycle readiness fact is cross-associated.");
    }
  }
  if (
    transportObservation.observedAt !== freshness.observedAt ||
    authentication.observedAt !== freshness.observedAt ||
    !serverScopesEqual(authentication.scope, scope) ||
    authentication.configRevision !== configRevision ||
    authentication.generation !== generation
  ) {
    throw new TypeError("lifecycle evidence is not bound to one observation generation.");
  }
  const transportFact = readiness[1];
  const authenticationFact = readiness[3];
  if (!transportFact || !authenticationFact) {
    throw new TypeError("lifecycle transport and authentication facts are required.");
  }
  const expectedTransportState: McpFactState =
    transportObservation.transport === "stdio"
      ? transportObservation.ownedStdioProcessAlive
        ? "met"
        : "not-met"
      : transportObservation.httpEndpointReachable
        ? "met"
        : "not-met";
  if (transportFact.state !== expectedTransportState) {
    throw new TypeError("transport readiness is not bound to its distinct observation.");
  }
  const expectedAuthState: McpFactState =
    authentication.state === "not-applicable"
      ? "not-applicable"
      : authentication.state === "authenticated"
        ? "met"
        : authentication.state === "required"
          ? "not-met"
          : "unknown";
  if (authenticationFact.state !== expectedAuthState) {
    throw new TypeError("authentication readiness is not bound to its owner observation.");
  }
  const observerPresent = decodeBoolean(input.observerPresent, "lifecycle.observerPresent");
  const state = decodeLiteral(input.state, mcp_lifecycleStates, "lifecycle.state");
  if (state === "ready" && !observerPresent) {
    throw new TypeError("ready requires a lifecycle observer.");
  }
  return {
    schemaVersion: mcp_schemaVersion,
    state,
    observerPresent,
    scope,
    configRevision,
    generation,
    ...freshness,
    transportObservation,
    authentication,
    readiness,
  };
}

function readinessFactValue(
  observation: McpLifecycleObservation,
  fact: McpReadinessFactName,
): McpReadinessFact {
  const found = observation.readiness.find((entry) => entry.fact === fact);
  if (!found) throw new TypeError(`readiness fact ${fact} is required.`);
  return found;
}

function readyFactAccepted(fact: McpReadinessFact): boolean {
  if (fact.fact === "authenticated") {
    return fact.state === "met" || fact.state === "not-applicable";
  }
  return fact.state === "met";
}

/**
 * Project a browser-safe status. Lower observations cannot fabricate Ready:
 * an observer plus fresh configuration, transport, protocol, authentication
 * (or stdio N/A), catalogue, and harmless-operation proof are all required.
 */
export function mcp_lifecycle_project(value: unknown, evaluatedAt: unknown): McpStatusProjection {
  const observation = mcp_decodeLifecycleObservation(value);
  const now = decodeTimestamp(evaluatedAt, "evaluatedAt");
  const missingFacts: McpReadinessFactName[] = [];
  for (const fact of observation.readiness) {
    if (fact.freshUntil < now || fact.state === "unknown" || !readyFactAccepted(fact)) {
      missingFacts.push(fact.fact);
    }
  }
  const configuredMet = readinessFactValue(observation, "configured").state === "met";
  if (!observation.observerPresent) {
    return {
      state: "unknown",
      label: configuredMet ? "configured" : "unknown",
      ready: false,
      missingFacts,
      reasonCode: configuredMet ? "stale-observation" : "configuration-missing",
      automaticAction: false,
    };
  }
  if (observation.freshUntil < now) {
    return {
      state: "unknown",
      label: "unknown",
      ready: false,
      missingFacts,
      reasonCode: "stale-observation",
      automaticAction: false,
    };
  }
  if (observation.state === "ready") {
    if (missingFacts.length === 0) {
      return {
        state: "ready",
        label: "ready",
        ready: true,
        missingFacts,
        reasonCode: "none",
        automaticAction: false,
      };
    }
    const onlyOperationMissing =
      missingFacts.length === 1 && missingFacts[0] === "operation-verified";
    const operationState = readinessFactValue(observation, "operation-verified").state;
    return {
      state: onlyOperationMissing ? "degraded" : "unknown",
      label:
        onlyOperationMissing && operationState === "not-applicable"
          ? "available-no-harmless-check"
          : "unknown",
      ready: false,
      missingFacts,
      reasonCode:
        operationState === "not-applicable" ? "harmless-check-not-defined" : "stale-observation",
      automaticAction: false,
    };
  }
  if (observation.state === "auth-required") {
    return {
      state: "auth-required",
      label: "auth-required",
      ready: false,
      missingFacts,
      reasonCode: "authentication-required",
      automaticAction: false,
    };
  }
  return {
    state: observation.state,
    label: observation.state,
    ready: false,
    missingFacts,
    reasonCode:
      observation.state === "approval-pending"
        ? "approval-required"
        : observation.state === "denied"
          ? "operation-denied"
          : observation.state === "cancelled"
            ? "operation-cancelled"
            : observation.state === "unknown"
              ? "outcome-unknown"
              : "none",
    automaticAction: false,
  };
}

export const mcp_lifecycleTransitions = {
  missing: ["missing", "disabled", "starting", "auth-required", "unknown"],
  disabled: ["starting", "disabled", "unknown"],
  starting: ["ready", "auth-required", "approval-pending", "disconnected", "degraded", "unknown"],
  "auth-required": ["starting", "disabled", "unknown"],
  "approval-pending": ["starting", "denied", "cancelled", "disconnected", "unknown"],
  ready: ["disconnected", "degraded", "disabled", "unknown"],
  degraded: ["starting", "ready", "disconnected", "disabled", "unknown"],
  disconnected: ["starting", "disabled", "unknown"],
  denied: ["ready", "degraded", "disabled", "starting"],
  cancelled: ["disconnected", "disabled", "ready"],
  unknown: ["starting", "disconnected", "disabled", "ready"],
} as const satisfies Readonly<Record<McpLifecycleState, readonly McpLifecycleState[]>>;

export interface McpTransitionContext {
  readonly newUserAction?: boolean;
  readonly directObservation?: boolean;
}

export function mcp_lifecycle_canTransition(
  from: unknown,
  to: unknown,
  context: McpTransitionContext = {},
): boolean {
  const previous = decodeLiteral(from, mcp_lifecycleStates, "from");
  const next = decodeLiteral(to, mcp_lifecycleStates, "to");
  if (!mcp_lifecycleTransitions[previous].some((candidate) => candidate === next)) return false;
  if (previous === "denied" && ["ready", "degraded", "starting"].includes(next)) {
    return context.newUserAction === true;
  }
  if (previous === "cancelled" && next === "ready") {
    return context.directObservation === true;
  }
  if (previous === "unknown" && next === "ready") {
    return context.directObservation === true;
  }
  return true;
}

export function mcp_probe_certifiesOnly(value: unknown): McpHarmlessCapabilityId {
  const probe = decodeLiteral(value, mcp_probeKinds, "probe");
  return probe === "browser_status"
    ? "browser-status"
    : probe === "ssh_status"
      ? "ssh-status"
      : "server-declared-harmless";
}

export function mcp_decodeSecretPresence(value: unknown): McpSecretPresence {
  prepareJson(value);
  const input = record(value, "secretPresence", [
    "environment",
    "headers",
    "oauth",
    "providerAuth",
    "credentialLikeArguments",
    "unknownFields",
  ]);
  return {
    environment: decodeBoolean(input.environment, "secretPresence.environment"),
    headers: decodeBoolean(input.headers, "secretPresence.headers"),
    oauth: decodeBoolean(input.oauth, "secretPresence.oauth"),
    providerAuth: decodeBoolean(input.providerAuth, "secretPresence.providerAuth"),
    credentialLikeArguments: decodeBoolean(
      input.credentialLikeArguments,
      "secretPresence.credentialLikeArguments",
    ),
    unknownFields: decodeBoolean(input.unknownFields, "secretPresence.unknownFields"),
  };
}

export function mcp_decodeOwnershipDescriptor(value: unknown): McpOwnershipDescriptor {
  prepareJson(value);
  const input = record(value, "ownership", ["kind", "cleanupOwner", "externalStateOwner"]);
  return {
    kind: decodeLiteral(input.kind, mcp_ownershipKinds, "ownership.kind"),
    cleanupOwner: decodeLiteral(
      input.cleanupOwner,
      ["pi-session", "external-owner"] as const,
      "ownership.cleanupOwner",
    ),
    externalStateOwner: decodeLiteral(
      input.externalStateOwner,
      ["none", "pi", "external-application", "browser-companion", "global-ssh-connect"] as const,
      "ownership.externalStateOwner",
    ),
  };
}

export function mcp_decodeTransportDescriptor(value: unknown): McpTransportDescriptor {
  prepareJson(value);
  if (!isPlainRecord(value)) throw new TypeError("transport must be a plain object.");
  if (value.kind === "stdio") {
    const input = record(value, "stdioTransport", [
      "kind",
      "executableLabel",
      "workingDirectoryLabel",
      "argumentCount",
    ]);
    return {
      kind: "stdio",
      executableLabel: decodeLabel(input.executableLabel, "stdioTransport.executableLabel"),
      workingDirectoryLabel: decodeNullableLabel(
        input.workingDirectoryLabel,
        "stdioTransport.workingDirectoryLabel",
      ),
      argumentCount: decodeNonNegativeInteger(
        input.argumentCount,
        "stdioTransport.argumentCount",
        mcp_maxCollectionLength,
      ),
    };
  }
  if (value.kind === "streamable-http") {
    const input = record(value, "httpTransport", ["kind", "endpoint", "headerNameCount"]);
    return {
      kind: "streamable-http",
      endpoint: decodeEndpoint(input.endpoint, "httpTransport.endpoint"),
      headerNameCount: decodeNonNegativeInteger(
        input.headerNameCount,
        "httpTransport.headerNameCount",
        mcp_maxCollectionLength,
      ),
    };
  }
  throw new TypeError("transport.kind is unsupported.");
}

export function mcp_decodeConfigSource(value: unknown): McpConfigSourceDescriptor {
  prepareJson(value);
  const input = record(value, "configSource", [
    "source",
    "state",
    "trust",
    "revision",
    "entryCount",
  ]);
  const source = decodeLiteral(input.source, mcp_configSourceKinds, "configSource.source");
  const trust = decodeLiteral(input.trust, mcp_projectTrustStates, "configSource.trust");
  if (
    (source === "user" && trust !== "not-applicable") ||
    (source === "project" && trust === "not-applicable")
  ) {
    throw new TypeError("configuration source trust is cross-associated.");
  }
  return {
    source,
    state: decodeLiteral(input.state, mcp_configSourceStates, "configSource.state"),
    trust,
    revision: decodeNonNegativeInteger(input.revision, "configSource.revision"),
    entryCount: decodeNonNegativeInteger(
      input.entryCount,
      "configSource.entryCount",
      mcp_maxCollectionLength,
    ),
  };
}

export function mcp_decodeEffectiveServer(value: unknown): McpEffectiveServerDescriptor {
  prepareJson(value);
  const input = record(value, "effectiveServer", [
    "serverId",
    "source",
    "definition",
    "overridden",
    "enabled",
    "exposure",
    "transport",
    "ownership",
    "toolCount",
    "secretPresence",
    "reasonCode",
  ]);
  const transport = mcp_decodeTransportDescriptor(input.transport);
  const ownership = mcp_decodeOwnershipDescriptor(input.ownership);
  const validOwnership =
    transport.kind === "stdio"
      ? ownership.kind === "owned-stdio-process" && ownership.cleanupOwner === "pi-session"
      : ownership.kind === "external-http-service" && ownership.cleanupOwner === "external-owner";
  if (!validOwnership) {
    throw new TypeError("transport and process ownership are cross-associated.");
  }
  const toolCount =
    input.toolCount === null
      ? null
      : decodeNonNegativeInteger(
          input.toolCount,
          "effectiveServer.toolCount",
          mcp_maxCollectionLength,
        );
  return {
    serverId: decodeIdentifier(input.serverId, "effectiveServer.serverId"),
    source: decodeLiteral(input.source, mcp_configSourceKinds, "effectiveServer.source"),
    definition: decodeLiteral(input.definition, mcp_definitionKinds, "effectiveServer.definition"),
    overridden: decodeBoolean(input.overridden, "effectiveServer.overridden"),
    enabled: decodeBoolean(input.enabled, "effectiveServer.enabled"),
    exposure: decodeLiteral(input.exposure, mcp_exposureKinds, "effectiveServer.exposure"),
    transport,
    ownership,
    toolCount,
    secretPresence: mcp_decodeSecretPresence(input.secretPresence),
    reasonCode: decodeReasonCode(input.reasonCode, "effectiveServer.reasonCode"),
  };
}

export function mcp_decodeConfigDiagnostic(value: unknown): McpConfigDiagnostic {
  prepareJson(value);
  const input = record(value, "configDiagnostic", ["source", "serverId", "reasonCode"]);
  return {
    source: decodeLiteral(input.source, mcp_configSourceKinds, "configDiagnostic.source"),
    serverId: decodeNullableIdentifier(input.serverId, "configDiagnostic.serverId"),
    reasonCode: decodeReasonCode(input.reasonCode, "configDiagnostic.reasonCode"),
  };
}

export function mcp_decodeConfigDescriptor(value: unknown): McpConfigDescriptor {
  prepareJson(value);
  const input = record(value, "config", [
    "schemaVersion",
    "scope",
    "revision",
    "autoEnableCodeMode",
    "sources",
    "servers",
    "diagnostics",
  ]);
  if (input.schemaVersion !== mcp_schemaVersion) {
    throw new TypeError("config schemaVersion is unsupported.");
  }
  const scope = mcp_decodeSessionScope(input.scope);
  const revision = decodePositiveInteger(input.revision, "config.revision");
  const sources = arrayValue(input.sources, "config.sources", 2).map(mcp_decodeConfigSource);
  if (
    !sources.some((source) => source.source === "user") ||
    new Set(sources.map((source) => source.source)).size !== sources.length
  ) {
    throw new TypeError("config sources require one user source and unique authorities.");
  }
  const servers = arrayValue(input.servers, "config.servers", mcp_maxCollectionLength).map(
    mcp_decodeEffectiveServer,
  );
  if (new Set(servers.map((server) => server.serverId)).size !== servers.length) {
    throw new TypeError("config server identities must be unique.");
  }
  const diagnostics = arrayValue(
    input.diagnostics,
    "config.diagnostics",
    mcp_maxCollectionLength,
  ).map(mcp_decodeConfigDiagnostic);
  return {
    schemaVersion: mcp_schemaVersion,
    scope,
    revision,
    autoEnableCodeMode: decodeBoolean(input.autoEnableCodeMode, "config.autoEnableCodeMode"),
    sources,
    servers,
    diagnostics,
  };
}

export function mcp_decodeApproval(value: unknown): McpApprovalDescriptor | null {
  prepareJson(value);
  if (value === null) return null;
  const input = record(value, "approval", ["state", "owner", "approvalGeneration", "current"]);
  const state = decodeLiteral(input.state, mcp_approvalStates, "approval.state");
  const approvalGeneration =
    input.approvalGeneration === null
      ? null
      : decodePositiveInteger(input.approvalGeneration, "approval.approvalGeneration");
  const current = decodeBoolean(input.current, "approval.current");
  if ((state === "not-required") !== (approvalGeneration === null)) {
    throw new TypeError("approval generation conflicts with approval state.");
  }
  if ((state === "stale" && current) || (state !== "stale" && !current)) {
    throw new TypeError("approval currency conflicts with approval state.");
  }
  return {
    state,
    owner: decodeLiteral(input.owner, mcp_approvalOwners, "approval.owner"),
    approvalGeneration,
    current,
  };
}

export function mcp_operation_approvalAllowsPhase(
  approvalState: McpApprovalState | null,
  phase: McpOperationPhase,
): boolean {
  const table = mcp_operationApprovalPhaseTable[approvalState ?? "not-required"];
  return table.some((candidate) => candidate === phase);
}

export function mcp_operation_phaseAllowsDispatch(
  phase: McpOperationPhase,
  dispatchState: McpDispatchState,
): boolean {
  return mcp_operationPhaseDispatchTable[phase].some((candidate) => candidate === dispatchState);
}

export function mcp_cancellation_hasConsistentTimestamps(
  state: McpCancellationState,
  requestedAt: number,
  confirmedAt: number | null,
): boolean {
  if (confirmedAt !== null && confirmedAt < requestedAt) return false;
  return state === "confirmed-before-dispatch" ? confirmedAt !== null : confirmedAt === null;
}

export function mcp_cancellation_hasConsistentDispatch(
  state: McpCancellationState,
  dispatchState: McpDispatchState,
): boolean {
  return state === "confirmed-before-dispatch"
    ? dispatchState === "not-dispatched"
    : state === "possibly-after-dispatch"
      ? dispatchState !== "not-dispatched"
      : true;
}

export function mcp_operation_cancellationAllowsPhase(
  cancellationState: McpCancellationState | null,
  phase: McpOperationPhase,
): boolean {
  return cancellationState === null
    ? phase !== "cancelled-before-dispatch"
    : mcp_operationCancellationPhaseTable[cancellationState].some(
        (candidate) => candidate === phase,
      );
}

export function mcp_decodeCancellation(value: unknown): McpCancellationDescriptor | null {
  prepareJson(value);
  if (value === null) return null;
  const input = record(value, "cancellation", ["state", "requestedAt", "confirmedAt"]);
  const state = decodeLiteral(input.state, mcp_cancellationStates, "cancellation.state");
  const requestedAt = decodeTimestamp(input.requestedAt, "cancellation.requestedAt");
  const confirmedAt =
    input.confirmedAt === null
      ? null
      : decodeTimestamp(input.confirmedAt, "cancellation.confirmedAt");
  if (!mcp_cancellation_hasConsistentTimestamps(state, requestedAt, confirmedAt)) {
    throw new TypeError("cancellation state conflicts with its confirmation timestamp.");
  }
  return {
    state,
    requestedAt,
    confirmedAt,
  };
}

export function mcp_decodeTerminal(value: unknown): McpTerminalDescriptor | null {
  prepareJson(value);
  if (value === null) return null;
  const input = record(value, "terminal", ["kind", "settledAt", "resultRef"]);
  return {
    kind: decodeLiteral(input.kind, mcp_terminalKinds, "terminal.kind"),
    settledAt: decodeTimestamp(input.settledAt, "terminal.settledAt"),
    resultRef: decodeNullableIdentifier(input.resultRef, "terminal.resultRef"),
  };
}

export function mcp_decodeOperation(value: unknown): McpOperationRecord {
  prepareJson(value);
  const input = record(value, "operation", [
    "schemaVersion",
    "operationId",
    "parentToolCallId",
    "scope",
    "configRevision",
    "generation",
    "toolName",
    "argumentDigest",
    "phase",
    "dispatchState",
    "approval",
    "cancellation",
    "terminal",
    "transportReplaced",
    "createdAt",
    "updatedAt",
  ]);
  if (input.schemaVersion !== mcp_schemaVersion) {
    throw new TypeError("operation schemaVersion is unsupported.");
  }
  const phase = decodeLiteral(input.phase, mcp_operationPhases, "operation.phase");
  const dispatchState = decodeLiteral(
    input.dispatchState,
    mcp_dispatchStates,
    "operation.dispatchState",
  );
  const approval = mcp_decodeApproval(input.approval);
  const cancellation = mcp_decodeCancellation(input.cancellation);
  const terminal = mcp_decodeTerminal(input.terminal);
  const createdAt = decodeTimestamp(input.createdAt, "operation.createdAt");
  const updatedAt = decodeTimestamp(input.updatedAt, "operation.updatedAt");
  if (updatedAt < createdAt) throw new TypeError("operation.updatedAt cannot precede createdAt.");
  if (!mcp_operation_approvalAllowsPhase(approval?.state ?? null, phase)) {
    throw new TypeError("approval state conflicts with operation phase.");
  }
  if (!mcp_operation_phaseAllowsDispatch(phase, dispatchState)) {
    throw new TypeError("operation phase conflicts with dispatch certainty.");
  }
  if (phase === "cancelled-before-dispatch") {
    if (
      dispatchState !== "not-dispatched" ||
      cancellation?.state !== "confirmed-before-dispatch" ||
      cancellation.confirmedAt === null ||
      terminal?.kind !== "cancelled"
    ) {
      throw new TypeError("pre-dispatch cancellation requires confirmation.");
    }
  }
  if (
    cancellation !== null &&
    (!mcp_cancellation_hasConsistentDispatch(cancellation.state, dispatchState) ||
      !mcp_operation_cancellationAllowsPhase(cancellation.state, phase))
  ) {
    throw new TypeError("cancellation state conflicts with dispatch or operation phase.");
  }
  if (phase === "result-known" && terminal === null) {
    throw new TypeError("result-known requires a terminal result.");
  }
  if (phase === "denied" && terminal?.kind !== "denied") {
    throw new TypeError("denied phase requires a terminal denial.");
  }
  if (
    terminal !== null &&
    phase !== "result-known" &&
    phase !== "denied" &&
    phase !== "cancelled-before-dispatch"
  ) {
    throw new TypeError("terminal result is inconsistent with the operation phase.");
  }
  return {
    schemaVersion: mcp_schemaVersion,
    operationId: decodeIdentifier(input.operationId, "operation.operationId"),
    parentToolCallId: decodeNullableIdentifier(
      input.parentToolCallId,
      "operation.parentToolCallId",
    ),
    scope: mcp_decodeServerScope(input.scope),
    configRevision: decodePositiveInteger(input.configRevision, "operation.configRevision"),
    generation: decodePositiveInteger(input.generation, "operation.generation"),
    toolName: decodeIdentifier(input.toolName, "operation.toolName"),
    argumentDigest: decodeDigest(input.argumentDigest, "operation.argumentDigest"),
    phase,
    dispatchState,
    approval,
    cancellation,
    terminal,
    transportReplaced: decodeBoolean(input.transportReplaced, "operation.transportReplaced"),
    createdAt,
    updatedAt,
  };
}

export function mcp_operation_isTerminal(value: unknown): boolean {
  const operation = mcp_decodeOperation(value);
  return (
    operation.phase === "result-known" ||
    operation.phase === "denied" ||
    operation.phase === "cancelled-before-dispatch"
  );
}

export function mcp_operation_canAutomaticallyReplay(value: unknown): false {
  // Decoding prevents forged non-JSON values from crossing this public predicate.
  void mcp_decodeOperation(value);
  return false;
}

/** Restart generations are strictly newer than the operation/checkpoint generation. */
export function mcp_restart_generationIsAdvancing(
  previousGeneration: number,
  nextGeneration: number,
): boolean {
  return nextGeneration > previousGeneration;
}

export function mcp_operation_recover(value: unknown, contextValue: unknown): McpOperationRecovery {
  const operation = mcp_decodeOperation(value);
  prepareJson(contextValue);
  const context = record(contextValue, "recoveryContext", [
    "trigger",
    "observedAt",
    "generation",
    "configRevision",
  ]);
  const trigger = decodeLiteral(
    context.trigger,
    [...mcp_restartTriggers, "configuration-change"] as const,
    "recoveryContext.trigger",
  );
  const observedAt = decodeTimestamp(context.observedAt, "recoveryContext.observedAt");
  const generation = decodePositiveInteger(context.generation, "recoveryContext.generation");
  const configRevision = decodePositiveInteger(
    context.configRevision,
    "recoveryContext.configRevision",
  );
  if (
    trigger === "restart" &&
    !mcp_restart_generationIsAdvancing(operation.generation, generation)
  ) {
    throw new TypeError("restart generation must advance beyond operation generation.");
  }
  const terminal =
    operation.phase === "result-known" ||
    operation.phase === "denied" ||
    operation.phase === "cancelled-before-dispatch";
  const approvalCurrent =
    operation.approval !== null &&
    operation.approval.current &&
    operation.generation === generation &&
    operation.configRevision === configRevision &&
    trigger !== "restart" &&
    !terminal;
  if (terminal) {
    return {
      operationId: operation.operationId,
      phase: operation.phase,
      dispatchState: operation.dispatchState,
      terminal: operation.terminal,
      approvalPreserved: operation.approval,
      approvalCurrent: false,
      automaticReplay: false,
      requiresUserReconciliation: false,
      requiresFreshApproval: false,
      reasonCode:
        operation.phase === "denied"
          ? "operation-denied"
          : operation.phase === "cancelled-before-dispatch"
            ? "operation-cancelled"
            : "none",
    };
  }
  if (operation.dispatchState === "not-dispatched") {
    return {
      operationId: operation.operationId,
      phase: operation.phase,
      dispatchState: operation.dispatchState,
      terminal: operation.terminal,
      approvalPreserved: operation.approval,
      approvalCurrent,
      automaticReplay: false,
      requiresUserReconciliation: false,
      requiresFreshApproval: operation.approval !== null && !approvalCurrent,
      reasonCode: trigger === "restart" ? "restart-inspection-required" : "none",
    };
  }
  void observedAt;
  return {
    operationId: operation.operationId,
    phase: "outcome-unknown",
    dispatchState: operation.dispatchState,
    terminal: null,
    approvalPreserved: operation.approval,
    approvalCurrent,
    automaticReplay: false,
    requiresUserReconciliation: true,
    requiresFreshApproval: operation.approval !== null || trigger === "restart",
    reasonCode: "outcome-unknown",
  };
}

export function mcp_decodePersistenceObservation(value: unknown): McpPersistenceObservation {
  prepareJson(value);
  const input = record(value, "persistence", [
    "schemaVersion",
    "status",
    "baseConfigRevision",
    "savedConfigRevision",
    "sessions",
  ]);
  if (input.schemaVersion !== mcp_schemaVersion) {
    throw new TypeError("persistence schemaVersion is unsupported.");
  }
  const status = decodeLiteral(
    input.status,
    ["unsaved", "saved", "conflict"] as const,
    "persistence.status",
  );
  const savedConfigRevision =
    input.savedConfigRevision === null
      ? null
      : decodePositiveInteger(input.savedConfigRevision, "persistence.savedConfigRevision");
  if ((status === "saved") !== (savedConfigRevision !== null)) {
    throw new TypeError("persistence saved revision is cross-associated with its status.");
  }
  const sessions = arrayValue(input.sessions, "persistence.sessions", mcp_maxCollectionLength).map(
    (entry, index) => {
      const session = record(entry, `persistence.sessions[${index}]`, [
        "sessionId",
        "generation",
        "observedConfigRevision",
        "reobserved",
      ]);
      return {
        sessionId: decodeIdentifier(session.sessionId, `persistence.sessions[${index}].sessionId`),
        generation: decodePositiveInteger(
          session.generation,
          `persistence.sessions[${index}].generation`,
        ),
        observedConfigRevision:
          session.observedConfigRevision === null
            ? null
            : decodePositiveInteger(
                session.observedConfigRevision,
                `persistence.sessions[${index}].observedConfigRevision`,
              ),
        reobserved: decodeBoolean(session.reobserved, `persistence.sessions[${index}].reobserved`),
      };
    },
  );
  if (new Set(sessions.map((session) => session.sessionId)).size !== sessions.length) {
    throw new TypeError("persistence session identities must be unique.");
  }
  return {
    schemaVersion: mcp_schemaVersion,
    status,
    baseConfigRevision: decodePositiveInteger(
      input.baseConfigRevision,
      "persistence.baseConfigRevision",
    ),
    savedConfigRevision,
    sessions,
  };
}

export function mcp_persistence_project(value: unknown): McpPersistenceOverlay {
  const observation = mcp_decodePersistenceObservation(value);
  if (observation.status === "conflict") {
    return {
      state: "conflict",
      savedConfigRevision: null,
      activeSessionCount: 0,
      affectedSessionCount: observation.sessions.length,
      reasonCode: "configuration-changed",
    };
  }
  if (observation.status === "unsaved") {
    return {
      state: "unsaved",
      savedConfigRevision: null,
      activeSessionCount: 0,
      affectedSessionCount: observation.sessions.length,
      reasonCode: "none",
    };
  }
  const savedConfigRevision = observation.savedConfigRevision;
  if (savedConfigRevision === null) throw new TypeError("saved persistence requires a revision.");
  const activeSessionCount = observation.sessions.filter(
    (session) => session.reobserved && session.observedConfigRevision === savedConfigRevision,
  ).length;
  const affectedSessionCount = observation.sessions.length;
  if (affectedSessionCount > 0 && activeSessionCount === affectedSessionCount) {
    return {
      state: "saved-and-active",
      savedConfigRevision,
      activeSessionCount,
      affectedSessionCount,
      reasonCode: "none",
    };
  }
  if (activeSessionCount === 0) {
    return {
      state: "saved-not-active",
      savedConfigRevision,
      activeSessionCount,
      affectedSessionCount,
      reasonCode: "restart-inspection-required",
    };
  }
  return {
    state: "saved-partial",
    savedConfigRevision,
    activeSessionCount,
    affectedSessionCount,
    reasonCode: "configuration-changed",
  };
}

export function mcp_decodeSkillsObservation(value: unknown): McpSkillsObservation {
  prepareJson(value);
  const input = record(value, "skillsObservation", [
    "schemaVersion",
    "state",
    "provenance",
    "scope",
    "configRevision",
    "generation",
    "observedAt",
    "freshUntil",
    "automaticReload",
    "registryRead",
  ]);
  if (input.schemaVersion !== mcp_schemaVersion) {
    throw new TypeError("skills schemaVersion is unsupported.");
  }
  if (
    decodeBoolean(input.automaticReload, "skillsObservation.automaticReload") ||
    decodeBoolean(input.registryRead, "skillsObservation.registryRead")
  ) {
    throw new TypeError("Skills Stage 0 observation cannot reload or read a registry.");
  }
  return {
    schemaVersion: mcp_schemaVersion,
    state: decodeLiteral(input.state, mcp_skillsStates, "skillsObservation.state"),
    provenance: decodeLiteral(
      input.provenance,
      ["runtime-supervisor"] as const,
      "skillsObservation.provenance",
    ),
    scope: mcp_decodeSessionScope(input.scope),
    configRevision: decodePositiveInteger(input.configRevision, "skillsObservation.configRevision"),
    generation: decodePositiveInteger(input.generation, "skillsObservation.generation"),
    ...decodeFreshness(input, "skillsObservation"),
    automaticReload: false,
    registryRead: false,
  };
}

export function mcp_decodeCheckpoint(value: unknown): McpCheckpoint {
  prepareJson(value);
  const input = record(value, "checkpoint", [
    "schemaVersion",
    "checkpointId",
    "createdAt",
    "scope",
    "configRevision",
    "generation",
    "config",
    "persistence",
    "lifecycles",
    "operations",
    "skills",
  ]);
  if (input.schemaVersion !== mcp_schemaVersion) {
    throw new TypeError("checkpoint schemaVersion is unsupported.");
  }
  const scope = mcp_decodeSessionScope(input.scope);
  const configRevision = decodePositiveInteger(input.configRevision, "checkpoint.configRevision");
  const generation = decodePositiveInteger(input.generation, "checkpoint.generation");
  const config = mcp_decodeConfigDescriptor(input.config);
  if (!scopesEqual(config.scope, scope) || config.revision !== configRevision) {
    throw new TypeError("checkpoint config is cross-associated.");
  }
  const lifecycles = arrayValue(
    input.lifecycles,
    "checkpoint.lifecycles",
    mcp_maxCollectionLength,
  ).map(mcp_decodeLifecycleObservation);
  if (new Set(lifecycles.map((lifecycle) => lifecycle.scope.serverId)).size !== lifecycles.length) {
    throw new TypeError("checkpoint server lifecycles must be unique.");
  }
  for (const lifecycle of lifecycles) {
    if (
      !scopesEqual(lifecycle.scope, scope) ||
      lifecycle.configRevision !== configRevision ||
      lifecycle.generation !== generation
    ) {
      throw new TypeError("checkpoint lifecycle is cross-associated.");
    }
    if (!config.servers.some((server) => server.serverId === lifecycle.scope.serverId)) {
      throw new TypeError("checkpoint lifecycle server is cross-associated with configuration.");
    }
  }
  const operations = arrayValue(
    input.operations,
    "checkpoint.operations",
    mcp_maxCollectionLength,
  ).map(mcp_decodeOperation);
  if (new Set(operations.map((operation) => operation.operationId)).size !== operations.length) {
    throw new TypeError("checkpoint operation identities must be unique.");
  }
  for (const operation of operations) {
    if (
      !scopesEqual(operation.scope, scope) ||
      operation.configRevision !== configRevision ||
      operation.generation !== generation
    ) {
      throw new TypeError("checkpoint operation is cross-associated.");
    }
    if (!config.servers.some((server) => server.serverId === operation.scope.serverId)) {
      throw new TypeError("checkpoint operation server is cross-associated with configuration.");
    }
  }
  const skills = mcp_decodeSkillsObservation(input.skills);
  if (
    !scopesEqual(skills.scope, scope) ||
    skills.configRevision !== configRevision ||
    skills.generation !== generation
  ) {
    throw new TypeError("checkpoint Skills observation is cross-associated.");
  }
  return {
    schemaVersion: mcp_schemaVersion,
    checkpointId: decodeIdentifier(input.checkpointId, "checkpoint.checkpointId"),
    createdAt: decodeTimestamp(input.createdAt, "checkpoint.createdAt"),
    scope,
    configRevision,
    generation,
    config,
    persistence: mcp_decodePersistenceObservation(input.persistence),
    lifecycles,
    operations,
    skills,
  };
}

/**
 * Inspect a checkpoint after restart. This never launches an MCP client,
 * reconnects, replays an operation, or preserves a live/approval assumption.
 */
export function mcp_checkpoint_inspect(
  value: unknown,
  nextGenerationValue: unknown,
): McpRestartInspection {
  const checkpoint = mcp_decodeCheckpoint(value);
  const nextGeneration = decodePositiveInteger(nextGenerationValue, "nextGeneration");
  if (!mcp_restart_generationIsAdvancing(checkpoint.generation, nextGeneration)) {
    throw new TypeError("restart generation must advance beyond the checkpoint.");
  }
  const persistence = mcp_persistence_project(checkpoint.persistence);
  const servers = checkpoint.lifecycles.map((lifecycle) => ({
    serverId: lifecycle.scope.serverId,
    previousGeneration: lifecycle.generation,
    state: "unknown" as const,
    observerPresent: false as const,
    reasonCode: "restart-inspection-required" as const,
    automaticAction: false as const,
  }));
  const operations = checkpoint.operations.map((operation) => {
    const terminalResult =
      operation.phase === "result-known" ||
      operation.phase === "denied" ||
      operation.phase === "cancelled-before-dispatch";
    const knownNotDispatched = !terminalResult && operation.dispatchState === "not-dispatched";
    return {
      operationId: operation.operationId,
      parentToolCallId: operation.parentToolCallId,
      serverId: operation.scope.serverId,
      toolName: operation.toolName,
      argumentDigest: operation.argumentDigest,
      phase: terminalResult || knownNotDispatched ? operation.phase : ("outcome-unknown" as const),
      dispatchState: operation.dispatchState,
      terminal: operation.terminal,
      approvalPreserved: operation.approval,
      approvalCurrent: false as const,
      automaticReplay: false as const,
      requiresUserReconciliation: !terminalResult && !knownNotDispatched,
      reasonCode: terminalResult
        ? ("none" as const)
        : knownNotDispatched
          ? ("restart-inspection-required" as const)
          : ("outcome-unknown" as const),
    };
  });
  return {
    checkpointId: checkpoint.checkpointId,
    previousGeneration: checkpoint.generation,
    nextGeneration,
    scope: checkpoint.scope,
    persistence,
    servers,
    operations,
    skills: {
      schemaVersion: mcp_schemaVersion,
      state: "required",
      provenance: "runtime-supervisor",
      scope: checkpoint.scope,
      configRevision: checkpoint.configRevision,
      generation: nextGeneration,
      observedAt: checkpoint.createdAt,
      freshUntil: checkpoint.createdAt,
      automaticReload: false,
      registryRead: false,
    },
    automaticActions: [],
  };
}
