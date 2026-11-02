import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { sharedPiCatalog_resolveModelsPath } from "../../electron/distribution/shared-pi-catalog";

test("Pi CLI catalog defaults to the standard agent profile", () => {
  expect(sharedPiCatalog_resolveModelsPath({ homeDir: "/Users/example" })).toBe(
    "/Users/example/.pi/agent/models.json",
  );
});

test("Pi CLI catalog path supports an explicit agent directory", () => {
  expect(
    sharedPiCatalog_resolveModelsPath({
      homeDir: "/Users/example",
      agentDir: "~/shared/pi-agent",
    }),
  ).toBe("/Users/example/shared/pi-agent/models.json");
  expect(
    sharedPiCatalog_resolveModelsPath({
      homeDir: "/Users/example",
      agentDir: "/Volumes/Test/pi-agent",
    }),
  ).toBe(join("/Volumes/Test/pi-agent", "models.json"));
});
