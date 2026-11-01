import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  permission_authorizationKinds,
  permission_capabilityIds,
  permission_decodeAuthorizationObservation,
  permission_decodeBinding,
  permission_decodeCapabilityDescriptor,
  permission_decodeDragOutcome,
  permission_decodeEvidence,
  permission_decodeFeatureOperation,
  permission_decodeInstalledRecipient,
  permission_decodePaneEvidence,
  permission_decodeRevealAttempt,
  permission_decodeRequestOutcome,
  permission_decodeSettingsOpenAttempt,
  permission_decodeSupportTuple,
  permission_isLinuxNativeExecutablePath,
  permission_isStableInstalledBundlePath,
  permission_isWindowsReservedDeviceComponent,
  permission_isWindowsInstalledExecutablePath,
  permission_panes,
  permission_paneCapabilityIds,
  permission_platforms,
  permission_schemaVersion,
  permission_windowsReservedDeviceNames,
  type InstalledRecipient,
  type PermissionBinding,
  type PermissionCapabilityDescriptor,
  type PermissionScope,
  type PermissionSupportTuple,
} from "../../contracts/permissions";

const workspaceRoot = path.resolve(__dirname, "../../../..");
const at = 1_764_000_000_000;

function recipient(overrides: Partial<InstalledRecipient> = {}): InstalledRecipient {
  return {
    kind: "main-app",
    status: "verified",
    platform: "macos",
    displayName: "pi-gui Candidate",
    bundleIdentifier: "com.pi-gui.desktop.candidate",
    bundlePath: "/Applications/pi-gui Candidate.app",
    identitySource: "installed-package",
    identityKey: "installed-parent-v1",
    reasonCode: null,
    ...overrides,
  };
}

function scope(overrides: Partial<PermissionScope> = {}): PermissionScope {
  return {
    kind: "app-default",
    scopeKey: "notifications-default",
    generation: 9,
    ...overrides,
  };
}

function support(overrides: Partial<PermissionSupportTuple> = {}): PermissionSupportTuple {
  return {
    platform: "macos",
    osVersion: "15.2",
    osBuild: "24C101",
    architecture: "arm64",
    packageFormat: "dmg",
    installerIdentity: "candidate-dmg",
    signerIdentity: "Developer ID Application: Candidate",
    installedIdentityKey: "installed-parent-v1",
    apiVersion: "UserNotifications-15",
    desktopSession: "aqua",
    scopeKey: "notifications-default",
    ...overrides,
  };
}

function binding(overrides: Partial<PermissionBinding> = {}): PermissionBinding {
  return {
    capabilityId: "notifications",
    platform: "macos",
    support: support(),
    scope: scope(),
    recipient: recipient(),
    generation: 9,
    ...overrides,
  };
}

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: permission_schemaVersion,
    kind: "reported-authorization",
    evidenceId: "evidence-auth-1",
    recordedAt: at,
    binding: binding(),
    authorization: "authorized",
    source: "native",
    reasonCode: null,
    ...overrides,
  };
}

function paneBinding(pane: (typeof permission_panes)[number]): PermissionBinding {
  const scopeKind =
    pane === "accessibility"
      ? "named-operation"
      : pane === "automation"
        ? "target-application"
        : pane === "files-and-folders"
          ? "selected-resource"
          : pane === "screen-and-system-audio-recording"
            ? "capture-source"
            : pane === "camera" || pane === "microphone"
              ? "media-stream"
              : "app-default";
  const scopeKey = `${pane}-scope`;
  return binding({
    capabilityId: permission_paneCapabilityIds[pane],
    scope: scope({ kind: scopeKind, scopeKey }),
    support: support({ scopeKey }),
  });
}

test("permission contract is browser-safe, versioned and closed", () => {
  const source = readFileSync(
    path.join(workspaceRoot, "apps/desktop/contracts/permissions.ts"),
    "utf8",
  );
  expect(source).not.toMatch(/from\s+["'](?:node:|electron|fs|path|child_process)/);
  expect(source).not.toMatch(/\b(?:fetch|require\s*\(|ipcMain|ipcRenderer|process\.|Date\.now)\b/);
  expect(permission_schemaVersion).toBe(1);
  expect(permission_platforms).toEqual(["macos", "windows", "linux"]);
  expect(permission_capabilityIds).toContain("notifications");
  expect(permission_authorizationKinds).toEqual([
    "not-determined",
    "denied",
    "authorized",
    "provisional",
    "ephemeral",
    "restricted-managed",
    "unsupported",
    "unavailable",
    "unknown",
  ]);
  expect(permission_panes).toHaveLength(8);
  expect(new Set(permission_capabilityIds).size).toBe(permission_capabilityIds.length);
});

test("all evidence layers strictly round-trip without collapsing into authorization", () => {
  const values = [
    {
      schemaVersion: permission_schemaVersion,
      kind: "settings-open-attempt",
      evidenceId: "settings-1",
      recordedAt: at,
      binding: binding(),
      state: "accepted",
      source: "application",
      reasonCode: null,
    },
    {
      schemaVersion: permission_schemaVersion,
      kind: "permission-request",
      evidenceId: "request-1",
      recordedAt: at,
      binding: binding(),
      state: "accepted",
      source: "native",
      reasonCode: null,
    },
    evidence(),
    {
      schemaVersion: permission_schemaVersion,
      kind: "installed-app-reveal",
      evidenceId: "reveal-1",
      recordedAt: at,
      binding: binding(),
      action: "show-in-finder",
      state: "accepted",
      source: "application",
      reasonCode: null,
    },
    {
      schemaVersion: permission_schemaVersion,
      kind: "installed-app-drag",
      evidenceId: "drag-1",
      recordedAt: at,
      binding: binding(),
      pane: "notifications",
      result: "unavailable",
      source: "application",
      reasonCode: "pane-evidence-unavailable",
    },
    {
      schemaVersion: permission_schemaVersion,
      kind: "feature-operation",
      evidenceId: "feature-1",
      recordedAt: at,
      binding: binding(),
      state: "succeeded",
      source: "native",
      reasonCode: null,
    },
  ];
  const decoded = values.map((value) =>
    permission_decodeEvidence(JSON.parse(JSON.stringify(value))),
  );
  expect(decoded.map((value) => value.kind)).toEqual([
    "settings-open-attempt",
    "permission-request",
    "reported-authorization",
    "installed-app-reveal",
    "installed-app-drag",
    "feature-operation",
  ]);
  expect(decoded[2]).toMatchObject({ authorization: "authorized", source: "native" });
  expect(decoded[5]).toMatchObject({ state: "succeeded", source: "native" });
});

test("strict decoders reject unknown fields, stale versions, hostile accessors and prototypes", () => {
  expect(() =>
    permission_decodeAuthorizationObservation({ ...evidence(), detail: "raw error" }),
  ).toThrow(/unsupported shape/);
  expect(() =>
    permission_decodeAuthorizationObservation({
      ...evidence(),
      schemaVersion: 2,
    }),
  ).toThrow(/unsupported/);

  const accessor = evidence();
  Object.defineProperty(accessor, "source", {
    enumerable: true,
    get: () => "native",
  });
  expect(() => permission_decodeAuthorizationObservation(accessor)).toThrow(/enumerable data/);

  const polluted = JSON.parse(
    JSON.stringify({
      ...evidence(),
      binding: binding(),
    }),
  ) as unknown as Record<string, unknown>;
  const pollutedBinding = polluted.binding as Record<string, unknown>;
  Object.defineProperty(pollutedBinding, "__proto__", {
    enumerable: true,
    value: { capabilityId: "full-disk-access" },
  });
  expect(() => permission_decodeAuthorizationObservation(polluted)).toThrow(/unsupported shape/);

  const inherited = Object.create({ source: "native" }) as Record<string, unknown>;
  Object.assign(inherited, evidence());
  delete inherited.source;
  expect(() => permission_decodeAuthorizationObservation(inherited)).toThrow(/plain JSON object/);
});

test("bounded identifiers and collections reject oversized or ambiguous values", () => {
  expect(() =>
    permission_decodeBinding({
      ...binding(),
      scope: scope({ scopeKey: "a".repeat(129) }),
    }),
  ).toThrow(/opaque identifier/);
  expect(() =>
    permission_decodeBinding({
      ...binding(),
      scope: scope({ scopeKey: "https://provider.example/file" }),
    }),
  ).toThrow(/opaque identifier/);
  expect(() =>
    permission_decodeBinding({
      ...binding(),
      scope: scope({ generation: 8 }),
    }),
  ).toThrow(/generation differ/);
  expect(() =>
    permission_decodeBinding({
      ...binding(),
      capabilityId: "notifications",
      scope: scope({ kind: "selected-resource", scopeKey: "selected-file" }),
      support: support({ scopeKey: "selected-file" }),
    }),
  ).toThrow(/capability, support, recipient, scope/);
  expect(() =>
    permission_decodeBinding({
      ...binding(),
      support: support({ signerIdentity: "unverified" }),
    }),
  ).toThrow(/capability, support, recipient, scope/);
  expect(() =>
    permission_decodeSupportTuple({
      ...support(),
      osVersion: "1".repeat(129),
    }),
  ).toThrow(/bounded string/);
  expect(() =>
    permission_decodeCapabilityDescriptor({
      capabilityId: "notifications",
      platform: "macos",
      scopeKinds: ["app-default", "app-default"],
      support: [{ support: support(), status: "supported" }],
    }),
  ).toThrow(/unique/);
  expect(() =>
    permission_decodeCapabilityDescriptor({
      capabilityId: "notifications",
      platform: "macos",
      scopeKinds: ["app-default"],
      support: Array.from({ length: 65 }, () => ({
        support: support(),
        status: "supported",
      })),
    }),
  ).toThrow(/collection limit|bounded/);
  expect(() =>
    permission_decodeCapabilityDescriptor({
      capabilityId: "notifications",
      platform: "macos",
      scopeKinds: ["selected-resource"],
      support: [{ support: support(), status: "supported" }],
    }),
  ).toThrow(/scope kinds conflict/);
});

test("authorization states remain distinct and renderer evidence cannot claim native-only states", () => {
  for (const authorization of permission_authorizationKinds) {
    const source =
      authorization === "unsupported" ||
      authorization === "unavailable" ||
      authorization === "unknown"
        ? "capability-probe"
        : "native";
    const reasonCode =
      authorization === "unsupported" ||
      authorization === "unavailable" ||
      authorization === "unknown"
        ? authorization === "unsupported"
          ? "not-implemented"
          : "probe-failed"
        : authorization === "restricted-managed"
          ? "managed-restriction"
          : authorization === "denied"
            ? "access-denied"
            : null;
    expect(
      permission_decodeAuthorizationObservation(
        evidence({
          evidenceId: `auth-${authorization}`,
          authorization,
          source,
          reasonCode,
        }),
      ).authorization,
    ).toBe(authorization);
  }

  expect(
    permission_decodeAuthorizationObservation(
      evidence({ authorization: "denied", source: "browser", reasonCode: "access-denied" }),
    ),
  ).toMatchObject({ authorization: "denied", source: "browser" });
  expect(() =>
    permission_decodeAuthorizationObservation(
      evidence({ authorization: "restricted-managed", source: "browser" }),
    ),
  ).toThrow(/native-only/);
  expect(() =>
    permission_decodeAuthorizationObservation(
      evidence({ authorization: "authorized", source: "capability-probe" }),
    ),
  ).toThrow(/cannot report a grant/);
  expect(() =>
    permission_decodeAuthorizationObservation(
      evidence({
        authorization: "unsupported",
        source: "native",
        reasonCode: "not-implemented",
      }),
    ),
  ).toThrow(/capability-probe evidence/);
});

test("installed recipient identity distinguishes parent, helper, browser and companion", () => {
  expect(permission_decodeInstalledRecipient(recipient()).kind).toBe("main-app");

  const helper = recipient({
    kind: "helper",
    displayName: "notification helper",
    bundleIdentifier: "com.pi-gui.desktop.candidate.helper",
    bundlePath:
      "/Applications/pi-gui Candidate.app/Contents/MacOS/pi-gui-notification-status-helper",
    identityKey: "helper-v1",
  });
  expect(permission_decodeInstalledRecipient(helper).kind).toBe("helper");
  expect(() =>
    permission_decodeInstalledRecipient({
      ...helper,
      bundlePath: "/Applications/Fake Helper.app",
    }),
  ).toThrow(/helper recipients/);
  expect(() =>
    permission_decodeInstalledRecipient({
      ...recipient(),
      bundlePath: "/Applications/pi-gui Candidate.app/Contents/MacOS/pi-gui",
    }),
  ).toThrow(/Contents\/MacOS/);

  const ambiguous = recipient({
    status: "ambiguous",
    displayName: null,
    bundleIdentifier: null,
    bundlePath: null,
    identitySource: "unverified",
    reasonCode: "identity-ambiguous",
  });
  expect(permission_decodeInstalledRecipient(ambiguous).status).toBe("ambiguous");
  expect(() =>
    permission_decodeInstalledRecipient({
      ...ambiguous,
      reasonCode: null,
    }),
  ).toThrow(/explicit reason/);

  expect(
    permission_decodeInstalledRecipient(
      recipient({
        kind: "browser",
        displayName: "Microsoft Edge",
        bundleIdentifier: "com.microsoft.edgemac",
        bundlePath: "/Applications/Microsoft Edge.app",
        identityKey: "browser-edge",
      }),
    ).kind,
  ).toBe("browser");
  expect(
    permission_decodeInstalledRecipient(
      recipient({
        kind: "companion",
        displayName: "Companion",
        bundleIdentifier: "com.pi-gui.companion",
        bundlePath: "/Applications/Companion",
        identityKey: "companion-v1",
      }),
    ).kind,
  ).toBe("companion");
});

test("verified installed-app identity requires a stable packaged parent path", () => {
  const rejectedPaths = [
    "/tmp/pi-gui Candidate.app",
    "/private/tmp/pi-gui Candidate.app",
    "/var/folders/aa/bb/T/pi-gui Candidate.app",
    "/Volumes/Network Share/Applications/pi-gui Candidate.app",
    "/Volumes/Remote/Applications/pi-gui Candidate.app",
    "/Volumes/Shared/Applications/pi-gui Candidate.app",
    "/Applications/../tmp/pi-gui Candidate.app",
    "/Applications//pi-gui Candidate.app",
    "/Applications/%2e%2e/tmp/pi-gui Candidate.app",
    "/Applications/latest/pi-gui Candidate.app",
    "/Applications/pi-gui Candidate.app.bak",
    "/Applications/pi-gui Candidate.app/Contents/MacOS/pi-gui",
  ];
  for (const bundlePath of rejectedPaths) {
    expect(permission_isStableInstalledBundlePath(bundlePath)).toBe(false);
    expect(() => permission_decodeInstalledRecipient(recipient({ bundlePath }))).toThrow(
      /installed parent|bundle path|Contents\/MacOS/,
    );
  }

  const acceptedPaths = [
    "/Applications/pi-gui Candidate.app",
    "/System/Applications/Utilities/Terminal.app",
    "/Users/example/Applications/pi-gui Candidate.app",
  ];
  for (const bundlePath of acceptedPaths) {
    expect(permission_isStableInstalledBundlePath(bundlePath)).toBe(true);
    expect(permission_decodeInstalledRecipient(recipient({ bundlePath })).bundlePath).toBe(
      bundlePath,
    );
  }

  const ambiguousDevelopment = recipient({
    status: "ambiguous",
    displayName: null,
    bundleIdentifier: null,
    bundlePath: "/tmp/pi-gui Candidate.app",
    identitySource: "unverified",
    reasonCode: "identity-ambiguous",
  });
  expect(permission_decodeInstalledRecipient(ambiguousDevelopment).status).toBe("ambiguous");
});

test("platform-specific identity syntax rejects foreign absolute path forms", () => {
  const windowsRecipient = recipient({
    platform: "windows",
    bundleIdentifier: "com.pi-gui.desktop.candidate",
    bundlePath: "C:\\Program Files\\pi-gui\\pi-gui.exe",
  });
  expect(permission_decodeInstalledRecipient(windowsRecipient).platform).toBe("windows");
  expect(
    permission_decodeInstalledRecipient(
      recipient({
        platform: "windows",
        bundleIdentifier: null,
        bundlePath: "d:/Tools/pi-gui/pi-gui.exe",
      }),
    ).bundleIdentifier,
  ).toBeNull();

  const linuxRecipient = recipient({
    platform: "linux",
    bundleIdentifier: null,
    bundlePath: "/usr/bin/pi-gui",
  });
  expect(permission_decodeInstalledRecipient(linuxRecipient).platform).toBe("linux");
  for (const bundlePath of [
    "/bin/pi-gui",
    "/usr/local/bin/pi-gui",
    "/opt/pi-gui/pi-gui",
    "/usr/lib/pi-gui/pi-gui",
    "/snap/pi-gui/current/pi-gui",
    "/app/bin/pi-gui",
  ]) {
    expect(permission_isLinuxNativeExecutablePath(bundlePath)).toBe(true);
    expect(
      permission_decodeInstalledRecipient(
        recipient({
          platform: "linux",
          bundleIdentifier: null,
          bundlePath,
        }),
      ).bundlePath,
    ).toBe(bundlePath);
  }

  for (const bundlePath of [
    "C:\\Program Files\\pi-gui\\pi-gui.exe",
    "d:\\Tools\\pi-gui.exe",
    "E:/Products/pi-gui/pi-gui.exe",
  ]) {
    expect(permission_isWindowsInstalledExecutablePath(bundlePath)).toBe(true);
  }
  for (const bundlePath of [
    "C:pi-gui.exe",
    "pi-gui.exe",
    "C:\\",
    "C:\\Program Files\\pi-gui",
    "C:\\Program Files\\pi-gui.app",
    "C:\\Program Files\\..\\pi-gui.exe",
    "C:\\Program Files\\\\pi-gui.exe",
    "C:\\Program Files\\pi-gui.exe ",
    "C:\\Program Files\\pi-gui.exe.bak",
    "\\\\server\\share\\pi-gui.exe",
    "\\\\?\\C:\\Program Files\\pi-gui.exe",
    "C:/Program Files\\pi-gui.exe",
    "/Applications/pi-gui.exe",
  ]) {
    expect(permission_isWindowsInstalledExecutablePath(bundlePath)).toBe(false);
    expect(() =>
      permission_decodeInstalledRecipient(
        recipient({
          platform: "windows",
          bundlePath,
        }),
      ),
    ).toThrow(/Windows|drive-absolute|executable|bounded string/);
  }

  for (const bundlePath of [
    "/tmp/pi-gui",
    "/home/leo/pi-gui",
    "/Applications/pi-gui.app",
    "/usr/bin/../pi-gui",
    "/usr/bin//pi-gui",
    "C:\\Program Files\\pi-gui\\pi-gui.exe",
    "relative/pi-gui",
  ]) {
    expect(permission_isLinuxNativeExecutablePath(bundlePath)).toBe(false);
    expect(() =>
      permission_decodeInstalledRecipient(
        recipient({
          platform: "linux",
          bundleIdentifier: null,
          bundlePath,
        }),
      ),
    ).toThrow(/Linux|native installation path/);
  }

  const foreignPaths = [
    recipient({ platform: "windows", bundlePath: "/Applications/pi-gui.app" }),
    recipient({ platform: "macos", bundlePath: "C:\\Program Files\\pi-gui\\pi-gui.exe" }),
    recipient({
      platform: "linux",
      bundleIdentifier: null,
      bundlePath: "/Applications/pi-gui.app",
    }),
    recipient({ platform: "windows", bundlePath: "/usr/bin/pi-gui" }),
    recipient({
      platform: "linux",
      bundleIdentifier: null,
      bundlePath: "C:\\Program Files\\pi-gui\\pi-gui.exe",
    }),
  ];
  for (const foreignPath of foreignPaths) {
    expect(() => permission_decodeInstalledRecipient(foreignPath)).toThrow(
      /Windows|macOS|Linux|installed parent|native installation|drive-absolute/,
    );
  }

  const helperExecutable = recipient({
    platform: "windows",
    kind: "helper",
    displayName: "Notification helper",
    bundleIdentifier: null,
    bundlePath: "C:\\Program Files\\pi-gui\\pi-gui-helper.exe",
    identityKey: "windows-helper-v1",
  });
  expect(permission_decodeInstalledRecipient(helperExecutable).kind).toBe("helper");
  expect(() =>
    permission_decodeInstalledRecipient({
      ...helperExecutable,
      kind: "main-app",
      bundlePath: "/Applications/pi-gui.app",
    }),
  ).toThrow(/Windows|drive-absolute|executable/);

  expect(() =>
    permission_decodeInstalledRecipient(
      recipient({
        platform: "windows",
        bundlePath: `C:\\Program Files\\${"a".repeat(1_030)}.exe`,
      }),
    ),
  ).toThrow(/bounded string/);
  const accessor = {
    ...recipient({
      platform: "windows",
      bundlePath: "C:\\Program Files\\pi-gui\\pi-gui.exe",
    }),
  };
  Object.defineProperty(accessor, "bundlePath", {
    enumerable: true,
    get: () => "C:\\Program Files\\pi-gui\\pi-gui.exe",
  });
  expect(() => permission_decodeInstalledRecipient(accessor)).toThrow(/enumerable data/);

  expect(() =>
    permission_decodeInstalledRecipient({
      ...windowsRecipient,
      identitySource: "unverified",
    }),
  ).toThrow(/verified identity evidence/);
  expect(
    permission_decodeInstalledRecipient({
      ...windowsRecipient,
      status: "ambiguous",
      reasonCode: "package-unverified",
    }).status,
  ).toBe("ambiguous");
});

test("Windows reserved DOS device names are rejected in every path component form", () => {
  expect(permission_windowsReservedDeviceNames).toHaveLength(22);
  for (const reservedName of permission_windowsReservedDeviceNames) {
    const alternatingCase = [...reservedName]
      .map((character, index) => (index % 2 === 0 ? character : character.toLowerCase()))
      .join("");
    const variants = [
      reservedName,
      reservedName.toLowerCase(),
      alternatingCase,
      `${reservedName}.exe`,
      `${reservedName}.tools`,
      `${reservedName}...`,
      `${reservedName}   `,
      `${reservedName} .txt`,
    ];
    for (const component of variants) {
      expect(permission_isWindowsReservedDeviceComponent(component)).toBe(true);
      for (const bundlePath of [
        `C:\\Program Files\\pi-gui\\${component}`,
        `C:\\Program Files\\pi-gui\\${component}\\pi-gui.exe`,
      ]) {
        expect(permission_isWindowsInstalledExecutablePath(bundlePath)).toBe(false);
        expect(() =>
          permission_decodeInstalledRecipient(
            recipient({
              platform: "windows",
              bundlePath,
            }),
          ),
        ).toThrow(/Windows|drive-absolute|executable|bounded string/);
      }
    }
    for (const leaf of [
      `${reservedName}.exe`,
      `${alternatingCase}.exe`,
      `${reservedName} .exe`,
      `${reservedName}...exe`,
      `${reservedName}.txt.exe`,
    ]) {
      const bundlePath = `C:\\Program Files\\pi-gui\\${leaf}`;
      expect(permission_isWindowsInstalledExecutablePath(bundlePath)).toBe(false);
      expect(() =>
        permission_decodeInstalledRecipient(
          recipient({
            platform: "windows",
            bundlePath,
          }),
        ),
      ).toThrow(/Windows|drive-absolute|executable|bounded string/);
    }
  }

  for (const filename of [
    "CONSOLE.exe",
    "prn-helper.exe",
    "AUXILIARY.exe",
    "nullsafe.exe",
    "COM0.exe",
    "COM10.exe",
    "COM1TOOL.exe",
    "LPT0.exe",
    "LPT9BACKUP.exe",
    "agent.exe",
  ]) {
    const bundlePath = `C:\\Program Files\\pi-gui\\${filename}`;
    expect(permission_isWindowsReservedDeviceComponent(filename)).toBe(false);
    expect(permission_isWindowsInstalledExecutablePath(bundlePath)).toBe(true);
    expect(
      permission_decodeInstalledRecipient(
        recipient({
          platform: "windows",
          bundlePath,
        }),
      ).bundlePath,
    ).toBe(bundlePath);
  }
});

test("pane evidence cannot use fixture data to claim native drag support", () => {
  const paneEvidence = {
    schemaVersion: permission_schemaVersion,
    evidenceId: "pane-evidence-1",
    recordedAt: at,
    pane: "accessibility",
    dragEvidence: "verified",
    source: "native",
    binding: binding({ capabilityId: "accessibility" }),
  };
  expect(permission_decodePaneEvidence(paneEvidence).dragEvidence).toBe("verified");
  expect(() =>
    permission_decodePaneEvidence({
      ...paneEvidence,
      source: "fixture",
    }),
  ).toThrow(/fixture evidence/);

  const feature = permission_decodeFeatureOperation({
    schemaVersion: permission_schemaVersion,
    kind: "feature-operation",
    evidenceId: "feature-fixture",
    recordedAt: at,
    binding: binding(),
    state: "succeeded",
    source: "fixture",
    reasonCode: null,
  });
  expect(feature.source).toBe("fixture");
});

test("every pane evidence type rejects cross-product capability associations", () => {
  for (const pane of permission_panes) {
    const matchingBinding = paneBinding(pane);
    expect(
      permission_decodeDragOutcome({
        schemaVersion: permission_schemaVersion,
        kind: "installed-app-drag",
        evidenceId: `drag-${pane}`,
        recordedAt: at,
        binding: matchingBinding,
        pane,
        result: "unsupported",
        source: "application",
        reasonCode: "not-implemented",
      }).pane,
    ).toBe(pane);
    expect(
      permission_decodeRevealAttempt({
        schemaVersion: permission_schemaVersion,
        kind: "installed-app-reveal",
        evidenceId: `reveal-${pane}`,
        recordedAt: at,
        binding: matchingBinding,
        pane,
        action: "show-in-finder",
        state: "accepted",
        source: "application",
        reasonCode: null,
      }).pane,
    ).toBe(pane);
    expect(
      permission_decodePaneEvidence({
        schemaVersion: permission_schemaVersion,
        evidenceId: `pane-evidence-${pane}`,
        recordedAt: at,
        pane,
        dragEvidence: "verified",
        source: "native",
        binding: matchingBinding,
      }).pane,
    ).toBe(pane);

    for (const foreignPane of permission_panes.filter((candidate) => candidate !== pane)) {
      const foreignBinding = paneBinding(foreignPane);
      expect(() =>
        permission_decodeDragOutcome({
          schemaVersion: permission_schemaVersion,
          kind: "installed-app-drag",
          evidenceId: `drag-${pane}-foreign-${foreignPane}`,
          recordedAt: at,
          binding: foreignBinding,
          pane,
          result: "unsupported",
          source: "application",
          reasonCode: "not-implemented",
        }),
      ).toThrow(/pane.*capability/);
      expect(() =>
        permission_decodeRevealAttempt({
          schemaVersion: permission_schemaVersion,
          kind: "installed-app-reveal",
          evidenceId: `reveal-${pane}-foreign-${foreignPane}`,
          recordedAt: at,
          binding: foreignBinding,
          pane,
          action: "show-in-finder",
          state: "accepted",
          source: "application",
          reasonCode: null,
        }),
      ).toThrow(/pane.*capability/);
      expect(() =>
        permission_decodePaneEvidence({
          schemaVersion: permission_schemaVersion,
          evidenceId: `pane-evidence-${pane}-foreign-${foreignPane}`,
          recordedAt: at,
          pane,
          dragEvidence: "verified",
          source: "native",
          binding: foreignBinding,
        }),
      ).toThrow(/pane.*capability/);
    }
  }
});

test("dedicated decoders reject malformed outcome-specific fields", () => {
  expect(() =>
    permission_decodeSettingsOpenAttempt({
      schemaVersion: permission_schemaVersion,
      kind: "settings-open-attempt",
      evidenceId: "settings-failed",
      recordedAt: at,
      binding: binding(),
      state: "failed",
      source: "application",
      reasonCode: null,
    }),
  ).toThrow(/reason code/);
  expect(() =>
    permission_decodeSettingsOpenAttempt({
      schemaVersion: permission_schemaVersion,
      kind: "settings-open-attempt",
      evidenceId: "settings-accepted",
      recordedAt: at,
      binding: binding(),
      state: "accepted",
      source: "application",
      reasonCode: "probe-failed",
    }),
  ).toThrow(/cannot carry/);
  expect(() =>
    permission_decodeRequestOutcome({
      schemaVersion: permission_schemaVersion,
      kind: "permission-request",
      evidenceId: "request-denied",
      recordedAt: at,
      binding: binding(),
      state: "denied",
      source: "native",
      reasonCode: null,
    }),
  ).toThrow(/reason code/);
  expect(() =>
    permission_decodeAuthorizationObservation(
      evidence({
        authorization: "denied",
        reasonCode: null,
      }),
    ),
  ).toThrow(/denied authorization requires/);
  expect(() =>
    permission_decodeRevealAttempt({
      schemaVersion: permission_schemaVersion,
      kind: "installed-app-reveal",
      evidenceId: "reveal-1",
      recordedAt: at,
      binding: binding(),
      action: "open-settings",
      state: "accepted",
      source: "application",
      reasonCode: null,
    }),
  ).toThrow(/action/);
  expect(() =>
    permission_decodeDragOutcome({
      schemaVersion: permission_schemaVersion,
      kind: "installed-app-drag",
      evidenceId: "drag-1",
      recordedAt: at,
      binding: binding(),
      pane: "notifications",
      result: "failed",
      source: "native",
      reasonCode: null,
    }),
  ).toThrow(/reason code/);
  expect(() =>
    permission_decodeFeatureOperation({
      schemaVersion: permission_schemaVersion,
      kind: "feature-operation",
      evidenceId: "feature-1",
      recordedAt: at,
      binding: binding(),
      state: "unknown",
      source: "native",
      reasonCode: null,
    }),
  ).toThrow(/reason code/);
});
