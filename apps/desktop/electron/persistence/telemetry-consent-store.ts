import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  telemetryConsent_decodeCheckpoint,
  type TelemetryConsentCheckpoint,
} from "../../contracts/telemetry-consent";
import { writeJsonAtomicForAppStore } from "./app-store-persistence";
import { readJsonWithBackup } from "./atomic-file-write";

export const TELEMETRY_CONSENT_STORE_MAX_BYTES = 8_192;

/**
 * Durable explicit-choice provenance for telemetry consent.
 *
 * The caller supplies the complete app root. This adapter never discovers an
 * ambient profile or falls back to a process-global path.
 */
export interface TelemetryConsentStore {
  load(): Promise<TelemetryConsentCheckpoint | null>;
  save(checkpoint: unknown): Promise<void>;
}

/** File-backed provenance inside the caller's isolated app data root. */
export class TelemetryConsentFileStore implements TelemetryConsentStore {
  readonly filePath: string;

  constructor(root: string) {
    if (typeof root !== "string" || !root.trim() || !isAbsolute(root)) {
      throw new TypeError("telemetry consent store requires an absolute caller root.");
    }
    this.filePath = join(root, "telemetry", "consent.json");
  }

  async load(): Promise<TelemetryConsentCheckpoint | null> {
    await telemetryConsentStore_assertBounded(this.filePath);
    await telemetryConsentStore_assertBounded(`${this.filePath}.bak`);
    const result = await readJsonWithBackup(this.filePath);
    if (result.recovered) {
      throw new Error(
        "Telemetry consent provenance was recovered from a backup and requires explicit reconciliation.",
      );
    }
    if (result.corrupted) {
      throw new Error("Telemetry consent provenance is corrupt and was not replaced.");
    }
    if (result.value === undefined) {
      return null;
    }
    if (
      result.contents === undefined ||
      result.contents.byteLength > TELEMETRY_CONSENT_STORE_MAX_BYTES
    ) {
      throw new Error("Telemetry consent provenance exceeds the byte bound.");
    }
    return telemetryConsent_decodeCheckpoint(result.value);
  }

  async save(value: unknown): Promise<void> {
    const checkpoint = telemetryConsent_decodeCheckpoint(value);
    const serialized = `${JSON.stringify(checkpoint)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > TELEMETRY_CONSENT_STORE_MAX_BYTES) {
      throw new Error("Telemetry consent provenance exceeds the byte bound.");
    }
    // Reuse the app-store durability path rather than writing a telemetry file
    // through the lower-level atomic writer directly.
    await writeJsonAtomicForAppStore(this.filePath, checkpoint);
  }
}

async function telemetryConsentStore_assertBounded(filePath: string): Promise<void> {
  try {
    const details = await stat(filePath);
    if (!details.isFile() || details.size > TELEMETRY_CONSENT_STORE_MAX_BYTES) {
      throw new Error("Telemetry consent provenance exceeds the byte bound.");
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
