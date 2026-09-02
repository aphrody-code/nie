/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Service de scraping exposé au bot Discord par le pont IPC UNIX du cron.
 *
 * ── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
 * Les moteurs de scraping (`@aphrody-code/bxc`, `@aphrody-code/x`) sont
 * installés dans `packages/cron`, PAS dans `apps/bot`, et ils n'y seront pas
 * installés : toucher au fichier de verrouillage casserait la CI (`bun.lock`
 * doit rester en version 1, or le Bun local est un canari 1.4 qui écrit en
 * version 2). Le bot atteint donc ces moteurs par la socket UNIX déjà en place
 * (`lib/ipc-unix.ts` ici, `apps/bot/src/lib/cron-ipc.ts` en face).
 *
 * ── CONTRAT DES SIX VERBES ──────────────────────────────────────────────────
 * Toutes les réponses suivent la forme déjà en vigueur sur le pont :
 * succès → `{ success: true, ...charge }`,
 * échec  → `{ success: false, error: "<message en français>", code: "<code>" }`.
 *
 * Codes d'erreur possibles, communs aux six verbes :
 *   `requete_invalide`     — paramètre manquant, vide, mal formé, ou URL refusée
 *                            (schéma non http/https, hôte local ou privé).
 *   `occupe`               — une requête de ce verbe est déjà en vol (un seul
 *                            scraping lourd à la fois).
 *   `trop_de_requetes`     — plafond par minute atteint (verbe ou global).
 *   `delai_depasse`        — le scraping n'a pas rendu la main dans son délai.
 *   `moteur_indisponible`  — le moteur requis n'est pas exploitable sur cet hôte
 *                            (bibliothèque native absente, moteur de recherche
 *                            bloqué, identifiants X absents).
 *   `introuvable`          — la ressource demandée n'existe pas (compte X, etc.).
 *   `erreur_scraping`      — tout le reste, message nettoyé de ses secrets.
 *
 * 1. `scrape.page` — rendu d'une page en markdown.
 *    Entrée  : `{ url: string, profil?: "static" | "http" }`
 *              `static` (défaut) = moteur DOM en processus, aucune dépendance
 *              native ; `http` = curl-impersonate (empreinte TLS d'un vrai
 *              navigateur), refusé en `moteur_indisponible` si la bibliothèque
 *              `libcurl-impersonate` est absente de l'hôte.
 *    Sortie  : `{ success: true, url, statut, titre, markdown, tronque,
 *                 octets, profil, ms }`
 *              `markdown` borné à 3500 caractères (l'embed Discord plafonne sa
 *              description à 4096) ; `tronque` dit si la coupe a eu lieu ;
 *              `octets` = poids UTF-8 du HTML source ; `url` = URL demandée.
 *    Délai   : 45 s. Débit : 1 en vol, 6 par minute.
 *
 * 2. `scrape.google` — recherche web.
 *    Entrée  : `{ requete: string, limite?: number }` (limite 1..8, défaut 5)
 *    Sortie  : `{ success: true, requete, moteur, resultats: [{ titre, url,
 *                 extrait }], ms }`
 *              ⚠ `moteur` vaut `"google"` ou `"duckduckgo"` et n'est PAS
 *              décoratif : mesuré le 13/8/2026, Google sert une page reCAPTCHA
 *              à l'adresse IP de ce VPS sur TOUS les transports de bxc (fetch
 *              authentifié, curl-impersonate, Chromium) — `googleWebSearch`
 *              renvoie alors une liste vide. On tente donc Google d'abord (le
 *              jour où le blocage tombe, le verbe reprend sa source première) et
 *              on se rabat sur le rendu HTML sans JavaScript de DuckDuckGo, qui
 *              répond, lui, depuis cet hôte. Le champ `moteur` dit lequel a
 *              réellement répondu : l'embed Discord doit l'afficher.
 *    Délai   : 40 s. Débit : 1 en vol, 6 par minute.
 *
 * 3. `scrape.recon` — diagnostic technique d'une page.
 *    Entrée  : `{ url: string }`
 *    Sortie  : `{ success: true, url, urlFinale, statut, statutTexte,
 *                 typeContenu, titre, octets, corpsTronque, ms,
 *                 enTetes: Record<string,string>,
 *                 technologies: string[],
 *                 liens: { total, internes, externes, exemples: string[] } }`
 *              `octets` = nombre d'octets RÉELLEMENT lus du corps (0 sur un
 *              corps binaire, qui n'est pas téléchargé) ; `corpsTronque` dit si
 *              la lecture s'est arrêtée au plafond de 2 Mo — au-delà, la taille
 *              totale de la ressource n'est pas connue et n'est donc pas
 *              inventée. `enTetes` ne contient que des en-têtes
 *              d'infrastructure (aucun `set-cookie`, aucune valeur
 *              d'authentification). `technologies` vient d'une détection maison
 *              par signatures d'en-têtes et de balises : le binaire
 *              `wappalyzergo-cli` de bxc n'est PAS installé sur cet hôte
 *              (`resolveBinary()` lève), donc `detectFrameworks` n'est pas
 *              utilisable ici.
 *    Délai   : 30 s. Débit : 1 en vol, 6 par minute.
 *
 * 4. `x.profil` — fiche d'un compte X.
 *    Entrée  : `{ pseudo: string }` (avec ou sans `@`)
 *    Sortie  : `{ success: true, fiche: { pseudo, id, nom, description,
 *                 abonnes, abonnements, certifie, avatar, creeLe, url }, ms }`
 *    Erreurs : `introuvable` si X ne renvoie pas de compte.
 *    Délai   : 25 s. Débit : 1 en vol, 10 par minute.
 *
 * 5. `x.posts` — derniers posts d'un compte.
 *    Entrée  : `{ pseudo: string, limite?: number }` (limite 1..10, défaut 5)
 *    Sortie  : `{ success: true, pseudo, posts: PostX[], ms }`
 *    Délai   : 45 s. Débit : 1 en vol, 10 par minute.
 *
 * 6. `x.recherche` — posts correspondant à une requête.
 *    Entrée  : `{ requete: string, limite?: number }` (limite 1..10, défaut 5)
 *    Sortie  : `{ success: true, requete, posts: PostX[], ms }`
 *    Délai   : 45 s. Débit : 1 en vol, 10 par minute.
 *
 * `PostX` = `{ id, url, auteur, auteurNom, date, texte, likes, retweets,
 *              reponses, vues, medias }` — `texte` borné à 400 caractères,
 * `date` en ISO 8601 (X publie un format non standard, converti ici).
 *
 * ── CE QUE CE MODULE GARANTIT AU DÉMON ──────────────────────────────────────
 * • Aucun verbe ne peut faire tomber `rg-cron` : chaque appel est enveloppé,
 *   toute exception devient une réponse `{ success: false }`.
 * • Aucun verbe ne peut occuper le VPS : un scraping lourd à la fois par verbe,
 *   trois au maximum tous verbes confondus, plus un plafond glissant par minute.
 * • Aucune charge n'est illimitée : markdown, listes, en-têtes et textes sont
 *   bornés AVANT de traverser la socket, et le corps distant lui-même est lu par
 *   morceaux puis abandonné à 2 Mo (`lireCorpsBorne`) — une URL pointant sur une
 *   archive de plusieurs gigaoctets ne peut pas saturer la mémoire du démon.
 * • Aucun secret ne part dans le journal ni dans un message d'erreur : les
 *   valeurs de cookie et de jeton sont masquées par `nettoyerMessage`.
 * • Aucune requête vers l'intérieur : `validerUrl` refuse `localhost`, les
 *   plages privées et les schémas autres que http/https — le cron partage sa
 *   machine avec dix services internes en écoute sur `127.0.0.1`.
 *   Limite honnête : cette garde regarde l'hôte écrit dans l'URL, pas l'adresse
 *   finalement résolue ; elle n'arrête donc pas un nom public pointant
 *   volontairement sur une adresse privée.
 *
 * Les moteurs sont chargés PARESSEUSEMENT (`await import`) : le démon démarre
 * sans eux, et un paquet cassé ne dégrade que le verbe concerné.
 */

import type { XClient } from "@aphrody-code/x";
import { loadBxcXCookieHeader } from "./x-accounts";

// ─── Bornes de charge ────────────────────────────────────────────────────────

/** Markdown renvoyé par `scrape.page` (embed Discord : 4096 pour la description). */
export const LIMITE_MARKDOWN = 3500;
/** Texte d'un post X (embed Discord : 1024 par champ). */
export const LIMITE_TEXTE_POST = 400;
/** Extrait d'un résultat de recherche web. */
export const LIMITE_EXTRAIT = 300;
/** Description d'une fiche de compte X. */
export const LIMITE_DESCRIPTION = 500;
/** Nombre d'en-têtes retenus par `scrape.recon`. */
export const LIMITE_ENTETES = 14;
/** Nombre de liens d'exemple retenus par `scrape.recon`. */
export const LIMITE_LIENS_EXEMPLES = 10;
/** HTML lu par `scrape.recon` avant analyse (2 Mo). */
export const LIMITE_HTML_OCTETS = 2_000_000;

/** Agent utilisateur commun aux appels directs (recon, repli DuckDuckGo). */
const AGENT_UTILISATEUR =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Emplacements connus de `libcurl-impersonate` sur nos hôtes.
 *
 * Le paquet npm `@aphrody/bxc` 0.6.7 ne l'embarque pas ; le profil `http` lève
 * donc « libcurl-impersonate not found » tant que `LIBCURL_IMPERSONATE_PATH`
 * n'est pas posé. La bibliothèque existe sur ce VPS, héritée de l'installation
 * bxc locale : on l'utilise si elle est là, on refuse proprement sinon.
 */
const CHEMINS_CURL_IMPERSONATE = [
	"/home/ubuntu/bxc/vendor/curl-impersonate/libcurl-impersonate.so",
	"/home/ubuntu/bxc/vendor/curl-impersonate/libcurl-impersonate.so.4",
];

// ─── Réponses et erreurs ─────────────────────────────────────────────────────

/**
 * Forme de réponse du pont. Volontairement redéclarée ici plutôt qu'importée de
 * `../../lib/ipc-unix` : le pont importe ce module, l'inverse créerait un cycle.
 */
export interface ReponseScrape {
	success: boolean;
	error?: string;
	code?: string;
	[clef: string]: unknown;
}

export type CodeErreurScrape =
	| "requete_invalide"
	| "occupe"
	| "trop_de_requetes"
	| "delai_depasse"
	| "moteur_indisponible"
	| "introuvable"
	| "erreur_scraping";

export class ErreurScrape extends Error {
	public readonly code: CodeErreurScrape;

	constructor(code: CodeErreurScrape, message: string) {
		super(message);
		this.name = "ErreurScrape";
		this.code = code;
	}
}

/**
 * Masque tout ce qui ressemble à un secret dans un message d'erreur.
 *
 * Les moteurs recopient parfois l'URL ou l'en-tête fautif dans leur message ;
 * la session X vit dans un `Cookie: auth_token=…; ct0=…`, et ce message finira
 * dans un salon Discord ET dans le journal systemd.
 */
export function nettoyerMessage(message: string): string {
	return message
		.replace(/(auth_token|ct0|csrf_token|token|api[_-]?key|password)=([^;&\s"']+)/gi, "$1=***")
		.replace(/Bearer\s+[A-Za-z0-9._%-]+/gi, "Bearer ***")
		.replace(/(gt|guest_id|kdt|twid)=([^;&\s"']+)/gi, "$1=***")
		.slice(0, 400);
}

/**
 * Coupe un texte à `limite` caractères en signalant la coupe par « … ».
 * Retire au passage les caractères de largeur nulle, qu'un site peut semer dans
 * son HTML et qui consomment le quota d'un embed sans rien afficher.
 */
export function bornerTexte(valeur: string, limite: number): string {
	const propre = valeur.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
	return propre.length <= limite ? propre : `${propre.slice(0, Math.max(0, limite - 1)).trimEnd()}…`;
}

/** Ramène un entier dans `[min, max]`, avec repli sur `defaut` si absent/illisible. */
export function bornerEntier(valeur: unknown, defaut: number, min: number, max: number): number {
	const nombre = typeof valeur === "number" ? valeur : Number.parseInt(String(valeur ?? ""), 10);
	if (!Number.isFinite(nombre)) {
		return defaut;
	}
	return Math.min(max, Math.max(min, Math.trunc(nombre)));
}

// ─── Validation des entrées ──────────────────────────────────────────────────

/** Hôtes bouclés ou réservés, refusés quelle que soit la casse. */
const HOTES_INTERDITS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "metadata.google.internal"]);

function estAdressePrivee(hote: string): boolean {
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hote);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		if (a === 10 || a === 127 || a === 0) return true;
		if (a === 169 && b === 254) return true; // lien-local / métadonnées cloud
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
		return false;
	}
	const sansCrochets = hote.replace(/^\[|\]$/g, "").toLowerCase();
	// ULA (fc00::/7) et lien-local IPv6 (fe80::/10).
	return /^f[cd][0-9a-f]{2}:/.test(sansCrochets) || /^fe[89ab][0-9a-f]:/.test(sansCrochets);
}

/**
 * Valide une URL fournie par un membre Discord.
 *
 * Refuse tout ce qui n'est pas http/https, ainsi que les hôtes locaux, privés
 * et le service de métadonnées cloud : le cron tourne sur un VPS où dix
 * services internes écoutent sur la boucle locale (PostgREST, stockage, API
 * azalée…) et n'exigent aucune identification.
 */
export function validerUrl(brut: unknown): URL {
	if (typeof brut !== "string" || brut.trim().length === 0) {
		throw new ErreurScrape("requete_invalide", "Il manque l'URL à analyser.");
	}
	const texte = brut.trim();
	let url: URL;
	try {
		url = new URL(texte);
	} catch {
		throw new ErreurScrape("requete_invalide", `« ${bornerTexte(texte, 80)} » n'est pas une URL valide.`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new ErreurScrape("requete_invalide", "Seules les adresses http:// et https:// sont acceptées.");
	}
	const hote = url.hostname.toLowerCase();
	if (HOTES_INTERDITS.has(hote) || hote.endsWith(".localhost") || hote.endsWith(".local") || estAdressePrivee(hote)) {
		throw new ErreurScrape("requete_invalide", "Cette adresse vise le réseau interne du serveur : refusée.");
	}
	return url;
}

/** Valide une requête textuelle (recherche web, recherche X). */
export function validerRequete(brut: unknown, minimum = 2): string {
	if (typeof brut !== "string") {
		throw new ErreurScrape("requete_invalide", "Il manque la requête de recherche.");
	}
	const texte = brut.trim();
	if (texte.length < minimum) {
		throw new ErreurScrape("requete_invalide", `La requête doit faire au moins ${minimum} caractères.`);
	}
	return bornerTexte(texte, 200);
}

/** Normalise un pseudo X : retire le `@`, l'URL complète, et valide la forme. */
export function validerPseudo(brut: unknown): string {
	if (typeof brut !== "string") {
		throw new ErreurScrape("requete_invalide", "Il manque le pseudo du compte X.");
	}
	const nettoye = brut
		.trim()
		.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
		.replace(/[/?#].*$/, "")
		.replace(/^@/, "");
	if (!/^[A-Za-z0-9_]{1,15}$/.test(nettoye)) {
		throw new ErreurScrape(
			"requete_invalide",
			"Un pseudo X ne contient que des lettres, des chiffres et des soulignés (15 au maximum)."
		);
	}
	return nettoye;
}

// ─── Limitation de débit ─────────────────────────────────────────────────────

/**
 * Limiteur à deux étages : concurrence et fenêtre glissante d'une minute.
 *
 * Une commande Discord répétée en boucle est le scénario par défaut, pas le cas
 * limite : sans ce garde, six `/scrape` d'affilée lanceraient six rendus de page
 * simultanés sur la machine qui sert aussi le site et le wiki.
 *
 * `maintenant` est injectable pour que les tests n'attendent pas une minute.
 */
export class LimiteurDebit {
	readonly nom: string;
	readonly maxSimultane: number;
	readonly maxParMinute: number;
	#enVol = 0;
	#horodatages: number[] = [];
	readonly #maintenant: () => number;

	constructor(nom: string, maxSimultane: number, maxParMinute: number, maintenant: () => number = Date.now) {
		this.nom = nom;
		this.maxSimultane = maxSimultane;
		this.maxParMinute = maxParMinute;
		this.#maintenant = maintenant;
	}

	/** Nombre d'appels retenus dans la dernière minute (après purge). */
	get consommeDansLaMinute(): number {
		this.#purger();
		return this.#horodatages.length;
	}

	get enVol(): number {
		return this.#enVol;
	}

	#purger(): void {
		const limite = this.#maintenant() - 60_000;
		this.#horodatages = this.#horodatages.filter((t) => t > limite);
	}

	/** Réserve un jeton ou lève. À libérer systématiquement par `liberer()`. */
	reserver(): void {
		this.#purger();
		if (this.#enVol >= this.maxSimultane) {
			throw new ErreurScrape(
				"occupe",
				this.maxSimultane === 1
					? "Un scraping identique est déjà en cours : réessaie dans quelques secondes."
					: "Trop de scrapings simultanés : réessaie dans quelques secondes."
			);
		}
		if (this.#horodatages.length >= this.maxParMinute) {
			throw new ErreurScrape(
				"trop_de_requetes",
				`Plafond atteint (${this.maxParMinute} par minute) : réessaie dans une minute.`
			);
		}
		this.#horodatages.push(this.#maintenant());
		this.#enVol += 1;
	}

	liberer(): void {
		this.#enVol = Math.max(0, this.#enVol - 1);
	}
}

/** Plafond commun à tous les verbes : le VPS sert aussi le site et le wiki. */
const LIMITEUR_GLOBAL = new LimiteurDebit("global", 3, 24);

const LIMITEURS: Record<string, LimiteurDebit> = {
	"scrape.page": new LimiteurDebit("scrape.page", 1, 6),
	"scrape.google": new LimiteurDebit("scrape.google", 1, 6),
	"scrape.recon": new LimiteurDebit("scrape.recon", 1, 6),
	"x.profil": new LimiteurDebit("x.profil", 1, 10),
	"x.posts": new LimiteurDebit("x.posts", 1, 10),
	"x.recherche": new LimiteurDebit("x.recherche", 1, 10),
};

/** Délai d'expiration par verbe, en millisecondes (60 s au maximum). */
const DELAIS_MS: Record<string, number> = {
	"scrape.page": 45_000,
	"scrape.google": 40_000,
	"scrape.recon": 30_000,
	"x.profil": 25_000,
	"x.posts": 45_000,
	"x.recherche": 45_000,
};

/** Liste des verbes servis par ce module (le pont s'en sert pour router). */
export const VERBES_SCRAPE = Object.keys(LIMITEURS) as readonly string[];

export function estVerbeScrape(verbe: string): boolean {
	return Object.hasOwn(LIMITEURS, verbe);
}

/**
 * Borne la durée d'une promesse.
 *
 * Ne l'annule pas — aucun des moteurs n'expose de signal d'abandon — mais rend
 * la main à l'appelant Discord, qui n'a que 15 minutes de jeton d'interaction et
 * beaucoup moins de patience.
 */
async function avecDelai<T>(promesse: Promise<T>, delaiMs: number, quoi: string): Promise<T> {
	let minuteur: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promesse,
			new Promise<never>((_, rejeter) => {
				minuteur = setTimeout(
					() =>
						rejeter(
							new ErreurScrape("delai_depasse", `${quoi} n'a pas répondu en ${Math.round(delaiMs / 1000)} s.`)
						),
					delaiMs
				);
			}),
		]);
	} finally {
		if (minuteur) {
			clearTimeout(minuteur);
		}
	}
}

// ─── Lecture bornée d'un corps de réponse ────────────────────────────────────

/** Poids UTF-8 réel d'une chaîne, en octets (≠ nombre de caractères). */
export function tailleOctets(texte: string): number {
	return Buffer.byteLength(texte, "utf8");
}

/**
 * Extrait le jeu de caractères d'un `content-type`, réduit à ce que
 * `TextDecoder` sait décoder. Repli sur `utf-8`, y compris sur une étiquette
 * inconnue : un site en `windows-1252` doit rendre « Société », pas « SociÃ©tÃ© ».
 */
export function charsetDepuisTypeContenu(typeContenu: string | null): string {
	const trouve = /charset\s*=\s*"?([\w-]+)"?/i.exec(typeContenu ?? "");
	const etiquette = trouve?.[1]?.toLowerCase();
	if (!etiquette) {
		return "utf-8";
	}
	try {
		// Construction jetable : seul moyen de savoir si l'étiquette est connue.
		creerDecodeur(etiquette);
		return etiquette;
	} catch {
		return "utf-8";
	}
}

/**
 * Construit un `TextDecoder` pour une étiquette WHATWG quelconque.
 *
 * La conversion est nécessaire et volontaire : les types Bun déclarent le
 * paramètre en `Bun.Encoding`, l'union des encodages de `Buffer` (`utf-8`,
 * `latin1`, `hex`…), alors que l'implémentation accepte tout label WHATWG —
 * `windows-1252`, `shift_jis`… C'est ce que vérifie le test de décodage de
 * « Société » en windows-1252. Une étiquette inconnue lève `RangeError`, ce dont
 * `charsetDepuisTypeContenu` se sert pour retomber sur `utf-8`.
 */
function creerDecodeur(etiquette: string): TextDecoder {
	return new TextDecoder(etiquette as ConstructorParameters<typeof TextDecoder>[0], { fatal: false });
}

export interface CorpsLu {
	texte: string;
	/** Octets réellement lus (jamais une taille annoncée par le serveur). */
	octets: number;
	/** Vrai si la lecture s'est arrêtée au plafond : la ressource est plus grosse. */
	tronque: boolean;
}

/**
 * Lit le corps d'une réponse en s'arrêtant à `maxOctets`.
 *
 * `Response.text()` chargerait TOUT en mémoire : une URL Discord pointant sur
 * une archive de plusieurs gigaoctets suffirait à faire tomber `rg-cron`, ce
 * que ce module promet d'empêcher. On lit donc par morceaux, on s'arrête au
 * plafond et on annule le flux — la connexion est libérée sans télécharger le
 * reste.
 */
export async function lireCorpsBorne(reponse: Response, maxOctets: number): Promise<CorpsLu> {
	const flux = reponse.body;
	if (!flux) {
		return { texte: "", octets: 0, tronque: false };
	}
	const lecteur = flux.getReader();
	const morceaux: Uint8Array[] = [];
	let octets = 0;
	let tronque = false;
	try {
		while (octets < maxOctets) {
			const { done, value } = await lecteur.read();
			if (done) {
				break;
			}
			if (!value || value.byteLength === 0) {
				continue;
			}
			morceaux.push(value);
			octets += value.byteLength;
			if (octets >= maxOctets) {
				tronque = true;
				break;
			}
		}
	} finally {
		try {
			await lecteur.cancel();
		} catch {
			/* flux déjà clos par le serveur */
		}
	}

	const assemble = new Uint8Array(octets);
	let curseur = 0;
	for (const morceau of morceaux) {
		assemble.set(morceau, curseur);
		curseur += morceau.byteLength;
	}
	// `creerDecodeur` pose `fatal: false` : un dernier morceau coupé au milieu
	// d'un caractère ne doit pas faire échouer tout le diagnostic.
	const decodeur = creerDecodeur(charsetDepuisTypeContenu(reponse.headers.get("content-type")));
	// Sur une lecture tronquée, les 4 derniers octets peuvent être un caractère
	// incomplet : on les écarte plutôt que de rendre un « caractère de
	// remplacement » en fin de texte.
	const texte = decodeur.decode(tronque ? assemble.subarray(0, Math.max(0, octets - 4)) : assemble);
	return { texte, octets, tronque };
}

// ─── Analyse pure : technologies, liens, SERP, fiche X ───────────────────────

/** En-têtes d'infrastructure retenus par `scrape.recon`, dans cet ordre. */
const ENTETES_NOTABLES = [
	"server",
	"content-type",
	"content-length",
	"content-encoding",
	"cache-control",
	"age",
	"x-powered-by",
	"x-cache",
	"cf-ray",
	"cf-cache-status",
	"via",
	"x-vercel-id",
	"x-nextjs-cache",
	"strict-transport-security",
	"x-frame-options",
	"x-content-type-options",
	"content-security-policy",
	"alt-svc",
	"last-modified",
	"etag",
];

/**
 * Extrait les en-têtes d'infrastructure d'une réponse.
 *
 * Liste blanche stricte : jamais de `set-cookie`, jamais d'`authorization`,
 * jamais d'en-tête inconnu — la sortie part dans un salon Discord.
 */
export function extraireEntetes(entetes: Headers): Record<string, string> {
	const retenus: Record<string, string> = {};
	for (const nom of ENTETES_NOTABLES) {
		if (Object.keys(retenus).length >= LIMITE_ENTETES) {
			break;
		}
		const valeur = entetes.get(nom);
		if (valeur) {
			retenus[nom] = bornerTexte(valeur, 120);
		}
	}
	return retenus;
}

interface SignatureTechno {
	nom: string;
	entete?: [string, RegExp];
	html?: RegExp;
}

/**
 * Signatures de détection.
 *
 * Détection maison assumée : le binaire `wappalyzergo-cli` dont dépend
 * `detectFrameworks` de bxc n'est pas installé sur cet hôte (`resolveBinary()`
 * lève « wappalyzergo-cli binary not found »). Ces signatures ne couvrent que
 * ce qui se lit sans ambiguïté dans les en-têtes ou le HTML servi.
 */
const SIGNATURES: readonly SignatureTechno[] = [
	{ nom: "Next.js", entete: ["x-powered-by", /next\.js/i], html: /\/_next\/static\/|__NEXT_DATA__/ },
	{ nom: "React", html: /data-reactroot|react(?:-dom)?(?:\.production)?\.min\.js/i },
	{ nom: "Nuxt", html: /__NUXT__|\/_nuxt\// },
	{ nom: "Vue.js", html: /vue(?:\.runtime)?(?:\.min)?\.js|data-v-[0-9a-f]{8}/i },
	{ nom: "Svelte", html: /\/_app\/immutable\/|svelte-[0-9a-z]{6}/ },
	{ nom: "Angular", html: /ng-version="|\bng-app\b/ },
	{ nom: "WordPress", html: /\/wp-content\/|\/wp-includes\/|name="generator" content="WordPress/i },
	{ nom: "Drupal", html: /drupal-settings-json|\/sites\/default\/files\// },
	{ nom: "Shopify", html: /cdn\.shopify\.com|Shopify\.theme/ },
	{ nom: "jQuery", html: /jquery(?:-|\.)\d|jquery(?:\.min)?\.js/i },
	{ nom: "Swiper", html: /swiper(?:-bundle)?(?:\.min)?\.(?:js|css)/i },
	{ nom: "Bootstrap", html: /bootstrap(?:\.bundle)?(?:\.min)?\.(?:js|css)/i },
	{ nom: "Tailwind CSS", html: /tailwind(?:css)?(?:\.min)?\.css|--tw-/ },
	{ nom: "Google Tag Manager", html: /googletagmanager\.com\/(?:gtm|gtag)/ },
	{ nom: "Google Analytics", html: /google-analytics\.com|gtag\('config'/ },
	{ nom: "Google Fonts", html: /fonts\.googleapis\.com/ },
	{ nom: "Cloudflare", entete: ["server", /cloudflare/i] },
	{ nom: "nginx", entete: ["server", /nginx/i] },
	{ nom: "OpenResty", entete: ["server", /openresty/i] },
	{ nom: "Apache", entete: ["server", /apache/i] },
	{ nom: "Caddy", entete: ["server", /caddy/i] },
	{ nom: "Amazon CloudFront", entete: ["via", /cloudfront/i] },
	{ nom: "Vercel", entete: ["server", /vercel/i] },
	{ nom: "PHP", entete: ["x-powered-by", /php/i] },
	{ nom: "ASP.NET", entete: ["x-powered-by", /asp\.net/i] },
	{ nom: "Express", entete: ["x-powered-by", /express/i] },
	{ nom: "HSTS", entete: ["strict-transport-security", /max-age/i] },
	{ nom: "HTTP/3 annoncé", entete: ["alt-svc", /h3/i] },
];

/**
 * Détecte les technologies d'une page à partir de ses en-têtes et de son HTML.
 * Renvoie une liste triée, sans doublon.
 */
export function detecterTechnologies(entetes: Record<string, string>, html: string): string[] {
	const enMinuscules: Record<string, string> = {};
	for (const [clef, valeur] of Object.entries(entetes)) {
		enMinuscules[clef.toLowerCase()] = valeur;
	}
	const trouvees = new Set<string>();
	for (const signature of SIGNATURES) {
		if (signature.entete) {
			const [nom, motif] = signature.entete;
			const valeur = enMinuscules[nom];
			if (valeur && motif.test(valeur)) {
				trouvees.add(signature.nom);
				continue;
			}
		}
		if (signature.html && signature.html.test(html)) {
			trouvees.add(signature.nom);
		}
	}
	const generateur = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i.exec(html);
	if (generateur?.[1]) {
		trouvees.add(bornerTexte(generateur[1], 60));
	}
	return [...trouvees].sort((a, b) => a.localeCompare(b, "fr"));
}

export interface ResumeLiens {
	total: number;
	internes: number;
	externes: number;
	exemples: string[];
}

/** Compte et échantillonne les liens `<a href>` d'une page, résolus en absolu. */
export function extraireLiens(html: string, base: string): ResumeLiens {
	const vus = new Set<string>();
	let internes = 0;
	let externes = 0;
	let hoteBase = "";
	try {
		hoteBase = new URL(base).hostname;
	} catch {
		hoteBase = "";
	}
	for (const trouve of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
		const brut = trouve[1]?.trim();
		if (!brut || brut.startsWith("#") || /^(?:javascript|mailto|tel|data):/i.test(brut)) {
			continue;
		}
		let absolu: string;
		try {
			absolu = new URL(brut, base).toString();
		} catch {
			continue;
		}
		if (!/^https?:/i.test(absolu) || vus.has(absolu)) {
			continue;
		}
		vus.add(absolu);
		if (new URL(absolu).hostname === hoteBase) {
			internes += 1;
		} else {
			externes += 1;
		}
	}
	return {
		total: vus.size,
		internes,
		externes,
		exemples: [...vus].slice(0, LIMITE_LIENS_EXEMPLES).map((u) => bornerTexte(u, 180)),
	};
}

export interface ResultatRecherche {
	titre: string;
	url: string;
	extrait: string;
}

/**
 * Entités nommées décodées.
 *
 * DuckDuckGo n'en émet que trois (`&amp;`, `&#x27;`, `&nbsp;`, relevé le
 * 13/8/2026), mais les `<title>` analysés par `scrape.recon` viennent de
 * n'importe quel site : la table couvre donc les accents français et la
 * ponctuation typographique, qu'un titre non décodé afficherait en charabia
 * dans l'embed.
 */
const ENTITES_NOMMEES: Record<string, string> = {
	quot: '"',
	apos: "'",
	nbsp: " ",
	lt: "<",
	gt: ">",
	amp: "&",
	eacute: "é",
	egrave: "è",
	ecirc: "ê",
	euml: "ë",
	agrave: "à",
	acirc: "â",
	ccedil: "ç",
	ugrave: "ù",
	ucirc: "û",
	uuml: "ü",
	icirc: "î",
	iuml: "ï",
	ocirc: "ô",
	oelig: "œ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	laquo: "«",
	raquo: "»",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	euro: "€",
	deg: "°",
	times: "×",
	middot: "·",
	bull: "•",
};

/** Décode une entité HTML nommée ou numérique. `&amp;` est traité en dernier. */
function decoderEntites(texte: string): string {
	return texte
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
		.replace(/&([a-z]+);/gi, (entier, nom: string) => ENTITES_NOMMEES[nom.toLowerCase()] ?? entier)
		.replace(/&amp;/g, "&");
}

/** Retire les balises d'un fragment HTML et normalise ses blancs. */
function texteBrut(fragment: string): string {
	return decoderEntites(fragment.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/**
 * Analyse le HTML sans JavaScript de `html.duckduckgo.com/html/`.
 *
 * Structure relevée le 13/8/2026 : un bloc `<div class="result …">` par
 * résultat, titre dans `<a class="result__a" href="//duckduckgo.com/l/?uddg=…">`,
 * extrait dans `<a class="result__snippet">`. Les publicités portent la classe
 * `result--ad` ET une cible `duckduckgo.com/y.js` : les deux sont écartées.
 */
export function analyserSerpDuckDuckGo(html: string, limite: number): ResultatRecherche[] {
	const resultats: ResultatRecherche[] = [];
	const blocs = html.split(/<div class="result\b/);
	for (const bloc of blocs.slice(1)) {
		if (resultats.length >= limite) {
			break;
		}
		const enTeteBloc = bloc.slice(0, 200);
		if (/result--ad/.test(enTeteBloc)) {
			continue;
		}
		const lien = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(bloc);
		if (!lien) {
			continue;
		}
		const url = deplierLienDuckDuckGo(lien[1] ?? "");
		if (!url) {
			continue;
		}
		let hote: string;
		try {
			hote = new URL(url).hostname;
		} catch {
			continue;
		}
		if (hote.endsWith("duckduckgo.com")) {
			continue; // redirection publicitaire `y.js`
		}
		const extrait = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(bloc);
		resultats.push({
			titre: bornerTexte(texteBrut(lien[2] ?? "") || hote, 160),
			url: bornerTexte(url, 300),
			extrait: bornerTexte(texteBrut(extrait?.[1] ?? ""), LIMITE_EXTRAIT),
		});
	}
	return resultats;
}

/** Déplie `//duckduckgo.com/l/?uddg=<url encodée>` vers l'URL réelle. */
export function deplierLienDuckDuckGo(href: string): string | null {
	const decode = decoderEntites(href.trim());
	const absolu = decode.startsWith("//") ? `https:${decode}` : decode;
	try {
		const url = new URL(absolu);
		const cible = url.searchParams.get("uddg");
		if (cible) {
			return cible;
		}
		return /^https?:$/.test(url.protocol) ? url.toString() : null;
	} catch {
		return null;
	}
}

export interface FicheX {
	pseudo: string;
	id: string;
	nom: string;
	description: string;
	abonnes: number | null;
	abonnements: number | null;
	certifie: boolean;
	avatar: string | null;
	creeLe: string | null;
	url: string;
}

/**
 * Convertit la date X (« Sun May 09 18:37:38 +0000 2021 ») en ISO 8601.
 * Renvoie `null` si la valeur est absente ou illisible : jamais la date du jour,
 * qui ferait passer une donnée manquante pour une donnée fraîche.
 */
export function dateXVersIso(brut: unknown): string | null {
	if (typeof brut !== "string" || brut.trim().length === 0) {
		return null;
	}
	const instant = new Date(brut);
	return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/**
 * Construit une fiche depuis `data.user.result` de l'opération GraphQL
 * `UserByScreenName`.
 *
 * Écrit ici plutôt qu'emprunté à `parseUserResult` du paquet : ce symbole n'est
 * pas déclaré dans le shim de types `packages/cron/types/x-shim.d.ts`, seul
 * contrat visible de tsc pour `@aphrody-code/x`. Les champs lus sont ceux
 * qu'utilise le paquet (`core` d'abord, `legacy` en repli).
 */
export function ficheDepuisResultatX(resultat: unknown, pseudoDemande: string): FicheX | null {
	if (!resultat || typeof resultat !== "object") {
		return null;
	}
	const brut = resultat as Record<string, unknown>;
	const legacy = (brut.legacy ?? {}) as Record<string, unknown>;
	const core = (brut.core ?? {}) as Record<string, unknown>;
	const avatarObjet = (brut.avatar ?? {}) as Record<string, unknown>;

	const id =
		(typeof brut.rest_id === "string" && brut.rest_id) ||
		(typeof legacy.id_str === "string" && legacy.id_str) ||
		"";
	const pseudo =
		(typeof core.screen_name === "string" && core.screen_name) ||
		(typeof legacy.screen_name === "string" && legacy.screen_name) ||
		pseudoDemande;
	if (!id) {
		return null;
	}
	const nom =
		(typeof core.name === "string" && core.name) || (typeof legacy.name === "string" && legacy.name) || pseudo;
	const avatar =
		(typeof legacy.profile_image_url_https === "string" && legacy.profile_image_url_https) ||
		(typeof avatarObjet.image_url === "string" && avatarObjet.image_url) ||
		null;

	return {
		pseudo,
		id,
		nom,
		description: bornerTexte(typeof legacy.description === "string" ? legacy.description : "", LIMITE_DESCRIPTION),
		abonnes: typeof legacy.followers_count === "number" ? legacy.followers_count : null,
		abonnements: typeof legacy.friends_count === "number" ? legacy.friends_count : null,
		certifie: brut.is_blue_verified === true,
		avatar,
		creeLe: dateXVersIso(legacy.created_at ?? core.created_at),
		url: `https://x.com/${pseudo}`,
	};
}

export interface PostX {
	id: string;
	url: string;
	auteur: string;
	auteurNom: string;
	date: string | null;
	texte: string;
	likes: number;
	retweets: number;
	reponses: number;
	vues: number | null;
	medias: number;
}

/** Met un post X (forme `Tweet` du paquet) à la forme bornée qui traverse la socket. */
export function bornerPostX(brut: unknown, pseudoParDefaut: string): PostX | null {
	if (!brut || typeof brut !== "object") {
		return null;
	}
	const tweet = brut as Record<string, unknown>;
	const id = typeof tweet.id === "string" ? tweet.id : "";
	if (!id) {
		return null;
	}
	const auteurObjet = (tweet.author ?? {}) as Record<string, unknown>;
	const auteur = typeof auteurObjet.username === "string" && auteurObjet.username ? auteurObjet.username : pseudoParDefaut;
	const medias = Array.isArray(tweet.media) ? tweet.media.length : 0;
	return {
		id,
		url: `https://x.com/${auteur}/status/${id}`,
		auteur,
		auteurNom: typeof auteurObjet.name === "string" && auteurObjet.name ? auteurObjet.name : auteur,
		date: dateXVersIso(tweet.created_at),
		texte: bornerTexte(typeof tweet.text === "string" ? tweet.text : "", LIMITE_TEXTE_POST),
		likes: typeof tweet.like_count === "number" ? tweet.like_count : 0,
		retweets: typeof tweet.retweet_count === "number" ? tweet.retweet_count : 0,
		reponses: typeof tweet.reply_count === "number" ? tweet.reply_count : 0,
		vues: typeof tweet.view_count === "number" ? tweet.view_count : null,
		medias,
	};
}

// ─── Moteurs (chargement paresseux) ──────────────────────────────────────────

/**
 * Prépare le profil `http` de bxc.
 *
 * Le paquet publié n'embarque pas `libcurl-impersonate` et ne la cherche que
 * dans son propre `vendor/` ou dans `LIBCURL_IMPERSONATE_PATH`. On pose la
 * variable si la bibliothèque installée sur l'hôte est trouvée ; sinon on
 * refuse le profil au lieu de laisser remonter un message anglais opaque.
 */
async function assurerCurlImpersonate(): Promise<void> {
	if (Bun.env.LIBCURL_IMPERSONATE_PATH) {
		return;
	}
	for (const chemin of CHEMINS_CURL_IMPERSONATE) {
		if (await Bun.file(chemin).exists()) {
			Bun.env.LIBCURL_IMPERSONATE_PATH = chemin;
			return;
		}
	}
	throw new ErreurScrape(
		"moteur_indisponible",
		"Le profil « http » (curl-impersonate) n'est pas disponible sur cet hôte : utilise le profil « static »."
	);
}

/**
 * Ouvre un client X à partir des cookies de `~/.bxc/cookies/xcom.json`.
 *
 * Même source que `twitter.ts` et `harvest-search.ts` : un seul endroit détient
 * la session, et la valeur du cookie ne quitte jamais cette fonction.
 */
async function clientX(): Promise<XClient> {
	const cookie = loadBxcXCookieHeader();
	if (!cookie) {
		throw new ErreurScrape(
			"moteur_indisponible",
			"Les identifiants X ne sont pas disponibles sur cet hôte (cookies absents ou incomplets)."
		);
	}
	const { XClient: ClasseXClient, XSession } = await import("@aphrody-code/x");
	try {
		return new ClasseXClient(XSession.fromCookieString(cookie));
	} catch (err) {
		throw new ErreurScrape(
			"moteur_indisponible",
			`Session X inutilisable : ${nettoyerMessage(err instanceof Error ? err.message : String(err))}`
		);
	}
}

// ─── Verbes ──────────────────────────────────────────────────────────────────

async function verbeScrapePage(requete: Record<string, unknown>): Promise<ReponseScrape> {
	const url = validerUrl(requete.url);
	const profilDemande = typeof requete.profil === "string" ? requete.profil : "static";
	if (profilDemande !== "static" && profilDemande !== "http") {
		throw new ErreurScrape("requete_invalide", "Profil inconnu : choisis « static » ou « http ».");
	}
	if (profilDemande === "http") {
		await assurerCurlImpersonate();
	}

	const { Browser } = await import("@aphrody-code/bxc");
	const { extractTitle, htmlToMarkdown } = await import("@aphrody-code/bxc/internal/html-utils");

	const debut = Bun.nanoseconds();
	const page = await Browser.newPage({ profile: profilDemande });
	try {
		const navigation = await page.goto(url.toString(), { timeoutMs: 25_000 });
		const html: string = await page.content();
		const markdownComplet: string = String(htmlToMarkdown(html) ?? "").trim();
		const titre: string = String(extractTitle(html) ?? "").trim();
		return {
			success: true,
			url: url.toString(),
			statut: typeof navigation?.status === "number" ? navigation.status : null,
			titre: bornerTexte(titre || url.hostname, 200),
			markdown: bornerTexte(markdownComplet, LIMITE_MARKDOWN),
			tronque: markdownComplet.length > LIMITE_MARKDOWN,
			octets: tailleOctets(html),
			profil: profilDemande,
			ms: Math.round((Bun.nanoseconds() - debut) / 1e6),
		};
	} finally {
		try {
			await page.close();
		} catch {
			/* page déjà fermée par le moteur */
		}
	}
}

/** Recherche DuckDuckGo (rendu HTML sans JavaScript) — repli de `scrape.google`. */
async function chercherDuckDuckGo(requete: string, limite: number): Promise<ResultatRecherche[]> {
	const url = new URL("https://html.duckduckgo.com/html/");
	url.searchParams.set("q", requete);
	url.searchParams.set("kl", "fr-fr");
	const reponse = await fetch(url, {
		headers: { "user-agent": AGENT_UTILISATEUR, "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" },
		signal: AbortSignal.timeout(20_000),
	});
	if (!reponse.ok) {
		throw new ErreurScrape("moteur_indisponible", `Le moteur de repli a répondu ${reponse.status}.`);
	}
	return analyserSerpDuckDuckGo(await reponse.text(), limite);
}

async function verbeScrapeGoogle(requete: Record<string, unknown>): Promise<ReponseScrape> {
	const texte = validerRequete(requete.requete);
	const limite = bornerEntier(requete.limite, 5, 1, 8);
	const debut = Bun.nanoseconds();

	let resultats: ResultatRecherche[] = [];
	let moteur = "google";
	try {
		const { googleWebSearch } = await import("@aphrody-code/bxc/google");
		const bruts: unknown = await googleWebSearch(texte, { num: limite, hl: "fr", gl: "FR" });
		if (Array.isArray(bruts)) {
			resultats = bruts
				.slice(0, limite)
				.map((entree): ResultatRecherche | null => {
					const item = (entree ?? {}) as Record<string, unknown>;
					const lien = typeof item.url === "string" ? item.url : "";
					if (!lien) {
						return null;
					}
					return {
						titre: bornerTexte(typeof item.title === "string" ? item.title : lien, 160),
						url: bornerTexte(lien, 300),
						extrait: bornerTexte(typeof item.snippet === "string" ? item.snippet : "", LIMITE_EXTRAIT),
					};
				})
				.filter((r): r is ResultatRecherche => r !== null);
		}
	} catch (err) {
		console.warn("[scrape] Google indisponible :", nettoyerMessage(err instanceof Error ? err.message : String(err)));
		resultats = [];
	}

	if (resultats.length === 0) {
		moteur = "duckduckgo";
		resultats = await chercherDuckDuckGo(texte, limite);
	}
	if (resultats.length === 0) {
		throw new ErreurScrape("moteur_indisponible", "Aucun moteur de recherche n'a répondu depuis ce serveur.");
	}

	return {
		success: true,
		requete: texte,
		moteur,
		resultats,
		ms: Math.round((Bun.nanoseconds() - debut) / 1e6),
	};
}

async function verbeScrapeRecon(requete: Record<string, unknown>): Promise<ReponseScrape> {
	const url = validerUrl(requete.url);
	const debut = Bun.nanoseconds();

	let reponse: Response;
	try {
		reponse = await fetch(url, {
			headers: { "user-agent": AGENT_UTILISATEUR, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
			redirect: "follow",
			signal: AbortSignal.timeout(20_000),
		});
	} catch (err) {
		throw new ErreurScrape(
			"erreur_scraping",
			`Impossible de joindre ${url.hostname} : ${nettoyerMessage(err instanceof Error ? err.message : String(err))}`
		);
	}

	const entetes = extraireEntetes(reponse.headers);
	const typeContenu = reponse.headers.get("content-type") ?? "";
	const estTextuel = /text\/|json|xml|javascript/i.test(typeContenu);

	let corps = "";
	let octets = 0;
	let corpsTronque = false;
	if (estTextuel) {
		const lu = await lireCorpsBorne(reponse, LIMITE_HTML_OCTETS);
		corps = lu.texte;
		octets = lu.octets;
		corpsTronque = lu.tronque;
	} else {
		// Corps binaire (image, archive, exécutable) : rien à analyser, et le
		// télécharger n'apprendrait rien. On annule le flux pour libérer la
		// connexion sans en lire un octet.
		try {
			await reponse.body?.cancel();
		} catch {
			/* flux déjà consommé ou coupé */
		}
	}

	const titre = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(corps)?.[1] ?? "";
	const { extractTitle } = await import("@aphrody-code/bxc/internal/html-utils");
	const titreFinal = titre ? texteBrut(titre) : String(extractTitle(corps) ?? "").trim();

	return {
		success: true,
		url: url.toString(),
		urlFinale: reponse.url || url.toString(),
		statut: reponse.status,
		statutTexte: reponse.statusText || "",
		typeContenu: bornerTexte(typeContenu, 120),
		titre: bornerTexte(titreFinal || url.hostname, 200),
		octets,
		corpsTronque,
		enTetes: entetes,
		technologies: detecterTechnologies(entetes, corps),
		liens: extraireLiens(corps, reponse.url || url.toString()),
		ms: Math.round((Bun.nanoseconds() - debut) / 1e6),
	};
}

async function verbeXProfil(requete: Record<string, unknown>): Promise<ReponseScrape> {
	const pseudo = validerPseudo(requete.pseudo);
	const debut = Bun.nanoseconds();
	const client = await clientX();

	let brut: unknown;
	try {
		brut = await client.graphqlWaiting(
			"UserByScreenName",
			{ screen_name: pseudo, withSafetyModeUserFields: true },
			undefined,
			20_000
		);
	} catch (err) {
		throw new ErreurScrape(
			"introuvable",
			`Le compte @${pseudo} est introuvable ou inaccessible : ${nettoyerMessage(
				err instanceof Error ? err.message : String(err)
			)}`
		);
	}

	const conteneur = (brut ?? {}) as { data?: { user?: { result?: unknown } } };
	const fiche = ficheDepuisResultatX(conteneur.data?.user?.result, pseudo);
	if (!fiche) {
		throw new ErreurScrape("introuvable", `Aucun compte X ne répond au pseudo @${pseudo}.`);
	}
	return { success: true, fiche, ms: Math.round((Bun.nanoseconds() - debut) / 1e6) };
}

async function verbeXPosts(requete: Record<string, unknown>): Promise<ReponseScrape> {
	const pseudo = validerPseudo(requete.pseudo);
	const limite = bornerEntier(requete.limite, 5, 1, 10);
	const debut = Bun.nanoseconds();
	const client = await clientX();

	let identifiant: string;
	try {
		identifiant = (await client.userByScreenName(pseudo)).id;
	} catch (err) {
		throw new ErreurScrape(
			"introuvable",
			`Le compte @${pseudo} est introuvable : ${nettoyerMessage(err instanceof Error ? err.message : String(err))}`
		);
	}
	if (!identifiant) {
		throw new ErreurScrape("introuvable", `Aucun compte X ne répond au pseudo @${pseudo}.`);
	}

	// X sert la chronologie avec ses épingles et ses réponses : on demande large
	// puis on borne, sinon `limite: 3` peut ne rendre qu'un post original.
	const page = await client.userTweets(identifiant, Math.max(limite * 3, 20));
	const posts = page.tweets
		.map((tweet) => bornerPostX(tweet, pseudo))
		.filter((post): post is PostX => post !== null)
		.slice(0, limite);

	return { success: true, pseudo, posts, ms: Math.round((Bun.nanoseconds() - debut) / 1e6) };
}

async function verbeXRecherche(requete: Record<string, unknown>): Promise<ReponseScrape> {
	const texte = validerRequete(requete.requete);
	const limite = bornerEntier(requete.limite, 5, 1, 10);
	const debut = Bun.nanoseconds();
	const client = await clientX();

	const page = await client.search(texte, Math.max(limite * 2, 20), undefined, "Latest");
	const posts = page.tweets
		.map((tweet) => bornerPostX(tweet, ""))
		.filter((post): post is PostX => post !== null && post.auteur.length > 0)
		.slice(0, limite);

	return { success: true, requete: texte, posts, ms: Math.round((Bun.nanoseconds() - debut) / 1e6) };
}

const IMPLEMENTATIONS: Record<string, (requete: Record<string, unknown>) => Promise<ReponseScrape>> = {
	"scrape.page": verbeScrapePage,
	"scrape.google": verbeScrapeGoogle,
	"scrape.recon": verbeScrapeRecon,
	"x.profil": verbeXProfil,
	"x.posts": verbeXPosts,
	"x.recherche": verbeXRecherche,
};

/**
 * Point d'entrée unique du pont IPC pour les six verbes de scraping.
 *
 * Ne lève JAMAIS : toute erreur, y compris une panne du moteur ou un dépassement
 * de délai, ressort en `{ success: false, error, code }`. C'est la promesse
 * faite au démon — un scraping ne doit pas pouvoir arrêter `rg-cron`.
 */
export async function servirVerbeScrape(verbe: string, requete: Record<string, unknown>): Promise<ReponseScrape> {
	const implementation = IMPLEMENTATIONS[verbe];
	const limiteur = LIMITEURS[verbe];
	if (!implementation || !limiteur) {
		return { success: false, error: `Verbe de scraping inconnu : « ${verbe} ».`, code: "verbe_inconnu" };
	}

	try {
		LIMITEUR_GLOBAL.reserver();
	} catch (err) {
		return enReponse(err);
	}
	try {
		limiteur.reserver();
	} catch (err) {
		LIMITEUR_GLOBAL.liberer();
		return enReponse(err);
	}

	try {
		return await avecDelai(implementation(requete), DELAIS_MS[verbe] ?? 30_000, `Le verbe « ${verbe} »`);
	} catch (err) {
		return enReponse(err);
	} finally {
		limiteur.liberer();
		LIMITEUR_GLOBAL.liberer();
	}
}

/** Traduit une exception en réponse IPC, en nettoyant le message de ses secrets. */
export function enReponse(err: unknown): ReponseScrape {
	if (err instanceof ErreurScrape) {
		return { success: false, error: err.message, code: err.code };
	}
	const message = nettoyerMessage(err instanceof Error ? err.message : String(err));
	return { success: false, error: message || "Échec du scraping.", code: "erreur_scraping" };
}
