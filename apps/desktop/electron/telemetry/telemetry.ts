import { createHash } from "node:crypto";

/**
 * Schema-2 telemetry owner for the desktop main process.
 *
 * The module deliberately has no startup, IPC, UI, exception-handler, or
 * production-endpoint imports. Callers inject identity configuration, storage,
 * transport, time, randomness, and logging. Every gate defaults closed here:
 * an invalid configuration is inert, consent is false, and no request is made
 * without an explicit operational enablement and current consent.
 */

export const TELEMETRY_SCHEMA = 2;
export const TELEMETRY_MAX_QUEUE = 50;
export const TELEMETRY_MAX_CRASH_QUEUE = 10;
export const TELEMETRY_CRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TELEMETRY_USAGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const TELEMETRY_REQUEST_TIMEOUT_MS = 10_000;
export const TELEMETRY_RETRY_BASE_MS = 60_000;
export const TELEMETRY_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
export const TELEMETRY_MAX_BODY_BYTES = 8_192;
export const TELEMETRY_UNKNOWN_STABLE_CODE = "telemetry.unknown";
export const TELEMETRY_ABNORMAL_EXIT_STABLE_CODE = "telemetry.abnormal_exit";
export const TELEMETRY_PERSISTENCE_VERSION = 1;

const MAX_TOOL_CALLS = 1_000_000_000;
const MAX_BROWSER_SESSIONS = 1_000_000_000;
const MAX_ACTIVE_DAYS = 3_650;
const MAX_UPTIME_SECONDS = 4_000_000_000;
const MAX_OCCURRENCES = 1_000_000;
const MAX_REQUESTS_PER_FLUSH = 10;

const APP_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const VERSION_PATTERN = /^[0-9]{1,4}(\.[0-9]{1,4}){0,3}(-[A-Za-z0-9.]{1,32})?$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const STABLE_CODE_PATTERN = /^[a-z][a-z0-9._-]{0,95}$/;
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const TELEMETRY_CRASH_KINDS = Object.freeze([
  "uncaughtException",
  "unhandledRejection",
  "native",
  "extension",
  "other",
] as const);

export type TelemetryCrashKind = (typeof TELEMETRY_CRASH_KINDS)[number];
export type TelemetryUsageAction = "tool-call-started" | "user-activity";

export type TelemetryConsent = Readonly<{
  telemetry: boolean;
  crash: boolean;
}>;

export type TelemetryAppIdentity = Readonly<{
  id: string;
  version: string;
  platform: string;
  arch: string;
}>;

export type TelemetryConfiguration = Readonly<{
  /** Release/development readiness. This is independent from user consent. */
  operationalEnabled: boolean;
  app: TelemetryAppIdentity;
  /** Base URL before `/collect` and `/crash`, for example `https://host/telemetry`. */
  baseUrl: string;
  disclosureVersion: number;
  /** App-owned stable error-code allowlist. Unknown values map to one fixed code. */
  stableCodes: readonly string[];
}>;

export type TelemetryClock = Readonly<{
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

export type TelemetryRandom = Readonly<{
  uuid(): string;
  fraction(): number;
}>;

export type TelemetryPersistence = Readonly<{
  load(): Promise<unknown>;
  save(state: Readonly<TelemetryPersistedState>): Promise<void>;
  clear(): Promise<void>;
}>;

export type TelemetryTransportRequest = Readonly<{
  url: string;
  body: string;
  headers: Readonly<{ "Content-Type": "application/json" }>;
  signal: AbortSignal;
}>;

export type TelemetryTransportResponse = Readonly<{
  status: number;
  retryAfter: string | null;
}>;

export type TelemetryTransport = Readonly<{
  send(request: TelemetryTransportRequest): Promise<TelemetryTransportResponse>;
}>;

export type TelemetryLogger = Readonly<{
  warn(event: TelemetryLogEvent): void;
  info(event: TelemetryLogEvent): void;
}>;

export type TelemetryLogEvent =
  | "telemetry.configuration_invalid"
  | "telemetry.identity_generation_failed"
  | "telemetry.persistence_failed"
  | "telemetry.persistence_clear_failed"
  | "telemetry.schedule_failed"
  | "telemetry.transport_failed";

export type TelemetryDependencies = Readonly<{
  clock: TelemetryClock;
  random: TelemetryRandom;
  persistence: TelemetryPersistence;
  transport: TelemetryTransport;
  logger: TelemetryLogger;
}>;

type AppSnapshot = Readonly<TelemetryAppIdentity>;

type UsageCounters = Readonly<{
  toolCalls: number;
  browserSessions: number;
  activeDays: number;
}>;

type TelemetryQueueBase = Readonly<{
  id: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  app: AppSnapshot;
}>;

export type TelemetryUsageQueueRecord = TelemetryQueueBase &
  Readonly<{
    stream: "usage";
    uptimeSeconds: number;
    usage: UsageCounters;
  }>;

export type TelemetryCrashQueueRecord = TelemetryQueueBase &
  Readonly<{
    stream: "crash";
    kind: TelemetryCrashKind;
    fingerprint: string;
    occurrences: number;
  }>;

export type TelemetryQueueRecord = TelemetryUsageQueueRecord | TelemetryCrashQueueRecord;

export type TelemetryPersistedState = Readonly<{
  version: typeof TELEMETRY_PERSISTENCE_VERSION;
  consent: TelemetryConsent & Readonly<{ disclosureVersion: number | null }>;
  appId: string | null;
  installId: string | null;
  usage: UsageCounters;
  lastActiveUtcDay: string | null;
  lastUsageReportAt: number | null;
  usageRetryAt: number | null;
  usageRejectionFailures: number;
  queue: readonly TelemetryQueueRecord[];
  sessionActive: boolean;
  suspended: boolean;
}>;

export type TelemetryConfigurationSnapshot = Readonly<{
  valid: boolean;
  issue: string | null;
  operationalEnabled: boolean;
  app: AppSnapshot | null;
  baseUrl: string | null;
  disclosureVersion: number | null;
}>;

export type TelemetryQueueStatus = Readonly<{
  usage: number;
  crash: number;
  total: number;
  nextAttemptAt: number | null;
}>;

export type TelemetryStatus = Readonly<{
  operationalEnabled: boolean;
  configurationValid: boolean;
  consent: TelemetryConsent;
  identityPresent: boolean;
  queue: TelemetryQueueStatus;
  lastUsageReportAt: number | null;
  retryAt: number | null;
  suspended: boolean;
  revocationPending: boolean;
  pendingWithdrawal: TelemetryConsent | null;
  inFlight: boolean;
  lastOutcome: string | null;
}>;

/**
 * Exact, content-free owner facts needed for consent projection.
 *
 * Explicit denial is intentionally absent: owner `false` means only that the
 * runtime gate is closed. A caller that needs denial provenance must read the
 * app-owned consent service/store, never infer it from this snapshot.
 */
export type TelemetryConsentMetadata = Readonly<{
  configurationValid: boolean;
  operationalEnabled: boolean;
  disclosureVersion: number | null;
  ownerConsent: Readonly<{
    usage: boolean;
    crash: boolean;
  }>;
  identityPresent: boolean;
  queue: Readonly<{
    usage: number;
    crash: number;
    total: number;
  }>;
  suspended: boolean;
  revocationPending: boolean;
  pendingWithdrawal: Readonly<{
    usage: boolean;
    crash: boolean;
  }> | null;
  inFlight: boolean;
  lastOutcome: string | null;
}>;

export type TelemetryFlushResult = Readonly<{
  status: "idle" | "sent" | "retained" | "suspended" | "cancelled";
  attempts: number;
  acknowledged: number;
  retained: number;
}>;

export type TelemetryOwner = Readonly<{
  telemetry_configuration_get(): TelemetryConfigurationSnapshot;
  telemetry_status_get(): TelemetryStatus;
  telemetry_consent_metadata_get(): TelemetryConsentMetadata;
  telemetry_consent_get(): TelemetryConsent;
  telemetry_consent_set(
    telemetry: boolean,
    crash: boolean,
    disclosureVersion: number,
  ): Promise<boolean>;
  telemetry_operational_set(enabled: boolean): Promise<void>;
  telemetry_usage_record(action: TelemetryUsageAction): Promise<boolean>;
  telemetry_error_record(kind: TelemetryCrashKind, stableCode: string): Promise<boolean>;
  telemetry_session_start(): Promise<boolean>;
  telemetry_session_end(): Promise<void>;
  telemetry_flush_due(): Promise<TelemetryFlushResult>;
  telemetry_identity_reset(): Promise<void>;
  telemetry_shutdown(): void;
}>;

type ValidatedConfiguration = Readonly<{
  config: TelemetryConfiguration | null;
  issue: string | null;
}>;

type PendingWithdrawal = Readonly<{
  withdrawn: TelemetryConsent;
  targetConsent: TelemetryConsent;
  disclosureVersion: number;
}>;

/**
 * A failed storage write cannot be undone, but keeping the withdrawal intent
 * here prevents recreation with the same persistence object from restoring
 * stale consent during this process. A full process restart can only be safe
 * once the app-private store accepts the withdrawal again.
 */
const pendingWithdrawals = new WeakMap<TelemetryPersistence, PendingWithdrawal>();

/**
 * Builds the published privacy-safe crash fingerprint. Callers must only pass
 * app-owned stable codes, never exception text, paths, URLs, or user content.
 */
export function telemetry_fingerprint(
  appId: string,
  kind: TelemetryCrashKind,
  stableCode: string,
): string {
  const material = `${appId}|fingerprint-v1|${kind}|${stableCode}`;
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * Creates the production-safe fetch adapter. Telemetry always uses a manual
 * redirect policy, omits credentials and cookies, and sends no inherited auth.
 */
export function telemetry_fetch_transport(fetchImpl: typeof globalThis.fetch): TelemetryTransport {
  return Object.freeze({
    async send(request: TelemetryTransportRequest): Promise<TelemetryTransportResponse> {
      // Electron's RequestInit typings omit the standard Fetch `cache` option.
      // An inferred object preserves it at runtime while remaining structurally
      // compatible with the narrower declared parameter.
      const requestInit = {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: request.signal,
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
      } satisfies RequestInit & { cache: "no-store" };
      const response = await fetchImpl(request.url, requestInit);
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
      };
    },
  });
}

/** Public factory. Invalid configuration produces an inert owner, never a throw. */
export async function telemetry_initialize(
  configuration: TelemetryConfiguration,
  dependencies: TelemetryDependencies,
): Promise<TelemetryOwner> {
  const validation = validateConfiguration(configuration);
  const owner = new TelemetryOwnerImplementation(validation.config, validation.issue, dependencies);
  await owner.initialize();
  return owner;
}

class TelemetryOwnerImplementation implements TelemetryOwner {
  private configuration: TelemetryConfiguration | null;
  private readonly configurationIssue: string | null;
  private readonly dependencies: TelemetryDependencies;
  private readonly startedAt: number;
  private state: TelemetryPersistedState;
  private recordSequence = 0;
  private mutationTail: Promise<void> = Promise.resolve();
  private flushPromise: Promise<TelemetryFlushResult> | null = null;
  private timer: unknown = undefined;
  private inFlightAbort: AbortController | null = null;
  private generation = 0;
  private shutDown = false;
  private revocationPending = false;
  private pendingWithdrawal: TelemetryConsent | null = null;
  private lastOutcome: string | null = null;

  constructor(
    configuration: TelemetryConfiguration | null,
    configurationIssue: string | null,
    dependencies: TelemetryDependencies,
  ) {
    this.configuration = configuration;
    this.configurationIssue = configurationIssue;
    this.dependencies = dependencies;
    this.startedAt = dependencies.clock.now();
    this.state = initialState();
  }

  async initialize(): Promise<void> {
    if (!this.configuration) {
      this.warn("telemetry.configuration_invalid");
      return;
    }

    try {
      const decoded = decodePersistedState(
        await this.dependencies.persistence.load(),
        this.configuration.disclosureVersion,
      );
      if (decoded) {
        this.state = decoded;
      }
    } catch {
      this.warn("telemetry.persistence_failed");
    }

    if (
      this.state.consent.disclosureVersion !== null &&
      this.state.consent.disclosureVersion !== this.configuration.disclosureVersion
    ) {
      this.state = initialState();
      await this.persist();
    } else if (this.state.appId !== null && this.state.appId !== this.configuration.app.id) {
      this.state = initialState();
      await this.persist();
    }

    const pendingWithdrawal = pendingWithdrawals.get(this.dependencies.persistence);
    if (pendingWithdrawal) {
      this.state =
        pendingWithdrawal.targetConsent.telemetry || pendingWithdrawal.targetConsent.crash
          ? applyConsentState(this.state, {
              ...pendingWithdrawal.targetConsent,
              disclosureVersion: this.configuration.disclosureVersion,
            })
          : initialState(this.configuration.disclosureVersion);
      this.revocationPending = true;
      this.pendingWithdrawal = pendingWithdrawal.withdrawn;
      const durable =
        !pendingWithdrawal.targetConsent.telemetry && !pendingWithdrawal.targetConsent.crash
          ? await this.persistWithdrawal()
          : await this.persist();
      if (durable) {
        pendingWithdrawals.delete(this.dependencies.persistence);
        this.revocationPending = false;
        this.pendingWithdrawal = null;
        this.lastOutcome = "withdrawn";
      } else {
        this.lastOutcome = "withdrawal-not-durable";
      }
    } else {
      const queueBeforeBounds = this.state.queue.length;
      this.boundQueue();
      if (this.state.queue.length !== queueBeforeBounds) {
        await this.persist();
      }
    }

    if (this.state.sessionActive) {
      await this.clearSessionMarker();
      if (this.crashAllowed()) {
        await this.enqueueCrash("other", TELEMETRY_ABNORMAL_EXIT_STABLE_CODE, true);
      }
    }
    this.scheduleNext();
  }

  telemetry_configuration_get(): TelemetryConfigurationSnapshot {
    if (!this.configuration) {
      return {
        valid: false,
        issue: this.configurationIssue,
        operationalEnabled: false,
        app: null,
        baseUrl: null,
        disclosureVersion: null,
      };
    }
    return {
      valid: true,
      issue: null,
      operationalEnabled: this.configuration.operationalEnabled,
      app: { ...this.configuration.app },
      baseUrl: this.configuration.baseUrl,
      disclosureVersion: this.configuration.disclosureVersion,
    };
  }

  telemetry_status_get(): TelemetryStatus {
    const usage = this.state.queue.filter((record) => record.stream === "usage").length;
    const crash = this.state.queue.length - usage;
    const retryTimes = this.state.queue
      .map((record) => record.nextAttemptAt)
      .filter((time) => time > this.dependencies.clock.now());
    if (
      this.state.usageRetryAt !== null &&
      this.state.usageRetryAt > this.dependencies.clock.now()
    ) {
      retryTimes.push(this.state.usageRetryAt);
    }
    return {
      operationalEnabled: this.operationalEnabled(),
      configurationValid: this.configuration !== null,
      consent: this.consentSnapshot(),
      identityPresent: this.state.installId !== null,
      queue: {
        usage,
        crash,
        total: this.state.queue.length,
        nextAttemptAt: retryTimes.length ? Math.min(...retryTimes) : null,
      },
      lastUsageReportAt: this.state.lastUsageReportAt,
      retryAt: retryTimes.length ? Math.min(...retryTimes) : null,
      suspended: this.state.suspended,
      revocationPending: this.revocationPending,
      pendingWithdrawal: this.pendingWithdrawal && { ...this.pendingWithdrawal },
      inFlight: this.inFlightAbort !== null,
      lastOutcome: this.lastOutcome,
    };
  }

  telemetry_consent_metadata_get(): TelemetryConsentMetadata {
    const configuration = this.telemetry_configuration_get();
    const status = this.telemetry_status_get();
    return {
      configurationValid: status.configurationValid,
      operationalEnabled: status.operationalEnabled,
      disclosureVersion: configuration.disclosureVersion,
      ownerConsent: {
        usage: status.consent.telemetry,
        crash: status.consent.crash,
      },
      identityPresent: status.identityPresent,
      queue: {
        usage: status.queue.usage,
        crash: status.queue.crash,
        total: status.queue.total,
      },
      suspended: status.suspended,
      revocationPending: status.revocationPending,
      pendingWithdrawal: status.pendingWithdrawal
        ? {
            usage: status.pendingWithdrawal.telemetry,
            crash: status.pendingWithdrawal.crash,
          }
        : null,
      inFlight: status.inFlight,
      lastOutcome: status.lastOutcome,
    };
  }

  telemetry_consent_get(): TelemetryConsent {
    return this.consentSnapshot();
  }

  async telemetry_consent_set(
    telemetry: boolean,
    crash: boolean,
    disclosureVersion: number,
  ): Promise<boolean> {
    const withdrawing = telemetry === false && crash === false;
    if (
      !this.configuration ||
      typeof telemetry !== "boolean" ||
      typeof crash !== "boolean" ||
      !Number.isInteger(disclosureVersion) ||
      (!withdrawing && disclosureVersion !== this.configuration.disclosureVersion)
    ) {
      return false;
    }

    this.cancelInFlight();
    this.generation += 1;
    return this.serialMutation(async () => {
      if (!telemetry && !crash) {
        this.state = initialState(this.configuration!.disclosureVersion);
        this.revocationPending = true;
        this.pendingWithdrawal = { telemetry: true, crash: true };
        const durable = await this.persistWithdrawal();
        this.revocationPending = !durable;
        if (durable) {
          pendingWithdrawals.delete(this.dependencies.persistence);
          this.pendingWithdrawal = null;
        } else {
          pendingWithdrawals.set(this.dependencies.persistence, {
            withdrawn: { telemetry: true, crash: true },
            targetConsent: { telemetry: false, crash: false },
            disclosureVersion: this.configuration!.disclosureVersion,
          });
        }
        this.lastOutcome = durable ? "withdrawn" : "withdrawal-not-durable";
        this.scheduleNext();
        return durable;
      }

      this.state = applyConsentState(this.state, {
        telemetry,
        crash,
        disclosureVersion: this.configuration!.disclosureVersion,
      });
      const persisted = await this.persist();
      const withdrawn = { telemetry: !telemetry, crash: !crash };
      const hasWithdrawal = withdrawn.telemetry || withdrawn.crash;
      this.revocationPending = hasWithdrawal && !persisted;
      this.pendingWithdrawal = this.revocationPending ? withdrawn : null;
      if (persisted) {
        pendingWithdrawals.delete(this.dependencies.persistence);
      } else if (hasWithdrawal) {
        pendingWithdrawals.set(this.dependencies.persistence, {
          withdrawn,
          targetConsent: { telemetry, crash },
          disclosureVersion: this.configuration!.disclosureVersion,
        });
      }
      this.lastOutcome = persisted
        ? hasWithdrawal
          ? "withdrawn"
          : "consent-updated"
        : hasWithdrawal
          ? "withdrawal-not-durable"
          : "consent-not-durable";
      this.scheduleNext();
      return persisted;
    }, false);
  }

  async telemetry_operational_set(enabled: boolean): Promise<void> {
    if (!this.configuration || typeof enabled !== "boolean") {
      return;
    }
    this.cancelInFlight();
    this.generation += 1;
    await this.serialMutation(async () => {
      this.configuration = Object.freeze({ ...this.configuration!, operationalEnabled: enabled });
      this.state = {
        ...applyConsentState(this.state, this.state.consent),
        ...(enabled ? {} : { queue: [], usageRetryAt: null, usageRejectionFailures: 0 }),
        suspended: false,
      };
      await this.persist();
      this.scheduleNext();
    }, undefined);
  }

  async telemetry_usage_record(action: TelemetryUsageAction): Promise<boolean> {
    if (!this.usageAllowed()) {
      return false;
    }
    if (action !== "tool-call-started" && action !== "user-activity") {
      return false;
    }

    return this.serialMutation(async () => {
      if (!this.usageAllowed() || !(await this.ensureIdentity())) {
        return false;
      }
      this.pruneQueue();
      const now = this.dependencies.clock.now();
      const activeDay = action === "user-activity" ? utcDay(now) : this.state.lastActiveUtcDay;
      const nextActiveDays =
        action === "user-activity" && activeDay !== this.state.lastActiveUtcDay
          ? clamp(this.state.usage.activeDays + 1, 0, MAX_ACTIVE_DAYS)
          : this.state.usage.activeDays;
      const usage = {
        toolCalls:
          action === "tool-call-started"
            ? clamp(this.state.usage.toolCalls + 1, 0, MAX_TOOL_CALLS)
            : this.state.usage.toolCalls,
        browserSessions: 0,
        activeDays: nextActiveDays,
      };
      const shouldQueue =
        this.usageDue() || this.state.queue.some((record) => record.stream === "usage");
      this.state = {
        ...this.state,
        usage,
        lastActiveUtcDay: action === "user-activity" ? activeDay : this.state.lastActiveUtcDay,
        queue: shouldQueue
          ? coalesceUsageQueue(this.state.queue, {
              id: this.nextRecordId(),
              createdAt: now,
              attempts: 0,
              nextAttemptAt: now,
              app: this.appSnapshot(),
              stream: "usage",
              uptimeSeconds: this.uptimeSeconds(),
              usage,
            })
          : this.state.queue,
      };
      this.boundQueue();
      await this.persist();
      this.scheduleNext();
      return true;
    }, false);
  }

  async telemetry_error_record(kind: TelemetryCrashKind, stableCode: string): Promise<boolean> {
    if (!this.crashAllowed() || !TELEMETRY_CRASH_KINDS.includes(kind)) {
      return false;
    }
    return this.enqueueCrash(kind, stableCode);
  }

  async telemetry_session_start(): Promise<boolean> {
    if (!this.crashAllowed()) {
      return false;
    }
    return this.serialMutation(async () => {
      if (!this.crashAllowed() || !(await this.ensureIdentity())) {
        return false;
      }
      this.state = { ...this.state, sessionActive: true };
      await this.persist();
      return true;
    }, false);
  }

  async telemetry_session_end(): Promise<void> {
    if (!this.state.sessionActive) {
      return;
    }
    await this.clearSessionMarker();
  }

  async telemetry_flush_due(): Promise<TelemetryFlushResult> {
    if (this.flushPromise) {
      return this.flushPromise;
    }
    this.flushPromise = this.performFlush().finally(() => {
      this.flushPromise = null;
      this.scheduleNext();
    });
    return this.flushPromise;
  }

  async telemetry_identity_reset(): Promise<void> {
    this.cancelInFlight();
    this.generation += 1;
    await this.serialMutation(async () => {
      this.state = {
        ...initialState(this.state.consent.disclosureVersion),
        consent: this.state.consent,
      };
      await this.persist();
      this.scheduleNext();
    }, undefined);
  }

  telemetry_shutdown(): void {
    this.shutDown = true;
    this.generation += 1;
    this.cancelInFlight();
    this.clearScheduledTimer();
  }

  private async enqueueCrash(
    kind: TelemetryCrashKind,
    stableCode: string,
    internalStableCode = false,
  ): Promise<boolean> {
    if (!this.crashAllowed() || !TELEMETRY_CRASH_KINDS.includes(kind)) {
      return false;
    }
    return this.serialMutation(async () => {
      if (!this.crashAllowed() || !(await this.ensureIdentity())) {
        return false;
      }
      this.pruneQueue();
      const mappedCode = internalStableCode ? stableCode : this.stableCode(stableCode);
      const fingerprint = telemetry_fingerprint(this.configuration!.app.id, kind, mappedCode);
      const now = this.dependencies.clock.now();
      const app = this.appSnapshot();
      const existingIndex = this.state.queue.findIndex(
        (record) =>
          record.stream === "crash" &&
          record.kind === kind &&
          record.fingerprint === fingerprint &&
          sameApp(record.app, app),
      );
      let queue = [...this.state.queue];
      if (existingIndex >= 0) {
        const existing = queue[existingIndex];
        if (existing?.stream === "crash") {
          queue[existingIndex] = {
            ...existing,
            occurrences: clamp(existing.occurrences + 1, 1, MAX_OCCURRENCES),
          };
        }
      } else {
        queue.push({
          id: this.nextRecordId(),
          createdAt: now,
          attempts: 0,
          nextAttemptAt: now,
          app,
          stream: "crash",
          kind,
          fingerprint,
          occurrences: 1,
        });
      }
      this.state = { ...this.state, queue };
      this.boundQueue();
      await this.persist();
      this.scheduleNext();
      return true;
    }, false);
  }

  private async performFlush(): Promise<TelemetryFlushResult> {
    if (
      this.shutDown ||
      !this.configuration ||
      this.configuration.operationalEnabled !== true ||
      this.state.suspended ||
      (!this.state.consent.telemetry && !this.state.consent.crash)
    ) {
      return this.result("idle", 0, 0);
    }

    await this.queueDueUsageIfNeeded();
    let attempts = 0;
    let acknowledged = 0;

    for (let index = 0; index < MAX_REQUESTS_PER_FLUSH; index += 1) {
      if (!this.anyConsentAllowed() || !this.operationalEnabled() || this.shutDown) {
        return this.result(attempts ? "retained" : "idle", attempts, acknowledged);
      }
      const now = this.dependencies.clock.now();
      const record = this.state.queue.find(
        (candidate) => candidate.nextAttemptAt <= now && this.recordAllowed(candidate),
      );
      if (!record || !this.state.installId) {
        return this.result(attempts ? "sent" : "idle", attempts, acknowledged);
      }

      const generation = this.generation;
      const controller = new AbortController();
      this.inFlightAbort = controller;
      const body = this.serializeRecord(record);
      if (!body || Buffer.byteLength(body, "utf8") > TELEMETRY_MAX_BODY_BYTES) {
        await this.rejectRecord(record, generation, "rejected");
        attempts += 1;
        continue;
      }

      attempts += 1;
      const url = this.endpoint(record.stream);
      let response: TelemetryTransportResponse;
      try {
        response = await this.requestWithTimeout(
          {
            url,
            body,
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
          },
          controller,
        );
      } catch (error: unknown) {
        this.inFlightAbort = null;
        if (generation !== this.generation || this.shutDown) {
          return this.result("cancelled", attempts - 1, acknowledged);
        }
        const timeout =
          controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
        await this.transientFailure(record, generation, timeout ? "timeout" : "transport", null);
        return this.result("retained", attempts, acknowledged);
      }
      this.inFlightAbort = null;

      if (
        generation !== this.generation ||
        !this.anyConsentAllowed() ||
        !this.operationalEnabled() ||
        this.shutDown
      ) {
        return this.result("cancelled", attempts, acknowledged);
      }

      if (response.status >= 200 && response.status < 300) {
        await this.acknowledge(record, generation);
        acknowledged += 1;
        continue;
      }
      if (response.status === 429) {
        await this.transientFailure(record, generation, "rate-limited", response.retryAfter);
        return this.result("retained", attempts, acknowledged);
      }
      if (response.status >= 500 && response.status < 600) {
        await this.transientFailure(record, generation, "transient", response.retryAfter);
        return this.result("retained", attempts, acknowledged);
      }
      if (response.status === 401 || response.status === 403) {
        await this.suspend(record.id, generation, "configuration");
        return this.result("suspended", attempts, acknowledged);
      }
      if (response.status >= 300 && response.status < 400) {
        await this.suspend(record.id, generation, "redirect");
        return this.result("suspended", attempts, acknowledged);
      }
      if (response.status >= 400 && response.status < 500) {
        await this.rejectRecord(record, generation, "rejected");
        continue;
      }

      await this.transientFailure(record, generation, "unexpected-status", null);
      return this.result("retained", attempts, acknowledged);
    }

    return this.result(attempts ? "retained" : "idle", attempts, acknowledged);
  }

  private requestWithTimeout(
    request: TelemetryTransportRequest,
    controller: AbortController,
  ): Promise<TelemetryTransportResponse> {
    return new Promise<TelemetryTransportResponse>((resolve, reject) => {
      let settled = false;
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        try {
          this.dependencies.clock.clearTimeout(timer);
        } catch {
          this.warn("telemetry.schedule_failed");
        }
        request.signal.removeEventListener("abort", onAbort);
        return true;
      };
      const onAbort = () => {
        if (!settle()) return;
        reject(Object.assign(new Error("telemetry request aborted"), { name: "AbortError" }));
      };
      const timer = this.dependencies.clock.setTimeout(() => {
        if (!settle()) return;
        controller.abort();
        reject(Object.assign(new Error("telemetry request timed out"), { name: "AbortError" }));
      }, TELEMETRY_REQUEST_TIMEOUT_MS);
      request.signal.addEventListener("abort", onAbort, { once: true });

      void this.dependencies.transport
        .send(request)
        .then((response) => {
          if (!settle()) return;
          resolve(response);
        })
        .catch((error: unknown) => {
          if (!settle()) return;
          reject(error);
        });
    });
  }

  private async queueDueUsageIfNeeded(): Promise<void> {
    if (!this.usageAllowed() || !this.usageDue() || this.hasUsageRecord()) {
      return;
    }
    await this.serialMutation(async () => {
      if (
        !this.usageAllowed() ||
        !this.usageDue() ||
        this.hasUsageRecord() ||
        !(await this.ensureIdentity())
      ) {
        return;
      }
      this.pruneQueue();
      const now = this.dependencies.clock.now();
      this.state = {
        ...this.state,
        queue: coalesceUsageQueue(this.state.queue, {
          id: this.nextRecordId(),
          createdAt: now,
          attempts: 0,
          nextAttemptAt: now,
          app: this.appSnapshot(),
          stream: "usage",
          uptimeSeconds: this.uptimeSeconds(),
          usage: this.state.usage,
        }),
      };
      this.boundQueue();
      await this.persist();
    }, undefined);
  }

  private async acknowledge(sentRecord: TelemetryQueueRecord, generation: number): Promise<void> {
    await this.serialMutation(async () => {
      if (generation !== this.generation) return;
      const current = this.state.queue.find((candidate) => candidate.id === sentRecord.id);
      if (!current) return;
      const now = this.dependencies.clock.now();
      const crashRemainder =
        sentRecord.stream === "crash" &&
        current.stream === "crash" &&
        sameCrashGroup(sentRecord, current)
          ? current.occurrences - sentRecord.occurrences
          : 0;
      this.state = {
        ...this.state,
        queue:
          crashRemainder > 0
            ? this.state.queue.map((candidate) =>
                candidate.id === sentRecord.id && candidate.stream === "crash"
                  ? {
                      ...candidate,
                      occurrences: crashRemainder,
                      attempts: 0,
                      nextAttemptAt: now,
                    }
                  : candidate,
              )
            : this.state.queue.filter((candidate) => candidate.id !== sentRecord.id),
        lastUsageReportAt:
          sentRecord.stream === "usage"
            ? Math.max(this.state.lastUsageReportAt ?? 0, now)
            : this.state.lastUsageReportAt,
        usageRetryAt: sentRecord.stream === "usage" ? null : this.state.usageRetryAt,
        usageRejectionFailures:
          sentRecord.stream === "usage" ? 0 : this.state.usageRejectionFailures,
      };
      this.lastOutcome = "success";
      await this.persist();
    }, undefined);
  }

  private async rejectRecord(
    sentRecord: TelemetryQueueRecord,
    generation: number,
    outcome: string,
  ): Promise<void> {
    await this.serialMutation(async () => {
      if (generation !== this.generation) return;
      const current = this.state.queue.find((candidate) => candidate.id === sentRecord.id);
      const now = this.dependencies.clock.now();
      const rejectedUsage = sentRecord.stream === "usage";
      const rejectionFailures = rejectedUsage
        ? Math.min(20, this.state.usageRejectionFailures + 1)
        : this.state.usageRejectionFailures;
      const crashRemainder =
        sentRecord.stream === "crash" &&
        current?.stream === "crash" &&
        sameCrashGroup(sentRecord, current)
          ? current.occurrences - sentRecord.occurrences
          : 0;
      this.state = {
        ...this.state,
        queue:
          crashRemainder > 0
            ? this.state.queue.map((candidate) =>
                candidate.id === sentRecord.id && candidate.stream === "crash"
                  ? {
                      ...candidate,
                      occurrences: crashRemainder,
                      attempts: 0,
                      nextAttemptAt: now + this.retryDelayMs(1, now, null),
                    }
                  : candidate,
              )
            : this.state.queue.filter((candidate) => candidate.id !== sentRecord.id),
        usageRetryAt: rejectedUsage
          ? now + this.retryDelayMs(rejectionFailures, now, null)
          : this.state.usageRetryAt,
        usageRejectionFailures: rejectionFailures,
      };
      this.lastOutcome = outcome;
      await this.persist();
    }, undefined);
  }

  private async transientFailure(
    sentRecord: TelemetryQueueRecord,
    generation: number,
    outcome: string,
    retryAfter: string | null,
  ): Promise<void> {
    await this.serialMutation(async () => {
      if (generation !== this.generation) return;
      const now = this.dependencies.clock.now();
      const queue = this.state.queue.map((record) => {
        if (record.id !== sentRecord.id) return record;
        const attempts = record.attempts + 1;
        const delay = this.retryDelayMs(attempts, now, retryAfter);
        return { ...record, attempts, nextAttemptAt: now + delay };
      });
      this.state = { ...this.state, queue };
      this.lastOutcome = outcome;
      await this.persist();
    }, undefined);
  }

  private async suspend(recordId: string, generation: number, outcome: string): Promise<void> {
    await this.serialMutation(async () => {
      if (generation !== this.generation) return;
      const record = this.state.queue.find((candidate) => candidate.id === recordId);
      this.state = {
        ...this.state,
        suspended: true,
        queue: record
          ? this.state.queue.map((candidate) =>
              candidate.id === recordId
                ? {
                    ...candidate,
                    attempts: candidate.attempts + 1,
                    nextAttemptAt: Number.MAX_SAFE_INTEGER,
                  }
                : candidate,
            )
          : this.state.queue,
      };
      this.lastOutcome = outcome;
      await this.persist();
    }, undefined);
  }

  private serializeRecord(record: TelemetryQueueRecord): string | null {
    const configuration = this.configuration;
    const installId = this.state.installId;
    if (!configuration || !installId) return null;
    if (record.stream === "usage") {
      return JSON.stringify({
        schema: TELEMETRY_SCHEMA,
        installId,
        app: appWire(record.app),
        runtime: { uptimeSeconds: record.uptimeSeconds },
        usage: { ...record.usage },
        consent: this.consentSnapshot(),
      });
    }
    return JSON.stringify({
      schema: TELEMETRY_SCHEMA,
      installId,
      app: appWire(record.app),
      kind: record.kind,
      fingerprint: record.fingerprint,
      occurrences: record.occurrences,
      consent: this.consentSnapshot(),
    });
  }

  private endpoint(stream: "usage" | "crash"): string {
    return `${this.configuration!.baseUrl}/${stream === "usage" ? "collect" : "crash"}`;
  }

  private async ensureIdentity(): Promise<boolean> {
    if (this.state.installId) return true;
    let candidate: string;
    try {
      candidate = this.dependencies.random.uuid().toLowerCase();
    } catch {
      this.warn("telemetry.identity_generation_failed");
      return false;
    }
    if (!UUID_V4_PATTERN.test(candidate)) {
      this.warn("telemetry.identity_generation_failed");
      return false;
    }
    this.state = {
      ...this.state,
      appId: this.configuration!.app.id,
      installId: candidate,
    };
    return true;
  }

  private appSnapshot(): AppSnapshot {
    return { ...this.configuration!.app };
  }

  private stableCode(stableCode: string): string {
    if (!this.configuration || typeof stableCode !== "string") {
      return TELEMETRY_UNKNOWN_STABLE_CODE;
    }
    return this.configuration.stableCodes.includes(stableCode)
      ? stableCode
      : TELEMETRY_UNKNOWN_STABLE_CODE;
  }

  private nextRecordId(): string {
    const now = this.dependencies.clock.now();
    this.recordSequence += 1;
    try {
      const candidate = this.dependencies.random.uuid().toLowerCase();
      if (candidate && !this.state.queue.some((record) => record.id === candidate)) {
        return candidate;
      }
    } catch {
      // The fallback remains local and unique within this owner's lifetime.
    }
    const suffix = Math.floor(this.randomFraction() * 1e9);
    return `record-${now.toString(36)}-${suffix.toString(36)}-${this.recordSequence.toString(36)}`;
  }

  private uptimeSeconds(): number {
    const elapsed = this.dependencies.clock.now() - this.startedAt;
    return clamp(Math.max(0, Math.floor(elapsed / 1000)), 0, MAX_UPTIME_SECONDS);
  }

  private usageDue(): boolean {
    if (
      this.state.usageRetryAt !== null &&
      this.dependencies.clock.now() < this.state.usageRetryAt
    ) {
      return false;
    }
    return (
      this.state.lastUsageReportAt === null ||
      this.dependencies.clock.now() >= this.state.lastUsageReportAt + TELEMETRY_USAGE_INTERVAL_MS
    );
  }

  private hasUsageRecord(): boolean {
    return this.state.queue.some((record) => record.stream === "usage");
  }

  private pruneQueue(): void {
    const cutoff = this.dependencies.clock.now() - TELEMETRY_CRASH_TTL_MS;
    const queue = this.state.queue.filter(
      (record) => record.stream !== "crash" || record.createdAt >= cutoff,
    );
    this.state = { ...this.state, queue };
  }

  private boundQueue(): void {
    this.pruneQueue();
    let queue = [...this.state.queue];
    while (queue.filter((record) => record.stream === "crash").length > TELEMETRY_MAX_CRASH_QUEUE) {
      const oldestCrashIndex = queue.findIndex((record) => record.stream === "crash");
      if (oldestCrashIndex < 0) break;
      queue.splice(oldestCrashIndex, 1);
    }
    if (queue.length > TELEMETRY_MAX_QUEUE) {
      queue.splice(0, queue.length - TELEMETRY_MAX_QUEUE);
    }
    this.state = { ...this.state, queue };
  }

  private recordAllowed(record: TelemetryQueueRecord): boolean {
    return record.stream === "usage" ? this.usageAllowed() : this.crashAllowed();
  }

  private operationalEnabled(): boolean {
    return (
      !this.shutDown &&
      this.configuration !== null &&
      this.configuration.operationalEnabled === true
    );
  }

  private usageAllowed(): boolean {
    return this.operationalEnabled() && this.state.consent.telemetry;
  }

  private crashAllowed(): boolean {
    return this.operationalEnabled() && this.state.consent.crash;
  }

  private anyConsentAllowed(): boolean {
    return this.state.consent.telemetry || this.state.consent.crash;
  }

  private consentSnapshot(): TelemetryConsent {
    return { telemetry: this.state.consent.telemetry, crash: this.state.consent.crash };
  }

  private scheduleNext(): void {
    this.clearScheduledTimer();
    if (
      this.shutDown ||
      !this.configuration ||
      this.configuration.operationalEnabled !== true ||
      this.state.suspended ||
      !this.anyConsentAllowed()
    ) {
      return;
    }
    const now = this.dependencies.clock.now();
    const queueTimes = this.state.queue
      .filter((record) => this.recordAllowed(record))
      .map((record) => record.nextAttemptAt);
    if (this.usageAllowed() && !this.hasUsageRecord() && this.usageDue()) {
      queueTimes.push(now);
    } else if (this.usageAllowed() && !this.hasUsageRecord() && this.state.usageRetryAt !== null) {
      queueTimes.push(this.state.usageRetryAt);
    }
    if (queueTimes.length === 0) {
      if (this.usageAllowed() && this.state.lastUsageReportAt !== null) {
        queueTimes.push(this.state.lastUsageReportAt + TELEMETRY_USAGE_INTERVAL_MS);
      } else {
        return;
      }
    }
    const target = Math.min(...queueTimes);
    const delay = Math.max(0, target - now);
    try {
      this.timer = this.dependencies.clock.setTimeout(() => {
        this.timer = undefined;
        void this.telemetry_flush_due().catch(() => undefined);
      }, delay);
    } catch {
      this.timer = undefined;
      this.warn("telemetry.schedule_failed");
    }
  }

  private clearScheduledTimer(): void {
    if (this.timer !== undefined) {
      try {
        this.dependencies.clock.clearTimeout(this.timer);
      } catch {
        this.warn("telemetry.schedule_failed");
      }
      this.timer = undefined;
    }
  }

  private cancelInFlight(): void {
    if (!this.inFlightAbort) return;
    this.inFlightAbort.abort();
    this.inFlightAbort = null;
  }

  private async clearSessionMarker(): Promise<void> {
    if (!this.state.sessionActive) return;
    await this.serialMutation(async () => {
      this.state = { ...this.state, sessionActive: false };
      await this.persist();
    }, undefined);
  }

  private async serialMutation<T>(operation: () => Promise<T>, failureValue: T): Promise<T> {
    let value = failureValue;
    const run = this.mutationTail.then(async () => {
      value = await operation();
    });
    this.mutationTail = run.catch(() => undefined);
    try {
      await run;
      return value;
    } catch {
      this.warn("telemetry.persistence_failed");
      return value;
    }
  }

  private async persist(): Promise<boolean> {
    try {
      await this.dependencies.persistence.save(cloneState(this.state));
      return true;
    } catch {
      this.warn("telemetry.persistence_failed");
      return false;
    }
  }

  private async clearPersistence(): Promise<boolean> {
    try {
      await this.dependencies.persistence.clear();
      return true;
    } catch {
      this.warn("telemetry.persistence_clear_failed");
      return false;
    }
  }

  private randomFraction(): number {
    try {
      return clamp(this.dependencies.random.fraction(), 0, 0.999999);
    } catch {
      return 0.5;
    }
  }

  private retryDelayMs(attempt: number, now: number, retryAfter: string | null): number {
    const backoff = Math.min(
      TELEMETRY_RETRY_MAX_MS,
      TELEMETRY_RETRY_BASE_MS * 2 ** Math.min(10, Math.max(0, attempt - 1)),
    );
    const jittered = Math.min(
      TELEMETRY_RETRY_MAX_MS,
      Math.max(1, Math.floor(backoff * (0.75 + this.randomFraction() * 0.5))),
    );
    const serverDelay = parseRetryAfterMs(retryAfter, now);
    return Math.min(
      TELEMETRY_RETRY_MAX_MS,
      serverDelay === null ? jittered : Math.max(jittered, serverDelay),
    );
  }

  private async persistWithdrawal(): Promise<boolean> {
    if (await this.clearPersistence()) {
      return true;
    }
    return this.persist();
  }

  private warn(event: TelemetryLogEvent): void {
    try {
      this.dependencies.logger.warn(event);
    } catch {
      // Delivery diagnostics must never become an application failure.
    }
  }

  private result(
    status: TelemetryFlushResult["status"],
    attempts: number,
    acknowledged: number,
  ): TelemetryFlushResult {
    return {
      status,
      attempts,
      acknowledged,
      retained: this.state.queue.length,
    };
  }
}

function initialState(disclosureVersion: number | null = null): TelemetryPersistedState {
  return {
    version: TELEMETRY_PERSISTENCE_VERSION,
    consent: { telemetry: false, crash: false, disclosureVersion },
    appId: null,
    installId: null,
    usage: { toolCalls: 0, browserSessions: 0, activeDays: 0 },
    lastActiveUtcDay: null,
    lastUsageReportAt: null,
    usageRetryAt: null,
    usageRejectionFailures: 0,
    queue: [],
    sessionActive: false,
    suspended: false,
  };
}

function validateConfiguration(configuration: TelemetryConfiguration): ValidatedConfiguration {
  if (!configuration || typeof configuration !== "object") {
    return { config: null, issue: "missing-configuration" };
  }
  const app = configuration.app;
  if (!app || typeof app !== "object") {
    return { config: null, issue: "missing-app-identity" };
  }
  if (typeof app.id !== "string" || !APP_ID_PATTERN.test(app.id)) {
    return { config: null, issue: "invalid-app-id" };
  }
  if (typeof app.version !== "string" || !VERSION_PATTERN.test(app.version)) {
    return { config: null, issue: "invalid-app-version" };
  }
  if (!validIdentityLabel(app.platform) || !validIdentityLabel(app.arch)) {
    return { config: null, issue: "invalid-app-platform" };
  }
  if (!Number.isInteger(configuration.disclosureVersion) || configuration.disclosureVersion < 1) {
    return { config: null, issue: "invalid-disclosure-version" };
  }
  if (!Array.isArray(configuration.stableCodes)) {
    return { config: null, issue: "invalid-stable-codes" };
  }
  if (
    configuration.stableCodes.some(
      (code) => typeof code !== "string" || !STABLE_CODE_PATTERN.test(code),
    )
  ) {
    return { config: null, issue: "invalid-stable-codes" };
  }
  const baseUrl = normalizeBaseUrl(configuration.baseUrl);
  if (!baseUrl) {
    return { config: null, issue: "invalid-base-url" };
  }
  return {
    issue: null,
    config: Object.freeze({
      operationalEnabled: configuration.operationalEnabled === true,
      app: Object.freeze({
        id: app.id,
        version: app.version,
        platform: app.platform,
        arch: app.arch,
      }),
      baseUrl,
      disclosureVersion: configuration.disclosureVersion,
      stableCodes: Object.freeze([...new Set(configuration.stableCodes)]),
    }),
  };
}

function normalizeBaseUrl(value: string): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    const loopback =
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]" ||
      url.hostname === "localhost";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function validIdentityLabel(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    [...value].length <= 32 &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function coalesceUsageQueue(
  queue: readonly TelemetryQueueRecord[],
  usage: TelemetryUsageQueueRecord,
): TelemetryQueueRecord[] {
  const existing = queue.find((record) => record.stream === "usage");
  if (!existing) return [...queue, usage];
  return queue.map((record) =>
    record.id === existing.id
      ? {
          ...usage,
          id: existing.id,
          createdAt: existing.createdAt,
          attempts: existing.attempts,
          nextAttemptAt: existing.nextAttemptAt,
        }
      : record,
  );
}

function applyConsentState(
  state: TelemetryPersistedState,
  consent: TelemetryPersistedState["consent"],
): TelemetryPersistedState {
  return {
    ...state,
    consent,
    queue: state.queue.filter((record) =>
      record.stream === "usage" ? consent.telemetry : consent.crash,
    ),
    usage: consent.telemetry ? state.usage : { toolCalls: 0, browserSessions: 0, activeDays: 0 },
    lastActiveUtcDay: consent.telemetry ? state.lastActiveUtcDay : null,
    usageRetryAt: consent.telemetry ? state.usageRetryAt : null,
    usageRejectionFailures: consent.telemetry ? state.usageRejectionFailures : 0,
    sessionActive: consent.crash ? state.sessionActive : false,
  };
}

function parseRetryAfterMs(value: string | null, now: number): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(TELEMETRY_RETRY_MAX_MS, seconds * 1000);
  }
  const target = Date.parse(normalized);
  if (!Number.isFinite(target) || target <= now) return null;
  return Math.min(TELEMETRY_RETRY_MAX_MS, target - now);
}

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function appWire(app: AppSnapshot): TelemetryAppIdentity {
  return { id: app.id, version: app.version, platform: app.platform, arch: app.arch };
}

function sameApp(left: AppSnapshot, right: AppSnapshot): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.platform === right.platform &&
    left.arch === right.arch
  );
}

function sameCrashGroup(
  left: TelemetryCrashQueueRecord,
  right: TelemetryCrashQueueRecord,
): boolean {
  return (
    left.kind === right.kind &&
    left.fingerprint === right.fingerprint &&
    sameApp(left.app, right.app)
  );
}

function cloneState(state: TelemetryPersistedState): TelemetryPersistedState {
  return structuredClone(state);
}

function decodePersistedState(
  value: unknown,
  disclosureVersion: number,
): TelemetryPersistedState | null {
  if (!isRecord(value) || value.version !== TELEMETRY_PERSISTENCE_VERSION) return null;
  if (!isRecord(value.consent) || !isRecord(value.usage)) return null;
  if (
    typeof value.consent.telemetry !== "boolean" ||
    typeof value.consent.crash !== "boolean" ||
    (value.consent.disclosureVersion !== null &&
      value.consent.disclosureVersion !== disclosureVersion) ||
    !isInteger(value.usage.toolCalls, 0, MAX_TOOL_CALLS) ||
    !isInteger(value.usage.browserSessions, 0, MAX_BROWSER_SESSIONS) ||
    !isInteger(value.usage.activeDays, 0, MAX_ACTIVE_DAYS)
  ) {
    return null;
  }
  if (
    (value.consent.telemetry || value.consent.crash) &&
    value.consent.disclosureVersion === null
  ) {
    return null;
  }
  if (
    value.installId !== null &&
    (typeof value.installId !== "string" || !UUID_V4_PATTERN.test(value.installId))
  ) {
    return null;
  }
  if (
    value.appId !== null &&
    (typeof value.appId !== "string" || !APP_ID_PATTERN.test(value.appId))
  ) {
    return null;
  }
  if ((value.installId === null) !== (value.appId === null)) {
    return null;
  }
  if (
    value.lastActiveUtcDay !== null &&
    (typeof value.lastActiveUtcDay !== "string" || !UTC_DAY_PATTERN.test(value.lastActiveUtcDay))
  ) {
    return null;
  }
  if (
    value.lastUsageReportAt !== null &&
    !isInteger(value.lastUsageReportAt, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  const usageRetryAt = value.usageRetryAt ?? null;
  if (usageRetryAt !== null && !isInteger(usageRetryAt, 0, Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  const usageRejectionFailures = value.usageRejectionFailures ?? 0;
  if (!isInteger(usageRejectionFailures, 0, 20)) return null;
  if (!Array.isArray(value.queue)) return null;
  const queue = value.queue.map(decodeQueueRecord);
  if (queue.some((record) => record === null)) return null;
  if (
    value.installId !== null &&
    queue.some((record) => record !== null && record.app.id !== value.appId)
  ) {
    return null;
  }
  if (value.sessionActive === true && value.installId === null) {
    return null;
  }
  return {
    version: TELEMETRY_PERSISTENCE_VERSION,
    consent: {
      telemetry: value.consent.telemetry,
      crash: value.consent.crash,
      disclosureVersion: value.consent.disclosureVersion,
    },
    appId: value.appId,
    installId: value.installId,
    usage: {
      toolCalls: value.usage.toolCalls,
      browserSessions: value.usage.browserSessions,
      activeDays: value.usage.activeDays,
    },
    lastActiveUtcDay: value.lastActiveUtcDay,
    lastUsageReportAt: value.lastUsageReportAt,
    usageRetryAt,
    usageRejectionFailures,
    queue: queue.filter((record): record is TelemetryQueueRecord => record !== null).slice(-50),
    sessionActive: value.sessionActive === true,
    suspended: value.suspended === true,
  };
}

function decodeQueueRecord(value: unknown): TelemetryQueueRecord | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isInteger(value.createdAt, 0, Number.MAX_SAFE_INTEGER) ||
    !isInteger(value.attempts, 0, Number.MAX_SAFE_INTEGER) ||
    !isInteger(value.nextAttemptAt, 0, Number.MAX_SAFE_INTEGER) ||
    !decodeApp(value.app)
  ) {
    return null;
  }
  const app = decodeApp(value.app);
  if (!app) return null;
  if (
    value.stream === "usage" &&
    isInteger(value.uptimeSeconds, 0, MAX_UPTIME_SECONDS) &&
    isRecord(value.usage) &&
    isInteger(value.usage.toolCalls, 0, MAX_TOOL_CALLS) &&
    isInteger(value.usage.browserSessions, 0, MAX_BROWSER_SESSIONS) &&
    isInteger(value.usage.activeDays, 0, MAX_ACTIVE_DAYS)
  ) {
    return {
      id: value.id,
      createdAt: value.createdAt,
      attempts: value.attempts,
      nextAttemptAt: value.nextAttemptAt,
      app,
      stream: "usage",
      uptimeSeconds: value.uptimeSeconds,
      usage: {
        toolCalls: value.usage.toolCalls,
        browserSessions: value.usage.browserSessions,
        activeDays: value.usage.activeDays,
      },
    };
  }
  if (
    value.stream === "crash" &&
    typeof value.kind === "string" &&
    TELEMETRY_CRASH_KINDS.includes(value.kind as TelemetryCrashKind) &&
    typeof value.fingerprint === "string" &&
    FINGERPRINT_PATTERN.test(value.fingerprint) &&
    isInteger(value.occurrences, 1, MAX_OCCURRENCES)
  ) {
    return {
      id: value.id,
      createdAt: value.createdAt,
      attempts: value.attempts,
      nextAttemptAt: value.nextAttemptAt,
      app,
      stream: "crash",
      kind: value.kind as TelemetryCrashKind,
      fingerprint: value.fingerprint,
      occurrences: value.occurrences,
    };
  }
  return null;
}

function decodeApp(value: unknown): AppSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !APP_ID_PATTERN.test(value.id) ||
    typeof value.version !== "string" ||
    !VERSION_PATTERN.test(value.version) ||
    typeof value.platform !== "string" ||
    !validIdentityLabel(value.platform) ||
    typeof value.arch !== "string" ||
    !validIdentityLabel(value.arch)
  ) {
    return null;
  }
  return {
    id: value.id,
    version: value.version,
    platform: value.platform,
    arch: value.arch,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}
