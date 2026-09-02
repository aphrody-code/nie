/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// RAG unifié — couche partagée (db) consommable par azalee (GraphQL / REST /
// server actions) ET le cron. Recherche hybride dense (cosine) + lexicale
// (FTS5) fusionnée par RRF sur le store LOCAL (`./rag-store.ts`, bun:sqlite).
//
// Migré depuis pgvector Supabase (`inagle_rag_chunks` + RPC `rag_hybrid_search`)
// le 2026-08-06 : ce store à lui seul pesait 592 Mo sur les 606 Mo du quota
// storage du plan free, restant le projet (azalee-web/website-web/rg-cron en
// échec pendant 7+ jours). Voir docs/rag-unified.md.
//
// Additif : ne remplace PAS `getEmbedding`/`vectorStore` de ./redis. Le store
// Redis reste branché en parallèle (cache généraliste, pas le RAG).

import { hybridSearch, RAG_LOCAL_DIM, type RagChunkResult, type RagSourceKind } from "./rag-store";

export type { RagChunkResult, RagSourceKind };
export const RAG_EMBED_DIM = RAG_LOCAL_DIM;

/**
 * Format enrichi tweet pour chunk RAG (auteur + date + métriques + texte).
 * Utilisé par ingestion cron (x/tweets) pour brancher sur le store RAG avec contexte complet.
 * Additif (ne change pas ragSearch/embed).
 */
export function formatTweetForRag(t: {
	id: string;
	author_username?: string | null;
	author_name?: string | null;
	text?: string | null;
	created_at?: string | null;
	metrics?: unknown;
	media?: unknown;
}): string {
	const u = t.author_username ? `@${t.author_username}` : "unknown";
	const n = t.author_name ? ` (${t.author_name})` : "";
	const d = t.created_at ? ` ${String(t.created_at).slice(0, 10)}` : "";
	let m = "";
	if (t.metrics && typeof t.metrics === "object") {
		const mm = t.metrics as Record<string, unknown>;
		m = ` metrics:${Object.entries(mm)
			.map(([k, v]) => `${k}=${v}`)
			.join(" ")}`;
	}
	const mediaNote = Array.isArray(t.media) && (t.media as any[]).length > 0 ? " [media]" : "";
	return `[tweet ${t.id}] ${u}${n}${d}${m}${mediaNote}\n${t.text || ""}`.trim();
}

function hashStringToRange(str: string, range: number): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash) % range;
}

/**
 * Embedding requête (384-dim, e5-small natif). Résolution : sidecar e5
 * (`RAG_EMBED_URL`) → OpenAI text-embedding-3-small (re-projeté) →
 * Feature-Hashing déterministe.
 * Doit rester aligné sur `cron/.../rag-embed.ts` (même algorithme de hashing).
 */
export async function ragEmbedQuery(text: string): Promise<number[]> {
	const dim = RAG_EMBED_DIM;

	const sidecar = process.env.RAG_EMBED_URL;
	if (sidecar) {
		const endpoint = sidecar.replace(/\/$/, "") + "/embed";
		// 2 tentatives à court backoff : absorbe un hoquet réseau sans faire
		// patienter l'utilisateur (un vrai redémarrage du sidecar bascule vite
		// sur le repli plutôt que de bloquer la requête plusieurs secondes).
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const res = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					// Chemin REQUÊTE : marque `query:true` pour le préfixe e5 côté sidecar.
					body: JSON.stringify({ texts: [text], query: true }),
				});
				if (res.ok) {
					const json = (await res.json()) as { embeddings?: number[][] };
					const e = json.embeddings?.[0];
					if (e) return projectAndNormalize(e, dim);
				}
			} catch {
				/* réessai puis repli */
			}
			if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
		}
	}

	const key = process.env.OPENAI_API_KEY;
	if (key && key.startsWith("sk-")) {
		try {
			const res = await fetch("https://api.openai.com/v1/embeddings", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
				body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
			});
			if (res.ok) {
				const json = (await res.json()) as { data?: { embedding?: number[] }[] };
				const e = json.data?.[0]?.embedding;
				if (e) return projectAndNormalize(e, dim);
			}
		} catch {
			/* fallback */
		}
	}

	// Feature hashing dim.
	const vector = new Array<number>(dim).fill(0);
	const words = text
		.toLowerCase()
		.replace(/[.,/#!$%^&*;:{}=\-_`~()[\]]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
	for (const word of words) {
		const idx = hashStringToRange(word, dim);
		const polarity = hashStringToRange(`p:${word}`, 2) === 0 ? 1 : -1;
		vector[idx] = (vector[idx] ?? 0) + polarity;
	}
	return normalize(vector, dim);
}

function projectAndNormalize(vec: number[], dim: number): number[] {
	if (vec.length === dim) return normalize(vec, dim);
	const out = new Array<number>(dim).fill(0);
	for (let i = 0; i < vec.length; i++) out[i % dim] = (out[i % dim] ?? 0) + (vec[i] ?? 0);
	return normalize(out, dim);
}

function normalize(vec: number[], dim: number): number[] {
	let norm = 0;
	for (const v of vec) norm += v * v;
	norm = Math.sqrt(norm);
	if (norm === 0) {
		const out = new Array<number>(dim).fill(0);
		out[0] = 1;
		return out;
	}
	return vec.map((v) => v / norm);
}

/** Recherche RAG hybride (dense + lexicale, RRF) sur le store local. */
export async function ragSearch(
	query: string,
	opts: { k?: number; kinds?: RagSourceKind[] } = {}
): Promise<RagChunkResult[]> {
	if (!query || query.trim().length < 2) return [];
	const emb = await ragEmbedQuery(query);
	try {
		return hybridSearch(emb, query, { k: opts.k, kinds: opts.kinds });
	} catch (err) {
		console.warn("[db/rag] hybridSearch échec:", err instanceof Error ? err.message : err);
		return [];
	}
}
