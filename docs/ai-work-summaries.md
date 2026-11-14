# AI work summaries and compaction model

Completed user turns can display one collapsed AI-generated work summary, with the original tools, commentary, failures and final response retained. Expand the bar to inspect the original work. Settings → General → **AI work summaries** enables or disables this presentation feature; it does not disable context compaction.

The composer **Summary model** picker is independent of the chat model. **Same as chat** follows the current chat selection; explicit overrides persist per thread. The same selection applies to manual and automatic Pi context compaction through the released SDK compaction hook, without changing the active chat model or kept-entry boundaries.

Visual requests use the session's model runtime and credentials, with semantic deduplication and caching, bounded input/output, and at most 300 cached results. Only the newest three completed spans automatically generate on mount; older spans require an explicit request.

## Reasoning and API compatibility

New visual and context summaries default to **medium** reasoning independently of the chat's reasoning setting. The released SDK clamps that preference to the model's declared supported levels; non-reasoning models omit the reasoning option. The selected session's `ModelRuntime` handles provider authentication and API-specific serialization, including Responses effort, Chat Completions effort and token-budget-based thinking. No provider or chat-model switch is used to hide an error.

Visual summaries remain concise, but reasoning models receive an allowance of up to 8,192 tokens rather than a 600-token combined answer/reasoning budget. The SDK maps this provider-neutral allowance to the API: budget-based APIs may reserve additional thinking tokens within the real model's declared total ceiling. The model's maximum stays intact so budget-based APIs retain room for the answer. Non-reasoning visual summaries retain a 600-token limit. Empty, token-cap-truncated or tool-call responses are not saved as successful summaries; summary requests never execute tools. Expanded new work summaries show their API and effective SDK reasoning mode, which survives caching/restart. Older cached summaries remain usable without invented request metadata.

Failures distinguish unsupported settings, generic request rejection, authentication/access, balance/quota, rate limits, service failures, context limits, timeout and cancellation. Details include the selected model, API and effective reasoning mode with credential-bearing endpoints and authorization values redacted. A generic HTTP 400 is not presented as proof of a connection failure or corrupt history.

See [context compaction progress](compaction-progress.md) for native stages, Stop, draft protection and explicit Retry.

A generation failure automatically retries **three times** after delays of **1, 2 and 4 seconds**: four attempts total, each with a fresh 45-second deadline. Up to two requests run concurrently; additional work queues fairly (at most 300 pending summaries), and a retry releases its slot while waiting. Concurrent windows share the same request and retry budget. Cancellation, disabling summaries, shutdown, or changing the applicable model stops pending attempts. Successful summaries are saved and reused after restart. After all four attempts fail, the work remains expandable and **Retry AI summary** starts a fresh bounded cycle. A cache-storage failure does not trigger another model request automatically.

## Completed-answer synchronization

Streaming text is provisional. Complete assistant text reconciles the visible row when the model message ends and again with its native persisted identity. A settled run and an idle transcript read also repair missing replies from the SDK's canonical branch projection, without resending prompts or rerunning tools. Recovery preserves display identities, tools, cards, queued messages and stopped partial output; stale asynchronous reads cannot overwrite intervening transcript mutations or newer observed runs. Final answers stay outside the collapsed work summary.

## Verification

- Desktop units: `apps/desktop/tests/unit/{work-summaries,work-summary-retries,transcript-reconciliation,transcript-source-identity}.spec.ts`.
- Native SDK final-only/partial output: `packages/pi-sdk-driver/test/pi-boundary-lifecycle.test.mts`.
- Deterministic Electron synchronization, background completion, automatic retries and restart: `apps/desktop/tests/core/transcript-sync-retries.spec.ts`.
- Fixture-backed Electron flow and restart: `apps/desktop/tests/core/work-summaries.spec.ts`.
- Explicit real-provider proof: `apps/desktop/tests/live/work-summaries.spec.ts`.
- Native SDK compaction routing/capabilities: `packages/pi-sdk-driver/test/{summary-compaction,summary-request,compaction-progress}.test.mts`.
- Native lifecycle through the Electron surface: `apps/desktop/tests/core/compaction-progress.spec.ts`.

Live tests require explicit real-auth opt-in. Passing fixture tests alone does not establish external-provider behavior. Local evidence and packaged application bundles are not part of the repository.
