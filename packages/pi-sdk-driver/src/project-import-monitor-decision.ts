import type { ProjectImportMonitorResult } from "@pi-gui/session-driver";

export function projectImportMonitor_decodeDecision(
  value: string,
): Pick<ProjectImportMonitorResult, "action" | "message"> | null {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(normalized.slice(start, end + 1)) as Record<string, unknown>;
    const action = parsed.action;
    if (action !== "continue" && action !== "retry" && action !== "skip") return null;
    const message =
      typeof parsed.message === "string" ? parsed.message.replace(/\s+/g, " ").trim() : "";
    return {
      action,
      message: (message || "Import monitoring completed.").slice(0, 240),
    };
  } catch {
    return null;
  }
}
