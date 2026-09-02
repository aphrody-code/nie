/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ZukanCharacterDetail } from "@aphrody-code/zukan";
import { crawlerTracker, getEmbedding, vectorStore } from "@rosegriffon/db/redis";
import { chunkText, computeStringHash } from "./rag-utils";
import { sql } from "../../lib/db.js";

// Centre le RAG sur le mirror Zukan : indexe les personnages du Zukan officiel
// (table `inagle_characters`, données corrigées par le remap zukan_hash/zukan_order
// — cf. scripts/inagle/pipeline/remap-zukan-mirror.ts) dans la MÊME collection
// vectorielle `inazuma-news` que les news et tweets, pour que l'assistant RAG
// réponde aux questions sur les personnages.
//
// Source = Supabase (source de vérité, strictement identique au mirror SQLite
// read-only servi par Azalée). La forme de chaque enregistrement est mappée sur
// le type canonique `ZukanCharacterDetail` de la SDK `@aphrody-code/zukan`.

const COLLECTION = "inazuma-news";
const PAGE_SIZE = 1000;
const MAX_CHUNKS_PRECLEAN = 20;

interface DBCharRow {
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
	zukan_hash: string | null;
	description_fr: string | null;
	description_en: string | null;
	description_ja: string | null;
	stat_frappe: number | null;
	stat_controle: number | null;
	stat_technique: number | null;
	stat_pression: number | null;
	stat_physique: number | null;
	stat_agilite: number | null;
	stat_intelligence: number | null;
	stat_total: number | null;
}

const STAT_LABELS: ReadonlyArray<[keyof DBCharRow, string]> = [
	["stat_frappe", "Frappe"],
	["stat_controle", "Contrôle"],
	["stat_technique", "Technique"],
	["stat_pression", "Pression"],
	["stat_physique", "Physique"],
	["stat_agilite", "Agilité"],
	["stat_intelligence", "Intelligence"],
];

// Colonnes lues sur `inagle_characters` (cf. requête SQL paginée ci-dessous) :
// id, name_fr, name_en, name_ja, position, element, gender, rarity_label, series,
// zukan_order, zukan_hash, description_fr, description_en, description_ja,
// stat_frappe, stat_controle, stat_technique, stat_pression, stat_physique,
// stat_agilite, stat_intelligence, stat_total

/** Mappe une ligne `inagle_characters` vers la forme canonique de la SDK Zukan. */
function toZukanDetail(c: DBCharRow): ZukanCharacterDetail {
	const stats: Record<string, number> = {};
	for (const [key, label] of STAT_LABELS) {
		const v = c[key];
		if (typeof v === "number") stats[label] = v;
	}
	return {
		id: c.zukan_hash || c.id,
		nameJa: c.name_ja || "",
		nameEn: c.name_en || undefined,
		nameFr: c.name_fr || undefined,
		position: c.position || undefined,
		element: c.element || undefined,
		stats,
	};
}

/** Construit le texte multilingue enrichi indexé pour un personnage. */
function buildCharText(c: DBCharRow): string {
	const names = [c.name_fr, c.name_en, c.name_ja].filter(Boolean).join(" / ");
	const desc = c.description_fr || c.description_en || c.description_ja || "";
	const statLine = STAT_LABELS.map(([key, label]) => {
		const v = c[key];
		return typeof v === "number" ? `${label} ${v}` : null;
	})
		.filter(Boolean)
		.join(", ");

	const lines = [
		`Nom: ${names || "?"}`,
		`Poste: ${c.position || "?"}`,
		`Élément: ${c.element || "?"}`,
		`Genre: ${c.gender || "?"}`,
		`Rareté: ${c.rarity_label || "?"}`,
		`Série: ${c.series || "?"}`,
		`N° Zukan: ${c.zukan_order ?? "?"}`,
		statLine
			? `Stats: ${statLine}${typeof c.stat_total === "number" ? ` (Total ${c.stat_total})` : ""}`
			: null,
		desc ? `Description: ${desc}` : null,
	];
	return lines.filter(Boolean).join("\n");
}

function displayName(c: DBCharRow, detail: ZukanCharacterDetail): string {
	return c.name_fr || c.name_en || c.name_ja || detail.id;
}

/**
 * Indexe tous les personnages du Zukan officiel (zukan_order non nul) dans la
 * collection vectorielle, avec déduplication par hash de contenu (re-run rapide).
 */
export async function indexZukanCharacters(): Promise<{ processed: number; errors: number }> {
	console.log("[RAG Zukan] Indexation des personnages du Zukan (mirror corrigé)…");

	let processed = 0;
	let errors = 0;
	let from = 0;

	for (;;) {
		let rows: DBCharRow[];
		try {
			rows = await sql<DBCharRow[]>`
				SELECT id, name_fr, name_en, name_ja, position, element, gender, rarity_label, series,
				       zukan_order, zukan_hash, description_fr, description_en, description_ja,
				       stat_frappe, stat_controle, stat_technique, stat_pression, stat_physique,
				       stat_agilite, stat_intelligence, stat_total
				FROM inagle_characters
				WHERE zukan_order IS NOT NULL
				ORDER BY zukan_order ASC
				LIMIT ${PAGE_SIZE} OFFSET ${from}
			`;
		} catch (err) {
			console.error(
				"[RAG Zukan] Lecture des personnages échouée :",
				err instanceof Error ? err.message : err
			);
			errors++;
			break;
		}

		if (rows.length === 0) break;

		for (const c of rows) {
			try {
				const detail = toZukanDetail(c);
				const text = buildCharText(c);
				if (text.length < 30) continue;

				const title = displayName(c, detail);
				const url = `https://azalee.rosegriffon.fr/chara/${c.id}`;
				const itemId = `chara-${c.id}`;

				const formattedDoc = `Titre: ${title}\nType: character\nContenu:\n${text}`;
				const contentHash = computeStringHash(formattedDoc);

				if (!(await crawlerTracker.shouldProcess(itemId, contentHash))) continue;

				const idsToDelete = [itemId];
				for (let i = 0; i < MAX_CHUNKS_PRECLEAN; i++) idsToDelete.push(`${itemId}#chunk-${i}`);
				await vectorStore.deleteDocuments(COLLECTION, idsToDelete);

				const chunks = chunkText(text, 800, 150);
				for (let i = 0; i < chunks.length; i++) {
					const chunk = chunks[i] || "";
					const formattedChunk = `Titre: ${title}\nType: character [Partie ${i + 1}/${chunks.length}]\nContenu:\n${chunk}`;
					const embedding = await getEmbedding(formattedChunk);
					await vectorStore.saveDocument(COLLECTION, {
						id: `${itemId}#chunk-${i}`,
						text: formattedChunk,
						embedding,
						metadata: {
							title,
							url,
							type: "character",
							chunkIndex: i,
							totalChunks: chunks.length,
							position: c.position ?? undefined,
							element: c.element ?? undefined,
							zukanOrder: c.zukan_order ?? undefined,
							zukanHash: c.zukan_hash ?? undefined,
						},
					});
				}

				await crawlerTracker.markProcessed(itemId, contentHash);
				processed++;
			} catch (err) {
				console.error(
					`[RAG Zukan] Erreur d'indexation pour ${c.id} :`,
					err instanceof Error ? err.message : err
				);
				errors++;
			}
		}

		if (rows.length < PAGE_SIZE) break;
		from += PAGE_SIZE;
	}

	console.log(`[RAG Zukan] Terminé : ${processed} personnages indexés, ${errors} erreurs.`);
	return { processed, errors };
}
