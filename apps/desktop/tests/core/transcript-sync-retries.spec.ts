import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  writeProjectExtension,
  selectSession,
  getDesktopState,
} from "../helpers/electron-app";

const extension = String.raw`
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { appendFileSync, existsSync } from 'node:fs';
let summaryCalls = 0;
export default function(pi) {
 pi.registerProvider('sync-proof', {api:'sync-proof',apiKey:'LOCAL_TEST',baseUrl:'http://127.0.0.1:9/never-contact',
 models:[{id:'chat',name:'chat',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:4096}],
 streamSimple(model,context,options) {
  const system=JSON.stringify(context);
  const summary=system.includes('collapsed UI bar'); const title=system.includes('UI thread titles');
  const index=context.messages.findLastIndex(m=>m.role==='user'&&/SYNC_FINAL_ONLY|SYNC_PARTIAL|SYNC_TOOLS/.test(JSON.stringify(m.content)));
  const intent=JSON.stringify(context.messages[index]?.content||'');
  const finished=context.messages.slice(index+1).some(m=>m.role==='toolResult');
  if(!summary&&!title&&process.env.PI_SYNC_CHAT_LOG)appendFileSync(process.env.PI_SYNC_CHAT_LOG,'request\n');
  const tool=!summary&&!title&&intent.includes('SYNC_TOOLS')&&!finished;
  const fail=summary&&++summaryCalls<=3;
  if(summary)appendFileSync(process.env.PI_SYNC_LOG,JSON.stringify({attempt:summaryCalls,time:Date.now()})+'\n');
  const text=summary?'SUMMARY_RECOVERED_ON_FOURTH':title?(intent.includes('SYNC_TOOLS')?'Tools sync thread':'Answer sync thread'):tool?'Reading README.':intent.includes('SYNC_PARTIAL')?'COMPLETE_CORRECTED_FINAL':intent.includes('SYNC_TOOLS')?'BACKGROUND_TOOL_FINAL':'FINAL_WITHOUT_DELTAS';
  const content=fail?[]:tool?[{type:'text',text},{type:'toolCall',id:'sync-read',name:'read',arguments:{path:'README.md'}}]:[{type:'text',text}];
  const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content,stopReason:fail?'error':tool?'toolUse':'stop',...(fail?{errorMessage:'transient summary fixture'}:{}),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now()};
  const stream=createAssistantMessageEventStream();stream.push({type:'start',partial:{...message,content:[]}});
  // Deliberately no deltas for final-only, summary or background-final responses.
  if(!summary&&!title&&!tool&&intent.includes('SYNC_PARTIAL'))stream.push({type:'text_delta',contentIndex:0,delta:'OBSOLETE_PARTIAL',partial:{...message,content:[{type:'text',text:'OBSOLETE_PARTIAL'}]}});
  const done=()=>stream.push(fail?{type:'error',reason:'error',error:message}:{type:'done',reason:message.stopReason,message});
  if(!summary&&!title&&!tool&&intent.includes('SYNC_TOOLS')){
   const timer=setInterval(()=>{if(existsSync(process.env.PI_SYNC_RELEASE)){clearInterval(timer);done();}},20);
   options?.signal?.addEventListener('abort',()=>{clearInterval(timer);stream.push({type:'error',reason:'aborted',error:{...message,stopReason:'aborted'}});},{once:true});
  }else done();
  return stream;
 }});
}
`;

test("canonical answers survive missing/partial deltas, background completion and restart; summaries retry three times automatically", async ({}, info) => {
  test.setTimeout(90_000);
  const profile = await makeUserDataDir();
  const workspace = await makeWorkspace("transcript-sync");
  const agentDir = join(profile, "agent");
  const log = join(profile, "summary-attempts.jsonl");
  const release = join(profile, "release-background");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(join(workspace, "README.md"), "Synthetic transcript synchronization fixture.\n");
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "sync-proof",
      defaultModel: "chat",
      enabledModels: ["sync-proof/*"],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspace, "sync-proof.ts", extension);
  const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;
  const options = {
    initialWorkspaces: [workspace],
    agentDir,
    testMode: "foreground" as const,
    envOverrides: { PI_SYNC_LOG: log, PI_SYNC_RELEASE: release },
  };
  let app = await launch(profile, options);
  try {
    let page = await app.firstWindow();
    const rename = async (title: string) => {
      const previous = await page.locator(".chat-header__title").innerText();
      const row = page.locator(".session-row--active").first();
      await row.click({ button: "right" });
      await row
        .getByRole("menu")
        .getByRole("button", { name: "Rename thread", exact: true })
        .click();
      await page.getByLabel(`Rename thread ${previous}`).fill(title);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.locator(".chat-header__title")).toHaveText(title);
    };
    const start = async (prompt: string) => {
      await page
        .getByRole("complementary")
        .getByRole("button", { name: "New thread", exact: true })
        .click();
      await page.getByLabel("New thread prompt", { exact: true }).fill(prompt);
      await page.getByRole("button", { name: "Start thread", exact: true }).click();
    };
    const final = (text: string) => page.getByTestId("transcript").getByText(text, { exact: true });
    await start("SYNC_FINAL_ONLY");
    await expect(final("FINAL_WITHOUT_DELTAS")).toHaveCount(1);
    await rename("Answer sync thread");
    await page.getByTestId("composer").fill("SYNC_PARTIAL");
    await page.getByTestId("composer").press("Enter");
    await expect(final("COMPLETE_CORRECTED_FINAL")).toHaveCount(1);
    await expect(final("OBSOLETE_PARTIAL")).toHaveCount(0);
    await start("SYNC_TOOLS");
    await rename("Tools sync thread");
    await selectSession(page, "Answer sync thread");
    await expect(final("FINAL_WITHOUT_DELTAS")).toHaveCount(1);
    await writeFile(release, "release fixture\n");
    await expect
      .poll(
        async () =>
          (await getDesktopState(page)).workspaces
            .flatMap((w) => w.sessions)
            .find((s) => s.title === "Tools sync thread")?.status,
      )
      .toBe("idle");
    await expect(final("BACKGROUND_TOOL_FINAL")).toHaveCount(0);
    await selectSession(page, "Tools sync thread");
    await expect(final("BACKGROUND_TOOL_FINAL")).toHaveCount(1);
    // Production retry schedule totals 7 seconds; this is the feature budget, not a flaky-test retry.
    await expect(page.getByTestId("work-summary-text")).toHaveText("SUMMARY_RECOVERED_ON_FOURTH", {
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("timeline-work-summary").getByText("BACKGROUND_TOOL_FINAL", { exact: true }),
    ).toHaveCount(0);
    const attempts = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { attempt: number; time: number });
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2, 3, 4]);
    for (const [i, delay] of [1000, 2000, 4000].entries())
      expect(attempts[i + 1]!.time - attempts[i]!.time).toBeGreaterThanOrEqual(delay - 10);
    await page.screenshot({ path: info.outputPath("recovered-final-and-summary.png") });
    await app.close();
    app = await launch(profile, options);
    page = await app.firstWindow();
    await selectSession(page, "Tools sync thread");
    await expect(final("BACKGROUND_TOOL_FINAL")).toHaveCount(1);
    await expect(page.getByTestId("work-summary-text")).toHaveText("SUMMARY_RECOVERED_ON_FOURTH");
    await selectSession(page, "Answer sync thread");
    await expect(final("FINAL_WITHOUT_DELTAS")).toHaveCount(1);
    await expect(final("COMPLETE_CORRECTED_FINAL")).toHaveCount(1);
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(4);
    await page.screenshot({ path: info.outputPath("restart-preserves-canonical-answers.png") });
    await info.attach("summary-attempts", {
      body: JSON.stringify(attempts, null, 2),
      contentType: "application/json",
    });
  } finally {
    await app.close();
  }
});

test("an already-loaded cache recovers dropped completion events on return without resending", async ({}, info) => {
  const profile = await makeUserDataDir();
  const workspace = await makeWorkspace("cached-sync");
  const agentDir = join(profile, "agent");
  const calls = join(profile, "chat-calls.log");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "sync-proof",
      defaultModel: "chat",
      enabledModels: ["sync-proof/*"],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspace, "sync-proof.ts", extension);
  const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;
  const app = await launch(profile, {
    initialWorkspaces: [workspace],
    agentDir,
    testMode: "foreground",
    envOverrides: { PI_SYNC_CHAT_LOG: calls },
  });
  try {
    // Test-only transport faults at the public driver's subscriber/read boundary.
    // Actual SDK generation/persistence and the actual main-store recovery still run.
    await app.electronApp.evaluate(async ({ app: electronApp }) => {
      const { createRequire } = process.getBuiltinModule("module");
      const { join } = process.getBuiltinModule("path");
      const require = createRequire(join(electronApp.getAppPath(), "out/main/main.js"));
      const { PiSdkDriver } =
        require("@pi-gui/pi-sdk-driver") as typeof import("@pi-gui/pi-sdk-driver");
      const control = { hide: true, dropped: 0 };
      (globalThis as unknown as { __syncFault: typeof control }).__syncFault = control;
      const subscribe = PiSdkDriver.prototype.subscribe;
      PiSdkDriver.prototype.subscribe = function (ref, listener) {
        return subscribe.call(this, ref, (event) => {
          if (
            control.hide &&
            (event.type === "assistantDelta" ||
              event.type === "assistantMessageEnded" ||
              event.type === "assistantMessagePersisted")
          ) {
            control.dropped++;
            return;
          }
          return listener(event);
        });
      };
      const read = PiSdkDriver.prototype.getTranscript;
      PiSdkDriver.prototype.getTranscript = async function (ref) {
        const saved = await read.call(this, ref);
        return control.hide
          ? saved.filter((row) => !(row.kind === "message" && row.role === "assistant"))
          : saved;
      };
    });
    const page = await app.firstWindow();
    const start = async () => {
      await page
        .getByRole("complementary")
        .getByRole("button", { name: "New thread", exact: true })
        .click();
      await page.getByLabel("New thread prompt", { exact: true }).fill("SYNC_FINAL_ONLY");
      await page.getByRole("button", { name: "Start thread", exact: true }).click();
      await expect(page.getByTestId("composer")).toBeVisible();
    };
    await start();
    const state = await getDesktopState(page);
    const id = state.selectedSessionId;
    await expect
      .poll(
        async () =>
          (await getDesktopState(page)).workspaces
            .flatMap((w) => w.sessions)
            .find((s) => s.id === id)?.status,
      )
      .toBe("idle");
    await expect(
      page.getByTestId("transcript").getByText("FINAL_WITHOUT_DELTAS", { exact: true }),
    ).toHaveCount(0);
    const previous = await page.locator(".chat-header__title").innerText();
    const row = page.locator(".session-row--active").first();
    await row.click({ button: "right" });
    await row.getByRole("menu").getByRole("button", { name: "Rename thread", exact: true }).click();
    await page.getByLabel(`Rename thread ${previous}`).fill("Recovered cached thread");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const dropped = await app.electronApp.evaluate(() => {
      const fault = (globalThis as unknown as { __syncFault: { hide: boolean; dropped: number } })
        .__syncFault;
      fault.hide = false;
      return fault.dropped;
    });
    expect(dropped).toBeGreaterThanOrEqual(2);
    await start();
    await expect(
      page.getByTestId("transcript").getByText("FINAL_WITHOUT_DELTAS", { exact: true }),
    ).toHaveCount(1);
    const count = (await readFile(calls, "utf8")).trim().split("\n").length;
    expect(count).toBe(2);
    await selectSession(page, "Recovered cached thread");
    await expect(
      page.getByTestId("transcript").getByText("FINAL_WITHOUT_DELTAS", { exact: true }),
    ).toHaveCount(1);
    expect((await readFile(calls, "utf8")).trim().split("\n")).toHaveLength(count);
    await page.screenshot({ path: info.outputPath("cached-answer-recovered-without-resend.png") });
  } finally {
    await app.close();
  }
});
