/**
 * Browser-safe Setup Centre contracts.
 *
 * Every value here is bounded JSON data. This module has no filesystem, process,
 * Electron, provider, credential, timer, or network behavior. Stable reason codes
 * replace forwarded errors and other external text.
 */

export const setupCentre_schemaVersion = 3 as const;
export const setupCentre_checkpointAnchorSchemaVersion = 1 as const;

export const setupCentre_routeIds = [
  "direct-provider",
  "codex-router",
  "browser-mcp-companion",
  "global-ssh-connect",
] as const;
export type SetupRouteId = (typeof setupCentre_routeIds)[number];

export const setupCentre_componentIds = [
  "pi-core",
  "direct-provider",
  "codex-router",
  "browser-mcp-companion",
  "global-ssh-connect",
] as const;
export type SetupComponentId = (typeof setupCentre_componentIds)[number];

export const setupCentre_stepIds = [
  "detection",
  "installation",
  "process",
  "endpoint",
  "account",
  "catalogue",
  "permission",
  "probe",
] as const;
export type SetupStepId = (typeof setupCentre_stepIds)[number];

export const setupCentre_evidenceStates = [
  "verified",
  "present-unverified",
  "not-detected",
  "unsupported",
  "unknown",
] as const;
export type SetupEvidenceState = (typeof setupCentre_evidenceStates)[number];

export const setupCentre_ownerships = [
  "bundled",
  "pi-gui-managed",
  "user-managed",
  "external",
  "unknown",
] as const;
export type SetupOwnership = (typeof setupCentre_ownerships)[number];

export const setupCentre_reasonCodes = [
  "detected",
  "not-found",
  "version-mismatch",
  "integrity-unverified",
  "ownership-unknown",
  "process-stopped",
  "process-running-unverified",
  "endpoint-unreachable",
  "identity-mismatch",
  "credentials-missing",
  "account-action-required",
  "catalogue-empty",
  "catalogue-stale",
  "permission-required",
  "native-approval-required",
  "probe-not-run",
  "probe-failed",
  "probe-unknown",
  "operation-cancelled",
  "partial-effects",
  "configuration-changed",
  "restart-inspection-required",
  "unsupported-platform",
  "policy-blocked",
] as const;
export type SetupReasonCode = (typeof setupCentre_reasonCodes)[number];

export const setupCentre_readiness = [
  "ready",
  "not-detected",
  "needs-install",
  "needs-process",
  "needs-endpoint",
  "needs-account",
  "needs-catalogue",
  "needs-permission",
  "needs-probe",
  "needs-inspection",
  "unsupported",
] as const;
export type SetupReadiness = (typeof setupCentre_readiness)[number];

export const setupCentre_progressStates = ["pending", "complete", "skipped"] as const;
export type SetupProgressState = (typeof setupCentre_progressStates)[number];

export const setupCentre_stepProjectionStates = [
  "complete",
  "current",
  "pending",
  "skipped",
  "needs-action",
  "unknown",
] as const;
export type SetupStepProjectionState = (typeof setupCentre_stepProjectionStates)[number];

export const setupCentre_operationModes = ["inspect", "mutate", "probe"] as const;
export type SetupOperationMode = (typeof setupCentre_operationModes)[number];

export const setupCentre_cancellationReasons = [
  "user-cancelled",
  "application-stopping",
  "configuration-changed",
  "replaced-by-handoff",
] as const;
export type SetupCancellationReason = (typeof setupCentre_cancellationReasons)[number];

export const setupCentre_cancellationOutcomes = [
  "never-started",
  "stopped",
  "completed-before-cancel",
  "failed-to-stop",
  "unknown",
] as const;
export type SetupCancellationOutcome = (typeof setupCentre_cancellationOutcomes)[number];

export const setupCentre_retiredOperationOutcomes = [
  "never-started",
  "stopped",
  "completed-before-cancel",
] as const;
export type SetupRetiredOperationOutcome = (typeof setupCentre_retiredOperationOutcomes)[number];

export const setupCentre_effectStates = ["none", "partial", "unknown"] as const;
export type SetupEffectState = (typeof setupCentre_effectStates)[number];

export const setupCentre_handoffKinds = [
  "inspect-current-state",
  "install-or-use-existing",
  "start-or-use-existing-service",
  "complete-account-step",
  "review-native-approval",
  "run-user-started-probe",
] as const;
export type SetupHandoffKind = (typeof setupCentre_handoffKinds)[number];

export const setupCentre_maxIdentifierLength = 160;
export const setupCentre_maxCollectionLength = 32;
export const setupCentre_maxRetiredOperations = 32;
export const setupCentre_maxJsonDepth = 12;
export const setupCentre_maxJsonNodes = 512;
export const setupCentre_maxJsonFields = 32;
export const setupCentre_maxTimestamp = 253_402_300_799_999;

export interface SetupEvidenceFact {
  readonly dimension: SetupStepId;
  readonly state: SetupEvidenceState;
  readonly observedAt: number;
  readonly reasonCode: SetupReasonCode | null;
}

export interface SetupComponentFacts {
  readonly componentId: SetupComponentId;
  readonly ownership: SetupOwnership;
  readonly configRevision: number;
  readonly generation: number;
  readonly facts: readonly SetupEvidenceFact[];
}

export type SetupRouteStepRequirement = "required" | "optional";

export interface SetupRouteStep {
  readonly step: SetupStepId;
  readonly requirement: SetupRouteStepRequirement;
}

export interface SetupRoute {
  readonly routeId: SetupRouteId;
  readonly componentId: SetupComponentId;
  readonly steps: readonly SetupRouteStep[];
}

export const setupCentre_routes = [
  {
    routeId: "direct-provider",
    componentId: "direct-provider",
    steps: [
      { step: "detection", requirement: "required" },
      { step: "installation", requirement: "required" },
      { step: "account", requirement: "required" },
      { step: "catalogue", requirement: "required" },
      { step: "probe", requirement: "required" },
    ],
  },
  {
    routeId: "codex-router",
    componentId: "codex-router",
    steps: [
      { step: "detection", requirement: "required" },
      { step: "installation", requirement: "required" },
      { step: "process", requirement: "required" },
      { step: "endpoint", requirement: "required" },
      { step: "account", requirement: "required" },
      { step: "catalogue", requirement: "required" },
      { step: "permission", requirement: "optional" },
      { step: "probe", requirement: "required" },
    ],
  },
  {
    routeId: "browser-mcp-companion",
    componentId: "browser-mcp-companion",
    steps: [
      { step: "detection", requirement: "required" },
      { step: "installation", requirement: "required" },
      { step: "process", requirement: "required" },
      { step: "endpoint", requirement: "required" },
      { step: "permission", requirement: "required" },
      { step: "probe", requirement: "required" },
    ],
  },
  {
    routeId: "global-ssh-connect",
    componentId: "global-ssh-connect",
    steps: [
      { step: "detection", requirement: "required" },
      { step: "installation", requirement: "required" },
      { step: "process", requirement: "required" },
      { step: "endpoint", requirement: "optional" },
      { step: "account", requirement: "optional" },
      { step: "permission", requirement: "required" },
      { step: "probe", requirement: "required" },
    ],
  },
] as const satisfies readonly SetupRoute[];

for (const route of setupCentre_routes) {
  Object.freeze(route.steps);
  Object.freeze(route);
}
for (const values of [
  setupCentre_routeIds,
  setupCentre_componentIds,
  setupCentre_stepIds,
  setupCentre_evidenceStates,
  setupCentre_ownerships,
  setupCentre_reasonCodes,
  setupCentre_readiness,
  setupCentre_progressStates,
  setupCentre_stepProjectionStates,
  setupCentre_operationModes,
  setupCentre_cancellationReasons,
  setupCentre_cancellationOutcomes,
  setupCentre_retiredOperationOutcomes,
  setupCentre_effectStates,
  setupCentre_handoffKinds,
]) {
  Object.freeze(values);
}
Object.freeze(setupCentre_routes);

export interface SetupProgressStep {
  readonly step: SetupStepId;
  readonly state: SetupProgressState;
}

export interface SetupProgress {
  readonly routeId: SetupRouteId;
  readonly generation: number;
  readonly configRevision: number;
  readonly steps: readonly SetupProgressStep[];
}

export interface SetupRetiredOperation {
  readonly operationId: string;
  readonly operationSequence: number;
  readonly generation: number;
  readonly retiredAt: number;
  readonly outcome: SetupRetiredOperationOutcome;
  readonly cancellationId: string;
  readonly effects: SetupEffectState;
}

export interface SetupCheckpoint {
  readonly schemaVersion: typeof setupCentre_schemaVersion;
  readonly routeId: SetupRouteId;
  readonly componentId: SetupComponentId;
  readonly generation: number;
  readonly configRevision: number;
  readonly operationSequence: number;
  readonly lastCompletedOperationId: string | null;
  readonly retiredOperations: readonly SetupRetiredOperation[];
  readonly progress: SetupProgress;
}

/**
 * A checkpoint anchor must be supplied separately by the persistence owner.
 * The pure domain can prove checkpoint/anchor equality but cannot authenticate
 * the source; cryptographic or storage-level trust belongs to that owner.
 */
export interface SetupCheckpointAnchor {
  readonly schemaVersion: typeof setupCentre_checkpointAnchorSchemaVersion;
  readonly authority: "persistence-owner";
  readonly checkpoint: SetupCheckpoint;
}

export interface SetupResourceKey {
  readonly componentId: SetupComponentId;
  readonly resource: SetupStepId;
  readonly scopeId: string;
}

export interface SetupOperationRequest {
  readonly operationId: string;
  readonly routeId: SetupRouteId;
  readonly step: SetupStepId;
  readonly resourceKey: SetupResourceKey;
  readonly mode: SetupOperationMode;
  readonly generation: number;
  readonly configRevision: number;
  readonly startedBy: "user";
}

export interface SetupLogicalOperation {
  readonly kind: "logical-operation";
  readonly request: SetupOperationRequest;
  readonly operationSequence: number;
  readonly openedAt: number;
  readonly state: "owned";
}

export interface SetupOperationResult {
  readonly operationId: string;
  readonly routeId: SetupRouteId;
  readonly step: SetupStepId;
  readonly resourceKey: SetupResourceKey;
  readonly generation: number;
  readonly configRevision: number;
  readonly fact: SetupEvidenceFact;
}

export interface SetupCancellationRequest {
  readonly cancellationId: string;
  readonly operationId: string;
  readonly generation: number;
  readonly configRevision: number;
  readonly reason: SetupCancellationReason;
}

export interface SetupCancellationIntent {
  readonly kind: "cancellation-intent";
  readonly request: SetupCancellationRequest;
  readonly requestedAt: number;
}

export interface SetupCancellationReceipt {
  readonly kind: "cancellation-receipt";
  readonly cancellationId: string;
  readonly operationId: string;
  readonly generation: number;
  readonly configRevision: number;
  readonly outcome: SetupCancellationOutcome;
  readonly effects: SetupEffectState;
  readonly observedAt: number;
}

export interface SetupHandoff {
  readonly kind: SetupHandoffKind;
  readonly routeId: SetupRouteId;
  readonly step: SetupStepId;
  readonly generation: number;
  readonly configRevision: number;
  readonly operationId: string | null;
  readonly reasonCode: SetupReasonCode;
}

export interface SetupStepProjection {
  readonly step: SetupStepId;
  readonly requirement: SetupRouteStepRequirement;
  readonly state: SetupStepProjectionState;
  readonly evidence: SetupEvidenceState;
  readonly reasonCode: SetupReasonCode | null;
}

export interface SetupStatusProjection {
  readonly routeId: SetupRouteId;
  readonly componentId: SetupComponentId;
  readonly readiness: SetupReadiness;
  readonly ready: boolean;
  readonly requiresInspection: boolean;
  readonly currentStep: SetupStepId | null;
  readonly steps: readonly SetupStepProjection[];
  readonly handoff: SetupHandoff | null;
}

export interface SetupRestartObservation {
  readonly restartId: string;
  readonly configRevision: number;
}

export const setupPersistence_schemaVersion = 1 as const;
export const setupPersistence_transitionKinds = [
  "admit",
  "settle",
  "retire",
  "cancel-nonreleasing",
  "restart",
  "configure",
] as const;
export type SetupPersistenceTransitionKind = (typeof setupPersistence_transitionKinds)[number];

export const setupPersistence_cursorKinds = ["idle", "admitted", "settled", "retired"] as const;
export type SetupPersistenceCursorKind = (typeof setupPersistence_cursorKinds)[number];

export const setupPersistence_settlementOutcomes = ["verified", "unverified"] as const;
export type SetupPersistenceSettlementOutcome =
  (typeof setupPersistence_settlementOutcomes)[number];

for (const values of [
  setupPersistence_transitionKinds,
  setupPersistence_cursorKinds,
  setupPersistence_settlementOutcomes,
]) {
  Object.freeze(values);
}

export interface SetupPersistenceIdentity {
  readonly generation: number;
  readonly configRevision: number;
  readonly operationSequence: number;
  readonly operationId: string;
  readonly step: SetupStepId;
  readonly resourceKey: SetupResourceKey;
}

export interface SetupPersistenceIdleCursor {
  readonly kind: "idle";
}

export interface SetupPersistenceAdmittedCursor {
  readonly kind: "admitted";
  readonly identity: SetupPersistenceIdentity;
}

export interface SetupPersistenceSettledCursor {
  readonly kind: "settled";
  readonly identity: SetupPersistenceIdentity;
  readonly outcome: SetupPersistenceSettlementOutcome;
}

export interface SetupPersistenceRetiredCursor {
  readonly kind: "retired";
  readonly identity: SetupPersistenceIdentity;
  readonly outcome: "releasing-cancellation";
  readonly cancellationId: string;
  readonly cancellationOutcome: SetupRetiredOperationOutcome;
  readonly effects: SetupEffectState;
}

export type SetupPersistenceCursor =
  | SetupPersistenceIdleCursor
  | SetupPersistenceAdmittedCursor
  | SetupPersistenceSettledCursor
  | SetupPersistenceRetiredCursor;

/**
 * The future persistence owner supplies this authenticated-in-context snapshot.
 * The pure validator enforces the expected revision and transition, but does not
 * authenticate the source or perform storage I/O.
 */
export interface SetupPersistenceAuthorityState {
  readonly schemaVersion: typeof setupPersistence_schemaVersion;
  readonly authority: "persistence-owner";
  readonly authorityRevision: number;
  readonly cursor: SetupPersistenceCursor;
}

export interface SetupPersistenceAdmitRequest {
  readonly kind: "admit";
  readonly expectedAuthorityRevision: number;
  readonly identity: SetupPersistenceIdentity;
}

export interface SetupPersistenceSettleRequest {
  readonly kind: "settle";
  readonly expectedAuthorityRevision: number;
  readonly identity: SetupPersistenceIdentity;
  readonly outcome: SetupPersistenceSettlementOutcome;
}

export interface SetupPersistenceRetireRequest {
  readonly kind: "retire";
  readonly expectedAuthorityRevision: number;
  readonly identity: SetupPersistenceIdentity;
  readonly cancellationId: string;
  readonly cancellationOutcome: SetupRetiredOperationOutcome;
  readonly effects: SetupEffectState;
  readonly retiredAt: number;
}

export interface SetupPersistenceNonReleasingCancellationRequest {
  readonly kind: "cancel-nonreleasing";
  readonly expectedAuthorityRevision: number;
  readonly identity: SetupPersistenceIdentity;
  readonly cancellationId: string;
  readonly cancellationOutcome: "failed-to-stop" | "unknown";
  readonly effects: "partial" | "unknown";
}

export interface SetupPersistenceRestartRequest {
  readonly kind: "restart";
  readonly expectedAuthorityRevision: number;
  readonly restartId: string;
  readonly configRevision: number;
}

export interface SetupPersistenceConfigureRequest {
  readonly kind: "configure";
  readonly expectedAuthorityRevision: number;
  readonly configRevision: number;
}

export type SetupPersistenceTransitionRequest =
  | SetupPersistenceAdmitRequest
  | SetupPersistenceSettleRequest
  | SetupPersistenceRetireRequest
  | SetupPersistenceNonReleasingCancellationRequest
  | SetupPersistenceRestartRequest
  | SetupPersistenceConfigureRequest;

export interface SetupPersistenceTransitionResult {
  readonly decision: "accepted" | "idempotent";
  readonly transition: SetupPersistenceTransitionKind;
  readonly cursor: SetupPersistenceCursor;
  readonly authorityRevision: number;
  readonly commitRequired: boolean;
  readonly clearsOwnership: boolean;
  readonly requiresInspection: boolean;
  readonly automaticActions: readonly [];
}

interface JsonWalk {
  nodes: number;
}

function setupCentre_isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function setupCentre_hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
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

function setupCentre_assertJsonValue(
  value: unknown,
  walk: JsonWalk,
  ancestors: WeakSet<object>,
  depth = 0,
  location = "$",
): void {
  walk.nodes += 1;
  if (walk.nodes > setupCentre_maxJsonNodes) {
    throw new TypeError(`${location} exceeds the JSON node limit.`);
  }
  if (depth > setupCentre_maxJsonDepth) {
    throw new TypeError(`${location} exceeds the nesting limit.`);
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > setupCentre_maxIdentifierLength) {
      throw new TypeError(`${location} exceeds the string limit.`);
    }
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
    if (value.length > setupCentre_maxCollectionLength) {
      throw new TypeError(`${location} exceeds the collection limit.`);
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
      setupCentre_assertJsonValue(
        descriptor.value,
        walk,
        ancestors,
        depth + 1,
        `${location}[${index}]`,
      );
    }
  } else {
    if (!setupCentre_isRecord(value)) {
      throw new TypeError(`${location} must be a plain object.`);
    }
    const ownNames = Object.getOwnPropertyNames(value);
    if (ownNames.length > setupCentre_maxJsonFields) {
      throw new TypeError(`${location} has too many fields.`);
    }
    for (const name of ownNames) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${location}.${name} must be enumerable data.`);
      }
      setupCentre_assertJsonValue(
        descriptor.value,
        walk,
        ancestors,
        depth + 1,
        `${location}.${name}`,
      );
    }
  }
  ancestors.delete(value);
}

function setupCentre_prepare(value: unknown): void {
  setupCentre_assertJsonValue(value, { nodes: 0 }, new WeakSet<object>());
}

/**
 * Identifier policy: identifiers are bounded opaque ASCII handles, never external text.
 * The decoder rejects semantic credential words and closed GitHub, AWS, Slack, and Stripe
 * token prefixes. Errors name only the field and never echo the candidate value.
 */
const setupCentre_credentialPrefixes = [
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "github_pat_",
  "xoxa-",
  "xoxb-",
  "xoxc-",
  "xoxe-",
  "xoxo-",
  "xoxp-",
  "xoxr-",
  "xoxs-",
  "xapp-",
  "sk_live_",
  "rk_live_",
  "sk_test_",
  "rk_test_",
  "whsec_",
] as const;
Object.freeze(setupCentre_credentialPrefixes);

function setupCentre_assertNoSecretBearingIdentifier(value: string, field: string): void {
  const lowered = value.toLowerCase();
  const awsAccessKey =
    (value.startsWith("AKIA") || value.startsWith("ASIA")) &&
    value.length === 20 &&
    [...value.slice(4)].every(
      (character) =>
        (character >= "A" && character <= "Z") || (character >= "0" && character <= "9"),
    );
  const prefixed =
    setupCentre_credentialPrefixes.some((prefix) => lowered.startsWith(prefix)) || awsAccessKey;
  if (
    prefixed ||
    lowered.includes("secret") ||
    lowered.includes("password") ||
    lowered.includes("authorization") ||
    lowered.includes("bearer") ||
    lowered.includes("apikey") ||
    lowered.includes("api_key") ||
    lowered.startsWith("sk-") ||
    lowered.startsWith("sk_") ||
    lowered.startsWith("eyj")
  ) {
    throw new TypeError(`${field} cannot be a credential-shaped identifier.`);
  }
}

function setupCentre_decodeIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > setupCentre_maxIdentifierLength ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new TypeError(`${field} must be a bounded opaque identifier.`);
  }
  setupCentre_assertNoSecretBearingIdentifier(value, field);
  return value;
}

function setupCentre_decodePositiveInteger(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(`${field} must be a positive safe integer.`);
  }
  return value as number;
}

function setupCentre_decodeNonNegativeInteger(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError(`${field} must be a nonnegative safe integer.`);
  }
  return value as number;
}

function setupCentre_decodeTimestamp(value: unknown, field: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > setupCentre_maxTimestamp
  ) {
    throw new TypeError(`${field} must be a bounded timestamp.`);
  }
  return value as number;
}

function setupCentre_decodeLiteral<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new TypeError(`${field} is not an accepted value.`);
  }
  return value as T;
}

function setupCentre_decodeNullableReason(value: unknown, field: string): SetupReasonCode | null {
  return value === null ? null : setupCentre_decodeLiteral(value, setupCentre_reasonCodes, field);
}

export function setupCentre_decodeRoute(value: unknown): SetupRoute {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["routeId", "componentId", "steps"])
  ) {
    throw new TypeError("route has an unsupported shape.");
  }
  const routeId = setupCentre_decodeLiteral(value.routeId, setupCentre_routeIds, "routeId");
  const componentId = setupCentre_decodeLiteral(
    value.componentId,
    setupCentre_componentIds,
    "componentId",
  );
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new TypeError("route.steps must be a non-empty array.");
  }
  const steps = value.steps.map((entry, index) => {
    if (!setupCentre_isRecord(entry) || !setupCentre_hasExactKeys(entry, ["step", "requirement"])) {
      throw new TypeError(`route.steps[${index}] has an unsupported shape.`);
    }
    return {
      step: setupCentre_decodeLiteral(
        entry.step,
        setupCentre_stepIds,
        `route.steps[${index}].step`,
      ),
      requirement: setupCentre_decodeLiteral(
        entry.requirement,
        ["required", "optional"] as const,
        `route.steps[${index}].requirement`,
      ),
    };
  });
  if (new Set(steps.map((step) => step.step)).size !== steps.length) {
    throw new TypeError("route steps must be unique.");
  }
  const expected = setupCentre_routes.find((route) => route.routeId === routeId);
  if (
    !expected ||
    expected.componentId !== componentId ||
    expected.steps.length !== steps.length ||
    expected.steps.some(
      (routeStep, index) =>
        routeStep.step !== steps[index]?.step ||
        routeStep.requirement !== steps[index]?.requirement,
    )
  ) {
    throw new TypeError("route does not match the closed setup definition.");
  }
  return { routeId, componentId, steps };
}

function setupCentre_routeDefinition(routeId: SetupRouteId): SetupRoute {
  const route = setupCentre_routes.find((candidate) => candidate.routeId === routeId);
  if (!route) throw new TypeError("route is not defined.");
  return setupCentre_decodeRoute(route);
}

export function setupCentre_decodeEvidenceFact(value: unknown): SetupEvidenceFact {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["dimension", "state", "observedAt", "reasonCode"])
  ) {
    throw new TypeError("evidence fact has an unsupported shape.");
  }
  return {
    dimension: setupCentre_decodeLiteral(value.dimension, setupCentre_stepIds, "fact.dimension"),
    state: setupCentre_decodeLiteral(value.state, setupCentre_evidenceStates, "fact.state"),
    observedAt: setupCentre_decodeTimestamp(value.observedAt, "fact.observedAt"),
    reasonCode: setupCentre_decodeNullableReason(value.reasonCode, "fact.reasonCode"),
  };
}

export function setupCentre_decodeComponentFacts(value: unknown): SetupComponentFacts {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "componentId",
      "ownership",
      "configRevision",
      "generation",
      "facts",
    ])
  ) {
    throw new TypeError("component facts have an unsupported shape.");
  }
  if (!Array.isArray(value.facts)) {
    throw new TypeError("component facts.facts must be an array.");
  }
  const facts = value.facts.map(setupCentre_decodeEvidenceFact);
  if (new Set(facts.map((fact) => fact.dimension)).size !== facts.length) {
    throw new TypeError("component fact dimensions must be unique.");
  }
  return {
    componentId: setupCentre_decodeLiteral(
      value.componentId,
      setupCentre_componentIds,
      "componentId",
    ),
    ownership: setupCentre_decodeLiteral(value.ownership, setupCentre_ownerships, "ownership"),
    configRevision: setupCentre_decodePositiveInteger(value.configRevision, "configRevision"),
    generation: setupCentre_decodePositiveInteger(value.generation, "generation"),
    facts,
  };
}

function setupCentre_decodeProgress(value: unknown): SetupProgress {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["routeId", "generation", "configRevision", "steps"])
  ) {
    throw new TypeError("progress has an unsupported shape.");
  }
  const routeId = setupCentre_decodeLiteral(
    value.routeId,
    setupCentre_routeIds,
    "progress.routeId",
  );
  const route = setupCentre_routeDefinition(routeId);
  if (!Array.isArray(value.steps)) throw new TypeError("progress.steps must be an array.");
  const steps = value.steps.map((entry, index) => {
    if (!setupCentre_isRecord(entry) || !setupCentre_hasExactKeys(entry, ["step", "state"])) {
      throw new TypeError(`progress.steps[${index}] has an unsupported shape.`);
    }
    return {
      step: setupCentre_decodeLiteral(
        entry.step,
        setupCentre_stepIds,
        `progress.steps[${index}].step`,
      ),
      state: setupCentre_decodeLiteral(
        entry.state,
        setupCentre_progressStates,
        `progress.steps[${index}].state`,
      ),
    };
  });
  if (
    steps.length !== route.steps.length ||
    steps.some((step, index) => step.step !== route.steps[index]?.step)
  ) {
    throw new TypeError("progress steps must exactly follow the route definition.");
  }
  for (const [index, step] of steps.entries()) {
    if (route.steps[index]?.requirement === "required" && step.state === "skipped") {
      throw new TypeError("required setup steps cannot be skipped.");
    }
  }
  return {
    routeId,
    generation: setupCentre_decodePositiveInteger(value.generation, "progress.generation"),
    configRevision: setupCentre_decodePositiveInteger(
      value.configRevision,
      "progress.configRevision",
    ),
    steps,
  };
}

export function setupCentre_decodeRetiredOperation(value: unknown): SetupRetiredOperation {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "operationId",
      "operationSequence",
      "generation",
      "retiredAt",
      "outcome",
      "cancellationId",
      "effects",
    ])
  ) {
    throw new TypeError("retired operation has an unsupported shape.");
  }
  const outcome = setupCentre_decodeLiteral(
    value.outcome,
    setupCentre_retiredOperationOutcomes,
    "retired.outcome",
  );
  const effects = setupCentre_decodeLiteral(
    value.effects,
    setupCentre_effectStates,
    "retired.effects",
  );
  setupCentre_assertRetiredCancellation(outcome, effects, "retired cancellation");
  return {
    operationId: setupCentre_decodeIdentifier(value.operationId, "retired.operationId"),
    operationSequence: setupCentre_decodePositiveInteger(
      value.operationSequence,
      "retired.operationSequence",
    ),
    generation: setupCentre_decodePositiveInteger(value.generation, "retired.generation"),
    retiredAt: setupCentre_decodeTimestamp(value.retiredAt, "retired.retiredAt"),
    outcome,
    cancellationId: setupCentre_decodeIdentifier(value.cancellationId, "retired.cancellationId"),
    effects,
  };
}

export function setupCentre_decodeCheckpoint(value: unknown): SetupCheckpoint {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "schemaVersion",
      "routeId",
      "componentId",
      "generation",
      "configRevision",
      "operationSequence",
      "lastCompletedOperationId",
      "retiredOperations",
      "progress",
    ])
  ) {
    throw new TypeError("checkpoint has an unsupported shape.");
  }
  if (value.schemaVersion !== setupCentre_schemaVersion) {
    throw new TypeError("checkpoint schemaVersion is unsupported.");
  }
  const routeId = setupCentre_decodeLiteral(value.routeId, setupCentre_routeIds, "routeId");
  const route = setupCentre_routeDefinition(routeId);
  const componentId = setupCentre_decodeLiteral(
    value.componentId,
    setupCentre_componentIds,
    "componentId",
  );
  if (componentId !== route.componentId) {
    throw new TypeError("checkpoint component does not match its route.");
  }
  const generation = setupCentre_decodePositiveInteger(value.generation, "generation");
  const configRevision = setupCentre_decodePositiveInteger(value.configRevision, "configRevision");
  const operationSequence = setupCentre_decodeNonNegativeInteger(
    value.operationSequence,
    "operationSequence",
  );
  if (!Array.isArray(value.retiredOperations)) {
    throw new TypeError("retiredOperations must be an array.");
  }
  if (value.retiredOperations.length > setupCentre_maxRetiredOperations) {
    throw new TypeError("retiredOperations exceeds the bounded history.");
  }
  const retiredOperations = value.retiredOperations.map(setupCentre_decodeRetiredOperation);
  if (
    new Set(retiredOperations.map((operation) => operation.operationId)).size !==
    retiredOperations.length
  ) {
    throw new TypeError("retired operation IDs must be unique.");
  }
  if (
    new Set(retiredOperations.map((operation) => operation.operationSequence)).size !==
    retiredOperations.length
  ) {
    throw new TypeError("retired operation sequences must be unique.");
  }
  if (
    retiredOperations.some(
      (operation) =>
        operation.operationSequence > operationSequence || operation.generation > generation,
    )
  ) {
    throw new TypeError("retired operations cannot exceed the checkpoint high-water marks.");
  }
  const progress = setupCentre_decodeProgress(value.progress);
  const lastCompletedOperationId =
    value.lastCompletedOperationId === null
      ? null
      : setupCentre_decodeIdentifier(value.lastCompletedOperationId, "lastCompletedOperationId");
  if (
    lastCompletedOperationId !== null &&
    retiredOperations.some((operation) => operation.operationId === lastCompletedOperationId)
  ) {
    throw new TypeError("a cancelled operation cannot remain the last completed operation.");
  }
  if (
    progress.routeId !== routeId ||
    progress.generation !== generation ||
    progress.configRevision !== configRevision
  ) {
    throw new TypeError("checkpoint progress is not bound to the checkpoint identity.");
  }
  return {
    schemaVersion: setupCentre_schemaVersion,
    routeId,
    componentId,
    generation,
    configRevision,
    operationSequence,
    lastCompletedOperationId,
    retiredOperations,
    progress,
  };
}

export function setupCentre_decodeCheckpointAnchor(value: unknown): SetupCheckpointAnchor {
  if (value === undefined) {
    throw new TypeError("checkpoint anchor is required.");
  }
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["schemaVersion", "authority", "checkpoint"])
  ) {
    throw new TypeError("checkpoint anchor has an unsupported shape.");
  }
  if (value.schemaVersion !== setupCentre_checkpointAnchorSchemaVersion) {
    throw new TypeError("checkpoint anchor schemaVersion is unsupported.");
  }
  if (value.authority !== "persistence-owner") {
    throw new TypeError("checkpoint anchor authority is unsupported.");
  }
  return {
    schemaVersion: setupCentre_checkpointAnchorSchemaVersion,
    authority: "persistence-owner",
    checkpoint: setupCentre_decodeCheckpoint(value.checkpoint),
  };
}

export function setupCentre_decodeResourceKey(value: unknown): SetupResourceKey {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["componentId", "resource", "scopeId"])
  ) {
    throw new TypeError("resource key has an unsupported shape.");
  }
  return {
    componentId: setupCentre_decodeLiteral(
      value.componentId,
      setupCentre_componentIds,
      "resourceKey.componentId",
    ),
    resource: setupCentre_decodeLiteral(
      value.resource,
      setupCentre_stepIds,
      "resourceKey.resource",
    ),
    scopeId: setupCentre_decodeIdentifier(value.scopeId, "resourceKey.scopeId"),
  };
}

export function setupCentre_decodeOperationRequest(value: unknown): SetupOperationRequest {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "operationId",
      "routeId",
      "step",
      "resourceKey",
      "mode",
      "generation",
      "configRevision",
      "startedBy",
    ])
  ) {
    throw new TypeError("operation request has an unsupported shape.");
  }
  const routeId = setupCentre_decodeLiteral(value.routeId, setupCentre_routeIds, "routeId");
  const step = setupCentre_decodeLiteral(value.step, setupCentre_stepIds, "step");
  const route = setupCentre_routeDefinition(routeId);
  if (!route.steps.some((candidate) => candidate.step === step)) {
    throw new TypeError("operation step is not part of its route.");
  }
  const resourceKey = setupCentre_decodeResourceKey(value.resourceKey);
  if (resourceKey.componentId !== route.componentId || resourceKey.resource !== step) {
    throw new TypeError("operation resource must name the route component and exact step.");
  }
  if (value.startedBy !== "user") {
    throw new TypeError("operations must be explicitly started by the user.");
  }
  return {
    operationId: setupCentre_decodeIdentifier(value.operationId, "operationId"),
    routeId,
    step,
    resourceKey,
    mode: setupCentre_decodeLiteral(value.mode, setupCentre_operationModes, "mode"),
    generation: setupCentre_decodePositiveInteger(value.generation, "generation"),
    configRevision: setupCentre_decodePositiveInteger(value.configRevision, "configRevision"),
    startedBy: "user",
  };
}

export function setupCentre_decodeLogicalOperation(value: unknown): SetupLogicalOperation {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["kind", "request", "operationSequence", "openedAt", "state"])
  ) {
    throw new TypeError("logical operation has an unsupported shape.");
  }
  if (value.kind !== "logical-operation" || value.state !== "owned") {
    throw new TypeError("logical operation identity/state is unsupported.");
  }
  return {
    kind: "logical-operation",
    request: setupCentre_decodeOperationRequest(value.request),
    operationSequence: setupCentre_decodePositiveInteger(
      value.operationSequence,
      "operationSequence",
    ),
    openedAt: setupCentre_decodeTimestamp(value.openedAt, "openedAt"),
    state: "owned",
  };
}

export function setupCentre_decodeOperationResult(value: unknown): SetupOperationResult {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "operationId",
      "routeId",
      "step",
      "resourceKey",
      "generation",
      "configRevision",
      "fact",
    ])
  ) {
    throw new TypeError("operation result has an unsupported shape.");
  }
  const routeId = setupCentre_decodeLiteral(value.routeId, setupCentre_routeIds, "routeId");
  const step = setupCentre_decodeLiteral(value.step, setupCentre_stepIds, "step");
  const resourceKey = setupCentre_decodeResourceKey(value.resourceKey);
  const route = setupCentre_routeDefinition(routeId);
  const fact = setupCentre_decodeEvidenceFact(value.fact);
  if (
    resourceKey.componentId !== route.componentId ||
    resourceKey.resource !== step ||
    fact.dimension !== step
  ) {
    throw new TypeError("operation result is not bound to its route, step, and resource.");
  }
  return {
    operationId: setupCentre_decodeIdentifier(value.operationId, "operationId"),
    routeId,
    step,
    resourceKey,
    generation: setupCentre_decodePositiveInteger(value.generation, "generation"),
    configRevision: setupCentre_decodePositiveInteger(value.configRevision, "configRevision"),
    fact,
  };
}

export function setupCentre_decodeCancellationRequest(value: unknown): SetupCancellationRequest {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "cancellationId",
      "operationId",
      "generation",
      "configRevision",
      "reason",
    ])
  ) {
    throw new TypeError("cancellation request has an unsupported shape.");
  }
  return {
    cancellationId: setupCentre_decodeIdentifier(value.cancellationId, "cancellationId"),
    operationId: setupCentre_decodeIdentifier(value.operationId, "operationId"),
    generation: setupCentre_decodePositiveInteger(value.generation, "generation"),
    configRevision: setupCentre_decodePositiveInteger(value.configRevision, "configRevision"),
    reason: setupCentre_decodeLiteral(value.reason, setupCentre_cancellationReasons, "reason"),
  };
}

export function setupCentre_decodeCancellationIntent(value: unknown): SetupCancellationIntent {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["kind", "request", "requestedAt"])
  ) {
    throw new TypeError("cancellation intent has an unsupported shape.");
  }
  if (value.kind !== "cancellation-intent") {
    throw new TypeError("cancellation intent kind is unsupported.");
  }
  return {
    kind: "cancellation-intent",
    request: setupCentre_decodeCancellationRequest(value.request),
    requestedAt: setupCentre_decodeTimestamp(value.requestedAt, "requestedAt"),
  };
}

export function setupCentre_decodeCancellationReceipt(value: unknown): SetupCancellationReceipt {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "kind",
      "cancellationId",
      "operationId",
      "generation",
      "configRevision",
      "outcome",
      "effects",
      "observedAt",
    ])
  ) {
    throw new TypeError("cancellation receipt has an unsupported shape.");
  }
  if (value.kind !== "cancellation-receipt") {
    throw new TypeError("cancellation receipt kind is unsupported.");
  }
  const outcome = setupCentre_decodeLiteral(
    value.outcome,
    setupCentre_cancellationOutcomes,
    "outcome",
  );
  const effects = setupCentre_decodeLiteral(value.effects, setupCentre_effectStates, "effects");
  if (outcome === "failed-to-stop" && effects === "none") {
    throw new TypeError("failed-to-stop must report partial or unknown effects.");
  }
  if (outcome === "unknown" && effects !== "unknown") {
    throw new TypeError("unknown cancellation must report unknown effects.");
  }
  if (
    outcome === "never-started" ||
    outcome === "stopped" ||
    outcome === "completed-before-cancel"
  ) {
    setupCentre_assertRetiredCancellation(outcome, effects, "cancellation receipt");
  }
  return {
    kind: "cancellation-receipt",
    cancellationId: setupCentre_decodeIdentifier(value.cancellationId, "cancellationId"),
    operationId: setupCentre_decodeIdentifier(value.operationId, "operationId"),
    generation: setupCentre_decodePositiveInteger(value.generation, "generation"),
    configRevision: setupCentre_decodePositiveInteger(value.configRevision, "configRevision"),
    outcome,
    effects,
    observedAt: setupCentre_decodeTimestamp(value.observedAt, "observedAt"),
  };
}

export function setupCentre_decodeHandoff(value: unknown): SetupHandoff {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "kind",
      "routeId",
      "step",
      "generation",
      "configRevision",
      "operationId",
      "reasonCode",
    ])
  ) {
    throw new TypeError("handoff has an unsupported shape.");
  }
  const routeId = setupCentre_decodeLiteral(value.routeId, setupCentre_routeIds, "routeId");
  const step = setupCentre_decodeLiteral(value.step, setupCentre_stepIds, "step");
  if (!setupCentre_routeDefinition(routeId).steps.some((candidate) => candidate.step === step)) {
    throw new TypeError("handoff step is not part of its route.");
  }
  return {
    kind: setupCentre_decodeLiteral(value.kind, setupCentre_handoffKinds, "kind"),
    routeId,
    step,
    generation: setupCentre_decodePositiveInteger(value.generation, "generation"),
    configRevision: setupCentre_decodePositiveInteger(value.configRevision, "configRevision"),
    operationId:
      value.operationId === null
        ? null
        : setupCentre_decodeIdentifier(value.operationId, "operationId"),
    reasonCode: setupCentre_decodeLiteral(value.reasonCode, setupCentre_reasonCodes, "reasonCode"),
  };
}

export function setupCentre_decodeStepProjection(value: unknown): SetupStepProjection {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["step", "requirement", "state", "evidence", "reasonCode"])
  ) {
    throw new TypeError("step projection has an unsupported shape.");
  }
  return {
    step: setupCentre_decodeLiteral(value.step, setupCentre_stepIds, "step"),
    requirement: setupCentre_decodeLiteral(
      value.requirement,
      ["required", "optional"] as const,
      "requirement",
    ),
    state: setupCentre_decodeLiteral(value.state, setupCentre_stepProjectionStates, "state"),
    evidence: setupCentre_decodeLiteral(value.evidence, setupCentre_evidenceStates, "evidence"),
    reasonCode: setupCentre_decodeNullableReason(value.reasonCode, "reasonCode"),
  };
}

export function setupCentre_decodeStatusProjection(value: unknown): SetupStatusProjection {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "routeId",
      "componentId",
      "readiness",
      "ready",
      "requiresInspection",
      "currentStep",
      "steps",
      "handoff",
    ])
  ) {
    throw new TypeError("status projection has an unsupported shape.");
  }
  const routeId = setupCentre_decodeLiteral(value.routeId, setupCentre_routeIds, "routeId");
  const route = setupCentre_routeDefinition(routeId);
  const componentId = setupCentre_decodeLiteral(
    value.componentId,
    setupCentre_componentIds,
    "componentId",
  );
  if (componentId !== route.componentId) {
    throw new TypeError("status component does not match its route.");
  }
  if (!Array.isArray(value.steps)) throw new TypeError("status.steps must be an array.");
  const steps = value.steps.map(setupCentre_decodeStepProjection);
  if (
    steps.length !== route.steps.length ||
    steps.some((step, index) => step.step !== route.steps[index]?.step)
  ) {
    throw new TypeError("status steps must exactly follow the route definition.");
  }
  if (typeof value.ready !== "boolean" || typeof value.requiresInspection !== "boolean") {
    throw new TypeError("status booleans are invalid.");
  }
  const readiness = setupCentre_decodeLiteral(value.readiness, setupCentre_readiness, "readiness");
  if (value.ready !== (readiness === "ready")) {
    throw new TypeError("status ready flag must match readiness.");
  }
  if (value.ready && value.requiresInspection) {
    throw new TypeError("ready status cannot require inspection.");
  }
  if (value.currentStep !== null && !route.steps.some((step) => step.step === value.currentStep)) {
    throw new TypeError("status currentStep is not part of its route.");
  }
  const currentStep =
    value.currentStep === null
      ? null
      : setupCentre_decodeLiteral(value.currentStep, setupCentre_stepIds, "currentStep");
  const handoff = value.handoff === null ? null : setupCentre_decodeHandoff(value.handoff);
  if (handoff !== null && (handoff.routeId !== routeId || handoff.step !== currentStep)) {
    throw new TypeError("status handoff must match its route and current step.");
  }
  if (value.ready && (currentStep !== null || handoff !== null)) {
    throw new TypeError("ready status cannot retain a current action.");
  }
  return {
    routeId,
    componentId,
    readiness,
    ready: value.ready,
    requiresInspection: value.requiresInspection,
    currentStep,
    steps,
    handoff,
  };
}

export function setupCentre_decodeRestartObservation(value: unknown): SetupRestartObservation {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["restartId", "configRevision"])
  ) {
    throw new TypeError("restart observation has an unsupported shape.");
  }
  return {
    restartId: setupCentre_decodeIdentifier(value.restartId, "restartId"),
    configRevision: setupCentre_decodePositiveInteger(value.configRevision, "configRevision"),
  };
}

export function setupPersistence_decodeIdentity(value: unknown): SetupPersistenceIdentity {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, [
      "generation",
      "configRevision",
      "operationSequence",
      "operationId",
      "step",
      "resourceKey",
    ])
  ) {
    throw new TypeError("persistence identity has an unsupported shape.");
  }
  const step = setupCentre_decodeLiteral(value.step, setupCentre_stepIds, "identity.step");
  const resourceKey = setupCentre_decodeResourceKey(value.resourceKey);
  if (resourceKey.resource !== step) {
    throw new TypeError("persistence identity step and resource must match.");
  }
  return {
    generation: setupCentre_decodePositiveInteger(value.generation, "identity.generation"),
    configRevision: setupCentre_decodePositiveInteger(
      value.configRevision,
      "identity.configRevision",
    ),
    operationSequence: setupCentre_decodePositiveInteger(
      value.operationSequence,
      "identity.operationSequence",
    ),
    operationId: setupCentre_decodeIdentifier(value.operationId, "identity.operationId"),
    step,
    resourceKey,
  };
}

export function setupPersistence_decodeCursor(value: unknown): SetupPersistenceCursor {
  setupCentre_prepare(value);
  if (!setupCentre_isRecord(value)) throw new TypeError("cursor must be an object.");
  const kind = setupCentre_decodeLiteral(value.kind, setupPersistence_cursorKinds, "cursor.kind");
  if (kind === "idle") {
    if (!setupCentre_hasExactKeys(value, ["kind"])) {
      throw new TypeError("idle cursor has an unsupported shape.");
    }
    return { kind: "idle" };
  }
  if (kind === "admitted") {
    if (!setupCentre_hasExactKeys(value, ["kind", "identity"])) {
      throw new TypeError("admitted cursor has an unsupported shape.");
    }
    return { kind: "admitted", identity: setupPersistence_decodeIdentity(value.identity) };
  }
  if (kind === "settled") {
    if (!setupCentre_hasExactKeys(value, ["kind", "identity", "outcome"])) {
      throw new TypeError("settled cursor has an unsupported shape.");
    }
    return {
      kind: "settled",
      identity: setupPersistence_decodeIdentity(value.identity),
      outcome: setupCentre_decodeLiteral(
        value.outcome,
        setupPersistence_settlementOutcomes,
        "settled.outcome",
      ),
    };
  }
  if (
    !setupCentre_hasExactKeys(value, [
      "kind",
      "identity",
      "outcome",
      "cancellationId",
      "cancellationOutcome",
      "effects",
    ])
  ) {
    throw new TypeError("retired cursor has an unsupported shape.");
  }
  if (value.outcome !== "releasing-cancellation") {
    throw new TypeError("retired cursor outcome is unsupported.");
  }
  const cancellationOutcome = setupCentre_decodeLiteral(
    value.cancellationOutcome,
    setupCentre_retiredOperationOutcomes,
    "retired.cancellationOutcome",
  );
  const effects = setupCentre_decodeLiteral(
    value.effects,
    setupCentre_effectStates,
    "retired.effects",
  );
  setupCentre_assertRetiredCancellation(
    cancellationOutcome,
    effects,
    "retired cursor cancellation",
  );
  return {
    kind: "retired",
    identity: setupPersistence_decodeIdentity(value.identity),
    outcome: "releasing-cancellation",
    cancellationId: setupCentre_decodeIdentifier(value.cancellationId, "retired.cancellationId"),
    cancellationOutcome,
    effects,
  };
}

function setupCentre_assertRetiredCancellation(
  outcome: SetupRetiredOperationOutcome,
  effects: SetupEffectState,
  field: string,
): void {
  if ((outcome === "never-started" || outcome === "stopped") && effects !== "none") {
    throw new TypeError(
      `${field} effects must be none when the operation stopped or never started.`,
    );
  }
}

export function setupPersistence_decodeAuthorityState(
  value: unknown,
): SetupPersistenceAuthorityState {
  setupCentre_prepare(value);
  if (
    !setupCentre_isRecord(value) ||
    !setupCentre_hasExactKeys(value, ["schemaVersion", "authority", "authorityRevision", "cursor"])
  ) {
    throw new TypeError("persistence authority state has an unsupported shape.");
  }
  if (
    value.schemaVersion !== setupPersistence_schemaVersion ||
    value.authority !== "persistence-owner"
  ) {
    throw new TypeError("persistence authority state identity is unsupported.");
  }
  return {
    schemaVersion: setupPersistence_schemaVersion,
    authority: "persistence-owner",
    authorityRevision: setupCentre_decodeNonNegativeInteger(
      value.authorityRevision,
      "authorityRevision",
    ),
    cursor: setupPersistence_decodeCursor(value.cursor),
  };
}

export function setupPersistence_decodeTransitionRequest(
  value: unknown,
): SetupPersistenceTransitionRequest {
  setupCentre_prepare(value);
  if (!setupCentre_isRecord(value)) {
    throw new TypeError("persistence transition request must be an object.");
  }
  const kind = setupCentre_decodeLiteral(
    value.kind,
    setupPersistence_transitionKinds,
    "transition.kind",
  );
  const expectedAuthorityRevision = setupCentre_decodeNonNegativeInteger(
    value.expectedAuthorityRevision,
    "expectedAuthorityRevision",
  );
  if (kind === "admit") {
    if (!setupCentre_hasExactKeys(value, ["kind", "expectedAuthorityRevision", "identity"])) {
      throw new TypeError("admit request has an unsupported shape.");
    }
    return {
      kind,
      expectedAuthorityRevision,
      identity: setupPersistence_decodeIdentity(value.identity),
    };
  }
  if (kind === "settle") {
    if (
      !setupCentre_hasExactKeys(value, ["kind", "expectedAuthorityRevision", "identity", "outcome"])
    ) {
      throw new TypeError("settle request has an unsupported shape.");
    }
    return {
      kind,
      expectedAuthorityRevision,
      identity: setupPersistence_decodeIdentity(value.identity),
      outcome: setupCentre_decodeLiteral(
        value.outcome,
        setupPersistence_settlementOutcomes,
        "settle.outcome",
      ),
    };
  }
  if (kind === "retire") {
    if (
      !setupCentre_hasExactKeys(value, [
        "kind",
        "expectedAuthorityRevision",
        "identity",
        "cancellationId",
        "cancellationOutcome",
        "effects",
        "retiredAt",
      ])
    ) {
      throw new TypeError("retire request has an unsupported shape.");
    }
    const cancellationOutcome = setupCentre_decodeLiteral(
      value.cancellationOutcome,
      setupCentre_retiredOperationOutcomes,
      "retire.cancellationOutcome",
    );
    const effects = setupCentre_decodeLiteral(
      value.effects,
      setupCentre_effectStates,
      "retire.effects",
    );
    if (
      (cancellationOutcome === "never-started" || cancellationOutcome === "stopped") &&
      effects !== "none"
    ) {
      throw new TypeError("retire effects must be none for a stopped cancellation.");
    }
    return {
      kind,
      expectedAuthorityRevision,
      identity: setupPersistence_decodeIdentity(value.identity),
      cancellationId: setupCentre_decodeIdentifier(value.cancellationId, "retire.cancellationId"),
      cancellationOutcome,
      effects,
      retiredAt: setupCentre_decodeTimestamp(value.retiredAt, "retire.retiredAt"),
    };
  }
  if (kind === "cancel-nonreleasing") {
    if (
      !setupCentre_hasExactKeys(value, [
        "kind",
        "expectedAuthorityRevision",
        "identity",
        "cancellationId",
        "cancellationOutcome",
        "effects",
      ])
    ) {
      throw new TypeError("non-releasing cancellation request has an unsupported shape.");
    }
    const cancellationOutcome = setupCentre_decodeLiteral(
      value.cancellationOutcome,
      ["failed-to-stop", "unknown"] as const,
      "cancel.cancellationOutcome",
    );
    const effects = setupCentre_decodeLiteral(
      value.effects,
      ["partial", "unknown"] as const,
      "cancel.effects",
    );
    if (cancellationOutcome === "unknown" && effects !== "unknown") {
      throw new TypeError("non-releasing cancellation outcome/effects are inconsistent.");
    }
    return {
      kind,
      expectedAuthorityRevision,
      identity: setupPersistence_decodeIdentity(value.identity),
      cancellationId: setupCentre_decodeIdentifier(value.cancellationId, "cancel.cancellationId"),
      cancellationOutcome,
      effects,
    };
  }
  if (kind === "restart") {
    if (
      !setupCentre_hasExactKeys(value, [
        "kind",
        "expectedAuthorityRevision",
        "restartId",
        "configRevision",
      ])
    ) {
      throw new TypeError("restart transition has an unsupported shape.");
    }
    return {
      kind,
      expectedAuthorityRevision,
      restartId: setupCentre_decodeIdentifier(value.restartId, "restart.restartId"),
      configRevision: setupCentre_decodePositiveInteger(
        value.configRevision,
        "restart.configRevision",
      ),
    };
  }
  if (!setupCentre_hasExactKeys(value, ["kind", "expectedAuthorityRevision", "configRevision"])) {
    throw new TypeError("configure transition has an unsupported shape.");
  }
  return {
    kind: "configure",
    expectedAuthorityRevision,
    configRevision: setupCentre_decodePositiveInteger(
      value.configRevision,
      "configure.configRevision",
    ),
  };
}

/** Return the closed route definition without exposing a mutable instance. */
export function setupCentre_getRoute(value: unknown): SetupRoute {
  return setupCentre_routeDefinition(
    setupCentre_decodeLiteral(value, setupCentre_routeIds, "routeId"),
  );
}
