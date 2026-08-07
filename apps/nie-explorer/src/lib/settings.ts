// Paramètres persistés (localStorage — pas de plugin-store nécessaire pour 4 chaînes).
import { useSyncExternalStore } from "react";

export interface Settings {
  gameDir: string;
  wikiDb: string;
  blenderExe: string;
  azaleeUrl: string;
}

const KEY = "nie-explorer:settings";
const DEFAULTS: Settings = { gameDir: "", wikiDb: "", blenderExe: "", azaleeUrl: "" };

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
