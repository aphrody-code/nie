/**
 * @file push-missions.ts
 * @description Runner standalone pour peupler `inagle_missions` depuis le vrai
 * config `common/gamedata/mission/mission_config_*.cfg.bin.json` (octets réels du
 * dump). La logique d'import vit dans `src/push-categories.ts` (`importMissions`)
 * — source UNIQUE partagée avec le flux principal cli-push.ts. Ce fichier ne fait
 * que créer l'adaptateur Supabase et lancer l'importer. Upsert idempotent
 * (ON CONFLICT mission_id).
 *
 * Lancement (depuis /home/ubuntu/rg) :
 *   DATA_PATH=/home/ubuntu/niers/data bun packages/inagle/scripts/push-missions.ts
 */

import { importMissions } from "../src/push-categories.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importMissions(null, db)
	.then(() => db.close())
	.catch((e) => {
		console.error("Erreur fatale push-missions:", e);
		process.exit(1);
	});
