import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  TELEMETRY_CONSENT_STORE_MAX_BYTES,
  TelemetryConsentFileStore,
} from "../../electron/persistence/telemetry-consent-store";
import type { TelemetryConsentCheckpoint } from "../../contracts/telemetry-consent";

const temporaryRoots: string[] = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-telemetry-consent-store-"));
  temporaryRoots.push(root);
  return root;
}

function checkpoint(
  overrides: Partial<TelemetryConsentCheckpoint> = {},
): TelemetryConsentCheckpoint {
  const choices = {
    usage: {
      value: "allowed" as const,
      source: "user" as const,
      disclosureVersion: 1,
    },
    crash: {
      value: "denied" as const,
      source: "user" as const,
      disclosureVersion: 1,
    },
  };
  return {
    schemaVersion: 1,
    latestRequestRevision: 1,
    desired: choices,
    durable: choices,
    pending: null,
    ...overrides,
  };
}

test("caller-root store round-trips independent explicit choices", async () => {
  const root = await temporaryRoot();
  const store = new TelemetryConsentFileStore(root);
  expect(store.filePath).toBe(join(root, "telemetry", "consent.json"));
  await expect(store.load()).resolves.toBeNull();

  await store.save(checkpoint());
  await expect(store.load()).resolves.toEqual(checkpoint());
});

test("undecided and denial provenance remain distinct records", async () => {
  const root = await temporaryRoot();
  const store = new TelemetryConsentFileStore(root);
  const undecided = {
    schemaVersion: 1 as const,
    latestRequestRevision: 0,
    desired: {
      usage: { value: "undecided" as const, source: "absent" as const, disclosureVersion: null },
      crash: { value: "undecided" as const, source: "absent" as const, disclosureVersion: null },
    },
    durable: {
      usage: { value: "undecided" as const, source: "absent" as const, disclosureVersion: null },
      crash: { value: "undecided" as const, source: "absent" as const, disclosureVersion: null },
    },
    pending: null,
  };
  await store.save(undecided);
  await expect(store.load()).resolves.toEqual(undecided);

  await store.save(checkpoint());
  expect((await store.load())?.durable.crash).toEqual({
    value: "denied",
    source: "user",
    disclosureVersion: 1,
  });
});

test("missing, corrupt, legacy, oversized, and extra-field records are restrictive", async () => {
  const root = await temporaryRoot();
  const store = new TelemetryConsentFileStore(root);
  await mkdir(dirname(store.filePath), { recursive: true });

  await writeFile(store.filePath, "{", "utf8");
  await expect(store.load()).rejects.toThrow(/corrupt/);

  await writeFile(
    store.filePath,
    JSON.stringify({ ...checkpoint(), privateContent: "not allowed" }),
    "utf8",
  );
  await expect(store.load()).rejects.toThrow(/unsupported shape/);

  await writeFile(store.filePath, JSON.stringify({ ...checkpoint(), schemaVersion: 0 }), "utf8");
  await expect(store.load()).rejects.toThrow(/unsupported/);

  await writeFile(
    store.filePath,
    JSON.stringify({
      ...checkpoint(),
      padding: "x".repeat(TELEMETRY_CONSENT_STORE_MAX_BYTES),
    }),
    "utf8",
  );
  await expect(store.load()).rejects.toThrow(/unsupported shape|byte bound/);

  await expect(store.save({ ...checkpoint(), extra: true })).rejects.toThrow(/unsupported shape/);
});

test("backup recovery is untrusted and cannot restore older allowed provenance", async () => {
  const root = await temporaryRoot();
  const store = new TelemetryConsentFileStore(root);
  const allowed = checkpoint();
  const pendingWithdrawal: TelemetryConsentCheckpoint = {
    schemaVersion: 1,
    latestRequestRevision: 2,
    desired: {
      usage: { value: "denied", source: "user", disclosureVersion: 1 },
      crash: { value: "allowed", source: "user", disclosureVersion: 1 },
    },
    durable: allowed.durable,
    pending: {
      requestRevision: 2,
      disclosureVersion: 1,
      state: "queued",
      desired: {
        usage: { value: "denied", source: "user", disclosureVersion: 1 },
        crash: { value: "allowed", source: "user", disclosureVersion: 1 },
      },
      outcome: "pending",
    },
  };

  await store.save(allowed);
  await store.save(pendingWithdrawal);
  await rm(store.filePath);
  await expect(store.load()).rejects.toThrow(/backup.*explicit reconciliation/);

  await writeFile(store.filePath, "{", "utf8");
  await expect(store.load()).rejects.toThrow(/backup.*explicit reconciliation/);

  await rm(store.filePath);
  await writeFile(`${store.filePath}.bak`, "{", "utf8");
  await expect(store.load()).rejects.toThrow(/corrupt/);
});

test("store requires an explicit absolute caller root", () => {
  expect(() => new TelemetryConsentFileStore("")).toThrow(/absolute caller root/);
  expect(() => new TelemetryConsentFileStore("relative/path")).toThrow(/absolute caller root/);
});
