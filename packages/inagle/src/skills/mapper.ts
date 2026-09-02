/**
 * Active Skill Mapper - Builds unified skill database
 *
 * Key structure:
 * - skill_config_*.json: version-based format with lists[].values
 * - skill_text.cfg.bin.json: CfgBin format with NOUN_INFO (names) and TEXT_INFO (descriptions)
 *
 * Hash conversion:
 * - skill_config uses hex strings like "0x07ADF4B1"
 * - skill_text uses signed integers that need >>> 0 for unsigned comparison
 */

/* eslint-disable no-console */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findConfigFile, sanitizeText } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/index.js";
import { loadShopConfig } from "../parsers/shop-config.js";
import type {
	CfgBinEntry,
	CfgBinFile,
	RawSkillConfigInfo,
	SkillConfigFile,
	SkillDatabase,
	UnifiedSkill,
} from "./types.js";
import { CATEGORY_NAMES, ELEMENT_NAMES } from "./types.js";

/** Parse JSON file safely */
function loadJson<T>(path: string): T {
	const content = readFileSync(path, "utf-8");
	return JSON.parse(content) as T;
}

/** Convert signed int to unsigned for hash comparison */
function toUnsigned(n: number): number {
	return n >>> 0;
}

/** Extract integer value from CfgBin variable */
function getInt(entry: CfgBinEntry, index: number): number {
	const v = entry.variables[index];
	if (!v) return 0;
	return Number.parseInt(String(v.value), 10);
}

/** Extract string value from CfgBin variable */
function getString(entry: CfgBinEntry, index: number): string {
	const v = entry.variables[index];
	if (!v) return "";
	return String(v.value);
}

interface TextMaps {
	names: Map<number, string>;
	descriptions: Map<number, string>;
}

/**
 * Parse skill_text file to extract names and descriptions
 *
 * Structure:
 * - NOUN_INFO: variables[0]=hash, variables[5]=name
 * - TEXT_INFO: variables[0]=hash, variables[2]=description
 */
function parseSkillText(filePath: string): TextMaps {
	if (!existsSync(filePath)) {
		console.warn(`  File not found: ${filePath}`);
		return { names: new Map(), descriptions: new Map() };
	}
	const data = loadJson<CfgBinFile>(filePath);

	const names = new Map<number, string>();
	const descriptions = new Map<number, string>();

	for (const entry of data.entries) {
		if (entry.name.startsWith("NOUN_INFO_BEGIN")) {
			for (const child of entry.children) {
				if (child.name.startsWith("NOUN_INFO_")) {
					const hash = toUnsigned(getInt(child, 0));
					// Try index 5 first (standard), then 2 (sometimes used)
					let name = getString(child, 5);
					if (!name) name = getString(child, 2);

					if (hash !== 0 && name) {
						names.set(hash, sanitizeText(name));
					}
				}
			}
		} else if (entry.name.startsWith("TEXT_INFO_BEGIN")) {
			for (const child of entry.children) {
				if (child.name.startsWith("TEXT_INFO_")) {
					const hash = toUnsigned(getInt(child, 0));
					const desc = getString(child, 2);
					if (hash !== 0 && desc) {
						descriptions.set(hash, sanitizeText(desc));
					}
				}
			}
		}
	}

	console.log(`  Found ${names.size} names, ${descriptions.size} descriptions`);
	return { names, descriptions };
}

/**
 * Build unified skill database
 */
export function buildSkillDatabase(options?: { dataRoot?: string }): SkillDatabase {
	const root = options?.dataRoot || DATA_ROOT;
	
	// Find all available skill configs (prefers highest versions, supports merging them)
	const skillConfigFiles: string[] = [];
	for (const version of [1, 2, 3, 4, 5]) {
		const found = findConfigFile("skill", `skill_config_${version}`);
		if (found) {
			skillConfigFiles.push(found);
		}
	}
	if (skillConfigFiles.length === 0) {
		skillConfigFiles.push("skill_config_2.00.19.00.cfg.bin.json");
	}

	const paths = {
		skillTextEn: join(root, "common/text/en/skill_text.cfg.bin.json"),
		skillTextFr: join(root, "common/text/fr/skill_text.cfg.bin.json"),
		skillTextJa: join(root, "common/text/ja/skill_text.cfg.bin.json"),
		shopTextEn: join(root, "common/text/en/shop_text.cfg.bin.json"),
		shopTextFr: join(root, "common/text/fr/shop_text.cfg.bin.json"),
	};

	// Load text maps for EN, FR and JA
	const textEn = parseSkillText(paths.skillTextEn);
	const textFr = parseSkillText(paths.skillTextFr);
	const textJa = parseSkillText(paths.skillTextJa);

	// Load shop data
	const shops = loadShopConfig(root);
	const shopTextEn = parseSkillText(paths.shopTextEn);
	const shopTextFr = parseSkillText(paths.shopTextFr);

	// Build map: ItemId -> { en: string[], fr: string[] }
	const itemShops = new Map<number, { en: string[]; fr: string[] }>();

	for (const shop of shops) {
		const shopNameEn = shopTextEn.names.get(shop.nameHash);
		const shopNameFr = shopTextFr.names.get(shop.nameHash);

		if (shopNameEn && shopNameFr) {
			for (const itemId of shop.items) {
				if (!itemShops.has(itemId)) {
					itemShops.set(itemId, { en: [], fr: [] });
				}
				const entry = itemShops.get(itemId)!;
				if (!entry.en.includes(shopNameEn)) entry.en.push(shopNameEn);
				if (!entry.fr.includes(shopNameFr)) entry.fr.push(shopNameFr);
			}
		}
	}
	console.log(`  Mapped shops for ${itemShops.size} items`);

	// Merge all config files to get complete skills list (later versions override earlier versions)
	const allRawSkillsMap = new Map<string, RawSkillConfigInfo>();

	for (const filename of skillConfigFiles) {
		const filePath = join(root, "common/gamedata/skill", filename);
		if (!existsSync(filePath)) {
			console.warn(`  File not found: ${filePath}`);
			continue;
		}
		try {
			const config = loadJson<SkillConfigFile>(filePath);
			const skillList = config.lists.find((l) => l.name === "m_skillInfoList");
			if (skillList) {
				console.log(`  Loaded ${skillList.values.length} skills from ${filename}`);
				for (const raw of skillList.values) {
					if (!raw?.skillIDStr || raw.skillIDStr === "") continue;
					allRawSkillsMap.set(raw.skillIDStr, raw);
				}
			}
		} catch (e) {
			console.error(`  Failed to load skill config from ${filename}`, e);
		}
	}

	console.log(`  Merged ${allRawSkillsMap.size} unique skills across ${skillConfigFiles.length} config files`);

	// Build unified skills
	const skills: UnifiedSkill[] = [];
	const stats = {
		totalSkills: 0,
		withNameEn: 0,
		withNameFr: 0,
		withNameJa: 0,
		withDescEn: 0,
		withDescFr: 0,
		withDescJa: 0,
		byElement: {} as Record<string, number>,
		byCategory: {} as Record<string, number>,
	};

	let idx = 0;
	for (const raw of allRawSkillsMap.values()) {
		const nameHash = Number.parseInt(raw.skillNameId, 16);
		const descHash = Number.parseInt(raw.skillDescId, 16);
		const skillHashId = Number.parseInt(raw.skillID, 16);

		const nameEn = textEn.names.get(nameHash);
		const nameFr = textFr.names.get(nameHash);
		const nameJa = textJa.names.get(nameHash);
		const descEn = textEn.descriptions.get(descHash);
		const descFr = textFr.descriptions.get(descHash);
		const descJa = textJa.descriptions.get(descHash);

		// Lookup shops (using skillHashId as itemId)
		const shopInfo = itemShops.get(skillHashId);

		const element = ELEMENT_NAMES[raw?.element ?? 0] ?? {
			en: "Unknown",
			ja: "不明",
		};
		const category = CATEGORY_NAMES[raw?.category ?? 0] ?? {
			en: "Unknown",
			ja: "不明",
		};

		const skill: UnifiedSkill = {
			id: idx++,
			hashId: skillHashId,
			internalCode: raw.skillIDStr,
			eventName: raw.eventIDName,
			image: `${raw.skillIDStr}.png`,
			names: {
				en: nameEn,
				fr: nameFr,
				ja: nameJa,
			},
			descriptions: {
				en: descEn,
				fr: descFr,
				ja: descJa,
			},
			shops: shopInfo
				? {
						en: shopInfo.en,
						fr: shopInfo.fr,
					}
				: undefined,
			stats: {
				powerMin: raw.power_min,
				powerMax: raw.power_max,
				tensionCost: raw.consumeTp, // Game uses "Tension" bar
				recastTime: raw.recastTime,
				growthType: raw.growthType,
				foulRate: raw.foulRate,
				skillEffectBitFlag: raw.skillEffectBitFlag,
			},
			element: {
				id: raw.element,
				nameEn: element.en,
				nameJa: element.ja,
			},
			category: {
				id: raw.category,
				nameEn: category.en,
				nameJa: category.ja,
			},
			partnerType: raw.partnerType,
			isEldorado: raw.eldorado,
		};

		skills.push(skill);

		// Update stats
		stats.totalSkills++;
		if (nameEn) stats.withNameEn++;
		if (nameFr) stats.withNameFr++;
		if (nameJa) stats.withNameJa++;
		if (descEn) stats.withDescEn++;
		if (descFr) stats.withDescFr++;
		if (descJa) stats.withDescJa++;

		const elementKey = element.en;
		stats.byElement[elementKey] = (stats.byElement[elementKey] || 0) + 1;

		const categoryKey = category.en;
		stats.byCategory[categoryKey] = (stats.byCategory[categoryKey] || 0) + 1;
	}

	// Sort by internal code
	skills.sort((a, b) => a.internalCode.localeCompare(b.internalCode));

	return {
		generatedAt: new Date().toISOString(),
		sources: {
			skillConfig: skillConfigFiles.join(", "),
			skillTextEn: "en/skill_text.cfg.bin.json",
			skillTextFr: "fr/skill_text.cfg.bin.json",
			skillTextJa: "ja/skill_text.cfg.bin.json",
		},
		stats,
		skills,
	};
}
