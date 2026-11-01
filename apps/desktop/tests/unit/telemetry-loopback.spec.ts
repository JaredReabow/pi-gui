import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  telemetry_fetch_transport,
  telemetry_initialize,
  type TelemetryAppIdentity,
} from "../../electron/telemetry/telemetry";
import {
  FakeClock,
  FakeRandom,
  MemoryPersistence,
  RecordingLogger,
  parseBody,
  testConfiguration,
} from "./telemetry-test-fixtures";

test("loopback service writes one usage and one crash receipt to a temporary store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-gui-telemetry-loopback-"));
  const receiptPath = join(directory, "receipt.json");
  const records: Array<{ path: string; body: Record<string, unknown> }> = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    handleRequest(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      const body = await readJson(request);
      records.push({ path: request.url ?? "", body });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(receiptPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    } catch {
      response.writeHead(400);
      response.end();
    }
  };

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("loopback server did not bind");
    expect(address.port).not.toBe(8788);
    const transport = telemetry_fetch_transport(fetch);
    const owner = await telemetry_initialize(
      testConfiguration({
        baseUrl: `http://127.0.0.1:${address.port}`,
        app: {
          ...testConfiguration().app,
          version: "1.0.1",
        } satisfies TelemetryAppIdentity,
      }),
      {
        clock: new FakeClock(),
        random: new FakeRandom(),
        persistence: new MemoryPersistence(),
        transport,
        logger: new RecordingLogger(),
      },
    );
    expect(await owner.telemetry_consent_set(true, true, 1)).toBe(true);
    expect(await owner.telemetry_usage_record("tool-call-started")).toBe(true);
    expect(await owner.telemetry_usage_record("user-activity")).toBe(true);
    expect(await owner.telemetry_error_record("other", "startup.failed")).toBe(true);
    const result = await owner.telemetry_flush_due();
    expect(result).toMatchObject({ acknowledged: 2, retained: 0 });

    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Array<{
      path: string;
      body: Record<string, unknown>;
    }>;
    expect(receipt.map((entry) => entry.path)).toEqual(["/collect", "/crash"]);
    expect(receipt[0]!.body).toMatchObject({
      schema: 2,
      app: {
        id: "example-app",
        version: "1.0.1",
        platform: "macos",
        arch: "arm64",
      },
      usage: { toolCalls: 1, browserSessions: 0, activeDays: 1 },
      consent: { telemetry: true, crash: true },
    });
    expect(receipt[1]!.body).toMatchObject({
      schema: 2,
      kind: "other",
      occurrences: 1,
      consent: { telemetry: true, crash: true },
    });
    expect(JSON.stringify(receipt)).not.toContain("/Users/example/");
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE exception text");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  request.setEncoding("utf8");
  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }
  return parseBody({
    url: "http://127.0.0.1/",
    body,
    headers: { "Content-Type": "application/json" },
    signal: new AbortController().signal,
  });
}
