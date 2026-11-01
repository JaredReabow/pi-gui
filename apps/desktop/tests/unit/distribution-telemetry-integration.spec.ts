import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import {
  TelemetryFilePersistence,
  telemetryStatePath,
} from "../../electron/persistence/telemetry-store";
import {
  DISTRIBUTION_TELEMETRY_APP_ID,
  DISTRIBUTION_TELEMETRY_BASE_URL,
  DISTRIBUTION_TELEMETRY_STABLE_CODES,
  DistributionTelemetryIntegration,
  distributionTelemetryConfiguration,
  distributionTelemetryProductionEnabled,
  distributionTelemetryTransport,
} from "../../electron/distribution/telemetry-integration";
import {
  telemetry_initialize,
  telemetry_fingerprint,
  type TelemetryDependencies,
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
} from "./telemetry-test-fixtures";

const SESSION_REF: SessionRef = {
  workspaceId: "workspace",
  sessionId: "session",
};

async function createIntegration(
  options: {
    readonly persistence?: MemoryPersistence | TelemetryFilePersistence;
    readonly transport?: FakeTransport;
    readonly clock?: FakeClock;
  } = {},
): Promise<{
  readonly integration: DistributionTelemetryIntegration;
  readonly persistence: MemoryPersistence | TelemetryFilePersistence;
  readonly transport: FakeTransport;
  readonly clock: FakeClock;
}> {
  const clock = options.clock ?? new FakeClock();
  const persistence = options.persistence ?? new MemoryPersistence();
  const transport = options.transport ?? new FakeTransport();
  const dependencies: TelemetryDependencies = {
    clock,
    random: new FakeRandom(),
    persistence,
    transport,
    logger: new RecordingLogger(),
  };
  const owner = await telemetry_initialize(
    testConfiguration({
      app: {
        ...TEST_APP,
        id: DISTRIBUTION_TELEMETRY_APP_ID,
      },
      baseUrl: DISTRIBUTION_TELEMETRY_BASE_URL,
      stableCodes: DISTRIBUTION_TELEMETRY_STABLE_CODES,
    }),
    dependencies,
  );
  return {
    integration: new DistributionTelemetryIntegration(owner),
    persistence,
    transport,
    clock,
  };
}

function toolStarted(): SessionDriverEvent {
  return {
    type: "toolStarted",
    sessionRef: SESSION_REF,
    timestamp: "2026-10-30T02:35:00.000Z",
    toolName: "read",
    callId: "call-1",
    input: { path: "PRIVATE_FILE_PATH" },
  };
}

function runFailed(): SessionDriverEvent {
  return {
    type: "runFailed",
    sessionRef: SESSION_REF,
    timestamp: "2026-10-30T02:36:00.000Z",
    error: { message: "PRIVATE PROVIDER ERROR" },
  };
}

test("consent stays closed by default and produces no identity, queue, or request", async () => {
  const fixture = await createIntegration();
  expect(fixture.integration.configuration()).toMatchObject({
    valid: true,
    operationalEnabled: true,
    app: { id: "pi-gui" },
    baseUrl: "https://updates.reabow.co/telemetry",
  });
  expect(fixture.integration.consent()).toEqual({ telemetry: false, crash: false });
  expect(await fixture.integration.startSession()).toBe(false);
  expect(await fixture.integration.recordUserActivity()).toBe(false);
  await fixture.integration.handleSessionEvent(toolStarted());
  await fixture.integration.handleSessionEvent(runFailed());
  await expect(fixture.integration.flushDue()).resolves.toMatchObject({ attempts: 0 });
  expect(fixture.integration.status()).toMatchObject({
    identityPresent: false,
    queue: { total: 0 },
  });
  expect(fixture.transport.requests).toHaveLength(0);
});

test("consent enables aggregate usage and crash delivery to the fixed production paths", async () => {
  const fixture = await createIntegration();
  const consent = await fixture.integration.setConsent(true, true);
  expect(consent).toMatchObject({
    durable: true,
    consent: { telemetry: true, crash: true },
    sessionMarkerActive: true,
  });

  await fixture.integration.recordUserActivity();
  await fixture.integration.handleSessionEvent(toolStarted());
  await fixture.integration.handleSessionEvent(runFailed());
  await fixture.integration.flushDue();

  expect(fixture.transport.requests.map((request) => request.url)).toEqual([
    "https://updates.reabow.co/telemetry/collect",
    "https://updates.reabow.co/telemetry/crash",
  ]);
  const usageBody = parseBody(fixture.transport.requests[0]!);
  expect(usageBody).toMatchObject({
    app: { id: "pi-gui" },
    usage: { toolCalls: 1, activeDays: 1 },
  });
  const crashBody = parseBody(fixture.transport.requests[1]!);
  expect(crashBody.fingerprint).toBe(
    telemetry_fingerprint("pi-gui", "other", "session.run_failed"),
  );
  const serialized = fixture.transport.requests.map((request) => request.body).join("\n");
  expect(serialized).not.toContain("PRIVATE_FILE_PATH");
  expect(serialized).not.toContain("PRIVATE PROVIDER ERROR");
});

test("usage and crash choices remain independent through partial withdrawal and revoke", async () => {
  const fixture = await createIntegration();
  expect(await fixture.integration.setConsent(true, false)).toMatchObject({
    durable: true,
    consent: { telemetry: true, crash: false },
    sessionMarkerActive: false,
  });
  expect(await fixture.integration.recordToolCallStarted()).toBe(true);
  expect(await fixture.integration.recordCrash("other", "session.run_failed")).toBe(false);

  expect(await fixture.integration.setConsent(false, true)).toMatchObject({
    durable: true,
    consent: { telemetry: false, crash: true },
    sessionMarkerActive: true,
  });
  expect(await fixture.integration.recordToolCallStarted()).toBe(false);
  expect(await fixture.integration.recordCrash("other", "session.run_failed")).toBe(true);

  expect(await fixture.integration.setConsent(false, false)).toMatchObject({
    durable: true,
    consent: { telemetry: false, crash: false },
    sessionMarkerActive: false,
  });
  expect(fixture.integration.status()).toMatchObject({
    identityPresent: false,
    queue: { total: 0 },
    revocationPending: false,
  });
});

test("consent and installation identity persist across restart under candidate userData", async () => {
  const userData = await mkdtemp(join(tmpdir(), "pi-gui-d07-telemetry-"));
  try {
    const firstPersistence = new TelemetryFilePersistence(userData);
    const first = await createIntegration({ persistence: firstPersistence });
    expect(await first.integration.setConsent(true, false)).toMatchObject({
      durable: true,
      consent: { telemetry: true, crash: false },
    });
    await first.integration.recordToolCallStarted();
    await first.integration.shutdown();

    const second = await createIntegration({
      persistence: new TelemetryFilePersistence(userData),
    });
    expect(second.integration.consent()).toEqual({ telemetry: true, crash: false });
    expect(second.integration.status()).toMatchObject({
      identityPresent: true,
    });
    expect(second.integration.status().queue.total).toBeGreaterThanOrEqual(1);
    expect(telemetryStatePath(userData)).toBe(join(userData, "telemetry", "state.json"));
    const persisted = JSON.parse(await readFile(telemetryStatePath(userData), "utf8")) as {
      consent?: { telemetry?: boolean; crash?: boolean };
      installId?: string;
      sessionActive?: boolean;
    };
    expect(persisted.consent).toMatchObject({ telemetry: true, crash: false });
    expect(persisted.installId).toMatch(/^[0-9a-f-]{36}$/);
    expect(persisted.sessionActive).toBe(false);
    expect(await second.integration.setConsent(false, false)).toMatchObject({
      durable: true,
      consent: { telemetry: false, crash: false },
    });
    await second.integration.shutdown();
    expect(JSON.parse(await readFile(telemetryStatePath(userData), "utf8"))).toBeNull();
    expect(JSON.parse(await readFile(`${telemetryStatePath(userData)}.bak`, "utf8"))).toBeNull();

    const third = await createIntegration({
      persistence: new TelemetryFilePersistence(userData),
    });
    expect(third.integration.consent()).toEqual({ telemetry: false, crash: false });
    expect(third.integration.status()).toMatchObject({
      identityPresent: false,
      queue: { total: 0 },
    });
    await third.integration.shutdown();
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("failed durable withdrawal is reported and leaves both capture gates closed", async () => {
  const persistence = new MemoryPersistence();
  const fixture = await createIntegration({ persistence });
  expect((await fixture.integration.setConsent(true, true)).durable).toBe(true);
  expect(await fixture.integration.recordToolCallStarted()).toBe(true);

  persistence.failClear = true;
  persistence.failSave = true;
  const withdrawal = await fixture.integration.setConsent(false, false);
  expect(withdrawal).toMatchObject({
    durable: false,
    consent: { telemetry: false, crash: false },
    sessionMarkerActive: false,
  });
  expect(withdrawal.status).toMatchObject({
    revocationPending: true,
    pendingWithdrawal: { telemetry: true, crash: true },
  });
  expect(await fixture.integration.recordToolCallStarted()).toBe(false);
  expect(await fixture.integration.recordCrash("other", "session.run_failed")).toBe(false);
});

test("storage and network failures never escape into application calls", async () => {
  const persistence = new MemoryPersistence();
  const transport = new FakeTransport(async () => {
    throw new Error("offline");
  });
  const fixture = await createIntegration({ persistence, transport });
  persistence.failSave = true;
  expect(await fixture.integration.setConsent(true, true)).toMatchObject({
    durable: false,
    consent: { telemetry: true, crash: true },
  });
  await expect(fixture.integration.recordToolCallStarted()).resolves.toBe(true);
  await expect(fixture.integration.recordCrash("other", "session.run_failed")).resolves.toBe(true);
  persistence.failSave = false;
  const flush = fixture.integration.flushDue();
  await expect(flush).resolves.toMatchObject({ attempts: 1, status: "retained" });
});

test("test launches cannot retain the production fetch transport", async () => {
  let fetchCalls = 0;
  const fetchSpy = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 200 });
  }) as typeof globalThis.fetch;
  expect(distributionTelemetryProductionEnabled({})).toBe(true);
  expect(
    distributionTelemetryProductionEnabled({
      PI_APP_TEST_MODE: "background",
      PI_APP_TEST_TELEMETRY: "disabled",
    }),
  ).toBe(false);

  const clock = new FakeClock();
  const transport = distributionTelemetryTransport(false, fetchSpy);
  const owner = await telemetry_initialize(
    distributionTelemetryConfiguration("1.0.1", "darwin", "arm64"),
    {
      clock,
      random: new FakeRandom(),
      persistence: new MemoryPersistence(),
      transport,
      logger: new RecordingLogger(),
    },
  );
  const integration = new DistributionTelemetryIntegration(owner);
  await integration.setConsent(true, true);
  await integration.recordToolCallStarted();
  await expect(integration.flushDue()).resolves.toMatchObject({ status: "retained" });
  expect(fetchCalls).toBe(0);
});
