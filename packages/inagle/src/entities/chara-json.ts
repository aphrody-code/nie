import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rewriteZukanUrl } from "../core/images.js";
import { DATA_ROOT } from "../core/paths.js";

export interface ZukanCharacter {
	id: string;
	name: string;
	nickname: string;
	image: string;
	detailUrl: string;
	gender: string;
	element: string;
	position: string;
	rarity: string | null;
	schoolYear: string;
	ageGroup: string;
	team: string;
	role: string;
	stats: {
		kick: number;
		control: number;
		technique: number;
		pressure: number;
		physical: number;
		agility: number;
		intelligence: number;
	};
	description: string;
	howToObtain: string;
	modelId: string;
}

let zukanCache: Map<string, ZukanCharacter> | null = null;

export function loadZukanCharacters(): Map<string, ZukanCharacter> {
	if (zukanCache) return zukanCache;

	zukanCache = new Map();
	// Use consolidated DB from zukan folder
	const path = join(DATA_ROOT, "zukan/db_consolidated.json");

	if (!existsSync(path)) {
		return zukanCache;
	}

	try {
		const content = readFileSync(path, "utf-8");
		const data = JSON.parse(content) as ZukanCharacter[];

		for (const char of data) {
			// Rewrite image URL
			if (char.image) {
				char.image = rewriteZukanUrl(char.image) as string;
			}

			if (char.modelId) {
				if (!zukanCache.has(char.modelId)) {
					zukanCache.set(char.modelId, char);
				}
			}
		}
	} catch (e) {
		console.error("[ZukanLoader] Failed to parse db_consolidated.json", e);
	}

	return zukanCache;
}
