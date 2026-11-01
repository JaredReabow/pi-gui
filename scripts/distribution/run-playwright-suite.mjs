#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  distribution_create_test_environment,
  distribution_sanitize_text,
} from "./test-environment.mjs";
import { distribution_run_owned_process } from "./process-control.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = join(repoRoot, "apps", "desktop");
const desktopRequire = createRequire(join(desktopRoot, "package.json"));

function playwright_suite_usage() {
  return [
    "Usage: node scripts/distribution/run-playwright-suite.mjs \\",
    "  --evidence-dir <dir> --expected-tests <count> <spec.ts> [...]",
    "",
    "Runs the selected Playwright tests with distribution test isolation.",
    "",
    "Options:",
    "  --evidence-dir <dir>   Create this directory and retain the JSON report there.",
    "  --expected-tests <n>   Require exactly this many executed tests.",
    "  --help                 Show this help without running tests.",
    "",
  ].join("\n");
}

function playwright_suite_parse_args(argv) {
  const options = { help: false, evidenceDir: undefined, expectedTests: undefined, specs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--evidence-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--evidence-dir requires a value.");
      options.evidenceDir = resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--expected-tests") {
      const value = argv[index + 1];
      if (!value) throw new Error("--expected-tests requires a value.");
      const expectedTests = Number(value);
      if (!Number.isInteger(expectedTests) || expectedTests < 1) {
        throw new Error("--expected-tests must be a positive integer.");
      }
      options.expectedTests = expectedTests;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    options.specs.push(resolve(argument));
  }
  if (!options.help && !options.evidenceDir) {
    throw new Error("--evidence-dir is required.");
  }
  if (!options.help && options.expectedTests === undefined) {
    throw new Error("--expected-tests is required.");
  }
  if (!options.help && options.specs.length === 0) {
    throw new Error("At least one Playwright spec is required.");
  }
  return options;
}

function playwright_suite_blocked(reason) {
  process.stderr.write(`BLOCKED: ${reason}\n`);
  return 2;
}

async function playwright_suite_prepare_evidence(evidenceDir) {
  await mkdir(dirname(evidenceDir), { recursive: true });
  await mkdir(evidenceDir);
  const testOutputDir = join(evidenceDir, "test-output");
  await mkdir(testOutputDir);
  return testOutputDir;
}

async function playwright_suite_main(argv) {
  let options;
  try {
    options = playwright_suite_parse_args(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${playwright_suite_usage()}`);
    return 2;
  }
  if (options.help) {
    if (argv.length !== 1) {
      process.stderr.write(
        `--help cannot be combined with other arguments.\n${playwright_suite_usage()}`,
      );
      return 2;
    }
    process.stdout.write(playwright_suite_usage());
    return 0;
  }

  for (const spec of options.specs) {
    const relation = relative(repoRoot, spec);
    if (relation.startsWith("..") || isAbsolute(relation)) {
      return playwright_suite_blocked(`Spec escapes this repository: ${spec}`);
    }
    if (!existsSync(spec)) {
      return playwright_suite_blocked(`Spec does not exist: ${spec}`);
    }
  }

  let playwrightCli;
  try {
    playwrightCli = desktopRequire.resolve("@playwright/test/cli");
  } catch (error) {
    return playwright_suite_blocked(
      `Playwright CLI is unavailable: ${error instanceof Error ? error.message : error}`,
    );
  }

  let testOutputDir;
  try {
    testOutputDir = await playwright_suite_prepare_evidence(options.evidenceDir);
  } catch (error) {
    return playwright_suite_blocked(
      `Could not create evidence directory ${options.evidenceDir}: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }

  const environment = distribution_create_test_environment();
  delete environment.FORCE_COLOR;
  delete environment.NO_COLOR;
  let stdout = "";
  let stderr = "";
  const interruption = new AbortController();
  let interruptedBy;
  const interrupt = (signal) => {
    if (!interruption.signal.aborted) {
      interruptedBy = signal;
      interruption.abort(signal);
    }
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  let result;
  let runError;
  try {
    result = await distribution_run_owned_process({
      executable: process.execPath,
      args: [
        playwrightCli,
        "test",
        "-c",
        join(desktopRoot, "playwright.config.ts"),
        ...options.specs,
        "--output",
        testOutputDir,
        "--reporter=json",
      ],
      cwd: repoRoot,
      env: environment,
      timeoutMs: 4.5 * 60_000,
      signal: interruption.signal,
      captureLimit: 20_000_000,
      gracefulTerminationMs: 500,
      forceTerminationMs: 5_000,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    runError = error;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }

  const reportPath = join(options.evidenceDir, "playwright-report.json");
  await writeFile(reportPath, `${stdout}\n`, "utf8");
  if (stderr.trim()) {
    await writeFile(
      join(options.evidenceDir, "playwright-stderr.log"),
      `${distribution_sanitize_text(stderr, environment)}\n`,
      "utf8",
    );
  }
  if (!result) {
    const cleanup = {
      status: "failed",
      reason: runError instanceof Error ? runError.message : String(runError),
      ownedProcessSpawned: false,
    };
    await writeFile(
      join(options.evidenceDir, "process-cleanup.json"),
      `${JSON.stringify(cleanup, null, 2)}\n`,
      "utf8",
    );
    process.stderr.write(
      `Could not run Playwright under owned process control: ${cleanup.reason}\n`,
    );
    return 1;
  }
  await writeFile(
    join(options.evidenceDir, "process-cleanup.json"),
    `${JSON.stringify(result.cleanup, null, 2)}\n`,
    "utf8",
  );
  if (result.spawnError) {
    process.stderr.write(`Could not start Playwright: ${result.spawnError.message}\n`);
    return 1;
  }
  if (result.cleanup.status !== "confirmed") {
    process.stderr.write(
      `Playwright cleanup was not confirmed: ${JSON.stringify(result.cleanup)}\n`,
    );
    return 1;
  }
  if (result.reason === "timeout") {
    process.stderr.write("TIMEOUT: Playwright exceeded its bounded run time; cleanup confirmed.\n");
    return 1;
  }
  if (result.reason === "cancelled") {
    process.stderr.write(
      `CANCELLED: Playwright ${interruptedBy ?? "run"} stopped; owned process tree cleanup confirmed.\n`,
    );
    return interruptedBy === "SIGINT" ? 130 : 143;
  }
  if (result.exitCode !== 0) {
    process.stderr.write(
      `Playwright failed with ${result.exitCode ?? result.exitSignal ?? "an unknown result"}.\n`,
    );
    return result.exitCode ?? 1;
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    process.stderr.write("Playwright returned exit 0 without a parseable JSON report.\n");
    return 1;
  }
  const stats = report?.stats;
  if (
    !stats ||
    !Number.isInteger(stats.expected) ||
    !Number.isInteger(stats.skipped) ||
    !Number.isInteger(stats.unexpected) ||
    !Number.isInteger(stats.flaky)
  ) {
    process.stderr.write("Playwright JSON report omitted its test statistics.\n");
    return 1;
  }
  if (stats.unexpected > 0 || stats.flaky > 0) {
    process.stderr.write(
      `Playwright report is not clean: unexpected=${stats.unexpected}, flaky=${stats.flaky}.\n`,
    );
    return 1;
  }
  if (stats.expected === 0 || stats.skipped > 0) {
    process.stderr.write(
      `NOT-RUN: no complete test result (expected=${stats.expected}, skipped=${stats.skipped}).\n`,
    );
    return 3;
  }
  if (stats.expected !== options.expectedTests) {
    process.stderr.write(
      `Test count mismatch: expected ${options.expectedTests}, observed ${stats.expected}.\n`,
    );
    return 1;
  }
  process.stdout.write(`Playwright pass: ${stats.expected} expected test(s).\n`);
  return 0;
}

process.exitCode = await playwright_suite_main(process.argv.slice(2));
