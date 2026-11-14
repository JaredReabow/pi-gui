/** Stable, offline-only sound choices shared by settings, Main and the renderer. */
export const completionChimeSounds = [
  { id: "soft-tap", intensity: "quiet", strength: 0.07, duration: 0.3 },
  { id: "felt-bell", intensity: "quiet", strength: 0.12, duration: 0.9 },
  { id: "wind-chimes", intensity: "quiet", strength: 0.18, duration: 1.7 },
  { id: "glass-ping", intensity: "gentle", strength: 0.23, duration: 1.1 },
  { id: "marimba", intensity: "gentle", strength: 0.28, duration: 0.9 },
  { id: "typewriter-return", intensity: "gentle", strength: 0.5, duration: 1.25 },
  { id: "desk-bell", intensity: "bright", strength: 0.52, duration: 1.3 },
  { id: "digital-chirp", intensity: "bright", strength: 0.45, duration: 0.65 },
  { id: "arcade", intensity: "bright", strength: 0.5, duration: 0.95 },
  { id: "doorbell", intensity: "bright", strength: 0.6, duration: 1.6 },
  { id: "gong", intensity: "bold", strength: 0.7, duration: 2.4 },
  { id: "fanfare", intensity: "bold", strength: 0.75, duration: 1.7 },
  { id: "klaxon", intensity: "loud", strength: 0.85, duration: 1.5 },
  { id: "air-horn", intensity: "loud", strength: 0.95, duration: 1.4 },
] as const;
export type CompletionChimeSoundId = (typeof completionChimeSounds)[number]["id"];
export interface CompletionChimePreferences {
  readonly chimeEnabled: boolean;
  readonly chimeSound: CompletionChimeSoundId;
  readonly chimeVolume: number;
}
export const defaultCompletionChimePreferences: CompletionChimePreferences = {
  chimeEnabled: true,
  chimeSound: "typewriter-return",
  chimeVolume: 60,
};
export interface CompletionChimePlayback {
  readonly sound: CompletionChimeSoundId;
  readonly volume: number;
}
export function isCompletionChimeSound(value: unknown): value is CompletionChimeSoundId {
  return completionChimeSounds.some((sound) => sound.id === value);
}
export function isChimeVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}
