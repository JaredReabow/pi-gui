import { childSelection_rejectOriginInput } from "../../contracts/child-selection";
import type {
  ChildModelSelection,
  ChildOriginMetadata,
  ChildSelectedConfiguration,
} from "../../contracts/child-selection";
import {
  childSelection_decode,
  childSelection_decodeSelectedConfig,
} from "../../contracts/child-selection";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export const createChildThreadToolName = "create_child_thread";
export const createChildThreadAction = "pi_gui_create_child_thread";
export const spawnWorkerToolName = "spawn_worker";
export const spawnWorkerAction = "pi_gui_spawn_worker";
export const listModelsToolName = "list_models";
export const listModelsAction = "pi_gui_list_models";
export const listThreadsToolName = "list_threads";
export const listThreadsAction = "pi_gui_list_threads";
export const readThreadToolName = "read_thread";
export const readThreadAction = "pi_gui_read_thread";
export const sendMessageToThreadToolName = "send_message_to_thread";
export const sendMessageToThreadAction = "pi_gui_send_message_to_thread";
export const archiveChildThreadsToolName = "archive_child_threads";
export const archiveChildThreadsAction = "pi_gui_archive_child_threads";

/** Every pi-gui thread tool. Their names are not file or search tools, whatever they contain. */
export const orchestrationToolNames: ReadonlySet<string> = new Set([
  createChildThreadToolName,
  spawnWorkerToolName,
  listModelsToolName,
  listThreadsToolName,
  readThreadToolName,
  sendMessageToThreadToolName,
  archiveChildThreadsToolName,
]);

export interface ArchiveChildThreadsToolDetails {
  readonly action: typeof archiveChildThreadsAction;
  readonly archived: readonly string[];
  readonly skipped: readonly { readonly threadId: string; readonly reason: string }[];
  readonly error?: string;
}

export interface CreateChildThreadToolDetails {
  readonly origin?: ChildOriginMetadata;
  readonly selectedConfig?: ChildSelectedConfiguration;
  readonly action: typeof createChildThreadAction;
  readonly prompt: string;
  readonly childThreadId?: string;
  readonly childWorkspaceId?: string;
  readonly childSessionId?: string;
  readonly title?: string;
  readonly deliveryStatus?: "running" | "responded";
  readonly error?: string;
}

export interface SpawnWorkerToolDetails {
  readonly action: typeof spawnWorkerAction;
  readonly prompt: string;
  readonly status?: "succeeded" | "failed" | "cancelled" | "timedOut";
  readonly text?: string;
  readonly modelProvider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
  readonly error?: string;
}

export interface ListModelsToolDetails {
  readonly action: typeof listModelsAction;
  readonly models?: readonly {
    readonly provider: string;
    readonly modelId: string;
    readonly label?: string;
    readonly reasoning: boolean;
    readonly thinkingLevels: readonly string[];
  }[];
  readonly defaultProvider?: string;
  readonly defaultModelId?: string;
  readonly defaultThinkingLevel?: string;
  readonly error?: string;
}

export interface OrchestrationThreadListEntry {
  readonly threadId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly status: string;
  /** `workspace` threads share the caller's project; `other_project` threads live in another one. */
  readonly relationship: "current" | "child" | "workspace" | "other_project";
  /** Display name of the thread's project, set only for `other_project` threads. */
  readonly project?: string;
  readonly updatedAt: string;
  readonly preview: string;
  readonly childThreadId?: string;
  readonly supervisionGate?: "continue" | "wake" | "stop";
  readonly supervisionReason?: string;
  readonly nextSupervisionRunAt?: string;
}

export interface OrchestrationThreadTranscriptMessage {
  readonly id: string;
  readonly role: "parent" | "child" | "system";
  readonly text: string;
  readonly createdAt: string;
}

export interface ListThreadsToolDetails {
  readonly action: typeof listThreadsAction;
  /** The `workspace` argument, when the call named another project or `*`. */
  readonly workspace?: string;
  readonly threads?: readonly OrchestrationThreadListEntry[];
  /** Threads a `*` listing left out past its cap; name a project to see them. */
  readonly omittedThreadCount?: number;
  readonly error?: string;
}

export interface ReadThreadToolDetails {
  readonly action: typeof readThreadAction;
  readonly threadId: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly title?: string;
  readonly status?: string;
  readonly childThreadId?: string;
  readonly goal?: string;
  readonly messages?: readonly OrchestrationThreadTranscriptMessage[];
  readonly error?: string;
}

export interface SendMessageToThreadToolDetails {
  readonly action: typeof sendMessageToThreadAction;
  readonly threadId: string;
  readonly message: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly status?: "queued" | "sent";
  readonly queuedMessageCount?: number;
  /** Display name of the receiving project, set only when it is not the sender's project. */
  readonly project?: string;
  readonly error?: string;
}

export interface OrchestrationRuntimeBridge {
  readonly archiveChildThreads: (
    ctx: ExtensionContext,
    threadIds: readonly string[],
  ) => Promise<AgentToolResult<ArchiveChildThreadsToolDetails>>;
  readonly createChildThread: (
    ctx: ExtensionContext,
    input: {
      readonly prompt: string;
      readonly toolCallId: string;
      readonly selection?: ChildModelSelection;
    },
  ) => Promise<AgentToolResult<CreateChildThreadToolDetails>>;
  readonly listModels: (ctx: ExtensionContext) => Promise<AgentToolResult<ListModelsToolDetails>>;
  readonly runWorker: (
    ctx: ExtensionContext,
    input: {
      readonly prompt: string;
      readonly toolCallId: string;
      readonly selection?: ChildModelSelection;
      readonly signal?: AbortSignal;
    },
  ) => Promise<AgentToolResult<SpawnWorkerToolDetails>>;
  readonly listThreads: (
    ctx: ExtensionContext,
    input: { readonly workspace?: string },
  ) => Promise<AgentToolResult<ListThreadsToolDetails>>;
  readonly readThread: (
    ctx: ExtensionContext,
    threadId: string,
  ) => Promise<AgentToolResult<ReadThreadToolDetails>>;
  readonly sendMessageToThread: (
    ctx: ExtensionContext,
    input: { readonly threadId: string; readonly message: string },
  ) => Promise<AgentToolResult<SendMessageToThreadToolDetails>>;
}

type OrchestrationToolDetails =
  | ArchiveChildThreadsToolDetails
  | CreateChildThreadToolDetails
  | SpawnWorkerToolDetails
  | ListModelsToolDetails
  | ListThreadsToolDetails
  | ReadThreadToolDetails
  | SendMessageToThreadToolDetails;

function createCreateChildThreadTool(
  bridge: OrchestrationRuntimeBridge,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: createChildThreadToolName,
    label: "Create child thread",
    description:
      "Start a separate pi-gui child thread for a delegated investigation or implementation task.",
    promptSnippet: "create_child_thread: start a separate pi-gui child thread for delegated work.",
    promptGuidelines: [
      "Use create_child_thread when the user asks you to spin up, delegate to, or run a separate child thread.",
      "Keep the child prompt concrete and self-contained so the user can inspect the resulting thread.",
      "Call list_models before choosing an exact provider/modelId or thinking level. Copy the returned values exactly; never guess or silently substitute one.",
      "Prefer the top-level model and thinkingLevel fields. When model is present, the legacy selection object is compatibility input and is ignored.",
      "pi-gui does not use the Codex-native create_thread or list_projects tool names. Use create_child_thread and list_threads.",
    ],
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Concrete instructions for the child thread.",
        },
        model: {
          type: "string",
          description:
            'Exact provider/model pair returned by list_models, for example "codex-router/deepseek/deepseek-v4.1-flash". Omit to inherit the current thread model.',
        },
        thinkingLevel: {
          type: "string",
          enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
          description:
            "Optional thinking level reported for the selected model. Omit to inherit the current thread level when supported.",
        },
        selection: {
          type: "object",
          description:
            "Legacy structured form of model and thinkingLevel. Ignored when the top-level model field is present.",
          properties: {
            provider: {
              type: "string",
              description: "Exact provider id from the effective model catalogue.",
            },
            modelId: {
              type: "string",
              description: "Exact model id from the effective model catalogue.",
            },
            thinkingLevel: {
              type: "string",
              enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
              description: "Exact supported thinking level.",
            },
          },
          required: ["provider", "modelId"],
          additionalProperties: false,
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      childSelection_rejectOriginInput(params);
      const prompt = createChildThreadPromptFromParams(params);
      if (!prompt) {
        throw new Error("create_child_thread requires a non-empty prompt.");
      }
      const selection = createChildThreadSelectionFromParams(params);
      return bridge.createChildThread(ctx, {
        prompt,
        toolCallId,
        ...(selection ? { selection } : {}),
      });
    },
  };
}

function createSpawnWorkerTool(
  bridge: OrchestrationRuntimeBridge,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: spawnWorkerToolName,
    label: "Run inline worker",
    description:
      "Run a self-contained worker inline on the current or a selected model, returning its final answer without creating a thread.",
    promptSnippet:
      "spawn_worker: run a delegated worker inline on the current or a selected model and return its answer here.",
    promptGuidelines: [
      "Use spawn_worker for a focused delegated task whose final answer should return in this conversation without creating a new thread.",
      "The worker inherits the current model and thinking level unless selection is provided.",
      "Before selecting a model, call list_models and copy its exact provider and modelId. Use list_models to determine whether the model supports thinking and the exact thinking levels available.",
      "Prefer the top-level model and thinkingLevel fields. When model is present, the legacy selection object is compatibility input and is ignored.",
      "Do not call Codex-native list_projects, create_thread, or other unavailable tool names. pi-gui exposes list_threads, create_child_thread, and spawn_worker.",
    ],
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Concrete, self-contained instructions for the worker. Its final response is returned as this tool's result.",
        },
        model: {
          type: "string",
          description:
            'Exact provider/model pair returned by list_models, for example "codex-router/deepseek/deepseek-v4.1-flash". Omit to inherit the current thread model.',
        },
        thinkingLevel: {
          type: "string",
          enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
          description:
            "Optional thinking level reported for the selected model. Omit to inherit the current thread level when supported.",
        },
        selection: {
          type: "object",
          description:
            "Legacy structured form of model and thinkingLevel. Ignored when the top-level model field is present.",
          properties: {
            provider: {
              type: "string",
              description: "Exact provider id returned by list_models.",
            },
            modelId: {
              type: "string",
              description: "Exact model id returned by list_models.",
            },
            thinkingLevel: {
              type: "string",
              enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
              description:
                "Exact thinking level reported for the selected model. Omit to inherit the current thread's level.",
            },
          },
          required: ["provider", "modelId"],
          additionalProperties: false,
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      childSelection_rejectOriginInput(params);
      const prompt = createChildThreadPromptFromParams(params);
      if (!prompt) {
        throw new Error("spawn_worker requires a non-empty prompt.");
      }
      const selection = createChildThreadSelectionFromParams(params);
      return bridge.runWorker(ctx, {
        prompt,
        toolCallId,
        ...(selection ? { selection } : {}),
        ...(signal ? { signal } : {}),
      });
    },
  };
}

function createListModelsTool(
  bridge: OrchestrationRuntimeBridge,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: listModelsToolName,
    label: "List worker models",
    description:
      "List the models currently available for pi-gui child threads and inline workers, including reasoning support.",
    promptSnippet:
      "list_models: list currently available worker models and their supported thinking levels.",
    promptGuidelines: [
      "Call list_models before an explicit model selection for create_child_thread or spawn_worker.",
      "Only use entries returned by this tool. Provider and modelId are an exact pair; labels are display names only.",
    ],
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      return bridge.listModels(ctx);
    },
  };
}

function createListThreadsTool(
  bridge: OrchestrationRuntimeBridge,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: listThreadsToolName,
    label: "List threads",
    description:
      "List pi-gui threads in the current project and parent thread, or in another project.",
    promptSnippet:
      "list_threads: list pi-gui threads for the current project, another project, or every project.",
    promptGuidelines: [
      "Use list_threads before reading or messaging another pi-gui thread when you need the exact thread id.",
      'Pass workspace with a project name, path or id to list that project\'s threads, or "*" for every project.',
      "Use the returned thread id with read_thread or send_message_to_thread.",
    ],
    parameters: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description:
            'Optional project name, path or id to list instead of the current project, or "*" for every project.',
        },
      },
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const workspace = isRecord(params) ? stringParam(params, "workspace") : undefined;
      return bridge.listThreads(ctx, workspace ? { workspace } : {});
    },
  };
}

function createReadThreadTool(
  bridge: OrchestrationRuntimeBridge,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: readThreadToolName,
    label: "Read thread",
    description: "Read a pi-gui thread transcript or child thread summary by id.",
    promptSnippet: "read_thread: read a pi-gui thread transcript by id.",
    promptGuidelines: [
      "Use read_thread with a thread id returned by list_threads or create_child_thread.",
      "Prefer reading a child thread before summarizing its status back to the parent.",
    ],
    parameters: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          description: "Thread id, child thread id, or session id to read.",
        },
      },
      required: ["thread_id"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const threadId = threadIdFromParams(params);
      if (!threadId) {
        return {
          content: [{ type: "text", text: "read_thread requires a thread_id." }],
          details: {
            action: readThreadAction,
            threadId: "",
            error: "read_thread requires a thread_id.",
          },
        };
      }
      return bridge.readThread(ctx, threadId);
    },
  };
}

function createSendMessageToThreadTool(
  bridge: OrchestrationRuntimeBridge,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: sendMessageToThreadToolName,
    label: "Send message to thread",
    description:
      "Send a follow-up message to an existing pi-gui thread in this project or another project.",
    promptSnippet: "send_message_to_thread: send a follow-up to an existing pi-gui thread.",
    promptGuidelines: [
      "Use send_message_to_thread to follow up with an existing child, sibling, or other-project pi-gui thread.",
      "Use a thread id returned by list_threads or create_child_thread.",
    ],
    parameters: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          description: "Thread id, child thread id, or session id to message.",
        },
        message: {
          type: "string",
          description: "Follow-up message to send.",
        },
      },
      required: ["thread_id", "message"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const threadId = threadIdFromParams(params);
      const message = messageFromParams(params);
      if (!threadId || !message) {
        return {
          content: [
            { type: "text", text: "send_message_to_thread requires thread_id and message." },
          ],
          details: {
            action: sendMessageToThreadAction,
            threadId: threadId ?? "",
            message: message ?? "",
            error: "send_message_to_thread requires thread_id and message.",
          },
        };
      }
      return bridge.sendMessageToThread(ctx, { threadId, message });
    },
  };
}

function createArchiveChildThreadsTool(
  bridge: OrchestrationRuntimeBridge,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: archiveChildThreadsToolName,
    label: "Archive completed child threads",
    description:
      "Archive completed direct child threads of the current thread, preserving their history and drafts. Running, queued, incomplete and unrelated threads are skipped. Archived threads can be restored from the sidebar.",
    promptSnippet:
      "archive_child_threads: archive completed child threads only when the user requests it.",
    promptGuidelines: [
      "Only use archive_child_threads after the user explicitly asks to archive completed child threads; never archive proactively.",
      "Use list_threads and read_thread to identify your own children and confirm their requested work is finished. A stopped model turn alone does not prove the task is done.",
      "Pass exact thread ids and report the archived and skipped results. Never stop tasks or discard queued messages to make them eligible.",
    ],
    parameters: {
      type: "object",
      properties: {
        thread_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 100,
          description: "Exact completed direct child thread ids returned by list_threads.",
        },
      },
      required: ["thread_ids"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (
        !isRecord(params) ||
        !Array.isArray(params.thread_ids) ||
        params.thread_ids.length < 1 ||
        params.thread_ids.length > 100 ||
        !params.thread_ids.every(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        )
      ) {
        return {
          content: [
            { type: "text", text: "archive_child_threads requires 1–100 exact thread_ids." },
          ],
          details: {
            action: archiveChildThreadsAction,
            archived: [],
            skipped: [],
            error: "Invalid thread_ids",
          },
        };
      }
      return bridge.archiveChildThreads(
        ctx,
        params.thread_ids.map((id: string) => id.trim()),
      );
    },
  };
}

export function createOrchestrationRuntimeTools(
  bridge: OrchestrationRuntimeBridge,
): readonly ToolDefinition<any, OrchestrationToolDetails>[] {
  return [
    createCreateChildThreadTool(bridge),
    createSpawnWorkerTool(bridge),
    createListModelsTool(bridge),
    createListThreadsTool(bridge),
    createReadThreadTool(bridge),
    createSendMessageToThreadTool(bridge),
    createArchiveChildThreadsTool(bridge),
  ];
}

export function createOrchestrationRuntimeExtension(
  bridge: OrchestrationRuntimeBridge,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    for (const tool of createOrchestrationRuntimeTools(bridge)) {
      pi.registerTool(tool);
    }
  };
}

export function createChildThreadPromptFromParams(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  return prompt || undefined;
}

export function createChildThreadSelectionFromParams(
  params: unknown,
): ChildModelSelection | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const model = stringParam(params, "model");
  const thinkingLevel = stringParam(params, "thinkingLevel");
  const hasStructuredSelection = "selection" in params;
  if (model) {
    const separator = model.indexOf("/");
    if (separator <= 0 || separator === model.length - 1) {
      throw new Error("model must be an exact provider/modelId pair returned by list_models.");
    }
    return childSelection_decode({
      provider: model.slice(0, separator),
      modelId: model.slice(separator + 1),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
  }
  if (thinkingLevel) {
    if (!hasStructuredSelection) {
      throw new Error("thinkingLevel requires model or selection.");
    }
    const selected = childSelection_decode(params.selection);
    return childSelection_decode({
      provider: selected.provider,
      modelId: selected.modelId,
      thinkingLevel,
    });
  }
  if (hasStructuredSelection) {
    return childSelection_decode(params.selection);
  }
  if ("selectedConfig" in params) {
    const selected = childSelection_decodeSelectedConfig(params.selectedConfig);
    if (selected.provider && selected.modelId) {
      return childSelection_decode({
        provider: selected.provider,
        modelId: selected.modelId,
        ...(selected.thinkingLevel ? { thinkingLevel: selected.thinkingLevel } : {}),
      });
    }
  }
  return undefined;
}

export function createChildThreadRequestFromToolOutput(
  output: unknown,
): { readonly prompt: string; readonly selection?: ChildModelSelection } | undefined {
  const details = toolOutputDetails(output);
  if (details?.action !== createChildThreadAction) {
    return undefined;
  }
  const prompt = createChildThreadPromptFromParams(details);
  if (!prompt) {
    return undefined;
  }
  const selection = createChildThreadSelectionFromParams(details);
  return { prompt, ...(selection ? { selection } : {}) };
}

export function createChildThreadPromptFromToolOutput(output: unknown): string | undefined {
  return createChildThreadRequestFromToolOutput(output)?.prompt;
}

export function listThreadsRequestedFromToolOutput(output: unknown): boolean {
  return toolOutputDetails(output)?.action === listThreadsAction;
}

export function readThreadIdFromToolOutput(output: unknown): string | undefined {
  const details = toolOutputDetails(output);
  if (details?.action !== readThreadAction) {
    return undefined;
  }
  return threadIdFromParams(details);
}

export function sendMessageToThreadFromToolOutput(
  output: unknown,
): { readonly threadId: string; readonly message: string } | undefined {
  const details = toolOutputDetails(output);
  if (details?.action !== sendMessageToThreadAction) {
    return undefined;
  }
  const threadId = threadIdFromParams(details);
  const message = messageFromParams(details);
  if (!threadId || !message) {
    return undefined;
  }
  return { threadId, message };
}

function toolOutputDetails(output: unknown): Record<string, unknown> | undefined {
  if (!isRecord(output) || !isRecord(output.details)) {
    return undefined;
  }
  return output.details;
}

function threadIdFromParams(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const threadId =
    stringParam(params, "thread_id") ??
    stringParam(params, "threadId") ??
    stringParam(params, "id");
  return threadId || undefined;
}

function messageFromParams(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const message = stringParam(params, "message") ?? stringParam(params, "text");
  return message || undefined;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
