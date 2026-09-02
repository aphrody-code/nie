/**
 * @file phase-title-config.ts
 * @description Parser for phase/chapter title images configuration
 *
 * Data source: phase/phase_title_config_*.cfg.bin.json
 *
 * Structure (entries format):
 * - PHASE_TITLE_TEX_INFO_*: Chapter title images
 *   Variables: [phaseId (Int), textureId (Int), texturePath (String)]
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedPhaseTitle extends ExportableEntity {
	phaseId: string;
	textureId: string;
	imagePath: string;
}

export interface PhaseTitleDatabase {
	titles: ParsedPhaseTitle[];
	byId: Map<string, ParsedPhaseTitle>;
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
	return texturePath.replace("#/menu/220_img/", "").replace("<LG>/", "fr/").replace(".g4tx", "");
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): ParsedPhaseTitle[] {
	const titles: ParsedPhaseTitle[] = [];
	if (!content?.entries) return titles;

	for (const entry of content.entries) {
		if (!entry.name?.startsWith("PHASE_TITLE_TEX_INFO_LIST_BEG_")) continue;

		for (const child of entry.children || []) {
			if (!child.name?.startsWith("PHASE_TITLE_TEX_INFO_")) continue;

			const vars = child.variables || [];
			if (vars.length < 3) continue;

			const phaseId = toHex(parseInt(vars[0].value, 10));
			const textureId = toHex(parseInt(vars[1].value, 10));
			const rawPath = vars[2]?.value || "";
			const imagePath = extractImageName(rawPath);

			titles.push({
				id: phaseId,
				name: imagePath.split("/").pop() || phaseId,
				phaseId,
				textureId,
				imagePath,
				attributes: {
					Image: imagePath,
				},
			});
		}
	}
	return titles;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadPhaseTitleConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedPhaseTitle[] | null> {
	const filename = findConfigFile("phase", "phase_title_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/phase", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildPhaseTitleDatabase(
	dataPath: string = DATA_ROOT
): Promise<PhaseTitleDatabase> {
	const titles = (await loadPhaseTitleConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedPhaseTitle>();
	for (const t of titles) byId.set(t.phaseId, t);

	return {
		titles,
		byId,
		toMarkdown: (id: string) => {
			const t = byId.get(id);
			return t ? EntityExporters.toMarkdown(t, "Chapitre") : null;
		},
		toReact: (id: string) => {
			const t = byId.get(id);
			return t ? EntityExporters.toReact(t) : null;
		},
	};
}
