/**
 * Les réglages, côté React : lecture réactive, écriture, remise à zéro, et application au
 * document.
 *
 * Le magasin est celui d'Inacord (`lib/settings.ts`) — une seule clé `localStorage`,
 * `nie-explorer:settings`, les mêmes identifiants. Ce fichier n'en ajoute pas un second : il
 * expose ce que l'écran des Options a besoin de faire, et ce que l'hôte doit appliquer.
 */
import { useEffect } from "react";
import {
	getSettings,
	SETTINGS_DEFAULTS,
	type Settings,
	setSettings,
	useSettings as useSettingsStore,
} from "../../lib/settings";
import type { SettingId } from "./settings-model";

export type { Settings };

/** Les réglages courants, réactifs, et les gestes pour les changer. */
export function useSettings(): {
	settings: Settings;
	set: (patch: Partial<Settings>) => void;
	reset: (ids: readonly SettingId[]) => void;
} {
	const settings = useSettingsStore();
	return { settings, set: setSettings, reset: resetSettings };
}

/** Remet ces réglages à leur valeur par défaut, et persiste. */
export function resetSettings(ids: readonly SettingId[]): void {
	const patch: Partial<Settings> = {};
	for (const id of ids) {
		// Le type de chaque champ est celui de sa clé : l'affectation par clé indexée l'oblige.
		(patch as Record<SettingId, unknown>)[id] = SETTINGS_DEFAULTS[id];
	}
	setSettings(patch);
}

/** La taille de police de base, en pixels, avant l'échelle. */
const BASE_FONT_SIZE_PX = 16;

/** Le thème résolu : `system` est tranché par `prefers-color-scheme`. */
export function resolveTheme(theme: Settings["theme"]): "light" | "dark" {
	if (theme !== "system") return theme;
	if (typeof window === "undefined" || !window.matchMedia) return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Applique les réglages d'apparence au document.
 *
 * Un réglage enregistré qui ne change rien est un défaut : ce crochet est ce qui le fait
 * changer quelque chose. Il pose sur `<html>` — `data-density`, `data-motion`, `font-size` — ce
 * que les feuilles de style lisent. Font scale and interface zoom multiply the root `rem`
 * scale rather than CSS `body.zoom`: the latter expands `100vw` beyond the visual viewport and
 * cuts off controls above 100 %. Native pixel canvases keep their measured geometry. La couleur
 * n'est plus un réglage : les rôles mesurés du jeu sont l'unique autorité visuelle.
 *
 * La langue n'est PAS appliquée ici : sous nie, changer de langue est une navigation
 * entière servie par `nie-site`, et c'est l'hôte qui la fait.
 */
export function useApplySettings(): void {
	const { fontScale, uiZoom, reducedMotion, listDensity } =
		useSettingsStore();

	useEffect(() => {
		document.documentElement.style.fontSize = `${BASE_FONT_SIZE_PX * fontScale * uiZoom}px`;
		// Clear inline state left by profiles opened with the former body-zoom implementation.
		(document.body.style as unknown as { zoom: string }).zoom = "";
	}, [fontScale, uiZoom]);

	useEffect(() => {
		document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
	}, [reducedMotion]);

	useEffect(() => {
		document.documentElement.dataset.density = listDensity;
	}, [listDensity]);
}

/** Lecture synchrone, hors React — pour un hôte qui décide avant de rendre (la langue). */
export { getSettings };
