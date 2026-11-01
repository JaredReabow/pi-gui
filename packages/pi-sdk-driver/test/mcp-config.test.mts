import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addMcpServer,
  listMcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  updateMcpServer,
} from "../dist/mcp-config.js";

interface Setup {
  readonly root: string;
  readonly agentDir: string;
  readonly cwd: string;
  readonly globalPath: string;
  readonly projectPath: string;
}

async function withSetup(run: (setup: Setup) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-mcp-config-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const setup = {
    root,
    agentDir,
    cwd,
    globalPath: join(agentDir, "mcp.json"),
    projectPath: join(cwd, ".pi", "mcp.json"),
  };
  try {
    await run(setup);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
}

function jsonWithCrlf(value: unknown, indentation = "\t", newline = true): string {
  const serialized = JSON.stringify(value, null, indentation).replaceAll("\n", "\r\n");
  return `\uFEFF${serialized}${newline ? "\r\n" : ""}`;
}

await test("async mutation preserves BOM, CRLF, indentation, trailing newline and unrelated fields", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    const original = {
      autoEnableCodemode: false,
      mcpServers: {
        docs: {
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer ${DOCS_TOKEN}" },
          oauth: { clientId: "client-id" },
          exposure: "direct",
          unknownServerField: { preserve: true },
        },
        files: {
          command: "npx",
          args: ["-y", "server"],
          env: { SECRET: "existing-secret" },
          customField: 7,
        },
      },
      somethingElse: { keep: true },
    };
    await writeFile(globalPath, jsonWithCrlf(original));

    await setMcpServerEnabled({ agentDir, cwd }, "global", "files", false);
    await addMcpServer({ agentDir, cwd }, { name: "local", command: "node", args: ["server.mjs"] });
    await updateMcpServer({ agentDir, cwd }, "global", "files", {
      description: " Local server ",
    });

    const changed = await readFile(globalPath, "utf8");
    assert.ok(changed.startsWith("\uFEFF"));
    assert.match(changed, /\r\n\t"autoEnableCodemode"/);
    assert.ok(changed.endsWith("\r\n"));
    const parsed = (await readJson(globalPath)) as typeof original;
    assert.equal(parsed.autoEnableCodemode, false);
    assert.deepEqual(parsed.somethingElse, { keep: true });
    assert.deepEqual(parsed.mcpServers.docs, original.mcpServers.docs);
    assert.deepEqual(parsed.mcpServers.files, {
      ...original.mcpServers.files,
      enabled: false,
      description: "Local server",
    });
    assert.deepEqual(parsed.mcpServers.local, {
      command: "node",
      args: ["server.mjs"],
    });

    await setMcpServerEnabled({ agentDir, cwd }, "global", "files", true);
    await updateMcpServer({ agentDir, cwd }, "global", "files", { description: null });
    assert.equal(await removeMcpServer(agentDir, "local"), true);
    const restored = (await readJson(globalPath)) as typeof original;
    assert.deepEqual(restored, original);
  });
});

await test("existing trailing-newline absence and compact formatting are preserved", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    const original = '{"mcpServers":{"files":{"command":"node"}},"keep":true}';
    await writeFile(globalPath, original);
    await setMcpServerEnabled({ agentDir, cwd }, "global", "files", false);
    const text = await readFile(globalPath, "utf8");
    assert.ok(text.startsWith('{"mcpServers"'));
    assert.equal(text.endsWith("\n"), false);
    assert.deepEqual(await readJson(globalPath), {
      mcpServers: { files: { command: "node", enabled: false } },
      keep: true,
    });
  });
});

await test("effective listing composes trusted project full and override-only entries", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath, projectPath }) => {
    await writeFile(
      globalPath,
      JSON.stringify({
        autoEnableCodemode: false,
        mcpServers: {
          shared: {
            url: "https://user:pass@example.com/shared?api_key=GLOBAL_KEY",
            headers: { Authorization: "Bearer GLOBAL_SECRET" },
            auth: { provider: "global-provider" },
            description: "Global description",
          },
          "tool-name": { command: "node", args: ["--api-key", "ARG_SECRET"] },
          authenticated: {
            url: "https://example.com/authenticated",
            auth: { provider: "global-provider" },
          },
        },
      }),
    );
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      projectPath,
      JSON.stringify({
        autoEnableCodemode: true,
        mcpServers: {
          shared: {
            command: "node",
            args: ["project.mjs"],
            env: { PROJECT_TOKEN: "PROJECT_SECRET" },
          },
          "tool-name": { enabled: false, exposure: "hidden" },
          authenticated: { enabled: false },
          repo: { url: "https://example.com/repo", unknownField: "UNKNOWN_SECRET" },
        },
      }),
    );

    const listing = listMcpServers({ agentDir, cwd });
    assert.equal(listing.autoEnableCodeMode, true);
    assert.equal(listing.projectTrusted, true);
    assert.deepEqual(
      listing.servers.map((server) => `${server.scope}:${server.name}:${server.overridden}`),
      [
        "project:shared:true",
        "project:tool-name:true",
        "project:authenticated:true",
        "project:repo:false",
      ],
    );
    assert.equal(listing.servers[0]?.transport, "stdio");
    assert.equal(listing.servers[0]?.enabled, true);
    assert.equal(listing.servers[1]?.enabled, false);
    assert.equal(listing.servers[2]?.secretPresence.providerAuth, true);
    assert.deepEqual(listing.servers[1]?.secretPresence, {
      environment: false,
      headers: false,
      oauth: false,
      providerAuth: false,
      credentialLikeArguments: true,
      unknownFields: false,
    });
    assert.equal(listing.servers[3]?.secretPresence.unknownFields, true);
    assert.doesNotMatch(
      JSON.stringify(listing),
      /GLOBAL_KEY|GLOBAL_SECRET|PROJECT_SECRET|ARG_SECRET|UNKNOWN_SECRET|pass/,
    );

    const untrusted = listMcpServers({ agentDir, cwd, projectTrusted: false });
    assert.deepEqual(
      untrusted.servers.map((server) => `${server.scope}:${server.name}`),
      ["global:shared", "global:tool-name", "global:authenticated"],
    );
  });
});

await test("malformed, rejected and missing mutations preserve bytes and report sanitized errors", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    const broken = '{"mcpServers":{"secret":{"env":{"TOKEN":"MALFORMED_SECRET"}},}}';
    await writeFile(globalPath, broken);
    for (const operation of [
      () => addMcpServer({ agentDir, cwd }, { name: "safe", command: "node" }),
      () => setMcpServerEnabled({ agentDir, cwd }, "global", "secret", false),
      () => removeMcpServer(agentDir, "secret"),
      () =>
        updateMcpServer({ agentDir, cwd }, "global", "secret", {
          description: "UPDATED_SECRET",
        }),
    ]) {
      await assert.rejects(operation, (error: unknown) => {
        assert.doesNotMatch(String(error), /MALFORMED_SECRET|UPDATED_SECRET/);
        return /invalid JSON/.test(String(error));
      });
      assert.equal(await readFile(globalPath, "utf8"), broken);
    }
  });
});

await test("missing file initializes cleanly and current-state operations are byte-preserving no-ops", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    assert.equal(await removeMcpServer(agentDir, "missing"), false);
    await assert.rejects(readFile(globalPath), /ENOENT/);

    await addMcpServer({ agentDir, cwd }, { name: "files", command: "node" });
    const before = await readFile(globalPath, "utf8");
    await setMcpServerEnabled({ agentDir, cwd }, "global", "files", true);
    await updateMcpServer({ agentDir, cwd }, "global", "files", { command: "node" });
    assert.equal(await readFile(globalPath, "utf8"), before);
  });
});

await test("name, URL and schema validation are sanitized and do not write", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    for (const server of [
      { name: " ", command: "node" },
      { name: "a", command: "  " },
      { name: "a", url: "file:///etc/passwd?secret=URL_SECRET" },
      { name: "a", url: "not a url" },
    ]) {
      await assert.rejects(
        addMcpServer({ agentDir, cwd }, server),
        (error: unknown) => !String(error).includes("URL_SECRET"),
      );
    }
    await assert.rejects(readFile(globalPath), /ENOENT/);

    await addMcpServer({ agentDir, cwd }, { name: "remote", url: "https://example.com/mcp" });
    await assert.rejects(
      addMcpServer({ agentDir, cwd }, { name: "remote", command: "node" }),
      /already exists/,
    );
  });
});

await test("prototype-shaped names remain ordinary JSON object keys", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    for (const name of ["toString", "constructor", "__proto__"]) {
      await addMcpServer({ agentDir, cwd }, { name, command: "node" });
    }
    const parsed = (await readJson(globalPath)) as { mcpServers: Record<string, unknown> };
    assert.deepEqual(Object.keys(parsed.mcpServers), ["toString", "constructor", "__proto__"]);
    assert.equal(await removeMcpServer(agentDir, "__proto__"), true);
    assert.equal(await removeMcpServer(agentDir, "constructor"), true);
    assert.deepEqual(
      Object.keys(
        ((await readJson(globalPath)) as { mcpServers: Record<string, unknown> }).mcpServers,
      ),
      ["toString"],
    );
  });
});

await test("namespace conflicts across global and project dependencies are refused", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    await addMcpServer({ agentDir, cwd }, { name: "my-docs", command: "node" });
    await assert.rejects(
      addMcpServer({ agentDir, cwd }, { name: "my_docs", command: "node" }),
      /namespace/,
    );

    const other = join(cwd, "..", "other-workspace");
    await mkdir(join(other, ".pi"), { recursive: true });
    await writeFile(
      join(other, ".pi", "mcp.json"),
      JSON.stringify({ mcpServers: { "team-search": { command: "node" } } }),
    );
    await assert.rejects(
      addMcpServer({ agentDir, cwd }, { name: "team_search", command: "node" }, [other]),
      /namespace/,
    );
    await addMcpServer({ agentDir, cwd }, { name: "team-search", command: "node" }, [other]);
    assert.deepEqual(
      Object.keys(((await readJson(globalPath)) as { mcpServers: object }).mcpServers),
      ["my-docs", "team-search"],
    );
  });
});

await test("stdio credential-like arguments are masked and hidden detection includes unknown fields", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath }) => {
    const args = [
      "-y",
      "@example/server",
      "--api-key",
      "ARG_SECRET_1",
      "--token=ARG_SECRET_2",
      "GITHUB_TOKEN=ARG_SECRET_3",
      "--header",
      "Authorization: Bearer ARG_SECRET_4",
      "--password",
      "--verbose",
      "https://user:ARG_SECRET_5@example.com/mcp?api_key=ARG_SECRET_6",
    ];
    await writeFile(
      globalPath,
      JSON.stringify({
        mcpServers: {
          tools: {
            command: "npx",
            args,
            env: { SECRET: "ENV_SECRET" },
            custom: "UNKNOWN_SECRET",
          },
        },
      }),
    );
    const [server] = listMcpServers({ agentDir, cwd }).servers;
    assert.equal(server?.hasHiddenSettings, true);
    assert.equal(server?.secretPresence.credentialLikeArguments, true);
    assert.equal(server?.secretPresence.unknownFields, true);
    assert.doesNotMatch(JSON.stringify(server), /ARG_SECRET|ENV_SECRET|UNKNOWN_SECRET/);
    assert.match(JSON.stringify(server), /•/);
  });
});

await test("description is saved and project auth is rejected like pi", async () => {
  await withSetup(async ({ agentDir, cwd, globalPath, projectPath }) => {
    await addMcpServer(
      { agentDir, cwd },
      { name: "docs", description: "  Team docs ", url: "https://example.com/mcp" },
    );
    assert.deepEqual(await readJson(globalPath), {
      mcpServers: { docs: { url: "https://example.com/mcp", description: "Team docs" } },
    });
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      projectPath,
      JSON.stringify({
        mcpServers: {
          unsafe: {
            url: "https://example.com/mcp",
            auth: { provider: "SECRET_PROVIDER" },
          },
        },
      }),
    );
    const listing = listMcpServers({ agentDir, cwd });
    assert.equal(
      listing.servers.some((server) => server.name === "unsafe"),
      false,
    );
    assert.match(listing.errors.join("\n"), /only allowed in the global/);
    assert.doesNotMatch(JSON.stringify(listing), /SECRET_PROVIDER/);
  });
});
