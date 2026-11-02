import { expect, test } from "@playwright/test";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { CreateSessionOptions, InlineWorkerModelSelection } from "@pi-gui/session-driver";
import type {
  ChildModelSelection,
  EffectiveChildModelSettings,
} from "../../contracts/child-selection";
import type { OrchestrationChildThread } from "../../contracts/desktop-state";
import { childModelSelection_createOptions } from "../../electron/orchestration/child-model-selection";
import { createOrchestrationOwner } from "../../electron/orchestration/app-store-orchestration";
import {
  createOrchestrationRuntimeTools,
  type OrchestrationRuntimeBridge,
} from "../../electron/orchestration/orchestration-runtime";

const parentRef = { workspaceId: "ws", sessionId: "parent" };
const timestamp = "2026-10-31T00:00:00.000Z";

const effective: EffectiveChildModelSettings = {
  policySource: "per-repo",
  defaultProvider: "provider-a",
  defaultModelId: "reasoning-a",
  defaultThinkingLevel: "medium",
  models: [
    {
      provider: "provider-a",
      modelId: "reasoning-a",
      available: true,
      reasoning: true,
      scope: "listed",
    },
    {
      provider: "provider-b",
      modelId: "plain-b",
      available: true,
      reasoning: false,
      scope: "matched",
    },
    {
      provider: "provider-a",
      modelId: "disabled",
      available: true,
      reasoning: true,
      scope: "off",
    },
    {
      provider: "provider-a",
      modelId: "unavailable",
      available: false,
      reasoning: true,
      scope: "listed",
    },
  ],
};

function resolved(
  selection: ChildModelSelection,
  baseOptions?: CreateSessionOptions,
): CreateSessionOptions {
  return childModelSelection_createOptions(effective, selection, baseOptions);
}

test("valid explicit selections retain the exact pair and supported thinking level", () => {
  expect(
    resolved({ provider: "provider-a", modelId: "reasoning-a", thinkingLevel: "xhigh" }),
  ).toEqual({
    initialModel: { provider: "provider-a", modelId: "reasoning-a" },
    initialThinkingLevel: "xhigh",
  });
  expect(
    resolved(
      { provider: "provider-b", modelId: "plain-b" },
      { initialThinkingLevel: "off", extensionFlagValues: { plan: true } },
    ),
  ).toEqual({
    initialThinkingLevel: "off",
    extensionFlagValues: { plan: true },
    initialModel: { provider: "provider-b", modelId: "plain-b" },
  });
  expect(resolved({ provider: "provider-a", modelId: "reasoning-a" })).toEqual({
    initialModel: { provider: "provider-a", modelId: "reasoning-a" },
  });
});

test("provider/model and thinking validation rejects every non-exact request", () => {
  const cases: readonly {
    readonly selection: ChildModelSelection;
    readonly baseOptions?: CreateSessionOptions;
    readonly error: RegExp;
  }[] = [
    {
      selection: { provider: "provider-a", modelId: "missing" },
      error: /Unknown child model: provider-a\/missing/,
    },
    {
      selection: { provider: "provider-b", modelId: "reasoning-a" },
      error: /Unknown child model: provider-b\/reasoning-a/,
    },
    {
      selection: { provider: "provider-a", modelId: "unavailable" },
      error: /Child model is unavailable/,
    },
    {
      selection: { provider: "provider-a", modelId: "disabled" },
      error: /Child model is disabled/,
    },
    {
      selection: { provider: "provider-b", modelId: "plain-b", thinkingLevel: "low" },
      error: /does not support thinking level low/,
    },
    {
      selection: { provider: "provider-b", modelId: "plain-b" },
      baseOptions: { initialThinkingLevel: "medium" },
      error: /does not support thinking level medium/,
    },
    {
      selection: {
        provider: "provider-a",
        modelId: "reasoning-a",
        thinkingLevel: "extreme" as ChildModelSelection["thinkingLevel"],
      },
      error: /Invalid child model selection/,
    },
    {
      selection: { provider: "provider-a", modelId: "reasoning-a" },
      baseOptions: { initialThinkingLevel: "unsupported" },
      error: /Unsupported child thinking level/,
    },
  ];

  for (const current of cases) {
    expect(() => resolved(current.selection, current.baseOptions)).toThrow(current.error);
  }
});

test("registered create_child_thread exposes flat model fields and normalizes the exact selection", async () => {
  let received:
    | {
        readonly prompt: string;
        readonly toolCallId: string;
        readonly selection?: ChildModelSelection;
      }
    | undefined;
  const bridge: OrchestrationRuntimeBridge = {
    archiveChildThreads: async () => ({
      content: [{ type: "text", text: "archive" }],
      details: { action: "pi_gui_archive_child_threads", archived: [], skipped: [] },
    }),
    createChildThread: async (_ctx, input) => {
      received = input;
      return {
        content: [{ type: "text", text: "created" }],
        details: {
          action: "pi_gui_create_child_thread",
          prompt: input.prompt,
        },
      };
    },
    runWorker: async () => ({
      content: [{ type: "text", text: "worker" }],
      details: { action: "pi_gui_spawn_worker", prompt: "" },
    }),
    listModels: async () => ({
      content: [{ type: "text", text: "models" }],
      details: { action: "pi_gui_list_models", models: [] },
    }),
    listThreads: async () => ({
      content: [{ type: "text", text: "list" }],
      details: { action: "pi_gui_list_threads" },
    }),
    readThread: async (_ctx, threadId) => ({
      content: [{ type: "text", text: "read" }],
      details: { action: "pi_gui_read_thread", threadId },
    }),
    sendMessageToThread: async (_ctx, input) => ({
      content: [{ type: "text", text: "sent" }],
      details: {
        action: "pi_gui_send_message_to_thread",
        threadId: input.threadId,
        message: input.message,
      },
    }),
  };
  const tool = createOrchestrationRuntimeTools(bridge).find(
    (candidate) => candidate.name === "create_child_thread",
  );
  expect(tool).toBeDefined();
  expect(tool?.parameters).toMatchObject({
    properties: {
      prompt: { type: "string" },
      model: { type: "string" },
      thinkingLevel: {
        enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
      },
      selection: {
        type: "object",
        required: ["provider", "modelId"],
        additionalProperties: false,
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  });

  const selection = {
    provider: "provider-a",
    modelId: "reasoning-a",
    thinkingLevel: "high",
  } as const;
  await tool?.execute(
    "selection-call",
    {
      prompt: "Inspect the selected model.",
      model: "provider-a/reasoning-a",
      thinkingLevel: "high",
    },
    undefined,
    undefined,
    {} as ExtensionToolContext,
  );
  expect(received).toEqual({
    prompt: "Inspect the selected model.",
    toolCallId: "selection-call",
    selection,
  });

  received = undefined;
  await expect(
    tool?.execute(
      "forged-call",
      {
        prompt: "Do not forge host metadata.",
        selection: {
          ...selection,
          origin: {
            kind: "child-thread",
            source: "desktop-host",
            parentWorkspaceId: "ws",
            parentSessionId: "parent",
          },
        },
      },
      undefined,
      undefined,
      {} as ExtensionToolContext,
    ),
  ).rejects.toThrow(/Invalid child model selection/);
  expect(received).toBeUndefined();
});

test("spawn_worker and list_models are registered and use the exact live-model contract", async () => {
  let received:
    | {
        readonly prompt: string;
        readonly toolCallId: string;
        readonly selection?: ChildModelSelection;
        readonly signal?: AbortSignal;
      }
    | undefined;
  let modelReads = 0;
  const bridge: OrchestrationRuntimeBridge = {
    archiveChildThreads: async () => ({
      content: [{ type: "text", text: "archive" }],
      details: { action: "pi_gui_archive_child_threads", archived: [], skipped: [] },
    }),
    createChildThread: async () => ({
      content: [{ type: "text", text: "created" }],
      details: { action: "pi_gui_create_child_thread", prompt: "" },
    }),
    runWorker: async (_ctx, input) => {
      received = input;
      return {
        content: [{ type: "text", text: "worker result" }],
        details: {
          action: "pi_gui_spawn_worker",
          prompt: input.prompt,
          status: "succeeded",
          text: "worker result",
        },
      };
    },
    listModels: async () => {
      modelReads++;
      return {
        content: [{ type: "text", text: "provider-a/reasoning-a" }],
        details: {
          action: "pi_gui_list_models",
          models: [
            {
              provider: "provider-a",
              modelId: "reasoning-a",
              label: "Reasoning A",
              reasoning: true,
              thinkingLevels: ["off", "low", "high", "max"],
            },
          ],
        },
      };
    },
    listThreads: async () => ({
      content: [{ type: "text", text: "list" }],
      details: { action: "pi_gui_list_threads" },
    }),
    readThread: async (_ctx, threadId) => ({
      content: [{ type: "text", text: "read" }],
      details: { action: "pi_gui_read_thread", threadId },
    }),
    sendMessageToThread: async (_ctx, input) => ({
      content: [{ type: "text", text: "sent" }],
      details: {
        action: "pi_gui_send_message_to_thread",
        threadId: input.threadId,
        message: input.message,
      },
    }),
  };
  const tools = createOrchestrationRuntimeTools(bridge);
  const spawn = tools.find((candidate) => candidate.name === "spawn_worker");
  const listModels = tools.find((candidate) => candidate.name === "list_models");
  expect(spawn?.promptGuidelines?.join(" ")).toContain("call list_models");
  expect(spawn?.promptGuidelines?.join(" ")).toContain("Do not call Codex-native");
  expect(spawn?.parameters).toMatchObject({
    properties: {
      prompt: { type: "string" },
      model: { type: "string" },
      thinkingLevel: {
        enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
      },
      selection: {
        type: "object",
        required: ["provider", "modelId"],
        additionalProperties: false,
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  });

  const controller = new AbortController();
  const selection = {
    provider: "provider-a",
    modelId: "reasoning-a",
    thinkingLevel: "high",
  } as const;
  await spawn?.execute(
    "worker-call",
    {
      prompt: "Inspect this selected model.",
      model: "provider-a/reasoning-a",
      thinkingLevel: "high",
    },
    controller.signal,
    undefined,
    {} as ExtensionToolContext,
  );
  expect(received).toEqual({
    prompt: "Inspect this selected model.",
    toolCallId: "worker-call",
    selection,
    signal: controller.signal,
  });

  await listModels?.execute(
    "models-call",
    {},
    controller.signal,
    undefined,
    {} as ExtensionToolContext,
  );
  expect(modelReads).toBe(1);
});

test("prompt-only creation preserves owner defaults without reading selection policy", async () => {
  const baseOptions: CreateSessionOptions = {
    initialModel: { provider: "default-provider", modelId: "default-model" },
    initialThinkingLevel: "medium",
  };
  let effectiveReads = 0;
  let createOptions: CreateSessionOptions | undefined;
  const host = {
    driver: {
      cancelCurrentRun: async () => undefined,
      createSession: async (_workspace: unknown, options?: CreateSessionOptions) => {
        createOptions = options;
        throw new Error("stop after capture");
      },
    },
    initialize: async () => undefined,
    orchestrationState: () => ({ workspaces: [], orchestrationChildren: [] }),
    workspaceRefFromState: () => ({ workspaceId: "ws", path: "/tmp" }),
    sessionFromState: () => ({ title: "Parent", status: "idle", updatedAt: timestamp }),
    buildCreateSessionOptions: async () => baseOptions,
    getEffectiveChildModelSettings: async () => {
      effectiveReads++;
      return effective;
    },
  };
  const owner = createOrchestrationOwner(
    host as unknown as Parameters<typeof createOrchestrationOwner>[0],
  );

  await expect(
    owner.createChildThreadToolResult(parentRef, {
      prompt: "Keep the configured defaults.",
      toolCallId: "prompt-only",
    }),
  ).rejects.toThrow("stop after capture");
  expect(createOptions).toEqual({
    ...baseOptions,
    title: "Keep the configured defaults.",
  });
  expect(effectiveReads).toBe(0);
});

test("valid explicit creation reaches driver create options before dispatch", async () => {
  const baseOptions: CreateSessionOptions = {
    initialModel: { provider: "default-provider", modelId: "default-model" },
    initialThinkingLevel: "medium",
    extensionFlagValues: { review: true },
  };
  let createOptions: CreateSessionOptions | undefined;
  let effectiveReads = 0;
  const host = {
    driver: {
      cancelCurrentRun: async () => undefined,
      createSession: async (_workspace: unknown, options?: CreateSessionOptions) => {
        createOptions = options;
        throw new Error("stop after capture");
      },
    },
    initialize: async () => undefined,
    orchestrationState: () => ({ workspaces: [], orchestrationChildren: [] }),
    workspaceRefFromState: () => ({ workspaceId: "ws", path: "/tmp" }),
    sessionFromState: () => ({ title: "Parent", status: "idle", updatedAt: timestamp }),
    buildCreateSessionOptions: async () => baseOptions,
    getEffectiveChildModelSettings: async () => {
      effectiveReads++;
      return effective;
    },
  };
  const owner = createOrchestrationOwner(
    host as unknown as Parameters<typeof createOrchestrationOwner>[0],
  );

  await expect(
    owner.createChildThreadToolResult(parentRef, {
      prompt: "Use the exact child model.",
      toolCallId: "explicit-call",
      selection: {
        provider: "provider-a",
        modelId: "reasoning-a",
        thinkingLevel: "max",
      },
    }),
  ).rejects.toThrow("stop after capture");
  expect(createOptions).toEqual({
    initialModel: { provider: "provider-a", modelId: "reasoning-a" },
    initialThinkingLevel: "max",
    extensionFlagValues: { review: true },
    title: "Use the exact child model.",
  });
  expect(effectiveReads).toBe(1);
});

test("invalid selection fails before any session creation", async () => {
  let createCalls = 0;
  const host = {
    driver: {
      cancelCurrentRun: async () => undefined,
      createSession: async () => {
        createCalls++;
        throw new Error("must not create");
      },
    },
    initialize: async () => undefined,
    orchestrationState: () => ({ workspaces: [], orchestrationChildren: [] }),
    workspaceRefFromState: () => ({ workspaceId: "ws", path: "/tmp" }),
    sessionFromState: () => ({ title: "Parent", status: "idle", updatedAt: timestamp }),
    buildCreateSessionOptions: async () => undefined,
    getEffectiveChildModelSettings: async () => effective,
  };
  const owner = createOrchestrationOwner(
    host as unknown as Parameters<typeof createOrchestrationOwner>[0],
  );

  await expect(
    owner.createChildThreadToolResult(parentRef, {
      prompt: "This must not create a child.",
      toolCallId: "invalid-call",
      selection: { provider: "provider-a", modelId: "unavailable" },
    }),
  ).rejects.toThrow(/Child model is unavailable/);
  expect(createCalls).toBe(0);
});

test("inline worker resolves the exact catalogue entry and inherits the parent thinking level", async () => {
  let hostInput:
    | {
        readonly parentRunId: string;
        readonly parentToolCallId: string;
        readonly signal: AbortSignal;
      }
    | undefined;
  let workerSelection: InlineWorkerModelSelection | undefined;
  const signal = new AbortController().signal;
  const host = {
    driver: {
      cancelCurrentRun: async () => undefined,
      createSession: async () => {
        throw new Error("Inline workers must not create a thread");
      },
      openSession: async () => ({
        ref: parentRef,
        workspace: { workspaceId: "ws", path: "/tmp" },
        title: "Parent",
        status: "running",
        updatedAt: timestamp,
        runningRunId: "run-a",
        config: {
          provider: "provider-a",
          modelId: "reasoning-a",
          thinkingLevel: "medium",
        },
      }),
      createInlineWorkerHostCapability: async (
        _parent: unknown,
        parentRunId: string,
        parentToolCallId: string,
        workerSignal: AbortSignal,
      ) => {
        hostInput = { parentRunId, parentToolCallId, signal: workerSignal };
        return {} as never;
      },
      startInlineWorker: (
        _request: unknown,
        _host: unknown,
        selection?: InlineWorkerModelSelection,
      ) => {
        workerSelection = selection;
        return {
          initial: { status: "running", workerId: "worker", workerRunId: "worker-run" },
          completion: Promise.resolve({
            status: "succeeded",
            workerId: "worker",
            workerRunId: "worker-run",
            text: "inline result",
          }),
        };
      },
    },
    initialize: async () => undefined,
    orchestrationState: () => ({ workspaces: [], orchestrationChildren: [] }),
    workspaceRefFromState: () => ({ workspaceId: "ws", path: "/tmp" }),
    sessionFromState: () => ({ title: "Parent", status: "running", updatedAt: timestamp }),
    buildCreateSessionOptions: async () => undefined,
    getEffectiveChildModelSettings: async () => effective,
    ensureSessionReady: async () => undefined,
  };
  const owner = createOrchestrationOwner(
    host as unknown as Parameters<typeof createOrchestrationOwner>[0],
  );
  const result = await owner.runWorkerToolResult(parentRef, {
    prompt: "Run the selected worker.",
    toolCallId: "worker-call",
    selection: { provider: "provider-a", modelId: "reasoning-a" },
    signal,
  });

  expect(hostInput).toEqual({
    parentRunId: "run-a",
    parentToolCallId: "worker-call",
    signal,
  });
  expect(workerSelection).toEqual({
    provider: "provider-a",
    modelId: "reasoning-a",
    thinkingLevel: "medium",
  });
  expect(result.details).toMatchObject({
    action: "pi_gui_spawn_worker",
    status: "succeeded",
    text: "inline result",
    modelProvider: "provider-a",
    modelId: "reasoning-a",
    thinkingLevel: "medium",
  });
});

test("list_models returns only currently usable models with exact thinking support", async () => {
  const host = {
    driver: {
      cancelCurrentRun: async () => undefined,
      createSession: async () => undefined,
    },
    initialize: async () => undefined,
    orchestrationState: () => ({ workspaces: [], orchestrationChildren: [] }),
    workspaceRefFromState: () => ({ workspaceId: "ws", path: "/tmp" }),
    sessionFromState: () => ({ title: "Parent", status: "idle", updatedAt: timestamp }),
    getEffectiveChildModelSettings: async () => ({
      ...effective,
      models: [{ ...effective.models[0]!, label: "Reasoning A" }, ...effective.models.slice(1)],
    }),
  };
  const owner = createOrchestrationOwner(
    host as unknown as Parameters<typeof createOrchestrationOwner>[0],
  );
  const result = await owner.listModelsToolResult(parentRef);

  expect(result.details).toMatchObject({
    action: "pi_gui_list_models",
    models: [
      {
        provider: "provider-a",
        modelId: "reasoning-a",
        label: "Reasoning A",
        reasoning: true,
      },
      {
        provider: "provider-b",
        modelId: "plain-b",
        reasoning: false,
        thinkingLevels: ["off"],
      },
    ],
    defaultProvider: "provider-a",
    defaultModelId: "reasoning-a",
    defaultThinkingLevel: "medium",
  });
  expect(result.details?.models).toHaveLength(2);
});

test("replay returns the original child and selection without consulting current policy", async () => {
  const originalSelection = {
    provider: "provider-b",
    modelId: "plain-b",
    thinkingLevel: "off",
  } as const;
  const child: OrchestrationChildThread = {
    id: "child-link",
    sourceToolCallId: "replayed-call",
    parentWorkspaceId: "ws",
    parentSessionId: "parent",
    childWorkspaceId: "ws",
    childSessionId: "child",
    origin: {
      kind: "child-thread",
      source: "desktop-host",
      parentWorkspaceId: "ws",
      parentSessionId: "parent",
      sourceToolCallId: "replayed-call",
    },
    selectedConfig: originalSelection,
    title: "Original child",
    goal: "Original prompt",
    status: "running",
    latestTranscript: "Original prompt",
    transcript: [],
    evidence: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let createCalls = 0;
  let effectiveReads = 0;
  const host = {
    driver: {
      cancelCurrentRun: async () => undefined,
      createSession: async () => {
        createCalls++;
        throw new Error("must not create");
      },
    },
    initialize: async () => undefined,
    orchestrationState: () => ({ workspaces: [], orchestrationChildren: [child] }),
    workspaceRefFromState: () => ({ workspaceId: "ws", path: "/tmp" }),
    sessionFromState: (ref: { sessionId: string }) =>
      ref.sessionId === "child"
        ? { title: child.title, status: "running", updatedAt: timestamp }
        : { title: "Parent", status: "idle", updatedAt: timestamp },
    ensureSessionReady: async () => undefined,
    transcriptFor: (ref: { sessionId: string }) =>
      ref.sessionId === "child"
        ? [
            {
              kind: "message" as const,
              id: "prompt",
              role: "user" as const,
              text: "Original prompt",
              createdAt: timestamp,
            },
          ]
        : [],
    getSessionError: () => undefined,
    getQueuedComposerMessages: () => [],
    buildCreateSessionOptions: async () => undefined,
    getEffectiveChildModelSettings: async () => {
      effectiveReads++;
      return effective;
    },
  };
  const owner = createOrchestrationOwner(
    host as unknown as Parameters<typeof createOrchestrationOwner>[0],
  );

  const result = await owner.createChildThreadToolResult(parentRef, {
    prompt: "Original prompt",
    toolCallId: "replayed-call",
    selection: {
      provider: "provider-a",
      modelId: "reasoning-a",
      thinkingLevel: "max",
    },
  });
  expect(result.details).toMatchObject({
    childThreadId: "child-link",
    childSessionId: "child",
    deliveryStatus: "running",
    origin: child.origin,
    selectedConfig: originalSelection,
  });
  expect(createCalls).toBe(0);
  expect(effectiveReads).toBe(0);
});
