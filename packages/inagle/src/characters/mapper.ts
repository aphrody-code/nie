/**
 * Character Mapper - Unifies all character data from different sources
 *
 * Files used:
 * - chara_base_*.cfg.bin.json: Base character info with hash IDs and internal codes
 * - chara_param_*.cfg.bin.json: Character parameters and stats
 * - chara_text.cfg.bin.json (en): English names
 * - chara_text_roma.cfg.bin.json (en): Japanese romanized names
 * - chara_description_text.cfg.bin.json (fr): French descriptions
 */

/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGameDataFile } from "../core/paths.js";
import type {
	CfgBinEntry,
	CfgBinFile,
	CharaBaseInfo,
	CharacterDatabase,
	CharaParamInfo,
	CharaTextInfo,
	UnifiedCharacter,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = join(__dirname, "../../../../../data");

/** Parse JSON file safely */
function loadJson<T>(path: string): T {
	const content = readFileSync(path, "utf-8");
	return JSON.parse(content) as T;
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

/**
 * Parse chara_base file to extract character info
 */
export function parseCharaBase(filePath: string): CharaBaseInfo[] {
	console.log(`[CharaMapper] Loading chara_base from ${filePath}`);
	const data = loadJson<CfgBinFile>(filePath);
	const characters: CharaBaseInfo[] = [];

	// Find CHARA_BASE_INFO_LIST entries
	for (const entry of data.entries) {
		if (entry.name.startsWith("CHARA_BASE_INFO_LIST_BEG")) {
			// Children contain the actual character info
			for (const child of entry.children) {
				if (child.name.startsWith("CHARA_BASE_INFO_") && !child.name.includes("REF_BATTLE")) {
					// Extract index from name (CHARA_BASE_INFO_123 -> 123)
					const match = child.name.match(/CHARA_BASE_INFO_(\d+)/);
					if (match) {
						const index = Number.parseInt(match[1], 10);
						const hashId = getInt(child, 0);
						const internalCode = getString(child, 1);
						const nameHash = getInt(child, 6); // Position may vary

						if (hashId !== 0) {
							characters.push({
								index,
								hashId,
								internalCode,
								nameHash,
							});
						}
					}
				}
			}
		}
	}

	console.log(`[CharaMapper] Found ${characters.length} characters in chara_base`);
	return characters;
}

/**
 * Parse chara_param file to extract parameters
 */
export function parseCharaParam(filePath: string): Map<number, CharaParamInfo> {
	console.log(`[CharaMapper] Loading chara_param from ${filePath}`);
	const data = loadJson<CfgBinFile>(filePath);
	const params = new Map<number, CharaParamInfo>();

	for (const entry of data.entries) {
		if (entry.name.startsWith("CHARA_PARAM_INFO_LIST_BEG")) {
			for (const child of entry.children) {
				if (child.name.startsWith("CHARA_PARAM_INFO_") && !child.name.includes("LIST")) {
					const match = child.name.match(/CHARA_PARAM_INFO_(\d+)/);
					if (match) {
						const index = Number.parseInt(match[1], 10);
						const hashId = getInt(child, 0);
						const nameHash = getInt(child, 1);
						const stats = child.variables
							.slice(2)
							.filter((v) => v.type === "Int")
							.map((v) => Number.parseInt(String(v.value), 10));

						if (hashId !== 0) {
							params.set(hashId, {
								index,
								hashId,
								nameHash,
								stats,
							});
						}
					}
				}
			}
		}
	}

	console.log(`[CharaMapper] Found ${params.size} character params`);
	return params;
}

/**
 * Parse chara_text file to extract names
 * Returns a map of hashId -> array of text entries (full name, family, first)
 */
export function parseCharaText(filePath: string): Map<number, CharaTextInfo[]> {
	console.log(`[CharaMapper] Loading chara_text from ${filePath}`);
	const data = loadJson<CfgBinFile>(filePath);
	const texts = new Map<number, CharaTextInfo[]>();

	for (const entry of data.entries) {
		if (entry.name.startsWith("NOUN_INFO_BEGIN")) {
			for (const child of entry.children) {
				if (child.name.startsWith("NOUN_INFO_")) {
					const hashId = getInt(child, 0);
					const textType = getInt(child, 1);
					// Name is at position 5 (after 3 empty strings)
					const name = getString(child, 5);

					if (hashId !== 0 && name) {
						const existing = texts.get(hashId) || [];
						existing.push({ hashId, textType, name });
						texts.set(hashId, existing);
					}
				}
			}
		}
	}

	console.log(`[CharaMapper] Found ${texts.size} unique character names`);
	return texts;
}

/**
 * Parse chara_description_text file
 */
export function parseCharaDescription(filePath: string): Map<number, string> {
	console.log(`[CharaMapper] Loading chara_description from ${filePath}`);
	const data = loadJson<CfgBinFile>(filePath);
	const descriptions = new Map<number, string>();

	for (const entry of data.entries) {
		if (entry.name.startsWith("TEXT_INFO_BEGIN")) {
			for (const child of entry.children) {
				if (child.name.startsWith("TEXT_INFO_")) {
					const hashId = getInt(child, 0);
					const description = getString(child, 2);

					if (hashId !== 0 && description) {
						descriptions.set(hashId, description.replace(/\\n/g, "\n"));
					}
				}
			}
		}
	}

	console.log(`[CharaMapper] Found ${descriptions.size} character descriptions`);
	return descriptions;
}

/**
 * Extract name parts from text entries
 */
function extractNames(texts: CharaTextInfo[] | undefined): {
	full?: string;
	family?: string;
	first?: string;
} {
	if (!texts) return {};

	const result: { full?: string; family?: string; first?: string } = {};
	for (const t of texts) {
		if (t.textType === 0) result.full = t.name;
		else if (t.textType === 11) result.family = t.name;
		else if (t.textType === 12) result.first = t.name;
	}
	return result;
}

/**
 * Build unified character database
 */
export function buildCharacterDatabase(options?: { dataRoot?: string }): CharacterDatabase {
	const root = options?.dataRoot || DATA_ROOT;

	// File paths
	const paths = {
		// Résolution version-agnostique (repli sur le chemin versionné historique)
		charaBase:
			resolveGameDataFile("character", "chara_base") ??
			join(root, "common/gamedata/character/chara_base_1.03.98.00.cfg.bin.json"),
		charaParam:
			resolveGameDataFile("character", "chara_param") ??
			join(root, "common/gamedata/character/chara_param_1.03.66.00.cfg.bin.json"),
		charaTextEn: join(root, "common/text/en/chara_text.cfg.bin.json"),
		charaTextFr: join(root, "common/text/fr/chara_text.cfg.bin.json"),
		charaTextRoma: join(root, "common/text/en/chara_text_roma.cfg.bin.json"),
		charaDescFr: join(root, "common/text/fr/chara_description_text.cfg.bin.json"),
	};

	console.log("[CharaMapper] Building character database...");
	console.log(`[CharaMapper] Data root: ${root}`);

	// Load all data sources
	const charaBase = parseCharaBase(paths.charaBase);
	const charaParams = parseCharaParam(paths.charaParam);
	const namesEn = parseCharaText(paths.charaTextEn);
	const namesFr = parseCharaText(paths.charaTextFr);
	const namesJp = parseCharaText(paths.charaTextRoma);
	const descriptionsFr = parseCharaDescription(paths.charaDescFr);

	// Build unified characters
	// Group by base hash to find variants
	const charactersByBaseHash = new Map<number, CharaBaseInfo[]>();

	for (const chara of charaBase) {
		// Try to find name hash from param
		const param = charaParams.get(chara.hashId);
		const nameHash = param?.nameHash || chara.nameHash || chara.hashId;

		const existing = charactersByBaseHash.get(nameHash) || [];
		existing.push(chara);
		charactersByBaseHash.set(nameHash, existing);
	}

	// Create unified characters
	const characters: UnifiedCharacter[] = [];
	let id = 0;

	for (const [nameHash, variants] of charactersByBaseHash) {
		// Get names from text files
		const enNames = extractNames(namesEn.get(nameHash));
		const frNames = extractNames(namesFr.get(nameHash));
		const jpNames = extractNames(namesJp.get(nameHash));
		const descFr = descriptionsFr.get(nameHash);

		// Skip if no name found (probably not a real character)
		if (!enNames.full && !jpNames.full) continue;

		// Primary variant is the first one
		const primary = variants[0];

		const character: UnifiedCharacter = {
			id: id++,
			hashId: nameHash,
			internalCode: primary.internalCode,
			names: {
				en: enNames.full,
				enFamily: enNames.family,
				enFirst: enNames.first,
				fr: frNames.full,
				frFamily: frNames.family,
				frFirst: frNames.first,
				jp: jpNames.full,
				jpFamily: jpNames.family,
				jpFirst: jpNames.first,
			},
			descriptions: {
				fr: descFr,
			},
		};

		// Add variants if there are multiple
		if (variants.length > 1) {
			character.variants = variants.slice(1).map((v) => ({
				hashId: v.hashId,
				internalCode: v.internalCode,
			}));
		}

		characters.push(character);
	}

	// Sort by ID
	characters.sort((a, b) => a.id - b.id);

	console.log(`[CharaMapper] Built database with ${characters.length} characters`);

	return {
		generatedAt: new Date().toISOString(),
		sources: {
			charaBase: "chara_base_1.03.98.00.cfg.bin.json",
			charaParam: "chara_param_1.03.66.00.cfg.bin.json",
			charaTextEn: "chara_text.cfg.bin.json",
			charaTextRoma: "chara_text_roma.cfg.bin.json",
			charaDescFr: "chara_description_text.cfg.bin.json",
		},
		totalCharacters: characters.length,
		characters,
	};
}

/**
 * Alternative approach: Use param hash as primary key
 * This may give better results for linking names to descriptions
 */
export function buildCharacterDatabaseV2(options?: { dataRoot?: string }): CharacterDatabase {
	const root = options?.dataRoot || DATA_ROOT;

	const paths = {
		// Résolution version-agnostique (repli sur le chemin versionné historique)
		charaBase:
			resolveGameDataFile("character", "chara_base") ??
			join(root, "common/gamedata/character/chara_base_1.03.98.00.cfg.bin.json"),
		charaParam:
			resolveGameDataFile("character", "chara_param") ??
			join(root, "common/gamedata/character/chara_param_1.03.66.00.cfg.bin.json"),
		charaTextEn: join(root, "common/text/en/chara_text.cfg.bin.json"),
		charaTextFr: join(root, "common/text/fr/chara_text.cfg.bin.json"),
		charaTextRoma: join(root, "common/text/en/chara_text_roma.cfg.bin.json"),
		charaDescFr: join(root, "common/text/fr/chara_description_text.cfg.bin.json"),
	};

	console.log("[CharaMapper V2] Building character database using param-based linking...");

	// Load sources
	const charaParams = parseCharaParam(paths.charaParam);
	const namesEn = parseCharaText(paths.charaTextEn);
	const namesFr = parseCharaText(paths.charaTextFr);
	const namesJp = parseCharaText(paths.charaTextRoma);
	const descriptionsFr = parseCharaDescription(paths.charaDescFr);

	// Build from params (which have name hash as second field)
	const characters: UnifiedCharacter[] = [];
	let id = 0;

	// Track seen name hashes to avoid duplicates
	const seenNameHashes = new Set<number>();

	for (const [hashId, param] of charaParams) {
		const nameHash = param.nameHash;

		// Skip duplicates
		if (seenNameHashes.has(nameHash)) continue;
		seenNameHashes.add(nameHash);

		const enNames = extractNames(namesEn.get(nameHash));
		const frNames = extractNames(namesFr.get(nameHash));
		const jpNames = extractNames(namesJp.get(nameHash));
		const descFr = descriptionsFr.get(hashId) || descriptionsFr.get(nameHash);

		// Skip if no identifiable name
		if (!enNames.full && !jpNames.full) continue;

		characters.push({
			id: id++,
			hashId: nameHash,
			internalCode: `param_${param.index}`,
			names: {
				en: enNames.full,
				enFamily: enNames.family,
				enFirst: enNames.first,
				fr: frNames.full,
				frFamily: frNames.family,
				frFirst: frNames.first,
				jp: jpNames.full,
				jpFamily: jpNames.family,
				jpFirst: jpNames.first,
			},
			descriptions: {
				fr: descFr,
			},
		});
	}

	characters.sort((a, b) => a.id - b.id);

	console.log(`[CharaMapper V2] Built database with ${characters.length} characters`);

	return {
		generatedAt: new Date().toISOString(),
		sources: {
			charaBase: "chara_base_1.03.98.00.cfg.bin.json",
			charaParam: "chara_param_1.03.66.00.cfg.bin.json",
			charaTextEn: "chara_text.cfg.bin.json",
			charaTextRoma: "chara_text_roma.cfg.bin.json",
			charaDescFr: "chara_description_text.cfg.bin.json",
		},
		totalCharacters: characters.length,
		characters,
	};
}
