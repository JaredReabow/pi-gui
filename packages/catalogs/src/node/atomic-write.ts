import { randomBytes } from "node:crypto";
import {
  mkdir,
  open as openFile,
  rename as renameFile,
  rm as removeFile,
  type FileHandle,
} from "node:fs/promises";
import { dirname } from "node:path";

/** Suffix of the transient files writeFileAtomic creates before renaming into place. */
export const TMP_SUFFIX = ".tmp";

/** Narrow filesystem operations used to exercise failure paths without changing production behavior. */
export interface AtomicWriteFileSystem {
  readonly mkdir: (path: string, options: { readonly recursive: true }) => Promise<unknown>;
  readonly open: (path: string, flags: string | number) => Promise<FileHandle>;
  readonly rename: (oldPath: string, newPath: string) => Promise<void>;
  readonly rm: (path: string, options: { readonly force: true }) => Promise<void>;
}

export interface AtomicWriteOptions {
  /** Intended only for deterministic failure tests; production uses the node:fs/promises implementation. */
  readonly fileSystem?: AtomicWriteFileSystem;
}

const nodeFileSystem: AtomicWriteFileSystem = {
  mkdir,
  open: openFile,
  rename: renameFile,
  rm: removeFile,
};

let tmpCounter = 0;

/**
 * Write `data` durably. A concurrent reader or a crash observes either the
 * previous complete target or the fully-written replacement.
 *
 * The temp file is unique and adjacent to the target. A successful complete
 * write and file fsync precedes a rename directly over the target. There is no
 * unlink of the target, so write, close, and rename failures leave the prior
 * target intact. Any owned temp file is removed on those failures.
 *
 * The containing directory is fsynced on a best-effort basis. Directory open,
 * sync, or close failures are ignored because some platforms cannot fsync a
 * directory. Once rename has succeeded, the new bytes are installed even if
 * that directory sync fails; the only remaining uncertainty is whether the
 * rename survives a crash or power loss.
 */
export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const dir = dirname(filePath);
  await fileSystem.mkdir(dir, { recursive: true });

  // A pid, process-local counter and randomness prevent two writers from
  // sharing a temp path, including writes started in the same millisecond.
  tmpCounter = (tmpCounter + 1) >>> 0;
  const tmpPath = `${filePath}.${process.pid}.${tmpCounter}.${randomBytes(6).toString("hex")}${TMP_SUFFIX}`;

  let handle: FileHandle | undefined;
  try {
    handle = await fileSystem.open(tmpPath, "w");
    await handle.writeFile(data);
    await handle.sync();
    const closing = handle;
    handle = undefined; // A failed close is already the final close attempt.
    await closing.close();
  } catch (error) {
    if (handle) await closeBestEffort(handle);
    await fileSystem.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }

  try {
    await fileSystem.rename(tmpPath, filePath);
  } catch (error) {
    await fileSystem.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }

  await syncDirectory(fileSystem, dir);
}

/** Serialize `value` as pretty JSON with a trailing newline and write it atomically. */
export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function closeBestEffort(handle: FileHandle): Promise<void> {
  await handle.close().catch(() => {});
}

async function syncDirectory(fileSystem: AtomicWriteFileSystem, dir: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await fileSystem.open(dir, "r");
    await handle.sync();
  } catch {
    // Directory fsync is a durability enhancement, not part of replacement.
  } finally {
    if (handle) await closeBestEffort(handle);
  }
}
