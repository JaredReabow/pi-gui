import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("actual Main retains appearance state across unrelated full saves and reloads", async ({}, testInfo) => {
  const root = resolve(__dirname, "../../../..");
  const output = testInfo.outputPath("project-persistence-probe.mjs");
  const writeControlSymbol = "d08-stage2-write-control";
  const persistenceWriteStart =
    "  await writeFileAtomicQueued(uiStateFilePath, serialized, decodePersistedUiState, {";
  const aliases = {
    "@pi-gui/session-driver": "packages/session-driver/src/index.ts",
    "@pi-gui/session-driver/runtime-types": "packages/session-driver/src/runtime-types.ts",
    "@pi-gui/session-driver/types": "packages/session-driver/src/types.ts",
    "@pi-gui/catalogs": "packages/catalogs/src/index.ts",
    "@pi-gui/catalogs/node": "packages/catalogs/src/node/index.ts",
    "@pi-gui/catalogs/node/atomic-write": "packages/catalogs/src/node/atomic-write.ts",
    "@pi-gui/pi-sdk-driver": "packages/pi-sdk-driver/src/index.ts",
    "@pi-gui/pi-sdk-driver/runtime-types": "packages/session-driver/src/runtime-types.ts",
    "@pi-gui/extension-ui": "packages/extension-ui/src/index.ts",
  };

  await build({
    stdin: {
      contents: `
        import assert from "node:assert/strict";
        import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { setTimeout as delay } from "node:timers/promises";
        import { DesktopAppStore } from ${JSON.stringify(join(root, "apps/desktop/electron/application/app-store.ts"))};

        const control = { writes: [], history: [], deny: false };
        globalThis[Symbol.for(${JSON.stringify(writeControlSymbol)})] = control;
        const clean = (value) => JSON.parse(JSON.stringify(value));
        const same = (left, right) => assert.deepEqual(clean(left), clean(right));
        const writeJson = async (path, value, pretty = false) => {
          await mkdir(dirname(path), { recursive: true });
          const bytes = JSON.stringify(value, null, pretty ? 2 : 0) + "\\n";
          await writeFile(path, bytes);
          return bytes;
        };
        const seed = async (name, value) => {
          const dir = ${JSON.stringify(testInfo.outputPath("profiles"))} + "/" + name;
          const path = join(dir, "ui-state.json");
          const initialBytes = await writeJson(path, value, true);
          return { dir, path, initialBytes };
        };
        const resetWrites = () => { control.writes.length = 0; control.deny = false; };
        const exactColors = {
          "present-root": "#123456",
          "linked-worktree-owner": "#123456",
          "absent-project": "#abcdef",
        };
        const existing = {
          selectedWorkspaceId: "present-root",
          selectedSessionId: "session",
          activeView: "threads",
          composerDraft: "per-session draft",
          composerDraftsBySession: { "present-root:session": "per-session draft" },
          extensionFlagsByWorkspace: { "present-root": { plan: true, "dry-run": false } },
          extensionFlagsBySession: { "present-root:session": { plan: true } },
          notificationPreferences: {
            backgroundCompletion: true,
            backgroundFailure: false,
            attentionNeeded: true,
          },
          disabledBuiltinExtensions: ["quiet", "second"],
          integratedTerminalShell: "/bin/zsh",
          lastViewedAtBySession: { "present-root:session": "2026-10-31T00:00:00Z" },
          lastInteractedAtBySession: { "present-root:session": "2026-10-31T00:01:00Z" },
          pinnedAtBySession: { "present-root:session": "2026-10-31T00:02:00Z" },
          pinnedSessionOrder: ["present-root:session"],
          workspaceOrder: ["present-root"],
          modelSettingsScopeMode: "per-repo",
          appGlobalModelSettings: {
            defaultProvider: "pi",
            defaultModelId: "fixture-model",
            defaultThinkingLevel: "high",
            enabledModelPatterns: ["fixture-*"],
          },
          sidebarCollapsed: true,
          threadGrouping: "workspace",
          collapsedWorkspaceIds: ["present-root"],
          folderPreferencesByWorkspace: { "present-root": "partial" },
          allThreadsSort: "activity",
          initiatingOriginBySession: {
            "present-root:session": { kind: "human", source: "desktop-host" },
          },
          createdAtBySession: { "present-root:session": "2026-10-31T00:00:00Z" },
          enableTransparency: true,
          themeMode: "dark",
        };
        const workspaceCatalog = {
          workspaces: [{
            workspaceId: "present-root",
            path: ${JSON.stringify(testInfo.outputPath("profiles/present-root"))},
            displayName: "Present root",
            lastOpenedAt: "2026-10-31T00:00:00Z",
            sortOrder: 0,
          }],
        };
        const sessionCatalog = {
          sessions: [
            {
              sessionRef: { workspaceId: "present-root", sessionId: "session" },
              workspaceId: "present-root",
              title: "Retained session",
              updatedAt: "2026-10-31T00:00:00Z",
              status: "idle",
            },
            {
              sessionRef: { workspaceId: "present-root", sessionId: "legacy-activity" },
              workspaceId: "present-root",
              title: "Legacy activity session",
              updatedAt: "2026-10-31T00:02:00Z",
              status: "idle",
            },
            {
              sessionRef: { workspaceId: "present-root", sessionId: "legacy-child" },
              workspaceId: "present-root",
              title: "Legacy child session",
              updatedAt: "2026-10-31T00:02:30Z",
              status: "idle",
            },
          ],
        };
        const configureMain = (store) => {
          store.driver.listWorkspaces = async () => workspaceCatalog;
          store.driver.listSessions = async () => sessionCatalog;
          store.workspaceOwner.syncAndListWorktrees = async () => [];
          store.syncStartupWorkspace = async () => undefined;
          store.ensureRuntimeLoaded = async () => {};
          store.loadScopedModelSettingsByWorkspace = async () => ({});
          store.loadLiveGlobalModelSettings = async () => existing.appGlobalModelSettings;
          store.startSelectedSessionHydration = () => {};
          return store;
        };

        const userSeed = await seed("user-activity", {
          version: 20,
          ...existing,
          workspaceAccentColors: exactColors,
          activityIndicatorPreference: { style: "spiral", source: "user" },
        });
        resetWrites();
        const first = configureMain(new DesktopAppStore({
          userDataDir: userSeed.dir,
          initialWorkspacePaths: [],
        }));
        first.schedulePersistUiState();
        await delay(350);
        assert.equal(control.writes.length, 0);
        assert.equal(await readFile(userSeed.path, "utf8"), userSeed.initialBytes);
        await first.initialize();
        assert.ok(control.writes.length > 0);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          same(write.activityIndicatorPreference, { style: "spiral", source: "user" });
        }
        same(first.workspaceAccentColors, exactColors);
        same(first.activityIndicatorPreference, { style: "spiral", source: "user" });
        same((await first.getState()).sidebarAppearance, {
          projectByWorkspaceId: {
            "present-root": { projectId: "present-root", accentColor: "#123456" },
          },
          activityIndicatorPreference: { style: "spiral", source: "user" },
        });

        resetWrites();
        await first.setAllThreadsSort("created");
        assert.ok(control.writes.length > 0);
        const firstWrite = control.writes.find((write) => write.allThreadsSort === "created");
        assert.ok(firstWrite);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          same(write.activityIndicatorPreference, { style: "spiral", source: "user" });
        }
        assert.equal(firstWrite.version, 20);
        same(firstWrite.workspaceAccentColors, exactColors);
        same(firstWrite.activityIndicatorPreference, { style: "spiral", source: "user" });
        assert.equal(firstWrite.allThreadsSort, "created");
        const userSavedBytes = await readFile(userSeed.path, "utf8");
        const userSaved = JSON.parse(userSavedBytes);
        same(userSaved.workspaceAccentColors, exactColors);
        same(userSaved.activityIndicatorPreference, { style: "spiral", source: "user" });
        assert.equal(userSaved.composerDraft, existing.composerDraft);
        same(userSaved.composerDraftsBySession, existing.composerDraftsBySession);
        same(userSaved.pinnedSessionOrder, existing.pinnedSessionOrder);
        same(userSaved.workspaceOrder, existing.workspaceOrder);
        same(userSaved.folderPreferencesByWorkspace, existing.folderPreferencesByWorkspace);
        assert.equal(userSaved.allThreadsSort, "created");
        same(userSaved.notificationPreferences, { ...existing.notificationPreferences, chimeEnabled: true, chimeSound: 'typewriter-return', chimeVolume: 60 });
        same(userSaved.initiatingOriginBySession, existing.initiatingOriginBySession);
        same(userSaved.createdAtBySession, existing.createdAtBySession);
        assert.equal(userSaved.themeMode, "dark");

        resetWrites();
        const firstReload = configureMain(new DesktopAppStore({
          userDataDir: userSeed.dir,
          initialWorkspacePaths: [],
        }));
        await firstReload.initialize();
        assert.ok(control.writes.length > 0);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          same(write.activityIndicatorPreference, { style: "spiral", source: "user" });
        }
        same(firstReload.workspaceAccentColors, exactColors);
        same(firstReload.activityIndicatorPreference, { style: "spiral", source: "user" });
        same((await firstReload.getState()).sidebarAppearance, {
          projectByWorkspaceId: {
            "present-root": { projectId: "present-root", accentColor: "#123456" },
          },
          activityIndicatorPreference: { style: "spiral", source: "user" },
        });

        const legacySeed = await seed("legacy-activity", {
          version: 20,
          ...existing,
          workspaceAccentColors: exactColors,
          activityIndicatorPreference: { style: "wheel", source: "legacy-migrated" },
        });
        resetWrites();
        const legacy = configureMain(new DesktopAppStore({
          userDataDir: legacySeed.dir,
          initialWorkspacePaths: [],
        }));
        await legacy.initialize();
        assert.ok(control.writes.length > 0);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          same(write.activityIndicatorPreference, {
            style: "wheel",
            source: "legacy-migrated",
          });
        }
        resetWrites();
        await legacy.setAllThreadsSort("title");
        const legacySavedBytes = await readFile(legacySeed.path, "utf8");
        const legacySaved = JSON.parse(legacySavedBytes);
        same(legacySaved.workspaceAccentColors, exactColors);
        same(legacySaved.activityIndicatorPreference, {
          style: "wheel",
          source: "legacy-migrated",
        });
        same(legacySaved.workspaceAccentColors, control.writes[0].workspaceAccentColors);
        same(
          legacySaved.activityIndicatorPreference,
          control.writes[0].activityIndicatorPreference,
        );
        resetWrites();
        const legacyReload = configureMain(new DesktopAppStore({
          userDataDir: legacySeed.dir,
          initialWorkspacePaths: [],
        }));
        await legacyReload.initialize();
        assert.ok(control.writes.length > 0);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          same(write.activityIndicatorPreference, {
            style: "wheel",
            source: "legacy-migrated",
          });
        }
        same(legacyReload.activityIndicatorPreference, {
          style: "wheel",
          source: "legacy-migrated",
        });

        const absentSeed = await seed("absent-activity", {
          version: 20,
          ...existing,
          workspaceAccentColors: exactColors,
        });
        resetWrites();
        const absent = configureMain(new DesktopAppStore({
          userDataDir: absentSeed.dir,
          initialWorkspacePaths: [],
        }));
        await absent.initialize();
        assert.ok(control.writes.length > 0);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          assert.equal(write.activityIndicatorPreference, undefined);
        }
        resetWrites();
        await absent.setAllThreadsSort("unread-first");
        const absentSavedBytes = await readFile(absentSeed.path, "utf8");
        const absentSaved = JSON.parse(absentSavedBytes);
        same(absentSaved.workspaceAccentColors, exactColors);
        assert.equal(Object.hasOwn(absentSaved, "activityIndicatorPreference"), false);
        assert.equal(control.writes[0].activityIndicatorPreference, undefined);
        resetWrites();
        const absentReload = configureMain(new DesktopAppStore({
          userDataDir: absentSeed.dir,
          initialWorkspacePaths: [],
        }));
        await absentReload.initialize();
        assert.ok(control.writes.length > 0);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          assert.equal(write.activityIndicatorPreference, undefined);
        }
        assert.equal(absentReload.activityIndicatorPreference, undefined);
        same(absentReload.workspaceAccentColors, exactColors);

        const invalidSeed = await seed("failed-decode", {
          version: 20,
          workspaceAccentColors: exactColors,
          activityIndicatorPreference: {
            style: "spiral",
            source: "user",
            nested: { forbidden: true },
          },
        });
        resetWrites();
        const invalid = configureMain(new DesktopAppStore({
          userDataDir: invalidSeed.dir,
          initialWorkspacePaths: [],
        }));
        await invalid.initialize();
        assert.equal(invalid.persistenceReadiness, "blocked");
        assert.ok((await invalid.getState()).startupDiagnostics.length > 0);
        await invalid.persistUiState();
        invalid.schedulePersistUiState();
        await delay(350);
        assert.equal(control.writes.length, 0);
        assert.equal(await readFile(invalidSeed.path, "utf8"), invalidSeed.initialBytes);

        const v19Seed = await seed("v19-migration", {
          version: 19,
          ...existing,
        });
        resetWrites();
        const v19Main = configureMain(
          new DesktopAppStore({
            userDataDir: v19Seed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await v19Main.initialize();
        const v19Saved = JSON.parse(await readFile(v19Seed.path, "utf8"));
        assert.equal(v19Saved.version, 20);
        assert.equal(v19Saved.activityIndicatorPreference, undefined);
        same(v19Saved.workspaceAccentColors, v19Main.workspaceAccentColors);
        assert.equal(Object.keys(v19Saved.workspaceAccentColors).length, 1);
        same((await v19Main.getState()).sidebarAppearance?.activityIndicatorPreference, {
          style: "moonwalk",
          source: "provisional",
        });
        const v19MigrationBackups = (await readdir(v19Seed.dir)).filter((name) =>
          name.startsWith("ui-state.pre-workbench-v19."),
        );
        assert.equal(v19MigrationBackups.length, 1);
        assert.equal(
          await readFile(join(v19Seed.dir, v19MigrationBackups[0]), "utf8"),
          v19Seed.initialBytes,
        );

        const legacyOrigin = {
          "present-root:legacy-child": {
            kind: "subagent",
            parentWorkspaceId: "present-root",
            parentSessionId: "parent-existing-only-in-session-origins",
          },
        };
        const installedRepairSeed = await seed("installed-repair-v20", {
          version: 20,
          ...existing,
          preventSleep: true,
          allowCrossProjectThreadCommands: false,
          lastHumanInputAtBySession: {
            "present-root:legacy-activity": "2026-10-31T00:03:00Z",
          },
          sessionOrigins: legacyOrigin,
        });
        resetWrites();
        const installedRepair = configureMain(new DesktopAppStore({
          userDataDir: installedRepairSeed.dir,
          initialWorkspacePaths: [],
        }));
        await installedRepair.initialize();
        assert.equal(installedRepair.persistenceReadiness, "ready");
        assert.ok(control.writes.length > 0);
        const repairSnapshotNames = (await readdir(installedRepairSeed.dir)).filter((name) =>
          name.startsWith("ui-state.pre-repair-v1.0.14."),
        );
        assert.equal(repairSnapshotNames.length, 1);
        const repairSnapshotPath = join(installedRepairSeed.dir, repairSnapshotNames[0]);
        const repairSnapshotBytes = await readFile(repairSnapshotPath, "utf8");
        assert.equal(repairSnapshotBytes, installedRepairSeed.initialBytes);

        resetWrites();
        await installedRepair.setAllThreadsSort("created");
        await installedRepair.setAllThreadsSort("title");
        assert.equal(
          (
            await readdir(installedRepairSeed.dir)
          ).filter((name) => name.startsWith("ui-state.pre-repair-v1.0.14.")).length,
          1,
        );
        assert.equal(await readFile(repairSnapshotPath, "utf8"), repairSnapshotBytes);

        const installedRepairSaved = JSON.parse(
          await readFile(installedRepairSeed.path, "utf8"),
        );
        assert.equal(installedRepairSaved.preventSleep, true);
        assert.equal(installedRepairSaved.allowCrossProjectThreadCommands, false);
        same(installedRepairSaved.sessionOrigins, legacyOrigin);
        assert.equal(
          installedRepairSaved.lastInteractedAtBySession["present-root:legacy-activity"],
          "2026-10-31T00:03:00Z",
        );
        same(installedRepairSaved.initiatingOriginBySession["present-root:legacy-child"], {
          kind: "tool",
          source: "desktop-host",
        });
        assert.equal(installedRepairSaved.legacyRepairUiStateImported, true);

        resetWrites();
        const installedRepairReload = configureMain(new DesktopAppStore({
          userDataDir: installedRepairSeed.dir,
          initialWorkspacePaths: [],
        }));
        await installedRepairReload.initialize();
        assert.equal(installedRepairReload.persistenceReadiness, "ready");
        const installedRepairReloaded = JSON.parse(
          await readFile(installedRepairSeed.path, "utf8"),
        );
        assert.equal(installedRepairReloaded.preventSleep, true);
        assert.equal(installedRepairReloaded.allowCrossProjectThreadCommands, false);
        same(installedRepairReloaded.sessionOrigins, legacyOrigin);
        assert.equal(
          installedRepairReloaded.lastInteractedAtBySession["present-root:legacy-activity"],
          "2026-10-31T00:03:00Z",
        );
        assert.equal(await readFile(repairSnapshotPath, "utf8"), repairSnapshotBytes);

        const failedWriteSeed = await seed("failed-write", {
          version: 20,
          ...existing,
          workspaceAccentColors: exactColors,
        });
        resetWrites();
        const failedWrite = configureMain(new DesktopAppStore({
          userDataDir: failedWriteSeed.dir,
          initialWorkspacePaths: [],
        }));
        await failedWrite.initialize();
        assert.ok(control.writes.length > 0);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          assert.equal(write.activityIndicatorPreference, undefined);
        }
        resetWrites();
        const priorBytes = await readFile(failedWriteSeed.path, "utf8");
        const priorBackupBytes = await readFile(failedWriteSeed.path + ".bak", "utf8");
        control.deny = true;
        await assert.rejects(
          failedWrite.setAllThreadsSort("title"),
          /synthetic ui-state write failure/,
        );
        control.deny = false;
        assert.equal(await readFile(failedWriteSeed.path, "utf8"), priorBytes);
        assert.equal(await readFile(failedWriteSeed.path + ".bak", "utf8"), priorBackupBytes);
        same(failedWrite.workspaceAccentColors, exactColors);
        assert.equal(failedWrite.activityIndicatorPreference, undefined);
        resetWrites();
        const failedWriteReload = configureMain(new DesktopAppStore({
          userDataDir: failedWriteSeed.dir,
          initialWorkspacePaths: [],
        }));
        await failedWriteReload.initialize();
        assert.ok(control.writes.length > 0);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          assert.equal(write.activityIndicatorPreference, undefined);
        }
        same(failedWriteReload.workspaceAccentColors, exactColors);
        assert.equal(failedWriteReload.activityIndicatorPreference, undefined);

        const backupNames = (await readdir(userSeed.dir)).filter((name) =>
          name.includes(".bak") || name.includes(".pre-workbench-"),
        );
        const proof = {
          actualMain: true,
          noWriteBeforeInit: true,
          unrelatedSaveWriteCount: 1,
          userAndLegacyActivityPreserved: true,
          absentActivityKeyPreserved: true,
          absentProjectKeyPreserved: true,
          exactColors,
          existingFieldsPreserved: true,
          failedDecodeBlockedWrite: true,
          v19UpgradeBackupRetained: true,
          installedRepairMigrationRetained: true,
          syntheticWriteFailurePreservedPrior: true,
          consumerProjectionCommitted: true,
          writeOrder: control.history.map((entry) => ({
            denied: entry.denied,
            version: entry.payload.version,
            allThreadsSort: entry.payload.allThreadsSort,
            accentKeys: Object.keys(entry.payload.workspaceAccentColors ?? {}),
            activityIndicatorPreference: entry.payload.activityIndicatorPreference,
          })),
          backupNames,
          initialUserJson: JSON.parse(userSeed.initialBytes),
          savedUserJson: JSON.parse(userSavedBytes),
          initialLegacyJson: JSON.parse(legacySeed.initialBytes),
          savedLegacyJson: JSON.parse(legacySavedBytes),
          initialAbsentJson: JSON.parse(absentSeed.initialBytes),
          savedAbsentJson: JSON.parse(absentSavedBytes),
        };
        const evidenceDir = process.env.PI_D08_STAGE2_EVIDENCE_DIR;
        if (evidenceDir) {
          const evidenceRoot = join(evidenceDir, "synthetic");
          await mkdir(evidenceRoot, { recursive: true });
          await writeFile(join(evidenceRoot, "proof.json"), JSON.stringify(proof, null, 2) + "\\n");
          await writeFile(
            join(evidenceRoot, "write-order.json"),
            JSON.stringify(proof.writeOrder, null, 2) + "\\n",
          );
          const retainProfile = async (name, dir) => {
            const destination = join(evidenceRoot, name);
            await mkdir(destination, { recursive: true });
            for (const file of await readdir(dir)) {
              if (
                file === "ui-state.json" ||
                file.endsWith(".bak") ||
                file.includes(".pre-workbench-") ||
                file.includes(".corrupt.")
              ) {
                await copyFile(join(dir, file), join(destination, file));
              }
            }
          };
          await retainProfile("user-activity", userSeed.dir);
          await retainProfile("legacy-activity", legacySeed.dir);
          await retainProfile("absent-activity", absentSeed.dir);
          await retainProfile("failed-decode", invalidSeed.dir);
          await retainProfile("v19-migration", v19Seed.dir);
          await retainProfile("failed-write", failedWriteSeed.dir);
        }
        console.log(JSON.stringify(proof));
        process.exit(0);
      `,
      resolveDir: root,
      loader: "js",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
    tsconfig: join(root, "apps/desktop/tsconfig.electron.json"),
    alias: Object.fromEntries(
      Object.entries(aliases).map(([name, target]) => [name, join(root, target)]),
    ),
    plugins: [
      {
        name: "track-actual-ui-state-writes",
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "d08-native-block",
          }));
          builder.onLoad({ filter: /.*/, namespace: "d08-native-block" }, () => ({
            contents:
              'export const nativeImage = new Proxy({}, { get() { throw new Error("Unexpected native image access in persistence test"); } });',
            loader: "js",
          }));
          builder.onLoad({ filter: /app-store-persistence\.ts$/ }, async ({ path }) => {
            const source = await readFile(path, "utf8");
            if (!source.includes(persistenceWriteStart)) {
              throw new Error("Expected actual ui-state write entry point");
            }
            return {
              contents: source.replace(
                persistenceWriteStart,
                `  const serializedWrite = JSON.parse(serialized);
  const writeControl = globalThis[Symbol.for(${JSON.stringify(writeControlSymbol)})];
  writeControl?.writes.push(serializedWrite);
  writeControl?.history.push({
    denied: Boolean(writeControl?.deny),
    payload: serializedWrite,
  });
  if (writeControl?.deny) throw new Error("synthetic ui-state write failure");
${persistenceWriteStart}`,
              ),
              loader: "ts",
            };
          });
        },
      },
    ],
  });

  const result = await execFileAsync(process.execPath, [output], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const proof = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
    actualMain?: boolean;
    noWriteBeforeInit?: boolean;
    userAndLegacyActivityPreserved?: boolean;
    absentActivityKeyPreserved?: boolean;
    absentProjectKeyPreserved?: boolean;
    existingFieldsPreserved?: boolean;
    failedDecodeBlockedWrite?: boolean;
    v19UpgradeBackupRetained?: boolean;
    syntheticWriteFailurePreservedPrior?: boolean;
    consumerProjectionCommitted?: boolean;
    writeOrder?: readonly {
      readonly denied: boolean;
      readonly version: number;
      readonly allThreadsSort: string;
    }[];
  };
  expect(proof).toMatchObject({
    actualMain: true,
    noWriteBeforeInit: true,
    userAndLegacyActivityPreserved: true,
    absentActivityKeyPreserved: true,
    absentProjectKeyPreserved: true,
    existingFieldsPreserved: true,
    failedDecodeBlockedWrite: true,
    v19UpgradeBackupRetained: true,
    syntheticWriteFailurePreservedPrior: true,
    consumerProjectionCommitted: true,
  });
  expect(proof.writeOrder?.length).toBeGreaterThanOrEqual(10);
  expect(
    proof.writeOrder?.some(
      (write) =>
        write.version === 20 && write.allThreadsSort === "created" && write.denied === false,
    ),
  ).toBe(true);
  expect(
    proof.writeOrder?.some(
      (write) => write.version === 20 && write.allThreadsSort === "title" && write.denied === true,
    ),
  ).toBe(true);
  await testInfo.attach("actual-main-persistence", {
    body: result.stdout,
    contentType: "application/json",
  });
});

test("actual Main commits defaults, projection, queued appearance mutations, and migration precedence", async ({}, testInfo) => {
  const root = resolve(__dirname, "../../../..");
  const output = testInfo.outputPath("stage3-appearance-probe.mjs");
  const writeControlSymbol = "d08-stage3-write-control";
  const persistenceWriteStart =
    "  await writeFileAtomicQueued(uiStateFilePath, serialized, decodePersistedUiState, {";
  const aliases = {
    "@pi-gui/session-driver": "packages/session-driver/src/index.ts",
    "@pi-gui/session-driver/runtime-types": "packages/session-driver/src/runtime-types.ts",
    "@pi-gui/session-driver/types": "packages/session-driver/src/types.ts",
    "@pi-gui/catalogs": "packages/catalogs/src/index.ts",
    "@pi-gui/catalogs/node": "packages/catalogs/src/node/index.ts",
    "@pi-gui/catalogs/node/atomic-write": "packages/catalogs/src/node/atomic-write.ts",
    "@pi-gui/pi-sdk-driver": "packages/pi-sdk-driver/src/index.ts",
    "@pi-gui/pi-sdk-driver/runtime-types": "packages/session-driver/src/runtime-types.ts",
    "@pi-gui/extension-ui": "packages/extension-ui/src/index.ts",
  };

  await build({
    stdin: {
      contents: `
        import assert from "node:assert/strict";
        import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { setTimeout as delay } from "node:timers/promises";
        import { DesktopAppStore } from ${JSON.stringify(join(root, "apps/desktop/electron/application/app-store.ts"))};

        const deferred = () => {
          let resolve;
          const promise = new Promise((done) => { resolve = done; });
          return { promise, resolve };
        };
        const control = {
          writes: [],
          history: [],
          denyNext: false,
          holdNext: null,
          holdStarted: null,
        };
        globalThis[Symbol.for(${JSON.stringify(writeControlSymbol)})] = control;
        const clean = (value) => JSON.parse(JSON.stringify(value));
        const same = (left, right) => assert.deepEqual(clean(left), clean(right));
        const writeJson = async (path, value) => {
          await mkdir(dirname(path), { recursive: true });
          const bytes = JSON.stringify(value, null, 2) + "\\n";
          await writeFile(path, bytes);
          return bytes;
        };
        const seed = async (name, value) => {
          const dir = ${JSON.stringify(testInfo.outputPath("stage3-profiles"))} + "/" + name;
          const path = join(dir, "ui-state.json");
          return { dir, path, initialBytes: await writeJson(path, value) };
        };
        const resetWrites = () => {
          control.writes.length = 0;
          control.denyNext = false;
          control.holdNext = null;
          control.holdStarted = null;
        };
        const holdWrite = (deny = false) => {
          const hold = deferred();
          const started = deferred();
          control.holdNext = hold.promise;
          control.holdStarted = started.resolve;
          control.denyNext = deny;
          return { release: hold.resolve, started: started.promise };
        };
        const queueEvents = [];
        const existing = {
          selectedWorkspaceId: "project-00",
          selectedSessionId: "",
          activeView: "threads",
          composerDraft: "unrelated draft",
          extensionFlagsByWorkspace: { "project-00": { plan: true } },
          notificationPreferences: {
            backgroundCompletion: true,
            backgroundFailure: false,
            attentionNeeded: true,
          },
          workspaceOrder: ["project-00"],
          modelSettingsScopeMode: "app-global",
          threadGrouping: "workspace",
          folderPreferencesByWorkspace: { "project-00": "partial" },
          allThreadsSort: "activity",
          themeMode: "dark",
        };
        const roots = Array.from({ length: 20 }, (_, index) => {
          const id = "project-" + String(index).padStart(2, "0");
          return {
            workspaceId: id,
            path: ${JSON.stringify(testInfo.outputPath("stage3-profiles/workspaces"))} + "/" + id,
            displayName: "Project " + index,
            lastOpenedAt: "2026-10-31T00:00:00Z",
            sortOrder: index,
          };
        });
        const linkedPath = ${JSON.stringify(testInfo.outputPath("stage3-profiles/workspaces"))} + "/linked-worktree";
        const orphanPath = ${JSON.stringify(testInfo.outputPath("stage3-profiles/workspaces"))} + "/orphan-worktree";
        const allWorkspaces = [
          ...roots,
          {
            workspaceId: "worktree-linked",
            path: linkedPath,
            displayName: "Linked worktree",
            lastOpenedAt: "2026-10-31T00:00:00Z",
            sortOrder: 20,
          },
          {
            workspaceId: "orphan-worktree",
            path: orphanPath,
            displayName: "Orphan worktree",
            lastOpenedAt: "2026-10-31T00:00:00Z",
            sortOrder: 21,
          },
        ];
        const allWorktrees = [
          {
            worktreeId: "linked",
            workspaceId: "project-00",
            path: linkedPath,
            displayName: "Linked worktree",
            kind: "linked",
            status: "ready",
            branchName: "linked",
            headSha: "1111111",
            createdAt: "2026-10-31T00:00:00Z",
            updatedAt: "2026-10-31T00:00:00Z",
          },
          {
            worktreeId: "orphan",
            workspaceId: "missing-root",
            path: orphanPath,
            displayName: "Orphan worktree",
            kind: "linked",
            status: "ready",
            branchName: "orphan",
            headSha: "2222222",
            createdAt: "2026-10-31T00:00:00Z",
            updatedAt: "2026-10-31T00:00:00Z",
          },
        ];
        const catalog = {
          workspaces: [...allWorkspaces],
          worktrees: [...allWorktrees],
          sessions: [],
        };
        const simpleCatalog = {
          workspaces: [roots[0]],
          worktrees: [],
          sessions: [],
        };
        const configureMain = (store, selectedCatalog) => {
          store.driver.listWorkspaces = async () => ({
            workspaces: selectedCatalog.workspaces,
          });
          store.driver.listSessions = async () => ({ sessions: selectedCatalog.sessions });
          store.workspaceOwner.syncAndListWorktrees = async () => selectedCatalog.worktrees;
          store.workspaceOwner.reconcileWorktrees = async () => {};
          store.syncStartupWorkspace = async () => undefined;
          store.ensureRuntimeLoaded = async () => {};
          store.loadScopedModelSettingsByWorkspace = async () => ({});
          store.loadLiveGlobalModelSettings = async () => ({ enabledModelPatterns: [] });
          store.startSelectedSessionHydration = () => {};
          return store;
        };
        const retainedColorKeys = ["project-00", "project-01", "absent-project"];
        const savedColors = {
          "project-00": "#5b8def",
          "project-01": "#5b8def",
          "absent-project": "#abcdef",
        };
        const mainSeed = await seed("defaults", {
          version: 20,
          ...existing,
          workspaceAccentColors: savedColors,
        });
        resetWrites();
        const main = configureMain(
          new DesktopAppStore({ userDataDir: mainSeed.dir, initialWorkspacePaths: [] }),
          catalog,
        );
        await main.initialize();
        const initialColors = main.workspaceAccentColors;
        const initialColorEntries = Object.entries(initialColors);
        assert.equal(initialColorEntries.length, 22);
        assert.equal(initialColors["project-00"], "#5b8def");
        assert.equal(initialColors["project-01"], "#5b8def");
        assert.equal(initialColors["absent-project"], "#abcdef");
        const generatedKeys = Object.keys(initialColors).filter(
          (key) => !retainedColorKeys.includes(key),
        );
        const generatedColors = generatedKeys.map((key) => initialColors[key]);
        assert.equal(new Set(generatedColors).size, generatedKeys.length);
        assert.equal(generatedColors.includes("#5b8def"), false);
        const initialProjection = (await main.getState()).sidebarAppearance;
        assert.ok(initialProjection);
        assert.equal(Object.keys(initialProjection.projectByWorkspaceId).length, 22);
        assert.deepEqual(initialProjection.projectByWorkspaceId["worktree-linked"], {
          projectId: "project-00",
          accentColor: "#5b8def",
        });
        assert.deepEqual(initialProjection.projectByWorkspaceId["orphan-worktree"], {
          projectId: "orphan-worktree",
          accentColor: initialColors["orphan-worktree"],
        });
        assert.deepEqual(initialProjection.activityIndicatorPreference, {
          style: "moonwalk",
          source: "provisional",
        });
        const initialSaved = JSON.parse(await readFile(mainSeed.path, "utf8"));
        same(initialSaved.workspaceAccentColors, initialColors);
        assert.equal(Object.hasOwn(initialSaved, "activityIndicatorPreference"), false);

        catalog.workspaces.reverse();
        catalog.worktrees.reverse();
        resetWrites();
        const reordered = await main.refreshState({
          refreshWorktrees: true,
          hydrateSelectedSession: false,
          markSelectedSessionViewed: false,
          persistState: false,
        });
        assert.equal(control.writes.length, 0);
        same(main.workspaceAccentColors, initialColors);
        same(reordered.sidebarAppearance, initialProjection);

        resetWrites();
        const linkedChanged = await main.setProjectAccentColor({
          workspaceId: "worktree-linked",
          color: "#ABC",
        });
        assert.equal(control.writes.length, 1);
        assert.equal(main.workspaceAccentColors["project-00"], "#aabbcc");
        assert.equal(main.workspaceAccentColors["project-01"], "#5b8def");
        assert.deepEqual(linkedChanged.sidebarAppearance.projectByWorkspaceId["project-00"], {
          projectId: "project-00",
          accentColor: "#aabbcc",
        });
        assert.deepEqual(linkedChanged.sidebarAppearance.projectByWorkspaceId["worktree-linked"], {
          projectId: "project-00",
          accentColor: "#aabbcc",
        });

        const beforeUnknown = await main.getState();
        resetWrites();
        await assert.rejects(
          main.setProjectAccentColor({ workspaceId: "missing-workspace", color: "#112233" }),
          /Unknown workspace/,
        );
        assert.equal(control.writes.length, 0);
        same((await main.getState()).sidebarAppearance, beforeUnknown.sidebarAppearance);

        resetWrites();
        await Promise.all([
          main.setProjectAccentColor({ workspaceId: "project-03", color: "#112233" }),
          main.setProjectAccentColor({ workspaceId: "project-03", color: "#445566" }),
        ]);
        assert.equal(control.writes.length, 2);
        assert.equal(control.writes[0].workspaceAccentColors["project-03"], "#112233");
        assert.equal(control.writes[1].workspaceAccentColors["project-03"], "#445566");
        assert.equal(main.workspaceAccentColors["project-03"], "#445566");

        resetWrites();
        const delayed = holdWrite(false);
        const delayedAccent = main.setProjectAccentColor({
          workspaceId: "project-04",
          color: "#778899",
        });
        await delayed.started;
        const beforeRelease = await main.getState();
        assert.equal(beforeRelease.sidebarAppearance.projectByWorkspaceId["project-04"].accentColor, initialColors["project-04"]);
        assert.equal(main.workspaceAccentColors["project-04"], initialColors["project-04"]);
        const queuedSort = main.setAllThreadsSort("created");
        queueEvents.push({ operation: "accent-write-held", queuedMutation: "setAllThreadsSort" });
        await delay(20);
        assert.equal(control.writes.length, 1);
        delayed.release();
        await Promise.all([delayedAccent, queuedSort]);
        const afterDelayed = await main.getState();
        assert.equal(afterDelayed.sidebarAppearance.projectByWorkspaceId["project-04"].accentColor, "#778899");
        assert.equal(afterDelayed.allThreadsSort, "created");
        const delayedSaved = JSON.parse(await readFile(mainSeed.path, "utf8"));
        assert.equal(delayedSaved.workspaceAccentColors["project-04"], "#778899");
        assert.equal(delayedSaved.allThreadsSort, "created");

        resetWrites();
        const failed = holdWrite(true);
        const failedAccent = main.setProjectAccentColor({
          workspaceId: "project-05",
          color: "#224466",
        });
        await failed.started;
        const unrelatedDuringFailure = main.setAllThreadsSort("title");
        queueEvents.push({ operation: "accent-write-denied", queuedMutation: "setAllThreadsSort" });
        failed.release();
        await assert.rejects(failedAccent, /synthetic ui-state write failure/);
        await unrelatedDuringFailure;
        const afterFailure = await main.getState();
        assert.equal(
          afterFailure.sidebarAppearance.projectByWorkspaceId["project-05"].accentColor,
          initialColors["project-05"],
        );
        assert.equal(afterFailure.allThreadsSort, "title");
        assert.equal(control.history.some((entry) => entry.denied), true);
        const failedSaved = JSON.parse(await readFile(mainSeed.path, "utf8"));
        assert.equal(failedSaved.workspaceAccentColors["project-05"], initialColors["project-05"]);
        assert.equal(failedSaved.allThreadsSort, "title");

        resetWrites();
        await main.setProjectAccentColor({ workspaceId: "project-05", color: "#224466" });
        assert.equal(main.workspaceAccentColors["project-05"], "#224466");
        assert.equal(control.writes.length, 1);

        resetWrites();
        const noLegacy = await main.migrateLegacyActivityIndicatorStyle("not-a-style");
        assert.equal(noLegacy.status, "no-legacy");
        assert.equal(control.writes.length, 0);
        assert.deepEqual(noLegacy.state.sidebarAppearance.activityIndicatorPreference, {
          style: "moonwalk",
          source: "provisional",
        });
        const migrated = await main.migrateLegacyActivityIndicatorStyle("wheel");
        assert.equal(migrated.status, "applied");
        assert.equal(control.writes.length, 1);
        assert.deepEqual(migrated.state.sidebarAppearance.activityIndicatorPreference, {
          style: "wheel",
          source: "legacy-migrated",
        });
        const userSelected = await main.setActivityIndicatorStyle("spiral");
        assert.deepEqual(userSelected.sidebarAppearance.activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });
        resetWrites();
        await assert.rejects(
          main.setActivityIndicatorStyle("not-a-style"),
          /Invalid activity indicator style/,
        );
        assert.equal(control.writes.length, 0);
        resetWrites();
        const existingLegacy = await main.migrateLegacyActivityIndicatorStyle("wheel");
        const existingMalformed = await main.migrateLegacyActivityIndicatorStyle({ invalid: true });
        assert.equal(existingLegacy.status, "already-set");
        assert.equal(existingMalformed.status, "already-set");
        assert.equal(control.writes.length, 0);
        const migrationSaved = JSON.parse(await readFile(mainSeed.path, "utf8"));
        assert.deepEqual(migrationSaved.activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });

        resetWrites();
        const restarted = configureMain(
          new DesktopAppStore({ userDataDir: mainSeed.dir, initialWorkspacePaths: [] }),
          catalog,
        );
        await restarted.initialize();
        assert.deepEqual((await restarted.getState()).sidebarAppearance.activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });

        const competingOneSeed = await seed("competing-one", {
          version: 20,
          ...existing,
        });
        const competingOne = configureMain(
          new DesktopAppStore({ userDataDir: competingOneSeed.dir, initialWorkspacePaths: [] }),
          simpleCatalog,
        );
        await competingOne.initialize();
        const migrationFirst = competingOne.migrateLegacyActivityIndicatorStyle("wheel");
        const userSecond = competingOne.setActivityIndicatorStyle("stick");
        const [migrationFirstResult, userSecondResult] = await Promise.all([
          migrationFirst,
          userSecond,
        ]);
        assert.equal(migrationFirstResult.status, "applied");
        assert.deepEqual(userSecondResult.sidebarAppearance.activityIndicatorPreference, {
          style: "stick",
          source: "user",
        });

        const competingTwoSeed = await seed("competing-two", {
          version: 20,
          ...existing,
        });
        const competingTwo = configureMain(
          new DesktopAppStore({ userDataDir: competingTwoSeed.dir, initialWorkspacePaths: [] }),
          simpleCatalog,
        );
        await competingTwo.initialize();
        const userFirst = competingTwo.setActivityIndicatorStyle("ball");
        const migrationSecond = competingTwo.migrateLegacyActivityIndicatorStyle("spiral");
        const [userFirstResult, migrationSecondResult] = await Promise.all([
          userFirst,
          migrationSecond,
        ]);
        assert.deepEqual(userFirstResult.sidebarAppearance.activityIndicatorPreference, {
          style: "ball",
          source: "user",
        });
        assert.equal(migrationSecondResult.status, "already-set");

        const migrationFailureSeed = await seed("migration-failure", {
          version: 20,
          ...existing,
        });
        const migrationFailure = configureMain(
          new DesktopAppStore({ userDataDir: migrationFailureSeed.dir, initialWorkspacePaths: [] }),
          simpleCatalog,
        );
        await migrationFailure.initialize();
        resetWrites();
        const migrationHold = holdWrite(true);
        const failedMigration = migrationFailure.migrateLegacyActivityIndicatorStyle("wave");
        await migrationHold.started;
        migrationHold.release();
        await assert.rejects(failedMigration, /synthetic ui-state write failure/);
        assert.equal((await migrationFailure.getState()).sidebarAppearance.activityIndicatorPreference.source, "provisional");
        const failedMigrationSaved = JSON.parse(await readFile(migrationFailureSeed.path, "utf8"));
        assert.equal(Object.hasOwn(failedMigrationSaved, "activityIndicatorPreference"), false);
        await migrationFailure.migrateLegacyActivityIndicatorStyle("wave");
        assert.deepEqual((await migrationFailure.getState()).sidebarAppearance.activityIndicatorPreference, {
          style: "wave",
          source: "legacy-migrated",
        });

        const emptySeed = await seed("empty", { version: 20 });
        resetWrites();
        const empty = configureMain(
          new DesktopAppStore({ userDataDir: emptySeed.dir, initialWorkspacePaths: [] }),
          { workspaces: [], worktrees: [], sessions: [] },
        );
        await empty.initialize();
        const emptyState = await empty.getState();
        assert.deepEqual(emptyState.sidebarAppearance, {
          projectByWorkspaceId: {},
          activityIndicatorPreference: { style: "moonwalk", source: "provisional" },
        });
        assert.equal(Object.keys(empty.workspaceAccentColors).length, 0);
        const emptySaved = JSON.parse(await readFile(emptySeed.path, "utf8"));
        assert.equal(Object.hasOwn(emptySaved, "workspaceAccentColors"), false);

        const proof = {
          defaultsAndProjection: true,
          generatedCount: generatedKeys.length,
          savedAbsentProjectRetained: Object.hasOwn(initialColors, "absent-project"),
          savedDuplicateRetained:
            initialColors["project-00"] === initialColors["project-01"],
          linkedWorktreeInheritsRoot:
            initialProjection.projectByWorkspaceId["worktree-linked"].projectId === "project-00",
          orphanUsesOwnStableOwner:
            initialProjection.projectByWorkspaceId["orphan-worktree"].projectId ===
            "orphan-worktree",
          reorderStable: true,
          sameOwnerLastWins: main.workspaceAccentColors["project-03"] === "#445566",
          delayedMutationPreservedUnrelatedState: afterDelayed.allThreadsSort === "created",
          failedMutationPreservedPriorAppearance:
            afterFailure.sidebarAppearance.projectByWorkspaceId["project-05"].accentColor ===
            initialColors["project-05"],
          failedMutationPreservedUnrelatedState: afterFailure.allThreadsSort === "title",
          retryApplied: main.workspaceAccentColors["project-05"] === "#224466",
          invalidMigrationNoLegacy: noLegacy.status === "no-legacy",
          validMigrationApplied: migrated.status === "applied",
          explicitUserWinsMigration: migrationSaved.activityIndicatorPreference.source === "user",
          malformedWithDurableAlreadySet: existingMalformed.status === "already-set",
          competingMigrationThenUser:
            migrationFirstResult.status === "applied" &&
            userSecondResult.sidebarAppearance.activityIndicatorPreference.style === "stick",
          competingUserThenMigration:
            migrationSecondResult.status === "already-set" &&
            userFirstResult.sidebarAppearance.activityIndicatorPreference.style === "ball",
          migrationFailureRetainedAbsence: true,
          migrationRetryApplied: true,
          zeroScaleEmptyProjection: true,
          restartPreservedUserActivity: true,
          queueEvents,
          writeHistory: control.history.map((entry) => ({
            denied: entry.denied,
            allThreadsSort: entry.payload.allThreadsSort,
            projectColors: entry.payload.workspaceAccentColors,
            activityIndicatorPreference: entry.payload.activityIndicatorPreference,
          })),
        };
        if (proof.generatedCount !== 19) {
          throw new Error("Expected 19 generated project colours");
        }
        const evidenceDir = process.env.PI_D08_STAGE3_EVIDENCE_DIR;
        if (evidenceDir) {
          await mkdir(evidenceDir, { recursive: true });
          await writeFile(join(evidenceDir, "proof.json"), JSON.stringify(proof, null, 2) + "\\n");
          await writeFile(join(evidenceDir, "queue-events.json"), JSON.stringify(queueEvents, null, 2) + "\\n");
          await writeFile(join(evidenceDir, "defaults.json"), JSON.stringify({
            savedColors,
            committedColors: initialColors,
            projectByWorkspaceId: initialProjection.projectByWorkspaceId,
          }, null, 2) + "\\n");
          await writeFile(join(evidenceDir, "migrations.json"), JSON.stringify({
            invalid: noLegacy.status,
            valid: migrated.status,
            existingValid: existingLegacy.status,
            existingMalformed: existingMalformed.status,
            migrationFirst: migrationFirstResult.status,
            userFirst: migrationSecondResult.status,
          }, null, 2) + "\\n");
          const retainProfile = async (name, dir) => {
            const destination = join(evidenceDir, "profiles", name);
            await mkdir(destination, { recursive: true });
            for (const file of await readdir(dir)) {
              if (file === "ui-state.json" || file.endsWith(".bak") || file.includes(".pre-workbench-")) {
                await copyFile(join(dir, file), join(destination, file));
              }
            }
          };
          await retainProfile("main", mainSeed.dir);
          await retainProfile("competing-one", competingOneSeed.dir);
          await retainProfile("competing-two", competingTwoSeed.dir);
          await retainProfile("migration-failure", migrationFailureSeed.dir);
          await retainProfile("empty", emptySeed.dir);
        }
        console.log(JSON.stringify(proof));
        process.exit(0);
      `,
      resolveDir: root,
      loader: "js",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
    tsconfig: join(root, "apps/desktop/tsconfig.electron.json"),
    alias: Object.fromEntries(
      Object.entries(aliases).map(([name, target]) => [name, join(root, target)]),
    ),
    plugins: [
      {
        name: "control-stage3-appearance-writes",
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "d08-native-block",
          }));
          builder.onLoad({ filter: /.*/, namespace: "d08-native-block" }, () => ({
            contents:
              'export const nativeImage = new Proxy({}, { get() { throw new Error("Unexpected native image access in Stage 3 test"); } });',
            loader: "js",
          }));
          builder.onLoad({ filter: /app-store-persistence\.ts$/ }, async ({ path }) => {
            const source = await readFile(path, "utf8");
            if (!source.includes(persistenceWriteStart)) {
              throw new Error("Expected actual ui-state write entry point");
            }
            return {
              contents: source.replace(
                persistenceWriteStart,
                `  const serializedWrite = JSON.parse(serialized);
  const writeControl = globalThis[Symbol.for(${JSON.stringify(writeControlSymbol)})];
  const entry = {
    denied: Boolean(writeControl?.denyNext),
    payload: serializedWrite,
  };
  writeControl?.writes.push(serializedWrite);
  writeControl?.history.push(entry);
  if (writeControl?.holdNext) {
    const release = writeControl.holdNext;
    const started = writeControl.holdStarted;
    writeControl.holdNext = null;
    writeControl.holdStarted = null;
    started?.();
    await release;
  }
  if (writeControl?.denyNext) {
    writeControl.denyNext = false;
    throw new Error("synthetic ui-state write failure");
  }
${persistenceWriteStart}`,
              ),
              loader: "ts",
            };
          });
        },
      },
    ],
  });

  const result = await execFileAsync(process.execPath, [output], {
    maxBuffer: 24 * 1024 * 1024,
  });
  const proof = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
    defaultsAndProjection?: boolean;
    generatedCount?: number;
    savedAbsentProjectRetained?: boolean;
    savedDuplicateRetained?: boolean;
    linkedWorktreeInheritsRoot?: boolean;
    orphanUsesOwnStableOwner?: boolean;
    reorderStable?: boolean;
    sameOwnerLastWins?: boolean;
    delayedMutationPreservedUnrelatedState?: boolean;
    failedMutationPreservedPriorAppearance?: boolean;
    failedMutationPreservedUnrelatedState?: boolean;
    retryApplied?: boolean;
    invalidMigrationNoLegacy?: boolean;
    validMigrationApplied?: boolean;
    explicitUserWinsMigration?: boolean;
    malformedWithDurableAlreadySet?: boolean;
    competingMigrationThenUser?: boolean;
    competingUserThenMigration?: boolean;
    migrationFailureRetainedAbsence?: boolean;
    migrationRetryApplied?: boolean;
    zeroScaleEmptyProjection?: boolean;
    restartPreservedUserActivity?: boolean;
  };
  expect(proof).toMatchObject({
    defaultsAndProjection: true,
    generatedCount: 19,
    savedAbsentProjectRetained: true,
    savedDuplicateRetained: true,
    linkedWorktreeInheritsRoot: true,
    orphanUsesOwnStableOwner: true,
    reorderStable: true,
    sameOwnerLastWins: true,
    delayedMutationPreservedUnrelatedState: true,
    failedMutationPreservedPriorAppearance: true,
    failedMutationPreservedUnrelatedState: true,
    retryApplied: true,
    invalidMigrationNoLegacy: true,
    validMigrationApplied: true,
    explicitUserWinsMigration: true,
    malformedWithDurableAlreadySet: true,
    competingMigrationThenUser: true,
    competingUserThenMigration: true,
    migrationFailureRetainedAbsence: true,
    migrationRetryApplied: true,
    zeroScaleEmptyProjection: true,
    restartPreservedUserActivity: true,
  });
  await testInfo.attach("stage3-actual-main", {
    body: result.stdout,
    contentType: "application/json",
  });
});
