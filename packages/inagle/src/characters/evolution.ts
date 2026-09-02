/**
 * @file evolution.ts
 * @description API d'évolution complète d'un personnage IEVR.
 *
 * Pour chaque niveau (1→99) :
 *   - Stats interpolées (Tir / Contrôle / Technique / Pression / Physique / Agilité / Intelligence)
 *   - Total de force
 *   - XP requis pour atteindre ce niveau
 *   - XP cumulée depuis le niveau 1
 *
 * Utilise la même logique que entities/character.ts :
 *   - lv1     : lookup par (mainPosition, subPosition, growthPattern)
 *   - lv30    : lookup par (mainPosition, subPosition, growthPattern, charaRank)
 *   - main    : lookup par (mainPosition, growthPattern, charaRank)
 *
 * Interpolation par paliers :
 *   lv  1→30 : linéaire entre stat_1  et stat_30
 *   lv 30→50 : linéaire entre stat_30 et stat_50
 *   lv 50→99 : linéaire entre stat_50 et stat_99
 */

import { DATA_ROOT } from "../core/paths.js";
import { PositionId } from "../core/types.js";
import { loadAllCharacters } from "../entities/character.js";
import {
	buildCharaExpTableDatabase,
	buildGrowthTableDatabase,
	type CharaExpEntry,
	type ExpRarityRate,
	type GrowthTableDatabase,
	type GrowthTableMain,
} from "../parsers/index.js";
import {
	calculateSingleStat,
	calculateTotalPower,
	rarityToGrowthRank,
	type StatBlock,
} from "../stat-calculator.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface LevelSnapshot {
	level: number;
	stats: StatBlock;
	total: number;
	/** XP requis pour atteindre ce niveau depuis le niveau précédent */
	expRequired: number;
	/** XP cumulée depuis le niveau 1 */
	expCumulative: number;
}

export interface CharacterEvolution {
	charaParamId: string;
	name: { fr: string; en: string; ja: string };
	position: string;
	element: string;
	rarity: string;
	growthPattern: number;
	charaRank: number;
	/** Multiplicateur XP (1 pour N/R/SR, 3 pour UR/LR/Legend/BASARA) */
	expMultiplier: number;
	/** Stats aux jalons clés */
	snapshots: {
		lv1: LevelSnapshot;
		lv30: LevelSnapshot;
		lv50: LevelSnapshot;
		lv99: LevelSnapshot;
	};
	/** Courbe complète niveau par niveau */
	curve: LevelSnapshot[];
	/** XP totale pour passer du niveau 1 au niveau 99 */
	totalExpTo99: number;
}

export interface EvolutionQuery {
	charaParamId: string;
	/** Niveau de début de la courbe (défaut : 1) */
	fromLevel?: number;
	/** Niveau de fin de la courbe (défaut : 99) */
	toLevel?: number;
	/** Retourner la courbe complète (défaut : true) */
	includeCurve?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function positionToString(raw: number): string {
	switch (raw) {
		case PositionId.GK:
			return "GK";
		case PositionId.FW:
			return "FW";
		case PositionId.MF:
			return "MF";
		case PositionId.DF:
			return "DF";
		default:
			return "Coach";
	}
}

function subPositionToId(str?: string): number {
	switch (str) {
		case "GK":
			return PositionId.GK;
		case "FW":
			return PositionId.FW;
		case "MF":
			return PositionId.MF;
		case "DF":
			return PositionId.DF;
		default:
			return PositionId.GK;
	}
}

/**
 * Calcule les stats d'un personnage à un niveau donné à partir des tables brutes.
 * Suit la même logique que entities/character.ts (growthPattern → lv1.playStyle).
 */
function calcStats(
	tables: GrowthTableDatabase,
	mainPos: number,
	subPos: number,
	growthPattern: number,
	charaRank: number,
	level: number
): StatBlock {
	const growthRank = rarityToGrowthRank(charaRank);

	// lv1 : playStyle = growthPattern (convention entities/character.ts)
	const lv1 =
		tables.lv1.find(
			(e) => e.mainPosition === mainPos && e.subPosition === subPos && e.playStyle === growthPattern
		) ??
		tables.lv1.find(
			(e) => e.mainPosition === mainPos && e.subPosition === subPos && e.playStyle === 0
		);

	// lv30
	const findLv30 = (pattern: number) =>
		tables.lv30.find(
			(e) =>
				e.mainPosition === mainPos &&
				e.subPosition === subPos &&
				e.growthPattern === pattern &&
				e.charaRank === growthRank
		);
	const lv30 = findLv30(growthPattern) ?? findLv30(growthPattern >= 2 ? 1 : 0);

	// main
	const findMain = (pattern: number): GrowthTableMain | undefined =>
		tables.main.find(
			(e) => e.mainPosition === mainPos && e.growthPattern === pattern && e.charaRank === growthRank
		);
	const main = findMain(growthPattern) ?? findMain(growthPattern >= 2 ? 1 : 0);

	if (!lv1 || !lv30 || !main) {
		throw new Error(
			`Tables de croissance introuvables : pos=${mainPos}/${subPos} pattern=${growthPattern} rank=${growthRank}`
		);
	}

	return {
		Kc: calculateSingleStat(
			level,
			lv1.Kc_1,
			lv30.Kc_30,
			main.Kc_50 as number,
			main.Kc_99 as number
		),
		Cr: calculateSingleStat(
			level,
			lv1.Cr_1,
			lv30.Cr_30,
			main.Cr_50 as number,
			main.Cr_99 as number
		),
		Tc: calculateSingleStat(
			level,
			lv1.Tc_1,
			lv30.Tc_30,
			main.Tc_50 as number,
			main.Tc_99 as number
		),
		Pr: calculateSingleStat(
			level,
			lv1.Pr_1,
			lv30.Pr_30,
			main.Pr_50 as number,
			main.Pr_99 as number
		),
		Ps: calculateSingleStat(
			level,
			lv1.Ps_1,
			lv30.Ps_30,
			main.Ps_50 as number,
			main.Ps_99 as number
		),
		Ag: calculateSingleStat(
			level,
			lv1.Ag_1,
			lv30.Ag_30,
			main.Ag_50 as number,
			main.Ag_99 as number
		),
		It: calculateSingleStat(
			level,
			lv1.It_1,
			lv30.It_30,
			main.It_50 as number,
			main.It_99 as number
		),
	};
}

// ── Singleton caches ─────────────────────────────────────────────────────────

let _growthDb: GrowthTableDatabase | null = null;
let _expTable: CharaExpEntry[] | null = null;
let _rarityRates: ExpRarityRate[] | null = null;

async function getGrowthDb(): Promise<GrowthTableDatabase> {
	if (!_growthDb) _growthDb = await buildGrowthTableDatabase(DATA_ROOT);
	return _growthDb;
}

async function getExpDb(): Promise<{ expTable: CharaExpEntry[]; rarityRates: ExpRarityRate[] }> {
	if (!_expTable || !_rarityRates) {
		const db = await buildCharaExpTableDatabase(DATA_ROOT);
		_expTable = db.expTable;
		_rarityRates = db.rarityRates;
	}
	return { expTable: _expTable!, rarityRates: _rarityRates! };
}

// ── API principale ────────────────────────────────────────────────────────────

/**
 * Génère l'évolution complète d'un personnage.
 *
 * @example
 * const evo = await getCharacterEvolution({ charaParamId: "0xBCC12B9F" });
 * console.log(evo.snapshots.lv99.stats.Kc); // 261
 */
export async function getCharacterEvolution(query: EvolutionQuery): Promise<CharacterEvolution> {
	const { charaParamId, fromLevel = 1, toLevel = 99, includeCurve = true } = query;

	// Charger les tables (lazy)
	const [tables, { expTable: expEntries, rarityRates }] = await Promise.all([
		getGrowthDb(),
		getExpDb(),
	]);

	// Trouver le personnage
	const chars = loadAllCharacters();
	const char = chars.find((c) => c.charaParamId === charaParamId);
	if (!char) throw new Error(`Personnage introuvable : ${charaParamId}`);

	const mainPos = char.positionRaw as number;
	const subPos = subPositionToId(char.subPosition);
	const growthPattern = char.growthPattern;
	const charaRank = char.rarityCode as number;

	// Multiplicateur XP selon growthRank (0-3 → ×1, 4-8 → ×3)
	const growthRank = rarityToGrowthRank(charaRank);
	const expRateEntry = rarityRates.find((r) => r.rarity === growthRank);
	const expMultiplier = expRateEntry?.rate ?? 1;

	// Table XP avec multiplicateur appliqué
	const expMap = new Map<number, number>();
	let cumulative = 0;
	const cumulativeMap = new Map<number, number>();
	cumulativeMap.set(1, 0);
	for (const entry of expEntries) {
		const adjustedExp = entry.needExp * expMultiplier;
		expMap.set(entry.level, adjustedExp);
		if (entry.level > 1) {
			cumulative += (expEntries[entry.level - 2]?.needExp ?? 0) * expMultiplier;
			cumulativeMap.set(entry.level, cumulative);
		}
	}

	// Générer la courbe
	const clampedFrom = Math.max(1, Math.min(fromLevel, 99));
	const clampedTo = Math.max(clampedFrom, Math.min(toLevel, 99));

	const makeSnapshot = (level: number): LevelSnapshot => {
		const stats = calcStats(tables, mainPos, subPos, growthPattern, charaRank, level);
		return {
			level,
			stats,
			total: calculateTotalPower(stats),
			expRequired: expMap.get(level) ?? 0,
			expCumulative: cumulativeMap.get(level) ?? 0,
		};
	};

	const curve: LevelSnapshot[] = [];
	if (includeCurve) {
		for (let lv = clampedFrom; lv <= clampedTo; lv++) {
			curve.push(makeSnapshot(lv));
		}
	}

	const lv99Snap = makeSnapshot(99);

	return {
		charaParamId,
		name: {
			fr: char.names?.fr ?? "",
			en: char.names?.en ?? "",
			ja: char.names?.ja ?? "",
		},
		position: positionToString(mainPos),
		element: char.element ?? "",
		rarity: char.rarity ?? "",
		growthPattern,
		charaRank,
		expMultiplier,
		snapshots: {
			lv1: makeSnapshot(1),
			lv30: makeSnapshot(30),
			lv50: makeSnapshot(50),
			lv99: lv99Snap,
		},
		curve,
		totalExpTo99: lv99Snap.expCumulative,
	};
}

/**
 * Compare l'évolution de plusieurs personnages niveau par niveau.
 * Utile pour le comparateur d'Azalee.
 */
export async function compareEvolutions(
	charaParamIds: string[],
	level: number
): Promise<Array<{ charaParamId: string; name: string; stats: StatBlock; total: number }>> {
	const results = await Promise.all(
		charaParamIds.map(async (id) => {
			const evo = await getCharacterEvolution({ charaParamId: id, includeCurve: false });
			const snap =
				evo.snapshots[level <= 1 ? "lv1" : level <= 30 ? "lv30" : level <= 50 ? "lv50" : "lv99"];
			return {
				charaParamId: id,
				name: evo.name.fr || evo.name.en,
				stats: snap.stats,
				total: snap.total,
			};
		})
	);
	return results.sort((a, b) => b.total - a.total);
}
