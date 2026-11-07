import { compact, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { SessionModelSelection, SessionRef } from "@pi-gui/session-driver";

/** One released hook covers /compact, threshold and overflow recovery. */
export function createSummaryCompactionExtension(
  workspaceId: string,
  selection: (ref: SessionRef) => Promise<SessionModelSelection | null>,
): ExtensionFactory {
  return (pi) => {
    pi.on("session_before_compact", async (event, ctx) => {
      try {
        const selected = await selection({
          workspaceId,
          sessionId: ctx.sessionManager.getSessionId(),
        });
        // Follow-chat delegates to Pi's native summarization (same model and policy).
        if (!selected) return;
        const runtime = ctx.modelRegistry;
        await runtime.refresh({ allowNetwork: false });
        const model = runtime.find(selected.provider, selected.modelId);
        if (!model)
          throw new Error(`Summary model unavailable: ${selected.provider}/${selected.modelId}`);
        const signal = AbortSignal.any([event.signal, AbortSignal.timeout(120_000)]);
        signal.throwIfAborted();
        const auth = await runtime.getApiKeyAndHeaders(model);
        if (!auth.ok) throw new Error(auth.error);
        const headers = Object.fromEntries(
          Object.entries(auth.headers ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
        const result = await compact(
          event.preparation,
          { ...model, maxTokens: Math.min(model.maxTokens || 8192, 8192) },
          auth.apiKey,
          headers,
          event.customInstructions,
          signal,
          undefined,
          (m, context, options) => runtime.streamSimple(m, context, options),
          auth.env,
        );
        signal.throwIfAborted();
        return { compaction: result };
      } catch (error) {
        // Extension errors otherwise fall through to Pi's chat model silently.
        // Cancel explicitly: keep history intact and make the selection failure visible.
        ctx.ui.notify(`Summary model compaction failed: ${String(error)}`, "error");
        return { cancel: true };
      }
    });
  };
}
