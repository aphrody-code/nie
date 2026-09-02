/**
 * @file lua.ts
 * @description Parser pour l'index global des scripts Lua decompilés et analysés.
 *
 * Source: /home/ubuntu/niers/data/lua_scripts/analysis/lua-global-index.json
 */

import { join } from "node:path";
import { existsSync } from "node:fs";

export interface LuaScriptRaw {
	file: string;
	tier: string;
	lines: number;
	functions: string[];
	calls: Record<string, number>;
	strings: string[];
	crc32Numbers: string[];
	engineCalls: string[];
	tableAccess: string[];
}

export interface ParsedLuaScript {
	id: string;
	name: string;
	version: string | null;
	category: string;
	functions: string[];
	calls: Record<string, number>;
	strings: string[];
	crc32_numbers: string[];
	hash: string | null;
}

/**
 * Calcule le hash SHA-256 d'un fichier.
 */
export async function computeSHA256(filePath: string): Promise<string | null> {
	try {
		const file = Bun.file(filePath);
		if (!(await file.exists())) return null;
		const arr = await file.arrayBuffer();
		const hashBuffer = await crypto.subtle.digest("SHA-256", arr);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	} catch {
		return null;
	}
}

/**
 * Résout le chemin absolu du script Lua en fonction de son tier.
 */
export function resolveLuaScriptPath(file: string, tier: string): string | null {
	const baseDir = "/home/ubuntu/niers/data/lua_scripts/decompiled";
	if (tier && tier !== "root") {
		const path = join(baseDir, tier, file);
		if (existsSync(path)) return path;
	}
	const rootPath = join(baseDir, file);
	if (existsSync(rootPath)) return rootPath;
	return null;
}

/**
 * Charge et parse l'index global des scripts Lua.
 */
export async function parseLuaIndex(
	indexPath = "/home/ubuntu/niers/data/lua_scripts/analysis/lua-global-index.json"
): Promise<ParsedLuaScript[]> {
	const file = Bun.file(indexPath);
	if (!(await file.exists())) {
		console.warn(`[LuaParser] Index file not found at ${indexPath}`);
		return [];
	}

	const data = await file.json();
	const files: LuaScriptRaw[] = data.files || [];
	const results: ParsedLuaScript[] = [];

	for (const f of files) {
		// Regex pour extraire le nom et la version
		// ex: chara_bank_menu_5.00.27.00.lua -> name: chara_bank_menu, version: 5.00.27.00
		// ex: chara_edit_parts_menu_mouse.lua -> name: chara_edit_parts_menu_mouse, version: null
		const match = f.file.match(/^(.*?)(?:_(\d+(?:\.\d+)*))?\.lua$/);
		const name = match ? match[1] : f.file.replace(/\.lua$/, "");
		const version = match && match[2] ? match[2] : null;

		// Résolution de la catégorie (p0, p1, p2, root)
		let category = "p2";
		if (f.tier === "p0-critical") category = "p0";
		else if (f.tier === "p1-gameplay") category = "p1";
		else if (f.tier === "p2-other") category = "p2";
		else if (f.tier === "root") category = "root";

		// Calcul du hash du fichier réel de script décompilé
		const realPath = resolveLuaScriptPath(f.file, f.tier);
		const hash = realPath ? await computeSHA256(realPath) : null;

		results.push({
			id: f.file,
			name,
			version,
			category,
			functions: f.functions || [],
			calls: f.calls || {},
			strings: f.strings || [],
			crc32_numbers: f.crc32Numbers || [],
			hash,
		});
	}

	return results;
}
