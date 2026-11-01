/**
 * The single owner of pi's user and project `mcp.json` files.
 *
 * This module validates and composes effective server definitions, exposes a
 * secret-safe read model, and serializes mutations by canonical target path.
 * Every write replaces complete bytes through the catalog atomic writer.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isProxy } from "node:util/types";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { writeFileAtomic } from "@pi-gui/catalogs/node/atomic-write";

export type McpServerScope = "global" | "project";

export interface McpSecretPresence {
  readonly environment: boolean;
  readonly headers: boolean;
  readonly oauth: boolean;
  readonly providerAuth: boolean;
  readonly credentialLikeArguments: boolean;
  readonly unknownFields: boolean;
}

export interface McpServerSummary {
  readonly name: string;
  /** The source of the effective definition or override. */
  readonly scope: McpServerScope;
  readonly transport: "stdio" | "http";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly overridden: boolean;
  readonly trustedProject: boolean;
  readonly secretPresence: McpSecretPresence;
  /** True when any credential-bearing or unknown field contains settings. */
  readonly hasHiddenSettings: boolean;
}

export interface McpServerListing {
  readonly globalConfigPath: string;
  readonly projectTrusted: boolean;
  readonly autoEnableCodeMode: boolean;
  readonly servers: readonly McpServerSummary[];
  /** Sanitized file and entry diagnostics. */
  readonly errors: readonly string[];
}

export type NewMcpServer = { readonly name: string; readonly description?: string } & (
  { readonly command: string; readonly args?: readonly string[] } | { readonly url: string }
);

export interface McpServerUpdate {
  readonly description?: string | null;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
}

export interface McpConfigLocation {
  readonly agentDir: string;
  readonly cwd: string;
  /** Product owners pass Pi's project trust decision. Existing callers retain prior behavior by default. */
  readonly projectTrusted?: boolean;
}

export type McpConfigMutation =
  | {
      readonly kind: "add";
      readonly scope?: McpServerScope;
      readonly server: NewMcpServer;
    }
  | {
      readonly kind: "update";
      readonly scope: McpServerScope;
      readonly name: string;
      readonly patch: McpServerUpdate;
    }
  | {
      readonly kind: "remove";
      readonly scope: McpServerScope;
      readonly name: string;
    }
  | {
      readonly kind: "enable";
      readonly scope: McpServerScope;
      readonly name: string;
      readonly enabled: boolean;
    };

export interface McpConfigMutationOptions {
  readonly otherProjects?: readonly string[];
  readonly projectTrusted?: boolean;
}

export interface McpConfigDependencyRevision {
  /** Opaque category; dependency filesystem paths are not returned. */
  readonly label: string;
  readonly revision: string;
}

export interface McpConfigMutationPreview {
  readonly previewId: string;
  readonly operation: McpConfigMutation["kind"];
  readonly target: {
    readonly scope: McpServerScope;
    readonly name: string;
    readonly revision: string;
  };
  readonly dependencies: readonly McpConfigDependencyRevision[];
  readonly changed: boolean;
}

export interface McpConfigCommitResult {
  readonly operation: McpConfigMutation["kind"];
  readonly outcome: "committed" | "unchanged";
  readonly targetRevision: string;
}

export type McpConfigErrorCode =
  | "invalid-input"
  | "invalid-config"
  | "already-exists"
  | "missing-server"
  | "namespace-conflict"
  | "config-changed"
  | "invalid-preview";

/** Errors expose stable categories and sanitized labels, never JSON fragments or secret values. */
export class McpConfigError extends Error {
  readonly code: McpConfigErrorCode;

  constructor(code: McpConfigErrorCode, message: string) {
    super(message);
    this.name = "McpConfigError";
    this.code = code;
  }
}

export class McpConfigConflictError extends McpConfigError {
  readonly dependenciesChanged: boolean;

  constructor(dependenciesChanged: boolean) {
    super(
      "config-changed",
      "MCP configuration changed after preview. Refresh the preview before saving.",
    );
    this.name = "McpConfigConflictError";
    this.dependenciesChanged = dependenciesChanged;
  }
}

/** pi's server-name rule. */
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const MCP_EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const;
const OVERRIDE_KEYS = new Set(["enabled", "exposure", "toolExposure"]);
const KNOWN_SERVER_FIELDS = new Set([
  "type",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "oauth",
  "auth",
  "enabled",
  "exposure",
  "toolExposure",
  "timeout",
  "description",
]);
const SECRET_NAME = /token|key|secret|password|passwd|auth|credential|bearer/i;
const HTTP_URL = /^https?:\/\//i;
const MASK = "•••";
const MCP_MUTATION_MAX_KEYS = 8;
const MCP_OTHER_PROJECTS_MAX = 128;
const MCP_ARGUMENTS_MAX = 128;
const MCP_SERVER_NAME_MAX_BYTES = 160;
const MCP_STRING_MAX_BYTES = 4_096;
const MCP_URL_MAX_BYTES = 8_192;

interface ConfigState {
  readonly path: string;
  readonly exists: boolean;
  readonly revision: string;
  readonly raw: Buffer | undefined;
  readonly body: string;
  readonly parsed: Record<string, unknown>;
  readonly hasBom: boolean;
  readonly eol: "\n" | "\r\n";
  readonly trailingNewline: boolean;
  readonly indentation: number | string | undefined;
}

interface EffectiveServer {
  readonly name: string;
  readonly value: Record<string, unknown>;
  readonly scope: McpServerScope;
  readonly overridden: boolean;
}

interface DependencyFile {
  readonly path: string;
  readonly source: McpServerScope;
  readonly label: string;
}

interface PreviewState {
  readonly location: McpConfigLocation;
  readonly mutation: McpConfigMutation;
  readonly targetPath: string;
  readonly targetKey: string;
  readonly dependencies: readonly DependencyFile[];
  readonly targetRevision: string;
  readonly dependencyRevisions: readonly McpConfigDependencyRevision[];
}

interface MutationPlan {
  readonly parsed: Record<string, unknown>;
  readonly changed: boolean;
}

const targetQueues = new Map<string, Promise<void>>();
const previewStates = new WeakMap<McpConfigMutationPreview, PreviewState>();

export function isValidMcpServerName(name: string): boolean {
  return MCP_SERVER_NAME.test(name);
}

export function mcpConfigPath(location: McpConfigLocation, scope: McpServerScope): string {
  return scope === "global"
    ? join(location.agentDir, "mcp.json")
    : join(location.cwd, CONFIG_DIR_NAME, "mcp.json");
}

/**
 * Build the effective Pi-compatible listing. A trusted project full definition
 * replaces the global definition with the same name; an override-only project
 * entry applies only `enabled`, `exposure`, and `toolExposure`.
 */
export function listMcpServers(location: McpConfigLocation): McpServerListing {
  const projectTrusted = location.projectTrusted ?? true;
  const errors: string[] = [];
  const effective = new Map<string, EffectiveServer>();
  let autoEnableCodeMode = true;

  const scopes: readonly McpServerScope[] = projectTrusted ? ["global", "project"] : ["global"];
  for (const scope of scopes) {
    const path = mcpConfigPath(location, scope);
    let state: ConfigState;
    try {
      state = readConfigStateSync(path);
    } catch (error) {
      errors.push(safeErrorMessage(path, error));
      continue;
    }
    if (!state.exists) continue;

    const configuredAutoEnable = state.parsed.autoEnableCodemode;
    if (typeof configuredAutoEnable === "boolean") {
      autoEnableCodeMode = configuredAutoEnable;
    } else if (configuredAutoEnable !== undefined) {
      errors.push(`${path}: autoEnableCodemode must be a boolean`);
    }

    const rawServers = isRecord(state.parsed.mcpServers) ? state.parsed.mcpServers : {};
    for (const [name, rawValue] of Object.entries(rawServers)) {
      if (scope === "project" && isRecord(rawValue) && isOverrideOnly(rawValue)) {
        const base = effective.get(name);
        const extraKeys = Object.keys(rawValue).filter((key) => !OVERRIDE_KEYS.has(key));
        if (!base) {
          errors.push(
            `${path}: server "${safeName(name)}" needs a command or URL, or a global server to override`,
          );
          continue;
        }
        if (extraKeys.length > 0) {
          errors.push(
            `${path}: server "${safeName(name)}" override can only set enabled, exposure, and toolExposure`,
          );
          continue;
        }
        const validation = validateMcpServer(name, { ...base.value, ...rawValue });
        if (!validation.ok) {
          errors.push(`${path}: ${validation.reason}`);
          continue;
        }
        effective.set(name, {
          name,
          value: validation.value,
          scope: "project",
          overridden: true,
        });
        continue;
      }

      const validation = validateMcpServer(name, rawValue);
      if (!validation.ok) {
        errors.push(`${path}: ${validation.reason}`);
        continue;
      }
      const clash = namespaceClash([...effective.keys()], name);
      if (clash) {
        errors.push(`${path}: server "${safeName(name)}" conflicts with "${safeName(clash)}"`);
        continue;
      }
      if (scope === "project") {
        const authError = projectAuthError(validation.value);
        if (authError) {
          errors.push(`${path}: ${authError}`);
          continue;
        }
      }
      effective.set(name, {
        name,
        value: validation.value,
        scope,
        overridden: scope === "project" && effective.has(name),
      });
    }
  }

  const servers = [...effective.values()].map(({ name, value, scope, overridden }) => {
    return summarizeServer(name, scope, value, overridden, projectTrusted);
  });
  return {
    globalConfigPath: mcpConfigPath(location, "global"),
    projectTrusted,
    autoEnableCodeMode,
    servers,
    errors,
  };
}

/** Read and validate a mutation without writing, retaining only opaque state for commit. */
export async function previewMcpConfigMutation(
  location: McpConfigLocation,
  mutation: McpConfigMutation,
  options: McpConfigMutationOptions = {},
): Promise<McpConfigMutationPreview> {
  // Every caller-owned value is copied before the first await. The stored
  // canonical object and revisions are separate immutable snapshots.
  const locationSnapshot = snapshotMcpConfigLocation(location);
  const mutationSnapshot = snapshotMcpConfigMutation(mutation);
  const optionsSnapshot = snapshotMcpConfigMutationOptions(options);
  const scope = mutationScope(mutationSnapshot);
  validateMutationName(mutationSnapshot);
  const targetPath = mcpConfigPath(locationSnapshot, scope);
  const dependencies = dependenciesForMutation(locationSnapshot, mutationSnapshot, optionsSnapshot);
  const targetKey = await canonicalTargetKey(targetPath);
  const targetState = await readConfigState(targetPath);
  const dependencyStates = await readDependencyStates(dependencies);
  assertDependencyNamespace(dependencies, dependencyStates, mutationSnapshot);
  const plan = buildMutationPlan(targetState, mutationSnapshot);
  const dependencyRevisions = copyDependencyRevisions(
    dependencies.map((dependency, index) => ({
      label: dependency.label,
      revision: dependencyStates[index]!.revision,
    })),
  );
  const expectedDependencyRevisions = freezeDependencyRevisions(
    dependencyRevisions.map((revision) => ({ ...revision })),
  );

  const preview: McpConfigMutationPreview = Object.freeze({
    previewId: randomUUID(),
    operation: mutationSnapshot.kind,
    target: Object.freeze({
      scope,
      name: mutationTargetName(mutationSnapshot),
      revision: targetState.revision,
    }),
    dependencies: dependencyRevisions,
    changed: plan.changed,
  });

  previewStates.set(
    preview,
    Object.freeze({
      location: locationSnapshot,
      mutation: mutationSnapshot,
      targetPath,
      targetKey,
      dependencies: Object.freeze(
        dependencies.map((dependency) => Object.freeze({ ...dependency })),
      ),
      targetRevision: targetState.revision,
      dependencyRevisions: expectedDependencyRevisions,
    }),
  );
  return preview;
}

/**
 * Commit an exact preview. The queue serializes commits for one canonical
 * target; a change to the target or any dependency before this check returns
 * `config-changed` without writing.
 *
 * The final compare and rename are not a cross-process compare-and-swap. An
 * external writer can still replace the file after the final read. If it wins,
 * its bytes remain; callers must not claim universal external serialization.
 */
export async function commitMcpConfigMutation(
  preview: McpConfigMutationPreview,
): Promise<McpConfigCommitResult> {
  const stored = previewStates.get(preview);
  if (!stored) {
    throw new McpConfigError(
      "invalid-preview",
      "MCP configuration preview is unknown or no longer valid.",
    );
  }

  return withTargetQueue(stored.targetKey, async () => {
    // Compare exact bytes before parsing so an externally introduced malformed
    // target is classified as a conflict and remains untouched.
    const currentTarget = await readConfigState(stored.targetPath, true);
    const currentDependencies = await readDependencyStates(stored.dependencies);
    const targetChanged = currentTarget.revision !== stored.targetRevision;
    const dependenciesChanged = stored.dependencyRevisions.some(
      (revision, index) => currentDependencies[index]!.revision !== revision.revision,
    );
    if (targetChanged || dependenciesChanged) {
      throw new McpConfigConflictError(dependenciesChanged);
    }

    assertDependencyNamespace(stored.dependencies, currentDependencies, stored.mutation);
    const result = await executeMutation(
      currentTarget,
      stored.mutation,
      stored.dependencies,
      currentDependencies,
    );
    previewStates.delete(preview);
    return result;
  });
}

/** Apply a mutation immediately under the same canonical-target queue. */
export async function applyMcpConfigMutation(
  location: McpConfigLocation,
  mutation: McpConfigMutation,
  options: McpConfigMutationOptions = {},
): Promise<McpConfigCommitResult> {
  const locationSnapshot = snapshotMcpConfigLocation(location);
  const mutationSnapshot = snapshotMcpConfigMutation(mutation);
  const optionsSnapshot = snapshotMcpConfigMutationOptions(options);
  const scope = mutationScope(mutationSnapshot);
  validateMutationName(mutationSnapshot);
  const targetPath = mcpConfigPath(locationSnapshot, scope);
  const dependencies = dependenciesForMutation(locationSnapshot, mutationSnapshot, optionsSnapshot);
  const targetKey = await canonicalTargetKey(targetPath);

  return withTargetQueue(targetKey, async () => {
    const targetState = await readConfigState(targetPath);
    const dependencyStates = await readDependencyStates(dependencies);
    assertDependencyNamespace(dependencies, dependencyStates, mutationSnapshot);
    return executeMutation(targetState, mutationSnapshot, dependencies, dependencyStates);
  });
}

/** Add a server. Existing callers add to the global file. */
export async function addMcpServer(
  location: McpConfigLocation,
  server: NewMcpServer,
  otherProjects: readonly string[] = [],
): Promise<void> {
  await applyMcpConfigMutation(
    location,
    { kind: "add", scope: "global", server },
    { otherProjects },
  );
}

/** Update guided fields while preserving hidden and unknown server fields. */
export async function updateMcpServer(
  location: McpConfigLocation,
  scope: McpServerScope,
  name: string,
  patch: McpServerUpdate,
): Promise<void> {
  await applyMcpConfigMutation(location, { kind: "update", scope, name, patch });
}

/** Remove a global server. Missing entries are a successful no-op. */
export async function removeMcpServer(agentDir: string, name: string): Promise<boolean> {
  const result = await applyMcpConfigMutation(
    { agentDir, cwd: agentDir },
    { kind: "remove", scope: "global", name },
  );
  return result.outcome === "committed";
}

/** Write `enabled: false`, or delete `enabled` to switch a server back on. */
export async function setMcpServerEnabled(
  location: McpConfigLocation,
  scope: McpServerScope,
  name: string,
  enabled: boolean,
): Promise<void> {
  await applyMcpConfigMutation(location, { kind: "enable", scope, name, enabled });
}

function mutationScope(mutation: McpConfigMutation): McpServerScope {
  return mutation.kind === "add" ? (mutation.scope ?? "global") : mutation.scope;
}

function mutationTargetName(mutation: McpConfigMutation): string {
  return mutation.kind === "add" ? mutation.server.name.trim() : mutation.name;
}

function validateMutationName(mutation: McpConfigMutation): void {
  const name = mutationTargetName(mutation);
  if (!isValidMcpServerName(name)) {
    throw new McpConfigError(
      "invalid-input",
      'Invalid MCP server name (use letters, digits, "_" and "-")',
    );
  }
}

function dependenciesForMutation(
  location: McpConfigLocation,
  mutation: McpConfigMutation,
  options: McpConfigMutationOptions,
): readonly DependencyFile[] {
  if (mutation.kind !== "add") return Object.freeze([]);
  if (mutationScope(mutation) === "project") {
    return Object.freeze([
      Object.freeze({
        path: mcpConfigPath(location, "global"),
        source: "global",
        label: "user",
      }),
    ]);
  }
  const projects = [...new Set([location.cwd, ...(options.otherProjects ?? [])])];
  return Object.freeze(
    projects.map((cwd, index) =>
      Object.freeze({
        path: mcpConfigPath({ ...location, cwd }, "project"),
        source: "project" as const,
        label: index === 0 ? "workspace" : `other-project-${index}`,
      }),
    ),
  );
}

function assertDependencyNamespace(
  dependencies: readonly DependencyFile[],
  states: readonly ConfigState[],
  mutation: McpConfigMutation,
): void {
  if (mutation.kind !== "add") return;
  const name = mutation.server.name.trim();
  for (const [index, dependency] of dependencies.entries()) {
    const names = validServerNames(states[index]!, dependency.source);
    const clash = namespaceClash(names, name);
    if (clash) {
      throw new McpConfigError(
        "namespace-conflict",
        `An MCP server named "${safeName(clash)}" already exists and shares this server namespace.`,
      );
    }
  }
}

function validServerNames(state: ConfigState, source: McpServerScope): readonly string[] {
  if (!state.exists || !isRecord(state.parsed.mcpServers)) return [];
  const names: string[] = [];
  for (const [name, value] of Object.entries(state.parsed.mcpServers)) {
    if (source === "project" && isRecord(value) && isOverrideOnly(value)) continue;
    const validation = validateMcpServer(name, value);
    if (!validation.ok) continue;
    if (source === "project" && projectAuthError(validation.value)) continue;
    names.push(name);
  }
  return names;
}

function buildMutationPlan(state: ConfigState, mutation: McpConfigMutation): MutationPlan {
  const parsed = { ...state.parsed };
  const existingServers = isRecord(parsed.mcpServers) ? { ...parsed.mcpServers } : undefined;
  const servers = existingServers ?? {};

  switch (mutation.kind) {
    case "add": {
      const name = mutation.server.name.trim();
      if (Object.hasOwn(servers, name)) {
        throw new McpConfigError(
          "already-exists",
          `An MCP server named "${safeName(name)}" already exists.`,
        );
      }
      const clash = namespaceClash(Object.keys(servers), name);
      if (clash) {
        throw new McpConfigError(
          "namespace-conflict",
          `An MCP server named "${safeName(clash)}" already exists and shares this server namespace.`,
        );
      }
      const config = newServerConfig(mutation.server);
      Object.defineProperty(servers, name, {
        value: config,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      parsed.mcpServers = servers;
      return { parsed, changed: true };
    }
    case "update": {
      const server = ownedServer(servers, mutation.name);
      const patched = updateServerValue(server, mutation.patch, mutation.name);
      servers[mutation.name] = patched.value;
      parsed.mcpServers = servers;
      return { parsed, changed: patched.changed };
    }
    case "remove": {
      if (!Object.hasOwn(servers, mutation.name)) return { parsed, changed: false };
      delete servers[mutation.name];
      parsed.mcpServers = servers;
      return { parsed, changed: true };
    }
    case "enable": {
      const server = ownedServer(servers, mutation.name);
      if (mutation.enabled) {
        if (server.enabled === undefined) return { parsed, changed: false };
        const next = { ...server };
        delete next.enabled;
        servers[mutation.name] = next;
      } else {
        if (server.enabled === false) return { parsed, changed: false };
        servers[mutation.name] = { ...server, enabled: false };
      }
      parsed.mcpServers = servers;
      return { parsed, changed: true };
    }
  }
}

function ownedServer(servers: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = Object.hasOwn(servers, name) ? servers[name] : undefined;
  if (!isRecord(value)) {
    throw new McpConfigError(
      "missing-server",
      `MCP configuration does not define server "${safeName(name)}".`,
    );
  }
  return value;
}

function updateServerValue(
  server: Record<string, unknown>,
  patch: McpServerUpdate,
  name: string,
): { readonly value: Record<string, unknown>; readonly changed: boolean } {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    throw new McpConfigError("invalid-input", "MCP server update must include at least one field.");
  }
  if (patch.command !== undefined && patch.url !== undefined) {
    throw new McpConfigError(
      "invalid-input",
      "MCP server update cannot set both a command and a URL.",
    );
  }

  const next = { ...server };
  let changed = false;
  if (patch.description !== undefined) {
    const description = patch.description?.trim();
    if (description) {
      if (next.description !== description) {
        next.description = description;
        changed = true;
      }
    } else if (Object.hasOwn(next, "description")) {
      delete next.description;
      changed = true;
    }
  }
  if (patch.command !== undefined) {
    const command = patch.command.trim();
    if (!command)
      throw new McpConfigError("invalid-input", "MCP server command must not be empty.");
    if (next.command !== command || Object.hasOwn(next, "url")) {
      next.command = command;
      delete next.url;
      if (next.type === "http" || next.type === "streamable-http") delete next.type;
      changed = true;
    }
  }
  if (patch.args !== undefined) {
    const args = [...patch.args];
    if (!sameStringArray(next.args, args)) {
      next.args = args;
      changed = true;
    }
  }
  if (patch.url !== undefined) {
    const url = validatedUrl(patch.url);
    if (next.url !== url || Object.hasOwn(next, "command") || Object.hasOwn(next, "args")) {
      next.url = url;
      delete next.command;
      delete next.args;
      delete next.cwd;
      if (next.type === "stdio") delete next.type;
      changed = true;
    }
  }

  const validation = validateMcpServer(name, next);
  if (!validation.ok) throw new McpConfigError("invalid-config", validation.reason);
  return { value: next, changed };
}

function executeMutation(
  targetState: ConfigState,
  mutation: McpConfigMutation,
  dependencies: readonly DependencyFile[],
  dependencyStates: readonly ConfigState[],
): Promise<McpConfigCommitResult> | McpConfigCommitResult {
  assertDependencyNamespace(dependencies, dependencyStates, mutation);
  const plan = buildMutationPlan(targetState, mutation);
  if (!plan.changed) {
    return {
      operation: mutation.kind,
      outcome: "unchanged",
      targetRevision: targetState.revision,
    };
  }
  const output = formatConfig(plan.parsed, targetState);
  return writeFileAtomic(targetState.path, output).then(() => ({
    operation: mutation.kind,
    outcome: "committed",
    targetRevision: revisionForText(output),
  }));
}

function formatConfig(parsed: Record<string, unknown>, state: ConfigState): string {
  const serialized = JSON.stringify(parsed, null, state.indentation);
  const withLineEndings = state.eol === "\r\n" ? serialized.replaceAll("\n", "\r\n") : serialized;
  const shouldEndWithNewline = !state.exists || state.trailingNewline;
  return `${state.hasBom ? "\uFEFF" : ""}${withLineEndings}${shouldEndWithNewline ? state.eol : ""}`;
}

async function readConfigState(path: string, allowInvalid = false): Promise<ConfigState> {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (error) {
    if (isFileNotFound(error)) return emptyConfigState(path);
    throw error;
  }
  return configStateFromBytes(path, raw, allowInvalid);
}

function readConfigStateSync(path: string): ConfigState {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (error) {
    if (isFileNotFound(error)) return emptyConfigState(path);
    throw error;
  }
  return configStateFromBytes(path, raw, false);
}

function emptyConfigState(path: string): ConfigState {
  return {
    path,
    exists: false,
    revision: "missing",
    raw: undefined,
    body: "",
    parsed: {},
    hasBom: false,
    eol: "\n",
    trailingNewline: true,
    indentation: 2,
  };
}

function configStateFromBytes(path: string, raw: Buffer, allowInvalid: boolean): ConfigState {
  const hasBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const decoded = raw.toString("utf8");
  const body = hasBom ? decoded.slice(1) : decoded;
  let parsed: Record<string, unknown>;
  try {
    parsed = parseMcpFile(path, body);
  } catch (error) {
    if (!allowInvalid) throw error;
    parsed = {};
  }
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const indentMatch = /^([ \t]+)(?=")/m.exec(body);
  const indentation = !body.includes("\n") ? undefined : (indentMatch?.[1]?.slice(0, 10) ?? "");
  return {
    path,
    exists: true,
    revision: createHash("sha256").update(raw).digest("hex"),
    raw,
    body,
    parsed,
    hasBom,
    eol,
    trailingNewline: body.endsWith("\n"),
    indentation,
  };
}

function parseMcpFile(path: string, text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new McpConfigError("invalid-config", `${path}: invalid JSON`);
  }
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
    throw new McpConfigError("invalid-config", `${path}: expected an mcpServers object`);
  }
  return parsed;
}

function revisionForText(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

async function readDependencyStates(
  dependencies: readonly DependencyFile[],
): Promise<readonly ConfigState[]> {
  return Promise.all(
    dependencies.map(async (dependency) => {
      try {
        return await readConfigState(dependency.path);
      } catch (error) {
        if (!(error instanceof McpConfigError) || error.code !== "invalid-config") throw error;
        try {
          return configStateFromBytes(dependency.path, await readFile(dependency.path), true);
        } catch (readError) {
          if (isFileNotFound(readError)) return emptyConfigState(dependency.path);
          throw readError;
        }
      }
    }),
  );
}

async function canonicalTargetKey(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    try {
      return join(await realpath(parent), basename(path));
    } catch {
      return resolve(path);
    }
  }
}

function withTargetQueue<T>(targetKey: string, action: () => Promise<T>): Promise<T> {
  const previous = targetQueues.get(targetKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.then(() => gate);
  targetQueues.set(targetKey, tail);

  return previous
    .catch(() => {})
    .then(action)
    .finally(() => {
      release();
      if (targetQueues.get(targetKey) === tail) targetQueues.delete(targetKey);
    });
}

function snapshotMcpConfigLocation(value: McpConfigLocation): McpConfigLocation {
  const record = boundedDataRecord(value, "location", 3);
  assertAllowedKeys(record, new Set(["agentDir", "cwd", "projectTrusted"]), "location");
  const agentDir = boundedString(readDataField(record, "agentDir"), "location.agentDir");
  const cwd = boundedString(readDataField(record, "cwd"), "location.cwd");
  const projectTrusted = optionalBoolean(record, "projectTrusted", "location.projectTrusted");
  return Object.freeze({
    agentDir,
    cwd,
    ...(projectTrusted === undefined ? {} : { projectTrusted }),
  });
}

function snapshotMcpConfigMutationOptions(
  value: McpConfigMutationOptions,
): McpConfigMutationOptions {
  const record = boundedDataRecord(value, "mutation options", 2);
  assertAllowedKeys(record, new Set(["otherProjects", "projectTrusted"]), "mutation options");
  const projectTrusted = optionalBoolean(
    record,
    "projectTrusted",
    "mutation options.projectTrusted",
  );
  let otherProjects: readonly string[] | undefined;
  if (Object.hasOwn(record, "otherProjects")) {
    otherProjects = boundedStringArray(
      readDataField(record, "otherProjects"),
      "mutation options.otherProjects",
      MCP_OTHER_PROJECTS_MAX,
    );
  }
  return Object.freeze({
    ...(otherProjects === undefined ? {} : { otherProjects }),
    ...(projectTrusted === undefined ? {} : { projectTrusted }),
  });
}

function snapshotMcpConfigMutation(value: McpConfigMutation): McpConfigMutation {
  const record = boundedDataRecord(value, "mutation", MCP_MUTATION_MAX_KEYS);
  const kind = boundedString(readDataField(record, "kind"), "mutation.kind");

  switch (kind) {
    case "add": {
      assertAllowedKeys(record, new Set(["kind", "scope", "server"]), "add mutation");
      const scope = optionalScope(record, "scope");
      const server = snapshotNewMcpServer(readDataField(record, "server"), "mutation.server");
      return Object.freeze({
        kind: "add",
        ...(scope === undefined ? {} : { scope }),
        server,
      });
    }
    case "update": {
      assertAllowedKeys(record, new Set(["kind", "scope", "name", "patch"]), "update mutation");
      const scope = requiredScope(record, "scope");
      const name = boundedString(
        readDataField(record, "name"),
        "mutation.name",
        MCP_SERVER_NAME_MAX_BYTES,
      );
      const patch = snapshotMcpServerUpdate(readDataField(record, "patch"), "mutation.patch");
      return Object.freeze({ kind: "update", scope, name, patch });
    }
    case "remove": {
      assertAllowedKeys(record, new Set(["kind", "scope", "name"]), "remove mutation");
      const scope = requiredScope(record, "scope");
      const name = boundedString(
        readDataField(record, "name"),
        "mutation.name",
        MCP_SERVER_NAME_MAX_BYTES,
      );
      return Object.freeze({ kind: "remove", scope, name });
    }
    case "enable": {
      assertAllowedKeys(record, new Set(["kind", "scope", "name", "enabled"]), "enable mutation");
      const scope = requiredScope(record, "scope");
      const name = boundedString(
        readDataField(record, "name"),
        "mutation.name",
        MCP_SERVER_NAME_MAX_BYTES,
      );
      const enabled = readDataField(record, "enabled");
      if (typeof enabled !== "boolean") throw invalidMutationInput();
      return Object.freeze({ kind: "enable", scope, name, enabled });
    }
    default:
      throw invalidMutationInput();
  }
}

function snapshotNewMcpServer(value: unknown, field: string): NewMcpServer {
  const record = boundedDataRecord(value, field, 5);
  assertAllowedKeys(record, new Set(["name", "description", "command", "args", "url"]), field);
  const name = boundedString(
    readDataField(record, "name"),
    `${field}.name`,
    MCP_SERVER_NAME_MAX_BYTES,
  );
  const description = optionalString(record, "description", `${field}.description`);
  const command = optionalString(record, "command", `${field}.command`);
  const url = optionalString(record, "url", `${field}.url`, MCP_URL_MAX_BYTES);
  const args = optionalStringArray(record, "args", `${field}.args`, MCP_ARGUMENTS_MAX);
  if (
    (command === undefined) === (url === undefined) ||
    (url !== undefined && args !== undefined)
  ) {
    throw invalidMutationInput();
  }
  const shared = {
    name,
    ...(description === undefined ? {} : { description }),
  };
  if (command !== undefined) {
    return Object.freeze({
      ...shared,
      command,
      ...(args === undefined ? {} : { args }),
    });
  }
  return Object.freeze({ ...shared, url: url! });
}

function snapshotMcpServerUpdate(value: unknown, field: string): McpServerUpdate {
  const record = boundedDataRecord(value, field, 4);
  assertAllowedKeys(record, new Set(["description", "command", "args", "url"]), field);
  const description = optionalNullableString(record, "description", `${field}.description`);
  const command = optionalString(record, "command", `${field}.command`);
  const url = optionalString(record, "url", `${field}.url`, MCP_URL_MAX_BYTES);
  const args = optionalStringArray(record, "args", `${field}.args`, MCP_ARGUMENTS_MAX);
  if (
    description === undefined &&
    command === undefined &&
    url === undefined &&
    args === undefined
  ) {
    throw invalidMutationInput();
  }
  if (command !== undefined && url !== undefined) throw invalidMutationInput();
  return Object.freeze({
    ...(description === undefined ? {} : { description }),
    ...(command === undefined ? {} : { command }),
    ...(args === undefined ? {} : { args }),
    ...(url === undefined ? {} : { url }),
  });
}

function freezeDependencyRevisions(
  revisions: readonly McpConfigDependencyRevision[],
): readonly McpConfigDependencyRevision[] {
  return Object.freeze(
    revisions.map((revision) =>
      Object.freeze({
        label: boundedString(revision.label, "dependency revision label"),
        revision: boundedString(revision.revision, "dependency revision"),
      }),
    ),
  );
}

function copyDependencyRevisions(
  revisions: readonly McpConfigDependencyRevision[],
): readonly McpConfigDependencyRevision[] {
  return Object.freeze(
    revisions.map((revision) => ({
      label: boundedString(revision.label, "dependency revision label"),
      revision: boundedString(revision.revision, "dependency revision"),
    })),
  );
}

function boundedDataRecord(
  value: unknown,
  label: string,
  maxKeys: number,
): Record<string, unknown> {
  try {
    if (!isRecord(value)) throw invalidMutationInput();
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalidMutationInput();
    const keys = Reflect.ownKeys(value);
    if (keys.length > maxKeys || keys.some((key) => typeof key !== "string")) {
      throw invalidMutationInput();
    }
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw invalidMutationInput();
      }
      Object.defineProperty(copy, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(copy);
  } catch (error) {
    if (error instanceof McpConfigError) throw error;
    throw invalidMutationInput(label);
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw invalidMutationInput(label);
    if (!allowed.has(key)) throw invalidMutationInput(label);
  }
}

function readDataField(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) throw invalidMutationInput();
  return descriptor.value;
}

function boundedString(value: unknown, label: string, maxBytes = MCP_STRING_MAX_BYTES): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw invalidMutationInput(label);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  maxBytes = MCP_STRING_MAX_BYTES,
): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  return boundedString(readDataField(record, key), label, maxBytes);
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = readDataField(record, key);
  if (value === null) return null;
  return boundedString(value, label);
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  label: string,
): boolean | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = readDataField(record, key);
  if (typeof value !== "boolean") throw invalidMutationInput(label);
  return value;
}

function optionalScope(record: Record<string, unknown>, key: string): McpServerScope | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  return requiredScope(record, key);
}

function requiredScope(record: Record<string, unknown>, key: string): McpServerScope {
  const value = readDataField(record, key);
  if (value !== "global" && value !== "project") throw invalidMutationInput();
  return value;
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
  maxItems: number,
): readonly string[] | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  return boundedStringArray(readDataField(record, key), label, maxItems);
}

function boundedStringArray(value: unknown, label: string, maxItems: number): readonly string[] {
  try {
    // Reject Proxy arrays before reading length or invoking any trap. Ordinary
    // arrays expose length as a non-configurable data descriptor, captured once.
    if (isProxy(value) || !Array.isArray(value)) throw invalidMutationInput(label);
    if (Object.getPrototypeOf(value) !== Array.prototype) throw invalidMutationInput(label);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const descriptorValue: unknown =
      lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
    const lengthValue = typeof descriptorValue === "number" ? descriptorValue : undefined;
    if (
      typeof lengthValue !== "number" ||
      !Number.isSafeInteger(lengthValue) ||
      lengthValue < 0 ||
      lengthValue > maxItems
    ) {
      throw invalidMutationInput(label);
    }
    const length = lengthValue;
    const keys = Reflect.ownKeys(value);
    const expectedLengthKey = keys.find((key) => key === "length");
    if (!expectedLengthKey || keys.length !== length + 1) throw invalidMutationInput(label);
    const copy: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) throw invalidMutationInput(label);
      copy.push(boundedString(descriptor.value, label));
    }
    return Object.freeze(copy);
  } catch (error) {
    if (error instanceof McpConfigError) throw error;
    throw invalidMutationInput(label);
  }
}

function invalidMutationInput(label = "mutation"): McpConfigError {
  return new McpConfigError(
    "invalid-input",
    `MCP ${label} input is malformed, non-data, or too large.`,
  );
}

function newServerConfig(server: NewMcpServer): Record<string, unknown> {
  const name = server.name.trim();
  const description = server.description?.trim();
  const transport = transportConfig(server);
  const config = description ? { ...transport, description } : transport;
  const validation = validateMcpServer(name, config);
  if (!validation.ok) throw new McpConfigError("invalid-config", validation.reason);
  return config;
}

function transportConfig(server: NewMcpServer): Record<string, unknown> {
  if ("url" in server) return { url: validatedUrl(server.url) };
  const command = server.command.trim();
  if (!command) {
    throw new McpConfigError("invalid-input", "MCP server command must not be empty.");
  }
  const args = server.args ?? [];
  return args.length > 0 ? { command, args: [...args] } : { command };
}

function validatedUrl(value: string): string {
  const url = value.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    // Use the sanitized error below.
  }
  throw new McpConfigError(
    "invalid-input",
    "MCP server URL must be a valid http:// or https:// URL.",
  );
}

type ValidationResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

/** Mirrors pi 1.4.0's public server-config validation without importing a private dist module. */
function validateMcpServer(name: string, raw: unknown): ValidationResult {
  if (!isValidMcpServerName(name)) {
    return { ok: false, reason: "invalid server name" };
  }
  if (!isRecord(raw)) {
    return { ok: false, reason: `server "${safeName(name)}" must be an object` };
  }

  const value = resolveExposureAliases(raw);
  const { type, exposure, enabled, timeout, toolExposure, description } = value;
  if (exposure !== undefined && !isExposure(exposure)) {
    return { ok: false, reason: `server "${safeName(name)}": invalid exposure` };
  }
  if (toolExposure !== undefined) {
    if (!isRecord(toolExposure)) {
      return { ok: false, reason: `server "${safeName(name)}": toolExposure must be an object` };
    }
    for (const tool of Object.keys(toolExposure)) {
      if (!isExposure(toolExposure[tool])) {
        return {
          ok: false,
          reason: `server "${safeName(name)}": toolExposure "${safeName(tool)}" is invalid`,
        };
      }
    }
  }
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return { ok: false, reason: `server "${safeName(name)}": enabled must be a boolean` };
  }
  if (description !== undefined && typeof description !== "string") {
    return { ok: false, reason: `server "${safeName(name)}": description must be a string` };
  }
  if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
    return { ok: false, reason: `server "${safeName(name)}": timeout must be positive` };
  }
  if (type === "sse") {
    return {
      ok: false,
      reason: `server "${safeName(name)}": legacy SSE transport is not supported`,
    };
  }

  if (
    typeof value.url === "string" &&
    (type === undefined || type === "http" || type === "streamable-http")
  ) {
    let url: URL;
    try {
      url = new URL(value.url);
    } catch {
      return { ok: false, reason: `server "${safeName(name)}": URL is invalid` };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, reason: `server "${safeName(name)}": URL must use HTTP or HTTPS` };
    }
    if (value.headers !== undefined && !isStringRecord(value.headers)) {
      return { ok: false, reason: `server "${safeName(name)}": headers must map to strings` };
    }
    const oauthError = validateOAuth(value.oauth);
    if (oauthError) {
      return { ok: false, reason: `server "${safeName(name)}": ${oauthError}` };
    }
    if (value.auth !== undefined) {
      if (
        !isRecord(value.auth) ||
        typeof value.auth.provider !== "string" ||
        !value.auth.provider
      ) {
        return { ok: false, reason: `server "${safeName(name)}": auth.provider is required` };
      }
      if (url.protocol !== "https:" && !LOOPBACK_HOSTS.has(url.hostname)) {
        return {
          ok: false,
          reason: `server "${safeName(name)}": auth requires HTTPS or loopback HTTP`,
        };
      }
    }
    return { ok: true, value };
  }

  if (typeof value.command === "string" && (type === undefined || type === "stdio")) {
    if (
      value.args !== undefined &&
      !(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"))
    ) {
      return { ok: false, reason: `server "${safeName(name)}": args must be strings` };
    }
    if (value.env !== undefined && !isStringRecord(value.env)) {
      return { ok: false, reason: `server "${safeName(name)}": env must map to strings` };
    }
    if (value.cwd !== undefined && typeof value.cwd !== "string") {
      return { ok: false, reason: `server "${safeName(name)}": cwd must be a string` };
    }
    return { ok: true, value };
  }

  return {
    ok: false,
    reason: `server "${safeName(name)}" needs either a command or URL`,
  };
}

function projectAuthError(value: Record<string, unknown>): string | undefined {
  if (typeof value.url === "string" && value.auth !== undefined) {
    return `server auth is only allowed in the global mcp.json`;
  }
  return undefined;
}

function validateOAuth(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return "oauth must be an object";
  if (value.clientId !== undefined && typeof value.clientId !== "string") {
    return "oauth.clientId must be a string";
  }
  if (value.clientSecret !== undefined && typeof value.clientSecret !== "string") {
    return "oauth.clientSecret must be a string";
  }
  if (
    value.callbackPort !== undefined &&
    (typeof value.callbackPort !== "number" ||
      !Number.isInteger(value.callbackPort) ||
      value.callbackPort < 1 ||
      value.callbackPort > 65_535)
  ) {
    return "oauth.callbackPort must be a port number";
  }
  if (value.callbackUrl !== undefined) {
    if (typeof value.callbackUrl !== "string" || !isLoopbackRedirectUrl(value.callbackUrl)) {
      return "oauth.callbackUrl must be a loopback HTTP URL";
    }
    const port = new URL(value.callbackUrl).port;
    if (port && typeof value.callbackPort === "number" && Number(port) !== value.callbackPort) {
      return "oauth callback ports must match";
    }
  }
  if (value.scope !== undefined && typeof value.scope !== "string") {
    return "oauth.scope must be a string";
  }
  if (
    value.clientName !== undefined &&
    (typeof value.clientName !== "string" || !value.clientName.trim())
  ) {
    return "oauth.clientName must be non-empty";
  }
  if (value.clientRegistration !== undefined) {
    if (value.clientRegistration !== "dcr" && value.clientRegistration !== "cimd") {
      return "oauth.clientRegistration is invalid";
    }
    if (
      value.clientRegistration === "cimd" &&
      (value.clientId !== undefined || value.clientName !== undefined)
    ) {
      return "oauth.clientRegistration cimd cannot use clientId or clientName";
    }
    if (value.clientRegistration === "cimd" && typeof value.callbackUrl === "string") {
      const callback = new URL(value.callbackUrl);
      if (callback.hostname === "[::1]" || callback.pathname !== "/callback") {
        return "oauth.clientRegistration cimd has an invalid callback URL";
      }
    }
  }
  if (value.authServerMetadataUrl !== undefined) {
    if (
      typeof value.authServerMetadataUrl !== "string" ||
      !isAllowedOAuthMetadataUrl(value.authServerMetadataUrl)
    ) {
      return "oauth.authServerMetadataUrl must use HTTPS or loopback HTTP";
    }
  }
  return undefined;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackRedirectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isAllowedOAuthMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
    );
  } catch {
    return false;
  }
}

function resolveExposureAliases(value: Record<string, unknown>): Record<string, unknown> {
  const resolved = { ...value };
  if (resolved.exposure === "codemode-deferred") resolved.exposure = "codemode";
  if (isRecord(resolved.toolExposure)) {
    resolved.toolExposure = Object.fromEntries(
      Object.entries(resolved.toolExposure).map(([tool, exposure]) => [
        tool,
        exposure === "codemode-deferred" ? "codemode" : exposure,
      ]),
    );
  }
  return resolved;
}

function isExposure(value: unknown): boolean {
  return (
    typeof value === "string" && MCP_EXPOSURES.includes(value as (typeof MCP_EXPOSURES)[number])
  );
}

function isOverrideOnly(value: Record<string, unknown>): boolean {
  return value.command === undefined && value.url === undefined && value.type === undefined;
}

function namespaceClash(names: readonly string[], name: string): string | undefined {
  const namespace = mcpNamespace(name);
  return names.find((other) => other !== name && mcpNamespace(other) === namespace);
}

function mcpNamespace(name: string): string {
  return `mcp__${name.replaceAll("-", "_")}`;
}

function summarizeServer(
  name: string,
  scope: McpServerScope,
  value: Record<string, unknown>,
  overridden: boolean,
  trustedProject: boolean,
): McpServerSummary {
  const enabled = value.enabled !== false;
  const secretPresence = secretPresenceFor(value);
  const description =
    typeof value.description === "string" && value.description.trim()
      ? { description: value.description.trim() }
      : {};
  const shared = {
    name,
    scope,
    ...description,
    enabled,
    overridden,
    trustedProject,
    secretPresence,
    hasHiddenSettings: Object.values(secretPresence).some(Boolean),
  } as const;

  if (typeof value.url === "string") {
    return { ...shared, transport: "http", url: redactUrl(value.url) };
  }
  const args = Array.isArray(value.args)
    ? redactArgs(value.args.filter((arg): arg is string => typeof arg === "string"))
    : [];
  return {
    ...shared,
    transport: "stdio",
    command: String(value.command),
    args,
  };
}

function secretPresenceFor(value: Record<string, unknown>): McpSecretPresence {
  const args = Array.isArray(value.args)
    ? value.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  return {
    environment: hasContent(value.env),
    headers: hasContent(value.headers),
    oauth: hasContent(value.oauth),
    providerAuth: hasContent(value.auth),
    credentialLikeArguments: hasCredentialLikeArgument(args),
    unknownFields: Object.entries(value).some(
      ([key, entry]) => !KNOWN_SERVER_FIELDS.has(key) && hasContent(entry),
    ),
  };
}

function hasCredentialLikeArgument(args: readonly string[]): boolean {
  return redactArgs(args).some((arg, index) => arg !== args[index] || SECRET_NAME.test(arg));
}

function hasContent(value: unknown): boolean {
  return (
    value !== undefined && value !== null && !(isRecord(value) && Object.keys(value).length === 0)
  );
}

/** Mask credentials in stdio arguments while leaving the file itself unchanged. */
function redactArgs(args: readonly string[]): string[] {
  const redacted: string[] = [];
  let maskNext = false;
  for (const arg of args) {
    if (maskNext && !arg.startsWith("--")) {
      redacted.push(MASK);
      maskNext = false;
      continue;
    }
    maskNext = false;
    if (HTTP_URL.test(arg)) {
      redacted.push(redactUrl(arg));
      continue;
    }
    const pair = /^([^=:\s]+)(=|:\s*)/.exec(arg);
    if (pair) {
      const value = arg.slice(pair[0].length);
      redacted.push(
        SECRET_NAME.test(pair[1]!)
          ? `${pair[1]}${pair[2]}${MASK}`
          : HTTP_URL.test(value)
            ? `${pair[1]}${pair[2]}${redactUrl(value)}`
            : arg,
      );
      continue;
    }
    redacted.push(arg);
    maskNext = arg.startsWith("-") && SECRET_NAME.test(arg);
  }
  return redacted;
}

function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "(invalid URL)";
  }
  const hasUserInfo = parsed.username !== "" || parsed.password !== "";
  const hasQuery = parsed.search !== "" || parsed.hash !== "";
  if (!hasUserInfo && !hasQuery) return url;
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return hasQuery ? `${parsed.toString()}?…` : parsed.toString();
}

function safeName(value: string): string {
  return isValidMcpServerName(value) ? value : "invalid";
}

function safeErrorMessage(path: string, error: unknown): string {
  if (error instanceof McpConfigError) return error.message;
  return `${path}: MCP configuration could not be read`;
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}
