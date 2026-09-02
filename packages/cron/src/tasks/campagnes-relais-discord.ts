/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RELAIS DISCORD DES CRÉATIONS D'UNE CAMPAGNE — TOUTES SOURCES.
 *
 * Une campagne se joue sur plusieurs réseaux à la fois. Le staff, lui, n'a qu'un
 * endroit à surveiller : le salon de relais (`x_campagnes.relais_salon`), où le
 * bot dépose chaque création au fil de l'eau, quelle que soit sa provenance.
 *
 * ⚠ CE SALON N'EST PAS LE SALON DE DÉPÔT. Le salon de dépôt (`salons_depot`,
 * `🍰〡iergday`) est l'endroit PUBLIC où les membres déposent eux-mêmes leurs
 * créations ; le salon de relais (`⚙🍰〡iergday-staff`) est le fil de suivi de
 * l'équipe. Confondre les deux ferait republier par le bot, dans le salon
 * public, ce que le membre vient d'y poster à la main.
 *
 * ── LES SOURCES ────────────────────────────────────────────────────────────
 *  - `x`        : `x_campagne_posts` × `tweets` — le hashtag de la campagne,
 *                 fautes de frappe comprises (`ie-crawl/hashtag-variantes.ts`).
 *  - `discord`  : `campagne_creations_discord` × `discord_messages` — le salon
 *                 de dépôt de la campagne.
 *  - `instagram`: `campagne_creations_instagram` — les créations DÉPOSÉES à la
 *                 main par les participants. Il n'existe aucun collecteur
 *                 automatique Instagram, et il ne peut pas en exister
 *                 aujourd'hui : toutes les portes sont fermées à un client non
 *                 connecté (mesures dans `docs/insta.md`). Le lien est vérifié à
 *                 l'oEmbed public au moment du dépôt, l'image ré-hébergée.
 *
 * ── CE QUI REND CETTE TÂCHE SÛRE ───────────────────────────────────────────
 *  1. IDEMPOTENCE. `x_campagne_relais` mémorise chaque (campagne, source,
 *     référence). Rejouer ne republie rien, et un plantage en milieu de lot
 *     reprend où il s'était arrêté — la ligne est écrite APRÈS l'accusé de
 *     réception de Discord, jamais avant.
 *  2. GARDE ANTI-DÉLUGE. `relais_depuis` borne le relais dans le temps ; sans
 *     elle, l'activer sur une campagne archivée déverserait ses centaines de
 *     créations d'un coup.
 *  3. MODÉRATION RESPECTÉE. Une création `masque` n'est jamais relayée : elle
 *     est rangée avec son motif, pour que chaque passe ne la reconsidère pas.
 *  4. PLAFOND PAR PASSE, et une pause entre deux envois (Discord accepte cinq
 *     messages par cinq secondes et par salon).
 *
 * ── POURQUOI L'API REST ET PAS LA PASSERELLE ───────────────────────────────
 * Booter le client discord.js charge les ~1 984 membres du serveur avant de
 * pouvoir écrire une ligne. Poster est un `POST /channels/{id}/messages` : on le
 * fait directement, comme `tasks/discord-messages.ts` le fait déjà pour lire.
 *
 * Usage :
 *   bun packages/cron/src/tasks/campagnes-relais-discord.ts [--campagne <slug>] [--limite N] [--dry]
 */

import {
	borner,
	COULEUR_MARQUE,
	emotesRoseGriffon,
	LIMITE_AUTEUR,
	LIMITE_CONTENU,
	LIMITE_DESCRIPTION,
} from "@rosegriffon/types/discord";

import { sql } from "../lib/db.js";
import { DISCORD_TOKEN, GUILD_ID } from "../lib/discord.js";

/*
 * `borner`, les limites de l'API, la couleur de marque et les émotes viennent
 * de `@rosegriffon/types/discord` depuis le 23/8/2026 : l'annonce de tirage du
 * site en a besoin des mêmes, `apps/website` ne peut pas dépendre de ce paquet
 * (un site n'embarque pas un démon d'exploitation), et deux copies finissent
 * toujours par diverger sur la valeur qui fait refuser le message entier.
 * `borner` est RÉ-EXPORTÉ plus bas : c'est la même implémentation, à un seul
 * endroit, et les appelants historiques n'ont pas à bouger.
 */

const API_DISCORD = "https://discord.com/api/v10";
const PREFIXE = "[Relais campagne]";

/** Origine publique du site — les images relayées doivent être en URL absolue. */
const ORIGINE = Bun.env.SITE_URL ?? "https://rosegriffon.fr";

/** Préfixe public du bucket `assets` (même valeur que `lib/x-campagnes/types.ts`). */
const CHEMIN_ASSETS = "/storage/v1/object/public/assets/";

/** Créations relayées par passe et par campagne. */
const MAX_PAR_PASSE = 12;

/** Pause entre deux envois : Discord accepte 5 messages / 5 s et par salon. */
const PAUSE_ENVOI_MS = 1200;

/**
 * Les émotes du serveur utilisées par le relais.
 *
 * Ce sont les mascottes de l'association (Roy et Gaëlle) : le message a la voix
 * de Rose Griffon, pas celle d'un robot générique. Les identifiants sont ceux
 * relevés le 13/8/2026 sur `GET /guilds/{id}/emojis` — une émote personnalisée
 * n'existe QUE sur le serveur qui la porte, et un identifiant inventé s'affiche
 * en texte brut dans le salon.
 *
 * Surchargeables par l'environnement : si une émote est renommée ou supprimée,
 * on ne veut pas d'un déploiement pour remettre le relais d'aplomb.
 */
const { annonce: EMOTE_ANNONCE, fete: EMOTE_FETE } = emotesRoseGriffon(Bun.env);

/**
 * Réactions posées sur chaque relais, dans cet ordre.
 *
 * Format `nom:id` — c'est celui qu'attend
 * `PUT /channels/{c}/messages/{m}/reactions/{emoji}/@me`, SANS les chevrons de
 * l'écriture en message (les y laisser donne un 400). Elles donnent au staff un
 * geste à un clic : valider d'un cœur plutôt que d'écrire un message.
 */
const REACTIONS = [
	Bun.env.RG_REACTION_ROY ?? "RG_Roy_coeur1:1141460972754702436",
	Bun.env.RG_REACTION_GAELLE ?? "RG_Gaelle_coeur1:1141461416503693384",
];

/** Provenance d'une création. Miroir de la contrainte `check` de la table. */
export type SourceCreation = "x" | "discord" | "instagram";

export interface StatsRelaisCampagne {
	slug: string;
	salon: string;
	/** Créations éligibles trouvées, avant plafond. */
	candidats: number;
	relayes: number;
	sautes: number;
	echecs: number;
	/** Créations laissées pour la passe suivante, faute de budget. */
	reportes: number;
	/** Décompte par provenance, pour que le journal dise D'OÙ vient la campagne. */
	parSource: Record<string, number>;
}

export interface StatsRelais {
	success: boolean;
	campagnes: number;
	details: StatsRelaisCampagne[];
	totalRelayes: number;
	dry: boolean;
	error?: string;
}

export interface OptionsRelais {
	slug?: string;
	limite?: number;
	dry?: boolean;
}

interface LigneCampagne {
	slug: string;
	titre: string;
	relais_salon: string;
	relais_depuis: Date | null;
}

/**
 * Une création, quelle que soit sa source, sous la forme qu'attend le relais.
 *
 * Les deux collecteurs écrivent dans des tables différentes, avec des colonnes
 * différentes ; c'est ICI qu'ils se rejoignent, une fois, plutôt que dans chaque
 * branche de la mise en forme.
 */
export interface Creation {
	source: SourceCreation;
	/** Identifiant chez la source (id de tweet, id de message Discord…). */
	reference: string;
	/** Adresse publique de la création d'origine. */
	lien: string;
	auteur: string;
	texte: string;
	image: string | null;
	hashtag: string | null;
	publieLe: Date;
	masque: boolean;
}

function dormir(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Appel REST Discord authentifié par le jeton du bot. */
async function appelDiscord<T>(chemin: string, init: RequestInit = {}): Promise<T> {
	if (!DISCORD_TOKEN) {
		throw new Error("DISCORD_BOT_TOKEN absent : impossible de poster.");
	}
	const reponse = await fetch(`${API_DISCORD}${chemin}`, {
		...init,
		headers: {
			Authorization: `Bot ${DISCORD_TOKEN}`,
			"Content-Type": "application/json",
			...(init.headers ?? {}),
		},
	});

	// 429 : Discord donne le délai exact à attendre. Le respecter une fois vaut
	// mieux que réessayer à l'aveugle et se faire fermer la route.
	if (reponse.status === 429) {
		const corps = (await reponse.json().catch(() => ({}))) as { retry_after?: number };
		const attente = Math.ceil((corps.retry_after ?? 1) * 1000);
		console.warn(`${PREFIXE} Quota Discord atteint, pause de ${attente} ms.`);
		await dormir(attente);
		return appelDiscord<T>(chemin, init);
	}

	if (!reponse.ok) {
		throw new Error(`${init.method ?? "GET"} ${chemin} → ${reponse.status} ${await reponse.text()}`);
	}
	// 204 sur les réactions : pas de corps à lire.
	return (reponse.status === 204 ? undefined : await reponse.json()) as T;
}

// ─── Mise en forme (PURE, testée seule) ──────────────────────────────────────

/**
 * Coupe au caractère près, en signalant la coupe — jamais en la masquant.
 *
 * L'implémentation vit dans `@rosegriffon/types/discord`, partagée avec
 * l'annonce de tirage du site. Elle reste exportée d'ici pour les appelants
 * historiques (dont `campagnes-relais-discord.test.ts`) : un ré-export n'est pas
 * un doublon, c'est le même code sous deux chemins.
 */
export { borner };

/** Adresse publique d'une publication X. */
export function urlPublication(username: string, id: string): string {
	return `https://x.com/${username}/status/${id}`;
}

/** Adresse publique d'un message Discord. */
export function urlMessageDiscord(guilde: string, salon: string, messageId: string): string {
	return `https://discord.com/channels/${guilde}/${salon}/${messageId}`;
}

/** URL absolue d'une image ré-hébergée dans le bucket `assets`. */
export function urlAsset(chemin: string | null | undefined): string | null {
	if (typeof chemin !== "string" || chemin.trim() === "") return null;
	return `${ORIGINE}${CHEMIN_ASSETS}${chemin.trim().replace(/^\/+/, "")}`;
}

/**
 * Première image d'un tweet, ré-hébergée si elle l'a été.
 *
 * `storage_url` d'abord : les URL `pbs.twimg.com` d'origine expirent et
 * laisseraient, des mois plus tard, un embed à l'image cassée dans l'archive du
 * salon.
 */
export function premiereImageTweet(media: unknown): string | null {
	if (!Array.isArray(media)) return null;
	for (const item of media) {
		if (typeof item !== "object" || item === null) continue;
		const m = item as {
			type?: string;
			storage_url?: string;
			url?: string;
			media_url_https?: string;
		};
		if (m.type && m.type !== "photo" && m.type !== "image") continue;
		const url = m.storage_url || m.media_url_https || m.url;
		if (typeof url === "string" && url.startsWith("http")) return url;
	}
	return null;
}

/**
 * Première image ré-hébergée d'une création Discord.
 *
 * Une entrée sans `chemin` est une recopie encore en échec : on passe à la
 * suivante plutôt que de servir l'URL Discord d'origine, qui est signée et
 * expire.
 */
export function premiereImageDiscord(images: unknown): string | null {
	if (!Array.isArray(images)) return null;
	for (const item of images) {
		if (typeof item !== "object" || item === null) continue;
		const url = urlAsset((item as { chemin?: string | null }).chemin);
		if (url) return url;
	}
	return null;
}

/** Ce que le membre lit en notification, par provenance. */
const LIBELLE_SOURCE: Record<SourceCreation, string> = {
	x: "sur X",
	discord: "sur Discord",
	instagram: "sur Instagram",
};

/**
 * Le message Discord d'une création relayée.
 *
 * Fonction PURE, testée seule : c'est elle qui décide ce que le staff lit, et
 * une charge qui viole une limite de l'API fait refuser le message ENTIER —
 * embed compris. Personne ne voit alors rien, pas même une erreur partielle, et
 * la création est silencieusement perdue.
 */
export function chargeRelais(
	creation: Creation,
	campagne: { titre: string; slug: string }
): Record<string, unknown> {
	const etiquette = creation.hashtag ? `#${creation.hashtag}` : campagne.titre;

	return {
		// Le contenu hors embed est ce que Discord montre en notification et en
		// aperçu de réponse : il doit se suffire à lui-même.
		content: borner(
			`${EMOTE_ANNONCE} Nouvelle création **${etiquette}** par **${borner(creation.auteur, 60)}** ${LIBELLE_SOURCE[creation.source]} ${EMOTE_FETE}`,
			LIMITE_CONTENU
		),
		embeds: [
			{
				author: { name: borner(creation.auteur, LIMITE_AUTEUR) },
				color: COULEUR_MARQUE,
				description: borner(creation.texte ?? "", LIMITE_DESCRIPTION),
				...(creation.image ? { image: { url: creation.image } } : {}),
				footer: { text: `${campagne.titre} · ${ORIGINE.replace(/^https?:\/\//, "")}/iergday` },
				timestamp: new Date(creation.publieLe).toISOString(),
				url: creation.lien,
			},
		],
		// Le bouton-lien : sans lui, aller voir la création d'origine demande de
		// recopier une URL à la main depuis un embed.
		components: [
			{
				type: 1,
				components: [
					{
						type: 2,
						style: 5,
						label: creation.source === "discord" ? "Aller au message" : "Voir la publication",
						url: creation.lien,
					},
				],
			},
		],
		// ⚠ AUCUNE MENTION N'EST AUTORISÉE. Le texte d'une création peut contenir
		// « @everyone » ; sans cette clause, le relais le transmettrait au serveur
		// entier avec les permissions du bot.
		allowed_mentions: { parse: [] },
	};
}

// ─── Lecture des sources ─────────────────────────────────────────────────────

/** Les publications X d'une campagne qui n'ont pas encore été relayées. */
async function creationsX(campagne: LigneCampagne): Promise<Creation[]> {
	const lignes = (await sql`
		select p.tweet_id,
		       p.hashtag_trouve,
		       p.masque,
		       p.publie_le,
		       t.text,
		       t.author_name,
		       t.author_username,
		       t.media
		  from public.x_campagne_posts p
		  join public.tweets t on t.id = p.tweet_id
		 where p.campagne_slug = ${campagne.slug}
		   and (${campagne.relais_depuis ?? null}::timestamptz is null
		        or p.publie_le >= ${campagne.relais_depuis ?? null}::timestamptz)
		   and not exists (
		         select 1 from public.x_campagne_relais r
		          where r.campagne_slug = p.campagne_slug
		            and r.source = 'x'
		            and r.reference_id = p.tweet_id)`) as Array<{
		tweet_id: string;
		hashtag_trouve: string | null;
		masque: boolean;
		publie_le: Date;
		text: string | null;
		author_name: string | null;
		author_username: string | null;
		media: unknown;
	}>;

	return lignes.map((l) => ({
		source: "x" as const,
		reference: l.tweet_id,
		lien: urlPublication(l.author_username ?? "i", l.tweet_id),
		// Le pseudo compte plus que le nom d'affichage ici : c'est lui qui permet
		// de retrouver l'auteur, et il est stable.
		auteur: l.author_username ? `@${l.author_username}` : (l.author_name ?? "auteur inconnu"),
		texte: l.text ?? "",
		image: premiereImageTweet(l.media),
		hashtag: l.hashtag_trouve,
		publieLe: l.publie_le,
		// Un post sans pseudo n'a pas d'URL constructible : le relayer produirait
		// un lien mort. Il est rangé comme un masqué, avec son motif.
		masque: l.masque || !l.author_username,
	}));
}

/** Les créations déposées sur Discord qui n'ont pas encore été relayées. */
async function creationsDiscord(campagne: LigneCampagne): Promise<Creation[]> {
	const lignes = (await sql`
		select c.message_id,
		       c.hashtag_trouve,
		       c.masque,
		       c.publie_le,
		       c.images,
		       m.content,
		       m.channel_id,
		       m.guild_id,
		       m.author_username,
		       m.author_display_name
		  from public.campagne_creations_discord c
		  join public.discord_messages m on m.message_id = c.message_id
		 where c.campagne_slug = ${campagne.slug}
		   and m.deleted_at is null
		   and (${campagne.relais_depuis ?? null}::timestamptz is null
		        or c.publie_le >= ${campagne.relais_depuis ?? null}::timestamptz)
		   and not exists (
		         select 1 from public.x_campagne_relais r
		          where r.campagne_slug = c.campagne_slug
		            and r.source = 'discord'
		            and r.reference_id = c.message_id)`) as Array<{
		message_id: string;
		hashtag_trouve: string | null;
		masque: boolean;
		publie_le: Date;
		images: unknown;
		content: string | null;
		channel_id: string;
		guild_id: string | null;
		author_username: string | null;
		author_display_name: string | null;
	}>;

	return lignes.map((l) => ({
		source: "discord" as const,
		reference: l.message_id,
		lien: urlMessageDiscord(l.guild_id ?? GUILD_ID ?? "@me", l.channel_id, l.message_id),
		auteur: l.author_display_name || l.author_username || "membre inconnu",
		texte: l.content ?? "",
		image: premiereImageDiscord(l.images),
		hashtag: l.hashtag_trouve,
		publieLe: l.publie_le,
		masque: l.masque,
	}));
}

/**
 * Les créations Instagram déposées à la main, pas encore relayées.
 *
 * ── PAS DE JOINTURE, CONTRAIREMENT AUX DEUX AUTRES ─────────────────────────
 * `x_campagne_posts` et `campagne_creations_discord` sont des tables
 * d'ASSOCIATION : le contenu vit ailleurs (`tweets`, `discord_messages`). La
 * table Instagram, elle, porte tout — parce qu'il n'existe aucun collecteur
 * amont où le contenu pourrait vivre. C'est le participant qui l'a saisi.
 *
 * `auteur_pseudo` peut être NULL : le déposant n'est pas obligé de se nommer, et
 * l'API Graph (le jour où elle alimentera cette table) ne rend pas ce champ.
 * « auteur inconnu » est alors exact — pas un repli qui masque une lacune.
 */
async function creationsInstagram(campagne: LigneCampagne): Promise<Creation[]> {
	const lignes = (await sql`
		select i.shortcode,
		       i.permalink,
		       i.hashtag_trouve,
		       i.masque,
		       i.publie_le,
		       i.legende,
		       i.images,
		       i.auteur_pseudo
		  from public.campagne_creations_instagram i
		 where i.campagne_slug = ${campagne.slug}
		   and (${campagne.relais_depuis ?? null}::timestamptz is null
		        or i.publie_le >= ${campagne.relais_depuis ?? null}::timestamptz)
		   and not exists (
		         select 1 from public.x_campagne_relais r
		          where r.campagne_slug = i.campagne_slug
		            and r.source = 'instagram'
		            and r.reference_id = i.shortcode)`) as Array<{
		shortcode: string;
		permalink: string;
		hashtag_trouve: string | null;
		masque: boolean;
		publie_le: Date;
		legende: string | null;
		images: unknown;
		auteur_pseudo: string | null;
	}>;

	return lignes.map((l) => ({
		source: "instagram" as const,
		reference: l.shortcode,
		lien: l.permalink,
		auteur: l.auteur_pseudo ? `@${l.auteur_pseudo}` : "auteur inconnu",
		texte: l.legende ?? "",
		image: premiereImageDiscord(l.images),
		hashtag: l.hashtag_trouve,
		publieLe: l.publie_le,
		masque: l.masque,
	}));
}

// ─── Relais ──────────────────────────────────────────────────────────────────

/** Relaie les campagnes actives qui déclarent un salon de relais. */
export async function relayerCampagnesDiscord(options: OptionsRelais = {}): Promise<StatsRelais> {
	const { slug, limite = MAX_PAR_PASSE, dry = false } = options;
	const details: StatsRelaisCampagne[] = [];

	try {
		const campagnes = (await sql`
			select slug, titre, relais_salon, relais_depuis
			  from public.x_campagnes
			 where actif
			   and relais_salon is not null
			   and (${slug ?? null}::text is null or slug = ${slug ?? null}::text)
			 order by principale desc, slug`) as LigneCampagne[];

		if (campagnes.length === 0) {
			const quoi = slug
				? `la campagne « ${slug} » n'a pas de salon de relais`
				: "aucune campagne active ne déclare de salon de relais";
			console.log(`${PREFIXE} Rien à relayer : ${quoi}.`);
			return { success: true, campagnes: 0, details: [], totalRelayes: 0, dry };
		}

		for (const campagne of campagnes) {
			details.push(await relayerCampagne(campagne, limite, dry));
		}

		return {
			success: true,
			campagnes: campagnes.length,
			details,
			totalRelayes: details.reduce((n, d) => n + d.relayes, 0),
			dry,
		};
	} catch (err) {
		console.error(`${PREFIXE} Échec global :`, message(err));
		return {
			success: false,
			campagnes: details.length,
			details,
			totalRelayes: details.reduce((n, d) => n + d.relayes, 0),
			dry,
			error: message(err),
		};
	}
}

async function relayerCampagne(
	campagne: LigneCampagne,
	limite: number,
	dry: boolean
): Promise<StatsRelaisCampagne> {
	const stats: StatsRelaisCampagne = {
		slug: campagne.slug,
		salon: campagne.relais_salon,
		candidats: 0,
		relayes: 0,
		sautes: 0,
		echecs: 0,
		reportes: 0,
		parSource: {},
	};

	// ⚠ TRI CHRONOLOGIQUE CROISSANT, toutes sources confondues. Le salon doit
	// raconter la campagne dans l'ordre où elle s'est produite ; en ordre
	// décroissant, un rattrapage de dix créations les afficherait à l'envers. Le
	// tri est fait ICI et non en SQL : deux requêtes triées séparément se
	// concaténeraient en deux blocs, pas en une chronologie.
	const creations = [
		...(await creationsX(campagne)),
		...(await creationsDiscord(campagne)),
		...(await creationsInstagram(campagne)),
	].sort((a, b) => new Date(a.publieLe).getTime() - new Date(b.publieLe).getTime());

	stats.candidats = creations.length;
	if (creations.length === 0) {
		console.log(`${PREFIXE} ${campagne.slug} : rien de nouveau à relayer.`);
		return stats;
	}

	for (const creation of creations) {
		if (stats.relayes >= limite) {
			stats.reportes = creations.length - stats.relayes - stats.sautes - stats.echecs;
			break;
		}

		// Modération : une création retirée du site ne part pas dans le salon. La
		// ligne est quand même écrite, avec son motif — sans quoi chaque passe la
		// reconsidérerait indéfiniment.
		if (creation.masque) {
			stats.sautes++;
			if (!dry) await marquerSaute(campagne, creation, "masquée par la modération, ou sans auteur");
			continue;
		}

		if (dry) {
			stats.relayes++;
			stats.parSource[creation.source] = (stats.parSource[creation.source] ?? 0) + 1;
			console.log(
				`${PREFIXE} ${campagne.slug} : SIMULATION — ${creation.source}/${creation.reference} (${creation.auteur}) serait relayée.`
			);
			continue;
		}

		try {
			const envoye = await appelDiscord<{ id: string }>(
				`/channels/${campagne.relais_salon}/messages`,
				{ method: "POST", body: JSON.stringify(chargeRelais(creation, campagne)) }
			);
			// La ligne est écrite APRÈS l'accusé de réception : l'écrire avant
			// perdrait définitivement toute création dont l'envoi échoue.
			await sql`
				insert into public.x_campagne_relais
					(campagne_slug, source, reference_id, salon_id, message_id)
				values (${campagne.slug}, ${creation.source}, ${creation.reference},
				        ${campagne.relais_salon}, ${envoye.id})
				on conflict (campagne_slug, source, reference_id) do update set
					message_id = excluded.message_id,
					salon_id   = excluded.salon_id,
					poste_le   = now()`;
			stats.relayes++;
			stats.parSource[creation.source] = (stats.parSource[creation.source] ?? 0) + 1;

			await poserReactions(campagne.relais_salon, envoye.id);
			await dormir(PAUSE_ENVOI_MS);
		} catch (err) {
			stats.echecs++;
			console.error(
				`${PREFIXE} ${campagne.slug} : échec du relais de ${creation.source}/${creation.reference} —`,
				message(err)
			);
		}
	}

	const detailSources = Object.entries(stats.parSource)
		.map(([source, n]) => `${source}=${n}`)
		.join(" ");
	console.log(
		`${PREFIXE} ${campagne.slug} : ${stats.relayes} relayée(s)${detailSources ? ` (${detailSources})` : ""}, ${stats.sautes} sautée(s), ${stats.echecs} en échec, ${stats.reportes} reportée(s) sur ${stats.candidats} candidate(s).`
	);
	return stats;
}

/** Range une création volontairement non relayée, avec son motif. */
async function marquerSaute(
	campagne: LigneCampagne,
	creation: Creation,
	motif: string
): Promise<void> {
	await sql`
		insert into public.x_campagne_relais
			(campagne_slug, source, reference_id, salon_id, saute_motif)
		values (${campagne.slug}, ${creation.source}, ${creation.reference},
		        ${campagne.relais_salon}, ${motif})
		on conflict (campagne_slug, source, reference_id) do nothing`;
}

/**
 * Pose les réactions des mascottes sur un relais.
 *
 * Un échec ici n'est JAMAIS une erreur de relais : le message est déjà dans le
 * salon, et une émote supprimée du serveur ne doit pas faire compter la création
 * comme perdue.
 */
async function poserReactions(salon: string, messageId: string): Promise<void> {
	for (const emote of REACTIONS) {
		try {
			await appelDiscord<void>(
				`/channels/${salon}/messages/${messageId}/reactions/${encodeURIComponent(emote)}/@me`,
				{ method: "PUT" }
			);
		} catch (err) {
			console.warn(`${PREFIXE} Réaction « ${emote} » impossible :`, message(err));
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface en ligne de commande
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
	const argv = Bun.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(
			[
				"Relaie dans un salon Discord les créations d'une campagne (X + Discord).",
				"",
				"  bun packages/cron/src/tasks/campagnes-relais-discord.ts [options]",
				"",
				"  --campagne <slug>  ne traite que cette campagne",
				"  --limite <n>       créations relayées par passe (défaut : 12)",
				"  --dry              simulation : n'écrit ni dans Discord ni en base",
			].join("\n")
		);
		process.exit(0);
	}

	const valeur = (nom: string): string | undefined => {
		const i = argv.indexOf(nom);
		return i === -1 ? undefined : argv[i + 1];
	};
	const limiteBrute = Number(valeur("--limite"));

	const res = await relayerCampagnesDiscord({
		slug: valeur("--campagne"),
		limite: Number.isFinite(limiteBrute) && limiteBrute > 0 ? limiteBrute : undefined,
		dry: argv.includes("--dry"),
	});

	console.log(`\n${PREFIXE} ── Résumé ──`);
	for (const d of res.details) {
		console.log(
			`  ${d.slug.padEnd(20)} candidats=${d.candidats} relayees=${d.relayes} sautees=${d.sautes} echecs=${d.echecs} reportees=${d.reportes}`
		);
	}
	if (res.error) console.error(`  ERREUR : ${res.error}`);
	process.exit(res.success ? 0 : 1);
}
