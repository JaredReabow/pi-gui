import {
  isChimeVolume,
  isCompletionChimeSound,
  type CompletionChimePlayback,
} from "../../../contracts/completion-chime";
import { renderCompletionChime } from "./chime-synthesis";

let context: AudioContext | undefined;
let output: DynamicsCompressorNode | undefined;
const active = new Set<AudioBufferSourceNode>();

export async function playCompletionChime(playback: CompletionChimePlayback): Promise<void> {
  if (!isCompletionChimeSound(playback.sound) || !isChimeVolume(playback.volume))
    throw new Error("Invalid chime playback");
  if (playback.volume === 0) return;
  if (!context || context.state === "closed") {
    context = new AudioContext();
    output = context.createDynamicsCompressor();
    output.threshold.value = -8;
    output.knee.value = 12;
    output.ratio.value = 12;
    output.connect(context.destination);
  }
  const audio = context;
  if (audio.state === "suspended") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        audio.resume(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Audio is suspended. Try Preview after interacting with the app.")),
            2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  if (audio.state !== "running" || context !== audio) throw new Error("Chime audio is unavailable");
  while (active.size >= 3) {
    const oldest = active.values().next().value;
    if (!oldest) break;
    active.delete(oldest);
    oldest.stop();
  }
  const pcm = renderCompletionChime(playback.sound);
  const buffer = audio.createBuffer(1, pcm.length, 24000);
  buffer.getChannelData(0).set(pcm);
  const source = audio.createBufferSource();
  const gain = audio.createGain();
  gain.gain.value = playback.volume / 100;
  source.buffer = buffer;
  source.connect(gain);
  gain.connect(output!);
  active.add(source);
  source.onended = () => {
    active.delete(source);
    source.disconnect();
    gain.disconnect();
  };
  source.start();
}

export function stopCompletionChimes(): void {
  for (const source of active) source.stop();
  active.clear();
  const old = context;
  context = undefined;
  output = undefined;
  if (old && old.state !== "closed") void old.close().catch(() => undefined);
}
