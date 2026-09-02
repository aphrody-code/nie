/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// rag-api — expose le store RAG local (bun:sqlite, aucune dépendance Supabase
// au moment de la requête) derrière api.rosegriffon.fr/rag/. Réutilise le
// moteur migré le 2026-08-06/07 (cf. docs/rag-unified.md) : recherche hybride
// dense (cosine brute-force) ∥ lexicale (FTS5 bm25), fusion RRF. Le seul appel
// réseau restant est le sidecar d'embedding local (rg-rag-embed.service,
// 127.0.0.1:8799) pour vectoriser la requête — zéro appel Supabase ici.

import { ragSearch, type RagSourceKind } from "@rosegriffon/db/rag";
import { chunkCount } from "@rosegriffon/db/rag-store";

const PORT = Number(process.env.RAG_API_PORT ?? 8806);
const HOST = process.env.RAG_API_HOST ?? "127.0.0.1";

// CORS ouvert : endpoint public, lecture seule, aucune donnée utilisateur.
const CORS_HEADERS: Record<string, string> = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-headers": "*, Content-Type",
	"access-control-max-age": "86400",
};

function corsJson(body: unknown, init?: ResponseInit): Response {
	const res = Response.json(body, init);
	for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
	return res;
}

function preflight(): Response {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const KNOWN_KINDS = new Set<RagSourceKind>([
	"lua",
	"cfg",
	"json",
	"ts",
	"sqlite",
	"code",
	"web",
	"tweet",
	"doc",
	"asset",
	"text",
]);

function parseKinds(raw: string | string[] | null | undefined): RagSourceKind[] | undefined {
	if (!raw) return undefined;
	const list = Array.isArray(raw) ? raw : raw.split(",");
	const kinds = list.map((k) => k.trim()).filter((k): k is RagSourceKind => KNOWN_KINDS.has(k as RagSourceKind));
	return kinds.length > 0 ? kinds : undefined;
}

async function handleSearch(query: string, k: number, kinds: RagSourceKind[] | undefined): Promise<Response> {
	const q = query.trim();
	if (q.length < 2) {
		return corsJson({ error: "query must be at least 2 characters" }, { status: 400 });
	}
	const kClamped = Math.min(Math.max(Number.isFinite(k) ? k : 10, 1), 50);
	try {
		const results = await ragSearch(q, { k: kClamped, kinds });
		return corsJson({ query: q, count: results.length, results });
	} catch (err) {
		return corsJson(
			{ error: err instanceof Error ? err.message : "rag search failed" },
			{ status: 500 }
		);
	}
}

interface SearchBody {
	query?: string;
	k?: number;
	kinds?: string[];
}

const server = Bun.serve({
	hostname: HOST,
	port: PORT,
	routes: {
		"/health": {
			OPTIONS: preflight,
			GET: () => corsJson({ ok: true, store: "local-sqlite", chunks: chunkCount() }),
		},

		"/search": {
			OPTIONS: preflight,
			GET: (req) => {
				const url = new URL(req.url);
				const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
				const k = Number(url.searchParams.get("k") ?? 10);
				const kinds = parseKinds(url.searchParams.get("kinds"));
				return handleSearch(query, k, kinds);
			},
			POST: async (req) => {
				let body: SearchBody;
				try {
					body = (await req.json()) as SearchBody;
				} catch {
					return corsJson({ error: "Invalid JSON body" }, { status: 400 });
				}
				return handleSearch(body.query ?? "", body.k ?? 10, parseKinds(body.kinds));
			},
		},
	},

	fetch(req) {
		if (req.method === "OPTIONS") return preflight();
		return corsJson({ error: "Not Found" }, { status: 404 });
	},
});

console.warn(`rag-api listening on http://${server.hostname}:${server.port} (chunks=${chunkCount()})`);

function shutdown(signal: string): void {
	console.warn(`rag-api received ${signal}, shutting down`);
	void server.stop(false);
	process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
