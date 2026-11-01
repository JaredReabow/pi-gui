import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { desktopIpc } from "../../contracts/ipc";
import {
  createNamedThread,
  installIpcInvokeControl,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSidePanel,
} from "../helpers/electron-app";

/** Resize only the Files container; a wide viewport proves this is not a media query. */
async function resizeFiles(window: Page, width: number): Promise<void> {
  await window.getByTestId("file-workbench").evaluate((element, size) => {
    Object.assign(element.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: `${size}px`,
      height: "720px",
      zIndex: "1000",
    });
  }, width);
  await expect(window.getByTestId("file-workbench")).toHaveCSS("width", `${width}px`);
}

async function capture(window: Page, info: TestInfo, name: string): Promise<void> {
  const surface = window.getByTestId("file-workbench");
  await surface.screenshot({ path: info.outputPath(`${name}.png`) });
  await writeFile(info.outputPath(`${name}.aria.yml`), await surface.ariaSnapshot());
  await writeFile(
    info.outputPath(`${name}.html`),
    await surface.evaluate((node) => node.outerHTML),
  );
  const bounds = await surface.evaluate((node) =>
    [
      node,
      ...node.querySelectorAll(
        "section, button, input, nav, .file-editor__body, .file-workbench__tree",
      ),
    ].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        class: element.getAttribute("class"),
        label: element.getAttribute("aria-label"),
        text: element.textContent?.slice(0, 100),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    }),
  );
  await writeFile(info.outputPath(`${name}.bounds.json`), JSON.stringify(bounds, null, 2));
}

test("Files responds to container resizing and retains real file, tabs and local state", async ({}, info) => {
  const workspace = await makeWorkspace("responsive-files");
  const directory = "deeply-nested-directory/another-long-directory/third-directory";
  await mkdir(join(workspace, directory), { recursive: true });
  for (const width of [320, 440, 700]) {
    await writeFile(
      join(workspace, directory, `responsive-${width}.md`),
      `# Responsive ${width}\n\n` +
        Array.from({ length: 100 }, (_, i) => `line ${i} content`).join("\n"),
    );
  }
  for (let index = 0; index < 45; index++) {
    await writeFile(join(workspace, `extra-${index}.txt`), `file ${index}`);
  }
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [workspace],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    await createNamedThread(window, "Responsive Files");
    await selectSidePanel(window, "Files");
    const identity = await harness.inspectIdentity();
    expect(identity.visible).toBe(false);
    expect(identity.testMode).toBe("background");
    expect(identity.telemetry.doNotTrack).toBe("1");
    await writeFile(info.outputPath("identity.json"), JSON.stringify(identity, null, 2));
    const editor = window.getByTestId("file-editor");
    const explorer = window.getByTestId("file-explorer");
    const filter = window.getByRole("searchbox", { name: "Filter files" });
    for (const [index, width] of [320, 440, 700].entries()) {
      await resizeFiles(window, width);
      await filter.fill("responsive-");
      const row = explorer.locator(`[data-file-path="${directory}/responsive-${width}.md"]`);
      await row.focus();
      await window.keyboard.press("Enter");
      await expect(editor.getByTestId("file-workbench-preview")).toContainText(
        `Responsive ${width}`,
      );
      await expect(editor.getByTestId("file-workbench-tab")).toHaveCount(index + 1);
      const explorerBox = (await explorer.boundingBox())!;
      const editorBox = (await editor.boundingBox())!;
      if (width <= 600) {
        expect(explorerBox.y + explorerBox.height).toBeLessThanOrEqual(editorBox.y + 1);
        expect(editorBox.width).toBe(width);
      } else {
        expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(explorerBox.x + 1);
        expect(editorBox.y).toBe(explorerBox.y);
      }
      const mode = editor.getByRole("button", { name: "View source" });
      await mode.click();
      await expect(mode).toHaveAttribute("aria-pressed", "true");
      const breadcrumb = editor.getByRole("navigation", { name: "File path" });
      await breadcrumb.focus();
      await window.keyboard.press("End");
      await breadcrumb.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      expect(await breadcrumb.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      const body = editor.locator(".file-editor__body");
      await body.focus();
      await window.keyboard.press("PageDown");
      await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      // Every interactive control stays inside the editor; wrapping cannot hide close/actions.
      for (const button of await editor.getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(editorBox.x);
        expect(box.x + box.width).toBeLessThanOrEqual(editorBox.x + editorBox.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(editorBox.y + editorBox.height);
      }
      await capture(window, info, `width-${width}`);
      await resizeFiles(window, width === 700 ? 320 : 700);
      await expect(filter).toHaveValue("responsive-");
      await expect(mode).toHaveAttribute("aria-pressed", "true");
      await expect(editor.getByTestId("file-workbench-tab")).toHaveCount(index + 1);
      await expect(explorer.locator(".file-workbench__tree-row--selected")).toHaveAttribute(
        "data-file-path",
        `${directory}/responsive-${width}.md`,
      );
      await expect(editor.getByTestId("file-workbench-preview")).toContainText(
        `# Responsive ${width}`,
      );
      await resizeFiles(window, width);
      await filter.fill("");
      const tree = window.getByTestId("file-workbench-tree");
      await tree.focus();
      await window.keyboard.press("PageDown");
      await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await capture(window, info, `scroll-${width}`);
    }
    await resizeFiles(window, 600);
    expect((await explorer.boundingBox())!.y).toBeLessThan((await editor.boundingBox())!.y);
    await resizeFiles(window, 601);
    expect((await explorer.boundingBox())!.y).toBe((await editor.boundingBox())!.y);
  } finally {
    await writeFile(
      info.outputPath("cleanup.json"),
      JSON.stringify(await harness.close(), null, 2),
    );
  }
});

test("Files loading, error and empty states remain usable at each container width", async ({}, info) => {
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [await makeWorkspace("responsive-file-states")],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Files states");
    // Hold the existing listing handler to observe loading without timing assumptions.
    await harness.electronApp.evaluate(({ ipcMain }, channel) => {
      const handlers = (
        ipcMain as typeof ipcMain & {
          _invokeHandlers: Map<string, (...args: unknown[]) => unknown>;
        }
      )._invokeHandlers;
      const original = handlers.get(channel)!;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        await new Promise<void>((resolve) => {
          (globalThis as typeof globalThis & { releaseFileList?: () => void }).releaseFileList =
            resolve;
        });
        return original(...args);
      });
    }, desktopIpc.listWorkspaceFiles);
    await selectSidePanel(window, "Files");
    for (const width of [320, 440, 700]) {
      await resizeFiles(window, width);
      await expect(window.getByText("Loading files...", { exact: true })).toBeVisible();
      await expect(window.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
      await capture(window, info, `loading-${width}`);
    }
    await harness.electronApp.evaluate(() => {
      (globalThis as typeof globalThis & { releaseFileList?: () => void }).releaseFileList?.();
    });
    await expect(window.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
    await harness.electronApp.evaluate(({ ipcMain }, channel) => {
      const handlers = (
        ipcMain as typeof ipcMain & {
          _invokeHandlers: Map<string, (...args: unknown[]) => unknown>;
        }
      )._invokeHandlers;
      const original = handlers.get(channel)!;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        await new Promise<void>((resolve) => {
          (globalThis as typeof globalThis & { releaseFileRead?: () => void }).releaseFileRead =
            resolve;
        });
        return original(...args);
      });
    }, desktopIpc.readWorkspaceFile);
    await window.locator('[data-file-path="README.md"]').click();
    for (const width of [320, 440, 700]) {
      await resizeFiles(window, width);
      await expect(window.getByText("Loading file...", { exact: true })).toBeVisible();
      await capture(window, info, `read-loading-${width}`);
    }
    await harness.electronApp.evaluate(() => {
      (globalThis as typeof globalThis & { releaseFileRead?: () => void }).releaseFileRead?.();
    });
    await expect(window.getByTestId("file-workbench-preview")).toContainText(
      "responsive-file-states",
    );
    await window.getByRole("button", { name: "Close README.md", exact: true }).click();
    await installIpcInvokeControl(harness, desktopIpc.readWorkspaceFile, {
      mode: "reject",
      sentinel: "Synthetic file read error",
    });
    await window.locator('[data-file-path="README.md"]').click();
    for (const width of [320, 440, 700]) {
      await resizeFiles(window, width);
      await expect(window.getByTestId("file-editor")).toContainText("Synthetic file read error");
      await expect(window.getByRole("button", { name: "Copy file", exact: true })).toBeDisabled();
      await capture(window, info, `read-error-${width}`);
    }
    await window.getByRole("button", { name: "Close README.md", exact: true }).click();
    for (const width of [320, 440, 700]) {
      await resizeFiles(window, width);
      await installIpcInvokeControl(harness, desktopIpc.listWorkspaceFiles, {
        mode: "reject",
        sentinel: "Synthetic listing error",
      });
      await window.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(window.getByText("Couldn't load files", { exact: true })).toBeVisible();
      await capture(window, info, `error-${width}`);
      await installIpcInvokeControl(harness, desktopIpc.listWorkspaceFiles, {
        mode: "replace",
        replacement: [],
      });
      await window.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(window.getByText("No indexed files", { exact: true })).toBeVisible();
      await expect(
        window.getByText("Select a file from the explorer.", { exact: true }),
      ).toBeVisible();
      await window.getByRole("searchbox", { name: "Filter files" }).fill("still reachable");
      await capture(window, info, `empty-${width}`);
    }
  } finally {
    await writeFile(
      info.outputPath("cleanup.json"),
      JSON.stringify(await harness.close(), null, 2),
    );
  }
});
