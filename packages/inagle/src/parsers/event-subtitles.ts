/**
 * @file event-subtitles.ts
 * @description Parser des scripts/sous-titres d'event IEVR (cutscenes voicées),
 * ancré strictement sur les octets réels du dump. Couvre le GAP non indexé :
 * les sous-titres timecodés (`gamedata/event/subtitle/<lang>/Subtitle_ev*`) et
 * leur dialogue localisé (`text/<lang>/event/ev*`), joints par le hash de texte
 * (Int signé invariant inter-langue).
 *
 * Trois familles de fichiers réelles (vérifiées, voir docs/gamedata-coverage) :
 *  1. `common/gamedata/event/subtitle/<lang>/Subtitle_<id>.cfg.bin.json`
 *     → 1 noeud `EV_SUBTITLE_DATA_LIST_BEG_0` (var Int = nb enfants),
 *       N enfants `EV_SUBTITLE_DATA_<n>` de 5 variables :
 *       var[0]=Int hash texte, var[1..4]=timings (start/end/grace, secondes).
 *       AUCUN texte ici (anti-hallucination). Le hash + le timing sont
 *       identiques entre langues (preuve : ev01_01850 partage les mêmes hash
 *       et timings sur de/en/es/fr/it/ja/zh ; pt a des sentinelles -1).
 *  2. `common/text/<lang>/event/<id>.cfg.bin.json`
 *     → `TEXT_INFO_BEGIN_0` + enfants `TEXT_INFO_<n>` `[Int hash, Int, String, Int]`
 *       var[2]=texte localisé brut (tags inline <MNT:…>, ruby [漢字/かな] conservés).
 *       Présent SEULEMENT pour en/fr/ja par-event ; de/es/it/pt/zh = 0 fichier.
 *  3. `common/text/event/<id>_map.cfg.bin.json` (table washa, langue-neutre)
 *     → `TEXT_WASHA_MAP_BEGIN_0` + enfants 17 variables :
 *       var[0]=Int hash (même clé), var[5]=String flag lip-sync,
 *       var[15]=String label canonique `eventId_bloc_ligne`.
 *
 * Le hash est stocké sous deux formes : `text_hash` (Int signé brut, clé réelle)
 * et `text_hash_u` (`0x........`, forme uint32 stable pour jointures externes).
 *
 * Le texte localisé est conservé BRUT (pas de sanitizeText) pour préserver la
 * fidélité aux octets source (tags <FLC>/<MNT>/…, furigana). Toute langue sans
 * fichier texte par-event reste à NULL — jamais fabriquée.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

/** Une ligne de sous-titre timecodée, jointe à son texte localisé par hash. */
export interface EventSubtitleLine {
	event_id: string; // 'ev09_05000'
	episode: string; // 'ev09'
	line_index: number; // ordre dans le fichier (0..N-1)
	text_hash: number; // Int signé brut (clé de jointure réelle)
	text_hash_u: string; // '0xC39AFCCB' (uint32 hex)
	/** Timings en secondes (var[1..4] du noeud EV_SUBTITLE_DATA). */
	show_start: number;
	show_end: number;
	t3: number;
	t4: number;
	/** Langues dont le fichier Subtitle existe ET porte un timing valide (≠ -1). */
	subtitle_langs: string[];
	/** Label canonique de ligne (washa var[15]) si résolu, sinon null. */
	line_label: string | null;
	/** Flag lip-sync (washa var[5], ex. 'no_lip') si présent, sinon null. */
	lip_sync: string | null;
	/** Texte localisé brut (par-event en/fr/ja). NULL si fichier absent. */
	text_ja: string | null;
	text_en: string | null;
	text_fr: string | null;
}

/** Agrégat de couverture par event (listing). */
export interface EventAggregate {
	event_id: string;
	episode: string;
	has_subtitle: boolean;
	subtitle_langs: string[]; // langues ayant un fichier Subtitle
	dialogue_langs: string[]; // langues ayant un fichier text/<lang>/event
	subtitle_rows: number; // nb EV_SUBTITLE_DATA (canonique)
	line_count: number; // nb TEXT_INFO (master ja sinon meilleur dispo)
	has_map: boolean; // table washa présente
}

// ============================================================================
// Chemins réels
// ============================================================================

const SUBTITLE_ROOT = join(DATA_ROOT, "common/gamedata/event/subtitle");
const TEXT_ROOT = join(DATA_ROOT, "common/text");
const WASHA_DIR = join(TEXT_ROOT, "event");

/** Langues de sous-titres réelles (9). */
const SUBTITLE_LANGS = ["de", "en", "es", "fr", "it", "ja", "pt", "zh_hans", "zh_hant"] as const;
/** Langues de dialogue par-event réelles (texte présent uniquement ici). */
const TEXT_LANGS = ["ja", "en", "fr"] as const;
type TextLang = (typeof TEXT_LANGS)[number];

// ============================================================================
// Helpers
// ============================================================================

/** Int signé → uint32 hex (0x........), même convention que core/data-loader toHex. */
function toHexU32(value: number): string {
	return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function safeReadJson(path: string): any | null {
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

/** Liste les `.cfg.bin.json` d'un dossier (exclut les `.cfg.bin` jumeaux). */
function listJsonCfg(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => f.endsWith(".cfg.bin.json"));
}

/** Convertit "Subtitle_ev09_05000.cfg.bin.json" → "ev09_05000". */
function subtitleFileToId(file: string): string {
	return file.replace(/^Subtitle_/, "").replace(/\.cfg\.bin\.json$/, "");
}

/** Convertit "ev09_05000.cfg.bin.json" → "ev09_05000". */
function textFileToId(file: string): string {
	return file.replace(/\.cfg\.bin\.json$/, "");
}

/** Préfixe d'épisode 'ev09' depuis 'ev09_05000'. */
function episodeOf(eventId: string): string {
	const m = eventId.match(/^(ev\d+)/i);
	return m ? m[1].toLowerCase() : eventId;
}

interface ParsedSubtitleRow {
	hash: number;
	t1: number;
	t2: number;
	t3: number;
	t4: number;
}

/**
 * Parse un fichier Subtitle_<id> : renvoie les lignes (hash + 4 timings) telles
 * quelles, dans l'ordre du fichier. var[0]=Int hash, var[1..4]=timings.
 */
function parseSubtitleFile(path: string): ParsedSubtitleRow[] | null {
	const data = safeReadJson(path);
	if (!data?.entries?.length) return null;
	const beg = data.entries.find((e: any) => typeof e?.name === "string" && e.name.startsWith("EV_SUBTITLE_DATA_LIST_BEG_"));
	if (!beg?.children) return null;

	const rows: ParsedSubtitleRow[] = [];
	for (const child of beg.children) {
		if (typeof child?.name !== "string" || !child.name.startsWith("EV_SUBTITLE_DATA_")) continue;
		const v = child.variables;
		if (!Array.isArray(v) || v.length < 5) continue;
		rows.push({
			hash: Number.parseInt(v[0].value, 10),
			t1: Number.parseFloat(v[1].value),
			t2: Number.parseFloat(v[2].value),
			t3: Number.parseFloat(v[3].value),
			t4: Number.parseFloat(v[4].value),
		});
	}
	return rows;
}

/** Charge la table de texte localisé d'un event : Map<hash:number, rawText:string>. */
function loadTextMap(eventId: string, lang: TextLang): Map<number, string> | null {
	const path = join(TEXT_ROOT, lang, "event", `${eventId}.cfg.bin.json`);
	if (!existsSync(path)) return null;
	const data = safeReadJson(path);
	if (!data?.entries?.length) return null;
	const beg = data.entries.find((e: any) => typeof e?.name === "string" && e.name.startsWith("TEXT_INFO_BEGIN_"));
	if (!beg?.children) return null;

	const map = new Map<number, string>();
	for (const child of beg.children) {
		if (typeof child?.name !== "string" || !child.name.startsWith("TEXT_INFO_")) continue;
		const v = child.variables;
		if (!Array.isArray(v) || v.length < 3) continue;
		const hash = Number.parseInt(v[0].value, 10);
		// var[2] = texte localisé brut (conservé tel quel, tags + furigana inclus)
		const raw = typeof v[2]?.value === "string" ? v[2].value : "";
		map.set(hash, raw);
	}
	return map;
}

interface WashaEntry {
	label: string | null;
	lipSync: string | null;
}

/** Charge la table washa d'un event : Map<hash:number, {label, lipSync}>. */
function loadWashaMap(eventId: string): Map<number, WashaEntry> | null {
	const path = join(WASHA_DIR, `${eventId}_map.cfg.bin.json`);
	if (!existsSync(path)) return null;
	const data = safeReadJson(path);
	if (!data?.entries?.length) return null;
	const beg = data.entries.find((e: any) => typeof e?.name === "string" && e.name.startsWith("TEXT_WASHA_MAP_BEGIN_"));
	if (!beg?.children) return null;

	const map = new Map<number, WashaEntry>();
	for (const child of beg.children) {
		if (typeof child?.name !== "string" || !child.name.startsWith("TEXT_WASHA_MAP_")) continue;
		const v = child.variables;
		if (!Array.isArray(v) || v.length < 16) continue;
		const hash = Number.parseInt(v[0].value, 10);
		const lipRaw = typeof v[5]?.value === "string" ? v[5].value : "";
		const labelRaw = typeof v[15]?.value === "string" ? v[15].value : "";
		map.set(hash, {
			label: labelRaw.length > 0 ? labelRaw : null,
			lipSync: lipRaw.length > 0 ? lipRaw : null,
		});
	}
	return map;
}

// ============================================================================
// Indexation des fichiers (1 passe)
// ============================================================================

/** Renvoie, pour chaque event voicé, la liste des langues dont le Subtitle existe. */
function indexSubtitleFiles(): Map<string, string[]> {
	const byEvent = new Map<string, string[]>();
	for (const lang of SUBTITLE_LANGS) {
		const dir = join(SUBTITLE_ROOT, lang);
		for (const file of listJsonCfg(dir)) {
			if (!file.startsWith("Subtitle_")) continue;
			const id = subtitleFileToId(file);
			const arr = byEvent.get(id) ?? [];
			arr.push(lang);
			byEvent.set(id, arr);
		}
	}
	for (const arr of byEvent.values()) arr.sort();
	return byEvent;
}

/** Choisit la langue source canonique pour le timing (préfère ja > fr > en > autres présentes). */
function pickCanonicalLang(langs: string[]): string {
	for (const pref of ["ja", "fr", "en", "de", "es", "it", "pt", "zh_hans", "zh_hant"]) {
		if (langs.includes(pref)) return pref;
	}
	return langs[0];
}

// ============================================================================
// Parsing principal
// ============================================================================

/**
 * Parse l'intégralité des sous-titres d'event voicés → 1 ligne atomique par
 * (event_id, line_index). Timing canonique (langue préférée avec timing valide),
 * texte ja/en/fr résolu par hash, label/lip-sync depuis la table washa.
 *
 * Borné par construction : 153 events voicés (union langues), ~2093 lignes.
 */
export function parseAllEventSubtitles(): EventSubtitleLine[] {
	const subtitleIndex = indexSubtitleFiles();
	const out: EventSubtitleLine[] = [];

	for (const [eventId, langs] of subtitleIndex.entries()) {
		// Timing canonique : la langue préférée présente (ja>fr>en>…).
		const canonLang = pickCanonicalLang(langs);
		const canonPath = join(SUBTITLE_ROOT, canonLang, `Subtitle_${eventId}.cfg.bin.json`);
		let rows = parseSubtitleFile(canonPath);
		if (!rows || rows.length === 0) continue;

		// Si la langue canonique a des sentinelles -1 (timing non authored), on
		// bascule sur une langue dont le 1er timing est réel, sans inventer.
		const hasReal = rows.some((r) => r.t1 >= 0 || r.t2 >= 0);
		if (!hasReal) {
			for (const lang of langs) {
				if (lang === canonLang) continue;
				const alt = parseSubtitleFile(join(SUBTITLE_ROOT, lang, `Subtitle_${eventId}.cfg.bin.json`));
				if (alt && alt.some((r) => r.t1 >= 0 || r.t2 >= 0)) {
					rows = alt;
					break;
				}
			}
		}

		// Langues dont le fichier porte un timing valide (≠ -1) pour cet event.
		const langsWithTiming: string[] = [];
		for (const lang of langs) {
			const lr = parseSubtitleFile(join(SUBTITLE_ROOT, lang, `Subtitle_${eventId}.cfg.bin.json`));
			if (lr && lr.some((r) => r.t1 >= 0 || r.t2 >= 0)) langsWithTiming.push(lang);
		}

		const textMaps: Partial<Record<TextLang, Map<number, string> | null>> = {};
		for (const lang of TEXT_LANGS) textMaps[lang] = loadTextMap(eventId, lang);
		const washa = loadWashaMap(eventId);
		const episode = episodeOf(eventId);

		rows.forEach((row, idx) => {
			const w = washa?.get(row.hash) ?? null;
			out.push({
				event_id: eventId,
				episode,
				line_index: idx,
				text_hash: row.hash,
				text_hash_u: toHexU32(row.hash),
				show_start: row.t1,
				show_end: row.t2,
				t3: row.t3,
				t4: row.t4,
				subtitle_langs: langsWithTiming.length > 0 ? langsWithTiming : langs,
				line_label: w?.label ?? null,
				lip_sync: w?.lipSync ?? null,
				text_ja: textMaps.ja?.get(row.hash) ?? null,
				text_en: textMaps.en?.get(row.hash) ?? null,
				text_fr: textMaps.fr?.get(row.hash) ?? null,
			});
		});
	}

	// Tri stable (event puis ordre) pour un upsert déterministe.
	out.sort((a, b) => (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : a.line_index - b.line_index));
	return out;
}

/**
 * Parse l'agrégat de couverture par event. Couvre les events voicés (subtitle)
 * ET tout event ayant du texte par-event (dialogue large, ~4683 master ja).
 * Sert au listing/couverture, pas au texte atomique.
 */
export function parseAllEventAggregates(): EventAggregate[] {
	const subtitleIndex = indexSubtitleFiles();

	// Univers des event_id = (events avec texte ja/en/fr) ∪ (events voicés).
	const eventIds = new Set<string>();
	for (const lang of TEXT_LANGS) {
		const dir = join(TEXT_ROOT, lang, "event");
		for (const file of listJsonCfg(dir)) eventIds.add(textFileToId(file));
	}
	for (const id of subtitleIndex.keys()) eventIds.add(id);

	const out: EventAggregate[] = [];
	for (const eventId of eventIds) {
		const subLangs = subtitleIndex.get(eventId) ?? [];

		const dialogueLangs: string[] = [];
		let lineCount = 0;
		for (const lang of TEXT_LANGS) {
			const map = loadTextMap(eventId, lang);
			if (map) {
				dialogueLangs.push(lang);
				// line_count = master ja en priorité, sinon le max disponible.
				if (lang === "ja" || map.size > lineCount) lineCount = Math.max(lineCount, map.size);
			}
		}

		let subtitleRows = 0;
		if (subLangs.length > 0) {
			const canon = pickCanonicalLang(subLangs);
			const rows = parseSubtitleFile(join(SUBTITLE_ROOT, canon, `Subtitle_${eventId}.cfg.bin.json`));
			subtitleRows = rows?.length ?? 0;
		}

		out.push({
			event_id: eventId,
			episode: episodeOf(eventId),
			has_subtitle: subLangs.length > 0,
			subtitle_langs: subLangs,
			dialogue_langs: dialogueLangs.sort(),
			subtitle_rows: subtitleRows,
			line_count: lineCount,
			has_map: existsSync(join(WASHA_DIR, `${eventId}_map.cfg.bin.json`)),
		});
	}

	out.sort((a, b) => (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0));
	return out;
}
