import { createHash } from "node:crypto";
import { readJsonWithBackup, writeFileAtomicQueued } from "../persistence/atomic-file-write";
import type { SessionModelSelection } from "@pi-gui/session-driver";
import type {
  SummaryPreferences,
  SummaryPreferenceUpdate,
  SummaryTarget,
  WorkSummaryResult,
} from "../../contracts/work-summaries";
import { completedWork } from "../../contracts/work-summaries";
import type { TimelineTranscriptItem } from "../../contracts/timeline-types";

interface SavedSummaries {
  version: 1;
  enabled: boolean;
  models: Record<string, SessionModelSelection>;
  cache: Record<string, WorkSummaryResult>;
}
const keyOf = (target: SummaryTarget) => JSON.stringify([target.workspaceId, target.sessionId]);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid summary preferences");
  return value as Record<string, unknown>;
}
export function decodeSummaryModel(value: unknown): SessionModelSelection | null {
  if (value === null) return null;
  const input = record(value);
  if (
    Object.keys(input).some((k) => k !== "provider" && k !== "modelId") ||
    typeof input.provider !== "string" ||
    !input.provider.trim() ||
    input.provider.length > 500 ||
    typeof input.modelId !== "string" ||
    !input.modelId.trim() ||
    input.modelId.length > 500
  ) {
    throw new Error("Invalid summary model");
  }
  return { provider: input.provider, modelId: input.modelId };
}
export function decodeSavedSummaries(value: unknown): SavedSummaries {
  const input = record(value);
  if (
    input.version !== 1 ||
    typeof input.enabled !== "boolean" ||
    Object.keys(input).some((key) => !["version", "enabled", "models", "cache"].includes(key))
  )
    throw new Error("Invalid summary preferences version");
  const models: Record<string, SessionModelSelection> = {};
  for (const [key, selection] of Object.entries(record(input.models))) {
    const model = decodeSummaryModel(selection);
    if (!model) throw new Error("Invalid saved summary model");
    Object.defineProperty(models, key, {
      value: model,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const cache: Record<string, WorkSummaryResult> = {};
  for (const [key, entry] of Object.entries(record(input.cache))) {
    const result = record(entry);
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      typeof result.text !== "string" ||
      result.text.length > 1200 ||
      (result.truncated !== undefined && typeof result.truncated !== "boolean")
    )
      throw new Error("Invalid summary cache");
    cache[key] = {
      text: result.text,
      model: decodeSummaryModel(result.model) ?? undefined,
      truncated: result.truncated === true,
      ...(result.usage === undefined ? {} : { usage: decodeSummaryUsage(result.usage) }),
    };
  }
  return { version: 1, enabled: input.enabled, models, cache };
}

function decodeSummaryUsage(value: unknown): NonNullable<WorkSummaryResult["usage"]> {
  const input = record(value);
  if (
    typeof input.totalTokens !== "number" ||
    !Number.isFinite(input.totalTokens) ||
    input.totalTokens < 0 ||
    typeof input.cost !== "number" ||
    !Number.isFinite(input.cost) ||
    input.cost < 0
  )
    throw new Error("Invalid summary usage");
  return { totalTokens: input.totalTokens, cost: input.cost };
}

/** Presentation state only: never modifies Pi history or performs tools. */
export class WorkSummaryOwner {
  private saved: SavedSummaries = { version: 1, enabled: true, models: {}, cache: {} };
  private readonly ready: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<WorkSummaryResult>>();
  private readonly failures = new Map<string, WorkSummaryResult>();
  private readonly controllers = new Set<AbortController>();
  private revision = 0;

  constructor(
    private readonly file: string,
    private readonly timeoutMs = 45_000,
  ) {
    this.ready = readJsonWithBackup(file).then((stored) => {
      if (stored.corrupted && !stored.recovered)
        throw new Error("Cannot read summary preferences; saved bytes preserved");
      if (stored.value !== undefined) this.saved = decodeSavedSummaries(stored.value);
    });
    // Read failures surface through API calls, not unhandled startup rejection.
    void this.ready.catch(() => undefined);
  }
  async preferences(target?: SummaryTarget): Promise<SummaryPreferences> {
    await this.ready;
    await this.writes;
    return {
      enabled: this.saved.enabled,
      model: target ? (this.saved.models[keyOf(target)] ?? null) : null,
    };
  }
  async update(input: SummaryPreferenceUpdate): Promise<SummaryPreferences> {
    await this.ready;
    if (input.model !== undefined && !input.target)
      throw new Error("Summary model requires a thread");
    const operation = this.writes.then(async () => {
      // Apply to the latest state so simultaneous settings/model/cache saves cannot lose data.
      const next = structuredClone(this.saved);
      if (input.enabled !== undefined) next.enabled = input.enabled;
      if (input.model !== undefined && input.target) {
        const key = keyOf(input.target);
        if (input.model) next.models[key] = input.model;
        else delete next.models[key];
      }
      this.revision++;
      for (const controller of this.controllers) controller.abort();
      this.failures.clear();
      await this.persist(next);
      this.saved = next;
    });
    this.writes = operation.catch(() => undefined);
    await operation;
    return this.preferences(input.target);
  }
  async close(): Promise<void> {
    for (const controller of this.controllers) controller.abort();
    await this.writes;
  }
  private persist(value = this.saved): Promise<void> {
    return writeFileAtomicQueued(this.file, `${JSON.stringify(value)}\n`, decodeSavedSummaries);
  }
  async summarize(options: {
    target: SummaryTarget;
    promptId: string;
    retry?: boolean;
    transcript: readonly TimelineTranscriptItem[];
    running: boolean;
    chatModel: SessionModelSelection | null;
    generate: (
      prompt: string,
      model: SessionModelSelection | null,
      signal: AbortSignal,
    ) => Promise<{
      text: string;
      model: SessionModelSelection;
      usage?: { totalTokens: number; cost: { total: number } };
    }>;
  }): Promise<WorkSummaryResult> {
    const prefs = await this.preferences(options.target);
    if (!prefs.enabled) return { error: "AI work summaries are off" };
    const work = completedWork(options.transcript, options.running).find(
      (span) => span.promptId === options.promptId,
    );
    if (!work) throw new Error("Completed work no longer exists on this branch");
    const model = prefs.model ?? options.chatModel;
    if (!model) return { error: "Choose a chat or summary model" };
    // Native/live row identities differ on reopen. Cache semantic content, never
    // transient renderer ids, timestamps or tool call correlation identifiers.
    const source = JSON.stringify({
      prompt: work.prompt,
      items: work.items
        .filter((item) => item.kind === "tool" || item.kind === "message")
        .map((item) =>
          Object.fromEntries(
            Object.entries(item).filter(
              ([field]) => !["id", "createdAt", "sourceMessageId", "callId"].includes(field),
            ),
          ),
        ),
    });
    const key = createHash("sha256")
      .update(JSON.stringify([options.target, model, source]))
      .digest("hex");
    if (options.retry) this.failures.delete(key);
    const cached = this.saved.cache[key] ?? this.failures.get(key);
    if (cached) return cached;
    const existing = this.pending.get(key);
    if (existing) return existing;
    // Bound auxiliary work globally; lazy UI requests cannot saturate providers.
    if (this.pending.size >= 2)
      return { error: "Summary service busy; reopen this thread to retry" };
    const revision = this.revision;
    const controller = new AbortController();
    this.controllers.add(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]);
    const truncated = source.length > 24000;
    const prompt = truncated
      ? `${source.slice(0, 12000)}\n[Middle of work omitted to fit the summary budget]\n${source.slice(-12000)}`
      : source;
    // Defer execution until after pending.set, including synchronous provider failures.
    const request = Promise.resolve().then(async (): Promise<WorkSummaryResult> => {
      try {
        const result = await Promise.race([
          options.generate(prompt, model, signal),
          new Promise<never>((_resolve, reject) => {
            if (signal.aborted) reject(new Error("Summary cancelled"));
            else
              signal.addEventListener(
                "abort",
                () => reject(new Error("Summary cancelled or timed out")),
                { once: true },
              );
          }),
        ]);
        signal.throwIfAborted();
        if (revision !== this.revision) return { error: "Summary settings changed" };
        const summary: WorkSummaryResult = {
          text: result.text,
          model: result.model,
          truncated,
          ...(result.usage
            ? { usage: { totalTokens: result.usage.totalTokens, cost: result.usage.cost.total } }
            : {}),
        };
        const write = this.writes.then(async () => {
          if (revision !== this.revision) return;
          this.saved.cache[key] = summary;
          const keys = Object.keys(this.saved.cache);
          for (const stale of keys.slice(0, Math.max(0, keys.length - 300)))
            delete this.saved.cache[stale];
          await this.persist();
        });
        this.writes = write.catch(() => undefined);
        await write;
        return summary;
      } catch (error) {
        const failed = { error: String(error).slice(0, 300) };
        if (revision === this.revision) {
          this.failures.set(key, failed);
          if (this.failures.size > 300) this.failures.delete(this.failures.keys().next().value!);
        }
        return failed;
      } finally {
        controller.abort();
        this.controllers.delete(controller);
        this.pending.delete(key);
      }
    });
    this.pending.set(key, request);
    return request;
  }
}
