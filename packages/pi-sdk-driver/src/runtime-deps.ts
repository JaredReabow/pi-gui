import { join, resolve } from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { CustomProviderStore } from "./custom-provider-store.js";
import type { RuntimeSupervisorOptions } from "./runtime-supervisor.js";

export interface RuntimeDependencies {
  readonly agentDir: string;
  readonly modelsJsonPath: string;
  readonly privateModelsJsonPath: string;
  readonly authPath: string;
  readonly customProviderStore: CustomProviderStore;
}

export function createRuntimeDependencies(
  options: RuntimeSupervisorOptions = {},
): RuntimeDependencies {
  const agentDir = resolve(options.agentDir ?? getAgentDir());
  const privateModelsJsonPath = join(agentDir, "models.json");
  const modelsJsonPath = options.modelCatalogPath
    ? resolve(options.modelCatalogPath)
    : privateModelsJsonPath;
  const authPath = join(agentDir, "auth.json");
  const customProviderStore =
    options.customProviderStore ?? new CustomProviderStore(privateModelsJsonPath);
  return {
    agentDir,
    modelsJsonPath,
    privateModelsJsonPath,
    authPath,
    customProviderStore,
  };
}

/** Build an isolated runtime from the shared catalog and private custom endpoints. */
export async function runtimeDependencies_createModelRuntime(
  deps: Pick<
    RuntimeDependencies,
    "authPath" | "modelsJsonPath" | "privateModelsJsonPath" | "customProviderStore"
  >,
): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    authPath: deps.authPath,
    modelsPath: deps.modelsJsonPath,
    refreshOnCreate: false,
  });
  if (deps.modelsJsonPath !== deps.privateModelsJsonPath) {
    await deps.customProviderStore.registerInto(runtime);
  }
  return runtime;
}
