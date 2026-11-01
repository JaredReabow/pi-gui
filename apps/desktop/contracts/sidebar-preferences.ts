/** Additive preferences. Absence preserves the existing sidebar treatment. */
export type FolderPreference = "open" | "partial" | "closed";
export type AllThreadsSort =
  "activity" | "latest-human-input" | "unread-first" | "created" | "title";
/** Authoritative backend batch bound; renderer callers import this when chunking explicit targets. */
export const sidebarPreferences_markReadLimit = 500;
export const sidebarPreferences_activityStyles = Object.freeze([
  "moonwalk",
  "stick",
  "wheel",
  "ball",
  "wave",
  "spiral",
] as const);
export const sidebarPreferences_defaultActivityStyle = "moonwalk";

export type ActivityIndicatorStyle = (typeof sidebarPreferences_activityStyles)[number];
export type ActivityIndicatorPreferenceSource = "provisional" | "user" | "legacy-migrated";
export type PersistedActivityIndicatorPreferenceSource = Exclude<
  ActivityIndicatorPreferenceSource,
  "provisional"
>;

export interface ActivityIndicatorPreferenceSnapshot {
  readonly style: ActivityIndicatorStyle;
  readonly source: ActivityIndicatorPreferenceSource;
}

export interface PersistedActivityIndicatorPreference {
  readonly style: ActivityIndicatorStyle;
  readonly source: PersistedActivityIndicatorPreferenceSource;
}

export type LegacyActivityMigrationDecision =
  | {
      readonly status: "applied";
      readonly preference: PersistedActivityIndicatorPreference;
    }
  | {
      readonly status: "already-set";
      readonly preference: PersistedActivityIndicatorPreference;
    }
  | {
      readonly status: "no-legacy";
      readonly preference: undefined;
    };

export interface MarkAllThreadsReadInput {
  /** Explicit snapshot of the rows to mark; never expands to future/new threads. */
  readonly targets: readonly { readonly workspaceId: string; readonly sessionId: string }[];
}

export const sidebarPreferences_provisionalActivityPreference: ActivityIndicatorPreferenceSnapshot =
  Object.freeze({
    style: sidebarPreferences_defaultActivityStyle,
    source: "provisional",
  });

type ActivityDataProperties = ReadonlyMap<string, unknown>;

/** Read exact data fields without invoking caller-defined accessors. */
function sidebarPreferences_activityDataProperties(
  value: unknown,
  label: string,
): ActivityDataProperties {
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

function sidebarPreferences_rejectUnknownActivityFields(
  properties: ActivityDataProperties,
  allowed: readonly string[],
  label: string,
): void {
  if (
    properties.size !== allowed.length ||
    [...properties.keys()].some((key) => !allowed.includes(key))
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

export function sidebarPreferences_isFolder(value: unknown): value is FolderPreference {
  return value === "open" || value === "partial" || value === "closed";
}
export function sidebarPreferences_isSort(value: unknown): value is AllThreadsSort {
  return (
    value === "activity" ||
    value === "latest-human-input" ||
    value === "unread-first" ||
    value === "created" ||
    value === "title"
  );
}
export function sidebarPreferences_decodeFolder(value: unknown): FolderPreference {
  if (!sidebarPreferences_isFolder(value)) throw new Error("Invalid folder preference");
  return value;
}
export function sidebarPreferences_decodeSort(value: unknown): AllThreadsSort {
  if (!sidebarPreferences_isSort(value)) throw new Error("Invalid All Threads sort");
  return value;
}

export function sidebarPreferences_decodeActivityStyle(value: unknown): ActivityIndicatorStyle {
  switch (value) {
    case "moonwalk":
    case "stick":
    case "wheel":
    case "ball":
    case "wave":
    case "spiral":
      return value;
    default:
      throw new Error("Invalid activity indicator style");
  }
}

export function sidebarPreferences_decodeActivityPreferenceSource(
  value: unknown,
): ActivityIndicatorPreferenceSource {
  switch (value) {
    case "provisional":
    case "user":
    case "legacy-migrated":
      return value;
    default:
      throw new Error("Invalid activity indicator preference source");
  }
}

export function sidebarPreferences_decodePersistedActivitySource(
  value: unknown,
): PersistedActivityIndicatorPreferenceSource {
  switch (value) {
    case "user":
    case "legacy-migrated":
      return value;
    default:
      throw new Error("Invalid persisted activity indicator preference source");
  }
}

/** Decode the exact durable activity object; provisional is renderer-derived only. */
export function sidebarPreferences_decodeDurableActivityPreference(
  value: unknown,
): PersistedActivityIndicatorPreference {
  const properties = sidebarPreferences_activityDataProperties(
    value,
    "persisted activity indicator preference",
  );
  sidebarPreferences_rejectUnknownActivityFields(
    properties,
    ["style", "source"],
    "persisted activity indicator preference",
  );
  return Object.freeze({
    style: sidebarPreferences_decodeActivityStyle(properties.get("style")),
    source: sidebarPreferences_decodePersistedActivitySource(properties.get("source")),
  });
}

/** Decode the presentation snapshot, including renderer-only provisional state. */
export function sidebarPreferences_decodeActivityPreferenceSnapshot(
  value: unknown,
): ActivityIndicatorPreferenceSnapshot {
  const properties = sidebarPreferences_activityDataProperties(
    value,
    "activity indicator preference snapshot",
  );
  sidebarPreferences_rejectUnknownActivityFields(
    properties,
    ["style", "source"],
    "activity indicator preference snapshot",
  );
  const style = sidebarPreferences_decodeActivityStyle(properties.get("style"));
  const source = sidebarPreferences_decodeActivityPreferenceSource(properties.get("source"));
  if (source === "provisional" && style !== sidebarPreferences_defaultActivityStyle) {
    throw new Error("Provisional activity indicator preference must be moonwalk");
  }
  return Object.freeze({
    style,
    source,
  });
}

/** Only the six exact legacy values are meaningful; absence and malformed input are no-legacy. */
export function sidebarPreferences_decodeLegacyActivityStyle(
  value: unknown,
): ActivityIndicatorStyle | undefined {
  switch (value) {
    case "moonwalk":
    case "stick":
    case "wheel":
    case "ball":
    case "wave":
    case "spiral":
      return value;
    default:
      return undefined;
  }
}

/**
 * Decide a migration from already-decoded durable state without performing I/O.
 * A durable preference wins before the legacy value is inspected.
 */
export function sidebarPreferences_decideLegacyActivityMigration(
  durablePreference: PersistedActivityIndicatorPreference | undefined,
  legacyValue: unknown,
): LegacyActivityMigrationDecision {
  if (durablePreference !== undefined) {
    return Object.freeze({
      status: "already-set",
      preference: durablePreference,
    });
  }

  const style = sidebarPreferences_decodeLegacyActivityStyle(legacyValue);
  if (style === undefined) {
    return Object.freeze({
      status: "no-legacy",
      preference: undefined,
    });
  }

  return Object.freeze({
    status: "applied",
    preference: Object.freeze({
      style,
      source: "legacy-migrated",
    }),
  });
}

/** Validate the complete batch before mutation; rejecting unknown fields prevents scope confusion. */
export function sidebarPreferences_decodeMarkRead(value: unknown): MarkAllThreadsReadInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid read targets");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "targets") ||
    !Array.isArray(record.targets) ||
    record.targets.length > sidebarPreferences_markReadLimit
  ) {
    throw new Error("Invalid read targets");
  }
  const targets = record.targets.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid read target");
    const target = value as Record<string, unknown>;
    if (
      Object.keys(target).some((key) => key !== "workspaceId" && key !== "sessionId") ||
      typeof target.workspaceId !== "string" ||
      !target.workspaceId.trim() ||
      typeof target.sessionId !== "string" ||
      !target.sessionId.trim()
    )
      throw new Error("Invalid read target");
    return { workspaceId: target.workspaceId, sessionId: target.sessionId };
  });
  return { targets };
}
