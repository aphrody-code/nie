import { describe, expect, test } from "bun:test";

import {
  EXPLORER_HISTORY_MAX,
  activateTab,
  canGoBack,
  canGoForward,
  closeTab,
  cycleTab,
  goBack,
  goForward,
  makeTab,
  openTab,
  updateTab,
  type ExplorerTabsState,
} from "./explorer-tabs";

function state(...ids: string[]): ExplorerTabsState {
  return { tabs: ids.map((id) => makeTab(id, `data/${id}`)), activeId: ids[0]! };
}

describe("Explorer tab reducers", () => {
  test("opens after the active tab and optionally preserves activation", () => {
    const initial = { ...state("a", "b"), activeId: "a" };
    const opened = openTab(initial, "c", "data/new", "data/new/file.g4tx", false);
    expect(opened.tabs.map((tab) => tab.id)).toEqual(["a", "c", "b"]);
    expect(opened.tabs[1]).toMatchObject({ prefix: "data/new", selected: "data/new/file.g4tx" });
    expect(opened.activeId).toBe("a");
  });

  test("closes the active tab onto its nearest neighbor but never closes the last tab", () => {
    const initial = { ...state("a", "b", "c"), activeId: "b" };
    const closed = closeTab(initial, "b");
    expect(closed.tabs.map((tab) => tab.id)).toEqual(["a", "c"]);
    expect(closed.activeId).toBe("c");
    const only = state("only");
    expect(closeTab(only, "only")).toBe(only);
    expect(closeTab(only, "missing")).toBe(only);
  });

  test("activates and cycles with wraparound", () => {
    const initial = state("a", "b", "c");
    expect(activateTab(initial, "b").activeId).toBe("b");
    expect(cycleTab(initial, -1).activeId).toBe("c");
    expect(cycleTab({ ...initial, activeId: "c" }, 1).activeId).toBe("a");
    expect(activateTab(initial, "missing")).toBe(initial);
  });

  test("records navigation, clears the forward branch, and travels without adding history", () => {
    let current = state("a");
    current = updateTab(current, "a", { prefix: "data/one", selected: "old" });
    current = updateTab(current, "a", { prefix: "data/two", query: "player" });
    expect(canGoBack(current.tabs[0]!)).toBe(true);
    current = goBack(current, "a");
    expect(current.tabs[0]).toMatchObject({ prefix: "data/one", selected: null, historyIndex: 1 });
    expect(canGoForward(current.tabs[0]!)).toBe(true);
    current = updateTab(current, "a", { prefix: "data/branch" });
    expect(current.tabs[0]!.history).toEqual(["data/a", "data/one", "data/branch"]);
    expect(canGoForward(current.tabs[0]!)).toBe(false);
    expect(goForward(current, "a")).toBe(current);
  });

  test("bounds history while retaining the newest prefix", () => {
    let current = state("a");
    for (let index = 0; index < EXPLORER_HISTORY_MAX + 5; index += 1) {
      current = updateTab(current, "a", { prefix: `data/${index}` });
    }
    expect(current.tabs[0]!.history).toHaveLength(EXPLORER_HISTORY_MAX);
    expect(current.tabs[0]!.history.at(-1)).toBe(`data/${EXPLORER_HISTORY_MAX + 4}`);
  });
});
