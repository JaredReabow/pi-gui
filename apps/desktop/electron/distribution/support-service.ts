import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  SUPPORT_OPTIONS,
  supportResolveOptionUrl,
  type SupportDismissalChoice,
  type SupportOption,
  type SupportPromptState,
} from "@pi-gui/distribution-support";
import type {
  SupportDevelopmentOption,
  SupportDevelopmentOptionId,
  SupportDevelopmentState,
} from "../../contracts/ipc";
import { writeJsonAtomicForAppStore } from "../persistence/app-store-persistence";
import { readJsonWithBackup } from "../persistence/atomic-file-write";

export const SUPPORT_SERVICE_FILE_MAX_BYTES = 1_024;

export interface SupportServicePersistence {
  loadDontAskAgain(): Promise<boolean>;
  saveDontAskAgain(): Promise<void>;
}

export interface SupportServiceOptions {
  readonly persistence: SupportServicePersistence;
  readonly openExternal: (url: string) => Promise<void>;
}

export interface SupportServiceFilePersistenceOptions {
  readonly writeJsonAtomic?: (filePath: string, value: unknown) => Promise<void>;
}

interface SupportDismissalFile {
  readonly version: 1;
  readonly dontAskAgain: boolean;
}

function supportService_projectOption(option: SupportOption): SupportDevelopmentOption {
  return Object.freeze({
    ...option,
    id: option.id as SupportDevelopmentOptionId,
    amount: option.amount ? Object.freeze({ ...option.amount }) : null,
  });
}

const SUPPORT_DEVELOPMENT_OPTIONS: readonly SupportDevelopmentOption[] = Object.freeze(
  SUPPORT_OPTIONS.map(supportService_projectOption),
);

function supportService_decodeFile(value: unknown): SupportDismissalFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid support dismissal file");
  }
  const record = value as Record<string, unknown>;
  if (
    !Object.hasOwn(record, "version") ||
    !Object.hasOwn(record, "dontAskAgain") ||
    !Object.keys(record).every((key) => key === "version" || key === "dontAskAgain") ||
    record.version !== 1 ||
    typeof record.dontAskAgain !== "boolean"
  ) {
    throw new TypeError("Invalid support dismissal file");
  }
  return { version: 1, dontAskAgain: record.dontAskAgain };
}

async function supportService_assertBounded(filePath: string): Promise<void> {
  try {
    const details = await stat(filePath);
    if (!details.isFile() || details.size > SUPPORT_SERVICE_FILE_MAX_BYTES) {
      throw new Error("Support dismissal file exceeds its byte bound");
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

/** File persistence inside the caller's isolated application-data directory. */
function supportService_writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  return writeJsonAtomicForAppStore(filePath, value);
}

export function supportService_createFilePersistence(
  root: string,
  options: SupportServiceFilePersistenceOptions = {},
): SupportServicePersistence {
  if (typeof root !== "string" || !root.trim() || !isAbsolute(root)) {
    throw new TypeError("Support persistence requires an absolute caller root");
  }
  const writeJsonAtomic = options.writeJsonAtomic ?? supportService_writeJsonAtomic;
  if (typeof writeJsonAtomic !== "function") {
    throw new TypeError("Support persistence requires a JSON writer");
  }
  const filePath = join(root, "support-development.json");

  return Object.freeze({
    async loadDontAskAgain(): Promise<boolean> {
      await supportService_assertBounded(filePath);
      await supportService_assertBounded(`${filePath}.bak`);
      const result = await readJsonWithBackup(filePath);
      if (result.value === undefined) return false;
      try {
        return supportService_decodeFile(result.value).dontAskAgain;
      } catch {
        // Malformed data is not the person's saved choice and must not hide anything.
        return false;
      }
    },
    async saveDontAskAgain(): Promise<void> {
      await supportService_assertBounded(filePath);
      await supportService_assertBounded(`${filePath}.bak`);
      const existing = await readJsonWithBackup(filePath);
      if (existing.corrupted && !existing.recovered) {
        throw new Error("Support dismissal file is corrupt and was not replaced");
      }
      if (existing.value !== undefined) {
        supportService_decodeFile(existing.value);
      }
      const value: SupportDismissalFile = Object.freeze({
        version: 1,
        dontAskAgain: true,
      });
      await writeJsonAtomic(filePath, value);
    },
  });
}

function supportService_isDismissalChoice(value: unknown): value is SupportDismissalChoice {
  return value === "not-now" || value === "dont-ask-again";
}

/**
 * Validate the original caller string without normalization. D05 owns the
 * accepted ID set and URL mapping; passing whitespace, controls, aliases or
 * prototype keys therefore rejects before any opener can be called.
 */
export function supportService_decodeOptionId(value: unknown): SupportDevelopmentOptionId {
  if (typeof value !== "string") {
    throw new TypeError("Support option must be an accepted exact ID");
  }
  supportResolveOptionUrl(value);
  return value as SupportDevelopmentOptionId;
}

/**
 * Manual support-service owner.
 *
 * The renderer may name only an accepted option ID. This service resolves the
 * destination from the shared policy and only then calls the injected opener.
 * "Not now" is held in process state; "Don't ask again" becomes visible only
 * after its persistence write succeeds.
 */
export class SupportService {
  private readonly persistence: SupportServicePersistence;
  private readonly openExternal: (url: string) => Promise<void>;
  private state: SupportPromptState;
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly pendingOpenByUrl = new Map<string, Promise<void>>();

  private constructor(
    persistence: SupportServicePersistence,
    openExternal: (url: string) => Promise<void>,
    persistedDontAskAgain: boolean,
  ) {
    this.persistence = persistence;
    this.openExternal = openExternal;
    this.state = Object.freeze({
      currentPromptDismissed: false,
      dontAskAgain: persistedDontAskAgain,
    });
  }

  static async create(options: SupportServiceOptions): Promise<SupportService> {
    if (typeof options?.openExternal !== "function") {
      throw new TypeError("Support service requires an external opener");
    }
    if (
      !options.persistence ||
      typeof options.persistence.loadDontAskAgain !== "function" ||
      typeof options.persistence.saveDontAskAgain !== "function"
    ) {
      throw new TypeError("Support service requires dismissal persistence");
    }
    let dontAskAgain = false;
    try {
      dontAskAgain = await options.persistence.loadDontAskAgain();
    } catch {
      // A failed read is not a saved opt-out. The manual Settings entry remains visible.
      dontAskAgain = false;
    }
    return new SupportService(options.persistence, options.openExternal, dontAskAgain);
  }

  getState(): SupportDevelopmentState {
    return Object.freeze({
      options: SUPPORT_DEVELOPMENT_OPTIONS,
      currentPromptDismissed: this.state.currentPromptDismissed,
      dontAskAgain: this.state.dontAskAgain,
    });
  }

  async openOption(optionId: unknown): Promise<void> {
    const url = supportResolveOptionUrl(supportService_decodeOptionId(optionId));
    const pending = this.pendingOpenByUrl.get(url);
    if (pending) return pending;
    const operation = Promise.resolve()
      .then(() => this.openExternal(url))
      .finally(() => {
        if (this.pendingOpenByUrl.get(url) === operation) {
          this.pendingOpenByUrl.delete(url);
        }
      });
    this.pendingOpenByUrl.set(url, operation);
    return operation;
  }

  dismiss(choice: unknown): Promise<SupportDevelopmentState> {
    if (!supportService_isDismissalChoice(choice)) {
      return Promise.reject(new RangeError("Unknown support dismissal choice"));
    }
    const operation = this.mutationTail.then(() => this.commitDismissal(choice));
    this.mutationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.then(() => this.getState());
  }

  private async commitDismissal(choice: SupportDismissalChoice): Promise<void> {
    if (choice === "not-now") {
      this.state = Object.freeze({
        ...this.state,
        currentPromptDismissed: true,
      });
      return;
    }
    if (this.state.dontAskAgain) return;
    await this.persistence.saveDontAskAgain();
    this.state = Object.freeze({
      currentPromptDismissed: true,
      dontAskAgain: true,
    });
  }
}
