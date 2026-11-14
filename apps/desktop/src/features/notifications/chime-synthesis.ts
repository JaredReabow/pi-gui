import {
  completionChimeSounds,
  type CompletionChimeSoundId,
} from "../../../contracts/completion-chime";

const tau = Math.PI * 2;
const sine = (frequency: number, time: number) => Math.sin(tau * frequency * time);
function strike(time: number, start: number, frequency: number, length: number, decay = 5): number {
  const t = time - start;
  if (t < 0 || t >= length) return 0;
  return (
    Math.min(t / 0.004, 1) *
    Math.min((length - t) / 0.02, 1) *
    Math.exp((-decay * t) / length) *
    sine(frequency, t)
  );
}
function bell(time: number, frequency: number, length: number): number {
  return (
    strike(time, 0, frequency, length, 3) +
    0.38 * strike(time, 0, frequency * 2.71, length, 6) +
    0.17 * strike(time, 0, frequency * 4.07, length, 9)
  );
}
function notes(
  time: number,
  frequencies: readonly number[],
  spacing: number,
  length: number,
): number {
  return frequencies.reduce((sum, hz, index) => sum + strike(time, index * spacing, hz, length), 0);
}
/** First-party procedural PCM: no downloads, platform sound files or recorded samples. */
export function renderCompletionChime(
  sound: CompletionChimeSoundId,
  sampleRate = 24000,
): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000)
    throw new Error("Unsupported chime sample rate");
  const preset = completionChimeSounds.find((candidate) => candidate.id === sound);
  if (!preset) throw new Error("Unknown completion chime");
  const samples = new Float32Array(Math.ceil(preset.duration * sampleRate));
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    let value = 0;
    switch (sound) {
      case "soft-tap":
        value = strike(t, 0, 440, 0.3, 12);
        break;
      case "felt-bell":
        value = strike(t, 0, 660, 0.9) + 0.15 * strike(t, 0, 1320, 0.4);
        break;
      case "wind-chimes":
        value = notes(t, [1174.66, 1567.98, 1318.51, 1760], 0.21, 0.95);
        break;
      case "glass-ping":
        value = bell(t, 2349.32, 1.1);
        break;
      case "marimba":
        value = notes(t, [523.25, 659.25, 783.99], 0.14, 0.45);
        break;
      case "typewriter-return": {
        // Inharmonic metal bell, hammer transient and a short mechanical carriage rasp.
        const noise = ((Math.imul(i + 1, 1103515245) >>> 8) % 65536) / 32768 - 1;
        value = bell(t, 2200, 1.25) + 0.5 * noise * Math.exp(-t * 180);
        if (t > 0.11 && t < 0.28)
          value +=
            0.13 * noise * Math.sin((Math.PI * (t - 0.11)) / 0.17) * (0.6 + 0.4 * sine(65, t));
        break;
      }
      case "desk-bell":
        value = bell(t, 1318.51, 1.3);
        break;
      case "digital-chirp":
        value = strike(t, 0, 1200, 0.18, 1) + strike(t, 0.24, 1800, 0.3, 2);
        break;
      case "arcade":
        value = notes(t, [523.25, 659.25, 783.99, 1046.5], 0.12, 0.4);
        break;
      case "doorbell":
        value = strike(t, 0, 783.99, 0.9, 2) + strike(t, 0.55, 659.25, 1.05, 3);
        break;
      case "gong":
        value = bell(t, 146.83, 2.4) + 0.45 * strike(t, 0, 233.08, 2.4, 2);
        break;
      case "fanfare":
        value =
          notes(t, [523.25, 523.25, 659.25, 783.99, 1046.5], 0.22, 0.75) *
          (1 + 0.25 * sine(523.25 * 2, t));
        break;
      case "klaxon":
        value =
          (sine(Math.floor(t / 0.18) % 2 ? 820 : 620, t) + 0.35 * sine(1860, t)) *
          Math.min(t / 0.02, 1);
        break;
      case "air-horn":
        value = 0.8 * (sine(220, t) + sine(277.18, t) + sine(329.63, t)) + 0.3 * sine(660, t);
        break;
    }
    const fade = Math.min(t / 0.002, 1, (preset.duration - t) / 0.035);
    samples[i] = Math.tanh(value) * preset.strength * 0.9 * Math.max(fade, 0);
  }
  return samples;
}
