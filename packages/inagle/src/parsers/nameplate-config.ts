/**
 * @file nameplate-config.ts
 * @description Parser for user nameplate configuration
 *
 * Data source: user_name_plate/user_name_plate_config_*.cfg.bin.json
 *
 * Structure (lists format):
 * - m_userNamePlateInfoList: Nameplate entries (54+ entries)
 *   Fields: userNamePlateId, userNamePlateNameId, sortNo,
 *           textureFileNameText, nameFontStyle, flagIndex, enableCond
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedNameplate extends ExportableEntity {
	nameplateId: string;
	nameTextId: string;
	sortNo: number;
	imagePath: string;
	fontStyle: string;
	flagIndex: number;
	enableCond: string;
}

export interface NameplateDatabase {
	nameplates: ParsedNameplate[];
	byId: Map<string, ParsedNameplate>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Helpers
// ============================================================================

function extractImageName(texturePath: string): string {
	return texturePath.replace("#/menu/", "").replace(".g4tx", "");
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): ParsedNameplate[] {
	const nameplates: ParsedNameplate[] = [];
	if (!content?.lists) return nameplates;

	for (const list of content.lists) {
		if (list.name === "m_userNamePlateInfoList") {
			for (const val of list.values) {
				const imgPath = extractImageName(val.textureFileNameText || "");
				nameplates.push({
					id: val.userNamePlateId,
					name: imgPath.split("/").pop() || val.userNamePlateId,
					nameplateId: val.userNamePlateId,
					nameTextId: val.userNamePlateNameId || "0x00000000",
					sortNo: val.sortNo ?? 0,
					imagePath: imgPath,
					fontStyle: val.nameFontStyle || "",
					flagIndex: val.flagIndex ?? 0,
					enableCond: val.enableCond || "",
					attributes: {
						SortNo: val.sortNo,
						Image: imgPath,
					},
				});
			}
		}
	}
	return nameplates;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadNameplateConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedNameplate[] | null> {
	const filename = findConfigFile("user_name_plate", "user_name_plate_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/user_name_plate", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildNameplateDatabase(
	dataPath: string = DATA_ROOT
): Promise<NameplateDatabase> {
	const nameplates = (await loadNameplateConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedNameplate>();
	for (const n of nameplates) byId.set(n.nameplateId, n);

	return {
		nameplates,
		byId,
		toMarkdown: (id: string) => {
			const n = byId.get(id);
			return n ? EntityExporters.toMarkdown(n, "Plaque") : null;
		},
		toReact: (id: string) => {
			const n = byId.get(id);
			return n ? EntityExporters.toReact(n) : null;
		},
	};
}
