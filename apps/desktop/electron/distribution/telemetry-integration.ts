import type { SessionDriverEvent } from "@pi-gui/session-driver";
import type { TelemetryConsentStatusSnapshot } from "../../contracts/telemetry-consent";
import {
  telemetry_fetch_transport,
  type TelemetryConfiguration,
  type TelemetryConsent,
  type TelemetryConsentMetadata,
  type TelemetryCrashKind,
  type TelemetryFlushResult,
  type TelemetryOwner,
  type TelemetryStatus,
  type TelemetryTransport,
} from "../telemetry/telemetry";

export const DISTRIBUTION_TELEMETRY_APP_ID = "pi-gui";
export const DISTRIBUTION_TELEMETRY_BASE_URL = "https://updates.reabow.co/telemetry";
export const DISTRIBUTION_TELEMETRY_DISCLOSURE_VERSION = 1;

export const DISTRIBUTION_TELEMETRY_STABLE_CODES = Object.freeze([
  "app.startup_failed",
  "app.render_process_gone",
  "app.child_process_gone",
  "app.uncaught_exception",
  "session.run_failed",
  "session.closed_failed",
  "extension.compatibility_issue",
] as const);

export type DistributionTelemetryStableCode = (typeof DISTRIBUTION_TELEMETRY_STABLE_CODES)[number];

export type DistributionTelemetryPlatform = "macos" | "windows" | "linux";

export interface DistributionTelemetryEnvironment {
  readonly PI_APP_TEST_MODE?: string | undefined;
  readonly PI_APP_TEST_TELEMETRY?: string | undefined;
}

export interface DistributionTelemetryConsentResult {
  readonly durable: boolean;
  readonly consent: TelemetryConsent;
  readonly status: TelemetryStatus;
  readonly sessionMarkerActive: boolean;
}

export function distributionTelemetryPlatform(platform: string): DistributionTelemetryPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  throw new TypeError(`Unsupported telemetry platform: ${platform}`);
}

export function distributionTelemetryConfiguration(
  version: string,
  platform: string,
  arch: string,
): TelemetryConfiguration {
  return Object.freeze({
    operationalEnabled: true,
    app: Object.freeze({
      id: DISTRIBUTION_TELEMETRY_APP_ID,
      version,
      platform: distributionTelemetryPlatform(platform),
      arch,
    }),
    baseUrl: DISTRIBUTION_TELEMETRY_BASE_URL,
    disclosureVersion: DISTRIBUTION_TELEMETRY_DISCLOSURE_VERSION,
    stableCodes: DISTRIBUTION_TELEMETRY_STABLE_CODES,
  });
}

/** Test launches never retain the production fetch transport, even if consent is later enabled. */
export function distributionTelemetryProductionEnabled(
  environment: DistributionTelemetryEnvironment,
): boolean {
  return environment.PI_APP_TEST_TELEMETRY !== "disabled" && !environment.PI_APP_TEST_MODE?.trim();
}

export function distributionTelemetryTransport(
  productionEnabled: boolean,
  fetchImpl: typeof globalThis.fetch,
): TelemetryTransport {
  return productionEnabled
    ? telemetry_fetch_transport(fetchImpl)
    : Object.freeze({
        async send(): Promise<never> {
          throw new Error("Production telemetry transport is disabled in this test environment.");
        },
      });
}

/**
 * Narrow app-facing adapter around the accepted D04 owner. It translates known
 * app/session events into aggregate calls and never forwards event content.
 */
export class DistributionTelemetryIntegration {
  private readonly owner: TelemetryOwner;
  private sessionMarkerActive = false;
  private consentStatusSource: (() => TelemetryConsentStatusSnapshot | null) | undefined;

  constructor(owner: TelemetryOwner) {
    this.owner = owner;
  }

  configuration(): ReturnType<TelemetryOwner["telemetry_configuration_get"]> {
    return this.owner.telemetry_configuration_get();
  }

  consent(): TelemetryConsent {
    return this.owner.telemetry_consent_get();
  }

  consentMetadata(): TelemetryConsentMetadata {
    return this.owner.telemetry_consent_metadata_get();
  }

  status(): TelemetryStatus {
    return this.owner.telemetry_status_get();
  }

  /**
   * Install the durable service projection as the capture and delivery gate.
   * Without a source, the engine owner retains its accepted standalone behavior.
   */
  setConsentStatusSource(source: (() => TelemetryConsentStatusSnapshot | null) | undefined): void {
    this.consentStatusSource = source;
  }

  async startSession(): Promise<boolean> {
    if (!this.consentAllows("crash")) return false;
    this.sessionMarkerActive = await this.owner.telemetry_session_start();
    return this.sessionMarkerActive;
  }

  async setConsent(usage: boolean, crash: boolean): Promise<DistributionTelemetryConsentResult> {
    const durable = await this.owner.telemetry_consent_set(
      usage,
      crash,
      DISTRIBUTION_TELEMETRY_DISCLOSURE_VERSION,
    );
    const consent = this.owner.telemetry_consent_get();
    if (consent.crash && !this.sessionMarkerActive) {
      this.sessionMarkerActive = await this.owner.telemetry_session_start();
    } else if (!consent.crash && this.sessionMarkerActive) {
      await this.owner.telemetry_session_end();
      this.sessionMarkerActive = false;
    }
    return Object.freeze({
      durable,
      consent,
      status: this.owner.telemetry_status_get(),
      sessionMarkerActive: this.sessionMarkerActive,
    });
  }

  async recordUserActivity(): Promise<boolean> {
    if (!this.consentAllows("usage")) return false;
    return this.owner.telemetry_usage_record("user-activity");
  }

  async recordToolCallStarted(): Promise<boolean> {
    if (!this.consentAllows("usage")) return false;
    return this.owner.telemetry_usage_record("tool-call-started");
  }

  async recordCrash(
    kind: TelemetryCrashKind,
    stableCode: DistributionTelemetryStableCode,
  ): Promise<boolean> {
    if (!this.consentAllows("crash")) return false;
    return this.owner.telemetry_error_record(kind, stableCode);
  }

  async handleSessionEvent(event: SessionDriverEvent): Promise<void> {
    switch (event.type) {
      case "toolStarted":
        await this.recordToolCallStarted();
        break;
      case "runFailed":
        await this.recordCrash("other", "session.run_failed");
        break;
      case "sessionClosed":
        if (event.reason === "failed") {
          await this.recordCrash("other", "session.closed_failed");
        }
        break;
      case "extensionCompatibilityIssue":
        await this.recordCrash("extension", "extension.compatibility_issue");
        break;
      default:
        break;
    }
  }

  async flushDue(): Promise<TelemetryFlushResult> {
    if (!this.consentAllows("usage") && !this.consentAllows("crash")) {
      return { status: "idle", attempts: 0, acknowledged: 0, retained: 0 };
    }
    return this.owner.telemetry_flush_due();
  }

  async shutdown(): Promise<void> {
    try {
      await this.owner.telemetry_session_end();
      this.sessionMarkerActive = false;
    } finally {
      this.owner.telemetry_shutdown();
    }
  }

  private consentAllows(category: "usage" | "crash"): boolean {
    if (!this.consentStatusSource) return true;
    try {
      return this.consentStatusSource()?.effective[category].value === "allowed";
    } catch {
      return false;
    }
  }
}
