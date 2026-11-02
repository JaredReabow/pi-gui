import type {
  RuntimeSettingsSnapshot,
  RuntimeModelRecord,
} from "@pi-gui/session-driver/runtime-types";

/** Browser-safe requests and host-authored child configuration; never runtime/auth objects. */
export type ChildThinkingLevel = NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>;

/** Provider and model are an atomic identity. Availability is resolved by the runtime owner. */
export interface ChildModelSelection {
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel?: ChildThinkingLevel;
}

export interface ChildOriginMetadata {
  readonly kind: "child-thread";
  readonly source: "desktop-host";
  readonly parentWorkspaceId: string;
  readonly parentSessionId: string;
  readonly sourceToolCallId?: string;
}

/** Actual driver-selected configuration, not the caller's requested selection. */
export interface ChildSelectedConfiguration {
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
}

/** Narrow projection of existing runtime-owner decisions; absent availability means unknown. */
export interface EffectiveChildModelSettings {
  readonly policySource: "app-global" | "per-repo";
  readonly defaultProvider?: string;
  readonly defaultModelId?: string;
  readonly defaultThinkingLevel?: ChildThinkingLevel;
  readonly models: readonly {
    readonly provider: string;
    readonly modelId: string;
    readonly label?: string;
    readonly available: boolean;
    readonly reasoning: boolean;
    readonly scope: RuntimeModelRecord["scope"];
  }[];
}

export function childSelection_isThinkingLevel(value: unknown): value is ChildThinkingLevel {
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value as string);
}

/** Strict request validation intentionally excludes host-authored origin/availability fields. */
export function childSelection_decode(value: unknown): ChildModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid child model selection");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["provider", "modelId", "thinkingLevel"].includes(key)) ||
    typeof record.provider !== "string" ||
    !record.provider.trim() ||
    typeof record.modelId !== "string" ||
    !record.modelId.trim() ||
    (record.thinkingLevel !== undefined && !childSelection_isThinkingLevel(record.thinkingLevel))
  )
    throw new Error("Invalid child model selection");
  return {
    provider: record.provider,
    modelId: record.modelId,
    ...(record.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: record.thinkingLevel as ChildThinkingLevel }),
  };
}

/** Storage accepts only the host projection, retaining malformed source files on failure. */
export function childSelection_decodeOrigin(value: unknown): ChildOriginMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid child origin");
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).some(
      (k) =>
        !["kind", "source", "parentWorkspaceId", "parentSessionId", "sourceToolCallId"].includes(k),
    ) ||
    r.kind !== "child-thread" ||
    r.source !== "desktop-host" ||
    typeof r.parentWorkspaceId !== "string" ||
    !r.parentWorkspaceId.trim() ||
    typeof r.parentSessionId !== "string" ||
    !r.parentSessionId.trim() ||
    (r.sourceToolCallId !== undefined &&
      (typeof r.sourceToolCallId !== "string" || !r.sourceToolCallId.trim()))
  )
    throw new Error("Invalid child origin");
  return {
    kind: "child-thread",
    source: "desktop-host",
    parentWorkspaceId: r.parentWorkspaceId,
    parentSessionId: r.parentSessionId,
    ...(r.sourceToolCallId === undefined ? {} : { sourceToolCallId: r.sourceToolCallId as string }),
  };
}
export function childSelection_decodeSelectedConfig(value: unknown): ChildSelectedConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid child configuration");
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).some((k) => !["provider", "modelId", "thinkingLevel"].includes(k)) ||
    Object.values(r).some((v) => v !== undefined && typeof v !== "string")
  )
    throw new Error("Invalid child configuration");
  return {
    ...(r.provider === undefined ? {} : { provider: r.provider as string }),
    ...(r.modelId === undefined ? {} : { modelId: r.modelId as string }),
    ...(r.thinkingLevel === undefined ? {} : { thinkingLevel: r.thinkingLevel as string }),
  };
}

/** Identity of the host creation route, never a model-supplied claim or a tool-call inference. */
export interface SessionInitiatingOrigin {
  readonly kind: "human" | "tool" | "scheduled";
  readonly source: "desktop-host";
}
export type SessionInitiatingKind = SessionInitiatingOrigin["kind"] | "unknown";

/** Missing legacy/imported identity is unknown, regardless of correlation IDs or timestamps. */
export function childSelection_initiatingKind(
  origin: SessionInitiatingOrigin | undefined,
): SessionInitiatingKind {
  return origin?.kind ?? "unknown";
}

/** Strict storage projection: it cannot carry credentials, runtime objects or caller metadata. */
export function childSelection_decodeInitiatingOrigin(value: unknown): SessionInitiatingOrigin {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid session initiating origin");
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).some((key) => key !== "kind" && key !== "source") ||
    r.source !== "desktop-host" ||
    (r.kind !== "human" && r.kind !== "tool" && r.kind !== "scheduled")
  )
    throw new Error("Invalid session initiating origin");
  return { kind: r.kind, source: "desktop-host" };
}

/** Tool requests may not supply host-authored provenance, even when called without schema validation. */
export function childSelection_rejectOriginInput(value: unknown): void {
  if (
    value &&
    typeof value === "object" &&
    ["origin", "initiatingOrigin", "initiatingOriginBySession"].some((key) =>
      Object.hasOwn(value, key),
    )
  )
    throw new Error("Session initiating origin is host-authored and cannot be supplied by a tool");
}
