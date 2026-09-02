/**
 * Global Search - Unified fuzzy search across all game data
 *
 * Uses uFuzzy for ultra-fast, typo-tolerant search with optimized ranking.
 *
 * Ranking prioritization:
 * 1. Exact prefix match (e.g., "End" → "Endou" first)
 * 2. Contiguous character runs (fewer gaps = better)
 * 3. Earlier match position in string
 * 4. Shorter result strings (more specific matches)
 */

import uFuzzy from "@leeoniya/ufuzzy";
import type { EnrichedBasara } from "../basara/api.js";
import type { EnrichedCharacter } from "../characters/api.js";
import type { ParsedItem } from "../parsers/item-config.js";
import type { EnrichedAuraSkill, EnrichedPassiveSkill, EnrichedSkill } from "../skills/api.js";

/** Search result with score */
export interface SearchResult<T> {
	item: T;
	score: number;
	matches: number[];
}

/** Search configuration */
export interface SearchConfig {
	/** Maximum results to return */
	limit?: number;
	/** Minimum score threshold (0-1) */
	minScore?: number;
	/** Sort by score descending */
	sortByScore?: boolean;
}

const DEFAULT_CONFIG: Required<SearchConfig> = {
	limit: 50,
	minScore: 0,
	sortByScore: true,
};

/**
 * Optimized uFuzzy options for character/skill name search
 */
const UFUZZY_OPTIONS: uFuzzy.Options = {
	intraMode: 1,
	intraIns: 1,
	intraSub: 1,
	intraTrn: 1,
	intraDel: 1,
	interIns: 2,
	interLft: 2,
	sort: (info, haystack, query) => {
		const queryLower = query.toLowerCase();
		const scored: Array<{ idx: number; score: number }> = [];

		for (let i = 0; i < info.idx.length; i++) {
			const haystackIdx = info.idx[i];
			const hay = haystack[haystackIdx].toLowerCase();
			const ranges = info.ranges[i];
			let score = 0;

			if (hay.startsWith(queryLower) || hay.split(/\s+/).some((w) => w.startsWith(queryLower))) {
				score += 1000;
			}

			if (ranges && ranges.length >= 2) {
				let gapCount = 0;
				for (let j = 2; j < ranges.length; j += 2) {
					const prevEnd = ranges[j - 1];
					const currStart = ranges[j];
					if (currStart > prevEnd + 1) gapCount++;
				}
				score += 500 - gapCount * 100;
			}

			const firstMatchPos = ranges?.[0] ?? Number.POSITIVE_INFINITY;
			score += 300 - Math.min(firstMatchPos, 30) * 10;
			score += 200 - Math.min(hay.length, 50) * 2;

			scored.push({ idx: i, score });
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.map((s) => s.idx);
	},
};

/**
 * Create a fuzzy search index for any collection
 */
export function createSearchIndex<T>(
	items: T[],
	getSearchableText: (item: T) => string
): {
	search: (query: string, config?: SearchConfig) => SearchResult<T>[];
	reindex: (newItems: T[]) => void;
} {
	let haystack: string[] = items.map(getSearchableText);
	let currentItems = items;

	const uf = new uFuzzy(UFUZZY_OPTIONS);

	return {
		search: (query: string, config?: SearchConfig): SearchResult<T>[] => {
			const cfg = { ...DEFAULT_CONFIG, ...config };

			if (!query.trim()) {
				return currentItems.slice(0, cfg.limit).map((item) => ({
					item,
					score: 1,
					matches: [],
				}));
			}

			const [idxs, info, order] = uf.search(haystack, query);

			if (!idxs || idxs.length === 0) {
				return [];
			}

			const results: SearchResult<T>[] = [];
			const indices = order ? order.map((i) => idxs[i]) : idxs;

			for (let i = 0; i < Math.min(indices.length, cfg.limit); i++) {
				const idx = indices[i];
				const score = info ? 1 / (1 + (info.idx?.[i] || 0)) : 0.5;

				if (score >= cfg.minScore) {
					results.push({
						item: currentItems[idx],
						score,
						matches: info?.ranges?.[i] || [],
					});
				}
			}

			if (cfg.sortByScore) {
				results.sort((a, b) => b.score - a.score);
			}

			return results;
		},

		reindex: (newItems: T[]) => {
			currentItems = newItems;
			haystack = newItems.map(getSearchableText);
		},
	};
}

/** Searchable entry type */
export type SearchableType =
	| "basara"
	| "character"
	| "skill"
	| "aura"
	| "passive"
	| "team"
	| "item";

/** Global search result */
export interface GlobalSearchResult {
	type: SearchableType;
	id: string;
	name: string;
	score: number;
	data: unknown;
	slug?: string;
}

/**
 * Create a global search API across all data types
 */
export function createGlobalSearch(dataSources: {
	basara?: EnrichedBasara[];
	characters?: EnrichedCharacter[];
	skills?: EnrichedSkill[];
	auras?: EnrichedAuraSkill[];
	passives?: EnrichedPassiveSkill[];
	items?: ParsedItem[];
}) {
	// Create indexes for each data source
	const indexes = {
		basara: dataSources.basara
			? createSearchIndex(dataSources.basara, (b) =>
					[b.names.fr, b.names.en, b.names.ja, b.internalCode].join(" ")
				)
			: null,
		characters: dataSources.characters
			? createSearchIndex(dataSources.characters, (c) =>
					[c.names.fr, c.names.en, c.names.ja, c.charaId].filter(Boolean).join(" ")
				)
			: null,
		skills: dataSources.skills
			? createSearchIndex(dataSources.skills, (s) =>
					[s.name_FR, s.name_EN, s.name_JA, s.skillIDStr].filter(Boolean).join(" ")
				)
			: null,
		auras: dataSources.auras
			? createSearchIndex(dataSources.auras, (a) =>
					[a.displayName, a.name_FR, a.auraIdStr].filter(Boolean).join(" ")
				)
			: null,
		passives: dataSources.passives
			? createSearchIndex(dataSources.passives, (p) =>
					[p.displayName, p.name_FR, p.desc_FR, p.passiveIdStr].filter(Boolean).join(" ")
				)
			: null,
		items: dataSources.items
			? createSearchIndex(dataSources.items, (i) =>
					[i.name, i.names?.fr, i.names?.en, i.internalCode].filter(Boolean).join(" ")
				)
			: null,
	};

	return {
		/** Search only BASARA */
		basara: (query: string, config?: SearchConfig) => indexes.basara?.search(query, config) || [],

		/** Search only characters */
		characters: (query: string, config?: SearchConfig) =>
			indexes.characters?.search(query, config) || [],

		/** Search only skills */
		skills: (query: string, config?: SearchConfig) => indexes.skills?.search(query, config) || [],

		/** Search only items */
		items: (query: string, config?: SearchConfig) => indexes.items?.search(query, config) || [],

		/** Search only auras */
		auras: (query: string, config?: SearchConfig) => indexes.auras?.search(query, config) || [],

		/** Search only passives */
		passives: (query: string, config?: SearchConfig) =>
			indexes.passives?.search(query, config) || [],

		/** Search across all data types */
		global: (query: string, config?: SearchConfig): GlobalSearchResult[] => {
			const cfg = { ...DEFAULT_CONFIG, ...config };
			const results: GlobalSearchResult[] = [];

			// Search BASARA
			if (indexes.basara) {
				for (const r of indexes.basara.search(query, { limit: cfg.limit })) {
					results.push({
						type: "basara",
						id: r.item.charaParamId,
						name: r.item.displayName,
						score: r.score,
						data: r.item,
						slug: r.item.slug,
					});
				}
			}

			// Search characters
			if (indexes.characters) {
				for (const r of indexes.characters.search(query, {
					limit: cfg.limit,
				})) {
					results.push({
						type: "character",
						id: r.item.charaParamId,
						name: r.item.names.fr || r.item.names.en || r.item.names.ja || r.item.charaId,
						score: r.score,
						data: r.item,
						slug: r.item.slug,
					});
				}
			}

			// Search skills
			if (indexes.skills) {
				for (const r of indexes.skills.search(query, { limit: cfg.limit })) {
					results.push({
						type: "skill",
						id: r.item.skillID,
						name: r.item.displayName,
						score: r.score,
						data: r.item,
					});
				}
			}

			// Search items
			if (indexes.items) {
				for (const r of indexes.items.search(query, { limit: cfg.limit })) {
					results.push({
						type: "item",
						id: r.item.id,
						name: r.item.name,
						score: r.score,
						data: r.item,
					});
				}
			}

			// Search auras
			if (indexes.auras) {
				for (const r of indexes.auras.search(query, { limit: cfg.limit })) {
					results.push({
						type: "aura",
						id: r.item.auraId,
						name: r.item.displayName,
						score: r.score,
						data: r.item,
					});
				}
			}

			// Search passives
			if (indexes.passives) {
				for (const r of indexes.passives.search(query, { limit: cfg.limit })) {
					results.push({
						type: "passive",
						id: r.item.passiveId,
						name: r.item.displayName,
						score: r.score,
						data: r.item,
					});
				}
			}

			// Sort by score and limit
			results.sort((a, b) => b.score - a.score);
			return results.slice(0, cfg.limit);
		},
	};
}

export type GlobalSearchAPI = ReturnType<typeof createGlobalSearch>;
