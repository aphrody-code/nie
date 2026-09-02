/**
 * Collecteur des vidéos de techniques de `zukan.inazuma.jp`.
 *
 * Le catalogue des techniques est rendu CÔTÉ SERVEUR : deux `fetch()` statiques
 * (`?per_page=500&page=1` puis `page=2`) rapportent 100 % des attributs
 * `data-movie-url` / `data-poster-url`. Aucun navigateur headless n'est requis
 * — ce qui évite au passage la contrainte de barrel de `zukan/order.ts` (qui,
 * lui, tire `@aphrody-code/bxc` et ne doit jamais être ré-exporté).
 *
 * Ce module est PUR réseau + parsing : aucune écriture DB, aucune dépendance
 * Node hors `fetch`. Il remplace l'ancienne lecture de `/tmp/zukan/**` disparue.
 */

import { parseSkillListHtml } from "./parser.js";
import type { ZukanSkill } from "./types.js";

/** Locales servant réellement du contenu (fr/de/es/it → 302 vers `/`, ko/zh → 404). */
export const ZUKAN_SKILL_LOCALES = ["en", "ja"] as const;
export type ZukanSkillLocale = (typeof ZUKAN_SKILL_LOCALES)[number];

/** 500 par page = 2 requêtes pour tout le catalogue (903 `<li>`, 895 nommés). */
export const ZUKAN_SKILL_PER_PAGE = 500;
export const ZUKAN_SKILL_PAGES = 2;

const ZUKAN_ORIGIN = "https://zukan.inazuma.jp";

export function zukanSkillPageUrl(locale: ZukanSkillLocale, page: number): string {
	return `${ZUKAN_ORIGIN}/${locale}/skill/?per_page=${ZUKAN_SKILL_PER_PAGE}&page=${page}`;
}

/**
 * Normalise un nom de technique pour le matching (casse, balises, espaces,
 * ponctuation typographique). Utilisé des deux côtés (zukan et `inagle_skills`).
 */
export function normalizeSkillName(name: string): string {
	return name
		.replace(/<[^>]+>/g, "")
		.replace(/[‘’ʼ]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[‐-―−]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/** Récupère et parse une page de techniques. */
export async function fetchZukanSkillPage(
	locale: ZukanSkillLocale,
	page: number
): Promise<ZukanSkill[]> {
	const url = zukanSkillPageUrl(locale, page);
	const res = await fetch(url, {
		headers: {
			"accept-language": locale === "ja" ? "ja" : "en",
			"user-agent": "rose-griffon-inagle/2 (+https://azalee.rosegriffon.fr)",
		},
	});
	if (!res.ok) {
		throw new Error(`zukan ${locale} page ${page}: HTTP ${res.status}`);
	}
	return parseSkillListHtml(await res.text());
}

/** Récupère TOUT le catalogue de techniques d'une locale (2 requêtes). */
export async function fetchZukanSkills(locale: ZukanSkillLocale): Promise<ZukanSkill[]> {
	const skills: ZukanSkill[] = [];
	for (let page = 1; page <= ZUKAN_SKILL_PAGES; page++) {
		skills.push(...(await fetchZukanSkillPage(locale, page)));
	}
	return skills;
}

export interface ZukanSkillIndex {
	en: ZukanSkill[];
	ja: ZukanSkill[];
	/** nom EN normalisé → technique. */
	byNameEn: Map<string, ZukanSkill>;
	/** nom JA normalisé → technique EN correspondante (appariée par hash vidéo). */
	byNameJa: Map<string, ZukanSkill>;
}

/**
 * Construit l'index de matching EN + JA.
 *
 * Le hash CloudFront de la vidéo est indépendant de la locale : l'appariement
 * EN↔JA se fait dessus (mesuré 895/895), pas sur un ordre de page supposé.
 */
export async function fetchZukanSkillIndex(): Promise<ZukanSkillIndex> {
	const [en, ja] = await Promise.all([fetchZukanSkills("en"), fetchZukanSkills("ja")]);

	const byNameEn = new Map<string, ZukanSkill>();
	const byVideo = new Map<string, ZukanSkill>();
	for (const skill of en) {
		const key = normalizeSkillName(skill.name);
		if (key && !byNameEn.has(key)) byNameEn.set(key, skill);
		if (skill.videoUrl && !byVideo.has(skill.videoUrl)) byVideo.set(skill.videoUrl, skill);
	}

	const byNameJa = new Map<string, ZukanSkill>();
	for (const skill of ja) {
		const twin = skill.videoUrl ? byVideo.get(skill.videoUrl) : undefined;
		if (!twin) continue;
		const key = normalizeSkillName(skill.name);
		if (key && !byNameJa.has(key)) byNameJa.set(key, twin);
	}

	return { byNameEn, byNameJa, en, ja };
}
