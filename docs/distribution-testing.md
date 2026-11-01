# Distribution Testing

The distribution harness is the common entry point for the release programme described in
`PI_GUI_IMPLEMENTATION_PLAN.md`. It keeps one module per required product area while preserving
the evidence layer that actually ran. A green unit check does not stand in for Electron, native,
provider, uploaded-artifact, production-ingestion, or clean-machine proof.

## Run The Foundation

List the canonical modules:

```sh
node scripts/distribution/run-harness.mjs --list
```

Run one or more modules and retain structured evidence under a fresh directory:

```sh
node scripts/distribution/run-harness.mjs \
  --module feature-parity,performance \
  --evidence-dir .artifacts/distribution-harness/review-run
```

The current foundation registers unimplemented adapters as `not-run` and reports the feature-parity
Electron doctor as `blocked` when Electron or the existing build is unavailable. Running either
state exits nonzero and writes `runner-summary.json`; neither state can become a pass.

Run the isolated runner contract checks:

```sh
node --test scripts/distribution/run-harness.test.mjs
```

Those checks cover the complete canonical module registry, continuation after a mixed failure,
nonzero aggregation, explicit blocked and not-run results, missing-evidence rejection, and the
credential-free/test-telemetry environment.

## Canonical Modules

| Module           | Required evidence layers                                     |
| ---------------- | ------------------------------------------------------------ |
| `feature-parity` | unit/contract, fixture-backed Electron                       |
| `setup`          | unit/contract, fixture-backed Electron, clean machine        |
| `accounts`       | unit/contract, live provider                                 |
| `permissions`    | unit/contract, native OS, clean machine                      |
| `workers`        | unit/contract, live provider                                 |
| `mcp`            | unit/contract, fixture-backed Electron, companion            |
| `telemetry`      | unit/contract, production ingestion                          |
| `donations`      | unit/contract, fixture-backed Electron                       |
| `lifecycle`      | unit/contract, fixture-backed Electron, clean machine        |
| `packaging`      | unit/contract, uploaded artifact verification, clean machine |
| `website`        | fixture-backed browser, uploaded artifact verification       |
| `performance`    | unit/contract, fixture-backed Electron                       |
| `privacy`        | unit/contract, clean machine                                 |

The adapter owns the command, fixture, or external gate for each required layer. An adapter adds
a check only through the runner API in `scripts/distribution/run-harness.mjs`; it must not
duplicate status aggregation or environment policy.

The runner replaces the exact `{evidenceDir}` argument token with its owned run directory before
starting an adapter. Command adapters may declare exit codes for `blocked` and `not-run`; all
other nonzero exits are failures.

Command adapters are spawned in an owned POSIX process group or Windows PID-rooted process tree.
`timeoutMs` defaults to 15 minutes. On timeout or cancellation, the runner first sends graceful
termination to the owned root, waits `gracefulTerminationMs` (default 2 seconds), then force-kills
the owned group/tree when required and waits up to `forceTerminationMs` (default 5 seconds). The
check fails only after writing a log that records escalation and whether cleanup was confirmed.
Later checks still run. The runner never terminates by executable or application name.
Spawn-time `ENOENT`, `EACCES`, and `ENOEXEC` failures are normalized as owned-process startup
failures. They retain a check log with `ownership=unspawned` and `cleanup=not-applicable`; no PID or
process group is signaled when the executable never started.

Programmatic `check.run` callbacks require an explicit positive `timeoutMs` and receive an
`AbortSignal`. They support bounded in-process work only. Any callback that needs child processes
must use a command adapter or the shared `process-control.mjs` API so descendant ownership and
cleanup remain enforceable; a non-cooperative callback cannot own the harness indefinitely.

The background Electron and Playwright wrappers also spawn their Playwright process as an owned
group/tree. They handle `SIGINT` and `SIGTERM`, abort the child execution, wait for confirmed
cleanup or record a cleanup failure, and return a nonzero interruption status. Wrapper timeouts
expire before their parent command deadlines, leaving time to reap Playwright and Electron
descendants.

## Result Contract

Every check and module returns one of:

- `pass`: the check ran and returned at least one existing evidence file inside the owned run
  directory.
- `fail`: the adapter ran but failed, threw, timed out, or claimed a pass without evidence.
- `blocked`: an explicit prerequisite prevented the check from running.
- `not-run`: a known check or evidence layer was deliberately not invoked.

The overall result uses the same values. `fail` takes precedence, then `blocked`, then
`not-run`. Only an all-`pass` run exits zero. The CLI exit codes are `0` for pass, `1` for fail,
`2` for blocked or invalid invocation, and `3` for not-run.

The runner executes every check in every selected module after a failure. It writes the
structured module/check summary and command logs under the evidence directory. A missing evidence
path, a path outside the owned run directory, or an omitted reason for blocked/not-run is a
failure.

## Background Electron Proof

`apps/desktop/tests/helpers/electron-app.ts` keeps foreground verification behavior available,
and applies isolation checks automatically to every `testMode: "background"` launch:

- Electron main PID equals the Playwright-owned child PID.
- `app.getPath("userData")` equals the caller's isolated profile.
- Development launches resolve `app.getAppPath()` to this checkout's `apps/desktop`.
- Every initial owned window is present, visible/focused false, and not destroyed.
- Renderer `document.hasFocus()` is retained as diagnostics; a hidden window may retain logical
  document focus even though the native window is hidden and unfocused.
- The main process reports `PI_APP_TEST_MODE=background`.
- `DO_NOT_TRACK=1`, `OTEL_SDK_DISABLED=true`, and
  `PI_APP_TEST_TELEMETRY=disabled` are present.

`harness.inspectIdentity()` returns the doctor record. `harness.close()` returns only after the
owned child has an exit code or signal and remains idempotent. Its result includes the owned PID
and exit status for `cleanup.json`.

Run the fixture-backed Electron doctor directly after the desktop build:

```sh
node scripts/distribution/check-background-electron.mjs \
  --evidence-dir .artifacts/distribution-harness/my-electron-doctor

./node_modules/.bin/playwright test \
  -c apps/desktop/playwright.config.ts \
  apps/desktop/tests/unit/distribution-background-launcher.spec.ts
```

The wrapper checks the installed Electron package and existing build before invoking the doctor.
`--help` prints usage without launching Electron; unsupported arguments exit nonzero without
starting the test. An explicit `--evidence-dir` is created exactly once, so callers and the
combined runner can retain doctor and cleanup files beside their own evidence.
The wrapper also writes `process-cleanup.json` for the Playwright process tree.
The doctor launches a hidden window, opens only the isolated temporary profile and workspace,
records `background-doctor.json`, and writes the verified `background-cleanup.json`. It uses the
development Electron binary, so its evidence is fixture-backed Electron, not a packaged or
installed-app test.

## Credentials And Telemetry

The runner removes provider credentials, Pi account directories, explicit real-auth source paths,
and Sentry/PostHog settings from command environments. Electron helpers also scrub provider
credentials by class. Logs redact known secret values, but adapters still must avoid passing private
inputs, local account data, private endpoints, research material, or production identifiers to test
commands.

Automated tests force production telemetry transport disabled. The canonical telemetry module
runs `apps/desktop/tests/unit/telemetry.spec.ts` (30 tests),
`apps/desktop/tests/unit/telemetry-loopback.spec.ts` (1 test), and
`apps/desktop/tests/unit/telemetry-v01b.spec.ts` (13 tests) through a shared Playwright adapter.
The adapter requires each exact count, inspects Playwright's JSON result, and reports `not-run`
rather than pass when no test ran or any test was skipped.

The focused telemetry suite has one optional canonical-source provenance check. Set
`PI_GUI_TELEMETRY_CONTRACT` and `PI_GUI_TELEMETRY_SERVICE` to hash the authoritative files; without
them that suite remains `not-run`. Loopback receipt evidence proves isolated test transport only.
Production ingestion remains a separate, human-authorized `production-ingestion` evidence layer.

## Evidence Boundaries

Keep these claims separate in the final report:

- unit and contract checks
- deterministic runtime integration
- fixture-backed Electron
- native OS behavior
- live provider and companion behavior
- uploaded artifact verification
- production ingestion receipts
- clean-machine acceptance

A build, a listed test, a skipped test, an open dialog, a local package, a successful upload call,
or a server health response does not promote a blocked layer to a pass. GUI work is not complete
until the relevant real Electron path passes; release work is not complete until the required
packaged-artifact, upload receipt, and clean-machine layers pass.
