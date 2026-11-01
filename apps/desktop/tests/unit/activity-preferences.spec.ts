import { expect, test } from "@playwright/test";
import {
  sidebarPreferences_activityStyles,
  sidebarPreferences_decideLegacyActivityMigration,
  sidebarPreferences_decodeActivityPreferenceSnapshot,
  sidebarPreferences_decodeActivityPreferenceSource,
  sidebarPreferences_decodeActivityStyle,
  sidebarPreferences_decodeDurableActivityPreference,
  sidebarPreferences_decodeLegacyActivityStyle,
  sidebarPreferences_decodePersistedActivitySource,
  sidebarPreferences_defaultActivityStyle,
  sidebarPreferences_provisionalActivityPreference,
  type PersistedActivityIndicatorPreference,
} from "../../contracts/sidebar-preferences";

test("the six activity IDs and provisional moonwalk default are exact", () => {
  expect(sidebarPreferences_activityStyles).toEqual([
    "moonwalk",
    "stick",
    "wheel",
    "ball",
    "wave",
    "spiral",
  ]);
  expect(sidebarPreferences_defaultActivityStyle).toBe("moonwalk");
  expect(Object.isFrozen(sidebarPreferences_activityStyles)).toBe(true);
  expect(sidebarPreferences_provisionalActivityPreference).toEqual({
    style: "moonwalk",
    source: "provisional",
  });
  expect(Object.isFrozen(sidebarPreferences_provisionalActivityPreference)).toBe(true);
});

test("style, provenance, durable preference, and snapshot decoders fail closed", () => {
  for (const style of sidebarPreferences_activityStyles) {
    expect(sidebarPreferences_decodeActivityStyle(style)).toBe(style);
    expect(sidebarPreferences_decodeLegacyActivityStyle(style)).toBe(style);
  }

  for (const invalid of ["Moonwalk", "dancing-stick", "unknown", "", null, 1, {}, ["moonwalk"]]) {
    expect(() => sidebarPreferences_decodeActivityStyle(invalid)).toThrow(
      "Invalid activity indicator style",
    );
    expect(sidebarPreferences_decodeLegacyActivityStyle(invalid)).toBeUndefined();
  }

  expect(sidebarPreferences_decodeActivityPreferenceSource("provisional")).toBe("provisional");
  expect(sidebarPreferences_decodeActivityPreferenceSource("user")).toBe("user");
  expect(sidebarPreferences_decodeActivityPreferenceSource("legacy-migrated")).toBe(
    "legacy-migrated",
  );
  expect(sidebarPreferences_decodePersistedActivitySource("user")).toBe("user");
  expect(sidebarPreferences_decodePersistedActivitySource("legacy-migrated")).toBe(
    "legacy-migrated",
  );
  expect(() => sidebarPreferences_decodePersistedActivitySource("provisional")).toThrow(
    "Invalid persisted activity indicator preference source",
  );

  expect(
    sidebarPreferences_decodeDurableActivityPreference({
      style: "spiral",
      source: "user",
    }),
  ).toEqual({ style: "spiral", source: "user" });
  expect(
    sidebarPreferences_decodeActivityPreferenceSnapshot({
      style: "moonwalk",
      source: "provisional",
    }),
  ).toEqual({ style: "moonwalk", source: "provisional" });

  for (const invalid of [
    null,
    [],
    { style: "spiral" },
    { style: "spiral", source: "user", extra: true },
    { style: "unknown", source: "user" },
    { style: "spiral", source: "provisional" },
  ]) {
    expect(() => sidebarPreferences_decodeDurableActivityPreference(invalid)).toThrow();
  }
});

test("snapshot decoding accepts only the complete valid style/source cross-product", () => {
  expect(
    sidebarPreferences_decodeActivityPreferenceSnapshot({
      style: "moonwalk",
      source: "provisional",
    }),
  ).toEqual({ style: "moonwalk", source: "provisional" });

  for (const style of sidebarPreferences_activityStyles) {
    if (style === "moonwalk") continue;
    expect(() =>
      sidebarPreferences_decodeActivityPreferenceSnapshot({
        style,
        source: "provisional",
      }),
    ).toThrow("Provisional activity indicator preference must be moonwalk");
  }

  for (const source of ["user", "legacy-migrated"] as const) {
    for (const style of sidebarPreferences_activityStyles) {
      expect(sidebarPreferences_decodeActivityPreferenceSnapshot({ style, source })).toEqual({
        style,
        source,
      });
    }
  }

  for (const invalid of [
    { style: "unknown", source: "user" },
    { style: "moonwalk", source: "unknown" },
    { style: "spiral", source: "unknown" },
  ]) {
    expect(() => sidebarPreferences_decodeActivityPreferenceSnapshot(invalid)).toThrow();
  }
});

test("durable preference and snapshot decoders never invoke caller accessors", () => {
  let getterCalls = 0;
  const accessorPreference: Record<string, unknown> = { source: "user" };
  Object.defineProperty(accessorPreference, "style", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "spiral";
    },
  });
  expect(() => sidebarPreferences_decodeDurableActivityPreference(accessorPreference)).toThrow(
    /data properties/,
  );
  expect(getterCalls).toBe(0);

  const unknownAccessor: Record<string, unknown> = {
    style: "spiral",
    source: "user",
  };
  Object.defineProperty(unknownAccessor, "extra", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "not-read";
    },
  });
  expect(() => sidebarPreferences_decodeActivityPreferenceSnapshot(unknownAccessor)).toThrow(
    /data properties/,
  );
  expect(getterCalls).toBe(0);

  const sourceAccessor: Record<string, unknown> = { style: "moonwalk" };
  Object.defineProperty(sourceAccessor, "source", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "provisional";
    },
  });
  expect(() => sidebarPreferences_decodeActivityPreferenceSnapshot(sourceAccessor)).toThrow(
    /data properties/,
  );
  expect(getterCalls).toBe(0);

  const styleAccessor: Record<string, unknown> = { source: "legacy-migrated" };
  Object.defineProperty(styleAccessor, "style", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "wheel";
    },
  });
  expect(() => sidebarPreferences_decodeActivityPreferenceSnapshot(styleAccessor)).toThrow(
    /data properties/,
  );
  expect(getterCalls).toBe(0);
});

test("legacy migration gives a durable preference deterministic precedence", () => {
  const userPreference: PersistedActivityIndicatorPreference = Object.freeze({
    style: "moonwalk",
    source: "user",
  });
  for (const legacyValue of ["spiral", "unknown", "", undefined, null]) {
    expect(sidebarPreferences_decideLegacyActivityMigration(userPreference, legacyValue)).toEqual({
      status: "already-set",
      preference: userPreference,
    });
  }

  let getterCalls = 0;
  const accessorLegacy: Record<string, unknown> = {};
  Object.defineProperty(accessorLegacy, "style", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "spiral";
    },
  });
  expect(sidebarPreferences_decideLegacyActivityMigration(userPreference, accessorLegacy)).toEqual({
    status: "already-set",
    preference: userPreference,
  });
  expect(getterCalls).toBe(0);

  const legacyPreference: PersistedActivityIndicatorPreference = Object.freeze({
    style: "wheel",
    source: "legacy-migrated",
  });
  expect(sidebarPreferences_decideLegacyActivityMigration(legacyPreference, "unknown")).toEqual({
    status: "already-set",
    preference: legacyPreference,
  });
});

test("migration applies only a valid legacy value while durable state is absent", () => {
  expect(sidebarPreferences_decideLegacyActivityMigration(undefined, "spiral")).toEqual({
    status: "applied",
    preference: {
      style: "spiral",
      source: "legacy-migrated",
    },
  });

  for (const invalid of ["unknown", "", undefined, null, 0, {}, ["spiral"]]) {
    expect(sidebarPreferences_decideLegacyActivityMigration(undefined, invalid)).toEqual({
      status: "no-legacy",
      preference: undefined,
    });
  }

  const applied = sidebarPreferences_decideLegacyActivityMigration(undefined, "moonwalk");
  expect(applied.status).toBe("applied");
  expect(Object.isFrozen(applied)).toBe(true);
  expect(Object.isFrozen(applied.preference)).toBe(true);
});
