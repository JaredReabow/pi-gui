import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { DesktopAppState } from "../../contracts/desktop-state";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  runOrchestrationRuntimeTool,
  seedAgentDir,
} from "../helpers/electron-app";

interface CapturedModelRequest {
  readonly model: string | undefined;
  readonly reasoningEffort: string | undefined;
  readonly promptText: string;
}

async function startSelectionServer(): Promise<{
  readonly baseUrl: string;
  readonly requests: readonly CapturedModelRequest[];
  readonly close: () => Promise<void>;
}> {
  const requests: CapturedModelRequest[] = [];
  const pending = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const payload = JSON.parse(body) as {
        model?: string;
        reasoning_effort?: string;
        messages?: readonly {
          readonly role?: string;
          readonly content?: unknown;
        }[];
      };
      const promptContent = [...(payload.messages ?? [])]
        .reverse()
        .find(
          (message) =>
            message.role === "user" &&
            /ALPHA_SELECTED|HOLD_FOR_CANCELLATION/.test(contentText(message.content)),
        )?.content;
      const promptText = contentText(promptContent);
      const shouldHold = (payload.messages ?? []).some((message) =>
        contentText(message.content).includes("HOLD_FOR_CANCELLATION"),
      );
      requests.push({
        model: payload.model,
        reasoningEffort: payload.reasoning_effort,
        promptText,
      });
      if (shouldHold) {
        pending.add(response);
        response.on("close", () => pending.delete(response));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: unknown, finishReason: string | null) =>
        response.write(
          `data: ${JSON.stringify({
            id: "child-selection-proof",
            object: "chat.completion.chunk",
            model: payload.model,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );
      chunk({ role: "assistant", content: "SELECTED_CHILD_COMPLETE" }, null);
      chunk({}, "stop");
      response.end("data: [DONE]\n\n");
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      for (const response of pending) response.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) =>
      typeof part === "object" && part && "text" in part ? String(part.text ?? "") : "",
    )
    .join("");
}

function childByToolCall(state: DesktopAppState, toolCallId: string) {
  return state.orchestrationChildren.find((child) => child.sourceToolCallId === toolCallId);
}

test("explicit child selections survive replay, cancellation and restart", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const server = await startSelectionServer();
  const userDataDir = await makeUserDataDir("pi-gui-child-selection-");
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("child-selection");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["local-proof/alpha", "local-proof/beta"],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        defaultProvider: "local-proof",
        defaultModel: "alpha",
        defaultThinkingLevel: "low",
        enabledModels: ["local-proof/alpha", "local-proof/beta"],
        cacheWarming: "off",
        compaction: { enabled: false },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          "local-proof": {
            baseUrl: server.baseUrl,
            api: "openai-completions",
            apiKey: "unused",
            compat: {
              supportsReasoningEffort: true,
              thinkingFormat: "openai",
            },
            models: [
              {
                id: "alpha",
                name: "Alpha reasoning",
                reasoning: true,
                thinkingLevelMap: {
                  off: "off",
                  minimal: "minimal",
                  low: "low",
                  medium: "medium",
                  high: "high",
                  xhigh: "xhigh",
                  max: "max",
                },
              },
              {
                id: "beta",
                name: "Beta reasoning",
                reasoning: true,
                thinkingLevelMap: {
                  off: "off",
                  minimal: "minimal",
                  low: "low",
                  medium: "medium",
                  high: "high",
                  xhigh: "xhigh",
                  max: "max",
                },
              },
              {
                id: "disabled",
                name: "Disabled reasoning",
                reasoning: true,
              },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const launchOptions = {
    agentDir,
    scrubProviderEnv: true,
    testMode: "background" as const,
  };
  const proof: Record<string, unknown> = { userDataDir, workspacePath, requests: [] };
  let parentRef = { workspaceId: "", sessionId: "" };
  let first: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  let second: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    first = await launchDesktop(userDataDir, {
      ...launchOptions,
      initialWorkspaces: [workspacePath],
    });
    const window = await first.firstWindow();
    proof.firstIdentity = await first.inspectIdentity();
    await createNamedThread(window, "Child selection parent");
    const initialState = await getDesktopState(window);
    parentRef = {
      workspaceId:
        initialState.selectedWorkspaceId ??
        (() => {
          throw new Error("Expected a selected workspace");
        })(),
      sessionId:
        initialState.selectedSessionId ??
        (() => {
          throw new Error("Expected a selected parent session");
        })(),
    };

    const alpha = await runOrchestrationRuntimeTool(first, {
      toolName: "create_child_thread",
      toolCallId: "selected-alpha",
      sessionRef: parentRef,
      params: {
        prompt: "Return ALPHA_SELECTED.",
        selection: {
          provider: "local-proof",
          modelId: "alpha",
          thinkingLevel: "low",
        },
      },
    });
    expect(alpha.details).toMatchObject({
      deliveryStatus: "responded",
      origin: {
        kind: "child-thread",
        source: "desktop-host",
        parentWorkspaceId: parentRef.workspaceId,
        parentSessionId: parentRef.sessionId,
        sourceToolCallId: "selected-alpha",
      },
      selectedConfig: {
        provider: "local-proof",
        modelId: "alpha",
        thinkingLevel: "low",
      },
    });

    const beta = await runOrchestrationRuntimeTool(first, {
      toolName: "create_child_thread",
      toolCallId: "selected-beta",
      sessionRef: parentRef,
      params: {
        prompt: "HOLD_FOR_CANCELLATION on BETA_SELECTED.",
        selection: {
          provider: "local-proof",
          modelId: "beta",
          thinkingLevel: "high",
        },
      },
    });
    expect(beta.details).toMatchObject({
      deliveryStatus: "running",
      selectedConfig: {
        provider: "local-proof",
        modelId: "beta",
        thinkingLevel: "high",
      },
    });
    await expect.poll(() => server.requests.length).toBe(2);
    expect(server.requests).toEqual([
      expect.objectContaining({
        model: "alpha",
        reasoningEffort: "low",
        promptText: expect.stringContaining("ALPHA_SELECTED"),
      }),
      expect.objectContaining({
        model: "beta",
        reasoningEffort: "high",
        promptText: expect.stringContaining("HOLD_FOR_CANCELLATION"),
      }),
    ]);

    const requestsBeforeReplay = server.requests.length;
    const replay = await runOrchestrationRuntimeTool(first, {
      toolName: "create_child_thread",
      toolCallId: "selected-alpha",
      sessionRef: parentRef,
      params: {
        prompt: "Return ALPHA_SELECTED.",
        selection: {
          provider: "local-proof",
          modelId: "beta",
          thinkingLevel: "max",
        },
      },
    });
    expect(replay.details).toMatchObject({
      childThreadId: alpha.details?.childThreadId,
      selectedConfig: {
        provider: "local-proof",
        modelId: "alpha",
        thinkingLevel: "low",
      },
    });
    expect(server.requests).toHaveLength(requestsBeforeReplay);

    await expect(
      runOrchestrationRuntimeTool(first, {
        toolName: "create_child_thread",
        toolCallId: "disabled-child",
        sessionRef: parentRef,
        params: {
          prompt: "This model may not be selected.",
          selection: {
            provider: "local-proof",
            modelId: "disabled",
            thinkingLevel: "low",
          },
        },
      }),
    ).rejects.toThrow(/Child model is disabled/);
    const afterDisabled = await getDesktopState(window);
    expect(childByToolCall(afterDisabled, "disabled-child")).toBeUndefined();
    expect(afterDisabled.orchestrationChildren).toHaveLength(2);

    const betaChild = childByToolCall(afterDisabled, "selected-beta");
    if (!betaChild) throw new Error("Expected the held beta child");
    await window.evaluate(
      ({ childThreadId }) =>
        globalThis.window.piApp!.setChildSupervisionLoop({
          childThreadId,
          gate: "stop",
        }),
      { childThreadId: betaChild.id },
    );
    await expect
      .poll(async () => childByToolCall(await getDesktopState(window), "selected-beta")?.status)
      .toBe("cancelled");
    proof.beforeRestart = (await getDesktopState(window)).orchestrationChildren.map((child) => ({
      id: child.id,
      sourceToolCallId: child.sourceToolCallId,
      origin: child.origin,
      selectedConfig: child.selectedConfig,
      status: child.status,
    }));
    proof.firstCleanup = await first.close();
    first = undefined;

    second = await launchDesktop(userDataDir, launchOptions);
    const reopened = await second.firstWindow();
    proof.secondIdentity = await second.inspectIdentity();
    const restored = await getDesktopState(reopened);
    const restoredAlpha = childByToolCall(restored, "selected-alpha");
    const restoredBeta = childByToolCall(restored, "selected-beta");
    expect(restoredAlpha).toMatchObject({
      selectedConfig: {
        provider: "local-proof",
        modelId: "alpha",
        thinkingLevel: "low",
      },
      origin: {
        source: "desktop-host",
        sourceToolCallId: "selected-alpha",
      },
    });
    expect(restoredBeta).toMatchObject({
      status: "cancelled",
      selectedConfig: {
        provider: "local-proof",
        modelId: "beta",
        thinkingLevel: "high",
      },
      origin: {
        source: "desktop-host",
        sourceToolCallId: "selected-beta",
      },
    });
    proof.afterRestart = restored.orchestrationChildren.map((child) => ({
      id: child.id,
      sourceToolCallId: child.sourceToolCallId,
      origin: child.origin,
      selectedConfig: child.selectedConfig,
      status: child.status,
    }));
    proof.requests = server.requests;
  } finally {
    if (first) proof.firstCleanup = await first.close();
    if (second) proof.secondCleanup = await second.close();
    await server.close();
    const proofDir = process.env.PI_APP_CHILD_SELECTION_PROOF_DIR?.trim();
    if (proofDir) {
      await mkdir(proofDir, { recursive: true });
      const body = JSON.stringify(proof, null, 2);
      await writeFile(join(proofDir, "child-model-selection-proof.json"), body);
      await testInfo.attach("child-model-selection-proof", {
        body,
        contentType: "application/json",
      });
    }
  }
});
