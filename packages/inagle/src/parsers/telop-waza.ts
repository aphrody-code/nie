/**
 * @file telop-waza.ts
 * @description Parser pour la configuration des télops de technique (waza)
 *
 * Source des données : skill/skill_telop_info_config_0.00.00.cfg.bin.json
 *
 * Structure (format `lists`, 2 listes parallèles de 926 entrées) :
 * - m_skillTelopInfoList (typeName SkillTelopInfo) : 1 entrée par hash de skill
 *     - id (hex)              : hash du skill auquel ce télop est rattaché (clé stable)
 *     - blankSizeInfo [l, r]  : couple d'index dans m_blankSizeInfoList
 *                               (l = marge gauche, r = marge droite)
 *     - eldoradoId (hex)      : hash du skill Eldorado lié (0x00000000 si aucun)
 * - m_blankSizeInfoList (typeName BlankSizeInfo) : table des marges (« blanks »)
 *     par langue, pour la gauche et la droite du télop, en pixels.
 *     Langues : ja, en, pt, fr, it, de, es, zh_hant, zh_hans.
 *
 * Le parseur résout les index blankSizeInfo vers les vraies valeurs de marge
 * gauche/droite par langue et aplatit le tout en une ligne typée par skill.
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

const TELOP_LANGS = [
	"ja",
	"en",
	"pt",
	"fr",
	"it",
	"de",
	"es",
	"zh_hant",
	"zh_hans",
] as const;

export type TelopLang = (typeof TELOP_LANGS)[number];

/** Une entrée brute de m_blankSizeInfoList (marges par langue). */
export interface BlankSizeInfo {
	ja_left: number;
	ja_right: number;
	en_left: number;
	en_right: number;
	pt_left: number;
	pt_right: number;
	fr_left: number;
	fr_right: number;
	it_left: number;
	it_right: number;
	de_left: number;
	de_right: number;
	es_left: number;
	es_right: number;
	zh_hant_left: number;
	zh_hant_right: number;
	zh_hans_left: number;
	zh_hans_right: number;
}

/** Ligne aplatie : 1 télop de skill, avec ses marges gauche/droite résolues. */
export interface ParsedTelopWaza {
	/** Hash du skill (clé primaire stable). */
	skillId: string;
	/** Index de la marge gauche dans m_blankSizeInfoList. */
	blankLeftIndex: number;
	/** Index de la marge droite dans m_blankSizeInfoList. */
	blankRightIndex: number;
	/** Hash du skill Eldorado lié (null si 0x00000000). */
	eldoradoId: string | null;
	/** Marges gauche par langue (pixels), résolues depuis blankLeftIndex. */
	left: Record<TelopLang, number>;
	/** Marges droite par langue (pixels), résolues depuis blankRightIndex. */
	right: Record<TelopLang, number>;
}

export interface TelopWazaDatabase {
	telops: ParsedTelopWaza[];
	byId: Map<string, ParsedTelopWaza>;
}

// ============================================================================
// Parser
// ============================================================================

const ZERO_HASH = "0x00000000";

function pickSide(blank: BlankSizeInfo, side: "left" | "right"): Record<TelopLang, number> {
	const out = {} as Record<TelopLang, number>;
	for (const lang of TELOP_LANGS) {
		out[lang] = blank[`${lang}_${side}` as keyof BlankSizeInfo] ?? 0;
	}
	return out;
}

export function parseTelopWazaContent(content: any): ParsedTelopWaza[] {
	const telops: ParsedTelopWaza[] = [];
	if (!content?.lists) return telops;

	const telopList = content.lists.find((l: any) => l.name === "m_skillTelopInfoList");
	const blankList = content.lists.find((l: any) => l.name === "m_blankSizeInfoList");
	if (!telopList) return telops;

	const blanks: BlankSizeInfo[] = blankList?.values ?? [];

	for (const val of telopList.values ?? []) {
		const pair: number[] = Array.isArray(val.blankSizeInfo) ? val.blankSizeInfo : [0, 0];
		const leftIndex = pair[0] ?? 0;
		const rightIndex = pair[1] ?? 0;

		// Index hors borne → marge nulle (jamais inventer une valeur).
		const empty = {} as Record<TelopLang, number>;
		for (const lang of TELOP_LANGS) empty[lang] = 0;

		const leftBlank = blanks[leftIndex];
		const rightBlank = blanks[rightIndex];

		telops.push({
			skillId: val.id,
			blankLeftIndex: leftIndex,
			blankRightIndex: rightIndex,
			eldoradoId:
				val.eldoradoId && val.eldoradoId !== ZERO_HASH ? val.eldoradoId : null,
			left: leftBlank ? pickSide(leftBlank, "left") : { ...empty },
			right: rightBlank ? pickSide(rightBlank, "right") : { ...empty },
		});
	}

	return telops;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadTelopWazaConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedTelopWaza[] | null> {
	const filename = findConfigFile("skill", "skill_telop_info_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/skill", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseTelopWazaContent(content) : null;
}

export async function buildTelopWazaDatabase(
	dataPath: string = DATA_ROOT
): Promise<TelopWazaDatabase> {
	const telops = (await loadTelopWazaConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedTelopWaza>();
	for (const t of telops) byId.set(t.skillId, t);
	return { telops, byId };
}
