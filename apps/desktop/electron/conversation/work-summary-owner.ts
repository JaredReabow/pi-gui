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
import {
  SummaryRequestScheduler,
  summaryDelay,
  withSummaryAbort,
} from "./summary-request-scheduler";
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
      ...(result.request === undefined ? {} : { request: decodeSummaryRequest(result.request) }),
    };
  }
  return { version: 1, enabled: input.enabled, models, cache };
}

function decodeSummaryRequest(value: unknown): NonNullable<WorkSummaryResult["request"]> {
  const input = record(value);
  if (
    Object.keys(input).some((key) => key !== "api" && key !== "thinkingLevel") ||
    typeof input.api !== "string" ||
    !input.api.trim() ||
    input.api.length > 200 ||
    typeof input.thinkingLevel !== "string" ||
    !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(input.thinkingLevel)
  )
    throw new Error("Invalid saved summary request policy");
  return { api: input.api, thinkingLevel: input.thinkingLevel };
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
  private readonly controllers = new Map<AbortController, string>();
  private readonly scheduler = new SummaryRequestScheduler();
  private closed = false;
  private revision = 0;

  constructor(
    private readonly file: string,
    private readonly timeoutMs = 45_000,
    private readonly retryDelaysMs: readonly [number, number, number] = [1_000, 2_000, 4_000],
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
      for (const controller of this.controllers.keys()) controller.abort();
      this.failures.clear();
      await this.persist(next);
      this.saved = next;
    });
    this.writes = operation.catch(() => undefined);
    await operation;
    return this.preferences(input.target);
  }
  chatModelChanged(target: SummaryTarget): void {
    const key = keyOf(target);
    if (this.saved.models[key]) return;
    for (const [controller, owner] of this.controllers) if (owner === key) controller.abort();
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers.keys()) controller.abort();
    await Promise.allSettled(this.pending.values());
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
      request?: WorkSummaryResult["request"];
      usage?: { totalTokens: number; cost: { total: number } };
    }>;
  }): Promise<WorkSummaryResult> {
    const prefs = await this.preferences(options.target);
    if (this.closed) return { error: "Summary service closed" };
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
    // Bound queued work as well as inference. Ordinary contention queues fairly.
    if (this.pending.size >= 300)
      return { error: "Summary queue full; retry after pending summaries finish" };
    const revision = this.revision;
    const controller = new AbortController();
    this.controllers.set(controller, keyOf(options.target));
    const signal = controller.signal;
    const truncated = source.length > 24000;
    const prompt = truncated
      ? `${source.slice(0, 12000)}\n[Middle of work omitted to fit the summary budget]\n${source.slice(-12000)}`
      : source;
    // Defer execution until after pending.set, including synchronous provider failures.
    const request = Promise.resolve().then(async (): Promise<WorkSummaryResult> => {
      try {
        let result: Awaited<ReturnType<typeof options.generate>> | undefined;
        // Four attempts total, with fresh deadlines; backoff holds no inference slot.
        for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
          signal.throwIfAborted();
          try {
            result = await this.scheduler.run(signal, async () => {
              const deadline = new AbortController();
              const attemptSignal = AbortSignal.any([signal, deadline.signal]);
              const timer = setTimeout(
                () => deadline.abort(new Error("Summary timed out")),
                this.timeoutMs,
              );
              try {
                const generated = await withSummaryAbort(
                  Promise.resolve().then(() => {
                    attemptSignal.throwIfAborted();
                    return options.generate(prompt, model, attemptSignal);
                  }),
                  attemptSignal,
                );
                attemptSignal.throwIfAborted();
                if (!generated.text.trim()) throw new Error("Summary model returned no text");
                return generated;
              } finally {
                clearTimeout(timer);
                deadline.abort();
              }
            });
            break;
          } catch (error) {
            if (signal.aborted) throw new Error("Summary cancelled");
            if (attempt === this.retryDelaysMs.length) throw error;
            await summaryDelay(this.retryDelaysMs[attempt]!, signal);
          }
        }
        if (!result) throw new Error("Summary request failed");
        signal.throwIfAborted();
        if (revision !== this.revision) return { error: "Summary settings changed" };
        const summary: WorkSummaryResult = {
          text: result.text,
          model: result.model,
          ...(result.request ? { request: result.request } : {}),
          truncated,
          ...(result.usage
            ? { usage: { totalTokens: result.usage.totalTokens, cost: result.usage.cost.total } }
            : {}),
        };
        const write = this.writes.then(async () => {
          signal.throwIfAborted();
          if (revision !== this.revision || this.closed)
            throw new Error("Summary settings changed");
          const next = structuredClone(this.saved);
          next.cache[key] = summary;
          const keys = Object.keys(next.cache);
          for (const stale of keys.slice(0, Math.max(0, keys.length - 300)))
            delete next.cache[stale];
          await this.persist(next);
          this.saved = next;
        });
        this.writes = write.catch(() => undefined);
        await write;
        return summary;
      } catch (error) {
        const failed = {
          error: (error instanceof Error ? error.message : String(error)).slice(0, 1200),
        };
        if (revision === this.revision && !signal.aborted && !this.closed) {
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
