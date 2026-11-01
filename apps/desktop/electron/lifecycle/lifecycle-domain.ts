/**
 * Pure R-D13 lifecycle domain.
 *
 * This module classifies owner facts, arbitrates requests, advances the single accepted stage
 * sequence, validates receipt-backed checkpoint deltas, and projects abrupt-crash recovery.
 * It performs no I/O and never owns a runtime, store, timer, barrier, or lifecycle action.
 */

import {
  lifecycle_decodeCancellationOutcome,
  lifecycle_decodeDraftFlushBatch,
  lifecycle_decodeInterruptionInput,
  lifecycle_decodePartialEffects,
  lifecycle_decodeRequestKey,
  lifecycle_decodeStageCheckpoint,
  lifecycle_decodeStageReceipt,
  lifecycle_decodeStage,
  lifecycle_decodeWorkFacts,
  lifecycle_fullStages,
  lifecycle_macosWindowCloseStages,
  lifecycle_maxCollectionLength,
  lifecycle_sequenceProfiles,
  type AbruptRecoveryDecision,
  type LifecycleCancellationOutcome,
  type LifecycleAdmission,
  type LifecycleFailure,
  type LifecycleDelta,
  type LifecycleDeltaKind,
  type LifecycleDraftFact,
  type LifecycleInterruptionInput,
  type LifecycleOperationRef,
  type LifecyclePartialEffects,
  type LifecycleRequestKey,
  type LifecycleRevalidationBoundary,
  type LifecycleRevalidationReason,
  type LifecycleRevalidationResult,
  type LifecycleSequenceProfile,
  type RequestArbitration,
  type StageCheckpoint,
  type StageReceipt,
  type LifecycleStage,
  type LifecycleStageAttempt,
  type LifecycleStageTransition,
  type LifecycleWorkFact,
  type LifecycleWorkIdentityKind,
  type LifecycleWorkState,
  type DraftFlushExpectation,
  type DraftFlushOutcome,
} from "../../contracts/lifecycle";

export interface LifecycleSequenceState {
  readonly profile: LifecycleSequenceProfile;
  readonly completedStages: readonly LifecycleStage[];
  readonly failedStage: LifecycleStage | null;
  readonly partialEffects?: LifecyclePartialEffects;
}

export interface LifecycleDraftFlushProjection {
  readonly nextState: "needs-decision" | "persisting-state-and-intent" | "failed-kept-open";
  readonly commitAllowed: false;
}

export interface LifecycleTransitionInput {
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly stageReceipts: readonly StageReceipt[];
  readonly state: LifecycleSequenceState;
  readonly attempt: LifecycleStageAttempt;
}

export interface StageRevalidationInput {
  readonly operationId: string;
  readonly requestKey: LifecycleRequestKey;
  readonly boundary: LifecycleRevalidationBoundary;
  readonly baseline: StageCheckpoint;
  readonly current: StageCheckpoint;
  readonly receipts: readonly StageReceipt[];
}

const lifecycleDomain_stageLists = {
  full: lifecycle_fullStages,
  "macos-window-close": lifecycle_macosWindowCloseStages,
} as const;

function lifecycleDomain_stagesFor(profile: LifecycleSequenceProfile): readonly LifecycleStage[] {
  return lifecycleDomain_stageLists[profile];
}

function lifecycleDomain_decodeProfile(value: unknown): LifecycleSequenceProfile {
  if (
    typeof value !== "string" ||
    !lifecycle_sequenceProfiles.includes(value as LifecycleSequenceProfile)
  ) {
    throw new TypeError("profile is not accepted.");
  }
  return value as LifecycleSequenceProfile;
}

function lifecycleDomain_isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function lifecycleDomain_sameRequestKey(
  left: LifecycleRequestKey,
  right: LifecycleRequestKey,
): boolean {
  if (
    left.intent !== right.intent ||
    left.target.kind !== right.target.kind ||
    left.effectScope.kind !== right.effectScope.kind ||
    left.effectScope.revision !== right.effectScope.revision
  ) {
    return false;
  }
  if (left.target.kind === "window" && right.target.kind === "window") {
    return (
      left.target.windowId === right.target.windowId &&
      left.effectScope.kind === "window" &&
      right.effectScope.kind === "window" &&
      left.effectScope.windowId === right.effectScope.windowId
    );
  }
  return left.target.kind === "application" && right.target.kind === "application";
}

function lifecycleDomain_operationIdForRequest(request: LifecycleRequestKey): string {
  const value = JSON.stringify(request);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `lifecycle-${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

/** Classify active, idle, or unknown work with unknown evidence taking precedence. */
export function lifecycleDomain_classify(value: unknown): LifecycleAdmission {
  const facts = lifecycle_decodeWorkFacts(value);
  if (
    facts.missingFacts > 0 ||
    facts.leaseOwnership === "foreign-live" ||
    facts.leaseOwnership === "unknown" ||
    facts.workerSurvival === "unknown"
  ) {
    return {
      execution: "unknown",
      admission: "blocked-unknown",
      requiresDecision: false,
    };
  }
  const activeCount =
    facts.parentRuns +
    facts.childRuns +
    facts.queuedRuns +
    facts.pendingTools +
    facts.activeInlineWorkers;
  if (activeCount > 0 || facts.workerSurvival === "proven-live") {
    return {
      execution: "active",
      admission: "needs-decision",
      requiresDecision: true,
    };
  }
  return {
    execution: "idle",
    admission: "proceed",
    requiresDecision: false,
  };
}

function lifecycleDomain_isDenseArray(value: unknown): value is readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    value.length > lifecycle_maxCollectionLength
  ) {
    return false;
  }
  const names = Object.getOwnPropertyNames(value).filter((name) => name !== "length");
  if (names.length !== value.length || names.some((name, index) => name !== String(index))) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) return false;
  }
  return true;
}

function lifecycleDomain_decodeDraftBatch(
  value: unknown,
): ReturnType<typeof lifecycle_decodeDraftFlushBatch> {
  const batch = lifecycle_decodeDraftFlushBatch(value);
  for (const [index, target] of batch.expectedTargets.entries()) {
    if (
      target.requestKey.intent === "window-close" &&
      (target.requestKey.target.kind !== "window" ||
        target.requestKey.target.windowId !== target.windowId ||
        target.requestKey.effectScope.kind !== "window" ||
        target.requestKey.effectScope.windowId !== target.windowId)
    ) {
      throw new TypeError(
        `expectedTargets[${index}] request scope does not match its window target.`,
      );
    }
  }
  return batch;
}

/** Classify exactly one outcome for every expected operation/window/edit generation. */
export function lifecycleDomain_classifyDraftFlush(value: unknown): LifecycleDraftFlushProjection {
  const batch = lifecycleDomain_decodeDraftBatch(value);
  const batchOperationIds = new Set([
    ...batch.expectedTargets.map((target) => target.operationId),
    ...batch.outcomes.map((outcome) => outcome.operationId),
  ]);
  const batchRequestKeys = new Set([
    ...batch.expectedTargets.map((target) => JSON.stringify(target.requestKey)),
    ...batch.outcomes.map((outcome) => JSON.stringify(outcome.requestKey)),
  ]);
  if (batchOperationIds.size !== 1 || batchRequestKeys.size !== 1) {
    throw new TypeError("draft batch must use one operation and one coherent request scope.");
  }
  const expected = new Map<string, DraftFlushExpectation>();
  for (const target of batch.expectedTargets) {
    const key = JSON.stringify([
      target.operationId,
      target.requestKey,
      target.windowId,
      target.editGeneration,
    ]);
    if (expected.has(key)) throw new TypeError("draft target expectations must be unique.");
    expected.set(key, target);
  }
  const outcomes = new Map<string, DraftFlushOutcome>();
  for (const outcome of batch.outcomes) {
    const key = JSON.stringify([
      outcome.operationId,
      outcome.requestKey,
      outcome.windowId,
      outcome.editGeneration,
    ]);
    if (!expected.has(key)) throw new TypeError("draft outcome has an unknown target.");
    if (outcomes.has(key)) throw new TypeError("draft target has duplicate outcomes.");
    outcomes.set(key, outcome);
  }
  if (outcomes.size !== expected.size) throw new TypeError("draft target outcome is missing.");
  const draftsSucceeded = [...outcomes.values()].every(
    (outcome) => outcome.status === "saved" || outcome.status === "no-pending",
  );
  if (!draftsSucceeded) {
    return { nextState: "needs-decision", commitAllowed: false };
  }
  return batch.statePersistenceSuccess
    ? { nextState: "persisting-state-and-intent", commitAllowed: false }
    : { nextState: "failed-kept-open", commitAllowed: false };
}

/** Return true once the operation has reached the admission barrier or any later stage. */
export function lifecycleDomain_effectBoundaryReached(stageValue: unknown): boolean {
  const stage = lifecycle_decodeStage(stageValue);
  return stage !== "capture-and-decide" && stage !== "capture-and-decide-target-window";
}

/**
 * Arbitrate one new request against an in-flight operation.
 *
 * Compatible keys join. Window A/window B, post-effect Quit, and every unrelated key queue.
 * Pre-effect window-close -> Quit and Quit -> relaunch escalate with required recapture.
 */
export function lifecycleDomain_arbitrateRequest(
  inflight: LifecycleOperationRef | null,
  requestValue: unknown,
  requestedOperationId?: unknown,
): RequestArbitration {
  const request = lifecycle_decodeRequestKey(requestValue);
  const operationId =
    requestedOperationId === undefined
      ? lifecycleDomain_operationIdForRequest(request)
      : requestedOperationId;
  if (!lifecycleDomain_isIdentifier(operationId)) {
    throw new TypeError("requested operationId is not a bounded identifier.");
  }
  if (inflight === null) {
    return {
      decision: "started",
      callerRelation: "started",
      operationId,
      recaptureRequired: true,
    };
  }
  if (!lifecycleDomain_isIdentifier(inflight.operationId)) {
    throw new TypeError("inflight.operationId is not a bounded identifier.");
  }
  const inflightRequest = lifecycle_decodeRequestKey(inflight.request);
  const inflightStage = lifecycle_decodeStage(inflight.stage);
  if (lifecycleDomain_sameRequestKey(inflightRequest, request)) {
    return {
      decision: "join",
      callerRelation: "joined",
      operationId: inflight.operationId,
      secondFlushCount: 0,
    };
  }
  const effectBoundaryReached = lifecycleDomain_effectBoundaryReached(inflightStage);
  const canEscalate =
    !effectBoundaryReached &&
    ((inflightRequest.intent === "window-close" && request.intent === "app-quit") ||
      (inflightRequest.intent === "app-quit" && request.intent === "app-relaunch"));
  if (canEscalate) {
    return {
      decision: "escalate",
      callerRelation: "escalated",
      operationId: inflight.operationId,
      activeRequestResult: "superseded-by-escalation",
      recaptureRequired: true,
      priorDecisionReused: false,
    };
  }
  if (
    effectBoundaryReached &&
    inflightRequest.intent === "app-quit" &&
    request.intent === "app-relaunch"
  ) {
    return {
      decision: "reject",
      callerRelation: "rejected",
      operationId,
      activeOperationId: inflight.operationId,
      callerResult: "rejected-incompatible",
      activeOperationResultChanged: false,
    };
  }
  return {
    decision: "queue",
    callerRelation: "queued",
    operationId,
    activeOperationId: inflight.operationId,
    secondStartsFromCapture: true,
  };
}

/** Return a fresh copy of the accepted sequence for one profile. */
export function lifecycleDomain_stageNames(value: unknown): readonly LifecycleStage[] {
  return [...lifecycleDomain_stagesFor(lifecycleDomain_decodeProfile(value))];
}

function lifecycleDomain_validateCompletedPrefix(
  stages: readonly LifecycleStage[],
  completed: readonly LifecycleStage[],
): void {
  if (completed.length > stages.length) throw new TypeError("completedStages is too long.");
  for (let index = 0; index < completed.length; index += 1) {
    if (completed[index] !== stages[index]) {
      throw new TypeError("completedStages must be an exact ordered prefix.");
    }
  }
}

function lifecycleDomain_attempted(
  attemptedStage: LifecycleStage,
  completedStages: readonly LifecycleStage[],
  target: LifecycleStage,
): boolean {
  return attemptedStage === target || completedStages.includes(target);
}

function lifecycleDomain_emptyPartialEffects(): LifecyclePartialEffects {
  return {
    draftIdentitiesSaved: [],
    statePersisted: false,
    teardownIntentPersisted: false,
    terminalReceiptIdentitiesPersisted: [],
    disposedIdentities: [],
    releasedLeaseIdentities: [],
    retainedLeaseIdentities: [],
    cancellation: null,
  };
}

function lifecycleDomain_mergeCancellation(
  prior: LifecycleCancellationOutcome | null,
  next: LifecycleCancellationOutcome | null,
): LifecycleCancellationOutcome | null {
  if (prior === null) return next;
  if (next === null) return prior;
  const outcomes = new Map<string, LifecycleCancellationOutcome["terminalOutcomes"][number]>();
  for (const outcome of [...prior.terminalOutcomes, ...next.terminalOutcomes]) {
    const existing = outcomes.get(outcome.identity);
    if (existing && existing.outcome !== outcome.outcome) {
      throw new TypeError("cancellation outcomes conflict for one identity.");
    }
    outcomes.set(outcome.identity, outcome);
  }
  return lifecycle_decodeCancellationOutcome({
    stoppedIdentities: [...new Set([...prior.stoppedIdentities, ...next.stoppedIdentities])],
    failedToStopIdentities: [
      ...new Set([...prior.failedToStopIdentities, ...next.failedToStopIdentities]),
    ],
    neverStartedIdentities: [
      ...new Set([...prior.neverStartedIdentities, ...next.neverStartedIdentities]),
    ],
    stillUnsettledIdentities: [
      ...new Set([...prior.stillUnsettledIdentities, ...next.stillUnsettledIdentities]),
    ],
    terminalOutcomes: [...outcomes.values()],
    leaseCustody:
      prior.leaseCustody === "unknown" || next.leaseCustody === "unknown"
        ? "unknown"
        : prior.leaseCustody === "released" || next.leaseCustody === "released"
          ? "released"
          : "retained",
  });
}

function lifecycleDomain_mergePartialEffects(
  prior: LifecyclePartialEffects,
  next: LifecyclePartialEffects,
): LifecyclePartialEffects {
  const terminalReceiptIdentitiesPersisted = [
    ...new Set([
      ...prior.terminalReceiptIdentitiesPersisted,
      ...next.terminalReceiptIdentitiesPersisted,
    ]),
  ];
  return {
    draftIdentitiesSaved: [
      ...new Set([...prior.draftIdentitiesSaved, ...next.draftIdentitiesSaved]),
    ],
    statePersisted: prior.statePersisted || next.statePersisted,
    teardownIntentPersisted: prior.teardownIntentPersisted || next.teardownIntentPersisted,
    terminalReceiptIdentitiesPersisted,
    disposedIdentities: [...new Set([...prior.disposedIdentities, ...next.disposedIdentities])],
    releasedLeaseIdentities: [
      ...new Set([...prior.releasedLeaseIdentities, ...next.releasedLeaseIdentities]),
    ],
    retainedLeaseIdentities: [
      ...new Set([...prior.retainedLeaseIdentities, ...next.retainedLeaseIdentities]),
    ],
    cancellation: lifecycleDomain_mergeCancellation(prior.cancellation, next.cancellation),
  };
}

function lifecycleDomain_includesStrings(
  container: readonly string[],
  required: readonly string[],
): boolean {
  return required.every((value) => container.includes(value));
}

function lifecycleDomain_validatePartialEffectsPreserved(
  prior: LifecyclePartialEffects,
  next: LifecyclePartialEffects,
): void {
  if (prior.statePersisted && !next.statePersisted) {
    throw new TypeError("partial effects regress persisted state.");
  }
  if (prior.teardownIntentPersisted && !next.teardownIntentPersisted) {
    throw new TypeError("partial effects regress persisted teardown intent.");
  }
  for (const [name, required] of [
    ["draft identities", prior.draftIdentitiesSaved],
    ["terminal receipt identities", prior.terminalReceiptIdentitiesPersisted],
    ["disposed identities", prior.disposedIdentities],
    ["released lease identities", prior.releasedLeaseIdentities],
    ["retained lease identities", prior.retainedLeaseIdentities],
  ] as const) {
    const current =
      next[
        name === "draft identities"
          ? "draftIdentitiesSaved"
          : name === "terminal receipt identities"
            ? "terminalReceiptIdentitiesPersisted"
            : name === "disposed identities"
              ? "disposedIdentities"
              : name === "released lease identities"
                ? "releasedLeaseIdentities"
                : "retainedLeaseIdentities"
      ];
    if (!lifecycleDomain_includesStrings(current, required)) {
      throw new TypeError(`partial effects regress ${name}.`);
    }
  }
  if (prior.cancellation !== null) {
    const nextCancellation = next.cancellation;
    if (nextCancellation === null) {
      throw new TypeError("partial effects regress cancellation facts.");
    }
    lifecycleDomain_mergeCancellation(prior.cancellation, nextCancellation);
  }
}

function lifecycleDomain_receiptStage(receipt: StageReceipt): LifecycleStage {
  if (receipt.kind === "draft-saved") return "flush-drafts";
  if (receipt.kind === "terminal-persisted") return "persist-terminal-receipts";
  if (
    receipt.kind === "cancellation" ||
    receipt.kind === "settlement" ||
    receipt.kind === "work-terminal" ||
    receipt.kind === "tool-settled"
  ) {
    return "cancel-and-wait";
  }
  return "dispose-and-release";
}

function lifecycleDomain_receiptIdentitiesForStage(
  stage: LifecycleStage,
  effects: LifecyclePartialEffects,
): ReadonlySet<string> {
  const cancellation = effects.cancellation;
  if (stage === "flush-drafts") return new Set(effects.draftIdentitiesSaved);
  if (stage === "persist-terminal-receipts") {
    return new Set(effects.terminalReceiptIdentitiesPersisted);
  }
  if (stage === "cancel-and-wait") {
    return new Set([
      ...(cancellation?.stoppedIdentities ?? []),
      ...(cancellation?.failedToStopIdentities ?? []),
      ...(cancellation?.neverStartedIdentities ?? []),
      ...(cancellation?.stillUnsettledIdentities ?? []),
      ...(cancellation?.terminalOutcomes.map((outcome) => outcome.identity) ?? []),
    ]);
  }
  if (stage === "dispose-and-release") {
    return new Set([
      ...effects.disposedIdentities,
      ...effects.releasedLeaseIdentities,
      ...effects.retainedLeaseIdentities,
    ]);
  }
  return new Set();
}

function lifecycleDomain_validateTransitionReceipts(
  receipts: readonly StageReceipt[],
  completedStages: readonly LifecycleStage[],
  attemptedStage: LifecycleStage,
  outcome: "succeeded" | "failed",
  effects: LifecyclePartialEffects,
): void {
  const allowedStages = new Set([...completedStages, attemptedStage]);
  const failedToStop = new Set(effects.cancellation?.failedToStopIdentities ?? []);
  const stillUnsettled = new Set(effects.cancellation?.stillUnsettledIdentities ?? []);
  const stopped = new Set(effects.cancellation?.stoppedIdentities ?? []);
  const terminalByIdentity = new Map(
    (effects.cancellation?.terminalOutcomes ?? []).map(
      (terminal) => [terminal.identity, terminal.outcome] as const,
    ),
  );
  const neverStarted = new Set(effects.cancellation?.neverStartedIdentities ?? []);
  const expectedCancellationOutcomeByIdentity = new Map<string, string>(terminalByIdentity);
  for (const identity of stopped) {
    expectedCancellationOutcomeByIdentity.set(
      identity,
      terminalByIdentity.get(identity) ?? "stopped",
    );
  }
  for (const identity of neverStarted) {
    expectedCancellationOutcomeByIdentity.set(identity, "cancelled");
  }
  const authoritativeTerminalStates = new Set([
    "stopped",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]);
  const cancellationReceiptsByIdentity = new Map<string, StageReceipt[]>();
  const terminalReceiptIdentities = new Set<string>();
  const seen = new Set<string>();
  for (const receipt of receipts) {
    const expectedStage = lifecycleDomain_receiptStage(receipt);
    const allowedIdentities = lifecycleDomain_receiptIdentitiesForStage(expectedStage, effects);
    if (
      receipt.stage !== expectedStage ||
      !allowedStages.has(receipt.stage) ||
      receipt.identities.some((identity) => !allowedIdentities.has(identity))
    ) {
      throw new TypeError("transition receipt is unrelated, future, or for an unknown identity.");
    }
    if (
      receipt.stage === "cancel-and-wait" &&
      receipt.success &&
      receipt.toState !== "retained" &&
      receipt.toState !== "unsettled" &&
      receipt.identities.some(
        (identity) => failedToStop.has(identity) || stillUnsettled.has(identity),
      )
    ) {
      throw new TypeError(
        "cancellation receipt contradicts failed-to-stop or still-unsettled effects.",
      );
    }
    if (
      receipt.stage === "cancel-and-wait" &&
      (receipt.toState === "retained" || receipt.toState === "unsettled") &&
      receipt.identities.some(
        (identity) =>
          stopped.has(identity) ||
          terminalByIdentity.has(identity) ||
          (!failedToStop.has(identity) && !stillUnsettled.has(identity)),
      )
    ) {
      throw new TypeError(
        "retained/unsettled cancellation receipt contradicts the cancellation outcome.",
      );
    }
    if (
      receipt.stage === "cancel-and-wait" &&
      receipt.success &&
      authoritativeTerminalStates.has(receipt.toState) &&
      receipt.identities.some(
        (identity) => expectedCancellationOutcomeByIdentity.get(identity) !== receipt.toState,
      )
    ) {
      throw new TypeError("cancellation receipt contradicts an authoritative terminal outcome.");
    }
    if (receipt.stage === "cancel-and-wait") {
      for (const identity of receipt.identities) {
        if (
          !expectedCancellationOutcomeByIdentity.has(identity) &&
          receipt.kind !== "cancellation" &&
          receipt.kind !== "settlement"
        ) {
          continue;
        }
        const matching = cancellationReceiptsByIdentity.get(identity) ?? [];
        matching.push(receipt);
        cancellationReceiptsByIdentity.set(identity, matching);
      }
    }
    if (receipt.kind === "terminal-persisted") {
      const mismatched = receipt.identities.some(
        (identity) =>
          !terminalByIdentity.has(identity) || terminalByIdentity.get(identity) !== receipt.toState,
      );
      if (mismatched) {
        throw new TypeError("terminal receipt does not match an authoritative outcome.");
      }
      if (receipt.success) {
        for (const identity of receipt.identities) terminalReceiptIdentities.add(identity);
      }
    }
    if (receipt.stage === attemptedStage && outcome === "succeeded" && !receipt.success) {
      throw new TypeError("successful transition receipts must report success.");
    }
    const key = JSON.stringify([
      receipt.stage,
      receipt.kind,
      receipt.identities,
      receipt.fromState,
      receipt.toState,
    ]);
    if (seen.has(key)) throw new TypeError("transition receipt is duplicated.");
    seen.add(key);
  }
  if (attemptedStage === "persist-terminal-receipts" && outcome === "succeeded") {
    const missingReceipt = effects.terminalReceiptIdentitiesPersisted.some(
      (identity) => !terminalReceiptIdentities.has(identity),
    );
    if (missingReceipt) {
      throw new TypeError("successful terminal persistence omits a required terminal receipt.");
    }
  }
  if (attemptedStage === "cancel-and-wait" && outcome === "succeeded") {
    const requiredIdentities = new Set(expectedCancellationOutcomeByIdentity.keys());
    const receiptIdentities = new Set(cancellationReceiptsByIdentity.keys());
    const exactIdentitySet =
      requiredIdentities.size === receiptIdentities.size &&
      [...requiredIdentities].every((identity) => receiptIdentities.has(identity));
    const duplicateOrMismatched = [...cancellationReceiptsByIdentity].some(
      ([identity, matching]) =>
        matching.length !== 1 ||
        !matching[0]?.success ||
        (matching[0]?.kind !== "cancellation" && matching[0]?.kind !== "settlement") ||
        matching[0]?.toState !== expectedCancellationOutcomeByIdentity.get(identity),
    );
    if (!exactIdentitySet || duplicateOrMismatched) {
      throw new TypeError(
        "successful cancellation requires exactly one matching receipt per terminal identity.",
      );
    }
  }
}

function lifecycleDomain_terminalCancellationIdentities(
  effects: LifecyclePartialEffects,
): ReadonlySet<string> {
  return new Set(effects.cancellation?.terminalOutcomes.map((outcome) => outcome.identity) ?? []);
}

function lifecycleDomain_validateTerminalEffectPersistence(
  effects: LifecyclePartialEffects,
  requirePersistence: boolean,
): void {
  if (!requirePersistence) return;
  const persisted = new Set(effects.terminalReceiptIdentitiesPersisted);
  const missing = [...lifecycleDomain_terminalCancellationIdentities(effects)].filter(
    (identity) => !persisted.has(identity),
  );
  if (missing.length > 0) {
    throw new TypeError("terminal receipt effects omit known terminal identities.");
  }
  const known = lifecycleDomain_terminalCancellationIdentities(effects);
  const unexpected = [...persisted].filter((identity) => !known.has(identity));
  if (unexpected.length > 0) {
    throw new TypeError("terminal receipt effects include identities without terminal outcomes.");
  }
}

function lifecycleDomain_requiredEffectsForCompletedStages(
  completedStages: readonly LifecycleStage[],
): LifecyclePartialEffects {
  const required = lifecycleDomain_emptyPartialEffects();
  if (completedStages.includes("persist-state-and-teardown-intent")) {
    const cancellation: LifecycleCancellationOutcome | null = completedStages.includes(
      "cancel-and-wait",
    )
      ? {
          stoppedIdentities: [],
          failedToStopIdentities: [],
          neverStartedIdentities: [],
          stillUnsettledIdentities: [],
          terminalOutcomes: [],
          leaseCustody: "retained" as const,
        }
      : null;
    return {
      ...required,
      statePersisted: true,
      teardownIntentPersisted: true,
      terminalReceiptIdentitiesPersisted:
        completedStages.includes("persist-terminal-receipts") && cancellation
          ? cancellation.terminalOutcomes.map((outcome) => outcome.identity)
          : [],
      cancellation,
    };
  }
  return required;
}

/**
 * Advance exactly one stage in the accepted sequence and retain cumulative effects.
 *
 * A failure stops the sequence at the attempted stage. The attempt must include all known prior
 * durable effects, so a later failure cannot erase persisted state, teardown intent, cancellation,
 * terminal receipt, disposal, or lease facts.
 */
export function lifecycleDomain_transition(
  value: LifecycleTransitionInput,
): LifecycleStageTransition {
  if (value === null || typeof value !== "object")
    throw new TypeError("advance input is required.");
  if (!lifecycleDomain_isIdentifier(value.operationId)) {
    throw new TypeError("transition operationId is invalid.");
  }
  const requestKey = lifecycle_decodeRequestKey(value.requestKey);
  const stageReceipts = lifecycleDomain_decodeReceipts(value.stageReceipts);
  lifecycleDomain_validateReceiptConsistency(stageReceipts);
  if (
    stageReceipts.some(
      (receipt) =>
        receipt.operationId !== value.operationId ||
        !lifecycleDomain_sameRequestKey(receipt.requestKey, requestKey),
    )
  ) {
    throw new TypeError("stage receipts do not match the transition operation scope.");
  }
  const profile = lifecycleDomain_decodeProfile(value.state.profile);
  const stages = lifecycleDomain_stagesFor(profile);
  const completedSource = value.state.completedStages;
  if (!lifecycleDomain_isDenseArray(completedSource)) {
    throw new TypeError("completedStages must be a dense bounded array.");
  }
  const completedStages = completedSource.map((stage) => lifecycle_decodeStage(stage));
  lifecycleDomain_validateCompletedPrefix(stages, completedStages);
  const stateFailedStage =
    value.state.failedStage === null ? null : lifecycle_decodeStage(value.state.failedStage);
  if (stateFailedStage !== null) {
    throw new TypeError("a failed lifecycle sequence is terminal and cannot advance.");
  }
  if (completedStages.length === stages.length) {
    throw new TypeError("completed lifecycle sequence has no next stage.");
  }
  const expectedStage = stages[completedStages.length];
  const attemptedStage = lifecycle_decodeStage(value.attempt.stage);
  if (attemptedStage !== expectedStage) {
    throw new TypeError(`expected stage ${String(expectedStage)} next.`);
  }
  if (value.attempt.outcome !== "succeeded" && value.attempt.outcome !== "failed") {
    throw new TypeError("stage outcome is not accepted.");
  }
  const priorEffects =
    value.state.partialEffects === undefined
      ? lifecycleDomain_emptyPartialEffects()
      : lifecycle_decodePartialEffects(value.state.partialEffects);
  const attemptEffects = lifecycle_decodePartialEffects(value.attempt.partialEffects);
  lifecycleDomain_validatePartialEffectsPreserved(priorEffects, attemptEffects);
  const stageRequired = lifecycleDomain_requiredEffectsForCompletedStages(completedStages);
  lifecycleDomain_validatePartialEffectsPreserved(stageRequired, attemptEffects);
  const partialEffects = lifecycleDomain_mergePartialEffects(priorEffects, attemptEffects);
  if (
    attemptedStage === "cancel-and-wait" &&
    value.attempt.outcome === "succeeded" &&
    ((partialEffects.cancellation?.failedToStopIdentities.length ?? 0) > 0 ||
      (partialEffects.cancellation?.stillUnsettledIdentities.length ?? 0) > 0)
  ) {
    throw new TypeError(
      "cancel-and-wait cannot succeed while failed-to-stop or still-unsettled identities remain.",
    );
  }
  lifecycleDomain_validateTerminalEffectPersistence(
    partialEffects,
    completedStages.includes("persist-terminal-receipts") ||
      (attemptedStage === "persist-terminal-receipts" && value.attempt.outcome === "succeeded"),
  );
  lifecycleDomain_validateTransitionReceipts(
    stageReceipts,
    completedStages,
    attemptedStage,
    value.attempt.outcome,
    partialEffects,
  );
  const nextCompleted =
    value.attempt.outcome === "succeeded" ? [...completedStages, attemptedStage] : completedStages;
  const nextStage =
    value.attempt.outcome === "succeeded" ? (stages[nextCompleted.length] ?? null) : null;
  const commitMarkerStage =
    profile === "full" ? "final-revalidate-and-commit-marker" : "window-close-commit-marker";
  const failedStage = value.attempt.outcome === "failed" ? attemptedStage : null;
  const unresolvedIdentities = [
    ...new Set([
      ...(partialEffects.cancellation?.failedToStopIdentities ?? []),
      ...(partialEffects.cancellation?.stillUnsettledIdentities ?? []),
    ]),
  ];
  return {
    profile,
    completedStages: nextCompleted,
    failedStage,
    attemptedStage,
    nextStage,
    cancellationAttempted:
      profile === "full" &&
      lifecycleDomain_attempted(attemptedStage, nextCompleted, "cancel-and-wait"),
    disposalAttempted:
      profile === "full" &&
      lifecycleDomain_attempted(attemptedStage, nextCompleted, "dispose-and-release"),
    commitMarkerAllowed: nextCompleted.includes(commitMarkerStage),
    lifecycleActionAllowed: value.attempt.outcome === "succeeded" && nextStage === null,
    partialEffects,
    failure:
      failedStage === null
        ? null
        : {
            operationId: value.operationId,
            requestKey,
            failedStage,
            completedStages: nextCompleted,
            stageReceipts,
            partialEffects,
            unresolvedIdentities,
          },
  };
}

function lifecycleDomain_workKey(item: LifecycleWorkFact): string {
  return `${item.kind}:${item.identity}`;
}

function lifecycleDomain_draftKey(item: LifecycleDraftFact): string {
  return `draft:${item.windowId}:${item.editGeneration}`;
}

function lifecycleDomain_mapBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [keyOf(item), item]));
}

function lifecycleDomain_workDeltaKind(
  kind: LifecycleWorkIdentityKind,
  from: LifecycleWorkState,
  to: LifecycleWorkState,
): LifecycleDeltaKind | "unexplained" {
  if (kind === "pending-tool") {
    return from === "pending" && to === "settled" ? "tool-settled" : "unexplained";
  }
  return from !== "settled" && to === "settled" ? "work-terminal" : "unexplained";
}

function lifecycleDomain_compareCheckpoints(
  baseline: StageCheckpoint,
  current: StageCheckpoint,
): readonly LifecycleDelta[] {
  const deltas: LifecycleDelta[] = [];
  const baselineWork = lifecycleDomain_mapBy(baseline.work, lifecycleDomain_workKey);
  const currentWork = lifecycleDomain_mapBy(current.work, lifecycleDomain_workKey);
  for (const key of [...baselineWork.keys()].sort()) {
    const prior = baselineWork.get(key);
    const next = currentWork.get(key);
    if (!prior) continue;
    if (!next) {
      deltas.push({
        kind: "unexplained",
        identity: prior.identity,
        fromState: prior.state,
        toState: "absent",
      });
      continue;
    }
    if (prior.state !== next.state) {
      deltas.push({
        kind: lifecycleDomain_workDeltaKind(prior.kind, prior.state, next.state),
        identity: prior.identity,
        fromState: prior.state,
        toState: next.state,
      });
    }
  }
  for (const key of [...currentWork.keys()].sort()) {
    const next = currentWork.get(key);
    if (next && !baselineWork.has(key)) {
      deltas.push({
        kind: "new-work",
        identity: next.identity,
        fromState: "absent",
        toState: next.state,
      });
    }
  }

  const baselineLeases = lifecycleDomain_mapBy(baseline.leases, (item) => item.identity);
  const currentLeases = lifecycleDomain_mapBy(current.leases, (item) => item.identity);
  for (const key of [...baselineLeases.keys()].sort()) {
    const prior = baselineLeases.get(key);
    const next = currentLeases.get(key);
    if (!prior) continue;
    if (!next) {
      deltas.push({
        kind: "ownership-race",
        identity: prior.identity,
        fromState: prior.ownership,
        toState: "absent",
      });
    } else if (prior.ownership !== next.ownership) {
      deltas.push({
        kind:
          prior.ownership === "local" && next.ownership === "absent"
            ? "lease-release"
            : "ownership-race",
        identity: prior.identity,
        fromState: prior.ownership,
        toState: next.ownership,
      });
    }
  }
  for (const key of [...currentLeases.keys()].sort()) {
    const next = currentLeases.get(key);
    if (next && !baselineLeases.has(key)) {
      deltas.push({
        kind: "ownership-race",
        identity: next.identity,
        fromState: "absent",
        toState: next.ownership,
      });
    }
  }

  const baselineDrafts = lifecycleDomain_mapBy(baseline.draftGenerations, lifecycleDomain_draftKey);
  const currentDrafts = lifecycleDomain_mapBy(current.draftGenerations, lifecycleDomain_draftKey);
  for (const key of [...baselineDrafts.keys()].sort()) {
    const prior = baselineDrafts.get(key);
    const next = currentDrafts.get(key);
    if (!prior) continue;
    if (!next) {
      deltas.push({
        kind: "unexplained",
        identity: key,
        fromState: prior.status,
        toState: "absent",
      });
    } else if (prior.status !== next.status) {
      deltas.push({
        kind: prior.status === "pending" && next.status === "saved" ? "draft-saved" : "unexplained",
        identity: key,
        fromState: prior.status,
        toState: next.status,
      });
    }
  }
  for (const key of [...currentDrafts.keys()].sort()) {
    const next = currentDrafts.get(key);
    if (next && !baselineDrafts.has(key)) {
      deltas.push({
        kind: "new-work",
        identity: key,
        fromState: "absent",
        toState: next.status,
      });
    }
  }
  return deltas;
}

function lifecycleDomain_decodeBoundary(value: unknown): LifecycleRevalidationBoundary {
  const values = [
    "barrier",
    "draft",
    "cancellation",
    "terminal-receipts",
    "disposal",
    "final",
  ] as const;
  if (typeof value !== "string" || !values.includes(value as LifecycleRevalidationBoundary)) {
    throw new TypeError("revalidation boundary is not accepted.");
  }
  return value as LifecycleRevalidationBoundary;
}

const lifecycleDomain_expectedStageByBoundary = {
  barrier: "barrier-and-revalidate",
  draft: "flush-drafts",
  cancellation: "cancel-and-wait",
  "terminal-receipts": "persist-terminal-receipts",
  disposal: "dispose-and-release",
  final: "final-revalidate-and-commit-marker",
} as const;

const lifecycleDomain_allowedDeltaKindsByBoundary: Readonly<
  Record<LifecycleRevalidationBoundary, readonly LifecycleDeltaKind[]>
> = {
  barrier: [],
  draft: ["draft-saved"],
  cancellation: ["work-terminal", "tool-settled"],
  "terminal-receipts": [],
  disposal: ["lease-release"],
  final: ["work-terminal", "tool-settled", "lease-release", "draft-saved"],
};

function lifecycleDomain_decodeReceipts(value: unknown): readonly StageReceipt[] {
  if (!lifecycleDomain_isDenseArray(value)) {
    throw new TypeError("receipts must be a bounded array.");
  }
  return value.map(lifecycle_decodeStageReceipt);
}

function lifecycleDomain_validateReceiptConsistency(receipts: readonly StageReceipt[]): void {
  const terminalStates = new Set([
    "settled",
    "stopped",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]);
  const retained = new Set<string>();
  const cancellationTerminal = new Map<string, Set<string>>();
  const persistedTerminal = new Map<string, Set<string>>();
  const persistedTerminalCounts = new Map<string, number>();
  for (const receipt of receipts) {
    for (const identity of receipt.identities) {
      if (
        (receipt.kind === "cancellation" || receipt.kind === "settlement") &&
        !receipt.success &&
        (receipt.toState === "retained" || receipt.toState === "unsettled")
      ) {
        retained.add(identity);
      }
      if (
        receipt.success &&
        terminalStates.has(receipt.toState) &&
        (receipt.stage === "cancel-and-wait" || receipt.kind === "terminal-persisted")
      ) {
        const target =
          receipt.kind === "terminal-persisted" ? persistedTerminal : cancellationTerminal;
        const outcomes = target.get(identity) ?? new Set<string>();
        outcomes.add(receipt.toState);
        target.set(identity, outcomes);
      }
      if (receipt.kind === "terminal-persisted" && receipt.success) {
        persistedTerminalCounts.set(identity, (persistedTerminalCounts.get(identity) ?? 0) + 1);
      }
    }
  }
  for (const identity of retained) {
    if (cancellationTerminal.has(identity) || persistedTerminal.has(identity)) {
      throw new TypeError(
        "one identity cannot have both retained/unsettled and settled terminal receipts.",
      );
    }
  }
  for (const [identity, outcomes] of cancellationTerminal) {
    if (outcomes.size > 1) {
      throw new TypeError("cancellation receipts conflict for one identity.");
    }
  }
  for (const [identity, outcomes] of persistedTerminal) {
    if (outcomes.size > 1 || (persistedTerminalCounts.get(identity) ?? 0) > 1) {
      throw new TypeError("terminal receipts conflict for one identity.");
    }
  }
}

function lifecycleDomain_receiptSupportsDelta(
  receipt: StageReceipt,
  delta: LifecycleDelta & { readonly kind: LifecycleDeltaKind },
  operationId: string,
  requestKey: LifecycleRequestKey,
): boolean {
  if (
    receipt.operationId !== operationId ||
    !lifecycleDomain_sameRequestKey(receipt.requestKey, requestKey) ||
    !receipt.success ||
    !receipt.identities.includes(delta.identity) ||
    receipt.fromState !== delta.fromState ||
    receipt.toState !== delta.toState
  ) {
    return false;
  }
  if (delta.kind === "draft-saved") {
    return receipt.stage === "flush-drafts" && receipt.kind === "draft-saved";
  }
  if (delta.kind === "lease-release") {
    return (
      receipt.stage === "dispose-and-release" &&
      (receipt.kind === "lease-release" || receipt.kind === "disposal")
    );
  }
  return (
    receipt.stage === "cancel-and-wait" &&
    (receipt.kind === delta.kind ||
      receipt.kind === "cancellation" ||
      receipt.kind === "settlement")
  );
}

function lifecycleDomain_hasTerminalReceipts(
  baseline: StageCheckpoint,
  current: StageCheckpoint,
  receipts: readonly StageReceipt[],
  enforceLowerBound: boolean,
  enforceUpperBound: boolean,
): boolean {
  if (current.work.some((work) => work.state !== "settled")) return false;
  return current.work.every((work) => {
    const baselineWork = baseline.work.find((item) => item.identity === work.identity);
    if (!baselineWork) return false;
    return receipts.some(
      (receipt) =>
        receipt.operationId === current.operationId &&
        lifecycleDomain_sameRequestKey(receipt.requestKey, current.requestKey) &&
        receipt.stage === "persist-terminal-receipts" &&
        receipt.kind === "terminal-persisted" &&
        receipt.success &&
        receipt.identities.includes(work.identity) &&
        receipt.fromState === baselineWork.state &&
        (!enforceLowerBound || receipt.observedAt >= baseline.capturedAt) &&
        (!enforceUpperBound || receipt.observedAt <= current.capturedAt),
    );
  });
}

function lifecycleDomain_hasExplicitNonSuccessCancellation(
  work: LifecycleWorkFact,
  receipts: readonly StageReceipt[],
  baseline: StageCheckpoint,
  current: StageCheckpoint,
): boolean {
  return receipts.some(
    (receipt) =>
      receipt.operationId === current.operationId &&
      lifecycleDomain_sameRequestKey(receipt.requestKey, current.requestKey) &&
      receipt.stage === "cancel-and-wait" &&
      (receipt.kind === "cancellation" || receipt.kind === "settlement") &&
      !receipt.success &&
      (receipt.toState === "retained" || receipt.toState === "unsettled") &&
      receipt.identities.includes(work.identity) &&
      receipt.fromState === work.state &&
      receipt.observedAt >= baseline.capturedAt &&
      receipt.observedAt <= current.capturedAt,
  );
}

function lifecycleDomain_decodeRevalidationInput(value: unknown): StageRevalidationInput {
  if (value === null || typeof value !== "object") {
    throw new TypeError("stage revalidation input is required.");
  }
  const record = value as Record<string, unknown>;
  const keys = ["operationId", "requestKey", "boundary", "baseline", "current", "receipts"];
  if (
    Object.getOwnPropertySymbols(record).length > 0 ||
    Object.getOwnPropertyNames(record).some((key) => !keys.includes(key)) ||
    Object.keys(record).length !== keys.length ||
    !lifecycleDomain_isIdentifier(record.operationId)
  ) {
    throw new TypeError("stage revalidation input has an unsupported shape.");
  }
  const receipts = lifecycleDomain_decodeReceipts(record.receipts);
  lifecycleDomain_validateReceiptConsistency(receipts);
  return {
    operationId: record.operationId,
    requestKey: lifecycle_decodeRequestKey(record.requestKey),
    boundary: lifecycleDomain_decodeBoundary(record.boundary),
    baseline: lifecycle_decodeStageCheckpoint(record.baseline),
    current: lifecycle_decodeStageCheckpoint(record.current),
    receipts,
  };
}

const lifecycleDomain_baselineStageByBoundary: Readonly<
  Record<LifecycleRevalidationBoundary, LifecycleStage>
> = {
  barrier: "capture-and-decide",
  draft: "barrier-and-revalidate",
  cancellation: "persist-state-and-teardown-intent",
  "terminal-receipts": "cancel-and-wait",
  disposal: "persist-terminal-receipts",
  final: "dispose-and-release",
};

/**
 * Compare two checkpoints and accept only exact operation-caused deltas at the current boundary.
 * New work and ownership races reject before any receipt can explain them.
 */
export function lifecycleDomain_revalidateStage(value: unknown): LifecycleRevalidationResult {
  let input: StageRevalidationInput;
  try {
    input = lifecycleDomain_decodeRevalidationInput(value);
  } catch {
    return {
      decision: "reject",
      reason: "unexplained-delta",
      deltas: [],
    };
  }
  const { operationId, requestKey, boundary, baseline, current, receipts } = input;
  if (
    baseline.operationId !== operationId ||
    current.operationId !== operationId ||
    !lifecycleDomain_sameRequestKey(baseline.requestKey, requestKey) ||
    !lifecycleDomain_sameRequestKey(current.requestKey, requestKey) ||
    baseline.stage !== lifecycleDomain_baselineStageByBoundary[boundary] ||
    baseline.censusRevision > current.censusRevision ||
    baseline.capturedAt > current.capturedAt ||
    current.stage !== lifecycleDomain_expectedStageByBoundary[boundary]
  ) {
    return {
      decision: "reject",
      reason: "unexplained-delta",
      deltas: lifecycleDomain_compareCheckpoints(baseline, current),
    };
  }
  const deltas = lifecycleDomain_compareCheckpoints(baseline, current);
  if (deltas.length > 0 && current.censusRevision === baseline.censusRevision) {
    return { decision: "reject", reason: "unexplained-delta", deltas };
  }
  if (deltas.some((delta) => delta.kind === "new-work")) {
    return { decision: "reject", reason: "new-work", deltas };
  }
  if (deltas.some((delta) => delta.kind === "ownership-race")) {
    return { decision: "reject", reason: "foreign-race", deltas };
  }
  const allowed = lifecycleDomain_allowedDeltaKindsByBoundary[boundary];
  for (const delta of deltas) {
    if (delta.kind === "unexplained" || !allowed.includes(delta.kind as LifecycleDeltaKind)) {
      return { decision: "reject", reason: "unsupported-delta", deltas };
    }
    const deltaKind = delta.kind as LifecycleDeltaKind;
    const sameIdentity = receipts.filter(
      (receipt) =>
        (receipt.kind === deltaKind ||
          (deltaKind === "lease-release" && receipt.kind === "disposal") ||
          (["work-terminal", "tool-settled"].includes(deltaKind) &&
            ["cancellation", "settlement"].includes(receipt.kind))) &&
        receipt.identities.includes(delta.identity) &&
        receipt.toState === delta.toState,
    );
    if (sameIdentity.some((receipt) => receipt.operationId !== operationId)) {
      return { decision: "reject", reason: "receipt-operation-mismatch", deltas };
    }
    const matching = receipts.some((receipt) =>
      lifecycleDomain_receiptSupportsDelta(
        receipt,
        { ...delta, kind: deltaKind },
        operationId,
        requestKey,
      ),
    );
    if (!matching) {
      return { decision: "reject", reason: "unexplained-delta", deltas };
    }
  }
  if (
    boundary === "cancellation" &&
    current.work
      .filter((work) => work.state !== "settled")
      .some(
        (work) =>
          !lifecycleDomain_hasExplicitNonSuccessCancellation(work, receipts, baseline, current),
      )
  ) {
    return { decision: "reject", reason: "unexplained-delta", deltas };
  }
  if (
    ["terminal-receipts", "disposal", "final"].includes(boundary) &&
    !lifecycleDomain_hasTerminalReceipts(
      baseline,
      current,
      receipts,
      boundary === "terminal-receipts",
      true,
    )
  ) {
    return { decision: "reject", reason: "unexplained-delta", deltas };
  }
  return {
    decision: "accept",
    reason: deltas.length === 0 ? "no-delta" : "expected-self-induced-delta",
    deltas,
  };
}

function lifecycleDomain_decideInterruption(
  input: LifecycleInterruptionInput,
): AbruptRecoveryDecision {
  if (
    input.authoritativeTerminal?.outcome === "failed" &&
    input.authoritativeTerminal.providerError
  ) {
    return {
      decision: "preserve-failed",
      outcomeKnown: true,
      terminal: input.authoritativeTerminal,
      autoReplay: false,
    };
  }
  if (input.authoritativeTerminal !== null) {
    return {
      decision: "preserve-terminal",
      outcomeKnown: true,
      terminal: input.authoritativeTerminal,
      ...(input.staleInterruption ? { reason: "terminal-precedence" } : {}),
      autoReplay: false,
    };
  }
  if (input.survival === "proven-live" && input.persistedIdentity !== null) {
    return {
      decision: "attach-live",
      outcomeKnown: false,
      identity: input.persistedIdentity,
      autoReplay: false,
    };
  }
  if (
    input.survival === "proven-dead" &&
    input.persistedIdentity !== null &&
    !input.missingResultOnly
  ) {
    return {
      decision: "interrupted",
      outcomeKnown: false,
      work: {
        ...input.persistedIdentity,
        reason: input.interruptionReason ?? "abrupt-crash",
        outcomeKnown: false,
        replayPolicy: "explicit-only",
      },
      pendingToolCallId: input.pendingToolCallId,
      autoReplay: false,
    };
  }
  return {
    decision: "pending-unknown",
    outcomeKnown: false,
    reason: input.missingResultOnly ? "missing-result-insufficient" : "liveness-unknown",
    autoReplay: false,
  };
}

/** Project a no-journal interruption decision from authoritative inputs. */
export function lifecycleDomain_projectInterruption(value: unknown): AbruptRecoveryDecision {
  return lifecycleDomain_decideInterruption(lifecycle_decodeInterruptionInput(value));
}

/** Recover through the same no-journal projection without replay authority. */
export function lifecycleDomain_recoverAbruptCrash(value: unknown): AbruptRecoveryDecision {
  return lifecycleDomain_projectInterruption(value);
}

export type {
  LifecycleCancellationOutcome,
  LifecycleInterruptionInput,
  LifecycleFailure,
  LifecyclePartialEffects,
  LifecycleRevalidationReason,
  LifecycleStageTransition,
  StageReceipt,
};
