import { join } from "node:path";
import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createExtensionRuntime,
  type CreateAgentSessionOptions,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import {
  projectImport_sanitizeMonitorText,
  type ProjectImportModelOption,
  type ProjectImportMonitorRequest,
  type ProjectImportMonitorResult,
} from "@pi-gui/session-driver";
import { projectImportMonitor_decodeDecision } from "./project-import-monitor-decision.js";
import { messageText as sessionMessageText } from "./session-supervisor-utils.js";

const MONITOR_SYSTEM_PROMPT = [
  "You monitor a deterministic local project-import operation.",
  "You receive only counts, project display names, statuses and sanitized error messages.",
  "You cannot request file contents, paths, credentials or additional tools.",
  "Choose exactly one action: continue when the operation should finish, retry when the same import should be attempted once more, or skip when the failed items should remain skipped.",
  'Return only JSON: {"action":"continue|retry|skip","message":"one short sentence"}.',
].join("\n");

export async function listProjectImportModels(
  agentDir: string,
): Promise<readonly ProjectImportModelOption[]> {
  const runtime = await createModelRuntime(agentDir);
  const available = await runtime.getAvailable();
  return available
    .map((model) => ({
      provider: model.provider,
      modelId: model.id,
      label: model.name,
      reasoning: model.reasoning,
    }))
    .sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.label.localeCompare(right.label),
    );
}

export async function monitorProjectImport(
  request: ProjectImportMonitorRequest,
  deps: { readonly agentDir: string },
): Promise<ProjectImportMonitorResult> {
  try {
    const modelRuntime = await createModelRuntime(deps.agentDir);
    const model = modelRuntime.getModel(request.model.provider, request.model.modelId);
    if (!model || !(await modelRuntime.getAuth(model))) {
      return unavailable("The selected monitoring model is not connected.");
    }
    const createOptions: CreateAgentSessionOptions = {
      cwd: request.cwd,
      agentDir: deps.agentDir,
      model,
      modelRuntime,
      resourceLoader: monitorResourceLoader(),
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
      tools: [],
    };
    const { session } = await createAgentSession(createOptions);
    try {
      await session.prompt(buildMonitorPrompt(request), { source: "interactive" });
      const decision = projectImportMonitor_decodeDecision(extractLastAssistantText(session));
      return decision
        ? { status: "completed", ...decision }
        : unavailable("The monitoring model returned an invalid decision.");
    } finally {
      session.dispose();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(message.slice(0, 240));
  }
}

async function createModelRuntime(agentDir: string): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    refreshOnCreate: false,
  });
  await runtime.refresh({ allowNetwork: false });
  return runtime;
}

function monitorResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => MONITOR_SYSTEM_PROMPT,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function buildMonitorPrompt(request: ProjectImportMonitorRequest): string {
  const bounded = {
    candidatesFound: request.candidatesFound,
    imported: request.imported,
    alreadyPresent: request.alreadyPresent,
    failures: request.failures.slice(0, 50).map((failure) => ({
      name: failure.name.slice(0, 100),
      status: "failed",
      error: projectImport_sanitizeMonitorText(failure.error),
    })),
  };
  return [
    "Review this local project-import result.",
    "If every import succeeded, choose continue.",
    "Retry only when another deterministic attempt is reasonable.",
    "Return only the required JSON object.",
    "",
    JSON.stringify(bounded),
  ].join("\n");
}

function extractLastAssistantText(session: { messages: readonly unknown[] }): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "assistant"
    ) {
      return sessionMessageText(message);
    }
  }
  return "";
}

function unavailable(message: string): ProjectImportMonitorResult {
  return { status: "unavailable", action: "continue", message };
}
