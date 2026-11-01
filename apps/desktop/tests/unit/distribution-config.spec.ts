import assert from "node:assert/strict";
import { test } from "@playwright/test";
import {
  SUPPORT_AUTOMATIC_POST_USE_SOLICITATION,
  SUPPORT_OPTION_IDS,
  SUPPORT_OPTIONS,
  distributionCreateCandidateProfile,
  distributionCreateCandidateReleaseManifest,
  distributionCreatePublishedProfile,
  distributionEvaluatePublicationGate,
  distributionEvaluateUpdateGate,
  distributionValidateReleaseManifest,
  type PublishedDistributionProfile,
} from "@pi-gui/distribution-config";

function publishedProfile(
  publication: "authorized" | "not-authorized" = "not-authorized",
): PublishedDistributionProfile {
  return distributionCreatePublishedProfile({
    schemaVersion: 1,
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
      releaseManifestUrl: "https://downloads.example.test/releases/manifest.json",
      publicationAuthorization:
        publication === "authorized"
          ? { status: "authorized", reference: "test-only-owner-approval" }
          : { status: "not-authorized" },
    },
  });
}

function publishedManifest() {
  return distributionValidateReleaseManifest({
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
      byteSize: 123_456,
      sha256: "a".repeat(64),
    },
    releaseNotesUrl: "https://downloads.example.test/releases/1.1.0",
    rollback: {
      kind: "previous-release",
      previousVersion: "1.0.2",
      previousManifestUrl: "https://downloads.example.test/releases/1.0.2/manifest.json",
      previousArtifactSha256: "b".repeat(64),
    },
  });
}

test("candidate profile is stable and gates every public action", () => {
  const older = distributionCreateCandidateProfile("1.0.1");
  const newer = distributionCreateCandidateProfile("1.0.2");
  assert.equal(older.identity.appName, "pi-gui-candidate");
  assert.equal(newer.identity.appName, "pi-gui-candidate");
  assert.equal(older.data.userDataDirectoryName, "pi-gui-candidate");
  assert.equal(newer.data.userDataDirectoryName, "pi-gui-candidate");
  assert.equal(newer.data.personalDataImport.status, "disabled");
  assert.equal(newer.data.personalDataImport.requiresExplicitUserAction, true);
  assert.equal(newer.data.personalDataImport.sourceSelection, "not-configured");
  assert.equal(newer.data.personalDataImport.copyOnly, true);
  assert.equal(newer.release.updateChecks, "disabled");
  assert.equal(newer.release.publication, "disabled");
  assert.equal(newer.release.releaseManifestUrl, null);
  assert.ok(newer.identity.unresolvedPublicFields.includes("repositoryOwner"));
  assert.ok(newer.identity.unresolvedPublicFields.includes("websiteOrigin"));

  const manifest = distributionCreateCandidateReleaseManifest({
    version: "1.0.2",
    platform: "macos",
    architecture: "arm64",
    minimumOs: "macOS 11",
  });
  assert.equal(
    distributionEvaluateUpdateGate(newer, manifest, {
      platform: "macos",
      architecture: "arm64",
    }).allowed,
    false,
  );
  assert.equal(distributionEvaluatePublicationGate(newer, manifest).allowed, false);
});

test("release manifest validation rejects mutable, malformed, and upstream targets", () => {
  const valid = publishedManifest();
  assert.equal(valid.channel, "published");
  assert.equal(valid.artifact?.byteSize, 123_456);

  const mutableArtifact = {
    ...valid,
    artifact: {
      ...valid.artifact,
      url: "https://downloads.example.test/latest/pi-gui-distribution-test-arm64.dmg",
    },
  };
  assert.throws(
    () => distributionValidateReleaseManifest(mutableArtifact),
    /immutable release version path segment/,
  );

  const queriedArtifact = {
    ...valid,
    artifact: {
      ...valid.artifact,
      url: `${valid.artifact?.url}?download=1`,
    },
  };
  assert.throws(() => distributionValidateReleaseManifest(queriedArtifact), /query or fragment/);

  const uppercaseDigest = {
    ...valid,
    artifact: { ...valid.artifact, sha256: "A".repeat(64) },
  };
  assert.throws(
    () => distributionValidateReleaseManifest(uppercaseDigest),
    /lowercase hexadecimal/,
  );

  const upstream = {
    ...valid,
    repository: { owner: "minghinmatthewlam", name: "pi-gui" },
  };
  assert.throws(
    () => distributionValidateReleaseManifest(upstream),
    /upstream author's release repository/,
  );

  const upstreamFeed = {
    ...valid,
    artifact: {
      ...valid.artifact,
      url: "https://github.com/minghinmatthewlam/pi-gui/releases/download/1.1.0/pi-gui.dmg",
    },
  };
  assert.throws(
    () => distributionValidateReleaseManifest(upstreamFeed),
    /upstream author's release feed/,
  );
});

test("published gating requires matching identity and fresh publication approval", () => {
  const manifest = publishedManifest();
  const withoutApproval = publishedProfile();
  const withApproval = publishedProfile("authorized");

  assert.deepEqual(
    distributionEvaluateUpdateGate(withoutApproval, manifest, {
      platform: "macos",
      architecture: "arm64",
    }),
    { allowed: true, reasons: [] },
  );
  assert.equal(distributionEvaluatePublicationGate(withoutApproval, manifest).allowed, false);
  assert.equal(distributionEvaluatePublicationGate(withApproval, manifest).allowed, true);
  assert.equal(
    distributionEvaluateUpdateGate(withApproval, manifest, {
      platform: "linux",
      architecture: "x64",
    }).allowed,
    false,
  );
});

test("distribution config exposes the accepted support package without solicitation", () => {
  const profile = distributionCreateCandidateProfile("1.0.2");
  assert.equal(profile.support.sourcePackage, "@pi-gui/distribution-support");
  assert.equal(profile.support.options, SUPPORT_OPTIONS);
  assert.equal(profile.support.optionIds, SUPPORT_OPTION_IDS);
  assert.equal(
    profile.support.automaticPostUseSolicitation,
    SUPPORT_AUTOMATIC_POST_USE_SOLICITATION,
  );
  assert.equal(profile.support.automaticPostUseSolicitation, false);
  assert.equal(profile.support.uiOwner, "D12/D14");
});

test("update compatibility permits a newer release while publication binds the package version", () => {
  const profile = publishedProfile("authorized");
  const release = publishedManifest();
  const installed = { ...profile, version: "1.0.2" };
  const target = { platform: "macos", architecture: "arm64" } as const;
  assert.equal(distributionEvaluateUpdateGate(installed, release, target).allowed, true);
  assert.equal(distributionEvaluatePublicationGate(installed, release).allowed, false);
  assert.equal(distributionEvaluatePublicationGate(profile, release).allowed, true);
  for (const bad of [
    { ...release, productSlug: "wrong-product" },
    { ...release, repository: { owner: "foreign", name: "repository" } },
    { ...release, websiteOrigin: "https://foreign.example.test" },
  ]) {
    assert.equal(distributionEvaluateUpdateGate(profile, bad, target).allowed, false);
    assert.equal(distributionEvaluatePublicationGate(profile, bad).allowed, false);
  }
});

test("profile origin policy rejects foreign and mutable release URLs without CDN exceptions", () => {
  const valid = publishedManifest();
  assert.equal(valid.channel, "published");
  if (valid.channel !== "published") return;
  for (const origin of [
    "https://foreign.example.test",
    "https://downloads.example.test.evil.test",
    "https://downloads.example.test@evil.test",
    "http://downloads.example.test",
    "https://downloads.example.test:444",
  ]) {
    for (const field of ["artifact", "releaseNotes", "rollback"] as const) {
      const raw = {
        ...valid,
        artifact: {
          ...valid.artifact,
          url: field === "artifact" ? `${origin}/releases/1.1.0/test.dmg` : valid.artifact.url,
        },
        releaseNotesUrl:
          field === "releaseNotes" ? `${origin}/releases/1.1.0` : valid.releaseNotesUrl,
        rollback:
          field === "rollback"
            ? {
                kind: "previous-release",
                previousVersion: "1.0.2",
                previousManifestUrl: `${origin}/releases/1.0.2/manifest.json`,
                previousArtifactSha256: "b".repeat(64),
              }
            : valid.rollback,
      };
      assert.throws(() => distributionValidateReleaseManifest(raw));
      assert.equal(
        distributionEvaluateUpdateGate(publishedProfile(), raw as typeof valid, {
          platform: "macos",
          architecture: "arm64",
        }).allowed,
        false,
      );
    }
  }
  for (const suffix of ["?download=1", "#latest"]) {
    assert.throws(() =>
      distributionValidateReleaseManifest({
        ...valid,
        releaseNotesUrl: valid.releaseNotesUrl + suffix,
      }),
    );
    assert.throws(() =>
      distributionValidateReleaseManifest({
        ...valid,
        rollback: {
          kind: "previous-release",
          previousVersion: "1.0.2",
          previousManifestUrl: `https://downloads.example.test/releases/1.0.2/manifest.json${suffix}`,
          previousArtifactSha256: "b".repeat(64),
        },
      }),
    );
  }
  assert.throws(() =>
    distributionValidateReleaseManifest({
      ...valid,
      releaseNotesUrl: "https://downloads.example.test/releases/latest",
    }),
  );
  assert.throws(() =>
    distributionValidateReleaseManifest({
      ...valid,
      rollback: {
        kind: "previous-release",
        previousVersion: "1.0.2",
        previousManifestUrl: "https://downloads.example.test/releases/latest/manifest.json",
        previousArtifactSha256: "b".repeat(64),
      },
    }),
  );
});
