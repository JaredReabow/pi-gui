import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  telemetryConsent_choiceKinds,
  telemetryConsent_decodeCheckpoint,
  telemetryConsent_decodeChoice,
  telemetryConsent_decodeChoices,
  telemetryConsent_decodeEngineStatus,
  telemetryConsent_decodePersistenceResult,
  telemetryConsent_decodeRequest,
  telemetryConsent_decodeStatus,
  telemetryConsent_deliveryStates,
  telemetryConsent_outcomeCodes,
  telemetryConsent_receiptStates,
  telemetryConsent_schemaVersion,
  type TelemetryConsentChoice,
  type TelemetryConsentChoices,
  type TelemetryConsentStatusSnapshot,
} from "../../contracts/telemetry-consent";

const workspaceRoot = path.resolve(__dirname, "../../../..");

function choice(
  value: "undecided" | "allowed" | "denied",
  disclosureVersion: number | null = value === "undecided" ? null : 1,
): TelemetryConsentChoice {
  return {
    value,
    source: value === "undecided" ? "absent" : "user",
    disclosureVersion,
  };
}

function choices(
  usage: TelemetryConsentChoice = choice("undecided"),
  crash: TelemetryConsentChoice = choice("undecided"),
): TelemetryConsentChoices {
  return { usage, crash };
}

function status(
  overrides: Partial<TelemetryConsentStatusSnapshot> = {},
): TelemetryConsentStatusSnapshot {
  const explicit = choices(choice("allowed"), choice("denied"));
  return {
    schemaVersion: telemetryConsent_schemaVersion,
    latestRequestRevision: 1,
    desired: explicit,
    durable: explicit,
    effective: explicit,
    pending: null,
    engine: {
      configurationValid: true,
      operationalEnabled: true,
      disclosureVersion: 1,
      identityPresent: true,
      queue: { usage: 0, crash: 0, total: 0 },
      suspended: false,
      revocationPending: false,
      ownerConsent: { usage: true, crash: false },
      withdrawalPending: { usage: false, crash: false },
      inFlight: false,
    },
    delivery: { state: "endpoint-accepted", receipt: "not-observed" },
    outcome: "saved",
    requiresRestartInspection: false,
    requiresReconciliation: false,
    ...overrides,
  };
}

test("telemetry consent contract is browser-safe, versioned, and closed", () => {
  const contractSource = readFileSync(
    path.join(workspaceRoot, "apps/desktop/contracts/telemetry-consent.ts"),
    "utf8",
  );
  const domainSource = readFileSync(
    path.join(workspaceRoot, "apps/desktop/electron/distribution/telemetry-consent-domain.ts"),
    "utf8",
  );
  for (const source of [contractSource, domainSource]) {
    expect(source).not.toMatch(/from\s+["'](?:node:|electron|fs|path|child_process)/);
    expect(source).not.toMatch(
      /\b(?:fetch|require\s*\(|ipcMain|ipcRenderer|process\.|Date\.now)\b/,
    );
  }
  expect(telemetryConsent_schemaVersion).toBe(1);
  expect(telemetryConsent_choiceKinds).toEqual(["undecided", "allowed", "denied"]);
  expect(telemetryConsent_outcomeCodes).toEqual([
    "none",
    "pending",
    "saved",
    "not-durable",
    "stale-result",
    "withdrawal-priority",
    "restart-inspection-required",
    "reconciliation-required",
  ]);
  expect(telemetryConsent_deliveryStates).toContain("endpoint-accepted");
  expect(telemetryConsent_receiptStates).toEqual(["not-observed"]);
});

test("provenance distinguishes undecided from explicit denial", () => {
  expect(telemetryConsent_decodeChoice(choice("undecided"))).toEqual({
    value: "undecided",
    source: "absent",
    disclosureVersion: null,
  });
  expect(telemetryConsent_decodeChoice(choice("denied"))).toEqual({
    value: "denied",
    source: "user",
    disclosureVersion: 1,
  });
  expect(() =>
    telemetryConsent_decodeChoice({
      value: "denied",
      source: "absent",
      disclosureVersion: null,
    }),
  ).toThrow(/explicit choice requires user provenance/);
  expect(() =>
    telemetryConsent_decodeChoice({
      value: "undecided",
      source: "user",
      disclosureVersion: 1,
    }),
  ).toThrow(/undecided choice must have absent provenance/);
  expect(() =>
    telemetryConsent_decodeChoice({
      value: "allowed",
      source: "user",
      disclosureVersion: null,
    }),
  ).toThrow(/disclosureVersion/);
});

test("requests require current revision, disclosure, and two explicit independent choices", () => {
  const request = {
    schemaVersion: telemetryConsent_schemaVersion,
    expectedRequestRevision: 7,
    disclosureVersion: 2,
    usage: "allowed",
    crash: "denied",
  } as const;
  expect(telemetryConsent_decodeRequest(request)).toEqual(request);
  expect(() => telemetryConsent_decodeRequest({ ...request, usage: "undecided" })).toThrow(
    /usage choice is unsupported/,
  );
  expect(() => telemetryConsent_decodeRequest({ ...request, disclosureVersion: 0 })).toThrow(
    /bounded safe integer/,
  );
  expect(() => telemetryConsent_decodeRequest({ ...request, expectedRequestRevision: -1 })).toThrow(
    /bounded safe integer/,
  );
  expect(() => telemetryConsent_decodeRequest({ ...request, preselected: true })).toThrow(
    /unsupported shape/,
  );
});

test("strict decoders reject hostile accessors, prototypes, extra fields and unbounded data", () => {
  const accessor = { ...choice("allowed") };
  Object.defineProperty(accessor, "source", {
    enumerable: true,
    get: () => "user",
  });
  expect(() => telemetryConsent_decodeChoice(accessor)).toThrow(/enumerable data property/);

  const inherited = Object.create({ source: "user" }) as Record<string, unknown>;
  Object.assign(inherited, choice("allowed"));
  delete inherited.source;
  expect(() => telemetryConsent_decodeChoice(inherited)).toThrow(/plain JSON object/);

  const polluted = JSON.parse(JSON.stringify(choice("allowed"))) as Record<string, unknown>;
  Object.defineProperty(polluted, "__proto__", {
    enumerable: true,
    value: { source: "user" },
  });
  expect(() => telemetryConsent_decodeChoice(polluted)).toThrow(/unsupported shape/);

  for (const forbidden of [
    "installId",
    "queueRecord",
    "fingerprint",
    "path",
    "error",
    "content",
    "secret",
    "supportPayload",
    "mcpPayload",
  ]) {
    expect(() =>
      telemetryConsent_decodeStatus({
        ...status(),
        [forbidden]: "PRIVATE_SENTINEL",
      }),
    ).toThrow(/unsupported shape/);
  }
  expect(() =>
    telemetryConsent_decodeChoices({
      ...choices(),
      extra: "PRIVATE_SENTINEL",
    }),
  ).toThrow(/unsupported shape/);
});

test("engine and status summaries are bounded and never expose raw records or text", () => {
  const engine = {
    configurationValid: true,
    operationalEnabled: true,
    disclosureVersion: 1,
    ownerConsent: { usage: false, crash: false },
    identityPresent: false,
    queue: { usage: 0, crash: 0, total: 0 },
    suspended: false,
    revocationPending: false,
    pendingWithdrawal: null,
    inFlight: false,
    lastOutcome: "success",
  } as const;
  expect(telemetryConsent_decodeEngineStatus(engine)).toMatchObject({
    configurationValid: true,
    ownerConsent: { usage: false, crash: false },
    lastOutcome: "success",
  });
  expect(() =>
    telemetryConsent_decodeEngineStatus({
      ...engine,
      consent: { telemetry: false, crash: false },
    }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    telemetryConsent_decodeEngineStatus({
      ...engine,
      queue: { usage: 2, crash: 1, total: 4 },
    }),
  ).toThrow(/total is inconsistent/);
  expect(() =>
    telemetryConsent_decodeEngineStatus({
      ...engine,
      lastOutcome: "x".repeat(97),
    }),
  ).toThrow(/bounded string/);

  const decoded = telemetryConsent_decodeStatus(status());
  const serialized = JSON.stringify(decoded);
  for (const forbidden of [
    "installId",
    "queueRecord",
    "fingerprint",
    "PRIVATE_SENTINEL",
    "/Users/example/private",
    "provider-error",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(decoded.delivery).toEqual({
    state: "endpoint-accepted",
    receipt: "not-observed",
  });
  expect(decoded.engine).toMatchObject({
    ownerConsent: { usage: true, crash: false },
    withdrawalPending: { usage: false, crash: false },
  });
});

test("pending, checkpoint and persistence decoders bind revision order strictly", () => {
  const desired = choices(choice("denied"), choice("denied"));
  const pending = {
    requestRevision: 3,
    disclosureVersion: 1,
    state: "queued",
    desired,
    outcome: "pending",
  } as const;
  expect(
    telemetryConsent_decodeCheckpoint({
      schemaVersion: telemetryConsent_schemaVersion,
      latestRequestRevision: 3,
      desired,
      durable: choices(),
      pending,
    }),
  ).toMatchObject({ latestRequestRevision: 3, pending });
  expect(() =>
    telemetryConsent_decodeStatus(
      status({
        latestRequestRevision: 4,
        desired,
        pending,
      }),
    ),
  ).toThrow(/pending request does not match/);
  expect(() =>
    telemetryConsent_decodeStatus(
      status({
        latestRequestRevision: 3,
        desired: choices(),
        pending,
      }),
    ),
  ).toThrow(/pending choices do not match/);
  expect(() =>
    telemetryConsent_decodeStatus(
      status({
        outcome: "saved",
        requiresRestartInspection: true,
      }),
    ),
  ).toThrow(/restart inspection must use/);
  expect(
    telemetryConsent_decodePersistenceResult({
      schemaVersion: telemetryConsent_schemaVersion,
      requestRevision: 3,
      engineDurable: true,
      provenanceDurable: false,
    }),
  ).toMatchObject({ engineDurable: true, provenanceDurable: false });
  expect(() =>
    telemetryConsent_decodePersistenceResult({
      schemaVersion: telemetryConsent_schemaVersion,
      requestRevision: 3,
      engineDurable: true,
      provenanceDurable: false,
      saved: true,
    }),
  ).toThrow(/unsupported shape/);
});
