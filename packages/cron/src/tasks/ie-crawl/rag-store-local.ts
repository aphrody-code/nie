/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Store vectoriel LOCAL (bun:sqlite, `@rosegriffon/db/rag-store`).
// Remplace le store pgvector Supabase (`inagle_rag_chunks` + RPC
// `rag_hybrid_search`) qui avait fait dépasser le quota storage du plan free
// (592 Mo à lui seul) et cassé azalee-web/website-web/rg-cron pendant 7+
// jours (migré le 2026-08-06, cf. docs/rag-unified.md).
// Le store Redis (`@rosegriffon/db/redis`) reste branché en parallèle (cache
// généraliste, pas le RAG).

import { upsertChunks, hybridSearch, type RagChunkRow } from "@rosegriffon/db/rag-store";
import { computeStringHash } from "./rag-utils";
import { chunkBySource, type SourceKind } from "./rag-chunkers";
import { embedBatch, embedOne, RAG_EMBED_DIM, type EmbedBackend } from "./rag-embed";

export interface RagSource {
	/** Identifiant stable de la source parente (doc/entité/fichier). */
	sourceId: string;
	kind: SourceKind;
	/** Contenu brut à découper, OU chunks déjà prêts (web/tweet). */
	raw: string;
	title?: string;
	url?: string;
	lang?: string;
	meta?: Record<string, unknown>;
	buildid?: number;
}

export interface IngestStats {
	sources: number;
	chunks: number;
	skipped: number;
	backend: EmbedBackend;
}

/** Ingestion idempotente d'un lot de sources dans le store local. */
export async function ingestSources(sources: RagSource[]): Promise<IngestStats> {
	const stats: IngestStats = { sources: 0, chunks: 0, skipped: 0, backend: "hash" };

	for (const src of sources) {
		const chunks = chunkBySource(src.kind, src.raw).filter((c) => c.content.trim().length >= 20);
		if (chunks.length === 0) {
			stats.skipped++;
			continue;
		}

		const texts = chunks.map((c) => {
			const header = `[${src.kind}] ${src.title ?? src.sourceId}${c.symbol ? ` :: ${c.symbol}` : ""}`;
			return `${header}\n${c.content}`;
		});

		const { backend, vectors } = await embedBatch(texts);
		stats.backend = backend;

		const rows: RagChunkRow[] = chunks.map((c, i) => {
			const content = texts[i]!;
			if (vectors[i]!.length !== RAG_EMBED_DIM) {
				throw new Error(`embedding dim ${vectors[i]!.length} != ${RAG_EMBED_DIM}`);
			}
			return {
				id: `${src.sourceId}#${c.index}`,
				source_id: src.sourceId,
				source_kind: src.kind,
				title: src.title ?? null,
				url: src.url ?? null,
				lang: src.lang ?? null,
				content,
				embedding: vectors[i]!,
				meta: { ...(src.meta ?? {}), symbol: c.symbol ?? null },
				content_hash: computeStringHash(content),
				buildid: src.buildid ?? null,
			};
		});

		try {
			upsertChunks(rows);
		} catch (err) {
			console.error(
				`[RAG local] upsert échec pour ${src.sourceId}:`,
				err instanceof Error ? err.message : err
			);
			stats.skipped++;
			continue;
		}
		stats.sources++;
		stats.chunks += rows.length;
	}
	return stats;
}

export interface RagPgResult {
	id: string;
	source_id: string;
	source_kind: string;
	title: string | null;
	url: string | null;
	lang: string | null;
	content: string;
	meta: Record<string, unknown>;
	score: number;
}

/** Recherche hybride (dense cosine ∥ lexicale FTS5, fusion RRF) sur le store local. */
export async function ragHybridSearch(
	query: string,
	opts: { k?: number; kinds?: SourceKind[] } = {}
): Promise<RagPgResult[]> {
	const { vector } = await embedOne(query);
	try {
		return hybridSearch(vector, query, { k: opts.k, kinds: opts.kinds });
	} catch (err) {
		console.error("[RAG local] hybridSearch échec:", err instanceof Error ? err.message : err);
		return [];
	}
}
