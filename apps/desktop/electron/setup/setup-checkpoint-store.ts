/**
 * Durable Setup Centre checkpoint persistence.
 *
 * The local file is only a candidate. Every checkpoint rewrite is fenced by a
 * caller-supplied trusted authority, and restart recovery begins from that
 * authority's complete anchor. This module never interprets local hashes,
 * backups, or auxiliary files as authentication.
 */

import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  setupCentre_checkpointAnchorSchemaVersion,
  setupCentre_decodeCheckpoint,
  setupCentre_decodeCheckpointAnchor,
  setupCentre_decodeRestartObservation,
  type SetupCheckpoint,
  type SetupCheckpointAnchor,
  type SetupRestartObservation,
  type SetupRouteId,
} from "../../contracts/setup-centre";
import {
  setupDomain_initialState,
  setupDomain_reconcileRestart,
  type SetupDomainState,
  type SetupRestartReconciliationResult,
} from "./setup-domain";

export const setupCheckpointStore_envelopeSchemaVersion = 2 as const;
export const setupCheckpointStore_maxFileBytes = 256 * 1024;
export const setupCheckpointStore_maxAuthorityRevisionLength = 160;

/** Exact local persistence layout. The root itself must be supplied by the caller. */
export interface SetupCheckpointStoreEnvelope {
  readonly schemaVersion: typeof setupCheckpointStore_envelopeSchemaVersion;
  readonly authorityRevision: string;
  readonly checkpoint: SetupCheckpoint;
  readonly sequenceState: SetupCheckpointStoreSequenceState;
}

/** Authenticated one-step cursor for the current operation sequence. */
export interface SetupCheckpointStoreSequenceState {
  readonly operationSequence: number;
  readonly state: "idle" | "admitted" | "completed" | "retired";
}

/** Fully resolved paths owned by one explicit store root. */
export interface SetupCheckpointStoreFiles {
  readonly rootDirectory: string;
  readonly checkpointPath: string;
  readonly backupPath: string;
}

/** One module-level serialization lane for an absolute checkpoint path. */
interface SetupCheckpointStoreQueue {
  tail: Promise<void>;
}

/** The persistence owner's externally supplied authority snapshot. */
export type SetupCheckpointStoreAuthorityReadResult =
  | { readonly state: "empty" }
  | {
      readonly state: "present";
      readonly revision: string;
      readonly anchor: SetupCheckpointAnchor;
      readonly sequenceState: SetupCheckpointStoreSequenceState;
    }
  | { readonly state: "unavailable" };

/** A conditional write that is fenced by the last authority revision read. */
export interface SetupCheckpointStoreAuthorityCommitRequest {
  /** Null is valid only for an explicitly authorized first bootstrap. */
  readonly expectedRevision: string | null;
  readonly anchor: SetupCheckpointAnchor;
  readonly sequenceState: SetupCheckpointStoreSequenceState;
}

/**
 * A definite rejection is safe to retry after a fresh read. Indeterminate means
 * the caller must inspect authority state before attempting any further commit.
 */
export type SetupCheckpointStoreAuthorityCommitResult =
  | {
      readonly state: "committed";
      readonly revision: string;
      readonly anchor: SetupCheckpointAnchor;
      readonly sequenceState: SetupCheckpointStoreSequenceState;
    }
  | {
      readonly state: "rejected";
      readonly reason: "conditional-mismatch" | "unauthorized" | "rejected";
    }
  | { readonly state: "indeterminate" };

/** The only authentication capability accepted by the store. */
export interface SetupCheckpointStoreAuthority {
  read(): Promise<SetupCheckpointStoreAuthorityReadResult>;
  commit(
    request: SetupCheckpointStoreAuthorityCommitRequest,
  ): Promise<SetupCheckpointStoreAuthorityCommitResult>;
}

export interface SetupCheckpointStoreCommitReceipt {
  readonly revision: string;
  readonly anchor: SetupCheckpointAnchor;
  readonly sequenceState: SetupCheckpointStoreSequenceState;
}

export type SetupCheckpointStoreErrorCode =
  | "invalid-store-root"
  | "invalid-writer"
  | "invalid-bootstrap"
  | "invalid-save-options"
  | "invalid-observation"
  | "invalid-envelope"
  | "invalid-authority-result"
  | "authority-unavailable"
  | "authority-rejected"
  | "authority-indeterminate"
  | "authority-receipt-mismatch"
  | "bootstrap-required"
  | "bootstrap-authority-not-empty"
  | "bootstrap-local-present"
  | "local-checkpoint-missing"
  | "local-checkpoint-corrupt"
  | "local-checkpoint-too-large"
  | "local-authority-mismatch"
  | "local-promotion-failed"
  | "stale-checkpoint"
  | "conflicting-checkpoint"
  | "stale-authority-revision"
  | "local-read-failed";

const setupCheckpointStore_errorMessages: Readonly<Record<SetupCheckpointStoreErrorCode, string>> =
  Object.freeze({
    "invalid-store-root": "The Setup checkpoint store root is invalid.",
    "invalid-writer": "The Setup checkpoint store requires an injected writer capability.",
    "invalid-bootstrap": "The Setup checkpoint bootstrap request is invalid.",
    "invalid-save-options": "The Setup checkpoint save request is invalid.",
    "invalid-observation": "The Setup restart observation is invalid.",
    "invalid-envelope": "The local Setup checkpoint envelope is invalid.",
    "invalid-authority-result": "The trusted Setup authority returned an invalid result.",
    "authority-unavailable": "The trusted Setup checkpoint authority is unavailable.",
    "authority-rejected": "The trusted Setup checkpoint authority rejected the conditional commit.",
    "authority-indeterminate":
      "The Setup authority commit outcome is indeterminate; inspect authority state before retrying.",
    "authority-receipt-mismatch":
      "The Setup authority receipt does not match the committed checkpoint.",
    "bootstrap-required": "The Setup checkpoint store requires an explicit authorized bootstrap.",
    "bootstrap-authority-not-empty":
      "The Setup checkpoint authority is not empty; bootstrap is not permitted.",
    "bootstrap-local-present":
      "Local Setup checkpoint data is present without an authoritative checkpoint.",
    "local-checkpoint-missing": "The local Setup checkpoint is missing.",
    "local-checkpoint-corrupt":
      "The local Setup checkpoint is corrupt; repair requires trusted authority recovery.",
    "local-checkpoint-too-large": "The local Setup checkpoint exceeds its bounded file size.",
    "local-authority-mismatch":
      "The local Setup checkpoint candidate does not match the trusted authority.",
    "local-promotion-failed":
      "The authoritative Setup checkpoint was committed but local promotion did not confirm.",
    "stale-checkpoint": "The Setup checkpoint candidate is older than the trusted authority.",
    "conflicting-checkpoint": "The Setup checkpoint candidate diverges from the trusted authority.",
    "stale-authority-revision": "The caller's expected Setup authority revision is stale.",
    "local-read-failed": "The local Setup checkpoint could not be read safely.",
  });

/** A closed error type that never echoes caller data, paths, or authority values. */
export class SetupCheckpointStoreError extends Error {
  readonly code: SetupCheckpointStoreErrorCode;
  readonly requiresFreshRead: boolean;
  readonly receipt: SetupCheckpointStoreCommitReceipt | undefined;

  constructor(
    code: SetupCheckpointStoreErrorCode,
    options: {
      readonly receipt?: SetupCheckpointStoreCommitReceipt;
    } = {},
  ) {
    super(setupCheckpointStore_errorMessages[code]);
    this.name = "SetupCheckpointStoreError";
    this.code = code;
    this.requiresFreshRead =
      code === "authority-indeterminate" || code === "authority-receipt-mismatch";
    this.receipt = options.receipt;
  }
}

export interface SetupCheckpointStoreBootstrapRequest {
  readonly authorizeEmptyAuthority: true;
  readonly routeId: SetupRouteId;
  readonly generation?: number;
  readonly configRevision?: number;
}

export interface SetupCheckpointStoreSaveOptions {
  /** Authority revision observed by the caller before deriving this candidate. */
  readonly expectedAuthorityRevision: string;
}

export interface SetupCheckpointStorePersistResult {
  readonly checkpoint: SetupCheckpoint;
  readonly authorityRevision: string;
  readonly sequenceState: SetupCheckpointStoreSequenceState;
  readonly authorityCommitted: boolean;
  readonly automaticActions: readonly [];
}

export interface SetupCheckpointStoreRestartResult {
  readonly state: SetupDomainState;
  readonly checkpoint: SetupCheckpoint;
  readonly authorityRevision: string;
  readonly sequenceState: SetupCheckpointStoreSequenceState;
  readonly recovery:
    "none" | "authority-missing" | "authority-commit-interrupted" | "authenticated-backup";
  readonly restart: SetupRestartReconciliationResult;
  readonly automaticActions: readonly [];
}

export type SetupCheckpointStoreWriter = (
  filePath: string,
  contents: string,
  validateExisting: (value: unknown) => unknown,
) => Promise<void>;

export interface SetupCheckpointStoreOptions {
  /** Required persistence-owner capability; callers may wrap it for failure tests. */
  readonly write: SetupCheckpointStoreWriter;
}

interface ParsedCheckpointFile {
  readonly status: "missing" | "corrupt" | "ok";
  readonly value?: unknown;
}

interface LocalCheckpointRead {
  readonly primary: ParsedCheckpointFile;
  readonly backup: ParsedCheckpointFile;
  readonly envelope: SetupCheckpointStoreEnvelope | undefined;
  readonly selected: "primary" | "backup" | "missing";
}

const setupCheckpointStore_queues = new Map<string, SetupCheckpointStoreQueue>();
const setupCheckpointStore_credentialPrefixes = [
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

function setupCheckpointStore_isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function setupCheckpointStore_isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

/**
 * Read an exact set of data properties. Accessors are rejected without being
 * invoked so malformed authority responses cannot execute during validation.
 */
function setupCheckpointStore_dataRecord(
  value: unknown,
  keys: readonly string[],
  code:
    | "invalid-envelope"
    | "invalid-authority-result"
    | "invalid-bootstrap"
    | "invalid-save-options"
    | "invalid-observation",
): Record<string, unknown> {
  if (!setupCheckpointStore_isPlainRecord(value)) {
    throw new SetupCheckpointStoreError(code);
  }
  const ownNames = Object.getOwnPropertyNames(value);
  if (ownNames.length !== keys.length || ownNames.some((key) => !keys.includes(key))) {
    throw new SetupCheckpointStoreError(code);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new SetupCheckpointStoreError(code);
    }
  }
  return value;
}

function setupCheckpointStore_dataRecordWithOptionalKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  code: "invalid-bootstrap",
): Record<string, unknown> {
  if (!setupCheckpointStore_isPlainRecord(value)) {
    throw new SetupCheckpointStoreError(code);
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const ownNames = Object.getOwnPropertyNames(value);
  if (
    ownNames.some((key) => !allowed.has(key)) ||
    requiredKeys.some((key) => !ownNames.includes(key))
  ) {
    throw new SetupCheckpointStoreError(code);
  }
  for (const key of ownNames) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new SetupCheckpointStoreError(code);
    }
  }
  return value;
}

function setupCheckpointStore_hasSecretBearingText(value: string): boolean {
  const lowered = value.toLowerCase();
  const awsAccessKey =
    (value.startsWith("AKIA") || value.startsWith("ASIA")) &&
    value.length === 20 &&
    [...value.slice(4)].every(
      (character) =>
        (character >= "A" && character <= "Z") || (character >= "0" && character <= "9"),
    );
  return (
    awsAccessKey ||
    setupCheckpointStore_credentialPrefixes.some((prefix) => lowered.startsWith(prefix)) ||
    lowered.includes("secret") ||
    lowered.includes("password") ||
    lowered.includes("authorization") ||
    lowered.includes("bearer") ||
    lowered.includes("apikey") ||
    lowered.includes("api_key") ||
    lowered.startsWith("sk-") ||
    lowered.startsWith("sk_") ||
    lowered.startsWith("eyj")
  );
}

function setupCheckpointStore_decodeAuthorityRevision(
  value: unknown,
  code: "invalid-envelope" | "invalid-authority-result" | "invalid-save-options",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > setupCheckpointStore_maxAuthorityRevisionLength ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ||
    setupCheckpointStore_hasSecretBearingText(value)
  ) {
    throw new SetupCheckpointStoreError(code);
  }
  return value;
}

function setupCheckpointStore_decodeSequenceState(
  value: unknown,
  code: "invalid-envelope" | "invalid-authority-result",
): SetupCheckpointStoreSequenceState {
  const record = setupCheckpointStore_dataRecord(value, ["operationSequence", "state"], code);
  if (
    !Number.isSafeInteger(record.operationSequence) ||
    (record.operationSequence as number) < 0 ||
    (record.state !== "idle" &&
      record.state !== "admitted" &&
      record.state !== "completed" &&
      record.state !== "retired")
  ) {
    throw new SetupCheckpointStoreError(code);
  }
  return {
    operationSequence: record.operationSequence as number,
    state: record.state,
  };
}

function setupCheckpointStore_sequenceStateMatchesCheckpoint(
  sequenceState: SetupCheckpointStoreSequenceState,
  checkpoint: SetupCheckpoint,
): boolean {
  if (sequenceState.operationSequence !== checkpoint.operationSequence) return false;
  if (sequenceState.state === "idle") return true;
  if (sequenceState.operationSequence === 0) return false;
  if (sequenceState.state === "completed") {
    return checkpoint.lastCompletedOperationId !== null;
  }
  if (sequenceState.state === "retired") {
    return checkpoint.retiredOperations.some(
      (retired) =>
        retired.operationSequence === checkpoint.operationSequence &&
        retired.generation === checkpoint.generation,
    );
  }
  return true;
}

/** Decode one exact local JSON envelope; accessors and unknown fields fail closed. */
export function setupCheckpointStore_decodeEnvelope(value: unknown): SetupCheckpointStoreEnvelope {
  const record = setupCheckpointStore_dataRecord(
    value,
    ["schemaVersion", "authorityRevision", "checkpoint", "sequenceState"],
    "invalid-envelope",
  );
  if (record.schemaVersion !== setupCheckpointStore_envelopeSchemaVersion) {
    throw new SetupCheckpointStoreError("invalid-envelope");
  }
  const authorityRevision = setupCheckpointStore_decodeAuthorityRevision(
    record.authorityRevision,
    "invalid-envelope",
  );
  let checkpoint: SetupCheckpoint;
  try {
    checkpoint = setupCentre_decodeCheckpoint(record.checkpoint);
  } catch {
    throw new SetupCheckpointStoreError("invalid-envelope");
  }
  const sequenceState = setupCheckpointStore_decodeSequenceState(
    record.sequenceState,
    "invalid-envelope",
  );
  if (!setupCheckpointStore_sequenceStateMatchesCheckpoint(sequenceState, checkpoint)) {
    throw new SetupCheckpointStoreError("invalid-envelope");
  }
  return {
    schemaVersion: setupCheckpointStore_envelopeSchemaVersion,
    authorityRevision,
    checkpoint,
    sequenceState,
  };
}

function setupCheckpointStore_decodeAuthorityReadResult(
  value: unknown,
): SetupCheckpointStoreAuthorityReadResult {
  const record = setupCheckpointStore_dataRecord(
    value,
    Object.prototype.hasOwnProperty.call(value ?? {}, "anchor")
      ? ["state", "revision", "anchor", "sequenceState"]
      : ["state"],
    "invalid-authority-result",
  );
  if (record.state === "empty" || record.state === "unavailable") {
    return { state: record.state };
  }
  if (
    record.state !== "present" ||
    !Object.prototype.hasOwnProperty.call(record, "revision") ||
    !Object.prototype.hasOwnProperty.call(record, "anchor")
  ) {
    throw new SetupCheckpointStoreError("invalid-authority-result");
  }
  const revision = setupCheckpointStore_decodeAuthorityRevision(
    record.revision,
    "invalid-authority-result",
  );
  let anchor: SetupCheckpointAnchor;
  try {
    anchor = setupCentre_decodeCheckpointAnchor(record.anchor);
  } catch {
    throw new SetupCheckpointStoreError("invalid-authority-result");
  }
  const sequenceState = setupCheckpointStore_decodeSequenceState(
    record.sequenceState,
    "invalid-authority-result",
  );
  if (!setupCheckpointStore_sequenceStateMatchesCheckpoint(sequenceState, anchor.checkpoint)) {
    throw new SetupCheckpointStoreError("invalid-authority-result");
  }
  return { state: "present", revision, anchor, sequenceState };
}

function setupCheckpointStore_decodeAuthorityCommitResult(
  value: unknown,
): SetupCheckpointStoreAuthorityCommitResult {
  if (!setupCheckpointStore_isPlainRecord(value)) {
    throw new SetupCheckpointStoreError("invalid-authority-result");
  }
  const stateDescriptor = Object.getOwnPropertyDescriptor(value, "state");
  if (!stateDescriptor?.enumerable || !("value" in stateDescriptor)) {
    throw new SetupCheckpointStoreError("invalid-authority-result");
  }
  const state: unknown = stateDescriptor.value;
  if (state === "committed") {
    const record = setupCheckpointStore_dataRecord(
      value,
      ["state", "revision", "anchor", "sequenceState"],
      "invalid-authority-result",
    );
    const revision = setupCheckpointStore_decodeAuthorityRevision(
      record.revision,
      "invalid-authority-result",
    );
    let anchor: SetupCheckpointAnchor;
    try {
      anchor = setupCentre_decodeCheckpointAnchor(record.anchor);
    } catch {
      throw new SetupCheckpointStoreError("invalid-authority-result");
    }
    const sequenceState = setupCheckpointStore_decodeSequenceState(
      record.sequenceState,
      "invalid-authority-result",
    );
    if (!setupCheckpointStore_sequenceStateMatchesCheckpoint(sequenceState, anchor.checkpoint)) {
      throw new SetupCheckpointStoreError("invalid-authority-result");
    }
    return { state: "committed", revision, anchor, sequenceState };
  }
  if (state === "rejected") {
    const record = setupCheckpointStore_dataRecord(
      value,
      ["state", "reason"],
      "invalid-authority-result",
    );
    if (
      record.reason !== "conditional-mismatch" &&
      record.reason !== "unauthorized" &&
      record.reason !== "rejected"
    ) {
      throw new SetupCheckpointStoreError("invalid-authority-result");
    }
    return { state: "rejected", reason: record.reason };
  }
  if (state === "indeterminate") {
    setupCheckpointStore_dataRecord(value, ["state"], "invalid-authority-result");
    return { state: "indeterminate" };
  }
  throw new SetupCheckpointStoreError("invalid-authority-result");
}

function setupCheckpointStore_decodeBootstrapRequest(
  value: unknown,
): Required<SetupCheckpointStoreBootstrapRequest> {
  const record = setupCheckpointStore_dataRecordWithOptionalKeys(
    value,
    ["authorizeEmptyAuthority", "routeId"],
    ["generation", "configRevision"],
    "invalid-bootstrap",
  );
  if (record.authorizeEmptyAuthority !== true) {
    throw new SetupCheckpointStoreError("invalid-bootstrap");
  }
  if (typeof record.routeId !== "string") {
    throw new SetupCheckpointStoreError("invalid-bootstrap");
  }
  const generation = record.generation === undefined ? 1 : record.generation;
  const configRevision = record.configRevision === undefined ? 1 : record.configRevision;
  try {
    const initialState = setupDomain_initialState(
      record.routeId as SetupRouteId,
      generation as number,
      configRevision as number,
    );
    return {
      authorizeEmptyAuthority: true,
      routeId: initialState.checkpoint.routeId,
      generation: initialState.checkpoint.generation,
      configRevision: initialState.checkpoint.configRevision,
    };
  } catch {
    throw new SetupCheckpointStoreError("invalid-bootstrap");
  }
}

function setupCheckpointStore_decodeSaveOptions(value: unknown): string {
  const record = setupCheckpointStore_dataRecord(
    value,
    ["expectedAuthorityRevision"],
    "invalid-save-options",
  );
  return setupCheckpointStore_decodeAuthorityRevision(
    record.expectedAuthorityRevision,
    "invalid-save-options",
  );
}

function setupCheckpointStore_anchorFor(checkpoint: SetupCheckpoint): SetupCheckpointAnchor {
  return {
    schemaVersion: setupCentre_checkpointAnchorSchemaVersion,
    authority: "persistence-owner",
    checkpoint,
  };
}

/** Strictly compare every decoded checkpoint field, including retired history. */
export function setupCheckpointStore_checkpointsEqual(
  left: SetupCheckpoint,
  right: SetupCheckpoint,
): boolean {
  return isDeepStrictEqual(left, right);
}

function setupCheckpointStore_sequenceStatesEqual(
  left: SetupCheckpointStoreSequenceState,
  right: SetupCheckpointStoreSequenceState,
): boolean {
  return isDeepStrictEqual(left, right);
}

function setupCheckpointStore_initialSequenceState(
  checkpoint: SetupCheckpoint,
): SetupCheckpointStoreSequenceState {
  return { operationSequence: checkpoint.operationSequence, state: "idle" };
}

function setupCheckpointStore_hasPreservedRetiredHistory(
  older: SetupCheckpoint,
  newer: SetupCheckpoint,
): boolean {
  return older.retiredOperations.every((retired) =>
    newer.retiredOperations.some((candidate) => isDeepStrictEqual(candidate, retired)),
  );
}

/** True only when a trusted newer state can replace an older local candidate safely. */
function setupCheckpointStore_isSafeAuthorityAdvance(
  local: SetupCheckpoint,
  authority: SetupCheckpoint,
  localSequenceState: SetupCheckpointStoreSequenceState,
): boolean {
  if (
    local.routeId !== authority.routeId ||
    local.componentId !== authority.componentId ||
    authority.generation < local.generation ||
    authority.operationSequence < local.operationSequence ||
    authority.retiredOperations.length < local.retiredOperations.length ||
    !setupCheckpointStore_hasPreservedRetiredHistory(local, authority)
  ) {
    return false;
  }
  if (authority.generation === local.generation) {
    return (
      authority.configRevision >= local.configRevision &&
      (authority.operationSequence > local.operationSequence ||
        setupCheckpointStore_checkpointsEqual(local, authority) ||
        setupCheckpointStore_isSameSequenceTransition(local, authority, localSequenceState) !==
          null)
    );
  }
  return true;
}

/**
 * A same-sequence save is one accepted-domain forward step:
 * - exactly one pending progress entry may become complete; or
 * - exactly one retired operation may be appended.
 *
 * Completion must advance lastCompletedOperationId. Retirement must preserve it
 * and may only append the active sequence at the current generation. All other
 * checkpoint fields remain stable, and the two shapes cannot be combined.
 */
function setupCheckpointStore_isSameSequenceTransition(
  current: SetupCheckpoint,
  candidate: SetupCheckpoint,
  currentSequenceState: SetupCheckpointStoreSequenceState,
): SetupCheckpointStoreSequenceState | null {
  if (
    current.routeId !== candidate.routeId ||
    current.componentId !== candidate.componentId ||
    current.generation !== candidate.generation ||
    current.configRevision !== candidate.configRevision ||
    current.operationSequence !== candidate.operationSequence ||
    current.progress.routeId !== candidate.progress.routeId ||
    current.progress.generation !== candidate.progress.generation ||
    current.progress.configRevision !== candidate.progress.configRevision ||
    currentSequenceState.operationSequence !== current.operationSequence ||
    currentSequenceState.state !== "admitted"
  ) {
    return null;
  }

  const retiredAppendLength = candidate.retiredOperations.length - current.retiredOperations.length;
  if (
    (retiredAppendLength !== 0 && retiredAppendLength !== 1) ||
    !isDeepStrictEqual(
      candidate.retiredOperations.slice(0, current.retiredOperations.length),
      current.retiredOperations,
    )
  ) {
    return null;
  }

  if (candidate.progress.steps.length !== current.progress.steps.length) return null;
  let progressChanges = 0;
  let validCompletion = true;
  for (const [index, currentStep] of current.progress.steps.entries()) {
    const candidateStep = candidate.progress.steps[index];
    if (candidateStep?.step !== currentStep.step || candidateStep.state === currentStep.state) {
      if (candidateStep?.step !== currentStep.step) return null;
      continue;
    }
    progressChanges += 1;
    if (currentStep.state !== "pending" || candidateStep?.state !== "complete") {
      validCompletion = false;
    }
  }
  if (progressChanges > 1 || !validCompletion) return null;

  const completionChanged = progressChanges === 1;
  const retirementChanged = retiredAppendLength === 1;
  if (completionChanged === retirementChanged) return null;

  if (completionChanged) {
    return candidate.lastCompletedOperationId === null
      ? null
      : { operationSequence: candidate.operationSequence, state: "completed" };
  }

  const retired = candidate.retiredOperations.at(-1);
  return retired !== undefined &&
    retired.generation === candidate.generation &&
    retired.operationSequence === candidate.operationSequence &&
    candidate.lastCompletedOperationId === current.lastCompletedOperationId
    ? { operationSequence: candidate.operationSequence, state: "retired" }
    : null;
}

function setupCheckpointStore_isAdmissionTransition(
  current: SetupCheckpoint,
  candidate: SetupCheckpoint,
): boolean {
  return (
    current.generation === candidate.generation &&
    current.configRevision === candidate.configRevision &&
    candidate.operationSequence === current.operationSequence + 1 &&
    candidate.lastCompletedOperationId === current.lastCompletedOperationId &&
    isDeepStrictEqual(candidate.retiredOperations, current.retiredOperations) &&
    isDeepStrictEqual(candidate.progress, current.progress)
  );
}

function setupCheckpointStore_isGenerationAdvance(
  current: SetupCheckpoint,
  candidate: SetupCheckpoint,
): boolean {
  if (
    candidate.generation !== current.generation + 1 ||
    candidate.configRevision < current.configRevision ||
    candidate.operationSequence !== current.operationSequence ||
    candidate.lastCompletedOperationId !== current.lastCompletedOperationId ||
    !isDeepStrictEqual(candidate.retiredOperations, current.retiredOperations) ||
    candidate.progress.steps.length !== current.progress.steps.length ||
    candidate.progress.routeId !== candidate.routeId ||
    candidate.progress.generation !== candidate.generation ||
    candidate.progress.configRevision !== candidate.configRevision
  ) {
    return false;
  }

  return candidate.progress.steps.every((candidateStep, index) => {
    const currentStep = current.progress.steps[index];
    if (candidateStep.step !== currentStep?.step) return false;
    if (candidateStep.state === currentStep.state) return true;
    return (
      candidate.configRevision > current.configRevision &&
      (candidateStep.step === "catalogue" || candidateStep.step === "probe") &&
      candidateStep.state === "pending"
    );
  });
}

function setupCheckpointStore_assertCandidateAdvance(
  current: SetupCheckpoint,
  candidate: SetupCheckpoint,
  currentSequenceState: SetupCheckpointStoreSequenceState,
): SetupCheckpointStoreSequenceState {
  if (
    candidate.routeId !== current.routeId ||
    candidate.componentId !== current.componentId ||
    candidate.generation < current.generation ||
    candidate.configRevision < current.configRevision ||
    candidate.operationSequence < current.operationSequence ||
    candidate.retiredOperations.length < current.retiredOperations.length ||
    !setupCheckpointStore_hasPreservedRetiredHistory(current, candidate)
  ) {
    throw new SetupCheckpointStoreError("stale-checkpoint");
  }
  if (currentSequenceState.operationSequence !== current.operationSequence) {
    throw new SetupCheckpointStoreError("local-authority-mismatch");
  }
  if (
    candidate.generation === current.generation &&
    candidate.configRevision !== current.configRevision
  ) {
    throw new SetupCheckpointStoreError("conflicting-checkpoint");
  }
  if (
    candidate.generation === current.generation &&
    candidate.operationSequence === current.operationSequence &&
    !setupCheckpointStore_checkpointsEqual(current, candidate)
  ) {
    const nextSequenceState = setupCheckpointStore_isSameSequenceTransition(
      current,
      candidate,
      currentSequenceState,
    );
    if (nextSequenceState !== null) return nextSequenceState;
    throw new SetupCheckpointStoreError("conflicting-checkpoint");
  }
  if (
    candidate.generation === current.generation &&
    setupCheckpointStore_isAdmissionTransition(current, candidate)
  ) {
    return { operationSequence: candidate.operationSequence, state: "admitted" };
  }
  if (setupCheckpointStore_isGenerationAdvance(current, candidate)) {
    return setupCheckpointStore_initialSequenceState(candidate);
  }
  throw new SetupCheckpointStoreError("conflicting-checkpoint");
}

async function setupCheckpointStore_readOneFile(filePath: string): Promise<ParsedCheckpointFile> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new SetupCheckpointStoreError("local-read-failed");
    }
    if (stat.size > setupCheckpointStore_maxFileBytes) {
      throw new SetupCheckpointStoreError("local-checkpoint-too-large");
    }

    // Keep one byte of headroom so a file that grows after stat cannot evade the bound.
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > setupCheckpointStore_maxFileBytes) {
      throw new SetupCheckpointStoreError("local-checkpoint-too-large");
    }
    if (offset !== stat.size) {
      return { status: "corrupt" };
    }
    try {
      return {
        status: "ok",
        value: JSON.parse(buffer.subarray(0, offset).toString("utf8")) as unknown,
      };
    } catch {
      return { status: "corrupt" };
    }
  } catch (error) {
    if (error instanceof SetupCheckpointStoreError) throw error;
    if (setupCheckpointStore_isMissingFileError(error)) return { status: "missing" };
    throw new SetupCheckpointStoreError("local-read-failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function setupCheckpointStore_readLocal(
  files: SetupCheckpointStoreFiles,
): Promise<LocalCheckpointRead> {
  const primary = await setupCheckpointStore_readOneFile(files.checkpointPath);
  const backup = await setupCheckpointStore_readOneFile(files.backupPath);

  const selected =
    primary.status === "ok" ? "primary" : backup.status === "ok" ? "backup" : "missing";
  if (selected === "missing") {
    return { primary, backup, envelope: undefined, selected };
  }

  try {
    return {
      primary,
      backup,
      selected,
      envelope: setupCheckpointStore_decodeEnvelope(
        selected === "primary" ? primary.value : backup.value,
      ),
    };
  } catch {
    throw new SetupCheckpointStoreError(
      primary.status === "corrupt" || backup.status === "corrupt"
        ? "local-checkpoint-corrupt"
        : "invalid-envelope",
    );
  }
}

async function setupCheckpointStore_readAuthority(
  authority: SetupCheckpointStoreAuthority,
): Promise<SetupCheckpointStoreAuthorityReadResult> {
  let raw: unknown;
  try {
    raw = await authority.read();
  } catch {
    throw new SetupCheckpointStoreError("authority-unavailable");
  }
  try {
    const result = setupCheckpointStore_decodeAuthorityReadResult(raw);
    return result.state === "unavailable"
      ? (() => {
          throw new SetupCheckpointStoreError("authority-unavailable");
        })()
      : result;
  } catch {
    throw new SetupCheckpointStoreError("authority-unavailable");
  }
}

async function setupCheckpointStore_commitAuthority(
  authority: SetupCheckpointStoreAuthority,
  expectedRevision: string | null,
  checkpoint: SetupCheckpoint,
  sequenceState: SetupCheckpointStoreSequenceState,
): Promise<SetupCheckpointStoreCommitReceipt> {
  const anchor = setupCheckpointStore_anchorFor(checkpoint);
  let raw: unknown;
  try {
    raw = await authority.commit({ expectedRevision, anchor, sequenceState });
  } catch {
    throw new SetupCheckpointStoreError("authority-indeterminate");
  }

  let result: SetupCheckpointStoreAuthorityCommitResult;
  try {
    result = setupCheckpointStore_decodeAuthorityCommitResult(raw);
  } catch {
    throw new SetupCheckpointStoreError("authority-indeterminate");
  }
  if (result.state === "rejected") {
    throw new SetupCheckpointStoreError("authority-rejected");
  }
  if (result.state === "indeterminate") {
    throw new SetupCheckpointStoreError("authority-indeterminate");
  }
  if (!setupCheckpointStore_checkpointsEqual(result.anchor.checkpoint, checkpoint)) {
    throw new SetupCheckpointStoreError("authority-receipt-mismatch");
  }
  if (!setupCheckpointStore_sequenceStatesEqual(result.sequenceState, sequenceState)) {
    throw new SetupCheckpointStoreError("authority-receipt-mismatch");
  }
  return {
    revision: result.revision,
    anchor: result.anchor,
    sequenceState: result.sequenceState,
  };
}

function setupCheckpointStore_serializeEnvelope(envelope: SetupCheckpointStoreEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

async function setupCheckpointStore_writeEnvelope(
  files: SetupCheckpointStoreFiles,
  envelope: SetupCheckpointStoreEnvelope,
  writer: SetupCheckpointStoreWriter,
  receipt?: SetupCheckpointStoreCommitReceipt,
): Promise<void> {
  const decoded = setupCheckpointStore_decodeEnvelope(envelope);
  const contents = setupCheckpointStore_serializeEnvelope(decoded);
  try {
    await writer(files.checkpointPath, contents, setupCheckpointStore_decodeEnvelope);
  } catch {
    throw new SetupCheckpointStoreError("local-promotion-failed", { receipt });
  }
}

function setupCheckpointStore_filesFor(rootDirectory: string): SetupCheckpointStoreFiles {
  if (typeof rootDirectory !== "string" || rootDirectory.trim().length === 0) {
    throw new SetupCheckpointStoreError("invalid-store-root");
  }
  const resolvedRoot = resolve(rootDirectory);
  if (resolvedRoot === resolve("/")) {
    throw new SetupCheckpointStoreError("invalid-store-root");
  }
  const checkpointPath = resolve(resolvedRoot, "setup-checkpoint.json");
  return {
    rootDirectory: resolvedRoot,
    checkpointPath,
    backupPath: `${checkpointPath}.bak`,
  };
}

async function setupCheckpointStore_enqueue<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lane = setupCheckpointStore_queues.get(key) ?? { tail: Promise.resolve() };
  const previous = lane.tail;
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  lane.tail = previous.then(() => current);
  setupCheckpointStore_queues.set(key, lane);
  await previous;
  try {
    return await operation();
  } finally {
    release?.();
    if (setupCheckpointStore_queues.get(key) === lane) {
      await lane.tail;
      if (setupCheckpointStore_queues.get(key) === lane) {
        setupCheckpointStore_queues.delete(key);
      }
    }
  }
}

/**
 * Explicit-root Setup checkpoint persistence.
 *
 * Every public operation holds the root's queue across authority read, local
 * read/validation, conditional authority commit, and local promotion.
 */
export class SetupCheckpointStore {
  readonly files: SetupCheckpointStoreFiles;
  private readonly authority: SetupCheckpointStoreAuthority;
  private readonly writer: SetupCheckpointStoreWriter;

  constructor(
    rootDirectory: string,
    authority: SetupCheckpointStoreAuthority,
    options: SetupCheckpointStoreOptions,
  ) {
    this.files = setupCheckpointStore_filesFor(rootDirectory);
    if (
      typeof authority !== "object" ||
      authority === null ||
      typeof authority.read !== "function" ||
      typeof authority.commit !== "function"
    ) {
      throw new SetupCheckpointStoreError("authority-unavailable");
    }
    this.authority = authority;
    if (typeof options?.write !== "function") {
      throw new SetupCheckpointStoreError("invalid-writer");
    }
    this.writer = options.write;
  }

  /**
   * Create the first checkpoint only when the trusted authority is empty and the
   * caller explicitly authorizes that bootstrap.
   */
  async bootstrap(value: unknown): Promise<SetupCheckpointStorePersistResult> {
    const request = setupCheckpointStore_decodeBootstrapRequest(value);
    const candidate = setupDomain_initialState(
      request.routeId,
      request.generation,
      request.configRevision,
    ).checkpoint;
    const sequenceState = setupCheckpointStore_initialSequenceState(candidate);

    return setupCheckpointStore_enqueue(this.files.checkpointPath, async () => {
      const authority = await setupCheckpointStore_readAuthority(this.authority);
      if (authority.state !== "empty") {
        throw new SetupCheckpointStoreError(
          authority.state === "present" ? "bootstrap-authority-not-empty" : "authority-unavailable",
        );
      }
      let local: LocalCheckpointRead;
      try {
        local = await setupCheckpointStore_readLocal(this.files);
      } catch (error) {
        if (
          error instanceof SetupCheckpointStoreError &&
          (error.code === "invalid-envelope" ||
            error.code === "local-checkpoint-corrupt" ||
            error.code === "local-checkpoint-too-large")
        ) {
          throw new SetupCheckpointStoreError("bootstrap-local-present");
        }
        throw error;
      }
      if (local.primary.status !== "missing" || local.backup.status !== "missing") {
        throw new SetupCheckpointStoreError("bootstrap-local-present");
      }

      const receipt = await setupCheckpointStore_commitAuthority(
        this.authority,
        null,
        candidate,
        sequenceState,
      );
      await setupCheckpointStore_writeEnvelope(
        this.files,
        {
          schemaVersion: setupCheckpointStore_envelopeSchemaVersion,
          authorityRevision: receipt.revision,
          checkpoint: candidate,
          sequenceState,
        },
        this.writer,
        receipt,
      );
      return {
        checkpoint: candidate,
        authorityRevision: receipt.revision,
        sequenceState,
        authorityCommitted: true,
        automaticActions: [],
      };
    });
  }

  /**
   * Conditionally persist a fully formed checkpoint. Active ownership is never
   * accepted by the checkpoint type; retired operations remain part of the
   * candidate and are compared without lossy hashing.
   */
  async save(value: unknown, optionsValue: unknown): Promise<SetupCheckpointStorePersistResult> {
    let candidate: SetupCheckpoint;
    try {
      candidate = setupCentre_decodeCheckpoint(value);
    } catch {
      throw new SetupCheckpointStoreError("invalid-envelope");
    }
    const expectedAuthorityRevision = setupCheckpointStore_decodeSaveOptions(optionsValue);

    return setupCheckpointStore_enqueue(this.files.checkpointPath, async () => {
      const local = await setupCheckpointStore_readLocal(this.files);
      const authority = await setupCheckpointStore_readAuthority(this.authority);
      if (authority.state === "empty") {
        throw new SetupCheckpointStoreError(
          local.selected === "missing" ? "bootstrap-required" : "bootstrap-local-present",
        );
      }
      if (authority.state === "unavailable") {
        throw new SetupCheckpointStoreError("authority-unavailable");
      }
      if (authority.revision !== expectedAuthorityRevision) {
        throw new SetupCheckpointStoreError("stale-authority-revision");
      }
      if (!local.envelope || local.primary.status === "corrupt" || local.selected !== "primary") {
        throw new SetupCheckpointStoreError("local-checkpoint-missing");
      }
      if (
        local.envelope.authorityRevision !== authority.revision ||
        !setupCheckpointStore_checkpointsEqual(
          local.envelope.checkpoint,
          authority.anchor.checkpoint,
        ) ||
        !setupCheckpointStore_sequenceStatesEqual(
          local.envelope.sequenceState,
          authority.sequenceState,
        )
      ) {
        throw new SetupCheckpointStoreError("local-authority-mismatch");
      }

      if (setupCheckpointStore_checkpointsEqual(authority.anchor.checkpoint, candidate)) {
        return {
          checkpoint: candidate,
          authorityRevision: authority.revision,
          sequenceState: authority.sequenceState,
          authorityCommitted: false,
          automaticActions: [],
        };
      }
      const sequenceState = setupCheckpointStore_assertCandidateAdvance(
        authority.anchor.checkpoint,
        candidate,
        authority.sequenceState,
      );

      const receipt = await setupCheckpointStore_commitAuthority(
        this.authority,
        authority.revision,
        candidate,
        sequenceState,
      );
      await setupCheckpointStore_writeEnvelope(
        this.files,
        {
          schemaVersion: setupCheckpointStore_envelopeSchemaVersion,
          authorityRevision: receipt.revision,
          checkpoint: candidate,
          sequenceState,
        },
        this.writer,
        receipt,
      );
      return {
        checkpoint: candidate,
        authorityRevision: receipt.revision,
        sequenceState,
        authorityCommitted: true,
        automaticActions: [],
      };
    });
  }

  /**
   * Reconcile a process restart in one serialized critical section. Trusted
   * authority state is the only recovery source; an older local backup is never
   * promoted or treated as authority.
   */
  async restart(value: unknown): Promise<SetupCheckpointStoreRestartResult> {
    let observation: SetupRestartObservation;
    try {
      observation = setupCentre_decodeRestartObservation(value);
    } catch {
      throw new SetupCheckpointStoreError("invalid-observation");
    }

    return setupCheckpointStore_enqueue(this.files.checkpointPath, async () => {
      const local = await setupCheckpointStore_readLocal(this.files);
      const authority = await setupCheckpointStore_readAuthority(this.authority);
      if (authority.state === "empty") {
        throw new SetupCheckpointStoreError(
          local.selected === "missing" ? "bootstrap-required" : "bootstrap-local-present",
        );
      }
      if (authority.state === "unavailable") {
        throw new SetupCheckpointStoreError("authority-unavailable");
      }
      if (observation.configRevision < authority.anchor.checkpoint.configRevision) {
        throw new SetupCheckpointStoreError("stale-checkpoint");
      }

      let source = authority.anchor.checkpoint;
      let recovery: SetupCheckpointStoreRestartResult["recovery"] = "authority-missing";
      if (local.envelope) {
        const exact =
          local.envelope.authorityRevision === authority.revision &&
          setupCheckpointStore_checkpointsEqual(
            local.envelope.checkpoint,
            authority.anchor.checkpoint,
          ) &&
          setupCheckpointStore_sequenceStatesEqual(
            local.envelope.sequenceState,
            authority.sequenceState,
          );
        if (exact) {
          recovery =
            local.selected === "backup" || local.primary.status === "corrupt"
              ? "authenticated-backup"
              : "none";
        } else if (
          setupCheckpointStore_isSafeAuthorityAdvance(
            local.envelope.checkpoint,
            authority.anchor.checkpoint,
            local.envelope.sequenceState,
          )
        ) {
          // A trusted forward authority state may follow an interrupted
          // authority commit. The local candidate and any backup are discarded;
          // only the complete authority anchor is used for recovery.
          recovery = "authority-commit-interrupted";
        } else {
          throw new SetupCheckpointStoreError("local-authority-mismatch");
        }
      } else if (local.primary.status === "corrupt" || local.backup.status === "corrupt") {
        throw new SetupCheckpointStoreError("local-checkpoint-corrupt");
      } else if (local.primary.status !== "missing" || local.backup.status !== "missing") {
        throw new SetupCheckpointStoreError("local-checkpoint-missing");
      }

      const reconciled = setupDomain_reconcileRestart(source, observation, authority.anchor);
      const candidate = reconciled.state.checkpoint;
      const sequenceState = setupCheckpointStore_initialSequenceState(candidate);
      const receipt = await setupCheckpointStore_commitAuthority(
        this.authority,
        authority.revision,
        candidate,
        sequenceState,
      );
      await setupCheckpointStore_writeEnvelope(
        this.files,
        {
          schemaVersion: setupCheckpointStore_envelopeSchemaVersion,
          authorityRevision: receipt.revision,
          checkpoint: candidate,
          sequenceState,
        },
        this.writer,
        receipt,
      );
      return {
        state: reconciled.state,
        checkpoint: candidate,
        authorityRevision: receipt.revision,
        sequenceState,
        recovery,
        restart: reconciled,
        automaticActions: [],
      };
    });
  }

  /** Semantic alias for callers that name the boot operation "load". */
  load(value: unknown): Promise<SetupCheckpointStoreRestartResult> {
    return this.restart(value);
  }
}
