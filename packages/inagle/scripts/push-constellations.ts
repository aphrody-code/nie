/**
 * @file push-constellations.ts
 * @description Runner standalone pour peupler `inagle_constellations` depuis le
 * vrai config Players Universe (`players_universe_config_*.cfg.bin.json`, octets
 * réels du dump). La logique d'import vit dans `src/push-categories.ts`
 * (`importConstellations`) — source UNIQUE partagée avec le flux principal
 * cli-push.ts. Grain = la constellation (signe astral) elle-même (30 entités),
 * distinct de `inagle_star_signs` (pool de persos drop par signe). Ce fichier ne
 * fait que créer l'adaptateur Supabase et lancer l'importer. Upsert idempotent
 * (ON CONFLICT id = starNameHash hex).
 *
 * Lancement (depuis /home/ubuntu/rg) :
 *   DATA_PATH=/home/ubuntu/niers/data bun packages/inagle/scripts/push-constellations.ts
 */

import { importConstellations } from "../src/push-categories.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importConstellations(null, db)
	.then(() => db.close())
	.catch((e) => {
		console.error("[push-constellations] échec :", e);
		process.exit(1);
	});
