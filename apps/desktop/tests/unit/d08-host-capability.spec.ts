import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { EffectiveChildModelSettings } from "../../contracts/child-selection";
import type { createOrchestrationOwner } from "../../electron/orchestration/app-store-orchestration";

const execFileAsync = promisify(execFile);
type OrchestrationHost = Parameters<typeof createOrchestrationOwner>[0];
// The owner's typed capability must expose only the narrow snapshot.
const capabilityType: OrchestrationHost["getEffectiveChildModelSettings"] = async (
  _workspaceId,
): Promise<EffectiveChildModelSettings> => ({ policySource: "app-global", models: [] });

/** Capture the actual composition host in a test-only bundle; shipped source is unmodified. */
test("actual orchestration host capability forwards through the existing sanitized runtime owner", async ({}, testInfo) => {
  expect(await capabilityType("ws")).toEqual({ policySource: "app-global", models: [] });
  const root = resolve(__dirname, "../../../..");
  const output = testInfo.outputPath("host-capability-probe.mjs");
  const hook =
    "export function createOrchestrationOwner(store: OrchestrationOwnerHost): OrchestrationOwner {";
  const aliases = {
    "@pi-gui/session-driver": "packages/session-driver/src/index.ts",
    "@pi-gui/catalogs": "packages/catalogs/src/index.ts",
    "@pi-gui/catalogs/node": "packages/catalogs/src/node/index.ts",
    "@pi-gui/catalogs/node/atomic-write": "packages/catalogs/src/node/atomic-write.ts",
    "@pi-gui/pi-sdk-driver": "packages/pi-sdk-driver/src/index.ts",
    "@pi-gui/extension-ui": "packages/extension-ui/src/index.ts",
  };
  await build({
    stdin: {
      contents: `
        import assert from "node:assert/strict";
        import { DesktopAppStore } from ${JSON.stringify(join(root, "apps/desktop/electron/application/app-store.ts"))};
        const store = new DesktopAppStore({ userDataDir: ${JSON.stringify(testInfo.outputPath("unused-profile"))}, initialWorkspacePaths: [] });
        const host = globalThis[Symbol.for("d08-capability-host")];
        assert.equal(typeof host?.getEffectiveChildModelSettings, "function");
        const runtime = { settings: { defaultProvider: "p", defaultModelId: "m", defaultThinkingLevel: "high", enabledModelPatterns: ["owner-policy"] }, models: [{ providerId: "p", modelId: "m", available: true, reasoning: true, scope: "listed", auth: "forbidden-model-auth", tool: "forbidden-tool" }], credentials: "forbidden-runtime-auth", extensions: ["forbidden-extension"] };
        let requests = [], ownerReads = 0;
        store.initialize = async () => {};
        store.workspaceRefFromState = (id) => { assert.equal(id, "ws"); return { workspaceId: id }; };
        store.ensureRuntimeLoaded = async (id) => { assert.equal(id, "ws"); };
        store.serializeRuntimeStateForCurrentWorkspaces = async () => { ownerReads++; return { ws: runtime }; };
        store.state = { modelSettingsScopeMode: "per-repo" };
        const method = store.getEffectiveChildModelSettings;
        store.getEffectiveChildModelSettings = function(id) { requests.push(id); return method.call(this, id); };
        const snapshot = await host.getEffectiveChildModelSettings("ws");
        assert.deepEqual(requests, ["ws"]);
        assert.equal(ownerReads, 1);
        assert.deepEqual(snapshot, { policySource: "per-repo", defaultProvider: "p", defaultModelId: "m", defaultThinkingLevel: "high", models: [{ provider: "p", modelId: "m", available: true, reasoning: true, scope: "listed" }] });
        assert.equal(JSON.stringify(snapshot).includes("forbidden"), false);
        store.schedulePersistUiState = () => {};
        const workspaceHost = globalThis[Symbol.for("d08-origin-workspace")];
        const scheduledHost = globalThis[Symbol.for("d08-origin-scheduled")];
        const snapshotFor = (id) => ({ ref: { workspaceId: "ws", sessionId: id }, workspace: { workspaceId: "ws", path: "/unused" }, title: id, status: "idle", updatedAt: "2026-10-31T00:00:00.000Z", initiatingOrigin: { kind: "forged" }, sourceToolCallId: "correlation-is-not-identity" });
        workspaceHost.seedSession(snapshotFor("human"));
        host.seedSession(snapshotFor("tool"));
        scheduledHost.seedSession(snapshotFor("scheduled"));
        workspaceHost.recordSessionCreation({ workspaceId: "ws", sessionId: "fork" });
        const origins = Object.fromEntries(store.sessionState.initiatingOriginBySession);
        for (const kind of ["human", "tool", "scheduled"]) assert.deepEqual(origins["ws:" + kind], { kind, source: "desktop-host" });
        assert.deepEqual(origins["ws:fork"], { kind: "human", source: "desktop-host" });
        assert.equal(origins["ws:legacy"], undefined);
        const reloaded = new DesktopAppStore({ userDataDir: ${JSON.stringify(testInfo.outputPath("unused-reload-profile"))}, initialWorkspacePaths: [] });
        reloaded.restorePersistedUiState({ initiatingOriginBySession: origins });
        assert.deepEqual(Object.fromEntries(reloaded.sessionState.initiatingOriginBySession), origins);
        reloaded.sessionState.prune(new Set(["ws:tool"]));
        assert.deepEqual([...reloaded.sessionState.initiatingOriginBySession.keys()], ["ws:tool"]);
        console.log(JSON.stringify({ actualConstructorBinding: true, forwardedWorkspaceId: requests[0], existingRuntimeOwnerReads: ownerReads, sanitizedSnapshot: snapshot, noAuthExtensionToolLeakage: true, trustedSeedOrigins: origins, legacyUnknown: true, reloadPreserved: true, pruningPreserved: true }));
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
        name: "capture-actual-composition-host",
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "d08-native-block",
          }));
          builder.onLoad({ filter: /.*/, namespace: "d08-native-block" }, () => ({
            contents:
              'export const nativeImage = new Proxy({}, { get() { throw new Error("Unexpected native image access in pure capability test"); } });',
            loader: "js",
          }));
          builder.onLoad(
            { filter: /app-store-(orchestration|workspace|scheduled-tasks)\.ts$/ },
            async ({ path }) => {
              const source = await readFile(path, "utf8");
              const isWorkspace = path.endsWith("app-store-workspace.ts");
              const isScheduled = path.endsWith("app-store-scheduled-tasks.ts");
              const seam = isWorkspace
                ? "export function createWorkspaceOwner(store: WorkspaceOwnerHost): WorkspaceOwner {"
                : isScheduled
                  ? "export function createScheduledTaskOwner(store: ScheduledTaskOwnerHost): ScheduledTaskOwner {"
                  : hook;
              const symbol = isWorkspace
                ? "d08-origin-workspace"
                : isScheduled
                  ? "d08-origin-scheduled"
                  : "d08-capability-host";
              if (!source.includes(seam)) throw new Error("Expected actual host composition seam");
              return {
                contents: source.replace(
                  seam,
                  `${seam}\n(globalThis as Record<symbol, unknown>)[Symbol.for("${symbol}")] = store;`,
                ),
                loader: "ts",
              };
            },
          );
        },
      },
    ],
  });
  const result = await execFileAsync(process.execPath, [output]);
  const proof = JSON.parse(result.stdout) as {
    actualConstructorBinding: boolean;
    existingRuntimeOwnerReads: number;
    noAuthExtensionToolLeakage: boolean;
    legacyUnknown: boolean;
    reloadPreserved: boolean;
    pruningPreserved: boolean;
  };
  expect(proof).toMatchObject({
    actualConstructorBinding: true,
    existingRuntimeOwnerReads: 1,
    noAuthExtensionToolLeakage: true,
    legacyUnknown: true,
    reloadPreserved: true,
    pruningPreserved: true,
  });
  await testInfo.attach("actual-host-capability", {
    body: result.stdout,
    contentType: "application/json",
  });
});
