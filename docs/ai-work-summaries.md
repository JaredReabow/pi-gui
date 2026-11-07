# AI work summaries and compaction model

Completed user turns can display one collapsed AI-generated work summary, with the original tools, commentary, failures and final response retained. Expand the bar to inspect the original work. Settings → General → **AI work summaries** enables or disables this presentation feature; it does not disable context compaction.

The composer **Summary model** picker is independent of the chat model. **Same as chat** follows the current chat selection; explicit overrides persist per thread. The same selection applies to manual and automatic Pi context compaction through the released SDK compaction hook, without changing the active chat model or kept-entry boundaries.

Visual requests use the session's model runtime and credentials, with deduplication, semantic caching, cancellation, a 45-second deadline, two concurrent requests, bounded input/output, and at most 300 cached results. Only the newest three completed spans automatically generate on mount; older spans require an explicit request. Failures offer an explicit retry instead of a render-loop retry.

## Verification

- Desktop units: `apps/desktop/tests/unit/work-summaries.spec.ts`.
- Fixture-backed Electron flow and restart: `apps/desktop/tests/core/work-summaries.spec.ts`.
- Explicit real-provider proof: `apps/desktop/tests/live/work-summaries.spec.ts`.
- Native SDK compaction routing: `packages/pi-sdk-driver/test/summary-compaction.test.mts`.

Live tests require explicit real-auth opt-in. Passing fixture tests alone does not establish external-provider behavior. Local evidence and packaged application bundles are not part of the repository.
