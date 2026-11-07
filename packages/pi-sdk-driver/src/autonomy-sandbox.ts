import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { realpath, mkdtemp, opendir, lstat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, isAbsolute, relative, sep, join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { createBashTool, type BashOperations } from "@earendil-works/pi-coding-agent";

const sdkEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const q = (text: string) => JSON.stringify(text);
const within = (root: string, path: string) => {
  const r = relative(root, path);
  return r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
};
// Seatbelt's #"regex" strings are raw, unlike ordinary quoted path strings.
// Character classes avoid the double-escaping ambiguity of backslash literals.
const ci = (source: string) =>
  source.replace(/[a-z]/gi, (letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`);
export const autonomySandboxAvailable = () => process.platform === "darwin";
export async function autonomySandboxProfile(
  cwd: string,
  temporary: string,
  writable: boolean,
  protectedPaths: readonly string[] = [],
  projectReadsOnly = false,
  inventoryHardlinks = true,
): Promise<string> {
  const root = await realpath(cwd);
  const temp = await realpath(temporary);
  const authority = await Promise.all(protectedPaths.map((path) => realpath(path)));
  const sensitive = ci("/([.]env[^/]*|[.]npmrc|auth[.]json|credentials[^/]*)$");
  const protectedTree = ci("/[.](git|pi|agents|codex|aws|ssh|gnupg|vscode)(/|$)");
  const instructions = ci("/(AGENTS[^/]*[.]md|CLAUDE[.]md)$");
  // A directory rename must not move the authority out of its excluded path.
  const authorityAncestors = new Set<string>();
  for (const path of authority)
    for (let parent = dirname(path); within(root, parent); parent = dirname(parent)) {
      authorityAncestors.add(parent);
      if (parent === root) break;
    }
  // A hardlink aliases an inode outside the sandbox, and a parent rename defeats
  // pathname leaf denials. Refuse the automatic action rather than guessing.
  const started = Date.now();
  let count = 0;
  const scan = async (directory: string): Promise<void> => {
    for await (const entry of await opendir(directory)) {
      if (++count > 20000 || Date.now() - started > 2000)
        throw new Error("Sandbox inventory exceeds automatic budget; human approval required");
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink() || authority.some((excluded) => within(excluded, path))) continue;
      if (entry.isDirectory()) {
        if (
          ![".git", ".pi", ".agents", ".codex", ".aws", ".ssh", ".gnupg", ".vscode"].includes(
            entry.name.toLowerCase(),
          )
        )
          await scan(path);
      } else if (entry.isFile() && (await lstat(path)).nlink > 1)
        throw new Error("Sandbox inventory found a hardlink; human approval required");
    }
  };
  // Arbitrary commands need a project inventory. File tools instead check the
  // exact leaf in both host and worker; do not crawl huge repos for each read.
  if (inventoryHardlinks) await scan(root);
  const runtime = sdkEntry.slice(0, sdkEntry.indexOf("/node_modules/") + "/node_modules".length);
  const archive = sdkEntry.match(/^(.*?[.]asar)(?:\/|$)/)?.[1];
  const appBundle = process.execPath.match(/^(.*?[.]app)(?:\/|$)/)?.[1];
  const readable = [
    root,
    temp,
    runtime,
    dirname(process.execPath),
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library/Apple",
    "/Library/Preferences",
    "/opt/homebrew",
    "/private/etc",
    "/private/var/db",
    ...(archive ? [archive] : []),
    ...(appBundle ? [appBundle] : []),
  ];
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    // Hardware/runtime queries only: unrestricted sysctl-read exposes other
    // host processes' argv/environment through KERN_PROCARGS2.
    `(allow sysctl-read ${[
      "hw.activecpu",
      "hw.busfrequency_compat",
      "hw.byteorder",
      "hw.cacheconfig",
      "hw.cachelinesize_compat",
      "hw.cpufamily",
      "hw.cpufrequency_compat",
      "hw.cputype",
      "hw.l1dcachesize_compat",
      "hw.l1icachesize_compat",
      "hw.l2cachesize_compat",
      "hw.l3cachesize_compat",
      "hw.logicalcpu_max",
      "hw.machine",
      "hw.model",
      "hw.memsize",
      "hw.ncpu",
      "hw.nperflevels",
      "hw.packages",
      "hw.pagesize_compat",
      "hw.pagesize",
      "hw.physicalcpu",
      "hw.physicalcpu_max",
      "hw.logicalcpu",
      "hw.cpufrequency",
      "hw.tbfrequency_compat",
      "hw.vectorunit",
      "machdep.cpu.brand_string",
      "kern.argmax",
      "kern.hostname",
      "kern.maxfilesperproc",
      "kern.maxproc",
      "kern.osproductversion",
      "kern.osrelease",
      "kern.ostype",
      "kern.osvariant_status",
      "kern.osversion",
      "kern.secure_kernel",
      "kern.sysv.semmns",
      "kern.usrstack64",
      "kern.version",
      "sysctl.proc_cputype",
      "vm.loadavg",
    ]
      .map((name) => `(sysctl-name ${q(name)})`)
      .join(" ")}
      (sysctl-name-prefix "hw.optional.arm.")
      (sysctl-name-prefix "hw.optional.armv8_")
      (sysctl-name-prefix "hw.perflevel")
    )`,
    // KERN_PROCARGS2 is authorized as process-info on macOS, not sysctl-read.
    // Explicit deny is required: same-sandbox targeting is insufficient here.
    "(deny process-info*)",
    "(allow process-info-pidinfo (target self))",
    "(allow file-read-metadata file-test-existence)",
    ...(projectReadsOnly
      ? [
          '(allow file-read* (literal "/"))',
          '(allow file-read* (subpath "/dev/fd"))',
          '(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))',
          ...readable.map(
            (path) => `(allow file-read* (require-all (subpath ${q(path)})
          (require-not (regex #${q(sensitive)}))
          (require-not (regex #${q(protectedTree)}))
          ${authority.map((excluded) => `(require-not (subpath ${q(excluded)}))`).join(" ")}
        ))`,
          ),
        ]
      : ["(allow file-read*)"]),
    // Like Codex, explicitly deny fcntls that mutate read-only descriptors.
    "(deny system-fcntl (fcntl-command 80 110))",
    "(deny network*)",
    "(deny mach-lookup)",
    "(deny mach-register)",
    "(deny appleevent-send)",
    "(deny authorization-right-obtain)",
    "(deny signal)",
    "(deny file-link)",
    // Single-process automatic commands cannot orphan/reparent descendants.
    // Commands requiring subprocesses escalate to a one-time human decision.
    "(deny process-fork)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${q(temp)}))`,
    '(allow file-write* (literal "/dev/null"))',
    ...(writable
      ? [
          `(allow file-write* (require-all (subpath ${q(root)})
      (require-not (regex #${q(protectedTree)}))
      (require-not (regex #${q(sensitive)}))
      (require-not (regex #${q(instructions)}))
      ${authority.map((path) => `(require-not (subpath ${q(path)}))`).join(" ")}
    ))`,
        ]
      : []),
    ...[...authorityAncestors].map((path) => `(deny file-write* (literal ${q(path)}))`),
    ...authority.map((path) => `(deny file-read-data (subpath ${q(path)}))`),
    `(deny file-read-data (regex #${q(sensitive)}))`,
    `(deny file-read-data (regex #${q(ci("/[.](pi|codex|aws|ssh|gnupg)(/|$)"))}))`,
  ].join("\n");
}

const worker = `
const sdk = require(${q(sdkEntry)});
const fs = require('node:fs/promises');
(async () => {
 let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>2097152)throw new Error('Action exceeds input limit');}
 const {tool,cwd,input}=JSON.parse(text);
 const create={write:sdk.createWriteTool,edit:sdk.createEditTool,read:sdk.createReadTool,ls:sdk.createLsTool};
 if(!Object.hasOwn(create,tool))throw new Error('Unsupported isolated tool');
 try{const info=await fs.lstat(input.path);if(info.isSymbolicLink()||(info.isFile()&&info.nlink>1))throw new Error('Linked files cannot be changed automatically');}catch(e){if(e.code!=='ENOENT')throw e;}
 let instance=create[tool](cwd);let parameters=input;
 if(tool==='read'){
   // Resolve before calling SDK fallbacks, then guard the final path through
   // released ReadOperations. Pin the checked inode while reading its bytes.
   const expected=await fs.realpath(input.path);const initial=await fs.lstat(expected);
   if(!initial.isFile()||initial.nlink>1)throw new Error('Sandbox read requires a regular unlinked file');
   const guard=async(path)=>{
     if(path!==expected||await fs.realpath(path)!==expected)throw new Error('Sandbox filename fallback or retargeting requires human approval');
     const info=await fs.lstat(path);
     if(info.isSymbolicLink()||info.nlink>1||info.dev!==initial.dev||info.ino!==initial.ino)throw new Error('Sandbox read target changed');
   };
   instance=sdk.createReadTool(cwd,{operations:{
     access:async(path)=>{await guard(path);await fs.access(path,require('node:fs').constants.R_OK);},
     detectImageMimeType:async(path)=>{await guard(path);return sdk.detectSupportedImageMimeTypeFromFile(path);},
     readFile:async(path)=>{await guard(path);const file=await fs.open(path,require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW);try{const actual=await file.stat();await guard(path);if(actual.dev!==initial.dev||actual.ino!==initial.ino)throw new Error('Sandbox read inode changed');return await file.readFile();}finally{await file.close();}}
   }});
   parameters={...input,path:expected};
 }
 const result=await instance.execute('isolated-action',parameters);
 process.stdout.write(JSON.stringify({result}));
})().catch(error=>{process.stdout.write(JSON.stringify({error:String(error)}));process.exitCode=1;});
`;
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("Isolated action cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
function assertResult<T>(result: AgentToolResult<T>): AgentToolResult<T> {
  if (result.isError)
    throw new Error(
      result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    );
  return result;
}
export async function runAutonomySandbox<T = unknown>(
  cwd: string,
  tool: "bash" | "write" | "edit" | "read" | "ls",
  input: unknown,
  signal?: AbortSignal,
  protectedPaths: readonly string[] = [],
): Promise<AgentToolResult<T>> {
  if (!autonomySandboxAvailable())
    throw new Error("No supported automatic sandbox on this platform; human approval required");
  signal?.throwIfAborted();
  const temporary = await abortable(mkdtemp(join(tmpdir(), "pi-agent-action-")), signal);
  const profile = await abortable(
    autonomySandboxProfile(
      cwd,
      temporary,
      tool === "bash" || tool === "write" || tool === "edit",
      protectedPaths,
      tool !== "bash",
      tool === "bash",
    ),
    signal,
  );
  const root = await abortable(realpath(cwd), signal);
  const env = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
    HOME: homedir(),
    LANG: "en_US.UTF-8",
    TMPDIR: temporary,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_NO_WARNINGS: "1",
  };
  signal?.throwIfAborted();
  if (tool === "bash") {
    const operations: BashOperations = {
      exec(command, directory, options) {
        options.signal?.throwIfAborted();
        signal?.throwIfAborted();
        return new Promise((resolve, reject) => {
          // SDK still owns output formatting/truncation. The trusted host starts
          // the sole confined process directly, so Seatbelt can prohibit fork.
          const child = spawn(
            "/usr/bin/sandbox-exec",
            ["-p", profile, "/bin/bash", "--noprofile", "--norc", "-c", command],
            { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] },
          );
          let failure: Error | undefined;
          let bytes = 0;
          const stop = () => {
            failure ??= new Error("Isolated action cancelled, timed out or exceeded output limit");
            child.kill("SIGKILL");
          };
          const timer = setTimeout(stop, Math.min(options.timeout ?? 120, 120) * 1000);
          options.signal?.addEventListener("abort", stop, { once: true });
          if (options.signal?.aborted) stop();
          const cleanup = () => {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", stop);
          };
          const data = (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) {
              stop();
              return;
            }
            try {
              options.onData(chunk);
            } catch (error) {
              failure = new Error(String(error));
              stop();
            }
          };
          child.stdout.on("data", data);
          child.stderr.on("data", data);
          child.on("error", (error) => {
            cleanup();
            reject(error);
          });
          child.on("close", (code) => {
            cleanup();
            if (failure || options.signal?.aborted)
              reject(failure ?? new Error("Isolated action cancelled"));
            else resolve({ exitCode: code });
          });
        });
      },
    };
    const result = await createBashTool(root, {
      operations,
      shellPath: "/bin/bash",
      exposeSessionEnvironment: false,
    }).execute(
      "isolated-action",
      input as Parameters<ReturnType<typeof createBashTool>["execute"]>[1],
      signal,
    );
    return assertResult(result) as AgentToolResult<T>;
  }
  const body = JSON.stringify({ cwd: root, tool, input });
  if (body.length > 2 * 1024 * 1024)
    throw new Error("Action exceeds isolated input limit; split it into smaller steps");
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sandbox-exec", ["-p", profile, process.execPath, "-e", worker], {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let cancelled = false;
    const stop = () => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(stop, 30000);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    };
    child.stdin.on("error", () => {});
    child.stdin.end(body);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.length > 1024 * 1024) stop();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (err.length < 8000) err += chunk.toString();
    });
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", () => {
      cleanup();
      if (cancelled || signal?.aborted) {
        reject(new Error("Isolated action cancelled, timed out or exceeded output limit"));
        return;
      }
      try {
        const response = JSON.parse(out) as { result?: AgentToolResult<T>; error?: string };
        if (response.error) throw new Error(response.error);
        if (!response.result || !Array.isArray(response.result.content))
          throw new Error("Invalid isolated result");
        resolve(assertResult(response.result));
      } catch (error) {
        reject(
          new Error(
            `Sandbox action failed (not retried outside the sandbox): ${String(error)} ${err.slice(0, 1500)}`,
          ),
        );
      }
    });
  });
}
