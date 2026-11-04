import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { DesktopAppState } from "../../contracts/desktop-state";
import type { PiDesktopApi } from "../../contracts/ipc";
import { updateSnapshot } from "./desktop-app-state";

export function useTranscriptMessageHistoryActions({
  api,
  workspaceId,
  sessionId,
  running,
  schemaSkew,
  setSnapshot,
}: {
  readonly api: PiDesktopApi | undefined;
  readonly workspaceId: string | undefined;
  readonly sessionId: string | undefined;
  readonly running: boolean;
  readonly schemaSkew: boolean;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
}) {
  const edit = useCallback(
    async (messageId: string, text: string) => {
      if (!api || !workspaceId || !sessionId) {
        throw new Error("Select a thread before editing its history.");
      }
      await updateSnapshot(setSnapshot, () =>
        api.editTranscriptMessage({ workspaceId, sessionId }, messageId, text),
      );
    },
    [api, sessionId, setSnapshot, workspaceId],
  );

  const remove = useCallback(
    async (messageId: string) => {
      if (!api || !workspaceId || !sessionId) {
        throw new Error("Select a thread before editing its history.");
      }
      await updateSnapshot(setSnapshot, () =>
        api.deleteTranscriptMessage({ workspaceId, sessionId }, messageId),
      );
    },
    [api, sessionId, setSnapshot, workspaceId],
  );

  const disabledReason = running
    ? "Finish or stop the current run before editing this message."
    : schemaSkew
      ? "Update pi-gui before editing a session written by a newer version."
      : undefined;
  return { edit, remove, disabledReason };
}
