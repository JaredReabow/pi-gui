/**
 * Browser-safe lifecycle contracts.
 *
 * This module contains bounded, serializable data only. It deliberately has no file-system,
 * Electron, timer, persistence, runtime, draft-content, tool-input, or provider-body fields.
 */

export const lifecycle_intents = [
  "window-close",
  "app-quit",
  "app-relaunch",
  "install-update",
  "update-when-idle",
] as const;
export type LifecycleIntent = (typeof lifecycle_intents)[number];

export const lifecycle_decisions = [
  "keep-working",
  "cancel-and-proceed",
  "retry",
  "discard-and-proceed",
  "restart-when-idle",
] as const;
export type LifecycleDecision = (typeof lifecycle_decisions)[number];

export const lifecycle_requestRelations = [
  "started",
  "joined",
  "queued",
  "escalated",
  "superseded",
  "rejected",
] as const;
export type LifecycleRequestRelation = (typeof lifecycle_requestRelations)[number];

export const lifecycle_callerTerminalOutcomes = [
  "completed",
  "kept-open",
  "failed-kept-open",
  "queued-not-started",
  "superseded-by-escalation",
  "rejected-incompatible",
  "joined-operation-result",
] as const;
export type LifecycleCallerTerminalOutcome = (typeof lifecycle_callerTerminalOutcomes)[number];

export const lifecycle_fullStages = [
  "capture-and-decide",
  "barrier-and-revalidate",
  "flush-drafts",
  "persist-state-and-teardown-intent",
  "cancel-and-wait",
  "persist-terminal-receipts",
  "dispose-and-release",
  "final-revalidate-and-commit-marker",
  "lifecycle-action",
] as const;
export type LifecycleFullStage = (typeof lifecycle_fullStages)[number];

export const lifecycle_macosWindowCloseStages = [
  "capture-and-decide-target-window",
  "barrier-and-revalidate-window-draft-scope",
  "flush-target-draft",
  "persist-target-state-and-window-close-intent",
  "final-receipt-aware-window-revalidation",
  "window-close-commit-marker",
  "close-target-window",
] as const;
export type LifecycleMacosWindowCloseStage = (typeof lifecycle_macosWindowCloseStages)[number];

export const lifecycle_stages = [
  ...lifecycle_fullStages,
  ...lifecycle_macosWindowCloseStages,
] as const;
export type LifecycleStage = (typeof lifecycle_stages)[number];

export const lifecycle_sequenceProfiles = ["full", "macos-window-close"] as const;
export type LifecycleSequenceProfile = (typeof lifecycle_sequenceProfiles)[number];

export const lifecycle_executionStatuses = ["active", "idle", "unknown"] as const;
export type ExecutionStatus = (typeof lifecycle_executionStatuses)[number];

export const lifecycle_admissionDecisions = [
  "proceed",
  "needs-decision",
  "blocked-unknown",
] as const;
export type LifecycleAdmissionDecision = (typeof lifecycle_admissionDecisions)[number];

export const lifecycle_leaseOwnerships = ["local", "foreign-live", "absent", "unknown"] as const;
export type LeaseOwnership = (typeof lifecycle_leaseOwnerships)[number];

export const lifecycle_workerSurvivalValues = [
  "proven-live",
  "proven-dead",
  "unknown",
  "not-applicable",
] as const;
export type LifecycleWorkerSurvival = (typeof lifecycle_workerSurvivalValues)[number];

export const lifecycle_draftStatuses = [
  "saved",
  "no-pending",
  "rejected",
  "timeout",
  "renderer-gone",
] as const;
export type LifecycleDraftStatus = (typeof lifecycle_draftStatuses)[number];

export const lifecycle_interruptionDecisions = [
  "preserve-terminal",
  "preserve-failed",
  "attach-live",
  "interrupted",
  "pending-unknown",
] as const;
export type LifecycleInterruptionDecision = (typeof lifecycle_interruptionDecisions)[number];

export const lifecycle_revalidationBoundaries = [
  "barrier",
  "draft",
  "cancellation",
  "terminal-receipts",
  "disposal",
  "final",
] as const;
export type LifecycleRevalidationBoundary = (typeof lifecycle_revalidationBoundaries)[number];

export const lifecycle_deltaKinds = [
  "work-terminal",
  "tool-settled",
  "lease-release",
  "draft-saved",
] as const;
export type LifecycleDeltaKind = (typeof lifecycle_deltaKinds)[number];

export const lifecycle_revalidationReasons = [
  "expected-self-induced-delta",
  "no-delta",
  "new-work",
  "foreign-race",
  "unexplained-delta",
  "receipt-operation-mismatch",
  "unsupported-delta",
] as const;
export type LifecycleRevalidationReason = (typeof lifecycle_revalidationReasons)[number];

export const lifecycle_maxIdentifierLength = 256;
export const lifecycle_maxCollectionLength = 256;
export const lifecycle_maxObservedCount = 10_000;

/** Exact serializable window or application target. */
export type LifecycleTarget =
  { readonly kind: "window"; readonly windowId: string } | { readonly kind: "application" };

/** Effect scope is revision-bound so a stale request cannot join a changed scope. */
export type LifecycleEffectScope =
  | { readonly kind: "window"; readonly windowId: string; readonly revision: number }
  | { readonly kind: "application"; readonly revision: number };

/** Exact join key for one lifecycle request. */
export interface LifecycleRequestKey {
  readonly intent: LifecycleIntent;
  readonly target: LifecycleTarget;
  readonly effectScope: LifecycleEffectScope;
}

export type RequestArbitration =
  | {
      readonly decision: "started";
      readonly callerRelation: "started";
      readonly operationId: string;
      readonly recaptureRequired: true;
    }
  | {
      readonly decision: "join";
      readonly callerRelation: "joined";
      readonly operationId: string;
      readonly secondFlushCount: 0;
    }
  | {
      readonly decision: "queue";
      readonly callerRelation: "queued";
      readonly operationId: string;
      readonly activeOperationId: string;
      readonly secondStartsFromCapture: true;
    }
  | {
      readonly decision: "escalate";
      readonly callerRelation: "escalated";
      readonly operationId: string;
      readonly activeRequestResult: "superseded-by-escalation";
      readonly recaptureRequired: true;
      readonly priorDecisionReused: false;
    }
  | {
      readonly decision: "reject";
      readonly callerRelation: "rejected";
      readonly operationId: string;
      readonly activeOperationId: string;
      readonly callerResult: "rejected-incompatible";
      readonly activeOperationResultChanged: false;
    };

export interface CallerRequestResult {
  readonly callerRelation: LifecycleRequestRelation;
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly terminalReceipt: StageReceipt | null;
}

/** Canonical request and ordered-stage identity used by arbitration and transitions. */
export interface LifecycleOperationRef {
  readonly operationId: string;
  readonly request: LifecycleRequestKey;
  readonly stage: LifecycleStage;
}

/** Owner observations used only to classify admission. */
export interface LifecycleWorkFacts {
  readonly leaseOwnership: LeaseOwnership;
  readonly parentRuns: number;
  readonly childRuns: number;
  readonly queuedRuns: number;
  readonly pendingTools: number;
  readonly activeInlineWorkers: number;
  readonly workerSurvival: LifecycleWorkerSurvival;
  readonly missingFacts: number;
}

export interface LifecycleAdmission {
  readonly execution: ExecutionStatus;
  readonly admission: LifecycleAdmissionDecision;
  readonly requiresDecision: boolean;
}

/** The only valid outputs for one authoritative sequence. */
export const lifecycle_orderedOutcomes = [
  "completed",
  "kept-open",
  "failed-kept-open",
  "queued-not-started",
  "superseded-by-escalation",
  "rejected-incompatible",
  "joined-operation-result",
] as const satisfies readonly LifecycleCallerTerminalOutcome[];

export type LifecycleWorkIdentityKind =
  "parent-run" | "child-run" | "queued-run" | "pending-tool" | "inline-worker";

export type LifecycleWorkState =
  "pending" | "queued" | "starting" | "running" | "waiting" | "settled";

/** Exact execution/work identity and state; never a transcript or tool payload. */
export interface LifecycleWorkFact {
  readonly kind: LifecycleWorkIdentityKind;
  readonly identity: string;
  readonly state: LifecycleWorkState;
}

export interface LifecycleLeaseFact {
  readonly identity: string;
  readonly ownership: LeaseOwnership;
}

export interface LifecycleDraftFact {
  readonly windowId: string;
  readonly editGeneration: number;
  readonly status: "pending" | "saved";
}

export interface DraftFlushOutcome {
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly windowId: string;
  readonly editGeneration: number;
  readonly status: LifecycleDraftStatus;
}

export interface DraftFlushExpectation {
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly windowId: string;
  readonly editGeneration: number;
}

export interface DraftFlushBatch {
  readonly expectedTargets: readonly DraftFlushExpectation[];
  readonly outcomes: readonly DraftFlushOutcome[];
  readonly statePersistenceSuccess: boolean;
}

/** Authoritative checkpoint bound to one exact request/effect scope. */
export interface StageCheckpoint {
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly stage: LifecycleStage;
  readonly censusRevision: number;
  readonly work: readonly LifecycleWorkFact[];
  readonly leases: readonly LifecycleLeaseFact[];
  readonly draftGenerations: readonly LifecycleDraftFact[];
  readonly capturedAt: number;
}

/** Identity-bound proof that this operation caused a checkpoint delta. */
export interface StageReceipt {
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly stage: LifecycleStage;
  readonly kind:
    LifecycleDeltaKind | "terminal-persisted" | "cancellation" | "settlement" | "disposal";
  readonly identities: readonly string[];
  readonly fromState: string;
  readonly toState: string;
  readonly cause: "operation";
  readonly success: boolean;
  readonly observedAt: number;
}

export interface TerminalReceipt extends StageReceipt {
  readonly kind: "terminal-persisted";
}

export interface CancellationReceipt extends StageReceipt {
  readonly kind: "cancellation";
}

export interface SettlementReceipt extends StageReceipt {
  readonly kind: "settlement";
}

export interface DisposalReceipt extends StageReceipt {
  readonly kind: "disposal";
}

export type LifecycleTerminalOutcome =
  "stopped" | "completed" | "failed" | "cancelled" | "interrupted";

export interface LifecycleTerminalIdentity {
  readonly identity: string;
  readonly outcome: LifecycleTerminalOutcome;
}

/** Explicit partial cancellation facts; no absent field is allowed to imply success. */
export interface LifecycleCancellationOutcome {
  readonly stoppedIdentities: readonly string[];
  readonly failedToStopIdentities: readonly string[];
  readonly neverStartedIdentities: readonly string[];
  readonly stillUnsettledIdentities: readonly string[];
  readonly terminalOutcomes: readonly LifecycleTerminalIdentity[];
  readonly leaseCustody: "released" | "retained" | "unknown";
}

/** Serializable partial effects retained after any failed lifecycle stage. */
export interface LifecyclePartialEffects {
  readonly draftIdentitiesSaved: readonly string[];
  readonly statePersisted: boolean;
  readonly teardownIntentPersisted: boolean;
  readonly terminalReceiptIdentitiesPersisted: readonly string[];
  readonly disposedIdentities: readonly string[];
  readonly releasedLeaseIdentities: readonly string[];
  readonly retainedLeaseIdentities: readonly string[];
  readonly cancellation: LifecycleCancellationOutcome | null;
}

export interface LifecycleStageAttempt {
  readonly stage: LifecycleStage;
  readonly outcome: "succeeded" | "failed";
  readonly partialEffects: LifecyclePartialEffects;
}

export interface LifecycleStageTransition {
  readonly profile: LifecycleSequenceProfile;
  readonly completedStages: readonly LifecycleStage[];
  readonly failedStage: LifecycleStage | null;
  readonly attemptedStage: LifecycleStage;
  readonly nextStage: LifecycleStage | null;
  readonly cancellationAttempted: boolean;
  readonly disposalAttempted: boolean;
  readonly commitMarkerAllowed: boolean;
  readonly lifecycleActionAllowed: boolean;
  readonly partialEffects: LifecyclePartialEffects;
  readonly failure: LifecycleFailure | null;
}

export interface LifecycleResultReceipt {
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly outcome: LifecycleCallerTerminalOutcome;
  readonly completedStages: readonly LifecycleStage[];
  readonly partialEffects: LifecyclePartialEffects;
  readonly createdAt: number;
}

export interface LifecycleFailure {
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly failedStage: LifecycleStage;
  readonly completedStages: readonly LifecycleStage[];
  readonly stageReceipts: readonly StageReceipt[];
  readonly partialEffects: LifecyclePartialEffects;
  readonly unresolvedIdentities: readonly string[];
}

export interface LifecycleInterruptionIdentity {
  readonly kind: "run" | "inline-worker";
  readonly identity: string;
  readonly generation: number;
}

export interface LifecycleAuthoritativeTerminal {
  readonly outcome: "completed" | "failed" | "cancelled";
  readonly providerError: boolean;
}

/**
 * Inputs available after an abrupt crash without a lifecycle journal.
 * `pendingToolCallId` is an identity only; tool input is intentionally not representable.
 */
export interface LifecycleInterruptionInput {
  readonly authoritativeTerminal: LifecycleAuthoritativeTerminal | null;
  readonly persistedIdentity: LifecycleInterruptionIdentity | null;
  readonly pendingToolCallId: string | null;
  readonly survival: LifecycleWorkerSurvival;
  readonly missingResultOnly: boolean;
  readonly staleInterruption: boolean;
  readonly interruptionReason?: InterruptionReason;
}

export type InterruptionReason =
  | "app-quit"
  | "update-restart"
  | "window-process-lost"
  | "runtime-lost"
  | "owned-process-lost"
  | "abrupt-crash";

export interface InterruptedWork {
  readonly kind: "run" | "inline-worker";
  readonly identity: string;
  readonly generation: number;
  readonly reason: InterruptionReason;
  readonly outcomeKnown: false;
  readonly replayPolicy: "explicit-only";
}

export type AbruptRecoveryDecision =
  | {
      readonly decision: "preserve-terminal";
      readonly outcomeKnown: true;
      readonly terminal: LifecycleAuthoritativeTerminal;
      readonly reason?: "terminal-precedence";
      readonly autoReplay: false;
    }
  | {
      readonly decision: "preserve-failed";
      readonly outcomeKnown: true;
      readonly terminal: LifecycleAuthoritativeTerminal;
      readonly autoReplay: false;
    }
  | {
      readonly decision: "attach-live";
      readonly outcomeKnown: false;
      readonly identity: LifecycleInterruptionIdentity;
      readonly autoReplay: false;
    }
  | {
      readonly decision: "interrupted";
      readonly outcomeKnown: false;
      readonly work: InterruptedWork;
      readonly pendingToolCallId: string | null;
      readonly autoReplay: false;
    }
  | {
      readonly decision: "pending-unknown";
      readonly outcomeKnown: false;
      readonly reason: "missing-result-insufficient" | "liveness-unknown";
      readonly autoReplay: false;
    };

export interface LifecycleRevalidationResult {
  readonly decision: "accept" | "reject";
  readonly reason: LifecycleRevalidationReason;
  readonly deltas: readonly LifecycleDelta[];
}

export interface LifecycleDelta {
  readonly kind: LifecycleDeltaKind | "new-work" | "ownership-race" | "unexplained";
  readonly identity: string;
  readonly fromState: string;
  readonly toState: string;
}

function lifecycle_isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function lifecycle_hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownNames = Object.getOwnPropertyNames(value);
  return (
    ownNames.every(
      (key) => keys.includes(key) && Object.prototype.propertyIsEnumerable.call(value, key),
    ) && ownNames.length === Object.keys(value).length
  );
}

function lifecycle_assertJsonValue(
  value: unknown,
  location = "$",
  ancestors = new WeakSet<object>(),
  depth = 0,
): void {
  if (depth > 20) throw new TypeError(`${location} exceeds the nesting limit.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${location} must be a finite number.`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${location} is not JSON data.`);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${location} cannot contain symbol keys.`);
  }
  if (ancestors.has(value)) throw new TypeError(`${location} cannot contain a cycle.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (value.length > lifecycle_maxCollectionLength) {
      throw new TypeError(`${location} exceeds the collection limit.`);
    }
    const names = Object.getOwnPropertyNames(value).filter((name) => name !== "length");
    if (names.length !== value.length || names.some((name, index) => name !== String(index))) {
      throw new TypeError(`${location} must be a dense array with no extra properties.`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError(`${location} cannot contain sparse entries.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(
          `${location}[${index}] must be an enumerable data property with no accessor.`,
        );
      }
      lifecycle_assertJsonValue(descriptor.value, `${location}[${index}]`, ancestors, depth + 1);
    }
  } else {
    if (!lifecycle_isRecord(value)) {
      throw new TypeError(`${location} must be a plain JSON object.`);
    }
    const names = Object.getOwnPropertyNames(value);
    if (names.length > 64) throw new TypeError(`${location} has too many fields.`);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${location}.${name} must be an enumerable data property.`);
      }
      lifecycle_assertJsonValue(descriptor.value, `${location}.${name}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function lifecycle_isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= lifecycle_maxIdentifierLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function lifecycle_isSafeInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function lifecycle_decodeString(value: unknown, field: string): string {
  if (!lifecycle_isBoundedString(value))
    throw new TypeError(`${field} must be a bounded identifier.`);
  return value;
}

function lifecycle_decodeSafeInteger(
  value: unknown,
  field: string,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!lifecycle_isSafeInteger(value, max))
    throw new TypeError(`${field} must be a bounded integer.`);
  return value;
}

function lifecycle_decodeUniqueStrings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > lifecycle_maxCollectionLength) {
    throw new TypeError(`${field} must be a bounded array.`);
  }
  const decoded = value.map((item, index) => lifecycle_decodeString(item, `${field}[${index}]`));
  if (new Set(decoded).size !== decoded.length) throw new TypeError(`${field} must be unique.`);
  return decoded;
}

function lifecycle_decodeLiteral<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new TypeError(`${field} is not an accepted value.`);
  }
  return value as T;
}

/** Strictly decode one execution liveness value. */
export function lifecycle_decodeExecutionStatus(value: unknown): ExecutionStatus {
  lifecycle_assertJsonValue(value);
  return lifecycle_decodeLiteral(value, lifecycle_executionStatuses, "execution");
}

/** Strictly decode a lifecycle intent without accepting aliases. */
export function lifecycle_decodeIntent(value: unknown): LifecycleIntent {
  lifecycle_assertJsonValue(value);
  return lifecycle_decodeLiteral(value, lifecycle_intents, "intent");
}

export function lifecycle_decodeStage(value: unknown): LifecycleStage {
  lifecycle_assertJsonValue(value);
  return lifecycle_decodeLiteral(value, lifecycle_stages, "stage");
}

export function lifecycle_decodeOutcome(value: unknown): LifecycleCallerTerminalOutcome {
  lifecycle_assertJsonValue(value);
  return lifecycle_decodeLiteral(value, lifecycle_callerTerminalOutcomes, "outcome");
}

export function lifecycle_decodeDraftStatus(value: unknown): LifecycleDraftStatus {
  lifecycle_assertJsonValue(value);
  return lifecycle_decodeLiteral(value, lifecycle_draftStatuses, "draftStatus");
}

function lifecycle_decodeTarget(value: unknown): LifecycleTarget {
  if (!lifecycle_isRecord(value)) throw new TypeError("target must be an object.");
  if (value.kind === "window") {
    if (!lifecycle_hasOnlyKeys(value, ["kind", "windowId"])) {
      throw new TypeError("window target has unsupported fields.");
    }
    return { kind: "window", windowId: lifecycle_decodeString(value.windowId, "target.windowId") };
  }
  if (value.kind === "application") {
    if (!lifecycle_hasOnlyKeys(value, ["kind"])) {
      throw new TypeError("application target has unsupported fields.");
    }
    return { kind: "application" };
  }
  throw new TypeError("target.kind is not accepted.");
}

function lifecycle_decodeEffectScope(value: unknown): LifecycleEffectScope {
  if (!lifecycle_isRecord(value)) throw new TypeError("effectScope must be an object.");
  const revision = lifecycle_decodeSafeInteger(value.revision, "effectScope.revision");
  if (value.kind === "window") {
    if (!lifecycle_hasOnlyKeys(value, ["kind", "windowId", "revision"])) {
      throw new TypeError("window effect scope has unsupported fields.");
    }
    return {
      kind: "window",
      windowId: lifecycle_decodeString(value.windowId, "effectScope.windowId"),
      revision,
    };
  }
  if (value.kind === "application") {
    if (!lifecycle_hasOnlyKeys(value, ["kind", "revision"])) {
      throw new TypeError("application effect scope has unsupported fields.");
    }
    return { kind: "application", revision };
  }
  throw new TypeError("effectScope.kind is not accepted.");
}

/** Strictly decode and cross-check lifecycle intent, target, and effect scope. */
export function lifecycle_decodeRequestKey(value: unknown): LifecycleRequestKey {
  lifecycle_assertJsonValue(value);
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, ["intent", "target", "effectScope"])
  ) {
    throw new TypeError("request has an unsupported shape.");
  }
  const intent = lifecycle_decodeIntent(value.intent);
  const target = lifecycle_decodeTarget(value.target);
  const effectScope = lifecycle_decodeEffectScope(value.effectScope);
  if (intent === "window-close") {
    if (
      target.kind !== "window" ||
      effectScope.kind !== "window" ||
      target.windowId !== effectScope.windowId
    ) {
      throw new TypeError("window-close requires one exact window target and effect scope.");
    }
  } else if (target.kind !== "application" || effectScope.kind !== "application") {
    throw new TypeError("application lifecycle intents require application target and scope.");
  }
  return { intent, target, effectScope };
}

/** Strictly decode bounded owner facts; absence is unknown rather than idle. */
export function lifecycle_decodeWorkFacts(value: unknown): LifecycleWorkFacts {
  lifecycle_assertJsonValue(value);
  const keys = [
    "leaseOwnership",
    "parentRuns",
    "childRuns",
    "queuedRuns",
    "pendingTools",
    "activeInlineWorkers",
    "workerSurvival",
    "missingFacts",
  ] as const;
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, keys) ||
    Object.keys(value).length !== keys.length
  ) {
    throw new TypeError("work facts have an unsupported shape.");
  }
  return {
    leaseOwnership: lifecycle_decodeLiteral(
      value.leaseOwnership,
      lifecycle_leaseOwnerships,
      "leaseOwnership",
    ),
    parentRuns: lifecycle_decodeSafeInteger(
      value.parentRuns,
      "parentRuns",
      lifecycle_maxObservedCount,
    ),
    childRuns: lifecycle_decodeSafeInteger(
      value.childRuns,
      "childRuns",
      lifecycle_maxObservedCount,
    ),
    queuedRuns: lifecycle_decodeSafeInteger(
      value.queuedRuns,
      "queuedRuns",
      lifecycle_maxObservedCount,
    ),
    pendingTools: lifecycle_decodeSafeInteger(
      value.pendingTools,
      "pendingTools",
      lifecycle_maxObservedCount,
    ),
    activeInlineWorkers: lifecycle_decodeSafeInteger(
      value.activeInlineWorkers,
      "activeInlineWorkers",
      lifecycle_maxObservedCount,
    ),
    workerSurvival: lifecycle_decodeLiteral(
      value.workerSurvival,
      lifecycle_workerSurvivalValues,
      "workerSurvival",
    ),
    missingFacts: lifecycle_decodeSafeInteger(
      value.missingFacts,
      "missingFacts",
      lifecycle_maxObservedCount,
    ),
  };
}

function lifecycle_decodeWorkFact(value: unknown, index: number): LifecycleWorkFact {
  if (!lifecycle_isRecord(value) || !lifecycle_hasOnlyKeys(value, ["kind", "identity", "state"])) {
    throw new TypeError(`work[${index}] has an unsupported shape.`);
  }
  const kind = lifecycle_decodeLiteral(
    value.kind,
    ["parent-run", "child-run", "queued-run", "pending-tool", "inline-worker"] as const,
    `work[${index}].kind`,
  );
  const state = lifecycle_decodeLiteral(
    value.state,
    ["pending", "queued", "starting", "running", "waiting", "settled"] as const,
    `work[${index}].state`,
  );
  const validState =
    kind === "pending-tool" ? state === "pending" || state === "settled" : state !== "pending";
  if (!validState) throw new TypeError(`work[${index}] state does not match its identity kind.`);
  return {
    kind,
    identity: lifecycle_decodeString(value.identity, `work[${index}].identity`),
    state,
  };
}

function lifecycle_decodeLeaseFact(value: unknown, index: number): LifecycleLeaseFact {
  if (!lifecycle_isRecord(value) || !lifecycle_hasOnlyKeys(value, ["identity", "ownership"])) {
    throw new TypeError(`leases[${index}] has an unsupported shape.`);
  }
  return {
    identity: lifecycle_decodeString(value.identity, `leases[${index}].identity`),
    ownership: lifecycle_decodeLiteral(
      value.ownership,
      lifecycle_leaseOwnerships,
      `leases[${index}].ownership`,
    ),
  };
}

function lifecycle_decodeDraftFact(value: unknown, index: number): LifecycleDraftFact {
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, ["windowId", "editGeneration", "status"])
  ) {
    throw new TypeError(`draftGenerations[${index}] has an unsupported shape.`);
  }
  return {
    windowId: lifecycle_decodeString(value.windowId, `draftGenerations[${index}].windowId`),
    editGeneration: lifecycle_decodeSafeInteger(
      value.editGeneration,
      `draftGenerations[${index}].editGeneration`,
    ),
    status: lifecycle_decodeLiteral(
      value.status,
      ["pending", "saved"] as const,
      `draftGenerations[${index}].status`,
    ),
  };
}

export function lifecycle_decodeDraftFlushOutcome(value: unknown): DraftFlushOutcome {
  lifecycle_assertJsonValue(value);
  const keys = ["operationId", "requestKey", "windowId", "editGeneration", "status"] as const;
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, keys) ||
    Object.keys(value).length !== keys.length
  ) {
    throw new TypeError("draft flush outcome has an unsupported shape.");
  }
  return {
    operationId: lifecycle_decodeString(value.operationId, "draft.operationId"),
    requestKey: lifecycle_decodeRequestKey(value.requestKey),
    windowId: lifecycle_decodeString(value.windowId, "draft.windowId"),
    editGeneration: lifecycle_decodeSafeInteger(value.editGeneration, "draft.editGeneration"),
    status: lifecycle_decodeDraftStatus(value.status),
  };
}

export function lifecycle_decodeDraftFlushBatch(value: unknown): DraftFlushBatch {
  lifecycle_assertJsonValue(value);
  const keys = ["expectedTargets", "outcomes", "statePersistenceSuccess"] as const;
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, keys) ||
    Object.keys(value).length !== keys.length ||
    !Array.isArray(value.expectedTargets) ||
    value.expectedTargets.length === 0 ||
    !Array.isArray(value.outcomes) ||
    typeof value.statePersistenceSuccess !== "boolean"
  ) {
    throw new TypeError("draft batch has an unsupported shape.");
  }
  const expectedTargets = value.expectedTargets.map((item, index) => {
    if (!lifecycle_isRecord(item)) {
      throw new TypeError(`expectedTargets[${index}] must be an object.`);
    }
    const targetKeys = ["operationId", "requestKey", "windowId", "editGeneration"] as const;
    if (
      !lifecycle_hasOnlyKeys(item, targetKeys) ||
      Object.keys(item).length !== targetKeys.length
    ) {
      throw new TypeError(`expectedTargets[${index}] has an unsupported shape.`);
    }
    return {
      operationId: lifecycle_decodeString(
        item.operationId,
        `expectedTargets[${index}].operationId`,
      ),
      requestKey: lifecycle_decodeRequestKey(item.requestKey),
      windowId: lifecycle_decodeString(item.windowId, `expectedTargets[${index}].windowId`),
      editGeneration: lifecycle_decodeSafeInteger(
        item.editGeneration,
        `expectedTargets[${index}].editGeneration`,
      ),
    };
  });
  const outcomes = value.outcomes.map(lifecycle_decodeDraftFlushOutcome);
  if (new Set(expectedTargets.map((target) => target.windowId)).size !== expectedTargets.length) {
    throw new TypeError("draft batch must contain exactly one latest edit generation per window.");
  }
  const operationIds = new Set([
    ...expectedTargets.map((target) => target.operationId),
    ...outcomes.map((outcome) => outcome.operationId),
  ]);
  const requestKeys = new Set([
    ...expectedTargets.map((target) => JSON.stringify(target.requestKey)),
    ...outcomes.map((outcome) => JSON.stringify(outcome.requestKey)),
  ]);
  if (operationIds.size !== 1 || requestKeys.size !== 1) {
    throw new TypeError("draft batch must use one operation and one request/effect scope.");
  }
  return {
    expectedTargets,
    outcomes,
    statePersistenceSuccess: value.statePersistenceSuccess,
  };
}

function lifecycle_decodeCollection<T>(
  value: unknown,
  field: string,
  decode: (item: unknown, index: number) => T,
  identityOf: (item: T) => string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > lifecycle_maxCollectionLength) {
    throw new TypeError(`${field} must be a bounded array.`);
  }
  const decoded = value.map(decode);
  if (new Set(decoded.map(identityOf)).size !== decoded.length) {
    throw new TypeError(`${field} identities must be unique.`);
  }
  return decoded;
}

/** Strictly decode a bounded authoritative lifecycle checkpoint. */
export function lifecycle_decodeStageCheckpoint(value: unknown): StageCheckpoint {
  lifecycle_assertJsonValue(value);
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, [
      "operationId",
      "requestKey",
      "stage",
      "censusRevision",
      "work",
      "leases",
      "draftGenerations",
      "capturedAt",
    ]) ||
    Object.keys(value).length !== 8
  ) {
    throw new TypeError("checkpoint has an unsupported shape.");
  }
  const work = lifecycle_decodeCollection(
    value.work,
    "checkpoint.work",
    lifecycle_decodeWorkFact,
    (item) => item.identity,
  );
  const leases = lifecycle_decodeCollection(
    value.leases,
    "checkpoint.leases",
    lifecycle_decodeLeaseFact,
    (item) => item.identity,
  );
  if (leases.some((lease) => work.some((item) => item.identity === lease.identity))) {
    throw new TypeError("checkpoint work and lease identities must be globally unique.");
  }
  return {
    operationId: lifecycle_decodeString(value.operationId, "checkpoint.operationId"),
    requestKey: lifecycle_decodeRequestKey(value.requestKey),
    stage: lifecycle_decodeStage(value.stage),
    censusRevision: lifecycle_decodeSafeInteger(value.censusRevision, "checkpoint.censusRevision"),
    work,
    leases,
    draftGenerations: lifecycle_decodeCollection(
      value.draftGenerations,
      "checkpoint.draftGenerations",
      lifecycle_decodeDraftFact,
      (item) => item.windowId,
    ),
    capturedAt: lifecycle_decodeSafeInteger(value.capturedAt, "checkpoint.capturedAt"),
  };
}

function lifecycle_isReceiptStatePair(kind: LifecycleDeltaKind, from: string, to: string): boolean {
  if (kind === "work-terminal") return from !== "settled" && to === "settled";
  if (kind === "tool-settled") return from === "pending" && to === "settled";
  if (kind === "lease-release") return from === "local" && to === "absent";
  return from === "pending" && to === "saved";
}

/** Strictly decode an identity-bound operation receipt. */
export function lifecycle_decodeStageReceipt(value: unknown): StageReceipt {
  lifecycle_assertJsonValue(value);
  const keys = [
    "operationId",
    "requestKey",
    "stage",
    "kind",
    "identities",
    "fromState",
    "toState",
    "cause",
    "success",
    "observedAt",
  ] as const;
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, keys) ||
    Object.keys(value).length !== keys.length
  ) {
    throw new TypeError("receipt has an unsupported shape.");
  }
  const kind = lifecycle_decodeLiteral(
    value.kind,
    [
      ...lifecycle_deltaKinds,
      "terminal-persisted",
      "cancellation",
      "settlement",
      "disposal",
    ] as const,
    "receipt.kind",
  );
  const fromState = lifecycle_decodeString(value.fromState, "receipt.fromState");
  const toState = lifecycle_decodeString(value.toState, "receipt.toState");
  if (
    lifecycle_deltaKinds.includes(kind as LifecycleDeltaKind) &&
    !lifecycle_isReceiptStatePair(kind as LifecycleDeltaKind, fromState, toState)
  ) {
    throw new TypeError("receipt state transition does not match its kind.");
  }
  const identities = lifecycle_decodeUniqueStrings(value.identities, "receipt.identities");
  const workStates = ["queued", "starting", "running", "waiting", "settled"] as const;
  const terminalStates = [
    "settled",
    "stopped",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ] as const;
  if (kind === "terminal-persisted") {
    if (
      lifecycle_decodeStage(value.stage) !== "persist-terminal-receipts" ||
      identities.length !== 1 ||
      fromState !== "settled" ||
      !terminalStates.includes(toState as (typeof terminalStates)[number])
    ) {
      throw new TypeError("terminal receipt has an invalid stage, identity, or state pair.");
    }
  }
  if (kind === "cancellation" || kind === "settlement") {
    const cancellationStates = [
      "settled",
      "stopped",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
      "retained",
      "unsettled",
    ] as const;
    if (
      lifecycle_decodeStage(value.stage) !== "cancel-and-wait" ||
      identities.length === 0 ||
      !workStates.includes(fromState as (typeof workStates)[number]) ||
      !cancellationStates.includes(toState as (typeof cancellationStates)[number])
    ) {
      throw new TypeError("cancellation/settlement receipt has invalid stage or states.");
    }
    if (
      (toState === "retained" || toState === "unsettled") &&
      (value.success || fromState === "settled")
    ) {
      throw new TypeError(
        "retained/unsettled cancellation receipts must be explicit non-success observations of unsettled work.",
      );
    }
  }
  if (kind === "disposal") {
    if (
      lifecycle_decodeStage(value.stage) !== "dispose-and-release" ||
      identities.length === 0 ||
      !lifecycle_leaseOwnerships.includes(fromState as LeaseOwnership) ||
      !lifecycle_leaseOwnerships.includes(toState as LeaseOwnership)
    ) {
      throw new TypeError("disposal receipt has invalid stage or states.");
    }
  }
  if (value.cause !== "operation" || typeof value.success !== "boolean") {
    throw new TypeError("receipt cause/success is invalid.");
  }
  return {
    operationId: lifecycle_decodeString(value.operationId, "receipt.operationId"),
    requestKey: lifecycle_decodeRequestKey(value.requestKey),
    stage: lifecycle_decodeStage(value.stage),
    kind,
    identities,
    fromState,
    toState,
    cause: "operation",
    success: value.success,
    observedAt: lifecycle_decodeSafeInteger(value.observedAt, "receipt.observedAt"),
  };
}

/** Strictly decode cancellation identities and custody. */
export function lifecycle_decodeCancellationOutcome(value: unknown): LifecycleCancellationOutcome {
  lifecycle_assertJsonValue(value);
  const keys = [
    "stoppedIdentities",
    "failedToStopIdentities",
    "neverStartedIdentities",
    "stillUnsettledIdentities",
    "terminalOutcomes",
    "leaseCustody",
  ] as const;
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, keys) ||
    Object.keys(value).length !== keys.length
  ) {
    throw new TypeError("cancellation outcome has an unsupported shape.");
  }
  if (
    !Array.isArray(value.terminalOutcomes) ||
    value.terminalOutcomes.length > lifecycle_maxCollectionLength
  ) {
    throw new TypeError("terminalOutcomes must be a bounded array.");
  }
  const terminalOutcomes = value.terminalOutcomes.map((item, index) => {
    if (!lifecycle_isRecord(item) || !lifecycle_hasOnlyKeys(item, ["identity", "outcome"])) {
      throw new TypeError(`terminalOutcomes[${index}] has an unsupported shape.`);
    }
    return {
      identity: lifecycle_decodeString(item.identity, `terminalOutcomes[${index}].identity`),
      outcome: lifecycle_decodeLiteral(
        item.outcome,
        ["stopped", "completed", "failed", "cancelled", "interrupted"] as const,
        `terminalOutcomes[${index}].outcome`,
      ),
    };
  });
  if (new Set(terminalOutcomes.map((item) => item.identity)).size !== terminalOutcomes.length) {
    throw new TypeError("terminalOutcomes identities must be unique.");
  }
  const stoppedIdentities = lifecycle_decodeUniqueStrings(
    value.stoppedIdentities,
    "stoppedIdentities",
  );
  const failedToStopIdentities = lifecycle_decodeUniqueStrings(
    value.failedToStopIdentities,
    "failedToStopIdentities",
  );
  const neverStartedIdentities = lifecycle_decodeUniqueStrings(
    value.neverStartedIdentities,
    "neverStartedIdentities",
  );
  const stillUnsettledIdentities = lifecycle_decodeUniqueStrings(
    value.stillUnsettledIdentities,
    "stillUnsettledIdentities",
  );
  const stopped = new Set(stoppedIdentities);
  const failed = new Set(failedToStopIdentities);
  const neverStarted = new Set(neverStartedIdentities);
  const unsettled = new Set(stillUnsettledIdentities);
  const terminalByIdentity = new Map(
    terminalOutcomes.map((outcome) => [outcome.identity, outcome.outcome] as const),
  );
  if (
    stoppedIdentities.some(
      (identity) => failed.has(identity) || neverStarted.has(identity) || unsettled.has(identity),
    ) ||
    failedToStopIdentities.some((identity) => neverStarted.has(identity)) ||
    neverStartedIdentities.some((identity) => unsettled.has(identity)) ||
    stoppedIdentities.some((identity) => !terminalByIdentity.has(identity)) ||
    terminalOutcomes.some(
      (outcome) =>
        failed.has(outcome.identity) ||
        neverStarted.has(outcome.identity) ||
        unsettled.has(outcome.identity),
    )
  ) {
    throw new TypeError("cancellation outcome has contradictory identity states.");
  }
  return {
    stoppedIdentities,
    failedToStopIdentities,
    neverStartedIdentities,
    stillUnsettledIdentities,
    terminalOutcomes,
    leaseCustody: lifecycle_decodeLiteral(
      value.leaseCustody,
      ["released", "retained", "unknown"] as const,
      "leaseCustody",
    ),
  };
}

/** Strictly decode all observable partial lifecycle effects. */
export function lifecycle_decodePartialEffects(value: unknown): LifecyclePartialEffects {
  lifecycle_assertJsonValue(value);
  const keys = [
    "draftIdentitiesSaved",
    "statePersisted",
    "teardownIntentPersisted",
    "terminalReceiptIdentitiesPersisted",
    "disposedIdentities",
    "releasedLeaseIdentities",
    "retainedLeaseIdentities",
    "cancellation",
  ] as const;
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, keys) ||
    Object.keys(value).length !== keys.length
  ) {
    throw new TypeError("partial effects have an unsupported shape.");
  }
  if (
    typeof value.statePersisted !== "boolean" ||
    typeof value.teardownIntentPersisted !== "boolean"
  ) {
    throw new TypeError("partial effect persistence flags must be booleans.");
  }
  const releasedLeaseIdentities = lifecycle_decodeUniqueStrings(
    value.releasedLeaseIdentities,
    "releasedLeaseIdentities",
  );
  const retainedLeaseIdentities = lifecycle_decodeUniqueStrings(
    value.retainedLeaseIdentities,
    "retainedLeaseIdentities",
  );
  if (releasedLeaseIdentities.some((identity) => retainedLeaseIdentities.includes(identity))) {
    throw new TypeError("lease identities cannot be both released and retained.");
  }
  return {
    draftIdentitiesSaved: lifecycle_decodeUniqueStrings(
      value.draftIdentitiesSaved,
      "draftIdentitiesSaved",
    ),
    statePersisted: value.statePersisted,
    teardownIntentPersisted: value.teardownIntentPersisted,
    terminalReceiptIdentitiesPersisted: lifecycle_decodeUniqueStrings(
      value.terminalReceiptIdentitiesPersisted,
      "terminalReceiptIdentitiesPersisted",
    ),
    disposedIdentities: lifecycle_decodeUniqueStrings(
      value.disposedIdentities,
      "disposedIdentities",
    ),
    releasedLeaseIdentities,
    retainedLeaseIdentities,
    cancellation:
      value.cancellation === null ? null : lifecycle_decodeCancellationOutcome(value.cancellation),
  };
}

/** Strictly decode a no-journal abrupt-crash observation. */
export function lifecycle_decodeInterruptionInput(value: unknown): LifecycleInterruptionInput {
  lifecycle_assertJsonValue(value);
  const keys = [
    "authoritativeTerminal",
    "persistedIdentity",
    "pendingToolCallId",
    "survival",
    "missingResultOnly",
    "staleInterruption",
    "interruptionReason",
  ] as const;
  if (
    !lifecycle_isRecord(value) ||
    !lifecycle_hasOnlyKeys(value, keys) ||
    Object.keys(value).length < keys.length - 1
  ) {
    throw new TypeError("interruption input has an unsupported shape.");
  }
  const authoritativeTerminal =
    value.authoritativeTerminal === null
      ? null
      : (() => {
          const terminal = value.authoritativeTerminal;
          if (
            !lifecycle_isRecord(terminal) ||
            !lifecycle_hasOnlyKeys(terminal, ["outcome", "providerError"])
          ) {
            throw new TypeError("authoritativeTerminal has an unsupported shape.");
          }
          if (typeof terminal.providerError !== "boolean") {
            throw new TypeError("authoritativeTerminal.providerError must be boolean.");
          }
          return {
            outcome: lifecycle_decodeLiteral(
              terminal.outcome,
              ["completed", "failed", "cancelled"] as const,
              "authoritativeTerminal.outcome",
            ),
            providerError: terminal.providerError,
          };
        })();
  const persistedIdentity =
    value.persistedIdentity === null
      ? null
      : (() => {
          const identity = value.persistedIdentity;
          if (
            !lifecycle_isRecord(identity) ||
            !lifecycle_hasOnlyKeys(identity, ["kind", "identity", "generation"])
          ) {
            throw new TypeError("persistedIdentity has an unsupported shape.");
          }
          return {
            kind: lifecycle_decodeLiteral(
              identity.kind,
              ["run", "inline-worker"] as const,
              "persistedIdentity.kind",
            ),
            identity: lifecycle_decodeString(identity.identity, "persistedIdentity.identity"),
            generation: lifecycle_decodeSafeInteger(
              identity.generation,
              "persistedIdentity.generation",
            ),
          };
        })();
  if (value.pendingToolCallId !== null && !lifecycle_isBoundedString(value.pendingToolCallId)) {
    throw new TypeError("pendingToolCallId must be null or a bounded identifier.");
  }
  if (
    typeof value.missingResultOnly !== "boolean" ||
    typeof value.staleInterruption !== "boolean"
  ) {
    throw new TypeError("interruption flags must be booleans.");
  }
  if (authoritativeTerminal?.outcome !== "failed" && authoritativeTerminal?.providerError) {
    throw new TypeError("providerError requires a failed authoritative terminal.");
  }
  const interruptionReason =
    value.interruptionReason === undefined
      ? undefined
      : lifecycle_decodeLiteral(
          value.interruptionReason,
          [
            "app-quit",
            "update-restart",
            "window-process-lost",
            "runtime-lost",
            "owned-process-lost",
            "abrupt-crash",
          ] as const,
          "interruptionReason",
        );
  return {
    authoritativeTerminal,
    persistedIdentity,
    pendingToolCallId: value.pendingToolCallId as string | null,
    survival: lifecycle_decodeLiteral(value.survival, lifecycle_workerSurvivalValues, "survival"),
    missingResultOnly: value.missingResultOnly,
    staleInterruption: value.staleInterruption,
    ...(interruptionReason === undefined ? {} : { interruptionReason }),
  };
}
