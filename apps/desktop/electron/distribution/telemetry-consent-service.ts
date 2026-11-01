import {
  telemetryConsent_schemaVersion,
  type TelemetryConsentCheckpoint,
  type TelemetryConsentEngineStatusInput,
  type TelemetryConsentPersistenceResult,
  type TelemetryConsentRequest,
  type TelemetryConsentStatusSnapshot,
} from "../../contracts/telemetry-consent";
import type { TelemetryConsentStore } from "../persistence/telemetry-consent-store";
import type { TelemetryConsentMetadata } from "../telemetry/telemetry";
import type {
  DistributionTelemetryIntegration,
  DistributionTelemetryConsentResult,
} from "./telemetry-integration";
import {
  telemetryConsentDomain_checkpoint,
  telemetryConsentDomain_completeRestartInspection,
  telemetryConsentDomain_initial,
  telemetryConsentDomain_observe,
  telemetryConsentDomain_recordPersistence,
  telemetryConsentDomain_request,
  telemetryConsentDomain_restart,
  telemetryConsentDomain_submit,
} from "./telemetry-consent-domain";

export const TELEMETRY_CONSENT_SERVICE_MAX_SUBSCRIBERS = 16;

export type TelemetryConsentStatusListener = (status: TelemetryConsentStatusSnapshot) => void;

export interface TelemetryConsentServiceOwner {
  consentMetadata(): TelemetryConsentMetadata;
  setConsent(usage: boolean, crash: boolean): Promise<DistributionTelemetryConsentResult>;
}

const restrictiveEngineInput: TelemetryConsentEngineStatusInput = Object.freeze({
  configurationValid: false,
  operationalEnabled: false,
  disclosureVersion: null,
  ownerConsent: Object.freeze({ usage: false, crash: false }),
  identityPresent: false,
  queue: Object.freeze({ usage: 0, crash: 0, total: 0 }),
  suspended: true,
  revocationPending: false,
  pendingWithdrawal: null,
  inFlight: false,
  lastOutcome: null,
});

/**
 * Sole adapter allowed to combine durable explicit provenance with the
 * schema-2 telemetry owner.
 *
 * Every mutation runs through one transaction queue. The engine and provenance
 * are distinct durability domains, so an accepted request is not saved until
 * both writes complete and the current owner still matches the requested
 * disclosure and category choices.
 */
export class TelemetryConsentService {
  private readonly owner: TelemetryConsentServiceOwner;
  private readonly store: TelemetryConsentStore;
  private state: TelemetryConsentStatusSnapshot;
  private readonly listeners = new Set<TelemetryConsentStatusListener>();
  private transactionTail: Promise<void> = Promise.resolve();
  private cleanedUp = false;

  private constructor(
    owner: TelemetryConsentServiceOwner,
    store: TelemetryConsentStore,
    state: TelemetryConsentStatusSnapshot,
  ) {
    this.owner = owner;
    this.store = store;
    this.state = state;
  }

  static async create(
    owner: TelemetryConsentServiceOwner,
    store: TelemetryConsentStore,
  ): Promise<TelemetryConsentService> {
    const engine = telemetryConsentService_engineInput(owner);
    let checkpoint: TelemetryConsentCheckpoint | null = null;
    try {
      checkpoint = await store.load();
    } catch {
      // A missing or invalid provenance record is not evidence of a choice.
      checkpoint = null;
    }
    let state =
      checkpoint === null
        ? telemetryConsentDomain_initial(engine)
        : telemetryConsentDomain_restart(checkpoint, engine);
    if (state.requiresRestartInspection) {
      // This is a read-only re-observation. It never completes an interrupted
      // request or promotes provenance to durable state.
      state = telemetryConsentDomain_completeRestartInspection(state, engine);
    }
    return new TelemetryConsentService(owner, store, state);
  }

  /** Return a copy-safe, bounded consent status snapshot. */
  telemetry_consent_get(): TelemetryConsentStatusSnapshot {
    return telemetryConsentService_cloneStatus(this.state);
  }

  /**
   * Apply one complete consent transaction. Requests are decoded before
   * entering the serialized queue and revision-checked when their turn starts.
   */
  telemetry_consent_change(value: unknown): Promise<TelemetryConsentStatusSnapshot> {
    const request = telemetryConsentDomain_request(value);
    const operation = this.transactionTail.then(() => this.commit(request));
    this.transactionTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.then(() => telemetryConsentService_cloneStatus(this.state));
  }

  /** Observe status changes without exposing the mutable internal snapshot. */
  telemetry_consent_status_subscribe(listener: TelemetryConsentStatusListener): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("telemetry consent status listener must be a function.");
    }
    if (this.cleanedUp) {
      throw new Error("telemetry consent service is cleaned up.");
    }
    if (this.listeners.size >= TELEMETRY_CONSENT_SERVICE_MAX_SUBSCRIBERS) {
      throw new Error("telemetry consent subscriber limit reached.");
    }
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  /** Release service subscriptions; durable choices and engine state remain. */
  telemetry_consent_cleanup(): void {
    this.cleanedUp = true;
    this.listeners.clear();
  }

  private async commit(request: TelemetryConsentRequest): Promise<void> {
    if (this.cleanedUp) {
      throw new Error("telemetry consent service is cleaned up.");
    }

    const submitted = telemetryConsentDomain_submit(this.state, request);
    this.replaceState(submitted.state);
    const requestRevision = submitted.pending.requestRevision;
    const withdrawalIntent = request.usage === "denied" || request.crash === "denied";
    let withdrawalIntentDurable = true;

    if (withdrawalIntent) {
      try {
        // This intent survives a crash between the engine write and final
        // provenance commit. It can never authorize a category by itself.
        await this.store.save(telemetryConsentDomain_checkpoint(this.state));
      } catch {
        withdrawalIntentDurable = false;
      }
    }

    let engineDurable = false;
    try {
      const engineBefore = telemetryConsentService_engineInput(this.owner);
      const engineUsage =
        request.usage === "denied"
          ? false
          : withdrawalIntentDurable
            ? true
            : engineBefore.ownerConsent.usage;
      const engineCrash =
        request.crash === "denied"
          ? false
          : withdrawalIntentDurable
            ? true
            : engineBefore.ownerConsent.crash;
      const result = await this.owner.setConsent(engineUsage, engineCrash);
      engineDurable = result.durable;
    } catch {
      engineDurable = false;
    }

    const engine = telemetryConsentService_engineInput(this.owner);
    this.replaceState(telemetryConsentDomain_observe(this.state, engine));
    const pending = telemetryConsentDomain_recordPersistence(
      this.state,
      telemetryConsentService_result(requestRevision, engineDurable, false),
    );
    this.replaceState(pending);

    if (!withdrawalIntentDurable) {
      // A failed intent write cannot support a full transaction. Re-observation
      // above retains the runtime withdrawal while leaving the result pending.
      return;
    }

    const finalCandidate = telemetryConsentDomain_recordPersistence(
      pending,
      telemetryConsentService_result(requestRevision, engineDurable, true),
    );
    try {
      await this.store.save(telemetryConsentDomain_checkpoint(finalCandidate));
      this.replaceState(finalCandidate);
    } catch {
      // Keep the pending engine-only projection. The prior durable checkpoint
      // or pre-written withdrawal intent remains the crash-safe record.
    }
  }

  private replaceState(next: TelemetryConsentStatusSnapshot): void {
    this.state = next;
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) {
      try {
        listener(telemetryConsentService_cloneStatus(this.state));
      } catch {
        // A status observer cannot turn a durable consent result into a failure.
      }
    }
  }
}

/** Construct the service from an existing app-facing telemetry integration. */
export async function telemetryConsentService_initialize(
  integration: DistributionTelemetryIntegration,
  store: TelemetryConsentStore,
): Promise<TelemetryConsentService> {
  return TelemetryConsentService.create(integration, store);
}

function telemetryConsentService_engineInput(
  owner: TelemetryConsentServiceOwner,
): TelemetryConsentEngineStatusInput {
  try {
    const value = owner.consentMetadata();
    return {
      configurationValid: value.configurationValid,
      operationalEnabled: value.operationalEnabled,
      disclosureVersion: value.disclosureVersion,
      ownerConsent: {
        usage: value.ownerConsent.usage,
        crash: value.ownerConsent.crash,
      },
      identityPresent: value.identityPresent,
      queue: {
        usage: value.queue.usage,
        crash: value.queue.crash,
        total: value.queue.total,
      },
      suspended: value.suspended,
      revocationPending: value.revocationPending,
      pendingWithdrawal: value.pendingWithdrawal
        ? {
            usage: value.pendingWithdrawal.usage,
            crash: value.pendingWithdrawal.crash,
          }
        : null,
      inFlight: value.inFlight,
      lastOutcome: value.lastOutcome,
    };
  } catch {
    return structuredClone(restrictiveEngineInput);
  }
}

function telemetryConsentService_result(
  requestRevision: number,
  engineDurable: boolean,
  provenanceDurable: boolean,
): TelemetryConsentPersistenceResult {
  return {
    schemaVersion: telemetryConsent_schemaVersion,
    requestRevision,
    engineDurable,
    provenanceDurable,
  };
}

function telemetryConsentService_cloneStatus(
  status: TelemetryConsentStatusSnapshot,
): TelemetryConsentStatusSnapshot {
  return structuredClone(status);
}
