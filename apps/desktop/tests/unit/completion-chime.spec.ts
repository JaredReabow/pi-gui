import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  completionChimeSounds,
  defaultCompletionChimePreferences,
  type CompletionChimePlayback,
} from "../../contracts/completion-chime";
import { createEmptyDesktopAppState } from "../../contracts/desktop-state";
import { expectNotificationPreferences } from "../../electron/ipc/request-validation";
import {
  decodePersistedUiState,
  readPersistedUiState,
  writePersistedUiState,
} from "../../electron/persistence/app-store-persistence";
import { CompletionChimeCoordinator } from "../../electron/platform/completion-chime";
import { renderCompletionChime } from "../../src/features/notifications/chime-synthesis";

const preferences = createEmptyDesktopAppState().notificationPreferences;
function completed(
  runId = "run-1",
  sessionId = "thread",
): Extract<SessionDriverEvent, { type: "runCompleted" }> {
  const ref = { workspaceId: "workspace", sessionId };
  return {
    type: "runCompleted",
    sessionRef: ref,
    runId,
    timestamp: "2026-01-01T00:00:00.000Z",
    snapshot: {
      ref,
      workspace: { workspaceId: "workspace", path: "/fixture" },
      title: "Fixture",
      status: "idle",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

test("typewriter is enabled by default; old notification flags and new choices round trip", async () => {
  expect(preferences).toMatchObject(defaultCompletionChimePreferences);
  expect(defaultCompletionChimePreferences).toEqual({
    chimeEnabled: true,
    chimeSound: "typewriter-return",
    chimeVolume: 60,
  });
  const legacy = decodePersistedUiState({
    version: 20,
    notificationPreferences: { backgroundCompletion: false, backgroundFailure: true },
  });
  expect({ ...preferences, ...legacy.notificationPreferences }).toMatchObject({
    chimeEnabled: true,
    chimeSound: "typewriter-return",
    backgroundCompletion: false,
  });
  const path = join(await mkdtemp(join(tmpdir(), "pi-chime-unit-")), "ui-state.json");
  const saved = {
    ...preferences,
    backgroundCompletion: false,
    chimeEnabled: false,
    chimeSound: "air-horn" as const,
    chimeVolume: 3,
  };
  await writePersistedUiState(path, { version: 20, notificationPreferences: saved });
  expect((await readPersistedUiState(path)).notificationPreferences).toEqual(saved);
});

test("IPC and durable decoding reject unknown sounds and invalid volumes", () => {
  for (const partial of [
    { chimeSound: "remote-url" },
    { chimeEnabled: "yes" },
    ...[-1, 101, NaN, Infinity, 1.5, "10", null].map((chimeVolume) => ({ chimeVolume })),
  ]) {
    expect(() => expectNotificationPreferences(partial)).toThrow();
    expect(() =>
      decodePersistedUiState({ version: 20, notificationPreferences: partial }),
    ).toThrow();
  }
  expect(
    expectNotificationPreferences({
      chimeVolume: 0,
      chimeSound: "typewriter-return",
      chimeEnabled: false,
    }),
  ).toEqual({ chimeVolume: 0, chimeSound: "typewriter-return", chimeEnabled: false });
});

test("fourteen original waveforms are distinct, non-silent, bounded and quiet-to-loud", () => {
  expect(completionChimeSounds).toHaveLength(14);
  const hashes = new Set<string>();
  const energy = new Map<string, number>();
  for (const preset of completionChimeSounds) {
    const pcm = renderCompletionChime(preset.id);
    expect(pcm.length).toBeLessThanOrEqual(24000 * 2.5);
    let sum = 0,
      peak = 0,
      finite = true;
    for (const sample of pcm) {
      finite = finite && Number.isFinite(sample);
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    expect(finite).toBe(true);
    expect(peak).toBeGreaterThan(0.001);
    expect(peak).toBeLessThan(0.9);
    expect(pcm[0]).toBe(0);
    expect(Math.abs(pcm[pcm.length - 1]!)).toBeLessThan(0.001);
    hashes.add(createHash("sha256").update(new Uint8Array(pcm.buffer)).digest("hex"));
    energy.set(preset.id, sum / pcm.length);
  }
  expect(hashes.size).toBe(14);
  expect(energy.get("air-horn")!).toBeGreaterThan(energy.get("soft-tap")! * 50);
  expect(() => renderCompletionChime("soft-tap", Infinity)).toThrow();
});

test("only settled completions play, once per run and session; mute is never replayed", () => {
  const played: CompletionChimePlayback[] = [];
  const owner = new CompletionChimeCoordinator((packet) => played.push(packet));
  const event = completed();
  owner.handle({ ...event, type: "sessionOpened" }, preferences);
  owner.handle({ ...event, type: "sessionUpdated" }, preferences);
  owner.handle({ ...event, type: "assistantMessageEnded" }, preferences);
  owner.handle({ ...event, type: "toolFinished", callId: "call", success: true }, preferences);
  owner.handle({ ...event, type: "runFailed", error: { message: "fixture" } }, preferences);
  expect(played).toEqual([]);
  owner.handle(event, preferences);
  owner.handle(event, preferences);
  expect(played).toHaveLength(1);
  owner.handle(completed("run-1", "other-thread"), preferences);
  owner.handle(completed("run-2"), { ...preferences, chimeEnabled: false });
  owner.handle(completed("run-2"), preferences);
  expect(played).toHaveLength(2);
  owner.handle(completed("run-3"), { ...preferences, chimeVolume: 0 });
  owner.handle(completed("run-3"), preferences);
  expect(played).toHaveLength(2);
  owner.handle(completed("run-4"), preferences);
  expect(played).toHaveLength(3);
  owner.stop();
  owner.handle(completed("run-5"), preferences);
  expect(played).toHaveLength(3);
});

test("a disposed playback window cannot fail or retry a settled turn", () => {
  let deliveries = 0;
  const owner = new CompletionChimeCoordinator(() => {
    deliveries++;
    throw new Error("Disposed fixture window");
  });
  expect(() => owner.handle(completed(), preferences)).not.toThrow();
  owner.handle(completed(), preferences);
  expect(deliveries).toBe(1);
});

test("legacy timestamp identity and bounded dedup survive a long-lived app", () => {
  const played: CompletionChimePlayback[] = [];
  const owner = new CompletionChimeCoordinator((packet) => played.push(packet));
  const legacy = { ...completed(), runId: undefined };
  owner.handle(legacy, preferences);
  owner.handle(legacy, preferences);
  owner.handle({ ...legacy, timestamp: "2026-01-01T00:01:00.000Z" }, preferences);
  expect(played).toHaveLength(2);
  for (let i = 0; i < 501; i++)
    owner.handle(completed(`bounded-${i}`), { ...preferences, chimeEnabled: false });
  // Old identities can be evicted, but no retained event or toggling replays on its own.
  expect(played).toHaveLength(2);
  owner.handle(completed("bounded-500"), preferences);
  expect(played).toHaveLength(2);
});
