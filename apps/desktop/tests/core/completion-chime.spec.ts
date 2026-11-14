import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  desktopShortcut,
  seedAgentDir,
  writeProjectExtension,
  getDesktopState,
} from "../helpers/electron-app";
import { createThread, selectSessionByTitle } from "../helpers/session-event-test-helpers";
import {
  emitCompletedEvent,
  emitFailedEvent,
  emitRunningEvent,
} from "../helpers/notification-events";

interface AudioProof {
  starts: number;
  ends: number;
  frames: number;
  peak: number;
  elapsed: number;
  packets: number;
}
async function observeAudio(page: Page) {
  await page.evaluate(() => {
    const proof: AudioProof = { starts: 0, ends: 0, frames: 0, peak: 0, elapsed: 0, packets: 0 };
    Object.assign(window, { __chimeProof: proof });
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      override createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        let began = 0;
        source.start = (when, offset, duration) => {
          proof.starts++;
          began = this.currentTime;
          const data = source.buffer?.getChannelData(0);
          proof.frames += data?.length ?? 0;
          for (const sample of data ?? []) proof.peak = Math.max(proof.peak, Math.abs(sample));
          start(when, offset, duration);
        };
        source.addEventListener("ended", () => {
          proof.ends++;
          proof.elapsed += this.currentTime - began;
        });
        return source;
      }
    };
    window.piApp!.onCompletionChime(() => proof.packets++);
  });
}
async function proof(page: Page): Promise<AudioProof> {
  return page.evaluate(() => (window as Window & { __chimeProof: AudioProof }).__chimeProof);
}
async function notifications(page: Page) {
  await page.keyboard.press(desktopShortcut(","));
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Chime sound", exact: true })).toBeVisible();
}
async function quietVolume(page: Page) {
  const volume = page.getByRole("slider", { name: "Chime volume", exact: true });
  await volume.focus();
  await volume.press("Home");
  for (let i = 0; i < 5; i++) await volume.press("ArrowRight");
  await expect(volume).toHaveValue("5");
  await volume.press("Tab");
  await expect
    .poll(async () => (await getDesktopState(page)).notificationPreferences.chimeVolume)
    .toBe(5);
}
const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;

test("bell, sound/volume/preview and genuine Web Audio persist without startup replay", async ({}, info) => {
  test.setTimeout(120000);
  const userData = await makeUserDataDir();
  const workspace = await makeWorkspace("chime-ui");
  const options = { initialWorkspaces: [workspace], testMode: "foreground" as const };
  let harness = await launch(userData, options);
  try {
    let page = await harness.firstWindow();
    await writeFile(
      info.outputPath("desktop-identity.json"),
      JSON.stringify(
        {
          ...(await harness.inspectIdentity()),
          runtime: await harness.electronApp.evaluate(() => ({
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
          })),
        },
        null,
        2,
      ),
    );
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("[completion-chime]")) errors.push(message.text());
    });
    const first = await createThread(page, "Chime Alpha");
    await createThread(page, "Chime Beta");
    await observeAudio(page);
    const bell = page.getByRole("button", { name: "Mute completion chimes", exact: true });
    await expect(bell).toHaveAttribute("aria-pressed", "true");
    const position = await bell.boundingBox();
    const send = await page.getByTestId("send").boundingBox();
    expect(position && send && position.x + position.width <= send.x).toBeTruthy();
    expect((await getDesktopState(page)).notificationPreferences).toMatchObject({
      chimeEnabled: true,
      chimeSound: "typewriter-return",
      chimeVolume: 60,
    });
    await notifications(page);
    const sounds = page.getByRole("combobox", { name: "Chime sound", exact: true });
    await expect(sounds).toHaveValue("typewriter-return");
    await expect(sounds.locator("option")).toHaveCount(14);
    await quietVolume(page);
    await sounds.selectOption("air-horn");
    await expect
      .poll(async () => (await getDesktopState(page)).notificationPreferences.chimeSound)
      .toBe("air-horn");
    // Selecting even the loudest option never auto-previews.
    expect((await proof(page)).starts).toBe(0);
    await sounds.selectOption("typewriter-return");
    await expect
      .poll(async () => (await getDesktopState(page)).notificationPreferences.chimeSound)
      .toBe("typewriter-return");
    await expect(sounds).toHaveValue("typewriter-return");
    await page.screenshot({ path: info.outputPath("chime-settings.png") });
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    const id = await emitRunningEvent(harness, first, "foreground-independent");
    expect((await proof(page)).packets).toBe(0);
    await emitCompletedEvent(harness, first, "foreground-independent", id);
    await expect.poll(async () => (await proof(page)).starts).toBe(1);
    await expect.poll(async () => (await proof(page)).ends).toBe(1);
    expect(await proof(page)).toMatchObject({ starts: 1, ends: 1, packets: 1 });
    expect((await proof(page)).frames).toBe(30000);
    expect((await proof(page)).peak).toBeGreaterThan(0.01);
    expect((await proof(page)).elapsed).toBeGreaterThan(0.5);
    const audioEvidence = info.outputPath("audio-graph-proof.json");
    await writeFile(audioEvidence, JSON.stringify(await proof(page), null, 2));
    await info.attach("audio-graph-proof.json", {
      path: audioEvidence,
      contentType: "application/json",
    });
    await emitCompletedEvent(harness, first, "duplicate", id);
    // An actual later event settles the duplicate assertion without relying on a sleep.
    await emitFailedEvent(harness, first, "failure", "Synthetic chime failure");
    expect((await proof(page)).packets).toBe(1);
    await notifications(page);
    await page.getByRole("switch", { name: "Play completion chimes", exact: true }).click();
    await expect(
      page.getByRole("switch", { name: "Play completion chimes", exact: true }),
    ).not.toBeChecked();
    await page.getByRole("button", { name: "Preview chime", exact: true }).click();
    await expect.poll(async () => (await proof(page)).starts).toBe(2);
    // Repeated previews exercise the real three-voice cap without hanging or leaking nodes.
    for (let i = 0; i < 3; i++)
      await page.getByRole("button", { name: "Preview chime", exact: true }).click();
    await expect.poll(async () => (await proof(page)).starts).toBe(5);
    await emitCompletedEvent(harness, first, "muted", "muted-run");
    expect((await proof(page)).packets).toBe(1);
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Enable completion chimes", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Enable completion chimes", exact: true }).click();
    await notifications(page);
    await expect(
      page.getByRole("switch", { name: "Play completion chimes", exact: true }),
    ).toBeChecked();
    await emitCompletedEvent(harness, first, "muted replay", "muted-run");
    expect((await proof(page)).packets).toBe(1);
    // Background completion while Settings is open is also eligible.
    await emitCompletedEvent(harness, first, "settings-background", "background-run");
    await expect.poll(async () => (await proof(page)).packets).toBe(2);
    await page
      .getByRole("combobox", { name: "Chime sound", exact: true })
      .selectOption("felt-bell");
    await page.getByRole("switch", { name: "Play completion chimes", exact: true }).click();
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await page.setViewportSize({ width: 760, height: 800 });
    // Collapse through this window's actual control. Main's base preference can
    // differ from the window-scoped state, and a collapsed sidebar opens no drawer.
    const sidebarToggle = page.getByTestId("sidebar-toggle");
    if ((await sidebarToggle.getAttribute("aria-pressed")) === "true") await sidebarToggle.click();
    await expect(sidebarToggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("sidebar-drawer-backdrop")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Enable completion chimes", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("bell-muted-narrow.png") });
    expect(errors).toEqual([]);
    await harness.close();
    harness = await launch(userData, options);
    page = await harness.firstWindow();
    await observeAudio(page);
    await selectSessionByTitle(page, "Chime Beta");
    await expect(
      page.getByRole("button", { name: "Enable completion chimes", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await notifications(page);
    await expect(page.getByRole("combobox", { name: "Chime sound", exact: true })).toHaveValue(
      "felt-bell",
    );
    await expect(page.getByRole("slider", { name: "Chime volume", exact: true })).toHaveValue("5");
    expect(await proof(page)).toMatchObject({ packets: 0, starts: 0 });
  } finally {
    await harness.close();
  }
});

const extension = String.raw`
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
 pi.registerProvider("chime-proof", { api:"chime-proof", apiKey:"TEST_ONLY", baseUrl:"http://127.0.0.1:9/never-contact",
 models:[{id:"chat",name:"Chime proof",reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:4096}],
 streamSimple(model,context,options) {
  // Runtime policy messages may follow the human prompt. Find the newest fixture request.
  const last=context.messages.filter(m=>m.role==="user" && /(?:hold|fail|success)-proof/.test(JSON.stringify(m.content))).at(-1);
  const text=JSON.stringify(last?.content ?? "");
  const held=text.includes("hold-proof"); const failed=text.includes("fail-proof");
  const response={role:"assistant",content:[{type:"text",text:held?"Waiting until stopped":"CHIME_FINISHED"}],api:model.api,provider:model.provider,model:model.id,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:failed?"error":"stop",timestamp:Date.now(),...(failed?{errorMessage:"Synthetic provider failure"}:{})};
  const stream=createAssistantMessageEventStream();
  stream.push({type:"start",partial:response});
  stream.push({type:"text_delta",contentIndex:0,delta:response.content[0].text,partial:response});
  const finish=()=>stream.push(failed?{type:"error",reason:"error",error:response}:{type:"done",reason:"stop",message:response});
  if(held){ const timer=setTimeout(finish,15000);options?.signal?.addEventListener("abort",()=>{clearTimeout(timer);stream.push({type:"error",reason:"aborted",error:{...response,stopReason:"aborted",errorMessage:"Stopped"}});},{once:true}); } else finish();
  return stream;
 }});
}
`;

test("settled SDK turn chimes once; user Stop and provider failure stay silent", async () => {
  test.setTimeout(90000);
  const userData = await makeUserDataDir();
  const workspace = await makeWorkspace("chime-runtime");
  const agent = join(userData, "agent");
  await seedAgentDir(agent, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agent, "settings.json"),
    JSON.stringify({
      defaultProvider: "chime-proof",
      defaultModel: "chat",
      packages: [],
      retry: { enabled: false },
      cacheWarming: "off",
    }),
  );
  await writeProjectExtension(workspace, "chime-proof.ts", extension);
  const harness = await launch(userData, {
    initialWorkspaces: [workspace],
    agentDir: agent,
    testMode: "foreground",
  });
  try {
    const page = await harness.firstWindow();
    await observeAudio(page);
    await notifications(page);
    await quietVolume(page);
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    await page.getByLabel("New thread prompt", { exact: true }).fill("success-proof");
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect(page.getByTestId("transcript")).toContainText("CHIME_FINISHED");
    await expect.poll(async () => (await proof(page)).packets).toBe(1);
    await expect.poll(async () => (await proof(page)).ends).toBe(1);
    await page.getByTestId("composer").fill("hold-proof");
    await page.getByTestId("send").click();
    await expect(page.getByTestId("transcript")).toContainText("Waiting until stopped");
    await expect(page.getByRole("button", { name: "Stop run", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop run", exact: true }).click();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
    expect((await proof(page)).packets).toBe(1);
    await page.getByTestId("composer").fill("fail-proof");
    await page.getByTestId("send").click();
    await expect
      .poll(async () =>
        (await getDesktopState(page)).workspaces
          .flatMap((w) => w.sessions)
          .some((s) => s.status === "failed"),
      )
      .toBe(true);
    expect((await proof(page)).packets).toBe(1);
  } finally {
    await harness.close();
  }
});
