import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeSupervisor } from "../dist/runtime-supervisor.js";
import { PiSdkDriver } from "../dist/pi-sdk-driver.js";

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

await test("sessions resolve shared models instead of the private stale catalog", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-shared-session-"));
  const agentDir = join(root, "private-agent");
  const cwd = join(root, "workspace");
  const sharedModelsPath = join(root, "shared-models.json");
  await Promise.all([mkdir(agentDir), mkdir(cwd)]);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Shared model resolution must not use the network");
  });
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(join(agentDir, "settings.json"), '{"packages":[]}\n');
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "codex-router": { ...provider(["older-model"]), api: "openai-responses" },
        "private-endpoint": { ...provider(["private-model"]), piGuiCustomEndpoint: true },
      },
    }),
  );
  await writeFile(
    sharedModelsPath,
    JSON.stringify({
      providers: {
        "codex-router": {
          ...provider(["older-model", "openrouter/openrouter/free"]),
          api: "openai-responses",
        },
      },
    }),
  );
  const sharedBefore = await readFile(sharedModelsPath, "utf8");
  const privateBefore = await readFile(join(agentDir, "models.json"), "utf8");
  const driver = new PiSdkDriver({
    agentDir,
    modelCatalogPath: sharedModelsPath,
    catalogFilePath: join(root, "catalogs.json"),
  });
  const workspace = { workspaceId: "shared-session", path: cwd };
  for (const initialModel of [
    { provider: "codex-router", modelId: "openrouter/openrouter/free" },
    { provider: "codex-router", modelId: "older-model" },
    { provider: "private-endpoint", modelId: "private-model" },
  ]) {
    const session = await driver.createSession(workspace, { initialModel });
    await driver.closeSession(session.ref);
  }
  assert.equal(await readFile(sharedModelsPath, "utf8"), sharedBefore);
  assert.equal(await readFile(join(agentDir, "models.json"), "utf8"), privateBefore);
});
