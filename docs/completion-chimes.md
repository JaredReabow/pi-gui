# Completion chimes

The bell immediately beside Send/Stop toggles completion sounds for the whole app, including background threads. It remains available during a run. New profiles and older notification preferences default to enabled, **Typewriter return bell**, at **60%** volume.

Open **Settings → Notifications → Completion chime** for the master switch, sound choice, volume and explicit Preview. There are fourteen original, offline sounds: Soft tap, Felt bell, Wind chimes, Glass ping, Marimba, Typewriter return bell, Desk bell, Digital chirp, Arcade success, Doorbell, Gong, Fanfare, Klaxon and Air horn. Intensity labels run from very quiet to loud/obnoxious. Selecting a sound does not play it automatically. Preview works while the master switch is muted; start with low volume for loud presets. Volume zero is silent.

These settings persist with the existing notification preferences. They are independent of desktop-notification permission and existing system alert sounds.

## Behavior and boundaries

Only live successful `runCompleted` events from the settled SDK run trigger a chime. Intermediate assistant/tool messages, Stop, failures, history loading, thread switching and startup do not. Muted completions are consumed, not replayed when re-enabled. A bounded Main-process deduplication set protects against repeated run events. Playback is sent to the primary app window only; no sound is queued for a window that does not exist.

The renderer generates first-party PCM locally with Web Audio. No recorded third-party samples, downloads, remote services or native player commands are used. Sounds last at most 2.4 seconds, have bounded levels and edge envelopes, and share a three-voice playback limit and output compressor. The typewriter combines an inharmonic struck metal bell, hammer transient and short carriage texture. Audio output still depends on the system device/volume and the browser's existing audio policy; the app does not weaken permissions to force playback.

## Verification

- `apps/desktop/tests/unit/completion-chime.spec.ts`: defaults, migration, validation, persistence, distinct bounded waveforms and completion routing.
- `apps/desktop/tests/core/completion-chime.spec.ts`: real Electron controls, quiet Web Audio graph playback, restart, background completion, and deterministic SDK success/Stop/failure. The spec also supports the shared packaged-app launcher.

Fixture-backed SDK and audio-graph checks do not establish external-provider service behavior or subjective human listening quality.
