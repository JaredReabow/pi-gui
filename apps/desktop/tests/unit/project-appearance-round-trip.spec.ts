import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("verifies Stage 2 appearance retention across independent Main round trips", async ({}, testInfo) => {
  const root = resolve(__dirname, "../../../..");
  const output = testInfo.outputPath("stage2-appearance-verifier.mjs");
  const writeControlSymbol = "v10-d08-d2-stage2-write-control";
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
        import {
          decodePersistedUiState,
        } from ${JSON.stringify(join(root, "apps/desktop/electron/persistence/app-store-persistence.ts"))};
        import {
          projectIdentity_maxAccentEntries,
          projectIdentity_maxWorkspaceIdLength,
        } from ${JSON.stringify(join(root, "apps/desktop/contracts/project-identity.ts"))};

        const control = { writes: [], history: [], audit: [], deny: false };
        globalThis[Symbol.for(${JSON.stringify(writeControlSymbol)})] = control;
        const same = (left, right) => assert.deepEqual(JSON.parse(JSON.stringify(left)), right);
        const exactColors = Object.freeze({
          "present-root": "#123456",
          "linked-worktree-owner": "#123456",
          "absent-project": "#abcdef",
        });
        const userActivity = Object.freeze({ style: "spiral", source: "user" });
        const legacyActivity = Object.freeze({ style: "wheel", source: "legacy-migrated" });
        const existing = Object.freeze({
          selectedWorkspaceId: "present-root",
          selectedSessionId: "session",
          activeView: "threads",
          composerDraft: "retained draft",
          composerDraftsBySession: { "present-root:session": "retained draft" },
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
        });
        const workspaceCatalog = Object.freeze({
          workspaces: [
            {
              workspaceId: "present-root",
              path: ${JSON.stringify(testInfo.outputPath("profiles/present-root"))},
              displayName: "Present root",
              lastOpenedAt: "2026-10-31T00:00:00Z",
              sortOrder: 0,
            },
          ],
        });
        const sessionCatalog = Object.freeze({
          sessions: [
            {
              sessionRef: { workspaceId: "present-root", sessionId: "session" },
              workspaceId: "present-root",
              title: "Retained session",
              updatedAt: "2026-10-31T00:00:00Z",
              status: "idle",
            },
          ],
        });
        const writeJson = async (path, value) => {
          await mkdir(dirname(path), { recursive: true });
          const bytes = JSON.stringify(value, null, 2) + "\\n";
          await writeFile(path, bytes);
          return bytes;
        };
        const seed = async (name, value) => {
          const dir = ${JSON.stringify(testInfo.outputPath("profiles"))} + "/" + name;
          const path = join(dir, "ui-state.json");
          return { dir, path, initialBytes: await writeJson(path, value) };
        };
        const seedRaw = async (name, bytes) => {
          const dir = ${JSON.stringify(testInfo.outputPath("profiles"))} + "/" + name;
          const path = join(dir, "ui-state.json");
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, bytes);
          return { dir, path, initialBytes: bytes };
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
        const resetWrites = () => {
          control.writes.length = 0;
          control.history.length = 0;
          control.deny = false;
        };
        const assertWriteRetains = (writes, colors, activity) => {
          assert.ok(writes.length > 0);
          for (const write of writes) {
            same(write.workspaceAccentColors, colors);
            same(write.activityIndicatorPreference, activity);
          }
        };
        const assertExistingFields = (saved) => {
          assert.equal(saved.composerDraft, existing.composerDraft);
          same(saved.composerDraftsBySession, existing.composerDraftsBySession);
          same(saved.pinnedSessionOrder, existing.pinnedSessionOrder);
          same(saved.workspaceOrder, existing.workspaceOrder);
          same(saved.folderPreferencesByWorkspace, existing.folderPreferencesByWorkspace);
          same(saved.notificationPreferences, { ...existing.notificationPreferences, chimeEnabled: true, chimeSound: 'typewriter-return', chimeVolume: 60 });
          same(saved.initiatingOriginBySession, existing.initiatingOriginBySession);
          same(saved.createdAtBySession, existing.createdAtBySession);
          assert.equal(saved.themeMode, existing.themeMode);
        };
        const retainProfile = async (evidenceRoot, name, dir) => {
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

        let getterCalls = 0;
        const rootAccessor = { version: 20 };
        Object.defineProperty(rootAccessor, "workspaceAccentColors", {
          enumerable: true,
          get() {
            getterCalls += 1;
            return { project: "#123456" };
          },
        });
        assert.throws(() => decodePersistedUiState(rootAccessor), /data property/);
        assert.equal(getterCalls, 0);

        const inheritedRoot = Object.create({
          version: 20,
          workspaceAccentColors: { project: "#123456" },
        });
        assert.throws(() => decodePersistedUiState(inheritedRoot), /plain object/);

        const accentAccessor = {};
        Object.defineProperty(accentAccessor, "project", {
          enumerable: true,
          get() {
            getterCalls += 1;
            return "#123456";
          },
        });
        assert.throws(
          () =>
            decodePersistedUiState({
              version: 20,
              workspaceAccentColors: accentAccessor,
            }),
          /Invalid ui-state/,
        );
        assert.equal(getterCalls, 0);

        const activityAccessor = { source: "user" };
        Object.defineProperty(activityAccessor, "style", {
          enumerable: true,
          get() {
            getterCalls += 1;
            return "spiral";
          },
        });
        assert.throws(
          () =>
            decodePersistedUiState({
              version: 20,
              activityIndicatorPreference: activityAccessor,
            }),
          /Invalid ui-state/,
        );
        assert.equal(getterCalls, 0);

        const atEntryLimit = Object.fromEntries(
          Array.from({ length: projectIdentity_maxAccentEntries }, (_, index) => [
            "project-" + index,
            "#123456",
          ]),
        );
        assert.equal(
          Object.keys(
            decodePersistedUiState({
              version: 20,
              workspaceAccentColors: atEntryLimit,
            }).workspaceAccentColors,
          ).length,
          projectIdentity_maxAccentEntries,
        );
        assert.throws(
          () =>
            decodePersistedUiState({
              version: 20,
              workspaceAccentColors: { ...atEntryLimit, overflow: "#abcdef" },
            }),
          /Invalid ui-state/,
        );

        const maximumId = "p".repeat(projectIdentity_maxWorkspaceIdLength);
        same(
          decodePersistedUiState({
            version: 20,
            workspaceAccentColors: { [maximumId]: "#ABCDEF" },
          }).workspaceAccentColors,
          { [maximumId]: "#abcdef" },
        );
        assert.throws(
          () =>
            decodePersistedUiState({
              version: 20,
              workspaceAccentColors: { [maximumId + "p"]: "#abcdef" },
            }),
          /Invalid ui-state/,
        );

        const prototypeNamedMap = JSON.parse(
          '{"version":20,"workspaceAccentColors":{"__proto__":"#abcdef","present-root":"#123456"}}',
        );
        const prototypeDecoded = decodePersistedUiState(prototypeNamedMap).workspaceAccentColors;
        assert.equal(Object.getPrototypeOf(prototypeDecoded), null);
        assert.equal(Object.hasOwn(prototypeDecoded, "__proto__"), true);

        const userSeed = await seed("user-retention", {
          version: 20,
          ...existing,
          workspaceAccentColors: exactColors,
          activityIndicatorPreference: userActivity,
        });
        resetWrites();
        const userMain = configureMain(
          new DesktopAppStore({
            userDataDir: userSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        userMain.schedulePersistUiState();
        await delay(320);
        assert.equal(control.writes.length, 0);
        assert.equal(await readFile(userSeed.path, "utf8"), userSeed.initialBytes);

        await userMain.initialize();
        assertWriteRetains(control.writes, exactColors, userActivity);
        same(userMain.workspaceAccentColors, exactColors);
        same(userMain.activityIndicatorPreference, userActivity);

        resetWrites();
        await userMain.setAllThreadsSort("created");
        const userMutationWrite = control.writes.find((write) => write.allThreadsSort === "created");
        assert.ok(userMutationWrite);
        assert.equal(userMutationWrite.version, 20);
        assertWriteRetains(control.writes, exactColors, userActivity);
        const userSavedBytes = await readFile(userSeed.path, "utf8");
        const userSaved = JSON.parse(userSavedBytes);
        same(userSaved.workspaceAccentColors, exactColors);
        same(userSaved.activityIndicatorPreference, userActivity);
        same(userSaved.workspaceAccentColors, userMutationWrite.workspaceAccentColors);
        same(userSaved.activityIndicatorPreference, userMutationWrite.activityIndicatorPreference);
        assert.equal(userSaved.allThreadsSort, "created");
        assertExistingFields(userSaved);

        resetWrites();
        const userReload = configureMain(
          new DesktopAppStore({
            userDataDir: userSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await userReload.initialize();
        assertWriteRetains(control.writes, exactColors, userActivity);
        same(userReload.workspaceAccentColors, exactColors);
        same(userReload.activityIndicatorPreference, userActivity);

        const legacySeed = await seed("legacy-retention", {
          version: 20,
          ...existing,
          workspaceAccentColors: exactColors,
          activityIndicatorPreference: legacyActivity,
        });
        resetWrites();
        const legacyMain = configureMain(
          new DesktopAppStore({
            userDataDir: legacySeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await legacyMain.initialize();
        resetWrites();
        await legacyMain.setAllThreadsSort("title");
        assertWriteRetains(control.writes, exactColors, legacyActivity);
        const legacySaved = JSON.parse(await readFile(legacySeed.path, "utf8"));
        same(legacySaved.workspaceAccentColors, exactColors);
        same(legacySaved.activityIndicatorPreference, legacyActivity);
        assert.equal(legacySaved.allThreadsSort, "title");
        resetWrites();
        const legacyReload = configureMain(
          new DesktopAppStore({
            userDataDir: legacySeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await legacyReload.initialize();
        assertWriteRetains(control.writes, exactColors, legacyActivity);
        same(legacyReload.workspaceAccentColors, exactColors);
        same(legacyReload.activityIndicatorPreference, legacyActivity);

        const absentSeed = await seed("durable-absence", {
          version: 20,
          ...existing,
          workspaceAccentColors: exactColors,
        });
        resetWrites();
        const absentMain = configureMain(
          new DesktopAppStore({
            userDataDir: absentSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await absentMain.initialize();
        resetWrites();
        await absentMain.setAllThreadsSort("unread-first");
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          assert.equal(write.activityIndicatorPreference, undefined);
        }
        const absentSaved = JSON.parse(await readFile(absentSeed.path, "utf8"));
        same(absentSaved.workspaceAccentColors, exactColors);
        assert.equal(Object.hasOwn(absentSaved, "activityIndicatorPreference"), false);
        assert.equal(absentSaved.allThreadsSort, "unread-first");
        resetWrites();
        const absentReload = configureMain(
          new DesktopAppStore({
            userDataDir: absentSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await absentReload.initialize();
        for (const write of control.writes) {
          same(write.workspaceAccentColors, exactColors);
          assert.equal(write.activityIndicatorPreference, undefined);
        }
        same(absentReload.workspaceAccentColors, exactColors);
        assert.equal(absentReload.activityIndicatorPreference, undefined);

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
        const migratedColor = v19Saved.workspaceAccentColors["present-root"];
        assert.ok(
          ["#5b8def", "#18a999", "#43a047", "#e0a100", "#e8752f", "#d84f72", "#8c6bd8", "#6d7f96"].includes(
            migratedColor
          )
        );
        assert.equal(v19Main.workspaceAccentColors["present-root"], migratedColor);
        assert.equal(Object.hasOwn(v19Saved, "activityIndicatorPreference"), false);
        const migrationCopies = (await readdir(v19Seed.dir)).filter((name) =>
          name.startsWith("ui-state.pre-workbench-v19."),
        );
        assert.equal(migrationCopies.length, 1);
        assert.equal(
          await readFile(join(v19Seed.dir, migrationCopies[0]), "utf8"),
          v19Seed.initialBytes,
        );

        const prototypeSeed = await seed("prototype-named-project", {
          version: 20,
          ...existing,
          workspaceAccentColors: Object.fromEntries([
            ["__proto__", "#abcdef"],
            ["present-root", "#123456"],
          ]),
          activityIndicatorPreference: userActivity,
        });
        resetWrites();
        const prototypeMain = configureMain(
          new DesktopAppStore({
            userDataDir: prototypeSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await prototypeMain.initialize();
        assert.equal(Object.getPrototypeOf(prototypeMain.workspaceAccentColors), null);
        assert.equal(Object.hasOwn(prototypeMain.workspaceAccentColors, "__proto__"), true);
        resetWrites();
        await prototypeMain.setAllThreadsSort("latest-human-input");
        const prototypeSaved = JSON.parse(await readFile(prototypeSeed.path, "utf8"));
        assert.equal(Object.hasOwn(prototypeSaved.workspaceAccentColors, "__proto__"), true);
        assert.equal(prototypeSaved.workspaceAccentColors.__proto__, "#abcdef");
        resetWrites();
        const prototypeReload = configureMain(
          new DesktopAppStore({
            userDataDir: prototypeSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await prototypeReload.initialize();
        assert.equal(Object.getPrototypeOf(prototypeReload.workspaceAccentColors), null);
        assert.equal(Object.hasOwn(prototypeReload.workspaceAccentColors, "__proto__"), true);

        const invalidActivitySeed = await seed("invalid-activity", {
          version: 20,
          workspaceAccentColors: exactColors,
          activityIndicatorPreference: { style: "spiral", source: "provisional" },
        });
        resetWrites();
        const invalidActivity = configureMain(
          new DesktopAppStore({
            userDataDir: invalidActivitySeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await invalidActivity.initialize();
        assert.equal(invalidActivity.persistenceReadiness, "blocked");
        assert.ok((await invalidActivity.getState()).startupDiagnostics.length > 0);
        await invalidActivity.persistUiState();
        invalidActivity.schedulePersistUiState();
        await delay(320);
        assert.equal(control.writes.length, 0);
        assert.equal(await readFile(invalidActivitySeed.path, "utf8"), invalidActivitySeed.initialBytes);

        const corruptJsonSeed = await seedRaw(
          "corrupt-json",
          '{"version":20,"workspaceAccentColors":{"present-root":"#123456"}',
        );
        resetWrites();
        const corruptJson = configureMain(
          new DesktopAppStore({
            userDataDir: corruptJsonSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await corruptJson.initialize();
        assert.equal(corruptJson.persistenceReadiness, "blocked");
        await corruptJson.persistUiState();
        corruptJson.schedulePersistUiState();
        await delay(320);
        assert.equal(control.writes.length, 0);
        assert.equal(await readFile(corruptJsonSeed.path, "utf8"), corruptJsonSeed.initialBytes);

        const overBoundColors = Object.fromEntries(
          Array.from({ length: projectIdentity_maxAccentEntries + 1 }, (_, index) => [
            "project-" + index,
            "#123456",
          ]),
        );
        const overBoundSeed = await seed("over-bound-colors", {
          version: 20,
          workspaceAccentColors: overBoundColors,
          activityIndicatorPreference: userActivity,
        });
        resetWrites();
        const overBound = configureMain(
          new DesktopAppStore({
            userDataDir: overBoundSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await overBound.initialize();
        assert.equal(overBound.persistenceReadiness, "blocked");
        await overBound.persistUiState();
        await delay(20);
        assert.equal(control.writes.length, 0);
        assert.equal(await readFile(overBoundSeed.path, "utf8"), overBoundSeed.initialBytes);

        const failedWriteSeed = await seed("failed-save", {
          version: 20,
          ...existing,
          workspaceAccentColors: exactColors,
          activityIndicatorPreference: userActivity,
        });
        resetWrites();
        const failedWrite = configureMain(
          new DesktopAppStore({
            userDataDir: failedWriteSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await failedWrite.initialize();
        resetWrites();
        const priorBytes = await readFile(failedWriteSeed.path, "utf8");
        const priorBackupBytes = await readFile(failedWriteSeed.path + ".bak", "utf8");
        control.deny = true;
        await assert.rejects(
          failedWrite.setAllThreadsSort("title"),
          /synthetic Stage 2 save failure/,
        );
        control.deny = false;
        assert.equal(control.history.at(-1).denied, true);
        assert.equal(await readFile(failedWriteSeed.path, "utf8"), priorBytes);
        assert.equal(await readFile(failedWriteSeed.path + ".bak", "utf8"), priorBackupBytes);
        same(failedWrite.workspaceAccentColors, exactColors);
        same(failedWrite.activityIndicatorPreference, userActivity);

        resetWrites();
        const failedWriteReload = configureMain(
          new DesktopAppStore({
            userDataDir: failedWriteSeed.dir,
            initialWorkspacePaths: [],
          }),
        );
        await failedWriteReload.initialize();
        assertWriteRetains(control.writes, exactColors, userActivity);
        same(failedWriteReload.workspaceAccentColors, exactColors);
        same(failedWriteReload.activityIndicatorPreference, userActivity);

        const proof = {
          schemaVersion: 1,
          actualMain: true,
          noWriteBeforeRetention: true,
          unrelatedMutation: "setAllThreadsSort",
          mutableOperation: "full persistUiState payload",
          exactColors,
          userActivity,
          legacyActivity,
          durableAbsence: true,
          v19MigrationBackup: migrationCopies[0],
          v19Stage3DefaultAssigned: true,
          prototypeNamedKeyAcceptedSafely: true,
          directDecoderRejections: {
            rootAccessor: true,
            inheritedRoot: true,
            accentAccessor: true,
            activityAccessor: true,
            entryOverflow: true,
            idOverflow: true,
            getterCalls,
          },
          invalidActivityBlocked: true,
          corruptJsonBlocked: true,
          boundsBlocked: true,
          failedWritePreservedPrior: true,
          laterProjectionApiUsed: false,
          writeCount: control.audit.length,
          writeOrder: control.audit.map((entry) => ({
            denied: entry.denied,
            version: entry.payload.version,
            allThreadsSort: entry.payload.allThreadsSort,
            accentKeys: Object.keys(entry.payload.workspaceAccentColors ?? {}),
            activityIndicatorPreference: entry.payload.activityIndicatorPreference,
          })),
          savedUser: userSaved,
          savedAbsence: absentSaved,
        };
        const evidenceDir = process.env.PI_V10_D08_D2_STAGE2_EVIDENCE_DIR;
        if (evidenceDir) {
          const evidenceRoot = join(evidenceDir, "profiles");
          await mkdir(evidenceRoot, { recursive: true });
          await writeFile(join(evidenceDir, "proof.json"), JSON.stringify(proof, null, 2) + "\\n");
          await writeFile(
            join(evidenceDir, "write-order.json"),
            JSON.stringify(proof.writeOrder, null, 2) + "\\n",
          );
          await retainProfile(evidenceRoot, "user-retention", userSeed.dir);
          await retainProfile(evidenceRoot, "legacy-retention", legacySeed.dir);
          await retainProfile(evidenceRoot, "durable-absence", absentSeed.dir);
          await retainProfile(evidenceRoot, "v19-migration", v19Seed.dir);
          await retainProfile(evidenceRoot, "prototype-named-project", prototypeSeed.dir);
          await retainProfile(evidenceRoot, "invalid-activity", invalidActivitySeed.dir);
          await retainProfile(evidenceRoot, "corrupt-json", corruptJsonSeed.dir);
          await retainProfile(evidenceRoot, "over-bound-colors", overBoundSeed.dir);
          await retainProfile(evidenceRoot, "failed-save", failedWriteSeed.dir);
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
        name: "observe-and-fail-stage2-main-saves",
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "v10-d08-native-block",
          }));
          builder.onLoad({ filter: /.*/, namespace: "v10-d08-native-block" }, () => ({
            contents:
              'export const nativeImage = new Proxy({}, { get() { throw new Error("Unexpected native image access in Stage 2 verifier"); } });',
            loader: "js",
          }));
          builder.onLoad({ filter: /app-store-persistence\.ts$/ }, async ({ path }) => {
            if (!path.endsWith("/apps/desktop/electron/persistence/app-store-persistence.ts")) {
              return undefined;
            }
            const source = await readFile(path, "utf8");
            if (!source.includes(persistenceWriteStart)) {
              throw new Error("Expected actual persistence pre-atomic-write call");
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
  writeControl?.audit.push({
    denied: Boolean(writeControl?.deny),
    payload: serializedWrite,
  });
  if (writeControl?.deny) throw new Error("synthetic Stage 2 save failure");
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
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  const proof = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
    readonly actualMain?: boolean;
    readonly noWriteBeforeRetention?: boolean;
    readonly exactColors?: Readonly<Record<string, string>>;
    readonly userActivity?: { readonly style: string; readonly source: string };
    readonly legacyActivity?: { readonly style: string; readonly source: string };
    readonly durableAbsence?: boolean;
    readonly v19MigrationBackup?: string;
    readonly v19Stage3DefaultAssigned?: boolean;
    readonly prototypeNamedKeyAcceptedSafely?: boolean;
    readonly directDecoderRejections?: {
      readonly rootAccessor: boolean;
      readonly inheritedRoot: boolean;
      readonly accentAccessor: boolean;
      readonly activityAccessor: boolean;
      readonly entryOverflow: boolean;
      readonly idOverflow: boolean;
      readonly getterCalls: number;
    };
    readonly invalidActivityBlocked?: boolean;
    readonly corruptJsonBlocked?: boolean;
    readonly boundsBlocked?: boolean;
    readonly failedWritePreservedPrior?: boolean;
    readonly laterProjectionApiUsed?: boolean;
    readonly writeOrder?: readonly {
      readonly denied: boolean;
      readonly version: number;
      readonly allThreadsSort?: string;
    }[];
  };

  expect(proof).toMatchObject({
    actualMain: true,
    noWriteBeforeRetention: true,
    unrelatedMutation: "setAllThreadsSort",
    mutableOperation: "full persistUiState payload",
    exactColors: {
      "present-root": "#123456",
      "linked-worktree-owner": "#123456",
      "absent-project": "#abcdef",
    },
    userActivity: { style: "spiral", source: "user" },
    legacyActivity: { style: "wheel", source: "legacy-migrated" },
    durableAbsence: true,
    v19Stage3DefaultAssigned: true,
    prototypeNamedKeyAcceptedSafely: true,
    directDecoderRejections: {
      rootAccessor: true,
      inheritedRoot: true,
      accentAccessor: true,
      activityAccessor: true,
      entryOverflow: true,
      idOverflow: true,
      getterCalls: 0,
    },
    invalidActivityBlocked: true,
    corruptJsonBlocked: true,
    boundsBlocked: true,
    failedWritePreservedPrior: true,
    laterProjectionApiUsed: false,
  });
  expect(proof.v19MigrationBackup).toMatch(/^ui-state\.pre-workbench-v19\..+\.json$/);
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

  await testInfo.attach("stage2-appearance-proof", {
    body: result.stdout,
    contentType: "application/json",
  });
});

test("independently verifies Stage 3 appearance ownership and failure isolation", async ({}, testInfo) => {
  const root = resolve(__dirname, "../../../..");
  const targetRoot = join(root, "artifacts/distribution/D08-D.2-STAGE3");
  const evidenceDir = process.env.PI_V10_D08_D2_STAGE3_INDEPENDENT_EVIDENCE_DIR;
  const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  const expectedTargetHashes = {
    "README.md": "525c54e3177aebc97bbda29f19914138f885176af8cf90a9e925dfc246a20898",
    "EVIDENCE.md": "ef3daa2be6c5715647c86b450d71a9dd80b7445515f173389da30bcc3228400a",
    "manifest.json": "0760fb04988798cca970bcbce6f9e61dc40251a44db086aeafe6dbb91d49a8de",
    SHA256SUMS: "c9821fb9d91a2487fa28437e2f6edfd8e2de258cfaf4d46df0b736fa08e4fc3d",
    "RESULTS.json": "3b8728c5047ba4851501a47da27d31e1bcab4d0d3045da6a8ca589d4c25a5350",
  };

  for (const [name, expected] of Object.entries(expectedTargetHashes)) {
    expect(digest(await readFile(join(targetRoot, name))), name).toBe(expected);
  }

  const targetManifest = JSON.parse(await readFile(join(targetRoot, "manifest.json"), "utf8")) as {
    readonly files: readonly unknown[];
    readonly self_accepted: boolean;
  };
  const ownership = JSON.parse(await readFile(join(targetRoot, "OWNERSHIP.json"), "utf8")) as {
    readonly workspace_record_changed: boolean;
    readonly contracts_changed: boolean;
    readonly persistence_decoder_changed: boolean;
    readonly ipc_or_preload_changed: boolean;
    readonly app_renderer_or_settings_changed: boolean;
    readonly local_storage_renderer_read_added: boolean;
    readonly peer_paths_reverted_or_modified: boolean;
  };
  const patch = await readFile(join(targetRoot, "PATCH.diff"), "utf8");
  const patchPaths = patch
    .split("\n")
    .filter((line) => line.startsWith("+++ "))
    .map((line) => line.slice(4).split("\t", 1)[0])
    .filter((path) => path.includes("/after/"))
    .map((path) => path.slice(path.indexOf("/after/") + "/after/".length))
    .sort();
  expect(targetManifest.files).toHaveLength(49);
  expect(targetManifest.self_accepted).toBe(false);
  expect(patchPaths).toEqual([
    "apps/desktop/electron/application/app-store.ts",
    "apps/desktop/tests/unit/project-persistence.spec.ts",
  ]);
  expect(patch).not.toMatch(
    /^diff -ruN .*\/(?:contracts|ipc|preload|src\/features|settings|persistence)\//m,
  );
  expect(ownership).toMatchObject({
    workspace_record_changed: false,
    contracts_changed: false,
    persistence_decoder_changed: false,
    ipc_or_preload_changed: false,
    app_renderer_or_settings_changed: false,
    local_storage_renderer_read_added: false,
    peer_paths_reverted_or_modified: false,
  });

  const desktopStateSource = await readFile(
    join(root, "apps/desktop/contracts/desktop-state.ts"),
    "utf8",
  );
  const workspaceRecordBody = /export interface WorkspaceRecord \{([\s\S]*?)\n\}/.exec(
    desktopStateSource,
  )?.[1];
  expect(workspaceRecordBody).toBeTruthy();
  expect(workspaceRecordBody).not.toMatch(
    /workspaceAccentColors|activityIndicatorPreference|sidebarAppearance/,
  );

  const staticProof = {
    schemaVersion: 1,
    frozenTargetHashes: expectedTargetHashes,
    manifestFiles: targetManifest.files.length,
    patchPaths,
    workspaceRecordFreeOfAppearance: true,
    contractsChanged: false,
    persistenceDecoderChanged: false,
    ipcOrPreloadChanged: false,
    rendererOrSettingsChanged: false,
    rendererLocalStorageAdded: false,
  };
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      join(evidenceDir, "static-boundary.json"),
      `${JSON.stringify(staticProof, null, 2)}\n`,
    );
  }

  const output = testInfo.outputPath("stage3-independent-appearance-verifier.mjs");
  const writeControlSymbol = "v10-d08-d2-stage3-independent-write-control";
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
        import { createHash } from "node:crypto";
        import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { setTimeout as delay } from "node:timers/promises";
        import { DesktopAppStore } from ${JSON.stringify(join(root, "apps/desktop/electron/application/app-store.ts"))};

        const deferred = () => {
          let resolve;
          const promise = new Promise((done) => {
            resolve = done;
          });
          return { promise, resolve };
        };
        const control = {
          writes: [],
          history: [],
          audit: [],
          hold: null,
        };
        globalThis[Symbol.for(${JSON.stringify(writeControlSymbol)})] = control;

        const clean = (value) => JSON.parse(JSON.stringify(value));
        const same = (left, right) => assert.deepEqual(clean(left), clean(right));
        const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
        const resetWrites = () => {
          control.writes.length = 0;
          control.history.length = 0;
          control.hold = null;
        };
        const holdWrite = (deny = false) => {
          const gate = deferred();
          const started = deferred();
          control.hold = { deny, gate: gate.promise, started: started.resolve };
          return { release: gate.resolve, started: started.promise };
        };
        const writeJson = async (path, value) => {
          await mkdir(dirname(path), { recursive: true });
          const bytes = JSON.stringify(value, null, 2) + "\\n";
          await writeFile(path, bytes);
          return bytes;
        };
        const seed = async (name, value) => {
          const dir = ${JSON.stringify(testInfo.outputPath("stage3-independent-profiles"))} + "/" + name;
          const path = join(dir, "ui-state.json");
          return { dir, path, initialBytes: await writeJson(path, value) };
        };

        const existing = Object.freeze({
          selectedWorkspaceId: "project-00",
          selectedSessionId: "",
          activeView: "threads",
          composerDraft: "independent retained draft",
          composerDraftsBySession: {},
          extensionFlagsByWorkspace: { "project-00": { plan: true, "dry-run": false } },
          extensionFlagsBySession: {},
          notificationPreferences: {
            backgroundCompletion: true,
            backgroundFailure: false,
            attentionNeeded: true,
          },
          disabledBuiltinExtensions: ["quiet"],
          integratedTerminalShell: "/bin/zsh",
          workspaceOrder: ["project-00"],
          modelSettingsScopeMode: "app-global",
          appGlobalModelSettings: {
            enabledModelPatterns: ["fixture-*"],
          },
          sidebarCollapsed: true,
          threadGrouping: "workspace",
          collapsedWorkspaceIds: ["project-00"],
          folderPreferencesByWorkspace: { "project-00": "partial" },
          allThreadsSort: "activity",
          initiatingOriginBySession: {},
          createdAtBySession: {},
          enableTransparency: true,
          themeMode: "dark",
        });

        const rootCount = 10;
        const roots = Array.from({ length: rootCount }, (_, index) => {
          const id = "project-" + String(index).padStart(2, "0");
          return {
            workspaceId: id,
            path: ${JSON.stringify(testInfo.outputPath("stage3-independent-profiles/workspaces"))} + "/" + id,
            displayName: "Independent project " + index,
            lastOpenedAt: "2026-10-31T00:00:00Z",
            sortOrder: index,
          };
        });
        const linkedPath = ${JSON.stringify(testInfo.outputPath("stage3-independent-profiles/workspaces/linked"))};
        const orphanPath = ${JSON.stringify(testInfo.outputPath("stage3-independent-profiles/workspaces/orphan"))};
        const allWorkspaces = [
          ...roots,
          {
            workspaceId: "linked-worktree",
            path: linkedPath,
            displayName: "Independent linked worktree",
            lastOpenedAt: "2026-10-31T00:00:00Z",
            sortOrder: rootCount,
          },
          {
            workspaceId: "orphan-worktree",
            path: orphanPath,
            displayName: "Independent orphan worktree",
            lastOpenedAt: "2026-10-31T00:00:00Z",
            sortOrder: rootCount + 1,
          },
        ];
        const allWorktrees = [
          {
            worktreeId: "linked",
            workspaceId: "project-00",
            path: linkedPath,
            displayName: "Independent linked worktree",
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
            displayName: "Independent orphan worktree",
            kind: "linked",
            status: "ready",
            branchName: "orphan",
            headSha: "2222222",
            createdAt: "2026-10-31T00:00:00Z",
            updatedAt: "2026-10-31T00:00:00Z",
          },
        ];
        const catalog = { workspaces: [...allWorkspaces], worktrees: [...allWorktrees], sessions: [] };
        const simpleCatalog = { workspaces: [roots[0]], worktrees: [], sessions: [] };
        const emptyCatalog = { workspaces: [], worktrees: [], sessions: [] };
        const configureMain = (store, selectedCatalog = catalog) => {
          store.driver.listWorkspaces = async () => ({ workspaces: selectedCatalog.workspaces });
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

        const savedColors = {
          "project-00": "#123456",
          "project-01": "#123456",
          "absent-project": "#abcdef",
        };
        const mainSeed = await seed("main", {
          version: 20,
          ...existing,
          workspaceAccentColors: savedColors,
        });
        resetWrites();
        const main = configureMain(
          new DesktopAppStore({ userDataDir: mainSeed.dir, initialWorkspacePaths: [] }),
        );
        await main.initialize();

        assert.ok(control.writes.length >= 1);
        assert.equal(Object.keys(main.workspaceAccentColors).length, 12);
        assert.equal(main.workspaceAccentColors["project-00"], "#123456");
        assert.equal(main.workspaceAccentColors["project-01"], "#123456");
        assert.equal(main.workspaceAccentColors["absent-project"], "#abcdef");
        const generatedOwnerIds = [
          ...Array.from({ length: rootCount - 2 }, (_, index) => "project-" + String(index + 2).padStart(2, "0")),
          "orphan-worktree",
        ];
        for (const ownerId of generatedOwnerIds) {
          assert.match(main.workspaceAccentColors[ownerId], /^#[0-9a-f]{6}$/);
        }
        const generatedColors = generatedOwnerIds.map((ownerId) => main.workspaceAccentColors[ownerId]);
        assert.equal(new Set(generatedColors).size, generatedOwnerIds.length);
        assert.equal(generatedColors.includes("#123456"), false);

        const initialProjection = (await main.getState()).sidebarAppearance;
        assert.equal(Object.keys(initialProjection.projectByWorkspaceId).length, allWorkspaces.length);
        same(initialProjection.projectByWorkspaceId["project-00"], {
          projectId: "project-00",
          accentColor: "#123456",
        });
        same(initialProjection.projectByWorkspaceId["linked-worktree"], {
          projectId: "project-00",
          accentColor: "#123456",
        });
        same(initialProjection.projectByWorkspaceId["orphan-worktree"], {
          projectId: "orphan-worktree",
          accentColor: main.workspaceAccentColors["orphan-worktree"],
        });
        same(initialProjection.activityIndicatorPreference, {
          style: "moonwalk",
          source: "provisional",
        });
        const initialSaved = JSON.parse(await readFile(mainSeed.path, "utf8"));
        same(initialSaved.workspaceAccentColors, main.workspaceAccentColors);
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
        same(main.workspaceAccentColors, initialSaved.workspaceAccentColors);
        same(reordered.sidebarAppearance, initialProjection);

        resetWrites();
        const linkedMutation = await main.setProjectAccentColor({
          workspaceId: "linked-worktree",
          color: "#ABC",
        });
        assert.equal(control.writes.length, 1);
        assert.equal(main.workspaceAccentColors["project-00"], "#aabbcc");
        assert.equal(main.workspaceAccentColors["project-01"], "#123456");
        same(linkedMutation.sidebarAppearance.projectByWorkspaceId["project-00"], {
          projectId: "project-00",
          accentColor: "#aabbcc",
        });
        same(linkedMutation.sidebarAppearance.projectByWorkspaceId["linked-worktree"], {
          projectId: "project-00",
          accentColor: "#aabbcc",
        });

        const userActivity = await main.setActivityIndicatorStyle("spiral");
        same(userActivity.sidebarAppearance.activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });
        const beforeConcurrency = await main.getState();
        const priorProjectTwoColor =
          beforeConcurrency.sidebarAppearance.projectByWorkspaceId["project-02"].accentColor;
        const priorDiskBytes = await readFile(mainSeed.path, "utf8");

        resetWrites();
        const held = holdWrite(false);
        const heldAccent = main.setProjectAccentColor({
          workspaceId: "project-02",
          color: "#778899",
        });
        await held.started;
        const duringHold = await main.getState();
        assert.equal(
          duringHold.sidebarAppearance.projectByWorkspaceId["project-02"].accentColor,
          priorProjectTwoColor,
        );
        assert.equal(main.workspaceAccentColors["project-02"], priorProjectTwoColor);
        assert.equal(await readFile(mainSeed.path, "utf8"), priorDiskBytes);
        const queuedUnrelated = main.setAllThreadsSort("title");
        await delay(30);
        assert.equal(control.writes.length, 1);
        assert.equal(control.writes[0].workspaceAccentColors["project-02"], "#778899");
        assert.equal(control.writes[0].allThreadsSort, "activity");
        held.release();
        await Promise.all([heldAccent, queuedUnrelated]);
        const afterHeld = await main.getState();
        assert.equal(
          afterHeld.sidebarAppearance.projectByWorkspaceId["project-02"].accentColor,
          "#778899",
        );
        assert.equal(afterHeld.allThreadsSort, "title");
        assert.equal(control.writes.length, 2);
        assert.equal(
          control.writes[1].workspaceAccentColors["project-02"],
          "#778899",
        );
        assert.equal(control.writes[1].allThreadsSort, "title");
        same(control.writes[1].activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });
        const heldSaved = JSON.parse(await readFile(mainSeed.path, "utf8"));
        assert.equal(heldSaved.workspaceAccentColors["project-02"], "#778899");
        assert.equal(heldSaved.allThreadsSort, "title");

        resetWrites();
        await Promise.all([
          main.setProjectAccentColor({ workspaceId: "project-03", color: "#112233" }),
          main.setProjectAccentColor({ workspaceId: "project-03", color: "#445566" }),
        ]);
        assert.equal(control.writes.length, 2);
        assert.equal(control.writes[0].workspaceAccentColors["project-03"], "#112233");
        assert.equal(control.writes[1].workspaceAccentColors["project-03"], "#445566");
        assert.equal(main.workspaceAccentColors["project-03"], "#445566");

        const priorProjectFourColor = main.workspaceAccentColors["project-04"];
        resetWrites();
        const failedHold = holdWrite(true);
        const failedAccent = main.setProjectAccentColor({
          workspaceId: "project-04",
          color: "#224466",
        });
        await failedHold.started;
        const unrelatedDuringFailure = main.setAllThreadsSort("unread-first");
        await delay(30);
        assert.equal(control.writes.length, 1);
        failedHold.release();
        await assert.rejects(failedAccent, /synthetic independent write failure/);
        await unrelatedDuringFailure;
        assert.equal(control.history[0].denied, true);
        assert.equal(control.writes.length, 2);
        const afterFailure = await main.getState();
        assert.equal(
          afterFailure.sidebarAppearance.projectByWorkspaceId["project-04"].accentColor,
          priorProjectFourColor,
        );
        same(afterFailure.sidebarAppearance.activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });
        assert.equal(afterFailure.allThreadsSort, "unread-first");
        const failedSaved = JSON.parse(await readFile(mainSeed.path, "utf8"));
        assert.equal(failedSaved.workspaceAccentColors["project-04"], priorProjectFourColor);
        same(failedSaved.activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });
        assert.equal(failedSaved.allThreadsSort, "unread-first");

        resetWrites();
        await main.setProjectAccentColor({ workspaceId: "project-04", color: "#224466" });
        assert.equal(main.workspaceAccentColors["project-04"], "#224466");
        assert.equal(control.writes.length, 1);

        const migrationUserSeed = await seed("migration-user", {
          version: 20,
          ...existing,
        });
        const migrationUser = configureMain(
          new DesktopAppStore({ userDataDir: migrationUserSeed.dir, initialWorkspacePaths: [] }),
          simpleCatalog,
        );
        await migrationUser.initialize();
        resetWrites();
        const noLegacy = await migrationUser.migrateLegacyActivityIndicatorStyle("not-a-style");
        assert.equal(noLegacy.status, "no-legacy");
        assert.equal(control.writes.length, 0);
        const migrated = await migrationUser.migrateLegacyActivityIndicatorStyle("wheel");
        assert.equal(migrated.status, "applied");
        const explicit = await migrationUser.setActivityIndicatorStyle("spiral");
        same(explicit.sidebarAppearance.activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });
        resetWrites();
        const afterExplicit = await migrationUser.migrateLegacyActivityIndicatorStyle("wave");
        const afterExplicitMalformed =
          await migrationUser.migrateLegacyActivityIndicatorStyle({ invalid: true });
        assert.equal(afterExplicit.status, "already-set");
        assert.equal(afterExplicitMalformed.status, "already-set");
        assert.equal(control.writes.length, 0);
        const migrationUserSaved = JSON.parse(await readFile(migrationUserSeed.path, "utf8"));
        same(migrationUserSaved.activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });

        const migrationFirstSeed = await seed("migration-first", {
          version: 20,
          ...existing,
        });
        const migrationFirst = configureMain(
          new DesktopAppStore({ userDataDir: migrationFirstSeed.dir, initialWorkspacePaths: [] }),
          simpleCatalog,
        );
        await migrationFirst.initialize();
        resetWrites();
        const [migrationFirstResult, userSecondResult] = await Promise.all([
          migrationFirst.migrateLegacyActivityIndicatorStyle("wheel"),
          migrationFirst.setActivityIndicatorStyle("stick"),
        ]);
        assert.equal(migrationFirstResult.status, "applied");
        same(userSecondResult.sidebarAppearance.activityIndicatorPreference, {
          style: "stick",
          source: "user",
        });
        assert.equal(control.writes.length, 2);
        assert.equal(control.writes[1].activityIndicatorPreference.source, "user");

        const userFirstSeed = await seed("user-first", {
          version: 20,
          ...existing,
        });
        const userFirst = configureMain(
          new DesktopAppStore({ userDataDir: userFirstSeed.dir, initialWorkspacePaths: [] }),
          simpleCatalog,
        );
        await userFirst.initialize();
        resetWrites();
        const [userFirstResult, migrationSecondResult] = await Promise.all([
          userFirst.setActivityIndicatorStyle("ball"),
          userFirst.migrateLegacyActivityIndicatorStyle("spiral"),
        ]);
        same(userFirstResult.sidebarAppearance.activityIndicatorPreference, {
          style: "ball",
          source: "user",
        });
        assert.equal(migrationSecondResult.status, "already-set");
        assert.equal(control.writes.length, 1);

        const explicitSeed = await seed("explicit-seed", {
          version: 20,
          ...existing,
          activityIndicatorPreference: { style: "moonwalk", source: "user" },
        });
        const explicitMain = configureMain(
          new DesktopAppStore({ userDataDir: explicitSeed.dir, initialWorkspacePaths: [] }),
          simpleCatalog,
        );
        await explicitMain.initialize();
        resetWrites();
        const seededExplicitMigration =
          await explicitMain.migrateLegacyActivityIndicatorStyle("wheel");
        assert.equal(seededExplicitMigration.status, "already-set");
        assert.equal(control.writes.length, 0);

        const migrationFailureSeed = await seed("migration-failure", {
          version: 20,
          ...existing,
        });
        const migrationFailure = configureMain(
          new DesktopAppStore({
            userDataDir: migrationFailureSeed.dir,
            initialWorkspacePaths: [],
          }),
          simpleCatalog,
        );
        await migrationFailure.initialize();
        resetWrites();
        const migrationBytesBeforeFailure = await readFile(migrationFailureSeed.path, "utf8");
        const migrationHold = holdWrite(true);
        const failedMigration = migrationFailure.migrateLegacyActivityIndicatorStyle("wave");
        await migrationHold.started;
        migrationHold.release();
        await assert.rejects(failedMigration, /synthetic independent write failure/);
        assert.deepEqual((await migrationFailure.getState()).sidebarAppearance.activityIndicatorPreference, {
          style: "moonwalk",
          source: "provisional",
        });
        assert.equal(await readFile(migrationFailureSeed.path, "utf8"), migrationBytesBeforeFailure);
        const failedMigrationSaved = JSON.parse(
          await readFile(migrationFailureSeed.path, "utf8"),
        );
        assert.equal(Object.hasOwn(failedMigrationSaved, "activityIndicatorPreference"), false);
        const migrationRetry = await migrationFailure.migrateLegacyActivityIndicatorStyle("wave");
        assert.equal(migrationRetry.status, "applied");
        assert.deepEqual(migrationRetry.state.sidebarAppearance.activityIndicatorPreference, {
          style: "wave",
          source: "legacy-migrated",
        });

        const emptySeed = await seed("empty", { version: 20 });
        resetWrites();
        const empty = configureMain(
          new DesktopAppStore({ userDataDir: emptySeed.dir, initialWorkspacePaths: [] }),
          emptyCatalog,
        );
        await empty.initialize();
        assert.deepEqual((await empty.getState()).sidebarAppearance, {
          projectByWorkspaceId: {},
          activityIndicatorPreference: { style: "moonwalk", source: "provisional" },
        });
        const emptySaved = JSON.parse(await readFile(emptySeed.path, "utf8"));
        assert.equal(Object.hasOwn(emptySaved, "workspaceAccentColors"), false);
        assert.equal(Object.hasOwn(emptySaved, "activityIndicatorPreference"), false);

        const mainSavedBeforeRestart = JSON.parse(await readFile(mainSeed.path, "utf8"));
        resetWrites();
        const restarted = configureMain(
          new DesktopAppStore({ userDataDir: mainSeed.dir, initialWorkspacePaths: [] }),
        );
        await restarted.initialize();
        assert.ok(control.writes.length <= 1);
        for (const write of control.writes) {
          same(write.workspaceAccentColors, mainSavedBeforeRestart.workspaceAccentColors);
          same(write.activityIndicatorPreference, {
            style: "spiral",
            source: "user",
          });
        }
        const restartedState = await restarted.getState();
        assert.equal(
          restartedState.sidebarAppearance.projectByWorkspaceId["linked-worktree"].accentColor,
          "#aabbcc",
        );
        assert.equal(
          restartedState.sidebarAppearance.projectByWorkspaceId["project-02"].accentColor,
          "#778899",
        );
        assert.equal(
          restartedState.sidebarAppearance.projectByWorkspaceId["project-03"].accentColor,
          "#445566",
        );
        assert.equal(
          restartedState.sidebarAppearance.projectByWorkspaceId["project-04"].accentColor,
          "#224466",
        );
        same(restartedState.sidebarAppearance.activityIndicatorPreference, {
          style: "spiral",
          source: "user",
        });
        assert.equal(restartedState.allThreadsSort, "unread-first");
        same(restarted.workspaceAccentColors, mainSavedBeforeRestart.workspaceAccentColors);

        resetWrites();
        const migrationRestart = configureMain(
          new DesktopAppStore({
            userDataDir: migrationFailureSeed.dir,
            initialWorkspacePaths: [],
          }),
          simpleCatalog,
        );
        await migrationRestart.initialize();
        assert.ok(control.writes.length <= 1);
        same(
          (await migrationRestart.getState()).sidebarAppearance.activityIndicatorPreference,
          { style: "wave", source: "legacy-migrated" },
        );

        const queueEvents = [
          {
            operation: "held appearance candidate",
            queuedUnrelatedWrite: "setAllThreadsSort(title)",
            candidateVisibleBeforeCommit: false,
          },
          {
            operation: "denied appearance candidate",
            queuedUnrelatedWrite: "setAllThreadsSort(unread-first)",
            unrelatedStateCommitted: true,
          },
        ];
        const proof = {
          schemaVersion: 1,
          actualMain: true,
          defaultsAndProjection: Object.keys(main.workspaceAccentColors).length === 12,
          projectionOrderStable: true,
          savedColorRetained: main.workspaceAccentColors["project-00"] === "#aabbcc",
          absentSavedRetained: Object.hasOwn(main.workspaceAccentColors, "absent-project"),
          duplicateSavedRetained: mainSavedBeforeRestart.workspaceAccentColors["project-01"] === "#123456",
          linkedWorktreeInheritsRoot:
            restartedState.sidebarAppearance.projectByWorkspaceId["linked-worktree"].projectId ===
            "project-00",
          orphanUsesStableOwner:
            restartedState.sidebarAppearance.projectByWorkspaceId["orphan-worktree"].projectId ===
            "orphan-worktree",
          mutationPersisted:
            main.workspaceAccentColors["project-03"] === "#445566" &&
            main.workspaceAccentColors["project-04"] === "#224466",
          userActivitySource:
            restartedState.sidebarAppearance.activityIndicatorPreference.source === "user",
          noCandidateLeakDuringHeldWrite: true,
          delayedUnrelatedWriteOrdered: true,
          concurrentAppearanceLastWins: main.workspaceAccentColors["project-03"] === "#445566",
          failurePreservedPriorAppearance: true,
          failureCommittedUnrelatedState: afterFailure.allThreadsSort === "unread-first",
          retryApplied: main.workspaceAccentColors["project-04"] === "#224466",
          invalidLegacyRejected: noLegacy.status === "no-legacy",
          legacyMigrationApplied: migrated.status === "applied",
          explicitUserWinsLegacy: migrationUserSaved.activityIndicatorPreference.source === "user",
          malformedLegacyWithDurablePreference:
            afterExplicitMalformed.status === "already-set",
          concurrentUserLosesRace: userSecondResult.sidebarAppearance.activityIndicatorPreference.style === "stick",
          concurrentMigrationSeesUser:
            migrationSecondResult.status === "already-set" &&
            userFirstResult.sidebarAppearance.activityIndicatorPreference.style === "ball",
          seededExplicitRejectsLegacy: seededExplicitMigration.status === "already-set",
          migrationFailureKeepsAbsence: true,
          migrationRetryApplied: migrationRetry.status === "applied",
          restartPreservedMain: true,
          restartPreservedLegacy: true,
          zeroScaleProjection: true,
          queueEvents,
          writeHistory: control.audit.map((entry) => ({
            denied: entry.denied,
            allThreadsSort: entry.payload.allThreadsSort,
            projectColors: entry.payload.workspaceAccentColors,
            activityIndicatorPreference: entry.payload.activityIndicatorPreference,
          })),
        };
        for (const [key, value] of Object.entries(proof)) {
          if (key.endsWith("ed") || key.endsWith("Applied") || key.endsWith("Retained")) {
            assert.notEqual(value, false, "Independent proof failed: " + key);
          }
        }

        const evidenceDir = process.env.PI_V10_D08_D2_STAGE3_INDEPENDENT_EVIDENCE_DIR;
        if (evidenceDir) {
          await mkdir(evidenceDir, { recursive: true });
          await writeFile(join(evidenceDir, "proof.json"), JSON.stringify(proof, null, 2) + "\\n");
          await writeFile(
            join(evidenceDir, "queue-events.json"),
            JSON.stringify(queueEvents, null, 2) + "\\n",
          );
          const retainedProfiles = [
            ["main", mainSeed.dir],
            ["migration-user", migrationUserSeed.dir],
            ["migration-first", migrationFirstSeed.dir],
            ["user-first", userFirstSeed.dir],
            ["explicit-seed", explicitSeed.dir],
            ["migration-failure", migrationFailureSeed.dir],
            ["empty", emptySeed.dir],
          ];
          const profileHashes = {};
          for (const [name, dir] of retainedProfiles) {
            const destination = join(evidenceDir, "profiles", name);
            await mkdir(destination, { recursive: true });
            const retained = [];
            for (const file of await readdir(dir)) {
              if (
                file === "ui-state.json" ||
                file.endsWith(".bak") ||
                file.includes(".pre-workbench-")
              ) {
                const source = join(dir, file);
                const bytes = await readFile(source);
                await copyFile(source, join(destination, file));
                retained.push({ file, bytes: bytes.byteLength, sha256: digest(bytes) });
              }
            }
            profileHashes[name] = retained.sort((left, right) =>
              left.file.localeCompare(right.file),
            );
          }
          await writeFile(
            join(evidenceDir, "profile-hashes.json"),
            JSON.stringify(profileHashes, null, 2) + "\\n",
          );
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
        name: "independently-control-stage3-appearance-writes",
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "v10-d08-stage3-native-block",
          }));
          builder.onLoad({ filter: /.*/, namespace: "v10-d08-stage3-native-block" }, () => ({
            contents:
              'export const nativeImage = new Proxy({}, { get() { throw new Error("Unexpected native image access in Stage 3 independent verifier"); } });',
            loader: "js",
          }));
          builder.onLoad({ filter: /app-store-persistence\.ts$/ }, async ({ path }) => {
            if (!path.endsWith("/apps/desktop/electron/persistence/app-store-persistence.ts")) {
              return undefined;
            }
            const source = await readFile(path, "utf8");
            if (!source.includes(persistenceWriteStart)) {
              throw new Error("Expected actual persistence pre-atomic-write call");
            }
            return {
              contents: source.replace(
                persistenceWriteStart,
                `  const serializedWrite = JSON.parse(serialized);
  const writeControl = globalThis[Symbol.for(${JSON.stringify(writeControlSymbol)})];
  const held = writeControl?.hold;
  const entry = {
    denied: Boolean(held?.deny),
    payload: serializedWrite,
  };
  writeControl?.writes.push(serializedWrite);
  writeControl?.history.push(entry);
          writeControl?.audit.push(entry);
  if (held) {
    writeControl.hold = null;
    held.started?.();
    await held.gate;
  }
  if (entry.denied) throw new Error("synthetic independent write failure");
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
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  const proof = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as Record<
    string,
    unknown
  >;
  expect(proof).toMatchObject({
    schemaVersion: 1,
    actualMain: true,
    defaultsAndProjection: true,
    projectionOrderStable: true,
    savedColorRetained: true,
    absentSavedRetained: true,
    duplicateSavedRetained: true,
    linkedWorktreeInheritsRoot: true,
    orphanUsesStableOwner: true,
    mutationPersisted: true,
    userActivitySource: true,
    noCandidateLeakDuringHeldWrite: true,
    delayedUnrelatedWriteOrdered: true,
    concurrentAppearanceLastWins: true,
    failurePreservedPriorAppearance: true,
    failureCommittedUnrelatedState: true,
    retryApplied: true,
    invalidLegacyRejected: true,
    legacyMigrationApplied: true,
    explicitUserWinsLegacy: true,
    malformedLegacyWithDurablePreference: true,
    concurrentUserLosesRace: true,
    concurrentMigrationSeesUser: true,
    seededExplicitRejectsLegacy: true,
    migrationFailureKeepsAbsence: true,
    migrationRetryApplied: true,
    restartPreservedMain: true,
    restartPreservedLegacy: true,
    zeroScaleProjection: true,
  });
  await testInfo.attach("stage3-independent-appearance-proof", {
    body: result.stdout,
    contentType: "application/json",
  });
});
