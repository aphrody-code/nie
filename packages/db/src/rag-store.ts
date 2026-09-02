/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// RAG unifié — store vectoriel LOCAL (bun:sqlite). Remplace le store pgvector
// Supabase (`inagle_rag_chunks` + RPC `rag_hybrid_search`) qui avait fait
// dépasser le quota storage du plan free (606 Mo DB, 592 Mo pour ce seul
// store) et cassé azalee-web/website-web/rg-cron pendant 7+ jours.
//
// Recherche hybride reproduite en local :
//   - dense : cosine (= dot product, embeddings L2-normalisés) par balayage
//     en mémoire (~58k chunks × 384 dims ≈ 15 ms/requête, pas besoin d'ANN à
//     cette échelle) ;
//   - lexicale : FTS5 (`unicode61 remove_diacritics 2`) + bm25 ;
//   - fusion RRF (k=60), même principe que la RPC Postgres remplacée.
//
// Dimension 384 native (e5-small du sidecar rg-rag-embed), sans le zero-pad
// vers 1024 qui n'existait que pour coller au type `halfvec(1024)` pgvector.
//
// Fichier partagé par deux process séparés (rg-cron = écrivain, azalee-web =
// lecteur) → WAL + busy_timeout pour l'accès concurrent multi-process.

// `import type` (PAS un import de valeur) : s'efface entièrement à la compilation,
// donc zéro `require("bun:sqlite")` émis au chargement du module. Nécessaire car
// azalee build sous Node (cf. scripts/next-build.sh — bug de prerender Bun sur
// /_global-error) : un import de VALEUR ferait planter "Collecting page data" dès
// que /api/rag/search ou /api/graphql sont dans le trace, `bun:sqlite` n'existant
// pas sous Node. `getDb()` charge le vrai constructeur en lazy, guardé `typeof Bun`
// (jamais atteint au build ni sous Node runtime — azalee-web/rg-cron tournent tous
// deux sous Bun en prod, cf. lib/supabase/sqlite-client.ts pour le même pattern).
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const RAG_LOCAL_DIM = 384;

export type RagSourceKind =
	| "lua"
	| "cfg"
	| "json"
	| "ts"
	| "sqlite"
	| "code"
	| "web"
	| "tweet"
	| "doc"
	| "asset"
	| "text";

export interface RagChunkRow {
	id: string;
	source_id: string;
	source_kind: RagSourceKind | string;
	title: string | null;
	url: string | null;
	lang: string | null;
	content: string;
	meta: Record<string, unknown>;
	content_hash: string;
	buildid: number | null;
	embedding: number[] | Float32Array;
}

export interface RagChunkResult {
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

function resolveStorePath(): string {
	if (process.env.RAG_STORE_PATH) return path.resolve(process.env.RAG_STORE_PATH);
	// `var/rag` PASSE EN PREMIER. Le candidat est retenu sur l'existence de son DOSSIER, et
	// `data/` existe toujours dans ce dépôt — c'est le VFS du jeu : le tester d'abord rendait
	// un `data/rag/rag-store.sqlite` qui n'a jamais existé, au lieu du store réellement écrit
	// par le cron et lu par `rag-api.service`.
	const candidates = [
		path.resolve(process.cwd(), "var/rag/rag-store.sqlite"),
		path.resolve(process.cwd(), "data/rag/rag-store.sqlite"),
		path.resolve(process.cwd(), "apps/azalee/data/rag/rag-store.sqlite"),
	];
	for (const c of candidates) {
		if (existsSync(path.dirname(c))) return c;
	}
	return candidates[candidates.length - 1]!;
}

let db: Database | null = null;

function getDb(): Database {
	if (db) return db;
	if (typeof Bun === "undefined") {
		throw new Error(
			"[rag-store] bun:sqlite indisponible (runtime Node) — le store RAG local ne tourne que sous Bun (azalee-web / rg-cron)."
		);
	}
	const p = resolveStorePath();
	mkdirSync(path.dirname(p), { recursive: true });
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load bun:sqlite sous garde Bun (cf. commentaire d'import ci-dessus)
	const { Database: DBConstructor } = require("bun:sqlite");
	const handle: Database = new DBConstructor(p, { create: true });
	handle.run("PRAGMA journal_mode = WAL;");
	handle.run("PRAGMA synchronous = NORMAL;");
	handle.run("PRAGMA busy_timeout = 5000;");
	handle.run(`
		CREATE TABLE IF NOT EXISTS rag_chunks (
			id TEXT PRIMARY KEY,
			source_id TEXT NOT NULL,
			source_kind TEXT NOT NULL,
			title TEXT,
			url TEXT,
			lang TEXT,
			content TEXT NOT NULL,
			meta TEXT NOT NULL DEFAULT '{}',
			content_hash TEXT NOT NULL,
			buildid INTEGER,
			embedding BLOB NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`);
	handle.run("CREATE INDEX IF NOT EXISTS rag_chunks_source_idx ON rag_chunks(source_id);");
	handle.run("CREATE INDEX IF NOT EXISTS rag_chunks_kind_idx ON rag_chunks(source_kind);");
	handle.run(`
		CREATE VIRTUAL TABLE IF NOT EXISTS rag_fts USING fts5(
			content, content='rag_chunks', content_rowid='rowid',
			tokenize='unicode61 remove_diacritics 2'
		);
	`);
	handle.run(`
		CREATE TRIGGER IF NOT EXISTS rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN
			INSERT INTO rag_fts(rowid, content) VALUES (new.rowid, new.content);
		END;
	`);
	handle.run(`
		CREATE TRIGGER IF NOT EXISTS rag_chunks_ad AFTER DELETE ON rag_chunks BEGIN
			INSERT INTO rag_fts(rag_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
		END;
	`);
	handle.run(`
		CREATE TRIGGER IF NOT EXISTS rag_chunks_au AFTER UPDATE ON rag_chunks BEGIN
			INSERT INTO rag_fts(rag_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
			INSERT INTO rag_fts(rowid, content) VALUES (new.rowid, new.content);
		END;
	`);
	db = handle;
	return handle;
}

function toBlob(vec: number[] | Float32Array): Uint8Array {
	const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
	return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
}

function fromBlob(blob: Uint8Array): Float32Array {
	// Recopie (pas de vue directe) : le buffer sous-jacent de bun:sqlite peut
	// être réutilisé/libéré entre deux lectures.
	const copy = new Uint8Array(blob.length);
	copy.set(blob);
	return new Float32Array(copy.buffer, 0, blob.length / 4);
}

/** Upsert idempotent (par `id`) d'un lot de chunks. Préserve le rowid → sync FTS via triggers. */
export function upsertChunks(rows: RagChunkRow[]): number {
	if (rows.length === 0) return 0;
	const handle = getDb();
	const stmt = handle.prepare(`
		INSERT INTO rag_chunks (id, source_id, source_kind, title, url, lang, content, meta, content_hash, buildid, embedding, updated_at)
		VALUES ($id, $source_id, $source_kind, $title, $url, $lang, $content, $meta, $content_hash, $buildid, $embedding, $updated_at)
		ON CONFLICT(id) DO UPDATE SET
			source_id = excluded.source_id,
			source_kind = excluded.source_kind,
			title = excluded.title,
			url = excluded.url,
			lang = excluded.lang,
			content = excluded.content,
			meta = excluded.meta,
			content_hash = excluded.content_hash,
			buildid = excluded.buildid,
			embedding = excluded.embedding,
			updated_at = excluded.updated_at
	`);
	const now = Date.now();
	const insertAll = handle.transaction((batch: RagChunkRow[]) => {
		for (const r of batch) {
			stmt.run({
				$id: r.id,
				$source_id: r.source_id,
				$source_kind: r.source_kind,
				$title: r.title,
				$url: r.url,
				$lang: r.lang,
				$content: r.content,
				$meta: JSON.stringify(r.meta ?? {}),
				$content_hash: r.content_hash,
				$buildid: r.buildid,
				$embedding: toBlob(r.embedding),
				$updated_at: now,
			});
		}
	});
	insertAll(rows);
	return rows.length;
}

export function chunkCount(): number {
	const row = getDb().query("SELECT count(*) c FROM rag_chunks").get() as { c: number };
	return row.c;
}

interface CacheEntry {
	sig: string;
	ids: string[];
	kinds: string[];
	vectors: Float32Array; // flat, stride RAG_LOCAL_DIM
}

let cache: CacheEntry | null = null;

function ensureCache(): CacheEntry {
	const handle = getDb();
	const sigRow = handle
		.query("SELECT count(*) c, coalesce(max(updated_at),0) m FROM rag_chunks")
		.get() as { c: number; m: number };
	const sig = `${sigRow.c}:${sigRow.m}`;
	if (cache && cache.sig === sig) return cache;

	const rows = handle
		.query("SELECT id, source_kind, embedding FROM rag_chunks ORDER BY rowid")
		.all() as { id: string; source_kind: string; embedding: Uint8Array }[];
	const ids = new Array<string>(rows.length);
	const kinds = new Array<string>(rows.length);
	const vectors = new Float32Array(rows.length * RAG_LOCAL_DIM);
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;
		ids[i] = row.id;
		kinds[i] = row.source_kind;
		vectors.set(fromBlob(row.embedding), i * RAG_LOCAL_DIM);
	}
	cache = { sig, ids, kinds, vectors };
	return cache;
}

function ftsMatchExpr(query: string): string | null {
	const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
	if (tokens.length === 0) return null;
	return tokens
		.slice(0, 16)
		.map((t) => `"${t.replace(/"/g, '""')}"`)
		.join(" ");
}

const RRF_K = 60;

/** Recherche hybride locale (dense cosine ∥ lexical FTS5, fusion RRF). Remplace la RPC pgvector. */
export function hybridSearch(
	queryEmbedding: number[] | Float32Array,
	queryText: string,
	opts: { k?: number; kinds?: string[] } = {}
): RagChunkResult[] {
	const k = opts.k ?? 10;
	const kindFilter = opts.kinds && opts.kinds.length > 0 ? new Set(opts.kinds) : null;
	const handle = getDb();
	const { ids, kinds, vectors } = ensureCache();
	const qVec = queryEmbedding instanceof Float32Array ? queryEmbedding : Float32Array.from(queryEmbedding);
	const n = ids.length;
	const denseN = Math.min(n, Math.max(k * 5, 50));

	// --- Dense (cosine = dot, vecteurs L2-normalisés) ---
	const denseScored: { idx: number; score: number }[] = [];
	for (let i = 0; i < n; i++) {
		if (kindFilter && !kindFilter.has(kinds[i]!)) continue;
		let dot = 0;
		const base = i * RAG_LOCAL_DIM;
		for (let d = 0; d < RAG_LOCAL_DIM; d++) dot += vectors[base + d]! * qVec[d]!;
		denseScored.push({ idx: i, score: dot });
	}
	denseScored.sort((a, b) => b.score - a.score);
	const denseTop = denseScored.slice(0, denseN);

	// --- Lexicale (FTS5 + bm25) ---
	const matchExpr = ftsMatchExpr(queryText);
	let lexIds: string[] = [];
	if (matchExpr) {
		const kindsSql = kindFilter
			? ` AND rc.source_kind IN (${[...kindFilter].map(() => "?").join(",")})`
			: "";
		// bun:sqlite : MATCH/bm25() doivent référencer le nom réel de la table
		// virtuelle FTS5, pas un alias (sinon "no such column").
		const lexRows = handle
			.query(
				`SELECT rc.id AS id FROM rag_fts JOIN rag_chunks rc ON rc.rowid = rag_fts.rowid
				 WHERE rag_fts MATCH ?${kindsSql} ORDER BY bm25(rag_fts) LIMIT ?`
			)
			.all(matchExpr, ...(kindFilter ? [...kindFilter] : []), denseN) as { id: string }[];
		lexIds = lexRows.map((r) => r.id);
	}

	// --- Fusion RRF ---
	const scoreMap = new Map<string, number>();
	denseTop.forEach((r, rank) => {
		const id = ids[r.idx]!;
		scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
	});
	lexIds.forEach((id, rank) => {
		scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
	});
	const fused = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
	if (fused.length === 0) return [];

	const placeholders = fused.map(() => "?").join(",");
	const fullRows = handle
		.query(
			`SELECT id, source_id, source_kind, title, url, lang, content, meta FROM rag_chunks WHERE id IN (${placeholders})`
		)
		.all(...fused.map(([id]) => id)) as {
		id: string;
		source_id: string;
		source_kind: string;
		title: string | null;
		url: string | null;
		lang: string | null;
		content: string;
		meta: string;
	}[];
	const byId = new Map(fullRows.map((r) => [r.id, r]));
	const scoreById = new Map(fused);
	return fused
		.map(([id]) => byId.get(id))
		.filter((r): r is NonNullable<typeof r> => r != null)
		.map((r) => ({
			id: r.id,
			source_id: r.source_id,
			source_kind: r.source_kind,
			title: r.title,
			url: r.url,
			lang: r.lang,
			content: r.content,
			meta: JSON.parse(r.meta || "{}"),
			score: scoreById.get(r.id) ?? 0,
		}));
}

/** Ferme le handle (tests uniquement). */
export function closeRagStore(): void {
	db?.close();
	db = null;
	cache = null;
}
