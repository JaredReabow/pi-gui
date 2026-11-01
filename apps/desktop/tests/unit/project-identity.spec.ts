import { expect, test } from "@playwright/test";
import { createEmptyDesktopAppState, type DesktopAppState } from "../../contracts/desktop-state";
import {
  projectIdentity_assignMissingAccents,
  projectIdentity_decodeAccentColors,
  projectIdentity_decodeColor,
  projectIdentity_decodeSetAccent,
  projectIdentity_effectiveByWorkspace,
  projectIdentity_maxAccentEntries,
  projectIdentity_maxWorkspaceIdLength,
  projectIdentity_presetColors,
  type ProjectAccentColor,
  type ProjectIdentityWorkspace,
} from "../../contracts/project-identity";
import { resolveRepoWorkspaceId } from "../../contracts/workspace-roots";

function workspace(
  id: string,
  path = `/workspaces/${id}`,
  rootWorkspaceId?: string,
): ProjectIdentityWorkspace {
  return rootWorkspaceId === undefined
    ? Object.freeze({ id, path })
    : Object.freeze({ id, path, rootWorkspaceId });
}

function colorMap(
  entries: readonly (readonly [string, ProjectAccentColor])[],
): Record<string, ProjectAccentColor> {
  return Object.fromEntries(entries);
}

function asPlainRecord(
  record: Readonly<Record<string, ProjectAccentColor>>,
): Record<string, ProjectAccentColor> {
  return Object.fromEntries(Object.entries(record));
}

test("colours normalize exactly and unsupported CSS or non-hex shapes reject", () => {
  expect(projectIdentity_decodeColor("#ABC")).toBe("#aabbcc");
  expect(projectIdentity_decodeColor(" #A1b2C3 ")).toBe("#a1b2c3");

  for (const invalid of [
    "",
    "#",
    "#12",
    "#1234",
    "#12345",
    "#1234567",
    "#ggg",
    "123456",
    "rgb(1, 2, 3)",
    "rebeccapurple",
    "currentColor",
    null,
    123,
    {},
  ]) {
    expect(() => projectIdentity_decodeColor(invalid), String(invalid)).toThrow(
      "Invalid project colour",
    );
  }
});

test("accent requests require exactly two own data fields without invoking accessors", () => {
  expect(projectIdentity_decodeSetAccent({ workspaceId: "workspace-a", color: "#ABC" })).toEqual({
    workspaceId: "workspace-a",
    color: "#aabbcc",
  });

  for (const invalid of [
    null,
    [],
    { workspaceId: "workspace-a" },
    { workspaceId: "workspace-a", color: "#abcdef", projectId: "root" },
    { workspaceId: "", color: "#abcdef" },
    { workspaceId: "workspace-a", color: "#abcdef", extra: undefined },
  ]) {
    expect(() => projectIdentity_decodeSetAccent(invalid)).toThrow(/Invalid/);
  }

  let getterCalls = 0;
  const accessorRequest: Record<string, unknown> = {};
  Object.defineProperty(accessorRequest, "workspaceId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "workspace-a";
    },
  });
  Object.defineProperty(accessorRequest, "color", {
    enumerable: true,
    value: "#abcdef",
  });
  expect(() => projectIdentity_decodeSetAccent(accessorRequest)).toThrow(/data properties/);
  expect(getterCalls).toBe(0);

  const unknownAccessor: Record<string, unknown> = {
    workspaceId: "workspace-a",
    color: "#abcdef",
  };
  Object.defineProperty(unknownAccessor, "later", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "not-read";
    },
  });
  expect(() => projectIdentity_decodeSetAccent(unknownAccessor)).toThrow(/data properties/);
  expect(getterCalls).toBe(0);
});

test("accent maps are fresh, prototype-safe, bounded, and non-mutating", () => {
  const saved = colorMap([
    ["root", "#AABBCC"],
    ["__proto__", "#123456"],
    ["constructor", "#654321"],
  ]);
  const before = JSON.stringify(saved);
  const decoded = projectIdentity_decodeAccentColors(saved);

  expect(JSON.stringify(saved)).toBe(before);
  expect(decoded.root).toBe("#aabbcc");
  expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
  expect(Object.hasOwn(decoded, "constructor")).toBe(true);
  expect(Object.isFrozen(decoded)).toBe(true);
  expect(Object.getPrototypeOf(decoded)).toBeNull();

  let getterCalls = 0;
  const accessorMap: Record<string, unknown> = {};
  Object.defineProperty(accessorMap, "root", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "#abcdef";
    },
  });
  expect(() => projectIdentity_decodeAccentColors(accessorMap)).toThrow(/data properties/);
  expect(getterCalls).toBe(0);

  const atLimit = colorMap(
    Array.from({ length: projectIdentity_maxAccentEntries }, (_, index) => [
      `project-${index}`,
      "#123456",
    ]),
  );
  expect(Object.keys(projectIdentity_decodeAccentColors(atLimit))).toHaveLength(
    projectIdentity_maxAccentEntries,
  );

  const overLimit = colorMap([...Object.entries(atLimit), ["project-overflow", "#abcdef"]]);
  const overLimitBefore = JSON.stringify(overLimit);
  expect(() => projectIdentity_decodeAccentColors(overLimit)).toThrow("too large");
  expect(JSON.stringify(overLimit)).toBe(overLimitBefore);

  expect(
    projectIdentity_decodeAccentColors(
      colorMap([["x".repeat(projectIdentity_maxWorkspaceIdLength), "#abcdef"]]),
    ),
  ).toHaveProperty("x".repeat(projectIdentity_maxWorkspaceIdLength));
  expect(() =>
    projectIdentity_decodeAccentColors(
      colorMap([["x".repeat(projectIdentity_maxWorkspaceIdLength + 1), "#abcdef"]]),
    ),
  ).toThrow("Invalid project id");
});

test("palette assignment is stable, missing-only, collision-safe, and immutable", () => {
  expect(Object.isFrozen(projectIdentity_presetColors)).toBe(true);
  expect(Object.keys(projectIdentity_assignMissingAccents({}, []))).toHaveLength(0);

  const zeroProjectsSaved = projectIdentity_assignMissingAccents({ absent: "#abcdef" }, []);
  expect(asPlainRecord(zeroProjectsSaved)).toEqual({ absent: "#abcdef" });

  expect(asPlainRecord(projectIdentity_assignMissingAccents({}, [workspace("a")]))).toEqual({
    a: "#18a999",
  });
  expect(projectIdentity_assignMissingAccents({}, [workspace("🦊")])["🦊"]).toBe("#43a047");

  const eight = projectIdentity_assignMissingAccents(
    {},
    Array.from("abcdefgh", (id) => workspace(id)),
  );
  expect(new Set(Object.values(eight))).toEqual(new Set(projectIdentity_presetColors));

  const saved = {
    p0: "#123456",
    absent: "#abcdef",
  } as const;
  const workspaces = Array.from({ length: 20 }, (_, index) =>
    workspace(`p${index}`, `/projects/${20 - index}/p${index}`),
  );
  const forward = projectIdentity_assignMissingAccents(saved, workspaces);
  const reversed = projectIdentity_assignMissingAccents(saved, [...workspaces].reverse());
  expect(reversed).toEqual(forward);
  expect(forward.p0).toBe("#123456");
  expect(forward.absent).toBe("#abcdef");
  expect(new Set(Object.values(forward)).size).toBe(21);
  expect(Object.isFrozen(forward)).toBe(true);
  expect(saved).toEqual({ p0: "#123456", absent: "#abcdef" });

  expect(
    projectIdentity_assignMissingAccents({ absent: projectIdentity_presetColors[1] }, [
      workspace("a"),
    ]).a,
  ).toBe(projectIdentity_presetColors[0]);

  const explicitDuplicates = projectIdentity_assignMissingAccents(
    {
      awayA: "#18a999",
      awayB: "#18a999",
    },
    [workspace("a")],
  );
  expect(explicitDuplicates.awayA).toBe("#18a999");
  expect(explicitDuplicates.awayB).toBe("#18a999");
  expect(explicitDuplicates.a).toBe("#5b8def");

  const fullSaved = colorMap(
    Array.from({ length: projectIdentity_maxAccentEntries }, (_, index) => [
      `saved-${index}`,
      "#123456",
    ]),
  );
  const fullBefore = JSON.stringify(fullSaved);
  expect(() => projectIdentity_assignMissingAccents(fullSaved, [workspace("overflow")])).toThrow(
    "too large",
  );
  expect(JSON.stringify(fullSaved)).toBe(fullBefore);
});

test("fixed-step generated fallback matches the historical collision oracle", () => {
  // Oracle from the accepted repair: hash("target") is 3414061457. With all
  // presets occupied, the generated base #7e7191 and first fixed-step probe
  // #1ca90a collide; the next fixed-step probe is #bae083.
  const generatedCollisionOracle = projectIdentity_assignMissingAccents(
    {
      preset0: projectIdentity_presetColors[0],
      preset1: projectIdentity_presetColors[1],
      preset2: projectIdentity_presetColors[2],
      preset3: projectIdentity_presetColors[3],
      preset4: projectIdentity_presetColors[4],
      preset5: projectIdentity_presetColors[5],
      preset6: projectIdentity_presetColors[6],
      preset7: projectIdentity_presetColors[7],
      generatedBase: "#7e7191",
      firstProbe: "#1ca90a",
    },
    [workspace("target")],
  );
  expect(generatedCollisionOracle.target).toBe("#bae083");
});

test("linked worktrees inherit their root while orphans retain a stable owner", () => {
  const workspaces = [
    workspace("root", "/repo"),
    workspace("worktree", "/repo-worktree", "root"),
    workspace("orphan", "/orphan", "missing-root"),
    workspace("standalone", "/standalone"),
  ];
  expect(resolveRepoWorkspaceId(workspaces, "worktree")).toBe("root");
  expect(resolveRepoWorkspaceId(workspaces, "orphan")).toBe("orphan");

  const assignments = projectIdentity_assignMissingAccents({}, workspaces);
  const effective = projectIdentity_effectiveByWorkspace(
    {
      ...assignments,
      worktree: "#ffffff",
      orphan: "#abcdef",
      standalone: "#654321",
    },
    workspaces,
  );

  expect(effective.root).toEqual({
    projectId: "root",
    accentColor: assignments.root,
  });
  expect(effective.worktree).toEqual(effective.root);
  expect(effective.orphan).toEqual({
    projectId: "orphan",
    accentColor: "#abcdef",
  });
  expect(effective.standalone).toEqual({
    projectId: "standalone",
    accentColor: "#654321",
  });
  expect(Object.isFrozen(effective)).toBe(true);
  expect(Object.isFrozen(effective.root)).toBe(true);
});

test("desktop sidebar appearance is optional and accepts the exact projection", () => {
  const withoutAppearance = createEmptyDesktopAppState();
  expect(Object.hasOwn(withoutAppearance, "sidebarAppearance")).toBe(false);

  const withAppearance: DesktopAppState = {
    ...withoutAppearance,
    sidebarAppearance: Object.freeze({
      projectByWorkspaceId: Object.freeze({
        root: Object.freeze({
          projectId: "root",
          accentColor: "#5b8def",
        }),
      }),
      activityIndicatorPreference: Object.freeze({
        style: "moonwalk",
        source: "provisional",
      }),
    }),
  };
  expect(withAppearance.sidebarAppearance?.projectByWorkspaceId.root).toEqual({
    projectId: "root",
    accentColor: "#5b8def",
  });
});

test("workspace decoding rejects accessors, extras, sparse arrays, and overflow without reads", () => {
  let getterCalls = 0;
  const accessorWorkspace: ProjectIdentityWorkspace = {
    path: "/repo",
    get id() {
      getterCalls += 1;
      return "root";
    },
  };
  expect(() => projectIdentity_assignMissingAccents({}, [accessorWorkspace])).toThrow(
    /data properties/,
  );
  expect(getterCalls).toBe(0);

  const extraWorkspace = { ...workspace("root"), extra: true };
  expect(() => projectIdentity_assignMissingAccents({}, [extraWorkspace])).toThrow(
    "Invalid workspace identity",
  );

  const sparse = new Array<ProjectIdentityWorkspace>(1);
  expect(() => projectIdentity_assignMissingAccents({}, sparse)).toThrow(
    "Workspace list fields must be data properties",
  );

  const oversized = Array.from({ length: projectIdentity_maxAccentEntries + 1 }, (_, index) =>
    workspace(`workspace-${index}`),
  );
  expect(() => projectIdentity_assignMissingAccents({}, oversized)).toThrow(
    "Workspace list is too large",
  );
});
