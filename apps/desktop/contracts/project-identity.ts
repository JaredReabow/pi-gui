import { resolveRepoWorkspaceId } from "./workspace-roots";

export const projectIdentity_presetColors = Object.freeze([
  "#5b8def",
  "#18a999",
  "#43a047",
  "#e0a100",
  "#e8752f",
  "#d84f72",
  "#8c6bd8",
  "#6d7f96",
] as const);

export const projectIdentity_maxAccentEntries = 4096;
export const projectIdentity_maxWorkspaceIdLength = 8192;

export type ProjectAccentColor = `#${string}`;

export interface ProjectAppearanceProjection {
  readonly projectId: string;
  readonly accentColor: ProjectAccentColor;
}

export interface SetProjectAccentColorInput {
  readonly workspaceId: string;
  readonly color: string;
}

export interface ProjectIdentityWorkspace {
  readonly id: string;
  readonly path: string;
  readonly rootWorkspaceId?: string;
}

type DataProperties = ReadonlyMap<string, unknown>;

function projectIdentity_dataProperties(value: unknown, label: string): DataProperties {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Invalid ${label}`);
  }

  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new Error(`Invalid ${label}`);
  }

  const properties = new Map<string, unknown>();
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new Error(`${label} fields must be enumerable data properties`);
    }
    properties.set(key, descriptor.value);
  }
  return properties;
}

function projectIdentity_rejectUnknownFields(
  properties: DataProperties,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of properties.keys()) {
    if (!allowed.includes(key)) {
      throw new Error(`Invalid ${label}`);
    }
  }
}

function projectIdentity_workspaceId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > projectIdentity_maxWorkspaceIdLength ||
    value.includes("\0")
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function projectIdentity_decodeColor(value: unknown): ProjectAccentColor {
  if (typeof value !== "string") {
    throw new Error("Invalid project colour");
  }
  const normalized = value.trim().toLowerCase();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(normalized);
  if (!match) {
    throw new Error("Invalid project colour");
  }
  const digits = match[1];
  if (!digits) {
    throw new Error("Invalid project colour");
  }
  return `#${digits.length === 3 ? [...digits].map((digit) => digit.repeat(2)).join("") : digits}`;
}

export function projectIdentity_decodeSetAccent(value: unknown): SetProjectAccentColorInput {
  const properties = projectIdentity_dataProperties(value, "project colour request");
  projectIdentity_rejectUnknownFields(
    properties,
    ["workspaceId", "color"],
    "project colour request",
  );
  if (properties.size !== 2) {
    throw new Error("Invalid project colour request");
  }
  return Object.freeze({
    workspaceId: projectIdentity_workspaceId(properties.get("workspaceId"), "workspace id"),
    color: projectIdentity_decodeColor(properties.get("color")),
  });
}

/** Decode saved assignments without evaluating accessors or inheriting prototypes. */
export function projectIdentity_decodeAccentColors(
  value: unknown,
): Readonly<Record<string, ProjectAccentColor>> {
  const properties = projectIdentity_dataProperties(value, "project colour map");
  if (properties.size > projectIdentity_maxAccentEntries) {
    throw new Error("Project colour map is too large");
  }

  const colors: Record<string, ProjectAccentColor> = Object.create(null);
  for (const [projectId, color] of properties) {
    projectIdentity_workspaceId(projectId, "project id");
    colors[projectId] = projectIdentity_decodeColor(color);
  }
  return Object.freeze(colors);
}

function projectIdentity_decodeWorkspaces(
  value: readonly ProjectIdentityWorkspace[],
): readonly ProjectIdentityWorkspace[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid workspace list");
  }

  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error("Invalid workspace list");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new Error("Invalid workspace list");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number"
  ) {
    throw new Error("Invalid workspace list");
  }
  const length = lengthDescriptor.value;
  if (length > projectIdentity_maxAccentEntries) {
    throw new Error("Workspace list is too large");
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "length") {
      continue;
    }
    const index = Number(key);
    if (!/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(index) || index >= length) {
      throw new Error("Invalid workspace list");
    }
  }

  const ids = new Set<string>();
  const workspaces: ProjectIdentityWorkspace[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("Workspace list fields must be data properties");
    }
    const properties = projectIdentity_dataProperties(descriptor.value, "workspace identity");
    projectIdentity_rejectUnknownFields(
      properties,
      ["id", "path", "rootWorkspaceId"],
      "workspace identity",
    );
    const id = projectIdentity_workspaceId(properties.get("id"), "workspace id");
    if (ids.has(id)) {
      throw new Error("Duplicate workspace id");
    }
    ids.add(id);
    const path = projectIdentity_workspaceId(properties.get("path"), "workspace path");
    const rootWorkspaceId =
      properties.get("rootWorkspaceId") === undefined
        ? undefined
        : projectIdentity_workspaceId(properties.get("rootWorkspaceId"), "root workspace id");
    workspaces.push(
      Object.freeze({
        id,
        path,
        ...(rootWorkspaceId === undefined ? {} : { rootWorkspaceId }),
      }),
    );
  }
  return Object.freeze(workspaces);
}

function projectIdentity_hash(value: string): number {
  let hash = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      throw new Error("Invalid project id");
    }
    hash = (hash * 31 + codePoint) >>> 0;
  }
  return hash;
}

function projectIdentity_generatedColor(hash: number): ProjectAccentColor {
  const value = hash & 0xffffff;
  return `#${value.toString(16).padStart(6, "0")}`;
}

/** Return a stable display fallback for old or incomplete state snapshots. */
export function projectIdentity_fallbackAccent(projectId: string): ProjectAccentColor {
  const normalized = projectIdentity_workspaceId(projectId, "project id");
  const color =
    projectIdentity_presetColors[
      projectIdentity_hash(normalized) % projectIdentity_presetColors.length
    ];
  if (!color) {
    throw new Error("Missing project preset");
  }
  return color;
}

/** Choose black or white text with the higher WCAG contrast against a project colour. */
export function projectIdentity_accentInk(color: ProjectAccentColor): "#111318" | "#ffffff" {
  const normalized = projectIdentity_decodeColor(color);
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  return luminance > 0.179 ? "#111318" : "#ffffff";
}

function projectIdentity_randomColor(
  random: () => number,
  used: ReadonlySet<string>,
  fallbackHash: number,
): ProjectAccentColor {
  const available = projectIdentity_presetColors.filter((candidate) => !used.has(candidate));
  if (available.length > 0) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error("Project colour random source must return [0, 1)");
    }
    const selected = available[Math.floor(sample * available.length)];
    if (selected) return selected;
    throw new Error("Missing available project preset");
  }

  let candidate = fallbackHash & 0xffffff;
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error("Project colour random source must return [0, 1)");
    }
    candidate = (Math.floor(sample * 0x1000000) + attempt * 0x9e3779) & 0xffffff;
    const color: ProjectAccentColor = `#${candidate.toString(16).padStart(6, "0")}`;
    if (!used.has(color)) return color;
  }
  throw new Error("Unable to choose a unique project colour");
}

/**
 * Add defaults only for owners that have no saved assignment. Supplying a
 * random source makes new-project assignment random while callers that omit it
 * retain the historical deterministic projection used by compatibility tests.
 */
export function projectIdentity_assignMissingAccents(
  saved: Readonly<Record<string, ProjectAccentColor>>,
  workspaces: readonly ProjectIdentityWorkspace[],
  random?: () => number,
): Readonly<Record<string, ProjectAccentColor>> {
  const decodedSaved = projectIdentity_decodeAccentColors(saved);
  const decodedWorkspaces = projectIdentity_decodeWorkspaces(workspaces);
  const owners = [
    ...new Set(
      decodedWorkspaces.map(
        (workspace) => resolveRepoWorkspaceId(decodedWorkspaces, workspace.id) ?? workspace.id,
      ),
    ),
  ].sort();

  const missing = owners.filter((owner) => !Object.hasOwn(decodedSaved, owner));
  if (Object.keys(decodedSaved).length + missing.length > projectIdentity_maxAccentEntries) {
    throw new Error("Project colour map is too large");
  }
  if (missing.length === 0) {
    return decodedSaved;
  }

  const next: Record<string, ProjectAccentColor> = Object.create(null);
  for (const [projectId, color] of Object.entries(decodedSaved)) {
    next[projectId] = color;
  }

  const used = new Set<string>(Object.values(decodedSaved));
  for (const owner of missing) {
    const hash = projectIdentity_hash(owner);
    const color =
      random === undefined
        ? projectIdentity_deterministicColor(hash, used)
        : projectIdentity_randomColor(random, used, hash);
    next[owner] = color;
    used.add(color);
  }
  return Object.freeze(next);
}

function projectIdentity_deterministicColor(
  hash: number,
  used: ReadonlySet<string>,
): ProjectAccentColor {
  const presetIndex = hash % projectIdentity_presetColors.length;
  let color: ProjectAccentColor | undefined = projectIdentity_presetColors[presetIndex];
  if (!color) {
    throw new Error("Missing project preset");
  }
  if (used.has(color)) {
    color =
      projectIdentity_presetColors.find((candidate) => !used.has(candidate)) ??
      projectIdentity_generatedColor(hash);
    if (used.has(color)) {
      let candidate = hash & 0xffffff;
      do {
        candidate = (candidate + 0x9e3779) & 0xffffff;
        color = `#${candidate.toString(16).padStart(6, "0")}`;
      } while (used.has(color));
    }
  }
  return color;
}

/** Project saved owner assignments onto every current primary and linked workspace. */
export function projectIdentity_effectiveByWorkspace(
  accentsByProjectId: Readonly<Record<string, ProjectAccentColor>>,
  workspaces: readonly ProjectIdentityWorkspace[],
): Readonly<Record<string, ProjectAppearanceProjection>> {
  const decodedAccents = projectIdentity_decodeAccentColors(accentsByProjectId);
  const decodedWorkspaces = projectIdentity_decodeWorkspaces(workspaces);
  const projections: Record<string, ProjectAppearanceProjection> = Object.create(null);

  for (const workspace of decodedWorkspaces) {
    const projectId = resolveRepoWorkspaceId(decodedWorkspaces, workspace.id) ?? workspace.id;
    const accentColor = decodedAccents[projectId];
    if (!accentColor) {
      throw new Error(`Missing project colour for ${projectId}`);
    }
    projections[workspace.id] = Object.freeze({
      projectId,
      accentColor,
    });
  }
  return Object.freeze(projections);
}
