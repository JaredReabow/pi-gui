import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addMcpServer,
  commitMcpConfigMutation,
  McpConfigConflictError,
  McpConfigError,
  previewMcpConfigMutation,
  setMcpServerEnabled,
  updateMcpServer,
} from "../dist/mcp-config.js";

async function withSetup(
  run: (setup: {
    readonly root: string;
    readonly agentDir: string;
    readonly cwd: string;
    readonly globalPath: string;
    readonly projectPath: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-mcp-concurrency-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  try {
    await run({
      root,
      agentDir,
      cwd,
      globalPath: join(agentDir, "mcp.json"),
      projectPath: join(cwd, ".pi", "mcp.json"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readConfig(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

await test("same-process mutations on one canonical target serialize without lost edits", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    await Promise.all([
      addMcpServer({ agentDir, cwd }, { name: "alpha", command: "node", args: ["a.mjs"] }),
      addMcpServer({ agentDir, cwd }, { name: "beta", command: "node", args: ["b.mjs"] }),
      addMcpServer({ agentDir, cwd }, { name: "gamma", command: "node", args: ["c.mjs"] }),
    ]);
    const parsed = (await readConfig(globalPath)) as {
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(parsed.mcpServers).sort(), ["alpha", "beta", "gamma"]);
  });
});

await test("previews from the same base cannot overwrite the first commit", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    const first = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "add", server: { name: "first", command: "node" } },
    );
    const stale = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "add", server: { name: "second", command: "node" } },
    );
    assert.equal(first.target.revision, "missing");
    assert.equal(stale.target.revision, "missing");

    const committed = await commitMcpConfigMutation(first);
    assert.equal(committed.operation, "add");
    assert.equal(committed.outcome, "committed");
    assert.match(committed.targetRevision, /^[a-f0-9]{64}$/);
    await assert.rejects(
      commitMcpConfigMutation(stale),
      (error: unknown) =>
        error instanceof McpConfigConflictError &&
        error.code === "config-changed" &&
        error.dependenciesChanged === false,
    );
    const parsed = (await readConfig(globalPath)) as { mcpServers: Record<string, unknown> };
    assert.deepEqual(Object.keys(parsed.mcpServers), ["first"]);
  });
});

await test("preview snapshots nested add fields and arrays against caller mutation", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    const originalArgs = ["planned.mjs", "--planned"];
    const mutation = {
      kind: "add" as const,
      server: {
        name: "planned",
        command: "node",
        args: originalArgs,
        description: "planned description",
      },
    };
    const preview = await previewMcpConfigMutation({ agentDir, cwd }, mutation);

    mutation.server.name = "tampered";
    mutation.server.command = "tampered-command";
    mutation.server.description = "tampered description";
    mutation.server.args[0] = "tampered.mjs";
    mutation.server.args = ["replacement.mjs"];
    originalArgs[1] = "--replacement";
    Object.setPrototypeOf(originalArgs, null);
    mutation.server = { name: "replacement", command: "replacement" };
    mutation.kind = "remove";

    await commitMcpConfigMutation(preview);
    assert.equal(preview.target.name, "planned");
    assert.deepEqual(
      ((await readConfig(globalPath)) as { mcpServers: Record<string, unknown> }).mcpServers,
      {
        planned: {
          command: "node",
          args: ["planned.mjs", "--planned"],
          description: "planned description",
        },
      },
    );
  });
});

await test("preview snapshots update arg arrays while preserving hidden fields", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    await writeFile(
      globalPath,
      JSON.stringify({
        mcpServers: {
          local: {
            command: "old-command",
            args: ["old.mjs"],
            env: { TOKEN: "HIDDEN_SECRET" },
            unknownServerField: { keep: true },
          },
        },
      }),
    );
    const patch = {
      description: "planned",
      command: "node",
      args: ["planned.mjs", "--safe"],
    };
    const preview = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "update", scope: "global", name: "local", patch },
    );

    patch.description = "tampered";
    patch.command = "tampered-command";
    patch.args[0] = "tampered.mjs";
    patch.args = ["replacement.mjs"];

    await commitMcpConfigMutation(preview);
    assert.deepEqual(await readConfig(globalPath), {
      mcpServers: {
        local: {
          command: "node",
          args: ["planned.mjs", "--safe"],
          env: { TOKEN: "HIDDEN_SECRET" },
          unknownServerField: { keep: true },
          description: "planned",
        },
      },
    });
  });
});

await test("dependency revision changes reject before target replacement", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath, projectPath }) => {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(projectPath, JSON.stringify({ mcpServers: {} }));
    const preview = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "add", server: { name: "safe", command: "node" } },
    );
    assert.deepEqual(
      preview.dependencies.map((dependency) => dependency.label),
      ["workspace"],
    );

    await writeFile(
      projectPath,
      JSON.stringify({ mcpServers: {}, unrelatedProjectEdit: "preserve-me" }),
    );
    await assert.rejects(
      commitMcpConfigMutation(preview),
      (error: unknown) =>
        error instanceof McpConfigConflictError && error.dependenciesChanged === true,
    );
    await assert.rejects(readFile(globalPath), /ENOENT/);
    assert.deepEqual(await readConfig(projectPath), {
      mcpServers: {},
      unrelatedProjectEdit: "preserve-me",
    });
  });
});

await test("a dependency made malformed after preview remains a stale-base conflict", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath, projectPath }) => {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(projectPath, JSON.stringify({ mcpServers: {} }));
    const preview = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "add", server: { name: "safe", command: "node" } },
    );
    const malformedProject = '{"mcpServers":{"secret":{"env":{"TOKEN":"DEPENDENCY_SECRET"}},}}';
    await writeFile(projectPath, malformedProject);

    await assert.rejects(
      commitMcpConfigMutation(preview),
      (error: unknown) =>
        error instanceof McpConfigConflictError &&
        error.code === "config-changed" &&
        error.dependenciesChanged === true,
    );
    await assert.rejects(readFile(globalPath), /ENOENT/);
    assert.equal(await readFile(projectPath, "utf8"), malformedProject);
  });
});

await test("a stateful Proxy otherProjects array is rejected before any length trap", async () => {
  await withSetup(async ({ root, agentDir, cwd, globalPath }) => {
    const projectOne = join(root, "other-one");
    const projectTwo = join(root, "other-two");
    let lengthReads = 0;
    const otherProjects = new Proxy([projectOne, projectTwo], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          throw new Error("OTHER_PROJECTS_PROXY_SECRET");
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    await assert.rejects(
      previewMcpConfigMutation(
        { agentDir, cwd },
        { kind: "add", server: { name: "safe", command: "node" } },
        { otherProjects },
      ),
      (error: unknown) =>
        error instanceof McpConfigError &&
        error.code === "invalid-input" &&
        !String(error).includes("OTHER_PROJECTS_PROXY_SECRET"),
    );
    assert.equal(lengthReads, 0);
    await assert.rejects(readFile(globalPath), /ENOENT/);
  });
});

await test("a Proxy args array rejects with a sanitized invalid-input error", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    let trapReads = 0;
    const args = new Proxy(["planned"], {
      get(target, property, receiver) {
        trapReads += 1;
        if (property === "length") throw new Error("ARGS_PROXY_SECRET");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    await assert.rejects(
      previewMcpConfigMutation(
        { agentDir, cwd },
        { kind: "add", server: { name: "safe", command: "node", args } },
      ),
      (error: unknown) =>
        error instanceof McpConfigError &&
        error.code === "invalid-input" &&
        !String(error).includes("ARGS_PROXY_SECRET"),
    );
    assert.equal(trapReads, 0);
    await assert.rejects(readFile(globalPath), /ENOENT/);
  });
});

await test("two preview handles use immutable private revisions after an open-handle edit", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath, projectPath }) => {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(projectPath, JSON.stringify({ mcpServers: {} }));
    const previewOne = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "add", server: { name: "safe-one", command: "node" } },
    );
    const previewTwo = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "add", server: { name: "safe-two", command: "node" } },
    );

    const dependencyHandle = await open(projectPath, "r+");
    try {
      const changedProject = JSON.stringify({
        mcpServers: {},
        externalProjectEdit: "from-open-handle",
      });
      await dependencyHandle.truncate(0);
      await dependencyHandle.writeFile(changedProject);
      await dependencyHandle.sync();
    } finally {
      await dependencyHandle.close();
    }

    const changedRevision = "a".repeat(64);
    for (const preview of [previewOne, previewTwo]) {
      assert.equal(Object.isFrozen(preview.dependencies), true);
      const exposedRevision = preview.dependencies[0] as {
        label: string;
        revision: string;
      };
      exposedRevision.revision = changedRevision;
      exposedRevision.label = "tampered";
      Object.setPrototypeOf(exposedRevision, null);
      assert.equal(exposedRevision.revision, changedRevision);
      assert.throws(() => {
        (preview.dependencies as { label: string; revision: string }[]).push({
          label: "forged",
          revision: changedRevision,
        });
      }, TypeError);
      assert.throws(() => {
        preview.dependencies[0] = { label: "forged", revision: changedRevision };
      }, TypeError);
      await assert.rejects(
        commitMcpConfigMutation(preview),
        (error: unknown) =>
          error instanceof McpConfigConflictError &&
          error.code === "config-changed" &&
          error.dependenciesChanged === true,
      );
    }
    await assert.rejects(readFile(globalPath), /ENOENT/);
    assert.deepEqual(await readConfig(projectPath), {
      mcpServers: {},
      externalProjectEdit: "from-open-handle",
    });
  });
});

await test("an observed external target writer wins and a failed queue does not poison later work", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    const preview = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "add", server: { name: "from-preview", command: "node" } },
    );
    const external = JSON.stringify({
      mcpServers: { external: { command: "external", env: { TOKEN: "EXTERNAL_SECRET" } } },
      externalEditorWon: true,
    });
    await writeFile(globalPath, external);

    await assert.rejects(
      commitMcpConfigMutation(preview),
      (error: unknown) =>
        error instanceof McpConfigConflictError && error.code === "config-changed",
    );
    assert.equal(await readFile(globalPath, "utf8"), external);
    assert.doesNotMatch(String(preview), /EXTERNAL_SECRET/);

    await addMcpServer({ agentDir, cwd }, { name: "after-conflict", command: "node" });
    const parsed = (await readConfig(globalPath)) as { mcpServers: Record<string, unknown> };
    assert.deepEqual(Object.keys(parsed.mcpServers), ["external", "after-conflict"]);
  });
});

await test("a malformed target written after preview is an exact conflict", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    await writeFile(globalPath, JSON.stringify({ mcpServers: {}, keep: true }));
    const preview = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "add", server: { name: "safe", command: "node" } },
    );
    const malformed = '{"mcpServers":{"external":{"env":{"TOKEN":"MALFORMED_SECRET"}},}}';
    await writeFile(globalPath, malformed);

    await assert.rejects(
      commitMcpConfigMutation(preview),
      (error: unknown) =>
        error instanceof McpConfigConflictError && error.code === "config-changed",
    );
    assert.equal(await readFile(globalPath, "utf8"), malformed);
    assert.doesNotMatch(String(preview), /MALFORMED_SECRET/);
  });
});

await test("a target removed after preview is a conflict and is not recreated", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    await writeFile(
      globalPath,
      JSON.stringify({ mcpServers: { safe: { command: "node" } }, keep: true }),
    );
    const preview = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "enable", scope: "global", name: "safe", enabled: false },
    );
    await rm(globalPath);

    await assert.rejects(
      commitMcpConfigMutation(preview),
      (error: unknown) =>
        error instanceof McpConfigConflictError && error.code === "config-changed",
    );
    await assert.rejects(readFile(globalPath), /ENOENT/);
  });
});

await test("preview rejects accessor-backed or unbounded mutation data without invoking it", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    let getterRead = false;
    const server = { name: "safe" };
    Object.defineProperty(server, "command", {
      enumerable: true,
      get() {
        getterRead = true;
        return "node";
      },
    });
    await assert.rejects(
      previewMcpConfigMutation({ agentDir, cwd }, { kind: "add", server } as never),
      (error: unknown) => error instanceof McpConfigError && error.code === "invalid-input",
    );
    assert.equal(getterRead, false);
    await assert.rejects(readFile(globalPath), /ENOENT/);
    await assert.rejects(
      previewMcpConfigMutation(
        { agentDir, cwd },
        {
          kind: "add",
          server: {
            name: "safe",
            command: "node",
            args: Array.from({ length: 129 }, () => "x"),
          },
        },
      ),
      (error: unknown) => error instanceof McpConfigError && error.code === "invalid-input",
    );

    let commandDescriptorReads = 0;
    const statefulServer = new Proxy(
      { name: "proxy-safe", command: "planned-command" },
      {
        get() {
          throw new Error("property getter must not run");
        },
        getOwnPropertyDescriptor(target, key) {
          if (key === "command") {
            commandDescriptorReads += 1;
            return {
              value: commandDescriptorReads === 1 ? "planned-command" : "tampered-command",
              enumerable: true,
              configurable: true,
              writable: true,
            };
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const proxyPreview = await previewMcpConfigMutation(
      { agentDir, cwd },
      { kind: "add", server: statefulServer },
    );
    await commitMcpConfigMutation(proxyPreview);
    assert.deepEqual(
      ((await readConfig(globalPath)) as { mcpServers: Record<string, unknown> }).mcpServers,
      { "proxy-safe": { command: "planned-command" } },
    );
  });
});

await test("post-check cross-process race remains an explicit limitation", async () => {
  const source = await readFile(new URL("../src/mcp-config.ts", import.meta.url), "utf8");
  assert.match(source, /external writer can still replace the file after the final read/i);
  assert.match(source, /not a cross-process compare-and-swap/i);
  assert.doesNotMatch(source, /unlink\s*\(/);
});
