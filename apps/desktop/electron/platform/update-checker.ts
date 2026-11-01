import { app, net, Notification, shell } from "electron";
import {
  distributionCanCheckForUpdates,
  distributionCreateCandidateProfile,
  distributionEvaluateUpdateGate,
  distributionRuntimeTarget,
  distributionValidateReleaseManifest,
  type DistributionProfile,
  type DistributionReleaseManifest,
} from "@pi-gui/distribution-config";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 15_000; // 15 seconds after launch
const FETCH_TIMEOUT_MS = 10_000;

export type UpdateCheckResult =
  | { status: "up-to-date"; currentVersion: string; latestVersion: string }
  | {
      status: "update-available";
      currentVersion: string;
      latestVersion: string;
      releaseUrl: string;
      manifest: DistributionReleaseManifest;
    }
  | { status: "disabled"; message: string }
  | { status: "error"; message: string };

export type GitHubRelease = {
  tag_name?: string;
  html_url?: string;
};

export type UpdateFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface UpdateCheckOptions {
  readonly profile?: DistributionProfile;
  readonly currentVersion?: string;
  readonly platform?: string;
  readonly architecture?: string;
  readonly fetcher?: UpdateFetch;
}

export function openReleasesPage(releaseUrl: string): Promise<void> {
  const url = new URL(releaseUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    return Promise.reject(new Error("Release pages must use a credential-free HTTPS URL."));
  }
  return shell.openExternal(url.href);
}

export function showUpdateNotification(
  currentVersion: string,
  latestVersion: string,
  releaseUrl: string,
  displayName = "pi-gui",
): void {
  if (!Notification.isSupported()) {
    return;
  }
  const notification = new Notification({
    title: `${displayName} Release Available`,
    body: `Version ${latestVersion} is available (you have ${currentVersion}). Click to view the release.`,
  });
  notification.on("click", () => {
    void openReleasesPage(releaseUrl).catch((error: unknown) => {
      console.error("[update-checker] openReleasesPage failed", error);
    });
  });
  notification.show();
}

/**
 * Candidate profiles return before any request is made. A published profile
 * fetches only its configured immutable release manifest and validates every
 * field before the app can present a download link.
 */
export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateCheckResult> {
  const profile =
    options.profile ??
    distributionCreateCandidateProfile(options.currentVersion ?? app.getVersion());
  if (!canCheckForUpdates(profile)) {
    return {
      status: "disabled",
      message: "Update checks are disabled until an authorized distribution feed is configured.",
    };
  }

  let target: ReturnType<typeof distributionRuntimeTarget>;
  try {
    target = distributionRuntimeTarget(
      options.platform ?? process.platform,
      options.architecture ?? process.arch,
    );
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unsupported update target.",
    };
  }
  const current = options.currentVersion ?? app.getVersion();
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      current,
    )
  ) {
    return { status: "error", message: "The installed version must be a semantic version." };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (options.fetcher ?? net.fetch)(profile.release.releaseManifestUrl, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "The update check timed out."
        : error instanceof Error
          ? error.message
          : "The update manifest could not be reached.";
    return { status: "error", message };
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    return {
      status: "error",
      message: "The distribution update manifest is not published yet.",
    };
  }
  if (!response.ok) {
    return {
      status: "error",
      message: `The distribution update service returned ${response.status}.`,
    };
  }

  let rawManifest: unknown;
  try {
    rawManifest = await response.json();
  } catch {
    return {
      status: "error",
      message: "The update service returned an unreadable response.",
    };
  }

  let manifest: DistributionReleaseManifest;
  try {
    manifest = distributionValidateReleaseManifest(rawManifest);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "The release manifest is invalid.",
    };
  }

  const gate = distributionEvaluateUpdateGate(profile, manifest, target);
  if (!gate.allowed) {
    return {
      status: "error",
      message: `Release manifest rejected: ${gate.reasons.join("; ")}.`,
    };
  }
  if (manifest.channel !== "published") {
    return {
      status: "error",
      message: "Candidate manifests cannot serve published updates.",
    };
  }

  if (compareSemver(manifest.version, current) > 0) {
    return {
      status: "update-available",
      currentVersion: current,
      latestVersion: manifest.version,
      releaseUrl: manifest.releaseNotesUrl,
      manifest,
    };
  }

  return {
    status: "up-to-date",
    currentVersion: current,
    latestVersion: manifest.version,
  };
}

export function initUpdateChecker(options: UpdateCheckOptions = {}): () => void {
  const profile =
    options.profile ??
    distributionCreateCandidateProfile(options.currentVersion ?? app.getVersion());
  if (!canCheckForUpdates(profile)) {
    return () => undefined;
  }

  let lastNotifiedVersion: string | undefined;
  const runAutoCheck = async () => {
    const result = await checkForUpdate(options);
    if (result.status === "disabled") return;
    if (result.status === "error") {
      console.warn("Update check failed:", result.message);
      return;
    }
    if (result.status === "update-available" && result.latestVersion !== lastNotifiedVersion) {
      lastNotifiedVersion = result.latestVersion;
      showUpdateNotification(
        result.currentVersion,
        result.latestVersion,
        result.releaseUrl,
        profile.identity.displayName,
      );
    }
  };

  const timeout = setTimeout(
    () =>
      void runAutoCheck().catch((error: unknown) => {
        console.error("[update-checker] runAutoCheck failed", error);
      }),
    INITIAL_DELAY_MS,
  );
  const interval = setInterval(
    () =>
      void runAutoCheck().catch((error: unknown) => {
        console.error("[update-checker] runAutoCheck failed", error);
      }),
    CHECK_INTERVAL_MS,
  );

  return () => {
    clearTimeout(timeout);
    clearInterval(interval);
  };
}

function canCheckForUpdates(profile: DistributionProfile): profile is DistributionProfile & {
  readonly channel: "published";
  readonly release: {
    readonly updateChecks: "enabled";
    readonly releaseManifestUrl: string;
  };
} {
  return distributionCanCheckForUpdates(profile);
}

/*
 * Kept as a pure compatibility helper for existing tests. The live updater
 * above never uses it, so no candidate build can reach this URL.
 */
export function releaseUrlFor(release: GitHubRelease): string {
  const legacyReleasesPage = "https://github.com/minghinmatthewlam/pi-gui/releases";
  const tag = release.tag_name;
  if (!tag) return legacyReleasesPage;

  const canonicalUrl = `${legacyReleasesPage}/tag/${encodeURIComponent(tag)}`;
  if (!release.html_url) return canonicalUrl;

  try {
    const candidate = new URL(release.html_url);
    const canonical = new URL(canonicalUrl);
    if (
      candidate.protocol === canonical.protocol &&
      candidate.host === canonical.host &&
      candidate.pathname === canonical.pathname &&
      candidate.username === "" &&
      candidate.password === "" &&
      candidate.search === "" &&
      candidate.hash === ""
    ) {
      return candidate.toString();
    }
  } catch {
    // Fall through to the legacy canonical URL for the exact tag.
  }
  return canonicalUrl;
}

/**
 * Compare two semver strings. Returns a negative number when `a < b`, zero when
 * equal, positive when `a > b`. Unparseable inputs compare equal so an update
 * is never claimed from an unvalidated version.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let index = 0; index < 3; index += 1) {
    const left = pa.nums[index] ?? 0;
    const right = pb.nums[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return comparePrerelease(pa.pre, pb.pre);
}

function parseSemver(
  version: string,
): { nums: [number, number, number]; pre: string[] } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!match) return undefined;
  return {
    nums: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? "";
    const right = b[index] ?? "";
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const delta = Number(left) - Number(right);
      if (delta !== 0) return delta < 0 ? -1 : 1;
    } else if (leftNumeric) {
      return -1;
    } else if (rightNumeric) {
      return 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
