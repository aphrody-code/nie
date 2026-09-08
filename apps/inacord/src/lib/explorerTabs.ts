import { useSyncExternalStore } from "react";
import {
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
  type ExplorerTab,
  type ExplorerTabPatch,
  type ExplorerTabsState,
} from "@niers/inacord-ui/explorer/explorer-tabs";

export {
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
};
export type {
  ExplorerSortKey,
  ExplorerTab,
  ExplorerTabPatch,
  ExplorerTabsState,
  ExplorerViewMode,
} from "@niers/inacord-ui/explorer/explorer-tabs";

const STORAGE_KEY = "nie-explorer:tabs";
/** Préfixe du premier onglet — l'Explorateur s'ouvrait déjà là avant les onglets. */
const DEFAULT_PREFIX = "data";

let idSeq = 0;

/** Identifiant d'onglet unique pour la session — le compteur est réamorcé au-dessus des ids
 * restaurés pour qu'un onglet neuf n'entre jamais en collision avec un onglet persisté. */
export function newTabId(): string {
  idSeq += 1;
  return `tab-${idSeq}`;
}

function freshState(): ExplorerTabsState {
  const id = newTabId();
  return { tabs: [makeTab(id, DEFAULT_PREFIX)], activeId: id };
}

/** Restauration DÉFENSIVE : un `localStorage` absent, corrompu, d'une version antérieure du type
 * ou réduit à un tableau vide doit rendre l'Explorateur utilisable, pas le laisser sans onglet. */
function load(): ExplorerTabsState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return freshState();
  }
  if (!raw) return freshState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return freshState();
    const src = (parsed as { tabs?: unknown }).tabs;
    if (!Array.isArray(src)) return freshState();
    const tabs: ExplorerTab[] = [];
    for (const t of src) {
      if (!t || typeof t !== "object") continue;
      const o = t as Record<string, unknown>;
      if (typeof o.prefix !== "string") continue;
      const id = typeof o.id === "string" && o.id ? o.id : newTabId();
      if (tabs.some((x) => x.id === id)) continue;
      const history = Array.isArray(o.history) && o.history.every((h) => typeof h === "string")
        ? (o.history as string[])
        : [o.prefix];
      const rawIndex = typeof o.historyIndex === "number" ? o.historyIndex : history.length - 1;
      const historyIndex = Math.min(Math.max(0, Math.trunc(rawIndex)), Math.max(0, history.length - 1));
      tabs.push({
        id,
        prefix: o.prefix,
        selected: typeof o.selected === "string" ? o.selected : null,
        ...(typeof o.query === "string" ? { query: o.query } : {}),
        ...(typeof o.ext === "string" ? { ext: o.ext } : {}),
        ...(o.sortKey === "name" || o.sortKey === "size" ? { sortKey: o.sortKey } : {}),
        ...(o.viewMode === "list" || o.viewMode === "grid" ? { viewMode: o.viewMode } : {}),
        ...(typeof o.gridSize === "number" && Number.isFinite(o.gridSize) ? { gridSize: o.gridSize } : {}),
        history: history.length > 0 ? history : [o.prefix],
        historyIndex,
      });
    }
    if (tabs.length === 0) return freshState();
    // Le compteur d'ids doit dépasser tout id restauré, sinon `newTabId` recréerait une clé déjà
    // présente (deux onglets indistinguables côté React et côté actions).
    for (const t of tabs) {
      const n = /^tab-(\d+)$/.exec(t.id);
      if (n) idSeq = Math.max(idSeq, Number(n[1]));
    }
    const wanted = (parsed as { activeId?: unknown }).activeId;
    const activeId = typeof wanted === "string" && tabs.some((t) => t.id === wanted) ? wanted : tabs[0]!.id;
    return { tabs, activeId };
  } catch {
    return freshState();
  }
}

let state: ExplorerTabsState = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota plein ou stockage refusé : les onglets restent parfaitement utilisables en mémoire.
  }
  listeners.forEach((l) => l());
}

function apply(fn: (s: ExplorerTabsState) => ExplorerTabsState): void {
  const next = fn(state);
  if (next === state) return; // identité inchangée = aucun rendu inutile
  state = next;
  persist();
}

export function getExplorerTabs(): ExplorerTabsState {
  return state;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Onglets de l'Explorateur (hook réactif, sans provider — comme `usePinnedPlaces`). */
export function useExplorerTabs(): ExplorerTabsState {
  return useSyncExternalStore(subscribe, getExplorerTabs);
}

/** Actions liées au store — chacune délègue au réducteur pur correspondant. */
export const explorerTabs = {
  open(prefix: string, selected: string | null = null, activate = true): string {
    const id = newTabId();
    apply((s) => openTab(s, id, prefix, selected, activate));
    return id;
  },
  close(id: string): void {
    apply((s) => closeTab(s, id));
  },
  activate(id: string): void {
    apply((s) => activateTab(s, id));
  },
  cycle(delta: number): void {
    apply((s) => cycleTab(s, delta));
  },
  update(id: string, patch: ExplorerTabPatch): void {
    apply((s) => updateTab(s, id, patch));
  },
  back(id: string): void {
    apply((s) => goBack(s, id));
  },
  forward(id: string): void {
    apply((s) => goForward(s, id));
  },
};
