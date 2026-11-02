import { join, resolve } from "node:path";

export interface SharedPiCatalogPathInput {
  readonly homeDir: string;
  /** Optional test or non-default CLI profile override. */
  readonly agentDir?: string;
}

/**
 * Resolves Pi CLI's model catalog without consulting `PI_CODING_AGENT_DIR`,
 * which pi-gui replaces with its private profile before runtime startup.
 */
export function sharedPiCatalog_resolveModelsPath(input: SharedPiCatalogPathInput): string {
  const configured = input.agentDir?.trim();
  const agentDir = !configured
    ? join(input.homeDir, ".pi", "agent")
    : configured === "~"
      ? input.homeDir
      : configured.startsWith("~/") || configured.startsWith("~\\")
        ? resolve(input.homeDir, configured.slice(2))
        : resolve(configured);
  return join(agentDir, "models.json");
}
