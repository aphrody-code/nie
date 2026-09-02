/**
 * @file performance-config.ts
 * @description Parser for soccer performance (special event) configuration
 *
 * Data source: soccer/soccer_performance_config_*.cfg.bin.json
 *
 * Structure (lists format):
 * - m_soccerPerformanceConfigList: Performance entries
 *   Fields: performanceId, eventId, eventNameTextId, textureFilePath,
 *           textureId, validCond
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedPerformance extends ExportableEntity {
	performanceId: string;
	eventId: string;
	eventNameTextId: string;
	imagePath: string;
	textureId: string;
	validCond: string;
}

export interface PerformanceDatabase {
	performances: ParsedPerformance[];
	byId: Map<string, ParsedPerformance>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Helpers
// ============================================================================

function extractImageName(texturePath: string): string {
	return texturePath.replace("#/menu/220_img/", "").replace(".g4tx", "");
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): ParsedPerformance[] {
	const performances: ParsedPerformance[] = [];
	if (!content?.lists) return performances;

	for (const list of content.lists) {
		if (list.name === "m_soccerPerformanceConfigList") {
			for (const val of list.values) {
				const imgPath = extractImageName(val.textureFilePath || "");
				performances.push({
					id: val.performanceId,
					name: val.performanceId,
					performanceId: val.performanceId,
					eventId: val.eventId || "",
					eventNameTextId: val.eventNameTextId || "0x00000000",
					imagePath: imgPath,
					textureId: val.textureId || "",
					validCond: val.validCond || "",
					attributes: {
						Event: val.eventId,
						Image: imgPath,
					},
				});
			}
		}
	}
	return performances;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadPerformanceConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedPerformance[] | null> {
	const filename = findConfigFile("soccer", "soccer_performance_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/soccer", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildPerformanceDatabase(
	dataPath: string = DATA_ROOT
): Promise<PerformanceDatabase> {
	const performances = (await loadPerformanceConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedPerformance>();
	for (const p of performances) byId.set(p.performanceId, p);

	return {
		performances,
		byId,
		toMarkdown: (id: string) => {
			const p = byId.get(id);
			return p ? EntityExporters.toMarkdown(p, "Performance") : null;
		},
		toReact: (id: string) => {
			const p = byId.get(id);
			return p ? EntityExporters.toReact(p) : null;
		},
	};
}
