import type {
  TelemetryClock,
  TelemetryConfiguration,
  TelemetryDependencies,
  TelemetryLogEvent,
  TelemetryPersistence,
  TelemetryPersistedState,
  TelemetryRandom,
  TelemetryTransport,
  TelemetryTransportRequest,
  TelemetryTransportResponse,
} from "../../electron/telemetry/telemetry";

export const TEST_APP = Object.freeze({
  id: "example-app",
  version: "1.0.0",
  platform: "macos",
  arch: "arm64",
});

export function testConfiguration(
  overrides: Partial<TelemetryConfiguration> = {},
): TelemetryConfiguration {
  return {
    operationalEnabled: true,
    app: TEST_APP,
    baseUrl: "https://telemetry.example.test/service",
    disclosureVersion: 1,
    stableCodes: ["startup.failed", "export.encoder_unavailable"],
    ...overrides,
  };
}

export class FakeClock implements TelemetryClock {
  private current: number;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  constructor(now = Date.parse("2026-10-30T02:34:00.000Z")) {
    this.current = now;
  }

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { at: this.current + Math.max(0, delayMs), callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") {
      this.timers.delete(handle);
    }
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.current)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [handle, timer] of due) {
      this.timers.delete(handle);
      timer.callback();
    }
  }

  set(now: number): void {
    this.current = now;
  }

  pendingDelays(): number[] {
    return [...this.timers.values()]
      .map((timer) => Math.max(0, timer.at - this.current))
      .sort((left, right) => left - right);
  }
}

export class MemoryPersistence implements TelemetryPersistence {
  state: unknown = null;
  saveCalls = 0;
  clearCalls = 0;
  failLoad = false;
  failSave = false;
  failClear = false;

  async load(): Promise<unknown> {
    if (this.failLoad) throw new Error("synthetic load failure");
    return this.state === null ? null : structuredClone(this.state);
  }

  async save(state: Readonly<TelemetryPersistedState>): Promise<void> {
    this.saveCalls += 1;
    if (this.failSave) throw new Error("synthetic save failure");
    this.state = structuredClone(state);
  }

  async clear(): Promise<void> {
    this.clearCalls += 1;
    if (this.failClear) throw new Error("synthetic clear failure");
    this.state = null;
  }

  serialized(): string {
    return JSON.stringify(this.state);
  }

  installId(): string | null {
    if (
      typeof this.state !== "object" ||
      this.state === null ||
      !("installId" in this.state) ||
      typeof this.state.installId !== "string"
    ) {
      return null;
    }
    return this.state.installId;
  }
}

export class FakeRandom implements TelemetryRandom {
  private uuidIndex = 0;
  fractionValue = 0.5;
  readonly uuids = [
    "01234567-89ab-4cde-8fab-0123456789ab",
    "11234567-89ab-4cde-8fab-0123456789ab",
    "21234567-89ab-4cde-8fab-0123456789ab",
  ];

  uuid(): string {
    const value = this.uuids[this.uuidIndex] ?? `31234567-89ab-4cde-8fab-01234567${this.uuidIndex}`;
    this.uuidIndex += 1;
    return value;
  }

  fraction(): number {
    return this.fractionValue;
  }
}

export type TransportHandler = (
  request: TelemetryTransportRequest,
  index: number,
) => Promise<TelemetryTransportResponse>;

export class FakeTransport implements TelemetryTransport {
  readonly requests: TelemetryTransportRequest[] = [];
  handler: TransportHandler;

  constructor(handler: TransportHandler = async () => ({ status: 200, retryAfter: null })) {
    this.handler = handler;
  }

  async send(request: TelemetryTransportRequest): Promise<TelemetryTransportResponse> {
    this.requests.push(request);
    return this.handler(request, this.requests.length - 1);
  }
}

export class RecordingLogger {
  readonly events: TelemetryLogEvent[] = [];

  warn(event: TelemetryLogEvent): void {
    this.events.push(event);
  }

  info(event: TelemetryLogEvent): void {
    this.events.push(event);
  }
}

export function testDependencies({
  clock = new FakeClock(),
  persistence = new MemoryPersistence(),
  transport = new FakeTransport(),
}: {
  clock?: FakeClock;
  persistence?: MemoryPersistence;
  transport?: FakeTransport;
} = {}): TelemetryDependencies & {
  clock: FakeClock;
  persistence: MemoryPersistence;
  transport: FakeTransport;
  logger: RecordingLogger;
  random: FakeRandom;
} {
  return {
    clock,
    persistence,
    transport,
    logger: new RecordingLogger(),
    random: new FakeRandom(),
  };
}

export function parseBody(request: TelemetryTransportRequest): Record<string, unknown> {
  return JSON.parse(request.body) as Record<string, unknown>;
}

export async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}
