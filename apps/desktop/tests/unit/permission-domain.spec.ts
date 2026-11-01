import { expect, test } from "@playwright/test";
import {
  permission_paneCapabilityIds,
  permission_panes,
  permission_schemaVersion,
  type InstalledRecipient,
  type PermissionBinding,
  type PermissionCapabilityDescriptor,
  type PermissionPaneEvidence,
  type PermissionScope,
  type PermissionSupportTuple,
} from "../../contracts/permissions";
import {
  permission_applicability,
  permission_domain_applyEvidence,
  permission_domain_createState,
  permission_drag_outcome,
  permission_error,
  permission_feature_receipt,
  permission_installed_app_identity,
  permission_observation,
  permission_pane_guidance,
  permission_recovery,
  permission_request_outcome,
  permission_reveal_outcome,
  permission_settings_open_outcome,
} from "../../electron/permissions/permission-domain";

const at = 1_764_000_000_000;

function mainRecipient(overrides: Partial<InstalledRecipient> = {}): InstalledRecipient {
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
    recipient: mainRecipient(),
    generation: 9,
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

function authorization(
  status:
    | "not-determined"
    | "denied"
    | "authorized"
    | "provisional"
    | "ephemeral"
    | "restricted-managed"
    | "unsupported"
    | "unavailable"
    | "unknown",
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: permission_schemaVersion,
    kind: "reported-authorization",
    evidenceId: `auth-${status}`,
    recordedAt: at,
    binding: binding(),
    authorization: status,
    source:
      status === "unsupported" || status === "unavailable" || status === "unknown"
        ? "capability-probe"
        : "native",
    reasonCode:
      status === "unsupported"
        ? "not-implemented"
        : status === "unavailable" || status === "unknown"
          ? "probe-failed"
          : status === "restricted-managed"
            ? "managed-restriction"
            : status === "denied"
              ? "access-denied"
              : null,
    ...overrides,
  };
}

function settingsAttempt(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: permission_schemaVersion,
    kind: "settings-open-attempt",
    evidenceId: "settings-1",
    recordedAt: at,
    binding: binding(),
    state: "accepted",
    source: "application",
    reasonCode: null,
    ...overrides,
  };
}

function feature(
  state:
    "succeeded" | "denied" | "cancelled" | "failed" | "unsupported" | "unavailable" | "unknown",
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: permission_schemaVersion,
    kind: "feature-operation",
    evidenceId: `feature-${state}`,
    recordedAt: at + 4,
    binding: binding(),
    state,
    source: "native",
    reasonCode:
      state === "succeeded"
        ? null
        : state === "denied"
          ? "access-denied"
          : state === "cancelled"
            ? "cancelled"
            : state === "unsupported"
              ? "not-implemented"
              : state === "unavailable"
                ? "probe-failed"
                : "unknown",
    ...overrides,
  };
}

function drag(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: permission_schemaVersion,
    kind: "installed-app-drag",
    evidenceId: "drag-1",
    recordedAt: at + 3,
    binding: binding(),
    pane: "notifications",
    result: "unsupported",
    source: "native",
    reasonCode: "not-implemented",
    ...overrides,
  };
}

function reveal(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: permission_schemaVersion,
    kind: "installed-app-reveal",
    evidenceId: "reveal-1",
    recordedAt: at + 2,
    binding: binding(),
    pane: "notifications",
    action: "show-in-finder",
    state: "accepted",
    source: "application",
    reasonCode: null,
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: permission_schemaVersion,
    kind: "permission-request",
    evidenceId: "request-1",
    recordedAt: at + 1,
    binding: binding(),
    state: "accepted",
    source: "native",
    reasonCode: null,
    ...overrides,
  };
}

function paneEvidence(
  pane: PermissionPaneEvidence["pane"],
  bindingValue: PermissionBinding,
  overrides: Partial<PermissionPaneEvidence> = {},
): PermissionPaneEvidence {
  return {
    schemaVersion: permission_schemaVersion,
    evidenceId: `pane-${pane}`,
    recordedAt: at + 5,
    pane,
    dragEvidence: "verified",
    source: "native",
    binding: bindingValue,
    ...overrides,
  };
}

test("supplied support tuple, not the capability enum, controls applicability", () => {
  const descriptor: PermissionCapabilityDescriptor = {
    capabilityId: "notifications",
    platform: "macos",
    scopeKinds: ["app-default"],
    support: [{ support: support(), status: "supported" }],
  };
  expect(permission_applicability(descriptor, support(), scope())).toBe("supported");
  expect(
    permission_applicability(descriptor, support({ osBuild: "different-build" }), scope()),
  ).toBe("unsupported");
  expect(
    permission_applicability(descriptor, support(), scope({ kind: "selected-resource" })),
  ).toBe("unsupported");
  expect(
    permission_applicability(
      {
        ...descriptor,
        support: [{ support: support(), status: "unavailable" }],
      },
      support(),
      scope(),
    ),
  ).toBe("unavailable");
  expect(
    permission_applicability(
      {
        ...descriptor,
        support: [{ support: support(), status: "unknown" }],
      },
      support(),
      scope(),
    ),
  ).toBe("unknown");
});

test("pane matrix keeps manual Add, drag and installed identity as separate gates", () => {
  const cases = [
    ["accessibility", "documented"],
    ["screen-and-system-audio-recording", "documented"],
    ["automation", "not-documented"],
    ["files-and-folders", "not-documented"],
    ["camera", "not-documented"],
    ["microphone", "not-documented"],
    ["notifications", "not-documented"],
    ["full-disk-access", "documented"],
  ] as const;
  for (const [pane, manualAdd] of cases) {
    const capabilityId =
      pane === "files-and-folders"
        ? "selected-files"
        : pane === "screen-and-system-audio-recording"
          ? "screen-capture"
          : pane;
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
    const paneScopeKey = `${pane}-scope`;
    const paneBinding = binding({
      capabilityId,
      scope: scope({ kind: scopeKind, scopeKey: paneScopeKey }),
      support: support({ scopeKey: paneScopeKey }),
    });
    const guidance = permission_pane_guidance(mainRecipient(), pane, paneBinding);
    expect(guidance.manualAdd).toBe(manualAdd);
    expect(guidance.dragAcceptance).toBe(
      pane === "full-disk-access" ? "prohibited" : "unavailable",
    );
    expect(guidance.showInFinder).toBe(pane === "full-disk-access" ? "unavailable" : "available");
    expect(guidance.openAttempt).toBe("not-attempted");
    if (pane === "full-disk-access") {
      expect(guidance.recovery).toContain("select-narrower-resource");
    }
  }
});

test("exact native pane evidence enables drag; mismatches and fixture evidence do not", () => {
  const exactBinding = binding({
    capabilityId: "accessibility",
    scope: scope({ kind: "named-operation", scopeKey: "accessibility-scope" }),
    support: support({ scopeKey: "accessibility-scope" }),
  });
  const evidence = paneEvidence("accessibility", exactBinding);
  expect(
    permission_pane_guidance(mainRecipient(), "accessibility", exactBinding, evidence)
      .dragAcceptance,
  ).toBe("available");
  expect(
    permission_pane_guidance(
      mainRecipient(),
      "accessibility",
      exactBinding,
      paneEvidence("accessibility", exactBinding, {
        binding: binding({
          capabilityId: "accessibility",
          generation: 10,
          scope: scope({
            kind: "named-operation",
            scopeKey: "accessibility-scope",
            generation: 10,
          }),
          support: support({ scopeKey: "accessibility-scope" }),
        }),
      }),
    ).dragAcceptance,
  ).toBe("unavailable");
  expect(
    permission_pane_guidance(
      mainRecipient(),
      "accessibility",
      exactBinding,
      paneEvidence("accessibility", exactBinding, {
        binding: binding({
          capabilityId: "accessibility",
          scope: scope({ kind: "named-operation", scopeKey: "accessibility-other" }),
          support: support({ scopeKey: "accessibility-other" }),
        }),
      }),
    ).dragAcceptance,
  ).toBe("unavailable");
  expect(
    permission_pane_guidance(
      mainRecipient(),
      "accessibility",
      exactBinding,
      paneEvidence("accessibility", exactBinding, {
        binding: binding({
          capabilityId: "accessibility",
          scope: scope({ kind: "named-operation", scopeKey: "accessibility-scope" }),
          recipient: mainRecipient({ identityKey: "other-installed-parent" }),
          support: support({
            installedIdentityKey: "other-installed-parent",
            scopeKey: "accessibility-scope",
          }),
        }),
      }),
    ).dragAcceptance,
  ).toBe("unavailable");
});

test("cross-product pane evidence never enables or validates an installed-app action", () => {
  for (const pane of permission_panes) {
    const matchingBinding = paneBinding(pane);
    for (const foreignPane of permission_panes.filter((candidate) => candidate !== pane)) {
      const foreignBinding = paneBinding(foreignPane);
      const dragAcceptance = permission_pane_guidance(
        mainRecipient(),
        pane,
        matchingBinding,
        paneEvidence(foreignPane, foreignBinding),
      ).dragAcceptance;
      expect(["unavailable", "prohibited"]).toContain(dragAcceptance);
      expect(dragAcceptance).not.toBe("available");
      expect(() =>
        permission_drag_outcome(
          drag({
            binding: foreignBinding,
            pane,
            result: "started",
            source: "native",
            reasonCode: null,
          }),
        ),
      ).toThrow(/pane.*capability/);
      expect(() =>
        permission_reveal_outcome(
          reveal({
            binding: foreignBinding,
            pane,
          }),
        ),
      ).toThrow(/pane.*capability/);
    }
  }
});

test("helper, browser, companion and ambiguous recipients cannot drive installed-app actions", () => {
  const notificationBinding = binding();
  const unsafeRecipients = [
    mainRecipient({
      kind: "helper",
      displayName: "helper",
      bundleIdentifier: "com.pi-gui.helper",
      bundlePath:
        "/Applications/pi-gui Candidate.app/Contents/MacOS/pi-gui-notification-status-helper",
      identityKey: "helper-v1",
    }),
    mainRecipient({
      kind: "browser",
      displayName: "Edge",
      bundleIdentifier: "com.microsoft.edgemac",
      bundlePath: "/Applications/Microsoft Edge.app",
      identityKey: "browser-edge",
    }),
    mainRecipient({
      kind: "companion",
      displayName: "Companion",
      bundleIdentifier: "com.pi-gui.companion",
      bundlePath: "/Applications/Companion",
      identityKey: "companion-v1",
    }),
    mainRecipient({
      status: "ambiguous",
      identitySource: "unverified",
      displayName: null,
      bundleIdentifier: null,
      bundlePath: null,
      reasonCode: "identity-ambiguous",
    }),
  ];
  for (const unsafeRecipient of unsafeRecipients) {
    const unsafeBinding = binding({
      recipient: unsafeRecipient,
      support: support({ installedIdentityKey: unsafeRecipient.identityKey }),
    });
    const guidance = permission_pane_guidance(
      permission_installed_app_identity(unsafeRecipient),
      "notifications",
      unsafeBinding,
    );
    expect(guidance.showInFinder).toBe("unavailable");
    expect(guidance.dragAcceptance).toBe("unavailable");
  }
  expect(notificationBinding.recipient.kind).toBe("main-app");
  const spoofedRecipient = mainRecipient();
  const helperBinding = binding({
    recipient: mainRecipient({
      kind: "helper",
      displayName: "same-key helper",
      bundleIdentifier: "com.pi-gui.helper",
      bundlePath: "/Applications/pi-gui Candidate.app/Contents/MacOS/helper",
    }),
  });
  expect(() => permission_pane_guidance(spoofedRecipient, "notifications", helperBinding)).toThrow(
    /recipient, capability, and binding differ/,
  );
});

test("temporary development bundles cannot enable installed-app actions", () => {
  const temporaryRecipient = mainRecipient({
    bundlePath: "/tmp/pi-gui Candidate.app",
    identitySource: "installed-package",
  });
  const temporaryBinding = binding({ recipient: temporaryRecipient });
  expect(
    permission_pane_guidance(temporaryRecipient, "notifications", temporaryBinding),
  ).toMatchObject({
    showInFinder: "unavailable",
    dragAcceptance: "unavailable",
  });
  expect(() =>
    permission_reveal_outcome(
      reveal({
        binding: temporaryBinding,
      }),
    ),
  ).toThrow(/installed parent/);
  expect(() =>
    permission_drag_outcome(
      drag({
        binding: temporaryBinding,
        pane: "accessibility",
        result: "started",
        source: "native",
        reasonCode: null,
      }),
    ),
  ).toThrow(/installed parent/);

  const packagedButAmbiguous = mainRecipient({
    status: "ambiguous",
    reasonCode: "package-unverified",
  });
  const ambiguousBinding = binding({ recipient: packagedButAmbiguous });
  expect(
    permission_pane_guidance(packagedButAmbiguous, "notifications", ambiguousBinding),
  ).toMatchObject({
    showInFinder: "unavailable",
    dragAcceptance: "unavailable",
  });
});

test("platform-specific recipients validate without enabling mac installed-app actions", () => {
  const windowsRecipient = mainRecipient({
    platform: "windows",
    bundleIdentifier: null,
    bundlePath: "C:\\Program Files\\pi-gui\\pi-gui.exe",
  });
  const windowsBinding = binding({
    platform: "windows",
    recipient: windowsRecipient,
    support: support({ platform: "windows" }),
  });
  expect(permission_installed_app_identity(windowsRecipient).platform).toBe("windows");
  expect(permission_pane_guidance(windowsRecipient, "notifications", windowsBinding)).toMatchObject(
    {
      showInFinder: "unavailable",
      dragAcceptance: "unavailable",
    },
  );
  expect(() =>
    permission_reveal_outcome(
      reveal({
        binding: windowsBinding,
      }),
    ),
  ).toThrow(/verified installed parent/);

  const linuxRecipient = mainRecipient({
    platform: "linux",
    bundleIdentifier: null,
    bundlePath: "/usr/bin/pi-gui",
  });
  const linuxBinding = binding({
    platform: "linux",
    recipient: linuxRecipient,
    support: support({ platform: "linux" }),
  });
  expect(permission_installed_app_identity(linuxRecipient).platform).toBe("linux");
  expect(permission_pane_guidance(linuxRecipient, "notifications", linuxBinding)).toMatchObject({
    showInFinder: "unavailable",
    dragAcceptance: "unavailable",
  });

  const windowsHelper = mainRecipient({
    platform: "windows",
    kind: "helper",
    displayName: "Notification helper",
    bundleIdentifier: null,
    bundlePath: "C:\\Program Files\\pi-gui\\pi-gui-helper.exe",
    identityKey: "windows-helper-v1",
  });
  const windowsHelperBinding = binding({
    platform: "windows",
    recipient: windowsHelper,
    support: support({ platform: "windows", installedIdentityKey: windowsHelper.identityKey }),
  });
  expect(
    permission_pane_guidance(windowsHelper, "notifications", windowsHelperBinding),
  ).toMatchObject({
    showInFinder: "unavailable",
    dragAcceptance: "unavailable",
  });

  const windowsAccessibilityBinding = binding({
    capabilityId: "accessibility",
    platform: "windows",
    recipient: windowsRecipient,
    scope: scope({ kind: "named-operation", scopeKey: "accessibility-scope" }),
    support: support({ platform: "windows", scopeKey: "accessibility-scope" }),
  });
  expect(() =>
    permission_drag_outcome(
      drag({
        binding: windowsAccessibilityBinding,
        pane: "accessibility",
        result: "started",
        source: "native",
        reasonCode: null,
      }),
    ),
  ).toThrow(/installed-app pane/);

  expect(() =>
    permission_installed_app_identity({
      ...windowsRecipient,
      identitySource: "unverified",
    }),
  ).toThrow(/verified identity evidence/);
  const ambiguousWindowsRecipient = {
    ...windowsRecipient,
    status: "ambiguous" as const,
    reasonCode: "package-unverified" as const,
  };
  const ambiguousWindowsBinding = binding({
    platform: "windows",
    recipient: ambiguousWindowsRecipient,
    support: support({ platform: "windows" }),
  });
  expect(
    permission_pane_guidance(ambiguousWindowsRecipient, "notifications", ambiguousWindowsBinding),
  ).toMatchObject({
    showInFinder: "unavailable",
    dragAcceptance: "unavailable",
  });
});

test("feature success and interaction receipts never create authorization", () => {
  const initial = permission_domain_createState(binding());
  const actionState = [settingsAttempt(), request(), reveal(), drag(), feature("succeeded")].reduce(
    (state, item) => permission_domain_applyEvidence(state, item),
    initial,
  );
  expect(actionState.authorization).toBeNull();

  const authorized = permission_domain_applyEvidence(
    actionState,
    authorization("authorized", {
      evidenceId: "auth-after-actions",
      recordedAt: at + 6,
    }),
  );
  expect(authorized.authorization?.authorization).toBe("authorized");
  const failedFeature = permission_domain_applyEvidence(
    authorized,
    feature("failed", {
      evidenceId: "feature-failed-after-grant",
      recordedAt: at + 8,
    }),
  );
  expect(failedFeature.authorization?.authorization).toBe("authorized");
  expect(failedFeature.appliedEvidence.at(-1)?.kind).toBe("feature-operation");

  const lateReveal = permission_domain_applyEvidence(
    failedFeature,
    reveal({ evidenceId: "reveal-after-grant", recordedAt: at + 9 }),
  );
  expect(lateReveal.authorization?.authorization).toBe("authorized");
});

test("request and observation decoders preserve provisional, ephemeral and browser source", () => {
  expect(permission_observation(authorization("provisional")).authorization).toBe("provisional");
  expect(permission_observation(authorization("ephemeral")).authorization).toBe("ephemeral");
  const browserDenied = permission_observation(
    authorization("denied", {
      source: "browser",
      reasonCode: "access-denied",
    }),
  );
  expect(browserDenied.source).toBe("browser");
  expect(
    permission_request_outcome(request({ state: "cancelled", reasonCode: "cancelled" })).state,
  ).toBe("cancelled");
  expect(permission_settings_open_outcome(settingsAttempt()).state).toBe("accepted");
  expect(permission_reveal_outcome(reveal()).action).toBe("show-in-finder");
  expect(permission_drag_outcome(drag()).result).toBe("unsupported");
  expect(permission_feature_receipt(feature("succeeded")).state).toBe("succeeded");
});

test("accepted reveal and started drag reject helper substitution", () => {
  const helper = mainRecipient({
    kind: "helper",
    displayName: "Notification helper",
    bundleIdentifier: "com.pi-gui.desktop.candidate.helper",
    bundlePath: "/Applications/pi-gui Candidate.app/Contents/MacOS/notification-helper",
    identityKey: "helper-v1",
  });
  const helperBinding = binding({
    recipient: helper,
    support: support({ installedIdentityKey: helper.identityKey }),
  });
  expect(() => permission_reveal_outcome(reveal({ binding: helperBinding }))).toThrow(
    /verified installed parent/,
  );
  expect(() =>
    permission_drag_outcome(
      drag({
        binding: helperBinding,
        pane: "notifications",
        result: "started",
        reasonCode: null,
      }),
    ),
  ).toThrow(/installed-app pane/);
  const fullDiskBinding = binding({
    capabilityId: "full-disk-access",
  });
  expect(() =>
    permission_drag_outcome(
      drag({
        binding: fullDiskBinding,
        pane: "full-disk-access",
        result: "started",
        reasonCode: null,
      }),
    ),
  ).toThrow(/installed-app pane/);
});

test("state rejects cross-recipient, scope, generation, support and stale evidence", () => {
  const state = permission_domain_createState(binding());
  const variants = [
    binding({
      recipient: mainRecipient({
        identityKey: "other-installed-parent",
        bundleIdentifier: "com.other.candidate",
        bundlePath: "/Applications/Other.app",
      }),
      support: support({ installedIdentityKey: "other-installed-parent" }),
    }),
    binding({
      scope: scope({ scopeKey: "notifications-other" }),
      support: support({ scopeKey: "notifications-other" }),
    }),
    binding({
      generation: 10,
      scope: scope({ generation: 10 }),
    }),
    binding({ support: support({ osBuild: "different-build" }) }),
  ];
  for (const mismatch of variants) {
    expect(() =>
      permission_domain_applyEvidence(state, authorization("authorized", { binding: mismatch })),
    ).toThrow(/generation differ|does not match/);
  }

  const current = permission_domain_applyEvidence(
    state,
    authorization("authorized", { evidenceId: "auth-current", recordedAt: at + 20 }),
  );
  expect(() =>
    permission_domain_applyEvidence(
      current,
      authorization("denied", { evidenceId: "auth-stale", recordedAt: at + 10 }),
    ),
  ).toThrow(/stale/);
  expect(() =>
    permission_domain_applyEvidence(
      current,
      authorization("denied", { evidenceId: "auth-tie", recordedAt: at + 20 }),
    ),
  ).toThrow(/stale or out of order/);
});

test("evidence ids cannot be reused with different content", () => {
  const initial = permission_domain_createState(binding());
  const accepted = permission_domain_applyEvidence(initial, request());
  expect(permission_domain_applyEvidence(accepted, request())).toBe(accepted);
  expect(() =>
    permission_domain_applyEvidence(
      accepted,
      request({
        state: "denied",
        reasonCode: "access-denied",
      }),
    ),
  ).toThrow(/reused/);
});

test("recovery keeps deny, unknown, managed, return, revoke, stale and restart distinct", () => {
  const denied = permission_recovery({
    schemaVersion: permission_schemaVersion,
    trigger: "denied",
    occurredAt: at + 1,
    evidence: authorization("denied"),
  });
  expect(denied.instructions).toContain("open-settings");
  expect(denied.instructions).toContain("keep-feature-fallback");
  expect(denied.instructions).not.toContain("feature-triggered-request");

  const unknown = permission_recovery({
    schemaVersion: permission_schemaVersion,
    trigger: "unknown",
    occurredAt: at + 1,
    evidence: authorization("unknown"),
  });
  expect(unknown.instructions).toContain("inspect-authorization");
  expect(unknown.instructions).not.toContain("open-settings");

  const managed = permission_recovery({
    schemaVersion: permission_schemaVersion,
    trigger: "restricted-managed",
    occurredAt: at + 1,
    evidence: authorization("restricted-managed"),
  });
  expect(managed.instructions).toContain("administrator-guidance");
  expect(managed.instructions).not.toContain("feature-triggered-request");

  const returned = permission_recovery({
    schemaVersion: permission_schemaVersion,
    trigger: "returned-from-settings",
    occurredAt: at + 2,
    evidence: settingsAttempt({ recordedAt: at + 1 }),
  });
  expect(returned.instructions).toEqual(["inspect-authorization"]);

  const revoked = permission_recovery({
    schemaVersion: permission_schemaVersion,
    trigger: "revoked",
    occurredAt: at + 1,
    evidence: authorization("denied", {
      reasonCode: "revoked",
    }),
  });
  expect(revoked.instructions).toContain("open-settings");

  const stale = permission_recovery({
    schemaVersion: permission_schemaVersion,
    trigger: "stale-scope",
    occurredAt: at + 8,
    evidence: feature("failed", {
      state: "failed",
      reasonCode: "stale-scope",
      recordedAt: at + 7,
    }),
  });
  expect(stale.instructions).toEqual(["reselect-scope", "inspect-authorization"]);

  const restart = permission_recovery({
    schemaVersion: permission_schemaVersion,
    trigger: "restart",
    occurredAt: at + 8,
    evidence: authorization("authorized", { recordedAt: at + 7 }),
  });
  expect(restart.instructions).toEqual(["inspect-authorization"]);
  expect(restart).toMatchObject({
    grantsAuthorization: false,
    reportsFeatureSuccess: false,
    requestsPermissionAction: false,
    requestsFeatureAction: false,
  });
});

test("recovery rejects evidence that does not support the requested transition", () => {
  expect(() =>
    permission_recovery({
      schemaVersion: permission_schemaVersion,
      trigger: "denied",
      occurredAt: at + 1,
      evidence: authorization("authorized"),
    }),
  ).toThrow(/denial recovery/);
  expect(() =>
    permission_recovery({
      schemaVersion: permission_schemaVersion,
      trigger: "returned-from-settings",
      occurredAt: at + 1,
      evidence: authorization("authorized"),
    }),
  ).toThrow(/Settings-open/);
  expect(() =>
    permission_recovery({
      schemaVersion: permission_schemaVersion,
      trigger: "unknown",
      occurredAt: at + 1,
      evidence: settingsAttempt(),
    }),
  ).toThrow(/reported authorization/);
  expect(() =>
    permission_recovery({
      schemaVersion: permission_schemaVersion,
      trigger: "revoked",
      occurredAt: at + 1,
      evidence: authorization("denied"),
    }),
  ).toThrow(/revocation/);
  expect(() =>
    permission_recovery({
      schemaVersion: permission_schemaVersion,
      trigger: "restart",
      occurredAt: at,
      evidence: authorization("authorized", { recordedAt: at + 1 }),
    }),
  ).toThrow(/postdate/);
  expect(() =>
    permission_recovery({
      schemaVersion: permission_schemaVersion,
      trigger: "stale-scope",
      occurredAt: at + 5,
      evidence: feature("failed", {
        reasonCode: "unknown",
      }),
    }),
  ).toThrow(/stale-scope evidence/);
});

test("errors expose only closed reasons and no raw native text tunnel", () => {
  expect(permission_error("stale-scope")).toMatchObject({
    reasonCode: "stale-scope",
    retry: "reselect",
    authorization: null,
    featureSucceeded: false,
  });
  expect(permission_error("SECRET_RAW_NATIVE_ERROR")).toEqual({
    kind: "permission-error",
    reasonCode: "unknown",
    retry: "inspect",
    authorization: null,
    featureSucceeded: false,
  });
});
