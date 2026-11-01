import { expect, test } from "@playwright/test";
import {
  promptHistory_create,
  promptHistory_historyKey,
  promptHistory_navigate,
  type PromptHistoryNavigationInput,
} from "../../src/features/conversation/prompt-history";

const history = ["first prompt", "second prompt\nwith a second line"];

function input(
  overrides: Partial<PromptHistoryNavigationInput> = {},
): PromptHistoryNavigationInput {
  return {
    state: promptHistory_create(),
    history,
    historyKey: promptHistory_historyKey(history),
    draft: "unsent draft",
    key: "ArrowUp",
    selectionStart: 0,
    selectionEnd: 0,
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    menuOpen: false,
    ...overrides,
  };
}

test("empty history and new-draft ArrowDown stay native", () => {
  const empty = input({ history: [], historyKey: promptHistory_historyKey([]) });
  expect(promptHistory_navigate(empty).handled).toBe(false);
  expect(promptHistory_navigate(empty).draft).toBe("unsent draft");

  const down = input({ key: "ArrowDown" });
  expect(promptHistory_navigate(down).handled).toBe(false);
  expect(promptHistory_navigate(down).draft).toBe("unsent draft");
});

test("Up recalls newest first and Down restores the exact unsent draft and caret", () => {
  const draft = "line one\nline two";
  const first = promptHistory_navigate(input({ draft, selectionStart: 4, selectionEnd: 4 }));
  expect(first).toMatchObject({
    handled: true,
    draft: history[1],
    selectionStart: history[1]?.length,
    selectionEnd: history[1]?.length,
  });

  const second = promptHistory_navigate(
    input({
      state: first.state,
      draft: first.draft,
      selectionStart: first.selectionStart,
      selectionEnd: first.selectionEnd,
    }),
  );
  expect(second.draft).toBe(history[0]);

  const third = promptHistory_navigate(
    input({
      state: second.state,
      key: "ArrowDown",
      draft: second.draft,
      selectionStart: second.selectionStart,
      selectionEnd: second.selectionEnd,
    }),
  );
  expect(third.draft).toBe(history[1]);

  const restored = promptHistory_navigate(
    input({
      state: third.state,
      key: "ArrowDown",
      draft: third.draft,
      selectionStart: third.selectionStart,
      selectionEnd: third.selectionEnd,
    }),
  );
  expect(restored).toMatchObject({
    handled: true,
    draft,
    selectionStart: 4,
    selectionEnd: 4,
  });
  expect(restored.state.index).toBeNull();
});

test("multiline cursor positions keep native Up behavior until the first line", () => {
  const middle = promptHistory_navigate(
    input({
      draft: "first\nsecond\nthird",
      selectionStart: "first\nsec".length,
      selectionEnd: "first\nsec".length,
    }),
  );
  expect(middle).toMatchObject({
    handled: false,
    draft: "first\nsecond\nthird",
  });

  const firstLine = promptHistory_navigate(
    input({
      draft: "first\nsecond\nthird",
      selectionStart: 2,
      selectionEnd: 2,
    }),
  );
  expect(firstLine).toMatchObject({ handled: true, draft: history[1] });
});

test("selection, modifiers, IME and open menus never replace text", () => {
  for (const blocked of [
    input({ selectionStart: 1, selectionEnd: 4 }),
    input({ shiftKey: true }),
    input({ altKey: true }),
    input({ ctrlKey: true }),
    input({ metaKey: true }),
    input({ isComposing: true }),
    input({ menuOpen: true }),
  ]) {
    const navigation = promptHistory_navigate(blocked);
    expect(navigation.handled).toBe(false);
    expect(navigation.draft).toBe(blocked.draft);
  }
});

test("history mutation resets navigation instead of applying an old index", () => {
  const recalled = promptHistory_navigate(input());
  const changedHistory = ["newer only"];
  const changed = promptHistory_navigate(
    input({
      state: recalled.state,
      history: changedHistory,
      historyKey: promptHistory_historyKey(changedHistory),
      key: "ArrowDown",
      draft: recalled.draft,
      selectionStart: recalled.selectionStart,
      selectionEnd: recalled.selectionEnd,
    }),
  );
  expect(changed.handled).toBe(false);
  expect(changed.draft).toBe(recalled.draft);
  expect(changed.state.index).toBeNull();
});

test("editing or externally replacing a recalled draft ends that history walk", () => {
  const recalled = promptHistory_navigate(input());
  const replacedDraft = "a replacement draft\non two lines";
  const replaced = promptHistory_navigate(
    input({
      state: recalled.state,
      key: "ArrowDown",
      draft: replacedDraft,
      selectionStart: 0,
      selectionEnd: 0,
    }),
  );
  expect(replaced.handled).toBe(false);
  expect(replaced.draft).toBe(replacedDraft);
  expect(replaced.state.index).toBeNull();

  const restarted = promptHistory_navigate(
    input({
      state: replaced.state,
      draft: replacedDraft,
      selectionStart: 0,
      selectionEnd: 0,
    }),
  );
  expect(restarted.handled).toBe(true);
  expect(restarted.draft).toBe(history[1]);
  expect(restarted.state.index).toBe(history.length - 1);

  const replacementRestored = promptHistory_navigate(
    input({
      state: restarted.state,
      key: "ArrowDown",
      draft: restarted.draft,
      selectionStart: restarted.selectionStart,
      selectionEnd: restarted.selectionEnd,
    }),
  );
  expect(replacementRestored.handled).toBe(true);
  expect(replacementRestored.draft).toBe(replacedDraft);
  expect(replacementRestored.state.index).toBeNull();
});

test("recall returns text only, never attachment or submission state", () => {
  const navigation = promptHistory_navigate(input());
  expect(Object.keys(navigation).sort()).toEqual([
    "draft",
    "handled",
    "selectionEnd",
    "selectionStart",
    "state",
  ]);
  expect(navigation.draft).toBe(history[1]);
  expect(JSON.stringify(navigation)).not.toMatch(/attachment|submit|queue|steer/i);
});
