import { expect, test } from "@playwright/test";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import {
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  writeProjectExtension,
  selectSession,
  desktopShortcut,
} from "../helpers/electron-app";
const extension = String.raw`
import{createAssistantMessageEventStream}from'@earendil-works/pi-ai';import{appendFileSync}from'node:fs';
export default function(pi){pi.registerProvider('access-proof',{api:'access-proof',apiKey:'TEST',baseUrl:'http://127.0.0.1:9/never-contact',models:['chat','reviewer'].map(id=>({id,name:id,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:2048})),streamSimple(model,context){
 const system=JSON.stringify(context);const review=system.includes('action safety reviewer');const summary=system.includes('collapsed UI bar');const title=system.includes('UI thread titles');
 const index=context.messages.findLastIndex(m=>m.role==='user'&&/write-project|write-second|write-read-only|command-deny|command-approve|command-auto|external/.test(JSON.stringify(m.content)));const intent=JSON.stringify(context.messages[index]?.content||'');const finished=context.messages.slice(index+1).some(m=>m.role==='toolResult');
 if(review)appendFileSync(process.env.PI_ACCESS_REVIEW_LOG,model.id+'\n');
 const tag=intent.includes('command-auto')?'command-auto':intent.includes('command-approve')?'command-approve':'command-deny';
 const command=intent.includes('command')||intent.includes('external');const args=command?{command:'printf modified > '+JSON.stringify(intent.includes('external')?process.env.PI_ACCESS_OUTSIDE_FILE:tag+'.txt'),timeout:4}:{path:'allowed.txt',content:intent.includes('write-read-only')?'forbidden-change':'project-change'};
 const text=review?'{"decision":"allow","risk":"low","reason":"bounded local fixture"}':title?(intent.includes('write-second')?'Second autonomy thread':'First autonomy thread'):summary?'Completed the requested local action.':'ACCESS_DONE';
 const content=review||summary||title||finished?[{type:'text',text}]:[{type:'toolCall',id:'access-action-'+index,name:command?'bash':'write',arguments:args}];
 const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content,stopReason:content[0].type==='text'?'stop':'toolUse',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now()};
 const stream=createAssistantMessageEventStream();stream.push({type:'start',partial:{...message,content:[]}});if(content[0].type==='text')stream.push({type:'text_delta',contentIndex:0,delta:text,partial:message});stream.push({type:'done',reason:message.stopReason,message});return stream;
}});}
`;
test("access modes, one-time approval, reviewer isolation and restart on Electron", async ({}, testInfo) => {
  test.setTimeout(150000);
  const userDataDir = await makeUserDataDir();
  const workspace = await makeWorkspace("access-proof");
  const agentDir = join(userDataDir, "agent");
  const log = join(userDataDir, "reviews.log");
  const outside = join(userDataDir, "outside.txt");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(userDataDir, "autonomy.json"),
    JSON.stringify({ version: 1, revision: 0, defaultMode: "read-only", sessions: {} }),
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "access-proof",
      defaultModel: "chat",
      enabledModels: ["access-proof/*"],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspace, "access-proof.ts", extension);
  const options = {
    initialWorkspaces: [workspace],
    agentDir,
    testMode: "foreground" as const,
    envOverrides: { PI_ACCESS_REVIEW_LOG: log, PI_ACCESS_OUTSIDE_FILE: outside },
  };
  const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;
  let harness = await launch(userDataDir, options);
  try {
    let window = await harness.firstWindow();
    const start = async (prompt: string) => {
      await window
        .getByRole("complementary")
        .getByRole("button", { name: "New thread", exact: true })
        .click();
      await window.getByLabel("New thread prompt", { exact: true }).fill(prompt);
      await window.getByRole("button", { name: "Start thread", exact: true }).click();
    };
    const send = async (prompt: string) => {
      const composer = window.getByTestId("composer");
      await composer.fill(prompt);
      await composer.press("Enter");
    };
    const renameCurrent = async (title: string) => {
      const previous = await window.locator(".chat-header__title").innerText();
      const row = window.locator(".session-row", { hasText: previous }).first();
      await row.click({ button: "right" });
      await row
        .getByRole("menu")
        .getByRole("button", { name: "Rename thread", exact: true })
        .click();
      await window.getByLabel(`Rename thread ${previous}`).fill(title);
      await window.getByRole("button", { name: "Save", exact: true }).click();
      await expect(window.locator(".chat-header__title")).toHaveText(title);
    };
    const done = () => window.getByTestId("transcript").getByText("ACCESS_DONE", { exact: true });
    const mode = () => window.getByLabel("Access mode", { exact: true });
    const reviewer = () =>
      window.getByRole("button", { name: "Approval review model", exact: true });
    const chooseReviewer = async () => {
      await reviewer().click();
      await window
        .locator(".composer .model-selector__dropdown")
        .getByRole("button", { name: /reviewer$/ })
        .click();
      await expect(reviewer()).toContainText("reviewer");
    };
    await start("write-project");
    await expect(done()).toHaveCount(1);
    // The v1 Read only default retains its old permission under Project only.
    await expect(mode()).toHaveValue("project-only");
    await expect(mode().locator("option")).toHaveText([
      "Read only",
      "Project only",
      "Auto access",
      "Full access",
    ]);
    expect(await readFile(join(workspace, "allowed.txt"), "utf8")).toBe("project-change");
    await renameCurrent("First autonomy thread");
    const dialog = window.getByTestId("extension-dialog");
    await mode().selectOption("read-only");
    await send("write-read-only");
    await expect(dialog).toContainText("Approve write once?");
    expect(await readFile(join(workspace, "allowed.txt"), "utf8")).toBe("project-change");
    await dialog.getByTestId("extension-dialog-cancel").click();
    await expect(done()).toHaveCount(2);
    await expect(mode()).toHaveValue("read-only");
    expect(await readFile(join(workspace, "allowed.txt"), "utf8")).toBe("project-change");
    await window.screenshot({ path: testInfo.outputPath("true-read-only-denied-edit.png") });
    await mode().selectOption("project-only");
    await send("command-deny");
    await expect(dialog).toContainText("Approve bash once?");
    await expect(dialog).toContainText("command-deny.txt");
    await expect(dialog.getByTestId("extension-dialog-cancel")).toBeFocused();
    await expect(access(join(workspace, "command-deny.txt"))).rejects.toThrow();
    await window.screenshot({ path: testInfo.outputPath("one-time-approval.png") });
    await dialog.getByTestId("extension-dialog-cancel").click();
    await expect(done()).toHaveCount(3);
    await expect(access(join(workspace, "command-deny.txt"))).rejects.toThrow();
    await send("command-approve");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("extension-dialog-confirm").click();
    await expect(done()).toHaveCount(4);
    expect(await readFile(join(workspace, "command-approve.txt"), "utf8")).toBe("modified");
    await mode().selectOption("auto");
    await chooseReviewer();
    await send("command-auto");
    await expect(done()).toHaveCount(5);
    expect(await readFile(join(workspace, "command-auto.txt"), "utf8")).toBe("modified");
    expect((await readFile(log, "utf8")).trim()).toBe("reviewer");
    await expect(dialog).toHaveCount(0);
    await window.screenshot({ path: testInfo.outputPath("auto-review-model.png") });
    await mode().selectOption("full-access");
    const warning = window.getByRole("alertdialog", { name: "Enable full access?" });
    await expect(warning.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await warning.press("Escape");
    await expect(warning).toHaveCount(0);
    await expect(mode()).toHaveValue("auto");
    await mode().selectOption("full-access");
    await window.getByRole("button", { name: "Enable full access", exact: true }).click();
    await expect(mode()).toHaveValue("full-access");
    await send("external");
    await expect(done()).toHaveCount(6);
    expect(await readFile(outside, "utf8")).toBe("modified");
    expect((await readFile(log, "utf8")).trim()).toBe("reviewer");
    await mode().selectOption("auto");
    await reviewer().click();
    await window.getByRole("button", { name: "Same as chat", exact: true }).click();
    await expect(reviewer()).toContainText("Same as chat");
    await chooseReviewer();
    await start("write-second");
    await expect(done()).toHaveCount(1);
    await expect(mode()).toHaveValue("project-only");
    await renameCurrent("Second autonomy thread");
    await mode().selectOption("read-only");
    await selectSession(window, "First autonomy thread");
    await expect(mode()).toHaveValue("auto");
    await harness.close();
    harness = await launch(userDataDir, options);
    window = await harness.firstWindow();
    await selectSession(window, "First autonomy thread");
    await expect(mode()).toHaveValue("auto");
    await expect(reviewer()).toContainText("reviewer");
    await selectSession(window, "Second autonomy thread");
    await expect(mode()).toHaveValue("read-only");
    await selectSession(window, "First autonomy thread");
    await expect(mode()).toHaveValue("auto");
    await expect(window.getByRole("button", { name: "Summary model", exact: true })).toContainText(
      "Same as chat",
    );
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByLabel("Default agent access", { exact: true })).toHaveValue(
      "project-only",
    );
    await window.screenshot({ path: testInfo.outputPath("default-access-settings.png") });
  } finally {
    await harness.close();
  }
});
