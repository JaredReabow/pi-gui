import type { AgentAccessMode, SessionModelSelection, SessionRef } from "@pi-gui/session-driver";
export interface AutonomyUpdate {
  readonly target?: SessionRef;
  readonly mode?: AgentAccessMode;
  readonly reviewModel?: SessionModelSelection | null;
  readonly confirmFullAccess?: boolean;
}
