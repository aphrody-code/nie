/**
 * @file gameplay-config.ts
 * @description Parsers for various gameplay-related gamedata categories
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { loadTextFile } from "./text-parser.js";

// ============================================================================
// VsRoute (Competition Routes)
// ============================================================================

export interface ParsedVsRoute {
	routeId: string;
	names: { en?: string; fr?: string; ja?: string };
	nodes: any[];
}

export function buildVsRouteDatabase(dataPath: string) {
	const dir = join(dataPath, "common", "gamedata", "vsroute");
	const results: ParsedVsRoute[] = [];

	if (!existsSync(dir)) return { vsRoutes: results };

	const textFr = loadTextFile("quest_title", "fr"); // VsRoutes often share quest text
	const textJa = loadTextFile("quest_title", "ja");

	const files = readdirSync(dir).filter((f) => f.endsWith(".cfg.bin.json"));
	for (const file of files) {
		try {
			const content = JSON.parse(readFileSync(join(dir, file), "utf-8"));

			// Check for flat list format
			if (content.lists) {
				const infoList = content.lists.find((l: any) => l.name === "m_chronicleVsRouteInfoList");
				if (infoList?.values) {
					for (const entry of infoList.values) {
						const id = entry.id;
						// Use ID itself as name hash for now as name is not explicit in this list
						// Often the ID maps to a text ID in another file or same file
						const idHex = id.startsWith("0x") ? id : toHex(Number(id));

						// Try to find name in text map using ID
						if (textFr.has(idHex)) {
							results.push({
								routeId: idHex,
								names: {
									fr: textFr.get(idHex),
									ja: textJa.get(idHex),
								},
								nodes: [],
							});
						}
					}
				}
			} else if (content.entries) {
				const entries = content.entries as ConfigNode[];
				function traverse(node: ConfigNode) {
					if (node.name.startsWith("VS_ROUTE_INFO_") && !node.name.includes("_LIST_")) {
						const vars = node.variables;
						if (vars.length >= 2) {
							const idInt = Number.parseInt(vars[0].value, 10) >>> 0;
							const nameHashInt = Number.parseInt(vars[1].value, 10) >>> 0;

							const idHex = toHex(idInt);
							const nameHashHex = toHex(nameHashInt);

							results.push({
								routeId: idHex,
								names: {
									fr: textFr.get(nameHashHex),
									ja: textJa.get(nameHashHex),
								},
								nodes: [],
							});
						}
					}
					if (node.children) node.children.forEach(traverse);
				}
				entries.forEach(traverse);
			}
		} catch (e) {
			console.error(`[VsRouteParser] Failed to parse ${file}`, e);
		}
	}

	return { vsRoutes: results };
}

// ============================================================================
// Crafting (Kizuna Link / Craft)
// ============================================================================

export interface ParsedCraft {
	craftId: string;
	targetItemId: string;
	materials: { itemId: string; count: number }[];
}

export function buildCraftDatabase(dataPath: string) {
	const dir = join(dataPath, "common", "gamedata", "craft");
	const results: ParsedCraft[] = [];

	if (!existsSync(dir)) return { crafts: results };

	const files = readdirSync(dir).filter((f) => f.endsWith(".cfg.bin.json"));
	for (const file of files) {
		try {
			const content = JSON.parse(readFileSync(join(dir, file), "utf-8"));
			const entries = content.entries as ConfigNode[];

			function traverse(node: ConfigNode) {
				// CRAFT_OBJ_INFO_0
				if (
					node.name.startsWith("CRAFT_OBJ_INFO_") &&
					!node.name.includes("_LIST_") &&
					!node.name.includes("_REF_")
				) {
					const vars = node.variables;
					if (vars.length >= 2) {
						const craftId = toHex(Number.parseInt(vars[0].value, 10));
						// Based on typical structure: [0]=ID, [1]=Type?, [2]=?, [3]=?, [4]=TargetItemID?
						// This needs precise mapping. Let's assume [0] is ID.
						// We will just store raw for now or minimal info.

						results.push({
							craftId,
							targetItemId: toHex(0), // Placeholder until we map fields
							materials: [],
						});
					}
				}
				if (node.children) node.children.forEach(traverse);
			}
			entries.forEach(traverse);
		} catch (e) {
			console.error(`[CraftParser] Failed to parse ${file}`, e);
		}
	}

	return { crafts: results };
}

// ============================================================================
// Event / Phase
// ============================================================================

export interface ParsedEvent {
	eventId: string;
	code: string;
}

export function buildEventDatabase(dataPath: string) {
	const dir = join(dataPath, "common", "gamedata", "event");
	const results: ParsedEvent[] = [];

	if (!existsSync(dir)) return { events: results };

	const files = readdirSync(dir).filter((f) => f.endsWith(".cfg.bin.json"));
	for (const file of files) {
		try {
			const _content = JSON.parse(readFileSync(join(dir, file), "utf-8"));
			// Events have very diverse structures.
			// We just want to extract IDs if possible.
			// For now, let's skip complex parsing to avoid noise.
		} catch {
			// Silence
		}
	}

	return { events: results };
}
