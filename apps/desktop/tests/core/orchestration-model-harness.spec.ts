import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";
import {
  startScriptedOpenAiServer,
  type ScriptedChatRequest,
  type ScriptedReply,
} from "../helpers/scripted-openai-server";

function scriptModelHarness(request: ScriptedChatRequest): ScriptedReply {
  const last = request.messages.at(-1);
  if (request.toolNames.length === 0) {
    return { text: `WORKER_MODEL:${request.model}` };
  }
  if (last?.role === "tool") {
    if (last.content.includes("Available worker models:")) {
      return {
        tool: "spawn_worker",
        args: {
          prompt: "Return the worker model name.",
          model: "scripted-test/worker",
        },
      };
    }
    if (last.content.includes("WORKER_MODEL:worker")) {
      return { text: "PARENT_RECEIVED_WORKER_RESULT" };
    }
    return { text: `Unexpected tool result: ${last.content}` };
  }
  return { tool: "list_models", args: {} };
}

function scriptCreateChildCompatibility(request: ScriptedChatRequest): ScriptedReply {
  if (request.model === "worker") {
    return { text: "CHILD_THREAD_READY" };
  }
  const last = request.messages.at(-1);
  if (last?.role === "tool") {
    return { text: "PARENT_RECEIVED_CHILD_THREAD" };
  }
  return {
    tool: "create_child_thread",
    args: {
      prompt: "Return CHILD_THREAD_READY.",
      model: "scripted-test/worker",
      thinkingLevel: "high",
      selection: {
        provider: "scripted-test",
        modelId: "scripted",
        thinkingLevel: "off",
      },
    },
  };
}

test("the model sees the pi-gui tool harness, discovers models, and runs an inline worker", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("model-harness");
  const server = await startScriptedOpenAiServer(scriptModelHarness);
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["scripted-test/scripted", "scripted-test/worker"],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "scripted-test",
      defaultModel: "scripted",
      enabledModels: ["scripted-test/scripted", "scripted-test/worker"],
    }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "scripted-test": {
          baseUrl: server.baseUrl,
          api: "openai-completions",
          apiKey: "unused",
          models: [{ id: "scripted" }, { id: "worker" }],
        },
      },
    }),
  );
  const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;
  const harness = await launch(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Model harness");
    await window.getByTestId("composer").fill("Run a worker on the exact selected model.");
    await window.getByTestId("composer").press("Enter");
    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("PARENT_RECEIVED_WORKER_RESULT", { timeout: 30_000 });

    const first = server.requests[0];
    expect(first?.toolNames).toEqual(
      expect.arrayContaining([
        "create_child_thread",
        "spawn_worker",
        "list_models",
        "list_threads",
      ]),
    );
    const discovered = server.requests.find((request) =>
      request.messages.some((message) => message.content.includes("Available worker models:")),
    );
    expect(discovered?.toolNames).toEqual(expect.arrayContaining(["spawn_worker", "list_models"]));
    const workerRequest = server.requests.find(
      (request) => request.model === "worker" && request.toolNames.length === 0,
    );
    expect(workerRequest).toBeDefined();
  } finally {
    await harness.close();
    await server.close();
  }
});

test("create_child_thread accepts top-level model arguments beside a host-added legacy selection", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("child-model-compatibility");
  const server = await startScriptedOpenAiServer(scriptCreateChildCompatibility);
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["scripted-test/scripted", "scripted-test/worker"],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "scripted-test",
      defaultModel: "scripted",
      enabledModels: ["scripted-test/scripted", "scripted-test/worker"],
    }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "scripted-test": {
          baseUrl: server.baseUrl,
          api: "openai-completions",
          apiKey: "unused",
          compat: {
            supportsReasoningEffort: true,
            thinkingFormat: "openai",
          },
          models: [
            { id: "scripted" },
            {
              id: "worker",
              name: "Worker reasoning",
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
          ],
        },
      },
    }),
  );
  const launch = process.env.PI_APP_TEST_RELEASE_DIR ? launchPackagedDesktop : launchDesktop;
  const harness = await launch(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Child model compatibility");
    await window.getByTestId("composer").fill("Create a child on the explicit worker model.");
    await window.getByTestId("composer").press("Enter");
    await expect(window.getByTestId("transcript")).toContainText("PARENT_RECEIVED_CHILD_THREAD", {
      timeout: 30_000,
    });
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.orchestrationChildren.at(-1)?.selectedConfig;
      })
      .toEqual({
        provider: "scripted-test",
        modelId: "worker",
        thinkingLevel: "high",
      });
    expect(server.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "worker",
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining("Return CHILD_THREAD_READY."),
            }),
          ]),
        }),
      ]),
    );
  } finally {
    await harness.close();
    await server.close();
  }
});
