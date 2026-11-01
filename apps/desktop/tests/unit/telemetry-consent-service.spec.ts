import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  TELEMETRY_MAX_BODY_BYTES,
  TELEMETRY_RETRY_BASE_MS,
  TELEMETRY_RETRY_MAX_MS,
  TELEMETRY_SCHEMA,
  telemetry_fingerprint,
  telemetry_initialize,
  type TelemetryOwner,
} from "../../electron/telemetry/telemetry";
import type { TelemetryConsentCheckpoint } from "../../contracts/telemetry-consent";
import {
  DistributionTelemetryIntegration,
  type DistributionTelemetryConsentResult,
} from "../../electron/distribution/telemetry-integration";
import {
  TELEMETRY_CONSENT_SERVICE_MAX_SUBSCRIBERS,
  TelemetryConsentService,
  type TelemetryConsentServiceOwner,
} from "../../electron/distribution/telemetry-consent-service";
import {
  TelemetryConsentFileStore,
  type TelemetryConsentStore,
} from "../../electron/persistence/telemetry-consent-store";
import {
  FakeClock,
  FakeTransport,
  MemoryPersistence,
  RecordingLogger,
  parseBody,
  testConfiguration,
  testDependencies,
  waitFor,
} from "./telemetry-test-fixtures";

const temporaryRoots: string[] = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class MemoryConsentStore implements TelemetryConsentStore {
  value: TelemetryConsentCheckpoint | null = null;
  readonly writes: TelemetryConsentCheckpoint[] = [];
  failSaveAt: number | null = null;
  loadFailure = false;

  async load(): Promise<TelemetryConsentCheckpoint | null> {
    if (this.loadFailure) throw new Error("synthetic provenance load failure");
    return this.value === null ? null : structuredClone(this.value);
  }

  async save(value: unknown): Promise<void> {
    if (this.failSaveAt === this.writes.length + 1) {
      throw new Error("synthetic provenance write failure");
    }
    const checkpoint = structuredClone(value) as TelemetryConsentCheckpoint;
    this.writes.push(checkpoint);
    this.value = checkpoint;
  }
}

interface EngineFixture {
  readonly owner: TelemetryOwner;
  readonly integration: DistributionTelemetryIntegration;
  readonly enginePersistence: MemoryPersistence;
  readonly transport: FakeTransport;
  readonly clock: FakeClock;
  readonly logger: RecordingLogger;
}

async function createEngine(
  options: {
    persistence?: MemoryPersistence;
    transport?: FakeTransport;
    clock?: FakeClock;
  } = {},
): Promise<EngineFixture> {
  const enginePersistence = options.persistence ?? new MemoryPersistence();
  const transport = options.transport ?? new FakeTransport();
  const clock = options.clock ?? new FakeClock();
  const dependencies = testDependencies({
    persistence: enginePersistence,
    transport,
    clock,
  });
  const owner = await telemetry_initialize(testConfiguration(), dependencies);
  return {
    owner,
    integration: new DistributionTelemetryIntegration(owner),
    enginePersistence,
    transport,
    clock,
    logger: dependencies.logger,
  };
}

async function createService(
  fixture: EngineFixture,
  store: MemoryConsentStore | TelemetryConsentFileStore,
  owner: TelemetryConsentServiceOwner = fixture.integration,
): Promise<TelemetryConsentService> {
  return TelemetryConsentService.create(owner, store);
}

function request(
  expectedRequestRevision: number,
  usage: "allowed" | "denied",
  crash: "allowed" | "denied",
) {
  return {
    schemaVersion: 1 as const,
    expectedRequestRevision,
    disclosureVersion: 1,
    usage,
    crash,
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-telemetry-consent-service-"));
  temporaryRoots.push(root);
  return root;
}

test("first run is undecided and a complete change saves independent allowed and denied provenance", async () => {
  const fixture = await createEngine();
  const store = new MemoryConsentStore();
  const service = await createService(fixture, store);

  expect(service.telemetry_consent_get()).toMatchObject({
    desired: {
      usage: { value: "undecided", source: "absent" },
      crash: { value: "undecided", source: "absent" },
    },
    durable: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    outcome: "none",
    delivery: { receipt: "not-observed" },
  });

  const saved = await service.telemetry_consent_change(request(0, "allowed", "denied"));
  expect(saved).toMatchObject({
    desired: {
      usage: { value: "allowed", source: "user", disclosureVersion: 1 },
      crash: { value: "denied", source: "user", disclosureVersion: 1 },
    },
    durable: {
      usage: { value: "allowed" },
      crash: { value: "denied" },
    },
    effective: {
      usage: { value: "allowed" },
      crash: { value: "denied" },
    },
    pending: null,
    outcome: "saved",
    delivery: { receipt: "not-observed" },
  });
  expect(store.writes).toHaveLength(2);
  expect(store.writes[0]?.pending).not.toBeNull();
  expect(store.writes[1]?.pending).toBeNull();
  expect(fixture.integration.consent()).toEqual({ telemetry: true, crash: false });
  expect(fixture.transport.requests).toHaveLength(0);
  service.telemetry_consent_cleanup();
  await fixture.integration.shutdown();
});

test("allowed and explicit denial provenance survive isolated restart while missing provenance stays closed", async () => {
  const root = await temporaryRoot();
  const enginePersistence = new MemoryPersistence();
  const firstEngine = await createEngine({ persistence: enginePersistence });
  const firstService = await createService(firstEngine, new TelemetryConsentFileStore(root));
  expect(
    await firstService.telemetry_consent_change(request(0, "allowed", "denied")),
  ).toMatchObject({ outcome: "saved" });
  firstService.telemetry_consent_cleanup();
  await firstEngine.integration.shutdown();

  const secondEngine = await createEngine({ persistence: enginePersistence });
  const secondService = await createService(secondEngine, new TelemetryConsentFileStore(root));
  expect(secondService.telemetry_consent_get()).toMatchObject({
    desired: {
      usage: { value: "allowed" },
      crash: { value: "denied", source: "user" },
    },
    durable: {
      usage: { value: "allowed" },
      crash: { value: "denied", source: "user" },
    },
    effective: {
      usage: { value: "allowed" },
      crash: { value: "denied" },
    },
    outcome: "none",
  });
  secondService.telemetry_consent_cleanup();
  await secondEngine.integration.shutdown();

  const engineWithoutProvenance = await createEngine({ persistence: enginePersistence });
  const missingStore = await createService(engineWithoutProvenance, new MemoryConsentStore());
  expect(missingStore.telemetry_consent_get()).toMatchObject({
    durable: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    effective: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    outcome: "reconciliation-required",
    engine: {
      ownerConsent: { usage: true, crash: false },
    },
  });
  missingStore.telemetry_consent_cleanup();
  await engineWithoutProvenance.integration.shutdown();
});

test("corrupt or mismatched provenance remains restrictive after restart inspection", async () => {
  const corruptFixture = await createEngine();
  const corruptStore = new MemoryConsentStore();
  corruptStore.loadFailure = true;
  const corruptService = await createService(corruptFixture, corruptStore);
  expect(corruptService.telemetry_consent_get()).toMatchObject({
    durable: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    effective: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
  });
  corruptService.telemetry_consent_cleanup();
  await corruptFixture.integration.shutdown();

  const mismatchFixture = await createEngine();
  const mismatchStore = new MemoryConsentStore();
  mismatchStore.value = {
    schemaVersion: 1,
    latestRequestRevision: 1,
    desired: {
      usage: { value: "allowed", source: "user", disclosureVersion: 1 },
      crash: { value: "denied", source: "user", disclosureVersion: 1 },
    },
    durable: {
      usage: { value: "allowed", source: "user", disclosureVersion: 1 },
      crash: { value: "denied", source: "user", disclosureVersion: 1 },
    },
    pending: null,
  };
  const mismatchService = await createService(mismatchFixture, mismatchStore);
  expect(mismatchService.telemetry_consent_get()).toMatchObject({
    effective: {
      usage: { value: "undecided" },
      crash: { value: "denied" },
    },
    outcome: "reconciliation-required",
    requiresRestartInspection: false,
    requiresReconciliation: true,
  });
  mismatchService.telemetry_consent_cleanup();
  await mismatchFixture.integration.shutdown();
});

test("backup-recovered allowed provenance is not restored without explicit reporting", async () => {
  const root = await temporaryRoot();
  const enginePersistence = new MemoryPersistence();
  const firstEngine = await createEngine({ persistence: enginePersistence });
  const firstStore = new TelemetryConsentFileStore(root);
  const firstService = await createService(firstEngine, firstStore);
  expect(
    await firstService.telemetry_consent_change(request(0, "allowed", "allowed")),
  ).toMatchObject({ outcome: "saved" });
  firstService.telemetry_consent_cleanup();
  await firstEngine.integration.shutdown();

  await firstStore.save({
    schemaVersion: 1,
    latestRequestRevision: 2,
    desired: {
      usage: { value: "denied", source: "user", disclosureVersion: 1 },
      crash: { value: "allowed", source: "user", disclosureVersion: 1 },
    },
    durable: {
      usage: { value: "allowed", source: "user", disclosureVersion: 1 },
      crash: { value: "allowed", source: "user", disclosureVersion: 1 },
    },
    pending: {
      requestRevision: 2,
      disclosureVersion: 1,
      state: "queued",
      desired: {
        usage: { value: "denied", source: "user", disclosureVersion: 1 },
        crash: { value: "allowed", source: "user", disclosureVersion: 1 },
      },
      outcome: "pending",
    },
  });
  await rm(firstStore.filePath);

  const secondEngine = await createEngine({ persistence: enginePersistence });
  expect(secondEngine.integration.consent()).toEqual({ telemetry: true, crash: true });
  const secondStore = new TelemetryConsentFileStore(root);
  await expect(secondStore.load()).rejects.toThrow(/backup.*explicit reconciliation/);
  const secondService = await createService(secondEngine, secondStore);
  expect(secondService.telemetry_consent_get()).toMatchObject({
    durable: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    effective: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    engine: {
      ownerConsent: { usage: true, crash: true },
    },
    outcome: "reconciliation-required",
    requiresReconciliation: true,
  });

  const reconciled = await secondService.telemetry_consent_change(request(0, "denied", "allowed"));
  expect(reconciled).toMatchObject({
    desired: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    durable: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    effective: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    pending: null,
    outcome: "saved",
  });
  expect(secondEngine.integration.consent()).toEqual({
    telemetry: false,
    crash: true,
  });
  await expect(secondStore.load()).resolves.toMatchObject({
    durable: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    pending: null,
  });
  secondService.telemetry_consent_cleanup();
  await secondEngine.integration.shutdown();
});

test("provenance failure attempts restrictive withdrawal and can retry durably", async () => {
  const fixture = await createEngine();
  const store = new MemoryConsentStore();
  const service = await createService(fixture, store);
  expect(await service.telemetry_consent_change(request(0, "allowed", "allowed"))).toMatchObject({
    outcome: "saved",
  });

  store.failSaveAt = store.writes.length + 1;
  const failedWithdrawal = await service.telemetry_consent_change(request(1, "denied", "allowed"));
  expect(failedWithdrawal).toMatchObject({
    durable: {
      usage: { value: "allowed" },
      crash: { value: "allowed" },
    },
    effective: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    engine: {
      ownerConsent: { usage: false, crash: true },
    },
    pending: { requestRevision: 2, state: "persistence-pending" },
    outcome: "not-durable",
  });
  expect(fixture.integration.consent()).toEqual({ telemetry: false, crash: true });
  expect(fixture.transport.requests).toHaveLength(0);

  store.failSaveAt = null;
  expect(await service.telemetry_consent_change(request(2, "denied", "allowed"))).toMatchObject({
    durable: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    effective: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    pending: null,
    outcome: "saved",
  });
  expect(fixture.integration.consent()).toEqual({ telemetry: false, crash: true });

  const enableFixture = await createEngine();
  const enableStore = new MemoryConsentStore();
  const originalStoreSave = enableStore.save.bind(enableStore);
  enableStore.save = async (value: unknown): Promise<void> => {
    const checkpoint = structuredClone(value) as TelemetryConsentCheckpoint;
    if (enableStore.writes.length === 0) {
      // Simulate a process interruption after the engine accepts the request
      // but before any final provenance record can replace this intent.
      await originalStoreSave(checkpoint);
      return;
    }
    throw new Error("simulated process interruption");
  };
  const enableService = await createService(enableFixture, enableStore);
  const interrupted = await enableService.telemetry_consent_change(request(0, "allowed", "denied"));
  expect(interrupted).toMatchObject({
    effective: {
      usage: { value: "undecided" },
      crash: { value: "denied" },
    },
    outcome: "not-durable",
  });
  enableService.telemetry_consent_cleanup();
  await enableFixture.integration.shutdown();

  const restartedEngine = await createEngine({
    persistence: enableFixture.enginePersistence,
  });
  const restarted = await createService(restartedEngine, enableStore);
  expect(restarted.telemetry_consent_get()).toMatchObject({
    effective: {
      usage: { value: "undecided" },
      crash: { value: "denied" },
    },
    pending: { requestRevision: 1, state: "queued" },
    outcome: "pending",
  });
  restarted.telemetry_consent_cleanup();
  await restartedEngine.integration.shutdown();
  await fixture.integration.shutdown();
});

test("prewrite failure preserves each independently enabled category without enabling the other", async () => {
  const cases = [
    {
      name: "usage only",
      initial: request(0, "allowed", "denied"),
      retry: request(1, "allowed", "denied"),
      expectedConsent: { telemetry: true, crash: false },
    },
    {
      name: "crash only",
      initial: request(0, "denied", "allowed"),
      retry: request(1, "denied", "allowed"),
      expectedConsent: { telemetry: false, crash: true },
    },
  ] as const;

  for (const entry of cases) {
    const fixture = await createEngine();
    const store = new MemoryConsentStore();
    const service = await createService(fixture, store);
    expect(await service.telemetry_consent_change(entry.initial), entry.name).toMatchObject({
      outcome: "saved",
    });
    const writesBeforeFailure = store.writes.length;
    store.failSaveAt = writesBeforeFailure + 1;

    const failed = await service.telemetry_consent_change(entry.retry);
    expect(failed, entry.name).toMatchObject({
      desired:
        entry.retry.usage === "allowed"
          ? { usage: { value: "allowed" }, crash: { value: "denied" } }
          : { usage: { value: "denied" }, crash: { value: "allowed" } },
      engine: {
        ownerConsent: {
          usage: entry.expectedConsent.telemetry,
          crash: entry.expectedConsent.crash,
        },
      },
      pending: { requestRevision: 2, state: "persistence-pending" },
      outcome: "not-durable",
    });
    expect(store.writes, entry.name).toHaveLength(writesBeforeFailure);
    expect(fixture.integration.consent(), entry.name).toEqual(entry.expectedConsent);
    expect(fixture.transport.requests, entry.name).toHaveLength(0);
    service.telemetry_consent_cleanup();
    await fixture.integration.shutdown();
  }
});

test("failed withdrawal intent still aborts delivery and clears only the denied queue", async () => {
  let releaseRequest: () => void = () => undefined;
  const transport = new FakeTransport(
    async () =>
      await new Promise<{ status: number; retryAfter: null }>((resolve) => {
        releaseRequest = () => resolve({ status: 200, retryAfter: null });
      }),
  );
  const fixture = await createEngine({ transport });
  const store = new MemoryConsentStore();
  const service = await createService(fixture, store);
  expect(await service.telemetry_consent_change(request(0, "allowed", "allowed"))).toMatchObject({
    outcome: "saved",
  });
  expect(await fixture.integration.recordToolCallStarted()).toBe(true);
  expect(await fixture.integration.recordCrash("other", "session.run_failed")).toBe(true);
  const flushing = fixture.integration.flushDue();
  await waitFor(() => transport.requests.length === 1);
  const signal = transport.requests[0]!.signal;

  store.failSaveAt = store.writes.length + 1;
  const failed = await service.telemetry_consent_change(request(1, "denied", "allowed"));
  expect(failed).toMatchObject({
    effective: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    engine: {
      ownerConsent: { usage: false, crash: true },
      queue: { usage: 0 },
    },
    outcome: "not-durable",
  });
  expect(signal.aborted).toBe(true);
  expect(await fixture.integration.recordToolCallStarted()).toBe(false);
  expect(await fixture.integration.recordCrash("other", "session.run_failed")).toBe(true);
  expect(fixture.integration.status().queue).toMatchObject({
    usage: 0,
    crash: 1,
  });
  releaseRequest();
  await expect(flushing).resolves.toMatchObject({ status: "cancelled" });
  service.telemetry_consent_cleanup();
  await fixture.integration.shutdown();
});

test("continued provenance and engine persistence failures remain restrictive and pending", async () => {
  const fixture = await createEngine();
  const store = new MemoryConsentStore();
  const service = await createService(fixture, store);
  expect(await service.telemetry_consent_change(request(0, "allowed", "allowed"))).toMatchObject({
    outcome: "saved",
  });

  store.failSaveAt = store.writes.length + 1;
  fixture.enginePersistence.failClear = true;
  fixture.enginePersistence.failSave = true;
  expect(await service.telemetry_consent_change(request(1, "denied", "allowed"))).toMatchObject({
    effective: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    engine: {
      ownerConsent: { usage: false, crash: true },
      revocationPending: true,
      withdrawalPending: { usage: true, crash: false },
    },
    pending: { requestRevision: 2, state: "persistence-pending" },
    outcome: "not-durable",
  });

  expect(await service.telemetry_consent_change(request(2, "denied", "denied"))).toMatchObject({
    desired: {
      usage: { value: "denied" },
      crash: { value: "denied" },
    },
    effective: {
      usage: { value: "denied" },
      crash: { value: "denied" },
    },
    engine: {
      ownerConsent: { usage: false, crash: false },
      revocationPending: true,
      withdrawalPending: { usage: true, crash: true },
    },
    pending: { requestRevision: 3, state: "persistence-pending" },
    outcome: "not-durable",
  });
  expect(fixture.integration.consent()).toEqual({ telemetry: false, crash: false });
  service.telemetry_consent_cleanup();
  fixture.owner.telemetry_shutdown();
});

test("engine durability failure keeps withdrawal pending and restrictive after restart", async () => {
  const enginePersistence = new MemoryPersistence();
  const firstEngine = await createEngine({ persistence: enginePersistence });
  const store = new MemoryConsentStore();
  const firstService = await createService(firstEngine, store);
  expect(
    await firstService.telemetry_consent_change(request(0, "allowed", "allowed")),
  ).toMatchObject({ outcome: "saved" });

  enginePersistence.failClear = true;
  enginePersistence.failSave = true;
  const failed = await firstService.telemetry_consent_change(request(1, "denied", "denied"));
  expect(failed).toMatchObject({
    durable: {
      usage: { value: "allowed" },
      crash: { value: "allowed" },
    },
    effective: {
      usage: { value: "denied" },
      crash: { value: "denied" },
    },
    engine: {
      ownerConsent: { usage: false, crash: false },
      revocationPending: true,
      withdrawalPending: { usage: true, crash: true },
    },
    pending: { requestRevision: 2, state: "persistence-pending" },
    outcome: "not-durable",
  });
  firstService.telemetry_consent_cleanup();
  firstEngine.owner.telemetry_shutdown();

  const restartedPersistence = new MemoryPersistence();
  restartedPersistence.state = structuredClone(enginePersistence.state);
  const restartedEngine = await createEngine({ persistence: restartedPersistence });
  expect(restartedEngine.integration.consent()).toEqual({ telemetry: true, crash: true });
  const restartedService = await createService(restartedEngine, store);
  expect(restartedService.telemetry_consent_get()).toMatchObject({
    durable: {
      usage: { value: "allowed" },
      crash: { value: "allowed" },
    },
    effective: {
      usage: { value: "denied" },
      crash: { value: "denied" },
    },
    pending: { requestRevision: 2, state: "queued" },
    outcome: "pending",
  });
  restartedService.telemetry_consent_cleanup();
  await restartedEngine.integration.shutdown();
});

test("withdrawal intent is written before a mixed re-enable and transactions serialize delayed work", async () => {
  const fixture = await createEngine();
  const store = new MemoryConsentStore();
  const events: string[] = [];
  let releaseEnable: (() => void) | null = null;
  const owner: TelemetryConsentServiceOwner = {
    consentMetadata: () => fixture.integration.consentMetadata(),
    async setConsent(usage, crash): Promise<DistributionTelemetryConsentResult> {
      events.push(`engine:${usage}:${crash}`);
      if (usage && crash && releaseEnable === null) {
        await new Promise<void>((resolve) => {
          releaseEnable = resolve;
        });
      }
      return fixture.integration.setConsent(usage, crash);
    },
  };
  const originalSave = store.save.bind(store);
  store.save = async (value: unknown): Promise<void> => {
    events.push("provenance");
    await originalSave(value);
  };
  const service = await createService(fixture, store, owner);

  const enabling = service.telemetry_consent_change(request(0, "allowed", "allowed"));
  await expect.poll(() => service.telemetry_consent_get().latestRequestRevision).toBe(1);
  await expect.poll(() => releaseEnable !== null).toBe(true);

  const withdrawing = service.telemetry_consent_change(request(1, "denied", "allowed"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(events).toEqual(["engine:true:true"]);
  releaseEnable!();

  expect(await enabling).toMatchObject({ outcome: "saved" });
  const final = await withdrawing;
  expect(final).toMatchObject({
    desired: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    durable: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    effective: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    outcome: "saved",
  });
  expect(events).toEqual([
    "engine:true:true",
    "provenance",
    "provenance",
    "engine:false:true",
    "provenance",
  ]);
  expect(store.writes.at(-1)?.desired).toEqual(final.durable);
  service.telemetry_consent_cleanup();
  await fixture.integration.shutdown();
});

test("service status is copied, subscriptions are bounded, and cleanup is idempotent", async () => {
  const fixture = await createEngine();
  const store = new MemoryConsentStore();
  const service = await createService(fixture, store);
  const observed: string[] = [];
  const unsubscribe = service.telemetry_consent_status_subscribe((status) => {
    observed.push(status.outcome);
  });
  const mutable = service.telemetry_consent_get() as { outcome: string };
  mutable.outcome = "saved";
  expect(service.telemetry_consent_get().outcome).toBe("none");

  const extraUnsubscribes: Array<() => void> = [];
  for (let index = 1; index < TELEMETRY_CONSENT_SERVICE_MAX_SUBSCRIBERS; index += 1) {
    extraUnsubscribes.push(service.telemetry_consent_status_subscribe(() => undefined));
  }
  expect(() => service.telemetry_consent_status_subscribe(() => undefined)).toThrow(
    /subscriber limit/,
  );
  await service.telemetry_consent_change(request(0, "allowed", "denied"));
  expect(observed).toEqual(["pending", "pending", "not-durable", "saved"]);
  unsubscribe();
  unsubscribe();
  for (const unsubscribeExtra of extraUnsubscribes) unsubscribeExtra();
  service.telemetry_consent_cleanup();
  service.telemetry_consent_cleanup();
  await expect(async () =>
    service.telemetry_consent_change(request(1, "denied", "denied")),
  ).rejects.toThrow(/cleaned up/);
  await fixture.integration.shutdown();
});

test("service preserves schema-2 body bounds, fingerprints, retry timing, and fake transport isolation", async () => {
  const transport = new FakeTransport(async (_request, index) => ({
    status: index === 0 ? 200 : 503,
    retryAfter: index === 0 ? null : "13",
  }));
  const fixture = await createEngine({ transport });
  const service = await createService(fixture, new MemoryConsentStore());
  expect(await service.telemetry_consent_change(request(0, "allowed", "allowed"))).toMatchObject({
    outcome: "saved",
  });
  expect(await fixture.integration.recordToolCallStarted()).toBe(true);
  expect(await fixture.integration.recordCrash("other", "session.run_failed")).toBe(true);
  await expect(fixture.integration.flushDue()).resolves.toMatchObject({
    status: "retained",
  });

  expect(TELEMETRY_RETRY_BASE_MS).toBe(60_000);
  expect(TELEMETRY_RETRY_MAX_MS).toBe(6 * 60 * 60 * 1000);
  expect(transport.requests.length).toBeGreaterThan(0);
  for (const transportRequest of transport.requests) {
    expect(Buffer.byteLength(transportRequest.body, "utf8")).toBeLessThanOrEqual(
      TELEMETRY_MAX_BODY_BYTES,
    );
    expect(parseBody(transportRequest).schema).toBe(TELEMETRY_SCHEMA);
    expect(transportRequest.url).toContain("telemetry.example.test");
  }
  const crash = transport.requests.find((entry) => entry.url.endsWith("/crash"));
  expect(crash).toBeDefined();
  expect(parseBody(crash!).fingerprint).toBe(
    telemetry_fingerprint("example-app", "other", "telemetry.unknown"),
  );
  expect(fixture.clock.pendingDelays().every((delay) => delay <= TELEMETRY_RETRY_MAX_MS)).toBe(
    true,
  );
  const safeStatus = JSON.stringify(service.telemetry_consent_get());
  for (const privateValue of [
    "example-app",
    "telemetry.example.test",
    "session.run_failed",
    "PRIVATE",
  ]) {
    expect(safeStatus).not.toContain(privateValue);
  }
  service.telemetry_consent_cleanup();
  await fixture.integration.shutdown();
});
