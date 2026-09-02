/**
 * @file pusher.ts
 * @description Pusher pour insérer ou mettre à jour les métadonnées des scripts Lua dans Supabase.
 */

import { parseLuaIndex } from "../parsers/lua";
import { type DataAdapter, dedup } from "../push-adapter";

/**
 * Importe les scripts Lua dans la table inagle_lua_scripts.
 */
export async function importLuaScripts(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Lua Scripts...");
	const parsedScripts = await parseLuaIndex();

	if (parsedScripts.length === 0) {
		console.error(
			"❌ 0 script Lua résolu — vérifier /home/ubuntu/niers/data/lua_scripts/analysis/lua-global-index.json"
		);
		return;
	}

	const rawRecords = parsedScripts.map((s) => ({
		id: s.id,
		name: s.name,
		version: s.version,
		category: s.category,
		functions: s.functions,
		calls: s.calls,
		strings: s.strings,
		crc32_numbers: s.crc32_numbers,
		hash: s.hash,
		updated_at: new Date().toISOString(),
	}));

	const records = dedup(rawRecords, "id");

	const BATCH_SIZE = 100;
	let pushed = 0;
	for (let i = 0; i < records.length; i += BATCH_SIZE) {
		const batch = records.slice(i, i + BATCH_SIZE);
		const { error } = await db.upsert("inagle_lua_scripts", batch, "id");
		if (error) {
			console.error("❌ Error batch lua scripts:", error.message || error);
		} else {
			pushed += batch.length;
		}
	}
	console.log(`✅ Lua Scripts imported (${pushed}/${records.length}).`);
}
