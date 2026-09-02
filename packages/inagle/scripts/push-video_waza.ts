/**
 * @file push-video_waza.ts
 * @description Runner standalone pour peupler `inagle_video_waza` depuis le vrai
 * config event_movie_config (octets réels du dump). La logique d'import vit dans
 * `src/push-categories.ts` (`importVideoWaza`) — source UNIQUE partagée avec le
 * flux principal cli-push.ts. Upsert idempotent (ON CONFLICT id = eventId hex).
 *
 * Exécution (depuis /home/ubuntu/rg) :
 *   bun packages/inagle/scripts/push-video_waza.ts
 */

import { importVideoWaza } from "../src/push-categories.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importVideoWaza(null, db)
	.then(() => db.close())
	.catch((e) => {
		console.error("❌ Erreur push-video_waza:", e);
		process.exit(1);
	});
