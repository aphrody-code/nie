/**
 * Interpolation de la courbe de statistiques d'une variante de personnage.
 *
 * Le jeu ne stocke que quatre paliers (`lv1`, `lv30`, `lv50`, `lv99`). Toute
 * valeur intermédiaire s'obtient par interpolation linéaire **par segment**
 * (1→30, 30→50, 50→99), avec troncature entière comme le moteur.
 *
 * Règle de jeu pure, sans I/O : partagée par le CLI (`chara`, `compare`), le
 * wiki web et une éventuelle GUI Tauri — c'est la seule implémentation.
 */

import type { CharaStats } from "../wiki/chara-stats-shared";

/** Paliers de stats tels qu'exposés par une variante inagle (tous optionnels). */
export interface VariantStatLevels {
	lv1?: CharaStats;
	lv30?: CharaStats;
	lv50?: CharaStats;
	lv99?: CharaStats;
}

/** Forme minimale d'une variante : seuls les paliers de stats sont lus. */
export interface StatCurveVariant {
	stats?: VariantStatLevels | null;
}

/** Stats toutes à zéro — repli lorsqu'aucun palier n'est disponible. */
const ZERO_STATS: CharaStats = {
	kick: 0,
	control: 0,
	technique: 0,
	pressure: 0,
	physical: 0,
	agility: 0,
	intelligence: 0,
};

/**
 * Renvoie les 7 stats d'une variante au niveau demandé (1-99).
 *
 * - `level === 99` → palier brut `lv99` (référence, jamais recalculée) ;
 * - `level === 1` avec `lv1` connu → palier brut `lv1` ;
 * - paliers complets (`lv1` + `lv30` + `lv50`) → interpolation par segment ;
 * - paliers partiels → interpolation linéaire unique `lv1`(ou `lv99`) → `lv99`.
 */
export function interpolateVariantStats(variant: StatCurveVariant, level: number): CharaStats {
	const stats = variant.stats?.lv99 ?? { ...ZERO_STATS };
	const statsLv1 = variant.stats?.lv1;
	const statsLv30 = variant.stats?.lv30;
	const statsLv50 = variant.stats?.lv50;

	if (level === 99) return stats;
	if (level === 1 && statsLv1) return statsLv1;

	const hasCompleteData = statsLv1 && statsLv30 && statsLv50;
	if (!hasCompleteData) {
		const startStats = statsLv1 || stats;
		const endStats = stats;
		const t = (level - 1) / 98;
		const lerp = (start: number, end: number) => Math.floor(start + (end - start) * t);

		return {
			kick: lerp(startStats.kick, endStats.kick),
			control: lerp(startStats.control, endStats.control),
			technique: lerp(startStats.technique, endStats.technique),
			pressure: lerp(startStats.pressure, endStats.pressure),
			physical: lerp(startStats.physical, endStats.physical),
			agility: lerp(startStats.agility, endStats.agility),
			intelligence: lerp(startStats.intelligence, endStats.intelligence),
		};
	}

	const getInterpolatedStat = (key: keyof CharaStats) => {
		const s1 = statsLv1[key] || 0;
		const s30 = statsLv30[key] || 0;
		const s50 = statsLv50[key] || 0;
		const s99 = stats[key] || 0;

		if (level <= 30) {
			return Math.floor(s1 + (s30 - s1) * ((level - 1) / 29));
		}
		if (level <= 50) {
			return Math.floor(s30 + (s50 - s30) * ((level - 30) / 20));
		}
		return Math.floor(s50 + (s99 - s50) * ((level - 50) / 49));
	};

	return {
		kick: getInterpolatedStat("kick"),
		control: getInterpolatedStat("control"),
		technique: getInterpolatedStat("technique"),
		pressure: getInterpolatedStat("pressure"),
		physical: getInterpolatedStat("physical"),
		agility: getInterpolatedStat("agility"),
		intelligence: getInterpolatedStat("intelligence"),
	};
}
