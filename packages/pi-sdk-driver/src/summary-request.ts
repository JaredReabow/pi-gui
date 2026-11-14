import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type { Api, Model, ModelThinkingLevel, SimpleStreamOptions } from "@earendil-works/pi-ai";

/** Provider-neutral policy; ModelRuntime owns API-specific effort/budget serialization. */
export function summaryThinkingLevel(model: Model<Api>): ModelThinkingLevel {
  return clampThinkingLevel(model, "medium");
}

export function summaryRequestOptions(
  model: Model<Api>,
  scope: "work" | "context",
  options: SimpleStreamOptions = {},
): SimpleStreamOptions {
  const level = summaryThinkingLevel(model);
  const allowance = scope === "work" && level === "off" ? 600 : 8192;
  const request = {
    ...options,
    maxTokens: Math.min(options.maxTokens ?? allowance, model.maxTokens || allowance, allowance),
  };
  // Preserve the real model ceiling. Budget-based APIs may reserve additional
  // thinking tokens above this provider-neutral answer allowance, within that ceiling.
  if (level === "off") delete request.reasoning;
  else request.reasoning = level;
  return request;
}

export interface ModelRequestFailure {
  readonly code: string;
  readonly message: string;
}

/** Never carry credential-bearing endpoints or authorization values into a UI error. */
export function safeRequestError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[endpoint redacted]")
    .replace(/\bBearer\s+[^\s"',;}]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[key redacted]")
    .replace(/\b(api[_ -]?key|authorization)\s*[:=]\s*["']?[^\s"',;}]+/gi, "$1=[redacted]")
    .replace(/\p{Cc}/gu, (character) => (character === "\n" || character === "\t" ? character : ""))
    .slice(0, 700);
}

export function explainModelRequestFailure(
  error: unknown,
  model: Pick<Model<Api>, "provider" | "id" | "api">,
  level: ModelThinkingLevel,
): ModelRequestFailure {
  const detail = safeRequestError(error);
  const status = Number(
    detail.match(/(?:HTTP(?: status)?|API error|status(?:Code)?)\s*[:=(]?\s*([45]\d\d)/i)?.[1] ??
      detail.match(/\b([45]\d\d)\s*[:{]/)?.[1],
  );
  let code = "MODEL_REQUEST_FAILED";
  let explanation = "The model request failed. Expand the details before retrying.";
  if (
    /unsupported[_ ]value|unsupported.{0,30}(reasoning|effort)|reasoning.{0,30}not supported/i.test(
      detail,
    )
  ) {
    code = "MODEL_SETTING_UNSUPPORTED";
    explanation =
      "The model rejected a request setting. Check the selected model and reasoning mode.";
  } else if (
    status === 401 ||
    status === 403 ||
    /no api key|not authenticated|credential.*expired/i.test(detail)
  ) {
    code = "MODEL_AUTH_REQUIRED";
    explanation =
      "The provider denied authentication or access. Check its login, API key and permissions.";
  } else if (
    status === 402 ||
    /insufficient.balance|insufficient.quota|billing|credit balance/i.test(detail)
  ) {
    code = "MODEL_USAGE_LIMIT";
    explanation =
      "The provider account has insufficient credit or quota. Check its balance or usage limits.";
  } else if (status === 429) {
    code = "MODEL_RATE_LIMITED";
    explanation = "The provider rate-limited this request (HTTP 429). Wait before retrying.";
  } else if (
    /context[_ ]length|maximum context|context window.{0,30}(exceed|limit)|too many tokens/i.test(
      detail,
    )
  ) {
    code = "MODEL_CONTEXT_LIMIT";
    explanation =
      "The request exceeds the model's context limit. Compact context or check the selected model's limits; the original history is kept.";
  } else if (/exhausted.{0,40}(token|budget)|hit the token cap/i.test(detail)) {
    code = "MODEL_SUMMARY_INCOMPLETE";
    explanation =
      "The summary hit its output/reasoning token limit. No incomplete summary was saved; check the model's output allowance.";
  } else if (/summary model returned no text/i.test(detail)) {
    code = "MODEL_EMPTY_RESPONSE";
    explanation =
      "The model returned no summary text. No empty summary was saved; check its response and reasoning/output allowance.";
  } else if (status === 400 || status === 422) {
    code = "MODEL_REQUEST_REJECTED";
    explanation = `The provider rejected this request (HTTP ${status}). Check model/API settings; a generic Bad Request does not identify the cause.`;
  } else if (status >= 500) {
    code = "MODEL_SERVICE_UNAVAILABLE";
    explanation = `The provider service failed (HTTP ${status}). This is not a draft or local-history failure.`;
  } else if (/timed?\s*out|timeout/i.test(detail)) {
    code = "MODEL_REQUEST_TIMEOUT";
    explanation =
      "The model request timed out. No complete summary was saved. Retry or choose a faster summary model.";
  } else if (/abort|cancel/i.test(detail)) {
    code = "MODEL_REQUEST_CANCELLED";
    explanation = "The model request was cancelled; no summary was saved.";
  } else if (/fetch failed|terminated|socket|ECONN|network/i.test(detail)) {
    code = "MODEL_CONNECTION_FAILED";
    explanation =
      "The provider connection failed or closed before completion. Retry when it is reachable.";
  }
  return {
    code,
    message: `${explanation}\nModel: ${safeRequestError(`${model.provider}/${model.id}`)} · API: ${safeRequestError(model.api)} · Reasoning: ${level === "off" ? "off (omitted)" : level}\nDetails: ${detail}`,
  };
}
