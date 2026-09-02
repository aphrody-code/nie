/**
 * @file lib/wiki/quests.ts
 * @description Accès data DÉDIÉ à la section Quêtes (`inagle_quests`, 182 lignes).
 *
 * Vérité terrain (miroir SQLite, db-2026-06-05) : tout le contenu réel vit dans la
 * colonne JSON `data` — les colonnes plates (`name_fr`, `type`, `phase`, `image_url`)
 * sont VIDES. Le JSON expose : `titles` (en/fr/ja), `explain_EN/FR/JA` (= titles),
 * `image` (nom d'asset, NON résolu sur le CDN à ce jour), `type` (0-45) et `phase`.
 *
 * Anti-hallucination : la table NE contient PAS d'objectifs/récompenses/prérequis
 * structurés (aucune clé `reward`/`objective`/`prereq`/`item` dans le JSON). On
 * n'invente donc rien — on expose uniquement les champs réellement présents.
 *
 * Sémantique des champs (parser inagle `quest-config.ts`) :
 * - `phase < 1000`  → objectif d'HISTOIRE PRINCIPALE (séquentiel, titre = consigne).
 * - `phase >= 1000` → QUÊTE ANNEXE nommée, regroupée par zone (`floor(phase/10000)`).
 */


import { createClient } from "../db/provider";

/** Catégorie dérivée du `phase` (pas une colonne DB). */
export type QuestKind = "main" | "side";

/** Quête normalisée pour le rendu wiki (champs RÉELS du miroir uniquement). */
export interface Quest {
	/** ID hex unique (ex. `0x103AF791`). */
	id: string;
	/** Titre localisé FR (fallback EN/JA), nettoyé des retours-ligne. */
	title: string;
	/** Titres bruts par langue (déjà présents dans `data.titles`). */
	titles: { fr: string; en: string; ja: string };
	/** Type in-game (0-45). 1=MAIN, 2=SUB, 3=DAILY selon l'enum inagle ; le reste
	 *  est une granularité d'étape non documentée → exposé tel quel. */
	type: number;
	/** Numéro de phase/chapitre (ordre dans l'histoire ou code de zone annexe). */
	phase: number;
	/** Nom d'asset image in-game (non résolu sur le CDN → pas rendu, conservé pour info). */
	image: string | null;
	/** Catégorie dérivée : histoire principale vs quête annexe. */
	kind: QuestKind;
	/** Numéro de zone annexe (`floor(phase/10000)`) si `kind === "side"`, sinon null. */
	area: number | null;
}

/** Forme brute attendue dans la colonne `data` (parsée en objet par le client SQLite). */
interface QuestData {
	id?: string;
	questId?: string;
	type?: number;
	phase?: number;
	image?: string | null;
	titles?: { en?: string; fr?: string; ja?: string };
	explain_EN?: string;
	explain_FR?: string;
	explain_JA?: string;
	displayText?: string;
}

interface QuestRow {
	id: string;
	data: QuestData | string | null;
}

/** Seuil au-delà duquel un `phase` code une quête annexe (et non un chapitre d'histoire). */
const SIDE_PHASE_THRESHOLD = 1000;

/** Normalise un titre multi-ligne (les consignes d'histoire ont des `\n` internes). */
function cleanTitle(raw: string | undefined | null): string {
	if (!raw) return "";
	return raw.replace(/\s+/g, " ").trim();
}

/** Le client SQLite parse déjà le JSON ; on tolère aussi une string par sûreté. */
function asData(data: QuestData | string | null): QuestData {
	if (!data) return {};
	if (typeof data === "string") {
		try {
			return JSON.parse(data) as QuestData;
		} catch {
			return {};
		}
	}
	return data;
}

/** Convertit une ligne brute en `Quest` normalisée (champs réels uniquement). */
function toQuest(row: QuestRow): Quest {
	const d = asData(row.data);
	const t = d.titles ?? {};
	const titles = {
		fr: cleanTitle(t.fr ?? d.explain_FR ?? t.en ?? ""),
		en: cleanTitle(t.en ?? d.explain_EN ?? ""),
		ja: cleanTitle(t.ja ?? d.explain_JA ?? ""),
	};
	const phase = typeof d.phase === "number" ? d.phase : 0;
	const kind: QuestKind = phase >= SIDE_PHASE_THRESHOLD ? "side" : "main";
	return {
		id: row.id,
		title: titles.fr || titles.en || titles.ja || row.id,
		titles,
		type: typeof d.type === "number" ? d.type : 0,
		phase,
		image: d.image ?? null,
		kind,
		area: kind === "side" ? Math.floor(phase / 10000) : null,
	};
}

/** Tri stable par phase croissante (= ordre narratif / regroupement de zone). */
function byPhase(a: Quest, b: Quest): number {
	if (a.phase !== b.phase) return a.phase - b.phase;
	return a.id.localeCompare(b.id);
}

let _cache: Quest[] | null = null;

/** Charge et normalise toutes les quêtes (182) depuis le miroir. Cache process-local. */
export async function getAllQuests(): Promise<Quest[]> {
	if (_cache) return _cache;
	const supabase = await createClient();
	const { data, error } = await supabase
		.from("inagle_quests")
		.select("id, data")
		.limit(2000);

	if (error || !data) {
		return [];
	}

	const quests = (data as QuestRow[]).map(toQuest).sort(byPhase);
	_cache = quests;
	return quests;
}

export interface QuestListResult {
	quests: Quest[];
	total: number;
	main: number;
	side: number;
}

/**
 * Liste filtrable (recherche plein-titre multilingue + filtre catégorie).
 * Filtrage côté serveur en mémoire — 182 lignes, pas de pagination nécessaire.
 */
export async function getQuestsList(params?: {
	q?: string;
	kind?: QuestKind | "all";
}): Promise<QuestListResult> {
	const all = await getAllQuests();
	const main = all.filter((x) => x.kind === "main").length;
	const side = all.length - main;

	let quests = all;
	const kind = params?.kind ?? "all";
	if (kind === "main" || kind === "side") {
		quests = quests.filter((x) => x.kind === kind);
	}

	const q = params?.q?.trim().toLowerCase();
	if (q) {
		quests = quests.filter(
			(x) =>
				x.titles.fr.toLowerCase().includes(q) ||
				x.titles.en.toLowerCase().includes(q) ||
				x.titles.ja.toLowerCase().includes(q) ||
				x.id.toLowerCase().includes(q)
		);
	}

	return { quests, total: all.length, main, side };
}

/** Récupère une quête par ID hex (normalisé en minuscule, tolère `0X`/`0x`). */
export async function getQuest(id: string): Promise<Quest | null> {
	const all = await getAllQuests();
	const norm = id.trim().toLowerCase();
	return all.find((x) => x.id.toLowerCase() === norm) ?? null;
}

/** Quêtes adjacentes (précédente/suivante par phase) pour la navigation du détail. */
export async function getQuestNeighbors(
	id: string
): Promise<{ prev: Quest | null; next: Quest | null }> {
	const all = await getAllQuests();
	const idx = all.findIndex((x) => x.id.toLowerCase() === id.trim().toLowerCase());
	if (idx === -1) return { prev: null, next: null };
	return {
		prev: idx > 0 ? all[idx - 1] : null,
		next: idx < all.length - 1 ? all[idx + 1] : null,
	};
}
