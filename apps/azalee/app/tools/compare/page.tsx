import type { Metadata } from "next";
import { CharacterComparator } from "@/components/wiki/CharacterComparator";
import type { CompareCharacter, SkillInfo } from "@/components/wiki/CharacterComparator";
import { createClient } from "@/lib/supabase/server";
import { wikiService } from "@/lib/wiki-service";

export const dynamic = "force-dynamic";

// Phantom skill IDs that exist in game data but have no corresponding DB entry
// 0xDBEDB6B8 = aura-dependent special technique slot (empty placeholder)
const PHANTOM_SKILL_IDS = new Set(["0xDBEDB6B8"]);

function mapSkill(skill: any) {
	return {
		category: skill.categoryName?.fr || "Spécial",
		element: skill.elementName?.en?.toLowerCase(),
		id: skill.skillId || skill.skillID || skill.skillIDStr || "",
		isPassive:
			skill.categoryName?.en?.toLowerCase() === "passive" ||
			skill.categoryName?.fr?.toLowerCase() === "talent" ||
			skill.skillType === "passive",
		name: skill.displayName || skill.name_FR || skill.name_EN || "???",
		power: skill.power_min ? `${skill.power_min}` : undefined,
		tension: skill.tp ?? skill.tension ?? undefined,
	};
}

/** Resolve skill names from a newline/comma-separated string (sheetData moveset/firstMoves) */
async function resolveSkillNames(raw: string): Promise<SkillInfo[]> {
	const separator = raw.includes("\n") ? "\n" : ",";
	const moveNames = raw
		.split(separator)
		.map((s) => s.trim())
		.filter((s) => s && !s.startsWith("#N/A") && !s.startsWith("Mix "));
	const resolved = await Promise.all(moveNames.map((name) => wikiService.getSkill(name)));
	const seen = new Set<string>();
	return resolved
		.filter(Boolean)
		.map((skill: any) => mapSkill(skill))
		.filter((s) => {
			if (seen.has(s.name)) {
				return false;
			}
			seen.add(s.name);
			return true;
		});
}

/** Try to inherit skills from a sibling variant (same chara_id) that has skill data */
async function inheritSkillsFromSibling(charaId: string, currentId: string): Promise<SkillInfo[]> {
	const supabase = await createClient();
	const { data: siblings } = await supabase
		.from("inagle_characters")
		.select("skills, sheet_data")
		.eq("chara_id", charaId)
		.neq("id", currentId)
		.limit(5);

	if (!siblings) {
		return [];
	}

	for (const sib of siblings) {
		const sd = (sib.sheet_data as any) || {};

		// Try sheetData moves first (more reliable names)
		const moveSource = sd.firstMoves || sd.moveset;
		if (moveSource) {
			const resolved = await resolveSkillNames(moveSource);
			if (resolved.length > 0) {
				return resolved;
			}
		}

		// Try binary skills
		const rawSkills: any[] = Array.isArray(sib.skills) ? sib.skills : [];
		if (rawSkills.length > 0) {
			const skillList = rawSkills
				.map((s: any) => (typeof s === "string" ? { learnLevel: 0, skillId: s } : s))
				.filter((s: any) => !PHANTOM_SKILL_IDS.has(s.skillId));

			const fetched = await Promise.all(skillList.map((s: any) => wikiService.getSkill(s.skillId)));
			const resolved = fetched.filter(Boolean).map((skill: any) => mapSkill(skill));
			if (resolved.length > 0) {
				return resolved;
			}
		}
	}

	return [];
}

/** Normalise poste FR/EN → code court (MF/FW/…) pour l’UI du comparateur */
const POSITION_TO_CODE: Record<string, string> = {
	Attaquant: "FW",
	ATT: "FW",
	FW: "FW",
	Défenseur: "DF",
	Defenseur: "DF",
	DEF: "DF",
	DF: "DF",
	Gardien: "GK",
	GAR: "GK",
	GK: "GK",
	Milieu: "MF",
	MIL: "MF",
	MF: "MF",
};

/** Normalise élément FR/EN → clé sprite (Forest/Fire/…) */
const ELEMENT_TO_CODE: Record<string, string> = {
	Feu: "Fire",
	Fire: "Fire",
	Forêt: "Forest",
	Foret: "Forest",
	Forest: "Forest",
	Montagne: "Mountain",
	Mountain: "Mountain",
	Vent: "Wind",
	Wind: "Wind",
	Néant: "Void",
	Neant: "Void",
	Void: "Void",
};

function formatCompareName(baseName: string, series?: string, rarity?: string): string {
	const tags: string[] = [];
	if (series && series !== "Inazuma Eleven") {
		// Court labels pour les séries non-IE1 (Ares, GO, Orion…)
		tags.push(series.replace(/^Inazuma Eleven\s*/i, "").trim() || series);
	}
	if (rarity && rarity !== "Normal") {
		tags.push(rarity);
	}
	return tags.length > 0 ? `${baseName} (${tags.join(" · ")})` : baseName;
}

async function resolveCharacter(idOrSlug: string | undefined): Promise<CompareCharacter | null> {
	if (!idOrSlug) {
		return null;
	}

	// 1) Lookup EXACT par slug ou id (le comparateur cible toujours une version précise).
	//    On évite de passer par base_slug en premier : getCharacterByBaseSlug + variants[0]
	//    collapsait Byron IE / Ares / GO sur la même variante.
	const supabase = await createClient();
	let { data: exactRow } = await supabase
		.from("inagle_characters")
		.select("*")
		.eq("slug", idOrSlug)
		.maybeSingle();
	if (!exactRow) {
		({ data: exactRow } = await supabase
			.from("inagle_characters")
			.select("*")
			.eq("id", idOrSlug)
			.maybeSingle());
	}

	// 2) Fallback legacy : base_slug / groupVariants (liens sans suffixe hex)
	// (pas d'initialiseur : les deux branches ci-dessous assignent toujours avant lecture)
	let baseChar: any;
	let variant: any;

	if (exactRow) {
		// Mapper la row exacte seule → stats/skills de CETTE version, pas d’un sibling
		baseChar = wikiService.mapDbCharacterToBase(exactRow);
		variant = baseChar?.variants?.[0] ?? null;
	} else {
		// MÊME chaîne que la fiche perso (app/chara/[id]/page.tsx)
		baseChar = await wikiService.getCharacterByBaseSlug(idOrSlug);
		if (!baseChar) {
			baseChar = await wikiService.getCharacterBySlug(idOrSlug);
		}
		if (!baseChar) {
			baseChar = await wikiService.getCharacter(idOrSlug);
		}
		if (!baseChar) {
			return null;
		}
		// Aligné fiche : match charaParamId OU slug variante
		const variants = (baseChar.variants as any[]) || [];
		variant =
			variants.find((v) => v.charaParamId === idOrSlug || v.slug === idOrSlug) || variants[0];
	}

	if (!baseChar || !variant) {
		return null;
	}

	const stats = variant.stats?.lv99 || {};
	// IMPORTANT : sheetData de la variante uniquement (pas baseChar.sheetData = youngest)
	const sd = variant.sheetData || {};
	const isBasara = variant.rarity === "BASARA" || (variant.rarityCode ?? 0) >= 20;
	const series = variant.series || (baseChar as any).series || undefined;
	const variantSlug = variant.slug || variant.charaParamId || idOrSlug;
	const variantInternalCode =
		variant.internalCode || (baseChar as any).internalCode || (baseChar as any).charaId || undefined;

	// Resolve skills — multiple fallback strategies
	let skills: SkillInfo[] = [];

	if (isBasara && sd.moveset) {
		// BASARA: use dedicated sheet moveset
		skills = await resolveSkillNames(sd.moveset);
	} else {
		// 1) Try binary skill IDs (filter out phantom slots)
		const rawSkills: Array<{ learnLevel: number; skillId: string }> | string[] =
			variant.skills || [];
		const skillList = rawSkills
			.map((s: any) => (typeof s === "string" ? { learnLevel: 0, skillId: s } : s))
			.filter((s: any) => !PHANTOM_SKILL_IDS.has(s.skillId));

		if (skillList.length > 0) {
			const fetchedSkills = await Promise.all(
				skillList.map((s: any) => wikiService.getSkill(s.skillId))
			);
			skills = fetchedSkills.filter(Boolean).map((skill: any) => mapSkill(skill));
		}

		// 2) Fallback: use firstMoves/moveset from sheetData (skill names)
		if (skills.length === 0) {
			const moveSource = sd.firstMoves || sd.moveset;
			if (moveSource) {
				skills = await resolveSkillNames(moveSource);
			}
		}

		// 3) Fallback: inherit from a sibling variant with the same chara_id
		//    (même chara_id = même série/version de base, pas cross-Ares)
		if (skills.length === 0) {
			const charaId = exactRow?.chara_id || (baseChar as any).charaId || (baseChar as any).internalCode;
			if (charaId) {
				skills = await inheritSkillsFromSibling(charaId, variant.charaParamId || idOrSlug);
			}
		}
	}

	// Deduplicate skills by name (keep first occurrence)
	const seen = new Set<string>();
	skills = skills.filter((s) => {
		if (seen.has(s.name)) {
			return false;
		}
		seen.add(s.name);
		return true;
	});

	const baseName = baseChar.names?.fr || baseChar.names?.en || exactRow?.name_fr || "Inconnu";
	const rarity = variant.rarity || exactRow?.rarity_label || "Normal";
	const rawPosition = variant.position || exactRow?.position || "MF";
	const rawElement = variant.element || exactRow?.element || "Void";

	return {
		element: ELEMENT_TO_CODE[rawElement] || rawElement || "Void",
		image: variant.image || baseChar.image || null,
		internalCode: variantInternalCode,
		name: formatCompareName(baseName, series, rarity),
		nameEn: baseChar.names?.en || exactRow?.name_en || undefined,
		nameJa: baseChar.names?.ja || exactRow?.name_ja || undefined,
		position: POSITION_TO_CODE[rawPosition] || rawPosition || "MF",
		rarity,
		skills,
		// Identité de la VARIANTE sélectionnée (pas le slug du plus jeune après groupVariants)
		// → swap / re-sélection du 2e perso ne réécrit plus char1 sur la mauvaise version.
		slug: variantSlug,
		stats: {
			agility: stats.agility || 0,
			control: stats.control || 0,
			intelligence: stats.intelligence || 0,
			kick: stats.kick || 0,
			physical: stats.physical || 0,
			pressure: stats.pressure || 0,
			technique: stats.technique || 0,
		},
		statsLv1: variant.stats?.lv1
			? {
					agility: variant.stats.lv1.agility || 0,
					control: variant.stats.lv1.control || 0,
					intelligence: variant.stats.lv1.intelligence || 0,
					kick: variant.stats.lv1.kick || 0,
					physical: variant.stats.lv1.physical || 0,
					pressure: variant.stats.lv1.pressure || 0,
					technique: variant.stats.lv1.technique || 0,
				}
			: undefined,
		statsLv30: variant.stats?.lv30
			? {
					agility: variant.stats.lv30.agility || 0,
					control: variant.stats.lv30.control || 0,
					intelligence: variant.stats.lv30.intelligence || 0,
					kick: variant.stats.lv30.kick || 0,
					physical: variant.stats.lv30.physical || 0,
					pressure: variant.stats.lv30.pressure || 0,
					technique: variant.stats.lv30.technique || 0,
				}
			: undefined,
		statsLv50: variant.stats?.lv50
			? {
					agility: variant.stats.lv50.agility || 0,
					control: variant.stats.lv50.control || 0,
					intelligence: variant.stats.lv50.intelligence || 0,
					kick: variant.stats.lv50.kick || 0,
					physical: variant.stats.lv50.physical || 0,
					pressure: variant.stats.lv50.pressure || 0,
					technique: variant.stats.lv50.technique || 0,
				}
			: undefined,
		teamName: (baseChar as any).teamName || undefined,
		zukanHash: variant.zukanHash || baseChar.zukanHash || undefined,
	};
}

export async function generateMetadata({
	searchParams,
}: {
	searchParams: Promise<{ char1?: string; char2?: string }>;
}): Promise<Metadata> {
	const { char1, char2 } = await searchParams;

	if (!char1 && !char2) {
		return {
			alternates: { canonical: "/tools/compare" },
			description:
				"Comparez deux personnages d'Inazuma Eleven: Victory Road côte à côte. Stats, techniques et bien plus.",
			title: "Comparateur de personnages | Azalée",
		};
	}

	const [c1, c2] = await Promise.all([resolveCharacter(char1), resolveCharacter(char2)]);

	const names = [c1?.name, c2?.name].filter(Boolean).join(" vs ");

	return {
		description: `Comparaison ${names} dans Inazuma Eleven: Victory Road. Stats, techniques, éléments et positions.`,
		title: `${names || "Comparateur"} | Azalée`,
	};
}

export default async function ComparePage({
	searchParams,
}: {
	searchParams: Promise<{ char1?: string; char2?: string }>;
}) {
	const { char1, char2 } = await searchParams;
	const [character1, character2] = await Promise.all([
		resolveCharacter(char1),
		resolveCharacter(char2),
	]);

	return (
		<div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
			<CharacterComparator char1={character1} char2={character2} />
		</div>
	);
}
