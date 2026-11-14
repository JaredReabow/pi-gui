import { test, expect } from "@playwright/test";
import { isOwnedElectronMain } from "../helpers/electron-app";

test("direct launch and Windows cmd ownership are proven, not unrelated process adoption", () => {
  const direct = {
    platform: "darwin" as const,
    launcherPid: 40,
    launcherExecutable: "/fixture/Electron",
    mainPid: 40,
    parentPid: 20,
  };
  expect(isOwnedElectronMain(direct)).toBe(true);
  const windows = {
    ...direct,
    platform: "win32" as const,
    launcherExecutable: "C:\\Windows\\System32\\cmd.exe",
    mainPid: 44,
    parentPid: 40,
  };
  expect(isOwnedElectronMain(windows)).toBe(true);
  expect(isOwnedElectronMain({ ...windows, parentPid: 88 })).toBe(false);
  expect(isOwnedElectronMain({ ...windows, launcherExecutable: "unrelated.exe" })).toBe(false);
  expect(isOwnedElectronMain({ ...windows, platform: "linux" })).toBe(false);
  expect(isOwnedElectronMain({ ...windows, launcherPid: undefined })).toBe(false);
});
