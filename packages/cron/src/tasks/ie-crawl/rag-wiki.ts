/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Ingestion du corpus Wiki IEVR (cœur Azalée) dans le RAG pgvector
// `inagle_rag_chunks` : personnages (Zukan officiel) + techniques.
// Source de vérité = Supabase (`inagle_characters` / `inagle_skills`), identique
// au mirror SQLite read-only servi par Azalée.
//
// Une ligne = une entité = un chunk (kind=sqlite, cf. UNIFIED-RAG-PLAN §4.1),
// texte FR-first enrichi (noms multilingues, poste/catégorie, élément, stats,
// description). IDEMPOTENT : upsert par id stable (`chara-<id>` / `skill-<id>`)
// via `ingestSources` → re-run sûr, pas de doublon. Réutilise STRICTEMENT le
// pipeline embed/store existant (backend sidecar → OpenAI → hash 1024-dim), donc
// cohérent avec les chunks déjà présents (tweets, json, doc…).
//
// Aucune PII : données de jeu publiques (personnages/techniques), pas de membres.

import { createSupabaseServiceClient } from "@rosegriffon/db/service";
import { ingestSources, type RagSource } from "./rag-store-local";

const PAGE_SIZE = 1000;
const BATCH = 64;

interface CharRow {
	id: string;
	name_fr: string | null;
	name_en: string | null;
	name_ja: string | null;
	position: string | null;
	element: string | null;
	gender: string | null;
	rarity_label: string | null;
	series: string | null;
	zukan_order: number | null;
	description_fr: string | null;
	description_en: string | null;
	stat_frappe: number | null;
	stat_controle: number | null;
	stat_technique: number | null;
	stat_pression: number | null;
	stat_physique: number | null;
	stat_agilite: number | null;
	stat_intelligence: number | null;
	stat_total: number | null;
}

interface SkillRow {
	id: string;
	name_fr: string | null;
	name_en: string | null;
	name_ja: string | null;
	category: string | null;
	element: string | null;
	power_min: number | null;
	power_max: number | null;
	tp_cost: number | null;
	tension_cost: number | null;
	is_hyper: boolean | null;
	evolution_type: string | null;
	description_fr: string | null;
	description_en: string | null;
}

const CHAR_COLUMNS = [
	"id", "name_fr", "name_en", "name_ja", "position", "element", "gender",
	"rarity_label", "series", "zukan_order", "description_fr", "description_en",
	"stat_frappe", "stat_controle", "stat_technique", "stat_pression",
	"stat_physique", "stat_agilite", "stat_intelligence", "stat_total",
].join(",");

const SKILL_COLUMNS = [
	"id", "name_fr", "name_en", "name_ja", "category", "element",
	"power_min", "power_max", "tp_cost", "tension_cost", "is_hyper",
	"evolution_type", "description_fr", "description_en",
].join(",");

const STAT_LABELS: ReadonlyArray<[keyof CharRow, string]> = [
	["stat_frappe", "Frappe"],
	["stat_controle", "Contrôle"],
	["stat_technique", "Technique"],
	["stat_pression", "Pression"],
	["stat_physique", "Physique"],
	["stat_agilite", "Agilité"],
	["stat_intelligence", "Intelligence"],
];

/** Texte FR-first enrichi d'un personnage (une entité = un chunk). */
function buildCharText(c: CharRow): string {
	const names = [c.name_fr, c.name_en, c.name_ja].filter(Boolean).join(" / ");
	const desc = c.description_fr || c.description_en || "";
	const statLine = STAT_LABELS.map(([key, label]) => {
		const v = c[key];
		return typeof v === "number" && v > 0 ? `${label} ${v}` : null;
	})
		.filter(Boolean)
		.join(", ");

	return [
		`Personnage: ${names || "?"}`,
		`Poste: ${c.position || "?"}`,
		`Élément: ${c.element || "?"}`,
		`Genre: ${c.gender || "?"}`,
		`Rareté: ${c.rarity_label || "?"}`,
		`Série: ${c.series || "?"}`,
		`N° Zukan: ${c.zukan_order ?? "?"}`,
		statLine
			? `Stats: ${statLine}${typeof c.stat_total === "number" && c.stat_total > 0 ? ` (Total ${c.stat_total})` : ""}`
			: null,
		desc ? `Description: ${desc.replace(/\s+/g, " ").trim()}` : null,
	]
		.filter(Boolean)
		.join("\n");
}

/** Texte FR-first enrichi d'une technique (une entité = un chunk). */
function buildSkillText(s: SkillRow): string {
	const names = [s.name_fr, s.name_en, s.name_ja].filter(Boolean).join(" / ");
	const desc = s.description_fr || s.description_en || "";
	const power =
		typeof s.power_min === "number" || typeof s.power_max === "number"
			? `Puissance: ${s.power_min ?? "?"}–${s.power_max ?? "?"}`
			: null;
	const cost =
		typeof s.tp_cost === "number"
			? `Coût TP: ${s.tp_cost}`
			: typeof s.tension_cost === "number"
				? `Coût Tension: ${s.tension_cost}`
				: null;

	return [
		`Technique: ${names || "?"}`,
		`Catégorie: ${s.category || "?"}`,
		`Élément: ${s.element || "?"}`,
		s.is_hyper ? "Type: Hyper-technique" : null,
		s.evolution_type ? `Évolution: ${s.evolution_type}` : null,
		power,
		cost,
		desc ? `Description: ${desc.replace(/\s+/g, " ").trim()}` : null,
	]
		.filter(Boolean)
		.join("\n");
}

export interface WikiIngestStats {
	success: boolean;
	characters: number;
	skills: number;
	chunks: number;
	backend: string;
}

interface Totals {
	sources: number;
	chunks: number;
	skipped: number;
	backend: string;
}

async function flush(batch: RagSource[], totals: Totals): Promise<void> {
	if (batch.length === 0) return;
	const stats = await ingestSources(batch);
	totals.sources += stats.sources;
	totals.chunks += stats.chunks;
	totals.skipped += stats.skipped;
	totals.backend = stats.backend;
}

async function ingestCharacters(limit: number, totals: Totals): Promise<number> {
	const supabase = createSupabaseServiceClient();
	let from = 0;
	let count = 0;
	let batch: RagSource[] = [];

	for (;;) {
		const { data, error } = await supabase
			.from("inagle_characters")
			.select(CHAR_COLUMNS)
			.not("zukan_order", "is", null)
			.order("zukan_order", { ascending: true })
			.range(from, from + PAGE_SIZE - 1);

		if (error) {
			console.error("[RAG Wiki] lecture personnages échouée:", error.message);
			break;
		}
		const rows = (data ?? []) as unknown as CharRow[];
		if (rows.length === 0) break;

		for (const c of rows) {
			if (count >= limit) break;
			const text = buildCharText(c);
			if (text.length < 30) continue;
			batch.push({
				sourceId: `chara-${c.id}`,
				kind: "sqlite",
				raw: text,
				title: c.name_fr || c.name_en || c.name_ja || c.id,
				url: `https://azalee.rosegriffon.fr/chara/${c.id}`,
				lang: "fr",
				meta: {
					table: "inagle_characters",
					entity_id: c.id,
					entity_type: "character",
					position: c.position ?? null,
					element: c.element ?? null,
					zukan_order: c.zukan_order ?? null,
				},
			});
			count++;
			if (batch.length >= BATCH) {
				await flush(batch, totals);
				batch = [];
			}
		}

		if (count >= limit || rows.length < PAGE_SIZE) break;
		from += PAGE_SIZE;
	}
	await flush(batch, totals);
	return count;
}

async function ingestSkills(limit: number, totals: Totals): Promise<number> {
	const supabase = createSupabaseServiceClient();
	let from = 0;
	let count = 0;
	let batch: RagSource[] = [];

	for (;;) {
		const { data, error } = await supabase
			.from("inagle_skills")
			.select(SKILL_COLUMNS)
			.order("id", { ascending: true })
			.range(from, from + PAGE_SIZE - 1);

		if (error) {
			console.error("[RAG Wiki] lecture techniques échouée:", error.message);
			break;
		}
		const rows = (data ?? []) as unknown as SkillRow[];
		if (rows.length === 0) break;

		for (const s of rows) {
			if (count >= limit) break;
			const text = buildSkillText(s);
			if (text.length < 30) continue;
			batch.push({
				sourceId: `skill-${s.id}`,
				kind: "sqlite",
				raw: text,
				title: s.name_fr || s.name_en || s.name_ja || s.id,
				url: `https://azalee.rosegriffon.fr/skill/${s.id}`,
				lang: "fr",
				meta: {
					table: "inagle_skills",
					entity_id: s.id,
					entity_type: "skill",
					category: s.category ?? null,
					element: s.element ?? null,
					is_hyper: s.is_hyper ?? null,
				},
			});
			count++;
			if (batch.length >= BATCH) {
				await flush(batch, totals);
				batch = [];
			}
		}

		if (count >= limit || rows.length < PAGE_SIZE) break;
		from += PAGE_SIZE;
	}
	await flush(batch, totals);
	return count;
}

/**
 * Ingère le corpus Wiki IEVR (personnages + techniques) dans pgvector.
 * Idempotent (upsert par id stable). `opts.only` borne à un type ; `opts.limit`
 * borne le nombre d'entités (tests/PoC).
 */
export async function ingestWikiCorpus(
	opts: { only?: "characters" | "skills"; limit?: number } = {}
): Promise<WikiIngestStats> {
	const limit = opts.limit ?? Infinity;
	const totals: Totals = { sources: 0, chunks: 0, skipped: 0, backend: "hash" };

	console.log("[RAG Wiki] Ingestion du corpus Wiki IEVR dans pgvector…");
	const characters = opts.only === "skills" ? 0 : await ingestCharacters(limit, totals);
	const skills = opts.only === "characters" ? 0 : await ingestSkills(limit, totals);

	console.log(
		`[RAG Wiki] Terminé : ${characters} personnages + ${skills} techniques → ` +
			`${totals.chunks} chunks (backend=${totals.backend}, skipped=${totals.skipped}).`
	);
	return { success: true, characters, skills, chunks: totals.chunks, backend: totals.backend };
}
