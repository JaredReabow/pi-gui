/**
 * Pure D07 Setup Centre domain.
 *
 * This reducer owns progression and operation arbitration only. Adapters may
 * perform I/O elsewhere, but this module never starts work, opens a URL, stores a
 * credential, replays a result, or derives readiness from a single transport fact.
 */

import {
  setupPersistence_decodeAuthorityState,
  setupPersistence_decodeTransitionRequest,
  setupCentre_decodeCancellationIntent,
  setupCentre_decodeCancellationReceipt,
  setupCentre_decodeCancellationRequest,
  setupCentre_decodeCheckpoint,
  setupCentre_decodeCheckpointAnchor,
  setupCentre_decodeComponentFacts,
  setupCentre_decodeHandoff,
  setupCentre_decodeLogicalOperation,
  setupCentre_decodeOperationRequest,
  setupCentre_decodeOperationResult,
  setupCentre_decodeRestartObservation,
  setupCentre_decodeRetiredOperation,
  setupCentre_decodeStatusProjection,
  setupCentre_getRoute,
  setupCentre_maxRetiredOperations,
  setupCentre_schemaVersion,
  setupCentre_stepIds,
  type SetupCancellationIntent,
  type SetupCancellationReceipt,
  type SetupCheckpoint,
  type SetupComponentFacts,
  type SetupEvidenceFact,
  type SetupHandoff,
  type SetupLogicalOperation,
  type SetupOperationRequest,
  type SetupPersistenceAuthorityState,
  type SetupPersistenceCursor,
  type SetupPersistenceIdentity,
  type SetupPersistenceTransitionRequest,
  type SetupPersistenceTransitionResult,
  type SetupProgress,
  type SetupReasonCode,
  type SetupRestartObservation,
  type SetupRetiredOperation,
  type SetupRoute,
  type SetupRouteId,
  type SetupStatusProjection,
  type SetupStepId,
  type SetupStepProjection,
} from "../../contracts/setup-centre";

export interface SetupDomainState {
  readonly checkpoint: SetupCheckpoint;
  readonly facts: SetupComponentFacts;
  readonly activeOperation: SetupLogicalOperation | null;
  readonly cancellationIntent: SetupCancellationIntent | null;
  readonly lastCancellationReceipt: SetupCancellationReceipt | null;
  readonly inspectionCompletedSteps: readonly SetupStepId[];
  readonly requiresInspection: boolean;
}

export interface SetupBeginOperationResult {
  readonly state: SetupDomainState;
  readonly operation: SetupLogicalOperation;
}

export interface SetupRequestCancellationResult {
  readonly state: SetupDomainState;
  readonly intent: SetupCancellationIntent;
}

export interface SetupCancellationApplicationResult {
  readonly state: SetupDomainState;
  readonly received: SetupCancellationReceipt;
  readonly retiredOperation: SetupRetiredOperation | null;
  readonly ownershipReleased: boolean;
  readonly requiresInspection: boolean;
}

export interface SetupConfigurationChangeResult {
  readonly state: SetupDomainState;
  readonly invalidatedSteps: readonly SetupStepId[];
  readonly automaticActions: readonly [];
}

export interface SetupRestartReconciliationResult {
  readonly state: SetupDomainState;
  readonly preservedCompletedSteps: readonly SetupStepId[];
  readonly preservedSkippedSteps: readonly SetupStepId[];
  readonly preRestartResultsAccepted: false;
  readonly anchorMatched: true;
  readonly requiresInspection: true;
  readonly automaticActions: readonly [];
}

const setupDomain_configurationInvalidatedSteps = [
  "catalogue",
  "probe",
] as const satisfies readonly SetupStepId[];

function setupDomain_progressFor(
  route: SetupRoute,
  generation: number,
  configRevision: number,
): SetupProgress {
  return {
    routeId: route.routeId,
    generation,
    configRevision,
    steps: route.steps.map((step) => ({ step: step.step, state: "pending" })),
  };
}

function setupDomain_emptyFacts(
  route: SetupRoute,
  generation: number,
  configRevision: number,
): SetupComponentFacts {
  return {
    componentId: route.componentId,
    ownership: route.routeId === "direct-provider" ? "bundled" : "unknown",
    generation,
    configRevision,
    facts: [],
  };
}

/** Create a closed initial checkpoint. No external work is scheduled. */
export function setupDomain_initialCheckpoint(
  routeValue: SetupRouteId,
  generation = 1,
  configRevision = 1,
): SetupCheckpoint {
  const route = setupCentre_getRoute(routeValue);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new TypeError("generation must be positive.");
  }
  if (!Number.isSafeInteger(configRevision) || configRevision < 1) {
    throw new TypeError("configRevision must be positive.");
  }
  return setupCentre_decodeCheckpoint({
    schemaVersion: setupCentre_schemaVersion,
    routeId: route.routeId,
    componentId: route.componentId,
    generation,
    configRevision,
    operationSequence: 0,
    lastCompletedOperationId: null,
    retiredOperations: [],
    progress: setupDomain_progressFor(route, generation, configRevision),
  });
}

/** Create a session with no observations and no active owner. */
export function setupDomain_initialState(
  routeValue: SetupRouteId,
  generation = 1,
  configRevision = 1,
): SetupDomainState {
  const checkpoint = setupDomain_initialCheckpoint(routeValue, generation, configRevision);
  const route = setupCentre_getRoute(routeValue);
  return {
    checkpoint,
    facts: setupDomain_emptyFacts(route, generation, configRevision),
    activeOperation: null,
    cancellationIntent: null,
    lastCancellationReceipt: null,
    inspectionCompletedSteps: [],
    requiresInspection: false,
  };
}

function setupDomain_routeFor(state: SetupDomainState): SetupRoute {
  return setupCentre_getRoute(state.checkpoint.routeId);
}

function setupDomain_assertState(state: SetupDomainState): void {
  const checkpoint = setupCentre_decodeCheckpoint(state.checkpoint);
  const facts = setupCentre_decodeComponentFacts(state.facts);
  if (
    facts.componentId !== checkpoint.componentId ||
    facts.generation !== checkpoint.generation ||
    facts.configRevision !== checkpoint.configRevision
  ) {
    throw new TypeError("facts are not bound to the current checkpoint.");
  }
  if (state.activeOperation !== null) setupCentre_decodeLogicalOperation(state.activeOperation);
  if (
    state.activeOperation !== null &&
    (state.activeOperation.request.generation !== checkpoint.generation ||
      state.activeOperation.request.configRevision !== checkpoint.configRevision ||
      state.activeOperation.operationSequence !== checkpoint.operationSequence)
  ) {
    throw new TypeError("active operation is not bound to the checkpoint high-water marks.");
  }
  if (
    state.activeOperation !== null &&
    checkpoint.retiredOperations.some(
      (operation) => operation.operationId === state.activeOperation?.request.operationId,
    )
  ) {
    throw new TypeError("a retired operation cannot own the current resource.");
  }
  if (state.cancellationIntent !== null) {
    setupCentre_decodeCancellationIntent(state.cancellationIntent);
  }
  if (state.lastCancellationReceipt !== null) {
    setupCentre_decodeCancellationReceipt(state.lastCancellationReceipt);
  }
  if (
    new Set(state.inspectionCompletedSteps).size !== state.inspectionCompletedSteps.length ||
    state.inspectionCompletedSteps.some((step) => !setupCentre_stepIds.includes(step))
  ) {
    throw new TypeError("inspectionCompletedSteps must be unique route step identities.");
  }
  if (typeof state.requiresInspection !== "boolean") {
    throw new TypeError("requiresInspection must be boolean.");
  }
}

/** Create a session from a decoded checkpoint and matching facts. */
export function setupDomain_createState(
  checkpointValue: unknown,
  factsValue: unknown,
): SetupDomainState {
  const checkpoint = setupCentre_decodeCheckpoint(checkpointValue);
  const facts = setupCentre_decodeComponentFacts(factsValue);
  const state: SetupDomainState = {
    checkpoint,
    facts,
    activeOperation: null,
    cancellationIntent: null,
    lastCancellationReceipt: null,
    inspectionCompletedSteps: [],
    requiresInspection: false,
  };
  setupDomain_assertState(state);
  return state;
}

function setupDomain_progressStep(state: SetupDomainState, step: SetupStepId) {
  return state.checkpoint.progress.steps.find((entry) => entry.step === step);
}

function setupDomain_firstIncompleteStep(state: SetupDomainState): SetupStepId | null {
  const step = state.checkpoint.progress.steps.find((entry) => entry.state === "pending");
  return step?.step ?? null;
}

function setupDomain_handoffFor(
  state: SetupDomainState,
  step: SetupStepId,
  readiness: SetupStatusProjection["readiness"],
): SetupHandoff | null {
  if (state.activeOperation !== null) return null;
  let kind: SetupHandoff["kind"];
  let reasonCode: SetupReasonCode;
  switch (readiness) {
    case "needs-inspection":
      kind = "inspect-current-state";
      reasonCode = state.requiresInspection ? "restart-inspection-required" : "operation-cancelled";
      break;
    case "not-detected":
    case "needs-install":
      kind = "install-or-use-existing";
      reasonCode = "not-found";
      break;
    case "needs-process":
      kind = "start-or-use-existing-service";
      reasonCode = "process-stopped";
      break;
    case "needs-account":
      kind = "complete-account-step";
      reasonCode = "account-action-required";
      break;
    case "needs-permission":
      kind = "review-native-approval";
      reasonCode = "native-approval-required";
      break;
    case "needs-endpoint":
      kind = "start-or-use-existing-service";
      reasonCode = "endpoint-unreachable";
      break;
    case "needs-catalogue":
      kind = "complete-account-step";
      reasonCode = "catalogue-empty";
      break;
    case "needs-probe":
      kind = "run-user-started-probe";
      reasonCode = "probe-not-run";
      break;
    case "unsupported":
      return null;
    case "ready":
      return null;
  }
  return setupCentre_decodeHandoff({
    kind,
    routeId: state.checkpoint.routeId,
    step,
    generation: state.checkpoint.generation,
    configRevision: state.checkpoint.configRevision,
    operationId: null,
    reasonCode,
  });
}

function setupDomain_readinessFor(
  state: SetupDomainState,
  projection: readonly SetupStepProjection[],
): SetupStatusProjection["readiness"] {
  if (state.activeOperation !== null) return "needs-inspection";
  if (state.requiresInspection) return "needs-inspection";
  for (const step of projection) {
    if (step.requirement !== "required" || step.state === "complete") continue;
    if (step.evidence === "unsupported") return "unsupported";
    if (step.evidence === "unknown") return "needs-inspection";
    if (step.evidence === "present-unverified") {
      switch (step.step) {
        case "detection":
          return "needs-inspection";
        case "installation":
          return "needs-install";
        case "process":
          return "needs-process";
        case "endpoint":
          return "needs-endpoint";
        case "account":
          return "needs-account";
        case "catalogue":
          return "needs-catalogue";
        case "permission":
          return "needs-permission";
        case "probe":
          return "needs-probe";
      }
    }
    if (step.evidence === "not-detected") {
      switch (step.step) {
        case "detection":
          return "not-detected";
        case "installation":
          return "needs-install";
        case "process":
          return "needs-process";
        case "endpoint":
          return "needs-endpoint";
        case "account":
          return "needs-account";
        case "catalogue":
          return "needs-catalogue";
        case "permission":
          return "needs-permission";
        case "probe":
          return "needs-probe";
      }
    }
    return step.requirement === "required" ? "needs-inspection" : "needs-inspection";
  }
  return projection.every(
    (step) =>
      step.requirement === "optional" ||
      (step.state === "complete" && step.evidence === "verified"),
  )
    ? "ready"
    : "needs-inspection";
}

/** Project separate facts into a closed route status. Unknown is never support. */
export function setupDomain_projectStatus(state: SetupDomainState): SetupStatusProjection {
  setupDomain_assertState(state);
  const route = setupDomain_routeFor(state);
  const factByStep = new Map(state.facts.facts.map((fact) => [fact.dimension, fact] as const));
  const steps = route.steps.map((routeStep): SetupStepProjection => {
    const fact = factByStep.get(routeStep.step);
    const progress = setupDomain_progressStep(state, routeStep.step);
    if (!fact) {
      return {
        step: routeStep.step,
        requirement: routeStep.requirement,
        state: progress?.state === "skipped" ? "skipped" : "pending",
        evidence: "unknown",
        reasonCode: state.requiresInspection ? "restart-inspection-required" : null,
      };
    }
    let stepState: SetupStepProjection["state"];
    if (progress?.state === "skipped") stepState = "skipped";
    else if (progress?.state === "complete" && fact.state === "verified") stepState = "complete";
    else if (fact.state === "unknown") stepState = "unknown";
    else if (fact.state === "verified") stepState = "current";
    else stepState = "needs-action";
    return {
      step: routeStep.step,
      requirement: routeStep.requirement,
      state: stepState,
      evidence: fact.state,
      reasonCode: fact.reasonCode,
    };
  });
  let readiness = setupDomain_readinessFor(state, steps);
  const firstPending = state.requiresInspection
    ? (route.steps[0]?.step ?? null)
    : (state.activeOperation?.request.step ?? setupDomain_firstIncompleteStep(state));
  if (readiness === "ready" && firstPending !== null) readiness = "needs-inspection";
  const currentStep =
    readiness === "ready"
      ? null
      : (state.activeOperation?.request.step ??
        steps.find((step) => step.state !== "complete" && step.state !== "skipped")?.step ??
        firstPending);
  const handoff =
    currentStep === null ? null : setupDomain_handoffFor(state, currentStep, readiness);
  return setupCentre_decodeStatusProjection({
    routeId: route.routeId,
    componentId: route.componentId,
    readiness,
    ready: readiness === "ready",
    requiresInspection: state.requiresInspection || readiness === "needs-inspection",
    currentStep,
    steps,
    handoff,
  });
}

function setupDomain_assertRouterStepIsOpen(
  state: SetupDomainState,
  request: SetupOperationRequest,
  openedAt: number,
): void {
  const route = setupDomain_routeFor(state);
  const progress = setupDomain_progressStep(state, request.step);
  if (!route.steps.some((step) => step.step === request.step) || !progress) {
    throw new TypeError("operation step is not part of the current route.");
  }
  if (progress.state !== "pending" && !(state.requiresInspection && request.mode === "inspect")) {
    throw new TypeError("operation step is already terminal in progress.");
  }
  const expectedStep = state.requiresInspection
    ? route.steps.find((step) => !state.inspectionCompletedSteps.includes(step.step))?.step
    : setupDomain_firstIncompleteStep(state);
  if (request.step !== expectedStep) {
    throw new TypeError("operation must target the current setup step.");
  }
  if (
    request.generation !== state.checkpoint.generation ||
    request.configRevision !== state.checkpoint.configRevision
  ) {
    throw new TypeError("operation generation/configuration is stale.");
  }
  if (request.resourceKey.componentId !== state.checkpoint.componentId) {
    throw new TypeError("operation resource component is unrelated to the route.");
  }
  if (openedAt < 0) throw new TypeError("openedAt must be a timestamp.");
}

/** Claim the single logical-operation owner for an explicit user-startable step. */
export function setupDomain_beginOperation(
  state: SetupDomainState,
  requestValue: unknown,
  openedAt: number,
): SetupBeginOperationResult {
  setupDomain_assertState(state);
  if (state.activeOperation !== null || state.cancellationIntent !== null) {
    throw new TypeError("setup already has an active resource owner.");
  }
  const request = setupCentre_decodeOperationRequest(requestValue);
  if (request.routeId !== state.checkpoint.routeId) {
    throw new TypeError("operation route is unrelated to the session.");
  }
  if (
    state.checkpoint.retiredOperations.some(
      (operation) => operation.operationId === request.operationId,
    )
  ) {
    throw new TypeError("operationId is retired and cannot be admitted again.");
  }
  if (state.requiresInspection && request.mode !== "inspect") {
    throw new TypeError("inspection must complete before another setup action.");
  }
  setupDomain_assertRouterStepIsOpen(state, request, openedAt);
  const checkpoint = setupCentre_decodeCheckpoint({
    ...state.checkpoint,
    operationSequence: state.checkpoint.operationSequence + 1,
  });
  const operation = setupCentre_decodeLogicalOperation({
    kind: "logical-operation",
    request,
    operationSequence: checkpoint.operationSequence,
    openedAt,
    state: "owned",
  });
  return {
    state: {
      ...state,
      checkpoint,
      activeOperation: operation,
      lastCancellationReceipt: null,
    },
    operation,
  };
}

/** Derive bounded persistence identity only from an explicit admitted operation. */
export function setupDomain_persistenceIdentityFromOperation(
  operationValue: unknown,
): SetupPersistenceIdentity {
  const operation = setupCentre_decodeLogicalOperation(operationValue);
  return {
    generation: operation.request.generation,
    configRevision: operation.request.configRevision,
    operationSequence: operation.operationSequence,
    operationId: operation.request.operationId,
    step: operation.request.step,
    resourceKey: operation.request.resourceKey,
  };
}

function setupDomain_sameOperation(
  operation: SetupLogicalOperation,
  value: {
    readonly operationId: string;
    readonly routeId: SetupRouteId;
    readonly step: SetupStepId;
    readonly resourceKey: SetupOperationRequest["resourceKey"];
    readonly generation: number;
    readonly configRevision: number;
  },
): boolean {
  return (
    operation.request.operationId === value.operationId &&
    operation.request.routeId === value.routeId &&
    operation.request.step === value.step &&
    operation.request.resourceKey.componentId === value.resourceKey.componentId &&
    operation.request.resourceKey.resource === value.resourceKey.resource &&
    operation.request.resourceKey.scopeId === value.resourceKey.scopeId &&
    operation.request.generation === value.generation &&
    operation.request.configRevision === value.configRevision
  );
}

function setupDomain_replaceFact(
  state: SetupDomainState,
  fact: SetupEvidenceFact,
): SetupComponentFacts {
  return setupCentre_decodeComponentFacts({
    ...state.facts,
    facts: [...state.facts.facts.filter((item) => item.dimension !== fact.dimension), fact],
  });
}

function setupDomain_setProgress(
  state: SetupDomainState,
  step: SetupStepId,
  nextState: "pending" | "complete" | "skipped",
  completedOperationId: string | null = state.checkpoint.lastCompletedOperationId,
): SetupCheckpoint {
  return setupCentre_decodeCheckpoint({
    ...state.checkpoint,
    lastCompletedOperationId: completedOperationId,
    progress: {
      ...state.checkpoint.progress,
      steps: state.checkpoint.progress.steps.map((entry) =>
        entry.step === step ? { ...entry, state: nextState } : entry,
      ),
    },
  });
}

/**
 * Accept only the result for the current owner and generation.
 *
 * A cancellation intent blocks late results until a matching receipt says that
 * work stopped. Nothing is replayed after an unknown outcome.
 */
export function setupDomain_acceptResult(
  state: SetupDomainState,
  resultValue: unknown,
): SetupDomainState {
  setupDomain_assertState(state);
  const result = setupCentre_decodeOperationResult(resultValue);
  if (
    state.checkpoint.retiredOperations.some(
      (operation) => operation.operationId === result.operationId,
    )
  ) {
    throw new TypeError("late result from a retired operation is rejected.");
  }
  if (!state.activeOperation) throw new TypeError("there is no active setup operation.");
  if (state.cancellationIntent) {
    throw new TypeError("late results cannot replace a pending cancellation receipt.");
  }
  if (state.lastCancellationReceipt?.operationId === state.activeOperation.request.operationId) {
    throw new TypeError("a cancellation receipt prevents late result settlement.");
  }
  if (state.requiresInspection && state.activeOperation.request.mode !== "inspect") {
    throw new TypeError("inspection is required before settling another operation result.");
  }
  if (!setupDomain_sameOperation(state.activeOperation, result)) {
    throw new TypeError("operation result is stale or belongs to another resource.");
  }
  if (result.fact.observedAt < state.activeOperation.openedAt) {
    throw new TypeError("operation result predates its logical owner.");
  }
  const facts = setupDomain_replaceFact(state, result.fact);
  const checkpoint =
    result.fact.state === "verified"
      ? setupDomain_setProgress(state, result.step, "complete", result.operationId)
      : state.checkpoint;
  const inspectionCompletedSteps =
    state.requiresInspection &&
    state.activeOperation.request.mode === "inspect" &&
    result.fact.state !== "unknown"
      ? [...state.inspectionCompletedSteps, result.step]
      : state.inspectionCompletedSteps;
  const inspectionRemaining =
    state.requiresInspection &&
    setupDomain_routeFor(state).steps.some((routeStep) =>
      routeStep.requirement !== "optional" ||
      state.checkpoint.progress.steps.find((step) => step.step === routeStep.step)?.state !==
        "skipped"
        ? !inspectionCompletedSteps.includes(routeStep.step)
        : false,
    );
  return {
    ...state,
    checkpoint,
    facts,
    activeOperation: null,
    inspectionCompletedSteps,
    requiresInspection: result.fact.state === "unknown" || inspectionRemaining,
  };
}

/** Record cancellation intent only; ownership remains until receipt arrives. */
export function setupDomain_requestCancellation(
  state: SetupDomainState,
  requestValue: unknown,
  requestedAt: number,
): SetupRequestCancellationResult {
  setupDomain_assertState(state);
  if (!state.activeOperation) throw new TypeError("there is no active setup operation.");
  if (state.cancellationIntent) throw new TypeError("cancellation is already pending.");
  const request = setupCentre_decodeCancellationRequest(requestValue);
  if (
    !setupDomain_sameOperation(state.activeOperation, {
      operationId: request.operationId,
      routeId: state.activeOperation.request.routeId,
      step: state.activeOperation.request.step,
      resourceKey: state.activeOperation.request.resourceKey,
      generation: request.generation,
      configRevision: request.configRevision,
    })
  ) {
    throw new TypeError("cancellation request is stale or belongs to another operation.");
  }
  const intent = setupCentre_decodeCancellationIntent({
    kind: "cancellation-intent",
    request,
    requestedAt,
  });
  return {
    intent,
    state: { ...state, cancellationIntent: intent },
  };
}

/**
 * Apply a confirmed cancellation receipt. Failed/unknown cancellation retains
 * the owner for inspection. A completed-before-cancel race releases ownership
 * even when effects are partial or unknown, then requires explicit inspection.
 * An intent is never presented as a stopped result.
 */
export function setupDomain_applyCancellationReceipt(
  state: SetupDomainState,
  receiptValue: unknown,
): SetupCancellationApplicationResult {
  setupDomain_assertState(state);
  if (!state.activeOperation || !state.cancellationIntent) {
    throw new TypeError("cancellation receipt requires the matching intent and owner.");
  }
  const receipt = setupCentre_decodeCancellationReceipt(receiptValue);
  const intent = state.cancellationIntent.request;
  if (
    receipt.cancellationId !== intent.cancellationId ||
    receipt.operationId !== intent.operationId ||
    receipt.generation !== intent.generation ||
    receipt.configRevision !== intent.configRevision ||
    receipt.observedAt < state.cancellationIntent.requestedAt
  ) {
    throw new TypeError("cancellation receipt does not match its pending intent.");
  }
  if (
    !setupDomain_sameOperation(state.activeOperation, {
      operationId: receipt.operationId,
      routeId: state.activeOperation.request.routeId,
      step: state.activeOperation.request.step,
      resourceKey: state.activeOperation.request.resourceKey,
      generation: receipt.generation,
      configRevision: receipt.configRevision,
    })
  ) {
    throw new TypeError("cancellation receipt belongs to a stale resource owner.");
  }
  const completedBeforeCancel = receipt.outcome === "completed-before-cancel";
  const release =
    completedBeforeCancel ||
    ((receipt.outcome === "never-started" || receipt.outcome === "stopped") &&
      receipt.effects === "none");
  const inspectionRequired = !release || completedBeforeCancel;
  const retiredOperation = release
    ? setupCentre_decodeRetiredOperation({
        operationId: receipt.operationId,
        operationSequence: state.activeOperation.operationSequence,
        generation: receipt.generation,
        retiredAt: receipt.observedAt,
        outcome: receipt.outcome,
        cancellationId: receipt.cancellationId,
        effects: receipt.effects,
      })
    : null;
  let checkpoint = state.checkpoint;
  if (retiredOperation) {
    if (checkpoint.retiredOperations.length >= setupCentre_maxRetiredOperations) {
      throw new TypeError("retired operation history is full.");
    }
    if (
      checkpoint.retiredOperations.some(
        (operation) => operation.operationId === retiredOperation.operationId,
      )
    ) {
      throw new TypeError("operationId is already retired.");
    }
    checkpoint = setupCentre_decodeCheckpoint({
      ...checkpoint,
      retiredOperations: [...checkpoint.retiredOperations, retiredOperation],
    });
  }
  return {
    received: receipt,
    retiredOperation,
    ownershipReleased: release,
    requiresInspection: inspectionRequired,
    state: {
      ...state,
      checkpoint,
      activeOperation: release ? null : state.activeOperation,
      cancellationIntent: null,
      lastCancellationReceipt: receipt,
      requiresInspection: state.requiresInspection || inspectionRequired,
    },
  };
}

/**
 * Advance the configuration revision and invalidate dependent observations.
 *
 * Outstanding operation lease/result generations become unusable immediately.
 */
export function setupDomain_changeConfiguration(
  state: SetupDomainState,
  nextConfigRevision: number,
): SetupConfigurationChangeResult {
  setupDomain_assertState(state);
  if (
    !Number.isSafeInteger(nextConfigRevision) ||
    nextConfigRevision <= state.checkpoint.configRevision
  ) {
    throw new TypeError("nextConfigRevision must advance the current revision.");
  }
  const invalidated: readonly SetupStepId[] = setupDomain_configurationInvalidatedSteps.filter(
    (step) => state.checkpoint.progress.steps.some((entry) => entry.step === step),
  );
  const route = setupDomain_routeFor(state);
  const generation = state.checkpoint.generation + 1;
  const checkpoint = setupCentre_decodeCheckpoint({
    ...state.checkpoint,
    generation,
    configRevision: nextConfigRevision,
    progress: {
      ...state.checkpoint.progress,
      generation,
      configRevision: nextConfigRevision,
      steps: state.checkpoint.progress.steps.map((entry) =>
        invalidated.includes(entry.step) ? { ...entry, state: "pending" } : entry,
      ),
    },
  });
  const facts = setupCentre_decodeComponentFacts({
    ...state.facts,
    generation,
    configRevision: nextConfigRevision,
    facts: state.facts.facts.filter((fact) => !invalidated.includes(fact.dimension)),
  });
  return {
    invalidatedSteps: invalidated,
    automaticActions: [],
    state: {
      checkpoint,
      facts,
      activeOperation: null,
      cancellationIntent: null,
      lastCancellationReceipt: null,
      inspectionCompletedSteps: route.steps
        .map((step) => step.step)
        .filter((step) => !invalidated.includes(step)),
      requiresInspection: true,
    },
  };
}

/** Strip transient owner, cancellation, and result state from a checkpoint. */
export function setupDomain_exportCheckpoint(state: SetupDomainState): SetupCheckpoint {
  setupDomain_assertState(state);
  return setupCentre_decodeCheckpoint(state.checkpoint);
}

/** Decode a synthetic checkpoint after an explicit save/restore boundary. */
export function setupDomain_roundTripCheckpoint(value: unknown): SetupCheckpoint {
  return setupCentre_decodeCheckpoint(value);
}

/**
 * Restore historical progress without restoring ownership or trusting any
 * pre-restart observation. The separately supplied persistence-owner anchor
 * must exactly match the structural checkpoint. The pure domain does not claim
 * to authenticate the anchor source; that authority belongs to persistence.
 */
export function setupDomain_reconcileRestart(
  checkpointValue: unknown,
  observationValue: unknown,
  anchorValue: unknown,
): SetupRestartReconciliationResult {
  const checkpoint = setupCentre_decodeCheckpoint(checkpointValue);
  const anchor = setupCentre_decodeCheckpointAnchor(anchorValue);
  if (JSON.stringify(checkpoint) !== JSON.stringify(anchor.checkpoint)) {
    throw new TypeError("checkpoint does not match its persistence-owner anchor.");
  }
  const observation: SetupRestartObservation =
    setupCentre_decodeRestartObservation(observationValue);
  const route = setupCentre_getRoute(checkpoint.routeId);
  const configChanged = observation.configRevision !== checkpoint.configRevision;
  const invalidated: readonly SetupStepId[] = configChanged
    ? setupDomain_configurationInvalidatedSteps
    : [];
  const generation = checkpoint.generation + 1;
  const nextCheckpoint = setupCentre_decodeCheckpoint({
    ...checkpoint,
    generation,
    configRevision: observation.configRevision,
    progress: {
      ...checkpoint.progress,
      generation,
      configRevision: observation.configRevision,
      steps: checkpoint.progress.steps.map((entry) =>
        invalidated.includes(entry.step) ? { ...entry, state: "pending" } : entry,
      ),
    },
  });
  const state: SetupDomainState = {
    checkpoint: nextCheckpoint,
    facts: setupDomain_emptyFacts(route, generation, observation.configRevision),
    activeOperation: null,
    cancellationIntent: null,
    lastCancellationReceipt: null,
    inspectionCompletedSteps: [],
    requiresInspection: true,
  };
  setupDomain_assertState(state);
  return {
    state,
    preservedCompletedSteps: nextCheckpoint.progress.steps
      .filter((step) => step.state === "complete")
      .map((step) => step.step),
    preservedSkippedSteps: nextCheckpoint.progress.steps
      .filter((step) => step.state === "skipped")
      .map((step) => step.step),
    preRestartResultsAccepted: false,
    anchorMatched: true,
    requiresInspection: true,
    automaticActions: [],
  };
}

function setupPersistence_sameIdentity(
  left: SetupPersistenceIdentity,
  right: SetupPersistenceIdentity,
): boolean {
  return (
    left.generation === right.generation &&
    left.configRevision === right.configRevision &&
    left.operationSequence === right.operationSequence &&
    left.operationId === right.operationId &&
    left.step === right.step &&
    left.resourceKey.componentId === right.resourceKey.componentId &&
    left.resourceKey.resource === right.resourceKey.resource &&
    left.resourceKey.scopeId === right.resourceKey.scopeId
  );
}

function setupPersistence_identityMatchesCheckpoint(
  identity: SetupPersistenceIdentity,
  checkpoint: SetupCheckpoint,
): boolean {
  return (
    identity.generation === checkpoint.generation &&
    identity.configRevision === checkpoint.configRevision &&
    identity.operationSequence === checkpoint.operationSequence &&
    identity.resourceKey.componentId === checkpoint.componentId &&
    setupCentre_getRoute(checkpoint.routeId).steps.some((step) => step.step === identity.step)
  );
}

function setupPersistence_sameProgress(left: SetupCheckpoint, right: SetupCheckpoint): boolean {
  return JSON.stringify(left.progress.steps) === JSON.stringify(right.progress.steps);
}

function setupPersistence_sameRetiredHistory(
  left: SetupCheckpoint,
  right: SetupCheckpoint,
): boolean {
  return JSON.stringify(left.retiredOperations) === JSON.stringify(right.retiredOperations);
}

function setupPersistence_sameCheckpoint(leftValue: unknown, rightValue: unknown): boolean {
  return JSON.stringify(leftValue) === JSON.stringify(rightValue);
}

function setupPersistence_assertCheckpointIdentity(
  previous: SetupCheckpoint,
  next: SetupCheckpoint,
): void {
  if (
    previous.schemaVersion !== next.schemaVersion ||
    previous.routeId !== next.routeId ||
    previous.componentId !== next.componentId
  ) {
    throw new TypeError("transition cannot change checkpoint route, component, or schema.");
  }
}

function setupPersistence_result(
  current: SetupPersistenceAuthorityState,
  request: SetupPersistenceTransitionRequest,
  cursor: SetupPersistenceCursor,
  options: {
    readonly idempotent?: boolean;
    readonly commitRequired?: boolean;
    readonly clearsOwnership?: boolean;
    readonly requiresInspection?: boolean;
  } = {},
): SetupPersistenceTransitionResult {
  const commitRequired = options.commitRequired ?? true;
  return {
    decision: options.idempotent ? "idempotent" : "accepted",
    transition: request.kind,
    cursor,
    authorityRevision: current.authorityRevision + (commitRequired ? 1 : 0),
    commitRequired,
    clearsOwnership: options.clearsOwnership ?? false,
    requiresInspection: options.requiresInspection ?? false,
    automaticActions: [],
  };
}

function setupPersistence_verifiedSettlementAllowed(
  previous: SetupCheckpoint,
  next: SetupCheckpoint,
  identity: SetupPersistenceIdentity,
): boolean {
  if (
    previous.generation !== next.generation ||
    previous.configRevision !== next.configRevision ||
    previous.operationSequence !== next.operationSequence ||
    !setupPersistence_sameRetiredHistory(previous, next) ||
    (next.lastCompletedOperationId !== previous.lastCompletedOperationId &&
      next.lastCompletedOperationId !== identity.operationId)
  ) {
    return false;
  }
  const route = setupCentre_getRoute(previous.routeId);
  const index = route.steps.findIndex((step) => step.step === identity.step);
  if (index < 0) return false;
  const previousStep = previous.progress.steps[index];
  const nextStep = next.progress.steps[index];
  if (!previousStep || !nextStep || nextStep.state !== "complete") return false;
  if (
    previous.progress.steps.some(
      (step, candidateIndex) =>
        candidateIndex !== index && step.state !== next.progress.steps[candidateIndex]?.state,
    )
  ) {
    return false;
  }
  if (previousStep.state !== "complete" && next.lastCompletedOperationId !== identity.operationId) {
    return false;
  }
  return true;
}

function setupPersistence_validateAdmission(
  current: SetupPersistenceAuthorityState,
  request: Extract<SetupPersistenceTransitionRequest, { kind: "admit" }>,
  previous: SetupCheckpoint,
  next: SetupCheckpoint,
): SetupPersistenceTransitionResult {
  if (current.cursor.kind === "admitted") {
    throw new TypeError("admission is forbidden while another operation is admitted.");
  }
  setupPersistence_assertCheckpointIdentity(previous, next);
  if (
    next.retiredOperations.some(
      (operation) => operation.operationId === request.identity.operationId,
    )
  ) {
    throw new TypeError("admission cannot reuse a retired operation identity.");
  }
  if (previous.lastCompletedOperationId === request.identity.operationId) {
    throw new TypeError("admission cannot reuse the last completed operation identity.");
  }
  if (
    !setupPersistence_identityMatchesCheckpoint(request.identity, next) ||
    request.identity.operationSequence !== previous.operationSequence + 1 ||
    previous.generation !== next.generation ||
    previous.configRevision !== next.configRevision ||
    previous.lastCompletedOperationId !== next.lastCompletedOperationId ||
    !setupPersistence_sameProgress(previous, next) ||
    !setupPersistence_sameRetiredHistory(previous, next)
  ) {
    throw new TypeError("admission changes forbidden checkpoint identity or history.");
  }
  return setupPersistence_result(current, request, {
    kind: "admitted",
    identity: request.identity,
  });
}

function setupPersistence_validateSettlement(
  current: SetupPersistenceAuthorityState,
  request: Extract<SetupPersistenceTransitionRequest, { kind: "settle" }>,
  previous: SetupCheckpoint,
  next: SetupCheckpoint,
): SetupPersistenceTransitionResult {
  if (current.cursor.kind === "settled") {
    if (
      setupPersistence_sameIdentity(current.cursor.identity, request.identity) &&
      current.cursor.outcome === request.outcome &&
      setupPersistence_sameCheckpoint(previous, next)
    ) {
      return setupPersistence_result(current, request, current.cursor, {
        idempotent: true,
        commitRequired: false,
        clearsOwnership: true,
      });
    }
    throw new TypeError("a different terminal settlement conflicts with the settled cursor.");
  }
  if (current.cursor.kind !== "admitted") {
    throw new TypeError("settlement requires an admitted operation.");
  }
  if (!setupPersistence_sameIdentity(current.cursor.identity, request.identity)) {
    throw new TypeError("settlement identity does not match the admitted operation.");
  }
  if (
    previous.retiredOperations.some(
      (operation) => operation.operationId === request.identity.operationId,
    )
  ) {
    throw new TypeError("a retired operation cannot settle again.");
  }
  setupPersistence_assertCheckpointIdentity(previous, next);
  if (
    !setupPersistence_identityMatchesCheckpoint(request.identity, previous) ||
    !setupPersistence_identityMatchesCheckpoint(request.identity, next)
  ) {
    throw new TypeError("settlement identity does not match checkpoint identity.");
  }
  if (
    request.outcome === "unverified"
      ? !setupPersistence_sameCheckpoint(previous, next)
      : !setupPersistence_verifiedSettlementAllowed(previous, next, request.identity)
  ) {
    throw new TypeError("settlement checkpoint changes are not allowed for the explicit outcome.");
  }
  return setupPersistence_result(
    current,
    request,
    { kind: "settled", identity: request.identity, outcome: request.outcome },
    { clearsOwnership: true },
  );
}

function setupPersistence_validateRetirement(
  current: SetupPersistenceAuthorityState,
  request: Extract<SetupPersistenceTransitionRequest, { kind: "retire" }>,
  previous: SetupCheckpoint,
  next: SetupCheckpoint,
): SetupPersistenceTransitionResult {
  if (current.cursor.kind === "retired") {
    const retired = previous.retiredOperations.find(
      (operation) => operation.operationId === request.identity.operationId,
    );
    if (
      setupPersistence_sameIdentity(current.cursor.identity, request.identity) &&
      retired &&
      retired.operationSequence === request.identity.operationSequence &&
      retired.generation === request.identity.generation &&
      retired.retiredAt === request.retiredAt &&
      retired.outcome === request.cancellationOutcome &&
      retired.cancellationId === request.cancellationId &&
      retired.effects === request.effects &&
      current.cursor.cancellationId === request.cancellationId &&
      current.cursor.cancellationOutcome === request.cancellationOutcome &&
      current.cursor.effects === request.effects &&
      setupPersistence_sameCheckpoint(previous, next)
    ) {
      return setupPersistence_result(current, request, current.cursor, {
        idempotent: true,
        commitRequired: false,
        clearsOwnership: true,
      });
    }
    throw new TypeError("a different terminal retirement conflicts with the retired cursor.");
  }
  if (current.cursor.kind === "settled") {
    throw new TypeError("retirement conflicts with the settled terminal cursor.");
  }
  if (current.cursor.kind !== "admitted") {
    throw new TypeError("retirement requires an admitted operation.");
  }
  if (!setupPersistence_sameIdentity(current.cursor.identity, request.identity)) {
    throw new TypeError("retirement identity does not match the admitted operation.");
  }
  if (
    previous.retiredOperations.some(
      (operation) => operation.operationId === request.identity.operationId,
    )
  ) {
    throw new TypeError("operation retirement was already recorded.");
  }
  setupPersistence_assertCheckpointIdentity(previous, next);
  if (
    !setupPersistence_identityMatchesCheckpoint(request.identity, previous) ||
    !setupPersistence_identityMatchesCheckpoint(request.identity, next) ||
    previous.generation !== next.generation ||
    previous.configRevision !== next.configRevision ||
    previous.operationSequence !== next.operationSequence ||
    previous.lastCompletedOperationId !== next.lastCompletedOperationId ||
    !setupPersistence_sameProgress(previous, next) ||
    next.retiredOperations.length !== previous.retiredOperations.length + 1 ||
    next.retiredOperations.length > setupCentre_maxRetiredOperations ||
    !previous.retiredOperations.every(
      (operation, index) =>
        JSON.stringify(operation) === JSON.stringify(next.retiredOperations[index]),
    )
  ) {
    throw new TypeError("retirement changes forbidden checkpoint identity or history.");
  }
  const retired = next.retiredOperations.at(-1);
  if (
    !retired ||
    retired.operationId !== request.identity.operationId ||
    retired.operationSequence !== request.identity.operationSequence ||
    retired.generation !== request.identity.generation ||
    retired.retiredAt !== request.retiredAt ||
    retired.outcome !== request.cancellationOutcome ||
    retired.cancellationId !== request.cancellationId ||
    retired.effects !== request.effects
  ) {
    throw new TypeError("retirement receipt does not match the appended checkpoint history.");
  }
  return setupPersistence_result(
    current,
    request,
    {
      kind: "retired",
      identity: request.identity,
      outcome: "releasing-cancellation",
      cancellationId: request.cancellationId,
      cancellationOutcome: request.cancellationOutcome,
      effects: request.effects,
    },
    { clearsOwnership: true },
  );
}

function setupPersistence_validateNonReleasingCancellation(
  current: SetupPersistenceAuthorityState,
  request: Extract<SetupPersistenceTransitionRequest, { kind: "cancel-nonreleasing" }>,
  previous: SetupCheckpoint,
  next: SetupCheckpoint,
): SetupPersistenceTransitionResult {
  if (current.cursor.kind !== "admitted") {
    throw new TypeError("non-releasing cancellation requires an admitted operation.");
  }
  if (
    !setupPersistence_sameIdentity(current.cursor.identity, request.identity) ||
    previous.retiredOperations.some(
      (operation) => operation.operationId === request.identity.operationId,
    ) ||
    !setupPersistence_sameCheckpoint(previous, next)
  ) {
    throw new TypeError("non-releasing cancellation cannot change identity or checkpoint.");
  }
  return setupPersistence_result(current, request, current.cursor, {
    commitRequired: false,
    requiresInspection: true,
  });
}

function setupPersistence_progressAfterExplicitBoundary(
  previous: SetupCheckpoint,
  next: SetupCheckpoint,
  configChanged: boolean,
): boolean {
  return previous.progress.steps.every((step, index) => {
    const nextStep = next.progress.steps[index];
    if (!nextStep || step.step !== nextStep.step) return false;
    if (configChanged && (step.step === "catalogue" || step.step === "probe")) {
      return nextStep.state === "pending";
    }
    return nextStep.state === step.state;
  });
}

function setupPersistence_validateExplicitBoundary(
  current: SetupPersistenceAuthorityState,
  request: Extract<SetupPersistenceTransitionRequest, { kind: "restart" | "configure" }>,
  previous: SetupCheckpoint,
  next: SetupCheckpoint,
): SetupPersistenceTransitionResult {
  setupPersistence_assertCheckpointIdentity(previous, next);
  const configChanged = request.configRevision !== previous.configRevision;
  if (
    (request.kind === "configure" && request.configRevision <= previous.configRevision) ||
    next.generation !== previous.generation + 1 ||
    next.configRevision !== request.configRevision ||
    next.operationSequence !== previous.operationSequence ||
    next.lastCompletedOperationId !== previous.lastCompletedOperationId ||
    !setupPersistence_sameRetiredHistory(previous, next) ||
    !setupPersistence_progressAfterExplicitBoundary(previous, next, configChanged)
  ) {
    throw new TypeError("explicit boundary transition has invalid checkpoint changes.");
  }
  return setupPersistence_result(
    current,
    request,
    { kind: "idle" },
    {
      clearsOwnership: true,
      requiresInspection: true,
    },
  );
}

/**
 * Exhaustive pure validator for the future authenticated persistence owner.
 *
 * The current authority state is trusted provenance supplied by that owner. This
 * function validates the explicit transition against the two bounded checkpoints
 * and never infers operation identity from checkpoint bookkeeping.
 */
export function setupDomain_validatePersistenceTransition(
  currentValue: unknown,
  requestValue: unknown,
  previousCheckpointValue: unknown,
  nextCheckpointValue: unknown,
): SetupPersistenceTransitionResult {
  const current = setupPersistence_decodeAuthorityState(currentValue);
  const request = setupPersistence_decodeTransitionRequest(requestValue);
  const previous = setupCentre_decodeCheckpoint(previousCheckpointValue);
  const next = setupCentre_decodeCheckpoint(nextCheckpointValue);
  if (request.expectedAuthorityRevision !== current.authorityRevision) {
    throw new TypeError("expectedAuthorityRevision is stale.");
  }
  if (
    current.cursor.kind !== "idle" &&
    !setupPersistence_identityMatchesCheckpoint(current.cursor.identity, previous)
  ) {
    throw new TypeError("authenticated cursor identity does not match the checkpoint.");
  }
  switch (request.kind) {
    case "admit":
      return setupPersistence_validateAdmission(current, request, previous, next);
    case "settle":
      return setupPersistence_validateSettlement(current, request, previous, next);
    case "retire":
      return setupPersistence_validateRetirement(current, request, previous, next);
    case "cancel-nonreleasing":
      return setupPersistence_validateNonReleasingCancellation(current, request, previous, next);
    case "restart":
    case "configure":
      return setupPersistence_validateExplicitBoundary(current, request, previous, next);
  }
}

/** Decode a projected status at the renderer boundary without widening its shape. */
export function setupDomain_decodeStatus(value: unknown): SetupStatusProjection {
  return setupCentre_decodeStatusProjection(value);
}

/** The route's closed, ordered step identities. */
export function setupDomain_routeSteps(routeValue: SetupRouteId): readonly SetupStepId[] {
  return setupCentre_getRoute(routeValue).steps.map((step) => step.step);
}

/** The evidence dimensions are fixed, closed, and independently decodable. */
export function setupDomain_evidenceDimensions(): readonly SetupStepId[] {
  return [...setupCentre_stepIds];
}
