import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { SUPPORT_OPTION_IDS, SUPPORT_OPTIONS } from "@pi-gui/distribution-support";
import {
  supportDevelopment_decodeDismissal,
  supportDevelopment_decodeEmpty,
} from "../../contracts/ipc";
import {
  SupportService,
  type SupportServicePersistence,
  supportService_createFilePersistence,
} from "../../electron/distribution/support-service";
import { writeJsonAtomicForAppStore } from "../../electron/persistence/app-store-persistence";

const EXPECTED_URLS = {
  "monthly-aud-5": "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
  "monthly-aud-10": "https://donate.stripe.com/bJe7sLbEC3ZHgtQc6JgA801",
  "monthly-aud-20": "https://donate.stripe.com/00w3cv4cadAh4L82w9gA802",
  "one-off-stripe": "https://donate.stripe.com/aFa3cv5ge3ZH7Xk2w9gA803",
  "one-off-paypal": "https://paypal.me/reabowpayment",
} as const;

function memoryPersistence(initial = false): SupportServicePersistence & {
  saved: boolean;
  saveCalls: number;
} {
  let saved = initial;
  return {
    get saved() {
      return saved;
    },
    saveCalls: 0,
    async loadDontAskAgain() {
      return saved;
    },
    async saveDontAskAgain() {
      this.saveCalls += 1;
      saved = true;
    },
  };
}

test("accepted offers keep their exact metadata and Main resolves only allowlisted URLs", async () => {
  const opened: string[] = [];
  const service = await SupportService.create({
    persistence: memoryPersistence(),
    openExternal: async (url) => {
      opened.push(url);
    },
  });

  expect(SUPPORT_OPTION_IDS).toEqual(Object.keys(EXPECTED_URLS));
  expect(SUPPORT_OPTIONS.find((option) => option.id === "one-off-paypal")).toMatchObject({
    cadence: "one-off",
    provider: "paypal",
    amount: null,
    recipient: "Leo Software",
  });
  expect(
    SUPPORT_OPTIONS.filter((option) => option.cadence === "monthly").map((option) => option.amount),
  ).toEqual([
    { currency: "AUD", minorUnits: 500 },
    { currency: "AUD", minorUnits: 1_000 },
    { currency: "AUD", minorUnits: 2_000 },
  ]);

  for (const optionId of SUPPORT_OPTION_IDS) {
    await service.openOption(optionId);
  }
  expect(service.getState().options).toEqual(SUPPORT_OPTIONS);
  expect(opened).toEqual(SUPPORT_OPTION_IDS.map((id) => EXPECTED_URLS[id]));
});

test("exact-ID mutations across whitespace, controls and Unicode never reach the opener", async () => {
  const opened: string[] = [];
  const service = await SupportService.create({
    persistence: memoryPersistence(),
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  const whitespaceAndControls = [
    "\u0000",
    "\u0001",
    "\t",
    "\n",
    "\v",
    "\f",
    "\r",
    " ",
    "\u007f",
    "\u0085",
    "\u00a0",
    "\u1680",
    "\u2000",
    "\u2001",
    "\u2002",
    "\u2003",
    "\u2004",
    "\u2005",
    "\u2006",
    "\u2007",
    "\u2008",
    "\u2009",
    "\u200a",
    "\u200b",
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u2060",
    "\u3000",
    "\ufeff",
    "\ud800",
    "\udfff",
  ];
  const idMutations = SUPPORT_OPTION_IDS.flatMap((id) => [
    ...whitespaceAndControls.flatMap((character) => [
      `${character}${id}`,
      `${id}${character}`,
      id.replace("-", `${character}-`),
    ]),
    id.toUpperCase(),
    id.replace("-", "\u2010"),
    id.replace("-", "\u2011"),
    id.replace("-", "\uff0d"),
    id.replace("o", "o\u0301"),
    id.replace(/[a-z]/g, (character) => String.fromCodePoint(character.codePointAt(0)! + 0xfee0)),
    `${id}%20`,
  ]);
  const hostileValues: unknown[] = [
    ...new Set(idMutations),
    "constructor",
    "__proto__",
    "toString",
    "",
    "https://donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
    "https://evil.example/7sY14nfUS2VD3H40o1gA800",
    "http://donate.stripe.com/7sY14nfUS2VD3H40o1gA800",
    { id: "monthly-aud-5" },
    ["monthly-aud-5"],
    () => "monthly-aud-5",
    Symbol("monthly-aud-5"),
    null,
    undefined,
  ];

  const resolved: unknown[] = [];
  for (const value of hostileValues) {
    try {
      await service.openOption(value);
      resolved.push({
        value,
        codepoints:
          typeof value === "string"
            ? [...value].map((character) => character.codePointAt(0)!.toString(16))
            : value,
      });
    } catch {
      // Expected rejection before any external opening.
    }
  }
  expect(resolved).toEqual([]);
  expect(opened).toEqual([]);
});

test("duplicate in-flight opens share one external invocation", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = await SupportService.create({
    persistence: memoryPersistence(),
    openExternal: async () => {
      calls += 1;
      await gate;
    },
  });

  const first = service.openOption("monthly-aud-5");
  const duplicate = service.openOption("monthly-aud-5");
  await Promise.resolve();
  expect(calls).toBe(1);
  release?.();
  await Promise.all([first, duplicate]);
  expect(calls).toBe(1);
});

test("Not now remains session-local while Don't ask again survives service restart", async () => {
  const persistence = memoryPersistence();
  const first = await SupportService.create({
    persistence,
    openExternal: async () => undefined,
  });
  expect(first.getState()).toMatchObject({
    currentPromptDismissed: false,
    dontAskAgain: false,
  });

  const notNow = await first.dismiss("not-now");
  expect(notNow).toMatchObject({ currentPromptDismissed: true, dontAskAgain: false });
  expect(persistence.saveCalls).toBe(0);

  const reloadedAfterNotNow = await SupportService.create({
    persistence,
    openExternal: async () => undefined,
  });
  expect(reloadedAfterNotNow.getState()).toMatchObject({
    currentPromptDismissed: false,
    dontAskAgain: false,
  });

  const dontAsk = await first.dismiss("dont-ask-again");
  expect(dontAsk).toMatchObject({ currentPromptDismissed: true, dontAskAgain: true });
  expect(persistence.saved).toBe(true);

  const restarted = await SupportService.create({
    persistence,
    openExternal: async () => undefined,
  });
  expect(restarted.getState()).toMatchObject({
    currentPromptDismissed: false,
    dontAskAgain: true,
  });
});

test("persistence failure cannot fabricate a saved dismissal", async () => {
  const service = await SupportService.create({
    persistence: {
      async loadDontAskAgain() {
        return false;
      },
      async saveDontAskAgain() {
        throw new Error("disk full");
      },
    },
    openExternal: async () => undefined,
  });

  await expect(service.dismiss("dont-ask-again")).rejects.toThrow("disk full");
  expect(service.getState()).toMatchObject({
    currentPromptDismissed: false,
    dontAskAgain: false,
  });
});

test("malformed persistence reads as no saved choice and valid writes round-trip", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-support-unit-"));
  const filePath = join(root, "support-development.json");
  const malformed = '{"version":1,"dontAskAgain":"yes"}\n';
  await writeFile(filePath, malformed, "utf8");
  let writerCalls = 0;
  const persistence = supportService_createFilePersistence(root, {
    writeJsonAtomic: async (target, value) => {
      writerCalls += 1;
      await writeJsonAtomicForAppStore(target, value);
    },
  });
  await expect(persistence.loadDontAskAgain()).resolves.toBe(false);
  await expect(persistence.saveDontAskAgain()).rejects.toThrow("Invalid support dismissal file");
  expect(writerCalls).toBe(0);
  await expect(readFile(filePath, "utf8")).resolves.toBe(malformed);

  await rm(filePath);
  await persistence.saveDontAskAgain();
  expect(writerCalls).toBe(1);
  await expect(persistence.loadDontAskAgain()).resolves.toBe(true);

  expect(() => supportService_createFilePersistence("relative/path")).toThrow(
    "absolute caller root",
  );
});

test("write failure and retry publish dismissal only after durable success", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-support-retry-"));
  let attempts = 0;
  const persistence = supportService_createFilePersistence(root, {
    writeJsonAtomic: async (filePath, value) => {
      attempts += 1;
      if (attempts === 1) throw new Error("simulated durable write failure");
      await writeJsonAtomicForAppStore(filePath, value);
    },
  });
  const service = await SupportService.create({
    persistence,
    openExternal: async () => undefined,
  });

  await expect(service.dismiss("dont-ask-again")).rejects.toThrow(
    "simulated durable write failure",
  );
  expect(service.getState()).toMatchObject({
    currentPromptDismissed: false,
    dontAskAgain: false,
  });

  const retried = await service.dismiss("dont-ask-again");
  expect(retried).toMatchObject({ currentPromptDismissed: true, dontAskAgain: true });
  expect(attempts).toBe(2);
  const restarted = await SupportService.create({
    persistence,
    openExternal: async () => undefined,
  });
  expect(restarted.getState()).toMatchObject({
    currentPromptDismissed: false,
    dontAskAgain: true,
  });
});

test("corrupt JSON remains untouched and valid writes retain an atomic backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-support-corrupt-"));
  const filePath = join(root, "support-development.json");
  const original = '{"version":1';
  await writeFile(filePath, original, "utf8");
  let writerCalls = 0;
  const persistence = supportService_createFilePersistence(root, {
    writeJsonAtomic: async (target, value) => {
      writerCalls += 1;
      await writeJsonAtomicForAppStore(target, value);
    },
  });

  await expect(persistence.loadDontAskAgain()).resolves.toBe(false);
  await expect(persistence.saveDontAskAgain()).rejects.toThrow("corrupt and was not replaced");
  expect(writerCalls).toBe(0);
  await expect(readFile(filePath, "utf8")).resolves.toBe(original);

  await rm(filePath);
  await persistence.saveDontAskAgain();
  const first = await readFile(filePath, "utf8");
  await persistence.saveDontAskAgain();
  await expect(readFile(`${filePath}.bak`, "utf8")).resolves.toBe(first);
  await expect(readFile(filePath, "utf8")).resolves.toBe(first);
});

test("IPC decoders reject extra payloads and unsupported dismissals", () => {
  expect(supportDevelopment_decodeEmpty(undefined)).toBeUndefined();
  expect(supportDevelopment_decodeDismissal("not-now")).toBe("not-now");
  expect(supportDevelopment_decodeDismissal("dont-ask-again")).toBe("dont-ask-again");

  expect(() => supportDevelopment_decodeEmpty(null)).toThrow("must not include a payload");
  expect(() => supportDevelopment_decodeDismissal("paid")).toThrow("not-now or dont-ask-again");
});
