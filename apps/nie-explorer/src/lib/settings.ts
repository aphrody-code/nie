// Paramètres persistés (localStorage — pas de plugin-store nécessaire pour ces quelques valeurs).
import { useSyncExternalStore } from "react";

export type Locale = "fr" | "en" | "ja";

export interface Settings {
  gameDir: string;
  wikiDb: string;
  blenderExe: string;
  azaleeUrl: string;
  /** Langue de l'interface. */
  locale: Locale;
  /** Échelle de la taille de police de base (agit sur `html { font-size }`, tout le reste est en rem). */
  fontScale: number;
  /** Zoom global de l'interface (CSS `zoom`, WebView2/Chromium). */
  uiZoom: number;
}

// Le thème clair/sombre/système est géré par next-themes (sa propre clé localStorage
// "theme") — pas dupliqué ici pour éviter deux sources de vérité qui divergent.
const KEY = "nie-explorer:settings";
const DEFAULTS: Settings = {
  gameDir: "",
  wikiDb: "",
  blenderExe: "",
  azaleeUrl: "",
  locale: "fr",
  fontScale: 1,
  uiZoom: 1,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let state: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return state;
}

export function setSettings(patch: Partial<Settings>): void {
  state = { ...state, ...patch };
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Hook réactif : re-render au moindre `setSettings`, sans provider/context. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
