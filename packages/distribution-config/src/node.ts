import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DistributionDataPolicy, DistributionProfile } from "./index.js";

export interface DistributionPathOptions {
  readonly appDataDirectory: string;
  readonly profile: DistributionProfile;
  /** Explicit test-only sandbox. Ambient overrides are ignored without this contract. */
  readonly testDataRoot?: string | undefined;
  readonly userDataDirectoryOverride?: string | undefined;
  readonly agentDataDirectoryOverride?: string | undefined;
}

export interface DistributionDataPaths {
  readonly userData: string;
  readonly agentData: string;
  readonly policy: DistributionDataPolicy;
}

/** Resolve stable owned paths; test overrides must remain inside a canonical sandbox. */
export function distributionResolveDataPaths(
  options: DistributionPathOptions,
): DistributionDataPaths {
  const appData = requireAbsolutePath(options.appDataDirectory, "app data directory");
  const testRoot =
    options.testDataRoot === undefined
      ? undefined
      : canonicalPath(requireAbsolutePath(options.testDataRoot, "test data root"));
  const ownedRoot = canonicalPath(resolve(appData, options.profile.data.userDataDirectoryName));
  const userData =
    testRoot === undefined
      ? ownedRoot
      : canonicalPath(
          requireAbsolutePath(
            options.userDataDirectoryOverride ??
              join(testRoot, options.profile.data.userDataDirectoryName),
            "test user data override",
          ),
        );
  const agentData =
    testRoot === undefined
      ? canonicalPath(join(userData, options.profile.data.agentDataDirectoryName))
      : canonicalPath(
          requireAbsolutePath(
            options.agentDataDirectoryOverride ??
              join(userData, options.profile.data.agentDataDirectoryName),
            "test agent data override",
          ),
        );
  if (testRoot !== undefined) {
    assertContained(testRoot, userData);
    assertContained(testRoot, agentData);
  } else {
    // A pre-existing symlink must not redirect the candidate into another profile.
    if (userData !== join(canonicalPath(appData), options.profile.data.userDataDirectoryName)) {
      throw new TypeError("Distribution user data must retain its stable owned identity");
    }
    assertContained(canonicalPath(appData), userData);
    assertContained(userData, agentData);
  }
  if (userData === canonicalPath(appData) || userData === agentData) {
    throw new TypeError("Distribution user data and Pi agent data must be separate owned roots");
  }
  return Object.freeze({ userData, agentData, policy: options.profile.data });
}

function assertContained(root: string, path: string): void {
  const child = relative(root, path);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new TypeError("Distribution data path must be contained in its designated root");
  }
}

/** Resolve existing ancestors too, so not-yet-created children cannot hide symlink escapes. */
function canonicalPath(path: string): string {
  try {
    lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), path.slice(parent.length));
  }
  return realpathSync(path);
}

function requireAbsolutePath(value: string, label: string): string {
  if (!isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`);
  return resolve(value);
}
