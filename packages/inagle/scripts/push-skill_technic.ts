/**
 * @file push-skill_technic.ts
 * @description Runner standalone pour peupler `inagle_skill_technic` depuis le
 * vrai config `skill/skill_technic_config` (octets réels du dump). La logique
 * d'import vit dans `src/push-categories.ts` (`importSkillTechnic`) — source
 * UNIQUE partagée avec le flux principal cli-push.ts. Ce fichier ne fait que
 * créer l'adaptateur Supabase et lancer l'importer. Upsert idempotent
 * (ON CONFLICT id = hash hex du technic).
 *
 * Lancement (depuis /home/ubuntu/rg) :
 *   DATA_PATH=/home/ubuntu/niers/data bun packages/inagle/scripts/push-skill_technic.ts
 */

import { importSkillTechnic } from "../src/push-categories.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importSkillTechnic(null, db)
	.then(() => db.close())
	.catch((e) => {
		console.error("Erreur fatale push-skill_technic:", e);
		process.exit(1);
	});
