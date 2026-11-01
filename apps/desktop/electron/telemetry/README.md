# Desktop Telemetry Owner

This directory is the standalone schema-2 telemetry implementation. It does not
import Electron, main-process startup code, UI, update policy, or a production
endpoint. Application wiring must supply a validated app identity and every
runtime dependency explicitly.

## Integration Contract

Call `telemetry_initialize()` from the desktop main process with:

- a release or development `operationalEnabled` decision;
- the configured app identity, including the app's real version and running
  platform/architecture;
- the intake base URL and the current disclosure version;
- the app-owned stable crash-code allowlist;
- injected persistence, clock, randomness, transport, and fixed-category logger.

Operational enablement is not consent. Both consent gates start false. No install
identity, capture, queue entry, or request is created while the relevant consent
and operational gates are closed.

Create one owner for the main-process lifetime. On normal shutdown, call
`telemetry_session_end()` before `telemetry_shutdown()`. Call
`telemetry_flush_due()` from due launch, resume, retry, or timer callbacks; the
owner coalesces concurrent calls and schedules no tight retry loop.

When a persisted destination failure is repaired, `telemetry_operational_set(true)`
clears the local suspension and permits work under the existing consent. A UI
consent change must call `telemetry_consent_set()` so the owner increments its
cancellation generation and aborts stale in-flight work. Setting the operational
gate false immediately aborts delivery and clears pending records while leaving
the user's stored consent choice intact.

## Metric Mapping

- `tool-call-started` increments `usage.toolCalls` once when an agent tool
  invocation actually starts. Call it once per invocation.
- `user-activity` marks the current UTC date active. Repeated activity on the
  same UTC day increments `usage.activeDays` only once.
- `usage.browserSessions` remains zero because this product has no reliable
  owned browser-session concept.
- `telemetry_error_record()` accepts only a fixed crash kind and stable code.
  Values outside the configured allowlist map to `telemetry.unknown`. Never pass
  exception messages, stacks, paths, URLs, commands, content, or user input.

Usage counters are cumulative for the current consent/identity period and
saturate at the canonical contract maxima. Repeated snapshots must not be summed
by analysts.

## Suggested Disclosure

> pi-gui can send optional aggregate usage and crash data to help improve the
> app. Usage sharing sends a random installation ID, app version and platform,
> process uptime, tool-call count, and active-day count. Crash sharing sends a
> random installation ID, app metadata, a fixed error category, an opaque
> fingerprint, and an occurrence count. The server adds coarse country/region
> information. Usage is retained for up to 90 days and crash records for up to
> 30 days, subject to shared storage limits and backups. No message, prompt,
> response, file content, path, URL, account identifier, or credential is sent.
> You can enable the streams independently and turn them off in Settings.
> Turning reporting off clears the local identity and pending data; records
> already received cannot be recalled because the service has no deletion API.

The final UI copy must use the product's localization path and a reviewed
disclosure version before enabling either choice.

## Persistence And Delivery

The injected persistence adapter must atomically store the opaque state passed to
`save()` in app-private storage. JSON serializer choice belongs to that adapter.
Do not log the state. Persisted active consent without the current disclosure
version is rejected and the owner starts with both choices off.

The fetch adapter supplied by `telemetry_fetch_transport()` uses manual redirect
handling, omits credentials and cookies, sends only `Content-Type`, and keeps the
platform TLS verifier enabled. HTTP is accepted only for an explicitly injected
loopback base URL.

Delivery is at least once and may duplicate a request if a response is lost.
There is no idempotency key or exact-once claim. Queue records never contain
free-form diagnostics.

Permanent usage rejections drop the rejected snapshot and persist a bounded
cooldown before another due snapshot is considered. Numeric and HTTP-date
`Retry-After` values, plus client jitter, are capped by
`TELEMETRY_RETRY_MAX_MS`.

Consent withdrawal returns `true` only after the persistence adapter durably
stores the resulting consent state. Full withdrawal may clear or replace state;
partial withdrawal stores replacement state while preserving the still-allowed
stream. Failed persistence returns `false`, reports `revocationPending` and
`pendingWithdrawal`, leaves the withdrawn stream closed in memory, and blocks
recreation with the same persistence object from restoring stale consent. A real
process restart cannot be made safe if the persistent store remains unwritable;
the integration must surface that local storage fault and retry withdrawal when
the store recovers.

Crash requests are dispatched as occurrence-count snapshots. ACK subtracts only
the sent count, permanent rejection retains occurrences added during the
request, and transient failure retries the current aggregate. Delivery remains
at least once: a lost success response can still duplicate a later attempt.

## Activation Boundary

No app ID is selected by this module. Application owners must supply and approve
the real identity. Source tests and the loopback receipt do not prove application
wiring, packaged-app behavior, production delivery, store disclosure acceptance,
or retention execution.
