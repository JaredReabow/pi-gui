import { compact, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type {
  Api,
  Model,
  ModelThinkingLevel,
  RetryCallbacks,
  RetryPolicy,
} from "@earendil-works/pi-ai";
import type { SessionModelSelection, SessionRef } from "@pi-gui/session-driver";
import {
  explainModelRequestFailure,
  safeRequestError,
  summaryThinkingLevel,
  summaryRequestOptions,
} from "./summary-request.js";

export interface SummaryCompactionRuntimeOptions {
  readonly retry?: RetryPolicy;
  readonly callbacks?: RetryCallbacks;
  readonly onRequest?: (model: Model<Api>, level: ModelThinkingLevel) => void;
  readonly onError?: (message: string) => void;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** One released hook covers /compact, threshold and overflow recovery. */
export function createSummaryCompactionExtension(
  workspaceId: string,
  selection: (ref: SessionRef) => Promise<SessionModelSelection | null>,
  runtimeOptions: (
    ref: SessionRef,
    customInstructions?: string,
  ) => SummaryCompactionRuntimeOptions = () => ({}),
): ExtensionFactory {
  return (pi) => {
    pi.on("session_before_compact", async (event, ctx) => {
      const ref = { workspaceId, sessionId: ctx.sessionManager.getSessionId() };
      let options: SummaryCompactionRuntimeOptions = {};
      let model: Model<Api> | undefined;
      let level: ModelThinkingLevel = "off";
      let signal: AbortSignal | undefined;
      try {
        options = runtimeOptions(ref, event.customInstructions);
        const selected = await selection(ref);
        const requested =
          selected ?? (ctx.model ? { provider: ctx.model.provider, modelId: ctx.model.id } : null);
        if (!requested) throw new Error("Choose a chat or summary model before compacting context");
        const runtime = ctx.modelRegistry;
        await runtime.refresh({ allowNetwork: false });
        model = runtime.find(requested.provider, requested.modelId);
        if (!model)
          throw new Error(`Summary model unavailable: ${requested.provider}/${requested.modelId}`);
        level = summaryThinkingLevel(model);
        options.onRequest?.(model, level);
        signal = AbortSignal.any([event.signal, AbortSignal.timeout(120_000)]);
        signal.throwIfAborted();
        const auth = await runtime.getApiKeyAndHeaders(model);
        if (!auth.ok) throw new Error(auth.error);
        const headers = Object.fromEntries(
          Object.entries(auth.headers ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
        // Native preparation skips file details from custom hooks. Our result still uses
        // Pi's own compact(), so carry only its validated file-operation metadata forward.
        // Kept-entry boundaries and native source messages are never changed.
        const previous = [...event.branchEntries]
          .reverse()
          .find((entry) => entry.type === "compaction");
        if (previous?.type === "compaction" && previous.fromHook && record(previous.details)) {
          const details = previous.details;
          if (
            details.piGuiSummaryVersion === 1 ||
            Object.keys(details).every((key) => key === "readFiles" || key === "modifiedFiles")
          ) {
            for (const [field, destination] of [
              ["readFiles", event.preparation.fileOps.read],
              ["modifiedFiles", event.preparation.fileOps.edited],
            ] as const) {
              const files = details[field];
              if (
                Array.isArray(files) &&
                files.every((file): file is string => typeof file === "string")
              )
                for (const file of files) destination.add(file);
            }
          }
        }
        const result = await compact(
          event.preparation,
          model,
          auth.apiKey,
          headers,
          event.customInstructions,
          signal,
          level,
          // ModelRuntime owns the selected provider's auth and API wire format.
          (m, context, requestOptions) =>
            runtime.streamSimple(m, context, summaryRequestOptions(m, "context", requestOptions)),
          auth.env,
          options.retry,
          options.callbacks,
          ctx.sessionManager.getSessionId(),
        );
        signal.throwIfAborted();
        return {
          compaction: {
            ...result,
            details: { ...(record(result.details) ? result.details : {}), piGuiSummaryVersion: 1 },
          },
        };
      } catch (error) {
        // Never silently switch to the chat model or rewrite history on a failed selection.
        if (event.signal.aborted) return { cancel: true };
        const cause: unknown = signal?.aborted ? signal.reason : error;
        const message = model
          ? explainModelRequestFailure(cause, model, level).message
          : safeRequestError(cause);
        try {
          options.onError?.(message);
        } catch {
          /* Presentation failure must not permit a model fallback. */
        }
        try {
          ctx.ui.notify(`Context compaction failed: ${message}`, "error");
        } catch {
          /* Best effort; native history still stays intact. */
        }
        return { cancel: true };
      }
    });
  };
}
