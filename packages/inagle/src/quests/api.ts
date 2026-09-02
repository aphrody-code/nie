/**
 * @file api.ts
 * @description Quests API - Quest data access and querying
 */

import { getDataPath } from "../core/data-loader.js";
import { buildQuestDatabase, type ParsedQuest } from "../parsers/quest-config.js";

export interface Quest extends ParsedQuest {
	/** Unique quest ID (hex) */
	id: string;
	/** Display text (title) */
	displayText?: string;
	/** Localized titles (aliases for test script) */
	explain_EN?: string;
	explain_FR?: string;
	explain_JA?: string;
}

export interface QuestsMeta {
	totalQuests: number;
	stats: {
		withTitleEN: number;
		withTitleJA: number;
		withTitleFR: number;
	};
}

export interface QuestsAPI {
	all(): Quest[];
	get(id: string): Quest | undefined;
	byPhase(phase: number): Quest[];
	search(query: string): Quest[];
	meta: QuestsMeta;
}

/**
 * Create Empty Quests API (Fallback)
 */
function createEmptyQuestsAPI(): QuestsAPI {
	return {
		all: () => [],
		get: (_: string) => undefined,
		byPhase: (_: number) => [],
		search: (_: string) => [],
		meta: {
			totalQuests: 0,
			stats: {
				withTitleEN: 0,
				withTitleJA: 0,
				withTitleFR: 0,
			},
		},
	};
}

/**
 * Create the Quests API.
 * @returns QuestsAPI instance
 */
export function createQuestsAPI(): QuestsAPI {
	try {
		const dataPath = getDataPath();
		const db = buildQuestDatabase(dataPath);

		const quests: Quest[] = db.quests.map((q) => ({
			...q,
			id: q.questId,
			displayText: q.titles?.en || q.titles?.ja || q.titles?.fr || "Unknown Quest",
			explain_EN: q.titles?.en,
			explain_FR: q.titles?.fr,
			explain_JA: q.titles?.ja,
		}));

		const byId = new Map<string, Quest>();
		for (const q of quests) {
			byId.set(q.id, q);
		}

		return {
			all: () => quests,
			get: (id: string) => byId.get(id),
			byPhase: (phase: number) => quests.filter((q) => q.phase === phase),
			search: (query: string) => {
				const q = query.toLowerCase();
				return quests.filter(
					(quest) =>
						quest.displayText?.toLowerCase().includes(q) ||
						quest.titles?.en?.toLowerCase().includes(q) ||
						quest.titles?.fr?.toLowerCase().includes(q) ||
						quest.titles?.ja?.toLowerCase().includes(q)
				);
			},
			meta: {
				totalQuests: quests.length,
				stats: {
					withTitleEN: quests.filter((q) => q.titles?.en).length,
					withTitleJA: quests.filter((q) => q.titles?.ja).length,
					withTitleFR: quests.filter((q) => q.titles?.fr).length,
				},
			},
		};
	} catch (error) {
		console.warn(
			"[Inagle] Failed to build quests database (missing files?). Running in fallback mode.",
			error instanceof Error ? error.message : String(error)
		);
		return createEmptyQuestsAPI();
	}
}
