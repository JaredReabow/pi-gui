import {
  decodeAgentAccessMode,
  type AgentAccessMode,
  type AgentAutonomyPreferences,
  type SessionRef,
  type SessionModelSelection,
} from "@pi-gui/session-driver";
import type { AutonomyUpdate } from "../../contracts/autonomy";
import { decodeSummaryModel } from "./work-summary-owner";
import { readJsonWithBackup, writeFileAtomicQueued } from "../persistence/atomic-file-write";

interface SavedAutonomy {
  version: 2;
  revision: number;
  defaultMode: AgentAccessMode;
  sessions: Record<string, { mode?: AgentAccessMode; reviewModel?: SessionModelSelection | null }>;
}
const keyOf = (ref: SessionRef) => JSON.stringify([ref.workspaceId, ref.sessionId]);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved autonomy preferences");
  return value as Record<string, unknown>;
}
export function decodeAutonomy(value: unknown): SavedAutonomy {
  const input = object(value);
  if (
    (input.version !== 1 && input.version !== 2) ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0 ||
    Object.keys(input).some((k) => !["version", "revision", "defaultMode", "sessions"].includes(k))
  )
    throw new Error("Invalid autonomy preferences version");
  // v1's misleading Read only label allowed project edits. Preserve that
  // capability under its new name; never reinterpret v2 Read only as writable.
  const mode = (value: unknown): AgentAccessMode =>
    input.version === 1 && value === "read-only" ? "project-only" : decodeAgentAccessMode(value);
  const sessions: SavedAutonomy["sessions"] = {};
  for (const [key, value] of Object.entries(object(input.sessions))) {
    if (key.length > 2000) throw new Error("Invalid autonomy session key");
    const entry = object(value);
    if (Object.keys(entry).some((k) => k !== "mode" && k !== "reviewModel"))
      throw new Error("Invalid autonomy session preference");
    Object.defineProperty(sessions, key, {
      enumerable: true,
      writable: true,
      configurable: true,
      value: {
        ...(entry.mode === undefined ? {} : { mode: mode(entry.mode) }),
        ...(entry.reviewModel === undefined
          ? {}
          : { reviewModel: decodeSummaryModel(entry.reviewModel) }),
      },
    });
  }
  return {
    version: 2,
    revision: Number(input.revision),
    defaultMode: mode(input.defaultMode),
    sessions,
  };
}

/** User-only authority in app data, explicitly excluded from automatic project scopes. */
export class AutonomyStore {
  private value: SavedAutonomy = {
    version: 2,
    revision: 0,
    defaultMode: "read-only",
    sessions: {},
  };
  private readonly ready: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {
    this.ready = readJsonWithBackup(path).then((saved) => {
      if (saved.corrupted || saved.recovered)
        throw new Error("Cannot read autonomy preferences; refusing to grant access");
      if (saved.value !== undefined) this.value = decodeAutonomy(saved.value);
    });
    this.ready.catch(() => undefined);
  }
  async get(target?: SessionRef): Promise<AgentAutonomyPreferences> {
    await this.ready;
    await this.writes;
    const entry = target ? this.value.sessions[keyOf(target)] : undefined;
    return {
      mode: entry?.mode ?? this.value.defaultMode,
      reviewModel: entry?.reviewModel ?? null,
      revision: this.value.revision,
    };
  }
  async set(input: AutonomyUpdate): Promise<AgentAutonomyPreferences> {
    await this.ready;
    if (input.mode === "full-access" && input.confirmFullAccess !== true)
      throw new Error("Full access requires explicit confirmation");
    if (input.reviewModel !== undefined && !input.target)
      throw new Error("Choose a thread before setting its review model");
    const nextWrite = this.writes.then(async () => {
      const next = structuredClone(this.value);
      if (input.target) {
        const key = keyOf(input.target);
        next.sessions[key] = {
          ...next.sessions[key],
          ...(input.mode === undefined ? {} : { mode: input.mode }),
          ...(input.reviewModel === undefined ? {} : { reviewModel: input.reviewModel }),
        };
      } else if (input.mode) next.defaultMode = input.mode;
      next.revision++;
      await writeFileAtomicQueued(this.path, JSON.stringify(next) + "\n", decodeAutonomy);
      this.value = next;
    });
    this.writes = nextWrite.catch(() => undefined);
    await nextWrite;
    return this.get(input.target);
  }
}
