/**
 * Prompt recall is local UI navigation over the selected thread's human messages.
 * It deliberately owns no persistence, submission, or attachment behavior.
 */
export interface PromptHistoryState {
  readonly index: number | null;
  readonly draft: string;
  readonly draftSelectionStart: number;
  readonly draftSelectionEnd: number;
  readonly recalledText: string | null;
  readonly historyKey: string;
}

export interface PromptHistoryNavigationInput {
  readonly state: PromptHistoryState;
  readonly history: readonly string[];
  readonly historyKey: string;
  readonly draft: string;
  readonly key: "ArrowUp" | "ArrowDown";
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly isComposing: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly menuOpen: boolean;
}

export interface PromptHistoryNavigationResult {
  readonly handled: boolean;
  readonly state: PromptHistoryState;
  readonly draft: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

const EMPTY_STATE: PromptHistoryState = {
  index: null,
  draft: "",
  draftSelectionStart: 0,
  draftSelectionEnd: 0,
  recalledText: null,
  historyKey: "",
};

export function promptHistory_create(): PromptHistoryState {
  return EMPTY_STATE;
}

/** Stable content identity for a fresh renderer array containing the same transcript text. */
export function promptHistory_historyKey(history: readonly string[]): string {
  return history.map((entry) => `${entry.length}:${entry}`).join("|");
}

export function promptHistory_reset(): PromptHistoryState {
  return EMPTY_STATE;
}

/**
 * Returns a draft-only navigation result. The caller keeps its current attachments and decides
 * when the recalled text is submitted.
 */
export function promptHistory_navigate(
  input: PromptHistoryNavigationInput,
): PromptHistoryNavigationResult {
  const current = normalizeState(input.state, input);
  const unchanged = (state: PromptHistoryState = current) =>
    result(false, state, input.draft, input.selectionStart, input.selectionEnd);

  if (
    input.menuOpen ||
    input.isComposing ||
    input.altKey ||
    input.ctrlKey ||
    input.metaKey ||
    input.shiftKey ||
    input.selectionStart !== input.selectionEnd ||
    input.history.length === 0
  ) {
    return unchanged();
  }

  if (current.index === null) {
    if (input.key === "ArrowDown") {
      return unchanged();
    }
    if (!isOnFirstLine(input.draft, input.selectionStart)) {
      return unchanged();
    }

    const index = input.history.length - 1;
    const recalled = input.history[index];
    if (recalled === undefined) {
      return unchanged();
    }
    const state: PromptHistoryState = {
      index,
      draft: input.draft,
      draftSelectionStart: input.selectionStart,
      draftSelectionEnd: input.selectionEnd,
      recalledText: recalled,
      historyKey: input.historyKey,
    };
    return result(true, state, recalled, recalled.length, recalled.length);
  }

  if (input.key === "ArrowUp") {
    const index = Math.max(0, current.index - 1);
    const recalled = input.history[index];
    if (recalled === undefined) {
      return unchanged(current);
    }
    return result(
      true,
      { ...current, index, recalledText: recalled },
      recalled,
      recalled.length,
      recalled.length,
    );
  }

  if (current.index < input.history.length - 1) {
    const index = current.index + 1;
    const recalled = input.history[index];
    if (recalled === undefined) {
      return unchanged(current);
    }
    return result(
      true,
      { ...current, index, recalledText: recalled },
      recalled,
      recalled.length,
      recalled.length,
    );
  }

  const restored = {
    ...EMPTY_STATE,
    historyKey: input.historyKey,
  };
  return result(
    true,
    restored,
    current.draft,
    current.draftSelectionStart,
    current.draftSelectionEnd,
  );
}

function normalizeState(
  state: PromptHistoryState,
  input: PromptHistoryNavigationInput,
): PromptHistoryState {
  if (state.index === null) {
    return { ...state, historyKey: input.historyKey };
  }
  if (
    state.historyKey !== input.historyKey ||
    state.index >= input.history.length ||
    state.recalledText !== input.draft
  ) {
    return { ...EMPTY_STATE, historyKey: input.historyKey };
  }
  return state;
}

function isOnFirstLine(draft: string, selectionStart: number): boolean {
  return draft.lastIndexOf("\n", Math.max(0, selectionStart - 1)) < 0;
}

function result(
  handled: boolean,
  state: PromptHistoryState,
  draft: string,
  selectionStart: number,
  selectionEnd: number,
): PromptHistoryNavigationResult {
  return { handled, state, draft, selectionStart, selectionEnd };
}
