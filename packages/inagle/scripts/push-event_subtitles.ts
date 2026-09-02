/**
 * @file push-event_subtitles.ts
 * @description Runner standalone qui peuple `inagle_events` (agrégat de
 * couverture) + `inagle_event_subtitles` (sous-titres timecodés atomiques)
 * depuis le vrai dump IEVR. La logique de parsing vit dans
 * `src/parsers/event-subtitles.ts` (octets réels). Upsert idempotent.
 *
 * Cible = Supabase (où vivent les autres `inagle_*`). On force l'adaptateur
 * Supabase REST via `SupabaseAdapter` + `resolveSupabaseClient()` au lieu de
 * `createSupabaseAdapter()` : ce dernier route vers `DATABASE_URL` quand il est
 * défini, qui pointe ici sur Neon (mauvaise cible).
 *
 * Lancement (depuis /home/ubuntu/rg) :
 *   DATA_PATH=/home/ubuntu/data bun packages/inagle/scripts/push-event_subtitles.ts
 */

import { SupabaseAdapter, resolveSupabaseClient } from "../src/push-adapter.ts";
import { parseAllEventAggregates, parseAllEventSubtitles } from "../src/parsers/event-subtitles.ts";

const SUPABASE_MAX_ROWS = 500; // batch upsert REST (évite payloads trop gros)

async function upsertChunked(
	db: SupabaseAdapter,
	table: string,
	records: any[],
	onConflict: string
): Promise<void> {
	for (let i = 0; i < records.length; i += SUPABASE_MAX_ROWS) {
		const chunk = records.slice(i, i + SUPABASE_MAX_ROWS);
		const { error } = await db.upsert(table, chunk, onConflict);
		if (error) {
			throw new Error(`upsert ${table} [${i}..${i + chunk.length}] : ${error.message ?? JSON.stringify(error)}`);
		}
		console.log(`  ✓ ${table} : ${Math.min(i + chunk.length, records.length)}/${records.length}`);
	}
}

async function main() {
	const db = new SupabaseAdapter(resolveSupabaseClient());

	console.log("→ parsing agrégats event…");
	const aggregates = parseAllEventAggregates();
	const eventRows = aggregates.map((a) => ({
		event_id: a.event_id,
		episode: a.episode,
		has_subtitle: a.has_subtitle,
		subtitle_langs: a.subtitle_langs,
		dialogue_langs: a.dialogue_langs,
		subtitle_rows: a.subtitle_rows,
		line_count: a.line_count,
		has_map: a.has_map,
		data: null,
	}));
	console.log(`  events agrégés : ${eventRows.length}`);

	console.log("→ parsing sous-titres timecodés…");
	const subtitles = parseAllEventSubtitles();
	const subtitleRows = subtitles.map((s) => ({
		event_id: s.event_id,
		episode: s.episode,
		line_index: s.line_index,
		text_hash: s.text_hash,
		text_hash_u: s.text_hash_u,
		show_start: s.show_start,
		show_end: s.show_end,
		t3: s.t3,
		t4: s.t4,
		subtitle_langs: s.subtitle_langs,
		line_label: s.line_label,
		lip_sync: s.lip_sync,
		text_ja: s.text_ja,
		text_en: s.text_en,
		text_fr: s.text_fr,
		data: null,
	}));
	const distinctEvents = new Set(subtitles.map((s) => s.event_id)).size;
	console.log(`  lignes de sous-titres : ${subtitleRows.length} sur ${distinctEvents} events voicés`);

	console.log("→ upsert inagle_events…");
	await upsertChunked(db, "inagle_events", eventRows, "event_id");

	console.log("→ upsert inagle_event_subtitles…");
	await upsertChunked(db, "inagle_event_subtitles", subtitleRows, "event_id,line_index");

	console.log(`✓ Terminé : ${eventRows.length} events, ${subtitleRows.length} sous-titres.`);
	await db.close();
}

main().catch((e) => {
	console.error("❌ Erreur push-event_subtitles:", e);
	process.exit(1);
});
