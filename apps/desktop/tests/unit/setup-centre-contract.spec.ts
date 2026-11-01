import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  setupPersistence_cursorKinds,
  setupPersistence_decodeAuthorityState,
  setupPersistence_decodeCursor,
  setupPersistence_decodeIdentity,
  setupPersistence_decodeTransitionRequest,
  setupPersistence_schemaVersion,
  setupPersistence_transitionKinds,
  setupCentre_checkpointAnchorSchemaVersion,
  setupCentre_decodeCancellationIntent,
  setupCentre_decodeCancellationReceipt,
  setupCentre_decodeCheckpoint,
  setupCentre_decodeCheckpointAnchor,
  setupCentre_decodeComponentFacts,
  setupCentre_decodeHandoff,
  setupCentre_decodeOperationRequest,
  setupCentre_decodeResourceKey,
  setupCentre_decodeRetiredOperation,
  setupCentre_decodeRoute,
  setupCentre_decodeStatusProjection,
  setupCentre_getRoute,
  setupCentre_reasonCodes,
  setupCentre_routeIds,
  setupCentre_routes,
  setupCentre_schemaVersion,
  setupCentre_stepIds,
  type SetupCheckpoint,
  type SetupComponentFacts,
  type SetupOperationRequest,
  type SetupPersistenceIdentity,
} from "../../contracts/setup-centre";

const workspaceRoot = path.resolve(__dirname, "../../../..");
const at = 1_764_000_000_000;

function sha256(file: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(workspaceRoot, file)))
    .digest("hex");
}

function componentFacts(
  componentId: SetupComponentFacts["componentId"] = "codex-router",
): SetupComponentFacts {
  return {
    componentId,
    ownership: componentId === "direct-provider" ? "bundled" : "user-managed",
    configRevision: 1,
    generation: 1,
    facts: setupCentre_stepIds.map((dimension) => ({
      dimension,
      state: "verified" as const,
      observedAt: at,
      reasonCode: "detected" as const,
    })),
  };
}

function directCheckpoint(): SetupCheckpoint {
  const route = setupCentre_getRoute("direct-provider");
  return {
    schemaVersion: setupCentre_schemaVersion,
    routeId: route.routeId,
    componentId: route.componentId,
    generation: 1,
    configRevision: 1,
    operationSequence: 0,
    lastCompletedOperationId: null,
    retiredOperations: [],
    progress: {
      routeId: route.routeId,
      generation: 1,
      configRevision: 1,
      steps: route.steps.map((step) => ({ step: step.step, state: "complete" })),
    },
  };
}

function directRequest(): SetupOperationRequest {
  return {
    operationId: "op-detect-1",
    routeId: "direct-provider",
    step: "detection",
    resourceKey: {
      componentId: "direct-provider",
      resource: "detection",
      scopeId: "provider-slot-primary",
    },
    mode: "inspect",
    generation: 1,
    configRevision: 1,
    startedBy: "user",
  };
}

function persistenceIdentity(
  overrides: Partial<SetupPersistenceIdentity> = {},
): SetupPersistenceIdentity {
  return {
    generation: 1,
    configRevision: 1,
    operationSequence: 1,
    operationId: "op-detection-1",
    step: "detection",
    resourceKey: {
      componentId: "direct-provider",
      resource: "detection",
      scopeId: "provider-slot-primary",
    },
    ...overrides,
  };
}

test("accepted D02/adaptor/research/seal inputs retain their reviewer hashes", () => {
  expect(sha256("artifacts/distribution/D02/component-contracts.json")).toBe(
    "9f3ffab8d7eebc5d809a903419aed1e42d196ede361c104ff18c3c192c4e39d1",
  );
  expect(sha256("artifacts/distribution/D02/ADAPTER_CONTRACTS.md")).toBe(
    "12e3249faf8b5efae638a6458f9678bbc7bc99c5ca0c7f763a91349106f34d84",
  );
  expect(sha256("artifacts/distribution/D02A/ADAPTER_INTERFACE.md")).toBe(
    "3d08eca1ec62edef9cf47f126f9ce52271898b8e95629cc9c21dd952558d31d8",
  );
  expect(sha256("artifacts/distribution/D02A/SHA256SUMS")).toBe(
    "76db18426910f2622eb39d886c7e0114b60c1343a4e97a514776462d2815115d",
  );
});

test("the contract is browser-safe and exposes closed route, step, reason and version sets", () => {
  const source = readFileSync(
    path.join(workspaceRoot, "apps/desktop/contracts/setup-centre.ts"),
    "utf8",
  );
  expect(source).not.toMatch(/from\s+["'](?:node:|electron|fs|path|child_process)/);
  expect(source).not.toMatch(/\b(?:fetch\s*\(|require\s*\(|ipcMain|ipcRenderer|process\.)/);
  expect(setupCentre_schemaVersion).toBe(3);
  expect(setupCentre_routeIds).toEqual([
    "direct-provider",
    "codex-router",
    "browser-mcp-companion",
    "global-ssh-connect",
  ]);
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
  expect(new Set(setupCentre_reasonCodes).size).toBe(setupCentre_reasonCodes.length);
  expect(setupCentre_routes.every((route) => route.steps.length > 0)).toBe(true);
  expect(Object.isFrozen(setupCentre_routes)).toBe(true);
  expect(Object.isFrozen(setupCentre_routes[0]?.steps)).toBe(true);
  expect(() => setupCentre_decodeRoute(setupCentre_routes[0]!)).not.toThrow();
  expect(() =>
    setupCentre_decodeRoute({
      ...setupCentre_routes[0],
      componentId: "codex-router",
    }),
  ).toThrow(/closed setup definition/);
  expect(setupCentre_getRoute("direct-provider").steps.map((step) => step.step)).toEqual([
    "detection",
    "installation",
    "account",
    "catalogue",
    "probe",
  ]);
  expect(setupCentre_getRoute("direct-provider").componentId).toBe("direct-provider");
});

test("component facts retain detection, install, transport, account, catalogue, permission and probe independently", () => {
  const decoded = setupCentre_decodeComponentFacts(componentFacts());
  expect(decoded.facts.map((fact) => fact.dimension)).toEqual(setupCentre_stepIds);
  expect(new Set(decoded.facts.map((fact) => fact.dimension)).size).toBe(8);
  expect(Object.isFrozen(decoded)).toBe(false);
  const clone = structuredClone(decoded) as unknown as {
    facts: Array<{ state: string }>;
  };
  clone.facts[0]!.state = "unknown";
  expect(decoded.facts[0]!.state).toBe("verified");
});

test("strict decoders reject extras, duplicate facts, accessors, oversize values and stale versions", () => {
  expect(() =>
    setupCentre_decodeComponentFacts({ ...componentFacts(), detail: "raw provider error" }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    setupCentre_decodeComponentFacts({
      ...componentFacts(),
      facts: [
        ...componentFacts().facts,
        { dimension: "probe", state: "verified", observedAt: at, reasonCode: "detected" },
      ],
    }),
  ).toThrow(/collection limit|unique/);
  expect(() =>
    setupCentre_decodeComponentFacts({
      ...componentFacts(),
      componentId: "router",
    }),
  ).toThrow();

  const resourceKey = {
    componentId: "direct-provider",
    resource: "detection",
  } as Record<string, unknown>;
  Object.defineProperty(resourceKey, "scopeId", {
    enumerable: true,
    get: () => "must-not-run",
  });
  expect(() =>
    setupCentre_decodeOperationRequest({
      ...directRequest(),
      resourceKey,
    }),
  ).toThrow(/enumerable data/);

  expect(() =>
    setupCentre_decodeOperationRequest(
      JSON.parse(
        JSON.stringify({
          ...directRequest(),
          resourceKey: { ...directRequest().resourceKey, scopeId: `sk-${"a".repeat(200)}` },
        }),
      ),
    ),
  ).toThrow(/string limit|credential-shaped/);
  expect(() =>
    setupCentre_decodeOperationRequest({
      ...directRequest(),
      resourceKey: {
        componentId: "direct-provider",
        resource: "detection",
        scopeId: "sk-live-credential",
      },
    }),
  ).toThrow(/credential-shaped/);
  expect(() =>
    setupCentre_decodeOperationRequest({
      ...directRequest(),
      resourceKey: {
        componentId: "direct-provider",
        resource: "detection",
        scopeId: "https://provider.example/raw",
      },
    }),
  ).toThrow(/opaque identifier/);
  expect(() => setupCentre_decodeCheckpoint({ ...directCheckpoint(), schemaVersion: 2 })).toThrow(
    /unsupported/,
  );
});

test("checkpoint and operation decoders cross-check route, step, resource and version identity", () => {
  const checkpoint = setupCentre_decodeCheckpoint(directCheckpoint());
  expect(checkpoint.componentId).toBe("direct-provider");
  expect(() =>
    setupCentre_decodeCheckpoint({
      ...directCheckpoint(),
      componentId: "codex-router",
    }),
  ).toThrow(/does not match/);
  expect(() =>
    setupCentre_decodeOperationRequest({
      ...directRequest(),
      step: "account",
      resourceKey: { ...directRequest().resourceKey, resource: "account" },
    }),
  ).not.toThrow();
  expect(() =>
    setupCentre_decodeOperationRequest({
      ...directRequest(),
      resourceKey: { ...directRequest().resourceKey, componentId: "codex-router" },
    }),
  ).toThrow(/resource/);
  expect(() =>
    setupCentre_decodeOperationRequest({
      ...directRequest(),
      startedBy: "automatic",
    }),
  ).toThrow();
});

test("checkpoint anchors are separate persistence-owner facts without embedded hashes", () => {
  const checkpoint = directCheckpoint();
  const anchor = {
    schemaVersion: setupCentre_checkpointAnchorSchemaVersion,
    authority: "persistence-owner" as const,
    checkpoint,
  };
  expect(setupCentre_decodeCheckpointAnchor(anchor)).toEqual(anchor);
  expect(() =>
    setupCentre_decodeCheckpointAnchor({
      ...anchor,
      digest: "embedded-self-hash-is-not-authentication",
    }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    setupCentre_decodeCheckpointAnchor({
      ...anchor,
      authority: "renderer",
    }),
  ).toThrow(/authority/);
  expect(() =>
    setupCentre_decodeCheckpointAnchor({
      ...anchor,
      schemaVersion: 2,
    }),
  ).toThrow(/schemaVersion/);
});

test("persistence cursors and authority state are closed and bounded", () => {
  const identity = persistenceIdentity();
  expect(setupPersistence_decodeIdentity(identity)).toEqual(identity);
  expect(setupPersistence_cursorKinds).toEqual(["idle", "admitted", "settled", "retired"]);
  for (const cursor of [
    { kind: "idle" as const },
    { kind: "admitted" as const, identity },
    { kind: "settled" as const, identity, outcome: "verified" as const },
    { kind: "settled" as const, identity, outcome: "unverified" as const },
    {
      kind: "retired" as const,
      identity,
      outcome: "releasing-cancellation" as const,
      cancellationId: "cancel-op-detection-1",
      cancellationOutcome: "stopped" as const,
      effects: "none" as const,
    },
  ]) {
    expect(setupPersistence_decodeCursor(cursor)).toEqual(cursor);
  }
  expect(() =>
    setupPersistence_decodeCursor({
      kind: "retired",
      identity,
      outcome: "releasing-cancellation",
      cancellationId: "cancel-op-detection-1",
      cancellationOutcome: "stopped",
      effects: "partial",
    }),
  ).toThrow(/effects must be none/);
  const current = {
    schemaVersion: setupPersistence_schemaVersion,
    authority: "persistence-owner" as const,
    authorityRevision: 7,
    cursor: { kind: "admitted" as const, identity },
  };
  expect(setupPersistence_decodeAuthorityState(current)).toEqual(current);
  expect(() =>
    setupPersistence_decodeAuthorityState({
      ...current,
      authorityRevision: -1,
    }),
  ).toThrow(/nonnegative/);
  expect(() =>
    setupPersistence_decodeAuthorityState({
      ...current,
      cursor: { ...current.cursor, observation: "raw runtime data" },
    }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    setupPersistence_decodeIdentity({
      ...identity,
      resourceKey: { ...identity.resourceKey, resource: "probe" },
    }),
  ).toThrow(/must match/);
});

test("transition requests are explicit, strict and carry no observations or errors", () => {
  const identity = persistenceIdentity();
  expect(setupPersistence_transitionKinds).toEqual([
    "admit",
    "settle",
    "retire",
    "cancel-nonreleasing",
    "restart",
    "configure",
  ]);
  const requests = [
    { kind: "admit" as const, expectedAuthorityRevision: 0, identity },
    {
      kind: "settle" as const,
      expectedAuthorityRevision: 1,
      identity,
      outcome: "verified" as const,
    },
    {
      kind: "settle" as const,
      expectedAuthorityRevision: 2,
      identity,
      outcome: "unverified" as const,
    },
    {
      kind: "retire" as const,
      expectedAuthorityRevision: 3,
      identity,
      cancellationId: "cancel-1",
      cancellationOutcome: "completed-before-cancel" as const,
      effects: "unknown" as const,
      retiredAt: at,
    },
    {
      kind: "cancel-nonreleasing" as const,
      expectedAuthorityRevision: 4,
      identity,
      cancellationId: "cancel-2",
      cancellationOutcome: "failed-to-stop" as const,
      effects: "partial" as const,
    },
    {
      kind: "restart" as const,
      expectedAuthorityRevision: 5,
      restartId: "restart-1",
      configRevision: 1,
    },
    {
      kind: "configure" as const,
      expectedAuthorityRevision: 6,
      configRevision: 2,
    },
  ];
  for (const request of requests) {
    expect(setupPersistence_decodeTransitionRequest(request)).toEqual(request);
  }
  for (const effects of ["none", "partial", "unknown"] as const) {
    const completedRace = {
      kind: "retire" as const,
      expectedAuthorityRevision: 7,
      identity,
      cancellationId: "cancel-completed-race",
      cancellationOutcome: "completed-before-cancel" as const,
      effects,
      retiredAt: at,
    };
    expect(setupPersistence_decodeTransitionRequest(completedRace)).toEqual(completedRace);
  }
  expect(() =>
    setupPersistence_decodeTransitionRequest({
      ...requests[0],
      observation: "command output",
    }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    setupPersistence_decodeTransitionRequest({
      ...requests[0],
      errorMessage: "raw provider error",
    }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    setupPersistence_decodeTransitionRequest({
      ...requests[3],
      cancellationOutcome: "stopped",
      effects: "partial",
    }),
  ).toThrow(/must be none/);
  expect(() =>
    setupPersistence_decodeTransitionRequest({
      ...requests[3],
      cancellationOutcome: "never-started",
      effects: "partial",
    }),
  ).toThrow(/must be none/);
  expect(() =>
    setupPersistence_decodeTransitionRequest({
      ...requests[4],
      cancellationOutcome: "unknown",
    }),
  ).toThrow(/inconsistent/);
});

test("opaque identifiers accept public handles and reject known credential token shapes", () => {
  const publicIds = [
    "provider-slot-primary",
    "account-slot-01",
    "setup:detection:v2",
    "profile.primary",
    "AKIA-region-1",
  ];
  for (const scopeId of publicIds) {
    expect(
      setupCentre_decodeResourceKey({
        componentId: "direct-provider",
        resource: "detection",
        scopeId,
      }).scopeId,
    ).toBe(scopeId);
  }
  const tokenShapes = [
    `ghp_${"A".repeat(36)}`,
    `github_pat_${"a".repeat(40)}`,
    "AKIAIOSFODNN7EXAMPLE",
    "xoxb-invalid",
    "xapp-1-A1234567890-1234567890123-abcdef",
    "sk_live_51ExampleUnsafeValue",
    "rk_test_51ExampleUnsafeValue",
    "whsec_ExampleUnsafeValue",
  ];
  for (const scopeId of tokenShapes) {
    try {
      setupCentre_decodeResourceKey({
        componentId: "direct-provider",
        resource: "detection",
        scopeId,
      });
      throw new Error("credential-shaped scopeId was accepted");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/credential-shaped/);
      expect(message).not.toContain(scopeId);
    }
  }
  expect(() =>
    setupCentre_decodeOperationRequest({
      ...directRequest(),
      operationId: "ghp_ExampleUnsafeOperation",
    }),
  ).toThrow(/credential-shaped/);
});

test("retired operation history is closed, bounded and bound to monotonic high-water marks", () => {
  const retired = {
    operationId: "op-retired-1",
    operationSequence: 2,
    generation: 1,
    retiredAt: at,
    outcome: "stopped" as const,
    cancellationId: "cancel-retired-1",
    effects: "none" as const,
  };
  expect(setupCentre_decodeRetiredOperation(retired)).toEqual(retired);
  expect(
    setupCentre_decodeRetiredOperation({
      ...retired,
      outcome: "completed-before-cancel",
      effects: "partial",
    }),
  ).toMatchObject({ outcome: "completed-before-cancel", effects: "partial" });
  expect(() =>
    setupCentre_decodeRetiredOperation({
      ...retired,
      effects: "partial",
    }),
  ).toThrow(/effects must be none/);
  expect(() =>
    setupCentre_decodeRetiredOperation({
      ...retired,
      cancellationId: `ghp_${"A".repeat(36)}`,
    }),
  ).toThrow(/credential-shaped/);
  expect(
    setupCentre_decodeCheckpoint({
      ...directCheckpoint(),
      operationSequence: 2,
      retiredOperations: [retired],
    }).retiredOperations,
  ).toEqual([retired]);
  expect(() =>
    setupCentre_decodeCheckpoint({
      ...directCheckpoint(),
      operationSequence: 2,
      retiredOperations: [retired, { ...retired, operationSequence: 3, generation: 1 }],
    }),
  ).toThrow(/unique/);
  expect(() =>
    setupCentre_decodeCheckpoint({
      ...directCheckpoint(),
      operationSequence: 2,
      retiredOperations: [
        retired,
        {
          ...retired,
          operationId: "op-retired-2",
          generation: 1,
        },
      ],
    }),
  ).toThrow(/sequences must be unique/);
  expect(() =>
    setupCentre_decodeCheckpoint({
      ...directCheckpoint(),
      operationSequence: 1,
      retiredOperations: [retired],
    }),
  ).toThrow(/high-water/);
  expect(() =>
    setupCentre_decodeCheckpoint({
      ...directCheckpoint(),
      operationSequence: 2,
      retiredOperations: [{ ...retired, unexpected: true }],
    }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    setupCentre_decodeCheckpoint({
      ...directCheckpoint(),
      operationSequence: 2,
      lastCompletedOperationId: "op-retired-1",
      retiredOperations: [retired],
    }),
  ).toThrow(/last completed/);
  expect(() =>
    setupCentre_decodeRetiredOperation({
      ...retired,
      outcome: "failed-to-stop",
    }),
  ).toThrow(/accepted value/);
  const bounded = Array.from({ length: 32 }, (_, index) => ({
    operationId: `op-retired-${index}`,
    operationSequence: index + 1,
    generation: 1,
    retiredAt: at,
    outcome: "stopped" as const,
    cancellationId: `cancel-op-retired-${index}`,
    effects: "none" as const,
  }));
  expect(
    setupCentre_decodeCheckpoint({
      ...directCheckpoint(),
      operationSequence: 32,
      retiredOperations: bounded,
    }).retiredOperations,
  ).toHaveLength(32);
  expect(() =>
    setupCentre_decodeCheckpoint({
      ...directCheckpoint(),
      operationSequence: 33,
      retiredOperations: [
        ...bounded,
        {
          operationId: "op-retired-33",
          operationSequence: 33,
          generation: 1,
          retiredAt: at,
          outcome: "stopped" as const,
          cancellationId: "cancel-op-retired-33",
          effects: "none" as const,
        },
      ],
    }),
  ).toThrow(/collection limit/);
});

test("cancellation intent and receipt are distinct closed payloads", () => {
  const intent = setupCentre_decodeCancellationIntent({
    kind: "cancellation-intent",
    request: {
      cancellationId: "cancel-1",
      operationId: "op-detect-1",
      generation: 1,
      configRevision: 1,
      reason: "user-cancelled",
    },
    requestedAt: at,
  });
  expect(intent.kind).toBe("cancellation-intent");
  expect(() =>
    setupCentre_decodeCancellationIntent({
      ...intent,
      outcome: "stopped",
    }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    setupCentre_decodeCancellationReceipt({
      kind: "cancellation-receipt",
      cancellationId: "cancel-1",
      operationId: "op-detect-1",
      generation: 1,
      configRevision: 1,
      outcome: "stopped",
      effects: "partial",
      observedAt: at,
    }),
  ).toThrow(/effects must be none/);
  expect(() =>
    setupCentre_decodeCancellationReceipt({
      kind: "cancellation-receipt",
      cancellationId: "cancel-1",
      operationId: "op-detect-1",
      generation: 1,
      configRevision: 1,
      outcome: "unknown",
      effects: "none",
      observedAt: at,
    }),
  ).toThrow(/unknown effects/);
});

test("handoffs and status projections contain stable codes rather than external text", () => {
  const handoff = {
    kind: "complete-account-step",
    routeId: "direct-provider",
    step: "account",
    generation: 1,
    configRevision: 1,
    operationId: null,
    reasonCode: "account-action-required",
  } as const;
  expect(setupCentre_decodeHandoff(handoff)).toEqual(handoff);
  expect(() =>
    setupCentre_decodeHandoff({ ...handoff, providerMessage: "paste this body" }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    setupCentre_decodeHandoff({ ...handoff, reasonCode: "provider said paste token" }),
  ).toThrow(/accepted value/);

  const checkpoint = directCheckpoint();
  const status = {
    routeId: checkpoint.routeId,
    componentId: checkpoint.componentId,
    readiness: "needs-account",
    ready: false,
    requiresInspection: false,
    currentStep: "account",
    steps: checkpoint.progress.steps.map((step) => ({
      ...step,
      requirement: "required",
      state: step.step === "account" ? "needs-action" : "complete",
      evidence: step.step === "account" ? "not-detected" : "verified",
      reasonCode: step.step === "account" ? "credentials-missing" : "detected",
    })),
    handoff,
  };
  expect(setupCentre_decodeStatusProjection(status).ready).toBe(false);
  expect(() =>
    setupCentre_decodeStatusProjection({
      ...status,
      steps: status.steps.map((step, index) =>
        index === 0 ? { ...step, requirement: "optional" } : step,
      ),
    }),
  ).not.toThrow();
  expect(() =>
    setupCentre_decodeStatusProjection({
      ...status,
      readiness: "ready",
      ready: true,
      requiresInspection: true,
      currentStep: null,
      handoff: null,
    }),
  ).toThrow(/inspection/);
});
