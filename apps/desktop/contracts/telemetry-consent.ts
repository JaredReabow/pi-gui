/**
 * Browser-safe telemetry consent contracts.
 *
 * Decisions, durable provenance, pending work, runtime gates, and delivery
 * evidence are deliberately separate. This module contains no clocks, I/O,
 * Electron, Node, network, or consent inference from application activity.
 */

export const telemetryConsent_schemaVersion = 1 as const;

export const telemetryConsent_maxJsonDepth = 8;
export const telemetryConsent_maxJsonNodes = 256;
export const telemetryConsent_maxFields = 32;
export const telemetryConsent_maxRevision = Number.MAX_SAFE_INTEGER;
export const telemetryConsent_maxDisclosureVersion = 1_000_000;
export const telemetryConsent_maxQueueCount = 50;

export const telemetryConsent_categories = ["usage", "crash"] as const;
export type TelemetryConsentCategory = (typeof telemetryConsent_categories)[number];

export const telemetryConsent_choiceKinds = ["undecided", "allowed", "denied"] as const;
export type TelemetryConsentChoiceKind = (typeof telemetryConsent_choiceKinds)[number];

export const telemetryConsent_explicitChoiceKinds = ["allowed", "denied"] as const;
export type TelemetryConsentExplicitChoiceKind =
  (typeof telemetryConsent_explicitChoiceKinds)[number];

export const telemetryConsent_provenanceSources = ["absent", "user"] as const;
export type TelemetryConsentProvenanceSource = (typeof telemetryConsent_provenanceSources)[number];

export const telemetryConsent_pendingStates = [
  "queued",
  "dispatching",
  "persistence-pending",
  "restart-inspection-required",
  "reconciliation-required",
] as const;
export type TelemetryConsentPendingState = (typeof telemetryConsent_pendingStates)[number];

export const telemetryConsent_outcomeCodes = [
  "none",
  "pending",
  "saved",
  "not-durable",
  "stale-result",
  "withdrawal-priority",
  "restart-inspection-required",
  "reconciliation-required",
] as const;
export type TelemetryConsentOutcomeCode = (typeof telemetryConsent_outcomeCodes)[number];

export const telemetryConsent_deliveryStates = [
  "idle",
  "in-flight",
  "endpoint-accepted",
  "retained",
  "suspended",
  "cancelled",
] as const;
export type TelemetryConsentDeliveryState = (typeof telemetryConsent_deliveryStates)[number];

export const telemetryConsent_receiptStates = ["not-observed"] as const;
export type TelemetryConsentReceiptState = (typeof telemetryConsent_receiptStates)[number];

export interface TelemetryConsentChoice {
  readonly value: TelemetryConsentChoiceKind;
  readonly source: TelemetryConsentProvenanceSource;
  readonly disclosureVersion: number | null;
}

export interface TelemetryConsentChoices {
  readonly usage: TelemetryConsentChoice;
  readonly crash: TelemetryConsentChoice;
}

/**
 * A user request is always an explicit choice for both independent categories.
 * The expected revision prevents an old form submission from becoming current.
 */
export interface TelemetryConsentRequest {
  readonly schemaVersion: typeof telemetryConsent_schemaVersion;
  readonly expectedRequestRevision: number;
  readonly disclosureVersion: number;
  readonly usage: TelemetryConsentExplicitChoiceKind;
  readonly crash: TelemetryConsentExplicitChoiceKind;
}

export interface TelemetryConsentPending {
  readonly requestRevision: number;
  readonly disclosureVersion: number;
  readonly state: TelemetryConsentPendingState;
  readonly desired: TelemetryConsentChoices;
  readonly outcome: TelemetryConsentOutcomeCode;
}

/**
 * The engine observation is an internal input boundary. The public status
 * projection below omits raw queue records, identities, endpoints, and errors.
 */
export interface TelemetryConsentEngineStatusInput {
  readonly configurationValid: boolean;
  readonly operationalEnabled: boolean;
  readonly disclosureVersion: number | null;
  readonly ownerConsent: Readonly<{
    usage: boolean;
    crash: boolean;
  }>;
  readonly identityPresent: boolean;
  readonly queue: Readonly<{
    usage: number;
    crash: number;
    total: number;
  }>;
  readonly suspended: boolean;
  readonly revocationPending: boolean;
  readonly pendingWithdrawal: Readonly<{
    usage: boolean;
    crash: boolean;
  }> | null;
  readonly inFlight: boolean;
  readonly lastOutcome: string | null;
}

export interface TelemetryConsentEngineSnapshot {
  readonly configurationValid: boolean;
  readonly operationalEnabled: boolean;
  readonly disclosureVersion: number | null;
  readonly identityPresent: boolean;
  readonly queue: Readonly<{
    usage: number;
    crash: number;
    total: number;
  }>;
  readonly suspended: boolean;
  readonly revocationPending: boolean;
  readonly ownerConsent: Readonly<{
    usage: boolean;
    crash: boolean;
  }>;
  readonly withdrawalPending: Readonly<{
    usage: boolean;
    crash: boolean;
  }>;
  readonly inFlight: boolean;
}

export interface TelemetryConsentDeliverySnapshot {
  readonly state: TelemetryConsentDeliveryState;
  readonly receipt: TelemetryConsentReceiptState;
}

export interface TelemetryConsentStatusSnapshot {
  readonly schemaVersion: typeof telemetryConsent_schemaVersion;
  readonly latestRequestRevision: number;
  readonly desired: TelemetryConsentChoices;
  readonly durable: TelemetryConsentChoices;
  readonly effective: TelemetryConsentChoices;
  readonly pending: TelemetryConsentPending | null;
  readonly engine: TelemetryConsentEngineSnapshot;
  readonly delivery: TelemetryConsentDeliverySnapshot;
  readonly outcome: TelemetryConsentOutcomeCode;
  readonly requiresRestartInspection: boolean;
  readonly requiresReconciliation: boolean;
}

export interface TelemetryConsentCheckpoint {
  readonly schemaVersion: typeof telemetryConsent_schemaVersion;
  readonly latestRequestRevision: number;
  readonly desired: TelemetryConsentChoices;
  readonly durable: TelemetryConsentChoices;
  readonly pending: TelemetryConsentPending | null;
}

export interface TelemetryConsentPersistenceResult {
  readonly schemaVersion: typeof telemetryConsent_schemaVersion;
  readonly requestRevision: number;
  readonly engineDurable: boolean;
  readonly provenanceDurable: boolean;
}

function telemetryConsent_isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function telemetryConsent_hasOnlyDataKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const names = Object.getOwnPropertyNames(value);
  return (
    names.length === keys.length &&
    names.every(
      (name) =>
        keys.includes(name) &&
        Object.prototype.propertyIsEnumerable.call(value, name) &&
        "value" in (Object.getOwnPropertyDescriptor(value, name) ?? {}),
    )
  );
}

function telemetryConsent_assertJsonData(
  value: unknown,
  location = "$",
  depth = 0,
  ancestors = new WeakSet<object>(),
  counter = { nodes: 0 },
): void {
  counter.nodes += 1;
  if (counter.nodes > telemetryConsent_maxJsonNodes) {
    throw new TypeError(`${location} exceeds the node limit.`);
  }
  if (depth > telemetryConsent_maxJsonDepth) {
    throw new TypeError(`${location} exceeds the nesting limit.`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${location} must be finite JSON data.`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${location} is not JSON data.`);
  if (ancestors.has(value)) throw new TypeError(`${location} contains a cycle.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      telemetryConsent_assertJsonData(item, `${location}[${index}]`, depth + 1, ancestors, counter);
    }
  } else {
    if (!telemetryConsent_isRecord(value)) {
      throw new TypeError(`${location} must be a plain JSON object.`);
    }
    const names = Object.getOwnPropertyNames(value);
    if (names.length > telemetryConsent_maxFields) {
      throw new TypeError(`${location} exceeds the field limit.`);
    }
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${location}.${name} must be an enumerable data property.`);
      }
      telemetryConsent_assertJsonData(
        descriptor.value,
        `${location}.${name}`,
        depth + 1,
        ancestors,
        counter,
      );
    }
  }
  ancestors.delete(value);
}

function telemetryConsent_record(
  value: unknown,
  keys: readonly string[],
  shape: string,
): Record<string, unknown> {
  telemetryConsent_assertJsonData(value);
  if (!telemetryConsent_isRecord(value) || !telemetryConsent_hasOnlyDataKeys(value, keys)) {
    throw new TypeError(`${shape} has an unsupported shape.`);
  }
  return value;
}

function telemetryConsent_boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean.`);
  return value;
}

function telemetryConsent_integer(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${name} must be a bounded safe integer.`);
  }
  return value;
}

function telemetryConsent_enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  name: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${name} is unsupported.`);
  }
  return value as Values[number];
}

function telemetryConsent_disclosureVersion(value: unknown): number {
  return telemetryConsent_integer(
    value,
    "disclosureVersion",
    1,
    telemetryConsent_maxDisclosureVersion,
  );
}

function telemetryConsent_revision(value: unknown, name: string): number {
  return telemetryConsent_integer(value, name, 0, telemetryConsent_maxRevision);
}

/** Strictly decode one independent choice and its provenance. */
export function telemetryConsent_decodeChoice(value: unknown): TelemetryConsentChoice {
  const record = telemetryConsent_record(
    value,
    ["value", "source", "disclosureVersion"],
    "telemetry consent choice",
  );
  const choice = telemetryConsent_enumValue(record.value, telemetryConsent_choiceKinds, "choice");
  const source = telemetryConsent_enumValue(
    record.source,
    telemetryConsent_provenanceSources,
    "provenance source",
  );
  if (choice === "undecided") {
    if (source !== "absent" || record.disclosureVersion !== null) {
      throw new TypeError("an undecided choice must have absent provenance.");
    }
    return { value: choice, source, disclosureVersion: null };
  }
  if (source !== "user") {
    throw new TypeError("an explicit choice requires user provenance.");
  }
  return {
    value: choice,
    source,
    disclosureVersion: telemetryConsent_disclosureVersion(record.disclosureVersion),
  };
}

/** Strictly decode the two independent choice lanes. */
export function telemetryConsent_decodeChoices(value: unknown): TelemetryConsentChoices {
  const record = telemetryConsent_record(value, ["usage", "crash"], "telemetry consent choices");
  return {
    usage: telemetryConsent_decodeChoice(record.usage),
    crash: telemetryConsent_decodeChoice(record.crash),
  };
}

/** Strictly decode a new explicit user request. */
export function telemetryConsent_decodeRequest(value: unknown): TelemetryConsentRequest {
  const record = telemetryConsent_record(
    value,
    ["schemaVersion", "expectedRequestRevision", "disclosureVersion", "usage", "crash"],
    "telemetry consent request",
  );
  if (record.schemaVersion !== telemetryConsent_schemaVersion) {
    throw new TypeError("telemetry consent request version is unsupported.");
  }
  return {
    schemaVersion: telemetryConsent_schemaVersion,
    expectedRequestRevision: telemetryConsent_revision(
      record.expectedRequestRevision,
      "expectedRequestRevision",
    ),
    disclosureVersion: telemetryConsent_disclosureVersion(record.disclosureVersion),
    usage: telemetryConsent_enumValue(
      record.usage,
      telemetryConsent_explicitChoiceKinds,
      "usage choice",
    ),
    crash: telemetryConsent_enumValue(
      record.crash,
      telemetryConsent_explicitChoiceKinds,
      "crash choice",
    ),
  };
}

/** Strictly decode the complete pending state. */
export function telemetryConsent_decodePending(value: unknown): TelemetryConsentPending {
  const record = telemetryConsent_record(
    value,
    ["requestRevision", "disclosureVersion", "state", "desired", "outcome"],
    "telemetry consent pending state",
  );
  const requestRevision = telemetryConsent_revision(record.requestRevision, "requestRevision");
  if (requestRevision < 1) throw new TypeError("requestRevision must be positive.");
  const desired = telemetryConsent_decodeChoices(record.desired);
  if (desired.usage.value === "undecided" || desired.crash.value === "undecided") {
    throw new TypeError("pending consent requires explicit choices.");
  }
  const disclosureVersion = telemetryConsent_disclosureVersion(record.disclosureVersion);
  if (
    desired.usage.disclosureVersion !== disclosureVersion ||
    desired.crash.disclosureVersion !== disclosureVersion
  ) {
    throw new TypeError("pending consent choices must use the request disclosure version.");
  }
  const state = telemetryConsent_enumValue(
    record.state,
    telemetryConsent_pendingStates,
    "pending state",
  );
  const outcome = telemetryConsent_enumValue(
    record.outcome,
    telemetryConsent_outcomeCodes,
    "pending outcome",
  );
  if (
    !["pending", "not-durable", "restart-inspection-required", "reconciliation-required"].includes(
      outcome,
    )
  ) {
    throw new TypeError("pending consent outcome is inconsistent.");
  }
  if (state === "persistence-pending" && outcome !== "not-durable") {
    throw new TypeError("persistence-pending consent requires a not-durable outcome.");
  }
  if (state === "restart-inspection-required" && outcome !== "restart-inspection-required") {
    throw new TypeError("restart-inspection-required consent requires a matching outcome.");
  }
  if (state === "reconciliation-required" && outcome !== "reconciliation-required") {
    throw new TypeError("reconciliation-required consent requires a matching outcome.");
  }
  return {
    requestRevision,
    disclosureVersion,
    state,
    desired,
    outcome,
  };
}

/** Strictly decode the accepted engine's sanitized status boundary. */
export function telemetryConsent_decodeEngineStatus(
  value: unknown,
): TelemetryConsentEngineStatusInput {
  const record = telemetryConsent_record(
    value,
    [
      "configurationValid",
      "operationalEnabled",
      "disclosureVersion",
      "ownerConsent",
      "identityPresent",
      "queue",
      "suspended",
      "revocationPending",
      "pendingWithdrawal",
      "inFlight",
      "lastOutcome",
    ],
    "telemetry engine status",
  );
  const ownerConsent = telemetryConsent_record(
    record.ownerConsent,
    ["usage", "crash"],
    "current owner consent",
  );
  const queue = telemetryConsent_record(
    record.queue,
    ["usage", "crash", "total"],
    "telemetry queue summary",
  );
  const usage = telemetryConsent_integer(
    queue.usage,
    "queue.usage",
    0,
    telemetryConsent_maxQueueCount,
  );
  const crash = telemetryConsent_integer(
    queue.crash,
    "queue.crash",
    0,
    telemetryConsent_maxQueueCount,
  );
  const total = telemetryConsent_integer(
    queue.total,
    "queue.total",
    0,
    telemetryConsent_maxQueueCount,
  );
  if (total !== usage + crash) throw new TypeError("telemetry queue total is inconsistent.");
  const disclosureVersion =
    record.disclosureVersion === null
      ? null
      : telemetryConsent_disclosureVersion(record.disclosureVersion);
  const pendingWithdrawal =
    record.pendingWithdrawal === null
      ? null
      : telemetryConsent_decodePendingWithdrawal(record.pendingWithdrawal);
  if (
    record.lastOutcome !== null &&
    (typeof record.lastOutcome !== "string" || record.lastOutcome.length > 96)
  ) {
    throw new TypeError("engine lastOutcome must be null or a bounded string.");
  }
  return {
    configurationValid: telemetryConsent_boolean(record.configurationValid, "configurationValid"),
    operationalEnabled: telemetryConsent_boolean(record.operationalEnabled, "operationalEnabled"),
    disclosureVersion,
    ownerConsent: {
      usage: telemetryConsent_boolean(ownerConsent.usage, "ownerConsent.usage"),
      crash: telemetryConsent_boolean(ownerConsent.crash, "ownerConsent.crash"),
    },
    identityPresent: telemetryConsent_boolean(record.identityPresent, "identityPresent"),
    queue: { usage, crash, total },
    suspended: telemetryConsent_boolean(record.suspended, "suspended"),
    revocationPending: telemetryConsent_boolean(record.revocationPending, "revocationPending"),
    pendingWithdrawal,
    inFlight: telemetryConsent_boolean(record.inFlight, "inFlight"),
    lastOutcome: record.lastOutcome,
  };
}

function telemetryConsent_decodePendingWithdrawal(
  value: unknown,
): Readonly<{ usage: boolean; crash: boolean }> {
  const record = telemetryConsent_record(value, ["usage", "crash"], "pending telemetry withdrawal");
  return {
    usage: telemetryConsent_boolean(record.usage, "pendingWithdrawal.usage"),
    crash: telemetryConsent_boolean(record.crash, "pendingWithdrawal.crash"),
  };
}

/** Strictly decode the sanitized public engine summary. */
export function telemetryConsent_decodeEngineSnapshot(
  value: unknown,
): TelemetryConsentEngineSnapshot {
  const record = telemetryConsent_record(
    value,
    [
      "configurationValid",
      "operationalEnabled",
      "disclosureVersion",
      "identityPresent",
      "queue",
      "suspended",
      "revocationPending",
      "ownerConsent",
      "withdrawalPending",
      "inFlight",
    ],
    "telemetry engine snapshot",
  );
  const queue = telemetryConsent_record(
    record.queue,
    ["usage", "crash", "total"],
    "telemetry engine queue",
  );
  const ownerConsent = telemetryConsent_record(
    record.ownerConsent,
    ["usage", "crash"],
    "telemetry owner consent",
  );
  const withdrawalPending = telemetryConsent_record(
    record.withdrawalPending,
    ["usage", "crash"],
    "telemetry withdrawal flags",
  );
  const usage = telemetryConsent_integer(
    queue.usage,
    "queue.usage",
    0,
    telemetryConsent_maxQueueCount,
  );
  const crash = telemetryConsent_integer(
    queue.crash,
    "queue.crash",
    0,
    telemetryConsent_maxQueueCount,
  );
  const total = telemetryConsent_integer(
    queue.total,
    "queue.total",
    0,
    telemetryConsent_maxQueueCount,
  );
  if (total !== usage + crash) throw new TypeError("telemetry queue total is inconsistent.");
  return {
    configurationValid: telemetryConsent_boolean(record.configurationValid, "configurationValid"),
    operationalEnabled: telemetryConsent_boolean(record.operationalEnabled, "operationalEnabled"),
    disclosureVersion:
      record.disclosureVersion === null
        ? null
        : telemetryConsent_disclosureVersion(record.disclosureVersion),
    identityPresent: telemetryConsent_boolean(record.identityPresent, "identityPresent"),
    queue: { usage, crash, total },
    suspended: telemetryConsent_boolean(record.suspended, "suspended"),
    revocationPending: telemetryConsent_boolean(record.revocationPending, "revocationPending"),
    ownerConsent: {
      usage: telemetryConsent_boolean(ownerConsent.usage, "engine.ownerConsent.usage"),
      crash: telemetryConsent_boolean(ownerConsent.crash, "engine.ownerConsent.crash"),
    },
    withdrawalPending: {
      usage: telemetryConsent_boolean(withdrawalPending.usage, "engine.withdrawalPending.usage"),
      crash: telemetryConsent_boolean(withdrawalPending.crash, "engine.withdrawalPending.crash"),
    },
    inFlight: telemetryConsent_boolean(record.inFlight, "inFlight"),
  };
}

export function telemetryConsent_decodeDelivery(value: unknown): TelemetryConsentDeliverySnapshot {
  const record = telemetryConsent_record(value, ["state", "receipt"], "telemetry delivery");
  return {
    state: telemetryConsent_enumValue(
      record.state,
      telemetryConsent_deliveryStates,
      "delivery state",
    ),
    receipt: telemetryConsent_enumValue(
      record.receipt,
      telemetryConsent_receiptStates,
      "receipt state",
    ),
  };
}

/** Strictly decode the complete renderer-safe status snapshot. */
export function telemetryConsent_decodeStatus(value: unknown): TelemetryConsentStatusSnapshot {
  const record = telemetryConsent_record(
    value,
    [
      "schemaVersion",
      "latestRequestRevision",
      "desired",
      "durable",
      "effective",
      "pending",
      "engine",
      "delivery",
      "outcome",
      "requiresRestartInspection",
      "requiresReconciliation",
    ],
    "telemetry consent status",
  );
  if (record.schemaVersion !== telemetryConsent_schemaVersion) {
    throw new TypeError("telemetry consent status version is unsupported.");
  }
  const latestRequestRevision = telemetryConsent_revision(
    record.latestRequestRevision,
    "latestRequestRevision",
  );
  const pending = record.pending === null ? null : telemetryConsent_decodePending(record.pending);
  if (pending !== null && pending.requestRevision !== latestRequestRevision) {
    throw new TypeError("pending request does not match the latest request revision.");
  }
  const desired = telemetryConsent_decodeChoices(record.desired);
  if (pending !== null && JSON.stringify(pending.desired) !== JSON.stringify(desired)) {
    throw new TypeError("pending choices do not match the desired consent state.");
  }
  const outcome = telemetryConsent_enumValue(
    record.outcome,
    telemetryConsent_outcomeCodes,
    "consent outcome",
  );
  if (pending !== null && (outcome === "none" || outcome === "saved")) {
    throw new TypeError("pending consent cannot be projected as saved or empty.");
  }
  const requiresRestartInspection = telemetryConsent_boolean(
    record.requiresRestartInspection,
    "requiresRestartInspection",
  );
  if (requiresRestartInspection && outcome !== "restart-inspection-required") {
    throw new TypeError("restart inspection must use the matching consent outcome.");
  }
  const requiresReconciliation = telemetryConsent_boolean(
    record.requiresReconciliation,
    "requiresReconciliation",
  );
  return {
    schemaVersion: telemetryConsent_schemaVersion,
    latestRequestRevision,
    desired,
    durable: telemetryConsent_decodeChoices(record.durable),
    effective: telemetryConsent_decodeChoices(record.effective),
    pending,
    engine: telemetryConsent_decodeEngineSnapshot(record.engine),
    delivery: telemetryConsent_decodeDelivery(record.delivery),
    outcome,
    requiresRestartInspection,
    requiresReconciliation,
  };
}

/** Strictly decode a persisted consent checkpoint. */
export function telemetryConsent_decodeCheckpoint(value: unknown): TelemetryConsentCheckpoint {
  const record = telemetryConsent_record(
    value,
    ["schemaVersion", "latestRequestRevision", "desired", "durable", "pending"],
    "telemetry consent checkpoint",
  );
  if (record.schemaVersion !== telemetryConsent_schemaVersion) {
    throw new TypeError("telemetry consent checkpoint version is unsupported.");
  }
  const latestRequestRevision = telemetryConsent_revision(
    record.latestRequestRevision,
    "latestRequestRevision",
  );
  const pending = record.pending === null ? null : telemetryConsent_decodePending(record.pending);
  if (pending !== null && pending.requestRevision !== latestRequestRevision) {
    throw new TypeError("pending request does not match the checkpoint revision.");
  }
  const desired = telemetryConsent_decodeChoices(record.desired);
  if (pending !== null && JSON.stringify(pending.desired) !== JSON.stringify(desired)) {
    throw new TypeError("pending choices do not match the checkpoint desired state.");
  }
  return {
    schemaVersion: telemetryConsent_schemaVersion,
    latestRequestRevision,
    desired,
    durable: telemetryConsent_decodeChoices(record.durable),
    pending,
  };
}

/** Strictly decode the two independent persistence receipts. */
export function telemetryConsent_decodePersistenceResult(
  value: unknown,
): TelemetryConsentPersistenceResult {
  const record = telemetryConsent_record(
    value,
    ["schemaVersion", "requestRevision", "engineDurable", "provenanceDurable"],
    "telemetry consent persistence result",
  );
  if (record.schemaVersion !== telemetryConsent_schemaVersion) {
    throw new TypeError("telemetry consent result version is unsupported.");
  }
  const requestRevision = telemetryConsent_revision(record.requestRevision, "requestRevision");
  if (requestRevision < 1) throw new TypeError("requestRevision must be positive.");
  return {
    schemaVersion: telemetryConsent_schemaVersion,
    requestRevision,
    engineDurable: telemetryConsent_boolean(record.engineDurable, "engineDurable"),
    provenanceDurable: telemetryConsent_boolean(record.provenanceDurable, "provenanceDurable"),
  };
}

for (const values of [
  telemetryConsent_categories,
  telemetryConsent_choiceKinds,
  telemetryConsent_explicitChoiceKinds,
  telemetryConsent_provenanceSources,
  telemetryConsent_pendingStates,
  telemetryConsent_outcomeCodes,
  telemetryConsent_deliveryStates,
  telemetryConsent_receiptStates,
]) {
  Object.freeze(values);
}
