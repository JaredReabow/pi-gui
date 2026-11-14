# Context compaction progress

Context compaction is different from the collapsed [AI work summaries](ai-work-summaries.md). It creates a native Pi context checkpoint while preserving the original session log and the SDK's kept-entry boundaries.

## While context is being summarized

The composer shows an **indeterminate progress bar**, the native stage, elapsed time, selected summary model/API and effective SDK reasoning mode. When the SDK schedules a transient-error retry, the bar shows its real retry budget and backoff countdown. Pi does not supply a fractional completion estimate, so the app does not invent a percentage.

The composer remains editable, but sending is held until compaction ends. Text, annotations and attachments are kept; pressing Enter does not queue a duplicate prompt or consume the draft. Main-process and native-driver admission checks also protect stale-window and asynchronous send races.

**Stop compaction** uses Pi's native abort and wait-for-idle path, including cancellation during retry backoff. Manual compaction is stoppable even when no assistant reply is streaming. It does not report a completed assistant turn or play a completion chime. Navigation to another thread remains usable; progress belongs only to the thread performing compaction.

A split-turn compaction can generate two summaries in sequence: history, then the earlier part of the current turn. The entire operation, including native retry waits, has a **10-minute total budget**; it is not cut off after two minutes while the model is still producing the second summary. This is a safety limit, not an expected duration. Stop remains available throughout, and a timeout saves no partial checkpoint.

## Failure and recovery

If compaction fails, the original history and unsent input remain intact. Error details distinguish provider/configuration failures from cancellation and show the model/API/reasoning setting without exposing authentication values. No partial or failed checkpoint is saved.

**Retry compaction** starts an explicit manual attempt using the current summary-model selection and the original manual focus instructions. It does not consume the text, images or annotations currently in the composer. Automatic transient retries remain owned by the released SDK and its session retry settings, not a second application retry loop. These settings are separate from the four-attempt visual work-summary budget.

Successful automatic overflow recovery continues through Pi's native turn lifecycle; the app does not resubmit a user prompt or replay historical tools. Manual compaction does not resume an interrupted assistant turn. Runtime-only activity is not restored as a phantom in-progress job after an application restart.

## Verification

- SDK behavior: `packages/pi-sdk-driver/test/{compaction-progress,summary-compaction,summary-request}.test.mts`.
- Credential-free Electron lifecycle, draft/image retention, thread switching, Stop, Retry and restart: `apps/desktop/tests/core/compaction-progress.spec.ts`.
- Existing summary/cache, queued-input, Stop and transcript synchronization tests cover adjacent behavior.

Fixture-backed Electron and payload captures are not proof of every external provider. Real-provider adapter calls, packaged execution and native operating-system behavior are separate verification surfaces.
