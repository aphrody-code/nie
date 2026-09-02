/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable import/no-duplicates */
import { Browser } from "@aphrody-code/bxc";
import { googleWebSearch } from "@aphrody-code/bxc/google";
import { extractTitle, htmlToMarkdown } from "@aphrody-code/bxc/internal/html-utils";

// Grounding web live pour le RAG. Reproduit l'actor `rag-web-browser` de bxc
// (Google Search → fetch → markdown token-optimisé pour LLM) À PARTIR DES
// PRIMITIVES EXPORTÉES de `@aphrody-code/bxc` : `googleWebSearch`, `Browser`
// (profil `http` = curl-impersonate, sans navigateur) et `htmlToMarkdown`.
//
// L'actor lui-même (`src/actors/rag-web-browser/main.ts`) n'est PAS exporté
// comme fonction (`runScraper` privé, hors `exports` map) et ne tourne qu'en
// tant qu'actor via `Actor.getInput()` (stockage Apify) — non importable. On
// recompose donc son comportement avec ses briques publiques, ce qui reste
// importable et testable depuis le cron.

export interface RagWebDoc {
	url: string;
	title: string;
	markdown: string;
	rank: number;
}

export interface RagWebOptions {
	/** Nombre maximal de résultats organiques à extraire. */
	maxResults?: number;
	/** Profil de scraping bxc. `http` = curl-impersonate (défaut, léger). */
	profile?: "static" | "fast" | "http" | "stealth" | "max";
	/** Langue Google (défaut `fr`). */
	hl?: string;
	/** Région Google (défaut `FR`). */
	gl?: string;
	/** Longueur minimale du markdown pour conserver un document. */
	minMarkdownLength?: number;
}

function isUrl(value: string): boolean {
	return /^https?:\/\//i.test(value.trim());
}

async function fetchMarkdown(
	url: string,
	rank: number,
	profile: NonNullable<RagWebOptions["profile"]>,
	minLength: number
): Promise<RagWebDoc | null> {
	const page = await Browser.newPage({ profile });
	try {
		await page.goto(url);
		const html = await page.content();
		const markdown = htmlToMarkdown(html).trim();
		if (markdown.length < minLength) return null;
		return { url, title: extractTitle(html) || url, markdown, rank };
	} finally {
		await page.close();
	}
}

/**
 * Recherche web + extraction markdown pour ancrer le RAG sur des sources live.
 * `query` peut être des mots-clés Google OU une URL directe.
 */
export async function ragWebSearch(query: string, opts: RagWebOptions = {}): Promise<RagWebDoc[]> {
	const maxResults = opts.maxResults ?? 3;
	const profile = opts.profile ?? "http";
	const minLength = opts.minMarkdownLength ?? 50;

	let targets: Array<{ url: string; rank: number }>;
	if (isUrl(query)) {
		targets = [{ url: query.trim(), rank: 1 }];
	} else {
		console.log(`[RAG Web] Recherche Google : "${query}" (max ${maxResults})`);
		const organic = await googleWebSearch(query, {
			num: maxResults,
			hl: opts.hl ?? "fr",
			gl: opts.gl ?? "FR",
		});
		targets = (organic as any[])
			.slice(0, maxResults)
			.map((r: any, i: number) => ({ url: (r as { url?: string }).url ?? "", rank: i + 1 }))
			.filter((t: { url: string; rank: number }) => t.url);
	}

	const docs: RagWebDoc[] = [];
	for (const t of targets) {
		try {
			const doc = await fetchMarkdown(t.url, t.rank, profile, minLength);
			if (doc) docs.push(doc);
		} catch (err) {
			console.warn(`[RAG Web] Échec ${t.url} :`, err instanceof Error ? err.message : err);
		}
	}
	return docs;
}
