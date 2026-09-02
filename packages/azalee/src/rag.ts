/**
 * Recherche sémantique (RAG) sur la base de connaissances Inazuma.
 *
 * S'appuie sur le sidecar d'embeddings self-host et le vector store Redis
 * exposés par `@rosegriffon/db/redis` — aucune clé d'API, aucun service
 * externe. Utilisable par le CLI (`azalee rag`), l'API headless et une GUI.
 */

import { getEmbedding, vectorStore } from "@rosegriffon/db/redis";

/** Un extrait pertinent renvoyé par la recherche sémantique. */
export interface RagResult {
	id: string;
	title: string;
	date: string;
	url: string;
	type: string;
	text: string;
	/** Similarité cosinus, 0 → 1. */
	score: number;
}

/** Interroge le RAG et renvoie les `limit` extraits les plus proches. */
export async function queryRag(question: string, limit = 4): Promise<RagResult[]> {
	const embedding = await getEmbedding(question);
	const results = await vectorStore.search("inazuma-news", embedding, limit, question);
	return results.map((r) => {
		const meta = r.document.metadata as Partial<Record<"title" | "date" | "url" | "type", string>>;
		return {
		id: r.document.id,
		title: meta.title ?? "",
		date: meta.date ?? "",
		url: meta.url ?? "",
		type: meta.type ?? "",
		text: r.document.text,
		score: r.score,
		};
	});
}
