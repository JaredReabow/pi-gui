import { fileURLToPath } from "node:url";

export const DISTRIBUTION_EVIDENCE_LAYERS = Object.freeze([
  "unit-and-contract",
  "fixture-backed-electron",
  "fixture-backed-browser",
  "native-os",
  "live-provider",
  "companion",
  "uploaded-artifact-verification",
  "production-ingestion",
  "clean-machine-acceptance",
]);

const backgroundElectronDoctor = fileURLToPath(
  new URL("./check-background-electron.mjs", import.meta.url),
);
const playwrightSuite = fileURLToPath(new URL("./run-playwright-suite.mjs", import.meta.url));
const telemetryContractSpec = fileURLToPath(
  new URL("../../apps/desktop/tests/unit/telemetry.spec.ts", import.meta.url),
);
const telemetryLoopbackSpec = fileURLToPath(
  new URL("../../apps/desktop/tests/unit/telemetry-loopback.spec.ts", import.meta.url),
);
const telemetryV01bSpec = fileURLToPath(
  new URL("../../apps/desktop/tests/unit/telemetry-v01b.spec.ts", import.meta.url),
);

function distribution_playwright_check({
  id,
  description,
  evidenceLayer,
  evidenceName,
  expectedTests,
  spec,
}) {
  return {
    id,
    description,
    evidenceLayer,
    command: {
      executable: process.execPath,
      args: [
        playwrightSuite,
        "--evidence-dir",
        `{evidenceDir}/${evidenceName}`,
        "--expected-tests",
        String(expectedTests),
        spec,
      ],
      timeoutMs: 5 * 60_000,
      gracefulTerminationMs: 7_000,
      forceTerminationMs: 5_000,
      blockedExitCodes: [2],
      notRunExitCodes: [3],
    },
  };
}

function distribution_module_pending_checks(moduleId, evidenceLayers) {
  return evidenceLayers.map((evidenceLayer) => ({
    id: `${moduleId}.${evidenceLayer}`,
    description: `Pending ${evidenceLayer} adapter for ${moduleId}.`,
    evidenceLayer,
    status: "not-run",
    reason: "No executable adapter is registered in the combined-harness foundation yet.",
  }));
}

function distribution_module_definition(id, title, evidenceLayers, commandChecks = {}) {
  return Object.freeze({
    id,
    title,
    requiredEvidenceLayers: Object.freeze(evidenceLayers),
    checks: Object.freeze(
      distribution_module_pending_checks(id, evidenceLayers).flatMap((check) => {
        const replacement = commandChecks[check.evidenceLayer] ?? check;
        return Array.isArray(replacement) ? replacement : [replacement];
      }),
    ),
  });
}

export const DISTRIBUTION_CANONICAL_MODULES = Object.freeze([
  distribution_module_definition(
    "feature-parity",
    "Feature parity",
    ["unit-and-contract", "fixture-backed-electron"],
    {
      "fixture-backed-electron": {
        id: "feature-parity.background-electron-doctor",
        description:
          "Launch the built app hidden and verify profile, PID, focus, telemetry, and teardown.",
        evidenceLayer: "fixture-backed-electron",
        command: {
          executable: process.execPath,
          args: [backgroundElectronDoctor, "--evidence-dir", "{evidenceDir}/electron-doctor"],
          timeoutMs: 120_000,
          gracefulTerminationMs: 7_000,
          forceTerminationMs: 5_000,
          blockedExitCodes: [2],
        },
      },
    },
  ),
  distribution_module_definition("setup", "Setup and dependency installation", [
    "unit-and-contract",
    "fixture-backed-electron",
    "clean-machine-acceptance",
  ]),
  distribution_module_definition("accounts", "Accounts and provider linking", [
    "unit-and-contract",
    "live-provider",
  ]),
  distribution_module_definition("permissions", "Platform permissions", [
    "unit-and-contract",
    "native-os",
    "clean-machine-acceptance",
  ]),
  distribution_module_definition("workers", "Agent workers", [
    "unit-and-contract",
    "live-provider",
  ]),
  distribution_module_definition("mcp", "MCP integrations", [
    "unit-and-contract",
    "fixture-backed-electron",
    "companion",
  ]),
  distribution_module_definition(
    "telemetry",
    "Telemetry contract and transport",
    ["unit-and-contract", "production-ingestion"],
    {
      "unit-and-contract": [
        distribution_playwright_check({
          id: "telemetry.contract-and-privacy",
          description:
            "Run the focused schema, consent, queue, privacy, and delivery contract tests.",
          evidenceLayer: "unit-and-contract",
          evidenceName: "telemetry-contract",
          expectedTests: 30,
          spec: telemetryContractSpec,
        }),
        distribution_playwright_check({
          id: "telemetry.loopback-receipt",
          description: "Run the isolated loopback receipt test.",
          evidenceLayer: "unit-and-contract",
          evidenceName: "telemetry-loopback",
          expectedTests: 1,
          spec: telemetryLoopbackSpec,
        }),
        distribution_playwright_check({
          id: "telemetry.v01b-regressions",
          description: "Run the independent V01B telemetry regressions.",
          evidenceLayer: "unit-and-contract",
          evidenceName: "telemetry-v01b",
          expectedTests: 13,
          spec: telemetryV01bSpec,
        }),
      ],
    },
  ),
  distribution_module_definition("donations", "Support and donations", [
    "unit-and-contract",
    "fixture-backed-electron",
  ]),
  distribution_module_definition("lifecycle", "Lifecycle, updates, and recovery", [
    "unit-and-contract",
    "fixture-backed-electron",
    "clean-machine-acceptance",
  ]),
  distribution_module_definition("packaging", "Packaging and release artifacts", [
    "unit-and-contract",
    "uploaded-artifact-verification",
    "clean-machine-acceptance",
  ]),
  distribution_module_definition("website", "Public website and downloads", [
    "fixture-backed-browser",
    "uploaded-artifact-verification",
  ]),
  distribution_module_definition("performance", "Performance and responsiveness", [
    "unit-and-contract",
    "fixture-backed-electron",
  ]),
  distribution_module_definition("privacy", "Privacy and data isolation", [
    "unit-and-contract",
    "clean-machine-acceptance",
  ]),
]);
