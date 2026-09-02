/**
 * Résolution LIVE des VRAIES stats de personnage depuis la gamedata.
 *
 * Les stats (frappe/contrôle/technique/pression/physique/agilité/intelligence)
 * NE sont PAS stockées par personnage : le jeu les calcule depuis une table de
 * croissance indexée par (position × pattern de croissance × rang de rareté),
 * décodée LIVE en JSON par nie-model-serve via la route CDN `/cfg/` :
 *   - `growth_table_config_0.00.00.00.cfg.bin` (RDBN) → 4 listes :
 *       m_growthTableLv1List   (base, clé mainPos×subPos×playStyle)
 *       m_growthTableLv30List  (clé mainPos×growthPattern×charaRank)
 *       m_growthTableMainList  (Lv50 + Lv99, clé mainPos×growthPattern×charaRank)
 *       m_growthTableSubList    (idem mais clé subPosition — non utilisée ici)
 *   - `chara_param_*.cfg.bin` (T2b) → growthPattern par charaParamId
 *     (variables[8] de chaque CHARA_PARAM_INFO, validé contre le dump réel).
 *
 * Le rang de la table ne va que de 0 à 1 pour le pattern : un growthPattern ≥ 2
 * (existe en data, ex Mark Evans) retombe sur pattern 1 puis 0 (logique inagle).
 *
 * Vérifié contre les colonnes `stat_*` de la DB (déjà peuplées par inagle) :
 *   Mark Evans (GK, Normal, pattern 2→fallback) → Kc99=133 Cr99=146 ✓
 *   Nathan Swift (DF, Normal, pattern 1)        → Kc99=131 Cr99=136 ✓
 *
 * Anti-hallucination : si le décodage CDN échoue, on renvoie `null` (aucune
 * stat inventée). Petits volumes mis en cache process-local + ISR 24 h.
 */

import { fetchJson } from "../net";
import {
	type CharaMultiLevelStats,
	type CharaStats,
	positionToMainPosition,
	rarityLabelToGrowthRank,
	statTotal,
} from "./chara-stats-shared";

export type {
	CharaMultiLevelStats,
	CharaStats,
} from "./chara-stats-shared";

const GROWTH_VFS = "data/common/gamedata/character/growth_table_config_0.00.00.00.cfg.bin";
const CHARA_PARAM_VFS = "data/common/gamedata/character/chara_param_1.03.66.00.cfg.bin";
const CDN = "https://cdn.rosegriffon.fr/cfg";

/** Lignes RDBN brutes des 3 listes de croissance utiles. */
interface GrowthMainRow {
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
interface GrowthLv30Row {
	mainPosition: number;
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
interface GrowthLv1Row {
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

interface GrowthIndex {
	/** clé `${mainPos}-${pattern}-${rank}` → stats Lv50 + Lv99 */
	main: Map<string, GrowthMainRow>;
	/** clé `${mainPos}-${pattern}-${rank}` → stats Lv30 */
	lv30: Map<string, GrowthLv30Row>;
	/** clé `${mainPos}-${subPos}-${playStyle}` → stats Lv1 */
	lv1: Map<string, GrowthLv1Row>;
}

/** Index growthPattern par charaParamId (hex minuscule, ex `0x3055cf22`). */
type ParamIndex = Map<string, { mainPosition: number; subPosition: number; growthPattern: number }>;

let growthCache: GrowthIndex | null = null;
let paramCache: ParamIndex | null = null;

function toHexId(n: number): string {
	return `0x${(n >>> 0).toString(16).padStart(8, "0")}`;
}

/** Charge + indexe la table de croissance (1 fetch CDN, caché process-local). */
async function loadGrowthIndex(): Promise<GrowthIndex | null> {
	if (growthCache) return growthCache;
	const cfg = await fetchJson<{ lists?: Array<{ name: string; rows: unknown[] }> }>(
		`${CDN}/${GROWTH_VFS}.json`,
		{ revalidate: 86400 },
	);
	if (!cfg) return null;
	const lists = cfg.lists ?? [];
	const findRows = (name: string) => (lists.find((l) => l.name === name)?.rows ?? []) as unknown[];

	const main = new Map<string, GrowthMainRow>();
	for (const r of findRows("m_growthTableMainList") as GrowthMainRow[]) {
		main.set(`${r.mainPosition}-${r.growthPattern}-${r.charaRank}`, r);
	}
	const lv30 = new Map<string, GrowthLv30Row>();
	for (const r of findRows("m_growthTableLv30List") as GrowthLv30Row[]) {
		lv30.set(`${r.mainPosition}-${r.growthPattern}-${r.charaRank}`, r);
	}
	const lv1 = new Map<string, GrowthLv1Row>();
	for (const r of findRows("m_growthTableLv1List") as GrowthLv1Row[]) {
		lv1.set(`${r.mainPosition}-${r.subPosition}-${r.playStyle}`, r);
	}
	if (main.size === 0) return null;

	growthCache = { main, lv30, lv1 };
	return growthCache;
}

/** Charge + indexe les growthPattern de chara_param par charaParamId. */
async function loadParamIndex(): Promise<ParamIndex | null> {
	if (paramCache) return paramCache;
	const cfg = await fetchJson<{
		entries?: Array<{ name: string; children?: Array<{ variables?: unknown[] }> }>;
	}>(`${CDN}/${CHARA_PARAM_VFS}.json`, { revalidate: 86400 });
	if (!cfg) return null;
	const idx: ParamIndex = new Map();
	const list = cfg.entries?.find((e) => e.name === "CHARA_PARAM_INFO_LIST_BEG");
	for (const child of list?.children ?? []) {
		const vars = (child.variables ?? []) as Array<{ Int?: number }>;
		if (vars.length < 9) continue;
		const paramId = vars[0]?.Int;
		if (typeof paramId !== "number") continue;
		idx.set(toHexId(paramId), {
			mainPosition: vars[3]?.Int ?? 0,
			subPosition: vars[4]?.Int ?? 0,
			// variables[8] = growthPattern (= playStyle Lv1), validé sur le dump.
			growthPattern: vars[8]?.Int ?? 0,
		});
	}
	if (idx.size === 0) return null;

	paramCache = idx;
	return paramCache;
}

/** Pattern effectif : la table ne couvre que 0/1 → ≥2 retombe sur 1 puis 0. */
function resolvePattern<T>(
	table: Map<string, T>,
	mainPos: number,
	pattern: number,
	rank: number
): T | undefined {
	return (
		table.get(`${mainPos}-${pattern}-${rank}`) ??
		table.get(`${mainPos}-1-${rank}`) ??
		table.get(`${mainPos}-0-${rank}`)
	);
}

/**
 * Résout les VRAIES stats multi-niveaux d'un personnage.
 *
 * @param charaParamId id hex (= colonne `id` de `inagle_characters`, ex `0x3055CF22`)
 * @param position libellé FR de position (ou code court)
 * @param rarityLabel libellé FR de rareté
 * @returns stats Lv1/30/50/99 + total99, ou `null` si données indisponibles
 *          (échec CDN, position « Entraîneur » sans croissance, jointure vide).
 */
export async function resolveCharaStats(
	charaParamId: string,
	position: string | null | undefined,
	rarityLabel: string | null | undefined
): Promise<CharaMultiLevelStats | null> {
	const mainPos = positionToMainPosition(position);
	if (mainPos === null) return null; // Coach / position inconnue

	const [growth, params] = await Promise.all([loadGrowthIndex(), loadParamIndex()]);
	if (!growth) return null;

	const param = params?.get(charaParamId.toLowerCase());
	const pattern = param?.growthPattern ?? 0;
	const subPos = param?.subPosition ?? 0;
	const rank = rarityLabelToGrowthRank(rarityLabel);

	const main = resolvePattern(growth.main, mainPos, pattern, rank);
	const lv30 = resolvePattern(growth.lv30, mainPos, pattern, rank);
	if (!main) return null;

	// Lv1 : clé mainPos×subPos×playStyle (playStyle = growthPattern, capé 0..2).
	const playStyle = Math.min(pattern, 2);
	const lv1Row =
		growth.lv1.get(`${mainPos}-${subPos}-${playStyle}`) ??
		growth.lv1.get(`${mainPos}-${subPos}-0`);

	const lv99: CharaStats = {
		kick: main.Kc_99,
		control: main.Cr_99,
		technique: main.Tc_99,
		pressure: main.Ps_99,
		physical: main.Pr_99,
		agility: main.Ag_99,
		intelligence: main.It_99,
	};
	const lv50: CharaStats = {
		kick: main.Kc_50,
		control: main.Cr_50,
		technique: main.Tc_50,
		pressure: main.Ps_50,
		physical: main.Pr_50,
		agility: main.Ag_50,
		intelligence: main.It_50,
	};
	const lv30Stats: CharaStats = lv30
		? {
				kick: lv30.Kc_30,
				control: lv30.Cr_30,
				technique: lv30.Tc_30,
				pressure: lv30.Ps_30,
				physical: lv30.Pr_30,
				agility: lv30.Ag_30,
				intelligence: lv30.It_30,
			}
		: { kick: 0, control: 0, technique: 0, pressure: 0, physical: 0, agility: 0, intelligence: 0 };
	const lv1Stats: CharaStats = lv1Row
		? {
				kick: lv1Row.Kc_1,
				control: lv1Row.Cr_1,
				technique: lv1Row.Tc_1,
				pressure: lv1Row.Ps_1,
				physical: lv1Row.Pr_1,
				agility: lv1Row.Ag_1,
				intelligence: lv1Row.It_1,
			}
		: { kick: 0, control: 0, technique: 0, pressure: 0, physical: 0, agility: 0, intelligence: 0 };

	return {
		lv1: lv1Stats,
		lv30: lv30Stats,
		lv50,
		lv99,
		total99: statTotal(lv99),
	};
}
