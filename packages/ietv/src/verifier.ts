/**
 * Vérificateur de sources — rejouer chaque lien et écrire ce qu'il répond.
 *
 * ```bash
 * bun packages/ietv/src/verifier.ts --db data/anime/episodes.db            # mesure seule
 * bun packages/ietv/src/verifier.ts --db data/anime/episodes.db --ecrire
 * bun packages/ietv/src/verifier.ts --db … --ecrire --plateforme dailymotion
 * ```
 *
 * ── POURQUOI CE MODULE EXISTE ──────────────────────────────────────────────
 * Le catalogue distingue déjà `verifiee` / `declaree` / `deduite`, mais ce
 * champ dit d'où vient une source, pas si elle répond. Mesuré le 2026-09-03 sur
 * `data/anime/episodes.db` : 1 725 des 1 770 sources portaient `verifiee`,
 * alors qu'aucune n'avait jamais été rejouée — le mot venait du moissonneur qui
 * avait LU l'identifiant dans une page, pas d'une sonde de la plateforme.
 *
 * Un bug réel est né exactement de cette confusion : le champ `origine`
 * contient un nom lisible de chaîne (« inazuma-eleven.fr (official) ») et non
 * une clé technique ; s'en servir pour bâtir une URL rendait un lecteur « Not
 * found », et rien dans la base ne le disait. Une source n'est un fait que
 * lorsque quelqu'un l'a redemandée à la plateforme.
 *
 * ── TROIS SONDES, TOUTES PUBLIQUES ET DESTINÉES À ÊTRE LUES ────────────────
 *  * **YouTube** → `oembed`, l'interface d'intégration publique. 200 = la vidéo
 *    existe ET est intégrable ; 401/403/404 = retirée, privée, ou intégration
 *    refusée. C'est exactement la question posée par le catalogue, puisque le
 *    lecteur du dépôt intègre.
 *  * **Dailymotion** → `api.dailymotion.com/video/<id>`, l'API de données
 *    publique, sans clé. Elle rend `private`, `allow_embed` et `status` : de
 *    quoi distinguer « n'existe pas » de « existe mais n'est pas diffusable ».
 *  * **`page`** → une requête HTTP sur la page elle-même, et son code.
 *
 * ── CE QUE LA SONDE NE PEUT PAS TRANCHER, ET POURQUOI ON LE DIT ────────────
 * 143 sources pointent le LECTEUR officiel (`dailymotion.com/player/<clé>.html
 * ?video=<id>`) parce que ces vidéos sont restreintes à ce lecteur : l'API
 * répond 404 alors que le site les joue. La tentation est de sonder l'URL du
 * lecteur — mesuré, elle ne discrimine rien : `xm8tv.html?video=…` répond 404
 * pour une vidéo restreinte COMME pour `x8reu53`, publique et servie par la
 * même API. Le code HTTP du lecteur ne dépend donc pas de la vidéo.
 *
 * {@link calibrerLecteur} refait cette mesure à chaque exécution sur une vidéo
 * témoin dont l'API atteste qu'elle est publique. Tant que le témoin échoue, la
 * sonde est déclarée non discriminante et les 143 sources sortent en
 * `non_testable` — pas en `morte`. Le jour où Dailymotion changera ce
 * comportement, la calibration le verra et la sonde comptera.
 *
 * Aucun en-tête n'est falsifié pour forcer une de ces réponses : envoyer un
 * `Referer` du site officiel ferait sans doute passer le lecteur, mais ce
 * serait se faire passer pour le site, c'est-à-dire contourner la restriction
 * plutôt que la constater. Une case « non testable » honnête vaut mieux.
 */

import { IETVCache } from "./cache.ts";
import {
	RE_DAILYMOTION_ID,
	RE_YOUTUBE_ID,
	type EtatSource,
	type Plateforme,
} from "./plateformes.ts";

/** Ce qu'une sonde conclut sur une source. */
export interface Verdict {
	etat: EtatSource;
	/** Code HTTP observé, `null` quand aucune requête n'a été faite. */
	codeHttp: number | null;
	/** Motif court et stable, destiné à être groupé (`SELECT … GROUP BY`). */
	raison: string;
}

/**
 * En-tête d'identification. Il DIT ce qu'est ce programme au lieu d'imiter un
 * navigateur : c'est la politesse minimale envers un serveur qu'on interroge
 * 1 700 fois, et l'inverse exact d'un contournement.
 */
export const AGENT = "niers-ietv-verifier/1.0 (+https://github.com/rosegriffon; catalogue anime)";

// ── Les sondes, en deux moitiés : l'URL, puis la lecture de la réponse ───────
//
// Séparer les deux est ce qui rend l'ensemble testable sans réseau : la moitié
// « lecture » est une fonction pure d'un code HTTP et d'une charge JSON.

/** URL de la sonde YouTube — l'`oEmbed` public. */
export function urlOembed(videoId: string): string {
	const cible = `https://www.youtube.com/watch?v=${videoId}`;
	return `https://www.youtube.com/oembed?url=${encodeURIComponent(cible)}&format=json`;
}

/** URL de la sonde Dailymotion — l'API de données publique. */
export function urlApiDailymotion(videoId: string): string {
	const champs = "id,title,private,allow_embed,status";
	return `https://api.dailymotion.com/video/${encodeURIComponent(videoId)}?fields=${champs}`;
}

/**
 * Verdict YouTube.
 *
 * 404 et 403 disent tous deux « pas intégrable » ; on les distingue par la
 * raison, jamais par l'état — pour le catalogue, les deux sont inutilisables.
 * Un 5xx n'est PAS une mort : c'est une panne de YouTube, et l'inscrire comme
 * telle effacerait des sources valides au premier hoquet.
 */
export function classerOembed(code: number): Verdict {
	if (code === 200) return { etat: "vivante", codeHttp: code, raison: "oembed_ok" };
	if (code === 404) return { etat: "morte", codeHttp: code, raison: "oembed_introuvable" };
	if (code === 401 || code === 403)
		return { etat: "morte", codeHttp: code, raison: "oembed_integration_refusee" };
	return { etat: "non_testable", codeHttp: code, raison: `oembed_code_${code}` };
}

/**
 * Verdict Dailymotion, à partir du code et de la charge JSON.
 *
 * `allow_embed = false` compte comme morte : le catalogue n'ouvre les vidéos
 * qu'intégrées, une vidéo non intégrable n'y est donc pas regardable — et le
 * dire vaut mieux que d'afficher un lecteur vide.
 */
export function classerApiDailymotion(code: number, charge: unknown): Verdict {
	if (code === 404) return { etat: "morte", codeHttp: code, raison: "api_introuvable" };
	if (code !== 200) return { etat: "non_testable", codeHttp: code, raison: `api_code_${code}` };

	const objet = charge as Record<string, unknown> | null;
	if (objet && typeof objet.error === "object" && objet.error !== null)
		return { etat: "morte", codeHttp: code, raison: "api_erreur" };
	if (typeof objet?.id !== "string")
		return { etat: "non_testable", codeHttp: code, raison: "api_reponse_illisible" };
	if (objet.private === true) return { etat: "morte", codeHttp: code, raison: "api_privee" };
	if (objet.allow_embed === false)
		return { etat: "morte", codeHttp: code, raison: "api_integration_refusee" };
	if (typeof objet.status === "string" && objet.status !== "published")
		return { etat: "morte", codeHttp: code, raison: `api_statut_${objet.status}` };
	return { etat: "vivante", codeHttp: code, raison: "api_publiee" };
}

/**
 * Verdict d'une page. 401 et 403 ne sont pas des morts : une page peut exiger
 * un consentement ou filtrer une région, et elle s'ouvre très bien dans un
 * navigateur — la sonde ne sait alors pas conclure.
 */
export function classerPage(code: number): Verdict {
	if (code >= 200 && code < 300) return { etat: "vivante", codeHttp: code, raison: "page_ok" };
	if (code === 404 || code === 410)
		return { etat: "morte", codeHttp: code, raison: "page_introuvable" };
	return { etat: "non_testable", codeHttp: code, raison: `page_code_${code}` };
}

/** Une source pointe le lecteur officiel quand son URL en porte la forme. */
export function estLecteurOfficiel(url: string): boolean {
	return /dailymotion\.com\/player\/[A-Za-z0-9]+\.html/.test(url);
}

/**
 * Verdict rendu SANS réseau quand l'identifiant stocké n'a pas la forme de sa
 * plateforme.
 *
 * ── CE QUE CE CONTRÔLE A TROUVÉ ────────────────────────────────────────────
 * Une ligne de la base porte `plateforme = 'youtube'` et
 * `sourceId = 'off-films-4'` — un jeton local fabriqué par le moissonneur, avec
 * pour `url` la page du site officiel. L'intégration construite depuis cette
 * ligne donne `youtube-nocookie.com/embed/off-films-4`, qui ne peut rien
 * ouvrir. Aucune sonde réseau ne l'aurait dit mieux qu'une regex : l'erreur est
 * dans la ligne, pas chez YouTube.
 */
export function verdictDeForme(plateforme: Plateforme, sourceId: string): Verdict | null {
	if (plateforme === "youtube" && !RE_YOUTUBE_ID.test(sourceId))
		return { etat: "morte", codeHttp: null, raison: "identifiant_youtube_non_conforme" };
	if (plateforme === "dailymotion" && !RE_DAILYMOTION_ID.test(sourceId))
		return { etat: "morte", codeHttp: null, raison: "identifiant_dailymotion_non_conforme" };
	return null;
}

// ── La couche réseau ────────────────────────────────────────────────────────

/** Une réponse HTTP réduite à ce dont les classeurs ont besoin. */
export interface Reponse {
	code: number;
	charge: unknown;
	/** Secondes demandées par un `Retry-After`, `null` s'il n'y en a pas. */
	attendre: number | null;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Un `fetch` qui rend toujours une {@link Reponse} — une panne réseau devient
 * le code 0, jamais une exception.
 *
 * Un rejet ferait tomber le lot entier sur une coupure de trois secondes, et
 * le code 0 se classe naturellement en `non_testable` : on n'a rien appris.
 */
export async function sonder(
	url: string,
	options: { json?: boolean; methode?: string; delaiMs?: number } = {}
): Promise<Reponse> {
	const controleur = new AbortController();
	const minuterie = setTimeout(() => controleur.abort(), options.delaiMs ?? 15_000);
	try {
		const reponse = await fetch(url, {
			method: options.methode ?? "GET",
			headers: { "user-agent": AGENT, accept: options.json ? "application/json" : "*/*" },
			redirect: "follow",
			signal: controleur.signal,
		});
		const enTete = reponse.headers.get("retry-after");
		const attendre = enTete ? Number.parseInt(enTete, 10) : null;
		let charge: unknown = null;
		if (options.json) {
			try {
				charge = await reponse.json();
			} catch {
				charge = null;
			}
		} else {
			// La page n'est pas lue : seul son code compte, et rapatrier 800
			// pages de 20 ko pour les jeter serait 16 Mo pris au serveur pour rien.
			await reponse.body?.cancel();
		}
		return {
			code: reponse.status,
			charge,
			attendre: attendre !== null && Number.isFinite(attendre) ? attendre : null,
		};
	} catch {
		return { code: 0, charge: null, attendre: null };
	} finally {
		clearTimeout(minuterie);
	}
}

/**
 * Sonde avec reprise sur 429 — la seule réponse qui mérite d'insister, parce
 * qu'elle dit « reviens plus tard », pas « non ».
 *
 * L'attente suit le `Retry-After` quand le serveur en donne un, et double
 * sinon. Au bout des essais, le 429 est rendu tel quel et se classera en
 * `non_testable` : mieux vaut une case vide qu'une source condamnée parce
 * qu'on a tapé trop vite.
 */
export async function sonderAvecReprise(
	url: string,
	options: { json?: boolean; methode?: string; essais?: number; attenteMs?: number } = {}
): Promise<Reponse> {
	const essais = options.essais ?? 3;
	let attente = options.attenteMs ?? 2_000;
	let derniere: Reponse = { code: 0, charge: null, attendre: null };
	// La séquence est le SUJET de cette boucle : chaque essai dépend du code
	// rendu par le précédent, et l'attente qui les sépare est ce qu'on a promis
	// au serveur. Les paralléliser reviendrait à répondre à un « ralentis » par
	// trois requêtes d'un coup.
	/* eslint-disable no-await-in-loop */
	for (let i = 0; i < essais; i++) {
		derniere = await sonder(url, options);
		if (derniere.code !== 429) return derniere;
		await dormir(derniere.attendre !== null ? derniere.attendre * 1_000 : attente);
		attente *= 2;
	}
	/* eslint-enable no-await-in-loop */
	return derniere;
}

/**
 * Mesure si la sonde du lecteur officiel discrimine quoi que ce soit.
 *
 * Le témoin est une vidéo dont l'API atteste qu'elle est publique : si le
 * lecteur lui-même la refuse, son code de retour ne dépend pas de la vidéo et
 * ne peut donc rien dire des 143 sources restreintes. Cf. l'en-tête du module.
 */
export async function calibrerLecteur(
	temoin = "x8reu53",
	cle = "xm8tv"
): Promise<{ discriminante: boolean; codeTemoin: number; codeApi: number }> {
	const api = await sonderAvecReprise(urlApiDailymotion(temoin), { json: true });
	const lecteur = await sonderAvecReprise(
		`https://www.dailymotion.com/player/${cle}.html?video=${temoin}`
	);
	const publique = classerApiDailymotion(api.code, api.charge).etat === "vivante";
	return {
		discriminante: publique && lecteur.code >= 200 && lecteur.code < 300,
		codeTemoin: lecteur.code,
		codeApi: api.code,
	};
}

// ── L'exécution sur un lot ──────────────────────────────────────────────────

/** Une cible réseau : une requête, et les lignes de base qu'elle tranche. */
export interface Cible {
	plateforme: Plateforme;
	/** Ce qui identifie la requête — id de vidéo, ou URL pour une page. */
	cle: string;
	url: string;
	ids: number[];
}

/**
 * Groupe des lignes en cibles réseau.
 *
 * ── LE DÉDOUBLONNAGE N'EST PAS UNE OPTIMISATION, C'EST UNE POLITESSE ───────
 * 1 770 lignes ne font que 1 751 cibles distinctes, et surtout la même vidéo
 * YouTube est référencée par le site officiel ET par une chaîne : sonder par
 * ligne redemanderait deux fois la même chose au même serveur. Le verdict
 * s'applique ensuite à toutes les lignes du groupe, ce qui est exact — elles
 * désignent la même vidéo.
 */
export function grouperCibles(
	lignes: readonly { id: number; plateforme: Plateforme; sourceId: string; url: string }[]
): Cible[] {
	const par = new Map<string, Cible>();
	for (const ligne of lignes) {
		// Une page n'a pas d'identifiant de lecture : son URL EST sa clé. Un
		// lecteur officiel non plus — c'est l'URL qui porte la clé du lecteur.
		const parUrl = ligne.plateforme === "page" || estLecteurOfficiel(ligne.url);
		const cle = parUrl ? ligne.url : ligne.sourceId;
		const identite = `${ligne.plateforme}|${cle}`;
		const presente = par.get(identite);
		if (presente) presente.ids.push(ligne.id);
		else par.set(identite, { plateforme: ligne.plateforme, cle, url: ligne.url, ids: [ligne.id] });
	}
	return [...par.values()];
}

/** Options d'une passe de vérification. */
export interface OptionsPasse {
	/** Requêtes simultanées. Six au maximum : ce sont des serveurs tiers. */
	concurrence: number;
	/** Pause après chaque requête d'un même travailleur, en millisecondes. */
	delaiMs: number;
	/** La sonde du lecteur officiel a-t-elle été mesurée comme discriminante. */
	lecteurDiscriminant: boolean;
	/** Appelé après chaque cible tranchée, pour l'affichage de progression. */
	progression?: (faites: number, total: number) => void;
}

/** Sonde UNE cible et rend son verdict. */
export async function verifierCible(cible: Cible, options: OptionsPasse): Promise<Verdict> {
	const forme = verdictDeForme(cible.plateforme, cible.cle);
	if (forme && !estLecteurOfficiel(cible.url)) return forme;

	if (cible.plateforme === "youtube") {
		const r = await sonderAvecReprise(urlOembed(cible.cle), { json: true });
		return classerOembed(r.code);
	}

	if (cible.plateforme === "dailymotion") {
		if (estLecteurOfficiel(cible.url)) {
			if (!options.lecteurDiscriminant) {
				return {
					etat: "non_testable",
					codeHttp: null,
					raison: "lecteur_officiel_sonde_non_discriminante",
				};
			}
			const r = await sonderAvecReprise(cible.url);
			return r.code >= 200 && r.code < 300
				? { etat: "vivante", codeHttp: r.code, raison: "lecteur_officiel_ok" }
				: { etat: "morte", codeHttp: r.code, raison: "lecteur_officiel_refuse" };
		}
		const r = await sonderAvecReprise(urlApiDailymotion(cible.cle), { json: true });
		return classerApiDailymotion(r.code, r.charge);
	}

	const r = await sonderAvecReprise(cible.url);
	return classerPage(r.code);
}

/**
 * Passe complète sur un lot de cibles, à concurrence bornée.
 *
 * Le pool est écrit à la main plutôt que par un `Promise.all` sur des tranches :
 * une tranche avance à la vitesse de sa requête la plus lente, et laisse donc
 * la concurrence retomber à un pendant les délais d'attente. Ici un
 * travailleur qui a fini prend la cible suivante.
 */
export async function verifierLot(
	cibles: readonly Cible[],
	options: OptionsPasse
): Promise<Map<number, Verdict>> {
	const verdicts = new Map<number, Verdict>();
	let curseur = 0;
	let faites = 0;

	const travailleur = async () => {
		// Un travailleur traite UNE cible à la fois : c'est ce qui borne la
		// concurrence à `options.concurrence`. Le parallélisme est ailleurs — dans
		// le nombre de travailleurs — et le déplacer ici le supprimerait.
		/* eslint-disable no-await-in-loop */
		for (;;) {
			const i = curseur++;
			const cible = cibles[i];
			if (!cible) return;
			const verdict = await verifierCible(cible, options);
			for (const id of cible.ids) verdicts.set(id, verdict);
			faites++;
			options.progression?.(faites, cibles.length);
			if (options.delaiMs > 0) await dormir(options.delaiMs);
		}
		/* eslint-enable no-await-in-loop */
	};

	const nombre = Math.max(1, Math.min(options.concurrence, 6));
	await Promise.all(Array.from({ length: nombre }, travailleur));
	return verdicts;
}

// ── Programme ───────────────────────────────────────────────────────────────

interface Options {
	db: string;
	ecrire: boolean;
	plateforme: Plateforme | undefined;
	limite: number | undefined;
	concurrence: number;
	delaiMs: number;
}

/** Lecture des arguments — pure, donc testable. */
export function lireOptions(argv: readonly string[]): Options {
	const o: Options = {
		db: "data/anime/episodes.db",
		ecrire: false,
		plateforme: undefined,
		limite: undefined,
		concurrence: 5,
		delaiMs: 150,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--db") o.db = argv[++i] ?? o.db;
		else if (a === "--ecrire") o.ecrire = true;
		else if (a === "--plateforme") {
			const v = argv[++i];
			if (v === "youtube" || v === "dailymotion" || v === "page") o.plateforme = v;
		} else if (a === "--limite") o.limite = Number.parseInt(argv[++i] ?? "", 10) || undefined;
		else if (a === "--concurrence")
			o.concurrence = Number.parseInt(argv[++i] ?? "", 10) || o.concurrence;
		else if (a === "--delai") o.delaiMs = Number.parseInt(argv[++i] ?? "", 10) || o.delaiMs;
	}
	return o;
}

/** Le tableau d'état, tel qu'on veut le lire avant ET après. */
function imprimerEtat(cache: IETVCache, titre: string) {
	const e = cache.etatVerification();
	console.log(`\n=== ${titre} ===`);
	console.log("total :");
	for (const l of e.total) console.log(`  ${l.etat.padEnd(16)} ${String(l.sources).padStart(5)}`);

	const etats = [...new Set(e.parPlateforme.map((l) => l.etat))].toSorted();
	const enTete = ["plateforme".padEnd(14), ...etats.map((x) => x.padStart(14))].join(" ");
	console.log(`\n${enTete}`);
	console.log("-".repeat(enTete.length));
	for (const p of [...new Set(e.parPlateforme.map((l) => l.plateforme))].toSorted()) {
		const cellules = etats.map((x) =>
			String(e.parPlateforme.find((l) => l.plateforme === p && l.etat === x)?.sources ?? 0).padStart(
				14
			)
		);
		console.log([p.padEnd(14), ...cellules].join(" "));
	}

	const enTeteL = ["langue".padEnd(14), ...etats.map((x) => x.padStart(14))].join(" ");
	console.log(`\n${enTeteL}`);
	console.log("-".repeat(enTeteL.length));
	for (const l of [...new Set(e.parLangue.map((x) => x.langue))].toSorted()) {
		const cellules = etats.map((x) =>
			String(e.parLangue.find((y) => y.langue === l && y.etat === x)?.sources ?? 0).padStart(14)
		);
		console.log([l.padEnd(14), ...cellules].join(" "));
	}

	console.log("\nepisodes REGARDABLES par langue (integrables, non mortes) :");
	for (const l of cache.couvertureRegardable()) {
		console.log(`  ${l.langue.padEnd(8)} ${String(l.episodes).padStart(4)} / 355`);
	}
}

if (import.meta.main) {
	const o = lireOptions(process.argv.slice(2));
	const cache = new IETVCache(o.db);
	imprimerEtat(cache, `AVANT — ${o.db}`);

	const lignes = cache.sourcesAVerifier({ plateforme: o.plateforme, limite: o.limite });
	const cibles = grouperCibles(lignes);
	console.log(`\n${lignes.length} lignes -> ${cibles.length} cibles reseau distinctes`);

	const calibration = await calibrerLecteur();
	console.log(
		`calibration lecteur officiel : temoin=${calibration.codeTemoin} api=${calibration.codeApi} ` +
			`-> ${calibration.discriminante ? "sonde DISCRIMINANTE" : "sonde NON discriminante"}`
	);

	const debut = Date.now();
	const verdicts = await verifierLot(cibles, {
		concurrence: o.concurrence,
		delaiMs: o.delaiMs,
		lecteurDiscriminant: calibration.discriminante,
		progression: (faites, total) => {
			if (faites % 100 === 0 || faites === total) {
				const s = ((Date.now() - debut) / 1000).toFixed(0);
				console.log(`  ${faites}/${total} cibles (${s}s)`);
			}
		},
	});

	const parRaison = new Map<string, number>();
	for (const v of verdicts.values()) parRaison.set(v.raison, (parRaison.get(v.raison) ?? 0) + 1);
	console.log("\nraisons :");
	for (const [raison, n] of [...parRaison].toSorted((a, b) => b[1] - a[1])) {
		console.log(`  ${raison.padEnd(40)} ${String(n).padStart(5)}`);
	}

	if (o.ecrire) {
		const ecrits = cache.marquerVerification(
			[...verdicts].map(([id, v]) => ({ id, ...v })),
			Date.now()
		);
		console.log(`\n${ecrits} lignes mises a jour`);
		imprimerEtat(cache, `APRES — ${o.db}`);
	} else {
		console.log("\n(--ecrire absent : rien n'a ete ecrit en base)");
	}

	cache.close();
}
