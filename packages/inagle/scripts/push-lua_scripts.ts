/**
 * @file push-lua_scripts.ts
 * @description Runner standalone pour peupler `inagle_lua_scripts` depuis l'index
 * global des scripts Lua décompilés.
 *
 * Exécution : `bun packages/inagle/scripts/push-lua_scripts.ts` (depuis /home/ubuntu/rg).
 */

import { importLuaScripts } from "../src/lua/pusher.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importLuaScripts(null, db)
	.then(() => db.close())
	.catch((err) => {
		console.error("Erreur fatale push-lua_scripts:", err);
		process.exit(1);
	});
