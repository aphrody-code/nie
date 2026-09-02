/**
 * Stat Calculator (Pure)
 *
 * Implements the growth logic to calculate stats at any level (1-99).
 * Decoupled from file system for shared usage.
 */

// ============================================================================
// Types
// ============================================================================

export interface StatBlock {
	Kc: number; // Kick
	Cr: number; // Control
	Tc: number; // Technique
	Pr: number; // Power/Physical
	Ps: number; // Pressure
	Ag: number; // Agility
	It: number; // Intelligence
}

export interface GrowthTableLv1Entry {
	mainPosition: number;
	subPosition: number;
	playStyle: number;
	Kc_1: number;
	Cr_1: number;
	Tc_1: number;
	Pr_1: number;
	Ps_1: number;
	Ag_1: number;
	It_1: number;
}

export interface GrowthTableLv30Entry {
	mainPosition: number;
	subPosition: number;
	growthPattern: number;
	charaRank: number;
	Kc_30: number;
	Cr_30: number;
	Tc_30: number;
	Pr_30: number;
	Ps_30: number;
	Ag_30: number;
	It_30: number;
}

export interface GrowthTableMainEntry {
	mainPosition: number;
	growthPattern: number;
	charaRank: number;
	Kc_50: number;
	Cr_50: number;
	Tc_50: number;
	Pr_50: number;
	Ps_50: number;
	Ag_50: number;
	It_50: number;
	Kc_99: number;
	Cr_99: number;
	Tc_99: number;
	Pr_99: number;
	Ps_99: number;
	Ag_99: number;
	It_99: number;
}

export interface GrowthTables {
	lv1: GrowthTableLv1Entry[];
	lv30: GrowthTableLv30Entry[];
	main: GrowthTableMainEntry[];
}

export interface CharacterGrowthParams {
	mainPosition: number; // 1 | 2 | 3 | 4 (GK, DF, MF, FW)
	subPosition: number;
	growthPattern: number; // 0 | 1 | 2+
	charaRank: number; // 0-7, 20
	playStyle?: number;
}

// ============================================================================
// Rarity Mapping
// ============================================================================

// Source unique : voir src/lib/rarity.ts. Réexporté ici pour préserver l'API
// publique de stat-calculator (importé par characters/evolution.ts et les tests).
export { rarityToGrowthRank } from "./lib/rarity.js";

// Réimporté en interne pour les usages locaux (calculateStats/generateGrowthCurve).
import { rarityToGrowthRank } from "./lib/rarity.js";

// ============================================================================
// Interpolation
// ============================================================================

/**
 * Interpolation linéaire entre deux valeurs
 */
function lerp(start: number, end: number, t: number): number {
	return Math.floor(start + (end - start) * t);
}

/**
 * Calcule une stat individuelle à un niveau donné
 */
export function calculateSingleStat(
	level: number,
	stat1: number,
	stat30: number,
	stat50: number,
	stat99: number
): number {
	if (level < 1) return stat1;
	if (level >= 99) return stat99;

	if (level <= 30) {
		return lerp(stat1, stat30, (level - 1) / 29);
	}
	if (level <= 50) {
		return lerp(stat30, stat50, (level - 30) / 20);
	}
	return lerp(stat50, stat99, (level - 50) / 49);
}

// ============================================================================
// Lookup Functions (Pure)
// ============================================================================

export function findLv1Entry(
	tables: GrowthTables,
	params: CharacterGrowthParams
): GrowthTableLv1Entry | undefined {
	let entry = tables.lv1.find(
		(e) =>
			e.mainPosition === params.mainPosition &&
			e.subPosition === params.subPosition &&
			e.playStyle === (params.playStyle ?? 0)
	);

	if (!entry && params.playStyle !== undefined && params.playStyle !== 0) {
		entry = tables.lv1.find(
			(e) =>
				e.mainPosition === params.mainPosition &&
				e.subPosition === params.subPosition &&
				e.playStyle === 0
		);
	}

	if (!entry && params.subPosition !== 0) {
		entry = tables.lv1.find(
			(e) =>
				e.mainPosition === params.mainPosition &&
				e.subPosition === 0 &&
				e.playStyle === 0
		);
	}

	if (!entry) {
		entry = tables.lv1.find((e) => e.mainPosition === params.mainPosition);
	}

	return entry;
}

export function findLv30Entry(
	tables: GrowthTables,
	params: CharacterGrowthParams
): GrowthTableLv30Entry | undefined {
	const growthRank = rarityToGrowthRank(params.charaRank);

	// Try exact pattern first
	let entry = tables.lv30.find(
		(e) =>
			e.mainPosition === params.mainPosition &&
			e.subPosition === params.subPosition &&
			e.growthPattern === params.growthPattern &&
			e.charaRank === growthRank
	);

	// Fallback: growth table only has patterns 0 and 1
	if (!entry && params.growthPattern >= 2) {
		entry = tables.lv30.find(
			(e) =>
				e.mainPosition === params.mainPosition &&
				e.subPosition === params.subPosition &&
				e.growthPattern === 0 &&
				e.charaRank === growthRank
		);
	}

	// Fallback: subPosition = 0
	if (!entry && params.subPosition !== 0) {
		entry = tables.lv30.find(
			(e) =>
				e.mainPosition === params.mainPosition &&
				e.subPosition === 0 &&
				e.growthPattern === 0 &&
				e.charaRank === growthRank
		);
	}

	// Fallback: charaRank = 0 (Normal)
	if (!entry && growthRank !== 0) {
		entry = tables.lv30.find(
			(e) =>
				e.mainPosition === params.mainPosition &&
				e.subPosition === 0 &&
				e.growthPattern === 0 &&
				e.charaRank === 0
		);
	}

	if (!entry) {
		entry = tables.lv30.find((e) => e.mainPosition === params.mainPosition);
	}

	return entry;
}

export function findMainEntry(
	tables: GrowthTables,
	params: CharacterGrowthParams
): GrowthTableMainEntry | undefined {
	const growthRank = rarityToGrowthRank(params.charaRank);

	// Try exact pattern first
	let entry = tables.main.find(
		(e) =>
			e.mainPosition === params.mainPosition &&
			e.growthPattern === params.growthPattern &&
			e.charaRank === growthRank
	);

	// Fallback: growth table only has patterns 0 and 1
	if (!entry && params.growthPattern >= 2) {
		entry = tables.main.find(
			(e) =>
				e.mainPosition === params.mainPosition &&
				e.growthPattern === 0 &&
				e.charaRank === growthRank
		);
	}

	// Fallback: charaRank = 0 (Normal)
	if (!entry && growthRank !== 0) {
		entry = tables.main.find(
			(e) =>
				e.mainPosition === params.mainPosition &&
				e.growthPattern === 0 &&
				e.charaRank === 0
		);
	}

	if (!entry) {
		entry = tables.main.find((e) => e.mainPosition === params.mainPosition);
	}

	return entry;
}

/**
 * Calcule toutes les stats d'un personnage à un niveau donné (Pure)
 */
export function calculateStats(
	tables: GrowthTables,
	params: CharacterGrowthParams,
	level: number
): StatBlock {
	const lv1 = findLv1Entry(tables, params);
	const lv30 = findLv30Entry(tables, params);
	const main = findMainEntry(tables, params);

	if (!lv1 || !lv30 || !main) {
		console.warn(`[StatCalculator] Growth data not found for params: ${JSON.stringify(params)}. Using default 0 stats.`);
		return { Kc: 0, Cr: 0, Tc: 0, Pr: 0, Ps: 0, Ag: 0, It: 0 };
	}

	return {
		Kc: calculateSingleStat(level, lv1.Kc_1, lv30.Kc_30, main.Kc_50, main.Kc_99),
		Cr: calculateSingleStat(level, lv1.Cr_1, lv30.Cr_30, main.Cr_50, main.Cr_99),
		Tc: calculateSingleStat(level, lv1.Tc_1, lv30.Tc_30, main.Tc_50, main.Tc_99),
		Pr: calculateSingleStat(level, lv1.Pr_1, lv30.Pr_30, main.Pr_50, main.Pr_99),
		Ps: calculateSingleStat(level, lv1.Ps_1, lv30.Ps_30, main.Ps_50, main.Ps_99),
		Ag: calculateSingleStat(level, lv1.Ag_1, lv30.Ag_30, main.Ag_50, main.Ag_99),
		It: calculateSingleStat(level, lv1.It_1, lv30.It_30, main.It_50, main.It_99),
	};
}

/**
 * Calcule le total des stats (force totale)
 */
export function calculateTotalPower(stats: StatBlock): number {
	return stats.Kc + stats.Cr + stats.Tc + stats.Pr + stats.Ps + stats.Ag + stats.It;
}

/**
 * Génère la courbe de croissance complète d'un personnage (Pure)
 */
export function generateGrowthCurve(
	tables: GrowthTables,
	params: CharacterGrowthParams,
	startLevel = 1,
	endLevel = 99
): Array<{ level: number; stats: StatBlock; total: number }> {
	const curve: Array<{ level: number; stats: StatBlock; total: number }> = [];

	for (let level = startLevel; level <= endLevel; level++) {
		const stats = calculateStats(tables, params, level);
		curve.push({
			level,
			stats,
			total: calculateTotalPower(stats),
		});
	}

	return curve;
}

export const POSITION_LABELS: Record<number, string> = {
	1: "GK (Goalkeeper)",
	2: "DF (Defender)",
	3: "MF (Midfielder)",
	4: "FW (Forward)",
};

export const RANK_LABELS: Record<number, string> = {
	1: "N (Normal)",
	2: "R (Rare)",
	3: "SR (Super Rare)",
	4: "SSR (Super Super Rare)",
	5: "UR (Ultra Rare)",
};

export const STAT_LABELS: Record<keyof StatBlock, { en: string; jp: string }> = {
	Kc: { en: "Kick", jp: "シュート" },
	Cr: { en: "Control", jp: "ドリブル" },
	Tc: { en: "Technique", jp: "テクニック" },
	Pr: { en: "Power", jp: "フィジカル" },
	Ps: { en: "Pressure", jp: "プレッシャー" },
	Ag: { en: "Agility", jp: "スピード" },
	It: { en: "Intelligence", jp: "インテリジェンス" },
};
