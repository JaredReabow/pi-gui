import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
  TINY_PNG_BASE64,
  waitForSelectedSessionReady,
  waitForTimelineLayout,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { sessionFilePathFromCatalog } from "../helpers/session-file";

const TITLE = "Conversation copy and duration fixture";
const INITIAL_PROMPT = "Initial active-branch prompt";
const FINAL_PROMPT = "Final active-branch prompt";
const PAST_PROMPT_PREFIX = "Offscreen historical prompt";
const DELETED_BRANCH_SENTINEL = "DELETED-BRANCH-MUST-NOT-EXPORT";
const COMPACTION_SENTINEL = "Compaction-visible sentinel";
const FILE_REFERENCE = "/workspace/copy-proof/context.md";
const CREDENTIAL_SENTINEL = "CREDENTIAL-MUST-NOT-EXPORT";
const TOKEN_SENTINEL = "ORDINARY-TOKEN-MUST-NOT-EXPORT";
const CLIENT_SECRET_SENTINEL = "CLIENT-SECRET-MUST-NOT-EXPORT";
const PRIVATE_KEY_SENTINEL = "PRIVATE-KEY-MUST-NOT-EXPORT";
const ACCESS_TOKEN_SENTINEL = "ACCESS-TOKEN-MUST-NOT-EXPORT";
const REFRESH_TOKEN_SENTINEL = "REFRESH-TOKEN-MUST-NOT-EXPORT";
const ID_TOKEN_SENTINEL = "ID-TOKEN-MUST-NOT-EXPORT";
const HEADER_SINGULAR_SENTINEL = "SINGULAR-HEADER-MUST-NOT-EXPORT";
const HEADER_PLURAL_SENTINEL = "PLURAL-HEADER-MUST-NOT-EXPORT";
const HEADER_UPPER_SENTINEL = "UPPER-HEADER-MUST-NOT-EXPORT";
const HEADER_KEBAB_SENTINEL = "KEBAB-HEADER-MUST-NOT-EXPORT";
const RUNTIME_SENTINEL = "RUNTIME-MUST-NOT-EXPORT";
const RAW_CODE = ['const exact = "raw-code";', "console.log(exact);"].join("\n");
const RESPONSE_MARKDOWN = [
  "## Copy proof",
  "",
  "**Exact response sentinel**",
  "",
  "```ts",
  RAW_CODE,
  "```",
  "",
  "```json",
  '{"status":"complete"}',
  "```",
  "",
  "Final response line.",
].join("\n");
const COPY_FAILURE = "Couldn't copy. Check clipboard access and try again.";

interface CopyProbe {
  readonly mode: "resolve" | "reject";
  readonly writes: readonly string[];
  readonly failedAttempts: readonly string[];
}

type ProbeWindow = Window & {
  __conversationCopyProbe?: {
    mode: "resolve" | "reject";
    writes: string[];
    failedAttempts: string[];
  };
};

async function installClipboardProbe(page: Page, mode: "resolve" | "reject"): Promise<void> {
  await page.evaluate(
    ({ nextMode, rejectionText }) => {
      const target = window as ProbeWindow;
      target.__conversationCopyProbe = {
        mode: nextMode,
        writes: [],
        failedAttempts: [],
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            const probe = target.__conversationCopyProbe;
            if (!probe) throw new Error("Copy probe missing");
            if (probe.mode === "reject") {
              probe.failedAttempts.push(text);
              throw new DOMException(rejectionText, "NotAllowedError");
            }
            probe.writes.push(text);
          },
        },
      });
    },
    { nextMode: mode, rejectionText: `Clipboard denied with ${TOKEN_SENTINEL}` },
  );
}

async function readClipboardProbe(page: Page): Promise<CopyProbe> {
  return page.evaluate(() => {
    const probe = (window as ProbeWindow).__conversationCopyProbe;
    if (!probe) throw new Error("Copy probe missing");
    return {
      mode: probe.mode,
      writes: [...probe.writes],
      failedAttempts: [...probe.failedAttempts],
    };
  });
}

async function seedConversationCopyFixture(
  agentDir: string,
  workspacePath: string,
): Promise<{ readonly sessionId: string; readonly title: typeof TITLE }> {
  const { SessionManager } = (await import("@earendil-works/pi-coding-agent")) as {
    SessionManager: {
      create(cwd: string): {
        appendMessage(message: Record<string, unknown>): string;
        appendCompaction(
          summary: string,
          firstKeptEntryId: string | null,
          tokensBefore: number,
        ): string;
        appendCustomMessageEntry(customType: string, content: string, display: boolean): string;
        appendCustomEntry(customType: string, data?: unknown): string;
        appendSessionInfo(name: string): string;
        branch(entryId: string): void;
        getSessionId(): string;
      };
    };
  };

  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const manager = SessionManager.create(workspacePath);
    const base = Date.now() - 3 * 86_400_000;
    const timestamp = (offsetSeconds: number) => base + offsetSeconds * 1_000;
    const usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const assistantMessage = (
      content: unknown,
      at: number,
      stopReason = "stop",
    ): Record<string, unknown> => ({
      role: "assistant",
      content,
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5",
      usage,
      stopReason,
      timestamp: at,
    });
    const fileAttachmentBlock = `<pi-gui-file-attachments>${JSON.stringify({
      version: 1,
      files: [
        {
          kind: "file",
          name: "context.md",
          mimeType: "text/markdown",
          fsPath: FILE_REFERENCE,
        },
      ],
    })}</pi-gui-file-attachments>`;

    const firstUser = manager.appendMessage({
      role: "user",
      content: [
        { type: "text", text: `${fileAttachmentBlock}\n${INITIAL_PROMPT}` },
        {
          type: "image",
          data: TINY_PNG_BASE64,
          mimeType: "image/png",
          name: "offscreen-image.png",
        },
      ],
      timestamp: timestamp(0),
    });
    const toolCallAssistant = manager.appendMessage(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: "copy-tool-call",
            name: "terminal",
            arguments: {
              command: "cat /workspace/copy-proof/context.md",
              credential: { token: CREDENTIAL_SENTINEL },
              runtime: { sandbox: RUNTIME_SENTINEL },
              token: TOKEN_SENTINEL,
              clientSecret: CLIENT_SECRET_SENTINEL,
              privateKey: PRIVATE_KEY_SENTINEL,
              private_key: PRIVATE_KEY_SENTINEL,
              nested: [
                { "access-token": ACCESS_TOKEN_SENTINEL },
                { REFRESH_TOKEN: REFRESH_TOKEN_SENTINEL },
                { IDToken: ID_TOKEN_SENTINEL },
              ],
              tokenCount: 42,
              tokenizer: "cl100k",
              clientId: "public-client-id",
              public_key: "public-key-reference",
              path: "/workspace/token/clientSecret/private_key.ts",
              header: { arbitrarilyNamed: HEADER_SINGULAR_SENTINEL },
              HEADERS: { arbitrarilyNamedUpper: HEADER_UPPER_SENTINEL },
              "h-e-a-d-e-r": { arbitrarilyNamedKebab: HEADER_KEBAB_SENTINEL },
              headers: [{ arbitrarilyNamedPlural: HEADER_PLURAL_SENTINEL }],
              headerCount: 3,
              headerName: "public-header-name",
              prose: "token clientSecret private_key remain ordinary prose",
              headerProse: "header and headers remain ordinary prose",
              code: 'const token = "source-code-remains-exact";',
            },
          },
        ],
        timestamp(1),
        "toolUse",
      ),
    );
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "copy-tool-call",
      toolName: "terminal",
      content: [
        { type: "text", text: "Command cancelled by user" },
        { type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" },
      ],
      details: {
        status: "cancelled",
        file: FILE_REFERENCE,
        credential: { token: CREDENTIAL_SENTINEL },
        runtime: { sandbox: RUNTIME_SENTINEL },
      },
      isError: true,
      timestamp: timestamp(2),
    });
    manager.appendMessage(
      assistantMessage("Tool failure retained in the transcript.", timestamp(3)),
    );

    manager.appendMessage({
      role: "user",
      content: DELETED_BRANCH_SENTINEL,
      timestamp: timestamp(4),
    });
    manager.appendMessage(assistantMessage(DELETED_BRANCH_SENTINEL, timestamp(5)));
    manager.branch(toolCallAssistant);

    manager.appendCompaction(COMPACTION_SENTINEL, firstUser, 1_000);
    manager.appendCustomMessageEntry("copy.fixture", "Extension message sentinel", true);
    manager.appendCustomEntry("pi-gui.card", {
      title: "Copy fixture card",
      subtitle: "Extension card sentinel",
      tone: "success",
      rows: [{ label: "Status", value: "Ready" }],
      actions: [{ type: "openFile", label: "Open context", path: FILE_REFERENCE }],
    });
    manager.appendMessage(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: "header-container-call",
            name: "inspect",
            arguments: {
              command: "inspect headers",
              header: { arbitraryInputValue: HEADER_SINGULAR_SENTINEL },
              Headers: [{ arbitraryInputValue: HEADER_PLURAL_SENTINEL }],
              "h-e-a-d-e-r": { arbitraryInputValue: HEADER_KEBAB_SENTINEL },
              nested: [{ HEADER: { arbitraryInputValue: HEADER_UPPER_SENTINEL } }],
              headerCount: 3,
              headerName: "public-header-name",
              headerProse: "header and headers remain ordinary prose",
              tokenCount: 42,
              tokenizer: "cl100k",
              clientId: "public-client-id",
              public_key: "public-key-reference",
              path: "/workspace/token/clientSecret/private_key.ts",
              prose: "token clientSecret private_key remain ordinary prose",
              code: 'const token = "source-code-remains-exact";',
            },
          },
        ],
        timestamp(6),
        "toolUse",
      ),
    );
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "header-container-call",
      toolName: "inspect",
      content: [{ type: "text", text: "Header inspection completed" }],
      details: {
        header: { arbitraryOutputValue: HEADER_SINGULAR_SENTINEL },
        HEADERS: { arbitraryOutputValue: HEADER_PLURAL_SENTINEL },
        "h-e-a-d-e-r": { arbitraryOutputValue: HEADER_KEBAB_SENTINEL },
        nested: [[{ HEADER: { arbitraryOutputValue: HEADER_UPPER_SENTINEL } }]],
        headerCount: 3,
        headerName: "public-header-name",
        headerProse: "header and headers remain ordinary prose",
      },
      isError: false,
      timestamp: timestamp(7),
    });

    for (let index = 0; index < 30; index += 1) {
      manager.appendMessage({
        role: "user",
        content: `${PAST_PROMPT_PREFIX} ${index}`,
        timestamp: timestamp(10 + index * 2),
      });
      manager.appendMessage(
        assistantMessage(`Offscreen historical response ${index}`, timestamp(11 + index * 2)),
      );
    }

    manager.appendMessage({
      role: "user",
      content: FINAL_PROMPT,
      timestamp: timestamp(100),
    });
    manager.appendMessage(
      assistantMessage([{ type: "text", text: RESPONSE_MARKDOWN }], timestamp(100) + 86_400_000),
    );
    manager.appendSessionInfo(TITLE);

    return { sessionId: manager.getSessionId(), title: TITLE };
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("copies raw code, exact responses, and every loaded offscreen branch row without mutating state", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir("pi-gui-copy-duration-");
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("conversation-copy-duration");
  await seedAgentDir(agentDir);
  const fixture = await seedConversationCopyFixture(agentDir, workspacePath);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const page = await harness.firstWindow();
    await waitForWorkspaceByPath(page, workspacePath);
    await selectSession(page, fixture.title);
    await waitForSelectedSessionReady(page, fixture);
    await waitForTimelineLayout(page);

    const identity = await harness.inspectIdentity();
    expect(identity.visible).toBe(false);
    expect(identity.focused).toBe(false);
    expect(identity.testMode).toBe("background");
    expect(identity.telemetry).toEqual({
      doNotTrack: "1",
      otelSdkDisabled: "true",
      testTransport: "disabled",
    });

    const pane = page.getByTestId("timeline-pane");
    await waitForTimelineLayout(page);
    const finalResponse = page.locator(".timeline-item--assistant", { hasText: "Copy proof" });
    await expect(finalResponse).toBeVisible();
    await pane.focus();
    await pane.press("Home");
    await expect
      .poll(() =>
        pane.evaluate((element) => (element instanceof HTMLElement ? element.scrollTop : -1)),
      )
      .toBe(0);
    await waitForTimelineLayout(page);
    await expect(finalResponse).toHaveCount(0);

    const selectedState = await getDesktopState(page);
    const selectedWorkspaceId = selectedState.selectedWorkspaceId;
    const selectedSessionId = selectedState.selectedSessionId;
    if (!selectedWorkspaceId || !selectedSessionId) {
      throw new Error("Selected copy fixture session is unavailable");
    }
    const sessionFilePath = await sessionFilePathFromCatalog(userDataDir, {
      workspaceId: selectedWorkspaceId,
      sessionId: selectedSessionId,
    });
    const sessionBeforeCopy = await readFile(sessionFilePath, "utf8");
    const composer = page.getByTestId("composer");
    const draft = "Draft remains unchanged through copy";
    await composer.fill(draft);

    await installClipboardProbe(page, "resolve");
    const scrollBeforeCopy = await pane.evaluate((element) =>
      element instanceof HTMLElement ? element.scrollTop : -1,
    );
    await page.getByRole("button", { name: "Copy active-branch transcript" }).click();
    await expect(
      page.getByRole("button", { name: "Copied active-branch transcript" }),
    ).toHaveAttribute("data-copy-state", "success");
    const scrollAfterCopy = await pane.evaluate((element) =>
      element instanceof HTMLElement ? element.scrollTop : -1,
    );
    expect(scrollAfterCopy).toBe(scrollBeforeCopy);

    const proofDir = process.env.PI_APP_COPY_DURATION_PROOF_DIR?.trim();
    if (proofDir) {
      await mkdir(proofDir, { recursive: true });
      await page.getByTestId("timeline-surface").screenshot({
        path: join(proofDir, "copy-controls-offscreen-export.png"),
      });
      await writeFile(
        join(proofDir, "copy-controls-offscreen-export.aria.yml"),
        await page.locator(".timeline-surface").ariaSnapshot(),
        "utf8",
      );
    }

    const toolRow = page.locator('.timeline-tool[data-tool-call-id="header-container-call"]');
    await pane.hover();
    for (let step = 0; step < 20 && (await toolRow.count()) === 0; step += 1) {
      await page.mouse.wheel(0, 500);
    }
    await expect(toolRow).toBeVisible();
    await toolRow.locator(".timeline-tool__header").click();
    const toolCopyButton = toolRow.getByTestId("copy-tool-content");
    await expect(toolCopyButton).toBeVisible();
    await toolCopyButton.click();
    await expect(toolCopyButton).toHaveAttribute("data-copy-state", "success");

    await pane.hover();
    for (let step = 0; step < 20 && (await finalResponse.count()) === 0; step += 1) {
      await page.mouse.wheel(0, 1_000);
    }
    await expect(finalResponse).toBeVisible();
    await finalResponse.hover();
    await finalResponse.getByTestId("copy-code").first().click();
    await expect(finalResponse.getByTestId("copy-code").first()).toHaveAttribute(
      "data-copy-state",
      "success",
    );
    await finalResponse.getByTestId("copy-response").click();
    await expect(finalResponse.getByTestId("copy-response")).toHaveAttribute(
      "data-copy-state",
      "success",
    );

    const successProbe = await readClipboardProbe(page);
    expect(successProbe.writes).toHaveLength(4);
    const transcriptPayload = successProbe.writes[0] ?? "";
    const toolPayload = successProbe.writes[1] ?? "";
    expect(successProbe.writes[2]).toBe(RAW_CODE);
    expect(successProbe.writes[3]).toBe(RESPONSE_MARKDOWN);
    expect(transcriptPayload).toContain("# Active branch transcript");
    expect(transcriptPayload).toContain("complete Markdown for the currently loaded active branch");
    expect(transcriptPayload).toContain(INITIAL_PROMPT);
    expect(transcriptPayload).toContain(`${PAST_PROMPT_PREFIX} 0`);
    expect(transcriptPayload).toContain(`${PAST_PROMPT_PREFIX} 29`);
    expect(transcriptPayload).toContain(FINAL_PROMPT);
    expect(transcriptPayload).toContain(COMPACTION_SENTINEL);
    expect(transcriptPayload).toContain("Extension message sentinel");
    expect(transcriptPayload).toContain("- Status: error");
    expect(transcriptPayload).toContain(FILE_REFERENCE);
    expect(transcriptPayload).toContain(RESPONSE_MARKDOWN);
    expect(transcriptPayload).not.toContain(DELETED_BRANCH_SENTINEL);
    for (const structuredPayload of [transcriptPayload, toolPayload]) {
      expect(structuredPayload).not.toContain(TINY_PNG_BASE64);
      expect(structuredPayload).not.toContain(CREDENTIAL_SENTINEL);
      expect(structuredPayload).not.toContain(TOKEN_SENTINEL);
      expect(structuredPayload).not.toContain(CLIENT_SECRET_SENTINEL);
      expect(structuredPayload).not.toContain(PRIVATE_KEY_SENTINEL);
      expect(structuredPayload).not.toContain(ACCESS_TOKEN_SENTINEL);
      expect(structuredPayload).not.toContain(REFRESH_TOKEN_SENTINEL);
      expect(structuredPayload).not.toContain(ID_TOKEN_SENTINEL);
      expect(structuredPayload).not.toContain(HEADER_SINGULAR_SENTINEL);
      expect(structuredPayload).not.toContain(HEADER_PLURAL_SENTINEL);
      expect(structuredPayload).not.toContain(HEADER_UPPER_SENTINEL);
      expect(structuredPayload).not.toContain(HEADER_KEBAB_SENTINEL);
      expect(structuredPayload).not.toContain(RUNTIME_SENTINEL);
    }
    expect(toolPayload).toContain('"tokenCount": 42');
    expect(toolPayload).toContain('"tokenizer": "cl100k"');
    expect(toolPayload).toContain('"clientId": "public-client-id"');
    expect(toolPayload).toContain('"public_key": "public-key-reference"');
    expect(toolPayload).toContain('"path": "/workspace/token/clientSecret/private_key.ts"');
    expect(toolPayload).toContain('"headerCount": 3');
    expect(toolPayload).toContain('"headerName": "public-header-name"');
    expect(toolPayload).toContain(
      '"prose": "token clientSecret private_key remain ordinary prose"',
    );
    expect(toolPayload).toContain('"headerProse": "header and headers remain ordinary prose"');
    await expect(composer).toHaveValue(draft);
    expect(await readFile(sessionFilePath, "utf8")).toBe(sessionBeforeCopy);

    const sessionAfterSuccess = await readFile(sessionFilePath, "utf8");
    await installClipboardProbe(page, "reject");
    await pane.focus();
    await pane.press("Home");
    await waitForTimelineLayout(page);
    await expect(toolRow).toBeVisible();
    await toolCopyButton.click();
    await expect(toolRow.getByRole("alert")).toHaveText(COPY_FAILURE);
    await expect(toolRow.getByRole("alert")).not.toContainText(TOKEN_SENTINEL);
    await expect(toolCopyButton).toHaveAttribute("data-copy-state", "error");
    await expect(toolCopyButton).not.toContainText("Copied");
    await expect(composer).toHaveValue(draft);
    expect(await readFile(sessionFilePath, "utf8")).toBe(sessionAfterSuccess);

    const failureProbe = await readClipboardProbe(page);
    if (proofDir) {
      const structuredSentinelAudit = Object.fromEntries(
        [
          CREDENTIAL_SENTINEL,
          TOKEN_SENTINEL,
          CLIENT_SECRET_SENTINEL,
          PRIVATE_KEY_SENTINEL,
          ACCESS_TOKEN_SENTINEL,
          REFRESH_TOKEN_SENTINEL,
          ID_TOKEN_SENTINEL,
          HEADER_SINGULAR_SENTINEL,
          HEADER_PLURAL_SENTINEL,
          HEADER_UPPER_SENTINEL,
          HEADER_KEBAB_SENTINEL,
          RUNTIME_SENTINEL,
        ].map((sentinel) => [
          sentinel,
          {
            transcriptPayload: transcriptPayload.includes(sentinel),
            structuredToolPayload: toolPayload.includes(sentinel),
          },
        ]),
      );
      await mkdir(proofDir, { recursive: true });
      await writeFile(
        join(proofDir, "copy-duration-proof.json"),
        `${JSON.stringify(
          {
            identity,
            success: {
              transcript: successProbe.writes[0],
              structuredTool: successProbe.writes[1],
              rawCode: successProbe.writes[2],
              response: successProbe.writes[3],
              structuredToolSha256: sha256(toolPayload),
              transcriptSha256: sha256(transcriptPayload),
            },
            failure: {
              source: "structured-tool-copy",
              attemptedPayloads: failureProbe.failedAttempts,
              announcement: COPY_FAILURE,
              announcementContainedSyntheticSecret: COPY_FAILURE.includes(TOKEN_SENTINEL),
              copiedStateShown: false,
              draftAfterFailure: await composer.inputValue(),
              transcriptFileUnchanged: true,
            },
            offscreen: {
              finalResponseLocatorCountAtExport: 0,
              scrollTopBefore: scrollBeforeCopy,
              scrollTopAfter: scrollAfterCopy,
            },
            structuredSentinelAudit,
            sessionFileSha256: sha256(sessionBeforeCopy),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
  } finally {
    await harness.close();
  }
});

test("running duration uses the shared formatter and advances on the controlled renderer clock", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir("pi-gui-duration-tick-");
  const workspacePath = await makeWorkspace("conversation-duration-tick");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const page = await harness.firstWindow();
    await waitForWorkspaceByPath(page, workspacePath);
    await createNamedThread(page, "Duration tick");
    const state = await getDesktopState(page);
    const selectedWorkspace = state.workspaces.find(
      (workspace) => workspace.id === state.selectedWorkspaceId,
    );
    const selectedSession = selectedWorkspace?.sessions.find(
      (session) => session.id === state.selectedSessionId,
    );
    if (!selectedWorkspace || !selectedSession) throw new Error("Selected session is unavailable");

    const start = Date.parse("2026-10-31T00:00:00.000Z");
    await page.clock.install({ time: new Date(start) });
    await page.clock.pauseAt(new Date(start));
    const sessionRef = {
      workspaceId: selectedWorkspace.id,
      sessionId: selectedSession.id,
    };
    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp: new Date(start).toISOString(),
      runId: "duration-tick-run",
      snapshot: {
        ref: sessionRef,
        workspace: {
          workspaceId: selectedWorkspace.id,
          path: selectedWorkspace.path,
          displayName: selectedWorkspace.name,
        },
        title: selectedSession.title,
        status: "running",
        updatedAt: new Date(start).toISOString(),
        runningRunId: "duration-tick-run",
      },
    });

    const working = page.getByTestId("timeline-working");
    await expect(working).toContainText("Working for 1s");
    await page.clock.fastForward(60_000);
    await expect(working).toContainText("Working for 1m");

    const proofDir = process.env.PI_APP_COPY_DURATION_PROOF_DIR?.trim();
    if (proofDir) {
      await mkdir(proofDir, { recursive: true });
      await writeFile(
        join(proofDir, "duration-tick-proof.json"),
        `${JSON.stringify(
          {
            initial: "Working for 1s",
            afterFastForwardMs: 60_000,
            current: await working.textContent(),
            clock: "controlled-renderer",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
  } finally {
    await harness.close();
  }
});
