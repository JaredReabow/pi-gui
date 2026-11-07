import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, symlink, link, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { runAutonomySandbox } from "../dist/autonomy-sandbox.js";
import { autonomyPath } from "../dist/autonomy-paths.js";
import { parseAutonomyReview } from "../dist/autonomy-extension.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-autonomy-test-"));
  const project = join(root, "project");
  await mkdir(project);
  return { root, project };
}
test("canonical paths reject traversal, prefix siblings, links, protected and ambiguous paths", async () => {
  const { root, project } = await fixture();
  await writeFile(join(root, "outside"), "private");
  await symlink(root, join(project, "escape"));
  await link(join(root, "outside"), join(project, "hard"));
  for (const p of [
    "../outside",
    project + "-other/file",
    "escape/outside",
    "hard",
    ".git/config",
    ".pi/extensions/x.ts",
    ".agents/skills/x",
    "AGENTS.md",
    ".env",
    "@../outside",
    "~/outside",
  ])
    assert.equal((await autonomyPath(project, p)).scoped, false, p);
  assert.equal((await autonomyPath(project, "src/new.ts")).scoped, true);
});
test("reviewer JSON is strict and cannot smuggle an allow decision", () => {
  assert.equal(
    parseAutonomyReview('{"decision":"allow","risk":"low","reason":"read-only inspection"}')
      .decision,
    "allow",
  );
  for (const text of [
    "allow",
    "```json\n{}\n```",
    '{"decision":"allow","risk":"low"}',
    '{"decision":"allow","risk":"low","reason":"ok","override":true}',
    '{"decision":true,"risk":"low","reason":"ok"}',
  ])
    assert.throws(() => parseAutonomyReview(text));
});
test(
  "real Seatbelt permits project SDK writes/edits and rejects host writes and linked files",
  { skip: process.platform !== "darwin" },
  async () => {
    const { root, project } = await fixture();
    const outside = join(root, "outside.txt");
    await writeFile(outside, "unchanged");
    const inside = join(project, "inside.txt");
    await runAutonomySandbox(project, "write", { path: inside, content: "before" });
    await runAutonomySandbox(project, "edit", {
      path: inside,
      edits: [{ oldText: "before", newText: "after" }],
    });
    assert.equal(await readFile(inside, "utf8"), "after");
    await assert.rejects(
      runAutonomySandbox(project, "bash", {
        command: `printf bad > ${JSON.stringify(outside)}`,
        timeout: 3,
      }),
    );
    assert.equal(await readFile(outside, "utf8"), "unchanged");
    await symlink(outside, join(project, "escape"));
    await link(outside, join(project, "hard"));
    for (const path of ["escape", "hard"]) {
      await assert.rejects(
        runAutonomySandbox(project, "write", { path: join(project, path), content: "bad" }),
      );
      await assert.rejects(
        runAutonomySandbox(project, "bash", { command: `printf bad > ${path}`, timeout: 3 }),
      );
    }
    assert.equal(await readFile(outside, "utf8"), "unchanged");
    await assert.rejects(
      runAutonomySandbox(project, "bash", {
        command: `ln ${JSON.stringify(outside)} new-hardlink`,
        timeout: 3,
      }),
    );
    await assert.rejects(access(join(project, "new-hardlink")));
  },
);
test(
  "real sandbox denies configuration writes, credential reads, network and external IPC",
  { skip: process.platform !== "darwin" },
  async () => {
    const { project } = await fixture();
    await mkdir(join(project, ".pi"));
    await writeFile(join(project, ".env"), "SYNTHETIC_TEST_SECRET");
    await assert.rejects(
      runAutonomySandbox(project, "bash", {
        command: "printf bad > .pi/settings.json",
        timeout: 3,
      }),
    );
    await assert.rejects(access(join(project, ".pi/settings.json")));
    await assert.rejects(runAutonomySandbox(project, "bash", { command: "cat .env", timeout: 3 }));
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.end("not allowed");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === "object");
      await assert.rejects(
        runAutonomySandbox(project, "bash", {
          command: `/usr/bin/curl --max-time 2 http://127.0.0.1:${addr.port}`,
          timeout: 4,
        }),
      );
      assert.equal(requests, 0);
      await assert.rejects(
        runAutonomySandbox(project, "bash", {
          command: "/usr/bin/osascript -e 'tell application \"Finder\" to get count of windows'",
          timeout: 3,
        }),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
test(
  "sandbox cancellation kills an active shell before its later write",
  { skip: process.platform !== "darwin" },
  async () => {
    const { project } = await fixture();
    const controller = new AbortController();
    const pending = runAutonomySandbox(
      project,
      "bash",
      {
        command: `exec ${JSON.stringify(process.execPath)} -e ${JSON.stringify("const fs=require('node:fs');fs.writeFileSync('started','yes');setTimeout(()=>fs.writeFileSync('late','late'),15000)")}`,
        timeout: 30,
      },
      controller.signal,
    );
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        await access(join(project, "started"));
        break;
      } catch {}
      await new Promise((r) => setTimeout(r, 30));
    }
    await access(join(project, "started"));
    controller.abort();
    await assert.rejects(pending);
    await assert.rejects(access(join(project, "late")));
  },
);
test(
  "cancel during async preparation never launches an action",
  { skip: process.platform !== "darwin" },
  async () => {
    const { project } = await fixture();
    const controller = new AbortController();
    const pending = runAutonomySandbox(
      project,
      "bash",
      { command: "printf bad > cancelled", timeout: 3 },
      controller.signal,
    );
    controller.abort();
    await assert.rejects(pending);
    await new Promise((r) => setTimeout(r, 100));
    await assert.rejects(access(join(project, "cancelled")));
  },
);
test(
  "renaming hardlink ancestors cannot escape project writes",
  { skip: process.platform !== "darwin" },
  async () => {
    const { root, project } = await fixture();
    await mkdir(join(project, "dir"));
    await writeFile(join(root, "outside"), "unchanged");
    await link(join(root, "outside"), join(project, "dir/alias"));
    await assert.rejects(
      runAutonomySandbox(project, "bash", {
        command: "mv dir moved; printf bad > moved/alias",
        timeout: 3,
      }),
      /hardlink/,
    );
    assert.equal(await readFile(join(root, "outside"), "utf8"), "unchanged");
    await access(join(project, "dir/alias"));
  },
);
test(
  "project overlap cannot rewrite authority or rename its ancestors",
  { skip: process.platform !== "darwin" },
  async () => {
    const { project } = await fixture();
    const holder = join(project, "holder");
    const authority = join(holder, "authority");
    await mkdir(authority, { recursive: true });
    const state = join(authority, "autonomy.json");
    await writeFile(state, "read-only");
    assert.equal((await autonomyPath(project, state, [authority])).scoped, false);
    await assert.rejects(
      runAutonomySandbox(project, "write", { path: state, content: "full-access" }, undefined, [
        authority,
      ]),
    );
    await assert.rejects(
      runAutonomySandbox(project, "bash", { command: "mv holder moved", timeout: 3 }, undefined, [
        authority,
      ]),
    );
    assert.equal(await readFile(state, "utf8"), "read-only");
    await assert.rejects(access(join(project, "moved")));
  },
);
test(
  "single-process confinement rejects orphaning and detached subprocesses",
  { skip: process.platform !== "darwin" },
  async () => {
    const { project } = await fixture();
    await assert.rejects(
      runAutonomySandbox(project, "bash", {
        command: "(sleep 2; printf orphan > orphan) </dev/null >/dev/null 2>&1 &",
        timeout: 4,
      }),
    );
    const script =
      "try{const child=require('node:child_process').spawn('/bin/sh',['-c','sleep 1; echo orphan > orphan'],{detached:true,stdio:'ignore'});child.on('error',()=>console.log('SPAWN_DENIED'));child.unref();}catch(error){if(error.code!=='EPERM')throw error;console.log('SPAWN_DENIED')}";
    const result = await runAutonomySandbox(project, "bash", {
      command: `exec ${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
      timeout: 4,
    });
    assert.ok(JSON.stringify(result.content).includes("SPAWN_DENIED"));
    await new Promise((r) => setTimeout(r, 2200));
    await assert.rejects(access(join(project, "orphan")));
  },
);
test(
  "file tools cannot read outside-project or case-variant credentials",
  { skip: process.platform !== "darwin" },
  async () => {
    const { root, project } = await fixture();
    await writeFile(join(root, "private.txt"), "PRIVATE_HOST_DATA");
    await writeFile(join(project, ".ENV"), "CASE_VARIANT_SECRET");
    for (const path of [join(root, "private.txt"), join(project, ".ENV")])
      await assert.rejects(runAutonomySandbox(project, "read", { path }));
    await assert.rejects(runAutonomySandbox(project, "bash", { command: "cat .ENV", timeout: 3 }));
    await writeFile(join(project, "README"), "ordinary project text");
    const result = await runAutonomySandbox(project, "read", { path: join(project, "README") });
    assert.ok(JSON.stringify(result).includes("ordinary project text"));
  },
);
