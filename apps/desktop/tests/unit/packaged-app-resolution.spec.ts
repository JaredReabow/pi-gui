import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePackagedAppExecutable } from "../helpers/electron-app";

for (const folder of ["", "win-unpacked", "win-arm64-unpacked"]) {
  test(`finds the Windows unpacked executable (${folder || "direct path"})`, async () => {
    const release = await mkdtemp(join(tmpdir(), "pi-windows-package-"));
    const app = join(release, folder);
    await mkdir(join(app, "resources"), { recursive: true });
    await writeFile(join(app, "resources", "app.asar"), "fixture");
    await writeFile(join(app, "pi-gui-candidate.exe"), "fixture");
    expect(await resolvePackagedAppExecutable(release, "win32")).toBe(
      join(app, "pi-gui-candidate.exe"),
    );
  });
}
test("does not mistake an installer or an incomplete app for a Windows bundle", async () => {
  const release = await mkdtemp(join(tmpdir(), "pi-windows-installer-"));
  await writeFile(join(release, "pi-gui-candidate-setup.exe"), "fixture");
  await writeFile(join(release, "pi-gui-candidate.exe"), "fixture");
  await expect(resolvePackagedAppExecutable(release, "win32")).rejects.toThrow(
    "No unpacked Windows app",
  );
});
