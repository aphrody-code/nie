/**
 * @file push-special_tactics.ts
 * @description Runner standalone pour peupler `inagle_special_tactics` depuis le
 * VRAI config (skill/special_tactics_config_*.cfg.bin.json) + textes item/*. La
 * logique d'import vit dans `src/push-categories.ts` (`importSpecialTactics`) —
 * source UNIQUE partagée avec le flux principal cli-push.ts. Upsert idempotent
 * (ON CONFLICT id = tacticsId hex).
 *
 * Lancer (depuis /home/ubuntu/rg) :
 *   bun packages/inagle/scripts/push-special_tactics.ts
 */

import { importSpecialTactics } from "../src/push-categories.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const db = createSupabaseAdapter();
await importSpecialTactics(null, db)
	.then(() => db.close())
	.catch((e) => {
		console.error("❌ push:special_tactics échec :", e);
		process.exit(1);
	});
