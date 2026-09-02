/**
 * @file push-star_signs.ts
 * @description Runner standalone pour peupler `inagle_star_signs` depuis le vrai
 * config `players_universe/players_universe_config` (liste
 * `m_starSignCharaInfoList`, octets réels du dump) + injection BASARA (rarity 20)
 * depuis `basara_chara_config`. La logique d'import vit dans
 * `src/push-categories.ts` (`importStarSigns`) — source UNIQUE partagée avec le
 * flux principal cli-push.ts. Ce fichier ne fait que créer l'adaptateur Supabase
 * et lancer l'importer. Upsert idempotent (ON CONFLICT chara_param_id).
 *
 * Lancement (depuis /home/ubuntu/rg) :
 *   DATA_PATH=/home/ubuntu/niers/data bun packages/inagle/scripts/push-star_signs.ts
 */

import { importStarSigns } from "../src/push-categories.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importStarSigns(null, db)
	.then(() => db.close())
	.catch((e) => {
		console.error("[push-star_signs] échec :", e);
		process.exit(1);
	});
