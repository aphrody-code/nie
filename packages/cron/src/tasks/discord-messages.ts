/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Veille des salons Discord suivis.
 *
 * Deux chemins d'écriture, un seul mapping :
 *   1. Rattrapage REST (`runDiscordMessagesSync`) — idempotent, rejoue tout ce
 *      que la passerelle a pu manquer (redémarrage du démon, coupure réseau).
 *   2. Passerelle temps réel (`brancherVeilleMessagesTempsReel`) — écrit en base
 *      dès réception de l'événement ; le trigger Postgres `rg_realtime_notify()`
 *      se charge de la diffusion SSE vers le site.
 *
 * Les deux passent par `enregistrerMessage()`, qui consomme l'objet BRUT de
 * l'API Discord : la passerelle redemande donc le message brut plutôt que de
 * traduire une structure discord.js, pour qu'il n'existe qu'une seule définition
 * du mapping « message Discord -> ligne ».
 *
 * La liste des salons est lue en base (`discord_channels.suivi`), jamais codée
 * en dur ; `DISCORD_SALONS_SUIVIS` (identifiants séparés par des virgules) permet
 * d'en armer d'autres avant la synchro.
 *
 * ── ON SUIT AUSSI DES CATÉGORIES ENTIÈRES ───────────────────────────────────
 * Armer les salons UN PAR UN ne tient pas pour l'archive du serveur : la
 * catégorie « Archives » compte 29 salons (relevé le 13/8/2026 sur
 * `GET /guilds/{id}/channels`), dont trois seulement étaient suivis. Les
 * créations des campagnes passées y dorment — c'est la SEULE source qui existe
 * pour elles, aucune n'a transité par X (cf. `tasks/campagnes-discord.ts`) — et
 * chaque salon rouvert plus tard aurait demandé une intervention manuelle.
 * `CATEGORIES_SUIVIES` déclare donc des catégories dont TOUS les salons
 * textuels sont archivés ; l'appartenance est relue à chaque passe, donc un
 * salon déplacé dans l'archive est pris automatiquement à la passe suivante.
 *
 * ── ET ON NE REMONTE PAS 29 HISTORIQUES D'UN COUP ───────────────────────────
 * La veille tourne toutes les 5 minutes. Remonter l'historique complet de 26
 * nouveaux salons dans la même passe, c'est dépasser le délai maximal de la
 * tâche et se faire tuer en plein travail — pour recommencer de zéro cinq
 * minutes plus tard. `BACKFILLS_PAR_PASSE` borne le nombre d'historiques
 * REMONTÉS par passe ; les autres salons sont quand même rafraîchis et
 * rattrapés, ils prennent simplement leur tour.
 */

import type {
	Client,
	Message,
	MessageReaction,
	PartialMessage,
	PartialMessageReaction,
} from "discord.js";
import { sql } from "../lib/db.js";
import { DISCORD_TOKEN, GUILD_ID } from "../lib/discord.js";

const API_DISCORD = "https://discord.com/api/v10";
const PREFIXE = "[Cron Discord]";
/** Taille de page maximale acceptée par `GET /channels/{id}/messages`. */
const TAILLE_PAGE = 100;
/** Petite pause entre deux pages : politesse envers le quota Discord. */
const PAUSE_PAGE_MS = 150;
/** Fenêtre de regroupement des rafales de réactions sur un même message. */
const REGROUPEMENT_REACTIONS_MS = 1500;
/** Nombre maximal de pages remontées en une passe de rattrapage (garde-fou). */
const PAGES_MAX = 500;

/**
 * Catégories dont TOUS les salons textuels sont archivés.
 *
 * `1180594177063526441` = « Archives » du serveur Rose Griffon : 29 salons au
 * 13/8/2026, dont les salons de dépôt des campagnes passées (`⚡〡inazuma-rg`,
 * `⚡〡inazuma-rg2`, `⚡〡inatober-rg`) et tous les événements terminés
 * (`⚡〡souvenirs-d-été`, `🎉〡concours`, `🏟〡route-du-sacre`…).
 *
 * `DISCORD_CATEGORIES_SUIVIES` AJOUTE à cette liste (elle ne la remplace pas) :
 * une catégorie retirée d'ici doit l'être en connaissance de cause, pas par
 * l'oubli d'une variable d'environnement sur un serveur.
 */
export const CATEGORIES_SUIVIES = ["1180594177063526441"] as const;

/**
 * Types de salons Discord dont les messages sont archivables.
 *
 * 0 = textuel, 5 = annonces, 15 = forum. Sont écartés : le vocal (2) et le
 * stage (13), qui n'ont pas d'historique de messages exploitable ici, et les
 * fils (11/12), qui ne figurent pas dans `GET /guilds/{id}/channels`.
 */
const TYPES_ARCHIVABLES = new Set([0, 5, 15]);

/**
 * Historiques complets remontés par passe.
 *
 * Deux salons d'archive suffisent à occuper une passe de cinq minutes sans
 * risquer le délai maximal de la tâche ; les 26 salons armés d'un coup se
 * remplissent donc en une heure et demie de passes ordinaires, sans qu'aucune
 * ne soit tuée en cours de route.
 */
const BACKFILLS_PAR_PASSE = Math.max(
	1,
	Number.parseInt(Bun.env.DISCORD_BACKFILLS_PAR_PASSE ?? "2", 10) || 2
);

// ─── FORMES BRUTES DE L'API DISCORD ──────────────────────────────────────────

interface AuteurBrut {
	id: string;
	username: string;
	global_name?: string | null;
	discriminator?: string | null;
	avatar?: string | null;
	bot?: boolean;
}

interface MessageBrut {
	id: string;
	channel_id?: string;
	guild_id?: string;
	author: AuteurBrut;
	type?: number;
	content?: string;
	attachments?: unknown[];
	embeds?: unknown[];
	sticker_items?: unknown[];
	reactions?: unknown[];
	poll?: unknown;
	mentions?: Array<{ id: string }>;
	mention_roles?: string[];
	mention_everyone?: boolean;
	message_reference?: { message_id?: string | null } | null;
	referenced_message?: { id: string } | null;
	pinned?: boolean;
	timestamp: string;
	edited_timestamp?: string | null;
}

interface SalonBrut {
	id: string;
	guild_id?: string;
	name?: string;
	type?: number;
	topic?: string | null;
	parent_id?: string | null;
	position?: number | null;
	icon_emoji?: { id: string | null; name: string | null } | null;
}

interface SalonSuivi {
	channel_id: string;
	guild_id: string;
	backfill_complete: boolean;
	last_message_id: string | null;
	name: string;
}

export interface StatsSalonVeille {
	channel_id: string;
	name: string;
	inseres: number;
	mis_a_jour: number;
	total: number;
	backfill_complete: boolean;
	error?: string;
}

export interface StatsVeille {
	salons: StatsSalonVeille[];
	inseres: number;
	mis_a_jour: number;
	/** Historiques non remontés dans cette passe, faute de budget. */
	backfills_differes?: number;
	durationMs: number;
}

// ─── APPELS REST DISCORD ─────────────────────────────────────────────────────

/**
 * Appel REST Discord avec le jeton du bot.
 *
 * On passe par `fetch` natif plutôt que par le client discord.js (qui gérerait
 * déjà les 429 via sa file d'attente) pour une raison précise : le rattrapage
 * doit continuer à fonctionner quand la passerelle est dégradée — intents
 * refusés, client non connecté, exécution en ligne de commande. Le 429 est donc
 * traité ici à la main, en respectant le `retry_after` renvoyé par Discord.
 */
async function appelDiscord<T>(chemin: string, tentative = 0): Promise<T> {
	if (!DISCORD_TOKEN) {
		throw new Error("DISCORD_BOT_TOKEN absent : la veille des salons est impossible.");
	}

	const reponse = await fetch(`${API_DISCORD}${chemin}`, {
		headers: {
			Authorization: `Bot ${DISCORD_TOKEN}`,
			"User-Agent": "RoseGriffonCron (https://rosegriffon.fr, 1.0)",
		},
	});

	if (reponse.status === 429) {
		if (tentative >= 5) {
			throw new Error(`Limite de débit Discord persistante sur ${chemin}.`);
		}
		const corps = (await reponse.json().catch(() => ({}))) as { retry_after?: number };
		const attente = Math.ceil((corps.retry_after ?? 1) * 1000) + 250;
		console.warn(`${PREFIXE} Limite de débit sur ${chemin} : attente de ${attente} ms.`);
		await Bun.sleep(attente);
		return appelDiscord<T>(chemin, tentative + 1);
	}

	if (reponse.status >= 500 && tentative < 3) {
		await Bun.sleep(1000 * (tentative + 1));
		return appelDiscord<T>(chemin, tentative + 1);
	}

	if (!reponse.ok) {
		const texte = await reponse.text().catch(() => "");
		throw new Error(`Discord a répondu ${reponse.status} sur ${chemin} : ${texte.slice(0, 200)}`);
	}

	return (await reponse.json()) as T;
}

// ─── MAPPING MESSAGE DISCORD -> LIGNE ────────────────────────────────────────

/** URL CDN complète de l'avatar de l'auteur (avatar par défaut si aucun). */
function urlAvatarDiscord(auteur: AuteurBrut): string {
	if (auteur.avatar) {
		const extension = auteur.avatar.startsWith("a_") ? "gif" : "webp";
		return `https://cdn.discordapp.com/avatars/${auteur.id}/${auteur.avatar}.${extension}?size=256`;
	}
	// Avatar par défaut : depuis la fin des discriminateurs, l'index se déduit de
	// l'identifiant lui-même ; les comptes hérités gardent `discriminant % 5`.
	const herite = Boolean(auteur.discriminator) && auteur.discriminator !== "0";
	const index = herite
		? Number(auteur.discriminator) % 5
		: Number((BigInt(auteur.id) >> 22n) % 6n);
	return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Écrit (ou met à jour) un message en base — SEULE définition du mapping.
 *
 * Note sur les colonnes `jsonb` : Bun.SQL sérialise directement un objet ou un
 * tableau JS en JSON pour une colonne `jsonb`. Il ne faut SURTOUT PAS passer par
 * `JSON.stringify(...)::jsonb` : le paramètre est déjà annoncé comme JSON, et le
 * transtypage produirait alors une *chaîne* JSON doublement encodée
 * (`"[{\"id\":…}]"` au lieu de `[{"id":…}]`). Vérifié sur la base réelle.
 *
 * La clause `WHERE` du `DO UPDATE` évite de réécrire une ligne identique : sans
 * elle, la passe de rafraîchissement de tête déclencherait 100 notifications
 * temps réel inutiles toutes les 5 minutes.
 */
async function enregistrerMessage(
	brut: MessageBrut,
	salonId: string,
	guildId: string
): Promise<"insere" | "mis_a_jour" | "inchange"> {
	const mentions = {
		users: (brut.mentions ?? []).map((u) => u.id),
		roles: brut.mention_roles ?? [],
		everyone: brut.mention_everyone ?? false,
	};

	const lignes = await sql<Array<{ insere: boolean }>>`
		INSERT INTO discord_messages (
			message_id, channel_id, guild_id,
			author_id, author_username, author_display_name, author_avatar_url, author_is_bot,
			type, content, attachments, embeds, stickers, reactions, poll, mentions,
			reference_message_id, pinned, created_at, edited_at, synced_at
		) VALUES (
			${brut.id}, ${brut.channel_id ?? salonId}, ${brut.guild_id ?? guildId},
			${brut.author.id}, ${brut.author.username}, ${brut.author.global_name ?? null},
			${urlAvatarDiscord(brut.author)}, ${brut.author.bot ?? false},
			${brut.type ?? 0}, ${brut.content ?? ""},
			${brut.attachments ?? []}, ${brut.embeds ?? []}, ${brut.sticker_items ?? []},
			${brut.reactions ?? []}, ${brut.poll ?? null}, ${mentions},
			${brut.message_reference?.message_id ?? brut.referenced_message?.id ?? null},
			${brut.pinned ?? false}, ${brut.timestamp}, ${brut.edited_timestamp ?? null}, now()
		)
		ON CONFLICT (message_id) DO UPDATE SET
			author_username = EXCLUDED.author_username,
			author_display_name = EXCLUDED.author_display_name,
			author_avatar_url = EXCLUDED.author_avatar_url,
			type = EXCLUDED.type,
			content = EXCLUDED.content,
			attachments = EXCLUDED.attachments,
			embeds = EXCLUDED.embeds,
			stickers = EXCLUDED.stickers,
			reactions = EXCLUDED.reactions,
			poll = EXCLUDED.poll,
			mentions = EXCLUDED.mentions,
			reference_message_id = EXCLUDED.reference_message_id,
			pinned = EXCLUDED.pinned,
			edited_at = EXCLUDED.edited_at,
			-- Un message que Discord nous rend encore n'est pas supprimé : on
			-- répare une suppression marquée à tort plutôt que de la figer.
			deleted_at = NULL,
			synced_at = now()
		WHERE discord_messages.content IS DISTINCT FROM EXCLUDED.content
		   OR discord_messages.embeds IS DISTINCT FROM EXCLUDED.embeds
		   OR discord_messages.attachments IS DISTINCT FROM EXCLUDED.attachments
		   OR discord_messages.stickers IS DISTINCT FROM EXCLUDED.stickers
		   OR discord_messages.reactions IS DISTINCT FROM EXCLUDED.reactions
		   OR discord_messages.poll IS DISTINCT FROM EXCLUDED.poll
		   OR discord_messages.mentions IS DISTINCT FROM EXCLUDED.mentions
		   OR discord_messages.pinned IS DISTINCT FROM EXCLUDED.pinned
		   OR discord_messages.edited_at IS DISTINCT FROM EXCLUDED.edited_at
		   OR discord_messages.author_username IS DISTINCT FROM EXCLUDED.author_username
		   OR discord_messages.author_display_name IS DISTINCT FROM EXCLUDED.author_display_name
		   OR discord_messages.author_avatar_url IS DISTINCT FROM EXCLUDED.author_avatar_url
		   OR discord_messages.deleted_at IS NOT NULL
		RETURNING (xmax = 0) AS insere
	`;

	const ligne = lignes[0];
	if (!ligne) return "inchange";
	return ligne.insere ? "insere" : "mis_a_jour";
}

// ─── SALONS SOUS VEILLE ──────────────────────────────────────────────────────

/** Salons actuellement sous veille — rafraîchi à chaque synchro. */
const salonsSuivis = new Set<string>();

/** Indique si un salon fait partie de la veille (utilisé par la passerelle). */
export function estSalonSuivi(channelId: string | null | undefined): boolean {
	return Boolean(channelId) && salonsSuivis.has(channelId as string);
}

/**
 * `DISCORD_SALONS_SUIVIS` arme des salons en base avant la synchro : la variable
 * ne remplace pas la liste lue en base, elle y ajoute (et force `suivi = true`).
 */
async function armerSalonsDepuisEnv(): Promise<void> {
	const brut = Bun.env.DISCORD_SALONS_SUIVIS;
	if (!brut) return;

	const identifiants = brut
		.split(",")
		.map((valeur) => valeur.trim())
		.filter(Boolean);
	if (identifiants.length === 0) return;

	if (!GUILD_ID) {
		console.warn(`${PREFIXE} DISCORD_SALONS_SUIVIS ignoré : DISCORD_GUILD_ID n'est pas configuré.`);
		return;
	}

	for (const identifiant of identifiants) {
		// `name` est NOT NULL : on pose l'identifiant en attendant que le
		// rafraîchissement du salon écrive le vrai nom juste après.
		await sql`
			INSERT INTO discord_channels (channel_id, guild_id, name, suivi)
			VALUES (${identifiant}, ${GUILD_ID}, ${identifiant}, true)
			ON CONFLICT (channel_id) DO UPDATE SET suivi = true, updated_at = now()
		`;
	}
	console.info(`${PREFIXE} ${identifiants.length} salon(s) armé(s) via DISCORD_SALONS_SUIVIS.`);
}

/**
 * Arme les salons de DÉPÔT déclarés par les campagnes (`x_campagnes.salons_depot`).
 *
 * ── POURQUOI C'EST ICI ET PAS DANS UNE VARIABLE D'ENVIRONNEMENT ────────────
 * `tasks/campagnes-discord.ts` rattache une création à une campagne quand elle
 * a été déposée dans l'un de ses salons — mais il ne lit PAS Discord : il lit
 * `discord_messages`, que remplit cette veille. Déclarer un salon de dépôt sans
 * le mettre sous veille, c'est donc une campagne qui restera vide pour
 * toujours, sans qu'aucune des deux tâches ne signale d'erreur (la récolte
 * compte simplement le salon parmi ses « salons inaccessibles »).
 *
 * En armant ici ce que la campagne déclare, ouvrir une campagne devient UN seul
 * geste : poser le salon dans `x_campagnes.salons_depot`. La chaîne
 * veille → récolte → page se branche toute seule.
 */
export async function armerSalonsDeDepot(): Promise<string[]> {
	if (!GUILD_ID) return [];

	const lignes = await sql<Array<{ salon: string; nouveau: boolean }>>`
		WITH declares AS (
			SELECT DISTINCT unnest(salons_depot) AS salon
			  FROM x_campagnes
			 WHERE salons_depot IS NOT NULL
		)
		INSERT INTO discord_channels (channel_id, guild_id, name, suivi)
		SELECT salon, ${GUILD_ID}, salon, true FROM declares
		ON CONFLICT (channel_id) DO UPDATE SET suivi = true, updated_at = now()
		RETURNING channel_id AS salon, (xmax = 0) AS nouveau
	`;
	const nouveaux = lignes.filter((ligne) => ligne.nouveau).map((ligne) => ligne.salon);
	if (nouveaux.length > 0) {
		console.info(
			`${PREFIXE} ${nouveaux.length} salon(s) de dépôt de campagne armé(s) : ${nouveaux.join(", ")}`
		);
	}
	return nouveaux;
}

/** Catégories à suivre : le registre du code, plus celles de l'environnement. */
export function categoriesSuivies(
	env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): string[] {
	const supplement = (env.DISCORD_CATEGORIES_SUIVIES ?? "")
		.split(",")
		.map((valeur) => valeur.trim())
		.filter((valeur) => /^\d{15,25}$/.test(valeur));
	return [...new Set([...CATEGORIES_SUIVIES, ...supplement])];
}

/**
 * Un salon de catégorie suivie est-il archivable ?
 *
 * Fonction PURE, testée seule : c'est elle qui décide ce qui entre dans
 * `discord_messages`, et se tromper de type revient soit à manquer une archive,
 * soit à demander l'historique d'un salon vocal (404 à chaque passe, toutes les
 * cinq minutes).
 */
export function estSalonArchivable(
	salon: { type?: number | null; parent_id?: string | null },
	categories: readonly string[]
): boolean {
	if (typeof salon.type !== "number" || !TYPES_ARCHIVABLES.has(salon.type)) {
		return false;
	}
	return Boolean(salon.parent_id) && categories.includes(salon.parent_id as string);
}

/**
 * Arme tous les salons textuels des catégories suivies.
 *
 * L'appartenance est relue à CHAQUE passe : un salon déplacé dans l'archive
 * entre en veille tout seul. L'inverse n'est pas vrai — un salon sorti de
 * l'archive garde `suivi = true`, parce que ses messages sont déjà archivés et
 * que cesser de les rattraper les figerait à moitié à jour.
 */
export async function armerSalonsDeCategories(): Promise<{
	examines: number;
	armes: string[];
	deja: number;
}> {
	const categories = categoriesSuivies();
	if (categories.length === 0 || !GUILD_ID) {
		return { examines: 0, armes: [], deja: 0 };
	}

	const salons = await appelDiscord<SalonBrut[]>(`/guilds/${GUILD_ID}/channels`);
	const candidats = salons.filter((salon) => estSalonArchivable(salon, categories));
	const armes: string[] = [];
	let deja = 0;

	for (const salon of candidats) {
		// `suivi` n'est jamais remis à `false` ici : cette requête ARME, elle ne
		// désarme pas. Le nom, le type et la position sont écrits au passage, ce
		// qui évite une ligne portant l'identifiant en guise de nom jusqu'au
		// premier rafraîchissement.
		const [ligne] = await sql<Array<{ nouveau: boolean }>>`
			INSERT INTO discord_channels (channel_id, guild_id, name, type, parent_id, position, suivi)
			VALUES (
				${salon.id},
				${salon.guild_id ?? GUILD_ID},
				${salon.name ?? salon.id},
				${salon.type ?? 0},
				${salon.parent_id ?? null},
				${salon.position ?? null},
				true
			)
			ON CONFLICT (channel_id) DO UPDATE SET
				name = EXCLUDED.name,
				type = EXCLUDED.type,
				parent_id = EXCLUDED.parent_id,
				position = EXCLUDED.position,
				suivi = true,
				updated_at = now()
			RETURNING (xmax = 0) AS nouveau, discord_channels.suivi
		`;
		if (ligne?.nouveau) {
			armes.push(salon.name ?? salon.id);
		} else {
			deja += 1;
		}
	}

	if (armes.length > 0) {
		console.info(
			`${PREFIXE} ${armes.length} salon(s) d'archive armé(s) : ${armes.slice(0, 10).join(", ")}${armes.length > 10 ? "…" : ""}`
		);
	}
	return { examines: candidats.length, armes, deja };
}

/** Lit la liste des salons suivis en base et met à jour l'ensemble en mémoire. */
async function chargerSalonsSuivis(): Promise<SalonSuivi[]> {
	const salons = await sql<SalonSuivi[]>`
		SELECT channel_id, guild_id, name, backfill_complete, last_message_id
		  FROM discord_channels
		 WHERE suivi
		 ORDER BY position NULLS LAST, channel_id
	`;
	salonsSuivis.clear();
	for (const salon of salons) salonsSuivis.add(salon.channel_id);
	return salons;
}

/** Réécrit les métadonnées du salon depuis `GET /channels/{id}`. */
async function rafraichirSalon(salon: SalonSuivi): Promise<void> {
	const brut = await appelDiscord<SalonBrut>(`/channels/${salon.channel_id}`);
	await sql`
		UPDATE discord_channels SET
			guild_id = ${brut.guild_id ?? salon.guild_id},
			name = ${brut.name ?? salon.name},
			type = ${brut.type ?? 0},
			topic = ${brut.topic ?? null},
			parent_id = ${brut.parent_id ?? null},
			position = ${brut.position ?? null},
			icon_emoji = COALESCE(${brut.icon_emoji?.name ?? null}, discord_channels.icon_emoji),
			updated_at = now()
		WHERE channel_id = ${salon.channel_id}
	`;
}

// ─── RATTRAPAGE REST ─────────────────────────────────────────────────────────

interface Compteurs {
	inseres: number;
	mis_a_jour: number;
}

/** Enregistre un lot de messages bruts et met à jour les compteurs. */
async function enregistrerLot(
	lot: MessageBrut[],
	salon: SalonSuivi,
	compteurs: Compteurs
): Promise<void> {
	for (const brut of lot) {
		const resultat = await enregistrerMessage(brut, salon.channel_id, salon.guild_id);
		if (resultat === "insere") compteurs.inseres++;
		else if (resultat === "mis_a_jour") compteurs.mis_a_jour++;
	}
}

/** Trie un lot du plus ancien au plus récent (les snowflakes sont numériques). */
function trierParAnciennete(lot: MessageBrut[]): MessageBrut[] {
	return [...lot].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

/** Remonte tout l'historique du salon en paginant vers le passé (`before=`). */
async function remonterHistorique(salon: SalonSuivi, compteurs: Compteurs): Promise<number> {
	let curseur: string | null = null;
	let pages = 0;
	let total = 0;

	while (pages < PAGES_MAX) {
		const requete: string = `/channels/${salon.channel_id}/messages?limit=${TAILLE_PAGE}${curseur ? `&before=${curseur}` : ""}`;
		const lot: MessageBrut[] = await appelDiscord<MessageBrut[]>(requete);
		if (lot.length === 0) break;

		await enregistrerLot(lot, salon, compteurs);
		total += lot.length;
		pages++;

		// Discord renvoie du plus récent au plus ancien : le curseur suivant est le
		// plus ancien du lot, calculé explicitement plutôt que déduit de l'ordre.
		curseur = trierParAnciennete(lot)[0]!.id;
		if (lot.length < TAILLE_PAGE) break;
		await Bun.sleep(PAUSE_PAGE_MS);
	}

	return total;
}

/** Rattrape les messages postés depuis `last_message_id` (`after=`). */
async function rattraperDepuis(
	salon: SalonSuivi,
	depuis: string,
	compteurs: Compteurs
): Promise<number> {
	let curseur = depuis;
	let pages = 0;
	let total = 0;

	while (pages < PAGES_MAX) {
		const lot = await appelDiscord<MessageBrut[]>(
			`/channels/${salon.channel_id}/messages?limit=${TAILLE_PAGE}&after=${curseur}`
		);
		if (lot.length === 0) break;

		// Même avec `after`, Discord renvoie du plus récent au plus ancien : sans
		// tri explicite le curseur reculerait au lieu d'avancer.
		const tries = trierParAnciennete(lot);
		await enregistrerLot(tries, salon, compteurs);
		total += tries.length;
		pages++;

		curseur = tries[tries.length - 1]!.id;
		if (lot.length < TAILLE_PAGE) break;
		await Bun.sleep(PAUSE_PAGE_MS);
	}

	return total;
}

/** Recale les compteurs du salon sur l'état réel de la base. */
async function recalerSalon(salon: SalonSuivi, backfillComplet: boolean): Promise<number> {
	const [ligne] = await sql<Array<{ message_count: number }>>`
		UPDATE discord_channels c SET
			last_message_id = (
				SELECT m.message_id FROM discord_messages m
				 WHERE m.channel_id = c.channel_id
				 ORDER BY m.created_at DESC LIMIT 1
			),
			-- Compte les messages visibles : c'est le nombre affiché par le site,
			-- les messages supprimés restant archivés mais masqués par la RLS.
			message_count = (
				SELECT count(*) FROM discord_messages m
				 WHERE m.channel_id = c.channel_id AND m.deleted_at IS NULL
			),
			backfill_complete = ${backfillComplet},
			synced_at = now(),
			updated_at = now()
		WHERE c.channel_id = ${salon.channel_id}
		RETURNING message_count
	`;
	return ligne?.message_count ?? 0;
}

/**
 * Rattrapage REST complet et idempotent de tous les salons suivis.
 * Séquentiel salon par salon pour rester très en dessous du quota Discord.
 */
export async function runDiscordMessagesSync(): Promise<{
	success: boolean;
	error?: string;
	stats?: StatsVeille;
}> {
	const debut = Date.now();
	console.info(`${PREFIXE} Démarrage de la veille des salons suivis...`);

	try {
		await armerSalonsDepuisEnv();
		// Les catégories entières AVANT la lecture de la liste : un salon d'archive
		// ajouté depuis la dernière passe entre en veille dès celle-ci.
		try {
			await armerSalonsDeCategories();
			await armerSalonsDeDepot();
		} catch (err) {
			// L'armement est un CONFORT (il ajoute des salons) ; la veille des
			// salons déjà suivis, elle, est la mission. Une panne Discord sur
			// `GET /guilds/{id}/channels` ne doit pas la faire échouer.
			console.warn(
				`${PREFIXE} Armement des catégories impossible :`,
				err instanceof Error ? err.message : err
			);
		}
		const salons = await chargerSalonsSuivis();

		if (salons.length === 0) {
			console.warn(`${PREFIXE} Aucun salon suivi (discord_channels.suivi) : rien à archiver.`);
			return {
				success: true,
				stats: { salons: [], inseres: 0, mis_a_jour: 0, durationMs: Date.now() - debut },
			};
		}

		const rapport: StatsSalonVeille[] = [];
		let inseresTotal = 0;
		let majTotal = 0;
		/**
		 * Historiques restant à remonter dans CETTE passe.
		 *
		 * Sans ce budget, armer une catégorie de 29 salons demandait 26 remontées
		 * d'historique dans la même passe : la tâche dépassait son délai maximal,
		 * se faisait tuer, et repartait de zéro cinq minutes plus tard — donc
		 * jamais aucun salon d'archive complet. Les salons non retenus sont quand
		 * même rafraîchis et rattrapés ; ils prennent leur tour à la passe
		 * suivante.
		 */
		let budgetBackfill = BACKFILLS_PAR_PASSE;
		let backfillsDifferes = 0;

		for (const salon of salons) {
			const compteurs: Compteurs = { inseres: 0, mis_a_jour: 0 };
			let backfillComplet = salon.backfill_complete;

			try {
				// a. Métadonnées du salon.
				await rafraichirSalon(salon);

				// b/c. Historique complet, puis rattrapage incrémental.
				if (!salon.backfill_complete && budgetBackfill <= 0) {
					backfillsDifferes += 1;
				} else if (!salon.backfill_complete) {
					budgetBackfill -= 1;
					const lus = await remonterHistorique(salon, compteurs);
					backfillComplet = true;
					console.info(`${PREFIXE} ${salon.name} : historique remonté (${lus} messages lus).`);
				} else if (salon.last_message_id) {
					const lus = await rattraperDepuis(salon, salon.last_message_id, compteurs);
					if (lus > 0) console.info(`${PREFIXE} ${salon.name} : ${lus} nouveau(x) message(s).`);
				}

				// d. Passe de tête : réactions et éditions des derniers messages déjà
				// archivés. Sans elle, un compteur de réactions ne bougerait jamais
				// entre deux messages postés.
				const tete = await appelDiscord<MessageBrut[]>(
					`/channels/${salon.channel_id}/messages?limit=${TAILLE_PAGE}`
				);
				await enregistrerLot(tete, salon, compteurs);

				// e. Curseur, compteur réel et horodatage.
				const total = await recalerSalon(salon, backfillComplet);

				inseresTotal += compteurs.inseres;
				majTotal += compteurs.mis_a_jour;
				rapport.push({
					channel_id: salon.channel_id,
					name: salon.name,
					inseres: compteurs.inseres,
					mis_a_jour: compteurs.mis_a_jour,
					total,
					backfill_complete: backfillComplet,
				});
				console.info(
					`${PREFIXE} ${salon.name} : ${compteurs.inseres} inséré(s), ${compteurs.mis_a_jour} mis à jour, ${total} archivé(s).`
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`${PREFIXE} Échec sur le salon ${salon.name} (${salon.channel_id}) :`, message);
				rapport.push({
					channel_id: salon.channel_id,
					name: salon.name,
					inseres: compteurs.inseres,
					mis_a_jour: compteurs.mis_a_jour,
					total: 0,
					backfill_complete: salon.backfill_complete,
					error: message,
				});
			}
		}

		if (backfillsDifferes > 0) {
			console.info(
				`${PREFIXE} ${backfillsDifferes} historique(s) reporté(s) à la prochaine passe (budget : ${BACKFILLS_PAR_PASSE}).`
			);
		}

		const stats: StatsVeille = {
			salons: rapport,
			inseres: inseresTotal,
			mis_a_jour: majTotal,
			backfills_differes: backfillsDifferes,
			durationMs: Date.now() - debut,
		};

		const echecs = rapport.filter((r) => r.error);
		if (echecs.length === rapport.length) {
			return { success: false, error: echecs[0]?.error ?? "Tous les salons ont échoué.", stats };
		}
		return { success: true, stats };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`${PREFIXE} Erreur critique de la veille des salons :`, err);
		return { success: false, error: message };
	}
}

/**
 * Force la reprise intégrale de l'historique des salons suivis.
 * Idempotent lui aussi : les messages déjà archivés ne sont pas réécrits.
 */
export async function runDiscordMessagesBackfill(): Promise<{
	success: boolean;
	error?: string;
	stats?: StatsVeille;
}> {
	console.info(`${PREFIXE} Réinitialisation du curseur d'historique des salons suivis...`);
	await armerSalonsDepuisEnv();
	await sql`UPDATE discord_channels SET backfill_complete = false, updated_at = now() WHERE suivi`;
	return runDiscordMessagesSync();
}

// ─── VEILLE TEMPS RÉEL (PASSERELLE) ──────────────────────────────────────────

/** Rafales de réactions regroupées par message pour éviter un appel par clic. */
const rafraichissementsEnAttente = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Identifiant du salon d'un message d'événement. Un événement peut arriver
 * « partiel » (message absent du cache) : `channelId` reste renseigné, mais on
 * complète par un `.fetch()` dans le cas contraire.
 */
async function resoudreSalon(message: Message | PartialMessage): Promise<string | null> {
	if (message.channelId) return message.channelId;
	if (message.partial) {
		const complet = await message.fetch().catch(() => null);
		return complet?.channelId ?? null;
	}
	return null;
}

/** Redemande le message brut à l'API et l'écrit en base (mapping unique). */
async function archiverDepuisApi(salonId: string, messageId: string): Promise<void> {
	const brut = await appelDiscord<MessageBrut>(`/channels/${salonId}/messages/${messageId}`);
	await enregistrerMessage(brut, salonId, brut.guild_id ?? GUILD_ID ?? "");
}

/** Programme un réarchivage regroupé (rafales de réactions sur un même message). */
function programmerRafraichissement(salonId: string, messageId: string): void {
	const enCours = rafraichissementsEnAttente.get(messageId);
	if (enCours) clearTimeout(enCours);
	rafraichissementsEnAttente.set(
		messageId,
		setTimeout(() => {
			rafraichissementsEnAttente.delete(messageId);
			archiverDepuisApi(salonId, messageId).catch((err) =>
				console.error(`${PREFIXE} Réarchivage du message ${messageId} impossible :`, err)
			);
		}, REGROUPEMENT_REACTIONS_MS)
	);
}

/**
 * Marque des messages comme supprimés (suppression logique, jamais un DELETE).
 *
 * La liste passe par `jsonb_array_elements_text` et non par `= ANY($1::text[])` :
 * Bun.SQL sérialise un tableau JS en JSON, pas en littéral de tableau Postgres —
 * `ANY` échoue alors sur « malformed array literal ». Vérifié sur la base réelle.
 */
async function marquerSupprimes(identifiants: string[]): Promise<void> {
	if (identifiants.length === 0) return;
	await sql`
		UPDATE discord_messages
		   SET deleted_at = now(), synced_at = now()
		 WHERE message_id IN (SELECT jsonb_array_elements_text(${identifiants}))
		   AND deleted_at IS NULL
	`;
}

/**
 * Branche les écouteurs de la passerelle sur les salons suivis.
 *
 * C'est ce qui rend la page « temps réel » : l'écriture en base est immédiate,
 * le trigger Postgres `rg_realtime_notify()` publie ensuite sur le canal
 * `rg_realtime`, que `rg-realtime` (:8812) rediffuse en SSE.
 *
 * L'ensemble des salons suivis est celui rempli par la dernière synchro ; tant
 * qu'aucune synchro n'a tourné, aucun événement n'est retenu (le filet de
 * sécurité toutes les 5 minutes rattrape ce court intervalle de démarrage).
 */
export function brancherVeilleMessagesTempsReel(client: Client): void {
	client.on("messageCreate", async (message) => {
		if (!estSalonSuivi(message.channelId)) return;
		try {
			await archiverDepuisApi(message.channelId, message.id);
		} catch (err) {
			console.error(`${PREFIXE} Archivage du nouveau message ${message.id} impossible :`, err);
		}
	});

	client.on("messageUpdate", async (_ancien, nouveau) => {
		const salonId = await resoudreSalon(nouveau);
		if (!estSalonSuivi(salonId)) return;
		try {
			await archiverDepuisApi(salonId!, nouveau.id);
		} catch (err) {
			console.error(`${PREFIXE} Mise à jour du message ${nouveau.id} impossible :`, err);
		}
	});

	client.on("messageDelete", async (message) => {
		const salonId = await resoudreSalon(message);
		if (!estSalonSuivi(salonId)) return;
		await marquerSupprimes([message.id]).catch((err) =>
			console.error(`${PREFIXE} Marquage de suppression impossible :`, err)
		);
	});

	client.on("messageDeleteBulk", async (messages) => {
		const identifiants: string[] = [];
		for (const message of messages.values()) {
			const salonId = await resoudreSalon(message);
			if (estSalonSuivi(salonId)) identifiants.push(message.id);
		}
		await marquerSupprimes(identifiants).catch((err) =>
			console.error(`${PREFIXE} Marquage de suppression en masse impossible :`, err)
		);
	});

	// Les trois événements de réaction n'apportent pas le décompte consolidé :
	// on redemande le message complet, dont le champ `reactions` fait foi.
	const surReaction = async (reaction: MessageReaction | PartialMessageReaction) => {
		try {
			// Une réaction sur un message hors cache arrive « partielle » : il faut la
			// compléter avant de lire le message auquel elle se rapporte.
			const complete = reaction.partial ? await reaction.fetch() : reaction;
			const salonId = await resoudreSalon(complete.message);
			if (!estSalonSuivi(salonId)) return;
			programmerRafraichissement(salonId!, complete.message.id);
		} catch (err) {
			console.error(`${PREFIXE} Traitement d'une réaction impossible :`, err);
		}
	};

	client.on("messageReactionAdd", (reaction) => void surReaction(reaction));
	client.on("messageReactionRemove", (reaction) => void surReaction(reaction));
	client.on("messageReactionRemoveAll", async (message) => {
		const salonId = await resoudreSalon(message);
		if (!estSalonSuivi(salonId)) return;
		programmerRafraichissement(salonId!, message.id);
	});

	console.info(`${PREFIXE} Veille temps réel des salons suivis branchée sur la passerelle.`);
}
