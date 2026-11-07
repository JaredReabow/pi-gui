import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AutonomyStore } from "../../electron/conversation/autonomy-store";
const exec = promisify(execFile);
test("a missing or corrupt primary never restores a stale Full access backup", async () => {
  for (const corrupt of [true, false]) {
    const path = join(await mkdtemp(join(tmpdir(), "pi-authority-backup-")), "autonomy.json");
    await writeFile(
      path + ".bak",
      JSON.stringify({ version: 1, revision: 1, defaultMode: "full-access", sessions: {} }),
    );
    if (corrupt) await writeFile(path, "{bad");
    await expect(new AutonomyStore(path).get()).rejects.toThrow("refusing to grant");
  }
});
test("actual Main revokes before cancellation completes and cancels sessions concurrently", async ({}, info) => {
  const root = resolve(__dirname, "../../../..");
  const output = info.outputPath("authority-main.mjs");
  await build({
    stdin: {
      resolveDir: root,
      contents: `
 import assert from 'node:assert/strict';import{mkdtemp}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
 import{DesktopAppStore}from ${JSON.stringify(join(root, "apps/desktop/electron/application/app-store.ts"))};
 import{AutonomyStore}from ${JSON.stringify(join(root, "apps/desktop/electron/conversation/autonomy-store.ts"))};
 for(const fail of [false,true]){
  const authority=new AutonomyStore(join(await mkdtemp(join(tmpdir(),'pi-main-authority-')),'autonomy.json'));await authority.set({mode:'full-access',confirmFullAccess:true});
  let finish;const held=new Promise(resolve=>finish=resolve);const cancelled=[];
  const subject={autonomy:authority,state:{workspaces:[{id:'workspace',sessions:[{id:'a',status:'running'},{id:'b',status:'running'}]}]},getAutonomyPreferences:()=>authority.get(),sessionFromState:()=>({status:'running'}),driver:{async cancelCurrentRun(target){cancelled.push(target.sessionId);if(target.sessionId==='a')await held;if(fail&&target.sessionId==='b')throw new Error('stop unavailable');}}};
  const pending=DesktopAppStore.prototype.setAutonomyPreferences.call(subject,{mode:'read-only'});const deadline=Date.now()+3000;while(cancelled.length<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(cancelled,['a','b']);assert.equal((await authority.get()).mode,'read-only');finish();if(fail)await assert.rejects(pending,/saved.*could not be stopped/);else assert.equal((await pending).mode,'read-only');assert.equal((await authority.get()).mode,'read-only');
 }
 console.log('AUTHORITY_ORDERING_OK');
 `,
    },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    alias: Object.fromEntries(
      Object.entries({
        "@pi-gui/session-driver/runtime-types": "packages/session-driver/src/runtime-types.ts",
        "@pi-gui/session-driver/types": "packages/session-driver/src/types.ts",
        "@pi-gui/session-driver": "packages/session-driver/src/index.ts",
        "@pi-gui/catalogs/node/atomic-write": "packages/catalogs/src/node/atomic-write.ts",
        "@pi-gui/catalogs/node": "packages/catalogs/src/node/index.ts",
        "@pi-gui/catalogs": "packages/catalogs/src/index.ts",
        "@pi-gui/pi-sdk-driver/runtime-types": "packages/session-driver/src/runtime-types.ts",
        "@pi-gui/pi-sdk-driver": "packages/pi-sdk-driver/src/index.ts",
        "@pi-gui/extension-ui": "packages/extension-ui/src/index.ts",
        "@pi-gui/distribution-config": "packages/distribution-config/src/index.ts",
        "@pi-gui/distribution-support": "packages/distribution-support/src/index.ts",
      }).map(([key, value]) => [key, join(root, value)]),
    ),
    plugins: [
      {
        name: "forbid-native-effects-in-policy-unit",
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "policy-native-forbidden",
          }));
          builder.onLoad({ filter: /.*/, namespace: "policy-native-forbidden" }, () => ({
            contents:
              'export const nativeImage = new Proxy({}, { get() { throw new Error("Unexpected native effect in policy ordering unit test"); } });',
            loader: "js",
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  const { stdout } = await exec(process.execPath, [output], { cwd: root, timeout: 20000 });
  expect(stdout).toContain("AUTHORITY_ORDERING_OK");
});
