/**
 * @file system-config.ts
 * @description Parsers for system, menu and UI gamedata
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { loadTextFile } from "./text-parser.js";

export interface ParsedMenuInfo {
	menuId: string;
	names: { en?: string; fr?: string; ja?: string };
}

export function buildMenuDatabase(dataPath: string) {
	const dir = join(dataPath, "common", "gamedata", "menu");
	const results: ParsedMenuInfo[] = [];

	if (!existsSync(dir)) return { menus: results };

	const textFr = loadTextFile("menu", "fr");
	const textJa = loadTextFile("menu", "ja");

	const files = readdirSync(dir).filter((f) => f.endsWith(".cfg.bin.json"));
	for (const file of files) {
		try {
			const content = JSON.parse(readFileSync(join(dir, file), "utf-8"));

			// Check for lists format (Menu Preset)
			if (content.lists) {
				const infoList = content.lists.find((l: any) => l.name === "m_sceneMenuPresetInfoList");
				if (infoList?.values) {
					for (const entry of infoList.values) {
						const id = entry.menuPresetType;
						const hex = id.startsWith("0x") ? id : toHex(Number(id));

						// Check if this ID maps to text
						if (textFr.has(hex)) {
							results.push({
								menuId: hex,
								names: {
									fr: textFr.get(hex),
									ja: textJa.get(hex),
								},
							});
						}
					}
				}
			} else if (content.entries) {
				// Legacy tree format
				const entries = content.entries as ConfigNode[];
				function traverse(node: ConfigNode) {
					if (node.name.includes("_INFO_") && !node.name.includes("_LIST_")) {
						const vars = node.variables;
						for (const v of vars) {
							if (v.type === "Int") {
								const hex = toHex(Number.parseInt(v.value, 10));
								if (textFr.has(hex)) {
									results.push({
										menuId: hex,
										names: {
											fr: textFr.get(hex),
											ja: textJa.get(hex),
										},
									});
									break;
								}
							}
						}
					}
					if (node.children) node.children.forEach(traverse);
				}
				entries.forEach(traverse);
			}
		} catch (_e) {
			// ignore
		}
	}

	return { menus: results };
}
