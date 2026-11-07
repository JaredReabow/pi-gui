import type { SessionModelSelection } from "./types.js";

export type AgentAccessMode = "read-only" | "project-only" | "auto" | "full-access";
export interface AgentAutonomyPreferences {
  readonly mode: AgentAccessMode;
  readonly reviewModel: SessionModelSelection | null;
  readonly revision: number;
}
export function decodeAgentAccessMode(value: unknown): AgentAccessMode {
  if (
    value !== "read-only" &&
    value !== "project-only" &&
    value !== "auto" &&
    value !== "full-access"
  )
    throw new Error("Invalid agent access mode");
  return value;
}
