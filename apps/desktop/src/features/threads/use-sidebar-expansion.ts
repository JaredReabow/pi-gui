import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

export const SIDEBAR_EXPANSION_KEY = "pi-gui.sidebar-expansion.v1";
export interface SidebarExpansion {
  readonly collapsedThreads: ReadonlySet<string>;
  readonly expandedHistory: ReadonlySet<string>;
  readonly archivedOpen: boolean;
}
const defaults = (): SidebarExpansion => ({
  collapsedThreads: new Set(),
  expandedHistory: new Set(),
  archivedOpen: false,
});
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item: unknown) => typeof item === "string" && item.length > 0);
/** Presentation-only preferences; never session history or authority. */
export function decodeSidebarExpansion(raw: string | null): SidebarExpansion {
  try {
    if (raw === null) return defaults();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults();
    const saved = value as Record<string, unknown>;
    if (
      saved.version !== 1 ||
      !strings(saved.collapsedThreads) ||
      !strings(saved.expandedHistory) ||
      typeof saved.archivedOpen !== "boolean"
    )
      return defaults();
    return {
      collapsedThreads: new Set(saved.collapsedThreads),
      expandedHistory: new Set(saved.expandedHistory),
      archivedOpen: saved.archivedOpen,
    };
  } catch {
    return defaults();
  }
}
export function readSidebarExpansion(storage?: Pick<Storage, "getItem">): SidebarExpansion {
  try {
    return decodeSidebarExpansion(
      (storage ?? globalThis.localStorage)?.getItem(SIDEBAR_EXPANSION_KEY) ?? null,
    );
  } catch {
    return defaults();
  }
}
export function saveSidebarExpansion(
  value: SidebarExpansion,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(
      SIDEBAR_EXPANSION_KEY,
      JSON.stringify({
        version: 1,
        collapsedThreads: [...value.collapsedThreads],
        expandedHistory: [...value.expandedHistory],
        archivedOpen: value.archivedOpen,
      }),
    );
  } catch {
    // Keep the current window usable if browser storage is unavailable/full.
  }
}
export function useSidebarExpansion() {
  const [state, setState] = useState(readSidebarExpansion);
  const current = useRef(state);
  const update = useCallback((change: (value: SidebarExpansion) => SidebarExpansion) => {
    const next = change(current.current);
    if (next === current.current) return;
    current.current = next;
    // Save synchronously on the actual change, not in a mount/cleanup effect:
    // immediate Quit, Settings and sidebar remounts must keep the last choice.
    saveSidebarExpansion(next);
    setState(next);
  }, []);
  const setCollapsedThreads = useCallback(
    (value: SetStateAction<ReadonlySet<string>>) =>
      update((previous) => {
        const next = typeof value === "function" ? value(previous.collapsedThreads) : value;
        return next === previous.collapsedThreads
          ? previous
          : { ...previous, collapsedThreads: next };
      }),
    [update],
  );
  const setExpandedHistory = useCallback(
    (value: SetStateAction<ReadonlySet<string>>) =>
      update((previous) => {
        const next = typeof value === "function" ? value(previous.expandedHistory) : value;
        return next === previous.expandedHistory
          ? previous
          : { ...previous, expandedHistory: next };
      }),
    [update],
  );
  const setArchivedOpen = useCallback(
    (value: SetStateAction<boolean>) =>
      update((previous) => {
        const next = typeof value === "function" ? value(previous.archivedOpen) : value;
        return next === previous.archivedOpen ? previous : { ...previous, archivedOpen: next };
      }),
    [update],
  );
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SIDEBAR_EXPANSION_KEY) return;
      const next = readSidebarExpansion();
      current.current = next;
      setState(next);
    };
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, []);
  return { ...state, setCollapsedThreads, setExpandedHistory, setArchivedOpen };
}
