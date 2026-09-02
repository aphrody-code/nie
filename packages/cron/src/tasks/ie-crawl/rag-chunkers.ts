/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Chunkers spécialisés par type de source (cf. UNIFIED-RAG-PLAN §4.1).
// Un découpage naïf ne convient pas à lua/json/ts/sqlite : chaque type a une
// granularité sémantique propre (fonction, entité, déclaration, ligne).

import { chunkText } from "./rag-utils";
import { formatTweetForRag } from "@rosegriffon/db/rag";

export type SourceKind =
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

export interface Chunk {
	/** Index local du chunk dans la source. */
	index: number;
	/** Texte du chunk (ce qui sera embeddé). */
	content: string;
	/** Symbole/clé/ligne d'origine, si pertinent. */
	symbol?: string;
}

/** Lua : découpe par bloc `function … end` (fallback récursif générique). */
export function chunkLua(src: string): Chunk[] {
	const chunks: Chunk[] = [];
	// Capture grossière des blocs de fonction (nom + corps jusqu'au `end` de même niveau approx).
	const fnRegex = /(?:^|\n)\s*(?:local\s+)?function\s+([\w.:]+)?\s*\([^)]*\)([\s\S]*?)\n\s*end/g;
	let m: RegExpExecArray | null;
	let i = 0;
	while ((m = fnRegex.exec(src)) !== null) {
		const symbol = m[1] || `fn_${i}`;
		const body = (m[0] || "").trim();
		if (body.length > 30) {
			chunks.push({ index: i++, content: body, symbol });
		}
	}
	if (chunks.length === 0) {
		// Pas de fonctions détectées (table de données) → chunker générique.
		return chunkText(src, 800, 120).map((content, index) => ({ index, content }));
	}
	return chunks;
}

/** JSON/cfg : 1 chunk par entrée racine (entité), sérialisée compacte. */
export function chunkJsonEntities(raw: string, maxEntries = 200): Chunk[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return chunkText(raw, 800, 100).map((content, index) => ({ index, content }));
	}

	const flat = (key: string, val: unknown): string => {
		const json = JSON.stringify(val);
		return `${key}: ${json.length > 1500 ? json.slice(0, 1500) + "…" : json}`;
	};

	const chunks: Chunk[] = [];
	if (Array.isArray(parsed)) {
		for (let i = 0; i < parsed.length && i < maxEntries; i++) {
			chunks.push({ index: i, content: flat(`[${i}]`, parsed[i]), symbol: String(i) });
		}
	} else if (parsed && typeof parsed === "object") {
		const entries = Object.entries(parsed as Record<string, unknown>);
		for (let i = 0; i < entries.length && i < maxEntries; i++) {
			const [k, v] = entries[i]!;
			chunks.push({ index: i, content: flat(k, v), symbol: k });
		}
	} else {
		chunks.push({ index: 0, content: String(parsed) });
	}
	return chunks;
}

/** TS : 1 chunk par déclaration top-level (interface/type/enum/function/const). */
export function chunkTs(src: string): Chunk[] {
	const declRegex =
		/(?:^|\n)export?\s*(?:declare\s+)?(?:interface|type|enum|function|const|class)\s+([\w$]+)[\s\S]*?(?=\n(?:export|declare|interface|type|enum|function|const|class)\b|$)/g;
	const chunks: Chunk[] = [];
	let m: RegExpExecArray | null;
	let i = 0;
	while ((m = declRegex.exec(src)) !== null) {
		const content = (m[0] || "").trim();
		if (content.length > 20) chunks.push({ index: i++, content, symbol: m[1] });
	}
	if (chunks.length === 0) {
		return chunkText(src, 700, 100).map((content, index) => ({ index, content }));
	}
	return chunks;
}

/** SQLite/row : un objet ligne → texte « champ: valeur ». */
export function chunkSqliteRow(row: Record<string, unknown>, rowId: string): Chunk {
	const content = Object.entries(row)
		.filter(([, v]) => v !== null && v !== undefined && v !== "")
		.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
		.join("\n");
	return { index: 0, content, symbol: rowId };
}

/** Texte long (web/doc/tweet) → chunker récursif générique. */
export function chunkProse(text: string, size = 800, overlap = 150): Chunk[] {
	return chunkText(text, size, overlap).map((content, index) => ({ index, content }));
}

/** Markdown : découpe par sections (#, ##, ###) en préservant le contexte complet des titres parents (breadcrumbs) et la structure des tables et blocs de code lors d'un découpage. */
export function chunkMarkdown(src: string, maxChunkSize = 800): Chunk[] {
	const lines = src.split("\n");
	const chunks: Chunk[] = [];
	const headerStack: string[] = [];
	let currentChunk = "";
	let chunkIndex = 0;

	let inCodeBlock = false;
	let codeBlockLang = "";
	let inTable = false;
	let tableHeaderLines: string[] = [];

	const getContextPrefix = () => {
		const path = headerStack.filter(Boolean).join(" > ");
		return path ? `Contexte: ${path}\n\n` : "";
	};

	const getCurrentHeader = () => {
		return headerStack[headerStack.length - 1] || "";
	};

	for (const line of lines) {
		// Détection de début/fin de code block
		const codeBlockMatch = line.match(/^\s*```(\w+)?/);
		if (codeBlockMatch) {
			inCodeBlock = !inCodeBlock;
			codeBlockLang = inCodeBlock ? (codeBlockMatch[1] || "") : "";
		}

		// Détection de ligne de table
		const isTableLine = line.match(/^\s*\|/);
		if (isTableLine) {
			if (!inTable) {
				inTable = true;
				tableHeaderLines = [];
			}
			if (tableHeaderLines.length < 2) {
				tableHeaderLines.push(line);
			}
		} else if (inTable) {
			inTable = false;
			tableHeaderLines = [];
		}

		const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
		if (headerMatch) {
			if (currentChunk.trim().length > 10) {
				let chunkContent = currentChunk.trim();
				if (inCodeBlock) {
					chunkContent += "\n```";
				}
				chunks.push({
					index: chunkIndex++,
					content: getContextPrefix() + chunkContent,
					symbol: getCurrentHeader() || undefined,
				});
			}

			// Réinitialisation de la table/codeblock si on change de section
			inTable = false;
			tableHeaderLines = [];
			
			const level = headerMatch[1]!.length;
			const title = headerMatch[2]!.trim();
			
			// Ajuster la pile d'en-têtes au niveau actuel
			headerStack[level - 1] = title;
			headerStack.length = level;
			
			currentChunk = (inCodeBlock ? `\`\`\`${codeBlockLang}\n` : "") + line + "\n";
		} else {
			if (currentChunk.length + line.length > maxChunkSize && currentChunk.trim().length > 10) {
				let chunkContent = currentChunk.trim();
				if (inCodeBlock) {
					chunkContent += "\n```";
				}
				chunks.push({
					index: chunkIndex++,
					content: getContextPrefix() + chunkContent,
					symbol: getCurrentHeader() || undefined,
				});

				// Préparer le début du nouveau chunk avec les entêtes structurels
				if (inCodeBlock) {
					currentChunk = `\`\`\`${codeBlockLang}\n`;
				} else if (inTable && tableHeaderLines.length >= 2) {
					currentChunk = tableHeaderLines.join("\n") + "\n";
				} else {
					currentChunk = "";
				}
			}
			currentChunk += line + "\n";
		}
	}

	if (currentChunk.trim().length > 10) {
		let chunkContent = currentChunk.trim();
		if (inCodeBlock) {
			chunkContent += "\n```";
		}
		chunks.push({
			index: chunkIndex++,
			content: getContextPrefix() + chunkContent,
			symbol: getCurrentHeader() || undefined,
		});
	}

	if (chunks.length === 0) {
		return chunkText(src, maxChunkSize, 120).map((content, index) => ({ index, content }));
	}

	return chunks;
}

/**
 * Chunker tweet spécialisé (additif, cf. UNIFIED-RAG-PLAN §4.1).
 * Enrichit avec auteur/date/métriques/médias/liens pour meilleur contexte RAG (pas seulement le texte brut).
 * Accepte string (compat ancien) ou objet structuré (depuis table tweets ou bxc Tweet).
 * Retourne 1 chunk par tweet (tweets + threads restent courts).
 */
export function chunkTweet(
	input:
		| string
		| {
				id?: string;
				text?: string;
				author_username?: string;
				author_name?: string;
				created_at?: string;
				metrics?: Record<string, unknown> | null;
				media?: Array<Record<string, unknown>> | null;
				url?: string;
		  }
): Chunk[] {
	let content: string;
	let symbol: string | undefined;

	if (typeof input === "string") {
		// Compat: raw string déjà formaté ou texte seul.
		content = input;
	} else {
		const t = input;
		const mediaUrls = Array.isArray(t.media)
			? t.media
					.map((m: any) => m?.url || m?.preview_url || m?.expanded_url)
					.filter(Boolean)
					.slice(0, 4)
					.join(" ")
			: "";
		symbol = t.id;
		// Utilise le formatter partagé (db/rag) pour le corps enrichi (auteur/date/métriques/texte) + media/urls.
		const base = formatTweetForRag({
			id: t.id || "",
			author_username: t.author_username,
			author_name: t.author_name,
			text: t.text,
			created_at: t.created_at,
			metrics: t.metrics,
			media: t.media,
		});
		content = t.url && !base.includes(t.url) ? `${base}\nurl: ${t.url}` : base;
		if (mediaUrls && !content.includes((mediaUrls.split(" ")[0] || ""))) {
			content = `${content}\nmedia: ${mediaUrls}`;
		}
	}

	if (!content.trim()) return [];
	return [{ index: 0, content: content.trim(), symbol }];
}

/** Dispatch par type de source. */
export function chunkBySource(kind: SourceKind, raw: string): Chunk[] {
	switch (kind) {
		case "lua":
			return chunkLua(raw);
		case "cfg":
		case "json":
			return chunkJsonEntities(raw);
		case "ts":
			return chunkTs(raw);
		case "code":
			return chunkProse(raw, 900, 120);
		case "text":
			// Texte de jeu (noms/descriptions/dialogues) : prose courte.
			return chunkProse(raw, 700, 100);
		case "tweet":
			// Utilise le chunker enrichi (raw peut être string formaté ou JSON stringifié).
			try {
				if (raw.trim().startsWith("{")) {
					return chunkTweet(JSON.parse(raw));
				}
			} catch {}
			return chunkTweet(raw);
		case "doc":
		case "web":
		default:
			if (raw.includes("# ") || raw.includes("## ")) {
				return chunkMarkdown(raw);
			}
			return chunkProse(raw);
	}
}
