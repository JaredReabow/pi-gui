import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, symlink, link, access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAutonomySandbox } from "../dist/autonomy-sandbox.js";
const exec = promisify(execFile);
async function pythonExecutable(): Promise<string> {
  for (const candidate of [process.env.PYTHON, "python3", "/usr/bin/python3"]) {
    if (!candidate) continue;
    try {
      const { stdout } = await exec(
        candidate,
        ["-I", "-c", "import ctypes, os, sys; print(os.path.realpath(sys.executable))"],
        { timeout: 5000 },
      );
      const executable = stdout.trim();
      await access(executable, constants.X_OK);
      return executable;
    } catch {
      /* Try the next installed interpreter, never silently skip the security check. */
    }
  }
  throw new Error(
    "These macOS syscall tests require Python 3 with ctypes; set PYTHON to its executable",
  );
}
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-native-boundary-"));
  const project = join(root, "project");
  await mkdir(project);
  return { root, project };
};
await test(
  "SDK alternate-filename fallbacks never read an unapproved target",
  { skip: process.platform !== "darwin" },
  async () => {
    const { project } = await fixture();
    await symlink("/etc/hosts", join(project, "host’s.txt"));
    await assert.rejects(
      runAutonomySandbox(project, "read", { path: join(project, "host's.txt") }),
    );
  },
);
await test(
  "peer process environments and mutating read-only fcntls are denied",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const python = await pythonExecutable();
    const { root, project } = await fixture();
    const outside = join(root, "outside");
    await writeFile(outside, "unchanged");
    const host = spawn(
      process.execPath,
      ["-e", "process.stdout.write('READY');setInterval(()=>{},1000)"],
      {
        env: { PATH: "/usr/bin:/bin", PI_AUTONOMY_SYNTHETIC_TEST_SECRET: "synthetic-only-canary" },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    t.after(() => {
      host.kill("SIGKILL");
    });
    assert.ok(host.pid);
    await once(host.stdout!, "data");
    const script = [
      "import ctypes,os,fcntl,errno",
      "libc=ctypes.CDLL(None,use_errno=True)",
      `mib=(ctypes.c_int*3)(1,49,${host.pid})`,
      "size=ctypes.c_size_t(1048576);buf=ctypes.create_string_buffer(size.value)",
      "result=libc.sysctl(mib,3,buf,ctypes.byref(size),None,0)",
      "assert result==-1 and ctypes.get_errno() in (errno.EPERM,errno.EACCES), str((result,ctypes.get_errno()))",
      `fd=os.open(${JSON.stringify(outside)},os.O_RDONLY)`,
      "for command in [80,110]:",
      " try:",
      "  fcntl.fcntl(fd,command,0)",
      '  raise AssertionError("mutating fcntl allowed")',
      " except OSError as error:",
      "  assert error.errno==errno.EPERM",
      "os.close(fd)",
      'print("SYSCALL_BOUNDARIES_DENIED")',
    ].join("\n");
    const result = await runAutonomySandbox(project, "bash", {
      command: `exec '${python.replace(/'/g, "'\\''")}' -I -c '${script.replace(/'/g, "'\\''")}'`,
      timeout: 5,
    });
    assert.ok(JSON.stringify(result).includes("SYSCALL_BOUNDARIES_DENIED"));
    assert.equal(await readFile(outside, "utf8"), "unchanged");
  },
);
await test(
  "ordinary file reads and writes do not crawl unrelated hardlinks",
  { skip: process.platform !== "darwin" },
  async () => {
    const { root, project } = await fixture();
    await writeFile(join(root, "outside"), "host");
    await link(join(root, "outside"), join(project, "unrelated-hardlink"));
    await runAutonomySandbox(project, "write", {
      path: join(project, "ordinary"),
      content: "ordinary",
    });
    assert.ok(
      JSON.stringify(
        await runAutonomySandbox(project, "read", { path: join(project, "ordinary") }),
      ).includes("ordinary"),
    );
    await assert.rejects(
      runAutonomySandbox(project, "bash", { command: "printf no-op", timeout: 3 }),
      /hardlink/,
    );
  },
);
