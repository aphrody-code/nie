/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RedisClient } from "bun";

// Initialisation globale avec auto-reconnect et gestion des queues hors-ligne
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

let clientInstance: RedisClient | null = null;

/**
 * Récupère le client Redis global (singleton) configuré pour la plateforme.
 */
export function getRedisClient(): RedisClient {
	if (!clientInstance) {
		try {
			const { RedisClient: BunRedisClient } = require("bun");
			clientInstance = new BunRedisClient(REDIS_URL, {
				connectionTimeout: 5000,
				idleTimeout: 300000, // 5 minutes to avoid idle timeouts during crawls
				autoReconnect: true,
				maxRetries: 10,
				enableOfflineQueue: true,
				enableAutoPipelining: true,
			}) as RedisClient;

			clientInstance.onconnect = () => {
				console.log(`[Redis] Connecté avec succès sur ${REDIS_URL.replace(/:[^:@]+@/, ":***@")}`);
			};

			clientInstance.onclose = (err) => {
				if (err) {
					console.error("[Redis] Déconnexion avec erreur :", err);
				} else {
					console.log("[Redis] Connexion fermée proprement.");
				}
				clientInstance = null; // Recreate on next call to recover from connection drops
			};
		} catch (err) {
			console.error("[Redis] Erreur critique d'initialisation :", err);
			throw err;
		}
	}
	return clientInstance;
}

/**
 * Réinitialise le client Redis global s'il est en erreur ou déconnecté.
 */
export function resetRedisClient(): void {
	if (clientInstance) {
		try {
			clientInstance.close();
		} catch (_) {}
		clientInstance = null;
	}
}

/**
 * ─── CACHE UTILITIES ──────────────────────────────────────────────────────────
 * Cache wrapper pour éviter la saturation de la base de données (Supabase).
 */
export const cache = {
	/**
	 * Récupère une valeur typée du cache.
	 */
	async get<T>(key: string): Promise<T | null> {
		const redis = getRedisClient();
		try {
			const data = await redis.get(key);
			if (data === null) return null;
			return JSON.parse(data) as T;
		} catch (err) {
			console.warn(`[Redis Cache] Échec get pour la clé "${key}":`, err);
			resetRedisClient();
			return null;
		}
	},

	/**
	 * Enregistre une valeur dans le cache avec un TTL en secondes.
	 */
	async set<T>(key: string, value: T, ttlSeconds = 3600): Promise<boolean> {
		const redis = getRedisClient();
		try {
			const serialized = JSON.stringify(value);
			await redis.set(key, serialized, "EX", ttlSeconds);
			return true;
		} catch (err) {
			console.warn(`[Redis Cache] Échec set pour la clé "${key}":`, err);
			resetRedisClient();
			return false;
		}
	},

	/**
	 * Invalide une clé de cache.
	 */
	async del(key: string): Promise<boolean> {
		const redis = getRedisClient();
		try {
			await redis.del(key);
			return true;
		} catch (err) {
			console.warn(`[Redis Cache] Échec del pour la clé "${key}":`, err);
			resetRedisClient();
			return false;
		}
	},

	/**
	 * Enveloppe une fonction asynchrone (ex: requête DB) dans un cache transparent.
	 */
	async wrap<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
		const cached = await this.get<T>(key);
		if (cached !== null) {
			return cached;
		}
		const fresh = await fetcher();
		await this.set(key, fresh, ttlSeconds);
		return fresh;
	},
};

/**
 * ─── CRAWLER & DATA TRACKER ───────────────────────────────────────────────────
 * Permet de tracker l'état des crawls pour éviter d'écrire en DB / scraper
 * inutilement si la donnée source n'a pas changé.
 */
export const crawlerTracker = {
	/**
	 * Détermine si le contenu d'un URL a changé par rapport au dernier crawl réussi.
	 * Retourne `true` s'il faut relancer le traitement / l'écriture.
	 */
	async shouldProcess(url: string, currentHash: string): Promise<boolean> {
		const redis = getRedisClient();
		const key = `crawler:hash:${url}`;
		try {
			const lastHash = await redis.get(key);
			return lastHash !== currentHash;
		} catch (err) {
			console.warn(`[Redis Crawler] Erreur lors du check de hash pour ${url} :`, err);
			resetRedisClient();
			return true; // En cas de doute, on traite
		}
	},

	/**
	 * Enregistre le hash actuel d'un URL pour marquer le crawl comme traité.
	 */
	async markProcessed(url: string, currentHash: string, ttlSeconds = 86400 * 7): Promise<void> {
		const redis = getRedisClient();
		const key = `crawler:hash:${url}`;
		try {
			await redis.set(key, currentHash, "EX", ttlSeconds);
		} catch (err) {
			console.warn(`[Redis Crawler] Impossible de sauvegarder le hash pour ${url} :`, err);
			resetRedisClient();
		}
	},
};

/**
 * ─── VECTOR STORE / RAG PREP ──────────────────────────────────────────────────
 * Stockage vectoriel léger et performant en mémoire Redis avec recherche de
 * similitude cosinus côté JS/TS (extrêmement rapide jusqu'à des milliers de documents).
 */
export interface VectorDocument<M = Record<string, unknown>> {
	id: string;
	text: string;
	embedding: number[];
	metadata: M;
	timestamp: number;
}

export const vectorStore = {
	/**
	 * Enregistre un document et son embedding associé dans Redis.
	 */
	async saveDocument<M = Record<string, unknown>>(
		collection: string,
		doc: Omit<VectorDocument<M>, "timestamp">
	): Promise<void> {
		const redis = getRedisClient();
		const key = `vector:${collection}:${doc.id}`;

		const payload: VectorDocument<M> = {
			...doc,
			timestamp: Date.now(),
		};

		try {
			await redis.set(key, JSON.stringify(payload));
			// Ajouter également à un set pour l'indexation de la collection
			await redis.sadd(`vector:collection:${collection}`, doc.id);
		} catch (err) {
			console.error(`[Redis Vector] Erreur de sauvegarde du document ${doc.id} :`, err);
			resetRedisClient();
			throw err;
		}
	},

	/**
	 * Supprime un document vectoriel.
	 */
	async deleteDocument(collection: string, id: string): Promise<void> {
		const redis = getRedisClient();
		const key = `vector:${collection}:${id}`;
		try {
			await redis.del(key);
			await redis.srem(`vector:collection:${collection}`, id);
		} catch (err) {
			console.error(`[Redis Vector] Erreur de suppression du document ${id} :`, err);
			resetRedisClient();
		}
	},

	/**
	 * Supprime plusieurs documents vectoriels en une seule opération (batch).
	 */
	async deleteDocuments(collection: string, ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const redis = getRedisClient();
		const keys = ids.map((id) => `vector:${collection}:${id}`);
		try {
			await redis.del(...keys);
			await redis.srem(`vector:collection:${collection}`, ...ids);
		} catch (err) {
			console.error(
				`[Redis Vector] Erreur de suppression en lot pour ${ids.length} documents :`,
				err
			);
			resetRedisClient();
		}
	},

	/**
	 * Récupère tous les documents d'une collection.
	 */
	async getCollection<M = Record<string, unknown>>(
		collection: string
	): Promise<VectorDocument<M>[]> {
		const redis = getRedisClient();
		const collectionSetKey = `vector:collection:${collection}`;

		try {
			const ids = await redis.smembers(collectionSetKey);
			if (ids.length === 0) return [];

			// Pipeline pour récupérer tous les documents d'un coup
			const promises = ids.map((id) => redis.get(`vector:${collection}:${id}`));
			const results = await Promise.all(promises);

			const docs: VectorDocument<M>[] = [];
			for (const raw of results) {
				if (raw) {
					docs.push(JSON.parse(raw) as VectorDocument<M>);
				}
			}
			return docs;
		} catch (err) {
			console.error(
				`[Redis Vector] Erreur lors de la récupération de la collection ${collection} :`,
				err
			);
			resetRedisClient();
			return [];
		}
	},

	/**
	 * Recherche par similarité cosinus les documents les plus proches du vecteur de requête.
	 */
	async search<M = Record<string, unknown>>(
		collection: string,
		queryEmbedding: number[],
		limit = 5,
		queryText?: string
	): Promise<{ document: Omit<VectorDocument<M>, "embedding">; score: number }[]> {
		const docs = await this.getCollection<M>(collection);
		if (docs.length === 0) return [];

		const scored = docs.map((doc) => {
			const cosineScore = cosineSimilarity(queryEmbedding, doc.embedding);
			let keywordScore = 0;

			if (queryText) {
				const queryWords = queryText
					.toLowerCase()
					.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ")
					.split(/\s+/)
					.filter(
						(w) =>
							w.length > 2 &&
							![
								"pour",
								"avec",
								"dans",
								"les",
								"des",
								"une",
								"dans",
								"sur",
								"the",
								"and",
								"for",
								"with",
							].includes(w)
					);

				if (queryWords.length > 0) {
					const docTextLower = doc.text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ");
					let matches = 0;
					for (const word of queryWords) {
						if (docTextLower.includes(word)) {
							matches++;
						}
					}
					keywordScore = matches / queryWords.length;
				}
			}

			// Recherche hybride : 60% similarité cosinus, 40% correspondance de mot-clé
			let score = queryText ? cosineScore * 0.6 + keywordScore * 0.4 : cosineScore;

			// Exact phrase match boost
			if (queryText) {
				const queryLower = queryText.toLowerCase();
				const textLower = doc.text.toLowerCase();
				const titleLower = ((doc.metadata as any)?.title || "").toLowerCase();

				if (titleLower.includes(queryLower)) {
					score += 0.25; // Significant boost for exact title match
				} else if (textLower.includes(queryLower)) {
					score += 0.12; // Moderate boost for exact text match
				}
			}

			// Language weights (favoring French and English, penalizing others)
			let langWeight = 1.0;
			const lang = (doc.metadata as any)?.language;
			if (lang === "fr") {
				langWeight = 1.35;
			} else if (lang === "en") {
				langWeight = 1.1;
			} else if (lang === "ja") {
				langWeight = 0.95;
			} else if (lang) {
				langWeight = 0.4;
			}
			score *= langWeight;

			// Supprimer l'embedding de la réponse pour économiser de la bande passante
			const { embedding, ...documentWithoutEmbedding } = doc;
			return {
				document: documentWithoutEmbedding,
				score,
			};
		});

		// Trier par score décroissant et renvoyer la limite
		return scored.sort((a, b) => b.score - a.score).slice(0, limit);
	},
};

/**
 * Calcule la similarité cosinus entre deux vecteurs numériques de dimension égale.
 * Formule : A . B / (||A|| * ||B||)
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
	if (vecA.length !== vecB.length) {
		throw new Error(`Incohérence de taille de vecteurs : ${vecA.length} vs ${vecB.length}`);
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < vecA.length; i++) {
		const a = vecA[i] ?? 0;
		const b = vecB[i] ?? 0;
		dotProduct += a * b;
		normA += a * a;
		normB += b * b;
	}

	if (normA === 0 || normB === 0) return 0; // Sécurité division par zéro
	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hashStringToRange(str: string, range: number): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0; // Convert to 32bit integer
	}
	return Math.abs(hash) % range;
}

/**
 * Génère un vecteur d'embedding de dimension 1536 (type text-embedding-3-small).
 * Utilise l'API OpenAI si OPENAI_API_KEY est défini, sinon utilise un Feature Hashing vectorizer déterministe.
 */
export async function getEmbedding(text: string): Promise<number[]> {
	const apiKey = process.env.OPENAI_API_KEY;
	const dimension = 1536;

	if (apiKey && apiKey.startsWith("sk-")) {
		try {
			const response = await fetch("https://api.openai.com/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: "text-embedding-3-small",
					input: text,
				}),
			});

			if (response.ok) {
				const json = (await response.json()) as { data?: { embedding?: number[] }[] };
				if (json.data && json.data[0] && json.data[0].embedding) {
					return json.data[0].embedding;
				}
			}
			console.warn(
				`[Redis Embeddings] Échec OpenAI API (status ${response.status}). Repli sur hash vectorizer.`
			);
		} catch (err) {
			console.warn(
				"[Redis Embeddings] Erreur lors de la requête OpenAI API. Repli sur hash vectorizer :",
				err
			);
		}
	}

	// Fallback : Feature Hashing Vectorizer (dimension 1536) L2-normalisé
	const vector = new Array<number>(dimension).fill(0);
	const words = text
		.toLowerCase()
		.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()\[\]]/g, " ")
		.split(/\s+/)
		.filter(Boolean);

	for (const word of words) {
		if (word.length > 0) {
			const index = hashStringToRange(word, dimension);
			const current = vector[index] ?? 0;
			vector[index] = current + 1;
		}
	}

	let norm = 0;
	for (let i = 0; i < dimension; i++) {
		const val = vector[i] ?? 0;
		norm += val * val;
	}
	norm = Math.sqrt(norm);

	if (norm > 0) {
		for (let i = 0; i < dimension; i++) {
			const val = vector[i] ?? 0;
			vector[i] = val / norm;
		}
	} else {
		vector[0] = 1.0;
	}

	return vector;
}
