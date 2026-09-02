/**
 * Pont navigateur vers le **moteur de jeu** niers (`nie-core` / `nie-game`), via le même binaire
 * wasm `nie-wasm` déjà embarqué (`/wasm/nie_wasm_bg.wasm`). Le binaire EXPORTE déjà toute une
 * couche moteur (stats growth, lookups skill/aura/item, FSM de match) ; jusqu'ici azalee ne câblait
 * que les décodeurs d'assets (`lib/cpk-wasm.ts`). Ce module expose la couche MOTEUR — intégration
 * « niers → azalee » : calculs byte-exact (ancrés sur nie.exe) directement dans le wiki.
 *
 * ⚠ Navigateur uniquement (wasm + fetch). À n'importer que depuis des composants `"use client"`.
 * On garde un init local idempotent (le module glue ES est un singleton ; le `wasm` interne est
 * partagé avec `lib/cpk-wasm.ts`, le 2e init ne fait qu'un fetch HTTP-caché redondant).
 */
import init, {
	aura_lookup,
	calculate_stats,
	final_score,
	init_panic_hook,
	item_lookup,
	match_tick,
	rarity_to_growth_rank,
	single_stat,
	skill_lookup,
} from "./nie-wasm-web/nie_wasm.js";

const WASM_URL = "/wasm/nie_wasm_bg.wasm";

let initPromise: Promise<void> | null = null;
async function ensureWasm(): Promise<void> {
	if (initPromise === null) {
		initPromise = (async () => {
			await init({ module_or_path: fetch(WASM_URL) });
			init_panic_hook();
		})().catch((cause: unknown) => {
			// Sans ce reset, un échec ponctuel (réseau coupé, binaire non encore
			// déployé) empoisonnait la promesse pour toute la durée de vie de
			// l'onglet : chaque appel ultérieur rejouait la MÊME erreur, sans
			// jamais retenter le chargement.
			initPromise = null;
			throw new Error(`Chargement du module wasm impossible (${WASM_URL}).`, { cause });
		});
	}
	return initPromise;
}

// --- Stats / croissance (nie-core::growth) ---------------------------------

/** Bloc des 7 statistiques IEVR (kicking, control, technique, pressure, physical, agility, intel). */
export interface StatBlock {
	kc: number;
	cr: number;
	tc: number;
	pr: number;
	ps: number;
	ag: number;
	it: number;
}

/** Résultat de `calculateStats` : le bloc + le total. */
export interface StatResult {
	stats: StatBlock;
	total: number;
}

/** Paramètres de croissance d'un personnage (codes bruts du jeu). */
export interface GrowthParams {
	/** 1=GK, 2=DF, 3=MF, 4=FW. */
	mainPosition: number;
	/** Sous-position (0 = aucune). */
	subPosition: number;
	/** Pattern de croissance (0, 1, 2+). */
	growthPattern: number;
	/** Code de rareté brut (0=N, 2=R, 3=SR, 4=SSR, 5=UR, 6=LR, 7=Legend, 20=BASARA). */
	charaRank: number;
	/** Style de jeu (0 par défaut). */
	playStyle: number;
}

/** Calcule le bloc de 7 stats à un niveau donné (tables de croissance réelles IEVR, byte-exact). */
export async function calculateStats(params: GrowthParams, level: number): Promise<StatResult> {
	await ensureWasm();
	return JSON.parse(
		calculate_stats(
			params.mainPosition,
			params.subPosition,
			params.growthPattern,
			params.charaRank,
			params.playStyle,
			level,
		),
	) as StatResult;
}

/** Courbe complète des stats sur une plage de niveaux (1→99 par défaut), pour graphes/breakpoints. */
export async function statCurve(
	params: GrowthParams,
	from = 1,
	to = 99,
): Promise<Array<{ level: number } & StatResult>> {
	await ensureWasm();
	const out: Array<{ level: number } & StatResult> = [];
	for (let lv = from; lv <= to; lv++) {
		const r = JSON.parse(
			calculate_stats(
				params.mainPosition,
				params.subPosition,
				params.growthPattern,
				params.charaRank,
				params.playStyle,
				lv,
			),
		) as StatResult;
		out.push({ level: lv, ...r });
	}
	return out;
}

/** Interpolation 3-segments d'une stat unique (lv1/30/50/99), clampée hors plage. */
export async function singleStat(
	level: number,
	statLv1: number,
	statLv30: number,
	statLv50: number,
	statLv99: number,
): Promise<number> {
	await ensureWasm();
	return single_stat(level, statLv1, statLv30, statLv50, statLv99);
}

/** Code de rareté brut → rang de table de croissance (0→0, 2→2, …, 5/6/7/20→5). */
export async function rarityToGrowthRank(rarityCode: number): Promise<number> {
	await ensureWasm();
	return rarity_to_growth_rank(rarityCode);
}

// --- Lookups data-driven (nie-game) ----------------------------------------

/**
 * Résolution typée d'un skill depuis son `cfg.bin` (+ texte). Renvoie la structure de jeu nommée
 * (puissance, élément, type…) telle que le moteur la lit. `configJson`/`textJson` = JSON des
 * `cfg.bin` correspondants (ex. via `/typed` ou `cfgbinTyped`).
 */
export async function skillLookup(configJson: string, textJson: string): Promise<unknown> {
	await ensureWasm();
	return JSON.parse(skill_lookup(configJson, textJson)) as unknown;
}

/** Résolution typée d'une aura (keshin/soul/mixi) depuis ses `cfg.bin`. */
export async function auraLookup(auraConfigJson: string, skillConfigJson: string): Promise<unknown> {
	await ensureWasm();
	return JSON.parse(aura_lookup(auraConfigJson, skillConfigJson)) as unknown;
}

/** Résolution typée d'un item depuis son `cfg.bin`. */
export async function itemLookup(itemConfigJson: string): Promise<unknown> {
	await ensureWasm();
	return JSON.parse(item_lookup(itemConfigJson)) as unknown;
}

// --- FSM de match (nie-core) ------------------------------------------------

/** Avance la machine à états d'un match d'un tick ; renvoie le nouvel état (JSON). */
export async function matchTick(state: string, isTraining: boolean, endCounter: number): Promise<unknown> {
	await ensureWasm();
	return JSON.parse(match_tick(state, isTraining, endCounter)) as unknown;
}

/** Score final encodé depuis (minutes, secondes) — helper FSM du moteur. */
export async function finalScore(minutes: number, seconds: number): Promise<number> {
	await ensureWasm();
	return final_score(minutes, seconds);
}
