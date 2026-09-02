/**
 * Smart Search Service - Context-aware, multilingual search with caching
 *
 * Features:
 * - Multilingual search (FR/EN/JP)
 * - Context-aware prioritization based on page
 * - Fuzzy matching with "did you mean" suggestions
 * - Request cancellation and debouncing
 * - Result caching
 */

import { detectMatchedLanguage, findClosestMatch } from "./fuzzy-match";

export type SearchableType =
	| "basara"
	| "character"
	| "skill"
	| "item"
	| "tactic"
	| "keshin"
	| "soul"
	| "miximax"
	| "awakening"
	| "modechange"
	| "aura"
	| "team"
	| "article"
	| "patchnote"
	| "passive"
	| "tweet"
	| "re"
	| "cross"
	| "level5"
	| "topic"
	| "doc";

export interface GlobalSearchResult {
	id: string;
	name: string;
	type: SearchableType;
	score: number;
	data: Record<string, unknown> | null;
}

/** Enhanced search result with language detection and suggestions */
export interface SmartSearchResult extends GlobalSearchResult {
	/** Language that matched (FR/EN/JP) */
	matchedLanguage?: "FR" | "EN" | "JP";
	/** Alternative name in matched language */
	matchedName?: string;
	/** "Did you mean?" suggestion if no exact match */
	suggestion?: string;
}

/** Search context for prioritization */
export type SearchContext =
	| "chara"
	| "skill"
	| "team"
	| "aura"
	| "passive"
	| "tactic"
	| "global"
	| "item"
	| "news"
	| "patchnotes";

/** Search configuration */
export interface SmartSearchConfig {
	/** Context for result prioritization */
	context?: SearchContext;
	/** Maximum results to return */
	limit?: number;
	/** Enable fuzzy suggestions */
	enableSuggestions?: boolean;
	/** Minimum score threshold */
	minScore?: number;
}

/** Cache entry with TTL */
interface CacheEntry {
	results: SmartSearchResult[];
	timestamp: number;
}

/** Search result cache (5 minute TTL) */
const CACHE_TTL = 5 * 60 * 1000;
const searchCache = new Map<string, CacheEntry>();

/**
 * Clé de cache : elle doit couvrir TOUTE option qui change la sortie.
 *
 * `minScore` et `enableSuggestions` manquaient : deux appels de même requête et
 * même contexte mais de seuils différents partageaient une entrée, et le second
 * récupérait silencieusement les résultats filtrés du premier.
 */
function getCacheKey(query: string, config: SmartSearchConfig): string {
	return [
		query,
		config.context || "global",
		config.limit || 20,
		config.minScore ?? 0,
		config.enableSuggestions === false ? "0" : "1",
	].join(":");
}

/**
 * Get cached results if valid
 */
function getCachedResults(query: string, config: SmartSearchConfig): SmartSearchResult[] | null {
	const key = getCacheKey(query, config);
	const entry = searchCache.get(key);

	if (!entry) {
		return null;
	}

	const age = Date.now() - entry.timestamp;
	if (age > CACHE_TTL) {
		searchCache.delete(key);
		return null;
	}

	return entry.results;
}

/**
 * Cache search results
 */
function cacheResults(
	query: string,
	config: SmartSearchConfig,
	results: SmartSearchResult[]
): void {
	const key = getCacheKey(query, config);
	searchCache.set(key, {
		results,
		timestamp: Date.now(),
	});

	// Cleanup old entries (prevent memory leak)
	if (searchCache.size > 100) {
		const now = Date.now();
		for (const [k, entry] of searchCache.entries()) {
			if (now - entry.timestamp > CACHE_TTL) {
				searchCache.delete(k);
			}
		}
	}
}

/**
 * Map search context to prioritized types
 */
const CONTEXT_PRIORITY: Record<SearchContext, SearchableType[]> = {
	aura: ["keshin", "soul", "miximax", "awakening", "modechange", "aura"],
	chara: ["basara", "character"],
	global: [
		"basara",
		"character",
		"skill",
		"keshin",
		"soul",
		"miximax",
		"awakening",
		"modechange",
		"aura",
		"item",
		"tactic",
		"team",
		"article",
		"patchnote",
		"tweet",
		"re",
		"cross",
		"level5",
		"topic",
		"doc",
	],
	item: ["item", "tactic"],
	news: ["article", "patchnote", "tweet", "level5", "topic"],
	passive: ["passive"],
	patchnotes: ["patchnote", "article", "tweet", "topic"],
	skill: ["skill"],
	tactic: ["tactic", "item"],
	team: ["team", "character", "basara"],
};

/**
 * Prioritize results based on search context
 */
function prioritizeResults(
	results: SmartSearchResult[],
	context: SearchContext
): SmartSearchResult[] {
	const priorities = CONTEXT_PRIORITY[context];

	return results.toSorted((a, b) => {
		// First sort by type priority
		const aPriority = priorities.indexOf(a.type);
		const bPriority = priorities.indexOf(b.type);

		if (aPriority !== bPriority) {
			if (aPriority === -1) {
				return 1;
			}
			if (bPriority === -1) {
				return -1;
			}
			return aPriority - bPriority;
		}

		// Then by score
		return b.score - a.score;
	});
}

/**
 * Enhance search results with language detection
 */
function enhanceResults(results: GlobalSearchResult[], query: string): SmartSearchResult[] {
	return results.map((result) => {
		const enhanced: SmartSearchResult = { ...result };

		// Detect matched language for multilingual items
		if (result.data && typeof result.data === "object") {
			const data = result.data as Record<string, unknown>;

			// For BASARA/Characters
			if (data.names && typeof data.names === "object") {
				const names = data.names as Record<string, string>;
				const matchedLang = detectMatchedLanguage(query, names);
				if (matchedLang) {
					enhanced.matchedLanguage = matchedLang;
					// `detectMatchedLanguage` renvoie "JP" mais la clé de l'objet est
					// `ja` : sans ce mapping, un match japonais retombait toujours sur
					// `result.name` (le nom FR) au lieu du nom japonais.
					const langKey = matchedLang === "JP" ? "ja" : (matchedLang.toLowerCase() as "fr" | "en");
					enhanced.matchedName = names[langKey] || result.name;
				}
			}

			// For Skills (uppercase keys from sheet_data)
			if (data.name_FR || data.name_EN || data.name_JA) {
				const matchedLang = detectMatchedLanguage(query, {
					en: data.name_EN as string,
					fr: data.name_FR as string,
					ja: data.name_JA as string,
				});
				if (matchedLang) {
					enhanced.matchedLanguage = matchedLang;
					const langKey = `name_${matchedLang === "JP" ? "JA" : matchedLang}` as
						| "name_FR"
						| "name_EN"
						| "name_JA";
					enhanced.matchedName = (data[langKey] as string) || result.name;
				}
			}

			// For auras, teams, items with lowercase keys (name_fr/name_en/name_ja)
			if (data.name_fr || data.name_en || data.name_ja) {
				const matchedLang = detectMatchedLanguage(query, {
					en: data.name_en as string,
					fr: data.name_fr as string,
					ja: data.name_ja as string,
				});
				if (matchedLang) {
					enhanced.matchedLanguage = matchedLang;
					const langKey = `name_${matchedLang === "JP" ? "ja" : matchedLang.toLowerCase()}`;
					enhanced.matchedName = (data[langKey] as string) || result.name;
				}
			}
		}

		return enhanced;
	});
}

/**
 * Generate "did you mean?" suggestions from all available names
 */
function generateSuggestions(query: string, allResults: GlobalSearchResult[]): string | undefined {
	// Collect all searchable names
	const allNames: string[] = [];

	for (const result of allResults) {
		if (result.data && typeof result.data === "object") {
			const data = result.data as Record<string, unknown>;

			// Noms multilingues — on pousse les valeurs BRUTES : `findClosestMatch`
			// normalise déjà les deux côtés pour le score, et la suggestion est
			// affichée telle quelle à l'utilisateur. Avec `getNameVariations` (qui
			// normalise), la suggestion sortait en minuscules sans accents
			// (« l'etoffe des heros » au lieu de « L'Étoffe des Héros »).
			if (data.names && typeof data.names === "object") {
				for (const value of Object.values(data.names as Record<string, unknown>)) {
					if (typeof value === "string" && value.length > 0) allNames.push(value);
				}
			}
			if (typeof data.name_FR === "string") {
				allNames.push(data.name_FR);
			}
			if (typeof data.name_EN === "string") {
				allNames.push(data.name_EN);
			}
			if (typeof data.name_JA === "string") {
				allNames.push(data.name_JA);
			}
		}
	}

	// Find closest match
	const closest = findClosestMatch(query, allNames, 0.6);
	return closest?.match;
}

/**
 * Smart search with context awareness and language detection
 */
export async function smartSearch(
	query: string,
	rawResults: GlobalSearchResult[],
	config: SmartSearchConfig = {}
): Promise<SmartSearchResult[]> {
	const { context = "global", limit = 20, enableSuggestions = true, minScore = 0 } = config;

	// Check cache first
	const cached = getCachedResults(query, config);
	if (cached) {
		return cached;
	}

	// Enhance results with language detection
	let results = enhanceResults(rawResults, query);

	// Filter by minimum score
	if (minScore > 0) {
		results = results.filter((r) => r.score >= minScore);
	}

	// Prioritize by context
	results = prioritizeResults(results, context);

	// Limit results
	results = results.slice(0, limit);

	// Add suggestions if no results
	if (results.length === 0 && enableSuggestions) {
		const suggestion = generateSuggestions(query, rawResults);
		if (suggestion) {
			// Return empty results with suggestion metadata
			results = [
				{
					data: null,
					id: "",
					name: "",
					score: 0,
					suggestion,
					type: "character",
				} as SmartSearchResult,
			];
		}
	}

	// Cache results
	cacheResults(query, config, results);

	return results;
}

/**
 * Clear search cache (useful for testing or manual cache invalidation)
 */
export function clearSearchCache(): void {
	searchCache.clear();
}

/**
 * Get cache statistics (for debugging)
 */
export function getCacheStats() {
	return {
		entries: Array.from(searchCache.entries()).map(([key, entry]) => ({
			key,
			age: Date.now() - entry.timestamp,
			resultCount: entry.results.length,
		})),
		size: searchCache.size,
	};
}
