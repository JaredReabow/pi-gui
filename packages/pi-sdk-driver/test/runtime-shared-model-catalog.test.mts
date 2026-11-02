import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeSupervisor } from "../dist/runtime-supervisor.js";

function provider(models: readonly string[], apiKey = "shared-key") {
  return {
    baseUrl: "http://127.0.0.1:9/v1",
    api: "openai-completions",
    apiKey,
    models: models.map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ["text"],
    })),
  };
}

await test("shared router catalog stays read-only while private settings and custom providers survive", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-shared-catalog-"));
  const agentDir = join(root, "private-agent");
  const sharedAgentDir = join(root, "shared-pi-agent");
  const workspacePath = join(root, "workspace");
  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(sharedAgentDir, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
  ]);
  const sharedModelsPath = join(sharedAgentDir, "models.json");
  const privateModelsPath = join(agentDir, "models.json");
  await writeFile(join(agentDir, "auth.json"), '{"private":"auth"}\n');
  await writeFile(
    join(agentDir, "settings.json"),
    '{"packages":[],"defaultThinkingLevel":"medium"}\n',
  );
  await writeFile(
    privateModelsPath,
    JSON.stringify({
      providers: {
        "private-endpoint": {
          ...provider(["private-model"], "unused"),
          piGuiCustomEndpoint: true,
        },
      },
    }),
  );
  await writeFile(
    sharedModelsPath,
    JSON.stringify({
      providers: {
        "router-catalog": provider(["router/alpha"]),
      },
    }),
  );
  const settingsBytes = await readFile(join(agentDir, "settings.json"), "utf8");
  const supervisor = new RuntimeSupervisor({
    agentDir,
    modelCatalogPath: sharedModelsPath,
  });
  const workspace = { workspaceId: "shared-catalog", path: workspacePath };

  const first = await supervisor.getRuntimeSnapshot(workspace);
  assert.deepEqual(
    first.models
      .filter((model) => model.providerId === "router-catalog")
      .map((model) => model.modelId),
    ["router/alpha"],
  );
  assert.deepEqual(
    first.models
      .filter((model) => model.providerId === "private-endpoint")
      .map((model) => model.modelId),
    ["private-model"],
  );

  await writeFile(
    sharedModelsPath,
    JSON.stringify({
      providers: {
        "router-catalog": provider(["router/alpha", "router/beta"]),
      },
    }),
  );
  const sharedBytesAfterPublication = await readFile(sharedModelsPath, "utf8");
  const refreshed = await supervisor.refreshRuntime(workspace);
  assert.deepEqual(
    refreshed.models
      .filter((model) => model.providerId === "router-catalog")
      .map((model) => model.modelId),
    ["router/alpha", "router/beta"],
  );

  await supervisor.setCustomProvider(workspace, {
    providerId: "private-second",
    baseUrl: "http://127.0.0.1:10/v1",
    models: [{ id: "second-model" }],
  });
  assert.equal(await readFile(sharedModelsPath, "utf8"), sharedBytesAfterPublication);
  assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), settingsBytes);
  const privateModels = JSON.parse(await readFile(privateModelsPath, "utf8")) as {
    providers?: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(privateModels.providers ?? {}).sort(), [
    "private-endpoint",
    "private-second",
  ]);
});
