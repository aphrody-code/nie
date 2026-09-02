/**
 * Fuzzy search using uFuzzy
 *
 * Provides fast fuzzy search across game data
 */

import uFuzzy from "@leeoniya/ufuzzy";

/**
 * Searchable item interface
 */
export interface SearchableItem {
	id: string | number;
	text: string;
	[key: string]: unknown;
}

/**
 * Search result with match info
 */
export interface SearchResult<T> {
	item: T;
	score: number;
	matches: [number, number][]; // [start, length] pairs
}

/**
 * Create a search index for a list of items
 */
export function createSearchIndex<T extends SearchableItem>(
	items: T[],
	textGetter: (item: T) => string = (item) => item.text
): {
	search: (query: string, limit?: number) => SearchResult<T>[];
	items: T[];
} {
	const texts = items.map(textGetter);
	const uf = new uFuzzy({
		intraMode: 1, // Allow fuzzy matching within words
		intraIns: 1, // Allow 1 insertion within words
		interIns: 3, // Allow 3 insertions between words
	});

	return {
		items,
		search(query: string, limit = 20): SearchResult<T>[] {
			const [idxs, info, order] = uf.search(texts, query);

			if (!idxs || !order) {
				return [];
			}

			const results: SearchResult<T>[] = [];

			for (let i = 0; i < Math.min(order.length, limit); i++) {
				const infoIdx = order[i];
				const itemIdx = idxs[infoIdx];
				const item = items[itemIdx];

				// Extract match ranges
				const matches: [number, number][] = [];
				if (info?.ranges) {
					const ranges = info.ranges[infoIdx];
					for (let j = 0; j < ranges.length; j += 2) {
						matches.push([ranges[j], ranges[j + 1] - ranges[j]]);
					}
				}

				results.push({
					item,
					score: infoIdx, // Lower is better
					matches,
				});
			}

			return results;
		},
	};
}

/**
 * Simple exact/prefix search (faster for exact matches)
 */
export function exactSearch<T>(items: T[], query: string, textGetter: (item: T) => string): T[] {
	const lowerQuery = query.toLowerCase();
	return items.filter((item) => textGetter(item).toLowerCase().includes(lowerQuery));
}

/**
 * Search with multiple fields
 */
export function multiFieldSearch<T>(
	items: T[],
	query: string,
	fieldGetters: ((item: T) => string)[]
): T[] {
	const lowerQuery = query.toLowerCase();
	return items.filter((item) =>
		fieldGetters.some((getter) => getter(item).toLowerCase().includes(lowerQuery))
	);
}
