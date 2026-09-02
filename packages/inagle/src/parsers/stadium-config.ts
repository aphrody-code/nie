/**
 * @file stadium-config.ts
 * @description Parser for stadium/field configuration
 *
 * Data source: soccer/soccer_game_option.cfg.bin.json
 *
 * Structure (entries format):
 * - SOCCER_OPTION_FIELD_INFO_*: Field entries with stadium images
 *   Variables: [fieldId (Int), index (Int), condition? (String), imagePath (String), ...]
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedStadium extends ExportableEntity {
	fieldId: string;
	index: number;
	imagePath: string;
	condition: string;
}

export interface StadiumDatabase {
	stadiums: ParsedStadium[];
	byId: Map<string, ParsedStadium>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Helpers
// ============================================================================

function toHex(value: number | string): string {
	const num = typeof value === "string" ? parseInt(value, 10) : value;
	return `0x${(num >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function extractImageName(texturePath: string): string {
	return texturePath.replace("#/menu/220_img/", "").replace(".g4tx", "");
}

// ============================================================================
// Parser
// ============================================================================

function parseFieldEntry(child: any): ParsedStadium | null {
	const vars = child.variables || [];
	let imagePath = "";
	let condition = "";
	let fieldIdRaw = 0;
	let index = 0;

	for (let i = 0; i < vars.length; i++) {
		const v = vars[i];
		if (v.type === "String" && typeof v.value === "string") {
			if (v.value.includes("220_img/stadium/")) {
				imagePath = extractImageName(v.value);
			} else if (v.value.length > 20) {
				condition = v.value;
			}
		} else if (v.type === "Int" && i === 0) {
			fieldIdRaw = parseInt(v.value, 10);
		} else if (v.type === "Int" && i === 1) {
			index = parseInt(v.value, 10);
		}
	}

	if (!imagePath) return null;

	const fieldId = toHex(fieldIdRaw);
	return {
		id: fieldId,
		name: imagePath.split("/").pop() || fieldId,
		fieldId,
		index,
		imagePath,
		condition,
		attributes: {
			Index: index,
			Image: imagePath,
		},
	};
}

function parseContent(content: any): ParsedStadium[] {
	const stadiums: ParsedStadium[] = [];
	if (!content?.entries) return stadiums;

	for (const entry of content.entries) {
		// Direct FIELD_INFO entries (flat format)
		if (entry.name?.startsWith("SOCCER_OPTION_FIELD_INFO_") && !entry.name.includes("_LIST_")) {
			const s = parseFieldEntry(entry);
			if (s) stadiums.push(s);
		}

		// Nested inside LIST_BEG (children format)
		if (entry.name?.startsWith("SOCCER_OPTION_FIELD_INFO_LIST_BEG_")) {
			for (const child of entry.children || []) {
				const s = parseFieldEntry(child);
				if (s) stadiums.push(s);
			}
		}
	}
	return stadiums;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadStadiumConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedStadium[] | null> {
	const path = join(dataPath, "common/gamedata/soccer/soccer_game_option.cfg.bin.json");
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildStadiumDatabase(dataPath: string = DATA_ROOT): Promise<StadiumDatabase> {
	const stadiums = (await loadStadiumConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedStadium>();
	for (const s of stadiums) byId.set(s.fieldId, s);

	return {
		stadiums,
		byId,
		toMarkdown: (id: string) => {
			const s = byId.get(id);
			return s ? EntityExporters.toMarkdown(s, "Stade") : null;
		},
		toReact: (id: string) => {
			const s = byId.get(id);
			return s ? EntityExporters.toReact(s) : null;
		},
	};
}
