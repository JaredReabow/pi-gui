import type {
  SessionCatalogSnapshot,
  WorkspaceCatalogSnapshot,
  WorkspaceId,
} from "@pi-gui/catalogs";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionQueuedMessage,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type {
  CreateSessionOptions,
  ForkSessionOptions,
  ForkSessionResult,
  HostUiResponse,
  InlineWorkerDriverCapability,
  InlineWorkerHostCapability,
  InlineWorkerModelSelection,
  InlineWorkerModelRequest,
  InlineWorkerRunHandle,
  SessionDriver,
  SessionEventListener,
  SessionModelSelection,
  SessionRef,
  SessionRunOutcome,
  SessionSnapshot,
  SessionMessageInput,
  Unsubscribe,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import {
  SessionSupervisor,
  type PiSdkDriverOptions,
  type SyncWorkspaceResult,
} from "./session-supervisor.js";
import { RuntimeSupervisor, type RuntimeSupervisorOptions } from "./runtime-supervisor.js";
import { createRuntimeDependencies } from "./runtime-deps.js";
import type { CustomProviderStore } from "./custom-provider-store.js";
import { generateThreadTitle, type GenerateThreadTitleOptions } from "./thread-title-generator.js";

export interface PiSdkDriverConfig extends PiSdkDriverOptions, RuntimeSupervisorOptions {}

export class PiSdkDriver implements SessionDriver, InlineWorkerDriverCapability {
  private readonly supervisor: SessionSupervisor;
  private readonly agentDir: string;
  private readonly modelsJsonPath: string;
  private readonly privateModelsJsonPath: string;
  private readonly customProviderStore: CustomProviderStore;
  private readonly generateThreadTitleOverride:
    | ((
        workspace: WorkspaceRef,
        options: GenerateThreadTitleOptions,
      ) => Promise<string | null | undefined>)
    | undefined;
  readonly runtimeSupervisor: RuntimeSupervisor;

  constructor(options: PiSdkDriverConfig = {}) {
    const deps = createRuntimeDependencies(options);
    this.agentDir = deps.agentDir;
    this.modelsJsonPath = deps.modelsJsonPath;
    this.privateModelsJsonPath = deps.privateModelsJsonPath;
    this.customProviderStore = deps.customProviderStore;
    this.generateThreadTitleOverride = options.generateThreadTitleOverride;

    this.supervisor = new SessionSupervisor({ ...options, agentDir: deps.agentDir });
    this.runtimeSupervisor = new RuntimeSupervisor({ ...options, ...deps });
  }

  createSession(workspace: WorkspaceRef, options?: CreateSessionOptions): Promise<SessionSnapshot> {
    return this.supervisor.createSession(workspace, options);
  }

  validateForkSession(sourceRef: SessionRef, options: ForkSessionOptions): Promise<void> {
    return this.supervisor.validateForkSession(sourceRef, options);
  }

  forkSession(sourceRef: SessionRef, options: ForkSessionOptions): Promise<ForkSessionResult> {
    return this.supervisor.forkSession(sourceRef, options);
  }

  openSession(sessionRef: SessionRef): Promise<SessionSnapshot> {
    return this.supervisor.openSession(sessionRef);
  }

  archiveSession(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.archiveSession(sessionRef);
  }

  archiveSessionIfIdle(
    sessionRef: SessionRef,
    expect?: { readonly lastRunOutcome?: SessionRunOutcome },
  ): Promise<void> {
    return this.supervisor.archiveSessionIfIdle(sessionRef, expect);
  }

  unarchiveSession(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.unarchiveSession(sessionRef);
  }

  sendUserMessage(sessionRef: SessionRef, input: SessionMessageInput): Promise<void> {
    return this.supervisor.sendUserMessage(sessionRef, input);
  }

  replaceQueuedMessages(
    sessionRef: SessionRef,
    messages: readonly SessionQueuedMessage[],
  ): Promise<void> {
    return this.supervisor.replaceQueuedMessages(sessionRef, messages);
  }

  cancelCurrentRun(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.cancelCurrentRun(sessionRef);
  }

  createInlineWorkerHostCapability(
    parent: SessionRef,
    parentRunId: string,
    parentToolCallId: string,
    signal: AbortSignal,
  ): Promise<InlineWorkerHostCapability> {
    return this.supervisor.createInlineWorkerHostCapability(
      parent,
      parentRunId,
      parentToolCallId,
      signal,
    );
  }

  startInlineWorker(
    request: InlineWorkerModelRequest,
    host: InlineWorkerHostCapability,
    selection?: InlineWorkerModelSelection,
  ): InlineWorkerRunHandle {
    return this.supervisor.startInlineWorker(request, host, selection);
  }

  cancelInlineWorkersForParent(parent: SessionRef): Promise<void> {
    return this.supervisor.cancelInlineWorkersForParent(parent);
  }

  setSessionModel(sessionRef: SessionRef, selection: SessionModelSelection): Promise<void> {
    return this.supervisor.setSessionModel(sessionRef, selection);
  }

  setSessionThinkingLevel(sessionRef: SessionRef, thinkingLevel: string): Promise<void> {
    return this.supervisor.setSessionThinkingLevel(sessionRef, thinkingLevel);
  }

  renameSession(sessionRef: SessionRef, title: string): Promise<void> {
    return this.supervisor.renameSession(sessionRef, title);
  }

  compactSession(sessionRef: SessionRef, customInstructions?: string): Promise<void> {
    return this.supervisor.compactSession(sessionRef, customInstructions);
  }

  reloadSession(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.reloadSession(sessionRef);
  }

  /** Reloads now, or when the running turn or compaction ends. */
  reloadSessionWhenIdle(sessionRef: SessionRef): Promise<"reloaded" | "deferred"> {
    return this.supervisor.reloadSessionWhenIdle(sessionRef);
  }

  getSessionTree(sessionRef: SessionRef): Promise<SessionTreeSnapshot> {
    return this.supervisor.getSessionTree(sessionRef);
  }

  navigateSessionTree(
    sessionRef: SessionRef,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<NavigateSessionTreeResult> {
    return this.supervisor.navigateSessionTree(sessionRef, targetId, options);
  }

  getSessionCommands(sessionRef: SessionRef) {
    return this.supervisor.getSessionCommands(sessionRef);
  }

  respondToHostUiRequest(sessionRef: SessionRef, response: HostUiResponse): Promise<void> {
    return this.supervisor.respondToHostUiRequest(sessionRef, response);
  }

  subscribe(sessionRef: SessionRef, listener: SessionEventListener): Unsubscribe {
    return this.supervisor.subscribe(sessionRef, listener);
  }

  closeSession(sessionRef: SessionRef): Promise<void> {
    return this.supervisor.closeSession(sessionRef);
  }

  listWorkspaces(): Promise<WorkspaceCatalogSnapshot> {
    return this.supervisor.listWorkspaces();
  }

  listSessions(workspaceId?: WorkspaceId): Promise<SessionCatalogSnapshot> {
    return this.supervisor.listSessions(workspaceId);
  }

  syncWorkspace(path: string, displayName?: string): Promise<SyncWorkspaceResult> {
    return this.supervisor.syncWorkspace(path, displayName);
  }

  reconcileWorkspace(workspaceId: WorkspaceId): Promise<SyncWorkspaceResult | undefined> {
    return this.supervisor.reconcileWorkspace(workspaceId);
  }

  getSessionFilePath(sessionRef: SessionRef): Promise<string | undefined> {
    return this.supervisor.getSessionFilePath(sessionRef);
  }

  renameWorkspace(workspaceId: WorkspaceId, displayName: string) {
    return this.supervisor.renameWorkspace(workspaceId, displayName);
  }

  async removeWorkspace(workspaceId: WorkspaceId): Promise<void> {
    await this.supervisor.removeWorkspace(workspaceId);
    this.runtimeSupervisor.removeWorkspace(workspaceId);
  }

  getTranscript(sessionRef: SessionRef) {
    return this.supervisor.getTranscript(sessionRef);
  }

  getSessionSchemaInfo(sessionRef: SessionRef) {
    return this.supervisor.getSessionSchemaInfo(sessionRef);
  }

  generateThreadTitle(
    workspace: WorkspaceRef,
    options: GenerateThreadTitleOptions,
  ): Promise<string | null> {
    if (this.generateThreadTitleOverride) {
      return Promise.resolve(this.generateThreadTitleOverride(workspace, options)).then(
        (override) =>
          override !== undefined
            ? override
            : generateThreadTitle(workspace, options, {
                agentDir: this.agentDir,
                modelsJsonPath: this.modelsJsonPath,
                privateModelsJsonPath: this.privateModelsJsonPath,
                customProviderStore: this.customProviderStore,
              }),
      );
    }
    return generateThreadTitle(workspace, options, {
      agentDir: this.agentDir,
      modelsJsonPath: this.modelsJsonPath,
      privateModelsJsonPath: this.privateModelsJsonPath,
      customProviderStore: this.customProviderStore,
    });
  }
}

export function createPiSdkDriver(options?: PiSdkDriverConfig): PiSdkDriver {
  return new PiSdkDriver(options);
}
