import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { Dispatch, SetStateAction } from "react";
import type { PiDesktopApi } from "../../contracts/ipc";
import type { DesktopAppState } from "../../contracts/desktop-state";
import { ModelSelector } from "../features/conversation/model-selector";
import { updateSnapshot } from "./desktop-app-state";
import {
  ModelSwitchConfirmation,
  useConversationModelSwitch,
  type ConversationThreadTarget,
} from "../features/conversation/model-switch-confirmation";

interface ConversationModelShellParams {
  readonly api: PiDesktopApi | undefined;
  readonly target: ConversationThreadTarget | null | undefined;
  readonly runtime: RuntimeSnapshot | undefined;
  readonly currentThinkingLevel: string | undefined;
  readonly currentProvider: string | undefined;
  readonly currentModelId: string | undefined;
  readonly composerDraft: string;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
}

/** App composition only: one thread-bound controller owns every conversation model request. */
export function useConversationModelShell(params: ConversationModelShellParams) {
  const modelSwitch = useConversationModelSwitch({
    target: params.target ?? undefined,
    currentProvider: params.currentProvider,
    currentModelId: params.currentModelId,
    onApply: (target, provider, modelId, source) => {
      if (!params.api) return;
      const clearSlashDraft = source === "slash-menu" && params.composerDraft === "/model";
      if (clearSlashDraft) params.setComposerDraft("");
      const api = params.api;
      void updateSnapshot(params.setSnapshot, async () => {
        if (clearSlashDraft) await api.updateComposerDraft("", target);
        return api.setSessionModel(target.workspaceId, target.sessionId, provider, modelId);
      }).catch((error: unknown) => {
        console.error("[renderer] updateSnapshot failed", error);
      });
    },
  });
  // The same existing session-thinking operation serves both selector placements.
  const setThinkingLevel = (level: string) => {
    const { api, target } = params;
    if (!api || !target) return;
    void updateSnapshot(params.setSnapshot, () =>
      api.setSessionThinkingLevel(
        target.workspaceId,
        target.sessionId,
        level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>,
      ),
    ).catch((error: unknown) => {
      console.error("[renderer] updateSnapshot failed", error);
    });
  };
  return {
    requestModelSwitch: modelSwitch.requestModelSwitch,
    setThinkingLevel,
    modelSelector: (
      <ModelSelector
        runtime={params.runtime}
        provider={params.currentProvider}
        modelId={params.currentModelId}
        thinkingLevel={params.currentThinkingLevel}
        disabled={!params.api || !params.target}
        dropdownPlacement="below"
        onSetModel={modelSwitch.requestModelSwitch}
        onSetThinking={setThinkingLevel}
      />
    ),
    confirmation: modelSwitch.pending ? (
      <ModelSwitchConfirmation
        pending={modelSwitch.pending}
        onCancel={modelSwitch.cancelModelSwitch}
        onConfirm={modelSwitch.confirmModelSwitch}
      />
    ) : null,
  };
}
