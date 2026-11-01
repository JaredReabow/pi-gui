import {
  SUPPORT_AUTOMATIC_POST_USE_SOLICITATION,
  INITIAL_SUPPORT_PROMPT_STATE,
  SUPPORT_OPTION_IDS,
  SUPPORT_OPTIONS,
  type SupportOption,
  type SupportOptionId,
} from "@pi-gui/distribution-support";

export {
  SUPPORT_AUTOMATIC_POST_USE_SOLICITATION,
  SUPPORT_DISMISSAL_LABELS,
  INITIAL_SUPPORT_PROMPT_STATE,
  SUPPORT_OPTION_IDS,
  SUPPORT_OPTIONS,
  supportDismissPrompt,
  supportGetOption,
  supportResolveOptionUrl,
  supportStartPromptSession,
} from "@pi-gui/distribution-support";
export type {
  SupportAmount,
  SupportCadence,
  SupportDismissalChoice,
  SupportOption,
  SupportOptionId,
  SupportPromptState,
  SupportProvider,
} from "@pi-gui/distribution-support";

export const DISTRIBUTION_CONFIG_SCHEMA_VERSION = 1 as const;
export const DISTRIBUTION_SUPPORT_SOURCE = "@pi-gui/distribution-support" as const;

export type DistributionChannel = "candidate" | "published";
export type DistributionPlatform = "macos" | "windows" | "linux";
export type DistributionArchitecture = "arm64" | "x64";

export const UNRESOLVED_PUBLIC_FIELDS = Object.freeze([
  "displayName",
  "appId",
  "packageName",
  "executableName",
  "appName",
  "publisher",
  "maintainer",
  "copyright",
  "repositoryOwner",
  "repositoryName",
  "websiteOrigin",
  "supportUrl",
  "releaseManifestUrl",
] as const);

export type UnresolvedPublicField = (typeof UNRESOLVED_PUBLIC_FIELDS)[number];

export interface DistributionDataPolicy {
  /**
   * Stable identity for local candidate state. This value never includes a
   * commit, branch, or version suffix.
   */
  readonly userDataDirectoryName: string;
  /** Pi's settings, credentials, and sessions stay below the distribution data root. */
  readonly agentDataDirectoryName: string;
  readonly personalDataImport: {
    readonly status: "disabled";
    readonly requiresExplicitUserAction: true;
    readonly sourceSelection: "not-configured";
    readonly destinationDirectoryName: string;
    readonly copyOnly: true;
  };
}

export interface CandidateDistributionIdentity {
  readonly status: "candidate";
  readonly distributionSlug: "pi-gui-candidate";
  readonly displayName: "pi-gui Candidate";
  readonly appId: "com.pi-gui.desktop.candidate";
  readonly packageName: "pi-gui-candidate";
  readonly executableName: "pi-gui-candidate";
  readonly appName: "pi-gui-candidate";
  readonly unresolvedPublicFields: readonly UnresolvedPublicField[];
}

export interface CandidateDistributionProfile {
  readonly schemaVersion: typeof DISTRIBUTION_CONFIG_SCHEMA_VERSION;
  readonly channel: "candidate";
  readonly version: string;
  readonly identity: CandidateDistributionIdentity;
  readonly data: DistributionDataPolicy;
  readonly release: {
    readonly updateChecks: "disabled";
    readonly publication: "disabled";
    readonly releaseManifestUrl: null;
    readonly reason: "distribution-identity-unresolved";
  };
  readonly support: DistributionSupportConfiguration;
}

export interface PublishedDistributionIdentity {
  readonly status: "resolved";
  readonly distributionSlug: string;
  readonly displayName: string;
  readonly appId: string;
  readonly packageName: string;
  readonly executableName: string;
  readonly appName: string;
  readonly publisher: string;
  readonly maintainer: string;
  readonly copyright: string;
  readonly repository: {
    readonly owner: string;
    readonly name: string;
    readonly url: string;
  };
  readonly domains: {
    readonly websiteOrigin: string;
    readonly supportUrl: string;
  };
}

export interface PublishedDistributionProfileInput {
  readonly schemaVersion?: typeof DISTRIBUTION_CONFIG_SCHEMA_VERSION;
  readonly channel: "published";
  readonly version: string;
  readonly identity: PublishedDistributionIdentity;
  readonly data: Pick<DistributionDataPolicy, "userDataDirectoryName" | "agentDataDirectoryName">;
  readonly release: {
    readonly updateChecks: "enabled";
    readonly releaseManifestUrl: string;
    readonly publicationAuthorization:
      | { readonly status: "not-authorized" }
      | { readonly status: "authorized"; readonly reference: string };
  };
}

export interface PublishedDistributionProfile {
  readonly schemaVersion: typeof DISTRIBUTION_CONFIG_SCHEMA_VERSION;
  readonly channel: "published";
  readonly version: string;
  readonly identity: PublishedDistributionIdentity;
  readonly data: DistributionDataPolicy;
  readonly release: {
    readonly updateChecks: "enabled";
    readonly publication:
      | { readonly status: "not-authorized" }
      | { readonly status: "authorized"; readonly reference: string };
    readonly releaseManifestUrl: string;
  };
  readonly support: DistributionSupportConfiguration;
}

export type DistributionProfile = CandidateDistributionProfile | PublishedDistributionProfile;

export interface DistributionSupportConfiguration {
  readonly sourcePackage: typeof DISTRIBUTION_SUPPORT_SOURCE;
  readonly optionIds: readonly SupportOptionId[];
  readonly options: readonly SupportOption[];
  readonly automaticPostUseSolicitation: false;
  readonly promptState: typeof INITIAL_SUPPORT_PROMPT_STATE;
  readonly uiOwner: "D12/D14";
}

const supportConfiguration: DistributionSupportConfiguration = Object.freeze({
  sourcePackage: DISTRIBUTION_SUPPORT_SOURCE,
  optionIds: SUPPORT_OPTION_IDS,
  options: SUPPORT_OPTIONS,
  automaticPostUseSolicitation: SUPPORT_AUTOMATIC_POST_USE_SOLICITATION,
  promptState: INITIAL_SUPPORT_PROMPT_STATE,
  uiOwner: "D12/D14",
});

export function distributionGetSupportConfiguration(): DistributionSupportConfiguration {
  return supportConfiguration;
}

const candidateDataPolicy: DistributionDataPolicy = Object.freeze({
  userDataDirectoryName: "pi-gui-candidate",
  agentDataDirectoryName: "agent",
  personalDataImport: Object.freeze({
    status: "disabled",
    requiresExplicitUserAction: true,
    sourceSelection: "not-configured",
    destinationDirectoryName: "agent",
    copyOnly: true,
  }),
});

/**
 * The only profile a checkout can run without an owner-supplied publication
 * identity. Its name is stable so candidate sessions do not multiply per commit.
 */
export function distributionCreateCandidateProfile(version: string): CandidateDistributionProfile {
  const normalizedVersion = validateVersion(version, "candidate version");
  return deepFreeze({
    schemaVersion: DISTRIBUTION_CONFIG_SCHEMA_VERSION,
    channel: "candidate",
    version: normalizedVersion,
    identity: {
      status: "candidate",
      distributionSlug: "pi-gui-candidate",
      displayName: "pi-gui Candidate",
      appId: "com.pi-gui.desktop.candidate",
      packageName: "pi-gui-candidate",
      executableName: "pi-gui-candidate",
      appName: "pi-gui-candidate",
      unresolvedPublicFields: UNRESOLVED_PUBLIC_FIELDS,
    },
    data: candidateDataPolicy,
    release: {
      updateChecks: "disabled",
      publication: "disabled",
      releaseManifestUrl: null,
      reason: "distribution-identity-unresolved",
    },
    support: supportConfiguration,
  });
}

/**
 * Construct a published profile only after every product, repository, domain,
 * and update-feed field is supplied by the owner. The upstream author's
 * repository is rejected so a local candidate cannot drift back onto its feed.
 */
export function distributionCreatePublishedProfile(
  input: PublishedDistributionProfileInput,
): PublishedDistributionProfile {
  if (input.channel !== "published") {
    throw new TypeError("Published distribution profile must use the published channel");
  }
  if (
    input.schemaVersion !== undefined &&
    input.schemaVersion !== DISTRIBUTION_CONFIG_SCHEMA_VERSION
  ) {
    throw new TypeError("Unsupported distribution configuration schema");
  }

  const version = validateVersion(input.version, "published version");
  const identity = input.identity;
  for (const [label, value] of [
    ["distributionSlug", identity.distributionSlug],
    ["displayName", identity.displayName],
    ["appId", identity.appId],
    ["packageName", identity.packageName],
    ["executableName", identity.executableName],
    ["appName", identity.appName],
    ["publisher", identity.publisher],
    ["maintainer", identity.maintainer],
    ["copyright", identity.copyright],
    ["repository owner", identity.repository.owner],
    ["repository name", identity.repository.name],
  ] as const) {
    validateNonEmpty(value, label);
  }

  const repositoryUrl = validateHttpsUrl(identity.repository.url, "repository URL");
  const websiteOrigin = validateHttpsUrl(identity.domains.websiteOrigin, "website origin");
  if (websiteOrigin.pathname !== "/" || websiteOrigin.search || websiteOrigin.hash) {
    throw new TypeError("Website origin must be an HTTPS origin without a path");
  }
  const supportUrl = validateHttpsUrl(identity.domains.supportUrl, "support URL");
  const manifestUrl = validateHttpsUrl(input.release.releaseManifestUrl, "release manifest URL");
  assertNotUpstreamRepository(identity.repository.owner, identity.repository.name);
  assertNotUpstreamUrl(repositoryUrl);
  assertNotUpstreamUrl(manifestUrl);

  if (input.release.updateChecks !== "enabled") {
    throw new TypeError("Published distribution profiles must enable update checks");
  }

  const publication = input.release.publicationAuthorization;
  if (publication.status === "authorized") {
    validateNonEmpty(publication.reference, "publication authorization reference");
  } else if (publication.status !== "not-authorized") {
    throw new TypeError("Publication authorization status is invalid");
  }

  const userDataDirectoryName = validateDirectoryName(
    input.data.userDataDirectoryName,
    "user data directory",
  );
  const agentDataDirectoryName = validateDirectoryName(
    input.data.agentDataDirectoryName,
    "agent data directory",
  );
  if (userDataDirectoryName === "pi" || agentDataDirectoryName === ".pi") {
    throw new TypeError("Published profile must not reuse the global Pi data identity");
  }

  return deepFreeze({
    schemaVersion: DISTRIBUTION_CONFIG_SCHEMA_VERSION,
    channel: "published",
    version,
    identity: {
      status: "resolved",
      distributionSlug: identity.distributionSlug,
      displayName: identity.displayName,
      appId: identity.appId,
      packageName: identity.packageName,
      executableName: identity.executableName,
      appName: identity.appName,
      publisher: identity.publisher,
      maintainer: identity.maintainer,
      copyright: identity.copyright,
      repository: Object.freeze({
        owner: identity.repository.owner,
        name: identity.repository.name,
        url: repositoryUrl.href,
      }),
      domains: Object.freeze({
        websiteOrigin: websiteOrigin.origin,
        supportUrl: supportUrl.href,
      }),
    },
    data: {
      userDataDirectoryName,
      agentDataDirectoryName,
      personalDataImport: Object.freeze({
        status: "disabled",
        requiresExplicitUserAction: true,
        sourceSelection: "not-configured",
        destinationDirectoryName: agentDataDirectoryName,
        copyOnly: true,
      }),
    },
    release: {
      updateChecks: "enabled",
      publication:
        publication.status === "authorized"
          ? Object.freeze({
              status: "authorized",
              reference: publication.reference,
            })
          : Object.freeze({ status: "not-authorized" }),
      releaseManifestUrl: manifestUrl.href,
    },
    support: supportConfiguration,
  });
}

export interface ReleaseArtifact {
  readonly url: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export type RollbackMetadata =
  | {
      readonly kind: "previous-release";
      readonly previousVersion: string;
      readonly previousManifestUrl: string;
      readonly previousArtifactSha256: string;
    }
  | {
      readonly kind: "first-release";
      readonly reason: "no-earlier-public-release";
    }
  | {
      readonly kind: "not-applicable";
      readonly reason: "candidate-not-published";
    };

interface ReleaseManifestBase {
  readonly schemaVersion: typeof DISTRIBUTION_CONFIG_SCHEMA_VERSION;
  readonly version: string;
  readonly platform: DistributionPlatform;
  readonly architecture: DistributionArchitecture;
  readonly minimumOs: string;
}

export interface CandidateReleaseManifest extends ReleaseManifestBase {
  readonly channel: "candidate";
  readonly productSlug: "pi-gui-candidate";
  readonly repository: null;
  readonly websiteOrigin: null;
  readonly artifact: null;
  readonly releaseNotesUrl: null;
  readonly rollback: Extract<RollbackMetadata, { kind: "not-applicable" }>;
}

export interface PublishedReleaseManifest extends ReleaseManifestBase {
  readonly channel: "published";
  readonly productSlug: string;
  readonly repository: {
    readonly owner: string;
    readonly name: string;
  };
  readonly websiteOrigin: string;
  readonly artifact: ReleaseArtifact;
  readonly releaseNotesUrl: string;
  readonly rollback: Exclude<RollbackMetadata, { kind: "not-applicable" }>;
}

export type DistributionReleaseManifest = CandidateReleaseManifest | PublishedReleaseManifest;

export function distributionCreateCandidateReleaseManifest(input: {
  readonly version: string;
  readonly platform: DistributionPlatform;
  readonly architecture: DistributionArchitecture;
  readonly minimumOs: string;
}): CandidateReleaseManifest {
  return deepFreeze({
    schemaVersion: DISTRIBUTION_CONFIG_SCHEMA_VERSION,
    channel: "candidate",
    productSlug: "pi-gui-candidate",
    version: validateVersion(input.version, "candidate manifest version"),
    platform: validatePlatform(input.platform),
    architecture: validateArchitecture(input.architecture),
    minimumOs: validateMinimumOs(input.minimumOs),
    repository: null,
    websiteOrigin: null,
    artifact: null,
    releaseNotesUrl: null,
    rollback: {
      kind: "not-applicable",
      reason: "candidate-not-published",
    },
  });
}

export function distributionValidateReleaseManifest(raw: unknown): DistributionReleaseManifest {
  const record = expectRecord(raw, "release manifest");
  if (record.schemaVersion !== DISTRIBUTION_CONFIG_SCHEMA_VERSION) {
    throw new TypeError("Unsupported release manifest schema");
  }

  const channel = record.channel;
  if (channel !== "candidate" && channel !== "published") {
    throw new TypeError("Release manifest channel must be candidate or published");
  }
  const version = validateVersion(record.version, "release version");
  const platform = validatePlatform(record.platform);
  const architecture = validateArchitecture(record.architecture);
  const minimumOs = validateMinimumOs(record.minimumOs);

  if (channel === "candidate") {
    const productSlug = validateNonEmpty(record.productSlug, "candidate product slug");
    if (productSlug !== "pi-gui-candidate") {
      throw new TypeError("Candidate release manifest must use the candidate product slug");
    }
    if (
      record.repository !== null ||
      record.websiteOrigin !== null ||
      record.artifact !== null ||
      record.releaseNotesUrl !== null
    ) {
      throw new TypeError("Candidate release manifests cannot contain public release targets");
    }
    const rollback = expectRecord(record.rollback, "candidate rollback metadata");
    if (rollback.kind !== "not-applicable" || rollback.reason !== "candidate-not-published") {
      throw new TypeError("Candidate rollback metadata must mark publication as not applicable");
    }
    return deepFreeze({
      schemaVersion: DISTRIBUTION_CONFIG_SCHEMA_VERSION,
      channel,
      productSlug,
      version,
      platform,
      architecture,
      minimumOs,
      repository: null,
      websiteOrigin: null,
      artifact: null,
      releaseNotesUrl: null,
      rollback: {
        kind: "not-applicable",
        reason: "candidate-not-published",
      },
    });
  }

  const productSlug = validateNonEmpty(record.productSlug, "published product slug");
  const repository = expectRecord(record.repository, "release repository");
  const repositoryOwner = validateNonEmpty(repository.owner, "repository owner");
  const repositoryName = validateNonEmpty(repository.name, "repository name");
  assertNotUpstreamRepository(repositoryOwner, repositoryName);

  const websiteOrigin = validateHttpsUrl(record.websiteOrigin, "manifest website origin");
  if (websiteOrigin.pathname !== "/" || websiteOrigin.search || websiteOrigin.hash) {
    throw new TypeError("Manifest website origin must be an HTTPS origin without a path");
  }

  const artifact = expectRecord(record.artifact, "release artifact");
  const artifactUrl = validateImmutableArtifactUrl(artifact.url, "release artifact URL", version);
  assertNotUpstreamUrl(artifactUrl);
  const byteSize = artifact.byteSize;
  if (typeof byteSize !== "number" || !Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new TypeError("Release artifact byte size must be a positive safe integer");
  }
  const sha256 = artifact.sha256;
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new TypeError("Release artifact SHA-256 must be 64 lowercase hexadecimal characters");
  }

  const releaseNotesUrl = validateHttpsUrl(record.releaseNotesUrl, "release-note URL");
  assertNotUpstreamUrl(releaseNotesUrl);
  if (releaseNotesUrl.search || releaseNotesUrl.hash) {
    throw new TypeError("Release-note URL must not contain a query or fragment");
  }

  if (!releaseNotesUrl.pathname.split("/").includes(version)) {
    throw new TypeError("Release-note URL must contain the immutable release version path segment");
  }
  const rollback = validateRollback(record.rollback, version);
  for (const url of [
    artifactUrl,
    releaseNotesUrl,
    ...(rollback.kind === "previous-release" ? [new URL(rollback.previousManifestUrl)] : []),
  ]) {
    if (url.origin !== websiteOrigin.origin) {
      throw new TypeError("Release URLs must use the manifest website origin");
    }
  }
  return deepFreeze({
    schemaVersion: DISTRIBUTION_CONFIG_SCHEMA_VERSION,
    channel,
    productSlug,
    version,
    platform,
    architecture,
    minimumOs,
    repository: {
      owner: repositoryOwner,
      name: repositoryName,
    },
    websiteOrigin: websiteOrigin.origin,
    artifact: {
      url: artifactUrl.href,
      byteSize,
      sha256,
    },
    releaseNotesUrl: releaseNotesUrl.href,
    rollback,
  });
}

export interface DistributionGateResult {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

export function distributionEvaluateUpdateGate(
  profile: DistributionProfile,
  manifest: DistributionReleaseManifest,
  runtime: {
    readonly platform: DistributionPlatform;
    readonly architecture: DistributionArchitecture;
  },
): DistributionGateResult {
  const reasons: string[] = [];
  if (profile.channel !== "published") {
    reasons.push("distribution profile is candidate-only");
  }
  if (manifest.channel !== "published") {
    reasons.push("release manifest is candidate-only");
  }
  if (profile.identity.status !== "resolved") {
    reasons.push("public distribution identity is unresolved");
  }
  if (manifest.productSlug !== profile.identity.distributionSlug) {
    reasons.push("release product does not match the distribution profile");
  }
  if (manifest.platform !== runtime.platform || manifest.architecture !== runtime.architecture) {
    reasons.push("release target does not match this runtime");
  }
  if (
    manifest.channel === "published" &&
    profile.channel === "published" &&
    (manifest.repository.owner !== profile.identity.repository.owner ||
      manifest.repository.name !== profile.identity.repository.name)
  ) {
    reasons.push("release repository does not match the distribution profile");
  }
  reasons.push(...distributionOriginReasons(profile, manifest));
  return Object.freeze({
    allowed: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}

export function distributionEvaluatePublicationGate(
  profile: DistributionProfile,
  manifest: DistributionReleaseManifest,
): DistributionGateResult {
  const reasons: string[] = [];
  if (manifest.version !== profile.version) {
    reasons.push("release version does not match the distribution profile");
  }
  if (profile.channel !== "published") reasons.push("candidate profiles are never publishable");
  if (manifest.channel !== "published") reasons.push("candidate manifests are never publishable");
  if (profile.channel === "published" && profile.release.publication.status !== "authorized") {
    reasons.push("publication requires a fresh owner authorization");
  }
  if (
    profile.channel === "published" &&
    manifest.channel === "published" &&
    manifest.productSlug !== profile.identity.distributionSlug
  ) {
    reasons.push("release product does not match the distribution profile");
  }
  if (
    profile.channel === "published" &&
    manifest.channel === "published" &&
    (manifest.repository.owner !== profile.identity.repository.owner ||
      manifest.repository.name !== profile.identity.repository.name)
  ) {
    reasons.push("release repository does not match the distribution profile");
  }
  reasons.push(...distributionOriginReasons(profile, manifest));
  return Object.freeze({
    allowed: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}

/** Apply profile-owned origin policy even when callers bypass the manifest parser. */
function distributionOriginReasons(
  profile: DistributionProfile,
  manifest: DistributionReleaseManifest,
): string[] {
  if (profile.channel !== "published" || manifest.channel !== "published") return [];
  try {
    const validated = distributionValidateReleaseManifest(manifest);
    if (validated.websiteOrigin !== profile.identity.domains.websiteOrigin) {
      return ["release website origin does not match the distribution profile"];
    }
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "release origin policy is invalid"];
  }
}

export function distributionCanCheckForUpdates(profile: DistributionProfile): boolean {
  return profile.channel === "published" && profile.release.updateChecks === "enabled";
}

export function distributionRuntimeTarget(
  platform: string,
  architecture: string,
): {
  readonly platform: DistributionPlatform;
  readonly architecture: DistributionArchitecture;
} {
  const normalizedPlatform =
    platform === "darwin"
      ? "macos"
      : platform === "win32"
        ? "windows"
        : platform === "linux"
          ? "linux"
          : undefined;
  if (!normalizedPlatform) {
    throw new TypeError(`Unsupported distribution platform: ${platform}`);
  }
  const normalizedArchitecture =
    architecture === "arm64" || architecture === "x64" ? architecture : undefined;
  if (!normalizedArchitecture) {
    throw new TypeError(`Unsupported distribution architecture: ${architecture}`);
  }
  return Object.freeze({
    platform: normalizedPlatform,
    architecture: normalizedArchitecture,
  });
}

function validateRollback(
  raw: unknown,
  currentVersion: string,
): Extract<RollbackMetadata, { kind: "previous-release" | "first-release" }> {
  const rollback = expectRecord(raw, "rollback metadata");
  if (rollback.kind === "first-release") {
    if (rollback.reason !== "no-earlier-public-release") {
      throw new TypeError("First-release rollback metadata must state why no rollback exists");
    }
    return {
      kind: "first-release",
      reason: "no-earlier-public-release",
    };
  }
  if (rollback.kind !== "previous-release") {
    throw new TypeError("Published release requires explicit rollback metadata");
  }
  const previousVersion = validateVersion(rollback.previousVersion, "rollback version");
  if (compareSemver(previousVersion, currentVersion) >= 0) {
    throw new TypeError("Rollback version must be older than the release version");
  }
  const previousManifestUrl = validateHttpsUrl(
    rollback.previousManifestUrl,
    "rollback manifest URL",
  );
  assertNotUpstreamUrl(previousManifestUrl);
  if (previousManifestUrl.search || previousManifestUrl.hash) {
    throw new TypeError("Rollback manifest URL must not contain a query or fragment");
  }
  if (
    !previousManifestUrl.pathname.split("/").includes(previousVersion) ||
    !previousManifestUrl.pathname.endsWith("/manifest.json")
  ) {
    throw new TypeError("Rollback manifest URL must name an immutable versioned manifest");
  }
  const previousArtifactSha256 = rollback.previousArtifactSha256;
  if (
    typeof previousArtifactSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(previousArtifactSha256)
  ) {
    throw new TypeError("Rollback artifact SHA-256 is invalid");
  }
  return {
    kind: "previous-release",
    previousVersion,
    previousManifestUrl: previousManifestUrl.href,
    previousArtifactSha256,
  };
}

function validateVersion(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  ) {
    throw new TypeError(`${label} must be a semantic version`);
  }
  return value;
}

function validatePlatform(value: unknown): DistributionPlatform {
  if (value !== "macos" && value !== "windows" && value !== "linux") {
    throw new TypeError("Distribution platform is invalid");
  }
  return value;
}

function validateArchitecture(value: unknown): DistributionArchitecture {
  if (value !== "arm64" && value !== "x64") {
    throw new TypeError("Distribution architecture is invalid");
  }
  return value;
}

function validateMinimumOs(value: unknown): string {
  const minimumOs = validateNonEmpty(value, "minimum OS");
  if (minimumOs.length > 120) throw new TypeError("Minimum OS must be at most 120 characters");
  return minimumOs;
}

function validateDirectoryName(value: unknown, label: string): string {
  const directoryName = validateNonEmpty(value, label);
  if (
    directoryName === "." ||
    directoryName === ".." ||
    directoryName.includes("/") ||
    directoryName.includes("\\")
  ) {
    throw new TypeError(`${label} must be one directory name`);
  }
  return directoryName;
}

function validateNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new TypeError(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function validateHttpsUrl(value: unknown, label: string): URL {
  if (typeof value !== "string") throw new TypeError(`${label} must be an HTTPS URL`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hostname.includes("..")
  ) {
    throw new TypeError(`${label} must be an HTTPS URL without credentials or a custom port`);
  }
  return parsed;
}

function validateImmutableArtifactUrl(value: unknown, label: string, version: string): URL {
  const parsed = validateHttpsUrl(value, label);
  if (parsed.search || parsed.hash) {
    throw new TypeError(`${label} must not contain a query or fragment`);
  }
  const segments = parsed.pathname.split("/");
  if (!segments.includes(version)) {
    throw new TypeError(`${label} must contain the immutable release version path segment`);
  }
  if (
    !/\.(?:dmg|zip|exe|appimage|deb)$/i.test(parsed.pathname) ||
    parsed.pathname.includes("/../") ||
    parsed.pathname.includes("/./")
  ) {
    throw new TypeError(`${label} must name a supported release artifact`);
  }
  return parsed;
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertNotUpstreamRepository(owner: string, name: string): void {
  if (owner.toLowerCase() === "minghinmatthewlam" && name.toLowerCase() === "pi-gui") {
    throw new TypeError("The upstream author's release repository is not a distribution target");
  }
}

function assertNotUpstreamUrl(url: URL): void {
  const path = url.pathname.toLowerCase();
  if (
    (url.hostname === "github.com" && path.startsWith("/minghinmatthewlam/pi-gui/")) ||
    (url.hostname === "api.github.com" && path.startsWith("/repos/minghinmatthewlam/pi-gui/"))
  ) {
    throw new TypeError("The upstream author's release feed is not a distribution target");
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[+-]/, 1)[0]!.split(".").map(Number);
  const pb = b.split(/[+-]/, 1)[0]!.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const left = pa[index] ?? 0;
    const right = pb[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
