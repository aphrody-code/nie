/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Récolte des CAMPAGNES À HASHTAG sur X (#IERGDay, #InazumaDay, #InazumaRG…).
//
// Complémentaire de `harvest-search.ts` (veille thématique Inazuma Eleven) et de
// `twitter.ts` (timelines de comptes) : ici on ramasse une OPÉRATION COMMUNAUTAIRE
// identifiée par un hashtag, et on n'en garde que les posts PORTANT UNE IMAGE —
// c'est ce que la page publique /iergday affiche.
//
// Les campagnes sont pilotées EN BASE (`public.x_campagnes`), pas dans le code :
// le hashtag exact d'une opération n'est souvent connu que quelques jours avant son
// lancement, et il ne doit pas falloir un déploiement pour le brancher.
//
// TROIS GARANTIES STRUCTURANTES
//  1. Idempotence : rejouer la récolte ne crée aucun doublon (upsert par clé) et ne
//     retélécharge aucune image déjà sur le disque.
//  2. Modération préservée : la clause `do update` de `x_campagne_posts` ne
//     mentionne NI `masque`, NI `motif_masquage`, NI `mis_en_avant`. Un post retiré
//     du site le reste à travers toutes les récoltes suivantes. Toute modification
//     qui ajouterait `masque = excluded.masque` ici serait un défaut de sécurité.
//  3. Lecture seule côté X : aucune publication, aucun like, aucun follow.
//
// Usage :
//   bun packages/cron/src/tasks/ie-crawl/hashtag-harvest.ts [--campagne <slug>] [--limite N] [--dry]

import { XClient, XSession, type Tweet } from "@aphrody-code/x";
import { SQL } from "bun";
import { ingestSources, type RagSource } from "./rag-store-local";
import {
	compterImages,
	porteUneImage,
	tweetToRow,
	urlTweet,
	type DBTweetRow,
	type MediaItem,
} from "./tweet-row";
import { fermerStockage, rehebergerMediasTweet } from "./tweet-media-storage";
import { apparierHashtag, requetesVariantes, variantesRecherche } from "./hashtag-variantes";
import { loadBxcXCookieHeader } from "./x-accounts";

// ─────────────────────────────────────────────────────────────────────────────
// Réglages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pages maximum par (requête × produit). X renvoie des 429 dès ~6-8 pages
 * consécutives sur une fenêtre d'un quart d'heure : au-delà, on ne gagne plus rien
 * et on grille le quota des requêtes suivantes.
 */
const MAX_PAGES_PAR_REQUETE = 8;

/** Tweets demandés par page (l'API accepte 20..100). */
const TWEETS_PAR_PAGE = 40;

/** Plafond de sécurité par campagne et par run (surchargé par `--limite`). */
const MAX_TWEETS_PAR_CAMPAGNE = 600;

/** Throttle anti rate-limit, aligné sur harvest-search.ts. */
const DELAI_ENTRE_PAGES_MS = 800;
const DELAI_ENTRE_REQUETES_MS = 1500;

/**
 * Timeout dur sur `search()`. Indispensable : le backoff interne du client
 * (`graphqlWaiting`) peut dormir jusqu'à une quinzaine de minutes sans rendre la
 * main, ce qui ferait passer le run pour un blocage.
 */
const TIMEOUT_RECHERCHE_MS = 25_000;

/** Timeout de l'ingestion RAG (facultative, ne doit jamais retenir le run). */
const TIMEOUT_RAG_MS = 120_000;

/**
 * Les deux produits de recherche X sont balayés puis DÉDOUBLONNÉS par id :
 *  - « Latest » : ordre chronologique strict, exhaustif mais coupé par le rate-limit
 *    sur les gros hashtags ;
 *  - « Top »    : sélection par engagement, qui remonte des posts anciens que
 *    « Latest » ne rend plus.
 * Les deux ensemble couvrent nettement mieux une campagne qu'un seul.
 */
const PRODUITS = ["Latest", "Top"] as const;
type Produit = (typeof PRODUITS)[number];

/** Taille des lots d'écriture en base. */
const LOT_ECRITURE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Types publics
// ─────────────────────────────────────────────────────────────────────────────

/** Raison d'arrêt d'une boucle de pagination, recopiée dans `x_campagne_curseurs`. */
export type ArretRecolte = "epuise" | "max_pages" | "rate_limit" | "erreur";

export interface StatsCampagne {
	slug: string;
	/** Nombre de couples (requête × produit) balayés. */
	requetes: number;
	pages: number;
	/** Tweets reçus de X, doublons compris. */
	recus: number;
	/** Tweets uniques retenus (image + hashtag présent). */
	avecImage: number;
	/** Parmi eux, ceux retenus sur une graphie FAUTIVE du hashtag. */
	surFaute: number;
	tweetsUpsert: number;
	rattachements: number;
	imagesRehebergees: number;
	imagesTelechargees: number;
	arret: ArretRecolte;
	erreur?: string;
}

export interface StatsRecolte {
	success: boolean;
	campagnes: number;
	details: StatsCampagne[];
	totalRattachements: number;
	totalImages: number;
	dry: boolean;
	error?: string;
}

export interface OptionsRecolte {
	/** Restreint la récolte à une seule campagne. */
	slug?: string;
	/** Plafond de tweets retenus par campagne. */
	limite?: number;
	/** Simulation : interroge X, n'écrit rien (ni base, ni disque). */
	dry?: boolean;
	/** Désactive l'ingestion RAG (activée par défaut). */
	sansRag?: boolean;
}

interface LigneCampagne {
	slug: string;
	titre: string;
	hashtags: string[];
	/**
	 * Hashtags récoltés MAIS JAMAIS AFFICHÉS (`x_campagnes.hashtags_rattrapage`) :
	 * la coquille d'un visuel, une variante orthographique répandue. Un participant
	 * qui recopie l'affiche fautive doit quand même rejoindre la galerie ; en
	 * revanche la page ne montre jamais ces hashtags — `queries.ts` ne les
	 * sélectionne pas et ramène `hashtag_trouve` à NULL quand il en vient un.
	 */
	hashtags_rattrapage: string[];
	requetes: string[];
	/**
	 * Comptes X de l'organisateur (`x_campagnes.comptes_organisateurs`).
	 *
	 * ⚠ L'ANNONCE D'UNE CAMPAGNE N'EST PAS UNE CRÉATION DE LA CAMPAGNE. Le tweet
	 * qui lance l'opération porte le hashtag ET l'affiche : sans cette liste, il
	 * devient la première « création » de la galerie, et le compteur public
	 * annonce « 1 création, 1 participant » avant que quiconque ait participé.
	 * (Mesuré le 13/8/2026 sur `#IERGDay` : le seul post retenu à l'ouverture
	 * était l'annonce de `@rose_griffon`, dont l'image est déjà publiée comme
	 * `image_affiche`.)
	 *
	 * Le pendant Discord de cette règle existe depuis le 12/8/2026 dans
	 * `tasks/campagnes-discord.ts` — les salons d'annonces (type 5) y sont
	 * écartés pour exactement la même raison.
	 */
	comptes_organisateurs: string[];
}

/** Tweet retenu, avec le hashtag de la campagne qui l'a fait mordre. */
interface Retenu {
	tweet: Tweet;
	hashtag: string;
	/** Graphie réellement écrite par l'auteur, et son nombre de fautes. */
	ecrit: string;
	fautes: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────────────────

function dormir(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Applique un timeout dur à une promesse SANS laisser traîner le minuteur : un
 * `setTimeout` non annulé garde la boucle d'événements Bun vivante et empêche le
 * programme de se terminer tout seul.
 */
async function avecDelaiMax<T>(promesse: Promise<T>, ms: number, quoi: string): Promise<T> {
	let minuteur: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promesse,
			new Promise<never>((_, rejeter) => {
				minuteur = setTimeout(() => rejeter(new Error(`${quoi} : délai dépassé`)), ms);
			}),
		]);
	} finally {
		if (minuteur) clearTimeout(minuteur);
	}
}

/** Reconnaît un rate-limit X, quelle que soit la forme sous laquelle il remonte. */
function estRateLimit(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const e = err as { status?: number; code?: number; message?: string };
	if (e.status === 429) return true;
	if (e.code === 88) return true; // code historique « Rate limit exceeded »
	return /429|rate.?limit|too many requests/i.test(e.message ?? "");
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Filtres d'une requête de campagne, hashtag retiré.
 *
 * `#IERGDay -filter:replies since:2026-07-01` → `-filter:replies since:2026-07-01`.
 * Les requêtes de variantes doivent porter EXACTEMENT les mêmes bornes que celles
 * déclarées en base : sans le `since:`, une variante rapatrierait toute
 * l'histoire du hashtag, y compris les éditions précédentes de la campagne.
 */
export function filtresDeRequete(requete: string): string {
	return (requete || "")
		.replace(/^\s*\([^)]*\)\s*/, "") // groupe `(#a OR #b)` en tête
		.replace(/^\s*#[\p{L}\p{N}_]+\s*/u, "") // ou hashtag simple en tête
		.trim();
}

/**
 * Le post vient-il d'un compte de l'organisateur ?
 *
 * Fonction PURE. La comparaison est insensible à la casse et tolère le `@` :
 * un pseudo X n'a pas de casse significative, et la colonne est remplie à la
 * main depuis l'écran d'administration.
 */
export function estCompteOrganisateur(
	tweet: { username?: string | null; author?: { username?: string | null } | null },
	campagne: { comptes_organisateurs?: readonly string[] | null }
): boolean {
	const comptes = campagne.comptes_organisateurs ?? [];
	if (comptes.length === 0) return false;
	const pseudo = (tweet.username ?? tweet.author?.username ?? "").replace(/^@+/, "").toLowerCase();
	if (!pseudo) return false;
	return comptes.some((c) => (c || "").replace(/^@+/, "").toLowerCase() === pseudo);
}

/**
 * Tous les hashtags qui font MORDRE un post : les affichables ET ceux de
 * rattrapage.
 *
 * La distinction est purement éditoriale — elle vit dans l'affichage, pas dans la
 * récolte. Un post qui porte la coquille d'une affiche est un post de la campagne :
 * l'écarter punirait le participant d'une faute de frappe qui n'est pas la sienne.
 * C'est `apps/website/src/lib/x-campagnes/queries.ts` qui empêche ces hashtags
 * d'atteindre l'écran, jamais cette fonction.
 */
function hashtagsRecoltes(campagne: LigneCampagne): string[] {
	return [...(campagne.hashtags ?? []), ...(campagne.hashtags_rattrapage ?? [])];
}

/**
 * Clé de curseur. La PK de `x_campagne_curseurs` est (campagne, requête), or les
 * deux produits paginent INDÉPENDAMMENT le même texte de requête : sans le suffixe
 * de produit, les deux boucles s'écraseraient l'une l'autre et reprendraient sur le
 * curseur de sa jumelle — c'est-à-dire au mauvais endroit d'une autre timeline.
 */
function cleCurseur(requete: string, produit: Produit): string {
	return `${requete} [${produit}]`;
}

function rowToRagSource(row: DBTweetRow, slug: string): RagSource {
	const username = row.author_username || "unknown";
	const displayName = row.author_name || username;
	const url = urlTweet(username, row.id);
	return {
		sourceId: `tweet-${row.id}`,
		kind: "tweet",
		raw: JSON.stringify({
			id: row.id,
			text: row.text,
			author_username: username,
			author_name: displayName,
			created_at: row.created_at,
			metrics: row.metrics,
			media: row.media,
			url,
		}),
		title: `Tweet de ${displayName} (@${username})`,
		url,
		meta: {
			author_username: username,
			author_name: displayName,
			date: row.created_at,
			source: "x-campagne",
			campagne: slug,
		},
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Récolte
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Récolte les campagnes actives, ré-héberge leurs images et met à jour la base.
 *
 * @param options `slug` pour n'en traiter qu'une, `limite` pour plafonner, `dry`
 *                pour ne rien écrire.
 */
export async function crawlHashtagCampaigns(options: OptionsRecolte = {}): Promise<StatsRecolte> {
	const { slug, limite = MAX_TWEETS_PAR_CAMPAGNE, dry = false, sansRag = false } = options;
	const sql = new SQL(Bun.env.DATABASE_URL);
	const details: StatsCampagne[] = [];

	try {
		const campagnes: LigneCampagne[] = await sql`
			select slug, titre, hashtags, hashtags_rattrapage, requetes, comptes_organisateurs
			  from public.x_campagnes
			 where actif and (${slug ?? null}::text is null or slug = ${slug ?? null}::text)
			 order by principale desc, debut_le desc nulls last, slug`;

		if (campagnes.length === 0) {
			const quoi = slug ? `la campagne « ${slug} »` : "aucune campagne active";
			console.log(`[Campagnes X] Rien à récolter : ${quoi} (inexistante ou inactive).`);
			return {
				success: true,
				campagnes: 0,
				details: [],
				totalRattachements: 0,
				totalImages: 0,
				dry,
			};
		}

		console.log(
			`[Campagnes X] ${campagnes.length} campagne(s) active(s)${dry ? " — MODE SIMULATION, aucune écriture" : ""}.`
		);

		// UN SEUL client pour tout le run : il accumule l'état de rate-limit, ce qui
		// permet au backoff interne d'attendre la bonne fenêtre. Deux clients, ce
		// sont deux boucles à l'aveugle qui prennent chacune leur 429.
		const cookie = loadBxcXCookieHeader();
		const session = cookie ? XSession.fromCookieString(cookie) : XSession.loadOrEnv();
		const client = new XClient(session);

		for (const campagne of campagnes) {
			details.push(await recolterCampagne(sql, client, campagne, limite, dry, sansRag));
		}

		const totalRattachements = details.reduce((n, d) => n + d.rattachements, 0);
		const totalImages = details.reduce((n, d) => n + d.imagesRehebergees, 0);
		return {
			success: true,
			campagnes: campagnes.length,
			details,
			totalRattachements,
			totalImages,
			dry,
		};
	} catch (err) {
		console.error("[Campagnes X] Échec global :", message(err));
		return {
			success: false,
			campagnes: details.length,
			details,
			totalRattachements: details.reduce((n, d) => n + d.rattachements, 0),
			totalImages: details.reduce((n, d) => n + d.imagesRehebergees, 0),
			dry,
			error: message(err),
		};
	} finally {
		await sql.end();
		await fermerStockage();
	}
}

/** Récolte une campagne : pagination X, sélection, ré-hébergement, écriture. */
async function recolterCampagne(
	sql: SQL,
	client: XClient,
	campagne: LigneCampagne,
	limite: number,
	dry: boolean,
	sansRag: boolean
): Promise<StatsCampagne> {
	const stats: StatsCampagne = {
		slug: campagne.slug,
		requetes: 0,
		pages: 0,
		recus: 0,
		avecImage: 0,
		surFaute: 0,
		tweetsUpsert: 0,
		rattachements: 0,
		imagesRehebergees: 0,
		imagesTelechargees: 0,
		arret: "epuise",
	};

	// Le repli sur `hashtags.map(…)` couvre TOUS les hashtags recherchés, rattrapage
	// compris : une campagne sans `requetes` doit tout de même interroger X sur ses
	// variantes, sinon le filet ne récolte rien.
	const hashtags = hashtagsRecoltes(campagne);
	const declarees = campagne.requetes?.length ? campagne.requetes : hashtags.map((h) => `#${h}`);
	if ((campagne.hashtags ?? []).length === 0) {
		stats.arret = "erreur";
		stats.erreur = "campagne sans hashtag";
		return stats;
	}

	// ── LES FAUTES DE FRAPPE SE DEMANDENT, ELLES NE SE DEVINENT PAS ────────────
	// L'index de X est EXACT : `#IERGDay` ne rendra jamais `#IERGDya`. Une faute
	// qu'on n'a pas demandée est une création perdue, définitivement. On ajoute
	// donc UNE requête par campagne, groupée en `OR` — X facture la page, pas le
	// terme, donc douze graphies coûtent le prix d'une. Les requêtes déclarées en
	// base restent en tête et ne sont jamais remplacées : ce sont elles qui
	// portent la vérité éditoriale de la campagne.
	const filtres = filtresDeRequete(declarees[0] ?? "");
	const dejaDemandees = new Set(declarees.map((r) => r.toLowerCase()));
	const variantes = hashtags.flatMap((h) => variantesRecherche(h));
	const requetesFautes = requetesVariantes(variantes, filtres).filter(
		(r) => !dejaDemandees.has(r.toLowerCase())
	);
	const requetes = [...declarees, ...requetesFautes];

	const rattrapage = campagne.hashtags_rattrapage ?? [];
	console.log(
		`[Campagnes X] « ${campagne.titre} » (${campagne.slug}) — ${requetes.length} requête(s) × ${PRODUITS.length} produit(s), hashtags : ${(campagne.hashtags ?? []).map((h) => `#${h}`).join(", ")}${rattrapage.length > 0 ? ` (+ rattrapage silencieux : ${rattrapage.map((h) => `#${h}`).join(", ")})` : ""}${requetesFautes.length > 0 ? ` (+ ${requetesFautes.length} requête(s) de fautes de frappe : ${variantes.slice(1, 6).map((v) => `#${v}`).join(", ")}…)` : ""}`
	);

	// Dédoublonnage à l'échelle de la campagne : un même post remonte presque
	// toujours à la fois dans « Latest » et dans « Top ».
	const retenus = new Map<string, Retenu>();

	for (const requete of requetes) {
		for (const produit of PRODUITS) {
			if (retenus.size >= limite) break;
			stats.requetes++;
			const resultat = await paginer(sql, client, campagne, requete, produit, retenus, limite, dry);
			stats.pages += resultat.pages;
			stats.recus += resultat.recus;
			// Un rate-limit sur une requête n'invalide pas les précédentes : on
			// conserve tout ce qui a été accumulé et on note la raison de l'arrêt.
			if (resultat.arret !== "epuise") stats.arret = resultat.arret;
			await dormir(DELAI_ENTRE_REQUETES_MS);
		}
	}

	stats.avecImage = retenus.size;
	stats.surFaute = [...retenus.values()].filter((r) => r.fautes > 0).length;
	console.log(
		`[Campagnes X] ${campagne.slug} : ${stats.recus} reçus, ${retenus.size} post(s) unique(s) avec image${stats.surFaute > 0 ? `, dont ${stats.surFaute} sur une graphie fautive du hashtag` : ""}.`
	);

	if (retenus.size === 0) {
		// Chemin nominal d'une campagne annoncée mais pas encore lancée (#IERGDay).
		// Rien à écrire — on horodate quand même le passage, pour que la page publique
		// puisse afficher « dernière mise à jour ».
		if (!dry) await marquerCollecte(sql, campagne.slug);
		console.log(
			`[Campagnes X] ${campagne.slug} : aucune publication à ce jour — le hashtag ne renvoie encore rien. Rien écrit.`
		);
		return stats;
	}

	if (dry) {
		console.log(
			`[Campagnes X] ${campagne.slug} : SIMULATION — ${retenus.size} post(s) auraient été enregistrés, aucune image téléchargée.`
		);
		return stats;
	}

	// Les posts déjà masqués par la modération sont écartés de l'écriture dans
	// `public.tweets` — et pas seulement du ré-hébergement de leurs images.
	//
	// ⚠ C'EST UN POINT DE CORRECTION, PAS UNE OPTIMISATION. `public.tweets` est une
	// table PARTAGÉE (process-tweets.ts, FrenchTweet, refetch-tweet-media.ts) dont la
	// colonne `media` contient, pour un tweet déjà récolté, le jsonb ENRICHI des
	// `storage_path`/`storage_url` du Storage self-host. Ne sauter que le
	// ré-hébergement tout en gardant la ligne dans le lot d'upsert réécrivait
	// `media = excluded.media` avec les URL pbs.twimg.com brutes : le masquage d'un
	// post détruisait donc, à la récolte suivante, le lien vers les fichiers déjà
	// ré-hébergés pour TOUS ses consommateurs. Un post masqué ne doit plus rien
	// écrire du tout côté `tweets`.
	const masques = new Set(
		(
			(await sql`
				select tweet_id from public.x_campagne_posts
				 where campagne_slug = ${campagne.slug} and masque`) as Array<{ tweet_id: string }>
		).map((r) => r.tweet_id)
	);

	// 1) Conversion + ré-hébergement des images.
	const lignesTweets: DBTweetRow[] = [];
	const lignesPosts: Array<{
		campagne_slug: string;
		tweet_id: string;
		hashtag_trouve: string;
		a_media: boolean;
		nb_images: number;
		publie_le: Date;
		collecte_le: Date;
	}> = [];

	let ignoresMasques = 0;
	for (const { tweet, hashtag } of retenus.values()) {
		const row = tweetToRow(tweet);
		// `author_username` est NULLable en base mais inutilisable côté site (l'URL
		// d'un post se construit avec) : on écarte les rares tweets sans auteur.
		if (!row.author_username) continue;

		if (masques.has(row.id)) {
			// Ni ré-hébergement, ni upsert `tweets` : on laisse la ligne existante
			// intacte (voir le commentaire du `select … where masque` ci-dessus).
			ignoresMasques++;
		} else {
			const res = await rehebergerMediasTweet(row.id, row.media as MediaItem[] | null);
			row.media = res.media;
			stats.imagesRehebergees += res.rehberges;
			stats.imagesTelechargees += res.telecharges;
			lignesTweets.push(row);
		}

		lignesPosts.push({
			campagne_slug: campagne.slug,
			tweet_id: row.id,
			hashtag_trouve: hashtag,
			a_media: true,
			nb_images: compterImages(row.media as MediaItem[] | null),
			publie_le: new Date(row.created_at),
			collecte_le: new Date(),
		});
	}

	// 2) Upsert `public.tweets`.
	for (let i = 0; i < lignesTweets.length; i += LOT_ECRITURE) {
		const lot = lignesTweets.slice(i, i + LOT_ECRITURE).map((r) => ({
			...r,
			created_at: new Date(r.created_at),
			updated_at: new Date(r.updated_at),
		}));
		// ⚠ `translation` et `category` sont ABSENTES de la clause `do update` :
		// elles sont renseignées après coup par process-tweets.ts et seraient
		// écrasées à chaque récolte.
		await sql`
			insert into public.tweets ${sql(
				lot,
				"id",
				"author_id",
				"author_name",
				"author_username",
				"created_at",
				"text",
				"is_thread",
				"tweet_count",
				"metrics",
				"media",
				"quoted_tweets",
				"updated_at"
			)}
			on conflict (id) do update set
				text            = excluded.text,
				media           = excluded.media,
				metrics         = excluded.metrics,
				author_name     = excluded.author_name,
				author_username = excluded.author_username,
				updated_at      = now()`;
		stats.tweetsUpsert += lot.length;
	}

	// 3) Upsert `public.x_campagne_posts`.
	for (let i = 0; i < lignesPosts.length; i += LOT_ECRITURE) {
		const lot = lignesPosts.slice(i, i + LOT_ECRITURE);
		// ⚠⚠ NE JAMAIS ajouter `masque`, `motif_masquage` ni `mis_en_avant` à cette
		// clause `do update` : ce sont les décisions humaines de modération et de
		// mise en avant. Les y mettre ferait réapparaître sur le site, à la récolte
		// suivante, tout post qu'un modérateur vient de retirer.
		await sql`
			insert into public.x_campagne_posts ${sql(
				lot,
				"campagne_slug",
				"tweet_id",
				"hashtag_trouve",
				"a_media",
				"nb_images",
				"publie_le",
				"collecte_le"
			)}
			on conflict (campagne_slug, tweet_id) do update set
				hashtag_trouve = excluded.hashtag_trouve,
				a_media        = excluded.a_media,
				nb_images      = excluded.nb_images,
				publie_le      = excluded.publie_le,
				collecte_le    = now()`;
		stats.rattachements += lot.length;
	}

	await marquerCollecte(sql, campagne.slug);
	console.log(
		`[Campagnes X] ${campagne.slug} : ${stats.tweetsUpsert} tweet(s) upsert, ${stats.rattachements} rattachement(s), ${stats.imagesRehebergees} image(s) ré-hébergée(s) dont ${stats.imagesTelechargees} nouvelle(s)${ignoresMasques > 0 ? `, ${ignoresMasques} post(s) masqué(s) laissé(s) intact(s)` : ""}.`
	);

	// 4) Ingestion RAG — EN DERNIER et sous son propre try/catch : le RAG est un
	// confort, il ne doit jamais faire échouer une récolte réussie.
	if (!sansRag && lignesTweets.length > 0) {
		try {
			const sources = lignesTweets.map((r) => rowToRagSource(r, campagne.slug));
			const ing = await avecDelaiMax(ingestSources(sources), TIMEOUT_RAG_MS, "ingestion RAG");
			console.log(
				`[Campagnes X] ${campagne.slug} : RAG ${ing.chunks} chunk(s) (backend=${ing.backend}).`
			);
		} catch (err) {
			console.warn(`[Campagnes X] ${campagne.slug} : ingestion RAG ignorée —`, message(err));
		}
	}

	return stats;
}

/** Boucle de pagination d'un couple (requête × produit). */
async function paginer(
	sql: SQL,
	client: XClient,
	campagne: LigneCampagne,
	requete: string,
	produit: Produit,
	retenus: Map<string, Retenu>,
	limite: number,
	dry: boolean
): Promise<{ pages: number; recus: number; arret: ArretRecolte }> {
	const cle = cleCurseur(requete, produit);

	// Reprise : uniquement après un rate-limit. Après un `epuise`, repartir du
	// curseur sauterait les nouveautés — elles arrivent EN TÊTE du flux.
	const [precedent] = (await sql`
		select curseur, dernier_arret from public.x_campagne_curseurs
		 where campagne_slug = ${campagne.slug} and requete = ${cle}`) as Array<{
		curseur: string | null;
		dernier_arret: string | null;
	}>;
	let curseur: string | undefined =
		precedent?.dernier_arret === "rate_limit" ? (precedent.curseur ?? undefined) : undefined;

	const vus = new Set<string>();
	let pages = 0;
	let recus = 0;
	let arret: ArretRecolte = "epuise";

	while (pages < MAX_PAGES_PAR_REQUETE) {
		let page: Awaited<ReturnType<XClient["search"]>>;
		try {
			page = await avecDelaiMax(
				client.search(requete, TWEETS_PAR_PAGE, curseur, produit),
				TIMEOUT_RECHERCHE_MS,
				`recherche « ${requete.slice(0, 40)}… » (${produit})`
			);
		} catch (err) {
			// Rate-limit : on CONSERVE l'accumulé et on mémorise le curseur pour
			// reprendre exactement ici au prochain run.
			arret = estRateLimit(err) ? "rate_limit" : "erreur";
			console.warn(
				`[Campagnes X] ${campagne.slug} « ${requete.slice(0, 40)}… » (${produit}) : arrêt page ${pages + 1} (${arret}) —`,
				message(err)
			);
			break;
		}

		pages++;
		const tweets = page.tweets ?? [];
		recus += tweets.length;

		let nouveaux = 0;
		let ajoutes = 0;
		for (const t of tweets) {
			if (!t?.id) continue;
			if (!vus.has(t.id)) {
				vus.add(t.id);
				nouveaux++;
			}
			if (retenus.has(t.id)) continue;
			// Deux filtres, tous deux nécessaires : au moins une image, ET le hashtag
			// réellement présent dans le texte du post.
			//
			// L'appariement TOLÈRE LES FAUTES DE FRAPPE (`#IERGDya`, `#IERG_Day`,
			// `#iergday2026`) : un participant qui recopie le hashtag d'une affiche
			// sur un téléphone n'a pas à perdre sa création pour une lettre. Le filet
			// s'applique à TOUT ce que X renvoie, y compris aux posts ramenés par
			// ricochet par une autre requête.
			if (!porteUneImage(t)) continue;
			// L'annonce de la campagne porte le hashtag et l'affiche : sans ce
			// filtre, elle devient la première « création » du mur.
			if (estCompteOrganisateur(t, campagne)) continue;
			const appariement = apparierHashtag(t.text, hashtagsRecoltes(campagne));
			if (!appariement) continue;
			retenus.set(t.id, {
				tweet: t,
				hashtag: appariement.hashtag,
				ecrit: appariement.ecrit,
				fautes: appariement.fautes,
			});
			ajoutes++;
			if (retenus.size >= limite) break;
		}

		console.log(
			`[Campagnes X]   ${produit} p${pages} : ${tweets.length} reçus, ${nouveaux} nouveaux, ${ajoutes} retenus (total ${retenus.size}).`
		);

		const suivant = page.next_cursor;
		// ⚠ X renvoie un `next_cursor` NON NUL même sur zéro résultat (vérifié sur
		// #iergday). S'arrêter sur `!next_cursor` seul boucle indéfiniment : il faut
		// aussi tester le nombre de tweets ET le nombre d'ids NOUVEAUX (deux pages
		// consécutives peuvent réémettre le même contenu sous un curseur différent).
		if (tweets.length === 0 || !suivant || nouveaux === 0) {
			arret = "epuise";
			break;
		}
		if (retenus.size >= limite) {
			arret = "max_pages";
			break;
		}
		curseur = suivant;

		// Curseur persisté après CHAQUE page : un 429 en milieu de parcours ne doit
		// pas faire perdre la progression déjà payée en quota.
		if (!dry) await persisterCurseur(sql, campagne.slug, cle, suivant, pages, "max_pages");
		await dormir(DELAI_ENTRE_PAGES_MS);
	}

	if (pages >= MAX_PAGES_PAR_REQUETE && arret === "epuise") arret = "max_pages";
	if (!dry) await persisterCurseur(sql, campagne.slug, cle, curseur ?? null, pages, arret);

	return { pages, recus, arret };
}

/** Écrit (ou met à jour) le curseur de reprise d'un couple (campagne, requête). */
async function persisterCurseur(
	sql: SQL,
	slug: string,
	cle: string,
	curseur: string | null,
	pages: number,
	arret: ArretRecolte
): Promise<void> {
	await sql`
		insert into public.x_campagne_curseurs
			(campagne_slug, requete, curseur, pages_lues, dernier_arret, maj_le)
		values (${slug}, ${cle}, ${curseur}, ${pages}, ${arret}, now())
		on conflict (campagne_slug, requete) do update set
			curseur       = excluded.curseur,
			pages_lues    = excluded.pages_lues,
			dernier_arret = excluded.dernier_arret,
			maj_le        = now()`;
}

/** Horodate le passage de récolte, succès comme échec. */
async function marquerCollecte(sql: SQL, slug: string): Promise<void> {
	await sql`
		update public.x_campagnes
		   set collecte_le = now(), updated_at = now()
		 where slug = ${slug}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface en ligne de commande
// ─────────────────────────────────────────────────────────────────────────────

function lireOptions(argv: readonly string[]): OptionsRecolte {
	const valeur = (nom: string): string | undefined => {
		const i = argv.indexOf(nom);
		return i === -1 ? undefined : argv[i + 1];
	};
	const limiteBrute = Number(valeur("--limite"));
	return {
		slug: valeur("--campagne"),
		limite: Number.isFinite(limiteBrute) && limiteBrute > 0 ? limiteBrute : undefined,
		dry: argv.includes("--dry"),
		sansRag: argv.includes("--sans-rag"),
	};
}

if (import.meta.main) {
	const argv = Bun.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(
			[
				"Récolte des campagnes à hashtag X vers public.x_campagne_posts.",
				"",
				"  bun packages/cron/src/tasks/ie-crawl/hashtag-harvest.ts [options]",
				"",
				"  --campagne <slug>  ne traite que cette campagne (défaut : toutes les actives)",
				"  --limite <n>       plafond de posts retenus par campagne (défaut : 600)",
				"  --dry              simulation : interroge X, n'écrit ni en base ni sur disque",
				"  --sans-rag         n'ingère pas les posts dans le RAG",
			].join("\n")
		);
		process.exit(0);
	}

	const res = await crawlHashtagCampaigns(lireOptions(argv));

	console.log("\n[Campagnes X] ── Résumé ──");
	for (const d of res.details) {
		console.log(
			`  ${d.slug.padEnd(20)} reçus=${d.recus} avec_image=${d.avecImage} tweets=${d.tweetsUpsert} rattachements=${d.rattachements} images=${d.imagesRehebergees}(+${d.imagesTelechargees}) arrêt=${d.arret}${d.erreur ? ` erreur=${d.erreur}` : ""}`
		);
	}
	console.log(
		`  TOTAL campagnes=${res.campagnes} rattachements=${res.totalRattachements} images=${res.totalImages}${res.dry ? " (simulation)" : ""}`
	);
	if (res.error) console.error(`  ERREUR : ${res.error}`);
	process.exit(res.success ? 0 : 1);
}
