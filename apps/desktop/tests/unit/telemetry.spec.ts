import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import {
  TELEMETRY_ABNORMAL_EXIT_STABLE_CODE,
  TELEMETRY_MAX_BODY_BYTES,
  TELEMETRY_MAX_CRASH_QUEUE,
  TELEMETRY_UNKNOWN_STABLE_CODE,
  telemetry_fingerprint,
  telemetry_initialize,
  telemetry_fetch_transport,
  type TelemetryConfiguration,
  type TelemetryOwner,
  type TelemetryPersistedState,
  type TelemetryTransportRequest,
} from "../../electron/telemetry/telemetry";
import {
  FakeClock,
  FakeRandom,
  FakeTransport,
  MemoryPersistence,
  RecordingLogger,
  TEST_APP,
  parseBody,
  testConfiguration,
  testDependencies,
  waitFor,
} from "./telemetry-test-fixtures";

type ContractModule = Readonly<{
  validatePing(
    body: unknown,
  ): Readonly<{ value: unknown; dropped: readonly string[] }> | Readonly<{ error: string }>;
  validateCrash(
    body: unknown,
  ): Readonly<{ value: unknown; dropped: readonly string[] }> | Readonly<{ error: string }>;
}>;

async function ownerFixture({
  operationalEnabled = true,
  consent = false,
  transport = new FakeTransport(),
  persistence = new MemoryPersistence(),
  clock = new FakeClock(),
  stableCodes,
  app,
}: {
  operationalEnabled?: boolean;
  consent?: boolean;
  transport?: FakeTransport;
  persistence?: MemoryPersistence;
  clock?: FakeClock;
  stableCodes?: readonly string[];
  app?: TelemetryConfiguration["app"];
} = {}): Promise<{
  owner: TelemetryOwner;
  transport: FakeTransport;
  persistence: MemoryPersistence;
  clock: FakeClock;
  logger: RecordingLogger;
  random: FakeRandom;
}> {
  const dependencies = testDependencies({ clock, persistence, transport });
  const owner = await telemetry_initialize(
    testConfiguration({
      operationalEnabled,
      ...(app ? { app } : {}),
      ...(stableCodes ? { stableCodes } : {}),
    }),
    dependencies,
  );
  if (consent) {
    expect(await owner.telemetry_consent_set(true, true, 1)).toBe(true);
  }
  return {
    owner,
    transport,
    persistence,
    clock,
    logger: dependencies.logger,
    random: dependencies.random,
  };
}

async function captureUsageAndCrash(owner: TelemetryOwner): Promise<void> {
  expect(await owner.telemetry_usage_record("tool-call-started")).toBe(true);
  expect(await owner.telemetry_error_record("other", "startup.failed")).toBe(true);
}

test("published fingerprint vector is stable and unknown codes map to one category", async () => {
  expect(telemetry_fingerprint("example-app", "other", "startup.failed")).toBe(
    "6c8c8a48177ed0ffc7446319e6d860e543dce71129dae0bae92875da500f56bd",
  );
  const first = await ownerFixture({ consent: true });
  const second = await ownerFixture({ consent: true });
  await first.owner.telemetry_error_record("other", "private free text");
  await second.owner.telemetry_error_record("other", "a different private value");
  await first.owner.telemetry_flush_due();
  await second.owner.telemetry_flush_due();
  const expected = telemetry_fingerprint("example-app", "other", TELEMETRY_UNKNOWN_STABLE_CODE);
  expect(parseBody(first.transport.requests[0]!).fingerprint).toBe(expected);
  expect(parseBody(second.transport.requests[0]!).fingerprint).toBe(expected);
});

test("operational and independent consent gates cover every combination", async () => {
  const cases = [
    {
      name: "all off",
      operational: false,
      usage: false,
      crash: false,
      paths: [],
    },
    {
      name: "usage only",
      operational: true,
      usage: true,
      crash: false,
      paths: ["/service/collect"],
    },
    {
      name: "crash only",
      operational: true,
      usage: false,
      crash: true,
      paths: ["/service/crash"],
    },
    {
      name: "both on",
      operational: true,
      usage: true,
      crash: true,
      paths: ["/service/collect", "/service/crash"],
    },
  ] as const;

  for (const entry of cases) {
    const { owner, transport, persistence } = await ownerFixture({
      operationalEnabled: entry.operational,
    });
    expect(await owner.telemetry_consent_set(entry.usage, entry.crash, 1)).toBe(true);
    const usageCapture = await owner.telemetry_usage_record("tool-call-started");
    const crashCapture = await owner.telemetry_error_record("other", "startup.failed");
    expect(usageCapture, entry.name).toBe(entry.usage);
    expect(crashCapture, entry.name).toBe(entry.crash);
    await owner.telemetry_flush_due();
    expect(
      transport.requests.map((request) => new URL(request.url).pathname),
      entry.name,
    ).toEqual(entry.paths);
    if (entry.paths.length === 0) {
      expect(owner.telemetry_status_get().identityPresent, entry.name).toBe(false);
      expect(persistence.installId(), entry.name).toBeNull();
    }
  }
});

test("operational off suppresses every consent combination without creating an identity", async () => {
  for (const consent of [
    { usage: false, crash: false },
    { usage: true, crash: false },
    { usage: false, crash: true },
    { usage: true, crash: true },
  ]) {
    const { owner, transport, persistence } = await ownerFixture({
      operationalEnabled: false,
    });
    expect(await owner.telemetry_consent_set(consent.usage, consent.crash, 1)).toBe(true);
    expect(await owner.telemetry_usage_record("tool-call-started")).toBe(false);
    expect(await owner.telemetry_error_record("other", "startup.failed")).toBe(false);
    await expect(owner.telemetry_flush_due()).resolves.toMatchObject({
      attempts: 0,
      retained: 0,
    });
    expect(transport.requests).toHaveLength(0);
    expect(persistence.installId()).toBeNull();
  }
});

test("withdrawal remains available after a disclosure version advance", async () => {
  const { owner, persistence } = await ownerFixture({ consent: true });
  await owner.telemetry_usage_record("tool-call-started");
  expect(await owner.telemetry_consent_set(false, false, 999)).toBe(true);
  expect(owner.telemetry_consent_get()).toEqual({ telemetry: false, crash: false });
  expect(owner.telemetry_status_get().identityPresent).toBe(false);
  expect(persistence.installId()).toBeNull();
});

test("closing the operational gate clears pending work without withdrawing consent", async () => {
  const { owner, transport, persistence } = await ownerFixture({ consent: true });
  await captureUsageAndCrash(owner);
  expect(owner.telemetry_status_get().queue.total).toBe(2);
  await owner.telemetry_operational_set(false);
  expect(owner.telemetry_consent_get()).toEqual({ telemetry: true, crash: true });
  expect(owner.telemetry_status_get().queue.total).toBe(0);
  expect(persistence.installId()).not.toBeNull();
  await expect(owner.telemetry_flush_due()).resolves.toMatchObject({
    attempts: 0,
    retained: 0,
  });
  expect(transport.requests).toHaveLength(0);
  await owner.telemetry_operational_set(true);
  expect(await owner.telemetry_error_record("other", "startup.failed")).toBe(true);
  expect(owner.telemetry_status_get().queue.crash).toBe(1);
});

test("canonical schema validates usage and crash with zero dropped fields", async () => {
  const { owner, transport } = await ownerFixture({ consent: true });
  await captureUsageAndCrash(owner);
  await owner.telemetry_flush_due();
  const usage = transport.requests.find((request) => request.url.endsWith("/collect"));
  const crash = transport.requests.find((request) => request.url.endsWith("/crash"));
  expect(usage).toBeDefined();
  expect(crash).toBeDefined();
  expect(await validateWithCanonicalContract(usage!)).toEqual({ dropped: 0 });
  expect(await validateWithCanonicalContract(crash!)).toEqual({ dropped: 0 });
});

test("consent metadata getter is exact, bounded, and content-free", async () => {
  const { owner } = await ownerFixture({ consent: true });
  expect(await owner.telemetry_usage_record("tool-call-started")).toBe(true);
  expect(await owner.telemetry_error_record("other", "PRIVATE crash detail")).toBe(true);

  const metadata = owner.telemetry_consent_metadata_get();
  expect(metadata).toEqual({
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: true, crash: true },
    identityPresent: true,
    queue: { usage: 1, crash: 1, total: 2 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: "consent-updated",
  });
  const serialized = JSON.stringify(metadata);
  for (const privateValue of [
    "example-app",
    "https://telemetry.example.test/service",
    "PRIVATE crash detail",
  ]) {
    expect(serialized).not.toContain(privateValue);
  }
});

test("canonical contract and service hashes match the authoritative evidence", async () => {
  const contractPath = process.env.PI_GUI_TELEMETRY_CONTRACT;
  const servicePath = process.env.PI_GUI_TELEMETRY_SERVICE;
  if (!contractPath || !servicePath) {
    test.skip(true, "Set canonical telemetry evidence paths for provenance verification.");
  }
  expect(await sha256(contractPath!)).toBe(
    "1e34f02a1538e75bc9c5364d7324dc80d25cc85eb195aba5bdd4fdcaa14c5290",
  );
  expect(await sha256(servicePath!)).toBe(
    "5f4aa68b11d2b821bdd41f75d16228dd5a52be8adb667f7fae03b3f9a86a39f7",
  );
});

test("privacy sentinels never enter payloads, fingerprints, queue files, or logs", async () => {
  const sentinels = [
    "PRIVATE exception text",
    "/Users/example/private/file.txt",
    "https://private.example/account",
    "clipboard-secret",
  ];
  const { owner, transport, persistence, logger } = await ownerFixture({ consent: true });
  expect(await owner.telemetry_usage_record("user-activity")).toBe(true);
  expect(await owner.telemetry_error_record("other", sentinels.join("|"))).toBe(true);
  await owner.telemetry_flush_due();
  const visible = [
    ...transport.requests.map((request) => request.body),
    persistence.serialized(),
    JSON.stringify(owner.telemetry_status_get()),
    logger.events.join("\n"),
  ].join("\n");
  for (const sentinel of sentinels) {
    expect(visible).not.toContain(sentinel);
  }
});

test("revocation aborts in-flight work and prevents stale callbacks from restoring state", async () => {
  let resolveRequest: (value: { status: number; retryAfter: null }) => void = () => undefined;
  const transport = new FakeTransport(
    async () =>
      await new Promise<{ status: number; retryAfter: null }>((resolve) => {
        resolveRequest = resolve;
      }),
  );
  const { owner } = await ownerFixture({ consent: true, transport });
  await captureUsageAndCrash(owner);
  const flushing = owner.telemetry_flush_due();
  await waitFor(() => transport.requests.length === 1);
  const signal = transport.requests[0]!.signal;
  expect(await owner.telemetry_consent_set(false, false, 1)).toBe(true);
  expect(signal.aborted).toBe(true);
  resolveRequest({ status: 200, retryAfter: null });
  const result = await flushing;
  expect(result.status).toBe("cancelled");
  expect(owner.telemetry_status_get()).toMatchObject({
    consent: { telemetry: false, crash: false },
    identityPresent: false,
    queue: { total: 0 },
  });
});

test("revocation during a multi-record flush stops later requests", async () => {
  let resolveSecond: (value: { status: number; retryAfter: null }) => void = () => undefined;
  const transport = new FakeTransport(async (_request, index) => {
    if (index === 0) return { status: 200, retryAfter: null };
    return await new Promise((resolve) => {
      resolveSecond = resolve;
    });
  });
  const { owner } = await ownerFixture({ consent: true, transport });
  await captureUsageAndCrash(owner);
  expect(await owner.telemetry_error_record("native", "startup.failed")).toBe(true);
  const flushing = owner.telemetry_flush_due();
  await waitFor(() => transport.requests.length === 2);
  await owner.telemetry_consent_set(false, false, 1);
  resolveSecond({ status: 200, retryAfter: null });
  await flushing;
  expect(transport.requests).toHaveLength(2);
  expect(owner.telemetry_status_get().queue.total).toBe(0);
});

test("identity persists across restart and reset creates a fresh identity", async () => {
  const persistence = new MemoryPersistence();
  const first = await ownerFixture({ consent: true, persistence });
  await first.owner.telemetry_usage_record("tool-call-started");
  const firstId = persistence.installId();
  expect(firstId).toMatch(/^[0-9a-f-]{36}$/);

  const reopened = await ownerFixture({ consent: false, persistence });
  expect(reopened.owner.telemetry_status_get().identityPresent).toBe(true);
  expect(persistence.installId()).toBe(firstId);
  await reopened.owner.telemetry_identity_reset();
  expect(persistence.installId()).toBeNull();
  reopened.random.uuids[0] = "41234567-89ab-4cde-8fab-0123456789ab";
  await reopened.owner.telemetry_usage_record("tool-call-started");
  expect(persistence.installId()).not.toBe(firstId);
});

test("identity survives an app-version upgrade while queued metadata uses the new version", async () => {
  const persistence = new MemoryPersistence();
  const first = await ownerFixture({ consent: true, persistence });
  await first.owner.telemetry_usage_record("tool-call-started");
  const firstId = persistence.installId();

  const upgraded = await ownerFixture({
    persistence,
    app: { ...TEST_APP, version: "1.1.0" },
  });
  expect(upgraded.owner.telemetry_status_get().identityPresent).toBe(true);
  expect(persistence.installId()).toBe(firstId);
  await upgraded.owner.telemetry_usage_record("tool-call-started");
  const state = JSON.parse(persistence.serialized()) as TelemetryPersistedState;
  const usage = state.queue.find((record) => record.stream === "usage");
  expect(usage?.stream === "usage" ? usage.app.version : null).toBe("1.1.0");
});

test("a changed app identity never reuses the previous app's installation identity", async () => {
  const persistence = new MemoryPersistence();
  const first = await ownerFixture({ consent: true, persistence });
  await first.owner.telemetry_usage_record("tool-call-started");
  const firstId = persistence.installId();
  const changed = await ownerFixture({
    persistence,
    app: { ...TEST_APP, id: "different-example-app" },
  });
  expect(changed.owner.telemetry_status_get().identityPresent).toBe(false);
  expect(persistence.installId()).not.toBe(firstId);
});

test("usage snapshots coalesce while fingerprints aggregate in a bounded queue", async () => {
  const stableCodes = Array.from({ length: 40 }, (_, index) => `error.category_${index}`);
  const { owner, persistence } = await ownerFixture({
    consent: true,
    stableCodes,
  });
  for (let index = 0; index < 12; index += 1) {
    expect(await owner.telemetry_usage_record("tool-call-started")).toBe(true);
  }
  for (const code of stableCodes) {
    expect(await owner.telemetry_error_record("other", code)).toBe(true);
    expect(await owner.telemetry_error_record("other", code)).toBe(true);
  }
  const status = owner.telemetry_status_get();
  expect(status.queue).toMatchObject({
    usage: 1,
    crash: TELEMETRY_MAX_CRASH_QUEUE,
    total: TELEMETRY_MAX_CRASH_QUEUE + 1,
  });
  const state = JSON.parse(persistence.serialized()) as TelemetryPersistedState;
  const usage = state.queue.find((record) => record.stream === "usage");
  expect(usage?.stream === "usage" ? usage.usage.toolCalls : null).toBe(12);
  const repeated = state.queue.find(
    (record) =>
      record.stream === "crash" &&
      record.fingerprint === telemetry_fingerprint("example-app", "other", "error.category_39"),
  );
  expect(repeated?.stream === "crash" ? repeated.occurrences : null).toBe(2);
});

test("restart pruning drops expired crash records before scheduling delivery", async () => {
  const persistence = new MemoryPersistence();
  persistence.state = {
    version: 1,
    consent: { telemetry: false, crash: true, disclosureVersion: 1 },
    appId: "example-app",
    installId: "01234567-89ab-4cde-8fab-0123456789ab",
    usage: { toolCalls: 0, browserSessions: 0, activeDays: 0 },
    lastActiveUtcDay: null,
    lastUsageReportAt: null,
    usageRetryAt: null,
    usageRejectionFailures: 0,
    queue: [
      {
        id: "expired-crash",
        createdAt: Date.parse("2026-09-01T00:00:00.000Z"),
        attempts: 0,
        nextAttemptAt: Date.parse("2026-09-01T00:00:00.000Z"),
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
  const { owner, transport } = await ownerFixture({ persistence });
  expect(owner.telemetry_status_get().queue.crash).toBe(0);
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(0);
});

test("storage failures never reject capture or mutate the caller's application", async () => {
  const persistence = new MemoryPersistence();
  persistence.failSave = true;
  const { owner } = await ownerFixture({ persistence });
  await expect(owner.telemetry_consent_set(true, true, 1)).resolves.toBe(false);
  expect(owner.telemetry_consent_get()).toEqual({ telemetry: true, crash: true });
  await expect(owner.telemetry_usage_record("tool-call-started")).resolves.toBe(true);
  await expect(owner.telemetry_error_record("other", "startup.failed")).resolves.toBe(true);
  await expect(owner.telemetry_flush_due()).resolves.toMatchObject({ attempts: 2 });
  expect(owner.telemetry_status_get().queue.total).toBe(0);
});

test("storage load failure leaves a valid owner usable with default consent", async () => {
  const persistence = new MemoryPersistence();
  persistence.failLoad = true;
  const { owner } = await ownerFixture({ persistence });
  expect(owner.telemetry_configuration_get().valid).toBe(true);
  expect(owner.telemetry_consent_get()).toEqual({ telemetry: false, crash: false });
  expect(owner.telemetry_status_get().identityPresent).toBe(false);
  await expect(owner.telemetry_flush_due()).resolves.toMatchObject({ attempts: 0 });
});

test("invalid identity is inert and never generates an identity or request", async () => {
  const dependencies = testDependencies();
  const owner = await telemetry_initialize(
    testConfiguration({ app: { ...TEST_APP, version: "v1.0.0+build" } }),
    dependencies,
  );
  expect(owner.telemetry_configuration_get()).toMatchObject({
    valid: false,
    issue: "invalid-app-version",
  });
  expect(await owner.telemetry_consent_set(true, true, 1)).toBe(false);
  expect(await owner.telemetry_usage_record("tool-call-started")).toBe(false);
  expect(owner.telemetry_status_get().identityPresent).toBe(false);
  expect(dependencies.transport.requests).toHaveLength(0);
});

test("counter boundaries saturate at the canonical maxima", async () => {
  const persistence = new MemoryPersistence();
  persistence.state = {
    version: 1,
    consent: { telemetry: true, crash: true, disclosureVersion: 1 },
    appId: "example-app",
    installId: "01234567-89ab-4cde-8fab-0123456789ab",
    usage: {
      toolCalls: 1_000_000_000,
      browserSessions: 0,
      activeDays: 3_650,
    },
    lastActiveUtcDay: "2026-10-29",
    lastUsageReportAt: null,
    usageRetryAt: null,
    usageRejectionFailures: 0,
    queue: [
      {
        id: "maximum-occurrences",
        createdAt: Date.parse("2026-10-30T02:00:00.000Z"),
        attempts: 0,
        nextAttemptAt: Date.parse("2026-10-30T02:00:00.000Z"),
        app: TEST_APP,
        stream: "crash",
        kind: "other",
        fingerprint: telemetry_fingerprint("example-app", "other", "startup.failed"),
        occurrences: 1_000_000,
      },
    ],
    sessionActive: false,
    suspended: false,
  };
  const { owner, transport } = await ownerFixture({ persistence });
  expect(await owner.telemetry_usage_record("tool-call-started")).toBe(true);
  expect(await owner.telemetry_usage_record("user-activity")).toBe(true);
  expect(await owner.telemetry_error_record("other", "startup.failed")).toBe(true);
  const state = JSON.parse(persistence.serialized()) as TelemetryPersistedState;
  expect(state.usage).toEqual({
    toolCalls: 1_000_000_000,
    browserSessions: 0,
    activeDays: 3_650,
  });
  const crash = state.queue.find((record) => record.stream === "crash");
  expect(crash?.stream === "crash" ? crash.occurrences : null).toBe(1_000_000);
  await owner.telemetry_flush_due();
  expect(transport.requests).not.toHaveLength(0);
  for (const request of transport.requests) {
    expect(Buffer.byteLength(request.body, "utf8")).toBeLessThanOrEqual(TELEMETRY_MAX_BODY_BYTES);
  }
});

test("HTTP success and ordinary client rejection have distinct queue behavior", async () => {
  for (const entry of [
    { status: 204, expectedQueue: 0 },
    { status: 400, expectedQueue: 0 },
    { status: 413, expectedQueue: 0 },
  ]) {
    const transport = new FakeTransport(async () => ({
      status: entry.status,
      retryAfter: null,
    }));
    const { owner } = await ownerFixture({ consent: true, transport });
    await owner.telemetry_error_record("other", "startup.failed");
    await owner.telemetry_flush_due();
    expect(owner.telemetry_status_get().queue.crash).toBe(entry.expectedQueue);
  }
});

test("authentication, redirects and ordinary 4xx outcomes are separated", async () => {
  for (const entry of [
    { status: 401, suspended: true, retained: 1 },
    { status: 403, suspended: true, retained: 1 },
    { status: 302, suspended: true, retained: 1 },
    { status: 422, suspended: false, retained: 0 },
  ]) {
    const transport = new FakeTransport(async () => ({
      status: entry.status,
      retryAfter: null,
    }));
    const { owner } = await ownerFixture({ consent: true, transport });
    await owner.telemetry_error_record("other", "startup.failed");
    await owner.telemetry_flush_due();
    expect(owner.telemetry_status_get().suspended).toBe(entry.suspended);
    expect(owner.telemetry_status_get().queue.crash).toBe(entry.retained);
  }
});

test("rate limits and transient failures retain records and honor bounded retry timing", async () => {
  const outcomes = [
    { status: 429, retryAfter: "120", minimumDelay: 120_000 },
    { status: 429, retryAfter: "invalid", minimumDelay: 60_000 },
    { status: 500, retryAfter: null, minimumDelay: 60_000 },
    { status: 503, retryAfter: "240", minimumDelay: 240_000 },
  ];
  for (const entry of outcomes) {
    const transport = new FakeTransport(async () => ({
      status: entry.status,
      retryAfter: entry.retryAfter,
    }));
    const { owner, clock } = await ownerFixture({ consent: true, transport });
    await owner.telemetry_error_record("other", "startup.failed");
    await owner.telemetry_flush_due();
    const status = owner.telemetry_status_get();
    expect(status.queue.crash).toBe(1);
    expect(status.retryAt).not.toBeNull();
    expect(status.retryAt! - clock.now()).toBeGreaterThanOrEqual(entry.minimumDelay);
  }
});

test("offline, TLS-like and timeout failures retain work without tight retries", async () => {
  for (const failure of [
    new TypeError("offline"),
    new Error("TLS certificate validation failed"),
  ]) {
    const transport = new FakeTransport(async () => {
      throw failure;
    });
    const { owner, clock } = await ownerFixture({ consent: true, transport });
    await owner.telemetry_error_record("other", "startup.failed");
    expect((await owner.telemetry_flush_due()).attempts).toBe(1);
    expect(owner.telemetry_status_get().retryAt! - clock.now()).toBeGreaterThanOrEqual(45_000);
  }

  const timeoutTransport = new FakeTransport(async () => await new Promise(() => undefined));
  const timeoutFixture = await ownerFixture({ consent: true, transport: timeoutTransport });
  await timeoutFixture.owner.telemetry_error_record("other", "startup.failed");
  const flushing = timeoutFixture.owner.telemetry_flush_due();
  await waitFor(() => timeoutTransport.requests.length === 1);
  timeoutFixture.clock.advance(10_000);
  expect((await flushing).status).toBe("retained");
  expect(timeoutTransport.requests[0]!.signal.aborted).toBe(true);
});

test("shutdown and concurrent flush calls cancel cleanly without duplicate workers", async () => {
  const transport = new FakeTransport(async () => await new Promise(() => undefined));
  const { owner } = await ownerFixture({ consent: true, transport });
  await owner.telemetry_error_record("other", "startup.failed");
  const first = owner.telemetry_flush_due();
  await waitFor(() => transport.requests.length === 1);
  const second = owner.telemetry_flush_due();
  owner.telemetry_shutdown();
  expect(await first).toMatchObject({ status: "cancelled" });
  expect(await second).toMatchObject({ status: "cancelled" });
  expect(transport.requests).toHaveLength(1);
});

test("fetch transport disables redirects, credentials and cookies", async () => {
  let options: RequestInit | undefined;
  const transport = telemetry_fetch_transport(async (_input, init) => {
    options = init;
    return new Response(null, { status: 302, headers: { "Retry-After": "60" } });
  });
  const response = await transport.send({
    url: "https://telemetry.example.test/service/collect",
    body: "{}",
    headers: { "Content-Type": "application/json" },
    signal: new AbortController().signal,
  });
  expect(response).toEqual({ status: 302, retryAfter: "60" });
  expect(options).toMatchObject({
    method: "POST",
    redirect: "manual",
    credentials: "omit",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  expect(options?.headers).not.toHaveProperty("Authorization");
});

test("normal session end clears the marker while an uncleared marker is reported only with crash consent", async () => {
  const persistence = new MemoryPersistence();
  const first = await ownerFixture({ consent: true, persistence });
  expect(await first.owner.telemetry_session_start()).toBe(true);
  await first.owner.telemetry_session_end();
  const stateAfterNormalExit = JSON.parse(persistence.serialized()) as TelemetryPersistedState;
  expect(stateAfterNormalExit.sessionActive).toBe(false);

  const abnormalState: TelemetryPersistedState = {
    ...stateAfterNormalExit,
    sessionActive: true,
  };
  persistence.state = abnormalState;
  const reopened = await ownerFixture({ consent: false, persistence });
  expect(reopened.owner.telemetry_consent_get().crash).toBe(true);
  expect(reopened.owner.telemetry_status_get().queue.crash).toBe(1);
  const saved = JSON.parse(persistence.serialized()) as TelemetryPersistedState;
  const record = saved.queue.find((entry) => entry.stream === "crash");
  expect(record?.stream === "crash" ? record.fingerprint : null).toBe(
    telemetry_fingerprint("example-app", "other", TELEMETRY_ABNORMAL_EXIT_STABLE_CODE),
  );
});

test("an operational-off restart acknowledges an abnormal marker without reporting it", async () => {
  const persistence = new MemoryPersistence();
  persistence.state = {
    version: 1,
    consent: { telemetry: false, crash: true, disclosureVersion: 1 },
    appId: "example-app",
    installId: "01234567-89ab-4cde-8fab-0123456789ab",
    usage: { toolCalls: 0, browserSessions: 0, activeDays: 0 },
    lastActiveUtcDay: null,
    lastUsageReportAt: null,
    usageRetryAt: null,
    usageRejectionFailures: 0,
    queue: [],
    sessionActive: true,
    suspended: false,
  };
  const { owner, transport } = await ownerFixture({
    operationalEnabled: false,
    persistence,
  });
  expect(owner.telemetry_status_get().queue.crash).toBe(0);
  expect(transport.requests).toHaveLength(0);
  const saved = JSON.parse(persistence.serialized()) as TelemetryPersistedState;
  expect(saved.sessionActive).toBe(false);
});

test("repeated flushes respect the 24-hour successful usage schedule", async () => {
  const { owner, transport, clock } = await ownerFixture({ consent: true });
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(1);
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(1);
  clock.advance(24 * 60 * 60 * 1000 - 1);
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(1);
  clock.advance(1);
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(2);
});

test("activity after a successful ping updates counters without bypassing its schedule", async () => {
  const { owner, transport, persistence, clock } = await ownerFixture({ consent: true });
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(1);
  await owner.telemetry_usage_record("tool-call-started");
  await owner.telemetry_usage_record("user-activity");
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(1);
  const beforeDue = JSON.parse(persistence.serialized()) as TelemetryPersistedState;
  expect(beforeDue.usage).toEqual({
    toolCalls: 1,
    browserSessions: 0,
    activeDays: 1,
  });
  clock.advance(24 * 60 * 60 * 1000);
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(2);
});

test("a backward clock change cannot trigger a rapid duplicate usage ping", async () => {
  const { owner, transport, clock } = await ownerFixture({ consent: true });
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(1);
  clock.advance(24 * 60 * 60 * 1000);
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(2);
  clock.set(clock.now() - 60 * 60 * 1000);
  await owner.telemetry_usage_record("tool-call-started");
  await owner.telemetry_flush_due();
  expect(transport.requests).toHaveLength(2);
});

async function validateWithCanonicalContract(
  request: TelemetryTransportRequest,
): Promise<{ dropped: number }> {
  const contractPath = process.env.PI_GUI_TELEMETRY_CONTRACT;
  const body = parseBody(request);
  if (!contractPath) {
    const allowed = request.url.endsWith("/collect")
      ? ["schema", "installId", "app", "runtime", "usage", "consent"]
      : ["schema", "installId", "app", "kind", "fingerprint", "occurrences", "consent"];
    expect(Object.keys(body).sort()).toEqual([...allowed].sort());
    expect(body.schema).toBe(2);
    return { dropped: 0 };
  }
  const contract = (await import(pathToFileURL(contractPath).href)) as ContractModule;
  const result = request.url.endsWith("/collect")
    ? contract.validatePing(body)
    : contract.validateCrash(body);
  expect("error" in result ? result.error : null).toBeNull();
  return { dropped: "error" in result ? -1 : result.dropped.length };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
