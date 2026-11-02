import { expect, test } from "@playwright/test";
import type { DesktopAppState } from "../../contracts/desktop-state";
import type {
  ProjectImportCandidate,
  ProjectImportMonitorRequest,
  ProjectImportMonitorResult,
} from "../../contracts/project-import";
import { projectImport_run } from "../../src/features/project-import/project-import-runner";

const importedState = { workspaces: [] } as unknown as DesktopAppState;
const model = { provider: "openai", modelId: "gpt-5" };

function candidate(id: string, path = `/projects/${id}`): ProjectImportCandidate {
  return { id, name: id, path, sources: ["cursor"] };
}

test("deterministic imports do not contact the selected model", async () => {
  const added: string[] = [];
  let monitorCalls = 0;

  const run = await projectImport_run({
    api: {
      platform: "darwin",
      addWorkspacePath: async (path) => {
        added.push(path);
        return importedState;
      },
      monitorProjectImport: async () => {
        monitorCalls += 1;
        return { status: "completed", action: "continue", message: "unexpected" };
      },
    },
    candidates: [candidate("alpha"), candidate("beta")],
    existingWorkspacePaths: [],
    model,
    onSnapshot: () => undefined,
    onProgress: () => undefined,
    onMonitorStart: () => undefined,
  });

  expect(added).toEqual(["/projects/alpha", "/projects/beta"]);
  expect(monitorCalls).toBe(0);
  expect(run.monitorResult).toBeNull();
  expect(run.results.map((result) => result.status)).toEqual(["imported", "imported"]);
});

test("a failed import asks the model once and honors one bounded retry", async () => {
  let addCalls = 0;
  let monitorCalls = 0;
  let monitorStarted = false;
  const requests: ProjectImportMonitorRequest[] = [];

  const run = await projectImport_run({
    api: {
      platform: "darwin",
      addWorkspacePath: async () => {
        addCalls += 1;
        if (addCalls === 1) throw new Error("workspace is locked");
        return importedState;
      },
      monitorProjectImport: async (request): Promise<ProjectImportMonitorResult> => {
        monitorCalls += 1;
        requests.push(request);
        return {
          status: "completed",
          action: "retry",
          message: "Retry after the transient lock.",
        };
      },
    },
    candidates: [candidate("alpha")],
    existingWorkspacePaths: [],
    model,
    onSnapshot: () => undefined,
    onProgress: () => undefined,
    onMonitorStart: () => {
      monitorStarted = true;
    },
  });

  expect(addCalls).toBe(2);
  expect(monitorCalls).toBe(1);
  expect(monitorStarted).toBe(true);
  expect(requests[0]).toMatchObject({
    model,
    candidatesFound: 1,
    imported: 0,
    failures: [
      {
        name: "alpha",
        status: "failed",
        error: "workspace is locked",
      },
    ],
  });
  expect(run.results).toEqual([
    {
      candidateId: "alpha",
      name: "alpha",
      path: "/projects/alpha",
      status: "imported",
    },
  ]);
  expect(run.monitorResult).toMatchObject({ action: "retry" });
});

test("existing Windows projects are matched without case or slash differences", async () => {
  let addCalls = 0;
  let monitorCalls = 0;

  const run = await projectImport_run({
    api: {
      platform: "win32",
      addWorkspacePath: async () => {
        addCalls += 1;
        return importedState;
      },
      monitorProjectImport: async () => {
        monitorCalls += 1;
        return { status: "completed", action: "continue", message: "unexpected" };
      },
    },
    candidates: [candidate("alpha", "c:/projects/alpha")],
    existingWorkspacePaths: ["C:\\Projects\\Alpha"],
    model,
    onSnapshot: () => undefined,
    onProgress: () => undefined,
    onMonitorStart: () => undefined,
  });

  expect(addCalls).toBe(0);
  expect(monitorCalls).toBe(0);
  expect(run.results[0]?.status).toBe("already-present");
});
