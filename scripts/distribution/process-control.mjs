import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 25;

function process_control_assert(condition, message) {
  if (!condition) throw new Error(message);
}

function process_control_delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function process_control_wait_until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!(await predicate())) return true;
    if (Date.now() === deadline) break;
    await process_control_delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  return !(await predicate());
}

function process_control_posix_group_alive(groupId) {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function process_control_windows_process_alive(pid) {
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { timeout: 5_000, windowsHide: true },
    );
    return stdout.trim().startsWith('"') && !stdout.includes("No tasks");
  } catch {
    return false;
  }
}

async function process_control_owned_tree_alive(owned) {
  if (owned.ownership.kind === "posix-process-group") {
    return process_control_posix_group_alive(owned.ownership.groupId);
  }
  return process_control_windows_process_alive(owned.ownership.rootPid);
}

function process_control_validate_owned(owned) {
  process_control_assert(
    owned?.child && owned?.ownership,
    "An owned child process handle is required.",
  );
}

function process_control_normalize_spawn_error(error, executable) {
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
  let label = "could not be started";
  if (code === "ENOENT") label = "was not found";
  else if (code === "EACCES") label = "was not executable";
  else if (code === "ENOEXEC") label = "has an invalid executable format";
  return {
    code,
    executable,
    message: `Executable ${executable} ${label} (${code}): ${error?.message ?? String(error)}`,
  };
}

export function distribution_spawn_owned_process({
  executable,
  args = [],
  cwd,
  env,
  isolate = true,
}) {
  process_control_assert(
    typeof executable === "string" && executable.trim(),
    "Owned process executable is required.",
  );
  process_control_assert(Array.isArray(args), "Owned process args must be an array.");
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: isolate && process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const spawnState = { error: undefined, listeners: new Set() };
  // This listener must exist before returning. Unsupported/execution-denied
  // executables emit "error" asynchronously, and an unhandled event would crash
  // the harness before it could retain a failed check.
  child.once("error", (error) => {
    spawnState.error = process_control_normalize_spawn_error(error, executable);
    for (const listener of spawnState.listeners) listener(spawnState.error);
  });
  const ownership = child.pid
    ? process.platform === "win32"
      ? Object.freeze({ kind: "windows-process-tree", rootPid: child.pid })
      : Object.freeze({
          kind: isolate ? "posix-process-group" : "posix-child",
          groupId: isolate ? child.pid : undefined,
          rootPid: child.pid,
        })
    : Object.freeze({ kind: "unspawned" });
  return { child, ownership, spawnState };
}

export async function distribution_owned_process_tree_is_alive(owned) {
  process_control_validate_owned(owned);
  if (owned.ownership.kind === "unspawned") return false;
  if (owned.ownership.kind === "posix-child") {
    return owned.child.exitCode === null && owned.child.signalCode === null;
  }
  return process_control_owned_tree_alive(owned);
}

export async function distribution_wait_for_owned_process(
  owned,
  { timeoutMs, signal, captureLimit = 2_000_000 },
) {
  process_control_validate_owned(owned);
  process_control_assert(
    Number.isInteger(timeoutMs) && timeoutMs > 0,
    "Owned process timeoutMs must be a positive integer.",
  );
  process_control_assert(
    Number.isInteger(captureLimit) && captureLimit > 0,
    "Owned process captureLimit must be a positive integer.",
  );
  const { child } = owned;
  let stdout = "";
  let stderr = "";
  const capture = (current, chunk) => `${current}${chunk}`.slice(-captureLimit);
  child.stdout?.on("data", (chunk) => {
    stdout = capture(stdout, chunk.toString("utf8"));
  });
  child.stderr?.on("data", (chunk) => {
    stderr = capture(stderr, chunk.toString("utf8"));
  });
  const completion = await new Promise((resolveCompletion) => {
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.off("close", onClose);
      owned.spawnState.listeners.delete(onSpawnError);
      signal?.removeEventListener("abort", onAbort);
      resolveCompletion(value);
    };
    const onClose = (code, signalName) =>
      finish({ reason: "close", code, signal: signalName, spawnError: undefined });
    const onSpawnError = (spawnError) =>
      finish({ reason: "spawn-error", code: null, signal: null, spawnError });
    const onAbort = () =>
      finish({ reason: "cancelled", code: null, signal: null, spawnError: undefined });
    if (signal?.aborted) {
      finish({ reason: "cancelled", code: null, signal: null, spawnError: undefined });
      return;
    }
    if (owned.spawnState.error) {
      onSpawnError(owned.spawnState.error);
      return;
    }
    child.once("close", onClose);
    owned.spawnState.listeners.add(onSpawnError);
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(
      () => finish({ reason: "timeout", code: null, signal: null, spawnError: undefined }),
      timeoutMs,
    );
  });
  return { ...completion, stdout, stderr };
}

export async function distribution_terminate_owned_process(
  owned,
  { gracefulTerminationMs = 2_000, forceTerminationMs = 5_000 } = {},
) {
  process_control_validate_owned(owned);
  process_control_assert(
    Number.isInteger(gracefulTerminationMs) && gracefulTerminationMs >= 0,
    "gracefulTerminationMs must be a nonnegative integer.",
  );
  process_control_assert(
    Number.isInteger(forceTerminationMs) && forceTerminationMs > 0,
    "forceTerminationMs must be a positive integer.",
  );
  if (owned.ownership.kind === "unspawned") {
    return {
      status: "not-applicable",
      ownership: "unspawned",
      gracefulSent: false,
      forceSent: false,
      escalatedToForce: false,
      rootExited: false,
      treeGone: true,
    };
  }
  const { child, ownership } = owned;
  let gracefulSent = false;
  let forceSent = false;
  let forced = false;
  let signalError;
  if (await process_control_owned_tree_alive(owned)) {
    if (process.platform === "win32") {
      try {
        await execFileAsync("taskkill", ["/PID", String(ownership.rootPid), "/T"], {
          timeout: gracefulTerminationMs + 1_000,
          windowsHide: true,
        });
        gracefulSent = true;
      } catch (error) {
        signalError = String(error);
      }
    } else {
      try {
        gracefulSent = child.kill("SIGTERM");
      } catch (error) {
        signalError = String(error);
      }
    }
    const goneAfterGrace = await process_control_wait_until(
      () => process_control_owned_tree_alive(owned),
      gracefulTerminationMs,
    );
    if (!goneAfterGrace) {
      forced = true;
      if (process.platform === "win32") {
        try {
          await execFileAsync("taskkill", ["/PID", String(ownership.rootPid), "/T", "/F"], {
            timeout: forceTerminationMs,
            windowsHide: true,
          });
          forceSent = true;
        } catch (error) {
          signalError = String(error);
        }
      } else {
        try {
          if (ownership.kind === "posix-process-group") {
            process.kill(-ownership.groupId, "SIGKILL");
          } else if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
          forceSent = true;
        } catch (error) {
          signalError = String(error);
        }
      }
    }
  }
  const treeGone = await process_control_wait_until(
    () => process_control_owned_tree_alive(owned),
    forceTerminationMs,
  );
  const rootExited = await process_control_wait_until(
    async () => child.exitCode === null && child.signalCode === null,
    Math.min(forceTerminationMs, 1_000),
  );
  return {
    status: treeGone && (rootExited || child.pid === undefined) ? "confirmed" : "failed",
    ownership: ownership.kind,
    rootPid: ownership.rootPid,
    ...(ownership.groupId ? { groupId: ownership.groupId } : {}),
    gracefulSent,
    forceSent,
    escalatedToForce: forced,
    rootExited,
    treeGone,
    ...(signalError ? { signalError } : {}),
  };
}

export async function distribution_run_owned_process({
  executable,
  args,
  cwd,
  env,
  timeoutMs,
  signal,
  isolate = true,
  captureLimit = 2_000_000,
  gracefulTerminationMs = 2_000,
  forceTerminationMs = 5_000,
}) {
  const owned = distribution_spawn_owned_process({
    executable,
    args,
    cwd,
    env,
    isolate,
  });
  const { child } = owned;
  const completion = await distribution_wait_for_owned_process(owned, {
    timeoutMs,
    signal,
    captureLimit,
  });
  const cleanup = await distribution_terminate_owned_process(owned, {
    gracefulTerminationMs,
    forceTerminationMs,
  });
  await process_control_delay(25);
  return {
    ...completion,
    exitCode: child.exitCode ?? completion.code,
    exitSignal: child.signalCode ?? completion.signal,
    cleanup,
  };
}
