/**
 * @file push-team_build.ts
 * @description Runner standalone pour peupler `inagle_team_build` depuis le vrai
 * config `skill/team_build_config_*.cfg.bin.json` (octets réels du dump, DLC
 * Orion — système Team Build). La logique d'import vit dans
 * `src/push-categories.ts` (`importTeamBuild`) — source UNIQUE partagée avec le
 * flux principal cli-push.ts. Ce fichier ne fait que créer l'adaptateur Supabase
 * et lancer l'importer. Upsert idempotent (ON CONFLICT id = "<section>:<index>").
 *
 * Lancement (depuis /home/ubuntu/rg) :
 *   bun packages/inagle/scripts/push-team_build.ts
 */

import { importTeamBuild } from "../src/push-categories.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importTeamBuild(null, db)
	.then(() => db.close())
	.catch((e) => {
		console.error("Erreur fatale push-team_build:", e);
		process.exit(1);
	});
