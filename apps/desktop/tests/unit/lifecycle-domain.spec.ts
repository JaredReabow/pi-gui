import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
  lifecycle_fullStages,
  lifecycle_macosWindowCloseStages,
  type LifecycleCancellationOutcome,
  type LifecyclePartialEffects,
  type LifecycleRequestKey,
  type LifecycleRevalidationBoundary,
  type StageCheckpoint,
  type StageReceipt,
  type LifecycleStage,
  type LifecycleStageAttempt,
  type LifecycleWorkFacts,
} from "../../contracts/lifecycle";
import {
  lifecycleDomain_arbitrateRequest,
  lifecycleDomain_classify,
  lifecycleDomain_classifyDraftFlush,
  lifecycleDomain_effectBoundaryReached,
  lifecycleDomain_projectInterruption,
  lifecycleDomain_recoverAbruptCrash,
  lifecycleDomain_revalidateStage,
  lifecycleDomain_stageNames,
  lifecycleDomain_transition,
  type LifecycleSequenceState,
} from "../../electron/lifecycle/lifecycle-domain";

const at = 1_764_000_000_000;
const workspaceRoot = path.resolve(__dirname, "../../../..");

function facts(overrides: Partial<LifecycleWorkFacts> = {}): LifecycleWorkFacts {
  return {
    leaseOwnership: "local",
    parentRuns: 0,
    childRuns: 0,
    queuedRuns: 0,
    pendingTools: 0,
    activeInlineWorkers: 0,
    workerSurvival: "not-applicable",
    missingFacts: 0,
    ...overrides,
  };
}

function partialEffects(overrides: Partial<LifecyclePartialEffects> = {}): LifecyclePartialEffects {
  return {
    draftIdentitiesSaved: [],
    statePersisted: false,
    teardownIntentPersisted: false,
    terminalReceiptIdentitiesPersisted: [],
    disposedIdentities: [],
    releasedLeaseIdentities: [],
    retainedLeaseIdentities: [],
    cancellation: null,
    ...overrides,
  };
}

function effectsAfterSuccessfulStage(
  stage: LifecycleStage,
  prior: LifecyclePartialEffects,
): LifecyclePartialEffects {
  const next = {
    ...prior,
    draftIdentitiesSaved: [...prior.draftIdentitiesSaved],
    terminalReceiptIdentitiesPersisted: [...prior.terminalReceiptIdentitiesPersisted],
    disposedIdentities: [...prior.disposedIdentities],
    releasedLeaseIdentities: [...prior.releasedLeaseIdentities],
    retainedLeaseIdentities: [...prior.retainedLeaseIdentities],
    cancellation: prior.cancellation,
  };
  if (stage === "flush-drafts") {
    next.draftIdentitiesSaved = [...new Set([...next.draftIdentitiesSaved, "draft:window-A:7"])];
  }
  if (stage === "persist-state-and-teardown-intent") {
    next.statePersisted = true;
    next.teardownIntentPersisted = true;
  }
  if (stage === "cancel-and-wait" && next.cancellation === null) {
    next.cancellation = cancellation();
  }
  return next;
}

function effectsForAttempt(
  stage: LifecycleStage,
  outcome: "succeeded" | "failed",
  prior: LifecyclePartialEffects,
): LifecyclePartialEffects {
  return outcome === "succeeded" ? effectsAfterSuccessfulStage(stage, prior) : prior;
}

function cancellation(
  overrides: Partial<LifecycleCancellationOutcome> = {},
): LifecycleCancellationOutcome {
  return {
    stoppedIdentities: [],
    failedToStopIdentities: [],
    neverStartedIdentities: [],
    stillUnsettledIdentities: [],
    terminalOutcomes: [],
    leaseCustody: "retained",
    ...overrides,
  };
}

function attempt(
  stage: LifecycleStage,
  outcome: "succeeded" | "failed" = "succeeded",
  effects = partialEffects(),
): LifecycleStageAttempt {
  return { stage, outcome, partialEffects: effects };
}

const windowARequest = {
  intent: "window-close",
  target: { kind: "window", windowId: "window-A" },
  effectScope: { kind: "window", windowId: "window-A", revision: 1 },
} as const;
const windowBRequest = {
  intent: "window-close",
  target: { kind: "window", windowId: "window-B" },
  effectScope: { kind: "window", windowId: "window-B", revision: 1 },
} as const;
const quitRequest = {
  intent: "app-quit",
  target: { kind: "application" },
  effectScope: { kind: "application", revision: 2 },
} as const;
const relaunchRequest = {
  intent: "app-relaunch",
  target: { kind: "application" },
  effectScope: { kind: "application", revision: 2 },
} as const;
const operationRequestKey: LifecycleRequestKey = windowARequest;

function draftTarget(
  windowId = "window-A",
  editGeneration = 7,
  operationId = "op-1",
  requestKey: LifecycleRequestKey = windowId === "window-B" ? windowBRequest : operationRequestKey,
) {
  return {
    operationId,
    requestKey,
    windowId,
    editGeneration,
  };
}

function draftOutcome(
  status: "saved" | "no-pending" | "rejected" | "timeout" | "renderer-gone",
  windowId = "window-A",
  editGeneration = 7,
  operationId = "op-1",
  requestKey: LifecycleRequestKey = windowId === "window-B" ? windowBRequest : operationRequestKey,
) {
  return { ...draftTarget(windowId, editGeneration, operationId, requestKey), status };
}

function domainTransition(input: {
  state: LifecycleSequenceState;
  attempt: LifecycleStageAttempt;
  stageReceipts?: readonly StageReceipt[];
}) {
  return lifecycleDomain_transition({
    operationId: "op-1",
    requestKey: operationRequestKey,
    stageReceipts: input.stageReceipts ?? [],
    state: input.state,
    attempt: input.attempt,
  });
}

function stoppedPairCancellationTransition(
  stageReceipts: readonly StageReceipt[],
  cancellationOverrides: Partial<LifecycleCancellationOutcome> = {},
) {
  const prior = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
  });
  return domainTransition({
    state: {
      profile: "full",
      completedStages: lifecycle_fullStages.slice(0, 4),
      failedStage: null,
      partialEffects: prior,
    },
    attempt: attempt("cancel-and-wait", "succeeded", {
      ...prior,
      cancellation: cancellation({
        stoppedIdentities: ["child-1", "child-2"],
        terminalOutcomes: [
          { identity: "child-1", outcome: "stopped" },
          { identity: "child-2", outcome: "stopped" },
        ],
        ...cancellationOverrides,
      }),
    }),
    stageReceipts,
  });
}

function exportedNames(filePath: string): ReadonlySet<string> {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set<string>();
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (
      exported &&
      (ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    }
    if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text);
      }
    }
  }
  return names;
}

function receipt(
  kind: StageReceipt["kind"],
  identity: string,
  fromState: string,
  toState: string,
  stage: LifecycleStage,
  operationId = "op-1",
  observedAt = at + 10,
  success = true,
): StageReceipt {
  return {
    operationId,
    requestKey: operationRequestKey,
    stage,
    identities: [identity],
    kind,
    fromState,
    toState,
    cause: "operation",
    success,
    observedAt,
  };
}

function checkpoint(overrides: Partial<StageCheckpoint> = {}): StageCheckpoint {
  return {
    operationId: "op-1",
    requestKey: operationRequestKey,
    stage: "capture-and-decide",
    censusRevision: 7,
    work: [
      { kind: "parent-run", identity: "parent-1", state: "running" },
      { kind: "child-run", identity: "child-1", state: "running" },
      { kind: "pending-tool", identity: "call-1", state: "pending" },
    ],
    leases: [{ identity: "session-1", ownership: "local" }],
    draftGenerations: [{ windowId: "window-A", editGeneration: 7, status: "pending" }],
    capturedAt: at,
    ...overrides,
  };
}

function revalidate(
  boundary: LifecycleRevalidationBoundary,
  baseline: StageCheckpoint,
  current: StageCheckpoint,
  receipts: readonly StageReceipt[],
) {
  return lifecycleDomain_revalidateStage({
    operationId: "op-1",
    requestKey: operationRequestKey,
    boundary,
    baseline,
    current,
    receipts,
  });
}

test("admission distinguishes explicit idle, active, and unknown facts", () => {
  expect(lifecycleDomain_classify(facts())).toEqual({
    execution: "idle",
    admission: "proceed",
    requiresDecision: false,
  });
  expect(
    lifecycleDomain_classify(
      facts({ parentRuns: 1, childRuns: 1, pendingTools: 1, activeInlineWorkers: 1 }),
    ),
  ).toEqual({
    execution: "active",
    admission: "needs-decision",
    requiresDecision: true,
  });
  expect(lifecycleDomain_classify(facts({ workerSurvival: "proven-live" }))).toEqual({
    execution: "active",
    admission: "needs-decision",
    requiresDecision: true,
  });
  for (const unresolved of [
    facts({ leaseOwnership: "foreign-live" }),
    facts({ leaseOwnership: "unknown" }),
    facts({ workerSurvival: "unknown" }),
    facts({ missingFacts: 1 }),
  ]) {
    expect(lifecycleDomain_classify(unresolved)).toEqual({
      execution: "unknown",
      admission: "blocked-unknown",
      requiresDecision: false,
    });
  }
});

test("all accepted admission fixtures preserve unknown evidence before activity", () => {
  const fixtures = [
    { facts: facts(), expected: "proceed" },
    {
      facts: facts({ parentRuns: 1, childRuns: 1, pendingTools: 1 }),
      expected: "needs-decision",
    },
    {
      facts: facts({ parentRuns: 1, pendingTools: 1 }),
      expected: "needs-decision",
    },
    {
      facts: facts({ leaseOwnership: "foreign-live" }),
      expected: "blocked-unknown",
    },
    {
      facts: facts({
        leaseOwnership: "unknown",
        workerSurvival: "unknown",
      }),
      expected: "blocked-unknown",
    },
    { facts: facts({ missingFacts: 1 }), expected: "blocked-unknown" },
  ] as const;
  for (const fixture of fixtures) {
    expect(lifecycleDomain_classify(fixture.facts).admission).toBe(fixture.expected);
  }
});

test("draft outcomes gate state persistence and keep the open state until commit", () => {
  expect(
    lifecycleDomain_classifyDraftFlush({
      expectedTargets: [
        draftTarget("window-A", 7, "op-1", quitRequest),
        draftTarget("window-B", 3, "op-1", quitRequest),
      ],
      outcomes: [
        draftOutcome("saved", "window-A", 7, "op-1", quitRequest),
        draftOutcome("no-pending", "window-B", 3, "op-1", quitRequest),
      ],
      statePersistenceSuccess: true,
    }),
  ).toEqual({
    nextState: "persisting-state-and-intent",
    commitAllowed: false,
  });
  for (const status of ["rejected", "timeout", "renderer-gone"] as const) {
    expect(
      lifecycleDomain_classifyDraftFlush({
        expectedTargets: [draftTarget()],
        outcomes: [draftOutcome(status)],
        statePersistenceSuccess: true,
      }),
    ).toEqual({
      nextState: "needs-decision",
      commitAllowed: false,
    });
  }
  expect(
    lifecycleDomain_classifyDraftFlush({
      expectedTargets: [draftTarget()],
      outcomes: [draftOutcome("saved")],
      statePersistenceSuccess: false,
    }),
  ).toEqual({
    nextState: "failed-kept-open",
    commitAllowed: false,
  });
  expect(() =>
    lifecycleDomain_classifyDraftFlush({
      expectedTargets: [],
      outcomes: [],
      statePersistenceSuccess: true,
    }),
  ).toThrow(/target|draft/i);
});

test("draft outcomes reject duplicate, unknown, missing, sparse, and unbound targets", () => {
  const valid = {
    expectedTargets: [draftTarget()],
    outcomes: [draftOutcome("saved")],
    statePersistenceSuccess: true,
  };
  expect(lifecycleDomain_classifyDraftFlush(valid)).toMatchObject({
    nextState: "persisting-state-and-intent",
  });
  for (const invalid of [
    { ...valid, outcomes: [draftOutcome("saved"), draftOutcome("saved")] },
    { ...valid, outcomes: [draftOutcome("saved", "window-B")] },
    { ...valid, outcomes: [] },
    { ...valid, outcomes: [draftOutcome("saved", "window-A", 7, "other-op")] },
    { ...valid, expectedTargets: Array(1) },
  ]) {
    expect(() => lifecycleDomain_classifyDraftFlush(invalid)).toThrow(
      /draft|target|dense|unknown/i,
    );
  }
});

test("verifier regression: empty draft expectation sets reject", () => {
  expect(() =>
    lifecycleDomain_classifyDraftFlush({
      expectedTargets: [],
      outcomes: [],
      statePersistenceSuccess: true,
    }),
  ).toThrow(/target|draft/i);
});

test("verifier regression: draft batches cannot mix operations or request scopes", () => {
  const mixedOperations = {
    expectedTargets: [
      draftTarget("window-A", 7, "op-1", quitRequest),
      draftTarget("window-B", 3, "op-2", quitRequest),
    ],
    outcomes: [
      draftOutcome("saved", "window-A", 7, "op-1", quitRequest),
      draftOutcome("saved", "window-B", 3, "op-2", quitRequest),
    ],
    statePersistenceSuccess: true,
  };
  expect(() => lifecycleDomain_classifyDraftFlush(mixedOperations)).toThrow(
    /operation|scope|batch/i,
  );
  expect(() =>
    lifecycleDomain_classifyDraftFlush({
      expectedTargets: [
        draftTarget("window-A", 7, "op-1", windowARequest),
        draftTarget("window-B", 3, "op-1", windowBRequest),
      ],
      outcomes: [
        draftOutcome("saved", "window-A", 7, "op-1", windowARequest),
        draftOutcome("saved", "window-B", 3, "op-1", windowBRequest),
      ],
      statePersistenceSuccess: true,
    }),
  ).toThrow(/scope|batch/i);
});

test("compatible joins are intent, target, and effect revision exact", () => {
  const operation = {
    operationId: "op-1",
    request: windowARequest,
    stage: "capture-and-decide" as const,
  };
  expect(lifecycleDomain_arbitrateRequest(null, windowARequest, "request-1")).toEqual({
    decision: "started",
    callerRelation: "started",
    operationId: "request-1",
    recaptureRequired: true,
  });
  expect(lifecycleDomain_arbitrateRequest(operation, windowARequest)).toEqual({
    decision: "join",
    callerRelation: "joined",
    operationId: "op-1",
    secondFlushCount: 0,
  });
  expect(
    lifecycleDomain_arbitrateRequest(operation, {
      ...windowARequest,
      effectScope: { ...windowARequest.effectScope, revision: 2 },
    }),
  ).toMatchObject({ decision: "queue", secondStartsFromCapture: true });
  expect(lifecycleDomain_arbitrateRequest(operation, windowBRequest, "request-B")).toMatchObject({
    decision: "queue",
    callerRelation: "queued",
    activeOperationId: "op-1",
  });
});

test("verifier regression: started arbitration returns its operation identity", () => {
  expect(
    lifecycleDomain_arbitrateRequest(
      null,
      {
        intent: "app-quit",
        target: { kind: "application" },
        effectScope: { kind: "application", revision: 3 },
      },
      "started-op",
    ),
  ).toEqual({
    decision: "started",
    callerRelation: "started",
    operationId: "started-op",
    recaptureRequired: true,
  });
  expect(
    lifecycleDomain_arbitrateRequest(null, {
      intent: "app-quit",
      target: { kind: "application" },
      effectScope: { kind: "application", revision: 3 },
    }),
  ).toHaveProperty("operationId");
});

test("Quit and relaunch escalate before effects and serialize or reject after the barrier", () => {
  const closingA = {
    operationId: "close-A",
    request: windowARequest,
    stage: "capture-and-decide" as const,
  };
  expect(lifecycleDomain_arbitrateRequest(closingA, quitRequest)).toEqual({
    decision: "escalate",
    callerRelation: "escalated",
    operationId: "close-A",
    activeRequestResult: "superseded-by-escalation",
    recaptureRequired: true,
    priorDecisionReused: false,
  });
  expect(
    lifecycleDomain_arbitrateRequest({ ...closingA, stage: "barrier-and-revalidate" }, quitRequest),
  ).toMatchObject({ decision: "queue", callerRelation: "queued" });

  const quitting = {
    operationId: "quit",
    request: quitRequest,
    stage: "capture-and-decide" as const,
  };
  expect(lifecycleDomain_arbitrateRequest(quitting, relaunchRequest)).toMatchObject({
    decision: "escalate",
    callerRelation: "escalated",
    activeRequestResult: "superseded-by-escalation",
  });
  expect(
    lifecycleDomain_arbitrateRequest(
      { ...quitting, stage: "barrier-and-revalidate" },
      relaunchRequest,
      "relaunch-2",
    ),
  ).toEqual({
    decision: "reject",
    callerRelation: "rejected",
    operationId: "relaunch-2",
    activeOperationId: "quit",
    callerResult: "rejected-incompatible",
    activeOperationResultChanged: false,
  });
  expect(lifecycleDomain_effectBoundaryReached("capture-and-decide")).toBe(false);
  expect(lifecycleDomain_effectBoundaryReached("barrier-and-revalidate")).toBe(true);
});

test("full lifecycle follows one exact stage order and completes only after lifecycle action", () => {
  let state: LifecycleSequenceState = {
    profile: "full",
    completedStages: [],
    failedStage: null,
  };
  for (const [index, stage] of lifecycle_fullStages.entries()) {
    const priorEffects = state.partialEffects ?? partialEffects();
    const result = domainTransition({
      state,
      attempt: attempt(stage, "succeeded", effectsForAttempt(stage, "succeeded", priorEffects)),
    });
    expect(result.attemptedStage).toBe(stage);
    expect(result.completedStages).toEqual(lifecycle_fullStages.slice(0, index + 1));
    expect(result.failedStage).toBeNull();
    expect(result.lifecycleActionAllowed).toBe(index === lifecycle_fullStages.length - 1);
    state = {
      profile: "full",
      completedStages: result.completedStages,
      failedStage: result.failedStage,
      partialEffects: result.partialEffects,
    };
  }
  expect(state.completedStages).toEqual(lifecycle_fullStages);
  expect(lifecycleDomain_stageNames("full")).toEqual(lifecycle_fullStages);
});

test("macOS window close never attempts runtime cancellation or disposal", () => {
  let state: LifecycleSequenceState = {
    profile: "macos-window-close",
    completedStages: [],
    failedStage: null,
  };
  for (const stage of lifecycle_macosWindowCloseStages) {
    const result = domainTransition({
      state,
      attempt: attempt(
        stage,
        "succeeded",
        effectsForAttempt(stage, "succeeded", state.partialEffects ?? partialEffects()),
      ),
    });
    expect(result.cancellationAttempted).toBe(false);
    expect(result.disposalAttempted).toBe(false);
    state = {
      profile: "macos-window-close",
      completedStages: result.completedStages,
      failedStage: result.failedStage,
      partialEffects: result.partialEffects,
    };
  }
  expect(state.completedStages).toEqual(lifecycle_macosWindowCloseStages);
});

test("an injected failure at every ordered stage stops effects and refuses continuation", () => {
  for (let failureIndex = 0; failureIndex < lifecycle_fullStages.length; failureIndex += 1) {
    let state: LifecycleSequenceState = {
      profile: "full",
      completedStages: [],
      failedStage: null,
    };
    for (let index = 0; index <= failureIndex; index += 1) {
      const stage = lifecycle_fullStages[index]!;
      const outcome = index === failureIndex ? "failed" : "succeeded";
      const priorEffects = state.partialEffects ?? partialEffects();
      const result = domainTransition({
        state,
        attempt: attempt(stage, outcome, effectsForAttempt(stage, outcome, priorEffects)),
      });
      if (index < failureIndex) {
        state = {
          profile: "full",
          completedStages: result.completedStages,
          failedStage: null,
          partialEffects: result.partialEffects,
        };
      } else {
        expect(result.failedStage).toBe(stage);
        expect(result.nextStage).toBeNull();
        expect(result.lifecycleActionAllowed).toBe(false);
        expect(() =>
          domainTransition({
            state: {
              profile: "full",
              completedStages: result.completedStages,
              failedStage: result.failedStage,
              partialEffects: result.partialEffects,
            },
            attempt: attempt("lifecycle-action"),
          }),
        ).toThrow(/terminal/);
      }
    }
  }
});

test("partial cancellation facts survive a cancellation-stage failure", () => {
  let state: LifecycleSequenceState = {
    profile: "full",
    completedStages: [],
    failedStage: null,
  };
  for (const stage of lifecycle_fullStages.slice(0, 4)) {
    const result = domainTransition({
      state,
      attempt: attempt(
        stage,
        "succeeded",
        effectsAfterSuccessfulStage(stage, state.partialEffects ?? partialEffects()),
      ),
    });
    state = {
      profile: "full",
      completedStages: result.completedStages,
      failedStage: null,
      partialEffects: result.partialEffects,
    };
  }
  const partial = cancellation({
    stoppedIdentities: ["child-1"],
    failedToStopIdentities: ["child-2"],
    stillUnsettledIdentities: ["child-2"],
    terminalOutcomes: [{ identity: "child-1", outcome: "stopped" }],
  });
  const result = domainTransition({
    state,
    attempt: attempt("cancel-and-wait", "failed", {
      ...(state.partialEffects ?? partialEffects()),
      cancellation: partial,
    }),
  });
  expect(result).toMatchObject({
    failedStage: "cancel-and-wait",
    cancellationAttempted: true,
    disposalAttempted: false,
    partialEffects: { cancellation: partial },
  });
});

test("verifier regression: later failure cannot regress already-persisted partial effects", () => {
  const durable = partialEffects({
    draftIdentitiesSaved: ["draft:window-A:7"],
    statePersisted: true,
    teardownIntentPersisted: true,
  });
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 4),
    failedStage: null,
    partialEffects: durable,
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt("cancel-and-wait", "failed", {
        ...partialEffects(),
        cancellation: cancellation({ failedToStopIdentities: ["child-1"] }),
      }),
    }),
  ).toThrow(/persisted|partial|regress/i);

  expect(
    domainTransition({
      state,
      attempt: attempt("cancel-and-wait", "failed", {
        ...durable,
        cancellation: cancellation({ failedToStopIdentities: ["child-1"] }),
      }),
    }),
  ).toMatchObject({
    failedStage: "cancel-and-wait",
    partialEffects: {
      statePersisted: true,
      teardownIntentPersisted: true,
    },
    failure: {
      unresolvedIdentities: ["child-1"],
    },
  });
});

test("verifier regression: transition receipts must match the attempted stage and identity", () => {
  const initial: LifecycleSequenceState = {
    profile: "full",
    completedStages: [],
    failedStage: null,
    partialEffects: partialEffects(),
  };
  expect(() =>
    domainTransition({
      state: initial,
      attempt: attempt("capture-and-decide"),
      stageReceipts: [receipt("cancellation", "child-1", "running", "settled", "cancel-and-wait")],
    }),
  ).toThrow(/receipt|stage|future|order/i);

  const readyToFlush: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 2),
    failedStage: null,
    partialEffects: partialEffects(),
  };
  const draftEffects = partialEffects({
    draftIdentitiesSaved: ["draft:window-A:7"],
  });
  expect(
    domainTransition({
      state: readyToFlush,
      attempt: attempt("flush-drafts", "succeeded", draftEffects),
      stageReceipts: [
        receipt("draft-saved", "draft:window-A:7", "pending", "saved", "flush-drafts"),
      ],
    }),
  ).toMatchObject({ failedStage: null, completedStages: lifecycle_fullStages.slice(0, 3) });
  expect(() =>
    domainTransition({
      state: readyToFlush,
      attempt: attempt("flush-drafts", "succeeded", draftEffects),
      stageReceipts: [
        receipt(
          "draft-saved",
          "draft:window-A:7",
          "pending",
          "saved",
          "flush-drafts",
          "op-1",
          at + 1,
        ),
        receipt(
          "draft-saved",
          "draft:window-A:7",
          "pending",
          "saved",
          "flush-drafts",
          "op-1",
          at + 2,
        ),
      ],
    }),
  ).toThrow(/duplicate|receipt/i);
  expect(() =>
    domainTransition({
      state: readyToFlush,
      attempt: attempt("flush-drafts", "succeeded", draftEffects),
      stageReceipts: [
        receipt("draft-saved", "draft:window-B:9", "pending", "saved", "flush-drafts"),
      ],
    }),
  ).toThrow(/identity|unrelated|unknown/i);
});

test("verifier regression: domain receipt arrays reject accessor-backed indices", () => {
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 2),
    failedStage: null,
    partialEffects: partialEffects(),
  };
  const transitionReceipts = Array(1) as unknown[];
  Object.defineProperty(transitionReceipts, 0, {
    enumerable: true,
    configurable: true,
    get: () => receipt("draft-saved", "draft:window-A:7", "pending", "saved", "flush-drafts"),
  });
  expect(() =>
    domainTransition({
      state,
      attempt: attempt(
        "flush-drafts",
        "succeeded",
        partialEffects({ draftIdentitiesSaved: ["draft:window-A:7"] }),
      ),
      stageReceipts: transitionReceipts as unknown as readonly StageReceipt[],
    }),
  ).toThrow(/array|accessor|data property|JSON/i);

  const baseline = checkpoint({
    stage: "persist-state-and-teardown-intent",
    work: [{ kind: "child-run", identity: "child-1", state: "running" }],
  });
  const current = checkpoint({
    ...baseline,
    stage: "cancel-and-wait",
    censusRevision: 8,
    capturedAt: at + 2,
  });
  const revalidationReceipts = Array(1) as unknown[];
  Object.defineProperty(revalidationReceipts, 0, {
    enumerable: true,
    configurable: true,
    get: () => ({
      ...receipt(
        "cancellation",
        "child-1",
        "running",
        "retained",
        "cancel-and-wait",
        "op-1",
        at + 1,
        false,
      ),
    }),
  });
  expect(
    revalidate(
      "cancellation",
      baseline,
      current,
      revalidationReceipts as unknown as readonly StageReceipt[],
    ),
  ).toMatchObject({ decision: "reject" });
});

test("verifier regression: failed cancellation effects reject conflicting terminal receipts", () => {
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 4),
    failedStage: null,
    partialEffects: partialEffects({
      statePersisted: true,
      teardownIntentPersisted: true,
    }),
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt(
        "cancel-and-wait",
        "failed",
        partialEffects({
          statePersisted: true,
          teardownIntentPersisted: true,
          cancellation: cancellation({
            failedToStopIdentities: ["child-1"],
            stillUnsettledIdentities: ["child-1"],
          }),
        }),
      ),
      stageReceipts: [receipt("work-terminal", "child-1", "running", "settled", "cancel-and-wait")],
    }),
  ).toThrow(/settled|unsettled|failed|receipt|contradict/i);
});

test("verifier regression: cancellation merges reject contradictory identity outcomes", () => {
  const prior = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
    cancellation: cancellation({
      stoppedIdentities: ["child-1"],
      terminalOutcomes: [{ identity: "child-1", outcome: "stopped" }],
    }),
  });
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 5),
    failedStage: null,
    partialEffects: prior,
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt("persist-terminal-receipts", "succeeded", {
        ...prior,
        terminalReceiptIdentitiesPersisted: ["child-1"],
        cancellation: cancellation({
          failedToStopIdentities: ["child-1"],
          stillUnsettledIdentities: ["child-1"],
        }),
      }),
    }),
  ).toThrow(/contradict|cancellation|stopped|failed/i);
});

test("verifier regression: terminal persistence includes every known terminal identity", () => {
  const prior = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
    cancellation: cancellation({
      stoppedIdentities: ["child-1"],
      terminalOutcomes: [{ identity: "child-1", outcome: "stopped" }],
    }),
  });
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 5),
    failedStage: null,
    partialEffects: prior,
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt("persist-terminal-receipts", "succeeded", prior),
    }),
  ).toThrow(/terminal.*receipt|receipt.*terminal/i);
  expect(
    domainTransition({
      state,
      attempt: attempt("persist-terminal-receipts", "succeeded", {
        ...prior,
        terminalReceiptIdentitiesPersisted: ["child-1"],
      }),
      stageReceipts: [
        receipt("terminal-persisted", "child-1", "settled", "stopped", "persist-terminal-receipts"),
      ],
    }),
  ).toMatchObject({
    failedStage: null,
    partialEffects: {
      terminalReceiptIdentitiesPersisted: ["child-1"],
    },
  });
});

test("stage attempts cannot skip, duplicate, or advance a complete sequence", () => {
  const initial: LifecycleSequenceState = {
    profile: "full",
    completedStages: [],
    failedStage: null,
  };
  expect(() =>
    domainTransition({
      state: initial,
      attempt: attempt("flush-drafts"),
    }),
  ).toThrow(/expected stage/);
  expect(() =>
    domainTransition({
      state: {
        profile: "full",
        completedStages: ["barrier-and-revalidate"],
        failedStage: null,
      },
      attempt: attempt("barrier-and-revalidate"),
    }),
  ).toThrow(/ordered prefix/);
  expect(() =>
    domainTransition({
      state: {
        profile: "full",
        completedStages: [...lifecycle_fullStages],
        failedStage: null,
      },
      attempt: attempt("lifecycle-action"),
    }),
  ).toThrow(/no next stage/);
});

test("receipt-aware revalidation advances through exact preceding stages", () => {
  const capture = checkpoint();
  const barrier = checkpoint({
    stage: "barrier-and-revalidate",
    capturedAt: at + 1,
  });
  expect(revalidate("barrier", capture, barrier, [])).toEqual({
    decision: "accept",
    reason: "no-delta",
    deltas: [],
  });

  const draft = checkpoint({
    stage: "flush-drafts",
    censusRevision: 8,
    draftGenerations: [{ windowId: "window-A", editGeneration: 7, status: "saved" }],
    capturedAt: at + 2,
  });
  expect(
    revalidate("draft", barrier, draft, [
      receipt("draft-saved", "draft:window-A:7", "pending", "saved", "flush-drafts"),
    ]),
  ).toMatchObject({ decision: "accept", reason: "expected-self-induced-delta" });

  const intent = checkpoint({
    stage: "persist-state-and-teardown-intent",
    censusRevision: 8,
    draftGenerations: [{ windowId: "window-A", editGeneration: 7, status: "saved" }],
    capturedAt: at + 3,
  });
  expect(revalidate("cancellation", intent, intent, [])).toMatchObject({
    decision: "reject",
    reason: "unexplained-delta",
  });
});

test("covered valid controls accept cancellation, terminal receipt, disposal, and final checks", () => {
  const intent = checkpoint({
    stage: "persist-state-and-teardown-intent",
    censusRevision: 7,
  });
  const cancelled = checkpoint({
    stage: "cancel-and-wait",
    censusRevision: 8,
    work: [
      { kind: "parent-run", identity: "parent-1", state: "settled" },
      { kind: "child-run", identity: "child-1", state: "settled" },
      { kind: "pending-tool", identity: "call-1", state: "settled" },
    ],
    capturedAt: at + 1,
  });
  expect(
    revalidate("cancellation", intent, cancelled, [
      receipt("work-terminal", "parent-1", "running", "settled", "cancel-and-wait"),
      receipt("work-terminal", "child-1", "running", "settled", "cancel-and-wait"),
      receipt("tool-settled", "call-1", "pending", "settled", "cancel-and-wait"),
    ]),
  ).toMatchObject({ decision: "accept" });

  const terminal = checkpoint({
    ...cancelled,
    stage: "persist-terminal-receipts",
    censusRevision: 9,
    capturedAt: at + 2,
  });
  const terminalReceipts = ["parent-1", "child-1", "call-1"].map((identity) =>
    receipt(
      "terminal-persisted",
      identity,
      "settled",
      "settled",
      "persist-terminal-receipts",
      "op-1",
      at + 1,
    ),
  );
  expect(revalidate("terminal-receipts", cancelled, terminal, terminalReceipts)).toEqual({
    decision: "accept",
    reason: "no-delta",
    deltas: [],
  });

  const disposal = checkpoint({
    ...terminal,
    stage: "dispose-and-release",
    censusRevision: 10,
    leases: [{ identity: "session-1", ownership: "absent" }],
    capturedAt: at + 3,
  });
  expect(
    revalidate("disposal", terminal, disposal, [
      ...terminalReceipts,
      receipt("disposal", "session-1", "local", "absent", "dispose-and-release"),
    ]),
  ).toMatchObject({ decision: "accept" });

  const final = checkpoint({
    ...disposal,
    stage: "final-revalidate-and-commit-marker",
    censusRevision: 11,
    capturedAt: at + 4,
  });
  expect(revalidate("final", disposal, final, terminalReceipts)).toEqual({
    decision: "accept",
    reason: "no-delta",
    deltas: [],
  });
});

test("verifier regression: impossible baseline stage rejects", () => {
  const baseline = checkpoint({ stage: "lifecycle-action" });
  const current = checkpoint({
    stage: "cancel-and-wait",
    censusRevision: 8,
    work: [
      { kind: "parent-run", identity: "parent-1", state: "running" },
      { kind: "child-run", identity: "child-1", state: "settled" },
      { kind: "pending-tool", identity: "call-1", state: "pending" },
    ],
  });
  expect(
    revalidate("cancellation", baseline, current, [
      receipt("work-terminal", "child-1", "running", "settled", "cancel-and-wait"),
    ]),
  ).toMatchObject({ decision: "reject" });
});

test("verifier regression: changed state under unchanged census revision rejects", () => {
  const baseline = checkpoint({ stage: "persist-state-and-teardown-intent" });
  const current = checkpoint({
    stage: "cancel-and-wait",
    censusRevision: baseline.censusRevision,
    work: [
      { kind: "parent-run", identity: "parent-1", state: "running" },
      { kind: "child-run", identity: "child-1", state: "settled" },
      { kind: "pending-tool", identity: "call-1", state: "pending" },
    ],
  });
  expect(
    revalidate("cancellation", baseline, current, [
      receipt("work-terminal", "child-1", "running", "settled", "cancel-and-wait"),
    ]),
  ).toMatchObject({ decision: "reject", reason: "unexplained-delta" });
});

test("verifier regression: terminal-receipt stage requires every settled receipt", () => {
  const baseline = checkpoint({
    stage: "cancel-and-wait",
    work: [
      { kind: "parent-run", identity: "parent-1", state: "settled" },
      { kind: "child-run", identity: "child-1", state: "settled" },
      { kind: "pending-tool", identity: "call-1", state: "settled" },
    ],
  });
  const current = checkpoint({
    ...baseline,
    stage: "persist-terminal-receipts",
    censusRevision: 8,
    capturedAt: at + 1,
  });
  expect(revalidate("terminal-receipts", baseline, current, [])).toMatchObject({
    decision: "reject",
  });
  expect(
    revalidate("terminal-receipts", baseline, current, [
      receipt(
        "terminal-persisted",
        "parent-1",
        "settled",
        "settled",
        "persist-terminal-receipts",
        "op-1",
        at + 1,
      ),
      receipt(
        "terminal-persisted",
        "child-1",
        "settled",
        "settled",
        "persist-terminal-receipts",
        "op-1",
        at + 1,
      ),
      receipt(
        "terminal-persisted",
        "call-1",
        "settled",
        "settled",
        "persist-terminal-receipts",
        "op-1",
        at + 1,
      ),
    ]),
  ).toMatchObject({ decision: "accept" });
});

test("verifier regression: terminal receipts validate state, chronology, and settlement", () => {
  const terminalBaseline = checkpoint({
    stage: "cancel-and-wait",
    work: [{ kind: "child-run", identity: "child-1", state: "settled" }],
    capturedAt: at,
  });
  const terminalCurrent = checkpoint({
    ...terminalBaseline,
    stage: "persist-terminal-receipts",
    censusRevision: 8,
    capturedAt: at + 2,
  });
  for (const invalidReceipt of [
    receipt(
      "terminal-persisted",
      "child-1",
      "nonsense",
      "nonsense",
      "persist-terminal-receipts",
      "op-1",
      at + 1,
    ),
    receipt(
      "terminal-persisted",
      "child-1",
      "settled",
      "settled",
      "persist-terminal-receipts",
      "op-1",
      at - 1,
    ),
    receipt(
      "terminal-persisted",
      "child-1",
      "settled",
      "settled",
      "persist-terminal-receipts",
      "op-1",
      at + 3,
    ),
  ]) {
    expect(
      revalidate("terminal-receipts", terminalBaseline, terminalCurrent, [invalidReceipt]),
    ).toMatchObject({ decision: "reject" });
  }

  const unsettledBaseline = checkpoint({
    stage: "cancel-and-wait",
    work: [{ kind: "child-run", identity: "child-1", state: "running" }],
  });
  const unsettledCurrent = checkpoint({
    ...unsettledBaseline,
    stage: "persist-terminal-receipts",
    censusRevision: 8,
    capturedAt: at + 1,
  });
  expect(revalidate("terminal-receipts", unsettledBaseline, unsettledCurrent, [])).toMatchObject({
    decision: "reject",
  });
});

test("verifier regression: cancellation completion rejects unexplained running work", () => {
  const baseline = checkpoint({
    stage: "persist-state-and-teardown-intent",
    work: [{ kind: "child-run", identity: "child-1", state: "running" }],
  });
  const current = checkpoint({
    ...baseline,
    stage: "cancel-and-wait",
    censusRevision: 8,
    capturedAt: at + 1,
  });
  expect(revalidate("cancellation", baseline, current, [])).toMatchObject({
    decision: "reject",
  });
  expect(
    revalidate("cancellation", baseline, current, [
      receipt(
        "cancellation",
        "child-1",
        "running",
        "unsettled",
        "cancel-and-wait",
        "op-1",
        at + 1,
        false,
      ),
    ]),
  ).toMatchObject({ decision: "accept" });
});

test("verifier regression: retained receipts must match the observed work state", () => {
  const baseline = checkpoint({
    stage: "persist-state-and-teardown-intent",
    work: [{ kind: "child-run", identity: "child-1", state: "running" }],
  });
  const current = checkpoint({
    ...baseline,
    stage: "cancel-and-wait",
    censusRevision: 8,
    capturedAt: at + 2,
  });
  expect(
    revalidate("cancellation", baseline, current, [
      receipt(
        "cancellation",
        "child-1",
        "queued",
        "retained",
        "cancel-and-wait",
        "op-1",
        at + 1,
        false,
      ),
    ]),
  ).toMatchObject({ decision: "reject" });
  expect(
    revalidate("cancellation", baseline, current, [
      receipt(
        "cancellation",
        "child-1",
        "running",
        "retained",
        "cancel-and-wait",
        "op-1",
        at + 1,
        false,
      ),
    ]),
  ).toMatchObject({ decision: "accept" });
});

test("verifier regression: terminal receipt fromState must match baseline work", () => {
  const baseline = checkpoint({
    stage: "cancel-and-wait",
    work: [{ kind: "child-run", identity: "child-1", state: "settled" }],
    leases: [],
    draftGenerations: [],
    capturedAt: at,
  });
  const current = checkpoint({
    ...baseline,
    stage: "persist-terminal-receipts",
    censusRevision: 8,
    capturedAt: at + 2,
  });
  expect(
    revalidate("terminal-receipts", baseline, current, [
      receipt(
        "terminal-persisted",
        "child-1",
        "queued",
        "completed",
        "persist-terminal-receipts",
        "op-1",
        at + 1,
      ),
    ]),
  ).toMatchObject({ decision: "reject" });
  for (const observedAt of [at, at + 2]) {
    expect(
      revalidate("terminal-receipts", baseline, current, [
        receipt(
          "terminal-persisted",
          "child-1",
          "settled",
          "completed",
          "persist-terminal-receipts",
          "op-1",
          observedAt,
        ),
      ]),
    ).toMatchObject({ decision: "accept" });
  }
});

test("verifier regression: final revalidation rejects future terminal receipts", () => {
  const baseline = checkpoint({
    stage: "dispose-and-release",
    censusRevision: 9,
    capturedAt: at + 1,
    work: [{ kind: "child-run", identity: "child-1", state: "settled" }],
    leases: [{ identity: "session-1", ownership: "absent" }],
    draftGenerations: [],
  });
  const current = checkpoint({
    ...baseline,
    stage: "final-revalidate-and-commit-marker",
    censusRevision: 10,
    capturedAt: at + 2,
  });
  expect(
    revalidate("final", baseline, current, [
      receipt(
        "terminal-persisted",
        "child-1",
        "settled",
        "completed",
        "persist-terminal-receipts",
        "op-1",
        at + 3,
      ),
    ]),
  ).toMatchObject({ decision: "reject" });
  expect(
    revalidate("final", baseline, current, [
      receipt(
        "terminal-persisted",
        "child-1",
        "settled",
        "completed",
        "persist-terminal-receipts",
        "op-1",
        at + 2,
      ),
    ]),
  ).toMatchObject({ decision: "accept" });
});

test("revalidation rejects wrong request scope, new work, ownership races, and foreign receipts", () => {
  const terminalBaseline = checkpoint({
    stage: "dispose-and-release",
    work: [
      { kind: "parent-run", identity: "parent-1", state: "settled" },
      { kind: "child-run", identity: "child-1", state: "settled" },
      { kind: "pending-tool", identity: "call-1", state: "settled" },
    ],
    leases: [{ identity: "session-1", ownership: "absent" }],
    draftGenerations: [{ windowId: "window-A", editGeneration: 7, status: "saved" }],
  });
  const terminalReceipts = ["parent-1", "child-1", "call-1"].map((identity) =>
    receipt(
      "terminal-persisted",
      identity,
      "settled",
      "settled",
      "persist-terminal-receipts",
      "op-1",
      at + 1,
    ),
  );
  const wrongScope = checkpoint({
    ...terminalBaseline,
    stage: "final-revalidate-and-commit-marker",
    requestKey: windowBRequest,
    censusRevision: 8,
    capturedAt: at + 1,
  });
  expect(revalidate("final", terminalBaseline, wrongScope, terminalReceipts)).toMatchObject({
    decision: "reject",
  });

  const newWork = checkpoint({
    ...terminalBaseline,
    stage: "final-revalidate-and-commit-marker",
    censusRevision: 8,
    work: [
      ...terminalBaseline.work,
      { kind: "child-run", identity: "new-child", state: "running" },
    ],
  });
  expect(revalidate("final", terminalBaseline, newWork, terminalReceipts)).toMatchObject({
    decision: "reject",
    reason: "new-work",
  });

  const ownershipRace = checkpoint({
    ...terminalBaseline,
    stage: "final-revalidate-and-commit-marker",
    censusRevision: 8,
    leases: [
      { identity: "session-1", ownership: "absent" },
      { identity: "foreign-session", ownership: "foreign-live" },
    ],
  });
  expect(revalidate("final", terminalBaseline, ownershipRace, terminalReceipts)).toMatchObject({
    decision: "reject",
    reason: "foreign-race",
  });

  const intent = checkpoint({ stage: "persist-state-and-teardown-intent" });
  const cancelled = checkpoint({
    stage: "cancel-and-wait",
    censusRevision: 8,
    work: [
      { kind: "parent-run", identity: "parent-1", state: "running" },
      { kind: "child-run", identity: "child-1", state: "settled" },
      { kind: "pending-tool", identity: "call-1", state: "pending" },
    ],
  });
  expect(
    revalidate("cancellation", intent, cancelled, [
      receipt("work-terminal", "child-1", "running", "settled", "cancel-and-wait", "op-2"),
    ]),
  ).toMatchObject({ decision: "reject", reason: "receipt-operation-mismatch" });
});

test("verifier regression: accepted v1.1 contract and domain exports are complete", async () => {
  const plan = JSON.parse(
    await readFile(
      path.join(workspaceRoot, "artifacts/distribution/R-D13-INTEGRATION-PLAN/plan.json"),
      "utf8",
    ),
  ) as {
    production_split: {
      contract: { required_exports: string[] };
      domain: { exports: Array<{ name: string }> };
    };
  };
  const contractExports = exportedNames(
    path.join(workspaceRoot, "apps/desktop/contracts/lifecycle.ts"),
  );
  const domainExports = exportedNames(
    path.join(workspaceRoot, "apps/desktop/electron/lifecycle/lifecycle-domain.ts"),
  );
  expect(
    plan.production_split.contract.required_exports.filter((name) => !contractExports.has(name)),
  ).toEqual([]);
  expect(
    plan.production_split.domain.exports
      .map((entry) => entry.name)
      .filter((name) => !domainExports.has(name)),
  ).toEqual([]);
  expect(plan.production_split.contract.required_exports).toHaveLength(20);
  expect(plan.production_split.domain.exports).toHaveLength(6);
});

test("verifier successor-03 regression: draft batches reject multiple generations for one window", () => {
  expect(() =>
    lifecycleDomain_classifyDraftFlush({
      expectedTargets: [
        draftTarget("window-A", 7, "op-1", quitRequest),
        draftTarget("window-A", 8, "op-1", quitRequest),
      ],
      outcomes: [
        draftOutcome("saved", "window-A", 7, "op-1", quitRequest),
        draftOutcome("no-pending", "window-A", 8, "op-1", quitRequest),
      ],
      statePersistenceSuccess: true,
    }),
  ).toThrow(/latest|generation|window|target/i);

  expect(
    lifecycleDomain_classifyDraftFlush({
      expectedTargets: [
        draftTarget("window-A", 7, "op-1", quitRequest),
        draftTarget("window-B", 3, "op-1", quitRequest),
      ],
      outcomes: [
        draftOutcome("saved", "window-A", 7, "op-1", quitRequest),
        draftOutcome("no-pending", "window-B", 3, "op-1", quitRequest),
      ],
      statePersistenceSuccess: true,
    }),
  ).toEqual({
    nextState: "persisting-state-and-intent",
    commitAllowed: false,
  });
});

test("verifier successor-03 regression: stopped work cannot claim successful retention", () => {
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 4),
    failedStage: null,
    partialEffects: partialEffects({
      statePersisted: true,
      teardownIntentPersisted: true,
    }),
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt("cancel-and-wait", "succeeded", {
        ...partialEffects({
          statePersisted: true,
          teardownIntentPersisted: true,
          cancellation: cancellation({
            stoppedIdentities: ["child-1"],
            terminalOutcomes: [{ identity: "child-1", outcome: "stopped" }],
          }),
        }),
      }),
      stageReceipts: [receipt("cancellation", "child-1", "running", "retained", "cancel-and-wait")],
    }),
  ).toThrow(/retained|success|unsettled|cancellation|receipt/i);
});

test("verifier successor-03 regression: cancellation receipt outcomes cannot contradict", () => {
  const baseline = checkpoint({
    stage: "persist-state-and-teardown-intent",
    work: [{ kind: "child-run", identity: "child-1", state: "running" }],
  });
  const current = checkpoint({
    ...baseline,
    stage: "cancel-and-wait",
    censusRevision: 8,
    capturedAt: at + 2,
  });
  expect(
    revalidate("cancellation", baseline, current, [
      receipt(
        "cancellation",
        "child-1",
        "running",
        "retained",
        "cancel-and-wait",
        "op-1",
        at + 1,
        false,
      ),
      receipt("work-terminal", "child-1", "running", "settled", "cancel-and-wait"),
    ]),
  ).toMatchObject({ decision: "reject" });

  expect(
    revalidate("cancellation", baseline, current, [
      receipt(
        "cancellation",
        "child-1",
        "running",
        "retained",
        "cancel-and-wait",
        "op-1",
        at + 1,
        false,
      ),
    ]),
  ).toMatchObject({
    decision: "accept",
    reason: "no-delta",
  });
});

test("verifier successor-03 regression: terminal persistence rejects conflicting outcomes", () => {
  const baseline = checkpoint({
    stage: "cancel-and-wait",
    work: [{ kind: "child-run", identity: "child-1", state: "settled" }],
    leases: [],
    draftGenerations: [],
  });
  const current = checkpoint({
    ...baseline,
    stage: "persist-terminal-receipts",
    censusRevision: 8,
    capturedAt: at + 2,
  });
  expect(
    revalidate("terminal-receipts", baseline, current, [
      receipt(
        "terminal-persisted",
        "child-1",
        "settled",
        "completed",
        "persist-terminal-receipts",
        "op-1",
        at + 1,
      ),
      receipt(
        "terminal-persisted",
        "child-1",
        "settled",
        "failed",
        "persist-terminal-receipts",
        "op-1",
        at + 2,
      ),
    ]),
  ).toMatchObject({ decision: "reject" });

  const twoIdentities = checkpoint({
    ...baseline,
    work: [
      { kind: "parent-run", identity: "parent-1", state: "settled" },
      { kind: "child-run", identity: "child-1", state: "settled" },
    ],
  });
  const terminal = checkpoint({
    ...twoIdentities,
    stage: "persist-terminal-receipts",
    censusRevision: 8,
    capturedAt: at + 2,
  });
  expect(
    revalidate("terminal-receipts", twoIdentities, terminal, [
      receipt(
        "terminal-persisted",
        "parent-1",
        "settled",
        "completed",
        "persist-terminal-receipts",
        "op-1",
        at + 1,
      ),
      receipt(
        "terminal-persisted",
        "child-1",
        "settled",
        "failed",
        "persist-terminal-receipts",
        "op-1",
        at + 2,
      ),
    ]),
  ).toMatchObject({ decision: "accept" });
});

test("verifier successor-03 regression: stopped work requires one authoritative outcome", () => {
  const missingOutcomeEffects = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
    cancellation: cancellation({
      stoppedIdentities: ["child-1"],
      terminalOutcomes: [],
    }),
  });
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 5),
    failedStage: null,
    partialEffects: missingOutcomeEffects,
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt("persist-terminal-receipts", "succeeded", {
        ...missingOutcomeEffects,
        terminalReceiptIdentitiesPersisted: ["child-1"],
      }),
      stageReceipts: [
        receipt(
          "terminal-persisted",
          "child-1",
          "running",
          "completed",
          "persist-terminal-receipts",
        ),
      ],
    }),
  ).toThrow(/terminal|outcome|stopped/i);

  const stoppedEffects = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
    cancellation: cancellation({
      stoppedIdentities: ["child-1"],
      terminalOutcomes: [{ identity: "child-1", outcome: "stopped" }],
    }),
  });
  const validState: LifecycleSequenceState = {
    ...state,
    partialEffects: stoppedEffects,
  };
  expect(
    domainTransition({
      state: validState,
      attempt: attempt("persist-terminal-receipts", "succeeded", {
        ...stoppedEffects,
        terminalReceiptIdentitiesPersisted: ["child-1"],
      }),
      stageReceipts: [
        receipt("terminal-persisted", "child-1", "settled", "stopped", "persist-terminal-receipts"),
      ],
    }),
  ).toMatchObject({
    failedStage: null,
    partialEffects: {
      terminalReceiptIdentitiesPersisted: ["child-1"],
    },
  });

  const completedEffects = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
    cancellation: cancellation({
      terminalOutcomes: [{ identity: "child-1", outcome: "completed" }],
    }),
  });
  const completedState: LifecycleSequenceState = {
    ...state,
    partialEffects: completedEffects,
  };
  expect(
    domainTransition({
      state: completedState,
      attempt: attempt("persist-terminal-receipts", "succeeded", {
        ...completedEffects,
        terminalReceiptIdentitiesPersisted: ["child-1"],
      }),
      stageReceipts: [
        receipt(
          "terminal-persisted",
          "child-1",
          "settled",
          "completed",
          "persist-terminal-receipts",
        ),
      ],
    }),
  ).toMatchObject({ failedStage: null });
});

test("verifier successor-04 regression: successful cancellation cannot leave unresolved work", () => {
  const prior = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
  });
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 4),
    failedStage: null,
    partialEffects: prior,
  };
  const cancellationEffects = {
    ...prior,
    cancellation: cancellation({
      failedToStopIdentities: ["child-1"],
      stillUnsettledIdentities: ["child-1"],
    }),
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt("cancel-and-wait", "succeeded", cancellationEffects),
    }),
  ).toThrow(/cancel-and-wait|failed|unsettled|succeeded/i);

  expect(
    domainTransition({
      state,
      attempt: attempt("cancel-and-wait", "failed", cancellationEffects),
    }),
  ).toMatchObject({
    failedStage: "cancel-and-wait",
    failure: {
      unresolvedIdentities: ["child-1"],
    },
  });
});

test("verifier successor-04 regression: cancellation outcomes map to authoritative terminals", () => {
  const prior = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
  });
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 4),
    failedStage: null,
    partialEffects: prior,
  };
  const stoppedEffects = {
    ...prior,
    cancellation: cancellation({
      stoppedIdentities: ["child-1"],
      terminalOutcomes: [{ identity: "child-1", outcome: "stopped" as const }],
    }),
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt("cancel-and-wait", "succeeded", stoppedEffects),
      stageReceipts: [
        receipt("cancellation", "child-1", "running", "completed", "cancel-and-wait"),
      ],
    }),
  ).toThrow(/terminal|outcome|receipt|stopped|completed/i);

  expect(
    domainTransition({
      state,
      attempt: attempt("cancel-and-wait", "succeeded", stoppedEffects),
      stageReceipts: [receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait")],
    }),
  ).toMatchObject({ failedStage: null });
});

test("verifier successor-04 regression: terminal persistence requires every receipt", () => {
  const prior = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
    cancellation: cancellation({
      stoppedIdentities: ["child-1", "child-2"],
      terminalOutcomes: [
        { identity: "child-1", outcome: "stopped" },
        { identity: "child-2", outcome: "stopped" },
      ],
    }),
  });
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 5),
    failedStage: null,
    partialEffects: prior,
  };
  const effects = {
    ...prior,
    terminalReceiptIdentitiesPersisted: ["child-1", "child-2"],
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt("persist-terminal-receipts", "succeeded", effects),
      stageReceipts: [
        receipt("terminal-persisted", "child-1", "settled", "stopped", "persist-terminal-receipts"),
      ],
    }),
  ).toThrow(/terminal|receipt|identity|missing|persist/i);

  expect(
    domainTransition({
      state,
      attempt: attempt("persist-terminal-receipts", "succeeded", effects),
      stageReceipts: [
        receipt("terminal-persisted", "child-1", "settled", "stopped", "persist-terminal-receipts"),
        receipt("terminal-persisted", "child-2", "settled", "stopped", "persist-terminal-receipts"),
      ],
    }),
  ).toMatchObject({ failedStage: null });
});

test("verifier successor-04 regression: terminal receipts require a settled source", () => {
  const prior = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
    cancellation: cancellation({
      stoppedIdentities: ["child-1"],
      terminalOutcomes: [{ identity: "child-1", outcome: "stopped" }],
    }),
  });
  const state: LifecycleSequenceState = {
    profile: "full",
    completedStages: lifecycle_fullStages.slice(0, 5),
    failedStage: null,
    partialEffects: prior,
  };
  const effects = {
    ...prior,
    terminalReceiptIdentitiesPersisted: ["child-1"],
  };
  expect(() =>
    domainTransition({
      state,
      attempt: attempt("persist-terminal-receipts", "succeeded", effects),
      stageReceipts: [
        receipt("terminal-persisted", "child-1", "running", "stopped", "persist-terminal-receipts"),
      ],
    }),
  ).toThrow(/settled|terminal|receipt|state/i);

  expect(
    domainTransition({
      state,
      attempt: attempt("persist-terminal-receipts", "succeeded", effects),
      stageReceipts: [
        receipt("terminal-persisted", "child-1", "settled", "stopped", "persist-terminal-receipts"),
      ],
    }),
  ).toMatchObject({ failedStage: null });
});

test("verifier successor-04 favorable control: terminal timestamps accept exact boundaries", () => {
  const baseline = checkpoint({
    stage: "cancel-and-wait",
    work: [{ kind: "child-run", identity: "child-1", state: "settled" }],
    leases: [],
    draftGenerations: [],
    capturedAt: at,
  });
  const current = checkpoint({
    ...baseline,
    stage: "persist-terminal-receipts",
    censusRevision: 8,
    capturedAt: at + 2,
  });
  for (const observedAt of [at, at + 2]) {
    expect(
      revalidate("terminal-receipts", baseline, current, [
        receipt(
          "terminal-persisted",
          "child-1",
          "settled",
          "completed",
          "persist-terminal-receipts",
          "op-1",
          observedAt,
        ),
      ]),
    ).toMatchObject({
      decision: "accept",
      reason: "no-delta",
    });
  }
});

test("verifier successor-05 F1: successful cancellation rejects zero terminal receipts", () => {
  expect(() => stoppedPairCancellationTransition([])).toThrow(
    /cancellation|receipt|identity|missing|terminal/i,
  );
});

test("verifier successor-05 F1: successful cancellation rejects one of two terminal receipts", () => {
  expect(() =>
    stoppedPairCancellationTransition([
      receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait"),
    ]),
  ).toThrow(/cancellation|receipt|identity|missing|terminal/i);
});

test("verifier successor-05 F1: successful cancellation accepts two of two terminal receipts", () => {
  expect(
    stoppedPairCancellationTransition([
      receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait"),
      receipt("cancellation", "child-2", "running", "stopped", "cancel-and-wait"),
    ]),
  ).toMatchObject({ failedStage: null });
});

test("verifier successor-05 F1: successful cancellation rejects duplicate terminal receipts", () => {
  expect(() =>
    stoppedPairCancellationTransition([
      receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait", "op-1", at + 1),
      receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait", "op-1", at + 2),
      receipt("cancellation", "child-2", "running", "stopped", "cancel-and-wait"),
    ]),
  ).toThrow(/cancellation|receipt|identity|duplicate|terminal/i);
});

test("verifier successor-05 F1: successful cancellation rejects an extra unrelated receipt", () => {
  expect(() =>
    stoppedPairCancellationTransition(
      [
        receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait"),
        receipt("cancellation", "child-2", "running", "stopped", "cancel-and-wait"),
        receipt("cancellation", "child-3", "running", "stopped", "cancel-and-wait"),
      ],
      { neverStartedIdentities: ["child-3"] },
    ),
  ).toThrow(/cancellation|receipt|identity|terminal/i);
});

test("verifier successor-05 F1: successful cancellation rejects a different identity receipt", () => {
  expect(() =>
    stoppedPairCancellationTransition(
      [
        receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait"),
        receipt("cancellation", "child-3", "running", "stopped", "cancel-and-wait"),
      ],
      { neverStartedIdentities: ["child-3"] },
    ),
  ).toThrow(/cancellation|receipt|identity|missing|terminal/i);
});

test("verifier successor-06 V6-01: work-terminal cannot cover never-started identities", () => {
  expect(() =>
    stoppedPairCancellationTransition(
      [
        receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait"),
        receipt("cancellation", "child-2", "running", "stopped", "cancel-and-wait"),
        receipt("work-terminal", "child-3", "queued", "settled", "cancel-and-wait"),
      ],
      { neverStartedIdentities: ["child-3"] },
    ),
  ).toThrow(/cancellation|receipt|identity|terminal|never/i);
});

test("verifier successor-06 V6-01: work-terminal cannot duplicate stopped coverage", () => {
  expect(() =>
    stoppedPairCancellationTransition([
      receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait"),
      receipt("cancellation", "child-2", "running", "stopped", "cancel-and-wait"),
      receipt("work-terminal", "child-1", "running", "settled", "cancel-and-wait"),
    ]),
  ).toThrow(/cancellation|receipt|identity|duplicate|terminal/i);
});

test("verifier successor-06 V6-01: never-started identities require cancellation settlement", () => {
  expect(
    stoppedPairCancellationTransition(
      [
        receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait"),
        receipt("cancellation", "child-2", "running", "stopped", "cancel-and-wait"),
        receipt("cancellation", "child-3", "queued", "cancelled", "cancel-and-wait"),
      ],
      { neverStartedIdentities: ["child-3"] },
    ),
  ).toMatchObject({ failedStage: null });
});

test("verifier successor-06 V6-01: duplicate receipt kinds for one identity reject", () => {
  expect(() =>
    stoppedPairCancellationTransition([
      receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait"),
      receipt("settlement", "child-1", "running", "stopped", "cancel-and-wait"),
      receipt("cancellation", "child-2", "running", "stopped", "cancel-and-wait"),
    ]),
  ).toThrow(/cancellation|receipt|identity|duplicate|terminal/i);
});

test("verifier successor-06 V6-01: work-terminal remains valid in receipt-aware settlement", () => {
  const baseline = checkpoint({
    stage: "persist-state-and-teardown-intent",
    work: [{ kind: "child-run", identity: "child-1", state: "running" }],
    capturedAt: at,
  });
  const current = checkpoint({
    ...baseline,
    stage: "cancel-and-wait",
    censusRevision: 8,
    work: [{ kind: "child-run", identity: "child-1", state: "settled" }],
    capturedAt: at + 2,
  });
  expect(
    revalidate("cancellation", baseline, current, [
      receipt("work-terminal", "child-1", "running", "settled", "cancel-and-wait", "op-1", at + 2),
    ]),
  ).toMatchObject({
    decision: "accept",
    reason: "expected-self-induced-delta",
  });
});

test("verifier successor-06 V6-01: work-terminal remains valid on failed cancellation", () => {
  const prior = partialEffects({
    statePersisted: true,
    teardownIntentPersisted: true,
  });
  expect(
    domainTransition({
      state: {
        profile: "full",
        completedStages: lifecycle_fullStages.slice(0, 4),
        failedStage: null,
        partialEffects: prior,
      },
      attempt: attempt("cancel-and-wait", "failed", {
        ...prior,
        cancellation: cancellation({
          stoppedIdentities: ["child-1"],
          failedToStopIdentities: ["child-2"],
          stillUnsettledIdentities: ["child-2"],
          terminalOutcomes: [{ identity: "child-1", outcome: "stopped" }],
        }),
      }),
      stageReceipts: [receipt("work-terminal", "child-1", "running", "settled", "cancel-and-wait")],
    }),
  ).toMatchObject({
    failedStage: "cancel-and-wait",
    failure: { unresolvedIdentities: ["child-2"] },
  });
});

test("verifier successor-06 V6-01: cancellation coverage remains deterministic", () => {
  const receipts = [
    receipt("cancellation", "child-1", "running", "stopped", "cancel-and-wait", "op-1", at),
    receipt("cancellation", "child-2", "running", "stopped", "cancel-and-wait", "op-1", at + 2),
  ] as const;
  const before = structuredClone(receipts);
  expect(stoppedPairCancellationTransition(receipts)).toEqual(
    stoppedPairCancellationTransition(receipts),
  );
  expect(receipts).toEqual(before);
});

test("abrupt crash respects terminal and provider-error precedence before liveness", () => {
  const base = {
    authoritativeTerminal: null,
    persistedIdentity: { kind: "run", identity: "run-1", generation: 3 },
    pendingToolCallId: "send-message-side-effect",
    survival: "proven-dead",
    missingResultOnly: false,
    staleInterruption: false,
  } as const;
  expect(lifecycleDomain_recoverAbruptCrash(base)).toEqual({
    decision: "interrupted",
    outcomeKnown: false,
    work: {
      ...base.persistedIdentity,
      reason: "abrupt-crash",
      outcomeKnown: false,
      replayPolicy: "explicit-only",
    },
    pendingToolCallId: "send-message-side-effect",
    autoReplay: false,
  });
  expect(lifecycleDomain_projectInterruption(base)).toEqual(
    lifecycleDomain_recoverAbruptCrash(base),
  );
  expect(
    lifecycleDomain_recoverAbruptCrash({
      ...base,
      authoritativeTerminal: { outcome: "failed", providerError: true },
    }),
  ).toMatchObject({ decision: "preserve-failed", outcomeKnown: true, autoReplay: false });
  expect(
    lifecycleDomain_recoverAbruptCrash({
      ...base,
      authoritativeTerminal: { outcome: "completed", providerError: false },
      staleInterruption: true,
    }),
  ).toMatchObject({
    decision: "preserve-terminal",
    outcomeKnown: true,
    reason: "terminal-precedence",
  });
  expect(lifecycleDomain_recoverAbruptCrash({ ...base, survival: "proven-live" })).toMatchObject({
    decision: "attach-live",
    outcomeKnown: false,
    identity: base.persistedIdentity,
    autoReplay: false,
  });
  expect(lifecycleDomain_recoverAbruptCrash({ ...base, survival: "unknown" })).toMatchObject({
    decision: "pending-unknown",
    outcomeKnown: false,
    reason: "liveness-unknown",
  });
  expect(lifecycleDomain_recoverAbruptCrash({ ...base, missingResultOnly: true })).toMatchObject({
    decision: "pending-unknown",
    reason: "missing-result-insufficient",
  });
});

test("domain outputs are deterministic and do not mutate inputs", () => {
  const classification = facts({ childRuns: 1 });
  const classificationBefore = structuredClone(classification);
  expect(lifecycleDomain_classify(classification)).toEqual(
    lifecycleDomain_classify(classification),
  );
  expect(classification).toEqual(classificationBefore);

  const baseline = checkpoint();
  const current = checkpoint({
    stage: "barrier-and-revalidate",
    capturedAt: at + 1,
  });
  const baselineBefore = structuredClone(baseline);
  const currentBefore = structuredClone(current);
  expect(revalidate("barrier", baseline, current, [])).toEqual(
    revalidate("barrier", baseline, current, []),
  );
  expect(baseline).toEqual(baselineBefore);
  expect(current).toEqual(currentBefore);
});

test("domain rejects malformed requests and oversized receipt collections", () => {
  expect(() =>
    lifecycleDomain_arbitrateRequest(
      {
        operationId: "op-1",
        request: windowARequest,
        stage: "capture-and-decide",
      },
      { intent: "app-quit", target: { kind: "application" }, effectScope: { revision: 1 } },
    ),
  ).toThrow();
  const baseline = checkpoint();
  const current = checkpoint({
    stage: "barrier-and-revalidate",
    capturedAt: at + 1,
  });
  expect(revalidate("barrier", baseline, current, Array(257).fill(null))).toMatchObject({
    decision: "reject",
  });
});
