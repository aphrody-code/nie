// Paramètres persistés (localStorage — pas de plugin-store nécessaire pour ces quelques valeurs).
import { useSyncExternalStore } from "react";

export type Locale = "fr" | "en" | "ja";

/** Palette d'accent — `azalee` (défaut, MD3 seed #F89C5A, identité historique niers/azalee) ou
 * `spacedrive` (portage des tokens `var/spaceui/packages/tokens`, cf. demande utilisatrice de
 * porter le style/design de spacedrive). Orthogonal au clair/sombre de `next-themes` : les deux
 * se combinent (`[data-accent="spacedrive"].dark`, cf. styles.css). */
export type AccentTheme = "azalee" | "spacedrive";

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
  /** Palette d'accent — cf. [`AccentTheme`]. */
  accentTheme: AccentTheme;
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
  accentTheme: "azalee",
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
