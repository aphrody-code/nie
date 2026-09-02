/**
 * @file push-drop_rates.ts
 * @description Runner standalone pour peupler `inagle_drop_rates` depuis les
 * VRAIS taux de drop (poids de loterie) du dump IEVR — trois configs jamais
 * matérialisés en DB jusqu'ici :
 *
 *   - item_emission : par item × rareté d'émission (item_emission_rarity_table_config)
 *   - spirit_drop   : tirage d'esprit par (table × dropRarity × rarity) (soccer_drop_config)
 *   - win_treasure  : coffres de victoire, par coffre × item (win_treasure_lot_table_config)
 *
 * Chaque ligne = un octet réel du config (anti-hallucination, rien fabriqué).
 * Upsert idempotent (ON CONFLICT id = `<source>:<ordinal>` déterministe).
 *
 * Lancement (depuis /home/ubuntu/rg) :
 *   DATA_PATH=/home/ubuntu/niers/data bun packages/inagle/scripts/push-drop_rates.ts
 */

import { loadAllDropRates } from "../src/parsers/drop-rates.ts";
import { createSupabaseAdapter } from "../src/push-adapter.ts";

const rows = loadAllDropRates();

const records = rows.map((r) => ({
	id: r.id,
	source: r.source,
	source_id: r.sourceId,
	item_id: r.itemId,
	rarity: r.rarity,
	drop_rarity: r.dropRarity,
	weight: r.weight,
}));

const bySource = records.reduce<Record<string, number>>((acc, r) => {
	acc[r.source] = (acc[r.source] ?? 0) + 1;
	return acc;
}, {});
console.log(
	`[push-drop_rates] ${records.length} lignes de taux :`,
	JSON.stringify(bySource)
);

if (records.length === 0) {
	console.error("[push-drop_rates] AUCUNE ligne — configs absents ? Abandon (rien à pousser).");
	process.exit(1);
}

const db = createSupabaseAdapter();
const { error } = await db.upsert("inagle_drop_rates", records, "id");
await db.close();

if (error) {
	console.error("[push-drop_rates] échec upsert :", error);
	process.exit(1);
}
console.log(`[push-drop_rates] OK — ${records.length} taux poussés dans inagle_drop_rates.`);
