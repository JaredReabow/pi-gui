import { join } from "node:path";
import type { TelemetryPersistence, TelemetryPersistedState } from "../telemetry/telemetry";
import { writeJsonAtomicForAppStore } from "./app-store-persistence";
import { readJsonWithBackup } from "./atomic-file-write";

/** The telemetry owner's state is app-private and isolated from the Pi agent profile. */
export function telemetryStatePath(userDataDir: string): string {
  return join(userDataDir, "telemetry", "state.json");
}

export class TelemetryFilePersistence implements TelemetryPersistence {
  readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = telemetryStatePath(userDataDir);
  }

  async load(): Promise<unknown> {
    const result = await readJsonWithBackup(this.filePath);
    if (result.corrupted && !result.recovered) {
      throw new Error("Telemetry state is corrupt and was not replaced.");
    }
    return result.value ?? null;
  }

  async save(state: Readonly<TelemetryPersistedState>): Promise<void> {
    await writeJsonAtomicForAppStore(this.filePath, state);
  }

  async clear(): Promise<void> {
    // Replacing the valid tombstone twice also replaces the rotating backup, so
    // both recovery paths fail closed after a later primary-file corruption.
    await writeJsonAtomicForAppStore(this.filePath, null);
    await writeJsonAtomicForAppStore(this.filePath, null);
  }
}
