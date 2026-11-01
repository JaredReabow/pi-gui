/**
 * Pure permission mapping and recovery domain.
 *
 * This module does not discover identity, call a native API, open Settings,
 * reveal or drag an app, run a feature, read a clock, or retain global state.
 */

import {
  permission_capabilityIds,
  permission_decodeAuthorizationObservation,
  permission_decodeBinding,
  permission_decodeCapabilityDescriptor,
  permission_decodeCapabilityId,
  permission_decodeDragOutcome,
  permission_decodeEvidence,
  permission_decodeFeatureOperation,
  permission_decodeInstalledRecipient,
  permission_decodePane,
  permission_decodePaneEvidence,
  permission_decodeRecoveryInput,
  permission_decodeRevealAttempt,
  permission_decodeRequestOutcome,
  permission_decodeScope,
  permission_decodeSettingsOpenAttempt,
  permission_decodeSupportTuple,
  permission_isStableInstalledBundlePath,
  permission_paneCapabilityIds,
  PermissionInstalledIdentityError,
  permission_reasonCodes,
  permission_sameBinding,
  permission_sameRecipient,
  permission_scopeKinds,
  type InstalledRecipient,
  type PermissionAuthorizationObservation,
  type PermissionBinding,
  type PermissionCapabilityDescriptor,
  type PermissionCapabilityId,
  type PermissionDragOutcome,
  type PermissionEvidence,
  type PermissionFeatureOperation,
  type PermissionManualAddState,
  type PermissionPane,
  type PermissionPaneEvidence,
  type PermissionReasonCode,
  type PermissionRecoveryDecision,
  type PermissionRecoveryInstruction,
  type PermissionRecoveryInput,
  type PermissionRevealAttempt,
  type PermissionRequestOutcome,
  type PermissionScope,
  type PermissionSettingsOpenAttempt,
  type PermissionSupportTuple,
} from "../../contracts/permissions";

export interface PermissionDomainState {
  readonly binding: PermissionBinding;
  readonly authorization: PermissionAuthorizationObservation | null;
  readonly latestEvidenceAt: number;
  readonly lastAuthorizationAt: number | null;
  readonly appliedEvidence: readonly PermissionEvidence[];
}

export interface PermissionPaneGuidance {
  readonly pane: PermissionPane;
  readonly capabilityId: PermissionCapabilityId;
  readonly manualAdd: PermissionManualAddState;
  readonly dragAcceptance: "available" | "unavailable" | "prohibited";
  readonly showInFinder: "available" | "unavailable";
  readonly openAttempt: "not-attempted";
  readonly recovery: readonly PermissionRecoveryInstruction[];
}

export interface PermissionFailure {
  readonly kind: "permission-error";
  readonly reasonCode: PermissionReasonCode;
  readonly authorization: null;
  readonly featureSucceeded: false;
  readonly retry: "inspect" | "reselect" | "none";
}

const permissionDomain_manualAdd: Readonly<Record<PermissionPane, PermissionManualAddState>> = {
  accessibility: "documented",
  automation: "not-documented",
  "files-and-folders": "not-documented",
  camera: "not-documented",
  microphone: "not-documented",
  notifications: "not-documented",
  "screen-and-system-audio-recording": "documented",
  "full-disk-access": "documented",
};

const permissionDomain_recovery: Readonly<
  Record<PermissionPane, readonly PermissionRecoveryInstruction[]>
> = {
  accessibility: [
    "open-settings",
    "show-in-finder",
    "feature-triggered-request",
    "inspect-authorization",
  ],
  automation: ["open-settings", "feature-triggered-request", "keep-feature-fallback"],
  "files-and-folders": [
    "open-settings",
    "feature-triggered-request",
    "reselect-scope",
    "keep-feature-fallback",
  ],
  camera: ["open-settings", "feature-triggered-request", "keep-feature-fallback"],
  microphone: ["open-settings", "feature-triggered-request", "keep-feature-fallback"],
  notifications: ["open-settings", "keep-feature-fallback", "inspect-authorization"],
  "screen-and-system-audio-recording": [
    "open-settings",
    "show-in-finder",
    "feature-triggered-request",
    "inspect-authorization",
  ],
  "full-disk-access": ["select-narrower-resource", "keep-feature-fallback"],
};

function permissionDomain_isMainInstalledRecipient(recipient: InstalledRecipient): boolean {
  return (
    recipient.kind === "main-app" &&
    recipient.status === "verified" &&
    recipient.platform === "macos" &&
    recipient.identitySource !== "unverified" &&
    recipient.bundleIdentifier !== null &&
    recipient.bundlePath !== null &&
    permission_isStableInstalledBundlePath(recipient.bundlePath)
  );
}

function permissionDomain_paneEvidenceMatches(
  binding: PermissionBinding,
  pane: PermissionPane,
  evidence: PermissionPaneEvidence | null,
): boolean {
  return (
    evidence !== null &&
    evidence.source === "native" &&
    evidence.dragEvidence === "verified" &&
    evidence.pane === pane &&
    evidence.binding.capabilityId === permission_paneCapabilityIds[pane] &&
    permission_sameBinding(binding, evidence.binding)
  );
}

/** Map one external observation without changing its source or authorization state. */
export function permission_observation(value: unknown): PermissionAuthorizationObservation {
  return permission_decodeAuthorizationObservation(value);
}

/** Map a request receipt. A denial is not promoted into reported authorization. */
export function permission_request_outcome(value: unknown): PermissionRequestOutcome {
  return permission_decodeRequestOutcome(value);
}

/** Map a Settings launch attempt. It never constructs an authorization observation. */
export function permission_settings_open_outcome(value: unknown): PermissionSettingsOpenAttempt {
  return permission_decodeSettingsOpenAttempt(value);
}

/** Validate an installed recipient without resolving or substituting one. */
export function permission_installed_app_identity(value: unknown): InstalledRecipient {
  return permission_decodeInstalledRecipient(value);
}

/**
 * Return pane guidance. Installed-app actions require a verified parent app.
 * Drag is unavailable unless exact native pane evidence matches this binding.
 */
export function permission_pane_guidance(
  recipientValue: unknown,
  paneValue: unknown,
  bindingValue: unknown,
  paneEvidenceValue: unknown = null,
): PermissionPaneGuidance {
  const pane = permission_decodePane(paneValue);
  const capabilityId = permission_paneCapabilityIds[pane];
  let recipient: InstalledRecipient;
  let binding: PermissionBinding;
  try {
    recipient = permission_decodeInstalledRecipient(recipientValue);
    binding = permission_decodeBinding(bindingValue);
  } catch (error) {
    if (error instanceof PermissionInstalledIdentityError) {
      return permissionDomain_unavailablePaneGuidance(pane);
    }
    throw error;
  }
  const paneEvidence =
    paneEvidenceValue === null ? null : permission_decodePaneEvidence(paneEvidenceValue);
  if (
    binding.capabilityId !== capabilityId ||
    binding.platform !== recipient.platform ||
    !permission_sameRecipient(binding.recipient, recipient)
  ) {
    throw new TypeError("pane guidance recipient, capability, and binding differ.");
  }
  const appActionsAvailable =
    permissionDomain_isMainInstalledRecipient(recipient) && pane !== "full-disk-access";
  const dragAvailable =
    appActionsAvailable &&
    permissionDomain_manualAdd[pane] === "documented" &&
    permissionDomain_paneEvidenceMatches(binding, pane, paneEvidence);
  return {
    pane,
    capabilityId,
    manualAdd: permissionDomain_manualAdd[pane],
    dragAcceptance:
      pane === "full-disk-access" ? "prohibited" : dragAvailable ? "available" : "unavailable",
    showInFinder: appActionsAvailable ? "available" : "unavailable",
    openAttempt: "not-attempted",
    recovery: [...permissionDomain_recovery[pane]],
  };
}

function permissionDomain_unavailablePaneGuidance(pane: PermissionPane): PermissionPaneGuidance {
  return {
    pane,
    capabilityId: permission_paneCapabilityIds[pane],
    manualAdd: permissionDomain_manualAdd[pane],
    dragAcceptance: pane === "full-disk-access" ? "prohibited" : "unavailable",
    showInFinder: "unavailable",
    openAttempt: "not-attempted",
    recovery: [...permissionDomain_recovery[pane]],
  };
}

/** Validate a reveal interaction receipt without changing authorization. */
export function permission_reveal_outcome(value: unknown): PermissionRevealAttempt {
  const reveal = permission_decodeRevealAttempt(value);
  if (
    reveal.state === "accepted" &&
    (reveal.pane === null ||
      reveal.binding.capabilityId !== permission_paneCapabilityIds[reveal.pane] ||
      !permissionDomain_isMainInstalledRecipient(reveal.binding.recipient))
  ) {
    throw new TypeError("accepted reveal interactions require a verified installed parent app.");
  }
  return reveal;
}

/** Validate a drag interaction receipt without changing authorization. */
export function permission_drag_outcome(value: unknown): PermissionDragOutcome {
  const drag = permission_decodeDragOutcome(value);
  if (drag.result === "started") {
    if (
      drag.source !== "native" ||
      !permissionDomain_isMainInstalledRecipient(drag.binding.recipient) ||
      permissionDomain_manualAdd[drag.pane] !== "documented" ||
      drag.pane === "full-disk-access"
    ) {
      throw new TypeError(
        "started drag interactions require native evidence for a documented installed-app pane.",
      );
    }
  }
  return drag;
}

/** Validate a feature receipt without changing authorization. */
export function permission_feature_receipt(value: unknown): PermissionFeatureOperation {
  return permission_decodeFeatureOperation(value);
}

/** Convert a closed error reason without accepting or forwarding raw native text. */
export function permission_error(value: unknown): PermissionFailure {
  const reasonCode =
    typeof value === "string" && permission_reasonCodes.includes(value as PermissionReasonCode)
      ? (value as PermissionReasonCode)
      : "unknown";
  return {
    kind: "permission-error",
    reasonCode,
    authorization: null,
    featureSucceeded: false,
    retry:
      reasonCode === "stale-scope"
        ? "reselect"
        : reasonCode === "unknown" || reasonCode === "probe-failed"
          ? "inspect"
          : "none",
  };
}

/** Return applicability only for an exact supplied support tuple. */
export function permission_applicability(
  descriptorValue: unknown,
  supportValue: unknown,
  scopeValue: unknown,
): "supported" | "unsupported" | "unavailable" | "unknown" {
  const descriptor = permission_decodeCapabilityDescriptor(descriptorValue);
  const support = permission_decodeSupportTuple(supportValue);
  const scope = permission_decodeScope(scopeValue);
  if (descriptor.platform !== support.platform || !descriptor.scopeKinds.includes(scope.kind)) {
    return "unsupported";
  }
  const matching = descriptor.support.find(
    (entry) =>
      entry.support.platform === support.platform &&
      entry.support.osVersion === support.osVersion &&
      entry.support.osBuild === support.osBuild &&
      entry.support.architecture === support.architecture &&
      entry.support.packageFormat === support.packageFormat &&
      entry.support.installerIdentity === support.installerIdentity &&
      entry.support.signerIdentity === support.signerIdentity &&
      entry.support.installedIdentityKey === support.installedIdentityKey &&
      entry.support.apiVersion === support.apiVersion &&
      entry.support.desktopSession === support.desktopSession &&
      entry.support.scopeKey === support.scopeKey,
  );
  return matching?.status ?? "unsupported";
}

/** Create empty state for one exact permission binding. */
export function permission_domain_createState(value: unknown): PermissionDomainState {
  return {
    binding: permission_decodeBinding(value),
    authorization: null,
    latestEvidenceAt: -1,
    lastAuthorizationAt: null,
    appliedEvidence: [],
  };
}

function permissionDomain_sameEvidence(
  left: PermissionEvidence,
  right: PermissionEvidence,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Apply ordered evidence. Only reported authorization changes authorization.
 * Cross-recipient/scope/support/generation and stale evidence are rejected.
 */
export function permission_domain_applyEvidence(
  stateValue: PermissionDomainState,
  evidenceValue: unknown,
): PermissionDomainState {
  const state = stateValue;
  const evidence = permission_decodeEvidence(evidenceValue);
  if (!permission_sameBinding(state.binding, evidence.binding)) {
    throw new TypeError("permission evidence binding does not match the active state.");
  }
  const prior = state.appliedEvidence.find((item) => item.evidenceId === evidence.evidenceId);
  if (prior !== undefined) {
    if (!permissionDomain_sameEvidence(prior, evidence)) {
      throw new TypeError("permission evidence id was reused with different content.");
    }
    return state;
  }
  if (evidence.recordedAt < state.latestEvidenceAt) {
    throw new TypeError("permission evidence is stale.");
  }
  if (
    evidence.kind === "reported-authorization" &&
    state.lastAuthorizationAt !== null &&
    evidence.recordedAt <= state.lastAuthorizationAt
  ) {
    throw new TypeError("authorization evidence is stale or out of order.");
  }
  if (state.appliedEvidence.length >= 64) {
    throw new TypeError("permission state evidence history is full.");
  }
  return {
    binding: state.binding,
    authorization: evidence.kind === "reported-authorization" ? evidence : state.authorization,
    latestEvidenceAt: evidence.recordedAt,
    lastAuthorizationAt:
      evidence.kind === "reported-authorization" ? evidence.recordedAt : state.lastAuthorizationAt,
    appliedEvidence: [...state.appliedEvidence, evidence],
  };
}

function permissionDomain_assertRecoveryEvidence(input: PermissionRecoveryInput): void {
  const { trigger, evidence } = input;
  if (evidence.recordedAt > input.occurredAt) {
    throw new TypeError("recovery evidence cannot postdate the recovery event.");
  }
  const authorizationObservation = evidence.kind === "reported-authorization" ? evidence : null;
  if (
    (trigger === "denied" ||
      trigger === "unknown" ||
      trigger === "restricted-managed" ||
      trigger === "revoked") &&
    authorizationObservation === null
  ) {
    throw new TypeError(`${trigger} recovery requires a reported authorization observation.`);
  }
  if (trigger === "denied" && authorizationObservation?.authorization !== "denied") {
    throw new TypeError("denial recovery requires a denied authorization observation.");
  }
  if (
    trigger === "unknown" &&
    (authorizationObservation === null ||
      !["unknown", "unsupported", "unavailable"].includes(authorizationObservation.authorization))
  ) {
    throw new TypeError("unknown recovery requires unknown, unsupported, or unavailable evidence.");
  }
  if (
    trigger === "restricted-managed" &&
    authorizationObservation?.authorization !== "restricted-managed"
  ) {
    throw new TypeError("managed recovery requires restricted-managed evidence.");
  }
  if (
    trigger === "revoked" &&
    (authorizationObservation?.authorization !== "denied" ||
      authorizationObservation.reasonCode !== "revoked")
  ) {
    throw new TypeError("revocation recovery requires denied/revoked evidence.");
  }
  if (trigger === "returned-from-settings" && evidence.kind !== "settings-open-attempt") {
    throw new TypeError("return recovery requires a Settings-open attempt.");
  }
  if (trigger === "stale-scope" && evidence.reasonCode !== "stale-scope") {
    throw new TypeError("stale-scope recovery requires stale-scope evidence.");
  }
}

/**
 * Project recovery from explicit evidence. Restart and return request inspection
 * only; this function never performs an action or creates authorization.
 */
export function permission_recovery(value: unknown): PermissionRecoveryDecision {
  const input = permission_decodeRecoveryInput(value);
  permissionDomain_assertRecoveryEvidence(input);
  const instructions: Readonly<
    Record<PermissionRecoveryType, readonly PermissionRecoveryInstruction[]>
  > = {
    denied: ["open-settings", "keep-feature-fallback"],
    unknown: ["inspect-authorization", "keep-feature-fallback"],
    "restricted-managed": ["administrator-guidance", "inspect-authorization"],
    "returned-from-settings": ["inspect-authorization"],
    revoked: ["inspect-authorization", "open-settings", "keep-feature-fallback"],
    "stale-scope": ["reselect-scope", "inspect-authorization"],
    restart: ["inspect-authorization"],
  };
  return {
    trigger: input.trigger,
    occurredAt: input.occurredAt,
    evidenceId: input.evidence.evidenceId,
    instructions: [...instructions[input.trigger]],
    requiresInspection: true,
    grantsAuthorization: false,
    reportsFeatureSuccess: false,
    requestsPermissionAction: false,
    requestsFeatureAction: false,
  };
}

type PermissionRecoveryType = PermissionRecoveryInput["trigger"];

/** Exposed closed constants for adapter and UI policy tests. */
export const permissionDomain_capabilityIds = permission_capabilityIds;
export const permissionDomain_paneCapabilities = permission_paneCapabilityIds;
export const permissionDomain_scopeKinds = permission_scopeKinds;

/** Validate descriptor input through the public domain boundary. */
export function permission_domain_capabilityDescriptor(
  value: unknown,
): PermissionCapabilityDescriptor {
  return permission_decodeCapabilityDescriptor(value);
}

/** Validate a capability identifier through the public domain boundary. */
export function permission_domain_capabilityId(value: unknown): PermissionCapabilityId {
  return permission_decodeCapabilityId(value);
}

/** Validate a feature operation and return its separate receipt. */
export function permission_feature_operation(value: unknown): PermissionFeatureOperation {
  return permission_decodeFeatureOperation(value);
}

/** Validate scope data through the public domain boundary. */
export function permission_domain_scope(value: unknown): PermissionScope {
  return permission_decodeScope(value);
}

/** Validate support data through the public domain boundary. */
export function permission_domain_support(value: unknown): PermissionSupportTuple {
  return permission_decodeSupportTuple(value);
}
