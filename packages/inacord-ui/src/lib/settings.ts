// Paramètres persistés (localStorage — pas de plugin-store nécessaire pour ces quelques valeurs).
import { useSyncExternalStore } from "react";
import { isGameLocale, type GameLocale } from "@niers/asset-source";

/** Language of the host shell and its URL. The public site currently serves these routes. */
export type Locale = "fr" | "en" | "es" | "ja";

/**
 * A language measured in the game's VFS text catalogue.
 *
 * This is deliberately distinct from {@link Locale}: a VFS locale such as `zh_hant`
 * selects decoded game resources; it does not imply that the surrounding web shell has
 * a translated route. Hosts must obtain the available set from `/api/v1/text` and never
 * substitute an authored translation for a missing game string.
 */
export type { GameLocale } from "@niers/asset-source";
export { GAME_LOCALES, SHIPPED_GAME_LOCALES } from "@niers/asset-source";

/** Former palette values kept only so persisted pre-migration JSON remains readable. */
export type AccentTheme = "spacedrive" | "midnight" | "noir" | "slate" | "nord" | "mocha";

/** Compatibility allow-list for persisted profiles; no palette selector is rendered. */
export const ACCENT_THEMES: readonly AccentTheme[] = [
  "spacedrive",
  "midnight",
  "noir",
  "slate",
  "nord",
  "mocha",
];

/** Le thème clair/sombre. `system` suit `prefers-color-scheme`. */
export type ThemeMode = "light" | "dark" | "system";

/** La densité des listes : `compact` resserre les espacements du jeu (`--jeu-espace-*`). */
export type ListDensity = "comfortable" | "compact";

export interface Settings {
  /**
   * Compatibility-only value read from profiles created before the measured game theme became
   * the single visual authority. It is no longer exposed or applied.
   */
  theme: ThemeMode;
  /** Réduit les mouvements de l'interface (les durées `--jeu-duree-*` tombent à zéro). */
  reducedMotion: boolean;
  /** Densité des listes — cf. [`ListDensity`]. */
  listDensity: ListDensity;
  gameDir: string;
  wikiDb: string;
  blenderExe: string;
  /** Origine de `nie-model-serve`/CDN : avatar assemblé et rendu de menus réels. */
  modelServiceUrl: string;
  /** Langue de l'interface. */
  locale: Locale;
  /** Language used when resolving text, menu and system resources from the game VFS. */
  gameLocale: GameLocale;
  /** Échelle de la taille de police de base (agit sur `html { font-size }`, tout le reste est en rem). */
  fontScale: number;
  /** Zoom global de l'interface (CSS `zoom`, WebView2/Chromium). */
  uiZoom: number;
  /** Compatibility-only former dark palette; retained so old settings JSON remains readable. */
  accentTheme: AccentTheme;
  /**
   * Autorise le serveur MCP `nie-mcp` à piloter cette fenêtre (naviguer, ouvrir un asset,
   * changer d'onglet) via le pont local `@niers/bridge`. Désactivé, aucun socket n'est ouvert.
   */
  bridgeEnabled: boolean;
  /**
   * Affiche les outils de spécialiste dans la barre latérale : RE, Viola, Live mod, Lua
   * (les vues marquées `avancee` dans `lib/vues.ts`).
   *
   * **Faux par défaut**, et c'est le point : l'application s'ouvre sur une médiathèque, or la
   * barre latérale offrait d'emblée le reverse-engineering, la lecture de la mémoire du jeu et
   * le désassemblage de scripts. Ces quatre entrées ne servent qu'à une personne ; les laisser
   * en permanence noyait les cinq qui comptent pour tout le monde.
   *
   * Rien n'est retiré : les vues restent atteignables par la palette de commandes (Ctrl+K) même
   * quand ce réglage est faux.
   */
  outilsAvances: boolean;
}

// `theme` et `accentTheme` restent dans le JSON pour relire sans erreur les profils historiques.
// Les hôtes forcent désormais l'unique thème mesuré du jeu et aucun contrôle ne les modifie.
const KEY = "nie-explorer:settings";
const DEFAULTS: Settings = {
  // The native menus have one measured light palette. A fresh install and an old profile must
  // therefore open on that stable oracle instead of an unrelated desktop preference.
  theme: "light",
  reducedMotion: false,
  listDensity: "comfortable",
  gameDir: "",
  wikiDb: "",
  blenderExe: "",
  modelServiceUrl: "",
  locale: "fr",
  gameLocale: "fr",
  fontScale: 1,
  uiZoom: 1,
  accentTheme: "spacedrive",
  bridgeEnabled: true,
  outilsAvances: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const merged: Settings = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
    // Migration : `accentTheme: "azalee"` (ancienne palette MD3, retirée avec le portage complet
    // des tokens spaceui) n'existe plus — sans ce garde, une valeur persistée pointerait vers une
    // classe CSS inexistante et l'app resterait sur la palette de base sans jamais s'en expliquer.
    if (!ACCENT_THEMES.includes(merged.accentTheme)) merged.accentTheme = DEFAULTS.accentTheme;
    if (!isGameLocale(merged.gameLocale)) merged.gameLocale = DEFAULTS.gameLocale;
    return merged;
  } catch {
    return DEFAULTS;
  }
}

let state: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return state;
}

/** Les valeurs par défaut, figées : c'est ce que « Réinitialiser » restaure. */
export const SETTINGS_DEFAULTS: Readonly<Settings> = DEFAULTS;

/** La clé `localStorage` — une seule, partagée par les deux hôtes. */
export const SETTINGS_STORAGE_KEY = KEY;

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
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
