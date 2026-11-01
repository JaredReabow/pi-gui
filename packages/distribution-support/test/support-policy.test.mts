import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPPORT_AUTOMATIC_POST_USE_SOLICITATION,
  SUPPORT_DISMISSAL_LABELS,
  SUPPORT_OPTION_IDS,
  SUPPORT_OPTIONS,
  INITIAL_SUPPORT_PROMPT_STATE,
  supportDismissPrompt,
  supportGetOption,
  supportResolveOptionUrl,
  supportStartPromptSession,
  type SupportOptionId,
} from "../dist/index.js";

const EXPECTED_URLS = {
  "monthly-aud-5": "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
  "monthly-aud-10": "https://donate.stripe.com/bJe7sLbEC3ZHgtQc6JgA801",
  "monthly-aud-20": "https://donate.stripe.com/00w3cv4cadAh4L82w9gA802",
  "one-off-stripe": "https://donate.stripe.com/aFa3cv5ge3ZH7Xk2w9gA803",
  "one-off-paypal": "https://paypal.me/reabowpayment",
} as const satisfies Record<SupportOptionId, string>;

await test("typed IDs resolve only their exact provider URLs and metadata", () => {
  assert.deepEqual(SUPPORT_OPTION_IDS, Object.keys(EXPECTED_URLS));

  for (const [id, expectedUrl] of Object.entries(EXPECTED_URLS) as [SupportOptionId, string][]) {
    assert.equal(supportResolveOptionUrl(id), expectedUrl);
    const option = supportGetOption(id);
    assert.equal(option.id, id);
    assert.equal(option.amount === null || option.amount.currency === "AUD", true);
  }

  assert.deepEqual(supportGetOption("one-off-paypal"), {
    id: "one-off-paypal",
    label: "One-off, you choose (PayPal)",
    cadence: "one-off",
    cadenceLabel: "One-off",
    provider: "paypal",
    providerLabel: "PayPal",
    amount: null,
    recipient: "Leo Software",
  });
  assert.deepEqual(
    SUPPORT_OPTIONS.filter((option) => option.cadence === "monthly").map((option) => option.amount),
    [
      { currency: "AUD", minorUnits: 500 },
      { currency: "AUD", minorUnits: 1_000 },
      { currency: "AUD", minorUnits: 2_000 },
    ],
  );
  assert.equal(Object.isFrozen(SUPPORT_OPTIONS), true);
  assert.equal(SUPPORT_OPTIONS.every(Object.isFrozen), true);
});

await test("arbitrary and hostile renderer URL input is rejected", () => {
  const hostileValues: unknown[] = [
    "",
    " monthly-aud-5",
    "monthly-aud-5 ",
    "constructor",
    "__proto__",
    "../../monthly-aud-5",
    "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
    "https://paypal.me/reabowpayment",
    "http://donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
    "https://evil.example/7sY14nfUS2VD3H40o1gA800",
    "https://evil.donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
    "https://donate.stripe.com.evil.example/7sY14nfUS2VD3H40o1gA800",
    "https://user:pass@donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
    "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA800/",
    "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA801",
    "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA800?amount=5",
    "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA800#checkout",
    "https://paypal.me/reabowpayment/",
    "https://paypal.me/reabowpayment?amount=5",
    "https://paypal.me/reabowpayment#checkout",
    null,
    undefined,
    5,
    ["monthly-aud-5"],
    { id: "monthly-aud-5" },
  ];

  for (const value of hostileValues) {
    assert.throws(() => supportResolveOptionUrl(value), /Unknown support option ID/);
    assert.throws(() => supportGetOption(value), /Unknown support option ID/);
  }
});

await test("Not now is session-local while Don't ask again remains suppressed", () => {
  assert.deepEqual(SUPPORT_DISMISSAL_LABELS, {
    "not-now": "Not now",
    "dont-ask-again": "Don't ask again",
  });
  assert.deepEqual(INITIAL_SUPPORT_PROMPT_STATE, {
    currentPromptDismissed: false,
    dontAskAgain: false,
  });

  const notNow = supportDismissPrompt(INITIAL_SUPPORT_PROMPT_STATE, "not-now");
  assert.deepEqual(notNow, { currentPromptDismissed: true, dontAskAgain: false });
  assert.deepEqual(supportStartPromptSession(notNow), INITIAL_SUPPORT_PROMPT_STATE);

  const dontAskAgain = supportDismissPrompt(notNow, "dont-ask-again");
  assert.deepEqual(dontAskAgain, { currentPromptDismissed: true, dontAskAgain: true });
  assert.deepEqual(supportStartPromptSession(dontAskAgain), {
    currentPromptDismissed: false,
    dontAskAgain: true,
  });
  assert.equal(Object.isFrozen(notNow), true);
  assert.equal(Object.isFrozen(dontAskAgain), true);
});

await test("dismissal policy accepts no payment outcomes and never auto-solicits", () => {
  assert.equal(SUPPORT_AUTOMATIC_POST_USE_SOLICITATION, false);

  for (const choice of [
    "payment-complete",
    "checkout-succeeded",
    "paid",
    "",
    null,
    1,
    { choice: "not-now" },
  ]) {
    assert.throws(
      () => supportDismissPrompt(INITIAL_SUPPORT_PROMPT_STATE, choice),
      /Unknown support dismissal choice/,
    );
  }

  for (const state of [
    null,
    {},
    { currentPromptDismissed: false },
    { currentPromptDismissed: false, dontAskAgain: "no" },
    {
      currentPromptDismissed: false,
      dontAskAgain: false,
      paymentVerified: true,
    },
  ]) {
    assert.throws(() => supportDismissPrompt(state, "not-now"), /Invalid support prompt state/);
    assert.throws(() => supportStartPromptSession(state), /Invalid support prompt state/);
  }

  const inheritedState = Object.create({
    currentPromptDismissed: false,
    dontAskAgain: false,
  });
  assert.throws(
    () => supportDismissPrompt(inheritedState, "not-now"),
    /Invalid support prompt state/,
  );
});
