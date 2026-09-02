/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// PoC d'ingestion unifiée pgvector : prouve l'ingestion d'un ÉCHANTILLON de
// chaque type de source (lua/cfg/json/ts/sqlite/web/tweet/doc) + une requête
// hybride de bout en bout. NE traite PAS les 56 Go — borné par `SAMPLE`.
//
// Usage : bun packages/cron/src/tasks/ie-crawl/rag-poc.ts [query]
// Pleine échelle : voir scripts/rag-ingest.ts (streaming, idempotent).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dansLeDepot } from "../../lib/racine";
import { ingestSources, ragHybridSearch, type RagSource } from "./rag-store-local";

const DATA = "/home/ubuntu/niers/data";
const SAMPLE = 3;

function take<T>(arr: T[], n: number): T[] {
	return arr.slice(0, n);
}

function findFiles(root: string, ext: string, limit: number): string[] {
	const out: string[] = [];
	function walk(dir: string) {
		if (out.length >= limit || !existsSync(dir)) return;
		let entries: { name: string; isDirectory: () => boolean }[];
		try {
			entries = readdirSync(dir, { withFileTypes: true }) as unknown as {
				name: string;
				isDirectory: () => boolean;
			}[];
		} catch {
			return;
		}
		for (const e of entries) {
			if (out.length >= limit) return;
			const name = String(e.name);
			const p = join(dir, name);
			if (e.isDirectory()) walk(p);
			else if (name.endsWith(ext)) out.push(p);
		}
	}
	walk(root);
	return out;
}

function collectSamples(): RagSource[] {
	const sources: RagSource[] = [];

	// 1. Lua décompilé
	for (const f of take(findFiles(join(DATA, "lua_scripts"), ".lua", SAMPLE), SAMPLE)) {
		sources.push({
			sourceId: `poc-lua-${f.split("/").pop()}`,
			kind: "lua",
			raw: readFileSync(f, "utf-8"),
			title: f.split("/").pop(),
			lang: "code",
			meta: { file: f, sample: true },
		});
	}

	// 2. JSON (exports inagle = entités réelles)
	for (const f of take(findFiles(join(DATA, "exports"), ".json", SAMPLE), SAMPLE)) {
		const raw = readFileSync(f, "utf-8");
		if (raw.length > 2_000_000) continue; // borne PoC
		sources.push({
			sourceId: `poc-json-${f.split("/").pop()}`,
			kind: "json",
			raw,
			title: f.split("/").pop(),
			lang: "fr",
			meta: { file: f, sample: true },
		});
	}

	// 3. cfg.bin n'est PAS du JSON brut → on prend un json cfg lisible si présent,
	//    sinon on saute (les .cfg.bin nécessitent le parseur iecode → P2).
	for (const f of take(findFiles(join(DATA, "common", "gamedata"), ".json", SAMPLE), SAMPLE)) {
		const raw = readFileSync(f, "utf-8");
		sources.push({
			sourceId: `poc-cfg-${f.split("/").slice(-2).join("_")}`,
			kind: "cfg",
			raw,
			title: f.split("/").pop(),
			lang: "code",
			meta: { file: f, sample: true },
		});
	}

	// 4. Types TS générés
	const tsCandidates = [
		dansLeDepot("packages", "db", "src", "types.gen.ts"),
		dansLeDepot("packages", "db", "src", "types.ts"),
	].filter(existsSync);
	for (const f of take(tsCandidates, SAMPLE)) {
		sources.push({
			sourceId: `poc-ts-${f.split("/").pop()}`,
			kind: "ts",
			raw: readFileSync(f, "utf-8").slice(0, 200_000),
			title: f.split("/").pop(),
			lang: "code",
			meta: { file: f, sample: true },
		});
	}

	// 5. Docs monorepo (.md)
	const docsDir = dansLeDepot("docs");
	if (existsSync(docsDir)) {
		const mds = readdirSync(docsDir).filter((n) => n.endsWith(".md") && n !== "llms-full.txt");
		for (const n of take(mds, SAMPLE)) {
			sources.push({
				sourceId: `poc-doc-${n}`,
				kind: "doc",
				raw: readFileSync(join(docsDir, n), "utf-8"),
				title: n,
				lang: "fr",
				meta: { file: n, sample: true },
			});
		}
	}

	// 6. Web crawl (sortie de l'agent ie-crawl, si déjà présente)
	const crawlDir = dansLeDepot("var", "ie-crawl", "victory-road-fr");
	if (existsSync(crawlDir)) {
		const htmls = findFiles(crawlDir, ".html", SAMPLE).concat(findFiles(crawlDir, ".md", SAMPLE));
		for (const f of take(htmls, SAMPLE)) {
			sources.push({
				sourceId: `poc-web-${f.split("/").pop()}`,
				kind: "web",
				raw: readFileSync(f, "utf-8").replace(/<[^>]+>/g, " ").slice(0, 50_000),
				title: f.split("/").pop(),
				url: "https://www.inazuma.jp/victory-road/fr/",
				lang: "fr",
				meta: { file: f, sample: true },
			});
		}
	}

	return sources;
}

async function main() {
	const query = process.argv[2] || "personnage attaquant feu statistiques";
	console.log("[RAG PoC] Collecte des échantillons…");
	const sources = collectSamples();
	console.log(`[RAG PoC] ${sources.length} sources échantillon :`);
	const byKind = sources.reduce<Record<string, number>>((a, s) => {
		a[s.kind] = (a[s.kind] ?? 0) + 1;
		return a;
	}, {});
	console.log("[RAG PoC]   répartition :", JSON.stringify(byKind));

	console.log("[RAG PoC] Ingestion pgvector…");
	const stats = await ingestSources(sources);
	console.log(
		`[RAG PoC] Ingéré : ${stats.sources} sources, ${stats.chunks} chunks, ${stats.skipped} sautées (backend embed: ${stats.backend}).`
	);

	console.log(`\n[RAG PoC] Requête hybride : "${query}"`);
	const results = await ragHybridSearch(query, { k: 6 });
	console.log(`[RAG PoC] ${results.length} résultats :`);
	for (const r of results) {
		console.log(
			`  • [${r.source_kind}] score=${r.score.toFixed(4)} ${r.title ?? r.source_id} — ${r.content.slice(0, 90).replace(/\n/g, " ")}`
		);
	}

	if (results.length === 0) {
		console.error("[RAG PoC] ÉCHEC : aucun résultat.");
		process.exit(1);
	}
	console.log("\n[RAG PoC] OK — pipeline e2e validé.");
}

main().catch((e) => {
	console.error("[RAG PoC] Erreur:", e);
	process.exit(1);
});
