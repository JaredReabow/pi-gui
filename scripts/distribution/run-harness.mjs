#!/usr/bin/env node

import { access, mkdir, mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DISTRIBUTION_CANONICAL_MODULES, DISTRIBUTION_EVIDENCE_LAYERS } from "./modules.mjs";
import {
  DISTRIBUTION_PROTECTED_TEST_ENV,
  distribution_create_test_environment,
  distribution_sanitize_text,
} from "./test-environment.mjs";
import { distribution_run_owned_process } from "./process-control.mjs";

export { distribution_create_test_environment } from "./test-environment.mjs";

export const DISTRIBUTION_RESULT_STATUSES = Object.freeze(["pass", "fail", "blocked", "not-run"]);

const EXIT_CODES = Object.freeze({
  pass: 0,
  fail: 1,
  blocked: 2,
  "not-run": 3,
});
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const EVIDENCE_DIR_PLACEHOLDER = "{evidenceDir}";

function distribution_assert(condition, message) {
  if (!condition) throw new Error(message);
}

function distribution_assert_id(value, label) {
  distribution_assert(
    typeof value === "string" && SAFE_ID.test(value),
    `${label} must match ${SAFE_ID}.`,
  );
}

export function distribution_validate_modules(modules) {
  distribution_assert(Array.isArray(modules), "Harness modules must be an array.");
  distribution_assert(modules.length > 0, "At least one harness module is required.");
  const moduleIds = new Set();
  for (const [moduleIndex, module] of modules.entries()) {
    distribution_assert(
      module && typeof module === "object",
      `modules[${moduleIndex}] is invalid.`,
    );
    distribution_assert_id(module.id, `modules[${moduleIndex}].id`);
    distribution_assert(!moduleIds.has(module.id), `Duplicate module id: ${module.id}.`);
    moduleIds.add(module.id);
    distribution_assert(
      typeof module.title === "string" && module.title.trim(),
      `${module.id}.title is required.`,
    );
    distribution_assert(
      Array.isArray(module.requiredEvidenceLayers) && module.requiredEvidenceLayers.length > 0,
      `${module.id}.requiredEvidenceLayers must be a nonempty array.`,
    );
    distribution_assert(
      new Set(module.requiredEvidenceLayers).size === module.requiredEvidenceLayers.length,
      `${module.id}.requiredEvidenceLayers must not contain duplicates.`,
    );
    for (const layer of module.requiredEvidenceLayers) {
      distribution_assert(
        DISTRIBUTION_EVIDENCE_LAYERS.includes(layer),
        `${module.id} requires unsupported evidence layer ${String(layer)}.`,
      );
    }
    distribution_assert(Array.isArray(module.checks), `${module.id}.checks must be an array.`);
    const checkIds = new Set();
    for (const [checkIndex, check] of module.checks.entries()) {
      distribution_assert(
        check && typeof check === "object",
        `${module.id}.checks[${checkIndex}] is invalid.`,
      );
      distribution_assert_id(check.id, `${module.id}.checks[${checkIndex}].id`);
      distribution_assert(
        !checkIds.has(check.id),
        `Duplicate check id ${check.id} in module ${module.id}.`,
      );
      checkIds.add(check.id);
      distribution_assert(
        DISTRIBUTION_EVIDENCE_LAYERS.includes(check.evidenceLayer),
        `${check.id} uses unsupported evidence layer ${String(check.evidenceLayer)}.`,
      );
      distribution_assert(
        module.requiredEvidenceLayers.includes(check.evidenceLayer),
        `${check.id} uses undeclared evidence layer ${check.evidenceLayer}.`,
      );
      const declaredStatus = check.status === undefined ? undefined : check.status;
      const hasRunAdapter = typeof check.run === "function";
      const hasCommandAdapter = check.command && typeof check.command === "object";
      distribution_assert(
        declaredStatus === undefined ||
          declaredStatus === "blocked" ||
          declaredStatus === "not-run",
        `${check.id} can only declare blocked or not-run; executable checks determine pass/fail.`,
      );
      distribution_assert(
        declaredStatus !== undefined || hasRunAdapter || hasCommandAdapter,
        `${check.id} must declare a status, run function, or command.`,
      );
      distribution_assert(
        declaredStatus !== undefined || hasRunAdapter !== hasCommandAdapter,
        `${check.id} must declare exactly one executable adapter.`,
      );
      if (hasRunAdapter) {
        distribution_assert(
          Number.isInteger(check.timeoutMs) && check.timeoutMs > 0,
          `${check.id}.timeoutMs is required for a programmatic check.run adapter.`,
        );
      }
      if (check.command?.blockedExitCodes !== undefined) {
        distribution_assert(
          Array.isArray(check.command.blockedExitCodes) &&
            check.command.blockedExitCodes.every((code) => Number.isInteger(code) && code > 0),
          `${check.id}.command.blockedExitCodes must contain positive integers.`,
        );
      }
      if (check.command?.notRunExitCodes !== undefined) {
        distribution_assert(
          Array.isArray(check.command.notRunExitCodes) &&
            check.command.notRunExitCodes.every((code) => Number.isInteger(code) && code > 0),
          `${check.id}.command.notRunExitCodes must contain positive integers.`,
        );
      }
      if (check.command?.gracefulTerminationMs !== undefined) {
        distribution_assert(
          Number.isInteger(check.command.gracefulTerminationMs) &&
            check.command.gracefulTerminationMs >= 0,
          `${check.id}.command.gracefulTerminationMs must be a nonnegative integer.`,
        );
      }
      if (check.command?.forceTerminationMs !== undefined) {
        distribution_assert(
          Number.isInteger(check.command.forceTerminationMs) &&
            check.command.forceTerminationMs > 0,
          `${check.id}.command.forceTerminationMs must be a positive integer.`,
        );
      }
      if (declaredStatus === "blocked" || declaredStatus === "not-run") {
        distribution_assert(
          typeof check.reason === "string" && check.reason.trim(),
          `${check.id} requires an explicit ${declaredStatus} reason.`,
        );
      }
    }
  }
  return true;
}

function distribution_safe_file_part(value) {
  return value.replaceAll(/[^a-z0-9._-]+/gi, "_");
}

async function distribution_write_check_log(evidenceDir, check, output) {
  const logPath = join(evidenceDir, "logs", `${distribution_safe_file_part(check.id)}.log`);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, output, "utf8");
  return logPath;
}

async function distribution_verify_evidence(evidence, evidenceDir) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return "A pass result must include at least one evidence record.";
  }
  for (const [index, record] of evidence.entries()) {
    if (!record || typeof record !== "object") {
      return `Evidence record ${index} is not an object.`;
    }
    if (typeof record.kind !== "string" || !record.kind.trim()) {
      return `Evidence record ${index} is missing its kind.`;
    }
    if (typeof record.path !== "string" || !record.path.trim()) {
      return `Evidence record ${index} is missing its path.`;
    }
    const absolutePath = isAbsolute(record.path)
      ? resolve(record.path)
      : resolve(evidenceDir, record.path);
    try {
      await access(absolutePath);
      const evidenceStats = await stat(absolutePath);
      if (!evidenceStats.isFile() || evidenceStats.size === 0) {
        return `Evidence record ${index} is not a nonempty file: ${absolutePath}.`;
      }
      const [ownedRoot, canonicalPath] = await Promise.all([
        realpath(evidenceDir),
        realpath(absolutePath),
      ]);
      const relation = relative(ownedRoot, canonicalPath);
      if (relation.startsWith("..") || isAbsolute(relation)) {
        return `Evidence record ${index} escapes the owned run directory.`;
      }
    } catch {
      return `Evidence record ${index} does not exist: ${absolutePath}.`;
    }
  }
  return undefined;
}

async function distribution_run_command(check, context) {
  const command = check.command;
  distribution_assert(
    typeof command.executable === "string" && command.executable.trim(),
    `${check.id}.command.executable is required.`,
  );
  const rawArgs = command.args ?? [];
  distribution_assert(Array.isArray(rawArgs), `${check.id}.command.args must be an array.`);
  distribution_assert(
    rawArgs.every((argument) => typeof argument === "string"),
    `${check.id}.command.args must contain only strings.`,
  );
  const args = rawArgs.map((argument) =>
    argument.replaceAll(EVIDENCE_DIR_PLACEHOLDER, context.evidenceDir),
  );
  const timeoutMs = command.timeoutMs ?? 15 * 60_000;
  distribution_assert(
    Number.isInteger(timeoutMs) && timeoutMs > 0,
    `${check.id}.command.timeoutMs must be a positive integer.`,
  );
  const commandEnv = {
    ...context.environment,
    ...(command.env ?? {}),
    ...DISTRIBUTION_PROTECTED_TEST_ENV,
  };
  const completion = await distribution_run_owned_process({
    executable: command.executable,
    args,
    cwd: command.cwd ?? context.cwd,
    env: commandEnv,
    timeoutMs,
    signal: context.signal,
    gracefulTerminationMs: command.gracefulTerminationMs ?? 2_000,
    forceTerminationMs: command.forceTerminationMs ?? 5_000,
  });
  const timedOut = completion.reason === "timeout";
  const cancelled = completion.reason === "cancelled";
  const sanitizedStdout = distribution_sanitize_text(completion.stdout, commandEnv);
  const sanitizedStderr = distribution_sanitize_text(
    completion.spawnError
      ? `${completion.stderr}\n${completion.spawnError.message}`
      : completion.stderr,
    commandEnv,
  );
  const cleanupReport = JSON.stringify(completion.cleanup, null, 2);
  const logPath = await distribution_write_check_log(
    context.evidenceDir,
    check,
    [
      `command: ${JSON.stringify([command.executable, ...args])}`,
      `cwd: ${command.cwd ?? context.cwd}`,
      `completion: ${completion.reason}`,
      `exit: ${completion.exitCode ?? completion.exitSignal ?? "<unknown>"}`,
      `timedOut: ${timedOut}`,
      `cancelled: ${cancelled}`,
      "cleanup:",
      cleanupReport,
      "stdout:",
      sanitizedStdout,
      "stderr:",
      sanitizedStderr,
      "",
    ].join("\n"),
  );
  const evidence = [{ kind: "command-output", path: logPath }];
  if (completion.spawnError) {
    return {
      status: "fail",
      error: `Could not execute ${command.executable}: ${completion.spawnError.message}. Cleanup ${completion.cleanup.status}.`,
      evidence,
    };
  }
  if (completion.cleanup.status !== "confirmed") {
    return {
      status: "fail",
      error: `Command cleanup was not confirmed after ${completion.reason}: ${cleanupReport}`,
      evidence,
    };
  }
  if (timedOut) {
    return {
      status: "fail",
      error: `Command exceeded ${timeoutMs} ms; cleanup confirmed${completion.cleanup.escalatedToForce ? " after forced process-tree escalation" : ""}.`,
      evidence,
    };
  }
  if (cancelled) {
    return {
      status: "fail",
      error: "Command was cancelled; owned process-tree cleanup confirmed.",
      evidence,
    };
  }
  if (completion.exitCode !== 0) {
    const blockedExitCodes = command.blockedExitCodes ?? [];
    if (Array.isArray(blockedExitCodes) && blockedExitCodes.includes(completion.exitCode)) {
      return {
        status: "blocked",
        reason:
          sanitizedStderr.trim() ||
          `Command reported blocked with exit code ${completion.exitCode}.`,
        evidence,
      };
    }
    const notRunExitCodes = command.notRunExitCodes ?? [];
    if (Array.isArray(notRunExitCodes) && notRunExitCodes.includes(completion.exitCode)) {
      return {
        status: "not-run",
        reason:
          sanitizedStderr.trim() ||
          `Command reported not-run with exit code ${completion.exitCode}.`,
        evidence,
      };
    }
    return {
      status: "fail",
      error: `Command exited with ${completion.exitCode ?? completion.exitSignal}.`,
      evidence,
    };
  }
  return { status: "pass", evidence };
}

async function distribution_run_in_process_check(check, context) {
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = context.signal?.aborted === true;
  let timer;
  let rejectStop;
  const stopped = new Promise((_, reject) => {
    rejectStop = reject;
  });
  const stop = (reason) => {
    if (timedOut || cancelled) return;
    if (reason === "timeout") timedOut = true;
    else cancelled = true;
    controller.abort();
    rejectStop(new Error(`in-process adapter ${reason}`));
  };
  const onAbort = () => stop("cancelled");
  context.signal?.addEventListener("abort", onAbort, { once: true });
  if (cancelled) {
    controller.abort();
    rejectStop(new Error("in-process adapter cancelled"));
  } else {
    timer = setTimeout(() => stop("timeout"), check.timeoutMs);
  }
  const work = Promise.resolve().then(() =>
    check.run({
      ...context,
      signal: controller.signal,
    }),
  );
  // A non-cooperative callback can outlive the contract. The harness stops
  // waiting; process-owning adapters must use the command adapter instead.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, stopped]);
  } catch (error) {
    if (!timedOut && !cancelled) throw error;
    const reason = timedOut
      ? `Programmatic check exceeded its ${check.timeoutMs} ms timeout.`
      : "Programmatic check was cancelled.";
    const logPath = await distribution_write_check_log(
      context.evidenceDir,
      check,
      `${reason}\nThe callback received an AbortSignal. In-process adapters cannot own process descendants; use a command adapter for child processes.\n`,
    );
    return {
      status: "fail",
      error: reason,
      evidence: [{ kind: "timeout-report", path: logPath }],
    };
  } finally {
    if (timer) clearTimeout(timer);
    context.signal?.removeEventListener("abort", onAbort);
  }
}

async function distribution_run_check(check, context) {
  try {
    if (check.status === "blocked" || check.status === "not-run") {
      return {
        id: check.id,
        description: check.description ?? "",
        evidenceLayer: check.evidenceLayer,
        status: check.status,
        reason: check.reason,
        evidence: [],
      };
    }
    const outcome =
      typeof check.run === "function"
        ? await distribution_run_in_process_check(check, context)
        : await distribution_run_command(check, context);
    distribution_assert(
      outcome && typeof outcome === "object",
      `${check.id} returned no structured result.`,
    );
    distribution_assert(
      DISTRIBUTION_RESULT_STATUSES.includes(outcome.status),
      `${check.id} returned unsupported status ${String(outcome.status)}.`,
    );
    const evidence = Array.isArray(outcome.evidence) ? outcome.evidence : [];
    let status = outcome.status;
    let error =
      typeof outcome.error === "string"
        ? distribution_sanitize_text(outcome.error, context.environment)
        : undefined;
    if (status === "pass") {
      const evidenceError = await distribution_verify_evidence(evidence, context.evidenceDir);
      if (evidenceError) {
        status = "fail";
        error = evidenceError;
      }
    } else if (
      (status === "blocked" || status === "not-run") &&
      !(typeof outcome.reason === "string" && outcome.reason.trim())
    ) {
      status = "fail";
      error = `${check.id} omitted its explicit ${outcome.status} reason.`;
    }
    return {
      id: check.id,
      description: check.description ?? "",
      evidenceLayer: check.evidenceLayer,
      status,
      ...(error ? { error } : {}),
      ...(typeof outcome.reason === "string"
        ? {
            reason: distribution_sanitize_text(outcome.reason, context.environment),
          }
        : {}),
      evidence,
    };
  } catch (error) {
    return {
      id: check.id,
      description: check.description ?? "",
      evidenceLayer: check.evidenceLayer,
      status: "fail",
      error: distribution_sanitize_text(
        error instanceof Error ? (error.stack ?? error.message) : error,
        context.environment,
      ),
      evidence: [],
    };
  }
}

function distribution_module_status(module, checks) {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (checks.some((check) => check.status === "not-run")) return "not-run";
  for (const layer of module.requiredEvidenceLayers) {
    if (!checks.some((check) => check.evidenceLayer === layer && check.status === "pass")) {
      return "not-run";
    }
  }
  return "pass";
}

function distribution_overall_status(modules) {
  if (modules.some((module) => module.status === "fail")) return "fail";
  if (modules.some((module) => module.status === "blocked")) return "blocked";
  if (modules.some((module) => module.status === "not-run")) return "not-run";
  return "pass";
}

export async function distribution_run_harness({
  modules = DISTRIBUTION_CANONICAL_MODULES,
  selectedModuleIds = [],
  cwd = process.cwd(),
  evidenceDir,
  baseEnv = process.env,
  runId,
  signal,
} = {}) {
  distribution_validate_modules(modules);
  distribution_assert(Array.isArray(selectedModuleIds), "selectedModuleIds must be an array.");
  distribution_assert(
    signal === undefined ||
      (typeof signal === "object" &&
        typeof signal.aborted === "boolean" &&
        typeof signal.addEventListener === "function"),
    "signal must be an AbortSignal.",
  );
  const runEvidenceDir = resolve(
    evidenceDir ??
      (await (async () => {
        const parent = join(cwd, ".artifacts", "distribution-harness");
        await mkdir(parent, { recursive: true });
        return mkdtemp(join(parent, "run-"));
      })()),
  );
  await mkdir(runEvidenceDir, { recursive: true });
  const selected =
    selectedModuleIds.length === 0
      ? modules
      : modules.filter((module) => selectedModuleIds.includes(module.id));
  const missingSelection = selectedModuleIds.filter(
    (id) => !modules.some((module) => module.id === id),
  );
  distribution_assert(
    missingSelection.length === 0,
    `Unknown module ids: ${missingSelection.join(", ")}.`,
  );
  const environment = distribution_create_test_environment(baseEnv);
  const startedAt = new Date().toISOString();
  const moduleResults = [];

  for (const module of selected) {
    const checkResults = [];
    for (const check of module.checks) {
      const result = await distribution_run_check(check, {
        cwd,
        evidenceDir: runEvidenceDir,
        environment,
        runId,
        signal,
      });
      checkResults.push(result);
    }
    moduleResults.push({
      id: module.id,
      title: module.title,
      requiredEvidenceLayers: [...module.requiredEvidenceLayers],
      status: distribution_module_status(module, checkResults),
      checks: checkResults,
    });
  }

  const status = distribution_overall_status(moduleResults);
  const summary = {
    schemaVersion: 1,
    runId: runId ?? `distribution-${Date.now()}`,
    status,
    exitCode: EXIT_CODES[status],
    startedAt,
    finishedAt: new Date().toISOString(),
    evidenceDir: resolve(runEvidenceDir),
    testEnvironment: { ...DISTRIBUTION_PROTECTED_TEST_ENV },
    modules: moduleResults,
  };
  await writeFile(
    join(runEvidenceDir, "runner-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  return summary;
}

export function distribution_format_summary(summary) {
  const lines = [
    `distribution harness: ${summary.status}`,
    `evidence: ${summary.evidenceDir}`,
    `environment: ${JSON.stringify(summary.testEnvironment)}`,
  ];
  for (const module of summary.modules) {
    lines.push(`[${module.status}] ${module.id}: ${module.title}`);
    for (const check of module.checks) {
      const detail = check.reason ?? check.error;
      lines.push(
        `  [${check.status}] ${check.evidenceLayer}: ${check.id}${detail ? ` (${detail})` : ""}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function distribution_usage() {
  return [
    "Usage: node scripts/distribution/run-harness.mjs [options]",
    "",
    "Options:",
    "  --module <id>        Run one canonical module; repeat or comma-separate values.",
    "  --evidence-dir <dir> Retain logs and runner-summary.json in this directory.",
    "  --list               List canonical modules without executing checks.",
    "  --json               Print the structured summary instead of the readable view.",
    "  --help               Show this help.",
    "",
  ].join("\n");
}

function distribution_parse_args(argv) {
  const options = {
    modules: [],
    evidenceDir: undefined,
    list: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") options.list = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help") options.help = true;
    else if (argument === "--module" || argument === "--evidence-dir") {
      const value = argv[index + 1];
      distribution_assert(value, `${argument} requires a value.`);
      index += 1;
      if (argument === "--evidence-dir") options.evidenceDir = resolve(value);
      else options.modules.push(...value.split(",").filter(Boolean));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function distribution_main() {
  let options;
  try {
    options = distribution_parse_args(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${distribution_usage()}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(distribution_usage());
    return 0;
  }
  if (options.list) {
    for (const module of DISTRIBUTION_CANONICAL_MODULES) {
      process.stdout.write(
        `${module.id}\t${module.title}\t${module.requiredEvidenceLayers.join(",")}\n`,
      );
    }
    return 0;
  }
  try {
    const summary = await distribution_run_harness({
      selectedModuleIds: options.modules,
      evidenceDir: options.evidenceDir,
    });
    process.stdout.write(
      options.json ? `${JSON.stringify(summary, null, 2)}\n` : distribution_format_summary(summary),
    );
    return summary.exitCode;
  } catch (error) {
    process.stderr.write(`distribution harness could not start: ${error.message}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = await distribution_main();
}
