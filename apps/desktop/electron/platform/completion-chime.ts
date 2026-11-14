import { sessionKey, type SessionDriverEvent } from "@pi-gui/session-driver";
import type { NotificationPreferences } from "../../contracts/desktop-state";
import type { CompletionChimePlayback } from "../../contracts/completion-chime";
import { isChimeVolume, isCompletionChimeSound } from "../../contracts/completion-chime";

/** Live settled-success events only; never infer completion from a hydrated snapshot. */
export class CompletionChimeCoordinator {
  private readonly consumed = new Set<string>();
  private stopped = false;
  constructor(private readonly dispatch: (playback: CompletionChimePlayback) => void) {}
  handle(event: SessionDriverEvent, preferences: NotificationPreferences): void {
    if (this.stopped || event.type !== "runCompleted") return;
    const key = JSON.stringify([sessionKey(event.sessionRef), event.runId ?? event.timestamp]);
    if (this.consumed.has(key)) return;
    this.consumed.add(key);
    if (this.consumed.size > 500) this.consumed.delete(this.consumed.values().next().value!);
    // Muted completions are consumed too, and never replay when enabled later.
    if (
      preferences.chimeEnabled &&
      preferences.chimeVolume > 0 &&
      isChimeVolume(preferences.chimeVolume) &&
      isCompletionChimeSound(preferences.chimeSound)
    ) {
      try {
        this.dispatch({ sound: preferences.chimeSound, volume: preferences.chimeVolume });
      } catch {
        // Audio delivery is best-effort and must never fail the model's settled turn.
        console.warn("[completion-chime] Playback window unavailable");
      }
    }
  }
  stop(): void {
    this.stopped = true;
    this.consumed.clear();
  }
}
