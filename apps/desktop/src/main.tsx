import React from "react";
import ReactDOM from "react-dom/client";
import { earlyModifierChords, getSidePanelTabCommand } from "../contracts/ipc";
import App from "./app/App";
import { playCompletionChime, stopCompletionChimes } from "./features/notifications/chime-player";
import { RendererErrorBoundary } from "./app/desktop-recovery";
import { WindowFrame } from "./app/window-titlebar";
import { I18nProvider } from "./i18n";
import { applyLastTheme } from "./ui/active-theme";
import "./dev-reload-hook";
import "./styles.css";

window.addEventListener(
  "keydown",
  (event) => {
    // Control+digit on macOS selects a side panel tab, not a thread; main queues it.
    const platform = window.piApp?.platform ?? "linux";
    const chord = {
      meta: event.metaKey,
      control: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      key: event.key,
      code: event.code,
    };
    if (getSidePanelTabCommand(platform, chord)) return;
    earlyModifierChords.note({
      modifier: event.metaKey || event.ctrlKey,
      shift: event.shiftKey,
      key: event.key,
      code: event.code,
    });
  },
  true,
);

applyLastTheme();

const unsubscribeChimes = window.piApp?.onCompletionChime((playback) => {
  void playCompletionChime(playback).catch((error: unknown) => {
    console.warn("[completion-chime] Playback unavailable", error);
  });
});
const disposeChimes = () => {
  unsubscribeChimes?.();
  stopCompletionChimes();
};
window.addEventListener("beforeunload", disposeChimes, { once: true });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    window.removeEventListener("beforeunload", disposeChimes);
    disposeChimes();
  });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <WindowFrame api={window.piApp}>
        <RendererErrorBoundary
          onRelaunch={() => {
            window.piApp?.relaunchApplication()?.catch((error: unknown) => {
              console.error("[renderer] relaunchApplication failed", error);
            });
          }}
        >
          <App />
        </RendererErrorBoundary>
      </WindowFrame>
    </I18nProvider>
  </React.StrictMode>,
);
