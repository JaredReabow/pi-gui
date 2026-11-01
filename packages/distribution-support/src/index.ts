/**
 * Behavior adapted from the Chrome Control MCP extension support policy
 * (`extension/support.js`), supplied as the migration reference.
 *
 * That source established the offer labels and public recipient. This package
 * keeps those facts as typed policy while replacing provider-wide host matching
 * with an exact option-to-URL allowlist.
 */

export type SupportProvider = "stripe" | "paypal";
export type SupportCadence = "monthly" | "one-off";
export type SupportOptionId =
  "monthly-aud-5" | "monthly-aud-10" | "monthly-aud-20" | "one-off-stripe" | "one-off-paypal";

export interface SupportAmount {
  readonly currency: "AUD";
  readonly minorUnits: number;
}

export interface SupportOption {
  readonly id: SupportOptionId;
  readonly label: string;
  readonly cadence: SupportCadence;
  readonly cadenceLabel: "Monthly" | "One-off";
  readonly provider: SupportProvider;
  readonly providerLabel: "Stripe" | "PayPal";
  readonly amount: SupportAmount | null;
  readonly recipient?: "Leo Software";
}

interface SupportOptionDefinition extends SupportOption {
  readonly path: string;
}

const SUPPORT_OPTION_DEFINITIONS = [
  {
    id: "monthly-aud-5",
    path: "/7sY14nfUS2VD3H40o1gA800",
    label: "A$5 per month",
    cadence: "monthly",
    cadenceLabel: "Monthly",
    provider: "stripe",
    providerLabel: "Stripe",
    amount: { currency: "AUD", minorUnits: 500 },
  },
  {
    id: "monthly-aud-10",
    path: "/bJe7sLbEC3ZHgtQc6JgA801",
    label: "A$10 per month",
    cadence: "monthly",
    cadenceLabel: "Monthly",
    provider: "stripe",
    providerLabel: "Stripe",
    amount: { currency: "AUD", minorUnits: 1_000 },
  },
  {
    id: "monthly-aud-20",
    path: "/00w3cv4cadAh4L82w9gA802",
    label: "A$20 per month",
    cadence: "monthly",
    cadenceLabel: "Monthly",
    provider: "stripe",
    providerLabel: "Stripe",
    amount: { currency: "AUD", minorUnits: 2_000 },
  },
  {
    id: "one-off-stripe",
    path: "/aFa3cv5ge3ZH7Xk2w9gA803",
    label: "One-off, you choose",
    cadence: "one-off",
    cadenceLabel: "One-off",
    provider: "stripe",
    providerLabel: "Stripe",
    amount: null,
  },
  {
    id: "one-off-paypal",
    path: "/reabowpayment",
    label: "One-off, you choose (PayPal)",
    cadence: "one-off",
    cadenceLabel: "One-off",
    provider: "paypal",
    providerLabel: "PayPal",
    amount: null,
    recipient: "Leo Software",
  },
] as const satisfies readonly SupportOptionDefinition[];

function freezeOption(option: SupportOption): SupportOption {
  if (option.amount) Object.freeze(option.amount);
  return Object.freeze(option);
}

const SUPPORT_PROVIDER_ORIGINS = Object.freeze({
  stripe: "https://donate.stripe.com",
  paypal: "https://paypal.me",
} as const);

function resolveDefinitionUrl(definition: SupportOptionDefinition): string {
  const url = new URL(`${SUPPORT_PROVIDER_ORIGINS[definition.provider]}${definition.path}`);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== definition.path
  ) {
    throw new Error(`Invalid support destination for ${definition.id}`);
  }
  return url.href;
}

const SUPPORT_OPTION_URLS = Object.freeze(
  Object.fromEntries(
    SUPPORT_OPTION_DEFINITIONS.map((definition) => [
      definition.id,
      resolveDefinitionUrl(definition),
    ]),
  ) as Record<SupportOptionId, string>,
);

export const SUPPORT_OPTIONS: readonly SupportOption[] = Object.freeze(
  SUPPORT_OPTION_DEFINITIONS.map(({ path: _path, ...option }) => freezeOption(option)),
);

export const SUPPORT_OPTION_IDS: readonly SupportOptionId[] = Object.freeze(
  SUPPORT_OPTIONS.map((option) => option.id),
);

function isSupportOptionId(value: unknown): value is SupportOptionId {
  return typeof value === "string" && Object.hasOwn(SUPPORT_OPTION_URLS, value);
}

/**
 * Resolve only a typed option ID. Renderer-provided URLs and unknown keys throw,
 * so the main process never has to trust a renderer-selected destination.
 */
export function supportResolveOptionUrl(optionId: unknown): string {
  if (!isSupportOptionId(optionId)) throw new RangeError("Unknown support option ID");
  return SUPPORT_OPTION_URLS[optionId];
}

/** Return display metadata by ID without exposing the destination URL. */
export function supportGetOption(optionId: unknown): SupportOption {
  if (!isSupportOptionId(optionId)) throw new RangeError("Unknown support option ID");
  const option = SUPPORT_OPTIONS.find((candidate) => candidate.id === optionId);
  if (!option) throw new RangeError("Unknown support option ID");
  return option;
}

export type SupportDismissalChoice = "not-now" | "dont-ask-again";

export const SUPPORT_DISMISSAL_LABELS = Object.freeze({
  "not-now": "Not now",
  "dont-ask-again": "Don't ask again",
} as const);

export interface SupportPromptState {
  /** Hides the current prompt. A later explicit prompt session may show it again. */
  readonly currentPromptDismissed: boolean;
  /** Local persistent suppression; it is never inferred from a payment result. */
  readonly dontAskAgain: boolean;
}

export const INITIAL_SUPPORT_PROMPT_STATE: SupportPromptState = Object.freeze({
  currentPromptDismissed: false,
  dontAskAgain: false,
});

/** Automatic solicitation after use remains off in the shared policy. */
export const SUPPORT_AUTOMATIC_POST_USE_SOLICITATION = false as const;

function isSupportPromptState(value: unknown): value is SupportPromptState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.hasOwn(record, "currentPromptDismissed") &&
    Object.hasOwn(record, "dontAskAgain") &&
    Object.keys(record).every(
      (key) => key === "currentPromptDismissed" || key === "dontAskAgain",
    ) &&
    typeof record.currentPromptDismissed === "boolean" &&
    typeof record.dontAskAgain === "boolean"
  );
}

function freezePromptState(state: SupportPromptState): SupportPromptState {
  return Object.freeze({
    currentPromptDismissed: state.currentPromptDismissed,
    dontAskAgain: state.dontAskAgain,
  });
}

/**
 * Apply a dismissal without interpreting checkout or payment outcomes.
 * "Not now" affects one local prompt session; "Don't ask again" is persistent.
 */
export function supportDismissPrompt(state: unknown, choice: unknown): SupportPromptState {
  if (!isSupportPromptState(state)) throw new TypeError("Invalid support prompt state");
  if (choice === "not-now") {
    return freezePromptState({ ...state, currentPromptDismissed: true });
  }
  if (choice === "dont-ask-again") {
    return freezePromptState({
      currentPromptDismissed: true,
      dontAskAgain: true,
    });
  }
  throw new RangeError("Unknown support dismissal choice");
}

/** Start a later explicit prompt while preserving only "Don't ask again". */
export function supportStartPromptSession(state: unknown): SupportPromptState {
  if (!isSupportPromptState(state)) throw new TypeError("Invalid support prompt state");
  return freezePromptState({
    currentPromptDismissed: false,
    dontAskAgain: state.dontAskAgain,
  });
}
