/**
 * @file skill-config.ts
 * @description Parser for skill_config files (Active Skills/Techniques)
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { toHex } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { loadTextFileAsync } from "./text-parser.js";

export interface ParsedSkill extends ExportableEntity {
	skillId: string; // Hex
	names: { en?: string; fr?: string; ja?: string };
	descriptions: { en?: string; fr?: string; ja?: string };

	power: { min: number; max: number };
	tpCost?: number;
	difficulty?: number;
	element?: string;
	type?: string;
}

/**
 * Find all skill_config files sorted by version (ascending).
 * DLC Orion adds v5 as a supplement to v4, both must be loaded and merged.
 */
function findAllSkillConfigFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir);
	return files
		.filter((f) => f.startsWith("skill_config_") && f.endsWith(".cfg.bin.json"))
		.sort()
		.map((f) => join(dir, f));
}

function _findSkillConfigFile(dir: string): string | null {
	const all = findAllSkillConfigFiles(dir);
	return all.length > 0 ? all[all.length - 1] : null;
}

export async function buildSkillDatabaseAsync(dataPath: string) {
	const skillDir = join(dataPath, "common", "gamedata", "skill");
	const allConfigPaths = findAllSkillConfigFiles(skillDir);

	const skills: ParsedSkill[] = [];
	const byId = new Map<string, ParsedSkill>();

	if (allConfigPaths.length === 0) {
		console.warn("[skill-config] Config not found in", skillDir);
		return { skills, byId, toMarkdown: () => null, toReact: () => null };
	}

	// Load Texts (Parallel)
	const [textEn, textFr, textJa] = await Promise.all([
		loadTextFileAsync("skill", "en"),
		loadTextFileAsync("skill", "fr"),
		loadTextFileAsync("skill", "ja"),
	]);

	const elementMap: Record<number, string> = {
		1: "Vent",
		2: "Forêt",
		3: "Feu",
		4: "Montagne",
	};
	// Category mapping: 1=Shoot, 2=Block, 3=Dribble, 4=Catch, 5=Special
	const typeMap: Record<number, string> = {
		1: "Tir",
		2: "Défense",
		3: "Dribble",
		4: "Arrêt",
		5: "Spécial",
	};

	// Load and merge all skill config versions (v4 base + v5 DLC Orion supplement)
	for (const configPath of allConfigPaths) {
		try {
			const content = await loadJsonAsync<any>(configPath);

			if (content?.lists) {
				const infoList = content.lists.find((l: any) => l.name === "m_skillInfoList");
				if (infoList?.values) {
					let added = 0;
					for (const entry of infoList.values) {
						const skillId = entry.skillID;
						const nameId = entry.skillNameId;
						const descId = entry.skillDescId;

						const skillIdHex = skillId.startsWith("0x") ? skillId : toHex(Number(skillId));

						// Skip if already loaded from an earlier version (later versions override)
						if (byId.has(skillIdHex)) continue;

						const nameIdHex = nameId.startsWith("0x") ? nameId : toHex(Number(nameId));
						const descIdHex = descId.startsWith("0x") ? descId : toHex(Number(descId));

						const nameFr = textFr.get(nameIdHex);
						const nameEn = textEn.get(nameIdHex);
						const nameJa = textJa.get(nameIdHex);
						const descFr = textFr.get(descIdHex);

						const skill: ParsedSkill = {
							id: skillIdHex,
							name: nameFr || nameEn || "Unknown Skill",
							description: descFr,
							skillId: skillIdHex,
							names: { en: nameEn, fr: nameFr, ja: nameJa },
							descriptions: {
								en: textEn.get(descIdHex),
								fr: descFr,
								ja: textJa.get(descIdHex),
							},
							power: {
								min: entry.power_min || 0,
								max: entry.power_max || 0,
							},
							tpCost: entry.consumeTp || 0,
							difficulty: entry.difficulty || 0,
							element: elementMap[entry.element] || "Néant",
							type: typeMap[entry.category] || "Technique",
							attributes: {
								Type: typeMap[entry.category],
								Élément: elementMap[entry.element],
								"Coût PT": entry.consumeTp,
								Puissance: `${entry.power_min}-${entry.power_max}`,
								Difficulté: entry.difficulty,
							},
						};

						if (skill.names.fr || skill.names.ja) {
							skills.push(skill);
							byId.set(skillIdHex, skill);
							added++;
						}
					}
					console.log(`[SkillParser] Loaded ${added} skills from ${configPath.split("/").pop()}`);
				}
			}
		} catch (e) {
			console.error(`[skill-config] Build failed for ${configPath}`, e);
		}
	}

	console.log(
		`[SkillParser] Total: ${skills.length} active skills (merged from ${allConfigPaths.length} config files).`
	);

	return {
		skills,
		byId,
		toMarkdown: (id: string) => {
			const s = byId.get(id);
			return s ? EntityExporters.toMarkdown(s, "Technique Spéciale") : null;
		},
		toReact: (id: string) => {
			const s = byId.get(id);
			return s ? EntityExporters.toReact(s) : null;
		},
	};
}

// Deprecate Sync
export function buildSkillDatabase(_dataPath: string) {
	throw new Error("Synchronous buildSkillDatabase is deprecated. Use Async version.");
}
