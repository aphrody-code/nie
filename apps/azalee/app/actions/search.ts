"use server";

import type { QueryResultRow } from "pg";
import { isKana, toKatakana } from "wanakana";
import { getPgPool } from "@/lib/db/pg";
import {
	getAuraImageUrl,
	getCharacterFaceUrl,
	getEmblemImageUrl,
	getItemImageUrl,
	getSkillImageUrl,
	resolveAssetUrl,
} from "@rosegriffon/azalee/images";
import { smartSearch } from "@rosegriffon/azalee/search/smart-search";
import type { GlobalSearchResult, SearchContext } from "@rosegriffon/azalee/search/smart-search";
import { createClient } from "@/lib/supabase/server";
import { TACTIC_FR, translateEffect } from "@rosegriffon/azalee/text/translations";

const TYPE_CONFIG: Record<string, { label: string; icon: string; urlPrefix: string }> = {
	article: { icon: "newspaper", label: "Actualité", urlPrefix: "/news" },
	aura: { icon: "auto_awesome", label: "Aura", urlPrefix: "/aura/autres" },
	awakening: { icon: "auto_awesome", label: "Éveil", urlPrefix: "/aura/eveil" },
	basara: { icon: "person", label: "Joueur BASARA", urlPrefix: "/chara" },
	character: { icon: "person_outline", label: "Personnage", urlPrefix: "/chara" },
	item: { icon: "inventory_2", label: "Objet", urlPrefix: "/item" },
	keshin: { icon: "auto_awesome", label: "Esprit Guerrier", urlPrefix: "/aura/esprits-guerriers" },
	miximax: { icon: "auto_awesome", label: "Miximax", urlPrefix: "/aura/miximax" },
	modechange: {
		icon: "auto_awesome",
		label: "Changement Mode",
		urlPrefix: "/aura/changement-mode",
	},
	patchnote: { icon: "update", label: "Patch Note", urlPrefix: "/patch-notes" },
	skill: { icon: "sports_soccer", label: "Technique", urlPrefix: "/skill" },
	soul: { icon: "auto_awesome", label: "Totem", urlPrefix: "/aura/totems" },
	tactic: { icon: "schema", label: "Tactique", urlPrefix: "/tactic" },
	tweet: { icon: "forum", label: "Tweet X", urlPrefix: "#" },
	re: { icon: "auto_fix_high", label: "IE RE (Remake)", urlPrefix: "#" },
	cross: { icon: "compare_arrows", label: "IE Cross", urlPrefix: "#" },
	level5: { icon: "menu_book", label: "Info LEVEL-5", urlPrefix: "#" },
	topic: { icon: "feed", label: "Info LEVEL-5", urlPrefix: "#" },
	doc: { icon: "description", label: "Documentation", urlPrefix: "#" },
};

/** Enhanced search result for frontend */
export interface EnhancedSearchResult {
	id: string;
	type: string;
	title: string;
	subtitle: string;
	icon: string;
	url: string;
	matchedLanguage?: "FR" | "EN" | "JP";
	matchedName?: string;
	suggestion?: string;
	score: number;
	imageUrl?: string;
	rarity?: string;
	element?: string;
	position?: string;
}

/** Aura table definition for search */
const AURA_TABLES = [
	{ table: "inagle_keshins_clean", type: "keshin" },
	{ table: "inagle_souls_clean", type: "soul" },
	{ table: "inagle_miximax_clean", type: "miximax" },
	{ table: "inagle_awakenings_clean", type: "awakening" },
	{ table: "inagle_mode_changes_clean", type: "modechange" },
	{ table: "inagle_auras", type: "aura" },
] as const;

/**
 * Smart global search with context awareness and language detection
 */
export async function searchGlobal(
	query: string,
	context?: SearchContext
): Promise<EnhancedSearchResult[]> {
	if (!query || query.length < 2) {
		return [];
	}

	const supabase = await createClient();
	// Sanitize query to prevent PostgREST filter injection
	const sanitized = query.replaceAll(/[%_,().*\\]/g, "");
	const q = `%${sanitized}%`;

	// Try converting romaji input to katakana for Japanese name search
	let orFilter = `name_fr.ilike.${q},name_en.ilike.${q},name_ja.ilike.${q}`;
	const kataCandidate = toKatakana(sanitized.toLowerCase());
	const isValidKana =
		kataCandidate.length > 0 && [...kataCandidate].every((c) => isKana(c) || c === "ー");
	if (isValidKana && kataCandidate !== sanitized) {
		const qKana = `%${kataCandidate}%`;
		orFilter = `name_fr.ilike.${q},name_en.ilike.${q},name_ja.ilike.${q},name_ja.ilike.${qKana}`;
	}

	// Build character query with romaji/katakana support
	const charQuery = (supabase as any)
		.from("inagle_characters")
		.select(
			"id, slug, name_fr, name_en, name_ja, position, element, rarity_label, gender, internal_code, zukan_hash, stat_frappe, sheet_data"
		)
		.or(orFilter)
		.order("zukan_hash", { ascending: false, nullsFirst: false })
		.order("stat_frappe", { ascending: false, nullsFirst: false })
		.limit(15);

	const getRagPromise = async () => {
		try {
			const { getEmbedding, vectorStore } = require("@rosegriffon/db/redis");
			const questionEmbedding = await getEmbedding(sanitized);
			return await vectorStore.search("inazuma-news", questionEmbedding, 10, sanitized);
		} catch (e) {
			console.warn("RAG search failed or Redis not configured:", e);
			return [];
		}
	};

	// Parallel search across ALL tables
	const [chars, skills, items, ragDocs, ...auraResults] = await Promise.all([
		// Characters: include enrichment fields for scoring & display
		charQuery,
		// Skills: include image/video fields
		(supabase as any)
			.from("inagle_skills")
			.select(
				"id, name_fr, name_en, name_ja, image_url, video_url, element_id, category_id, power_min, power_max, sheet_data"
			)
			.or(orFilter)
			.order("video_url", { ascending: false, nullsFirst: false })
			.limit(10),
		// Items: include image/price
		(supabase as any)
			.from("inagle_items")
			.select("id, name_fr, name_en, name_ja, image_url, category, price, sheet_data")
			.or(orFilter)
			.limit(10),
		// RAG documents
		getRagPromise(),
		// All aura tables
		...AURA_TABLES.map(({ table }) =>
			(supabase as any)
				.from(table)
				.select("id, name_fr, name_en, name_ja, sub_type, asset_code, image_url")
				.or(orFilter)
				.limit(5)
		),
	]);

	// Separate queries for non-game content (teams, articles, patch notes).
	// `articles`/`patch_notes` ne sont PAS des tables `inagle_*` : elles passent en
	// Postgres DIRECT (bypass le Data API PostgREST — cf. lib/db/pg.ts) au lieu du
	// Proxy `createClient()`. `inagle_teams` reste inchangé (redirigé vers le
	// miroir SQLite par le Proxy).
	const pool = getPgPool();
	// Comme le client Supabase (qui ne throw jamais, il renvoie { data: null, error }),
	// on avale les erreurs pg ici pour ne pas faire planter toute la recherche globale
	// si `articles`/`patch_notes` sont indisponibles — même résilience qu'avant.
	const safeQuery = async <T extends QueryResultRow>(sql: string, params: unknown[]): Promise<T[]> => {
		try {
			const { rows } = await pool.query<T>(sql, params);
			return rows;
		} catch (error) {
			console.error("searchGlobal pg query error:", error);
			return [];
		}
	};
	const [teams, articlesRows, patchNotesRows] = await Promise.all([
		(supabase as any)
			.from("inagle_teams")
			.select("id, name_fr, name_en, name_ja, sheet_data")
			.or(orFilter)
			.limit(8),
		safeQuery<{
			id: string;
			title: string;
			slug: string;
			excerpt: string | null;
			category: string | null;
		}>(
			`SELECT id, title, slug, excerpt, category
			 FROM articles
			 WHERE status = $1 AND app = $2 AND title ILIKE $3
			 LIMIT 5`,
			["published", "azalee", q]
		),
		safeQuery<{
			id: string;
			title: string;
			title_fr: string | null;
			date: string;
			platform: unknown;
		}>(
			`SELECT id, title, title_fr, date, platform
			 FROM patch_notes
			 WHERE title ILIKE $1 OR title_fr ILIKE $1
			 LIMIT 5`,
			[q]
		),
	]);
	const articles = { data: articlesRows };
	const patchNotes = { data: patchNotesRows };

	const rawResults: GlobalSearchResult[] = [];

	// ─── Relevance scoring helper ─────────────────────────────────────
	// Boost results whose name starts with or exactly matches the query
	const queryLower = sanitized.toLowerCase();
	function matchRelevance(names: Array<string | null | undefined>): number {
		let best = 0;
		for (const raw of names) {
			if (!raw) {
				continue;
			}
			const n = raw.toLowerCase();
			if (n === queryLower) {
				return 3;
			} // Exact match
			if (n.startsWith(queryLower)) {
				best = Math.max(best, 2);
			} // Prefix match
			// Word-start match (e.g. "mark" in "Endo Mark")
			if (best < 1.5 && n.split(/[\s_-]/).some((w) => w.startsWith(queryLower))) {
				best = Math.max(best, 1.5);
			}
		}
		return best;
	}

	// Characters — boost enriched (has image, has stats, has sheet_data)
	if (chars.data) {
		chars.data.forEach((c: any) => {
			let score = 1;
			score += matchRelevance([c.name_fr, c.name_en, c.name_ja]);
			if (c.zukan_hash) {
				score += 0.3;
			} // Has official image
			if (c.stat_frappe) {
				score += 0.2;
			} // Has stats
			if (c.sheet_data) {
				score += 0.1;
			} // Has community data
			const isBasara = c.rarity_label === "BASARA";
			if (isBasara) {
				score += 0.2;
			} // BASARA priority
			rawResults.push({
				data: c,
				id: c.slug || c.id,
				name: c.name_fr || c.name_en,
				score,
				type: isBasara ? "basara" : "character",
			});
		});
	}

	// Skills — boost those with video
	if (skills.data) {
		skills.data.forEach((s: any) => {
			let score = 1;
			score += matchRelevance([s.name_fr, s.name_en, s.name_ja]);
			if (s.video_url) {
				score += 0.2;
			}
			if (s.sheet_data) {
				score += 0.1;
			}
			rawResults.push({
				data: s,
				id: s.id,
				name: s.name_fr || s.name_en,
				score,
				type: "skill",
			});
		});
	}

	// Items — boost those with sheet_data/price, discriminate tactics
	if (items.data) {
		items.data.forEach((i: any) => {
			let score = 1;
			score += matchRelevance([i.name_fr, i.name_en, i.name_ja]);
			if (i.sheet_data) {
				score += 0.1;
			}
			if (i.price) {
				score += 0.1;
			}
			const isTactic = i.category === "special_tactics";
			rawResults.push({
				data: i,
				id: i.id,
				name: i.name_fr || i.name_en,
				score,
				type: isTactic ? "tactic" : "item",
			});
		});
	}

	// Auras (all categories)
	auraResults.forEach((result, index) => {
		const { type: auraType } = AURA_TABLES[index];
		if (result.data) {
			result.data.forEach((a: any) => {
				let score = 0.9;
				score += matchRelevance([a.name_fr, a.name_en, a.name_ja]);
				rawResults.push({
					data: a,
					id: a.id,
					name: a.name_fr || a.name_en || a.name_ja || a.id,
					score,
					type: auraType,
				});
			});
		}
	});

	// Teams
	if (teams.data) {
		teams.data.forEach((t: any) => {
			let score = 0.8;
			score += matchRelevance([t.name_fr, t.name_en, t.name_ja]);
			if (t.sheet_data) {
				score += 0.1;
			}
			rawResults.push({
				data: t,
				id: t.id,
				name: t.name_fr || t.name_en || t.name_ja,
				score,
				type: "team",
			});
		});
	}

	// Articles
	if (articles.data) {
		articles.data.forEach((a: any) => {
			let score = 0.7;
			score += matchRelevance([a.title]);
			rawResults.push({
				data: a,
				id: a.slug || a.id,
				name: a.title,
				score,
				type: "article",
			});
		});
	}

	// Patch Notes — also search title_fr
	if (patchNotes.data) {
		patchNotes.data.forEach((p: any) => {
			let score = 0.6;
			score += matchRelevance([p.title, p.title_fr]);
			rawResults.push({
				data: p,
				id: p.id,
				name: p.title_fr || p.title,
				score,
				type: "patchnote",
			});
		});
	}

	// RAG documents
	if (ragDocs && Array.isArray(ragDocs)) {
		ragDocs.forEach((r: any) => {
			const doc = r.document;
			const type = doc.metadata.type || "article";
			const title = doc.metadata.title || doc.text.substring(0, 50);
			rawResults.push({
				data: {
					...doc.metadata,
					id: doc.id,
					text: doc.text,
					url: doc.metadata.url,
				},
				id: doc.id,
				name: title,
				score: r.score * 1.5, // Match normal score range
				type: type as any,
			});
		});
	}

	// Apply smart search enhancements
	const smartResults = await smartSearch(query, rawResults, {
		context: context || "global",
		enableSuggestions: true,
		limit: 20,
		minScore: 0,
	});

	// Handle "did you mean?" suggestion case
	if (smartResults.length === 1 && smartResults[0].suggestion) {
		return [
			{
				icon: "search",
				id: "suggestion",
				score: 0,
				subtitle: "Vouliez-vous dire...",
				suggestion: smartResults[0].suggestion,
				title: smartResults[0].suggestion,
				type: "suggestion",
				url: "#",
			},
		];
	}

	// Transform for frontend consumption with image/rarity/element/position
	return smartResults.map((r) => {
		const config = TYPE_CONFIG[r.type] || { icon: "help", label: "Autre", urlPrefix: "#" };
		const d = (r.data || {}) as Record<string, any>;

		let url: string;
		if (d.url) {
			url = d.url;
		} else if (config.urlPrefix !== "#") {
			url = `${config.urlPrefix}/${r.id}`;
		} else {
			url = "#";
		}

		// Resolve image URL per type
		let imageUrl: string | undefined;
		let rarity: string | undefined;
		let element: string | undefined;
		let position: string | undefined;

		if (r.type === "character" || r.type === "basara") {
			imageUrl = getCharacterFaceUrl(d.internal_code || d.id);
			rarity = d.rarity_label;
			({ element } = d);
			({ position } = d);
		} else if (r.type === "skill") {
			imageUrl = d.image_url || getSkillImageUrl(d.id);
		} else if (r.type === "item" || r.type === "tactic") {
			imageUrl = d.image_url || getItemImageUrl(d.id);
		} else if (["keshin", "soul", "miximax", "awakening", "modechange", "aura"].includes(r.type)) {
			imageUrl = getAuraImageUrl(d.asset_code) || undefined;
		} else if (r.type === "team") {
			const emblemId = d.sheet_data?.binderTeamOrderType || d.sheet_data?.emblem;
			if (emblemId) {
				imageUrl = getEmblemImageUrl(emblemId) || undefined;
			}
		}

		return {
			element,
			icon: config.icon,
			id: r.id,
			imageUrl: imageUrl || undefined,
			matchedLanguage: r.matchedLanguage,
			matchedName: r.matchedName,
			position,
			rarity,
			score: r.score,
			subtitle: config.label,
			title: r.matchedName || r.name,
			type: r.type,
			url,
		};
	});
}

export interface CompareSearchResult {
	slug: string;
	name: string;
	element?: string;
	position?: string;
	rarity?: string;
	/** Série (IE / GO / Ares…) — indispensable pour distinguer les versions d’un même perso */
	series?: string;
	imageUrl?: string;
	zukanHash?: string;
	totalStats: number;
}

/**
 * Search characters for the compare tool — only returns characters with stats.
 * Supports text search, filter-only browse, or both combined.
 */
export async function searchCompareCharacters(
	query: string,
	filters?: { element?: string; position?: string; rarity?: string }
): Promise<CompareSearchResult[]> {
	const hasText = query && query.length >= 2;
	const hasFilters = filters?.element || filters?.position || filters?.rarity;

	// Need at least a text query or an active filter
	if (!hasText && !hasFilters) {
		return [];
	}

	const supabase = await createClient();
	let dbQuery = (supabase as any)
		.from("inagle_characters")
		.select(
			"id, slug, name_fr, name_en, name_ja, position, element, rarity_label, series, internal_code, zukan_hash, stat_frappe, stat_controle, stat_technique, stat_pression, stat_physique, stat_agilite, stat_intelligence"
		)
		.not("stat_frappe", "is", null);

	// Text search (optional — if no text, we just browse by filters)
	if (hasText) {
		const sanitized = query.replaceAll(/[%_,().*\\]/g, "");
		const q = `%${sanitized}%`;

		let compareOrFilter = `name_fr.ilike.${q},name_en.ilike.${q},name_ja.ilike.${q}`;
		const compareKata = toKatakana(sanitized.toLowerCase());
		const compareValidKana =
			compareKata.length > 0 && [...compareKata].every((c) => isKana(c) || c === "ー");
		if (compareValidKana && compareKata !== sanitized) {
			compareOrFilter = `name_fr.ilike.${q},name_en.ilike.${q},name_ja.ilike.${q},name_ja.ilike.%${compareKata}%`;
		}
		dbQuery = dbQuery.or(compareOrFilter);
	}

	if (filters?.element) {
		dbQuery = dbQuery.eq("element", filters.element);
	}
	if (filters?.position) {
		dbQuery = dbQuery.eq("position", filters.position);
	}
	if (filters?.rarity) {
		if (filters.rarity === "BASARA") {
			dbQuery = dbQuery.eq("rarity_label", "BASARA");
		} else if (filters.rarity === "10") {
			dbQuery = dbQuery.eq("rarity_label", "Héros");
		} else if (filters.rarity === "1") {
			dbQuery = dbQuery.eq("rarity_label", "Normal");
		}
	}

	const { data } = await dbQuery
		.order("stat_frappe", { ascending: false, nullsFirst: false })
		.limit(30);

	if (!data) {
		return [];
	}

	return (data as any[]).map((c) => {
		const total =
			(c.stat_frappe || 0) +
			(c.stat_controle || 0) +
			(c.stat_technique || 0) +
			(c.stat_pression || 0) +
			(c.stat_physique || 0) +
			(c.stat_agilite || 0) +
			(c.stat_intelligence || 0);
		return {
			element: c.element || undefined,
			imageUrl: getCharacterFaceUrl(c.internal_code || c.id),
			name: c.name_fr || c.name_en || c.id,
			position: c.position || undefined,
			rarity: c.rarity_label || undefined,
			series: c.series || undefined,
			// Toujours le slug de la VARIANTE (pas base_slug) pour que le comparateur
			// charge la bonne version (Byron IE ≠ Byron Ares).
			slug: c.slug || c.id,
			totalStats: total,
			zukanHash: c.zukan_hash || undefined,
		};
	});
}

/**
 * Get search suggestions based on query
 */
export async function getSearchSuggestions(query: string): Promise<string[]> {
	if (!query || query.length < 2) {
		return [];
	}

	const results = await searchGlobal(query);
	const suggestions = new Set<string>();

	for (const result of results) {
		if (result.title) {
			suggestions.add(result.title);
		}
	}

	return [...suggestions].slice(0, 5);
}

// ─── Meta suggestions for search landing page ──────────────────────────────

export interface MetaSuggestion {
	id: string;
	slug: string;
	name: string;
	imageUrl?: string;
	subtitle?: string;
	url: string;
}

export interface MetaSuggestions {
	players: MetaSuggestion[];
	skills: MetaSuggestion[];
	tactics: MetaSuggestion[];
	items: MetaSuggestion[];
	passives: MetaSuggestion[];
}

const SKILL_CATEGORY_FR: Record<string, string> = {
	"1": "Tir",
	"2": "Dribble",
	"3": "Défense",
	"4": "Arrêt",
};

const POSITION_SHORT: Record<string, string> = {
	DF: "DEF",
	FW: "ATT",
	GK: "GAR",
	MF: "MIL",
};

const ELEMENT_SHORT: Record<string, string> = {
	Fire: "Feu",
	Forest: "Forêt",
	Mountain: "Montagne",
	Void: "Néant",
	Wind: "Vent",
};

const ITEM_CATEGORY_FR: Record<string, string> = {
	accessory: "Accessoire",
	consume: "Consommable",
	costume: "Costume",
	equip: "Équipement",
	fashion: "Mode",
	formation: "Formation",
	important: "Important",
	misanga: "Misanga",
	performance: "Célébration",
	shoes: "Chaussures",
	special: "Spécial",
	special_skill: "Passif",
	special_tactics: "Tactique",
};

const PASSIVE_BOOST_FR: Record<string, string> = {
	Affrontement: "Affrontement",
	Arrêt: "Arrêt",
	Attaque: "Attaque",
	Brèche: "Brèche",
	Dribble: "Dribble",
	Défense: "Défense",
	Mixte: "Mixte",
	Récupération: "Récupération",
	Spécial: "Spécial",
	Tension: "Tension",
	Tir: "Tir",
	Vitesse: "Vitesse",
};

/**
 * Get pre-computed meta suggestions for the search landing page.
 * Returns top BASARA players, most powerful skills, enriched tactics,
 * popular items, and key passives.
 */
export async function getMetaSuggestions(): Promise<MetaSuggestions> {
	const supabase = await createClient();

	const [playersRes, skillsRes, tacticsRes, itemsRes, passivesRes] = await Promise.all([
		// Top 10 BASARA by total stats, prefer those with zukan_hash for 3D images
		(supabase as any)
			.from("inagle_characters")
			.select(
				"id, slug, name_fr, name_en, position, element, internal_code, zukan_hash, stat_frappe, stat_controle, stat_technique, stat_pression, stat_physique, stat_agilite, stat_intelligence"
			)
			.eq("rarity_label", "BASARA")
			.not("stat_frappe", "is", null)
			.not("zukan_hash", "is", null)
			.order("stat_frappe", { ascending: false, nullsFirst: false })
			.limit(12),
		// Top 8 skills by power_max with video
		(supabase as any)
			.from("inagle_skills")
			.select("id, name_fr, name_en, category_id, element_id, power_max, video_url, image_url")
			.not("power_max", "is", null)
			.not("video_url", "is", null)
			.order("power_max", { ascending: false, nullsFirst: false })
			.limit(8),
		// 8 enriched tactics (have shop)
		(supabase as any)
			.from("inagle_tactics")
			.select("name, effect1, shop")
			.not("shop", "is", null)
			.order("name")
			.limit(8),
		// Top 8 gameplay items with price (shoes, misanga, accessory, etc.)
		(supabase as any)
			.from("inagle_items")
			.select("id, name_fr, name_en, category, price, image_url")
			.not("price", "is", null)
			.in("category", ["shoes", "misanga", "accessory", "consume", "special", "formation"])
			.not("name_fr", "is", null)
			.order("price", { ascending: false, nullsFirst: false })
			.limit(8),
		// 8 key passives with descriptions (exclude unknown/broken entries)
		(supabase as any)
			.from("inagle_passives")
			.select("id, name_fr, name_en, category, boost_type, description_fr, effect_value")
			.not("name_fr", "is", null)
			.not("description_fr", "is", null)
			.neq("category", "Inconnu")
			.not("description_fr", "ilike", "%[CPASSIVE%")
			.order("effect_value", { ascending: false, nullsFirst: false })
			.limit(8),
	]);

	// Map BASARA players — use bucket face icons (zukan 3D mirror not available)
	const players: MetaSuggestion[] = (playersRes.data || []).map((c: any) => {
		const total =
			(c.stat_frappe || 0) +
			(c.stat_controle || 0) +
			(c.stat_technique || 0) +
			(c.stat_pression || 0) +
			(c.stat_physique || 0) +
			(c.stat_agilite || 0) +
			(c.stat_intelligence || 0);
		const pos = POSITION_SHORT[c.position] || c.position || "";
		const el = ELEMENT_SHORT[c.element] || c.element || "";
		const parts = [pos, el, total > 0 ? String(total) : ""].filter(Boolean);
		const imageUrl = getCharacterFaceUrl(c.internal_code || c.id);
		return {
			id: c.id,
			imageUrl,
			name: c.name_fr || c.name_en || c.id,
			slug: c.slug || c.id,
			subtitle: parts.join(" · "),
			url: `/chara/${c.slug || c.id}`,
		};
	});

	// Map skills
	const skills: MetaSuggestion[] = (skillsRes.data || []).map((s: any) => {
		const cat = SKILL_CATEGORY_FR[String(s.category_id)] || "";
		const power = s.power_max ? String(s.power_max) : "";
		const parts = [cat, power].filter(Boolean);
		return {
			id: s.id,
			imageUrl: getSkillImageUrl(s.id),
			name: s.name_fr || s.name_en || s.id,
			slug: s.id,
			subtitle: parts.join(" · "),
			url: `/skill/${s.id}`,
		};
	});

	// Map tactics
	const tactics: MetaSuggestion[] = (tacticsRes.data || []).map((t: any) => {
		const nameFr = TACTIC_FR[t.name] || t.name;
		const effect = t.effect1 ? translateEffect(t.effect1) : "";
		return {
			id: t.name,
			name: nameFr,
			slug: t.name
				.toLowerCase()
				.replaceAll(/[^a-z0-9]+/g, "-")
				.replaceAll(/^-+|-+$/g, ""),
			subtitle: effect,
			url: `/tactic/${t.name
				.toLowerCase()
				.replaceAll(/[^a-z0-9]+/g, "-")
				.replaceAll(/^-+|-+$/g, "")}`,
		};
	});

	// Map items — use image_url from DB (correct asset filename)
	const items: MetaSuggestion[] = (itemsRes.data || []).map((i: any) => {
		const catFr = ITEM_CATEGORY_FR[i.category] || i.category || "";
		const price = i.price ? `${i.price} P` : "";
		const parts = [catFr, price].filter(Boolean);
		return {
			id: i.id,
			imageUrl: i.image_url ? resolveAssetUrl(i.image_url) || "" : getItemImageUrl(i.id),
			name: i.name_fr || i.name_en || i.id,
			slug: i.id,
			subtitle: parts.join(" · "),
			url: `/item/${i.id}`,
		};
	});

	// Map passives
	const passives: MetaSuggestion[] = (passivesRes.data || []).map((p: any) => {
		const boostFr = PASSIVE_BOOST_FR[p.boost_type] || p.boost_type || "";
		const catFr =
			p.category === "Joueur" ? "Joueur" : p.category === "Équipe" ? "Équipe" : p.category || "";
		const parts = [catFr, boostFr].filter(Boolean);
		return {
			id: p.id,
			name: p.name_fr || p.name_en || p.id,
			slug: p.id,
			subtitle: parts.join(" · "),
			url: `/passive/${p.id}`,
		};
	});

	return { items, passives, players, skills, tactics };
}

/**
 * Recherche pour la barre "RAG" affichée en bas des outils.
 *
 * La barre doit produire des résultats RÉELS et cliquables. On combine :
 *  1. Une recherche full-text multi-entités du wiki (personnages, techniques,
 *     objets, auras, équipes, articles…) via `searchGlobal` — toujours
 *     pertinente et avec de vraies URLs vers les fiches.
 *  2. Les documents sémantiques du corpus actus/tweets (Redis vector store),
 *     en complément, si disponibles.
 *
 * Les deux sources sont fusionnées dans la forme `RagDocument` attendue par
 * le composant `RagAssistant`.
 */
export async function searchRagOnly(query: string): Promise<any[]> {
	if (!query || query.length < 2) {
		return [];
	}

	const sanitized = query.replaceAll(/[%_,().*\\]/g, "");

	// 1. Entités wiki réelles (cliquables) — source principale.
	const wikiPromise = (async () => {
		try {
			const entities = await searchGlobal(query);
			return (
				entities
					// searchGlobal injecte aussi des docs RAG internes (type "doc",
					// url file://…) non cliquables → on ne garde que les fiches wiki.
					.filter((r) => r.type !== "doc" && !String(r.url).startsWith("file:"))
					.slice(0, 12)
					.map((r) => ({
						id: `wiki-${r.type}-${r.id}`,
						title: r.title,
						date: "",
						url: r.url,
						type: r.type,
						text:
							r.matchedName && r.matchedName !== r.title
								? `${r.subtitle} · ${r.matchedName}`
								: r.subtitle,
						score: typeof r.score === "number" ? Math.min(1, r.score / 3) : 0.6,
					}))
			);
		} catch (e) {
			console.warn("RAG wiki search failed:", e);
			return [] as any[];
		}
	})();

	// 2. Corpus sémantique actus / tweets — complément.
	const newsPromise = (async () => {
		try {
			const { getEmbedding, vectorStore } = require("@rosegriffon/db/redis");
			const questionEmbedding = await getEmbedding(sanitized);
			const results = await vectorStore.search("inazuma-news", questionEmbedding, 8, sanitized);
			return (
				results
					// Exclut le bruit non-actionnable (docs internes, chemins file://).
					.filter((r: any) => {
						const type = r.document.metadata?.type || "article";
						const url = r.document.metadata?.url || "";
						return type !== "doc" && !String(url).startsWith("file:");
					})
					.map((r: any) => ({
						id: r.document.id,
						title: r.document.metadata?.title || r.document.text.substring(0, 50),
						date: r.document.metadata?.date || "",
						url: r.document.metadata?.url || "#",
						type: r.document.metadata?.type || "article",
						text: r.document.text,
						score: r.score,
					}))
			);
		} catch (e) {
			console.warn("RAG news search failed or Redis not configured:", e);
			return [] as any[];
		}
	})();

	const [wikiDocs, newsDocs] = await Promise.all([wikiPromise, newsPromise]);

	// Fusion hybride par Reciprocal Rank Fusion (RRF) — cf. pattern Supabase
	// hybrid-search. Au lieu de préfixer BRUTALEMENT toutes les entités wiki avant
	// toutes les actus (l'ancien concat faisait perdre tout résultat sémantique
	// fort), on fusionne les deux sources par RANG : chaque doc reçoit
	// `poids / (k + rang)` dans sa liste, on additionne (un doc présent dans les
	// deux listes cumule), puis on trie. Les têtes de chaque liste remontent, les
	// queues sont pénalisées → meilleur des deux mondes, interclassé.
	const RRF_K = 50; // constante de lissage (limite la domination des tout 1ers)
	const FULL_TEXT_WEIGHT = 1.2; // léger biais vers les fiches wiki (cliquables)
	const SEMANTIC_WEIGHT = 1; // actus / tweets sémantiques
	const sortByScore = (a: any, b: any) => (b.score || 0) - (a.score || 0);

	const ranked = new Map<string, { doc: any; rrf: number }>();
	const fuse = (docs: any[], weight: number) => {
		docs.sort(sortByScore).forEach((doc, index) => {
			const contribution = weight / (RRF_K + index + 1);
			const existing = ranked.get(doc.id);
			if (existing) {
				existing.rrf += contribution;
			} else {
				ranked.set(doc.id, { doc, rrf: contribution });
			}
		});
	};
	fuse(wikiDocs, FULL_TEXT_WEIGHT);
	fuse(newsDocs, SEMANTIC_WEIGHT);

	return [...ranked.values()]
		.sort((a, b) => b.rrf - a.rrf)
		.slice(0, 12)
		.map((entry) => entry.doc);
}
