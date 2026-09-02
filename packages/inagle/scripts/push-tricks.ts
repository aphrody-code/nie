/**
 * @file push-tricks.ts
 * @description Runner standalone pour peupler `inagle_tricks` depuis le vrai
 * config `trick_config` (octets réels du dump). La logique d'import vit dans
 * `src/push-categories.ts` (`importTricks`) — source UNIQUE partagée avec le
 * flux principal cli-push.ts. Upsert idempotent (ON CONFLICT id = trickID hex).
 *
 * Usage (depuis /home/ubuntu/rg) :
 *   bun packages/inagle/scripts/push-tricks.ts
 */

import { importTricks } from "../src/push-categories.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importTricks(null, db)
	.then(() => db.close())
	.catch((e) => {
		console.error("❌ Erreur push-tricks:", e);
		process.exit(1);
	});
