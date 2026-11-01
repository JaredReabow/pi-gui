import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  setupCentre_decodeCheckpoint,
  type SetupCheckpoint,
  type SetupCheckpointAnchor,
  type SetupLogicalOperation,
  type SetupOperationRequest,
  type SetupStepId,
} from "../../contracts/setup-centre";
import { writeFileAtomicQueued } from "../../electron/persistence/atomic-file-write";
import {
  SetupCheckpointStore,
  SetupCheckpointStoreError,
  setupCheckpointStore_decodeEnvelope,
  setupCheckpointStore_envelopeSchemaVersion,
  setupCheckpointStore_maxFileBytes,
  type SetupCheckpointStoreAuthority,
  type SetupCheckpointStoreAuthorityCommitRequest,
  type SetupCheckpointStoreAuthorityCommitResult,
  type SetupCheckpointStoreAuthorityReadResult,
  type SetupCheckpointStoreOptions,
  type SetupCheckpointStorePersistResult,
  type SetupCheckpointStoreSequenceState,
  type SetupCheckpointStoreWriter,
} from "../../electron/setup/setup-checkpoint-store";
import {
  setupDomain_acceptResult,
  setupDomain_applyCancellationReceipt,
  setupDomain_beginOperation,
  setupDomain_createState,
  setupDomain_exportCheckpoint,
  setupDomain_initialCheckpoint,
  setupDomain_initialState,
  setupDomain_requestCancellation,
  type SetupDomainState,
} from "../../electron/setup/setup-domain";

type AuthoritySnapshot = {
  revision: string;
  anchor: SetupCheckpointAnchor;
  sequenceState: SetupCheckpointStoreSequenceState;
};

class MemoryAuthority implements SetupCheckpointStoreAuthority {
  private receiptNumber = 0;
  private snapshot: AuthoritySnapshot | undefined;
  readOverride: (() => Promise<SetupCheckpointStoreAuthorityReadResult>) | undefined;
  commitOverride:
    | ((
        request: SetupCheckpointStoreAuthorityCommitRequest,
      ) => Promise<SetupCheckpointStoreAuthorityCommitResult>)
    | undefined;
  readCount = 0;
  commitRequests: SetupCheckpointStoreAuthorityCommitRequest[] = [];

  setSnapshot(
    snapshot: Omit<AuthoritySnapshot, "sequenceState"> &
      Partial<Pick<AuthoritySnapshot, "sequenceState">>,
  ): void {
    this.snapshot = structuredClone({
      ...snapshot,
      sequenceState: snapshot.sequenceState ?? {
        operationSequence: snapshot.anchor.checkpoint.operationSequence,
        state: "idle",
      },
    });
  }

  presentSnapshot(): AuthoritySnapshot | undefined {
    return structuredClone(this.snapshot);
  }

  async read(): Promise<SetupCheckpointStoreAuthorityReadResult> {
    this.readCount += 1;
    if (this.readOverride) return this.readOverride();
    return this.snapshot
      ? {
          state: "present",
          revision: this.snapshot.revision,
          anchor: structuredClone(this.snapshot.anchor),
          sequenceState: structuredClone(this.snapshot.sequenceState),
        }
      : { state: "empty" };
  }

  async commit(
    request: SetupCheckpointStoreAuthorityCommitRequest,
  ): Promise<SetupCheckpointStoreAuthorityCommitResult> {
    this.commitRequests.push(structuredClone(request));
    if (this.commitOverride) return this.commitOverride(request);
    if (
      (request.expectedRevision === null && this.snapshot) ||
      (request.expectedRevision !== null && request.expectedRevision !== this.snapshot?.revision)
    ) {
      return { state: "rejected", reason: "conditional-mismatch" };
    }
    this.receiptNumber += 1;
    this.snapshot = {
      revision: `authority-${this.receiptNumber}`,
      anchor: structuredClone(request.anchor),
      sequenceState: structuredClone(request.sequenceState),
    };
    return {
      state: "committed",
      revision: this.snapshot.revision,
      anchor: structuredClone(this.snapshot.anchor),
      sequenceState: structuredClone(this.snapshot.sequenceState),
    };
  }
}

const roots: string[] = [];

async function tempRoot(prefix = "setup-checkpoint-store-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function readPrimary(root: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, "setup-checkpoint.json"), "utf8")) as unknown;
}

function createStore(
  root: string,
  authority: SetupCheckpointStoreAuthority,
  write: SetupCheckpointStoreWriter = writeFileAtomicQueued,
): SetupCheckpointStore {
  return new SetupCheckpointStore(root, authority, { write });
}

async function saveWithCurrentRevision(
  store: SetupCheckpointStore,
  authority: MemoryAuthority,
  value: unknown,
): Promise<SetupCheckpointStorePersistResult> {
  const revision = authority.presentSnapshot()?.revision;
  if (!revision) throw new Error("test authority has no checkpoint");
  return store.save(value, { expectedAuthorityRevision: revision });
}

async function expectConflictWithoutMutation(
  root: string,
  store: SetupCheckpointStore,
  authority: MemoryAuthority,
  candidate: unknown,
): Promise<void> {
  const beforeAuthority = authority.presentSnapshot();
  const beforeBytes = await readFile(join(root, "setup-checkpoint.json"), "utf8");
  await expect(saveWithCurrentRevision(store, authority, candidate)).rejects.toMatchObject({
    code: "conflicting-checkpoint",
  });
  expect(authority.presentSnapshot()).toEqual(beforeAuthority);
  expect(await readFile(join(root, "setup-checkpoint.json"), "utf8")).toBe(beforeBytes);
}

const domainAt = 1_764_000_000_100;

function operationRequest(
  state: SetupDomainState,
  operationId: string,
  step: SetupStepId = "detection",
): SetupOperationRequest {
  return {
    operationId,
    routeId: state.checkpoint.routeId,
    step,
    resourceKey: {
      componentId: state.checkpoint.componentId,
      resource: step,
      scopeId: "setup-primary",
    },
    mode: "inspect",
    generation: state.checkpoint.generation,
    configRevision: state.checkpoint.configRevision,
    startedBy: "user",
  };
}

function verifiedResult(operation: SetupLogicalOperation, observedAt = domainAt + 1) {
  return {
    operationId: operation.request.operationId,
    routeId: operation.request.routeId,
    step: operation.request.step,
    resourceKey: operation.request.resourceKey,
    generation: operation.request.generation,
    configRevision: operation.request.configRevision,
    fact: {
      dimension: operation.request.step,
      state: "verified" as const,
      observedAt,
      reasonCode: null,
    },
  };
}

function admissionCheckpoint(operationId: string): SetupCheckpoint {
  const initial = setupDomain_initialState("codex-router");
  return setupDomain_beginOperation(initial, operationRequest(initial, operationId), domainAt).state
    .checkpoint;
}

function completionCheckpoint(operationId: string): SetupCheckpoint {
  const initial = setupDomain_initialState("codex-router");
  const begun = setupDomain_beginOperation(
    initial,
    operationRequest(initial, operationId),
    domainAt,
  );
  return setupDomain_acceptResult(begun.state, verifiedResult(begun.operation)).checkpoint;
}

test("bootstrap, save, and restart preserve exact schema fields and require inspection", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);

  const bootstrapped = await store.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  const candidate = admissionCheckpoint("op-admission");
  const saved = await saveWithCurrentRevision(store, authority, candidate);

  expect(bootstrapped.automaticActions).toEqual([]);
  expect(saved.authorityCommitted).toBe(true);
  expect(saved.authorityRevision).toBe("authority-2");
  expect((await readPrimary(root)) as any).toMatchObject({
    schemaVersion: setupCheckpointStore_envelopeSchemaVersion,
    authorityRevision: "authority-2",
    sequenceState: {
      operationSequence: 1,
      state: "admitted",
    },
    checkpoint: {
      schemaVersion: 3,
      routeId: "codex-router",
      componentId: "codex-router",
      generation: 1,
      configRevision: 1,
      operationSequence: 1,
      lastCompletedOperationId: null,
      retiredOperations: [],
    },
  });

  const restarted = await createStore(root, authority).load({
    restartId: "restart-one",
    configRevision: 2,
  });
  expect(restarted.checkpoint.generation).toBe(2);
  expect(restarted.checkpoint.configRevision).toBe(2);
  expect(restarted.checkpoint.operationSequence).toBe(1);
  expect(restarted.checkpoint.retiredOperations).toEqual([]);
  expect(restarted.sequenceState).toEqual({
    operationSequence: 1,
    state: "idle",
  });
  expect(restarted.checkpoint.progress.steps).toMatchObject([
    { step: "detection", state: "pending" },
    { step: "installation", state: "pending" },
    { step: "process", state: "pending" },
    { step: "endpoint", state: "pending" },
    { step: "account", state: "pending" },
    { step: "catalogue", state: "pending" },
    { step: "permission", state: "pending" },
    { step: "probe", state: "pending" },
  ]);
  expect(restarted.state.activeOperation).toBeNull();
  expect(restarted.state.cancellationIntent).toBeNull();
  expect(restarted.state.requiresInspection).toBe(true);
  expect(restarted.restart.preRestartResultsAccepted).toBe(false);
  expect(restarted.automaticActions).toEqual([]);
  expect(authority.presentSnapshot()?.anchor.checkpoint).toEqual(restarted.checkpoint);
});

test("actual domain completion at one operation sequence persists and survives restart", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);
  await store.bootstrap({ authorizeEmptyAuthority: true, routeId: "codex-router" });

  const initial = setupDomain_initialState("codex-router");
  const begun = setupDomain_beginOperation(
    initial,
    operationRequest(initial, "op-completion"),
    domainAt,
  );
  await saveWithCurrentRevision(store, authority, begun.state.checkpoint);
  const beforeDivergence = await readFile(join(root, "setup-checkpoint.json"), "utf8");
  const divergent = setupCentre_decodeCheckpoint({
    ...begun.state.checkpoint,
    lastCompletedOperationId: "op-completion",
    progress: {
      ...begun.state.checkpoint.progress,
      steps: begun.state.checkpoint.progress.steps.map((entry) =>
        entry.step === "detection" || entry.step === "installation"
          ? { ...entry, state: "complete" as const }
          : entry,
      ),
    },
  });
  await expect(saveWithCurrentRevision(store, authority, divergent)).rejects.toMatchObject({
    code: "conflicting-checkpoint",
  });
  expect(await readFile(join(root, "setup-checkpoint.json"), "utf8")).toBe(beforeDivergence);
  const completed = setupDomain_acceptResult(begun.state, verifiedResult(begun.operation));
  expect(completed.checkpoint.operationSequence).toBe(begun.state.checkpoint.operationSequence);

  await saveWithCurrentRevision(store, authority, completed.checkpoint);
  const replay = await saveWithCurrentRevision(store, authority, completed.checkpoint);
  expect(replay.authorityCommitted).toBe(false);

  const secondAdmission = setupDomain_beginOperation(
    completed,
    operationRequest(completed, "op-second-completion", "installation"),
    domainAt + 2,
  );
  await saveWithCurrentRevision(store, authority, secondAdmission.state.checkpoint);
  const secondCompleted = setupDomain_acceptResult(
    secondAdmission.state,
    verifiedResult(secondAdmission.operation, domainAt + 3),
  );
  await saveWithCurrentRevision(store, authority, secondCompleted.checkpoint);

  const restarted = await createStore(root, authority).restart({
    restartId: "restart-after-completion",
    configRevision: 1,
  });
  expect(restarted.checkpoint.operationSequence).toBe(2);
  expect(restarted.checkpoint.lastCompletedOperationId).toBe("op-second-completion");
  expect(restarted.checkpoint.progress.steps.slice(0, 2)).toEqual([
    { step: "detection", state: "complete" },
    { step: "installation", state: "complete" },
  ]);
  expect(restarted.state.activeOperation).toBeNull();
  expect(restarted.state.requiresInspection).toBe(true);
  expect(restarted.automaticActions).toEqual([]);
});

test("actual domain cancellation retirement persists and blocks operation-ID reuse", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);
  const bootstrapped = await store.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });

  const initial = setupDomain_createState(bootstrapped.checkpoint, {
    componentId: "codex-router",
    ownership: "unknown",
    generation: bootstrapped.checkpoint.generation,
    configRevision: bootstrapped.checkpoint.configRevision,
    facts: [],
  });
  const begun = setupDomain_beginOperation(
    initial,
    operationRequest(initial, "op-retire"),
    domainAt,
  );
  await saveWithCurrentRevision(store, authority, begun.state.checkpoint);
  const intent = setupDomain_requestCancellation(
    begun.state,
    {
      cancellationId: "cancel-op-retire",
      operationId: "op-retire",
      generation: begun.state.checkpoint.generation,
      configRevision: begun.state.checkpoint.configRevision,
      reason: "user-cancelled",
    },
    domainAt + 1,
  );
  const cancelled = setupDomain_applyCancellationReceipt(intent.state, {
    kind: "cancellation-receipt",
    cancellationId: "cancel-op-retire",
    operationId: "op-retire",
    generation: begun.state.checkpoint.generation,
    configRevision: begun.state.checkpoint.configRevision,
    outcome: "stopped",
    effects: "none",
    observedAt: domainAt + 2,
  });
  expect(cancelled.state.checkpoint.operationSequence).toBe(
    begun.state.checkpoint.operationSequence,
  );
  await saveWithCurrentRevision(store, authority, cancelled.state.checkpoint);
  const replacedRetirement = setupCentre_decodeCheckpoint({
    ...cancelled.state.checkpoint,
    retiredOperations: [
      {
        ...cancelled.state.checkpoint.retiredOperations[0],
        operationId: "op-forged-retirement",
      },
    ],
  });
  await expect(saveWithCurrentRevision(store, authority, replacedRetirement)).rejects.toMatchObject(
    { code: "stale-checkpoint" },
  );
  await expect(
    saveWithCurrentRevision(store, authority, begun.state.checkpoint),
  ).rejects.toMatchObject({ code: "stale-checkpoint" });

  const restarted = await createStore(root, authority).restart({
    restartId: "restart-after-retirement",
    configRevision: 1,
  });
  expect(restarted.checkpoint.operationSequence).toBe(1);
  expect(restarted.checkpoint.retiredOperations).toEqual([
    expect.objectContaining({
      operationId: "op-retire",
      operationSequence: 1,
      generation: 1,
      outcome: "stopped",
    }),
  ]);

  const restored = setupDomain_createState(restarted.checkpoint, {
    componentId: restarted.checkpoint.componentId,
    ownership: "unknown",
    generation: restarted.checkpoint.generation,
    configRevision: restarted.checkpoint.configRevision,
    facts: [],
  });
  expect(() =>
    setupDomain_beginOperation(restored, operationRequest(restored, "op-retire"), domainAt + 3),
  ).toThrow(/retired/);
});

test("one operation sequence cannot accept a second terminal continuation", async () => {
  const completedRoot = await tempRoot();
  const completedAuthority = new MemoryAuthority();
  const completedStore = createStore(completedRoot, completedAuthority);
  await completedStore.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  const initial = setupDomain_initialState("codex-router");
  const begun = setupDomain_beginOperation(
    initial,
    operationRequest(initial, "op-first-terminal"),
    domainAt,
  );
  await saveWithCurrentRevision(completedStore, completedAuthority, begun.state.checkpoint);
  const completed = setupDomain_acceptResult(
    begun.state,
    verifiedResult(begun.operation),
  ).checkpoint;
  await saveWithCurrentRevision(completedStore, completedAuthority, completed);

  const secondCompletion = setupCentre_decodeCheckpoint({
    ...completed,
    lastCompletedOperationId: "op-second-terminal",
    progress: {
      ...completed.progress,
      steps: completed.progress.steps.map((entry) =>
        entry.step === "installation" ? { ...entry, state: "complete" as const } : entry,
      ),
    },
  });
  await expectConflictWithoutMutation(
    completedRoot,
    completedStore,
    completedAuthority,
    secondCompletion,
  );

  const retirementAfterCompletion = setupCentre_decodeCheckpoint({
    ...completed,
    retiredOperations: [
      {
        operationId: "op-retired-after-completion",
        operationSequence: completed.operationSequence,
        generation: completed.generation,
        retiredAt: domainAt + 2,
        outcome: "stopped",
        cancellationId: "cancel-after-completion",
        effects: "none",
      },
    ],
  });
  await expectConflictWithoutMutation(
    completedRoot,
    completedStore,
    completedAuthority,
    retirementAfterCompletion,
  );

  const retiredRoot = await tempRoot();
  const retiredAuthority = new MemoryAuthority();
  const retiredStore = createStore(retiredRoot, retiredAuthority);
  await retiredStore.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  const retiredInitial = setupDomain_initialState("codex-router");
  const retiredBegun = setupDomain_beginOperation(
    retiredInitial,
    operationRequest(retiredInitial, "op-retired-terminal"),
    domainAt,
  );
  await saveWithCurrentRevision(retiredStore, retiredAuthority, retiredBegun.state.checkpoint);
  const intent = setupDomain_requestCancellation(
    retiredBegun.state,
    {
      cancellationId: "cancel-op-retired-terminal",
      operationId: "op-retired-terminal",
      generation: retiredBegun.state.checkpoint.generation,
      configRevision: retiredBegun.state.checkpoint.configRevision,
      reason: "user-cancelled",
    },
    domainAt + 1,
  );
  const retired = setupDomain_applyCancellationReceipt(intent.state, {
    kind: "cancellation-receipt",
    cancellationId: "cancel-op-retired-terminal",
    operationId: "op-retired-terminal",
    generation: retiredBegun.state.checkpoint.generation,
    configRevision: retiredBegun.state.checkpoint.configRevision,
    outcome: "stopped",
    effects: "none",
    observedAt: domainAt + 2,
  }).state.checkpoint;
  await saveWithCurrentRevision(retiredStore, retiredAuthority, retired);

  const completionAfterRetirement = setupCentre_decodeCheckpoint({
    ...retired,
    lastCompletedOperationId: "op-completion-after-retirement",
    progress: {
      ...retired.progress,
      steps: retired.progress.steps.map((entry) =>
        entry.step === "detection" ? { ...entry, state: "complete" as const } : entry,
      ),
    },
  });
  await expectConflictWithoutMutation(
    retiredRoot,
    retiredStore,
    retiredAuthority,
    completionAfterRetirement,
  );
});

test("bootstrap is explicit and refuses non-empty authority or local-only data", async () => {
  const unauthorizedRoot = await tempRoot();
  const unauthorizedAuthority = new MemoryAuthority();
  const unauthorized = createStore(unauthorizedRoot, unauthorizedAuthority);
  await expect(
    unauthorized.bootstrap({
      authorizeEmptyAuthority: false,
      routeId: "direct-provider",
    } as unknown),
  ).rejects.toMatchObject({ code: "invalid-bootstrap" });
  expect(unauthorizedAuthority.readCount).toBe(0);
  expect(unauthorizedAuthority.commitRequests).toEqual([]);

  const nonEmptyRoot = await tempRoot();
  const nonEmptyAuthority = new MemoryAuthority();
  nonEmptyAuthority.setSnapshot({
    revision: "authority-existing",
    anchor: {
      schemaVersion: 1,
      authority: "persistence-owner",
      checkpoint: setupDomain_initialCheckpoint("direct-provider"),
    },
    sequenceState: {
      operationSequence: 0,
      state: "idle",
    },
  });
  await expect(
    createStore(nonEmptyRoot, nonEmptyAuthority).bootstrap({
      authorizeEmptyAuthority: true,
      routeId: "direct-provider",
    }),
  ).rejects.toMatchObject({ code: "bootstrap-authority-not-empty" });

  const localOnlyRoot = await tempRoot();
  const localOnlyAuthority = new MemoryAuthority();
  await writeFile(join(localOnlyRoot, "setup-checkpoint.json"), "{}\n");
  await expect(
    createStore(localOnlyRoot, localOnlyAuthority).bootstrap({
      authorizeEmptyAuthority: true,
      routeId: "direct-provider",
    }),
  ).rejects.toMatchObject({ code: "bootstrap-local-present" });
  expect(localOnlyAuthority.commitRequests).toEqual([]);
});

test("constructor requires an injected writer capability without an ambient default", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();

  expect(
    () => new SetupCheckpointStore(root, authority, {} as unknown as SetupCheckpointStoreOptions),
  ).toThrow(expect.objectContaining({ code: "invalid-writer" }));
});

test("save requires the caller's expected authority revision", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);
  const bootstrapped = await store.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  const before = authority.presentSnapshot();

  await expect(store.save(bootstrapped.checkpoint, undefined as never)).rejects.toMatchObject({
    code: "invalid-save-options",
  });
  expect(authority.presentSnapshot()).toEqual(before);
});

test("missing local state recovers only from a present authority and reconciles restart", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);
  await store.bootstrap({ authorizeEmptyAuthority: true, routeId: "direct-provider" });
  await rm(join(root, "setup-checkpoint.json"), { force: true });
  await rm(join(root, "setup-checkpoint.json.bak"), { force: true });

  const recovered = await store.restart({
    restartId: "restart-authority-recovery",
    configRevision: 1,
  });
  expect(recovered.recovery).toBe("authority-missing");
  expect(recovered.checkpoint.generation).toBe(2);
  expect(recovered.state.activeOperation).toBeNull();
  expect(recovered.state.requiresInspection).toBe(true);
  expect(recovered.automaticActions).toEqual([]);
  expect((await readPrimary(root)) as any).toMatchObject({
    authorityRevision: recovered.authorityRevision,
    checkpoint: recovered.checkpoint,
  });
});

test("forged, truncated, and divergent local files never self-authenticate", async () => {
  const forgedRoot = await tempRoot();
  const forgedAuthority = new MemoryAuthority();
  const forgedStore = createStore(forgedRoot, forgedAuthority);
  await forgedStore.bootstrap({ authorizeEmptyAuthority: true, routeId: "codex-router" });
  await writeFile(
    join(forgedRoot, "setup-checkpoint.json"),
    `${JSON.stringify({
      schemaVersion: setupCheckpointStore_envelopeSchemaVersion,
      authorityRevision: forgedAuthority.presentSnapshot()?.revision,
      checkpoint: setupDomain_initialCheckpoint("codex-router"),
      freeAuthentication: true,
    })}\n`,
  );
  await expect(
    forgedStore.restart({ restartId: "restart-forged", configRevision: 1 }),
  ).rejects.toMatchObject({ code: "invalid-envelope" });

  const truncatedRoot = await tempRoot();
  const truncatedAuthority = new MemoryAuthority();
  const truncatedStore = createStore(truncatedRoot, truncatedAuthority);
  await truncatedStore.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "direct-provider",
  });
  await writeFile(join(truncatedRoot, "setup-checkpoint.json"), '{"schemaVersion":');
  await rm(join(truncatedRoot, "setup-checkpoint.json.bak"), { force: true });
  await expect(
    truncatedStore.restart({ restartId: "restart-truncated", configRevision: 1 }),
  ).rejects.toMatchObject({ code: "local-checkpoint-corrupt" });

  const divergentRoot = await tempRoot();
  const divergentAuthority = new MemoryAuthority();
  const divergentStore = createStore(divergentRoot, divergentAuthority);
  await divergentStore.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  await saveWithCurrentRevision(
    divergentStore,
    divergentAuthority,
    admissionCheckpoint("op-authorized"),
  );
  const divergent = completionCheckpoint("op-forged");
  await writeFile(
    join(divergentRoot, "setup-checkpoint.json"),
    `${JSON.stringify({
      schemaVersion: setupCheckpointStore_envelopeSchemaVersion,
      authorityRevision: divergentAuthority.presentSnapshot()?.revision,
      checkpoint: divergent,
      sequenceState: divergentAuthority.presentSnapshot()?.sequenceState,
    })}\n`,
  );
  await rm(join(divergentRoot, "setup-checkpoint.json.bak"), { force: true });
  await expect(
    divergentStore.restart({ restartId: "restart-divergent", configRevision: 1 }),
  ).rejects.toMatchObject({ code: "local-authority-mismatch" });
});

test("rolled-back primary is discarded when a safe authority advance is available", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);
  await store.bootstrap({ authorizeEmptyAuthority: true, routeId: "codex-router" });
  const initial = setupDomain_initialState("codex-router");
  const begun = setupDomain_beginOperation(
    initial,
    operationRequest(initial, "op-first"),
    domainAt,
  );
  await saveWithCurrentRevision(store, authority, begun.state.checkpoint);
  const priorBytes = await readFile(join(root, "setup-checkpoint.json"));
  const completed = setupDomain_acceptResult(begun.state, verifiedResult(begun.operation));
  await saveWithCurrentRevision(store, authority, completed.checkpoint);
  await writeFile(join(root, "setup-checkpoint.json"), priorBytes);
  await rm(join(root, "setup-checkpoint.json.bak"), { force: true });

  const recovered = await store.restart({
    restartId: "restart-rolled-back-local",
    configRevision: 1,
  });
  expect(recovered.recovery).toBe("authority-commit-interrupted");
  expect(recovered.checkpoint.retiredOperations).toEqual([]);
  expect(recovered.checkpoint.operationSequence).toBe(1);
  expect(recovered.checkpoint.lastCompletedOperationId).toBe("op-first");
  expect(recovered.checkpoint.progress.steps[0]).toEqual({
    step: "detection",
    state: "complete",
  });
  expect(recovered.checkpoint.generation).toBe(2);
});

test("restart observation cannot roll back the authoritative configuration revision", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);
  await store.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "direct-provider",
    configRevision: 2,
  });
  const before = authority.presentSnapshot();

  await expect(
    store.restart({ restartId: "restart-config-rollback", configRevision: 1 }),
  ).rejects.toMatchObject({ code: "stale-checkpoint" });
  expect(authority.presentSnapshot()).toEqual(before);
  expect(await readFile(join(root, "setup-checkpoint.json"), "utf8")).toContain(
    '"configRevision": 2',
  );

  const initial = setupDomain_initialCheckpoint("direct-provider", 2, 1);
  const rolledBackCandidate = setupCentre_decodeCheckpoint({
    ...initial,
  });
  await expect(
    saveWithCurrentRevision(store, authority, rolledBackCandidate),
  ).rejects.toMatchObject({
    code: "stale-checkpoint",
  });
});

test("same-sequence competitors with one expected revision allow exactly one commit", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const firstStore = createStore(root, authority);
  await firstStore.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  const secondStore = createStore(root, authority);
  const initial = setupDomain_initialState("codex-router");
  const begun = setupDomain_beginOperation(
    initial,
    operationRequest(initial, "op-competing"),
    domainAt,
  );
  await saveWithCurrentRevision(firstStore, authority, begun.state.checkpoint);
  const expectedAuthorityRevision = authority.presentSnapshot()?.revision;
  if (!expectedAuthorityRevision) throw new Error("test authority has no checkpoint");
  const completed = setupDomain_acceptResult(
    begun.state,
    verifiedResult(begun.operation),
  ).checkpoint;
  const intent = setupDomain_requestCancellation(
    begun.state,
    {
      cancellationId: "cancel-op-competing",
      operationId: "op-competing",
      generation: begun.state.checkpoint.generation,
      configRevision: begun.state.checkpoint.configRevision,
      reason: "user-cancelled",
    },
    domainAt + 2,
  );
  const retired = setupDomain_applyCancellationReceipt(intent.state, {
    kind: "cancellation-receipt",
    cancellationId: "cancel-op-competing",
    operationId: "op-competing",
    generation: begun.state.checkpoint.generation,
    configRevision: begun.state.checkpoint.configRevision,
    outcome: "stopped",
    effects: "none",
    observedAt: domainAt + 3,
  }).state.checkpoint;
  const results = await Promise.allSettled([
    firstStore.save(completed, { expectedAuthorityRevision }),
    secondStore.save(retired, { expectedAuthorityRevision }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status).toBe("rejected");
  if (rejected?.status === "rejected") {
    expect(rejected.reason).toBeInstanceOf(SetupCheckpointStoreError);
    if (!(rejected.reason instanceof SetupCheckpointStoreError)) {
      throw rejected.reason;
    }
    expect(rejected.reason.code).toBe("stale-authority-revision");
  }
  const authoritative = authority.presentSnapshot()?.anchor.checkpoint;
  const committedBytes = await readFile(join(root, "setup-checkpoint.json"), "utf8");
  const committedRevision = authority.presentSnapshot()?.revision;
  expect(authoritative?.operationSequence).toBe(1);
  expect(
    (authoritative?.progress.steps[0]?.state === "complete") !==
      (authoritative?.retiredOperations.length === 1),
  ).toBe(true);
  expect((await readPrimary(root)) as any).toMatchObject({
    authorityRevision: authority.presentSnapshot()?.revision,
    checkpoint: authoritative,
  });
  if (rejected?.status === "rejected") {
    const rejectedCandidate = results[0]?.status === "rejected" ? completed : retired;
    await expect(
      firstStore.save(rejectedCandidate, { expectedAuthorityRevision }),
    ).rejects.toMatchObject({ code: "stale-authority-revision" });
    expect(await readFile(join(root, "setup-checkpoint.json"), "utf8")).toBe(committedBytes);
    expect(authority.presentSnapshot()?.revision).toBe(committedRevision);
  }
});

test("conditional rejection is definite and leaves local promotion untouched", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);
  await store.bootstrap({ authorizeEmptyAuthority: true, routeId: "codex-router" });
  const before = await readFile(join(root, "setup-checkpoint.json"), "utf8");
  authority.commitOverride = async () => ({
    state: "rejected",
    reason: "conditional-mismatch",
  });

  await expect(
    saveWithCurrentRevision(store, authority, admissionCheckpoint("op-rejected")),
  ).rejects.toMatchObject({
    code: "authority-rejected",
    requiresFreshRead: false,
  });
  expect(await readFile(join(root, "setup-checkpoint.json"), "utf8")).toBe(before);
});

test("indeterminate authority commit requires fresh inspection and recovers authority state", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);
  await store.bootstrap({ authorizeEmptyAuthority: true, routeId: "codex-router" });
  const before = await readFile(join(root, "setup-checkpoint.json"), "utf8");
  let committedAnchor: SetupCheckpointAnchor | undefined;
  authority.commitOverride = async (request) => {
    authority.setSnapshot({
      revision: "authority-indeterminate-committed",
      anchor: request.anchor,
    });
    committedAnchor = request.anchor;
    return { state: "indeterminate" };
  };

  await expect(
    saveWithCurrentRevision(store, authority, admissionCheckpoint("op-indeterminate")),
  ).rejects.toMatchObject({
    code: "authority-indeterminate",
    requiresFreshRead: true,
  });
  expect(await readFile(join(root, "setup-checkpoint.json"), "utf8")).toBe(before);
  expect(authority.presentSnapshot()?.anchor).toEqual(committedAnchor);
  authority.commitOverride = undefined;

  const recovered = await createStore(root, authority).restart({
    restartId: "restart-after-indeterminate",
    configRevision: 1,
  });
  expect(recovered.recovery).toBe("authority-commit-interrupted");
  expect(recovered.checkpoint.retiredOperations).toEqual(
    committedAnchor?.checkpoint.retiredOperations,
  );
  expect(recovered.checkpoint.generation).toBe(2);
});

test("thrown or mismatched authority receipts are treated as fresh-read failures", async () => {
  const thrownRoot = await tempRoot();
  const thrownAuthority = new MemoryAuthority();
  const thrownStore = createStore(thrownRoot, thrownAuthority);
  await thrownStore.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  thrownAuthority.commitOverride = async () => {
    throw new Error("transport-outcome-unknown");
  };
  await expect(
    saveWithCurrentRevision(
      thrownStore,
      thrownAuthority,
      admissionCheckpoint("op-transport-unknown"),
    ),
  ).rejects.toMatchObject({
    code: "authority-indeterminate",
    requiresFreshRead: true,
  });

  const mismatchRoot = await tempRoot();
  const mismatchAuthority = new MemoryAuthority();
  const mismatchStore = createStore(mismatchRoot, mismatchAuthority);
  await mismatchStore.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  mismatchAuthority.commitOverride = async () => ({
    state: "committed",
    revision: "authority-mismatched-receipt",
    anchor: {
      schemaVersion: 1,
      authority: "persistence-owner",
      checkpoint: setupDomain_initialCheckpoint("direct-provider"),
    },
    sequenceState: {
      operationSequence: 0,
      state: "idle",
    },
  });
  await expect(
    saveWithCurrentRevision(
      mismatchStore,
      mismatchAuthority,
      admissionCheckpoint("op-mismatched-receipt"),
    ),
  ).rejects.toMatchObject({
    code: "authority-receipt-mismatch",
    requiresFreshRead: true,
  });
});

test("failures before and after local promotion are distinct and recoverable", async () => {
  const beforeRoot = await tempRoot();
  const beforeAuthority = new MemoryAuthority();
  const beforeBootstrap = createStore(beforeRoot, beforeAuthority);
  await beforeBootstrap.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  const beforeFailure = new SetupCheckpointStore(beforeRoot, beforeAuthority, {
    write: async () => {
      throw new Error("injected-before-promotion");
    },
  });
  await expect(
    saveWithCurrentRevision(beforeFailure, beforeAuthority, admissionCheckpoint("op-write-before")),
  ).rejects.toMatchObject({
    code: "local-promotion-failed",
  });
  const recoveredBefore = await createStore(beforeRoot, beforeAuthority).restart({
    restartId: "restart-after-write-before",
    configRevision: 1,
  });
  expect(recoveredBefore.recovery).toBe("authority-commit-interrupted");

  const afterRoot = await tempRoot();
  const afterAuthority = new MemoryAuthority();
  const afterBootstrap = createStore(afterRoot, afterAuthority);
  await afterBootstrap.bootstrap({
    authorizeEmptyAuthority: true,
    routeId: "codex-router",
  });
  const afterFailure = new SetupCheckpointStore(afterRoot, afterAuthority, {
    write: async (filePath, contents, validateExisting) => {
      await writeFileAtomicQueued(filePath, contents, validateExisting);
      throw new Error("injected-after-promotion");
    },
  });
  await expect(
    saveWithCurrentRevision(afterFailure, afterAuthority, admissionCheckpoint("op-write-after")),
  ).rejects.toMatchObject({
    code: "local-promotion-failed",
  });
  const recoveredAfter = await createStore(afterRoot, afterAuthority).restart({
    restartId: "restart-after-write-after",
    configRevision: 1,
  });
  expect(recoveredAfter.recovery).toBe("none");
  expect(recoveredAfter.checkpoint.operationSequence).toBe(1);
  expect(recoveredAfter.checkpoint.lastCompletedOperationId).toBeNull();
  expect(recoveredAfter.checkpoint.progress.steps[0]?.state).toBe("pending");
});

test("unavailable or accessor-bearing authority results fail without executing getters", async () => {
  const unavailableRoot = await tempRoot();
  const unavailableAuthority = new MemoryAuthority();
  unavailableAuthority.readOverride = async () => ({ state: "unavailable" });
  const unavailableStore = createStore(unavailableRoot, unavailableAuthority);
  await expect(
    unavailableStore.bootstrap({
      authorizeEmptyAuthority: true,
      routeId: "direct-provider",
    }),
  ).rejects.toMatchObject({ code: "authority-unavailable" });

  const accessorRoot = await tempRoot();
  const accessorAuthority = new MemoryAuthority();
  let getterReads = 0;
  accessorAuthority.readOverride = async () => {
    const result = {};
    Object.defineProperty(result, "state", {
      enumerable: true,
      get() {
        getterReads += 1;
        return "empty";
      },
    });
    return result as SetupCheckpointStoreAuthorityReadResult;
  };
  await expect(
    createStore(accessorRoot, accessorAuthority).bootstrap({
      authorizeEmptyAuthority: true,
      routeId: "direct-provider",
    }),
  ).rejects.toMatchObject({ code: "authority-unavailable" });
  expect(getterReads).toBe(0);
});

test("strict envelope accessors and unknown fields fail without executing getters", () => {
  const checkpoint = setupDomain_initialCheckpoint("direct-provider");
  let getterReads = 0;
  const accessorEnvelope = {};
  Object.defineProperties(accessorEnvelope, {
    schemaVersion: {
      enumerable: true,
      get() {
        getterReads += 1;
        return setupCheckpointStore_envelopeSchemaVersion;
      },
    },
    authorityRevision: {
      enumerable: true,
      value: "authority-1",
    },
    checkpoint: {
      enumerable: true,
      value: checkpoint,
    },
  });
  expect(() => setupCheckpointStore_decodeEnvelope(accessorEnvelope)).toThrow(
    SetupCheckpointStoreError,
  );
  expect(getterReads).toBe(0);

  expect(() =>
    setupCheckpointStore_decodeEnvelope({
      schemaVersion: setupCheckpointStore_envelopeSchemaVersion,
      authorityRevision: "authority-1",
      checkpoint,
      unknown: true,
    }),
  ).toThrow(SetupCheckpointStoreError);
});

test("oversize files and secret-bearing inputs fail closed without echoing values", async () => {
  const root = await tempRoot();
  const authority = new MemoryAuthority();
  const store = createStore(root, authority);
  await store.bootstrap({ authorizeEmptyAuthority: true, routeId: "direct-provider" });
  await writeFile(
    join(root, "setup-checkpoint.json"),
    Buffer.alloc(setupCheckpointStore_maxFileBytes + 1, 0x20),
  );
  await rm(join(root, "setup-checkpoint.json.bak"), { force: true });
  await expect(
    store.restart({ restartId: "restart-oversize", configRevision: 1 }),
  ).rejects.toMatchObject({ code: "local-checkpoint-too-large" });

  const secret = "sk_live_fixture_value_must_not_escape";
  let restartError: unknown;
  try {
    await store.restart({ restartId: secret, configRevision: 1 });
  } catch (error) {
    restartError = error;
  }
  expect(restartError).toBeInstanceOf(SetupCheckpointStoreError);
  expect(String(restartError)).not.toContain(secret);

  const secretAuthorityRoot = await tempRoot();
  const secretAuthority = new MemoryAuthority();
  secretAuthority.readOverride = async () => ({
    state: "present",
    revision: secret,
    anchor: {
      schemaVersion: 1,
      authority: "persistence-owner",
      checkpoint: setupDomain_initialCheckpoint("direct-provider"),
    },
    sequenceState: {
      operationSequence: 0,
      state: "idle",
    },
  });
  let authorityError: unknown;
  try {
    await createStore(secretAuthorityRoot, secretAuthority).restart({
      restartId: "restart-secret-authority",
      configRevision: 1,
    });
  } catch (error) {
    authorityError = error;
  }
  expect(authorityError).toBeInstanceOf(SetupCheckpointStoreError);
  expect(String(authorityError)).not.toContain(secret);
});
