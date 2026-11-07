import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  writeProjectExtension,
  desktopShortcut,
  waitForTimelineLayout,
  selectSession,
} from "../helpers/electron-app";

const extension = String.raw`
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { appendFileSync } from "node:fs";
export default function(pi) {
  pi.registerProvider("summary-proof", {
    api: "summary-proof", apiKey: "LOCAL_TEST", baseUrl: "http://127.0.0.1:9/never-contact",
    models: ["chat", "chosen-summary"].map(id => ({ id, name: id, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 })),
    streamSimple(model, context) {
      const summary = JSON.stringify(context).includes("collapsed UI bar");
      if (summary) appendFileSync(process.env.PI_SUMMARY_PROOF_LOG, model.id + "\n");
      const finished = context.messages.some(m => m.role === "toolResult" || m.role === "tool");
      const text = summary ? "Summary via " + model.id + ": Read README; the shell check failed and remains unresolved." : "Final answer: README inspected; the check failed.";
      const content = summary || finished ? [{type:"text",text}] : [
        { type: "text", text: "Inspecting README and running the check." },
        { type: "toolCall", id: "proof-read", name: "read", arguments: { path: "README.md" } },
        { type: "toolCall", id: "proof-fail", name: "bash", arguments: { command: "exit 1", timeout: 5 } },
      ];
      const message = {role:"assistant", content, api:model.api, provider:model.provider, model:model.id,
        usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
        stopReason:summary||finished?"stop":"toolUse",timestamp:Date.now()};
      const stream = createAssistantMessageEventStream();
      stream.push({type:"start",partial:{...message,content:[]}});
      stream.push({type:"text_delta",contentIndex:0,delta:content[0].text,partial:message});
      stream.push({type:"done",reason:message.stopReason,message});
      return stream;
    }
  });
}
`;

test("AI summary groups failures; toggle, override and same-chat reset persist on Electron", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("summary-proof");
  const agentDir = join(userDataDir, "agent");
  const log = join(userDataDir, "summary-requests.log");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(join(workspacePath, "README.md"), "A fixture for summary verification.\n");
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "summary-proof",
      defaultModel: "chat",
      packages: [],
      enabledModels: ["summary-proof/*"],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspacePath, "summary-proof.ts", extension);
  const options = {
    initialWorkspaces: [workspacePath],
    agentDir,
    testMode: "foreground" as const,
    envOverrides: { PI_SUMMARY_PROOF_LOG: log },
  };
  const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;
  let harness = await launch(userDataDir, options);
  try {
    let window = await harness.firstWindow();
    await window
      .getByRole("complementary")
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    await window
      .getByLabel("New thread prompt", { exact: true })
      .fill("Read README and run the shell check.");
    await window.getByRole("button", { name: "Start thread", exact: true }).click();
    const summary = window.getByTestId("timeline-work-summary");
    await expect(summary.getByTestId("work-summary-text")).toContainText("Summary via chat");
    await expect(summary).toContainText("1 failed");
    await expect(window.getByTestId("transcript")).toContainText("Final answer");
    const title = await window.locator(".chat-header__title").innerText();
    await waitForTimelineLayout(window);
    await summary.locator(".timeline-tool-group__header").click();
    await expect(summary.locator(".timeline-tool--error")).toBeVisible();
    await expect(summary).toContainText("Inspecting README");
    await window.screenshot({ path: testInfo.outputPath("summary-expanded.png") });
    await summary.locator(".timeline-tool-group__header").click();
    await expect(summary.locator(".timeline-tool--error")).toHaveCount(0);
    await window.getByRole("button", { name: "Summary model", exact: true }).click();
    await window
      .locator(".composer .model-selector__dropdown")
      .getByRole("button", { name: /chosen-summary$/ })
      .click();
    await expect(summary.getByTestId("work-summary-text")).toContainText(
      "Summary via chosen-summary",
    );
    await window.screenshot({ path: testInfo.outputPath("summary-collapsed.png") });
    await window.keyboard.press(desktopShortcut(","));
    const toggle = window.getByRole("switch", { name: "AI work summaries", exact: true });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("timeline-work-summary")).toHaveCount(0);
    await expect(window.locator(".timeline-tool--error")).toBeVisible();
    await harness.close();
    harness = await launch(userDataDir, options);
    window = await harness.firstWindow();
    await selectSession(window, title);
    await expect(window.getByRole("button", { name: "Summary model", exact: true })).toContainText(
      "chosen-summary",
    );
    await expect(window.getByTestId("timeline-work-summary")).toHaveCount(0);
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("switch", { name: "AI work summaries", exact: true }).click();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("work-summary-text")).toContainText(
      "Summary via chosen-summary",
    );
    // The semantic cache survives native/live row-id changes and restart.
    expect((await readFile(log, "utf8")).trim().split("\n")).toEqual(["chat", "chosen-summary"]);
    await window.getByRole("button", { name: "Summary model", exact: true }).click();
    await window.getByRole("button", { name: "Same as chat", exact: true }).click();
    await expect(window.getByRole("button", { name: "Summary model", exact: true })).toContainText(
      "Same as chat",
    );
    await expect(window.getByTestId("work-summary-text")).toContainText("Summary via chat");
    await window.screenshot({ path: testInfo.outputPath("summary-restart-reset.png") });
  } finally {
    await harness.close();
  }
});
