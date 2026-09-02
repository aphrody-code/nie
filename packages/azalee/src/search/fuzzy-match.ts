/**
 * Fuzzy Matching & Levenshtein Distance for Search
 *
 * Provides typo-tolerant search with "Did you mean?" suggestions
 */

import { isKana, toKatakana } from "wanakana";

/** Convert romaji to katakana, returning null if the result contains non-kana characters */
function romajiToKatakanaCache(input: string): string | null {
	const kata = toKatakana(input);
	if (kata.length === 0) {
		return null;
	}
	const allKana = [...kata].every((c) => isKana(c) || c === "ー");
	return allKana ? kata : null;
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching and "did you mean" suggestions
 */
export function levenshteinDistance(a: string, b: string): number {
	const aLen = a.length;
	const bLen = b.length;

	if (aLen === 0) {
		return bLen;
	}
	if (bLen === 0) {
		return aLen;
	}

	// Create distance matrix
	const matrix: number[][] = Array(aLen + 1)
		.fill(null)
		.map(() => Array(bLen + 1).fill(0));

	// Initialize first row and column
	for (let i = 0; i <= aLen; i++) {
		matrix[i][0] = i;
	}
	for (let j = 0; j <= bLen; j++) {
		matrix[0][j] = j;
	}

	// Calculate distances
	for (let i = 1; i <= aLen; i++) {
		for (let j = 1; j <= bLen; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1, // Deletion
				matrix[i][j - 1] + 1, // Insertion
				matrix[i - 1][j - 1] + cost // Substitution
			);
		}
	}

	return matrix[aLen][bLen];
}

/**
 * Calculate similarity score (0-1) based on Levenshtein distance
 */
export function similarityScore(a: string, b: string): number {
	const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
	const maxLen = Math.max(a.length, b.length);
	return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

/**
 * Check if two strings are similar enough for fuzzy matching
 * @param threshold - Minimum similarity (0-1), default 0.7
 */
export function isSimilar(a: string, b: string, threshold = 0.7): boolean {
	return similarityScore(a, b) >= threshold;
}

/**
 * Normalize text for comparison (lowercase, remove accents)
 */
export function normalizeText(text: string): string {
	return text
		.normalize("NFD")
		.replaceAll(/[\u0300-\u036F]/g, "") // Remove accents
		.toLowerCase()
		.trim();
}

/**
 * Find closest match from a list of candidates
 * Returns { match: string, score: number } or null if no good match
 */
export function findClosestMatch(
	query: string,
	candidates: string[],
	threshold = 0.6
): { match: string; score: number } | null {
	const normalizedQuery = normalizeText(query);
	let bestMatch: { match: string; score: number } | null = null;

	for (const candidate of candidates) {
		const normalizedCandidate = normalizeText(candidate);
		const score = similarityScore(normalizedQuery, normalizedCandidate);

		if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
			bestMatch = { match: candidate, score };
		}
	}

	return bestMatch;
}

/**
 * Extract all searchable text variations from multilingual name object
 */
export function getNameVariations(names: {
	fr?: string | null;
	en?: string | null;
	ja?: string | null;
}): string[] {
	return [names.fr, names.en, names.ja]
		.filter((name): name is string => Boolean(name))
		.map(normalizeText);
}

/**
 * Detect which language matched the query.
 * Also detects romaji input matching Japanese names via katakana conversion.
 */
export function detectMatchedLanguage(
	query: string,
	names: {
		fr?: string | null;
		en?: string | null;
		ja?: string | null;
	}
): "FR" | "EN" | "JP" | null {
	const normalizedQuery = normalizeText(query);

	if (names.fr && normalizeText(names.fr).includes(normalizedQuery)) {
		return "FR";
	}
	if (names.en && normalizeText(names.en).includes(normalizedQuery)) {
		return "EN";
	}
	if (names.ja && normalizeText(names.ja).includes(normalizedQuery)) {
		return "JP";
	}

	// Romaji → katakana: if query converts to valid kana that matches name_ja, it's a JP match
	if (names.ja && romajiToKatakanaCache) {
		const kata = romajiToKatakanaCache(normalizedQuery);
		if (kata && names.ja.includes(kata)) {
			return "JP";
		}
	}

	// Fuzzy match fallback
	if (names.fr && isSimilar(normalizedQuery, normalizeText(names.fr))) {
		return "FR";
	}
	if (names.en && isSimilar(normalizedQuery, normalizeText(names.en))) {
		return "EN";
	}
	if (names.ja && isSimilar(normalizedQuery, normalizeText(names.ja))) {
		return "JP";
	}

	return null;
}

/**
 * Highlight matching parts of text (for UI rendering)
 * Returns array of { text: string, highlight: boolean }
 */
export function highlightMatches(
	text: string,
	query: string
): Array<{ text: string; highlight: boolean }> {
	if (!query) {
		return [{ text, highlight: false }];
	}

	const normalizedText = normalizeText(text);
	const normalizedQuery = normalizeText(query);

	const index = normalizedText.indexOf(normalizedQuery);
	if (index === -1) {
		return [{ text, highlight: false }];
	}

	const parts: Array<{ text: string; highlight: boolean }> = [];

	if (index > 0) {
		parts.push({ highlight: false, text: text.slice(0, index) });
	}

	parts.push({
		highlight: true,
		text: text.slice(index, index + query.length),
	});

	if (index + query.length < text.length) {
		parts.push({
			highlight: false,
			text: text.slice(index + query.length),
		});
	}

	return parts;
}
