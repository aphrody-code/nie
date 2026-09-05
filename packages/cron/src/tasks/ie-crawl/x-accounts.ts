/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Config centralisée des comptes X/Twitter officiels Inazuma Eleven / LEVEL-5.
// Multi-comptes pour ingestion cron + RAG (cf. UNIFIED-RAG-PLAN §4.1 + §8).
//
// Validés via bxc x profile + tweets (2026-06) + bxc x search discovery:
// - inazuma_project : イナズマイレブン公式 (JP, ~260k) — principal
// - inazuma_cross   : イナズマイレブン クロス 公式 (JP, ~46k) — officiel jeu mobile Cross
// - AkihiroHino : 日野晃博 CEO LEVEL-5 (~228k)
// - LEVEL5_times : レベルファイブ officiel (~134k)
// - Azalee_IE : Azalée FR community / relais (~13k)
// - InazumaSeries : Inazuma Eleven Series — officiel global EN (~34k)
// - Level5Hub : Level-5 Hub — news/leaks ES très actif (~3k, fort engagement)
//
// Comptes communauté/news haut-signal découverts via bxc x search (2026-06),
// vérifiés réels, centrés Inazuma Eleven (≠ news jeux généralistes bruyantes) :
// - DartsEnthusiast : EN news/analyse IE (~3.4k, stats DL, INA-DAI, leaks)
// - InazumaNational : EN clips/comparatifs IE (~11k)
// - ShinAngelico    : ES leaker/news IE (~22k, gros engagement trailers/DLC)
// - Braco_Frost     : ES news/leaks IE (~? , annonces DLC/mundial)
//
// Round 2 — découverte Grok (OIDC auth.x.ai, modèle grok-4.3) puis VÉRIFICATION
// individuelle via bxc x client (profil + tweets), 2026-06. Ajoutés uniquement les
// comptes RÉELS, centrés IE et à signal suffisant :
// - inazumaSD_L5   : イナズマイレブン SD 公式 (JP officiel, ~24.5k)
// - mutugame       : ムツゲーム — ambassadeur officiel LEVEL-5 公認 (JP, ~2k)
// - inazo__        : Inazo|Noa — FR news/analyse IE (~4.7k, interviews Hino, critiques VR)
// - ievrfr         : "Inazuma Eleven: Victory Road FR" (FR, ~500, dédié VR)
// - InazumaCrossFR : "Inazuma Cross FR" (FR, ~230, dédié Cross)
// - ElevenEspanol  : INAZUMA ELEVEN España (ES, ~15.7k, news communauté)
// - InazumaItalia  : Inazuma Eleven Italia (IT, ~2k, news communauté)
// - Tenmatsukaze2  : "Tenma: Inazuma Eleven" (PT/BR, ~2.4k)
// - TheBrasem      : EN — résumés Ina-Dai, dates DLC, nouveaux hissatsu (~1.2k, fort engagement)
// - Inazuma_JuuuN  : ジューーン — JA streamer/analyse VR+Cross (~2.4k, vues 100k+ sur hissatsu)
// - Koume_no_Inaire: コウメ大福 — JA compétitif/meta VR (~1.5k)
//
// Round 2 — ÉCARTÉS bien que RÉELS (vérifiés via bxc, mais signal insuffisant ou
// timeline trop bruyante pour un RAG informatif ; leur contenu IE reste capté par
// les requêtes de recherche dans harvest-search.ts) :
// - Suumash (~516) timeline multi-jeux (Sonic/Pokémon/SF6), trop de bruit
// - Peo_ie (~10), superonzeroad (~31) : trop peu de followers/activité
// - inazuma_1122/Tyode, dialgaburger, shiratoyanae, kanaruhanon : nom générique,
//   focus IE non confirmé sur la timeline (risque hors-sujet)
// - fanarts JP/ES petits comptes (Haru_anime_cos, nususi_53, makino35963,
//   TZUCHICHI1112, YGO_5838DUEL, lotto6700, YxTrPL8h1N44366, 4488ku, CAZADORX7,
//   fhilipecrash, YU_REI12) : <4k followers, fan-art (peu de texte informatif)
// Aucun handle Grok ne s'est révélé inexistant ce round (35/35 réels), mais ~24
// écartés pour signal/centrage.
//
// Découverts / testés (low activity ou non-officiel principal, conservés pour complétude):
// - InazumaElevenEN (EN, 3 followers, 0 tweets récents)
// - inazuma_eleven (fan/low, ~150)
// - hino_akihiro (low, 2 followers, 0 tweets)
// Non retenus (news jeux GÉNÉRALISTES — timeline trop bruyante pour le RAG IEVR,
// captés à la place par requêtes de recherche dans harvest-search.ts) :
// - gematsu, famitsu, siliconera, NinEverything, RPGSite, GoNintendoTweet…
// Non existants / erreurs UserByScreenName missing result:
// - inazuma_global, LEVEL5_official (pas de compte actif sous ces handles au moment du fetch).
//
// Usage: import { OFFICIAL_X_ACCOUNTS } from "./x-accounts";
// Le crawlTwitter reste additif (même signature), consomme cette liste par défaut.
// La découverte par requêtes (multi-langue, news/communauté) passe par
// crawlTwitterSearch (harvest-search.ts) — complémentaire des timelines ci-dessous.

export const OFFICIAL_X_ACCOUNTS = [
	"inazuma_project", // 公式 JP principal
	"inazuma_cross", // 公式 JP — jeu mobile Inazuma Eleven Cross
	"AkihiroHino", // CEO LEVEL-5
	"LEVEL5_times", // LEVEL-5 officiel
	"Azalee_IE", // FR
	"InazumaSeries", // Series / officiel global EN
	"Level5Hub", // news/leaks ES actif
	// communauté / news haut-signal centrés IE (découverte search bxc 2026-06)
	"DartsEnthusiast", // EN news/analyse
	"InazumaNational", // EN clips/comparatifs
	"ShinAngelico", // ES leaker/news
	"Braco_Frost", // ES news/leaks
	// round 2 — officiels + communauté vérifiés (Grok OIDC discovery + bxc verify)
	"inazumaSD_L5", // 公式 JP — Inazuma Eleven SD
	"mutugame", // ambassadeur officiel LEVEL-5 公認
	"inazo__", // FR news/analyse
	"ievrfr", // FR dédié Victory Road
	"InazumaCrossFR", // FR dédié Cross
	"ElevenEspanol", // ES communauté/news
	"InazumaItalia", // IT communauté/news
	"Tenmatsukaze2", // PT/BR communauté
	"TheBrasem", // EN résumés/news (Ina-Dai, DLC, hissatsu)
	"Inazuma_JuuuN", // JA streamer/analyse VR+Cross
	"Koume_no_Inaire", // JA compétitif/meta VR
	// low / fallback (gardés pour historique / search discovery, peuvent retourner 0)
	"InazumaElevenEN",
	"inazuma_eleven",
	"hino_akihiro",
] as const;

export type OfficialXAccount = (typeof OFFICIAL_X_ACCOUNTS)[number];

/** Comptes prioritaires (fort volume + activité) — pour crawls rapides ou filtrage RAG. */
export const PRIMARY_X_ACCOUNTS: readonly OfficialXAccount[] = [
	"inazuma_project",
	"inazuma_cross",
	"AkihiroHino",
	"LEVEL5_times",
	"Azalee_IE",
	"InazumaSeries",
] as const;

/** Retourne la liste complète (ou primaire si opt-in). */
export function getOfficialXAccounts(primaryOnly = false): readonly string[] {
	return primaryOnly ? PRIMARY_X_ACCOUNTS : OFFICIAL_X_ACCOUNTS;
}

/** Helper: charge cookie bxc xcom.json (si présent) et renvoie "auth_token=..; ct0=.." pour XSession.fromCookieString. */
export function loadBxcXCookieHeader(): string | null {
	try {
		const fs = require("node:fs") as typeof import("node:fs");
		const nodePath = require("node:path") as typeof import("node:path");
		const path = nodePath.join(process.env.HOME ?? "/home/ubuntu", ".bxc/cookies/xcom.json");
		if (!fs.existsSync(path)) return null;
		const cookies = JSON.parse(fs.readFileSync(path, "utf-8")) as Array<{ name: string; value: string }>;
		const auth = cookies.find((c) => c.name === "auth_token");
		const ct0 = cookies.find((c) => c.name === "ct0");
		if (!auth?.value || !ct0?.value) return null;
		return `auth_token=${auth.value}; ct0=${ct0.value}`;
	} catch {
		return null;
	}
}

/** Charge les cookies complets depuis bxc xcom.json pour injection dans Browser (bxc) ou XSession. */
export function loadBxcXCookies(): Array<{ name: string; value: string; domain?: string; path?: string }> {
	try {
		const fs = require("node:fs") as typeof import("node:fs");
		const nodePath = require("node:path") as typeof import("node:path");
		const path = nodePath.join(process.env.HOME ?? "/home/ubuntu", ".bxc/cookies/xcom.json");
		if (!fs.existsSync(path)) return [];
		const cookies = JSON.parse(fs.readFileSync(path, "utf-8")) as Array<{ name: string; value: string; domain?: string; path?: string }>;
		return cookies.map((c) => ({
			name: c.name,
			value: c.value,
			domain: c.domain || ".x.com",
			path: c.path || "/",
		}));
	} catch {
		return [];
	}
}
