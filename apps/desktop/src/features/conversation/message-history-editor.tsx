import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { CheckIcon, PencilIcon, TrashIcon } from "../../ui/icons";

export type MessageHistoryRole = "user" | "assistant";

interface UseMessageHistoryEditorOptions {
  readonly messageId: string | undefined;
  readonly role: MessageHistoryRole;
  readonly text: string;
  readonly disabledReason?: string;
  readonly onEditMessage?: (messageId: string, text: string) => Promise<void>;
  readonly onDeleteMessage?: (messageId: string) => Promise<void>;
}

export interface MessageHistoryEditor {
  readonly available: boolean;
  readonly editing: boolean;
  readonly pendingDelete: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly draft: string;
  readonly disabledReason: string | undefined;
  readonly beginEdit: () => void;
  readonly cancelEdit: () => void;
  readonly setDraft: (text: string) => void;
  readonly save: () => Promise<void>;
  readonly beginDelete: () => void;
  readonly cancelDelete: () => void;
  readonly deleteMessage: () => Promise<void>;
}

export function useMessageHistoryEditor({
  messageId,
  role,
  text,
  disabledReason,
  onEditMessage,
  onDeleteMessage,
}: UseMessageHistoryEditorOptions): MessageHistoryEditor {
  const available = Boolean(messageId && (onEditMessage || onDeleteMessage));
  const [editing, setEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [draft, setDraftState] = useState(text);
  const roleLabel = role === "user" ? "user message" : "assistant reply";

  useEffect(() => {
    if (!available) {
      setEditing(false);
      setPendingDelete(false);
      setBusy(false);
      setError(undefined);
      return;
    }
    if (!editing) setDraftState(text);
  }, [available, editing, text]);

  const beginEdit = () => {
    if (!messageId || !onEditMessage || disabledReason) return;
    setDraftState(text);
    setPendingDelete(false);
    setError(undefined);
    setEditing(true);
  };
  const cancelEdit = () => {
    if (busy) return;
    setDraftState(text);
    setError(undefined);
    setEditing(false);
  };
  const save = async () => {
    if (!messageId || !onEditMessage || busy) return;
    const nextText = draft.trim();
    if (!nextText) {
      setError(`${roleLabel[0]!.toUpperCase()}${roleLabel.slice(1)} cannot be empty.`);
      return;
    }
    if (nextText === text) {
      setEditing(false);
      setError(undefined);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onEditMessage(messageId, nextText);
      setDraftState(nextText);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Couldn't save the ${roleLabel}.`);
    } finally {
      setBusy(false);
    }
  };
  const beginDelete = () => {
    if (!onDeleteMessage || disabledReason) return;
    setEditing(false);
    setError(undefined);
    setPendingDelete(true);
  };
  const cancelDelete = () => {
    if (!busy) setPendingDelete(false);
  };
  const deleteMessage = async () => {
    if (!messageId || !onDeleteMessage || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onDeleteMessage(messageId);
      setPendingDelete(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Couldn't delete the ${roleLabel}.`);
    } finally {
      setBusy(false);
    }
  };

  return {
    available,
    editing,
    pendingDelete,
    busy,
    error,
    draft,
    disabledReason,
    beginEdit,
    cancelEdit,
    setDraft: setDraftState,
    save,
    beginDelete,
    cancelDelete,
    deleteMessage,
  };
}

export function MessageHistoryActions({
  editor,
  role,
  canEdit,
}: {
  readonly editor: MessageHistoryEditor;
  readonly role: MessageHistoryRole;
  readonly canEdit: boolean;
}) {
  if (!editor.available || editor.editing) return null;
  const roleLabel = role === "user" ? "user message" : "assistant reply";
  if (editor.pendingDelete) {
    return (
      <div
        className="timeline-history-actions timeline-history-actions--confirm"
        data-testid="message-history-delete-confirm"
      >
        <span>Delete this {roleLabel}?</span>
        <button
          type="button"
          className="timeline-item__action timeline-item__action--danger"
          aria-label={`Confirm delete ${roleLabel}`}
          data-testid="confirm-delete-message"
          disabled={editor.busy}
          onClick={() => {
            editor.deleteMessage().catch((cause: unknown) => {
              console.error("[message-history] delete failed", cause);
            });
          }}
        >
          <TrashIcon />
          <span className="timeline-item__action-label">
            {editor.busy ? "Deleting…" : "Delete"}
          </span>
        </button>
        <button
          type="button"
          className="timeline-item__action"
          aria-label={`Cancel delete ${roleLabel}`}
          data-testid="cancel-delete-message"
          disabled={editor.busy}
          onClick={editor.cancelDelete}
        >
          <span className="timeline-item__action-label">Cancel</span>
        </button>
      </div>
    );
  }
  return (
    <div className="timeline-history-actions" data-testid="message-history-actions">
      <button
        type="button"
        className="timeline-item__action"
        aria-label={`Edit ${roleLabel}`}
        data-testid="edit-message"
        disabled={!canEdit}
        title={canEdit ? undefined : editor.disabledReason}
        onClick={editor.beginEdit}
      >
        <PencilIcon />
        <span className="timeline-item__action-label">Edit</span>
      </button>
      <button
        type="button"
        className="timeline-item__action timeline-item__action--danger"
        aria-label={`Delete ${roleLabel}`}
        data-testid="delete-message"
        disabled={!editor.disabledReason ? false : Boolean(editor.disabledReason)}
        title={editor.disabledReason}
        onClick={editor.beginDelete}
      >
        <TrashIcon />
        <span className="timeline-item__action-label">Delete</span>
      </button>
    </div>
  );
}

export function MessageHistoryEditForm({
  editor,
  role,
}: {
  readonly editor: MessageHistoryEditor;
  readonly role: MessageHistoryRole;
}) {
  const inputId = useId();
  const roleLabel = role === "user" ? "user message" : "assistant reply";
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      editor.cancelEdit();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      editor.save().catch((cause: unknown) => {
        console.error("[message-history] save failed", cause);
      });
    }
  };
  return (
    <div className="timeline-history-editor" data-testid="message-history-editor">
      <label className="sr-only" htmlFor={inputId}>
        Edit {roleLabel}
      </label>
      <textarea
        autoFocus
        className="timeline-history-editor__input"
        id={inputId}
        aria-label={`Edit ${roleLabel}`}
        rows={Math.min(12, Math.max(3, editor.draft.split("\n").length + 1))}
        value={editor.draft}
        onChange={(event) => editor.setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="timeline-history-editor__actions">
        <span className="timeline-history-editor__hint">⌘/Ctrl+Enter to save</span>
        <button
          type="button"
          className="timeline-item__action"
          data-testid="cancel-edit-message"
          disabled={editor.busy}
          onClick={editor.cancelEdit}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--primary timeline-history-editor__save"
          data-testid="save-message"
          disabled={editor.busy || !editor.draft.trim()}
          onClick={() => {
            editor.save().catch((cause: unknown) => {
              console.error("[message-history] save failed", cause);
            });
          }}
        >
          <CheckIcon />
          <span>{editor.busy ? "Saving…" : "Save"}</span>
        </button>
      </div>
    </div>
  );
}

export function MessageHistoryError({ editor }: { readonly editor: MessageHistoryEditor }) {
  return editor.error ? (
    <div className="timeline-history-error" role="alert">
      {editor.error}
    </div>
  ) : null;
}
