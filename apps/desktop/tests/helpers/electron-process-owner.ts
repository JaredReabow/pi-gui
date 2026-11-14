import { win32 } from "node:path";

/** Playwright launches Electron through cmd.exe on Windows, and directly elsewhere. */
export function isOwnedElectronMain(input: {
  readonly platform: NodeJS.Platform;
  readonly launcherPid: number | undefined;
  readonly launcherExecutable: string;
  readonly mainPid: number;
  readonly parentPid: number;
}): boolean {
  if (!input.launcherPid || input.launcherPid <= 0) return false;
  if (input.mainPid === input.launcherPid) return true;
  return (
    input.platform === "win32" &&
    win32.basename(input.launcherExecutable).toLowerCase() === "cmd.exe" &&
    input.parentPid === input.launcherPid &&
    input.mainPid > 0
  );
}
