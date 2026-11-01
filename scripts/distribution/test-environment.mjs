const sensitiveEnvironment =
  /(?:^|_)(?:API_KEY|AUTH|COOKIE|CREDENTIAL|PASSWORD|SECRET|TOKEN)(?:$|_)|^(?:ANTHROPIC_OAUTH_TOKEN|AWS_ACCESS_KEY_ID|AWS_BEARER_TOKEN_BEDROCK|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_GATEWAY_ID|PI_CODING_AGENT_DIR|PI_APP_REAL_AUTH_SOURCE_DIR|OTEL_.+|POSTHOG_.+|SENTRY_.+)$/i;

export const DISTRIBUTION_PROTECTED_TEST_ENV = Object.freeze({
  PI_APP_TEST_MODE: "background",
  PI_APP_TEST_LANE: "distribution",
  DO_NOT_TRACK: "1",
  OTEL_SDK_DISABLED: "true",
  PI_APP_TEST_TELEMETRY: "disabled",
});

export function distribution_create_test_environment(baseEnv = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined && !sensitiveEnvironment.test(key)) {
      environment[key] = value;
    }
  }
  return { ...environment, ...DISTRIBUTION_PROTECTED_TEST_ENV };
}

export function distribution_sanitize_text(value, environment) {
  let text = String(value ?? "");
  for (const [key, secret] of Object.entries(environment)) {
    if (sensitiveEnvironment.test(key) && typeof secret === "string" && secret.length >= 4) {
      text = text.replaceAll(secret, "[redacted]");
    }
  }
  return text;
}
