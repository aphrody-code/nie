import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "../core/paths.js";
import type { ZukanItem } from "../zukan/types.js";

let zukanItemCache: Map<string, ZukanItem> | null = null;

export function loadZukanItems(): Map<string, ZukanItem> {
	if (zukanItemCache) return zukanItemCache;

	zukanItemCache = new Map();
	const path = join(DATA_ROOT, "zukan/db_items.json");

	if (!existsSync(path)) {
		return zukanItemCache;
	}

	try {
		const content = readFileSync(path, "utf-8");
		const data = JSON.parse(content) as ZukanItem[];

		for (const item of data) {
			zukanItemCache.set(item.id, item);
		}
	} catch (e) {
		console.error("[ZukanLoader] Failed to parse db_items.json", e);
	}

	return zukanItemCache;
}
