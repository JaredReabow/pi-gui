import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCredentialStore, InMemoryModelsStore, type Api } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  explainModelRequestFailure,
  safeRequestError,
  summaryThinkingLevel,
  summaryRequestOptions,
} from "../dist/summary-request.js";

const runtime = await ModelRuntime.create({
  modelsPath: null,
  credentials: new InMemoryCredentialStore(),
  modelsStore: new InMemoryModelsStore(),
  refreshOnCreate: false,
  allowModelNetwork: false,
});
function fixture(api: Api, reasoning = true) {
  const provider = `summary-policy-${api}-${reasoning}`;
  runtime.registerProvider(provider, {
    api,
    baseUrl: "http://127.0.0.1:9/no-network",
    apiKey: "TEST_ONLY",
    models: [
      {
        id: api === "anthropic-messages" ? "claude-sonnet-4-5" : "gpt-5.6-terra",
        name: "summary fixture",
        reasoning,
        input: ["text"],
        contextWindow: 100000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
  const model = runtime.getModels(provider)[0];
  assert.ok(model);
  return model;
}
const model = fixture("openai-responses");

await test("summaries prefer medium; non-reasoning models omit the option; declared capabilities clamp it", () => {
  assert.equal(summaryThinkingLevel(model), "medium");
  assert.deepEqual(summaryRequestOptions(model, "work"), { reasoning: "medium", maxTokens: 8192 });
  const plain = fixture("openai-responses", false);
  assert.equal(summaryThinkingLevel(plain), "off");
  assert.deepEqual(summaryRequestOptions(plain, "work", { reasoning: "high" }), { maxTokens: 600 });
  assert.deepEqual(summaryRequestOptions(plain, "context"), { maxTokens: 8192 });
  const limited = { ...model, thinkingLevelMap: { medium: null, high: "high" } };
  assert.equal(summaryThinkingLevel(limited), "high");
  assert.deepEqual(summaryRequestOptions(limited, "work"), { reasoning: "high", maxTokens: 8192 });
});

for (const api of ["openai-responses", "openai-completions", "anthropic-messages"] as const) {
  for (const scope of ["work", "context"] as const) {
    await test(`released SDK serializes ${scope} summary medium in the ${api} wire format without fetching`, async () => {
      const selected = fixture(api);
      let payload: Record<string, unknown> | undefined;
      let fetches = 0;
      const fetch = globalThis.fetch;
      globalThis.fetch = async () => {
        fetches++;
        throw new Error("NETWORK_MUST_NOT_RUN");
      };
      try {
        await runtime
          .streamSimple(
            selected,
            {
              systemPrompt: "Summarize fixture data only; do not call tools.",
              messages: [
                { role: "user", content: "Changed fixture; verification passed.", timestamp: 0 },
              ],
            },
            summaryRequestOptions(selected, scope, {
              onPayload(value) {
                payload = value as Record<string, unknown>;
                throw new Error("PAYLOAD_CAPTURED_BEFORE_NETWORK");
              },
            }),
          )
          .result();
      } finally {
        globalThis.fetch = fetch;
      }
      assert.equal(fetches, 0);
      assert.ok(payload);
      if (api === "openai-responses") {
        assert.equal((payload.reasoning as { effort: string }).effort, "medium");
        assert.ok(Array.isArray(payload.input));
        assert.equal(payload.reasoning_effort, undefined);
      } else if (api === "openai-completions") {
        assert.equal(payload.reasoning_effort, "medium");
        assert.ok(Array.isArray(payload.messages));
        assert.equal(payload.reasoning, undefined);
      } else {
        const thinking = payload.thinking as { type: string; budget_tokens: number };
        assert.equal(thinking.type, "enabled");
        assert.ok(thinking.budget_tokens > 0);
        assert.ok(
          Number(payload.max_tokens) - thinking.budget_tokens >= 8192,
          "preserve answer headroom instead of lowering the real model ceiling",
        );
        assert.ok(Number(payload.max_tokens) <= selected.maxTokens);
        assert.equal(payload.reasoning, undefined);
        assert.equal(payload.reasoning_effort, undefined);
      }
    });
  }
}

for (const [detail, code, text] of [
  [
    'API error (400): {"detail":"Bad Request"}',
    "MODEL_REQUEST_REJECTED",
    "does not identify the cause",
  ],
  [
    '400 {"code":"unsupported_value","param":"reasoning.effort","message":"minimal is not supported"}',
    "MODEL_SETTING_UNSUPPORTED",
    "reasoning mode",
  ],
  ["HTTP 401: unauthorized", "MODEL_AUTH_REQUIRED", "login"],
  ["HTTP 403: permission denied", "MODEL_AUTH_REQUIRED", "permissions"],
  ["API error (402): Insufficient Balance", "MODEL_USAGE_LIMIT", "credit or quota"],
  ["HTTP 429: slow down", "MODEL_RATE_LIMITED", "Wait"],
  ["HTTP 503: unavailable", "MODEL_SERVICE_UNAVAILABLE", "provider service"],
  [
    "400 context_length_exceeded: maximum context length exceeded",
    "MODEL_CONTEXT_LIMIT",
    "context limit",
  ],
  [
    "Summary exhausted its output/reasoning token budget",
    "MODEL_SUMMARY_INCOMPLETE",
    "No incomplete summary",
  ],
  ["Summary model returned no text", "MODEL_EMPTY_RESPONSE", "no summary text"],
  ["Summary timed out", "MODEL_REQUEST_TIMEOUT", "timed out"],
  ["The operation was aborted", "MODEL_REQUEST_CANCELLED", "cancelled"],
  ["fetch failed: ECONNRESET", "MODEL_CONNECTION_FAILED", "connection"],
] as const) {
  await test(`request failure is actionable: ${code}`, () => {
    const failure = explainModelRequestFailure(detail, model, "medium");
    assert.equal(failure.code, code);
    assert.ok(failure.message.includes(text));
    assert.ok(failure.message.includes("Reasoning: medium"));
    assert.ok(failure.message.includes("API: openai-responses"));
  });
}
await test("UI error details never expose endpoint capabilities or key values", () => {
  const safe = safeRequestError(
    "fetch failed at http://127.0.0.1:4202/_caller/secret-capability/v1 Authorization: Bearer secret-token api_key=secret-key sk-secret987",
  );
  for (const secret of ["secret-capability", "secret-token", "secret-key", "sk-secret987"])
    assert.ok(!safe.includes(secret));
});
