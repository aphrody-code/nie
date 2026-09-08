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
  restoreExplorerTabs,
  updateTab,
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
    const restored = restoreExplorerTabs(JSON.parse(raw), newTabId);
    if (!restored) return freshState();
    // Le compteur d'ids doit dépasser tout id restauré, sinon `newTabId` recréerait une clé déjà
    // présente (deux onglets indistinguables côté React et côté actions).
    for (const t of restored.tabs) {
      const n = /^tab-(\d+)$/.exec(t.id);
      if (n) idSeq = Math.max(idSeq, Number(n[1]));
    }
    return restored;
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
