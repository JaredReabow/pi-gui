import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  lifecycle_callerTerminalOutcomes,
  lifecycle_decodeCancellationOutcome,
  lifecycle_decodeStageCheckpoint,
  lifecycle_decodeDraftStatus,
  lifecycle_decodeDraftFlushBatch,
  lifecycle_decodeExecutionStatus,
  lifecycle_decodeIntent,
  lifecycle_decodeInterruptionInput,
  lifecycle_decodeOutcome,
  lifecycle_decodePartialEffects,
  lifecycle_decodeRequestKey,
  lifecycle_decodeStageReceipt,
  lifecycle_decodeStage,
  lifecycle_decodeWorkFacts,
  lifecycle_draftStatuses,
  lifecycle_executionStatuses,
  lifecycle_intents,
  lifecycle_maxCollectionLength,
  lifecycle_maxIdentifierLength,
  lifecycle_maxObservedCount,
  lifecycle_stages,
  type LifecycleCancellationOutcome,
  type StageCheckpoint,
  type StageReceipt,
  type LifecyclePartialEffects,
} from "../../contracts/lifecycle";

const at = 1_764_000_000_000;

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

const requestKey = {
  intent: "window-close",
  target: { kind: "window", windowId: "window-A" },
  effectScope: { kind: "window", windowId: "window-A", revision: 1 },
} as const;
const quitRequestKey = {
  intent: "app-quit",
  target: { kind: "application" },
  effectScope: { kind: "application", revision: 2 },
} as const;

function checkpoint(overrides: Partial<StageCheckpoint> = {}): StageCheckpoint {
  return {
    operationId: "op-1",
    requestKey,
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

test("lifecycle contract is browser-safe and has no payload-bearing shape", async () => {
  const source = await readFile(join(__dirname, "../../contracts/lifecycle.ts"), "utf8");
  expect(source).not.toMatch(/from\s+["'](?:node:|electron)/);
  expect(source).not.toMatch(
    /["'](?:toolInput|toolResult|promptText|draftText|credential|secret|filePath)["']/,
  );
  const clone = structuredClone(checkpoint());
  expect(lifecycle_decodeStageCheckpoint(clone)).toEqual(clone);
  expect(clone).toEqual(checkpoint());
});

test("execution, intent, stage, and caller outcome decoders are exact", () => {
  expect(lifecycle_executionStatuses).toEqual(["active", "idle", "unknown"]);
  for (const value of lifecycle_executionStatuses) {
    expect(lifecycle_decodeExecutionStatus(value)).toBe(value);
  }
  for (const value of lifecycle_intents) expect(lifecycle_decodeIntent(value)).toBe(value);
  for (const value of lifecycle_stages) expect(lifecycle_decodeStage(value)).toBe(value);
  for (const value of lifecycle_callerTerminalOutcomes) {
    expect(lifecycle_decodeOutcome(value)).toBe(value);
  }
  for (const value of lifecycle_draftStatuses) {
    expect(lifecycle_decodeDraftStatus(value)).toBe(value);
  }
  for (const value of ["busy", "window_closed", "complete", "unknown-stage"]) {
    expect(() => lifecycle_decodeExecutionStatus(value)).toThrow();
    expect(() => lifecycle_decodeIntent(value)).toThrow();
    expect(() => lifecycle_decodeStage(value)).toThrow();
    expect(() => lifecycle_decodeOutcome(value)).toThrow();
    expect(() => lifecycle_decodeDraftStatus(value)).toThrow();
  }
});

test("request decoder binds intent, exact target, and revisioned effect scope", () => {
  const windowRequest = {
    intent: "window-close",
    target: { kind: "window", windowId: "window-A" },
    effectScope: { kind: "window", windowId: "window-A", revision: 4 },
  };
  const quitRequest = {
    intent: "app-quit",
    target: { kind: "application" },
    effectScope: { kind: "application", revision: 9 },
  };
  expect(lifecycle_decodeRequestKey(structuredClone(windowRequest))).toEqual(windowRequest);
  expect(lifecycle_decodeRequestKey(structuredClone(quitRequest))).toEqual(quitRequest);

  for (const invalid of [
    null,
    {},
    { ...windowRequest, target: { kind: "window", windowId: "window-B" } },
    {
      ...windowRequest,
      effectScope: { kind: "window", windowId: "window-A", revision: -1 },
    },
    { ...windowRequest, target: { kind: "application" } },
    { ...quitRequest, effectScope: { kind: "application", revision: 9, prompt: "body" } },
    { ...quitRequest, toolInput: "must not decode" },
  ]) {
    expect(() => lifecycle_decodeRequestKey(invalid)).toThrow();
  }
});

test("draft batch decoder binds one operation and one coherent request scope", () => {
  const valid = {
    expectedTargets: [
      { operationId: "op-1", requestKey: quitRequestKey, windowId: "window-A", editGeneration: 7 },
      { operationId: "op-1", requestKey: quitRequestKey, windowId: "window-B", editGeneration: 3 },
    ],
    outcomes: [
      {
        operationId: "op-1",
        requestKey: quitRequestKey,
        windowId: "window-A",
        editGeneration: 7,
        status: "saved",
      },
      {
        operationId: "op-1",
        requestKey: quitRequestKey,
        windowId: "window-B",
        editGeneration: 3,
        status: "no-pending",
      },
    ],
    statePersistenceSuccess: true,
  };
  expect(lifecycle_decodeDraftFlushBatch(structuredClone(valid))).toEqual(valid);
  expect(() =>
    lifecycle_decodeDraftFlushBatch({
      ...valid,
      outcomes: valid.outcomes.map((outcome, index) =>
        index === 1 ? { ...outcome, operationId: "op-2" } : outcome,
      ),
    }),
  ).toThrow(/operation|scope|batch/i);
});

test("verifier regression: draft batches bind one latest generation per window", () => {
  const valid = {
    expectedTargets: [
      { operationId: "op-1", requestKey: quitRequestKey, windowId: "window-A", editGeneration: 7 },
      { operationId: "op-1", requestKey: quitRequestKey, windowId: "window-B", editGeneration: 3 },
    ],
    outcomes: [
      {
        operationId: "op-1",
        requestKey: quitRequestKey,
        windowId: "window-A",
        editGeneration: 7,
        status: "saved",
      },
      {
        operationId: "op-1",
        requestKey: quitRequestKey,
        windowId: "window-B",
        editGeneration: 3,
        status: "no-pending",
      },
    ],
    statePersistenceSuccess: true,
  } as const;
  expect(lifecycle_decodeDraftFlushBatch(structuredClone(valid))).toEqual(valid);
  expect(() =>
    lifecycle_decodeDraftFlushBatch({
      ...valid,
      expectedTargets: [
        valid.expectedTargets[0],
        {
          ...valid.expectedTargets[0],
          editGeneration: 8,
        },
      ],
      outcomes: [
        valid.outcomes[0],
        {
          ...valid.outcomes[0],
          editGeneration: 8,
          status: "no-pending",
        },
      ],
    }),
  ).toThrow(/latest|generation|window/i);
});

test("work facts are bounded and incomplete facts cannot decode as idle", () => {
  const idle = {
    leaseOwnership: "local",
    parentRuns: 0,
    childRuns: 0,
    queuedRuns: 0,
    pendingTools: 0,
    activeInlineWorkers: 0,
    workerSurvival: "not-applicable",
    missingFacts: 0,
  };
  expect(lifecycle_decodeWorkFacts(idle)).toEqual(idle);
  for (const invalid of [
    { ...idle, missingFacts: undefined },
    { ...idle, missingFacts: -1 },
    { ...idle, parentRuns: lifecycle_maxObservedCount + 1 },
    { ...idle, leaseOwnership: "remote" },
    { ...idle, workerSurvival: "alive" },
    { ...idle, transcript: "private" },
  ]) {
    expect(() => lifecycle_decodeWorkFacts(invalid)).toThrow();
  }
});

test("stage receipt decoder binds exact identities and request scope to its operation", () => {
  const terminal: StageReceipt = {
    operationId: "op-1",
    requestKey,
    stage: "cancel-and-wait",
    identities: ["child-1"],
    kind: "work-terminal",
    fromState: "running",
    toState: "settled",
    cause: "operation",
    success: true,
    observedAt: at,
  };
  const tool: StageReceipt = {
    ...terminal,
    identities: ["call-1"],
    kind: "tool-settled",
    fromState: "pending",
  };
  const lease: StageReceipt = {
    ...terminal,
    stage: "dispose-and-release",
    identities: ["session-1"],
    kind: "lease-release",
    fromState: "local",
    toState: "absent",
  };
  const draft: StageReceipt = {
    ...terminal,
    stage: "flush-drafts",
    identities: ["draft:window-A:7"],
    kind: "draft-saved",
    fromState: "pending",
    toState: "saved",
  };
  for (const receipt of [terminal, tool, lease, draft]) {
    expect(lifecycle_decodeStageReceipt(structuredClone(receipt))).toEqual(receipt);
  }
  for (const invalid of [
    { ...terminal, fromState: "settled" },
    { ...tool, toState: "running" },
    { ...lease, fromState: "foreign-live" },
    { ...draft, toState: "pending" },
    { ...terminal, cause: "timer" },
    { ...terminal, success: "yes" },
    { ...terminal, toolInput: "private" },
  ]) {
    expect(() => lifecycle_decodeStageReceipt(invalid)).toThrow();
  }
});

test("partial effects preserve cancellation identities and reject oversize collections", () => {
  const effects = partialEffects({
    draftIdentitiesSaved: ["draft:window-A:7"],
    statePersisted: true,
    teardownIntentPersisted: true,
    terminalReceiptIdentitiesPersisted: ["child-1"],
    disposedIdentities: [],
    releasedLeaseIdentities: [],
    retainedLeaseIdentities: ["session-1"],
    cancellation: cancellation({
      stoppedIdentities: ["child-1"],
      failedToStopIdentities: ["child-2"],
      stillUnsettledIdentities: ["child-2"],
      terminalOutcomes: [{ identity: "child-1", outcome: "stopped" }],
    }),
  });
  expect(lifecycle_decodePartialEffects(structuredClone(effects))).toEqual(effects);
  expect(
    lifecycle_decodeCancellationOutcome(cancellation({ neverStartedIdentities: ["parent-2"] })),
  ).toEqual(cancellation({ neverStartedIdentities: ["parent-2"] }));

  for (const invalid of [
    { ...effects, cancellation: { ...effects.cancellation, leaseCustody: "leased" } },
    { ...effects, stoppedIdentities: ["wrong-level"] },
    {
      ...effects,
      disposedIdentities: Array(lifecycle_maxCollectionLength + 1).fill("runtime"),
    },
    {
      ...effects,
      releasedLeaseIdentities: ["session-1", "session-1"],
    },
    {
      ...effects,
      releasedLeaseIdentities: ["session-1"],
      retainedLeaseIdentities: ["session-1"],
    },
    {
      ...effects,
      cancellation: cancellation({
        stoppedIdentities: ["child-1"],
        failedToStopIdentities: ["child-1"],
      }),
    },
    {
      ...effects,
      cancellation: cancellation({
        stoppedIdentities: ["child-1"],
        terminalOutcomes: [],
      }),
    },
  ]) {
    expect(() => lifecycle_decodePartialEffects(invalid)).toThrow();
  }
});

test("checkpoint decoder rejects malformed identities, conflicting kinds, and oversized inputs", () => {
  const valid = checkpoint();
  expect(lifecycle_decodeStageCheckpoint(valid)).toEqual(valid);
  for (const invalid of [
    { ...valid, operationId: "" },
    { ...valid, operationId: "x".repeat(lifecycle_maxIdentifierLength + 1) },
    { ...valid, work: [{ kind: "pending-tool", identity: "call", state: "running" }] },
    { ...valid, work: [{ kind: "parent-run", identity: "run", state: "pending" }] },
    {
      ...valid,
      work: [
        { kind: "parent-run", identity: "run", state: "running" },
        { kind: "parent-run", identity: "run", state: "running" },
      ],
    },
    {
      ...valid,
      work: Array(lifecycle_maxCollectionLength + 1).fill({
        kind: "parent-run",
        identity: "run",
        state: "running",
      }),
    },
    {
      ...valid,
      work: [{ kind: "parent-run", identity: "session-1", state: "running" }],
    },
    { ...valid, draftGenerations: [{ windowId: "window-A", editGeneration: -1, status: "saved" }] },
    { ...valid, prompt: "body" },
  ]) {
    expect(() => lifecycle_decodeStageCheckpoint(invalid)).toThrow();
  }
});

test("verifier regression: strict decoders reject sparse arrays", () => {
  const sparseWork = Array(1) as unknown[];
  expect(() => lifecycle_decodeStageCheckpoint({ ...checkpoint(), work: sparseWork })).toThrow(
    /dense|sparse|JSON/i,
  );
});

test("verifier regression: strict decoders reject array index accessors", () => {
  const work = Array(1) as unknown[];
  Object.defineProperty(work, 0, {
    enumerable: true,
    configurable: true,
    get: () => ({
      kind: "parent-run",
      identity: "parent-1",
      state: "running",
    }),
  });
  expect(() =>
    lifecycle_decodeStageCheckpoint(
      checkpoint({ work: work as unknown as StageCheckpoint["work"] }),
    ),
  ).toThrow(/data property|accessor|JSON/i);
});

test("verifier regression: strict decoders reject symbol-keyed non-JSON data", () => {
  const symbolRequest = {
    intent: "app-quit",
    target: { kind: "application" },
    effectScope: { kind: "application", revision: 1 },
    [Symbol("hidden")]: 1n,
  };
  expect(() => lifecycle_decodeRequestKey(symbolRequest)).toThrow(/symbol|JSON/i);

  const nestedSymbol = {
    ...checkpoint(),
    work: [
      {
        kind: "parent-run",
        identity: "run-1",
        state: "running",
        [Symbol("hidden")]: 1n,
      },
    ],
  };
  expect(() => lifecycle_decodeStageCheckpoint(nestedSymbol)).toThrow(/symbol|JSON/i);
});

test("verifier regression: terminal receipts require the terminal persistence stage and states", () => {
  const terminal: StageReceipt = {
    operationId: "op-1",
    requestKey,
    stage: "persist-terminal-receipts",
    kind: "terminal-persisted",
    identities: ["child-1"],
    fromState: "settled",
    toState: "completed",
    cause: "operation",
    success: true,
    observedAt: at + 1,
  };
  expect(lifecycle_decodeStageReceipt(structuredClone(terminal))).toEqual(terminal);
  for (const invalid of [
    { ...terminal, stage: "lifecycle-action" },
    { ...terminal, fromState: "nonsense" },
    { ...terminal, fromState: "running" },
    { ...terminal, fromState: "pending" },
    { ...terminal, fromState: "queued" },
    { ...terminal, toState: "nonsense" },
    { ...terminal, identities: [] },
    { ...terminal, identities: ["child-1", "child-2"] },
  ]) {
    expect(() => lifecycle_decodeStageReceipt(invalid)).toThrow(/stage|state|identity|terminal/i);
  }
});

test("verifier regression: retained cancellation receipts are explicit non-success data", () => {
  const retained: StageReceipt = {
    operationId: "op-1",
    requestKey,
    stage: "cancel-and-wait",
    kind: "cancellation",
    identities: ["child-1"],
    fromState: "running",
    toState: "retained",
    cause: "operation",
    success: false,
    observedAt: at + 1,
  };
  expect(lifecycle_decodeStageReceipt(structuredClone(retained))).toEqual(retained);
  for (const invalid of [
    { ...retained, success: true },
    { ...retained, fromState: "settled" },
    { ...retained, toState: "unsettled", success: true },
  ]) {
    expect(() => lifecycle_decodeStageReceipt(invalid)).toThrow(
      /retained|unsettled|success|state/i,
    );
  }
});

test("interruption input has no journal or payload fields and is strictly bounded", () => {
  const input = {
    authoritativeTerminal: null,
    persistedIdentity: { kind: "run", identity: "run-1", generation: 3 },
    pendingToolCallId: "call-1",
    survival: "proven-dead",
    missingResultOnly: false,
    staleInterruption: false,
  };
  expect(lifecycle_decodeInterruptionInput(structuredClone(input))).toEqual(input);
  for (const invalid of [
    { ...input, journal: [] },
    { ...input, toolInput: "private" },
    { ...input, persistedIdentity: { ...input.persistedIdentity, generation: -1 } },
    {
      ...input,
      authoritativeTerminal: { outcome: "completed", providerError: true },
    },
    { ...input, pendingToolCallId: "x".repeat(lifecycle_maxIdentifierLength + 1) },
    { ...input, survival: "running" },
  ]) {
    expect(() => lifecycle_decodeInterruptionInput(invalid)).toThrow();
  }
});
