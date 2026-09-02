/**
 * @file chara-menu-resource-config.ts
 * @description Parser for character menu resource path templates
 *
 * Data source: menu/chara_menu_resource_*.cfg.bin.json
 *
 * This config defines how character icon paths are resolved:
 * - INFO_0: Default path templates with <charaID> and <skillID> placeholders
 * - INFO_1+: Per-character overrides with specific file paths
 *
 * Covers: 200_icon/10_icon_chr (face, uniform, coach, aura_fs, aura_armed,
 *         aura_mixi, aura_soul), 220_img/soul_effect
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface CharaResourceTemplate {
	/** Template paths with <charaID> / <skillID> placeholders */
	faceSmall: string;
	faceLarge: string;
	miniChr: string;
	winIcon: string;
	coachSmall: string;
	coachLarge: string;
	auraFsSmall: string;
	auraFsLarge: string;
	auraArmedSmall: string;
	auraArmedLarge: string;
	auraMixiSmall: string;
	auraMixiLarge: string;
	auraSoulSmall: string;
	auraSoulLarge: string;
	soulEffect: string;
}

export interface ParsedCharaResource extends ExportableEntity {
	resourceId: string;
	isTemplate: boolean;
	paths: Partial<CharaResourceTemplate>;
}

export interface CharaMenuResourceDatabase {
	basePath: string;
	template: CharaResourceTemplate | null;
	overrides: ParsedCharaResource[];
	byId: Map<string, ParsedCharaResource>;
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

function cleanPath(val: string): string {
	return val.replace(".g4tx", "");
}

/** Extract string paths from variables array, skipping Int values */
function extractPaths(vars: any[]): string[] {
	return vars
		.filter((v: any) => v.type === "String" && typeof v.value === "string")
		.map((v: any) => cleanPath(v.value));
}

// ============================================================================
// Parser
// ============================================================================

const PATH_FIELDS: (keyof CharaResourceTemplate)[] = [
	"faceSmall",
	"faceLarge",
	"miniChr",
	"winIcon",
	"coachSmall",
	"coachLarge",
	"auraFsSmall",
	"auraFsLarge",
	"auraArmedSmall",
	"auraArmedLarge",
	"auraMixiSmall",
	"auraMixiLarge",
	"auraSoulSmall",
	"auraSoulLarge",
	"soulEffect",
];

function parseContent(content: any): {
	basePath: string;
	template: CharaResourceTemplate | null;
	overrides: ParsedCharaResource[];
} {
	let basePath = "";
	let template: CharaResourceTemplate | null = null;
	const overrides: ParsedCharaResource[] = [];

	if (!content?.entries) return { basePath, template, overrides };

	for (const entry of content.entries) {
		// Base path
		if (entry.name === "CHARA_MENU_RESOURCE_BASE_PATH_LIST_BEG_0") {
			for (const child of entry.children || []) {
				const strVar = child.variables?.find((v: any) => v.type === "String");
				if (strVar) basePath = strVar.value;
			}
		}

		// Resource info entries
		if (entry.name === "CHARA_MENU_RESOURCE_INFO_LIST_BEG_0") {
			for (let i = 0; i < (entry.children || []).length; i++) {
				const child = entry.children[i];
				const vars = child.variables || [];
				const paths = extractPaths(vars);

				// First Int is the resource ID
				const idVar = vars.find((v: any) => v.type === "Int");
				const resourceId = idVar ? toHex(parseInt(idVar.value, 10)) : `INFO_${i}`;

				const isTemplate = paths.some(
					(p: string) => p.includes("<charaID>") || p.includes("<skillID>")
				);

				const pathMap: Partial<CharaResourceTemplate> = {};
				for (let j = 0; j < Math.min(paths.length, PATH_FIELDS.length); j++) {
					pathMap[PATH_FIELDS[j]] = paths[j];
				}

				if (i === 0 && isTemplate) {
					template = pathMap as CharaResourceTemplate;
				} else {
					overrides.push({
						id: resourceId,
						name: resourceId,
						resourceId,
						isTemplate,
						paths: pathMap,
						attributes: {
							Face: pathMap.faceSmall || "",
							Coach: pathMap.coachSmall || "",
						},
					});
				}
			}
		}
	}

	return { basePath, template, overrides };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadCharaMenuResourceConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ReturnType<typeof parseContent> | null> {
	const path = join(dataPath, "common/gamedata/menu/chara_menu_resource_0.00.00.cfg.bin.json");
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildCharaMenuResourceDatabase(
	dataPath: string = DATA_ROOT
): Promise<CharaMenuResourceDatabase> {
	const result = await loadCharaMenuResourceConfigAsync(dataPath);
	const basePath = result?.basePath || "#/menu/";
	const template = result?.template || null;
	const overrides = result?.overrides || [];

	const byId = new Map<string, ParsedCharaResource>();
	for (const o of overrides) byId.set(o.resourceId, o);

	return {
		basePath,
		template,
		overrides,
		byId,
		toMarkdown: (id: string) => {
			const o = byId.get(id);
			return o ? EntityExporters.toMarkdown(o, "CharaResource") : null;
		},
		toReact: (id: string) => {
			const o = byId.get(id);
			return o ? EntityExporters.toReact(o) : null;
		},
	};
}
