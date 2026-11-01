import { net } from "electron";
import { randomUUID } from "node:crypto";
import { TelemetryFilePersistence } from "../persistence/telemetry-store";
import {
  telemetry_initialize,
  type TelemetryClock,
  type TelemetryLogger,
  type TelemetryRandom,
} from "../telemetry/telemetry";
import {
  DistributionTelemetryIntegration,
  distributionTelemetryConfiguration,
  distributionTelemetryProductionEnabled,
  distributionTelemetryTransport,
  type DistributionTelemetryEnvironment,
} from "./telemetry-integration";

export interface DistributionTelemetryRuntimeOptions {
  readonly userDataDir: string;
  readonly version: string;
  readonly platform: string;
  readonly architecture: string;
  readonly environment: DistributionTelemetryEnvironment;
}

export async function createDistributionTelemetryRuntime(
  options: DistributionTelemetryRuntimeOptions,
): Promise<DistributionTelemetryIntegration | null> {
  try {
    const productionFetch = ((input: string | URL, init?: RequestInit) =>
      net.fetch(String(input), init)) as typeof globalThis.fetch;
    const owner = await telemetry_initialize(
      distributionTelemetryConfiguration(options.version, options.platform, options.architecture),
      {
        clock: systemClock,
        random: systemRandom,
        persistence: new TelemetryFilePersistence(options.userDataDir),
        transport: distributionTelemetryTransport(
          distributionTelemetryProductionEnabled(options.environment),
          productionFetch,
        ),
        logger: fixedTelemetryLogger,
      },
    );
    return new DistributionTelemetryIntegration(owner);
  } catch (error) {
    console.error("[telemetry] initialization failed; telemetry remains inactive", error);
    return null;
  }
}

const systemClock: TelemetryClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
  clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout),
});

const systemRandom: TelemetryRandom = Object.freeze({
  uuid: () => randomUUID(),
  fraction: () => Math.random(),
});

const fixedTelemetryLogger: TelemetryLogger = Object.freeze({
  warn: (event) => console.warn(`[telemetry] ${event}`),
  info: (event) => console.info(`[telemetry] ${event}`),
});
