import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { trapDialogFocus } from "../../ui/dialog-focus";
import "../../styles/conversation-model-switch.css";

export interface ConversationThreadTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export interface PendingConversationModelSwitch {
  readonly target: ConversationThreadTarget;
  readonly provider: string;
  readonly modelId: string;
  readonly source: "selector" | "slash-menu";
}

interface UseConversationModelSwitchParams {
  readonly target: ConversationThreadTarget | undefined;
  readonly currentProvider: string | undefined;
  readonly currentModelId: string | undefined;
  readonly onApply: (
    target: ConversationThreadTarget,
    provider: string,
    modelId: string,
    source: PendingConversationModelSwitch["source"],
  ) => void;
}

export interface ConversationModelSwitchController {
  readonly pending: PendingConversationModelSwitch | undefined;
  readonly requestModelSwitch: (
    provider: string,
    modelId: string,
    source?: PendingConversationModelSwitch["source"],
  ) => boolean;
  readonly confirmModelSwitch: () => boolean;
  readonly cancelModelSwitch: () => void;
}

/**
 * Captures the current thread before asking for confirmation, so asynchronous UI changes cannot
 * redirect a confirmed switch to a different selected thread.
 */
export function useConversationModelSwitch(
  params: UseConversationModelSwitchParams,
): ConversationModelSwitchController {
  const [pending, setPending] = useState<PendingConversationModelSwitch | undefined>();
  const targetWorkspaceId = params.target?.workspaceId;
  const targetSessionId = params.target?.sessionId;

  useEffect(() => {
    setPending((current) =>
      current &&
      current.target.workspaceId === targetWorkspaceId &&
      current.target.sessionId === targetSessionId
        ? current
        : undefined,
    );
  }, [targetSessionId, targetWorkspaceId]);

  const requestModelSwitch = useCallback(
    (
      provider: string,
      modelId: string,
      source: PendingConversationModelSwitch["source"] = "selector",
    ): boolean => {
      const target = params.target;
      if (
        !target ||
        !provider.trim() ||
        !modelId.trim() ||
        (params.currentProvider === provider && params.currentModelId === modelId)
      ) {
        return false;
      }
      setPending({
        target: { workspaceId: target.workspaceId, sessionId: target.sessionId },
        provider,
        modelId,
        source,
      });
      return true;
    },
    [params.currentModelId, params.currentProvider, params.target],
  );

  const confirmModelSwitch = useCallback((): boolean => {
    if (!pending || !sameTarget(pending.target, params.target)) {
      setPending(undefined);
      return false;
    }
    const confirmed = pending;
    setPending(undefined);
    params.onApply(confirmed.target, confirmed.provider, confirmed.modelId, confirmed.source);
    return true;
  }, [params, pending]);

  const cancelModelSwitch = useCallback(() => {
    setPending(undefined);
  }, []);

  return {
    pending,
    requestModelSwitch,
    confirmModelSwitch,
    cancelModelSwitch,
  };
}

interface ModelSwitchConfirmationProps {
  readonly pending: PendingConversationModelSwitch;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Confirmation UI only. It neither selects a model nor knows any provider pricing. */
export function ModelSwitchConfirmation({
  pending,
  onConfirm,
  onCancel,
}: ModelSwitchConfirmationProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("[data-model-switch-cancel]")?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      trapDialogFocus(event, dialogRef.current);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="model-switch-confirmation__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        aria-describedby="model-switch-confirmation-description"
        aria-labelledby="model-switch-confirmation-title"
        aria-modal="true"
        className="model-switch-confirmation"
        data-testid="model-switch-confirmation"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <div className="model-switch-confirmation__eyebrow">Thread model</div>
        <h2 className="model-switch-confirmation__title" id="model-switch-confirmation-title">
          Switch model?
        </h2>
        <p className="model-switch-confirmation__copy" id="model-switch-confirmation-description">
          Use{" "}
          <code>
            {pending.provider}:{pending.modelId}
          </code>{" "}
          for this thread?
        </p>
        <p className="model-switch-confirmation__detail">
          Costs and context limits can differ by model.
        </p>
        <p className="model-switch-confirmation__detail">
          Your current draft and attachments stay in place. Nothing is sent by this change.
        </p>
        <div className="model-switch-confirmation__actions">
          <button
            className="button button--secondary"
            data-model-switch-cancel="true"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            data-model-switch-confirm="true"
            type="button"
            onClick={onConfirm}
          >
            Switch model
          </button>
        </div>
      </div>
    </div>
  );
}

function sameTarget(
  left: ConversationThreadTarget,
  right: ConversationThreadTarget | undefined,
): boolean {
  return (
    right !== undefined &&
    left.workspaceId === right.workspaceId &&
    left.sessionId === right.sessionId
  );
}
