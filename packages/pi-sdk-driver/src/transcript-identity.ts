import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { SessionRef, WorkspaceRef } from "@pi-gui/session-driver";
import { messageText } from "./session-supervisor-utils.js";

/** Pi publishes message_end before append; turn_end supplies the persisted identity. */
export function createTranscriptIdentityExtension(options: {
  readonly workspace: WorkspaceRef;
  readonly onPersisted: (sessionRef: SessionRef, sourceMessageId: string, text: string) => void;
}): ExtensionFactory {
  return (pi) => {
    pi.on("turn_end", (event, context) => {
      options.onPersisted(
        {
          workspaceId: options.workspace.workspaceId,
          sessionId: context.sessionManager.getSessionId(),
        },
        event.messageEntryId,
        messageText({ ...event.message }),
      );
    });
  };
}
