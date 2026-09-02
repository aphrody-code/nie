/**
 * @file push-super_tactics.ts
 * @description Runner standalone pour peupler `inagle_super_tactics` depuis le
 * VRAI config de base (skill/super_tactics_config_*.cfg.bin.json). La logique
 * d'import vit dans `src/push-categories.ts` (`importSuperTactics`) — source
 * UNIQUE partagée avec le flux principal cli-push.ts. Ce fichier ne fait que
 * créer l'adaptateur Supabase et lancer l'importer. Upsert idempotent
 * (ON CONFLICT id = "<kind>:<idx>").
 *
 * Lancement (depuis /home/ubuntu/rg) :
 *   DATA_PATH=/home/ubuntu/niers/data bun packages/inagle/scripts/push-super_tactics.ts
 */

import { importSuperTactics } from "../src/push-categories.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importSuperTactics(null, db)
	.then(() => db.close())
	.catch((e) => {
		console.error("push:super_tactics échec :", e);
		process.exit(1);
	});
