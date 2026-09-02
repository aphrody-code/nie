import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PATHS } from "../core/paths.js";
import type { MenuEntry } from "./explorer.js";

// Path resolution for menu maps
// Now located in packages/inagle/data/menu-maps
const MAPS_DIR = join(PATHS.root, "menu-maps");
const LOCAL_MAPS_DIR = resolve("data/menu-maps");

export function loadMenuMap(mapId: string): MenuMap | null {
	const filename = `${mapId}.json`;
	const filePath = existsSync(join(LOCAL_MAPS_DIR, filename))
		? join(LOCAL_MAPS_DIR, filename)
		: join(MAPS_DIR, filename);

	if (!existsSync(filePath)) {
		return null;
	}

	try {
		const content = readFileSync(filePath, "utf-8");
		return JSON.parse(content) as MenuMap;
	} catch {
		return null;
	}
}

export interface MenuMap {
	name: string;
	generatedAt: string;
	totalFiles: number;
	files: {
		path: string;
		name: string;
		size?: number;
		extension?: string;
	}[];
}

/**
 * Load all pre-generated menu maps
 */
export function loadMenuMaps(dirPath?: string): MenuEntry[] {
	const targetDir = dirPath || (existsSync(LOCAL_MAPS_DIR) ? LOCAL_MAPS_DIR : MAPS_DIR);

	if (!existsSync(targetDir)) {
		// console.warn(`[MenuMaps] Maps directory not found: ${targetDir}`);
		return [];
	}

	const allEntries: MenuEntry[] = [];

	try {
		const files = readdirSync(targetDir).filter((f) => f.endsWith(".json"));

		for (const file of files) {
			try {
				const content = readFileSync(join(targetDir, file), "utf-8");
				const map = JSON.parse(content) as MenuMap;

				// Convert to MenuEntry format
				for (const f of map.files) {
					allEntries.push({
						name: f.name,
						path: f.path, // Relative to menu root (e.g. 00_soccer/...)
						type: "file",
						size: f.size,
						extension: f.extension,
					});
				}
			} catch (e) {
				console.error(`[MenuMaps] Failed to load map ${file}`, e);
			}
		}
	} catch (e) {
		console.error("[MenuMaps] Failed to read maps directory", e);
	}

	return allEntries;
}

/**
 * Check if maps are available
 */
export function hasMenuMaps(): boolean {
	return existsSync(LOCAL_MAPS_DIR) || existsSync(MAPS_DIR);
}
