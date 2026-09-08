/** Host-neutral state and reducers for Explorer tabs. */

export type ExplorerSortKey = "name" | "size";
export type ExplorerViewMode = "list" | "grid";

export interface ExplorerTab {
  /** Stable identity used by renderers and tab actions. */
  id: string;
  prefix: string;
  selected: string | null;
  query?: string;
  ext?: string;
  sortKey?: ExplorerSortKey;
  viewMode?: ExplorerViewMode;
  gridSize?: number;
  /** Visited prefixes, ordered from oldest to newest. */
  history: string[];
  /** Current position in `history`; later entries form the forward stack. */
  historyIndex: number;
}

export interface ExplorerTabsState {
  tabs: ExplorerTab[];
  activeId: string;
}

/** Fields controlled by a tab consumer; identity and history remain reducer-owned. */
export type ExplorerTabPatch = Partial<Omit<ExplorerTab, "id" | "history" | "historyIndex">>;

export const EXPLORER_HISTORY_MAX = 64;

export function makeTab(id: string, prefix: string, selected: string | null = null): ExplorerTab {
  return { id, prefix, selected, history: [prefix], historyIndex: 0 };
}

/** Insert a tab immediately after the active tab, matching browser tab behavior. */
export function openTab(
  state: ExplorerTabsState,
  id: string,
  prefix: string,
  selected: string | null = null,
  activate = true,
): ExplorerTabsState {
  const tab = makeTab(id, prefix, selected);
  const activeIndex = state.tabs.findIndex((candidate) => candidate.id === state.activeId);
  const tabs = [...state.tabs];
  tabs.splice(activeIndex === -1 ? tabs.length : activeIndex + 1, 0, tab);
  return { tabs, activeId: activate ? id : state.activeId };
}

/** Close one tab while preserving the invariant that at least one tab remains. */
export function closeTab(state: ExplorerTabsState, id: string): ExplorerTabsState {
  if (state.tabs.length <= 1) return state;
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (id !== state.activeId) return { tabs, activeId: state.activeId };
  return { tabs, activeId: tabs[Math.min(index, tabs.length - 1)]!.id };
}

export function activateTab(state: ExplorerTabsState, id: string): ExplorerTabsState {
  if (id === state.activeId || !state.tabs.some((tab) => tab.id === id)) return state;
  return { tabs: state.tabs, activeId: id };
}

/** Cycle through tabs with wraparound. */
export function cycleTab(state: ExplorerTabsState, delta: number): ExplorerTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
  if (index === -1 || state.tabs.length < 2) return state;
  const count = state.tabs.length;
  return { tabs: state.tabs, activeId: state.tabs[(((index + delta) % count) + count) % count]!.id };
}

/** Apply a patch and record prefix changes in this tab's bounded history. */
export function updateTab(
  state: ExplorerTabsState,
  id: string,
  patch: ExplorerTabPatch,
): ExplorerTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return state;
  const previous = state.tabs[index]!;
  const next: ExplorerTab = { ...previous, ...patch };
  if (patch.prefix !== undefined && patch.prefix !== previous.prefix) {
    const history = previous.history.slice(0, previous.historyIndex + 1);
    history.push(patch.prefix);
    next.history = history.length > EXPLORER_HISTORY_MAX
      ? history.slice(history.length - EXPLORER_HISTORY_MAX)
      : history;
    next.historyIndex = next.history.length - 1;
  }
  const tabs = [...state.tabs];
  tabs[index] = next;
  return { tabs, activeId: state.activeId };
}

export function canGoBack(tab: ExplorerTab): boolean {
  return tab.historyIndex > 0;
}

export function canGoForward(tab: ExplorerTab): boolean {
  return tab.historyIndex < tab.history.length - 1;
}

export function goBack(state: ExplorerTabsState, id: string): ExplorerTabsState {
  return travel(state, id, -1);
}

export function goForward(state: ExplorerTabsState, id: string): ExplorerTabsState {
  return travel(state, id, 1);
}

function travel(state: ExplorerTabsState, id: string, delta: number): ExplorerTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return state;
  const previous = state.tabs[index]!;
  const historyIndex = previous.historyIndex + delta;
  if (historyIndex < 0 || historyIndex >= previous.history.length) return state;
  const tabs = [...state.tabs];
  tabs[index] = {
    ...previous,
    prefix: previous.history[historyIndex]!,
    selected: null,
    historyIndex,
  };
  return { tabs, activeId: state.activeId };
}
