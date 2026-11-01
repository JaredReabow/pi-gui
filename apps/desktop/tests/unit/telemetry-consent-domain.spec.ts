import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  TELEMETRY_MAX_BODY_BYTES,
  TELEMETRY_SCHEMA,
  telemetry_fingerprint,
  telemetry_initialize,
  type TelemetryOwner,
} from "../../electron/telemetry/telemetry";
import {
  telemetryConsentDomain_checkpoint,
  telemetryConsentDomain_completeReconciliation,
  telemetryConsentDomain_completeRestartInspection,
  telemetryConsentDomain_initial,
  telemetryConsentDomain_observe,
  telemetryConsentDomain_recordPersistence,
  telemetryConsentDomain_restart,
  telemetryConsentDomain_submit,
} from "../../electron/distribution/telemetry-consent-domain";
import {
  FakeClock,
  FakeTransport,
  MemoryPersistence,
  parseBody,
  testConfiguration,
  testDependencies,
  waitFor,
} from "./telemetry-test-fixtures";

function request(
  expectedRequestRevision: number,
  usage: "allowed" | "denied",
  crash: "allowed" | "denied",
  disclosureVersion = 1,
) {
  return {
    schemaVersion: 1 as const,
    expectedRequestRevision,
    disclosureVersion,
    usage,
    crash,
  };
}

function persistenceResult(
  requestRevision: number,
  engineDurable: boolean,
  provenanceDurable: boolean,
) {
  return {
    schemaVersion: 1 as const,
    requestRevision,
    engineDurable,
    provenanceDurable,
  };
}

function engineObservation(
  overrides: Partial<{
    configurationValid: boolean;
    operationalEnabled: boolean;
    disclosureVersion: number | null;
    ownerConsent: { usage: boolean; crash: boolean };
    identityPresent: boolean;
    queue: { usage: number; crash: number; total: number };
    suspended: boolean;
    revocationPending: boolean;
    pendingWithdrawal: { usage: boolean; crash: boolean } | null;
    inFlight: boolean;
    lastOutcome: string | null;
  }> = {},
) {
  return {
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: false, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: null,
    ...overrides,
  };
}

function engineStatus(
  owner: TelemetryOwner,
  overrides: Partial<{
    configurationValid: boolean;
    operationalEnabled: boolean;
    disclosureVersion: number | null;
    ownerConsent: { usage: boolean; crash: boolean };
    identityPresent: boolean;
    queue: { usage: number; crash: number; total: number };
    suspended: boolean;
    revocationPending: boolean;
    pendingWithdrawal: { usage: boolean; crash: boolean } | null;
    inFlight: boolean;
    lastOutcome: string | null;
  }> = {},
) {
  const configuration = owner.telemetry_configuration_get();
  const status = owner.telemetry_status_get();
  return {
    configurationValid: configuration.valid,
    operationalEnabled: configuration.operationalEnabled,
    disclosureVersion: configuration.disclosureVersion,
    ownerConsent: {
      usage: status.consent.telemetry,
      crash: status.consent.crash,
    },
    identityPresent: status.identityPresent,
    queue: {
      usage: status.queue.usage,
      crash: status.queue.crash,
      total: status.queue.total,
    },
    suspended: status.suspended,
    revocationPending: status.revocationPending,
    pendingWithdrawal: status.pendingWithdrawal
      ? {
          usage: status.pendingWithdrawal.telemetry,
          crash: status.pendingWithdrawal.crash,
        }
      : null,
    inFlight: status.inFlight,
    lastOutcome: status.lastOutcome,
    ...overrides,
  };
}

async function createOwner(
  options: {
    persistence?: MemoryPersistence;
    transport?: FakeTransport;
    clock?: FakeClock;
  } = {},
): Promise<{
  owner: TelemetryOwner;
  persistence: MemoryPersistence;
  transport: FakeTransport;
  clock: FakeClock;
}> {
  const persistence = options.persistence ?? new MemoryPersistence();
  const transport = options.transport ?? new FakeTransport();
  const clock = options.clock ?? new FakeClock();
  const owner = await telemetry_initialize(
    testConfiguration(),
    testDependencies({ persistence, transport, clock }),
  );
  return { owner, persistence, transport, clock };
}

test("first run is independently undecided, ignores use, and does not infer denial", async () => {
  const fixture = await createOwner();
  const initial = telemetryConsentDomain_initial(engineStatus(fixture.owner));
  expect(initial).toMatchObject({
    latestRequestRevision: 0,
    desired: {
      usage: { value: "undecided", source: "absent", disclosureVersion: null },
      crash: { value: "undecided", source: "absent", disclosureVersion: null },
    },
    durable: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    effective: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    pending: null,
    outcome: "none",
    requiresRestartInspection: false,
    requiresReconciliation: false,
  });

  expect(await fixture.owner.telemetry_usage_record("user-activity")).toBe(false);
  expect(await fixture.owner.telemetry_error_record("other", "private detail")).toBe(false);
  const afterUse = telemetryConsentDomain_observe(initial, engineStatus(fixture.owner));
  expect(afterUse.desired).toEqual(initial.desired);
  expect(afterUse.effective).toEqual(initial.effective);
  expect(afterUse.engine.identityPresent).toBe(false);
  expect(afterUse.engine.queue.total).toBe(0);
  expect(fixture.transport.requests).toHaveLength(0);

  const noProvenance = telemetryConsentDomain_initial({
    ...engineStatus(fixture.owner),
    ownerConsent: { usage: true, crash: true },
  });
  expect(noProvenance.durable).toEqual(initial.durable);
  expect(noProvenance.effective).toEqual(initial.effective);
  expect(noProvenance.requiresRestartInspection).toBe(false);
  expect(noProvenance.requiresReconciliation).toBe(true);
  expect(noProvenance.outcome).toBe("reconciliation-required");

  const freshPendingWithdrawal = telemetryConsentDomain_initial(
    engineObservation({
      revocationPending: true,
      pendingWithdrawal: { usage: true, crash: false },
    }),
  );
  expect(freshPendingWithdrawal).toMatchObject({
    desired: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    durable: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    effective: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    outcome: "reconciliation-required",
    requiresRestartInspection: false,
    requiresReconciliation: true,
    engine: {
      ownerConsent: { usage: false, crash: false },
      withdrawalPending: { usage: true, crash: false },
    },
  });
});

test("partial persistence is pending, not saved, and effective gates stay closed", () => {
  const initial = telemetryConsentDomain_initial({
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: false, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: null,
  });
  const submitted = telemetryConsentDomain_submit(initial, request(0, "allowed", "denied"));
  expect(submitted.state.desired).toMatchObject({
    usage: { value: "allowed", source: "user", disclosureVersion: 1 },
    crash: { value: "denied", source: "user", disclosureVersion: 1 },
  });
  expect(submitted.state.effective).toMatchObject({
    usage: { value: "undecided" },
    crash: { value: "denied" },
  });
  expect(submitted.state.pending).toMatchObject({
    requestRevision: 1,
    state: "queued",
    outcome: "pending",
  });
  expect(() => telemetryConsentDomain_submit(initial, request(7, "allowed", "allowed"))).toThrow(
    /request is stale/,
  );

  const partial = telemetryConsentDomain_recordPersistence(
    submitted.state,
    persistenceResult(1, true, false),
  );
  expect(partial).toMatchObject({
    outcome: "not-durable",
    pending: {
      requestRevision: 1,
      state: "persistence-pending",
      outcome: "not-durable",
    },
  });
  expect(partial.durable.usage.value).toBe("undecided");
  expect(partial.durable.crash.value).toBe("undecided");
  expect(partial.effective.usage.value).toBe("undecided");
  expect(partial.effective.crash.value).toBe("denied");

  const ownerAligned = telemetryConsentDomain_observe(submitted.state, {
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: true, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: null,
  });
  const saved = telemetryConsentDomain_recordPersistence(
    ownerAligned,
    persistenceResult(1, true, true),
  );
  expect(saved).toMatchObject({ outcome: "saved", pending: null });
  expect(saved.durable).toEqual(saved.desired);
  expect(saved.effective).toMatchObject({
    usage: { value: "allowed" },
    crash: { value: "denied" },
  });
});

test("durable receipts cannot claim saved without aligned current-owner facts", () => {
  const submitted = telemetryConsentDomain_submit(
    telemetryConsentDomain_initial(engineObservation()),
    request(0, "allowed", "allowed"),
  );
  const mismatched = telemetryConsentDomain_recordPersistence(
    submitted.state,
    persistenceResult(1, true, true),
  );
  expect(mismatched).toMatchObject({
    durable: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    effective: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    pending: {
      requestRevision: 1,
      state: "reconciliation-required",
      outcome: "reconciliation-required",
    },
    outcome: "reconciliation-required",
    requiresReconciliation: true,
    engine: {
      ownerConsent: { usage: false, crash: false },
    },
  });
});

test("delayed enable completion cannot override a newer withdrawal", () => {
  const initial = telemetryConsentDomain_initial({
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: false, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: null,
  });
  const enabled = telemetryConsentDomain_submit(initial, request(0, "allowed", "allowed"));
  const ownerEnabled = telemetryConsentDomain_observe(enabled.state, {
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: true, crash: true },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: null,
  });
  const savedEnable = telemetryConsentDomain_recordPersistence(
    ownerEnabled,
    persistenceResult(1, true, true),
  );
  const withdrawing = telemetryConsentDomain_submit(savedEnable, request(1, "denied", "denied"));
  const ownerWithdrawn = telemetryConsentDomain_observe(withdrawing.state, {
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: false, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: null,
  });
  const stale = telemetryConsentDomain_recordPersistence(
    ownerWithdrawn,
    persistenceResult(1, true, true),
  );
  expect(stale).toMatchObject({
    outcome: "withdrawal-priority",
    latestRequestRevision: 2,
    desired: {
      usage: { value: "denied" },
      crash: { value: "denied" },
    },
    effective: {
      usage: { value: "denied" },
      crash: { value: "denied" },
    },
    pending: { requestRevision: 2, state: "queued" },
  });
  const withdrawn = telemetryConsentDomain_recordPersistence(
    stale,
    persistenceResult(2, true, true),
  );
  expect(withdrawn).toMatchObject({ outcome: "saved", pending: null });
  expect(withdrawn.durable).toEqual(withdrawn.desired);
  expect(withdrawn.effective).toMatchObject({
    usage: { value: "denied" },
    crash: { value: "denied" },
  });
});

test("saved allow remains durable but closes when current owner drifts off", () => {
  const submitted = telemetryConsentDomain_submit(
    telemetryConsentDomain_initial(engineObservation()),
    request(0, "allowed", "allowed"),
  );
  const enabled = telemetryConsentDomain_recordPersistence(
    telemetryConsentDomain_observe(
      submitted.state,
      engineObservation({ ownerConsent: { usage: true, crash: true } }),
    ),
    persistenceResult(1, true, true),
  );
  expect(enabled.effective).toMatchObject({
    usage: { value: "allowed" },
    crash: { value: "allowed" },
  });

  const ownerOff = telemetryConsentDomain_observe(enabled, engineObservation());
  expect(ownerOff).toMatchObject({
    durable: {
      usage: { value: "allowed" },
      crash: { value: "allowed" },
    },
    effective: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    outcome: "reconciliation-required",
    requiresRestartInspection: false,
    requiresReconciliation: true,
    engine: {
      ownerConsent: { usage: false, crash: false },
      withdrawalPending: { usage: false, crash: false },
    },
  });

  const usageWithdrawalPending = telemetryConsentDomain_observe(
    enabled,
    engineObservation({
      ownerConsent: { usage: false, crash: true },
      revocationPending: true,
      pendingWithdrawal: { usage: true, crash: false },
    }),
  );
  expect(usageWithdrawalPending.engine).toMatchObject({
    ownerConsent: { usage: false, crash: true },
    withdrawalPending: { usage: true, crash: false },
  });
  expect(usageWithdrawalPending.effective).toMatchObject({
    usage: { value: "undecided" },
    crash: { value: "allowed" },
  });
  expect(usageWithdrawalPending.requiresReconciliation).toBe(true);
  expect(usageWithdrawalPending.durable).toEqual(enabled.durable);
});

test("partial withdrawal preserves the independent crash runtime and saved choice", () => {
  const submitted = telemetryConsentDomain_submit(
    telemetryConsentDomain_initial(engineObservation()),
    request(0, "allowed", "allowed"),
  );
  const enabled = telemetryConsentDomain_recordPersistence(
    telemetryConsentDomain_observe(
      submitted.state,
      engineObservation({ ownerConsent: { usage: true, crash: true } }),
    ),
    persistenceResult(1, true, true),
  );
  const withdrawingUsage = telemetryConsentDomain_submit(enabled, request(1, "denied", "allowed"));
  const ownerPartiallyWithdrawn = telemetryConsentDomain_observe(
    withdrawingUsage.state,
    engineObservation({
      ownerConsent: { usage: false, crash: true },
      revocationPending: true,
      pendingWithdrawal: { usage: true, crash: false },
    }),
  );
  const notDurable = telemetryConsentDomain_recordPersistence(
    ownerPartiallyWithdrawn,
    persistenceResult(2, false, true),
  );
  expect(notDurable).toMatchObject({
    outcome: "not-durable",
    pending: {
      requestRevision: 2,
      state: "persistence-pending",
      outcome: "not-durable",
    },
    durable: {
      usage: { value: "allowed" },
      crash: { value: "allowed" },
    },
    effective: {
      usage: { value: "denied" },
      crash: { value: "allowed" },
    },
    requiresReconciliation: true,
    engine: {
      ownerConsent: { usage: false, crash: true },
      withdrawalPending: { usage: true, crash: false },
    },
  });
});

test("restart inspects the current owner and never accepts an old pending result", () => {
  const initial = telemetryConsentDomain_initial({
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: false, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: null,
  });
  const submitted = telemetryConsentDomain_submit(initial, request(0, "allowed", "allowed"));
  const checkpoint = telemetryConsentDomain_checkpoint(submitted.state);
  const restarted = telemetryConsentDomain_restart(checkpoint, {
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: false, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: true,
    revocationPending: true,
    pendingWithdrawal: { usage: true, crash: true },
    inFlight: false,
    lastOutcome: "withdrawal-not-durable",
  });
  expect(restarted).toMatchObject({
    outcome: "restart-inspection-required",
    requiresRestartInspection: true,
    durable: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    effective: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    pending: {
      requestRevision: 1,
      state: "restart-inspection-required",
      outcome: "restart-inspection-required",
    },
    engine: {
      suspended: true,
      revocationPending: true,
      ownerConsent: { usage: false, crash: false },
      withdrawalPending: { usage: true, crash: true },
    },
  });
  expect(() => telemetryConsentDomain_submit(restarted, request(1, "denied", "denied"))).toThrow(
    /restart inspection must complete/,
  );

  const inspected = telemetryConsentDomain_completeRestartInspection(restarted, {
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: false, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: "withdrawn",
  });
  expect(inspected).toMatchObject({
    requiresRestartInspection: false,
    outcome: "pending",
    durable: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    pending: { requestRevision: 1, state: "queued" },
  });
});

test("disclosure changes make old durable choices ineffective", () => {
  const choices = {
    usage: { value: "allowed", source: "user", disclosureVersion: 1 },
    crash: { value: "denied", source: "user", disclosureVersion: 1 },
  } as const;
  const restarted = telemetryConsentDomain_restart(
    {
      schemaVersion: 1,
      latestRequestRevision: 1,
      desired: choices,
      durable: choices,
      pending: null,
    },
    {
      configurationValid: true,
      operationalEnabled: true,
      disclosureVersion: 2,
      ownerConsent: { usage: false, crash: false },
      identityPresent: true,
      queue: { usage: 1, crash: 0, total: 1 },
      suspended: false,
      revocationPending: false,
      pendingWithdrawal: null,
      inFlight: false,
      lastOutcome: null,
    },
  );
  expect(restarted.requiresRestartInspection).toBe(true);
  expect(restarted.durable.usage.disclosureVersion).toBe(1);
  expect(restarted.effective.usage.value).toBe("undecided");
  expect(restarted.effective.crash.value).toBe("denied");
});

test("owner/provenance mismatch survives restart inspection until reconciled", () => {
  const choices = {
    usage: { value: "allowed", source: "user", disclosureVersion: 1 },
    crash: { value: "denied", source: "user", disclosureVersion: 1 },
  } as const;
  const checkpoint = {
    schemaVersion: 1 as const,
    latestRequestRevision: 1,
    desired: choices,
    durable: choices,
    pending: null,
  };
  const restarted = telemetryConsentDomain_restart(checkpoint, engineObservation());
  expect(restarted).toMatchObject({
    durable: choices,
    effective: {
      usage: { value: "undecided" },
      crash: { value: "denied" },
    },
    outcome: "restart-inspection-required",
    requiresRestartInspection: true,
    requiresReconciliation: true,
  });

  const inspected = telemetryConsentDomain_completeRestartInspection(
    restarted,
    engineObservation(),
  );
  expect(inspected).toMatchObject({
    durable: choices,
    effective: {
      usage: { value: "undecided" },
      crash: { value: "denied" },
    },
    outcome: "reconciliation-required",
    requiresRestartInspection: false,
    requiresReconciliation: true,
  });

  const reconciled = telemetryConsentDomain_completeReconciliation(
    inspected,
    engineObservation({ ownerConsent: { usage: true, crash: false } }),
  );
  expect(reconciled).toMatchObject({
    durable: choices,
    effective: {
      usage: { value: "allowed" },
      crash: { value: "denied" },
    },
    outcome: "saved",
    requiresRestartInspection: false,
    requiresReconciliation: false,
  });
});

test("invalid configuration closes effective consent without overwriting saved intent", () => {
  const submitted = telemetryConsentDomain_submit(
    telemetryConsentDomain_initial(engineObservation()),
    request(0, "allowed", "allowed"),
  );
  const saved = telemetryConsentDomain_recordPersistence(
    telemetryConsentDomain_observe(
      submitted.state,
      engineObservation({ ownerConsent: { usage: true, crash: true } }),
    ),
    persistenceResult(1, true, true),
  );
  const invalid = telemetryConsentDomain_observe(
    saved,
    engineObservation({
      configurationValid: false,
      disclosureVersion: null,
      ownerConsent: { usage: true, crash: true },
    }),
  );
  expect(invalid).toMatchObject({
    durable: {
      usage: { value: "allowed" },
      crash: { value: "allowed" },
    },
    effective: {
      usage: { value: "undecided" },
      crash: { value: "undecided" },
    },
    outcome: "reconciliation-required",
    requiresReconciliation: true,
  });
});

test("accepted engine withdrawal aborts delivery and preserves queue/generation semantics", async () => {
  let resolveRequest: (value: { status: number; retryAfter: null }) => void = () => undefined;
  const transport = new FakeTransport(
    async () =>
      await new Promise<{ status: number; retryAfter: null }>((resolve) => {
        resolveRequest = resolve;
      }),
  );
  const fixture = await createOwner({ transport });
  let state = telemetryConsentDomain_initial(engineStatus(fixture.owner));
  const enabling = telemetryConsentDomain_submit(state, request(0, "allowed", "allowed"));
  expect(await fixture.owner.telemetry_consent_set(true, true, 1)).toBe(true);
  const enabledOwner = telemetryConsentDomain_observe(enabling.state, engineStatus(fixture.owner));
  state = telemetryConsentDomain_recordPersistence(enabledOwner, persistenceResult(1, true, true));
  expect(await fixture.owner.telemetry_usage_record("tool-call-started")).toBe(true);
  expect(await fixture.owner.telemetry_error_record("other", "startup.failed")).toBe(true);
  const flushing = fixture.owner.telemetry_flush_due();
  await waitFor(() => transport.requests.length === 1);

  const withdrawing = telemetryConsentDomain_submit(state, request(1, "denied", "denied"));
  expect(await fixture.owner.telemetry_consent_set(false, false, 1)).toBe(true);
  expect(transport.requests[0]!.signal.aborted).toBe(true);
  const withdrawnOwner = telemetryConsentDomain_observe(
    withdrawing.state,
    engineStatus(fixture.owner),
  );
  const withdrawn = telemetryConsentDomain_recordPersistence(
    withdrawnOwner,
    persistenceResult(2, true, true),
  );
  const stale = telemetryConsentDomain_recordPersistence(
    withdrawn,
    persistenceResult(1, true, true),
  );
  expect(stale.outcome).toBe("withdrawal-priority");
  expect(stale.effective).toMatchObject({
    usage: { value: "denied" },
    crash: { value: "denied" },
  });
  resolveRequest({ status: 200, retryAfter: null });
  await expect(flushing).resolves.toMatchObject({ status: "cancelled" });
  expect(fixture.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: false, crash: false },
    identityPresent: false,
    queue: { total: 0 },
    revocationPending: false,
  });
});

test("accepted engine restart is inspected through its current owner", async () => {
  const persistence = new MemoryPersistence();
  const first = await createOwner({ persistence });
  let state = telemetryConsentDomain_initial(engineStatus(first.owner));
  const submitted = telemetryConsentDomain_submit(state, request(0, "allowed", "denied"));
  expect(await first.owner.telemetry_consent_set(true, false, 1)).toBe(true);
  const alignedOwner = telemetryConsentDomain_observe(submitted.state, engineStatus(first.owner));
  state = telemetryConsentDomain_recordPersistence(alignedOwner, persistenceResult(1, true, true));
  expect(await first.owner.telemetry_usage_record("tool-call-started")).toBe(true);
  const checkpoint = telemetryConsentDomain_checkpoint(state);
  first.owner.telemetry_shutdown();

  const second = await createOwner({ persistence });
  const inspected = telemetryConsentDomain_restart(checkpoint, engineStatus(second.owner));
  expect(inspected.engine.identityPresent).toBe(true);
  expect(inspected.engine.queue.total).toBeGreaterThanOrEqual(1);
  expect(inspected.requiresRestartInspection).toBe(false);
  expect(inspected.effective).toMatchObject({
    usage: { value: "allowed" },
    crash: { value: "denied" },
  });
});

test("failed durable withdrawal remains pending and restart requires inspection", async () => {
  const persistence = new MemoryPersistence();
  const first = await createOwner({ persistence });
  let state = telemetryConsentDomain_initial(engineStatus(first.owner));
  const enabling = telemetryConsentDomain_submit(state, request(0, "allowed", "allowed"));
  expect(await first.owner.telemetry_consent_set(true, true, 1)).toBe(true);
  const enabledOwner = telemetryConsentDomain_observe(enabling.state, engineStatus(first.owner));
  state = telemetryConsentDomain_recordPersistence(enabledOwner, persistenceResult(1, true, true));
  const withdrawing = telemetryConsentDomain_submit(state, request(1, "denied", "denied"));
  persistence.failClear = true;
  persistence.failSave = true;
  const durable = await first.owner.telemetry_consent_set(false, false, 1);
  expect(durable).toBe(false);
  const attemptedWithdrawal = telemetryConsentDomain_observe(
    withdrawing.state,
    engineStatus(first.owner),
  );
  state = telemetryConsentDomain_recordPersistence(
    attemptedWithdrawal,
    persistenceResult(2, durable, true),
  );
  expect(state).toMatchObject({
    outcome: "not-durable",
    pending: { requestRevision: 2, state: "persistence-pending" },
    effective: {
      usage: { value: "denied" },
      crash: { value: "denied" },
    },
  });

  const checkpoint = telemetryConsentDomain_checkpoint(state);
  const second = await createOwner({ persistence });
  const restarted = telemetryConsentDomain_restart(
    checkpoint,
    engineStatus(second.owner, {
      ...engineStatus(second.owner),
      lastOutcome: second.owner.telemetry_status_get().lastOutcome,
    }),
  );
  expect(restarted).toMatchObject({
    requiresRestartInspection: true,
    outcome: "restart-inspection-required",
    effective: {
      usage: { value: "denied" },
      crash: { value: "denied" },
    },
    engine: {
      revocationPending: true,
      ownerConsent: { usage: false, crash: false },
      withdrawalPending: { usage: true, crash: true },
    },
  });
});

test("schema-2 payload allowlist, size, fingerprint and privacy vectors remain intact", async () => {
  const fixture = await createOwner();
  const sentinels = [
    "PRIVATE exception text",
    "/Users/example/private/file.txt",
    "https://private.example/account",
    "clipboard-secret",
    "payment-token",
    "support transcript",
    "mcp payload",
  ];
  expect(await fixture.owner.telemetry_consent_set(true, true, 1)).toBe(true);
  expect(await fixture.owner.telemetry_usage_record("tool-call-started")).toBe(true);
  expect(await fixture.owner.telemetry_error_record("other", sentinels.join("|"))).toBe(true);
  await fixture.owner.telemetry_flush_due();
  expect(fixture.transport.requests).toHaveLength(2);

  for (const transportRequest of fixture.transport.requests) {
    expect(Buffer.byteLength(transportRequest.body, "utf8")).toBeLessThanOrEqual(
      TELEMETRY_MAX_BODY_BYTES,
    );
    const body = parseBody(transportRequest);
    expect(body.schema).toBe(TELEMETRY_SCHEMA);
    const keys = Object.keys(body).sort();
    if (transportRequest.url.endsWith("/collect")) {
      expect(keys).toEqual(["app", "consent", "installId", "runtime", "schema", "usage"]);
    } else {
      expect(keys).toEqual([
        "app",
        "consent",
        "fingerprint",
        "installId",
        "kind",
        "occurrences",
        "schema",
      ]);
    }
    for (const sentinel of sentinels) {
      expect(transportRequest.body).not.toContain(sentinel);
    }
  }
  expect(parseBody(fixture.transport.requests[1]!).fingerprint).toBe(
    telemetry_fingerprint("example-app", "other", "telemetry.unknown"),
  );
  expect(telemetry_fingerprint("example-app", "other", "startup.failed")).toBe(
    "6c8c8a48177ed0ffc7446319e6d860e543dce71129dae0bae92875da500f56bd",
  );

  const safeStatus = JSON.stringify(telemetryConsentDomain_initial(engineStatus(fixture.owner)));
  for (const sentinel of sentinels) {
    expect(safeStatus).not.toContain(sentinel);
  }

  const receiptPath = process.env.PI_GUI_D07_TCONS_RECEIPT_PATH;
  if (receiptPath) {
    await mkdir(path.dirname(receiptPath), { recursive: true });
    const requests = fixture.transport.requests.map((item) => ({
      transport: "in-memory-fake",
      path: new URL(item.url).pathname,
      bytes: Buffer.byteLength(item.body, "utf8"),
      sha256: createHash("sha256").update(item.body).digest("hex"),
      schema: TELEMETRY_SCHEMA,
      allowlistedKeys: Object.keys(parseBody(item)).sort(),
    }));
    await writeFile(
      receiptPath,
      `${JSON.stringify(
        {
          source: "focused-test",
          productionNetworkCalls: 0,
          transport: "in-memory-fake",
          requests,
          privacySentinelsPresent: false,
          fingerprintVectorMatched: true,
          maximumBodyBytes: TELEMETRY_MAX_BODY_BYTES,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
});

test("engine disposition is copied into bounded delivery evidence without claiming receipt", () => {
  const base = {
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: false, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: null,
  } as const;
  const state = telemetryConsentDomain_initial(base);
  expect(
    telemetryConsentDomain_observe(state, { ...base, lastOutcome: "success" }).delivery,
  ).toEqual({ state: "endpoint-accepted", receipt: "not-observed" });
  expect(
    telemetryConsentDomain_observe(state, {
      ...base,
      queue: { usage: 1, crash: 0, total: 1 },
      lastOutcome: "transport",
    }).delivery,
  ).toEqual({ state: "retained", receipt: "not-observed" });
  expect(
    telemetryConsentDomain_observe(state, {
      ...base,
      suspended: true,
      lastOutcome: "configuration",
    }).delivery,
  ).toEqual({ state: "suspended", receipt: "not-observed" });
  expect(
    telemetryConsentDomain_observe(state, {
      ...base,
      lastOutcome: "cancelled",
    }).delivery,
  ).toEqual({ state: "cancelled", receipt: "not-observed" });
  const serialized = JSON.stringify(state);
  expect(serialized).not.toContain("lastOutcome");
  expect(serialized).not.toContain("installId");
});
