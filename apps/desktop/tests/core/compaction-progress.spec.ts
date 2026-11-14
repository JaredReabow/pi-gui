import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  pasteTinyPng,
  seedAgentDir,
  selectSession,
  waitForTimelineLayout,
  writeProjectExtension,
} from "../helpers/electron-app";

// Genuine AgentSession compact()/retry/abort, with a credential-free gated provider.
// Only the narrow negative-admission assertion calls IPC directly: a current renderer
// correctly blocks that send before IPC, so this independently tests a stale client.
const extension = String.raw`
import { createAssistantMessageEventStream, getCurrentTools } from '@earendil-works/pi-ai';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
let compactCalls=0;
export default function(pi) {
 pi.registerProvider('compaction-proof',{api:'compaction-proof',apiKey:'TEST_ONLY',baseUrl:'http://127.0.0.1:9/never-contact',
 models:['chat','summary'].map(id=>({id,name:id==='summary'?'Progress summary':'Progress chat',reasoning:true,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:16384})),
 streamSimple(model,context,options) {
  const all=JSON.stringify(context);
  const visual=all.includes('collapsed UI bar');const title=all.includes('UI thread titles');
  const compact=!visual&&!title&&all.includes('You are a context summarization assistant.');
  // Runtime context can append an auxiliary user message after the actual prompt.
  const index=context.messages.findLastIndex(m=>m.role==='user'&&/FIRST_THREAD|SECOND_THREAD|TOOLS_FIXTURE|CHAT_BAD_REQUEST|KEPT_DRAFT|KEEP_NEW_INPUT|DRAFT_DURING/.test(JSON.stringify(m.content)));
  const intent=JSON.stringify(context.messages[index]?.content||'');
  const finished=context.messages.slice(index+1).some(m=>m.role==='toolResult');
  const tool=!visual&&!title&&!compact&&intent.includes('TOOLS_FIXTURE')&&!finished;
  const mode=readFileSync(process.env.PI_COMPACT_CONTROL,'utf8').trim();
  const call=compact?++compactCalls:0;
  const error=compact&&(mode.includes('bad-request')||mode==='transient')?(mode==='transient'?'HTTP 503: provider temporarily unavailable':'codex-router API error (400): 400 {"detail":"Bad Request"}'):!visual&&!title&&!compact&&intent.includes('CHAT_BAD_REQUEST')?'codex-router API error (400): 400 {"detail":"Bad Request"}':undefined;
  const kind=compact?'compact':visual?'visual':title?'title':'chat';
  appendFileSync(process.env.PI_COMPACT_LOG,JSON.stringify({kind,call,model:model.id,reasoning:options?.reasoning||'off',maxTokens:options?.maxTokens||model.maxTokens,tools:getCurrentTools(context.messages).length,focusRetained:all.includes('PRESERVE_FOCUS_SENTINEL')})+'\n');
  const text=compact?'## Goal\nPreserve synthetic goal.\n## Progress\nInspected fixture.\n## Next Steps\nContinue.':visual?'MEDIUM_SUMMARY_OK':title?(intent.includes('SECOND_THREAD')?'Other progress thread':'First progress thread'):tool?'Reading README.':intent.includes('SECOND_THREAD')?'SECOND_THREAD_ANSWER':intent.includes('TOOLS_FIXTURE')?'TOOLS_FINAL':intent.includes('FIRST_THREAD')?'FIRST_THREAD_ANSWER':'FOLLOWUP_ANSWER';
  const content=error?[]:tool?[{type:'text',text},{type:'toolCall',id:'fixture-read',name:'read',arguments:{path:'README.md'}}]:[{type:'text',text}];
  const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content,stopReason:error?'error':tool?'toolUse':'stop',...(error?{errorMessage:error}:{}),usage:{input:100,output:10,cacheRead:0,cacheWrite:0,totalTokens:110,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now()};
  const stream=createAssistantMessageEventStream();stream.push({type:'start',partial:{...message,content:[]}});
  let settled=false,timer;
  const done=(abort=false)=>{if(settled)return;settled=true;if(timer)clearInterval(timer);const result=abort?{...message,content:[],stopReason:'aborted',errorMessage:'Operation aborted'}:message;stream.push(result.stopReason==='error'||result.stopReason==='aborted'?{type:'error',reason:result.stopReason,error:result}:{type:'done',reason:result.stopReason,message:result});};
  if(compact&&mode.startsWith('gated')){timer=setInterval(()=>{if(existsSync(process.env.PI_COMPACT_RELEASE+'.'+call))done();},20);if(options?.signal?.aborted)done(true);else options?.signal?.addEventListener('abort',()=>done(true),{once:true});}else done();
  return stream;
 }});
}
`;

type Request = {
  kind: string;
  call: number;
  model: string;
  reasoning: string;
  maxTokens: number;
  tools: number;
  focusRetained: boolean;
};
async function setup(mode: string, retryDelay = 1000) {
  const profile = await makeUserDataDir();
  const workspace = await makeWorkspace("compaction-progress");
  const agentDir = join(profile, "agent"),
    control = join(profile, "compaction-control"),
    log = join(profile, "requests.jsonl"),
    release = join(profile, "release-summary");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(workspace, "README.md"),
    "Synthetic fixture read for medium summary proof.\n",
  );
  await writeFile(control, mode);
  await writeFile(log, "");
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "compaction-proof",
      defaultModel: "chat",
      defaultThinkingLevel: "high",
      enabledModels: ["compaction-proof/*"],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false, keepRecentTokens: 0 },
      retry: { enabled: true, maxRetries: 3, baseDelayMs: retryDelay },
    }),
  );
  await writeProjectExtension(workspace, "compaction-proof.ts", extension);
  const options = {
    initialWorkspaces: [workspace],
    agentDir,
    testMode: "foreground" as const,
    envOverrides: { PI_COMPACT_CONTROL: control, PI_COMPACT_LOG: log, PI_COMPACT_RELEASE: release },
  };
  const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;
  return {
    profile,
    control,
    release,
    options,
    launch,
    requests: async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Request),
  };
}
async function start(page: Page, prompt: string) {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "New thread", exact: true })
    .click();
  await page.getByLabel("New thread prompt", { exact: true }).fill(prompt);
  await page.getByRole("button", { name: "Start thread", exact: true }).click();
}
async function rename(page: Page, title: string) {
  const previous = await page.locator(".chat-header__title").innerText();
  const row = page.locator(".session-row--active").first();
  await row.click({ button: "right" });
  await row.getByRole("menu").getByRole("button", { name: "Rename thread", exact: true }).click();
  await page.getByLabel(`Rename thread ${previous}`).fill(title);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".chat-header__title")).toHaveText(title);
}
async function selected(page: Page) {
  const state = await getDesktopState(page);
  return state.workspaces.flatMap((w) => w.sessions).find((s) => s.id === state.selectedSessionId)!;
}

test("native manual compaction shows honest progress, keeps drafts/images, isolates sessions, stops and survives restart without a phantom job", async ({}, info) => {
  test.setTimeout(90000);
  const h = await setup("gated");
  let app = await h.launch(h.profile, h.options);
  try {
    let page = await app.firstWindow();
    await start(page, "FIRST_THREAD synthetic compaction fixture.");
    await expect(page.getByTestId("transcript")).toContainText("FIRST_THREAD_ANSWER");
    await rename(page, "First progress thread");
    const first = await selected(page);
    const composer = page.getByTestId("composer");
    await composer.fill("/compact");
    await composer.press("Enter");
    await expect(page.getByRole("progressbar", { name: "Context compaction" })).toBeVisible();
    await expect(page.getByTestId("compaction-request-mode")).toContainText("Reasoning: medium");
    await expect(page.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow", /.+/);
    const draft = "KEPT_DRAFT_DURING_COMPACTION";
    await composer.fill(draft);
    await pasteTinyPng(page, "compaction-draft.png");
    await expect(page.locator(".composer-attachment--image")).toHaveCount(1);
    await expect(page.getByTestId("send")).toBeDisabled();
    await composer.press("Enter");
    await expect(composer).toHaveValue(draft);
    await expect(page.locator(".composer-attachment--image")).toHaveCount(1);
    await expect.poll(async () => (await getDesktopState(page)).composerDraft).toBe(draft);
    const rejected = await page.evaluate((text) => window.piApp.submitComposer(text), draft);
    expect(rejected.lastError).toContain("Your draft and attachments are kept");
    const heldTranscript = await getSelectedTranscript(page);
    expect(heldTranscript).not.toBeNull();
    expect(
      heldTranscript!.transcript.filter(
        (m) => m.kind === "message" && m.role === "user" && m.text === draft,
      ),
    ).toHaveLength(0);
    expect((await h.requests()).filter((r) => r.kind === "chat")).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("native-compaction-draft-preserved.png") });

    // Navigation must not wait behind the long-running /compact IPC operation.
    await start(page, "SECOND_THREAD synthetic isolation fixture.");
    await expect(page.getByTestId("transcript")).toContainText("SECOND_THREAD_ANSWER");
    await rename(page, "Other progress thread");
    await expect(page.getByTestId("compaction-progress")).toHaveCount(0);
    expect(
      (await getDesktopState(page)).workspaces
        .flatMap((w) => w.sessions)
        .find((s) => s.id === first.id)?.status,
    ).toBe("running");
    await selectSession(page, "First progress thread");
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("composer")).toHaveValue(draft);
    await page.getByRole("button", { name: "Stop compaction", exact: true }).click();
    await expect(page.getByTestId("compaction-progress")).toHaveAttribute("data-phase", "stopped");
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByTestId("composer")).toHaveValue(draft);
    await expect(page.locator(".composer-attachment--image")).toHaveCount(1);
    await expect.poll(async () => (await selected(page)).status).toBe("idle");
    await expect(page.getByTestId("transcript")).not.toContainText("Compacted session context");
    expect((await selected(page)).config?.thinkingLevel).toBe(first.config?.thinkingLevel);
    await page.screenshot({ path: info.outputPath("compaction-stopped-with-draft.png") });
    await app.close();
    app = await h.launch(h.profile, h.options);
    page = await app.firstWindow();
    await selectSession(page, "First progress thread");
    await expect(page.getByTestId("compaction-progress")).toHaveCount(0);
    await expect(page.getByTestId("composer")).toHaveValue(draft);
    await expect(page.locator(".composer-attachment--image")).toHaveCount(1);
    await page.getByTestId("composer").press("Enter");
    await expect(page.getByTestId("transcript")).toContainText("FOLLOWUP_ANSWER");
    await expect(page.locator(".composer-attachment--image")).toHaveCount(0);
    expect(
      (await getSelectedTranscript(page))!.transcript.filter(
        (m) => m.kind === "message" && m.role === "user" && m.text === draft,
      ),
    ).toHaveLength(1);
    await page.getByTestId("composer").fill("CHAT_BAD_REQUEST");
    await page.getByTestId("composer").press("Enter");
    // An accepted chat turn's provider failure belongs in the transcript, not an
    // unsent-draft banner. The original native error remains in the source log.
    await expect(page.getByTestId("transcript")).toContainText("HTTP 400");
    await expect(page.getByTestId("transcript")).toContainText("does not identify the cause");
    await expect(page.getByTestId("transcript")).toContainText("API: compaction-proof");
    await page.screenshot({ path: info.outputPath("actionable-chat-400.png") });
  } finally {
    await app.close();
  }
});

test("summary mode is visible; failed context compaction keeps new input and retries the selected model/focus without consuming it", async ({}, info) => {
  test.setTimeout(60000);
  const h = await setup("gated-bad-request");
  const app = await h.launch(h.profile, h.options);
  try {
    const page = await app.firstWindow();
    await start(page, "TOOLS_FIXTURE inspect README only.");
    await expect(page.getByTestId("transcript")).toContainText("TOOLS_FINAL");
    const summary = page.getByTestId("timeline-work-summary");
    await expect(summary.getByTestId("work-summary-text")).toHaveText("MEDIUM_SUMMARY_OK");
    await waitForTimelineLayout(page);
    await summary.locator(".timeline-tool-group__header").click();
    await expect(summary.getByTestId("work-summary-request-mode")).toContainText(
      "Reasoning: medium",
    );
    await page.getByRole("button", { name: "Summary model", exact: true }).click();
    await page
      .locator(".composer .model-selector__dropdown")
      .getByRole("button", { name: /Progress summary$/ })
      .click();
    await expect(summary).toContainText("Summary model: compaction-proof/summary");
    const before = await selected(page);
    await page.getByTestId("composer").fill("/compact PRESERVE_FOCUS_SENTINEL");
    await page.getByTestId("composer").press("Enter");
    await expect(page.getByRole("progressbar")).toBeVisible();
    const draft = "KEEP_NEW_INPUT_ON_SUMMARY_FAILURE";
    await page.getByTestId("composer").fill(draft);
    await pasteTinyPng(page, "failure-kept.png");
    await expect.poll(async () => (await getDesktopState(page)).composerDraft).toBe(draft);
    await writeFile(`${h.release}.1`, "release synthetic failed summary\n");
    await expect(page.getByTestId("compaction-progress")).toHaveAttribute("data-phase", "failed");
    await page
      .getByTestId("compaction-progress")
      .getByText("Error details", { exact: true })
      .click();
    await expect(page.getByTestId("compaction-progress")).toContainText("HTTP 400");
    await expect(page.getByTestId("compaction-progress")).toContainText("Reasoning: medium");
    await expect(page.getByTestId("compaction-progress")).toContainText("compaction-proof/summary");
    await expect(page.getByTestId("composer")).toHaveValue(draft);
    await expect(page.locator(".composer-attachment--image")).toHaveCount(1);
    await expect(page.getByTestId("transcript")).toContainText("TOOLS_FINAL");
    await page.screenshot({ path: info.outputPath("compaction-failure-actionable.png") });
    await writeFile(h.control, "gated");
    await page.getByRole("button", { name: "Retry compaction", exact: true }).click();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("composer")).toHaveValue(draft);
    await expect
      .poll(async () => (await h.requests()).filter((r) => r.kind === "compact").length)
      .toBe(2);
    // Pi may summarize history and a split-turn prefix in separate calls. Gate
    // the first retry call, then let its genuine continuation finish normally.
    await writeFile(h.control, "success");
    await writeFile(`${h.release}.2`, "release successful retry\n");
    await expect(page.getByTestId("compaction-progress")).toHaveCount(0);
    await expect(page.getByTestId("transcript")).toContainText("Compacted session context");
    await expect(page.getByTestId("composer")).toHaveValue(draft);
    await expect(page.locator(".composer-attachment--image")).toHaveCount(1);
    expect((await selected(page)).config).toEqual(before.config);
    const requests = (await h.requests()).filter(
      (r) => r.kind === "compact" || r.kind === "visual",
    );
    expect(
      requests.every((r) => r.reasoning === "medium" && r.tools === 0 && r.maxTokens >= 8192),
    ).toBe(true);
    const compact = requests.filter((r) => r.kind === "compact");
    expect(compact.map((r) => ({ model: r.model, focus: r.focusRetained }))).toEqual([
      { model: "summary", focus: true },
      { model: "summary", focus: true },
      { model: "summary", focus: true },
    ]);
    await info.attach("summary-request-metadata", {
      body: JSON.stringify(requests, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("compaction-recovered-draft-kept.png") });
  } finally {
    await app.close();
  }
});

test("native retry backoff is visible and Stop cancels it without a second request", async ({}, info) => {
  test.setTimeout(45000);
  const h = await setup("transient", 60000);
  const app = await h.launch(h.profile, h.options);
  const page = await app.firstWindow();
  await page.evaluate(() => {
    const samples: unknown[] = [];
    Object.assign(window, { compactionDraftSamples: samples });
    window.piApp.onStateChanged((state) => {
      samples.push({
        event: "snapshot",
        time: performance.now(),
        draft: state.composerDraft,
        source: state.composerDraftSyncSource,
        nonce: state.composerDraftSyncNonce,
        revision: state.revision,
        workspace: state.selectedWorkspaceId,
        session: state.selectedSessionId,
        visible: document.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')?.value,
      });
    });
    document.addEventListener("input", (event) => {
      const element = event.target;
      if (element instanceof HTMLTextAreaElement && element.dataset.testid === "composer")
        samples.push({ event: "input", time: performance.now(), value: element.value });
    });
  });
  try {
    await start(page, "FIRST_THREAD retry backoff fixture.");
    await expect(page.getByTestId("transcript")).toContainText("FIRST_THREAD_ANSWER");
    await page.getByTestId("composer").fill("/compact");
    await page.getByTestId("composer").press("Enter");
    await expect(page.getByTestId("compaction-progress")).toHaveAttribute("data-phase", "retrying");
    await expect(page.getByTestId("compaction-progress")).toContainText(
      /Summary retry \d+ of \d+ scheduled/,
    );
    await expect(page.getByRole("progressbar")).toBeVisible();
    // Prevent debounce from saving first: a late slash-menu result must preserve
    // genuinely unsaved input, not pass only because a slow screenshot let it save.
    await page.clock.install();
    await page.clock.pauseAt(Date.now() + 1000);
    await page.getByTestId("composer").fill("DRAFT_DURING_NATIVE_BACKOFF");
    expect((await getDesktopState(page)).composerDraft).not.toBe("DRAFT_DURING_NATIVE_BACKOFF");
    await page.screenshot({ path: info.outputPath("genuine-native-retry-backoff.png") });
    await page.getByRole("button", { name: "Stop compaction", exact: true }).click();
    await expect(page.getByTestId("compaction-progress")).toHaveAttribute("data-phase", "stopped");
    // Native Stop can publish before the original /compact IPC reply. Wait for
    // its visible command receipt, then drain the reply and two render frames.
    await expect(page.getByTestId("transcript")).toContainText("Context compaction stopped");
    await getDesktopState(page);
    await page.clock.runFor(32);
    await expect(page.getByTestId("composer")).toHaveValue("DRAFT_DURING_NATIVE_BACKOFF");
    await expect.poll(async () => (await selected(page)).status).toBe("idle");
    expect((await h.requests()).filter((r) => r.kind === "compact")).toHaveLength(1);
  } finally {
    const observations = JSON.stringify(
      await page.evaluate(() => Reflect.get(window, "compactionDraftSamples") as unknown),
      null,
      2,
    );
    const path = info.outputPath("draft-observations.json");
    await writeFile(path, observations);
    await info.attach("draft-observations", { path, contentType: "application/json" });
    await app.close();
  }
});
