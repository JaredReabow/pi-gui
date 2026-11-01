import { expect, test } from "@playwright/test";
import {
  TELEMETRY_RETRY_MAX_MS,
  telemetry_fingerprint,
  telemetry_initialize,
  type TelemetryOwner,
  type TelemetryPersistedState,
} from "../../electron/telemetry/telemetry";
import {
  FakeClock,
  FakeRandom,
  FakeTransport,
  MemoryPersistence,
  TEST_APP,
  parseBody,
  testConfiguration,
  testDependencies,
  waitFor,
} from "./telemetry-test-fixtures";

async function makeOwner({
  consent = true,
  persistence = new MemoryPersistence(),
  transport = new FakeTransport(),
  clock = new FakeClock(),
}: {
  consent?: boolean;
  persistence?: MemoryPersistence;
  transport?: FakeTransport;
  clock?: FakeClock;
} = {}): Promise<{
  owner: TelemetryOwner;
  persistence: MemoryPersistence;
  transport: FakeTransport;
  clock: FakeClock;
}> {
  const dependencies = testDependencies({ clock, persistence, transport });
  const owner = await telemetry_initialize(testConfiguration(), dependencies);
  if (consent) {
    expect(await owner.telemetry_consent_set(true, true, 1)).toBe(true);
  }
  return { owner, persistence, transport, clock };
}

test("V01B: failed durable withdrawal returns false, closes gates, and blocks same-process resurrection", async () => {
  const persistence = new MemoryPersistence();
  const enabled = await makeOwner({ persistence });
  await enabled.owner.telemetry_usage_record("tool-call-started");
  const oldIdentity = persistence.installId();
  expect(oldIdentity).not.toBeNull();

  persistence.failClear = true;
  persistence.failSave = true;
  expect(await enabled.owner.telemetry_consent_set(false, false, 1)).toBe(false);
  expect(enabled.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: false, crash: false },
    identityPresent: false,
    queue: { total: 0 },
    revocationPending: true,
    lastOutcome: "withdrawal-not-durable",
  });
  expect(persistence.installId()).toBe(oldIdentity);
  expect(await enabled.owner.telemetry_usage_record("tool-call-started")).toBe(false);
  expect(await enabled.owner.telemetry_error_record("other", "startup.failed")).toBe(false);
  await expect(enabled.owner.telemetry_flush_due()).resolves.toMatchObject({ attempts: 0 });

  // Recreating the owner with the same still-broken persistence object cannot
  // resurrect stale disk consent because the in-process withdrawal tombstone wins.
  const blockedRestart = await makeOwner({ consent: false, persistence });
  expect(blockedRestart.owner.telemetry_consent_get()).toEqual({
    telemetry: false,
    crash: false,
  });
  expect(blockedRestart.owner.telemetry_status_get()).toMatchObject({
    identityPresent: false,
    revocationPending: true,
  });
  expect(persistence.installId()).toBe(oldIdentity);

  persistence.failClear = false;
  persistence.failSave = false;
  const recovered = await makeOwner({ consent: false, persistence });
  expect(recovered.owner.telemetry_consent_get()).toEqual({
    telemetry: false,
    crash: false,
  });
  expect(recovered.owner.telemetry_status_get()).toMatchObject({
    identityPresent: false,
    revocationPending: false,
  });
  expect(persistence.installId()).toBeNull();
});

test("V01B: replacement closed-consent state makes withdrawal durable when clear fails", async () => {
  const persistence = new MemoryPersistence();
  const enabled = await makeOwner({ persistence });
  await enabled.owner.telemetry_usage_record("tool-call-started");
  persistence.failClear = true;
  expect(await enabled.owner.telemetry_consent_set(false, false, 1)).toBe(true);
  expect(enabled.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: false, crash: false },
    identityPresent: false,
    revocationPending: false,
  });
  expect(persistence.installId()).toBeNull();
  const reopened = await makeOwner({ consent: false, persistence });
  expect(reopened.owner.telemetry_consent_get()).toEqual({
    telemetry: false,
    crash: false,
  });
  expect(reopened.owner.telemetry_status_get().identityPresent).toBe(false);
});

test("partial usage withdrawal closes usage through failed persistence and recovery while preserving crash", async () => {
  const persistence = new MemoryPersistence();
  const enabled = await makeOwner({ persistence });
  await enabled.owner.telemetry_usage_record("tool-call-started");
  await enabled.owner.telemetry_error_record("other", "startup.failed");
  const identity = persistence.installId();
  persistence.failSave = true;

  expect(await enabled.owner.telemetry_consent_set(false, true, 1)).toBe(false);
  expect(enabled.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: false, crash: true },
    identityPresent: true,
    revocationPending: true,
    pendingWithdrawal: { telemetry: true, crash: false },
  });
  expect(await enabled.owner.telemetry_usage_record("tool-call-started")).toBe(false);
  expect(await enabled.owner.telemetry_error_record("other", "startup.failed")).toBe(true);

  const restarted = await makeOwner({ consent: false, persistence });
  expect(restarted.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: false, crash: true },
    identityPresent: true,
    revocationPending: true,
    pendingWithdrawal: { telemetry: true, crash: false },
    queue: { usage: 0 },
  });
  expect(restarted.owner.telemetry_status_get().queue.crash).toBeGreaterThan(0);
  expect(await restarted.owner.telemetry_error_record("other", "startup.failed")).toBe(true);

  persistence.failSave = false;
  const recovered = await makeOwner({ consent: false, persistence });
  expect(recovered.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: false, crash: true },
    identityPresent: true,
    revocationPending: false,
    pendingWithdrawal: null,
    queue: { usage: 0 },
  });
  expect(recovered.owner.telemetry_status_get().queue.crash).toBeGreaterThan(0);
  expect(persistence.installId()).toBe(identity);
  const state = persistence.state as TelemetryPersistedState;
  expect(state.consent).toEqual({ telemetry: false, crash: true, disclosureVersion: 1 });
});

test("partial crash withdrawal closes crash through failed persistence and recovery while preserving usage", async () => {
  const persistence = new MemoryPersistence();
  const enabled = await makeOwner({ persistence });
  await enabled.owner.telemetry_usage_record("tool-call-started");
  await enabled.owner.telemetry_error_record("other", "startup.failed");
  const identity = persistence.installId();
  persistence.failSave = true;

  expect(await enabled.owner.telemetry_consent_set(true, false, 1)).toBe(false);
  expect(enabled.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: true, crash: false },
    identityPresent: true,
    revocationPending: true,
    pendingWithdrawal: { telemetry: false, crash: true },
    queue: { crash: 0, usage: 1 },
  });
  expect(await enabled.owner.telemetry_error_record("other", "startup.failed")).toBe(false);
  expect(await enabled.owner.telemetry_usage_record("tool-call-started")).toBe(true);

  const restarted = await makeOwner({ consent: false, persistence });
  expect(restarted.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: true, crash: false },
    identityPresent: true,
    revocationPending: true,
    pendingWithdrawal: { telemetry: false, crash: true },
    queue: { crash: 0, usage: 1 },
  });
  expect(await restarted.owner.telemetry_usage_record("tool-call-started")).toBe(true);

  persistence.failSave = false;
  const recovered = await makeOwner({ consent: false, persistence });
  expect(recovered.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: true, crash: false },
    identityPresent: true,
    revocationPending: false,
    pendingWithdrawal: null,
    queue: { crash: 0, usage: 1 },
  });
  expect(persistence.installId()).toBe(identity);
  const state = persistence.state as TelemetryPersistedState;
  expect(state.consent).toEqual({ telemetry: true, crash: false, disclosureVersion: 1 });
});

test("V01B: permanent usage rejection drops the record and schedules a bounded cooldown", async () => {
  const transport = new FakeTransport(async () => ({ status: 400, retryAfter: null }));
  const { owner, clock } = await makeOwner({ transport });
  await owner.telemetry_usage_record("tool-call-started");
  await expect(owner.telemetry_flush_due()).resolves.toMatchObject({
    status: "sent",
    attempts: 1,
    retained: 0,
  });
  const delays = clock.pendingDelays();
  expect(delays).toHaveLength(1);
  expect(delays[0]).toBeGreaterThanOrEqual(45_000);
  expect(delays[0]).toBeLessThanOrEqual(75_000);
  expect(delays).not.toContain(0);
  expect(owner.telemetry_status_get().retryAt! - clock.now()).toBe(delays[0]);
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(1);
  expect(owner.telemetry_status_get().queue.usage).toBe(0);
});

test("crash ACK removes only the dispatched occurrences and sends later additions", async () => {
  const responses: Array<(value: { status: number; retryAfter: null }) => void> = [];
  const transport = new FakeTransport(
    async () =>
      await new Promise<{ status: number; retryAfter: null }>((resolve) => {
        responses.push(resolve);
      }),
  );
  const { owner } = await makeOwner({ transport });
  expect(await owner.telemetry_consent_set(false, true, 1)).toBe(true);
  await owner.telemetry_error_record("other", "startup.failed");
  const flushing = owner.telemetry_flush_due();
  await waitFor(() => transport.requests.length === 1);
  expect(parseBody(transport.requests[0]!).occurrences).toBe(1);
  await owner.telemetry_error_record("other", "startup.failed");

  responses[0]!({ status: 200, retryAfter: null });
  await waitFor(() => transport.requests.length === 2);
  expect(parseBody(transport.requests[1]!).occurrences).toBe(1);
  responses[1]!({ status: 200, retryAfter: null });
  await flushing;
  expect(owner.telemetry_status_get().queue.crash).toBe(0);
});

test("crash permanent rejection retains identical captures added during the request", async () => {
  const responses: Array<(value: { status: number; retryAfter: null }) => void> = [];
  const transport = new FakeTransport(
    async () =>
      await new Promise<{ status: number; retryAfter: null }>((resolve) => {
        responses.push(resolve);
      }),
  );
  const { owner, clock } = await makeOwner({ transport });
  expect(await owner.telemetry_consent_set(false, true, 1)).toBe(true);
  await owner.telemetry_error_record("other", "startup.failed");
  const flushing = owner.telemetry_flush_due();
  await waitFor(() => transport.requests.length === 1);
  await owner.telemetry_error_record("other", "startup.failed");
  responses[0]!({ status: 400, retryAfter: null });
  await flushing;

  expect(owner.telemetry_status_get().queue.crash).toBe(1);
  const saved = JSON.parse(JSON.stringify(owner.telemetry_status_get())) as {
    retryAt: number;
  };
  expect(saved.retryAt).toBeGreaterThan(clock.now());
  const persistedQueue = await owner.telemetry_flush_due();
  expect(persistedQueue.attempts).toBe(0);

  clock.advance(saved.retryAt - clock.now());
  await waitFor(() => transport.requests.length === 2);
  expect(parseBody(transport.requests[1]!).occurrences).toBe(1);
  responses[1]!({ status: 200, retryAfter: null });
  await waitFor(() => owner.telemetry_status_get().queue.crash === 0);
});

test("crash transient failure retains the full aggregate without synthetic occurrence inflation", async () => {
  const responses: Array<(value: { status: number; retryAfter: null }) => void> = [];
  const transport = new FakeTransport(
    async () =>
      await new Promise<{ status: number; retryAfter: null }>((resolve) => {
        responses.push(resolve);
      }),
  );
  const { owner, clock } = await makeOwner({ transport });
  expect(await owner.telemetry_consent_set(false, true, 1)).toBe(true);
  await owner.telemetry_error_record("other", "startup.failed");
  const flushing = owner.telemetry_flush_due();
  await waitFor(() => transport.requests.length === 1);
  await owner.telemetry_error_record("other", "startup.failed");
  responses[0]!({ status: 503, retryAfter: null });
  await flushing;

  expect(owner.telemetry_status_get().queue.crash).toBe(1);
  const retryAt = owner.telemetry_status_get().retryAt!;
  clock.advance(retryAt - clock.now());
  await waitFor(() => transport.requests.length === 2);
  expect(parseBody(transport.requests[1]!).occurrences).toBe(2);
  responses[1]!({ status: 200, retryAfter: null });
  await waitFor(() => owner.telemetry_status_get().queue.crash === 0);
});

test("crash withdrawal while a request is active clears new same-fingerprint work", async () => {
  let resolveRequest: (value: { status: number; retryAfter: null }) => void = () => undefined;
  const transport = new FakeTransport(
    async () =>
      await new Promise<{ status: number; retryAfter: null }>((resolve) => {
        resolveRequest = resolve;
      }),
  );
  const persistence = new MemoryPersistence();
  const { owner } = await makeOwner({ persistence, transport });
  expect(await owner.telemetry_consent_set(false, true, 1)).toBe(true);
  await owner.telemetry_error_record("other", "startup.failed");
  const flushing = owner.telemetry_flush_due();
  await waitFor(() => transport.requests.length === 1);
  await owner.telemetry_error_record("other", "startup.failed");
  persistence.failSave = true;
  expect(await owner.telemetry_consent_set(true, false, 1)).toBe(false);
  expect(transport.requests[0]!.signal.aborted).toBe(true);
  resolveRequest({ status: 200, retryAfter: null });
  await expect(flushing).resolves.toMatchObject({ status: "cancelled" });
  expect(owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: true, crash: false },
    queue: { crash: 0 },
    revocationPending: true,
    pendingWithdrawal: { telemetry: false, crash: true },
  });
  expect(await owner.telemetry_error_record("other", "startup.failed")).toBe(false);
  expect(await owner.telemetry_usage_record("tool-call-started")).toBe(true);

  const restarted = await makeOwner({ consent: false, persistence });
  expect(restarted.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: true, crash: false },
    queue: { crash: 0 },
    revocationPending: true,
  });
});

test("usage withdrawal while a request is active clears queued snapshots and preserves crash", async () => {
  let resolveRequest: (value: { status: number; retryAfter: null }) => void = () => undefined;
  const transport = new FakeTransport(
    async () =>
      await new Promise<{ status: number; retryAfter: null }>((resolve) => {
        resolveRequest = resolve;
      }),
  );
  const persistence = new MemoryPersistence();
  const { owner } = await makeOwner({ persistence, transport });
  expect(await owner.telemetry_consent_set(true, false, 1)).toBe(true);
  await owner.telemetry_usage_record("tool-call-started");
  const flushing = owner.telemetry_flush_due();
  await waitFor(() => transport.requests.length === 1);
  await owner.telemetry_usage_record("tool-call-started");
  persistence.failSave = true;
  expect(await owner.telemetry_consent_set(false, true, 1)).toBe(false);
  expect(transport.requests[0]!.signal.aborted).toBe(true);
  resolveRequest({ status: 200, retryAfter: null });
  await expect(flushing).resolves.toMatchObject({ status: "cancelled" });
  expect(owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: false, crash: true },
    queue: { usage: 0 },
    revocationPending: true,
    pendingWithdrawal: { telemetry: true, crash: false },
  });
  expect(await owner.telemetry_usage_record("tool-call-started")).toBe(false);
  expect(await owner.telemetry_error_record("other", "startup.failed")).toBe(true);

  const restarted = await makeOwner({ consent: false, persistence });
  expect(restarted.owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: false, crash: true },
    queue: { usage: 0 },
    revocationPending: true,
  });
});

test("V01B: numeric and HTTP-date Retry-After values are capped", async () => {
  const numeric = await retryAfterDelay("999999999");
  expect(numeric).toBe(TELEMETRY_RETRY_MAX_MS);

  const clock = new FakeClock();
  const future = new Date(clock.now() + 10 * 24 * 60 * 60 * 1000).toUTCString();
  const dated = await retryAfterDelay(future, clock);
  expect(dated).toBe(TELEMETRY_RETRY_MAX_MS);
});

test("V01B: malformed Retry-After values fall back and jitter remains bounded", async () => {
  const malformed = await retryAfterDelay("not-a-date");
  expect(malformed).toBeGreaterThanOrEqual(45_000);
  expect(malformed).toBeLessThanOrEqual(75_000);

  const lower = await retryAfterDelay(null, new FakeClock(), 0);
  expect(lower).toBe(45_000);

  const upper = await retryAfterDelay(null, new FakeClock(), 1);
  expect(upper).toBeGreaterThanOrEqual(60_000);
  expect(upper).toBeLessThanOrEqual(75_000);

  const cappedJitter = await retryAfterDelay(null, new FakeClock(), 1, 9);
  expect(cappedJitter).toBe(TELEMETRY_RETRY_MAX_MS);
});

test("V01B: active persisted consent without a current disclosure marker fails closed", async () => {
  const persistence = new MemoryPersistence();
  persistence.state = {
    version: 1,
    consent: { telemetry: true, crash: true, disclosureVersion: null },
    appId: "example-app",
    installId: "01234567-89ab-4cde-8fab-0123456789ab",
    usage: { toolCalls: 4, browserSessions: 0, activeDays: 1 },
    lastActiveUtcDay: "2026-10-30",
    lastUsageReportAt: null,
    usageRetryAt: null,
    usageRejectionFailures: 0,
    queue: [],
    sessionActive: false,
    suspended: false,
  };
  const { owner, transport } = await makeOwner({ consent: false, persistence });
  expect(owner.telemetry_consent_get()).toEqual({ telemetry: false, crash: false });
  expect(owner.telemetry_status_get().identityPresent).toBe(false);
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(0);
});

async function retryAfterDelay(
  retryAfter: string | null,
  clock = new FakeClock(),
  fraction = 0.5,
  attemptsBefore = 0,
): Promise<number> {
  const persistence = new MemoryPersistence();
  persistence.state = crashState(clock.now(), attemptsBefore);
  const transport = new FakeTransport(async () => ({
    status: 429,
    retryAfter,
  }));
  const dependencies = testDependencies({ clock, persistence, transport });
  dependencies.random.fractionValue = fraction;
  const owner = await telemetry_initialize(testConfiguration(), dependencies);
  await owner.telemetry_flush_due();
  return owner.telemetry_status_get().retryAt! - clock.now();
}

function crashState(now: number, attemptsBefore: number): TelemetryPersistedState {
  return {
    version: 1,
    consent: { telemetry: false, crash: true, disclosureVersion: 1 },
    appId: TEST_APP.id,
    installId: "01234567-89ab-4cde-8fab-0123456789ab",
    usage: { toolCalls: 0, browserSessions: 0, activeDays: 0 },
    lastActiveUtcDay: null,
    lastUsageReportAt: null,
    usageRetryAt: null,
    usageRejectionFailures: 0,
    queue: [
      {
        id: "retry-crash",
        createdAt: now,
        attempts: attemptsBefore,
        nextAttemptAt: now,
        app: TEST_APP,
        stream: "crash",
        kind: "other",
        fingerprint: telemetry_fingerprint("example-app", "other", "startup.failed"),
        occurrences: 1,
      },
    ],
    sessionActive: false,
    suspended: false,
  };
}
