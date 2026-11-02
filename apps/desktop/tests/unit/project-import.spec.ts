import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import {
  projectImport_decodeMonitorRequest,
  projectImport_sanitizeMonitorText,
} from "../../contracts/project-import";
import { scanProjectImports } from "../../electron/project-import/project-import-scanner";
import { projectImportMonitor_decodeDecision } from "../../../../packages/pi-sdk-driver/src/project-import-monitor-decision";

test("project discovery reads only supported local metadata and merges duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-project-import-scan-"));
  const homeDir = join(root, "home");
  const appDataDir = join(root, "app-data");
  const documentsDir = join(root, "documents");
  const cursorProject = join(root, "projects", "cursor-project");
  const claudeProject = join(root, "projects", "claude-project");
  const chatGPTProject = join(documentsDir, "ChatGPT", "chatgpt-project");
  await Promise.all([
    mkdir(cursorProject, { recursive: true }),
    mkdir(claudeProject, { recursive: true }),
    mkdir(join(chatGPTProject, ".git"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(cursorProject, "package.json"), "{}\n"),
    writeFile(join(claudeProject, "pyproject.toml"), "[project]\nname='fixture'\n"),
  ]);

  const cursorStorage = join(appDataDir, "Cursor", "User", "workspaceStorage", "fixture");
  await mkdir(cursorStorage, { recursive: true });
  await writeFile(
    join(cursorStorage, "workspace.json"),
    JSON.stringify({ folder: `file://${cursorProject}` }),
  );
  const cursorGlobalStorage = join(appDataDir, "Cursor", "User", "globalStorage");
  await mkdir(cursorGlobalStorage, { recursive: true });
  await writeFile(
    join(cursorGlobalStorage, "storage.json"),
    JSON.stringify({
      profileAssociations: {
        workspaces: { [`file://${cursorProject}`]: { profile: "default" } },
      },
    }),
  );

  const claudeSessionDir = join(homeDir, ".claude", "projects", "encoded-project");
  await mkdir(claudeSessionDir, { recursive: true });
  await writeFile(
    join(claudeSessionDir, "session.jsonl"),
    `${JSON.stringify({ type: "session", cwd: claudeProject })}\n`,
  );

  const result = await scanProjectImports({
    platform: "darwin",
    homeDir,
    appDataDir,
    documentsDir,
  });

  expect(result.sources).toEqual([
    { source: "cursor", detected: true, candidateCount: 1 },
    { source: "claude", detected: true, candidateCount: 1 },
    { source: "chatgpt", detected: true, candidateCount: 1 },
  ]);
  expect(result.candidates.map((candidate) => candidate.name)).toEqual([
    "chatgpt-project",
    "claude-project",
    "cursor-project",
  ]);
  expect(result.candidates.every((candidate) => candidate.path.startsWith(root))).toBe(true);
  expect(result.candidates.find((candidate) => candidate.path === cursorProject)?.sources).toEqual([
    "cursor",
  ]);
});

test("AI monitor decisions are strict and bounded", () => {
  expect(
    projectImportMonitor_decodeDecision(
      '```json\n{"action":"retry","message":"Retry the one failed import."}\n```',
    ),
  ).toEqual({ action: "retry", message: "Retry the one failed import." });
  expect(projectImportMonitor_decodeDecision('{"action":"delete","message":"no"}')).toBeNull();
  expect(projectImportMonitor_decodeDecision("not json")).toBeNull();
});

test("AI monitor requests accept only sanitized bounded summaries", () => {
  const sanitizedError = projectImport_sanitizeMonitorText(
    "Permission denied at /Users/leo/private/project; Bearer secret.token api_key=abc123",
  );
  expect(sanitizedError).not.toContain("/Users/leo");
  expect(sanitizedError).not.toContain("secret.token");
  expect(sanitizedError).not.toContain("abc123");
  expect(sanitizedError).toContain("[path]");
  expect(sanitizedError).toContain("Bearer [redacted]");
  expect(
    projectImport_sanitizeMonitorText('Cannot import "C:\\Users\\Leo\\Project Name"; code EPERM'),
  ).toBe("Cannot import [path]; code EPERM");

  expect(
    projectImport_decodeMonitorRequest({
      model: { provider: "provider", modelId: "model" },
      cwd: "/workspace/project",
      candidatesFound: 3,
      imported: 2,
      alreadyPresent: 0,
      failures: [{ name: "project", status: "failed", error: "Permission denied" }],
    }),
  ).toMatchObject({ imported: 2, failures: [{ status: "failed" }] });
  expect(
    projectImport_decodeMonitorRequest({
      model: { provider: "provider", modelId: "model" },
      cwd: "/workspace/project",
      candidatesFound: 1,
      imported: 0,
      alreadyPresent: 0,
      failures: [
        {
          name: "project",
          status: "failed",
          error: "Failed at /Users/leo/private/project",
        },
      ],
    }).failures[0]?.error,
  ).toBe("Failed at [path]");
  expect(() =>
    projectImport_decodeMonitorRequest({
      model: { provider: "provider", modelId: "model" },
      cwd: "/workspace/project",
      candidatesFound: 1,
      imported: 0,
      alreadyPresent: 0,
      failures: [{ name: "project", status: "unknown", error: "x" }],
    }),
  ).toThrow("status must be failed");
});

test("a multi-root Cursor workspace contributes every project folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-project-import-multi-root-"));
  const homeDir = join(root, "home");
  const appDataDir = join(root, "app-data");
  const documentsDir = join(root, "documents");
  const firstProject = join(root, "projects", "alpha");
  const secondProject = join(root, "projects", "beta");
  const workspaceFile = join(root, "fixture.code-workspace");
  const cursorStorage = join(appDataDir, "Cursor", "User", "workspaceStorage", "fixture");
  await Promise.all([
    mkdir(firstProject, { recursive: true }),
    mkdir(secondProject, { recursive: true }),
    mkdir(cursorStorage, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(firstProject, "package.json"), "{}\n"),
    writeFile(join(secondProject, "package.json"), "{}\n"),
    writeFile(
      workspaceFile,
      JSON.stringify({
        folders: [{ path: relative(root, firstProject) }, { path: relative(root, secondProject) }],
      }),
    ),
    writeFile(
      join(cursorStorage, "workspace.json"),
      JSON.stringify({ workspace: pathToFileURL(workspaceFile).href }),
    ),
  ]);

  const result = await scanProjectImports({
    platform: "darwin",
    homeDir,
    appDataDir,
    documentsDir,
  });

  expect(result.sources[0]).toEqual({ source: "cursor", detected: true, candidateCount: 2 });
  expect(result.candidates.map((candidate) => candidate.path)).toEqual([
    firstProject,
    secondProject,
  ]);
});
