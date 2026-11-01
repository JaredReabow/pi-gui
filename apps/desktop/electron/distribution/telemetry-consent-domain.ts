/**
 * Pure telemetry consent domain.
 *
 * This reducer owns intent, provenance projection, current-owner facts,
 * stale-result arbitration, and copy-safe status. It does not read a clock,
 * storage, network, identity, or application content and performs no I/O.
 */

import {
  telemetryConsent_decodeCheckpoint,
  telemetryConsent_decodeChoices,
  telemetryConsent_decodeEngineStatus,
  telemetryConsent_decodePending,
  telemetryConsent_decodePersistenceResult,
  telemetryConsent_decodeRequest,
  telemetryConsent_decodeStatus,
  telemetryConsent_schemaVersion,
  type TelemetryConsentCheckpoint,
  type TelemetryConsentChoice,
  type TelemetryConsentChoices,
  type TelemetryConsentDeliverySnapshot,
  type TelemetryConsentEngineSnapshot,
  type TelemetryConsentEngineStatusInput,
  type TelemetryConsentOutcomeCode,
  type TelemetryConsentPending,
  type TelemetryConsentRequest,
  type TelemetryConsentStatusSnapshot,
} from "../../contracts/telemetry-consent";

export type TelemetryConsentDomainState = TelemetryConsentStatusSnapshot;

function telemetryConsentDomain_undecidedChoice(): TelemetryConsentChoice {
  return {
    value: "undecided",
    source: "absent",
    disclosureVersion: null,
  };
}

function telemetryConsentDomain_undecidedChoices(): TelemetryConsentChoices {
  return {
    usage: telemetryConsentDomain_undecidedChoice(),
    crash: telemetryConsentDomain_undecidedChoice(),
  };
}

function telemetryConsentDomain_requestedChoice(
  value: "allowed" | "denied",
  disclosureVersion: number,
): TelemetryConsentChoice {
  return {
    value,
    source: "user",
    disclosureVersion,
  };
}

function telemetryConsentDomain_choicesFromRequest(
  request: TelemetryConsentRequest,
): TelemetryConsentChoices {
  return {
    usage: telemetryConsentDomain_requestedChoice(request.usage, request.disclosureVersion),
    crash: telemetryConsentDomain_requestedChoice(request.crash, request.disclosureVersion),
  };
}

function telemetryConsentDomain_engineSnapshot(
  value: TelemetryConsentEngineStatusInput,
): TelemetryConsentEngineSnapshot {
  return {
    configurationValid: value.configurationValid,
    operationalEnabled: value.operationalEnabled,
    disclosureVersion: value.disclosureVersion,
    identityPresent: value.identityPresent,
    queue: { ...value.queue },
    suspended: value.suspended,
    revocationPending: value.revocationPending,
    ownerConsent: { ...value.ownerConsent },
    withdrawalPending: value.pendingWithdrawal
      ? { ...value.pendingWithdrawal }
      : { usage: false, crash: false },
    inFlight: value.inFlight,
  };
}

function telemetryConsentDomain_delivery(
  value: TelemetryConsentEngineStatusInput,
): TelemetryConsentDeliverySnapshot {
  let state: TelemetryConsentDeliverySnapshot["state"] = "idle";
  if (value.inFlight) {
    state = "in-flight";
  } else if (value.suspended) {
    state = "suspended";
  } else if (value.lastOutcome === "success") {
    state = "endpoint-accepted";
  } else if (
    value.queue.total > 0 ||
    (value.lastOutcome !== null &&
      [
        "rejected",
        "rate-limited",
        "transient",
        "timeout",
        "transport",
        "unexpected-status",
      ].includes(value.lastOutcome))
  ) {
    state = "retained";
  } else if (value.lastOutcome === "cancelled") {
    state = "cancelled";
  }
  return { state, receipt: "not-observed" };
}

function telemetryConsentDomain_withdrawalPending(
  engine: TelemetryConsentEngineStatusInput,
  category: "usage" | "crash",
): boolean {
  return engine.pendingWithdrawal?.[category] === true;
}

function telemetryConsentDomain_choiceOwnerAligned(
  choice: TelemetryConsentChoice,
  engine: TelemetryConsentEngineStatusInput,
  category: "usage" | "crash",
): boolean {
  return (
    !telemetryConsentDomain_withdrawalPending(engine, category) &&
    (choice.value === "allowed"
      ? engine.ownerConsent[category]
      : choice.value === "denied" || choice.value === "undecided"
        ? !engine.ownerConsent[category]
        : false)
  );
}

function telemetryConsentDomain_disclosureMatches(
  choice: TelemetryConsentChoice,
  engine: TelemetryConsentEngineStatusInput,
): boolean {
  return (
    choice.value === "undecided" ||
    (choice.source === "user" &&
      engine.disclosureVersion !== null &&
      choice.disclosureVersion === engine.disclosureVersion)
  );
}

function telemetryConsentDomain_engineSatisfiesChoices(
  choices: TelemetryConsentChoices,
  engine: TelemetryConsentEngineStatusInput,
): boolean {
  return (
    engine.configurationValid &&
    engine.disclosureVersion !== null &&
    !engine.revocationPending &&
    telemetryConsentDomain_choiceOwnerAligned(choices.usage, engine, "usage") &&
    telemetryConsentDomain_choiceOwnerAligned(choices.crash, engine, "crash") &&
    telemetryConsentDomain_disclosureMatches(choices.usage, engine) &&
    telemetryConsentDomain_disclosureMatches(choices.crash, engine)
  );
}

function telemetryConsentDomain_choicePendingMutation(
  pending: TelemetryConsentPending | null,
  durable: TelemetryConsentChoice,
  category: "usage" | "crash",
): boolean {
  return pending !== null && JSON.stringify(pending.desired[category]) !== JSON.stringify(durable);
}

function telemetryConsentDomain_choiceReconciliationRequired(
  desired: TelemetryConsentChoices,
  durable: TelemetryConsentChoices,
  engine: TelemetryConsentEngineStatusInput,
  pending: TelemetryConsentPending | null,
  category: "usage" | "crash",
): boolean {
  const desiredChoice = desired[category];
  const durableChoice = durable[category];
  if (engine.pendingWithdrawal?.[category]) return true;
  if (!telemetryConsentDomain_choicePendingMutation(pending, durableChoice, category)) {
    if (!telemetryConsentDomain_choiceOwnerAligned(desiredChoice, engine, category)) {
      return true;
    }
  }
  return (
    !engine.configurationValid ||
    (engine.disclosureVersion === null &&
      (desiredChoice.value !== "undecided" || durableChoice.value !== "undecided")) ||
    !telemetryConsentDomain_disclosureMatches(desiredChoice, engine) ||
    !telemetryConsentDomain_disclosureMatches(durableChoice, engine)
  );
}

function telemetryConsentDomain_reconciliationRequired(
  desired: TelemetryConsentChoices,
  durable: TelemetryConsentChoices,
  engine: TelemetryConsentEngineStatusInput,
  pending: TelemetryConsentPending | null,
): boolean {
  return (
    telemetryConsentDomain_choiceReconciliationRequired(
      desired,
      durable,
      engine,
      pending,
      "usage",
    ) ||
    telemetryConsentDomain_choiceReconciliationRequired(desired, durable, engine, pending, "crash")
  );
}

function telemetryConsentDomain_choiceEffective(
  desired: TelemetryConsentChoice,
  durable: TelemetryConsentChoice,
  pending: TelemetryConsentPending | null,
  engine: TelemetryConsentEngineStatusInput,
  requiresRestartInspection: boolean,
  requiresReconciliation: boolean,
  category: "usage" | "crash",
): TelemetryConsentChoice {
  if (desired.value === "denied" && desired.source === "user") {
    return desired;
  }
  if (
    requiresRestartInspection ||
    requiresReconciliation ||
    telemetryConsentDomain_choicePendingMutation(pending, durable, category)
  ) {
    return telemetryConsentDomain_undecidedChoice();
  }
  if (
    desired.value === "allowed" &&
    desired.source === "user" &&
    durable.value === "allowed" &&
    durable.source === "user" &&
    engine.configurationValid &&
    engine.disclosureVersion !== null &&
    desired.disclosureVersion === engine.disclosureVersion &&
    durable.disclosureVersion === engine.disclosureVersion &&
    !telemetryConsentDomain_withdrawalPending(engine, category) &&
    engine.ownerConsent[category]
  ) {
    return durable;
  }
  return telemetryConsentDomain_undecidedChoice();
}

function telemetryConsentDomain_effective(
  desired: TelemetryConsentChoices,
  durable: TelemetryConsentChoices,
  pending: TelemetryConsentPending | null,
  engine: TelemetryConsentEngineStatusInput,
  requiresRestartInspection: boolean,
  _requiresReconciliation: boolean,
): TelemetryConsentChoices {
  return {
    usage: telemetryConsentDomain_choiceEffective(
      desired.usage,
      durable.usage,
      pending,
      engine,
      requiresRestartInspection,
      telemetryConsentDomain_choiceReconciliationRequired(
        desired,
        durable,
        engine,
        pending,
        "usage",
      ),
      "usage",
    ),
    crash: telemetryConsentDomain_choiceEffective(
      desired.crash,
      durable.crash,
      pending,
      engine,
      requiresRestartInspection,
      telemetryConsentDomain_choiceReconciliationRequired(
        desired,
        durable,
        engine,
        pending,
        "crash",
      ),
      "crash",
    ),
  };
}

function telemetryConsentDomain_status(
  input: Readonly<{
    latestRequestRevision: number;
    desired: TelemetryConsentChoices;
    durable: TelemetryConsentChoices;
    pending: TelemetryConsentPending | null;
    engine: TelemetryConsentEngineStatusInput;
    outcome: TelemetryConsentOutcomeCode;
    requiresRestartInspection: boolean;
    requiresReconciliation: boolean;
  }>,
): TelemetryConsentDomainState {
  const snapshot = {
    schemaVersion: telemetryConsent_schemaVersion,
    latestRequestRevision: input.latestRequestRevision,
    desired: input.desired,
    durable: input.durable,
    effective: telemetryConsentDomain_effective(
      input.desired,
      input.durable,
      input.pending,
      input.engine,
      input.requiresRestartInspection,
      input.requiresReconciliation,
    ),
    pending: input.pending,
    engine: telemetryConsentDomain_engineSnapshot(input.engine),
    delivery: telemetryConsentDomain_delivery(input.engine),
    outcome: input.outcome,
    requiresRestartInspection: input.requiresRestartInspection,
    requiresReconciliation: input.requiresReconciliation,
  } as const;
  return telemetryConsent_decodeStatus(snapshot);
}

/** Create a closed first-run state from the current owner observation. */
export function telemetryConsentDomain_initial(engineValue: unknown): TelemetryConsentDomainState {
  const engine = telemetryConsent_decodeEngineStatus(engineValue);
  const desired = telemetryConsentDomain_undecidedChoices();
  const durable = telemetryConsentDomain_undecidedChoices();
  const requiresReconciliation = telemetryConsentDomain_reconciliationRequired(
    desired,
    durable,
    engine,
    null,
  );
  return telemetryConsentDomain_status({
    latestRequestRevision: 0,
    desired,
    durable,
    pending: null,
    engine,
    outcome: requiresReconciliation ? "reconciliation-required" : "none",
    requiresRestartInspection: false,
    requiresReconciliation,
  });
}

/**
 * Queue an explicit request. The expected revision rejects stale form
 * submissions without changing the restrictive current state.
 */
export function telemetryConsentDomain_submit(
  stateValue: unknown,
  requestValue: unknown,
): Readonly<{
  state: TelemetryConsentDomainState;
  pending: TelemetryConsentPending;
}> {
  const state = telemetryConsent_decodeStatus(stateValue);
  const request = telemetryConsent_decodeRequest(requestValue);
  if (state.requiresRestartInspection && state.pending?.state === "restart-inspection-required") {
    throw new TypeError("restart inspection must complete before a new consent request.");
  }
  if (request.expectedRequestRevision !== state.latestRequestRevision) {
    throw new TypeError("telemetry consent request is stale.");
  }
  const desired = telemetryConsentDomain_choicesFromRequest(request);
  const requestRevision = state.latestRequestRevision + 1;
  const pending: TelemetryConsentPending = {
    requestRevision,
    disclosureVersion: request.disclosureVersion,
    state: "queued",
    desired,
    outcome: "pending",
  };
  return {
    state: telemetryConsentDomain_status({
      latestRequestRevision: requestRevision,
      desired,
      durable: state.durable,
      pending,
      engine: currentEngine(state),
      outcome: "pending",
      requiresRestartInspection: false,
      requiresReconciliation: false,
    }),
    pending,
  };
}

/**
 * A stale enable result can never replace a newer withdrawal. Durable receipts
 * are accepted only when the preserved current-owner facts also match the
 * desired choices and disclosure.
 */
export function telemetryConsentDomain_recordPersistence(
  stateValue: unknown,
  resultValue: unknown,
): TelemetryConsentDomainState {
  const state = telemetryConsent_decodeStatus(stateValue);
  const result = telemetryConsent_decodePersistenceResult(resultValue);
  const engine = currentEngine(state);
  if (result.requestRevision < state.latestRequestRevision) {
    const withdrawalIntent =
      state.desired.usage.value === "denied" || state.desired.crash.value === "denied";
    return telemetryConsentDomain_status({
      latestRequestRevision: state.latestRequestRevision,
      desired: state.desired,
      durable: state.durable,
      pending: state.pending,
      engine,
      outcome: withdrawalIntent ? "withdrawal-priority" : "stale-result",
      requiresRestartInspection: state.requiresRestartInspection,
      requiresReconciliation: state.requiresReconciliation,
    });
  }
  if (result.requestRevision > state.latestRequestRevision || state.pending === null) {
    throw new TypeError("telemetry consent result does not match a pending request.");
  }
  const bothPersisted = result.engineDurable && result.provenanceDurable;
  const ownerAligned = telemetryConsentDomain_engineSatisfiesChoices(state.desired, engine);
  if (bothPersisted && ownerAligned) {
    return telemetryConsentDomain_status({
      latestRequestRevision: state.latestRequestRevision,
      desired: state.desired,
      durable: state.desired,
      pending: null,
      engine,
      outcome: "saved",
      requiresRestartInspection: false,
      requiresReconciliation: false,
    });
  }
  const reconciliation = bothPersisted && !ownerAligned;
  const pending: TelemetryConsentPending = {
    ...state.pending,
    state: reconciliation ? "reconciliation-required" : "persistence-pending",
    outcome: reconciliation ? "reconciliation-required" : "not-durable",
  };
  const requiresReconciliation =
    telemetryConsentDomain_reconciliationRequired(state.desired, state.durable, engine, pending) ||
    reconciliation;
  return telemetryConsentDomain_status({
    latestRequestRevision: state.latestRequestRevision,
    desired: state.desired,
    durable: state.durable,
    pending,
    engine,
    outcome: reconciliation ? "reconciliation-required" : "not-durable",
    requiresRestartInspection: false,
    requiresReconciliation,
  });
}

/** Replace runtime facts without substituting the UI's effective projection. */
export function telemetryConsentDomain_observe(
  stateValue: unknown,
  engineValue: unknown,
): TelemetryConsentDomainState {
  const state = telemetryConsent_decodeStatus(stateValue);
  const engine = telemetryConsent_decodeEngineStatus(engineValue);
  const requiresReconciliation = telemetryConsentDomain_reconciliationRequired(
    state.desired,
    state.durable,
    engine,
    state.pending,
  );
  const outcome = state.requiresRestartInspection
    ? "restart-inspection-required"
    : state.pending !== null
      ? state.outcome
      : requiresReconciliation
        ? "reconciliation-required"
        : state.durable.usage.value === state.desired.usage.value &&
            state.durable.crash.value === state.desired.crash.value
          ? "saved"
          : "none";
  return telemetryConsentDomain_status({
    latestRequestRevision: state.latestRequestRevision,
    desired: state.desired,
    durable: state.durable,
    pending: state.pending,
    engine,
    outcome,
    requiresRestartInspection: state.requiresRestartInspection,
    requiresReconciliation,
  });
}

/** Project only the durable-intent checkpoint; runtime observations are omitted. */
export function telemetryConsentDomain_checkpoint(stateValue: unknown): TelemetryConsentCheckpoint {
  const state = telemetryConsent_decodeStatus(stateValue);
  return telemetryConsent_decodeCheckpoint({
    schemaVersion: telemetryConsent_schemaVersion,
    latestRequestRevision: state.latestRequestRevision,
    desired: state.desired,
    durable: state.durable,
    pending: state.pending,
  });
}

/**
 * Reconcile a persisted checkpoint against the current owner. Any unresolved
 * request or owner/provenance mismatch requires fresh inspection and never
 * becomes saved through restart.
 */
export function telemetryConsentDomain_restart(
  checkpointValue: unknown,
  currentEngineValue: unknown,
): TelemetryConsentDomainState {
  const checkpoint = telemetryConsent_decodeCheckpoint(checkpointValue);
  const engine = telemetryConsent_decodeEngineStatus(currentEngineValue);
  const mismatch = telemetryConsentDomain_reconciliationRequired(
    checkpoint.desired,
    checkpoint.durable,
    engine,
    checkpoint.pending,
  );
  const pending =
    checkpoint.pending === null
      ? null
      : {
          ...checkpoint.pending,
          state: "restart-inspection-required" as const,
          outcome: "restart-inspection-required" as const,
        };
  const requiresRestartInspection = pending !== null || mismatch;
  const requiresReconciliation = mismatch;
  return telemetryConsentDomain_status({
    latestRequestRevision: checkpoint.latestRequestRevision,
    desired: checkpoint.desired,
    durable: checkpoint.durable,
    pending,
    engine,
    outcome: requiresRestartInspection ? "restart-inspection-required" : "none",
    requiresRestartInspection,
    requiresReconciliation,
  });
}

/** Resolve restart inspection without claiming a persisted mutation. */
export function telemetryConsentDomain_completeRestartInspection(
  stateValue: unknown,
  engineValue: unknown,
): TelemetryConsentDomainState {
  const state = telemetryConsent_decodeStatus(stateValue);
  if (!state.requiresRestartInspection) {
    return telemetryConsentDomain_observe(state, engineValue);
  }
  const engine = telemetryConsent_decodeEngineStatus(engineValue);
  const pending =
    state.pending?.state === "restart-inspection-required"
      ? { ...state.pending, state: "queued" as const, outcome: "pending" as const }
      : null;
  const requiresReconciliation = telemetryConsentDomain_reconciliationRequired(
    state.desired,
    state.durable,
    engine,
    pending,
  );
  return telemetryConsentDomain_status({
    latestRequestRevision: state.latestRequestRevision,
    desired: state.desired,
    durable: state.durable,
    pending,
    engine,
    outcome:
      pending !== null
        ? "pending"
        : requiresReconciliation
          ? "reconciliation-required"
          : state.durable.usage.value === state.desired.usage.value &&
              state.durable.crash.value === state.desired.crash.value
            ? "saved"
            : "none",
    requiresRestartInspection: false,
    requiresReconciliation,
  });
}

/**
 * Finish reconciliation only when the current owner matches durable intent.
 * A mismatched projection remains closed and explicit.
 */
export function telemetryConsentDomain_completeReconciliation(
  stateValue: unknown,
  engineValue: unknown,
): TelemetryConsentDomainState {
  const state = telemetryConsent_decodeStatus(stateValue);
  const engine = telemetryConsent_decodeEngineStatus(engineValue);
  const requiresReconciliation = telemetryConsentDomain_reconciliationRequired(
    state.desired,
    state.durable,
    engine,
    state.pending,
  );
  return telemetryConsentDomain_status({
    latestRequestRevision: state.latestRequestRevision,
    desired: state.desired,
    durable: state.durable,
    pending: state.pending,
    engine,
    outcome: requiresReconciliation
      ? "reconciliation-required"
      : state.pending !== null
        ? state.outcome
        : state.durable.usage.value === state.desired.usage.value &&
            state.durable.crash.value === state.desired.crash.value
          ? "saved"
          : "none",
    requiresRestartInspection: state.requiresRestartInspection,
    requiresReconciliation,
  });
}

/** Decode a request at an adapter boundary. */
export function telemetryConsentDomain_request(value: unknown): TelemetryConsentRequest {
  return telemetryConsent_decodeRequest(value);
}

/** Decode durable choices at a persistence adapter boundary. */
export function telemetryConsentDomain_choices(value: unknown): TelemetryConsentChoices {
  return telemetryConsent_decodeChoices(value);
}

function currentEngine(state: TelemetryConsentStatusSnapshot): TelemetryConsentEngineStatusInput {
  return {
    configurationValid: state.engine.configurationValid,
    operationalEnabled: state.engine.operationalEnabled,
    disclosureVersion: state.engine.disclosureVersion,
    ownerConsent: { ...state.engine.ownerConsent },
    identityPresent: state.engine.identityPresent,
    queue: { ...state.engine.queue },
    suspended: state.engine.suspended,
    revocationPending: state.engine.revocationPending,
    pendingWithdrawal:
      state.engine.withdrawalPending.usage || state.engine.withdrawalPending.crash
        ? { ...state.engine.withdrawalPending }
        : null,
    inFlight: state.engine.inFlight,
    lastOutcome:
      state.delivery.state === "endpoint-accepted"
        ? "success"
        : state.delivery.state === "retained"
          ? "transient"
          : state.delivery.state === "cancelled"
            ? "cancelled"
            : null,
  };
}

export { telemetryConsent_decodePending as telemetryConsentDomain_pending };
