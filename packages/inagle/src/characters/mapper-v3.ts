/**
 * Character Mapper V3 - Based on actual chara_base structure
 *
 * Key discovery:
 * - chara_base[3] = name hash (links to chara_text)
 * - chara_base[19] = description hash (links to chara_description_text)
 * - chara_base[1] = internal code (c01000010, etc.)
 * - chara_base[0] = unique character hash
 */

/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGameDataFile } from "../core/paths.js";
import type { CfgBinEntry, CfgBinFile, CharacterDatabase, UnifiedCharacter } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = join(__dirname, "../../../../../data");

/** Parse JSON file safely */
function loadJson<T>(path: string): T {
	const content = readFileSync(path, "utf-8");
	return JSON.parse(content) as T;
}

/** Extract integer value from variable */
function getInt(entry: CfgBinEntry, index: number): number {
	const v = entry.variables[index];
	if (!v || v.type !== "Int") return 0;
	return Number.parseInt(String(v.value), 10);
}

/** Extract string value from variable */
function getString(entry: CfgBinEntry, index: number): string {
	const v = entry.variables[index];
	if (!v || v.type !== "String") return "";
	return String(v.value);
}

interface TextEntry {
	hash: number;
	textType: number;
	name: string;
}

/**
 * Parse chara_text file to extract names
 * Returns a map of hash -> {full, family, first}
 */
function parseCharaText(
	filePath: string
): Map<number, { full?: string; family?: string; first?: string }> {
	console.log(`[CharaMapper] Loading ${filePath.split(/[/\\]/).pop()}`);
	const data = loadJson<CfgBinFile>(filePath);
	const textMap = new Map<number, TextEntry[]>();

	for (const entry of data.entries) {
		if (entry.name.startsWith("NOUN_INFO_BEGIN")) {
			for (const child of entry.children) {
				if (child.name.startsWith("NOUN_INFO_")) {
					const hash = getInt(child, 0);
					const textType = getInt(child, 1);
					const name = getString(child, 5);

					if (hash !== 0 && name) {
						const existing = textMap.get(hash) || [];
						existing.push({ hash, textType, name });
						textMap.set(hash, existing);
					}
				}
			}
		}
	}

	// Convert to name parts
	const result = new Map<number, { full?: string; family?: string; first?: string }>();
	for (const [hash, texts] of textMap) {
		const parts: { full?: string; family?: string; first?: string } = {};
		for (const t of texts) {
			if (t.textType === 0) parts.full = t.name;
			else if (t.textType === 11) parts.family = t.name;
			else if (t.textType === 12) parts.first = t.name;
		}
		if (parts.full) result.set(hash, parts);
	}

	console.log(`  Found ${result.size} unique names`);
	return result;
}

/**
 * Parse chara_description_text file
 */
function parseCharaDescription(filePath: string): Map<number, string> {
	console.log(`[CharaMapper] Loading ${filePath.split(/[/\\]/).pop()}`);
	const data = loadJson<CfgBinFile>(filePath);
	const descriptions = new Map<number, string>();

	for (const entry of data.entries) {
		if (entry.name.startsWith("TEXT_INFO_BEGIN")) {
			for (const child of entry.children) {
				if (child.name.startsWith("TEXT_INFO_")) {
					const hash = getInt(child, 0);
					const description = getString(child, 2);

					if (hash !== 0 && description) {
						descriptions.set(hash, description.replace(/\\n/g, "\n"));
					}
				}
			}
		}
	}

	console.log(`  Found ${descriptions.size} descriptions`);
	return descriptions;
}

/**
 * Build unified character database using correct field mapping
 *
 * chara_base structure:
 * [0] = unique character hash
 * [1] = internal code (string)
 * [3] = name hash -> links to chara_text
 * [19] = description hash -> links to chara_description_text
 */
export function buildCharacterDatabaseV3(options?: { dataRoot?: string }): CharacterDatabase {
	const root = options?.dataRoot || DATA_ROOT;

	const paths = {
		// Résolution version-agnostique (repli sur le chemin versionné historique)
		charaBase:
			resolveGameDataFile("character", "chara_base") ??
			join(root, "common/gamedata/character/chara_base_1.03.98.00.cfg.bin.json"),
		charaTextEn: join(root, "common/text/en/chara_text.cfg.bin.json"),
		charaTextRoma: join(root, "common/text/en/chara_text_roma.cfg.bin.json"),
		charaDescFr: join(root, "common/text/fr/chara_description_text.cfg.bin.json"),
	};

	console.log("[CharaMapper V3] Building character database...");
	console.log(`[CharaMapper V3] Data root: ${root}\n`);

	// Load name/description maps
	const namesEn = parseCharaText(paths.charaTextEn);
	const namesJp = parseCharaText(paths.charaTextRoma);
	const descriptionsFr = parseCharaDescription(paths.charaDescFr);

	// Load chara_base
	console.log("[CharaMapper] Loading chara_base");
	const base = loadJson<CfgBinFile>(paths.charaBase);

	// Find the info list
	const infoList = base.entries.find((e) => e.name.includes("CHARA_BASE_INFO_LIST"));
	if (!infoList) {
		throw new Error("CHARA_BASE_INFO_LIST not found");
	}

	// Filter to only CHARA_BASE_INFO entries (not REF_BATTLE)
	const infoEntries = infoList.children.filter((c) => /^CHARA_BASE_INFO_\d+$/.test(c.name));
	console.log(`  Found ${infoEntries.length} character entries`);

	// Build unified characters
	// Group by name hash to find variants
	const charactersByNameHash = new Map<
		number,
		{
			entries: CfgBinEntry[];
			enNames?: { full?: string; family?: string; first?: string };
			jpNames?: { full?: string; family?: string; first?: string };
		}
	>();

	for (const entry of infoEntries) {
		const nameHash = getInt(entry, 3);
		if (nameHash === 0) continue;

		const existing = charactersByNameHash.get(nameHash);
		if (existing) {
			existing.entries.push(entry);
		} else {
			charactersByNameHash.set(nameHash, {
				entries: [entry],
				enNames: namesEn.get(nameHash),
				jpNames: namesJp.get(nameHash),
			});
		}
	}

	// Now build unified characters from groups
	const characters: UnifiedCharacter[] = [];
	let id = 0;

	for (const [nameHash, group] of charactersByNameHash) {
		const { entries, enNames, jpNames } = group;

		// Skip if no name found
		if (!enNames?.full && !jpNames?.full) continue;

		// Sort entries by internal code (base version first)
		entries.sort((a, b) => {
			const codeA = getString(a, 1);
			const codeB = getString(b, 1);
			// Base version (no underscore) comes first
			const aHasUnderscore = codeA.includes("_");
			const bHasUnderscore = codeB.includes("_");
			if (!aHasUnderscore && bHasUnderscore) return -1;
			if (aHasUnderscore && !bHasUnderscore) return 1;
			return codeA.localeCompare(codeB);
		});

		const primary = entries[0];
		const internalCode = getString(primary, 1);
		const descHash = getInt(primary, 19);
		const descFr = descriptionsFr.get(descHash);

		const character: UnifiedCharacter = {
			id: id++,
			hashId: nameHash,
			internalCode,
			names: {
				en: enNames?.full,
				enFamily: enNames?.family,
				enFirst: enNames?.first,
				jp: jpNames?.full,
				jpFamily: jpNames?.family,
				jpFirst: jpNames?.first,
			},
			descriptions: {
				fr: descFr,
			},
		};

		// Add variants if there are multiple entries
		if (entries.length > 1) {
			character.variants = entries.slice(1).map((e) => ({
				hashId: getInt(e, 0),
				internalCode: getString(e, 1),
			}));
		}

		characters.push(character);
	}

	// Sort by ID
	characters.sort((a, b) => a.id - b.id);

	console.log(`\n[CharaMapper V3] Built database with ${characters.length} characters`);

	return {
		generatedAt: new Date().toISOString(),
		sources: {
			charaBase: "chara_base_1.03.98.00.cfg.bin.json",
			charaParam: "N/A",
			charaTextEn: "chara_text.cfg.bin.json",
			charaTextRoma: "chara_text_roma.cfg.bin.json",
			charaDescFr: "chara_description_text.cfg.bin.json",
		},
		totalCharacters: characters.length,
		characters,
	};
}
