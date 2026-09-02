/**
 * @file passive-skill-config.ts
 * @description Parser for passive_skill_config files (Passives/Abilities)
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { loadTextFileAsync } from "./text-parser.js";

export interface ParsedPassiveEffect {
	effectId: string;
	params: number[];
}

export interface ParsedPassive extends ExportableEntity {
	passiveId: string; // Hex
	effectId: string;
	names: { en?: string; fr?: string; ja?: string };
	descriptions: { en?: string; fr?: string; ja?: string };
	rarity: number;
	effectParams?: number[];
	scope?: "team" | "player";
}

function findPassiveConfigFile(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir);
	const configFile = files
		.filter((f) => f.startsWith("passive_skill_config_") && f.endsWith(".cfg.bin.json"))
		.sort()
		.pop();
	return configFile ? join(dir, configFile) : null;
}

export async function buildPassiveDatabaseAsync(dataPath: string) {
	const skillDir = join(dataPath, "common", "gamedata", "skill");
	const configPath = findPassiveConfigFile(skillDir);

	const passives: ParsedPassive[] = [];
	const byId = new Map<string, ParsedPassive>();

	if (!configPath) {
		console.warn("[passive-skill-config] Config not found in", skillDir);
		return { passives, byId, toMarkdown: () => null, toReact: () => null };
	}

	// Load Texts in Parallel
	const [textEn, textFr, textJa, textPassiveEn, textPassiveFr, textPassiveJa] = await Promise.all([
		loadTextFileAsync("skill", "en"),
		loadTextFileAsync("skill", "fr"),
		loadTextFileAsync("skill", "ja"),
		loadTextFileAsync("soccer_passive", "en"),
		loadTextFileAsync("soccer_passive", "fr"),
		loadTextFileAsync("soccer_passive", "ja"),
	]);

	// Load Team Passives
	const teamPassivePath = join(
		dataPath,
		"common/gamedata/soccer/soccer_team_passive_config_0.00.00.cfg.bin.json"
	);
	const teamContent = await loadJsonAsync<any>(teamPassivePath);

	if (teamContent?.lists) {
		const list = teamContent.lists.find((l: any) => l.name === "m_soccerTeamPassiveDataList");
		if (list?.values) {
			for (const entry of list.values) {
				const id = entry.teamPassiveId;
				const textId = entry.teamPassiveTextId;
				const effectId = entry.effectId;

				const idHex = id.startsWith("0x") ? id : toHex(Number(id));
				const textIdHex = textId.startsWith("0x") ? textId : toHex(Number(textId));

				const nameFr = textPassiveFr.get(textIdHex);
				const nameEn = textPassiveEn.get(textIdHex);
				const nameJa = textPassiveJa.get(textIdHex);

				if (nameFr || nameJa) {
					const passive: ParsedPassive = {
						id: idHex,
						name: nameFr || nameEn || "Team Passive",
						description: nameFr,
						passiveId: idHex,
						effectId: effectId,
						names: { en: nameEn, fr: nameFr, ja: nameJa },
						descriptions: { en: nameEn, fr: nameFr, ja: nameJa },
						rarity: 0,
						effectParams: [entry.effectValueMin, entry.effectValueMax],
						scope: "team",
						attributes: {
							Type: "Passif d'Équipe",
							"Effet Min": entry.effectValueMin,
							"Effet Max": entry.effectValueMax,
						},
					};
					passives.push(passive);
					byId.set(idHex, passive);
				}
			}
		}
	}

	try {
		const content = await loadJsonAsync<any>(configPath);
		if (!content) throw new Error("Failed to load passive config");

		const entries = content.entries as ConfigNode[];
		const effectsMap = new Map<string, ParsedPassiveEffect>();

		// Pass 1: Collect Effects
		function collectEffects(node: ConfigNode) {
			if (node.name.startsWith("PASSIVE_SKILL_EFFECT_") && !node.name.includes("_LIST_")) {
				const vars = node.variables;
				if (vars.length >= 2) {
					const effectId = toHex(Number.parseInt(vars[0].value, 10));
					const params = vars
						.slice(1)
						.map((v) =>
							v.type === "Float"
								? parseFloat(v.value.replace(",", "."))
								: Number.parseInt(v.value, 10)
						);
					effectsMap.set(effectId, { effectId, params });
				}
			}
			if (node.children) node.children.forEach(collectEffects);
		}
		entries.forEach(collectEffects);
		console.log(`[PassiveParser] Loaded ${effectsMap.size} effects.`);

		// Pass 2: Collect Skills
		function collectSkills(node: ConfigNode) {
			if (
				node.name.startsWith("PASSIVE_SKILL_INFO_") &&
				!node.name.includes("_LIST_") &&
				!node.name.includes("_REF_")
			) {
				const vars = node.variables;
				if (vars.length >= 5) {
					const passiveIdInt = Number.parseInt(vars[0].value, 10);
					const effectIdInt = Number.parseInt(vars[1].value, 10);
					const nameIdInt = Number.parseInt(vars[2].value, 10);
					const descIdInt = Number.parseInt(vars[3].value, 10);
					const rarity = Number.parseInt(vars[4].value, 10);

					const passiveIdHex = toHex(passiveIdInt);
					const effectIdHex = toHex(effectIdInt);
					const nameIdHex = toHex(nameIdInt);
					const descIdHex = toHex(descIdInt);

					let nameFr = textFr.get(nameIdHex) || textPassiveFr.get(nameIdHex);
					let nameJa = textJa.get(nameIdHex) || textPassiveJa.get(nameIdHex);
					let nameEn = textEn.get(nameIdHex) || textPassiveEn.get(nameIdHex);

					if (!nameFr && textPassiveFr.has(passiveIdHex)) {
						nameFr = textPassiveFr.get(passiveIdHex);
						nameJa = textPassiveJa.get(passiveIdHex);
						nameEn = textPassiveEn.get(passiveIdHex);
					}

					const descFr = textFr.get(descIdHex) || textPassiveFr.get(descIdHex);
					const effectParams = effectsMap.get(effectIdHex)?.params;
					const finalName = nameFr || nameEn || `Passive_${passiveIdHex}`;

					const passive: ParsedPassive = {
						id: passiveIdHex,
						name: finalName,
						description: descFr,
						passiveId: passiveIdHex,
						effectId: effectIdHex,
						names: { en: nameEn, fr: nameFr, ja: nameJa },
						descriptions: {
							en: textEn.get(descIdHex) || textPassiveEn.get(descIdHex),
							fr: descFr,
							ja: textJa.get(descIdHex) || textPassiveJa.get(descIdHex),
						},
						rarity,
						effectParams: effectParams,
						scope: "player",
						attributes: {
							Type: "Passif Joueur",
							Rareté: rarity,
							Valeur: effectParams ? effectParams[0] : undefined,
						},
					};

					passives.push(passive);
					byId.set(passiveIdHex, passive);
				}
			}
			if (node.children) node.children.forEach(collectSkills);
		}

		entries.forEach(collectSkills);
		console.log(`[PassiveParser] Loaded ${passives.length} passives.`);
	} catch (e) {
		console.error("[passive-skill-config] Build failed", e);
	}

	return {
		passives,
		byId,
		toMarkdown: (id: string) => {
			const p = byId.get(id);
			return p ? EntityExporters.toMarkdown(p, "Talent Passif") : null;
		},
		toReact: (id: string) => {
			const p = byId.get(id);
			return p ? EntityExporters.toReact(p) : null;
		},
	};
}

// Keep sync version for compatibility if needed, but simplified to wrap async in future
export function buildPassiveDatabase(_dataPath: string) {
	throw new Error("Synchronous buildPassiveDatabase is deprecated. Use Async version.");
}
