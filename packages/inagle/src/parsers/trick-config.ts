/**
 * @file trick-config.ts
 * @description Parser for trick/feint configuration
 *
 * Data source: skill/trick_config.cfg.bin.json
 *
 * Structure (lists format):
 * - m_trickInfoList: Trick entries (9 entries)
 *   Fields: trickID (hex), trickIDName (string), eventID (hex), eventIDName (string),
 *           failEventID (hex), failEventIDName (string), trickName (JP string), trickCategory (int)
 *
 * Categories: 1=Shoot, 2=Dribble, 3=Block, 4=Catch
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

const TRICK_CATEGORY_MAP: Record<number, string> = {
	1: "Tir",
	2: "Dribble",
	3: "Bloc",
	4: "Arret",
};

export interface ParsedTrick extends ExportableEntity {
	trickId: string;
	trickIdName: string;
	eventId: string;
	eventIdName: string;
	failEventId: string;
	failEventIdName: string;
	trickNameJa: string;
	trickCategory: number;
	trickCategoryName: string;
}

export interface TrickDatabase {
	tricks: ParsedTrick[];
	byId: Map<string, ParsedTrick>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): ParsedTrick[] {
	const tricks: ParsedTrick[] = [];
	if (!content?.lists) return tricks;

	for (const list of content.lists) {
		if (list.name === "m_trickInfoList") {
			for (const val of list.values) {
				const categoryName = TRICK_CATEGORY_MAP[val.trickCategory] || `Cat${val.trickCategory}`;
				tricks.push({
					id: val.trickID,
					name: val.trickName,
					trickId: val.trickID,
					trickIdName: val.trickIDName,
					eventId: val.eventID,
					eventIdName: val.eventIDName,
					failEventId: val.failEventID,
					failEventIdName: val.failEventIDName,
					trickNameJa: val.trickName,
					trickCategory: val.trickCategory,
					trickCategoryName: categoryName,
					attributes: {
						Code: val.trickIDName,
						Categorie: categoryName,
						Evenement: val.eventIDName,
					},
				});
			}
		}
	}
	return tricks;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadTrickConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedTrick[] | null> {
	const filename = findConfigFile("skill", "trick_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/skill", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildTrickDatabase(dataPath: string = DATA_ROOT): Promise<TrickDatabase> {
	const tricks = (await loadTrickConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedTrick>();
	for (const t of tricks) byId.set(t.trickId, t);

	return {
		tricks,
		byId,
		toMarkdown: (id: string) => {
			const t = byId.get(id);
			return t ? EntityExporters.toMarkdown(t, "Feinte") : null;
		},
		toReact: (id: string) => {
			const t = byId.get(id);
			return t ? EntityExporters.toReact(t) : null;
		},
	};
}
