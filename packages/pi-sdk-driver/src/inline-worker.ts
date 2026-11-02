import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type {
  InlineWorkerFailedResult,
  InlineWorkerHostAssociation,
  InlineWorkerTerminalResult,
} from "@pi-gui/session-driver";
import {
  inlineWorkerPolicy_errorResult,
  inlineWorkerPolicy_sanitizeError,
  type InlineWorkerPolicy,
} from "./inline-worker-policy.js";

export type InlineWorkerCancellationReason = "caller" | "parent" | "deadline";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface InlineWorkerExecutionContext {
  readonly association: InlineWorkerHostAssociation;
  readonly prompt: string;
  readonly model: NonNullable<AgentSession["model"]>;
  readonly modelRuntime: ModelRuntime;
  readonly thinkingLevel: ThinkingLevel;
  readonly cwd: string;
  readonly agentDir: string;
  readonly parentSignal: AbortSignal;
}

export interface InlineWorkerExecutorOptions {
  readonly policy: InlineWorkerPolicy;
  /**
   * Test seam only. Production uses the pinned SDK constructor and passes the
   * same options asserted by the real-core tests.
   */
  readonly createAgentSessionImpl?: (
    options: CreateAgentSessionOptions,
  ) => Promise<CreateAgentSessionResult>;
}

function finalAssistant(session: AgentSession) {
  return [...session.messages].reverse().find((message) => message.role === "assistant");
}

function assistantText(message: ReturnType<typeof finalAssistant>): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function failed(
  association: InlineWorkerHostAssociation,
  code: InlineWorkerFailedResult["error"]["code"],
  error: unknown,
  policy: InlineWorkerPolicy,
): InlineWorkerFailedResult {
  return {
    status: "failed",
    workerId: association.workerId,
    workerRunId: association.workerRunId,
    error: inlineWorkerPolicy_errorResult(code, error, policy),
  };
}

function cancellationResult(
  association: InlineWorkerHostAssociation,
  reason: InlineWorkerCancellationReason,
): InlineWorkerTerminalResult {
  return reason === "deadline"
    ? {
        status: "timedOut",
        workerId: association.workerId,
        workerRunId: association.workerRunId,
      }
    : {
        status: "cancelled",
        workerId: association.workerId,
        workerRunId: association.workerRunId,
      };
}

/**
 * Build a resource loader with every discovery surface disabled. Keeping the
 * empty extension runtime is necessary for Pi's extension runner, but no
 * extension factory, CLI resource, package, skill, prompt, theme, context file
 * or MCP provider can enter this worker.
 */
async function createIsolatedResourceLoader(
  cwd: string,
  agentDir: string,
): Promise<DefaultResourceLoader> {
  const settingsManager = SettingsManager.inMemory({
    cacheWarming: "off",
    compaction: { enabled: false },
    defaultTools: [],
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 1 },
  });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    disabledBuiltinExtensions: ["mcp"],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "You are an inline worker. Complete the task and return a final answer.",
    appendSystemPrompt: [],
    extensionsOverride: (base) => ({
      extensions: [],
      errors: [],
      runtime: base.runtime,
    }),
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    themesOverride: () => ({ themes: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
  });
  await loader.reload();
  return loader;
}

/**
 * One in-memory worker execution. It owns the worker session, caller/parent
 * signal listener, deadline and exactly-once cleanup. Settlement in Pi, rather
 * than an abort acknowledgement, is the only path to a started-worker result.
 */
export class InlineWorkerExecution {
  readonly completion: Promise<InlineWorkerTerminalResult>;

  get parentRef() {
    return this.context.association.parent;
  }

  private resolveCompletion!: (result: InlineWorkerTerminalResult) => void;
  private readonly createAgentSessionImpl: NonNullable<
    InlineWorkerExecutorOptions["createAgentSessionImpl"]
  >;
  private session: AgentSession | undefined;
  private unsubscribe: (() => void) | undefined;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private cancellationReason: InlineWorkerCancellationReason | undefined;
  private abortRequested = false;
  private abortPromise: Promise<void> | undefined;
  private abortError: unknown;
  private settling = false;
  private finishRequested = false;
  private agentStarted = false;
  private disposed = false;

  constructor(
    private readonly context: InlineWorkerExecutionContext,
    private readonly options: InlineWorkerExecutorOptions,
  ) {
    this.createAgentSessionImpl = options.createAgentSessionImpl ?? createAgentSession;
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
    context.parentSignal.addEventListener("abort", this.onCallerAbort, { once: true });
    this.deadlineTimer = setTimeout(() => {
      this.cancel("deadline");
    }, options.policy.deadlineMs);
    this.deadlineTimer.unref?.();
    void this.run().catch((error: unknown) => {
      this.finish(
        failed(this.context.association, "WORKER_START_FAILED", error, this.options.policy),
      );
    });
  }

  /** Idempotent: the first caller or parent/Stop/deadline reason wins. */
  cancel(reason: InlineWorkerCancellationReason): void {
    if (this.settling || this.cancellationReason) return;
    this.cancellationReason = reason;
    this.clearDeadline();
    this.context.parentSignal.removeEventListener("abort", this.onCallerAbort);
    this.requestAbort();
  }

  private readonly onCallerAbort = (): void => {
    this.cancel("caller");
  };

  private clearDeadline(): void {
    if (!this.deadlineTimer) return;
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
  }

  private requestAbort(): void {
    if (this.abortRequested || this.settling || !this.session) return;
    this.abortRequested = true;
    this.abortPromise = this.session.abort().catch((error: unknown) => {
      // Abort acknowledgement is not settlement. Keep observing authoritative
      // Pi events and retain the failure for cleanup diagnostics.
      this.abortError = error;
    });
  }

  private async run(): Promise<void> {
    if (this.cancellationReason) {
      this.finish(cancellationResult(this.context.association, this.cancellationReason));
      return;
    }

    try {
      const resourceLoader = await createIsolatedResourceLoader(
        this.context.cwd,
        this.context.agentDir,
      );
      if (this.cancellationReason) {
        this.finish(cancellationResult(this.context.association, this.cancellationReason));
        return;
      }

      const settingsManager = SettingsManager.inMemory({
        cacheWarming: "off",
        compaction: { enabled: false },
        defaultTools: [],
        retry: { enabled: false, maxRetries: 0, baseDelayMs: 1 },
      });
      const { session } = await this.createAgentSessionImpl({
        cwd: this.context.cwd,
        agentDir: this.context.agentDir,
        modelRuntime: this.context.modelRuntime,
        model: this.context.model,
        thinkingLevel: this.context.thinkingLevel,
        sessionManager: SessionManager.inMemory(this.context.cwd),
        settingsManager,
        resourceLoader,
        tools: [],
        noTools: "all",
        customTools: [],
      });
      this.session = session;
      this.unsubscribe = session.subscribe(this.onSessionEvent);

      if (this.cancellationReason) {
        this.requestAbort();
        this.finish(cancellationResult(this.context.association, this.cancellationReason));
        return;
      }
      if (session.getActiveToolNames().length > 0) {
        this.finish(
          failed(
            this.context.association,
            "WORKER_START_FAILED",
            new Error("Inline worker session exposed active tools."),
            this.options.policy,
          ),
        );
        return;
      }

      try {
        await session.prompt(this.context.prompt, {
          source: "interactive",
          expandPromptTemplates: false,
        });
      } catch (error) {
        if (this.settling) return;
        if (this.cancellationReason) {
          await session.waitForIdle().catch(() => undefined);
          if (!this.settling && !this.agentStarted) {
            this.finish(cancellationResult(this.context.association, this.cancellationReason));
          }
        } else if (!this.agentStarted) {
          this.finish(
            failed(this.context.association, "WORKER_START_FAILED", error, this.options.policy),
          );
        }
      }
    } catch (error) {
      if (this.settling) return;
      this.finish(
        this.cancellationReason
          ? cancellationResult(this.context.association, this.cancellationReason)
          : failed(this.context.association, "WORKER_START_FAILED", error, this.options.policy),
      );
    }
  }

  private readonly onSessionEvent = (event: AgentSessionEvent): void => {
    if (event.type === "agent_start") {
      this.agentStarted = true;
      return;
    }
    if (event.type !== "agent_settled" || this.settling || !this.session) return;
    this.settling = true;
    this.clearDeadline();
    this.context.parentSignal.removeEventListener("abort", this.onCallerAbort);

    const assistant = finalAssistant(this.session);
    const text = assistantText(assistant);
    const aborted = event.aborted || assistant?.stopReason === "aborted";
    let terminal: InlineWorkerTerminalResult;
    if (aborted) {
      terminal = cancellationResult(this.context.association, this.cancellationReason ?? "parent");
    } else if (assistant?.stopReason === "error") {
      terminal = failed(
        this.context.association,
        "PROVIDER_ERROR",
        assistant.errorMessage ?? "Provider request failed.",
        this.options.policy,
      );
    } else if (assistant?.stopReason !== "stop") {
      terminal = failed(
        this.context.association,
        "INVALID_RESULT",
        "Worker did not produce a complete final assistant response.",
        this.options.policy,
      );
    } else if (new TextEncoder().encode(text).byteLength > this.options.policy.maxResultBytes) {
      terminal = failed(
        this.context.association,
        "RESULT_TOO_LARGE",
        "Worker result exceeded the configured UTF-8 byte bound.",
        this.options.policy,
      );
    } else {
      terminal = {
        status: "succeeded",
        workerId: this.context.association.workerId,
        workerRunId: this.context.association.workerRunId,
        text,
      };
    }
    if (this.abortError) {
      console.warn(
        `[pi-sdk-driver] inline worker ${this.context.association.workerId} abort did not acknowledge: ${inlineWorkerPolicy_sanitizeError(
          this.abortError,
          this.options.policy,
        )}`,
      );
    }
    this.finish(terminal);
  };

  private finish(result: InlineWorkerTerminalResult): void {
    if (this.finishRequested) return;
    this.finishRequested = true;
    this.clearDeadline();
    this.context.parentSignal.removeEventListener("abort", this.onCallerAbort);
    void this.cleanup().then(
      () => this.resolveCompletion(result),
      (error: unknown) =>
        this.resolveCompletion(
          failed(this.context.association, "CLEANUP_FAILED", error, this.options.policy),
        ),
    );
  }

  private async cleanup(): Promise<void> {
    await this.abortPromise;
    let cleanupError: unknown;
    try {
      this.unsubscribe?.();
    } catch (error) {
      cleanupError = error;
    } finally {
      this.unsubscribe = undefined;
      if (this.session && !this.disposed) {
        this.disposed = true;
        try {
          this.session.dispose();
        } catch (error) {
          cleanupError ??= error;
        }
      }
    }
    if (cleanupError) throw cleanupError;
  }
}
