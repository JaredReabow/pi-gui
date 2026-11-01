import assert from "node:assert/strict";
import { mkdtemp, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  TMP_SUFFIX,
  writeFileAtomic,
  type AtomicWriteFileSystem,
} from "../dist/node/atomic-write.js";

type Failure =
  "write" | "file-sync" | "file-close" | "rename" | "directory-sync" | "directory-close";

async function withTarget(run: (target: string, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-atomic-failure-"));
  const target = join(dir, "catalog.json");
  await writeFile(target, "prior");
  try {
    await run(target, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function injectedFileSystem(failure: Failure, calls: string[]): AtomicWriteFileSystem {
  return {
    mkdir: async () => undefined,
    open: async (path, flags) => {
      const real = await open(path, flags);
      const directory = flags === "r";
      return {
        writeFile: async (data) => {
          calls.push("write");
          if (failure === "write") throw new Error("injected write failure");
          await real.writeFile(data);
        },
        sync: async () => {
          calls.push(directory ? "directory-sync" : "file-sync");
          await real.sync();
          if (
            (!directory && failure === "file-sync") ||
            (directory && failure === "directory-sync")
          ) {
            throw new Error(`injected ${directory ? "directory" : "file"} sync failure`);
          }
        },
        close: async () => {
          calls.push(directory ? "directory-close" : "file-close");
          await real.close();
          if (
            (!directory && failure === "file-close") ||
            (directory && failure === "directory-close")
          ) {
            throw new Error(`injected ${directory ? "directory" : "file"} close failure`);
          }
        },
      } as Awaited<ReturnType<typeof open>>;
    },
    rename: async (oldPath, newPath) => {
      calls.push("rename");
      if (failure === "rename") throw new Error("injected rename failure");
      await rename(oldPath, newPath);
    },
    rm: async (path, options) => {
      calls.push("rm");
      await rm(path, options);
    },
  };
}

for (const failure of ["write", "file-sync", "file-close", "rename"] as const) {
  await test(`${failure} failure preserves the target and removes the owned temp file`, async () => {
    await withTarget(async (target, dir) => {
      const calls: string[] = [];
      await assert.rejects(
        writeFileAtomic(target, "replacement", {
          fileSystem: injectedFileSystem(failure, calls),
        }),
        /injected/,
      );
      assert.equal(await readFile(target, "utf8"), "prior");
      assert.deepEqual(await readdir(dir), ["catalog.json"]);
      assert.ok(calls.includes("rm"), "the failed write must clean its owned temp file");
      assert.equal(
        (await readdir(dir)).some((entry) => entry.endsWith(TMP_SUFFIX)),
        false,
      );
    });
  });
}

for (const failure of ["directory-sync", "directory-close"] as const) {
  await test(`${failure} is best effort after a successful rename`, async () => {
    await withTarget(async (target, dir) => {
      const calls: string[] = [];
      await writeFileAtomic(target, "replacement", {
        fileSystem: injectedFileSystem(failure, calls),
      });
      assert.equal(await readFile(target, "utf8"), "replacement");
      assert.deepEqual(await readdir(dir), ["catalog.json"]);
      assert.ok(calls.includes("rename"));
      assert.ok(calls.includes(failure));
    });
  });
}
