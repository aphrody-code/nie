/**
 * Smart Search Module - Azalee
 *
 * Unified export for all search utilities
 */

// Fuzzy matching utilities
export {
	detectMatchedLanguage,
	findClosestMatch,
	getNameVariations,
	highlightMatches,
	isSimilar,
	levenshteinDistance,
	normalizeText,
	similarityScore,
} from "./fuzzy-match";

// Smart search service
export {
	clearSearchCache,
	getCacheStats,
	type SearchContext,
	type SmartSearchConfig,
	type SmartSearchResult,
	smartSearch,
} from "./smart-search";
