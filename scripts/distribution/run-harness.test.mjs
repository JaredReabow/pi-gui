import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { distribution_run_owned_process } from "./process-control.mjs";
import { distribution_run_harness, distribution_validate_modules } from "./run-harness.mjs";
import { DISTRIBUTION_CANONICAL_MODULES } from "./modules.mjs";

const stubbornProcessTree = fileURLToPath(
  new URL("./fixtures/stubborn-process-tree.mjs", import.meta.url),
);

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function evidenceCheck(id, layer, sequence) {
  return {
    id,
    evidenceLayer: layer,
    timeoutMs: 5_000,
    async run(context) {
      sequence.push(id);
      const path = join(context.evidenceDir, `${id}.txt`);
      await writeFile(path, `${id}\n`, "utf8");
      return {
        status: "pass",
        evidence: [{ kind: "self-test", path }],
      };
    },
  };
}

test("the canonical registry covers every combined-harness area", () => {
  assert.deepEqual(
    DISTRIBUTION_CANONICAL_MODULES.map((module) => module.id),
    [
      "feature-parity",
      "setup",
      "accounts",
      "permissions",
      "workers",
      "mcp",
      "telemetry",
      "donations",
      "lifecycle",
      "packaging",
      "website",
      "performance",
      "privacy",
    ],
  );
  assert.equal(distribution_validate_modules(DISTRIBUTION_CANONICAL_MODULES), true);
});

test("telemetry files are registered as executable adapters instead of placeholders", () => {
  const telemetry = DISTRIBUTION_CANONICAL_MODULES.find((module) => module.id === "telemetry");
  assert.ok(telemetry);
  const unitChecks = telemetry.checks.filter(
    (check) => check.evidenceLayer === "unit-and-contract",
  );
  assert.deepEqual(
    unitChecks.map((check) => check.id),
    ["telemetry.contract-and-privacy", "telemetry.loopback-receipt", "telemetry.v01b-regressions"],
  );
  assert.deepEqual(
    unitChecks.map((check) => check.command.args.at(-1)),
    [
      fileURLToPath(new URL("../../apps/desktop/tests/unit/telemetry.spec.ts", import.meta.url)),
      fileURLToPath(
        new URL("../../apps/desktop/tests/unit/telemetry-loopback.spec.ts", import.meta.url),
      ),
      fileURLToPath(
        new URL("../../apps/desktop/tests/unit/telemetry-v01b.spec.ts", import.meta.url),
      ),
    ],
  );
  assert.deepEqual(
    unitChecks.map((check) => check.command.args[2]),
    [
      "{evidenceDir}/telemetry-contract",
      "{evidenceDir}/telemetry-loopback",
      "{evidenceDir}/telemetry-v01b",
    ],
  );
  assert.deepEqual(
    unitChecks.map((check) => check.command.args[4]),
    ["30", "1", "13"],
  );
  for (const check of unitChecks) {
    assert.equal(check.status, undefined);
    assert.equal(check.command.blockedExitCodes[0], 2);
    assert.equal(check.command.notRunExitCodes[0], 3);
    assert.equal(existsSync(check.command.args.at(-1)), true);
  }
  assert.equal(
    telemetry.checks.find((check) => check.evidenceLayer === "production-ingestion").status,
    "not-run",
  );

  const featureParity = DISTRIBUTION_CANONICAL_MODULES.find(
    (module) => module.id === "feature-parity",
  );
  assert.ok(featureParity);
  const electronDoctor = featureParity.checks.find(
    (check) => check.id === "feature-parity.background-electron-doctor",
  );
  assert.ok(electronDoctor);
  assert.equal(electronDoctor.command.args[2], "{evidenceDir}/electron-doctor");
});

test("command adapters substitute the evidence path and preserve not-run exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-command-test-"));
  const evidenceDir = join(root, "evidence");
  const summary = await distribution_run_harness({
    evidenceDir,
    modules: [
      {
        id: "command-semantics",
        title: "Command semantics",
        requiredEvidenceLayers: ["unit-and-contract"],
        checks: [
          {
            id: "missing-prerequisite",
            evidenceLayer: "unit-and-contract",
            command: {
              executable: process.execPath,
              args: ["-e", "process.stderr.write('fixture prerequisite missing'); process.exit(3)"],
              notRunExitCodes: [3],
            },
          },
          {
            id: "evidence-placeholder",
            evidenceLayer: "unit-and-contract",
            command: {
              executable: process.execPath,
              args: ["-e", "process.stdout.write(process.argv[1])", "{evidenceDir}"],
            },
          },
        ],
      },
    ],
  });
  assert.equal(summary.status, "not-run");
  assert.equal(summary.exitCode, 3);
  assert.equal(summary.modules[0].checks[0].status, "not-run");
  assert.equal(summary.modules[0].checks[1].status, "pass");
  const commandLog = await readFile(join(evidenceDir, "logs", "evidence-placeholder.log"), "utf8");
  assert.match(commandLog, new RegExp(evidenceDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("missing executables fail without an unhandled error and continue the module", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-missing-executable-"));
  const evidenceDir = join(root, "evidence");
  const continuation = evidenceCheck("continuation", "unit-and-contract", []);
  const summary = await distribution_run_harness({
    evidenceDir,
    modules: [
      {
        id: "missing-executable",
        title: "Missing executable",
        requiredEvidenceLayers: ["unit-and-contract"],
        checks: [
          {
            id: "missing-command",
            evidenceLayer: "unit-and-contract",
            command: {
              executable: `/definitely-missing-pi-gui-${process.pid}`,
            },
          },
          continuation,
        ],
      },
    ],
  });
  assert.deepEqual(
    summary.modules[0].checks.map((check) => check.status),
    ["fail", "pass"],
  );
  const log = await readFile(join(evidenceDir, "logs", "missing-command.log"), "utf8");
  assert.match(log, /was not found \(ENOENT\)/);
  assert.match(log, /"ownership": "unspawned"/);
  assert.match(log, /"status": "not-applicable"/);
  assert.doesNotMatch(log, /"rootPid"/);
});

test(
  "non-executable targets fail without an unhandled error and continue the module",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-nonexec-"));
    const evidenceDir = join(root, "evidence");
    const executable = join(root, "not-executable");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(executable, 0o644);
    const continuation = evidenceCheck("continuation", "unit-and-contract", []);
    const summary = await distribution_run_harness({
      evidenceDir,
      modules: [
        {
          id: "non-executable",
          title: "Non-executable",
          requiredEvidenceLayers: ["unit-and-contract"],
          checks: [
            {
              id: "non-executable-command",
              evidenceLayer: "unit-and-contract",
              command: { executable },
            },
            continuation,
          ],
        },
      ],
    });
    assert.deepEqual(
      summary.modules[0].checks.map((check) => check.status),
      ["fail", "pass"],
    );
    const log = await readFile(join(evidenceDir, "logs", "non-executable-command.log"), "utf8");
    assert.match(log, /was not executable \(EACCES\)/);
    assert.match(log, /"ownership": "unspawned"/);
    assert.match(log, /"status": "not-applicable"/);
    assert.doesNotMatch(log, /"rootPid"/);
  },
);

test("timeout escalates an owned process tree, retains failure, and continues", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-timeout-test-"));
  const evidenceDir = join(root, "evidence");
  const pidPath = join(evidenceDir, "stubborn-pids.json");
  const continuationPath = join(evidenceDir, "continuation.txt");
  const summary = await distribution_run_harness({
    evidenceDir,
    modules: [
      {
        id: "timeout-tree",
        title: "Timeout process tree",
        requiredEvidenceLayers: ["unit-and-contract"],
        checks: [
          {
            id: "stubborn-tree",
            evidenceLayer: "unit-and-contract",
            command: {
              executable: process.execPath,
              args: [stubbornProcessTree, pidPath],
              timeoutMs: 150,
              gracefulTerminationMs: 100,
              forceTerminationMs: 3_000,
            },
          },
          {
            id: "after-timeout",
            evidenceLayer: "unit-and-contract",
            command: {
              executable: process.execPath,
              args: [
                "-e",
                'require("node:fs").writeFileSync(process.argv[1], "continued\\n")',
                continuationPath,
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(summary.status, "fail");
  assert.deepEqual(
    summary.modules[0].checks.map((check) => check.status),
    ["fail", "pass"],
  );
  const pids = JSON.parse(await readFile(pidPath, "utf8"));
  assert.equal(processExists(pids.rootPid), false);
  assert.equal(processExists(pids.descendantPid), false);
  assert.equal(await readFile(continuationPath, "utf8"), "continued\n");
  const timeoutLog = await readFile(join(evidenceDir, "logs", "stubborn-tree.log"), "utf8");
  assert.match(timeoutLog, /timedOut: true/);
  assert.match(timeoutLog, /"escalatedToForce": true/);
  assert.match(timeoutLog, /"status": "confirmed"/);
  assert.match(timeoutLog, /"treeGone": true/);
});

test("cancellation cleans an owned process tree before reporting the interruption", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-cancel-test-"));
  const pidPath = join(root, "stubborn-pids.json");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("test cancellation"), 150);
  let result;
  try {
    result = await distribution_run_owned_process({
      executable: process.execPath,
      args: [stubbornProcessTree, pidPath],
      timeoutMs: 5_000,
      signal: controller.signal,
      gracefulTerminationMs: 100,
      forceTerminationMs: 3_000,
    });
  } finally {
    clearTimeout(timer);
  }
  assert.equal(result.reason, "cancelled");
  assert.equal(result.cleanup.status, "confirmed");
  assert.equal(result.cleanup.escalatedToForce, true);
  assert.equal(result.cleanup.treeGone, true);
  const pids = JSON.parse(await readFile(pidPath, "utf8"));
  assert.equal(processExists(pids.rootPid), false);
  assert.equal(processExists(pids.descendantPid), false);
  await writeFile(
    join(root, "cancel-cleanup.json"),
    `${JSON.stringify({ ...result.cleanup, ...pids }, null, 2)}\n`,
    "utf8",
  );
});

test("programmatic run adapters are bounded and receive abort", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-run-timeout-test-"));
  const evidenceDir = join(root, "evidence");
  const sequence = [];
  let abortObserved = false;
  const summary = await distribution_run_harness({
    evidenceDir,
    modules: [
      {
        id: "programmatic-timeout",
        title: "Programmatic timeout",
        requiredEvidenceLayers: ["unit-and-contract"],
        checks: [
          {
            id: "slow-callback",
            evidenceLayer: "unit-and-contract",
            timeoutMs: 50,
            async run({ signal }) {
              await new Promise((resolveAbort) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    abortObserved = true;
                    resolveAbort();
                  },
                  { once: true },
                );
              });
              throw new Error("aborted fixture");
            },
          },
          evidenceCheck("after-programmatic-timeout", "unit-and-contract", sequence),
        ],
      },
    ],
  });
  assert.equal(summary.status, "fail");
  assert.deepEqual(
    summary.modules[0].checks.map((check) => check.status),
    ["fail", "pass"],
  );
  assert.deepEqual(sequence, ["after-programmatic-timeout"]);
  assert.equal(abortObserved, true);
  assert.match(
    await readFile(join(evidenceDir, "logs", "slow-callback.log"), "utf8"),
    /Programmatic check exceeded its 50 ms timeout/,
  );
});

test("mixed failures continue and retain a nonzero overall result", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-runner-test-"));
  const evidenceDir = join(root, "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const sequence = [];
  const modules = [
    {
      id: "fixture-module",
      title: "Fixture module",
      requiredEvidenceLayers: ["unit-and-contract"],
      checks: [
        evidenceCheck("before", "unit-and-contract", sequence),
        {
          id: "throwing",
          evidenceLayer: "unit-and-contract",
          timeoutMs: 5_000,
          async run() {
            sequence.push("throwing");
            throw new Error("intentional fixture failure");
          },
        },
        evidenceCheck("after", "unit-and-contract", sequence),
      ],
    },
    {
      id: "blocked-module",
      title: "Blocked module",
      requiredEvidenceLayers: ["native-os"],
      checks: [
        {
          id: "blocked-check",
          evidenceLayer: "native-os",
          status: "blocked",
          reason: "Native runner is unavailable in this isolated check.",
        },
      ],
    },
    {
      id: "not-run-module",
      title: "Not-run module",
      requiredEvidenceLayers: ["live-provider"],
      checks: [
        {
          id: "not-run-check",
          evidenceLayer: "live-provider",
          status: "not-run",
          reason: "The live adapter has not been integrated.",
        },
      ],
    },
    {
      id: "late-module",
      title: "Late module",
      requiredEvidenceLayers: ["unit-and-contract"],
      checks: [evidenceCheck("late", "unit-and-contract", sequence)],
    },
  ];

  const summary = await distribution_run_harness({
    modules,
    evidenceDir,
  });
  assert.deepEqual(sequence, ["before", "throwing", "after", "late"]);
  assert.deepEqual(
    summary.modules.map((module) => module.status),
    ["fail", "blocked", "not-run", "pass"],
  );
  assert.equal(summary.status, "fail");
  assert.equal(summary.exitCode, 1);
  const persisted = JSON.parse(await readFile(join(evidenceDir, "runner-summary.json"), "utf8"));
  assert.equal(persisted.status, "fail");
});

test("a success without retained evidence is a failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-missing-evidence-"));
  const summary = await distribution_run_harness({
    evidenceDir: join(root, "evidence"),
    modules: [
      {
        id: "missing-evidence",
        title: "Missing evidence",
        requiredEvidenceLayers: ["unit-and-contract"],
        checks: [
          {
            id: "claimed-pass",
            evidenceLayer: "unit-and-contract",
            timeoutMs: 5_000,
            async run() {
              return { status: "pass", evidence: [] };
            },
          },
        ],
      },
    ],
  });
  assert.equal(summary.status, "fail");
  assert.equal(summary.exitCode, 1);
  assert.match(summary.modules[0].checks[0].error, /must include at least one evidence record/);
});

test("explicit not-run checks never become passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-not-run-"));
  const summary = await distribution_run_harness({
    evidenceDir: join(root, "evidence"),
    modules: [
      {
        id: "pending",
        title: "Pending",
        requiredEvidenceLayers: ["production-ingestion"],
        checks: [
          {
            id: "pending-receipt",
            evidenceLayer: "production-ingestion",
            status: "not-run",
            reason: "No production receipt was requested.",
          },
        ],
      },
    ],
  });
  assert.equal(summary.status, "not-run");
  assert.equal(summary.exitCode, 3);
  assert.equal(summary.modules[0].checks[0].reason, "No production receipt was requested.");
});

test("the command environment strips credentials and blocks production telemetry", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-distribution-env-"));
  const summary = await distribution_run_harness({
    evidenceDir: join(root, "evidence"),
    baseEnv: {
      PATH: process.env.PATH,
      PI_APP_REAL_AUTH_SOURCE_DIR: "/private/provider/auth",
      OPENAI_API_KEY: "private-api-key",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://production.invalid/telemetry",
      PI_APP_TEST_MODE: "foreground",
      DO_NOT_TRACK: "0",
    },
    modules: [
      {
        id: "environment",
        title: "Environment",
        requiredEvidenceLayers: ["unit-and-contract"],
        checks: [
          {
            id: "environment-guard",
            evidenceLayer: "unit-and-contract",
            timeoutMs: 5_000,
            async run(context) {
              assert.equal(context.environment.PI_APP_REAL_AUTH_SOURCE_DIR, undefined);
              assert.equal(context.environment.OPENAI_API_KEY, undefined);
              assert.equal(context.environment.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
              assert.equal(context.environment.PI_APP_TEST_MODE, "background");
              assert.equal(context.environment.DO_NOT_TRACK, "1");
              assert.equal(context.environment.OTEL_SDK_DISABLED, "true");
              assert.equal(context.environment.PI_APP_TEST_TELEMETRY, "disabled");
              const path = join(context.evidenceDir, "environment.json");
              await writeFile(path, `${JSON.stringify(context.environment, null, 2)}\n`, "utf8");
              return {
                status: "pass",
                evidence: [{ kind: "environment", path }],
              };
            },
          },
        ],
      },
    ],
  });
  assert.equal(summary.status, "pass");
  assert.equal(summary.exitCode, 0);
});
