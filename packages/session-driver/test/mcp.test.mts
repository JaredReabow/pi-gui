import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mcp_checkpoint_inspect,
  mcp_approvalStates,
  mcp_cancellationStates,
  mcp_decodeAuthHandoff,
  mcp_decodeAuthentication,
  mcp_decodeCancellation,
  mcp_decodeCheckpoint,
  mcp_decodeConfigDescriptor,
  mcp_decodeConfigSource,
  mcp_decodeEffectiveServer,
  mcp_decodeLifecycleObservation,
  mcp_decodeOperation,
  mcp_decodeOwnershipDescriptor,
  mcp_decodePersistenceObservation,
  mcp_decodeReadinessFact,
  mcp_decodeSecretPresence,
  mcp_decodeServerScope,
  mcp_decodeSkillsObservation,
  mcp_decodeTerminal,
  mcp_decodeTransportDescriptor,
  mcp_decodeTransportObservation,
  mcp_dispatchStates,
  mcp_factProvenance,
  mcp_cancellation_hasConsistentDispatch,
  mcp_cancellation_hasConsistentTimestamps,
  mcp_lifecycleTransitions,
  mcp_lifecycle_canTransition,
  mcp_lifecycle_project,
  mcp_lifecycleStates,
  mcp_operation_canAutomaticallyReplay,
  mcp_operation_approvalAllowsPhase,
  mcp_operation_cancellationAllowsPhase,
  mcp_operation_isTerminal,
  mcp_operation_phaseAllowsDispatch,
  mcp_operationPhases,
  mcp_operation_recover,
  mcp_persistence_project,
  mcp_probe_certifiesOnly,
  mcp_probeKinds,
  mcp_readinessFacts,
  mcp_restart_generationIsAdvancing,
  mcp_schemaVersion,
  type McpCheckpoint,
  type McpApprovalState,
  type McpCancellationState,
  type McpConfigDescriptor,
  type McpDispatchState,
  type McpLifecycleObservation,
  type McpOperationPhase,
  type McpOperationRecord,
  type McpPersistenceObservation,
  type McpReadinessFact,
  type McpServerScope,
} from "../dist/mcp.js";

const at = 1_764_000_000_000;
const freshUntil = at + 60_000;
const argumentDigest = "a".repeat(64);

const sessionScope = {
  kind: "session",
  workspaceId: "workspace-1",
  sessionId: "session-1",
} as const;
const serverScope: McpServerScope = {
  ...sessionScope,
  serverId: "server-1",
};

function readinessFact(overrides: Partial<McpReadinessFact> = {}): McpReadinessFact {
  const fact = overrides.fact ?? "configured";
  return {
    fact,
    state: fact === "authenticated" ? "met" : "met",
    provenance: mcp_factProvenance[fact],
    scope: serverScope,
    configRevision: 7,
    generation: 3,
    observedAt: at,
    freshUntil,
    reasonCode: "none",
    ...overrides,
  };
}

function lifecycle(overrides: Partial<McpLifecycleObservation> = {}): McpLifecycleObservation {
  return {
    schemaVersion: mcp_schemaVersion,
    state: "ready",
    observerPresent: true,
    scope: serverScope,
    configRevision: 7,
    generation: 3,
    observedAt: at,
    freshUntil,
    transportObservation: {
      transport: "streamable-http",
      httpEndpointReachable: true,
      ownedStdioProcessAlive: false,
      externalProcessObserved: false,
      observedAt: at,
      freshUntil,
    },
    authentication: {
      state: "authenticated",
      owner: "pi-credential-store",
      credentialKinds: ["oauth"],
      scope: serverScope,
      configRevision: 7,
      generation: 3,
      observedAt: at,
      freshUntil,
      reasonCode: "none",
    },
    readiness: mcp_readinessFacts.map((fact) => readinessFact({ fact })),
    ...overrides,
  };
}

function config(): McpConfigDescriptor {
  return {
    schemaVersion: mcp_schemaVersion,
    scope: sessionScope,
    revision: 7,
    autoEnableCodeMode: false,
    sources: [
      {
        source: "user",
        state: "present",
        trust: "not-applicable",
        revision: 7,
        entryCount: 1,
      },
    ],
    servers: [
      {
        serverId: "server-1",
        source: "user",
        definition: "full",
        overridden: false,
        enabled: true,
        exposure: "deferred",
        transport: {
          kind: "streamable-http",
          endpoint: "https://example.invalid/mcp",
          headerNameCount: 1,
        },
        ownership: {
          kind: "external-http-service",
          cleanupOwner: "external-owner",
          externalStateOwner: "external-application",
        },
        toolCount: 2,
        secretPresence: {
          environment: false,
          headers: true,
          oauth: true,
          providerAuth: false,
          credentialLikeArguments: false,
          unknownFields: false,
        },
        reasonCode: "none",
      },
    ],
    diagnostics: [],
  };
}

function operation(overrides: Partial<McpOperationRecord> = {}): McpOperationRecord {
  return {
    schemaVersion: mcp_schemaVersion,
    operationId: "operation-1",
    parentToolCallId: "tool-call-1",
    scope: serverScope,
    configRevision: 7,
    generation: 3,
    toolName: "browser_status",
    argumentDigest,
    phase: "dispatch-started",
    dispatchState: "possibly-dispatched",
    approval: {
      state: "approved",
      owner: "browser-companion",
      approvalGeneration: 4,
      current: true,
    },
    cancellation: null,
    terminal: null,
    transportReplaced: false,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function persistence(
  overrides: Partial<McpPersistenceObservation> = {},
): McpPersistenceObservation {
  return {
    schemaVersion: mcp_schemaVersion,
    status: "saved",
    baseConfigRevision: 7,
    savedConfigRevision: 7,
    sessions: [
      {
        sessionId: "session-1",
        generation: 3,
        observedConfigRevision: 7,
        reobserved: true,
      },
    ],
    ...overrides,
  };
}

function checkpoint(): McpCheckpoint {
  return {
    schemaVersion: mcp_schemaVersion,
    checkpointId: "checkpoint-1",
    createdAt: at,
    scope: sessionScope,
    configRevision: 7,
    generation: 3,
    config: config(),
    persistence: persistence(),
    lifecycles: [lifecycle()],
    operations: [
      operation(),
      operation({
        operationId: "operation-terminal",
        phase: "result-known",
        dispatchState: "confirmed-dispatched",
        approval: null,
        terminal: {
          kind: "success",
          settledAt: at + 1,
          resultRef: "result-reference-1",
        },
      }),
    ],
    skills: {
      schemaVersion: mcp_schemaVersion,
      state: "observed-restored",
      provenance: "runtime-supervisor",
      scope: sessionScope,
      configRevision: 7,
      generation: 3,
      observedAt: at,
      freshUntil,
      automaticReload: false,
      registryRead: false,
    },
  };
}

await test("accepted R-D10 dependency hashes and Stage 0 source stay browser-safe", () => {
  const root = new URL("../../../", import.meta.url);
  const inputRoot = new URL("artifacts/distribution/R-D10-MCP-INTEGRATION/SUCCESSOR-01/", root);
  const hash = (file: string) =>
    createHash("sha256")
      .update(readFileSync(new URL(file, inputRoot)))
      .digest("hex");
  assert.equal(
    hash("SHA256SUMS"),
    "bcc6bed30d5a9e498085adb348f388ac11f8dacb19e01fa62be9c3c8dda3b49b",
  );
  assert.equal(
    hash("manifest.json"),
    "5eeb665e485a7cefca3a136b1a0fb495aae4075b5451f5f6a23d78ea09e4d2b0",
  );
  assert.equal(
    hash("REVIEW_RESPONSE.md"),
    "4295deebffc81e959ac8e6fc49e6e862054d71233aa6dce8d14b9f9c2a92fd7b",
  );

  const source = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /\bfrom\s+["'](?:node:|electron|fs|path|child_process|@earendil-works\/)/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:fetch|require|spawn|exec|readFile|writeFile|ipcMain|ipcRenderer)\s*\(/,
  );
  assert.doesNotMatch(source, /\b(?:globalThis\.)?process\.(?:env|cwd|pid|exit|platform)\b/);
  assert.doesNotMatch(source, /\bDate\.now\b|\bnew Date\b/);
  assert.doesNotMatch(source, /\bas unknown\b/);
});

await test("lifecycle and readiness vocabulary is closed and exact", () => {
  assert.deepEqual(mcp_lifecycleStates, [
    "missing",
    "disabled",
    "starting",
    "ready",
    "degraded",
    "disconnected",
    "auth-required",
    "approval-pending",
    "denied",
    "cancelled",
    "unknown",
  ]);
  assert.equal(mcp_lifecycleStates.length, 11);
  assert.equal(new Set(mcp_lifecycleStates).size, 11);
  assert.equal(mcp_lifecycleStates.includes("failed"), false);
  assert.deepEqual(mcp_readinessFacts, [
    "configured",
    "transport-alive",
    "protocol-initialized",
    "authenticated",
    "tool-available",
    "operation-verified",
  ]);
  assert.equal(mcp_readinessFacts.length, 6);
  assert.deepEqual(Object.keys(mcp_lifecycleTransitions).sort(), [...mcp_lifecycleStates].sort());
});

await test("strict decoders return fresh bounded data", () => {
  const input = lifecycle();
  const decoded = mcp_decodeLifecycleObservation(input);
  assert.deepEqual(decoded, input);
  assert.notEqual(decoded, input);
  assert.notEqual(decoded.readiness, input.readiness);
  assert.notEqual(decoded.readiness[0], input.readiness[0]);
  const clone = decoded.readiness.map((fact) => ({ ...fact }));
  clone[0]!.state = "not-met";
  assert.equal(decoded.readiness[0]!.state, "met");
  assert.equal(input.readiness[0]!.state, "met");
});

await test("focused decoders preserve scoped configuration, transport and auth identity", () => {
  assert.deepEqual(mcp_decodeServerScope(serverScope), serverScope);
  assert.equal(mcp_decodeReadinessFact(readinessFact()).fact, "configured");
  assert.equal(
    mcp_decodeTransportObservation(lifecycle().transportObservation).externalProcessObserved,
    false,
  );
  assert.equal(mcp_decodeAuthentication(lifecycle().authentication).state, "authenticated");
  assert.equal(mcp_decodeConfigSource(config().sources[0]).source, "user");
  const effectiveServer = config().servers[0]!;
  assert.equal(mcp_decodeEffectiveServer(effectiveServer).serverId, "server-1");
  assert.equal(mcp_decodeTransportDescriptor(effectiveServer.transport).kind, "streamable-http");
  assert.equal(
    mcp_decodeOwnershipDescriptor(effectiveServer.ownership).kind,
    "external-http-service",
  );
  assert.equal(mcp_decodeSecretPresence(effectiveServer.secretPresence).oauth, true);
  assert.equal(mcp_decodeConfigDescriptor(config()).servers.length, 1);
  assert.equal(mcp_decodeOperation(operation()).approval?.state, "approved");
  assert.equal(mcp_decodeCancellation(null), null);
  assert.equal(mcp_decodeTerminal(null), null);
  assert.equal(mcp_decodePersistenceObservation(persistence()).status, "saved");
  assert.equal(mcp_decodeSkillsObservation(checkpoint().skills).registryRead, false);
  assert.equal(mcp_decodeCheckpoint(checkpoint()).checkpointId, "checkpoint-1");
});

await test("decoders reject unknown fields, accessors, symbols, inherited values and hostile prototypes", () => {
  assert.throws(
    () => mcp_decodeLifecycleObservation({ ...lifecycle(), detail: "raw server error" }),
    /unsupported shape/,
  );
  assert.throws(
    () => mcp_decodeConfigDescriptor({ ...config(), env: { TOKEN: "forged" } }),
    /unsupported shape/,
  );

  let getterRead = false;
  const accessor = { ...operation() };
  Object.defineProperty(accessor, "toolName", {
    enumerable: true,
    get() {
      getterRead = true;
      return "browser_status";
    },
  });
  assert.throws(() => mcp_decodeOperation(accessor), /enumerable data/);
  assert.equal(getterRead, false);

  const symbol = lifecycle();
  Object.defineProperty(symbol, Symbol("forged"), {
    enumerable: true,
    value: "forged",
  });
  assert.throws(() => mcp_decodeLifecycleObservation(symbol), /symbol fields/);

  const inherited = {};
  Object.setPrototypeOf(inherited, { observerPresent: true });
  assert.throws(() => mcp_decodeLifecycleObservation(inherited), /plain JSON object/);

  const polluted = lifecycle();
  Object.defineProperty(polluted, "__proto__", {
    enumerable: true,
    value: { state: "ready" },
  });
  assert.throws(() => mcp_decodeLifecycleObservation(polluted), /unsupported shape/);
});

await test("decoders reject malformed values, cross-association, stale freshness and secrets", () => {
  assert.throws(
    () => mcp_decodeOperation({ ...operation(), argumentDigest: "not-a-digest" }),
    /SHA-256/,
  );
  assert.throws(
    () => mcp_decodeLifecycleObservation({ ...lifecycle(), freshUntil: at - 1 }),
    /cannot precede/,
  );
  assert.throws(
    () =>
      mcp_decodeCheckpoint({
        ...checkpoint(),
        operations: [
          {
            ...operation(),
            scope: { ...serverScope, sessionId: "other-session" },
          },
        ],
      }),
    /cross-associated/,
  );
  assert.throws(
    () =>
      mcp_decodeConfigDescriptor({
        ...config(),
        servers: [
          {
            ...config().servers[0],
            transport: {
              kind: "streamable-http",
              endpoint: "https://token:secret@example.invalid/mcp?token=value#fragment",
              headerNameCount: 1,
            },
          },
        ],
      }),
    /userinfo, query, or fragment/,
  );
  assert.throws(
    () =>
      mcp_decodeConfigDescriptor({
        ...config(),
        servers: [
          {
            ...config().servers[0],
            ownership: {
              kind: "owned-stdio-process",
              cleanupOwner: "pi-session",
              externalStateOwner: "none",
            },
          },
        ],
      }),
    /process ownership/,
  );
  assert.throws(() => mcp_decodeOperation({ ...operation(), toolName: "\ud800" }), /valid Unicode/);
  assert.throws(
    () => mcp_decodeOperation({ ...operation(), operationId: "a".repeat(161) }),
    /opaque identifier/,
  );
  assert.throws(
    () =>
      mcp_decodeOperation({
        ...operation(),
        operationId: "https://example.invalid/raw-detail",
      }),
    /opaque URL/,
  );
  assert.throws(
    () =>
      mcp_decodeOperation({
        ...operation(),
        parentToolCallId: "sk-live-credential-value",
      }),
    /credential material/,
  );
  assert.throws(
    () => mcp_decodeConfigSource({ ...config().sources[0], entryCount: 129 }),
    /non-negative safe integer/,
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => mcp_decodeConfigDescriptor(cyclic), /cyclic/);
});

await test("six readiness facts stay independent and no lower fact fabricates Ready", () => {
  const noObserver = mcp_lifecycle_project(
    lifecycle({
      state: "unknown",
      observerPresent: false,
    }),
    at,
  );
  assert.deepEqual(noObserver, {
    state: "unknown",
    label: "configured",
    ready: false,
    missingFacts: [],
    reasonCode: "stale-observation",
    automaticAction: false,
  });

  const missingConfig = mcp_lifecycle_project(
    lifecycle({
      state: "unknown",
      observerPresent: false,
      readiness: mcp_readinessFacts.map((fact) =>
        readinessFact({
          fact,
          state: fact === "configured" ? "not-met" : "met",
          reasonCode: fact === "configured" ? "configuration-missing" : "none",
        }),
      ),
    }),
    at,
  );
  assert.equal(missingConfig.label, "unknown");
  assert.equal(missingConfig.ready, false);

  for (const fact of mcp_readinessFacts.slice(0, -1)) {
    const input = lifecycle({
      authentication:
        fact === "authenticated"
          ? {
              ...lifecycle().authentication,
              state: "required",
              reasonCode: "authentication-required",
            }
          : lifecycle().authentication,
      transportObservation:
        fact === "transport-alive"
          ? {
              ...lifecycle().transportObservation,
              httpEndpointReachable: false,
            }
          : lifecycle().transportObservation,
      readiness: mcp_readinessFacts.map((entry) =>
        readinessFact({
          fact: entry,
          state: entry === fact ? "not-met" : "met",
          reasonCode: entry === fact ? "transport-unreachable" : "none",
        }),
      ),
    });
    const projected = mcp_lifecycle_project(input, at);
    assert.equal(projected.ready, false, fact);
    assert.ok(projected.missingFacts.includes(fact), fact);
  }

  const noHarmlessCheck = mcp_lifecycle_project(
    lifecycle({
      readiness: mcp_readinessFacts.map((fact) =>
        readinessFact({
          fact,
          state: fact === "operation-verified" ? "not-applicable" : "met",
          reasonCode: fact === "operation-verified" ? "harmless-check-not-defined" : "none",
        }),
      ),
    }),
    at,
  );
  assert.deepEqual(noHarmlessCheck, {
    state: "degraded",
    label: "available-no-harmless-check",
    ready: false,
    missingFacts: ["operation-verified"],
    reasonCode: "harmless-check-not-defined",
    automaticAction: false,
  });

  assert.equal(mcp_lifecycle_project(lifecycle(), at).ready, true);
});

await test("HTTP reachability, owned stdio process and external process are distinct", () => {
  const http = lifecycle({
    transportObservation: {
      transport: "streamable-http",
      httpEndpointReachable: true,
      ownedStdioProcessAlive: false,
      externalProcessObserved: false,
      observedAt: at,
      freshUntil,
    },
    authentication: {
      ...lifecycle().authentication,
      state: "required",
      reasonCode: "authentication-required",
    },
    readiness: mcp_readinessFacts.map((fact) =>
      readinessFact({
        fact,
        state: fact === "authenticated" ? "not-met" : "met",
        reasonCode: fact === "authenticated" ? "authentication-required" : "none",
      }),
    ),
    state: "auth-required",
  });
  const decoded = mcp_decodeLifecycleObservation(http);
  assert.equal(decoded.transportObservation.httpEndpointReachable, true);
  assert.equal(decoded.transportObservation.ownedStdioProcessAlive, false);
  assert.equal(decoded.transportObservation.externalProcessObserved, false);
  assert.equal(decoded.authentication.state, "required");
  assert.equal(mcp_lifecycle_project(http, at).ready, false);

  assert.throws(
    () =>
      mcp_decodeTransportObservation({
        transport: "streamable-http",
        httpEndpointReachable: true,
        ownedStdioProcessAlive: true,
        externalProcessObserved: true,
        observedAt: at,
        freshUntil,
      }),
    /owned stdio process/,
  );
  assert.throws(
    () =>
      mcp_decodeTransportObservation({
        transport: "stdio",
        httpEndpointReachable: true,
        ownedStdioProcessAlive: true,
        externalProcessObserved: false,
        observedAt: at,
        freshUntil,
      }),
    /HTTP reachability/,
  );
});

await test("auth handoffs cannot approve themselves or grant capability", () => {
  const handoff = {
    handoffId: "handoff-1",
    operationId: "operation-1",
    kind: "native-approval",
    owner: "global-ssh-connect",
    scope: serverScope,
    configRevision: 7,
    generation: 3,
    approvalGeneration: 4,
    requestedAt: at,
    automaticDecision: false,
    grantsCapability: false,
  } as const;
  assert.deepEqual(mcp_decodeAuthHandoff(handoff), handoff);
  assert.throws(
    () => mcp_decodeAuthHandoff({ ...handoff, automaticDecision: true }),
    /cannot approve itself/,
  );
  assert.throws(
    () => mcp_decodeAuthHandoff({ ...handoff, grantsCapability: true }),
    /cannot approve itself/,
  );
});

await test("approval state determines every permitted operation phase", () => {
  const expected: Readonly<Record<McpApprovalState, readonly McpOperationPhase[]>> = {
    "not-required": [
      "requested",
      "policy-checking",
      "approved-before-dispatch",
      "dispatch-started",
      "result-known",
      "denied",
      "cancelled-before-dispatch",
      "outcome-unknown",
    ],
    pending: ["approval-pending"],
    approved: [
      "approved-before-dispatch",
      "dispatch-started",
      "result-known",
      "cancelled-before-dispatch",
      "outcome-unknown",
    ],
    denied: ["denied"],
    cancelled: ["cancelled-before-dispatch"],
    stale: [
      "approved-before-dispatch",
      "dispatch-started",
      "result-known",
      "cancelled-before-dispatch",
      "outcome-unknown",
    ],
  };
  for (const approval of mcp_approvalStates) {
    for (const phase of mcp_operationPhases) {
      assert.equal(
        mcp_operation_approvalAllowsPhase(approval, phase),
        expected[approval].includes(phase),
        `${approval} -> ${phase}`,
      );
    }
  }
  for (const phase of mcp_operationPhases) {
    assert.equal(
      mcp_operation_approvalAllowsPhase(null, phase),
      expected["not-required"].includes(phase),
      `no approval -> ${phase}`,
    );
  }

  for (const approval of ["denied", "pending"] as const) {
    for (const phase of [
      "approved-before-dispatch",
      "dispatch-started",
      "result-known",
      "outcome-unknown",
    ] as const) {
      assert.throws(
        () =>
          mcp_decodeOperation(
            operation({
              phase,
              dispatchState:
                phase === "approved-before-dispatch" ? "not-dispatched" : "possibly-dispatched",
              approval: {
                state: approval,
                owner: "browser-companion",
                approvalGeneration: 4,
                current: true,
              },
              terminal:
                phase === "result-known"
                  ? { kind: "success", settledAt: at + 1, resultRef: "result-approval" }
                  : null,
            }),
          ),
        /approval state/,
        `${approval} -> ${phase}`,
      );
    }
  }
});

await test("phase and dispatch certainty have a closed transition matrix", () => {
  const expected: Readonly<Record<McpOperationPhase, readonly McpDispatchState[]>> = {
    requested: ["not-dispatched"],
    "policy-checking": ["not-dispatched"],
    "approval-pending": ["not-dispatched"],
    "approved-before-dispatch": ["not-dispatched"],
    "dispatch-started": ["possibly-dispatched", "confirmed-dispatched"],
    "result-known": ["not-dispatched", "possibly-dispatched", "confirmed-dispatched"],
    denied: ["not-dispatched"],
    "cancelled-before-dispatch": ["not-dispatched"],
    "outcome-unknown": ["possibly-dispatched", "confirmed-dispatched"],
  };
  for (const phase of mcp_operationPhases) {
    for (const dispatch of mcp_dispatchStates) {
      assert.equal(
        mcp_operation_phaseAllowsDispatch(phase, dispatch),
        expected[phase].includes(dispatch),
        `${phase} -> ${dispatch}`,
      );
    }
  }
});

await test("cancellation confirmation and dispatch matrices reject every contradiction", () => {
  const expectedTimestamps: Readonly<Record<McpCancellationState, readonly [boolean, boolean]>> = {
    requested: [true, false],
    "confirmed-before-dispatch": [false, true],
    "possibly-after-dispatch": [true, false],
  };
  const expectedDispatch: Readonly<
    Record<McpCancellationState, readonly [boolean, boolean, boolean]>
  > = {
    requested: [true, true, true],
    "confirmed-before-dispatch": [true, false, false],
    "possibly-after-dispatch": [false, true, true],
  };
  for (const state of mcp_cancellationStates) {
    for (const [index, confirmedAt] of [null, at + 1].entries()) {
      const accepted = expectedTimestamps[state][index];
      assert.equal(mcp_cancellation_hasConsistentTimestamps(state, at, confirmedAt), accepted);
      const descriptor = { state, requestedAt: at, confirmedAt };
      if (accepted) {
        assert.deepEqual(mcp_decodeCancellation(descriptor), descriptor);
      } else {
        assert.throws(() => mcp_decodeCancellation(descriptor), /confirmation timestamp/);
      }
    }
    for (const [index, dispatch] of mcp_dispatchStates.entries()) {
      assert.equal(
        mcp_cancellation_hasConsistentDispatch(state, dispatch),
        expectedDispatch[state][index],
        `${state} -> ${dispatch}`,
      );
    }
  }
  assert.equal(mcp_cancellation_hasConsistentTimestamps("requested", at, at - 1), false);
  assert.equal(
    mcp_cancellation_hasConsistentTimestamps("confirmed-before-dispatch", at, at - 1),
    false,
  );

  assert.throws(
    () =>
      mcp_decodeOperation(
        operation({
          phase: "outcome-unknown",
          dispatchState: "not-dispatched",
          cancellation: {
            state: "possibly-after-dispatch",
            requestedAt: at,
            confirmedAt: null,
          },
        }),
      ),
    /cancellation|dispatch/,
  );
});

await test("cancellation state determines every permitted operation phase", () => {
  const expected: Readonly<Record<McpCancellationState, readonly McpOperationPhase[]>> = {
    requested: [
      "requested",
      "policy-checking",
      "approval-pending",
      "approved-before-dispatch",
      "dispatch-started",
      "result-known",
      "outcome-unknown",
    ],
    "confirmed-before-dispatch": ["cancelled-before-dispatch"],
    "possibly-after-dispatch": ["result-known", "outcome-unknown"],
  };
  for (const cancellation of mcp_cancellationStates) {
    for (const phase of mcp_operationPhases) {
      assert.equal(
        mcp_operation_cancellationAllowsPhase(cancellation, phase),
        expected[cancellation].includes(phase),
        `${cancellation} -> ${phase}`,
      );
    }
  }
  assert.equal(mcp_operation_cancellationAllowsPhase(null, "cancelled-before-dispatch"), false);
});

await test("operation phases distinguish approval, possible dispatch, confirmed cancellation and terminal results", () => {
  assert.deepEqual(
    mcp_decodeOperation(
      operation({
        phase: "approval-pending",
        dispatchState: "not-dispatched",
        approval: {
          state: "pending",
          owner: "browser-companion",
          approvalGeneration: 4,
          current: true,
        },
      }),
    ).phase,
    "approval-pending",
  );
  assert.equal(mcp_decodeOperation(operation()).dispatchState, "possibly-dispatched");

  const cancelledBefore = operation({
    operationId: "operation-cancelled",
    phase: "cancelled-before-dispatch",
    dispatchState: "not-dispatched",
    cancellation: {
      state: "confirmed-before-dispatch",
      requestedAt: at + 2,
      confirmedAt: at + 3,
    },
    terminal: {
      kind: "cancelled",
      settledAt: at + 3,
      resultRef: null,
    },
  });
  assert.equal(mcp_operation_isTerminal(cancelledBefore), true);

  const terminal = operation({
    phase: "result-known",
    dispatchState: "confirmed-dispatched",
    terminal: {
      kind: "success",
      settledAt: at + 4,
      resultRef: "result-1",
    },
  });
  assert.equal(mcp_operation_isTerminal(terminal), true);

  assert.throws(
    () =>
      mcp_decodeOperation({
        ...cancelledBefore,
        cancellation: {
          state: "requested",
          requestedAt: at + 2,
          confirmedAt: null,
        },
      }),
    /requires confirmation/,
  );
  assert.throws(
    () => mcp_decodeOperation({ ...operation(), phase: "result-known" }),
    /requires a terminal result/,
  );
});

await test("recovery preserves approvals, invalidates assumptions and never replays", () => {
  for (const trigger of ["timeout", "disconnect", "reconnect", "restart", "configuration-change"]) {
    const recovered = mcp_operation_recover(operation(), {
      trigger,
      observedAt: at + 5,
      generation: trigger === "configuration-change" ? 3 : 4,
      configRevision: trigger === "configuration-change" ? 8 : 7,
    });
    assert.equal(recovered.phase, "outcome-unknown", trigger);
    assert.deepEqual(recovered.approvalPreserved, operation().approval, trigger);
    assert.equal(recovered.approvalCurrent, false, trigger);
    assert.equal(recovered.automaticReplay, false, trigger);
    assert.equal(recovered.requiresUserReconciliation, true, trigger);
    assert.equal(mcp_operation_canAutomaticallyReplay(operation()), false, trigger);
  }

  const knownNotDispatched = mcp_operation_recover(
    operation({
      phase: "approval-pending",
      dispatchState: "not-dispatched",
      approval: {
        state: "pending",
        owner: "global-ssh-connect",
        approvalGeneration: 4,
        current: true,
      },
    }),
    {
      trigger: "restart",
      observedAt: at + 5,
      generation: 4,
      configRevision: 7,
    },
  );
  assert.equal(knownNotDispatched.phase, "approval-pending");
  assert.equal(knownNotDispatched.dispatchState, "not-dispatched");
  assert.equal(knownNotDispatched.reasonCode, "restart-inspection-required");
  assert.equal(knownNotDispatched.requiresUserReconciliation, false);
  assert.equal(knownNotDispatched.requiresFreshApproval, true);
  assert.equal(knownNotDispatched.approvalCurrent, false);
  assert.equal(knownNotDispatched.automaticReplay, false);

  const requestedNotDispatched = mcp_operation_recover(
    operation({
      phase: "requested",
      dispatchState: "not-dispatched",
      approval: null,
    }),
    {
      trigger: "restart",
      observedAt: at + 5,
      generation: 4,
      configRevision: 7,
    },
  );
  assert.equal(requestedNotDispatched.phase, "requested");
  assert.equal(requestedNotDispatched.reasonCode, "restart-inspection-required");
  assert.equal(requestedNotDispatched.requiresUserReconciliation, false);
  assert.equal(requestedNotDispatched.requiresFreshApproval, false);
  assert.equal(requestedNotDispatched.automaticReplay, false);

  const terminal = operation({
    phase: "result-known",
    dispatchState: "confirmed-dispatched",
    terminal: {
      kind: "tool-error",
      settledAt: at + 3,
      resultRef: "result-reference-2",
    },
  });
  const recovered = mcp_operation_recover(terminal, {
    trigger: "restart",
    observedAt: at + 6,
    generation: 4,
    configRevision: 7,
  });
  assert.equal(recovered.phase, "result-known");
  assert.deepEqual(recovered.terminal, terminal.terminal);
  assert.equal(recovered.automaticReplay, false);
});

await test("restart generation rules agree across direct recovery and checkpoints", () => {
  assert.equal(mcp_restart_generationIsAdvancing(3, 3), false);
  assert.equal(mcp_restart_generationIsAdvancing(3, 2), false);
  assert.equal(mcp_restart_generationIsAdvancing(3, 4), true);

  const approvedPreDispatch = operation({
    operationId: "operation-approved-pre-dispatch",
    phase: "approved-before-dispatch",
    dispatchState: "not-dispatched",
  });
  const dispatched = operation({
    operationId: "operation-possibly-dispatched",
    phase: "dispatch-started",
    dispatchState: "possibly-dispatched",
  });
  const confirmedDispatched = operation({
    operationId: "operation-confirmed-dispatched",
    phase: "dispatch-started",
    dispatchState: "confirmed-dispatched",
  });
  const terminal = operation({
    operationId: "operation-result-known",
    phase: "result-known",
    dispatchState: "confirmed-dispatched",
    terminal: {
      kind: "success",
      settledAt: at + 1,
      resultRef: "result-restart",
    },
  });
  const denied = operation({
    operationId: "operation-denied",
    phase: "denied",
    dispatchState: "not-dispatched",
    approval: {
      state: "denied",
      owner: "pi-gui-policy",
      approvalGeneration: 4,
      current: true,
    },
    terminal: {
      kind: "denied",
      settledAt: at + 1,
      resultRef: null,
    },
  });
  const cancelled = operation({
    operationId: "operation-cancelled",
    phase: "cancelled-before-dispatch",
    dispatchState: "not-dispatched",
    cancellation: {
      state: "confirmed-before-dispatch",
      requestedAt: at,
      confirmedAt: at + 1,
    },
    terminal: {
      kind: "cancelled",
      settledAt: at + 1,
      resultRef: null,
    },
  });
  const operations = [
    approvedPreDispatch,
    dispatched,
    confirmedDispatched,
    terminal,
    denied,
    cancelled,
  ];

  for (const candidate of operations) {
    for (const generation of [2, 3]) {
      assert.throws(
        () =>
          mcp_operation_recover(candidate, {
            trigger: "restart",
            observedAt: at + 5,
            generation,
            configRevision: 7,
          }),
        /restart generation must advance/,
        `${candidate.operationId} generation ${generation}`,
      );
    }
  }

  const recoveredApproved = mcp_operation_recover(approvedPreDispatch, {
    trigger: "restart",
    observedAt: at + 5,
    generation: 4,
    configRevision: 7,
  });
  assert.equal(recoveredApproved.phase, "approved-before-dispatch");
  assert.equal(recoveredApproved.dispatchState, "not-dispatched");
  assert.equal(recoveredApproved.approvalCurrent, false);
  assert.equal(recoveredApproved.requiresFreshApproval, true);
  assert.equal(recoveredApproved.requiresUserReconciliation, false);
  assert.equal(recoveredApproved.automaticReplay, false);

  for (const candidate of [dispatched, confirmedDispatched]) {
    const recovered = mcp_operation_recover(candidate, {
      trigger: "restart",
      observedAt: at + 5,
      generation: 4,
      configRevision: 7,
    });
    assert.equal(recovered.phase, "outcome-unknown");
    assert.equal(recovered.dispatchState, candidate.dispatchState);
    assert.equal(recovered.approvalCurrent, false);
    assert.equal(recovered.requiresFreshApproval, true);
    assert.equal(recovered.requiresUserReconciliation, true);
    assert.equal(recovered.automaticReplay, false);
  }

  for (const [candidate, expectedPhase, expectedKind] of [
    [terminal, "result-known", "success"],
    [denied, "denied", "denied"],
    [cancelled, "cancelled-before-dispatch", "cancelled"],
  ] as const) {
    const recovered = mcp_operation_recover(candidate, {
      trigger: "restart",
      observedAt: at + 5,
      generation: 4,
      configRevision: 7,
    });
    assert.equal(recovered.phase, expectedPhase);
    assert.equal(recovered.terminal?.kind, expectedKind);
    assert.equal(recovered.approvalCurrent, false);
    assert.equal(recovered.requiresUserReconciliation, false);
    assert.equal(recovered.automaticReplay, false);
  }

  const restartCheckpoint = {
    ...checkpoint(),
    operations,
  };
  for (const generation of [2, 3]) {
    assert.throws(
      () => mcp_checkpoint_inspect(restartCheckpoint, generation),
      /restart generation must advance/,
      `checkpoint generation ${generation}`,
    );
  }
  const inspected = mcp_checkpoint_inspect(restartCheckpoint, 4);
  assert.equal(inspected.operations[0]!.phase, "approved-before-dispatch");
  assert.equal(inspected.operations[0]!.dispatchState, "not-dispatched");
  assert.equal(inspected.operations[0]!.requiresUserReconciliation, false);
  assert.equal(inspected.operations[1]!.phase, "outcome-unknown");
  assert.equal(inspected.operations[1]!.requiresUserReconciliation, true);
  assert.equal(inspected.operations[2]!.phase, "outcome-unknown");
  assert.equal(inspected.operations[2]!.requiresUserReconciliation, true);
  assert.equal(inspected.operations[3]!.phase, "result-known");
  assert.equal(inspected.operations[3]!.terminal?.kind, "success");
  assert.equal(inspected.operations[4]!.phase, "denied");
  assert.equal(inspected.operations[4]!.terminal?.kind, "denied");
  assert.equal(inspected.operations[5]!.phase, "cancelled-before-dispatch");
  assert.equal(inspected.operations[5]!.terminal?.kind, "cancelled");
  assert.ok(inspected.operations.every((candidate) => candidate.approvalCurrent === false));
  assert.ok(inspected.operations.every((candidate) => candidate.automaticReplay === false));
});

await test("Browser and SSH status certify only their declared harmless capability", () => {
  assert.deepEqual(mcp_probeKinds, ["browser_status", "ssh_status", "declared-harmless"]);
  assert.equal(mcp_probe_certifiesOnly("browser_status"), "browser-status");
  assert.equal(mcp_probe_certifiesOnly("ssh_status"), "ssh-status");
  assert.equal(mcp_probe_certifiesOnly("declared-harmless"), "server-declared-harmless");
  assert.throws(() => mcp_probe_certifiesOnly("browser_navigate"), /not an accepted value/);
  assert.throws(() => mcp_probe_certifiesOnly("run_ssh_command"), /not an accepted value/);
});

await test("all lifecycle transitions are deterministic and irreversible actions need new evidence", () => {
  for (const from of mcp_lifecycleStates) {
    for (const to of mcp_lifecycleStates) {
      const expected = mcp_lifecycleTransitions[from].some((candidate) => candidate === to);
      const context = {
        newUserAction: true,
        directObservation: true,
      };
      assert.equal(mcp_lifecycle_canTransition(from, to, context), expected, `${from} -> ${to}`);
    }
  }
  assert.equal(mcp_lifecycle_canTransition("denied", "ready"), false);
  assert.equal(mcp_lifecycle_canTransition("denied", "ready", { newUserAction: true }), true);
  assert.equal(mcp_lifecycle_canTransition("cancelled", "ready"), false);
  assert.equal(
    mcp_lifecycle_canTransition("cancelled", "ready", { directObservation: true }),
    true,
  );
  assert.equal(mcp_lifecycle_canTransition("unknown", "ready"), false);
  assert.equal(mcp_lifecycle_canTransition("unknown", "ready", { directObservation: true }), true);
  assert.throws(() => mcp_lifecycle_canTransition("failed", "ready"), /not an accepted value/);
});

await test("saved-active, not-active, partial and conflict overlays remain generation-scoped", () => {
  assert.equal(mcp_persistence_project(persistence()).state, "saved-and-active");
  assert.deepEqual(
    mcp_persistence_project(
      persistence({
        sessions: [
          {
            sessionId: "session-a",
            generation: 3,
            observedConfigRevision: 6,
            reobserved: false,
          },
          {
            sessionId: "session-b",
            generation: 3,
            observedConfigRevision: 6,
            reobserved: false,
          },
        ],
      }),
    ),
    {
      state: "saved-not-active",
      savedConfigRevision: 7,
      activeSessionCount: 0,
      affectedSessionCount: 2,
      reasonCode: "restart-inspection-required",
    },
  );
  assert.equal(
    mcp_persistence_project(
      persistence({
        sessions: [
          {
            sessionId: "session-a",
            generation: 3,
            observedConfigRevision: 7,
            reobserved: true,
          },
          {
            sessionId: "session-b",
            generation: 3,
            observedConfigRevision: 6,
            reobserved: false,
          },
        ],
      }),
    ).state,
    "saved-partial",
  );
  assert.equal(
    mcp_persistence_project(
      persistence({
        status: "conflict",
        savedConfigRevision: null,
      }),
    ).state,
    "conflict",
  );
  assert.equal(
    mcp_persistence_project(
      persistence({
        status: "unsaved",
        savedConfigRevision: null,
      }),
    ).state,
    "unsaved",
  );
});

await test("checkpoint restart preserves unresolved identities and invalidates live assumptions", () => {
  const checkpointWithKnownNotDispatched = checkpoint();
  const inspected = mcp_checkpoint_inspect(
    {
      ...checkpointWithKnownNotDispatched,
      operations: [
        ...checkpointWithKnownNotDispatched.operations,
        operation({
          operationId: "operation-known-not-dispatched",
          phase: "requested",
          dispatchState: "not-dispatched",
          approval: null,
        }),
      ],
    },
    4,
  );
  assert.equal(inspected.previousGeneration, 3);
  assert.equal(inspected.nextGeneration, 4);
  assert.deepEqual(inspected.automaticActions, []);
  assert.deepEqual(inspected.servers, [
    {
      serverId: "server-1",
      previousGeneration: 3,
      state: "unknown",
      observerPresent: false,
      reasonCode: "restart-inspection-required",
      automaticAction: false,
    },
  ]);
  assert.equal(inspected.operations[0]!.phase, "outcome-unknown");
  assert.equal(inspected.operations[0]!.approvalCurrent, false);
  assert.deepEqual(inspected.operations[0]!.approvalPreserved, operation().approval);
  assert.equal(inspected.operations[0]!.automaticReplay, false);
  assert.equal(inspected.operations[0]!.requiresUserReconciliation, true);
  assert.equal(inspected.operations[1]!.phase, "result-known");
  assert.equal(inspected.operations[1]!.terminal?.kind, "success");
  assert.equal(inspected.operations[1]!.requiresUserReconciliation, false);
  assert.equal(inspected.operations[2]!.phase, "requested");
  assert.equal(inspected.operations[2]!.dispatchState, "not-dispatched");
  assert.equal(inspected.operations[2]!.reasonCode, "restart-inspection-required");
  assert.equal(inspected.operations[2]!.requiresUserReconciliation, false);
  assert.equal(inspected.operations[2]!.automaticReplay, false);
  assert.equal(inspected.skills.state, "required");
  assert.equal(inspected.skills.automaticReload, false);
  assert.equal(inspected.skills.registryRead, false);
});

await test("checkpoint decoder rejects stale generations and cross-associated operations", () => {
  const crossAssociated = checkpoint();
  const crossed = {
    ...crossAssociated,
    operations: [
      {
        ...crossAssociated.operations[0]!,
        scope: { ...serverScope, serverId: "other-server" },
      },
    ],
  };
  assert.throws(() => mcp_decodeCheckpoint(crossed), /cross-associated/);
  assert.throws(() => mcp_checkpoint_inspect(checkpoint(), 3), /must advance/);
  assert.throws(
    () =>
      mcp_decodeCheckpoint({
        ...checkpoint(),
        skills: {
          ...checkpoint().skills,
          registryRead: true,
        },
      }),
    /cannot reload or read a registry/,
  );
});
