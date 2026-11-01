import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type {
  TelemetryConsentRequest,
  TelemetryConsentStatusSnapshot,
} from "../../contracts/telemetry-consent";
import { distributionTelemetryConfiguration } from "../../electron/distribution/telemetry-integration";
import { TelemetryFilePersistence } from "../../electron/persistence/telemetry-store";
import { telemetry_initialize } from "../../electron/telemetry/telemetry";
import { launchDesktop, makeUserDataDir } from "../helpers/electron-app";
import {
  FakeClock,
  FakeRandom,
  FakeTransport,
  RecordingLogger,
} from "../unit/telemetry-test-fixtures";

function update(
  expectedRequestRevision: number,
  usage: "allowed" | "denied",
  crash: "allowed" | "denied",
): TelemetryConsentRequest {
  return {
    schemaVersion: 1,
    expectedRequestRevision,
    disclosureVersion: 1,
    usage,
    crash,
  };
}

test("fresh-profile bridge is default-off, rejects malformed and foreign-frame requests, and cleans subscriptions", async () => {
  const userDataDir = await makeUserDataDir("pi-gui-d07-telemetry-bridge-");
  const harness = await launchDesktop(userDataDir, {
    testMode: "background",
    scrubProviderEnv: true,
    envOverrides: { PI_APP_TEST_TELEMETRY_BRIDGE: "1" },
  });
  try {
    const page = await harness.firstWindow();
    const identity = await harness.inspectIdentity();
    expect(identity.telemetry).toEqual({
      doNotTrack: "1",
      otelSdkDisabled: "true",
      testTransport: "disabled",
    });
    expect(await page.evaluate(() => "ipcRenderer" in window || "require" in window)).toBe(false);
    const initial = await page.evaluate(
      () => window.piApp!.getTelemetryConsentStatus() as Promise<TelemetryConsentStatusSnapshot>,
    );
    expect(initial).toMatchObject({
      latestRequestRevision: 0,
      desired: {
        usage: { value: "undecided", source: "absent" },
        crash: { value: "undecided", source: "absent" },
      },
      effective: {
        usage: { value: "undecided" },
        crash: { value: "undecided" },
      },
      engine: {
        configurationValid: true,
        operationalEnabled: true,
        disclosureVersion: 1,
        identityPresent: false,
        queue: { usage: 0, crash: 0, total: 0 },
      },
      delivery: { receipt: "not-observed" },
    });

    const malformedError = await page.evaluate(async () => {
      try {
        await window.piApp!.setTelemetryConsent({
          schemaVersion: 1,
          expectedRequestRevision: 0,
          disclosureVersion: 1,
          usage: "allowed",
          crash: "denied",
          extra: "private",
        } as never);
        return "";
      } catch (error) {
        return String(error);
      }
    });
    expect(malformedError).toMatch(/unsupported shape/i);

    const foreignFrameResult = await page.evaluate(async () => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.srcdoc = "<!doctype html><html><body>foreign frame</body></html>";
      document.body.append(iframe);
      await new Promise<void>((resolve) =>
        iframe.addEventListener("load", () => resolve(), { once: true }),
      );
      const foreignApp = (iframe.contentWindow as (Window & { piApp?: Window["piApp"] }) | null)
        ?.piApp;
      if (!foreignApp) return "api-unavailable";
      try {
        await foreignApp.getTelemetryConsentStatus();
        return "accepted";
      } catch (error) {
        return String(error);
      }
    });
    expect(foreignFrameResult).toContain("must originate from the window's main frame");

    await page.evaluate(() => {
      const testWindow = window as Window & { __telemetryConsentEvents?: number };
      testWindow.__telemetryConsentEvents = 0;
      testWindow.__telemetryConsentUnsubscribe = window.piApp!.onTelemetryConsentChanged(() => {
        testWindow.__telemetryConsentEvents = (testWindow.__telemetryConsentEvents ?? 0) + 1;
      });
    });

    const duplicateResults = await page.evaluate(
      async (payload) => {
        const requests = [
          window.piApp!.setTelemetryConsent(payload),
          window.piApp!.setTelemetryConsent(payload),
        ];
        return Promise.allSettled(requests).then((results) =>
          results.map((result) => result.status),
        );
      },
      update(0, "allowed", "denied"),
    );
    expect(duplicateResults.sort()).toEqual(["fulfilled", "rejected"]);
    const afterDuplicate = await page.evaluate(
      () => window.piApp!.getTelemetryConsentStatus() as Promise<TelemetryConsentStatusSnapshot>,
    );
    expect(afterDuplicate).toMatchObject({
      latestRequestRevision: 1,
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
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __telemetryConsentEvents?: number }).__telemetryConsentEvents ??
            0,
        ),
      )
      .toBeGreaterThan(0);
    const eventsBeforeUnsubscribe = await page.evaluate(
      () =>
        (window as Window & { __telemetryConsentEvents?: number }).__telemetryConsentEvents ?? 0,
    );
    await page.evaluate(() =>
      (
        window as Window & { __telemetryConsentUnsubscribe?: () => void }
      ).__telemetryConsentUnsubscribe?.(),
    );
    const withdrawn = await page.evaluate(
      (payload) =>
        window.piApp!.setTelemetryConsent(payload) as Promise<TelemetryConsentStatusSnapshot>,
      update(1, "denied", "denied"),
    );
    expect(withdrawn).toMatchObject({
      effective: {
        usage: { value: "denied" },
        crash: { value: "denied" },
      },
      pending: null,
      outcome: "saved",
    });
    await page.waitForTimeout(100);
    await expect(
      page.evaluate(
        () =>
          (window as Window & { __telemetryConsentEvents?: number }).__telemetryConsentEvents ?? 0,
      ),
    ).resolves.toBe(eventsBeforeUnsubscribe);
  } finally {
    await expect(harness.close()).resolves.toMatchObject({
      closed: true,
      exitCode: 0,
      signalCode: null,
    });
  }
});

test("startup revokes raw engine consent and queued work when durable provenance is absent", async () => {
  const userDataDir = await makeUserDataDir("pi-gui-d07-telemetry-bridge-stale-");
  const setupTransport = new FakeTransport();
  const owner = await telemetry_initialize(
    distributionTelemetryConfiguration("1.0.1", process.platform, process.arch),
    {
      clock: new FakeClock(),
      random: new FakeRandom(),
      persistence: new TelemetryFilePersistence(userDataDir),
      transport: setupTransport,
      logger: new RecordingLogger(),
    },
  );
  expect(await owner.telemetry_consent_set(true, true, 1)).toBe(true);
  expect(await owner.telemetry_usage_record("tool-call-started")).toBe(true);
  expect(await owner.telemetry_error_record("other", "session.run_failed")).toBe(true);
  owner.telemetry_shutdown();
  expect(setupTransport.requests).toHaveLength(0);

  const harness = await launchDesktop(userDataDir, {
    testMode: "background",
    scrubProviderEnv: true,
  });
  try {
    const page = await harness.firstWindow();
    const status = await page.evaluate(
      () => window.piApp!.getTelemetryConsentStatus() as Promise<TelemetryConsentStatusSnapshot>,
    );
    expect(status).toMatchObject({
      durable: {
        usage: { value: "undecided" },
        crash: { value: "undecided" },
      },
      effective: {
        usage: { value: "undecided" },
        crash: { value: "undecided" },
      },
      engine: {
        ownerConsent: { usage: false, crash: false },
        queue: { usage: 0, crash: 0, total: 0 },
        identityPresent: false,
      },
      delivery: { receipt: "not-observed" },
    });
  } finally {
    await expect(harness.close()).resolves.toMatchObject({
      closed: true,
      exitCode: 0,
      signalCode: null,
    });
  }
});

test("durable consent survives restart and pending provenance failure is recoverable through IPC", async () => {
  const userDataDir = await makeUserDataDir("pi-gui-d07-telemetry-bridge-restart-");
  const first = await launchDesktop(userDataDir, {
    testMode: "background",
    scrubProviderEnv: true,
  });
  try {
    const page = await first.firstWindow();
    const saved = await page.evaluate(
      (payload) =>
        window.piApp!.setTelemetryConsent(payload) as Promise<TelemetryConsentStatusSnapshot>,
      update(0, "allowed", "denied"),
    );
    expect(saved).toMatchObject({ outcome: "saved", pending: null });
  } finally {
    await expect(first.close()).resolves.toMatchObject({
      closed: true,
      exitCode: 0,
      signalCode: null,
    });
  }

  const second = await launchDesktop(userDataDir, {
    testMode: "background",
    scrubProviderEnv: true,
  });
  try {
    const page = await second.firstWindow();
    const restarted = await page.evaluate(
      () => window.piApp!.getTelemetryConsentStatus() as Promise<TelemetryConsentStatusSnapshot>,
    );
    expect(restarted).toMatchObject({
      desired: {
        usage: { value: "allowed", source: "user" },
        crash: { value: "denied", source: "user" },
      },
      durable: {
        usage: { value: "allowed" },
        crash: { value: "denied" },
      },
      effective: {
        usage: { value: "allowed" },
        crash: { value: "denied" },
      },
      delivery: { receipt: "not-observed" },
    });
  } finally {
    await expect(second.close()).resolves.toMatchObject({
      closed: true,
      exitCode: 0,
      signalCode: null,
    });
  }

  const failedUserData = await makeUserDataDir("pi-gui-d07-telemetry-bridge-pending-");
  const consentPath = join(failedUserData, "telemetry", "consent.json");
  await mkdir(consentPath, { recursive: true });
  const failed = await launchDesktop(failedUserData, {
    testMode: "background",
    scrubProviderEnv: true,
  });
  try {
    const page = await failed.firstWindow();
    const pending = await page.evaluate(
      (payload) =>
        window.piApp!.setTelemetryConsent(payload) as Promise<TelemetryConsentStatusSnapshot>,
      update(0, "allowed", "denied"),
    );
    expect(pending).toMatchObject({
      effective: {
        usage: { value: "undecided" },
        crash: { value: "denied" },
      },
      pending: { requestRevision: 1, state: "persistence-pending" },
      outcome: "not-durable",
    });
    await rm(consentPath, { recursive: true, force: true });
    const recovered = await page.evaluate(
      (payload) =>
        window.piApp!.setTelemetryConsent(payload) as Promise<TelemetryConsentStatusSnapshot>,
      update(1, "allowed", "denied"),
    );
    expect(recovered).toMatchObject({
      durable: {
        usage: { value: "allowed" },
        crash: { value: "denied" },
      },
      pending: null,
      outcome: "saved",
    });
  } finally {
    await expect(failed.close()).resolves.toMatchObject({
      closed: true,
      exitCode: 0,
      signalCode: null,
    });
  }
});
