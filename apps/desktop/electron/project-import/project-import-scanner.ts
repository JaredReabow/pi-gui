import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, open, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, parse, resolve } from "node:path";
import type {
  ProjectImportCandidate,
  ProjectImportSource,
  ProjectImportSourceStatus,
} from "@pi-gui/session-driver";

const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_DIRECTORIES = 600;
const MAX_CANDIDATES = 500;
const PROJECT_MARKERS = [
  ".git",
  ".pi",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Package.swift",
  "project.yml",
  "CMakeLists.txt",
];

export interface ProjectImportScanOptions {
  readonly platform?: NodeJS.Platform;
  readonly homeDir: string;
  readonly appDataDir: string;
  readonly documentsDir: string;
}

interface RawCandidate {
  readonly source: ProjectImportSource;
  readonly path: string;
  readonly requireMarker: boolean;
}

export async function scanProjectImports(options: ProjectImportScanOptions): Promise<{
  readonly candidates: readonly ProjectImportCandidate[];
  readonly sources: readonly ProjectImportSourceStatus[];
}> {
  const raw: RawCandidate[] = [];
  const detected = new Set<ProjectImportSource>();

  await scanCursor(options, raw, detected);
  await scanClaude(options, raw, detected);
  await scanChatGPT(options, raw, detected);

  const merged = new Map<string, { path: string; sources: Set<ProjectImportSource> }>();
  for (const item of raw.slice(0, MAX_CANDIDATES * 3)) {
    const workspacePaths = await resolveProjectDirectories(
      item.path,
      item.requireMarker,
      options.platform ?? process.platform,
    );
    for (const workspacePath of workspacePaths) {
      const key = options.platform === "win32" ? workspacePath.toLowerCase() : workspacePath;
      const current = merged.get(key);
      if (current) current.sources.add(item.source);
      else merged.set(key, { path: workspacePath, sources: new Set([item.source]) });
    }
  }

  const candidates = [...merged.values()]
    .map(({ path, sources }) => ({
      id: createHash("sha256").update(path).digest("hex").slice(0, 20),
      name: basename(path),
      path,
      sources: [...sources].sort(),
    }))
    .sort(
      (left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
    )
    .slice(0, MAX_CANDIDATES);

  const allSources: readonly ProjectImportSource[] = ["cursor", "claude", "chatgpt"];
  return {
    candidates,
    sources: allSources.map((source) => ({
      source,
      detected: detected.has(source),
      candidateCount: candidates.filter((candidate) => candidate.sources.includes(source)).length,
    })),
  };
}

async function scanCursor(
  options: ProjectImportScanOptions,
  raw: RawCandidate[],
  detected: Set<ProjectImportSource>,
): Promise<void> {
  const userDirs =
    options.platform === "darwin"
      ? [join(options.appDataDir, "Cursor", "User")]
      : options.platform === "win32"
        ? [join(options.appDataDir, "Cursor", "User")]
        : [
            join(options.appDataDir, "Cursor", "User"),
            join(options.homeDir, ".config", "Cursor", "User"),
          ];
  for (const userDir of userDirs) {
    if (!(await pathExists(userDir))) continue;
    detected.add("cursor");
    const storage = await readJsonBounded(join(userDir, "globalStorage", "storage.json"));
    for (const candidate of cursorPathsFromStorage(storage)) {
      raw.push({ source: "cursor", path: candidate, requireMarker: false });
    }
    for (const candidate of await cursorWorkspacePaths(userDir)) {
      raw.push({ source: "cursor", path: candidate, requireMarker: false });
    }
  }
}

async function scanClaude(
  options: ProjectImportScanOptions,
  raw: RawCandidate[],
  detected: Set<ProjectImportSource>,
): Promise<void> {
  const configPaths = [
    join(options.homeDir, ".claude.json"),
    join(options.appDataDir, "Claude", "claude.json"),
  ];
  for (const configPath of configPaths) {
    const config = await readJsonBounded(configPath);
    if (!config) continue;
    detected.add("claude");
    for (const candidate of claudePathsFromConfig(config)) {
      raw.push({ source: "claude", path: candidate, requireMarker: false });
    }
  }

  const projectsDir = join(options.homeDir, ".claude", "projects");
  const entries = await readdirSafe(projectsDir);
  if (entries.length > 0) detected.add("claude");
  for (const entry of entries.slice(0, MAX_SCAN_DIRECTORIES)) {
    if (!entry.isDirectory()) continue;
    const files = await readdirSafe(join(projectsDir, entry.name));
    const sessionFile = files
      .filter((file) => file.isFile() && file.name.endsWith(".jsonl"))
      .sort((left, right) => right.name.localeCompare(left.name))[0];
    if (!sessionFile) continue;
    const header = await readFirstJsonLine(join(projectsDir, entry.name, sessionFile.name));
    if (typeof header?.cwd === "string") {
      raw.push({ source: "claude", path: header.cwd, requireMarker: false });
    }
  }
}

async function scanChatGPT(
  options: ProjectImportScanOptions,
  raw: RawCandidate[],
  detected: Set<ProjectImportSource>,
): Promise<void> {
  const roots = [
    join(options.documentsDir, "ChatGPT"),
    join(options.homeDir, ".codex", "worktrees"),
  ];
  for (const root of roots) {
    const entries = await readdirSafe(root);
    if (entries.length === 0) continue;
    detected.add("chatgpt");
    for (const entry of entries.slice(0, MAX_SCAN_DIRECTORIES)) {
      if (!entry.isDirectory()) continue;
      raw.push({ source: "chatgpt", path: join(root, entry.name), requireMarker: true });
    }
  }
}

function cursorPathsFromStorage(value: unknown): string[] {
  const paths = new Set<string>();
  const visit = (node: unknown, keyHint: string, depth: number) => {
    if (depth > 8 || paths.size >= 500) return;
    if (typeof node === "string") {
      if (isPathLikeValue(keyHint, node)) paths.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 500)) visit(item, keyHint, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, child] of Object.entries(node).slice(0, 1000)) {
      if (/^(?:file:\/\/|\/|[A-Za-z]:[\\/])/.test(key)) paths.add(key);
      visit(child, key, depth + 1);
    }
  };
  visit(value, "", 0);
  return [...paths];
}

function claudePathsFromConfig(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.projects)) return [];
  return Object.keys(value.projects).filter((path) => isAbsoluteProjectPath(path));
}

async function cursorWorkspacePaths(userDir: string): Promise<string[]> {
  const storageRoot = join(userDir, "workspaceStorage");
  const entries = await readdirSafe(storageRoot);
  const paths: string[] = [];
  for (const entry of entries.slice(0, MAX_SCAN_DIRECTORIES)) {
    if (!entry.isDirectory()) continue;
    const workspace = await readJsonBounded(join(storageRoot, entry.name, "workspace.json"));
    if (!isRecord(workspace)) continue;
    for (const key of ["folder", "workspace", "folderUri", "workspaceUri"]) {
      if (typeof workspace[key] === "string") paths.push(workspace[key]);
    }
  }
  return paths;
}

async function resolveProjectDirectories(
  value: string,
  requireMarker: boolean,
  platform: NodeJS.Platform,
): Promise<string[]> {
  const normalized = normalizePathValue(value, platform);
  if (!normalized) return [];
  try {
    const info = await stat(normalized);
    if (info.isFile() && extname(normalized) === ".code-workspace") {
      const workspace = await readJsonBounded(normalized);
      if (isRecord(workspace) && Array.isArray(workspace.folders)) {
        const projectPaths: string[] = [];
        for (const folder of workspace.folders) {
          if (!isRecord(folder)) continue;
          const folderValue =
            typeof folder.path === "string"
              ? resolve(dirname(normalized), folder.path)
              : typeof folder.uri === "string"
                ? folder.uri
                : undefined;
          if (!folderValue) continue;
          const folderPath = normalizePathValue(folderValue, platform);
          if (
            folderPath &&
            (await isLikelyProject(folderPath, requireMarker)) &&
            !projectPaths.includes(folderPath)
          ) {
            projectPaths.push(folderPath);
          }
        }
        return projectPaths;
      }
      return [];
    }
    return (await isLikelyProject(normalized, requireMarker)) ? [normalized] : [];
  } catch {
    return [];
  }
}

async function isLikelyProject(path: string, requireMarker: boolean): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isDirectory() || isDangerousRoot(path)) return false;
    if (!requireMarker) return true;
    return (await Promise.all(PROJECT_MARKERS.map((name) => pathExists(join(path, name))))).some(
      Boolean,
    );
  } catch {
    return false;
  }
}

function normalizePathValue(value: string, platform: NodeJS.Platform): string | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return undefined;
  if (trimmed.startsWith("file://")) {
    try {
      const url = new URL(trimmed);
      const decoded = decodeURIComponent(url.pathname);
      return platform === "win32" ? decoded.replace(/^\/([A-Za-z]:)/, "$1") : decoded;
    } catch {
      return undefined;
    }
  }
  if (!isAbsoluteProjectPath(trimmed)) return undefined;
  return resolve(trimmed);
}

function isAbsoluteProjectPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file://");
}

function isPathLikeValue(key: string, value: string): boolean {
  return (
    /(?:folder|workspace|path|uri|cwd)$/i.test(key) &&
    (value.startsWith("file://") || isAbsoluteProjectPath(value))
  );
}

function isDangerousRoot(path: string): boolean {
  const normalized = resolve(path);
  return normalized === parse(normalized).root || normalized.split(/[\\/]/).length < 3;
}

async function readJsonBounded(path: string): Promise<unknown> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_METADATA_BYTES) return undefined;
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function readFirstJsonLine(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const handle = await open(path, constants.O_RDONLY);
    try {
      const buffer = Buffer.alloc(32 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0];
      const value = JSON.parse(firstLine!) as unknown;
      return isRecord(value) ? value : undefined;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readdirSafe(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
