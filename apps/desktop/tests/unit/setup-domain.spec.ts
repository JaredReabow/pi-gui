import { expect, test } from "@playwright/test";
import {
  setupPersistence_schemaVersion,
  setupCentre_checkpointAnchorSchemaVersion,
  setupCentre_schemaVersion,
  setupCentre_stepIds,
  type SetupCheckpoint,
  type SetupCheckpointAnchor,
  type SetupComponentFacts,
  type SetupLogicalOperation,
  type SetupOperationRequest,
  type SetupPersistenceAuthorityState,
  type SetupPersistenceCursor,
  type SetupPersistenceIdentity,
  type SetupPersistenceTransitionRequest,
  type SetupRouteId,
  type SetupStepId,
} from "../../contracts/setup-centre";
import {
  setupDomain_acceptResult,
  setupDomain_applyCancellationReceipt,
  setupDomain_beginOperation,
  setupDomain_changeConfiguration,
  setupDomain_createState,
  setupDomain_exportCheckpoint,
  setupDomain_initialCheckpoint,
  setupDomain_initialState,
  setupDomain_persistenceIdentityFromOperation,
  setupDomain_projectStatus,
  setupDomain_reconcileRestart,
  setupDomain_requestCancellation,
  setupDomain_routeSteps,
  setupDomain_roundTripCheckpoint,
  setupDomain_validatePersistenceTransition,
  type SetupDomainState,
} from "../../electron/setup/setup-domain";

const at = 1_764_000_000_100;

function request(
  state: SetupDomainState,
  step: SetupStepId,
  overrides: Partial<SetupOperationRequest> = {},
): SetupOperationRequest {
  return {
    operationId: `op-${step}`,
    routeId: state.checkpoint.routeId,
    step,
    resourceKey: {
      componentId: state.checkpoint.componentId,
      resource: step,
      scopeId: "setup-primary",
    },
    mode: step === "probe" ? "probe" : step === "detection" ? "inspect" : "mutate",
    generation: state.checkpoint.generation,
    configRevision: state.checkpoint.configRevision,
    startedBy: "user",
    ...overrides,
  };
}

function result(
  operation: SetupLogicalOperation,
  overrides: Partial<{
    operationId: string;
    generation: number;
    configRevision: number;
    state: "verified" | "present-unverified" | "not-detected" | "unsupported" | "unknown";
    observedAt: number;
    step: SetupStepId;
  }> = {},
) {
  const step = overrides.step ?? operation.request.step;
  return {
    operationId: overrides.operationId ?? operation.request.operationId,
    routeId: operation.request.routeId,
    step,
    resourceKey:
      step === operation.request.step
        ? operation.request.resourceKey
        : { ...operation.request.resourceKey, resource: step },
    generation: overrides.generation ?? operation.request.generation,
    configRevision: overrides.configRevision ?? operation.request.configRevision,
    fact: {
      dimension: step,
      state: overrides.state ?? ("verified" as const),
      observedAt: overrides.observedAt ?? at,
      reasonCode: overrides.state === "unknown" ? ("probe-unknown" as const) : null,
    },
  };
}

function checkpointWith(
  routeId: SetupRouteId,
  states: Partial<Record<SetupStepId, "pending" | "complete" | "skipped">> = {},
): SetupCheckpoint {
  const base = setupDomain_initialCheckpoint(routeId);
  return setupDomain_roundTripCheckpoint({
    ...base,
    progress: {
      ...base.progress,
      steps: base.progress.steps.map((step) => ({
        ...step,
        state: states[step.step] ?? step.state,
      })),
    },
  });
}

function anchorFor(checkpoint: SetupCheckpoint): SetupCheckpointAnchor {
  return {
    schemaVersion: setupCentre_checkpointAnchorSchemaVersion,
    authority: "persistence-owner",
    checkpoint: structuredClone(checkpoint),
  };
}

function authorityState(
  cursor: SetupPersistenceCursor,
  authorityRevision = 0,
): SetupPersistenceAuthorityState {
  return {
    schemaVersion: setupPersistence_schemaVersion,
    authority: "persistence-owner",
    authorityRevision,
    cursor,
  };
}

function stopOperation(
  state: SetupDomainState,
  operationId: string,
  openedAt: number,
): SetupDomainState {
  const begun = setupDomain_beginOperation(
    state,
    request(state, "detection", { operationId }),
    openedAt,
  );
  const intent = setupDomain_requestCancellation(
    begun.state,
    {
      cancellationId: `cancel-${operationId}`,
      operationId,
      generation: begun.operation.request.generation,
      configRevision: begun.operation.request.configRevision,
      reason: "user-cancelled",
    },
    openedAt + 1,
  );
  return setupDomain_applyCancellationReceipt(intent.state, {
    kind: "cancellation-receipt",
    cancellationId: `cancel-${operationId}`,
    operationId,
    generation: begun.operation.request.generation,
    configRevision: begun.operation.request.configRevision,
    outcome: "stopped",
    effects: "none",
    observedAt: openedAt + 2,
  }).state;
}

function factsFor(
  routeId: SetupRouteId,
  states: Partial<Record<SetupStepId, SetupComponentFacts["facts"][number]["state"]>> = {},
): SetupComponentFacts {
  const checkpoint = setupDomain_initialCheckpoint(routeId);
  return {
    componentId: checkpoint.componentId,
    ownership: routeId === "direct-provider" ? "bundled" : "user-managed",
    generation: checkpoint.generation,
    configRevision: checkpoint.configRevision,
    facts: setupCentre_stepIds
      .filter((step) => states[step] !== undefined)
      .map((step) => ({
        dimension: step,
        state: states[step]!,
        observedAt: at,
        reasonCode:
          states[step] === "not-detected"
            ? ("not-found" as const)
            : states[step] === "unknown"
              ? ("probe-unknown" as const)
              : null,
      })),
  };
}

function completedDirectState(): SetupDomainState {
  const checkpoint = checkpointWith("direct-provider", {
    detection: "complete",
    installation: "complete",
    account: "complete",
    catalogue: "complete",
    probe: "complete",
  });
  return setupDomain_createState(
    checkpoint,
    factsFor("direct-provider", {
      detection: "verified",
      installation: "verified",
      account: "verified",
      catalogue: "verified",
      probe: "verified",
    }),
  );
}

test("direct provider readiness requires all route facts and stays independent of Router and MCP", () => {
  const ready = setupDomain_projectStatus(completedDirectState());
  expect(ready).toMatchObject({
    routeId: "direct-provider",
    componentId: "direct-provider",
    readiness: "ready",
    ready: true,
    currentStep: null,
    handoff: null,
  });
  expect(ready.steps.map((step) => step.step)).toEqual([
    "detection",
    "installation",
    "account",
    "catalogue",
    "probe",
  ]);
  expect(JSON.stringify(ready)).not.toMatch(/codex-router|browser-mcp-companion/);

  const endpointOnly = setupDomain_createState(
    checkpointWith("codex-router", { endpoint: "complete" }),
    factsFor("codex-router", { endpoint: "verified" }),
  );
  const projection = setupDomain_projectStatus(endpointOnly);
  expect(projection.ready).toBe(false);
  expect(projection.readiness).not.toBe("ready");
});

test("opened, listed and reachable facts remain separate and never collapse into readiness", () => {
  const checkpoint = checkpointWith("codex-router", {
    detection: "complete",
    installation: "complete",
    process: "complete",
    endpoint: "complete",
    account: "complete",
    catalogue: "complete",
    probe: "pending",
  });
  const state = setupDomain_createState(
    checkpoint,
    factsFor("codex-router", {
      detection: "verified",
      installation: "verified",
      process: "present-unverified",
      endpoint: "present-unverified",
      account: "present-unverified",
      catalogue: "present-unverified",
    }),
  );
  const projection = setupDomain_projectStatus(state);
  expect(projection.ready).toBe(false);
  expect(projection.readiness).toBe("needs-process");
  expect(projection.steps.map((step) => [step.step, step.evidence])).toEqual([
    ["detection", "verified"],
    ["installation", "verified"],
    ["process", "present-unverified"],
    ["endpoint", "present-unverified"],
    ["account", "present-unverified"],
    ["catalogue", "present-unverified"],
    ["permission", "unknown"],
    ["probe", "unknown"],
  ]);

  const notReadyInstall = setupDomain_projectStatus(
    setupDomain_createState(
      checkpointWith("codex-router", {
        detection: "complete",
        installation: "complete",
      }),
      factsFor("codex-router", {
        detection: "verified",
        installation: "present-unverified",
      }),
    ),
  );
  expect(notReadyInstall.readiness).toBe("needs-install");
});

test("unknown and unsupported facts trigger inspection or unsupported status", () => {
  const unknown = setupDomain_createState(
    checkpointWith("direct-provider", { detection: "complete" }),
    factsFor("direct-provider", { detection: "unknown" }),
  );
  expect(setupDomain_projectStatus(unknown)).toMatchObject({
    readiness: "needs-inspection",
    ready: false,
    requiresInspection: true,
    currentStep: "detection",
  });

  const unsupported = setupDomain_createState(
    checkpointWith("browser-mcp-companion"),
    factsFor("browser-mcp-companion", { detection: "unsupported" }),
  );
  const projection = setupDomain_projectStatus(unsupported);
  expect(projection.readiness).toBe("unsupported");
  expect(projection.ready).toBe(false);
  expect(projection.handoff).toBeNull();
});

test("optional route steps may be skipped without becoming ready on their own", () => {
  const checkpoint = checkpointWith("global-ssh-connect", {
    detection: "complete",
    installation: "complete",
    process: "complete",
    endpoint: "skipped",
    account: "skipped",
    permission: "pending",
    probe: "pending",
  });
  const beforeApproval = setupDomain_createState(
    checkpoint,
    factsFor("global-ssh-connect", {
      detection: "verified",
      installation: "verified",
      process: "verified",
      permission: "not-detected",
    }),
  );
  expect(setupDomain_projectStatus(beforeApproval)).toMatchObject({
    readiness: "needs-permission",
    currentStep: "permission",
  });
  expect(() =>
    setupDomain_roundTripCheckpoint({
      ...setupDomain_initialCheckpoint("direct-provider"),
      progress: {
        ...setupDomain_initialCheckpoint("direct-provider").progress,
        steps: setupDomain_initialCheckpoint("direct-provider").progress.steps.map((step) =>
          step.step === "account" ? { ...step, state: "skipped" } : step,
        ),
      },
    }),
  ).toThrow(/required setup steps/);
});

test("one owner, current step, generation and operation identity gate every result", () => {
  const initial = setupDomain_initialState("direct-provider");
  expect(() => setupDomain_beginOperation(initial, request(initial, "account"), at)).toThrow(
    /current setup step/,
  );
  const begun = setupDomain_beginOperation(initial, request(initial, "detection"), at);
  expect(begun.state.activeOperation?.state).toBe("owned");
  expect(() =>
    setupDomain_beginOperation(begun.state, request(begun.state, "installation"), at),
  ).toThrow(/active resource owner/);
  expect(() =>
    setupDomain_acceptResult(begun.state, result(begun.operation, { operationId: "other" })),
  ).toThrow(/stale/);
  expect(() =>
    setupDomain_acceptResult(begun.state, result(begun.operation, { generation: 2 })),
  ).toThrow(/stale/);
  expect(() =>
    setupDomain_acceptResult(begun.state, result(begun.operation, { observedAt: at - 1 })),
  ).toThrow(/predates/);

  const accepted = setupDomain_acceptResult(begun.state, result(begun.operation));
  expect(accepted.activeOperation).toBeNull();
  expect(accepted.checkpoint.progress.steps[0]?.state).toBe("complete");
  expect(accepted.checkpoint.lastCompletedOperationId).toBe("op-detection");
  expect(setupDomain_projectStatus(accepted).currentStep).toBe("installation");
});

test("cancellation intent is not a confirmed receipt and late results cannot overwrite it", () => {
  const initial = setupDomain_initialState("direct-provider");
  const begun = setupDomain_beginOperation(initial, request(initial, "detection"), at);
  const cancellation = setupDomain_requestCancellation(
    begun.state,
    {
      cancellationId: "cancel-1",
      operationId: begun.operation.request.operationId,
      generation: begun.operation.request.generation,
      configRevision: begun.operation.request.configRevision,
      reason: "user-cancelled",
    },
    at + 1,
  );
  expect(cancellation.intent.kind).toBe("cancellation-intent");
  expect(cancellation.state.activeOperation).not.toBeNull();
  expect(cancellation.state.requiresInspection).toBe(false);
  expect(() =>
    setupDomain_acceptResult(cancellation.state, result(begun.operation, { observedAt: at + 2 })),
  ).toThrow(/pending cancellation receipt/);

  const applied = setupDomain_applyCancellationReceipt(cancellation.state, {
    kind: "cancellation-receipt",
    cancellationId: "cancel-1",
    operationId: begun.operation.request.operationId,
    generation: begun.operation.request.generation,
    configRevision: begun.operation.request.configRevision,
    outcome: "stopped",
    effects: "none",
    observedAt: at + 3,
  });
  expect(applied.ownershipReleased).toBe(true);
  expect(applied.requiresInspection).toBe(false);
  expect(applied.state.activeOperation).toBeNull();
  expect(applied.state.cancellationIntent).toBeNull();
  expect(() =>
    setupDomain_applyCancellationReceipt(applied.state, {
      kind: "cancellation-receipt",
      cancellationId: "cancel-1",
      operationId: begun.operation.request.operationId,
      generation: begun.operation.request.generation,
      configRevision: begun.operation.request.configRevision,
      outcome: "stopped",
      effects: "none",
      observedAt: at + 4,
    }),
  ).toThrow(/matching intent and owner/);
});

test("confirmed cancellation retires the operation identity and permits only a new sequence", () => {
  const initial = setupDomain_initialState("direct-provider");
  const first = setupDomain_beginOperation(
    initial,
    request(initial, "detection", { operationId: "op-first" }),
    at,
  );
  const cancellation = setupDomain_requestCancellation(
    first.state,
    {
      cancellationId: "cancel-first",
      operationId: "op-first",
      generation: 1,
      configRevision: 1,
      reason: "user-cancelled",
    },
    at + 1,
  );
  const cancelled = setupDomain_applyCancellationReceipt(cancellation.state, {
    kind: "cancellation-receipt",
    cancellationId: "cancel-first",
    operationId: "op-first",
    generation: 1,
    configRevision: 1,
    outcome: "stopped",
    effects: "none",
    observedAt: at + 2,
  });
  expect(cancelled.retiredOperation).toMatchObject({
    operationId: "op-first",
    operationSequence: 1,
    generation: 1,
    outcome: "stopped",
  });
  expect(cancelled.state.checkpoint.operationSequence).toBe(1);
  expect(() =>
    setupDomain_beginOperation(
      cancelled.state,
      request(cancelled.state, "detection", {
        operationId: "op-first",
      }),
      at + 3,
    ),
  ).toThrow(/retired/);
  const replacement = setupDomain_beginOperation(
    cancelled.state,
    request(cancelled.state, "detection", {
      operationId: "op-second",
    }),
    at + 4,
  );
  expect(replacement.operation.operationSequence).toBe(2);
  expect(replacement.operation.request.resourceKey).toEqual(first.operation.request.resourceKey);
  expect(() =>
    setupDomain_acceptResult(replacement.state, result(first.operation, { observedAt: at + 5 })),
  ).toThrow(/retired operation/);
  const completed = setupDomain_acceptResult(
    replacement.state,
    result(replacement.operation, { observedAt: at + 6 }),
  );
  expect(completed.activeOperation).toBeNull();
  expect(completed.checkpoint.operationSequence).toBe(2);
  expect(completed.checkpoint.retiredOperations).toHaveLength(1);
});

test("retired operations and sequence high-water marks survive restart", () => {
  const initial = setupDomain_initialState("direct-provider");
  const first = setupDomain_beginOperation(
    initial,
    request(initial, "detection", { operationId: "op-before-restart" }),
    at,
  );
  const cancellation = setupDomain_requestCancellation(
    first.state,
    {
      cancellationId: "cancel-before-restart",
      operationId: "op-before-restart",
      generation: 1,
      configRevision: 1,
      reason: "application-stopping",
    },
    at + 1,
  );
  const cancelled = setupDomain_applyCancellationReceipt(cancellation.state, {
    kind: "cancellation-receipt",
    cancellationId: "cancel-before-restart",
    operationId: "op-before-restart",
    generation: 1,
    configRevision: 1,
    outcome: "never-started",
    effects: "none",
    observedAt: at + 2,
  });
  const checkpoint = setupDomain_exportCheckpoint(cancelled.state);
  const restarted = setupDomain_reconcileRestart(
    checkpoint,
    {
      restartId: "restart-retired-1",
      configRevision: 1,
    },
    anchorFor(checkpoint),
  );
  expect(restarted.state.checkpoint.operationSequence).toBe(1);
  expect(restarted.state.checkpoint.retiredOperations).toHaveLength(1);
  expect(() =>
    setupDomain_beginOperation(
      restarted.state,
      request(restarted.state, "detection", {
        operationId: "op-before-restart",
        mode: "inspect",
      }),
      at + 3,
    ),
  ).toThrow(/retired/);
});

test("restart fails closed for absent, forged, rolled-back and truncated anchors", () => {
  const initial = setupDomain_initialState("direct-provider");
  const once = stopOperation(initial, "op-anchored-1", at);
  const valid = setupDomain_exportCheckpoint(once);
  const observation = { restartId: "restart-anchor-check", configRevision: 1 };
  expect(() => setupDomain_reconcileRestart(valid, observation, undefined)).toThrow(/anchor/);

  const forged = setupDomain_roundTripCheckpoint({
    ...valid,
    operationSequence: 0,
    retiredOperations: [],
  });
  expect(() => setupDomain_reconcileRestart(forged, observation, anchorFor(valid))).toThrow(
    /persistence-owner anchor/,
  );
  expect(() =>
    setupDomain_reconcileRestart(initial.checkpoint, observation, anchorFor(valid)),
  ).toThrow(/persistence-owner anchor/);

  const twice = stopOperation(once, "op-anchored-2", at + 10);
  const complete = setupDomain_exportCheckpoint(twice);
  const truncated = setupDomain_roundTripCheckpoint({
    ...complete,
    operationSequence: 1,
    retiredOperations: [complete.retiredOperations[0]!],
  });
  expect(() =>
    setupDomain_reconcileRestart(
      truncated,
      { restartId: "restart-truncated", configRevision: 1 },
      anchorFor(complete),
    ),
  ).toThrow(/persistence-owner anchor/);
});

test("a matching persistence-owner anchor permits monotonic control and new-ID reuse", () => {
  const stopped = stopOperation(
    setupDomain_initialState("direct-provider"),
    "op-before-anchored-restart",
    at,
  );
  const checkpoint = setupDomain_exportCheckpoint(stopped);
  const restarted = setupDomain_reconcileRestart(
    checkpoint,
    { restartId: "restart-anchored", configRevision: 1 },
    anchorFor(checkpoint),
  );
  expect(restarted.anchorMatched).toBe(true);
  expect(restarted.state.checkpoint.operationSequence).toBe(1);
  expect(restarted.state.checkpoint.retiredOperations).toEqual(checkpoint.retiredOperations);
  expect(() =>
    setupDomain_beginOperation(
      restarted.state,
      request(restarted.state, "detection", {
        operationId: "op-before-anchored-restart",
        mode: "inspect",
      }),
      at + 3,
    ),
  ).toThrow(/retired/);
  const replacement = setupDomain_beginOperation(
    restarted.state,
    request(restarted.state, "detection", {
      operationId: "op-after-anchored-restart",
      mode: "inspect",
    }),
    at + 4,
  );
  expect(replacement.operation.operationSequence).toBe(2);
  expect(replacement.operation.request.resourceKey).toEqual({
    componentId: "direct-provider",
    resource: "detection",
    scopeId: "setup-primary",
  });
});

test("the bounded 32-entry registry fails closed instead of evicting history", () => {
  const initial = setupDomain_initialState("direct-provider");
  const retiredOperations = Array.from({ length: 32 }, (_, index) => ({
    operationId: `op-full-${index + 1}`,
    operationSequence: index + 1,
    generation: 1,
    retiredAt: at + index,
    outcome: "stopped" as const,
    cancellationId: `cancel-op-full-${index + 1}`,
    effects: "none" as const,
  }));
  const fullState: SetupDomainState = {
    ...initial,
    checkpoint: {
      ...initial.checkpoint,
      operationSequence: 32,
      retiredOperations,
    },
  };
  const begun = setupDomain_beginOperation(
    fullState,
    request(fullState, "detection", { operationId: "op-over-capacity" }),
    at + 100,
  );
  const intent = setupDomain_requestCancellation(
    begun.state,
    {
      cancellationId: "cancel-over-capacity",
      operationId: "op-over-capacity",
      generation: 1,
      configRevision: 1,
      reason: "user-cancelled",
    },
    at + 101,
  );
  expect(() =>
    setupDomain_applyCancellationReceipt(intent.state, {
      kind: "cancellation-receipt",
      cancellationId: "cancel-over-capacity",
      operationId: "op-over-capacity",
      generation: 1,
      configRevision: 1,
      outcome: "stopped",
      effects: "none",
      observedAt: at + 102,
    }),
  ).toThrow(/history is full/);
  expect(intent.state.activeOperation?.operationSequence).toBe(33);
  expect(intent.state.checkpoint.retiredOperations).toHaveLength(32);
});

test("persistence admission is explicit and rejects a second active owner", () => {
  const initial = setupDomain_initialState("direct-provider");
  const previous = setupDomain_exportCheckpoint(initial);
  const first = setupDomain_beginOperation(
    initial,
    request(initial, "detection", { operationId: "op-persist-a" }),
    at,
  );
  const identity = setupDomain_persistenceIdentityFromOperation(first.operation);
  const admission: SetupPersistenceTransitionRequest = {
    kind: "admit",
    expectedAuthorityRevision: 0,
    identity,
  };
  const accepted = setupDomain_validatePersistenceTransition(
    authorityState({ kind: "idle" }, 0),
    admission,
    previous,
    setupDomain_exportCheckpoint(first.state),
  );
  expect(accepted).toMatchObject({
    decision: "accepted",
    cursor: { kind: "admitted", identity },
    authorityRevision: 1,
    commitRequired: true,
    clearsOwnership: false,
    automaticActions: [],
  });
  const priorCheckpoint = setupDomain_roundTripCheckpoint({
    ...previous,
    lastCompletedOperationId: "op-bookkeeping-only",
  });
  const explicitState = setupDomain_createState(priorCheckpoint, factsFor("direct-provider"));
  const explicit = setupDomain_beginOperation(
    explicitState,
    request(explicitState, "detection", { operationId: "op-explicit-new" }),
    at,
  );
  const explicitIdentity = setupDomain_persistenceIdentityFromOperation(explicit.operation);
  expect(
    setupDomain_validatePersistenceTransition(
      authorityState({ kind: "idle" }, 0),
      {
        kind: "admit",
        expectedAuthorityRevision: 0,
        identity: explicitIdentity,
      },
      priorCheckpoint,
      setupDomain_exportCheckpoint(explicit.state),
    ).cursor,
  ).toEqual({ kind: "admitted", identity: explicitIdentity });
  expect(() =>
    setupDomain_validatePersistenceTransition(
      authorityState(accepted.cursor, accepted.authorityRevision),
      {
        kind: "admit",
        expectedAuthorityRevision: accepted.authorityRevision,
        identity: { ...identity, operationId: "op-persist-b", operationSequence: 2 },
      },
      setupDomain_exportCheckpoint(first.state),
      setupDomain_exportCheckpoint(first.state),
    ),
  ).toThrow(/another operation is admitted/);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      authorityState({ kind: "idle" }, 0),
      { ...admission, expectedAuthorityRevision: 1 },
      previous,
      setupDomain_exportCheckpoint(first.state),
    ),
  ).toThrow(/stale/);
});

test("verified and unverified settlements use the exact admitted identity", () => {
  for (const outcome of ["verified", "unverified"] as const) {
    const initial = setupDomain_initialState("direct-provider");
    const begun = setupDomain_beginOperation(
      initial,
      request(initial, "detection", { operationId: `op-settle-${outcome}` }),
      at,
    );
    const identity = setupDomain_persistenceIdentityFromOperation(begun.operation);
    const previous = setupDomain_exportCheckpoint(begun.state);
    const settled = setupDomain_acceptResult(
      begun.state,
      result(begun.operation, {
        state: outcome === "verified" ? "verified" : "present-unverified",
      }),
    );
    const transition: SetupPersistenceTransitionRequest = {
      kind: "settle",
      expectedAuthorityRevision: 1,
      identity,
      outcome,
    };
    const validated = setupDomain_validatePersistenceTransition(
      authorityState({ kind: "admitted", identity }, 1),
      transition,
      previous,
      setupDomain_exportCheckpoint(settled),
    );
    expect(validated).toMatchObject({
      cursor: { kind: "settled", identity, outcome },
      authorityRevision: 2,
      commitRequired: true,
      clearsOwnership: true,
      requiresInspection: false,
      automaticActions: [],
    });
  }
});

test("verified reinspection can settle while checkpoint progress stays unchanged", () => {
  const base = checkpointWith("direct-provider", { detection: "complete" });
  const restarted = setupDomain_reconcileRestart(
    base,
    { restartId: "reinspection-restart", configRevision: 1 },
    anchorFor(base),
  ).state;
  const begun = setupDomain_beginOperation(
    restarted,
    request(restarted, "detection", {
      operationId: "op-reinspect-complete",
      mode: "inspect",
    }),
    at,
  );
  const identity = setupDomain_persistenceIdentityFromOperation(begun.operation);
  const previous = setupDomain_exportCheckpoint(begun.state);
  const settled = setupDomain_acceptResult(
    begun.state,
    result(begun.operation, { state: "verified" }),
  );
  const next = setupDomain_exportCheckpoint(settled);
  expect(next.progress).toEqual(previous.progress);
  expect(next.lastCompletedOperationId).toBe("op-reinspect-complete");
  expect(
    setupDomain_validatePersistenceTransition(
      authorityState({ kind: "admitted", identity }, 1),
      {
        kind: "settle",
        expectedAuthorityRevision: 1,
        identity,
        outcome: "verified",
      },
      previous,
      next,
    ),
  ).toMatchObject({
    cursor: { kind: "settled", identity, outcome: "verified" },
    authorityRevision: 2,
    commitRequired: true,
  });
});

test("exact terminal settlement retries are idempotent and different terminals conflict", () => {
  const initial = setupDomain_initialState("direct-provider");
  const begun = setupDomain_beginOperation(
    initial,
    request(initial, "detection", { operationId: "op-idempotent-settle" }),
    at,
  );
  const identity = setupDomain_persistenceIdentityFromOperation(begun.operation);
  const settled = setupDomain_acceptResult(
    begun.state,
    result(begun.operation, { state: "present-unverified" }),
  );
  const checkpoint = setupDomain_exportCheckpoint(settled);
  const current = authorityState({ kind: "settled", identity, outcome: "unverified" }, 2);
  const requestValue: SetupPersistenceTransitionRequest = {
    kind: "settle",
    expectedAuthorityRevision: 2,
    identity,
    outcome: "unverified",
  };
  expect(
    setupDomain_validatePersistenceTransition(current, requestValue, checkpoint, checkpoint),
  ).toMatchObject({
    decision: "idempotent",
    authorityRevision: 2,
    commitRequired: false,
    automaticActions: [],
  });
  expect(() =>
    setupDomain_validatePersistenceTransition(
      current,
      { ...requestValue, outcome: "verified" },
      checkpoint,
      checkpoint,
    ),
  ).toThrow(/different terminal settlement/);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      current,
      {
        kind: "retire",
        expectedAuthorityRevision: 2,
        identity,
        cancellationId: "cancel-terminal-conflict",
        cancellationOutcome: "stopped",
        effects: "none",
        retiredAt: at + 2,
      },
      checkpoint,
      checkpoint,
    ),
  ).toThrow(/settled terminal cursor/);

  const fresh = setupDomain_beginOperation(
    settled,
    request(settled, "detection", { operationId: "op-after-settlement" }),
    at + 3,
  );
  const freshIdentity = setupDomain_persistenceIdentityFromOperation(fresh.operation);
  expect(
    setupDomain_validatePersistenceTransition(
      current,
      { kind: "admit", expectedAuthorityRevision: 2, identity: freshIdentity },
      checkpoint,
      setupDomain_exportCheckpoint(fresh.state),
    ),
  ).toMatchObject({ cursor: { kind: "admitted", identity: freshIdentity } });
});

test("releasing retirement is appended exactly and retries idempotently", () => {
  const initial = setupDomain_initialState("direct-provider");
  const begun = setupDomain_beginOperation(
    initial,
    request(initial, "detection", { operationId: "op-persist-retire" }),
    at,
  );
  const identity = setupDomain_persistenceIdentityFromOperation(begun.operation);
  const previous = setupDomain_exportCheckpoint(begun.state);
  const retired = stopOperation(initial, "op-persist-retire", at) as SetupDomainState;
  const next = setupDomain_exportCheckpoint(retired);
  const requestValue: SetupPersistenceTransitionRequest = {
    kind: "retire",
    expectedAuthorityRevision: 1,
    identity,
    cancellationId: "cancel-op-persist-retire",
    cancellationOutcome: "stopped",
    effects: "none",
    retiredAt: at + 2,
  };
  const applied = setupDomain_validatePersistenceTransition(
    authorityState({ kind: "admitted", identity }, 1),
    requestValue,
    previous,
    next,
  );
  expect(applied).toMatchObject({
    cursor: {
      kind: "retired",
      identity,
      outcome: "releasing-cancellation",
      cancellationId: requestValue.cancellationId,
      cancellationOutcome: requestValue.cancellationOutcome,
      effects: requestValue.effects,
    },
    authorityRevision: 2,
    clearsOwnership: true,
  });
  expect(() =>
    setupDomain_validatePersistenceTransition(
      authorityState({ kind: "admitted", identity }, 1),
      { ...requestValue, cancellationId: "cancel-forged-receipt" },
      previous,
      next,
    ),
  ).toThrow(/appended checkpoint history/);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      authorityState({ kind: "admitted", identity }, 1),
      { ...requestValue, effects: "partial" },
      previous,
      next,
    ),
  ).toThrow(/must be none/);
  const retry = setupDomain_validatePersistenceTransition(
    authorityState(applied.cursor, applied.authorityRevision),
    { ...requestValue, expectedAuthorityRevision: applied.authorityRevision },
    next,
    next,
  );
  expect(retry).toMatchObject({ decision: "idempotent", commitRequired: false });
  expect(() =>
    setupDomain_validatePersistenceTransition(
      authorityState(applied.cursor, applied.authorityRevision),
      {
        ...requestValue,
        expectedAuthorityRevision: applied.authorityRevision,
        cancellationId: "cancel-changed-retry",
      },
      next,
      next,
    ),
  ).toThrow(/different terminal retirement/);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      authorityState(applied.cursor, applied.authorityRevision),
      {
        kind: "settle",
        expectedAuthorityRevision: applied.authorityRevision,
        identity,
        outcome: "verified",
      },
      next,
      next,
    ),
  ).toThrow(/requires an admitted operation/);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      authorityState(applied.cursor, applied.authorityRevision),
      {
        kind: "admit",
        expectedAuthorityRevision: applied.authorityRevision,
        identity: { ...identity, operationSequence: 2 },
      },
      next,
      next,
    ),
  ).toThrow(/retired/);

  const fresh = setupDomain_beginOperation(
    retired,
    request(retired, "detection", { operationId: "op-after-retirement" }),
    at + 3,
  );
  const freshIdentity = setupDomain_persistenceIdentityFromOperation(fresh.operation);
  expect(
    setupDomain_validatePersistenceTransition(
      authorityState(applied.cursor, applied.authorityRevision),
      {
        kind: "admit",
        expectedAuthorityRevision: applied.authorityRevision,
        identity: freshIdentity,
      },
      next,
      setupDomain_exportCheckpoint(fresh.state),
    ),
  ).toMatchObject({ cursor: { kind: "admitted", identity: freshIdentity } });
});

test("completed-before-cancel retirement binds receipt fields and rejects changed retries", () => {
  const initial = setupDomain_initialState("direct-provider");
  const begun = setupDomain_beginOperation(
    initial,
    request(initial, "detection", { operationId: "op-race-retire" }),
    at,
  );
  const identity = setupDomain_persistenceIdentityFromOperation(begun.operation);
  const cancellation = setupDomain_requestCancellation(
    begun.state,
    {
      cancellationId: "cancel-op-race-retire",
      operationId: identity.operationId,
      generation: identity.generation,
      configRevision: identity.configRevision,
      reason: "user-cancelled",
    },
    at + 1,
  );
  const retiredState = setupDomain_applyCancellationReceipt(cancellation.state, {
    kind: "cancellation-receipt",
    cancellationId: "cancel-op-race-retire",
    operationId: identity.operationId,
    generation: identity.generation,
    configRevision: identity.configRevision,
    outcome: "completed-before-cancel",
    effects: "partial",
    observedAt: at + 2,
  }).state;
  const previous = setupDomain_exportCheckpoint(begun.state);
  const next = setupDomain_exportCheckpoint(retiredState);
  const requestValue: SetupPersistenceTransitionRequest = {
    kind: "retire",
    expectedAuthorityRevision: 1,
    identity,
    cancellationId: "cancel-op-race-retire",
    cancellationOutcome: "completed-before-cancel",
    effects: "partial",
    retiredAt: at + 2,
  };
  const current = authorityState({ kind: "admitted", identity }, 1);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      current,
      { ...requestValue, cancellationId: "cancel-mismatched-receipt" },
      previous,
      next,
    ),
  ).toThrow(/appended checkpoint history/);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      current,
      { ...requestValue, effects: "unknown" },
      previous,
      next,
    ),
  ).toThrow(/appended checkpoint history/);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      current,
      {
        ...requestValue,
        identity: {
          ...identity,
          operationId: "op-wrong-retire",
        },
      },
      previous,
      next,
    ),
  ).toThrow(/admitted operation/);

  const applied = setupDomain_validatePersistenceTransition(current, requestValue, previous, next);
  expect(applied.cursor).toEqual({
    kind: "retired",
    identity,
    outcome: "releasing-cancellation",
    cancellationId: requestValue.cancellationId,
    cancellationOutcome: requestValue.cancellationOutcome,
    effects: requestValue.effects,
  });
  expect(
    setupDomain_validatePersistenceTransition(
      authorityState(applied.cursor, applied.authorityRevision),
      { ...requestValue, expectedAuthorityRevision: applied.authorityRevision },
      next,
      next,
    ),
  ).toMatchObject({
    decision: "idempotent",
    authorityRevision: applied.authorityRevision,
    commitRequired: false,
  });
  for (const changed of [
    { cancellationId: "cancel-changed-receipt" },
    { effects: "unknown" as const },
    { cancellationOutcome: "stopped" as const, effects: "none" as const },
    { retiredAt: at + 3 },
  ]) {
    expect(() =>
      setupDomain_validatePersistenceTransition(
        authorityState(applied.cursor, applied.authorityRevision),
        {
          ...requestValue,
          ...changed,
          expectedAuthorityRevision: applied.authorityRevision,
        },
        next,
        next,
      ),
    ).toThrow(/different terminal retirement/);
  }
});

test("non-releasing cancellation leaves the admitted owner in place", () => {
  for (const testCase of [
    { outcome: "failed-to-stop" as const, effects: "partial" as const },
    { outcome: "failed-to-stop" as const, effects: "unknown" as const },
    { outcome: "unknown" as const, effects: "unknown" as const },
  ]) {
    const begun = setupDomain_beginOperation(
      setupDomain_initialState("direct-provider"),
      request(setupDomain_initialState("direct-provider"), "detection", {
        operationId: `op-nonrelease-${testCase.outcome}-${testCase.effects}`,
      }),
      at,
    );
    const identity = setupDomain_persistenceIdentityFromOperation(begun.operation);
    const checkpoint = setupDomain_exportCheckpoint(begun.state);
    const resultValue = setupDomain_validatePersistenceTransition(
      authorityState({ kind: "admitted", identity }, 1),
      {
        kind: "cancel-nonreleasing",
        expectedAuthorityRevision: 1,
        identity,
        cancellationId: `cancel-${testCase.outcome}-${testCase.effects}`,
        cancellationOutcome: testCase.outcome,
        effects: testCase.effects,
      },
      checkpoint,
      checkpoint,
    );
    expect(resultValue).toMatchObject({
      decision: "accepted",
      cursor: { kind: "admitted", identity },
      authorityRevision: 1,
      commitRequired: false,
      clearsOwnership: false,
      requiresInspection: true,
      automaticActions: [],
    });
    expect(() =>
      setupDomain_validatePersistenceTransition(
        authorityState(resultValue.cursor, resultValue.authorityRevision),
        {
          kind: "admit",
          expectedAuthorityRevision: resultValue.authorityRevision,
          identity: { ...identity, operationId: "op-other", operationSequence: 2 },
        },
        checkpoint,
        checkpoint,
      ),
    ).toThrow(/another operation is admitted/);
  }
});

test("explicit restart and configuration clear ownership and emit no actions", () => {
  const begun = setupDomain_beginOperation(
    setupDomain_initialState("direct-provider"),
    request(setupDomain_initialState("direct-provider"), "detection", {
      operationId: "op-before-boundary",
    }),
    at,
  );
  const identity = setupDomain_persistenceIdentityFromOperation(begun.operation);
  const previous = setupDomain_exportCheckpoint(begun.state);
  const restarted = setupDomain_reconcileRestart(
    previous,
    { restartId: "persistence-restart", configRevision: 1 },
    anchorFor(previous),
  ).state;
  expect(
    setupDomain_validatePersistenceTransition(
      authorityState({ kind: "admitted", identity }, 1),
      {
        kind: "restart",
        expectedAuthorityRevision: 1,
        restartId: "persistence-restart",
        configRevision: 1,
      },
      previous,
      setupDomain_exportCheckpoint(restarted),
    ),
  ).toMatchObject({
    cursor: { kind: "idle" },
    authorityRevision: 2,
    clearsOwnership: true,
    requiresInspection: true,
    automaticActions: [],
  });
  const configured = setupDomain_changeConfiguration(begun.state, 2).state;
  expect(
    setupDomain_validatePersistenceTransition(
      authorityState({ kind: "admitted", identity }, 1),
      {
        kind: "configure",
        expectedAuthorityRevision: 1,
        configRevision: 2,
      },
      previous,
      setupDomain_exportCheckpoint(configured),
    ),
  ).toMatchObject({
    cursor: { kind: "idle" },
    authorityRevision: 2,
    clearsOwnership: true,
    requiresInspection: true,
    automaticActions: [],
  });
});

test("wrong operation, step, resource, configuration, sequence and generation reject", () => {
  const begun = setupDomain_beginOperation(
    setupDomain_initialState("direct-provider"),
    request(setupDomain_initialState("direct-provider"), "detection", {
      operationId: "op-identity-check",
    }),
    at,
  );
  const identity = setupDomain_persistenceIdentityFromOperation(begun.operation);
  const checkpoint = setupDomain_exportCheckpoint(begun.state);
  const current = authorityState({ kind: "admitted", identity }, 1);
  const invalidIdentities = [
    { ...identity, operationId: "op-wrong" },
    {
      ...identity,
      step: "probe" as const,
      resourceKey: { ...identity.resourceKey, resource: "probe" as const },
    },
    { ...identity, resourceKey: { ...identity.resourceKey, componentId: "codex-router" as const } },
    { ...identity, configRevision: 2 },
    { ...identity, operationSequence: 2 },
  ];
  for (const invalid of invalidIdentities) {
    expect(() =>
      setupDomain_validatePersistenceTransition(
        current,
        {
          kind: "settle",
          expectedAuthorityRevision: 1,
          identity: invalid,
          outcome: "unverified",
        },
        checkpoint,
        checkpoint,
      ),
    ).toThrow();
  }
  const restarted = setupDomain_reconcileRestart(
    checkpoint,
    { restartId: "generation-reset-base", configRevision: 1 },
    anchorFor(checkpoint),
  ).state;
  const nextGeneration = setupDomain_beginOperation(
    restarted,
    request(restarted, "detection", {
      operationId: "op-generation-two",
      mode: "inspect",
    }),
    at + 3,
  );
  const generationTwoIdentity = setupDomain_persistenceIdentityFromOperation(
    nextGeneration.operation,
  );
  expect(generationTwoIdentity.generation).toBe(2);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      authorityState({ kind: "admitted", identity: generationTwoIdentity }, 1),
      {
        kind: "settle",
        expectedAuthorityRevision: 1,
        identity: { ...generationTwoIdentity, generation: 1 },
        outcome: "unverified",
      },
      setupDomain_exportCheckpoint(nextGeneration.state),
      setupDomain_exportCheckpoint(nextGeneration.state),
    ),
  ).toThrow(/identity/);
});

test("a stale late result after anchored restart and fresh admission rejects", () => {
  const stopped = stopOperation(
    setupDomain_initialState("direct-provider"),
    "op-old-before-transition",
    at,
  );
  const oldIdentity = {
    generation: 1,
    configRevision: 1,
    operationSequence: stopped.checkpoint.retiredOperations[0]!.operationSequence,
    operationId: stopped.checkpoint.retiredOperations[0]!.operationId,
    step: "detection" as const,
    resourceKey: {
      componentId: "direct-provider" as const,
      resource: "detection" as const,
      scopeId: "setup-primary",
    },
  };
  const checkpoint = setupDomain_exportCheckpoint(stopped);
  const restarted = setupDomain_reconcileRestart(
    checkpoint,
    { restartId: "stale-transition-restart", configRevision: 1 },
    anchorFor(checkpoint),
  ).state;
  const fresh = setupDomain_beginOperation(
    restarted,
    request(restarted, "detection", {
      operationId: "op-fresh-after-restart",
      mode: "inspect",
    }),
    at + 3,
  );
  const freshIdentity = setupDomain_persistenceIdentityFromOperation(fresh.operation);
  expect(() =>
    setupDomain_validatePersistenceTransition(
      authorityState({ kind: "admitted", identity: freshIdentity }, 1),
      {
        kind: "settle",
        expectedAuthorityRevision: 1,
        identity: oldIdentity,
        outcome: "verified",
      },
      setupDomain_exportCheckpoint(fresh.state),
      setupDomain_exportCheckpoint(fresh.state),
    ),
  ).toThrow(/identity/);
});

test("cancellation receipts settle completed races and require inspection without stranding ownership", () => {
  for (const testCase of [
    {
      outcome: "failed-to-stop" as const,
      effects: "partial" as const,
      released: false,
    },
    {
      outcome: "unknown" as const,
      effects: "unknown" as const,
      released: false,
    },
    {
      outcome: "completed-before-cancel" as const,
      effects: "none" as const,
      released: true,
    },
    {
      outcome: "completed-before-cancel" as const,
      effects: "partial" as const,
      released: true,
    },
    {
      outcome: "completed-before-cancel" as const,
      effects: "unknown" as const,
      released: true,
    },
  ]) {
    const initial = setupDomain_initialState("direct-provider");
    const begun = setupDomain_beginOperation(initial, request(initial, "detection"), at);
    const cancellation = setupDomain_requestCancellation(
      begun.state,
      {
        cancellationId: "cancel-1",
        operationId: begun.operation.request.operationId,
        generation: 1,
        configRevision: 1,
        reason: "user-cancelled",
      },
      at + 1,
    );
    const applied = setupDomain_applyCancellationReceipt(cancellation.state, {
      kind: "cancellation-receipt",
      cancellationId: "cancel-1",
      operationId: begun.operation.request.operationId,
      generation: 1,
      configRevision: 1,
      outcome: testCase.outcome,
      effects: testCase.effects,
      observedAt: at + 2,
    });
    expect(applied.ownershipReleased).toBe(testCase.released);
    expect(applied.requiresInspection).toBe(true);
    expect(applied.state.requiresInspection).toBe(true);
    expect(applied.state.activeOperation !== null).toBe(!testCase.released);
    expect(applied.retiredOperation !== null).toBe(testCase.released);
    expect(applied.state.checkpoint.retiredOperations).toHaveLength(testCase.released ? 1 : 0);
    const projection = setupDomain_projectStatus(applied.state);
    expect(projection.readiness).toBe("needs-inspection");
    if (testCase.released) {
      expect(projection.handoff).toMatchObject({
        kind: "inspect-current-state",
        operationId: null,
      });
      expect(() =>
        setupDomain_acceptResult(applied.state, result(begun.operation, { observedAt: at + 3 })),
      ).toThrow(/retired operation/);
    } else {
      expect(projection.handoff).toBeNull();
      expect(() =>
        setupDomain_acceptResult(applied.state, result(begun.operation, { observedAt: at + 3 })),
      ).toThrow(/cancellation receipt|inspection/);
    }
  }
});

test("configuration changes invalidate owners, catalogue and probes without automatic replay", () => {
  const checkpoint = checkpointWith("direct-provider", {
    detection: "complete",
    installation: "complete",
    account: "complete",
    catalogue: "complete",
    probe: "pending",
  });
  const state = setupDomain_createState(
    checkpoint,
    factsFor("direct-provider", {
      detection: "verified",
      installation: "verified",
      account: "verified",
      catalogue: "verified",
    }),
  );
  const begun = setupDomain_beginOperation(state, request(state, "probe"), at);
  const changed = setupDomain_changeConfiguration(begun.state, 2);
  expect(changed.invalidatedSteps).toEqual(["catalogue", "probe"]);
  expect(changed.automaticActions).toEqual([]);
  expect(changed.state.checkpoint.generation).toBe(2);
  expect(changed.state.checkpoint.configRevision).toBe(2);
  expect(changed.state.activeOperation).toBeNull();
  expect(changed.state.requiresInspection).toBe(true);
  expect(changed.state.facts.facts.map((fact) => fact.dimension)).not.toContain("catalogue");
  expect(() =>
    setupDomain_acceptResult(changed.state, {
      ...result(begun.operation),
      generation: 2,
      configRevision: 2,
    }),
  ).toThrow(/no active/);
});

test("synthetic checkpoint round-trip preserves complete and skipped progress but drops ownership", () => {
  const checkpoint = checkpointWith("global-ssh-connect", {
    detection: "complete",
    installation: "complete",
    process: "complete",
    endpoint: "skipped",
    account: "skipped",
    permission: "pending",
    probe: "pending",
  });
  const restored = setupDomain_roundTripCheckpoint(structuredClone(checkpoint));
  expect(restored.progress.steps.filter((step) => step.state === "complete")).toHaveLength(3);
  expect(restored.progress.steps.filter((step) => step.state === "skipped")).toHaveLength(2);
  const state = setupDomain_createState(
    restored,
    factsFor("global-ssh-connect", {
      detection: "verified",
      installation: "verified",
      process: "verified",
    }),
  );
  const exported = setupDomain_exportCheckpoint(state);
  expect(exported).toEqual(restored);
  expect(exported).not.toHaveProperty("activeOperation");
  expect(exported).not.toHaveProperty("cancellationIntent");
});

test("restart reconciliation preserves historical progress but rejects all pre-restart results", () => {
  const checkpoint = checkpointWith("codex-router", {
    detection: "complete",
    installation: "complete",
    process: "complete",
    endpoint: "pending",
    account: "pending",
    catalogue: "pending",
    probe: "pending",
  });
  const reconciliation = setupDomain_reconcileRestart(
    checkpoint,
    {
      restartId: "restart-1",
      configRevision: 1,
    },
    anchorFor(checkpoint),
  );
  expect(reconciliation.preservedCompletedSteps).toEqual(["detection", "installation", "process"]);
  expect(reconciliation.preservedSkippedSteps).toEqual([]);
  expect(reconciliation.preRestartResultsAccepted).toBe(false);
  expect(reconciliation.requiresInspection).toBe(true);
  expect(reconciliation.automaticActions).toEqual([]);
  expect(reconciliation.state.activeOperation).toBeNull();
  expect(reconciliation.state.cancellationIntent).toBeNull();
  expect(reconciliation.state.facts.facts).toEqual([]);
  expect(reconciliation.state.checkpoint.generation).toBe(2);
  const projection = setupDomain_projectStatus(reconciliation.state);
  expect(projection.requiresInspection).toBe(true);
  expect(projection.currentStep).toBe("detection");
  expect(projection.handoff).toMatchObject({
    kind: "inspect-current-state",
    reasonCode: "restart-inspection-required",
  });
  expect(() =>
    setupDomain_acceptResult(reconciliation.state, {
      operationId: "pre-restart",
      routeId: "codex-router",
      step: "detection",
      resourceKey: {
        componentId: "codex-router",
        resource: "detection",
        scopeId: "setup-primary",
      },
      generation: 1,
      configRevision: 1,
      fact: {
        dimension: "detection",
        state: "verified",
        observedAt: at,
        reasonCode: null,
      },
    }),
  ).toThrow(/no active/);
});

test("restart with changed configuration also invalidates catalogue and probe progress", () => {
  const checkpoint = checkpointWith("direct-provider", {
    detection: "complete",
    installation: "complete",
    account: "complete",
    catalogue: "complete",
    probe: "complete",
  });
  const reconciliation = setupDomain_reconcileRestart(
    checkpoint,
    {
      restartId: "restart-2",
      configRevision: 2,
    },
    anchorFor(checkpoint),
  );
  expect(reconciliation.state.checkpoint.configRevision).toBe(2);
  expect(reconciliation.state.checkpoint.progress.steps).toMatchObject([
    { step: "detection", state: "complete" },
    { step: "installation", state: "complete" },
    { step: "account", state: "complete" },
    { step: "catalogue", state: "pending" },
    { step: "probe", state: "pending" },
  ]);
  expect(reconciliation.preservedCompletedSteps).toEqual(["detection", "installation", "account"]);
  expect(reconciliation.automaticActions).toEqual([]);
});

test("explicit post-restart inspections advance without replay and clear the gate after every fact", () => {
  const checkpoint = checkpointWith("codex-router", {
    detection: "complete",
    installation: "complete",
    process: "complete",
  });
  let state = setupDomain_reconcileRestart(
    checkpoint,
    {
      restartId: "restart-3",
      configRevision: 1,
    },
    anchorFor(checkpoint),
  ).state;
  for (const [index, step] of setupDomain_routeSteps("codex-router").entries()) {
    const openedAt = at + index * 2;
    const begun = setupDomain_beginOperation(
      state,
      request(state, step, {
        operationId: `post-restart-${step}`,
        mode: "inspect",
      }),
      openedAt,
    );
    state = setupDomain_acceptResult(
      begun.state,
      result(begun.operation, { observedAt: openedAt + 1 }),
    );
  }
  expect(state.requiresInspection).toBe(false);
  expect(state.inspectionCompletedSteps).toEqual(setupDomain_routeSteps("codex-router"));
  expect(setupDomain_projectStatus(state)).toMatchObject({
    readiness: "ready",
    ready: true,
    currentStep: null,
  });
});

test("account and permission projections emit bounded handoffs with exact current generations", () => {
  const accountState = setupDomain_createState(
    checkpointWith("direct-provider", {
      detection: "complete",
      installation: "complete",
    }),
    factsFor("direct-provider", {
      detection: "verified",
      installation: "verified",
      account: "not-detected",
    }),
  );
  expect(setupDomain_projectStatus(accountState).handoff).toMatchObject({
    kind: "complete-account-step",
    routeId: "direct-provider",
    step: "account",
    generation: 1,
    configRevision: 1,
    operationId: null,
    reasonCode: "account-action-required",
  });

  const permissionState = setupDomain_createState(
    checkpointWith("browser-mcp-companion", {
      detection: "complete",
      installation: "complete",
      process: "complete",
      endpoint: "complete",
    }),
    factsFor("browser-mcp-companion", {
      detection: "verified",
      installation: "verified",
      process: "verified",
      endpoint: "verified",
      permission: "not-detected",
    }),
  );
  expect(setupDomain_projectStatus(permissionState).handoff).toMatchObject({
    kind: "review-native-approval",
    step: "permission",
    reasonCode: "native-approval-required",
  });
  expect(JSON.stringify(setupDomain_projectStatus(permissionState))).not.toMatch(
    /https?:|Bearer|sk-/,
  );
});

test("contract and domain versions remain fixed and exported step order is deterministic", () => {
  expect(setupCentre_schemaVersion).toBe(3);
  expect(setupDomain_initialCheckpoint("direct-provider")).toMatchObject({
    schemaVersion: 3,
    routeId: "direct-provider",
    componentId: "direct-provider",
    generation: 1,
    configRevision: 1,
    operationSequence: 0,
    retiredOperations: [],
  });
  expect(setupCentre_stepIds).toEqual([
    "detection",
    "installation",
    "process",
    "endpoint",
    "account",
    "catalogue",
    "permission",
    "probe",
  ]);
});
