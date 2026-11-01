import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  telemetryConsentIpc_decodeEmpty,
  telemetryConsentIpc_decodeStatus,
  telemetryConsentIpc_decodeUpdate,
  desktopIpc,
} from "../../contracts/ipc";
import { telemetryConsentDomain_initial } from "../../electron/distribution/telemetry-consent-domain";
import {
  DistributionTelemetryIntegration,
  DISTRIBUTION_TELEMETRY_STABLE_CODES,
} from "../../electron/distribution/telemetry-integration";
import {
  telemetryConsentService_initialize,
  type TelemetryConsentService,
} from "../../electron/distribution/telemetry-consent-service";
import type { TelemetryConsentCheckpoint } from "../../contracts/telemetry-consent";
import type { TelemetryConsentStore } from "../../electron/persistence/telemetry-consent-store";
import { telemetry_initialize, type TelemetryOwner } from "../../electron/telemetry/telemetry";
import {
  FakeClock,
  FakeRandom,
  FakeTransport,
  MemoryPersistence,
  RecordingLogger,
  TEST_APP,
  testConfiguration,
} from "./telemetry-test-fixtures";

const repositoryRoot = path.resolve(__dirname, "../../../..");

class MemoryConsentStore implements TelemetryConsentStore {
  value: TelemetryConsentCheckpoint | null = null;

  async load(): Promise<TelemetryConsentCheckpoint | null> {
    return this.value === null ? null : structuredClone(this.value);
  }

  async save(value: unknown): Promise<void> {
    this.value = structuredClone(value) as TelemetryConsentCheckpoint;
  }
}

function engineObservation() {
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
  };
}

function update(
  expectedRequestRevision: number,
  usage: "allowed" | "denied",
  crash: "allowed" | "denied",
) {
  return {
    schemaVersion: 1,
    expectedRequestRevision,
    disclosureVersion: 1,
    usage,
    crash,
  };
}

async function createIntegration(): Promise<{
  readonly integration: DistributionTelemetryIntegration;
  readonly owner: TelemetryOwner;
  readonly transport: FakeTransport;
}> {
  const transport = new FakeTransport();
  const owner = await telemetry_initialize(
    testConfiguration({
      app: { ...TEST_APP, id: "pi-gui" },
      stableCodes: DISTRIBUTION_TELEMETRY_STABLE_CODES,
    }),
    {
      clock: new FakeClock(),
      random: new FakeRandom(),
      persistence: new MemoryPersistence(),
      transport,
      logger: new RecordingLogger(),
    },
  );
  return {
    integration: new DistributionTelemetryIntegration(owner),
    owner,
    transport,
  };
}

test("telemetry IPC codecs accept exact updates and reject every widened shape", () => {
  const valid = update(0, "allowed", "denied");
  expect(telemetryConsentIpc_decodeUpdate(valid)).toEqual(valid);
  expect(() => telemetryConsentIpc_decodeUpdate({ ...valid, userId: "private" })).toThrow(
    /unsupported shape/,
  );
  expect(() => telemetryConsentIpc_decodeUpdate({ ...valid, schemaVersion: 2 })).toThrow(
    /version is unsupported/,
  );
  expect(() => telemetryConsentIpc_decodeUpdate({ ...valid, usage: "maybe" })).toThrow(
    /usage choice is unsupported/,
  );

  let getterReads = 0;
  const accessor = { ...valid };
  Object.defineProperty(accessor, "usage", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "allowed";
    },
  });
  expect(() => telemetryConsentIpc_decodeUpdate(accessor)).toThrow(/data property/);
  expect(getterReads).toBe(0);

  const oversized = {
    ...valid,
    ...Object.fromEntries(
      Array.from({ length: 40 }, (_entry, index) => [`extra${index}`, "x".repeat(256)]),
    ),
  };
  expect(() => telemetryConsentIpc_decodeUpdate(oversized)).toThrow(
    /field limit|unsupported shape/,
  );
  expect(telemetryConsentIpc_decodeEmpty(undefined)).toBeUndefined();
  expect(() => telemetryConsentIpc_decodeEmpty(null)).toThrow(/must not include a payload/);
});

test("telemetry IPC status exposes only bounded consent facts", () => {
  const status = telemetryConsentDomain_initial(engineObservation());
  const decoded = telemetryConsentIpc_decodeStatus(status);
  expect(decoded).toEqual(status);
  expect(Object.keys(decoded).sort()).toEqual([
    "delivery",
    "desired",
    "durable",
    "effective",
    "engine",
    "latestRequestRevision",
    "outcome",
    "pending",
    "requiresReconciliation",
    "requiresRestartInspection",
    "schemaVersion",
  ]);
  const serialized = JSON.stringify(decoded);
  for (const forbidden of [
    "installId",
    "appId",
    "baseUrl",
    "queueRecords",
    "fingerprint",
    "filePath",
    "error",
    "content",
    "credential",
    "payment",
    "support",
    "mcp",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(8_192);
  expect(() => telemetryConsentIpc_decodeStatus({ ...status, appId: "private" })).toThrow(
    /unsupported shape/,
  );
  expect(() => telemetryConsentIpc_decodeStatus({ ...status, queueRecords: [] })).toThrow(
    /unsupported shape/,
  );
});

test("integration delivery gate uses the durable service projection", async () => {
  const fixture = await createIntegration();
  const service = await telemetryConsentService_initialize(
    fixture.integration,
    new MemoryConsentStore(),
  );
  fixture.integration.setConsentStatusSource(() => service.telemetry_consent_get());

  expect(await fixture.integration.recordUserActivity()).toBe(false);
  expect(await fixture.integration.recordToolCallStarted()).toBe(false);
  expect(await fixture.integration.recordCrash("other", "session.run_failed")).toBe(false);
  await expect(fixture.integration.flushDue()).resolves.toEqual({
    status: "idle",
    attempts: 0,
    acknowledged: 0,
    retained: 0,
  });
  expect(fixture.transport.requests).toHaveLength(0);

  await expect(
    service.telemetry_consent_change(update(0, "allowed", "allowed")),
  ).resolves.toMatchObject({ outcome: "saved" });
  expect(await fixture.integration.recordUserActivity()).toBe(true);
  expect(await fixture.integration.recordCrash("other", "session.run_failed")).toBe(true);
  await fixture.integration.flushDue();
  expect(fixture.transport.requests).toHaveLength(2);
  service.telemetry_consent_cleanup();
  await fixture.integration.shutdown();
});

test("Main composes the consent gate before session and flush while preserving narrow IPC", async () => {
  const [mainSource, ipcSource, preloadSource] = await Promise.all([
    readFile(path.join(repositoryRoot, "apps/desktop/electron/main.ts"), "utf8"),
    readFile(
      path.join(repositoryRoot, "apps/desktop/electron/ipc/register-desktop-ipc.ts"),
      "utf8",
    ),
    readFile(path.join(repositoryRoot, "apps/desktop/electron/preload.ts"), "utf8"),
  ]);
  const composition = mainSource.indexOf(
    "telemetryConsentService = await composeTelemetryConsentService",
  );
  const startSession = mainSource.indexOf("await telemetry.startSession()");
  const flush = mainSource.indexOf("void telemetry.flushDue()");
  expect(composition).toBeGreaterThan(-1);
  expect(startSession).toBeGreaterThan(composition);
  expect(flush).toBeGreaterThan(startSession);
  expect(mainSource).toContain("new TelemetryConsentFileStore(userDataDir)");
  expect(mainSource).toContain(
    "integration.setConsentStatusSource(() => service.telemetry_consent_get())",
  );
  expect(mainSource).toContain("telemetryConsentIpc_decodeStatus(status)");
  expect(mainSource).toContain(
    "window.webContents.send(desktopIpc.telemetryConsentChanged, safeStatus)",
  );

  expect(ipcSource).toContain(
    "handleMainFrame(desktopIpc.getTelemetryConsentStatus, telemetryConsentIpc_decodeEmpty",
  );
  expect(ipcSource).toContain(
    "desktopIpc.setTelemetryConsent,\n    telemetryConsentIpc_decodeUpdate",
  );
  expect(preloadSource).toContain("getTelemetryConsentStatus:");
  expect(preloadSource).toContain("setTelemetryConsent:");
  expect(preloadSource).toContain("onTelemetryConsentChanged:");
  expect(preloadSource).toContain("subscribeIpc<unknown>(desktopIpc.telemetryConsentChanged");
  expect(preloadSource).not.toContain("ipcRenderer:");
  expect(desktopIpc.telemetryConsentChanged).toBe("pi-gui:telemetry-consent-changed");
});
