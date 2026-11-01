import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { test } from "@playwright/test";
import {
  distributionCreateCandidateProfile,
  distributionCreatePublishedProfile,
  type DistributionReleaseManifest,
  type PublishedDistributionProfile,
} from "@pi-gui/distribution-config";
import { distributionResolveDataPaths } from "@pi-gui/distribution-config/node";
import { checkForUpdate, type UpdateFetch } from "../../electron/platform/update-checker";

function publishedProfile(): PublishedDistributionProfile {
  return distributionCreatePublishedProfile({
    channel: "published",
    version: "1.1.0",
    identity: {
      status: "resolved",
      distributionSlug: "pi-gui-distribution-test",
      displayName: "Pi GUI Test",
      appId: "com.example.pi-gui-distribution-test",
      packageName: "pi-gui-distribution-test",
      executableName: "pi-gui-distribution-test",
      appName: "pi-gui-distribution-test",
      publisher: "Example Publisher",
      maintainer: "Example Maintainer <maintainer@example.test>",
      copyright: "Copyright 2026 Example Publisher",
      repository: {
        owner: "example",
        name: "pi-gui-distribution",
        url: "https://github.com/example/pi-gui-distribution",
      },
      domains: {
        websiteOrigin: "https://downloads.example.test",
        supportUrl: "https://support.example.test/pi-gui",
      },
    },
    data: {
      userDataDirectoryName: "pi-gui-distribution-test",
      agentDataDirectoryName: "agent",
    },
    release: {
      updateChecks: "enabled",
      releaseManifestUrl: "https://downloads.example.test/manifest.json",
      publicationAuthorization: { status: "not-authorized" },
    },
  });
}

function manifest(): DistributionReleaseManifest {
  return {
    schemaVersion: 1,
    channel: "published",
    productSlug: "pi-gui-distribution-test",
    version: "1.1.0",
    platform: "macos",
    architecture: "arm64",
    minimumOs: "macOS 11",
    repository: {
      owner: "example",
      name: "pi-gui-distribution",
    },
    websiteOrigin: "https://downloads.example.test",
    artifact: {
      url: "https://downloads.example.test/releases/1.1.0/pi-gui-distribution-test-1.1.0-arm64.dmg",
      byteSize: 42,
      sha256: "c".repeat(64),
    },
    releaseNotesUrl: "https://downloads.example.test/releases/1.1.0",
    rollback: {
      kind: "first-release",
      reason: "no-earlier-public-release",
    },
  };
}

test("candidate data roots stay stable and separate from the global Pi profile", () => {
  const first = distributionResolveDataPaths({
    appDataDirectory: "/Users/example/Library/Application Support",
    profile: distributionCreateCandidateProfile("1.0.1"),
  });
  const second = distributionResolveDataPaths({
    appDataDirectory: "/Users/example/Library/Application Support",
    profile: distributionCreateCandidateProfile("1.0.2"),
  });

  assert.deepEqual(second, first);
  assert.equal(second.userData, "/Users/example/Library/Application Support/pi-gui-candidate");
  assert.equal(
    second.agentData,
    "/Users/example/Library/Application Support/pi-gui-candidate/agent",
  );
  assert.notEqual(second.agentData, "/Users/example/.pi/agent");
  assert.equal(second.policy.personalDataImport.status, "disabled");

  const explicitImport = distributionResolveDataPaths({
    appDataDirectory: "/Users/example/Library/Application Support",
    profile: distributionCreateCandidateProfile("1.0.2"),
    agentDataDirectoryOverride: "~/.pi/agent",
  });
  assert.equal(explicitImport.agentData, first.agentData);

  assert.throws(
    () =>
      distributionResolveDataPaths({
        appDataDirectory: "relative",
        profile: distributionCreateCandidateProfile("1.0.2"),
      }),
    /must be an absolute path/,
  );
});

test("candidate update checks make no network request", async () => {
  let fetchCalls = 0;
  const fetchNever: UpdateFetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };
  const result = await checkForUpdate({
    profile: distributionCreateCandidateProfile("1.0.2"),
    currentVersion: "1.0.2",
    fetcher: fetchNever,
  });
  assert.equal(result.status, "disabled");
  assert.equal(fetchCalls, 0);
});

test("published updater consumes only its validated release manifest", async () => {
  const calls: string[] = [];
  const fetchManifest: UpdateFetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(manifest()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const result = await checkForUpdate({
    profile: publishedProfile(),
    currentVersion: "1.0.2",
    platform: "darwin",
    architecture: "arm64",
    fetcher: fetchManifest,
  });
  assert.equal(result.status, "update-available");
  if (result.status !== "update-available") return;
  assert.equal(result.latestVersion, "1.1.0");
  assert.equal(result.releaseUrl, "https://downloads.example.test/releases/1.1.0");
  assert.deepEqual(calls, ["https://downloads.example.test/manifest.json"]);
});

test("candidate builder and updater contain no upstream publication or API feed", async () => {
  const root = resolve(process.cwd());
  const builder = await readFile(join(root, "apps/desktop/electron-builder.yml"), "utf8");
  const desktopPackage = JSON.parse(
    await readFile(join(root, "apps/desktop/package.json"), "utf8"),
  ) as Record<string, unknown>;
  const updater = await readFile(
    join(root, "apps/desktop/electron/platform/update-checker.ts"),
    "utf8",
  );

  assert.match(builder, /appId: com\.pi-gui\.desktop\.candidate/);
  assert.match(builder, /productName: pi-gui Candidate/);
  assert.doesNotMatch(builder, /^publish:/m);
  assert.doesNotMatch(builder, /owner: minghinmatthewlam/);
  assert.equal(desktopPackage.homepage, undefined);
  assert.doesNotMatch(updater, /releases\/latest/);
  assert.doesNotMatch(updater, /api\.github\.com\/repos/);
  assert.match(updater, /distributionValidateReleaseManifest/);
});

test("ambient overrides never select personal data and explicit test roots contain every effective path", async () => {
  const { mkdtemp, mkdir, symlink, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "pi-gui-d07-path-policy-"));
  const sandbox = join(root, "sandbox");
  const legacy = join(root, "legacy");
  await mkdir(sandbox);
  await mkdir(legacy);
  const marker = join(legacy, "sessions.json");
  await writeFile(marker, '{"synthetic":"legacy-never-imported"}');
  const before = await readFile(marker, "utf8");
  const options = {
    appDataDirectory: join(root, "app-data"),
    profile: distributionCreateCandidateProfile("1.0.2"),
  };
  const stable = distributionResolveDataPaths(options);
  for (const overrides of [
    { userDataDirectoryOverride: legacy },
    { agentDataDirectoryOverride: legacy },
    { userDataDirectoryOverride: legacy, agentDataDirectoryOverride: legacy },
  ])
    assert.deepEqual(distributionResolveDataPaths({ ...options, ...overrides }), stable);
  const explicit = distributionResolveDataPaths({
    ...options,
    testDataRoot: sandbox,
    userDataDirectoryOverride: join(sandbox, "user"),
    agentDataDirectoryOverride: join(sandbox, "agent"),
  });
  assert.equal(explicit.policy.personalDataImport.status, "disabled");
  for (const outside of [legacy, join(sandbox, "..", "legacy"), `${sandbox}-sibling`]) {
    for (const field of ["userDataDirectoryOverride", "agentDataDirectoryOverride"]) {
      assert.throws(
        () => distributionResolveDataPaths({ ...options, testDataRoot: sandbox, [field]: outside }),
        /contained/,
      );
    }
  }
  await symlink(legacy, join(sandbox, "escape"));
  for (const field of ["userDataDirectoryOverride", "agentDataDirectoryOverride"]) {
    assert.throws(
      () =>
        distributionResolveDataPaths({
          ...options,
          testDataRoot: sandbox,
          [field]: join(sandbox, "escape", "new-child"),
        }),
      /contained/,
    );
  }
  assert.equal(await readFile(marker, "utf8"), before);
});

test("updater compares the observed installed version numerically and rejects malformed versions", async () => {
  for (const [currentVersion, expected] of [
    ["1.1.0", "up-to-date"],
    ["2.0.0", "up-to-date"],
    ["1.0.2", "update-available"],
    ["garbage", "error"],
    ["1.0.2garbage", "error"],
  ]) {
    const result = await checkForUpdate({
      profile: { ...publishedProfile(), version: currentVersion! },
      currentVersion,
      platform: "darwin",
      architecture: "arm64",
      fetcher: async () => new Response(JSON.stringify(manifest()), { status: 200 }),
    });
    assert.equal(result.status, expected);
  }
  const release = manifest();
  if (release.channel !== "published") return;
  const numeric = {
    ...release,
    version: "1.10.0",
    artifact: {
      ...release.artifact,
      url: "https://downloads.example.test/releases/1.10.0/test.dmg",
    },
    releaseNotesUrl: "https://downloads.example.test/releases/1.10.0",
  };
  const result = await checkForUpdate({
    profile: { ...publishedProfile(), version: "1.9.9" },
    currentVersion: "1.9.9",
    platform: "darwin",
    architecture: "arm64",
    fetcher: async () => new Response(JSON.stringify(numeric), { status: 200 }),
  });
  assert.equal(result.status, "update-available");
});
