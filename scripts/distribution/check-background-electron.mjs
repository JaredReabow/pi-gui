#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { distribution_create_test_environment } from "./run-harness.mjs";
import { distribution_run_owned_process } from "./process-control.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = join(repoRoot, "apps", "desktop");
const desktopRequire = createRequire(join(desktopRoot, "package.json"));
const safeEnvironment = distribution_create_test_environment();

async function background_electron_fail(reason) {
  process.stderr.write(`BLOCKED: ${reason}\n`);
  return 2;
}

function background_electron_usage() {
  return [
    "Usage: node scripts/distribution/check-background-electron.mjs [--evidence-dir <dir>]",
    "",
    "Launches the built desktop app hidden and verifies its isolated profile, owned PID,",
    "window visibility/focus, telemetry policy, and teardown.",
    "",
    "Options:",
    "  --evidence-dir <dir> Create this exact directory for the doctor and cleanup evidence.",
    "  --help               Show this help without launching Electron.",
    "",
  ].join("\n");
}

function background_electron_parse_args(argv) {
  const options = { help: false, evidenceDir: undefined };
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
    throw new Error(`Unexpected argument: ${argument}`);
  }
  return options;
}

async function background_electron_main(argv) {
  let options;
  try {
    options = background_electron_parse_args(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${background_electron_usage()}`);
    return 2;
  }
  if (options.help) {
    if (argv.length !== 1) {
      process.stderr.write(
        `--help cannot be combined with other arguments.\n${background_electron_usage()}`,
      );
      return 2;
    }
    process.stdout.write(background_electron_usage());
    return 0;
  }

  let electronExecutable;
  try {
    electronExecutable = desktopRequire("electron");
  } catch (error) {
    return background_electron_fail(
      `Electron is not installed correctly: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (typeof electronExecutable !== "string" || !existsSync(electronExecutable)) {
    return background_electron_fail(
      `Electron executable is unavailable at ${String(electronExecutable)}.`,
    );
  }
  if (!existsSync(join(desktopRoot, "out", "main", "main.js"))) {
    return background_electron_fail(
      "The desktop build is absent at apps/desktop/out/main/main.js.",
    );
  }

  let playwrightCli;
  try {
    playwrightCli = desktopRequire.resolve("@playwright/test/cli");
  } catch (error) {
    return background_electron_fail(
      `Playwright CLI is unavailable: ${error instanceof Error ? error.message : error}`,
    );
  }
  const outputParent = join(repoRoot, ".artifacts", "distribution-harness");
  let outputDirectory;
  if (options.evidenceDir) {
    try {
      await mkdir(dirname(options.evidenceDir), { recursive: true });
      await mkdir(options.evidenceDir);
      outputDirectory = options.evidenceDir;
    } catch (error) {
      return background_electron_fail(
        `Could not create explicit evidence directory ${options.evidenceDir}: ${error instanceof Error ? error.message : error}`,
      );
    }
  } else {
    await mkdir(outputParent, { recursive: true });
    outputDirectory = await mkdtemp(join(outputParent, "electron-doctor-"));
  }
  safeEnvironment.PI_DISTRIBUTION_ELECTRON_EVIDENCE_DIR = outputDirectory;
  process.stdout.write(`Evidence: ${outputDirectory}\n`);

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
        join(desktopRoot, "tests", "unit", "distribution-background-launcher.spec.ts"),
        "--output",
        outputDirectory,
        "--reporter=line",
      ],
      cwd: repoRoot,
      env: safeEnvironment,
      timeoutMs: 90_000,
      signal: interruption.signal,
      captureLimit: 2_000_000,
      gracefulTerminationMs: 500,
      forceTerminationMs: 5_000,
    });
  } catch (error) {
    runError = error;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
  if (!result) {
    const cleanup = {
      status: "failed",
      reason: runError instanceof Error ? runError.message : String(runError),
      ownedProcessSpawned: false,
    };
    await writeFile(
      join(outputDirectory, "process-cleanup.json"),
      `${JSON.stringify(cleanup, null, 2)}\n`,
      "utf8",
    );
    process.stderr.write(
      `Could not run the Electron doctor under owned process control: ${cleanup.reason}\n`,
    );
    return 1;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  await writeFile(
    join(outputDirectory, "process-cleanup.json"),
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
    process.stderr.write("TIMEOUT: background Electron doctor cleanup confirmed.\n");
    return 1;
  }
  if (result.reason === "cancelled") {
    process.stderr.write(
      `CANCELLED: background Electron doctor ${interruptedBy ?? "run"} stopped; cleanup confirmed.\n`,
    );
    return interruptedBy === "SIGINT" ? 130 : 143;
  }
  return result.exitCode ?? 1;
}

process.exitCode = await background_electron_main(process.argv.slice(2));
