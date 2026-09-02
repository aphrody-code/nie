/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Surface RAG unifiée du cron — point d'import UNIQUE. Centralise les trois
// briques :
//   - `rag`        : sync vectorielle (personnages Zukan + news + tweets) + requête sémantique locale
//   - `rag-zukan`  : indexation des personnages du mirror Zukan corrigé (cœur)
//   - `rag-web`    : grounding web live via les primitives bxc (équivalent de l'actor rag-web-browser)
//
// Les consommateurs (daemon `index.ts`, orchestrateur `ie-crawl/index.ts`)
// importent depuis ce barrel plutôt que de toucher les modules internes.

export { queryRag, runRagSync } from "./rag";
export { chunkText, computeStringHash } from "./rag-utils";
export { indexZukanCharacters } from "./rag-zukan";
export { ingestWikiCorpus, type WikiIngestStats } from "./rag-wiki";
export { ragWebSearch, type RagWebDoc, type RagWebOptions } from "./rag-web";

// RAG unifié pgvector (additif, cf. UNIFIED-RAG-PLAN). Le store Redis reste
// branché ; ces exports exposent la nouvelle voie hybride pgvector.
export {
	ingestSources,
	ragHybridSearch,
	type RagSource,
	type RagPgResult,
	type IngestStats,
} from "./rag-store-local";
export { chunkBySource, chunkTweet, type SourceKind, type Chunk } from "./rag-chunkers";
export { embedBatch, embedOne, type EmbedBackend } from "./rag-embed";

import { queryRag } from "./rag";
import { ragWebSearch, type RagWebDoc } from "./rag-web";

export interface GroundedSource {
	kind: "local" | "web";
	title: string;
	url?: string;
	text: string;
	score?: number;
	rank?: number;
}

export interface GroundedAnswer {
	question: string;
	sources: GroundedSource[];
	local: number;
	web: number;
}

export interface GroundedQueryOptions {
	/** Nombre de documents locaux (vectoriels) à récupérer. */
	limit?: number;
	/** Active le grounding web live (Google → markdown via bxc). */
	web?: boolean;
	/** Nombre maximal de pages web à extraire quand `web` est actif. */
	webMaxResults?: number;
	/**
	 * Ne déclenche le grounding web que si le RAG local renvoie moins de
	 * `minLocal` documents (par défaut : toujours, si `web` actif).
	 */
	minLocalBeforeWeb?: number;
}

/**
 * Requête RAG unifiée : récupération sémantique locale (vectorStore Redis) +
 * grounding web live optionnel (bxc). Centralise toute la logique de réponse.
 */
export async function ragGroundedQuery(
	question: string,
	opts: GroundedQueryOptions = {}
): Promise<GroundedAnswer> {
	const limit = opts.limit ?? 4;
	const local = await queryRag(question, limit);

	const sources: GroundedSource[] = local.map((r) => ({
		kind: "local" as const,
		title: typeof r.title === "string" ? r.title : question,
		url: typeof r.url === "string" ? r.url : undefined,
		text: r.text,
		score: r.score,
	}));

	let webDocs: RagWebDoc[] = [];
	const needWeb = opts.web && local.length < (opts.minLocalBeforeWeb ?? Number.POSITIVE_INFINITY);
	if (opts.web && (opts.minLocalBeforeWeb === undefined || needWeb)) {
		try {
			webDocs = await ragWebSearch(question, { maxResults: opts.webMaxResults ?? 3 });
			for (const d of webDocs) {
				sources.push({ kind: "web", title: d.title, url: d.url, text: d.markdown, rank: d.rank });
			}
		} catch (err) {
			console.warn("[RAG] Grounding web échoué :", err instanceof Error ? err.message : err);
		}
	}

	return { question, sources, local: local.length, web: webDocs.length };
}
