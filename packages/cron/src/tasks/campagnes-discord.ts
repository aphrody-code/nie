/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Récolte des CRÉATIONS DISCORD d'une campagne, vers
 * `public.campagne_creations_discord`.
 *
 * POURQUOI CETTE TÂCHE EXISTE
 * `hashtag-harvest.ts` récolte les campagnes sur X. Mesuré le 12/8/2026 : aucune
 * des 12 998 lignes de `public.tweets` ne porte `#inazumarg`, `#inatoberrg*` ni
 * `#iergday`. Les cinq campagnes archivées de /iergday ont donc une galerie
 * structurellement vide — leurs créations n'ont jamais transité par X. Elles ont
 * été déposées dans des salons Discord dédiés. C'est la seule source qui existe,
 * et c'est celle-ci que cette tâche lit.
 *
 * ELLE N'INTERROGE PAS X, ET PRESQUE PAS DISCORD
 * La source est `public.discord_messages`, déjà rempli par la veille
 * (`discord-messages.ts`). Cette tâche fait une passe SQL sur les salons suivis,
 * puis n'appelle Discord que pour TÉLÉCHARGER les images qu'elle doit
 * ré-héberger — c'est-à-dire une fois par image, jamais deux (cf. idempotence).
 *
 * DEUX CHEMINS DE RATTACHEMENT, ET IL FAUT LES DEUX
 *  1. Le HASHTAG écrit dans le message (comparaison en minuscules, sur
 *     `hashtags` ∪ `hashtags_rattrapage`, exactement comme sur X). Sans
 *     ambiguïté, donc NON borné dans le temps.
 *  2. L'APPARTENANCE au salon de dépôt (`x_campagnes.salons_depot`) — le cas
 *     majoritaire : personne n'écrit le hashtag dans le salon qui lui est déjà
 *     consacré. Ce chemin-là EST borné par la fenêtre `debut_le`/`fin_le`,
 *     parce que `1153955426191278132` (⚡〡inatober-rg) a servi aux Inatober
 *     2023, 2024 ET 2025 : sans borne, une création de 2023 serait attribuée
 *     aux trois éditions à la fois.
 *
 * CE QUI COMPTE COMME CRÉATION : TOUT MÉDIA AFFICHABLE, PAS SEULEMENT UNE IMAGE
 * L'annonce d'IERG Day dit « liberté créative totale ». Le filtre « images
 * seulement » a pourtant écarté en silence, le 22/8/2026, la vidéo `.mov` de
 * karuminasan — postée DANS LES DÉLAIS et seule participation de son auteur,
 * donc un participant entier disparu du tirage sans qu'aucune ligne de journal
 * ne le dise. Les pièces jointes VIDÉO sont désormais récoltées et comptées.
 * Un `.pdf`, un `.psd` ou une archive restent écartés : la galerie ne saurait
 * pas les rendre, et annoncer une création qu'on ne peut pas montrer est pire
 * que de ne pas la compter.
 *
 * LE DÉLAI DE GRÂCE DU SALON DE DÉPÔT N'EST PAS UN REPORT DE LA CLÔTURE
 * Le même règlement dit « vous pouvez également le poster APRÈS dans le salon ».
 * Le chemin « salon de dépôt » accepte donc les dépôts jusqu'à
 * `DELAI_GRACE_DEPOT_MS` après `fin_le`, bornés en plus par l'ouverture de la
 * campagne suivante qui déclare le MÊME salon (⚡〡inatober-rg a servi à trois
 * éditions : sans cette borne, un dépôt tardif de 2023 deviendrait une création
 * de 2024). Cela ne donne AUCUN ticket de tirage : le roster écarte lui-même
 * toute création postée après `fin_le`, avec le motif « publiée après la clôture
 * de la campagne » (`apps/website/src/lib/x-campagnes/tirage-queries.ts`,
 * `SQL_CREATIONS`). La fresque les montre, le tirage ne les compte pas.
 *
 * TROIS GARANTIES STRUCTURANTES (les mêmes que la récolte X)
 *  1. Idempotence : rejouer ne crée aucun doublon (upsert par clé) et ne
 *     retélécharge aucune image déjà ré-hébergée (le chemin est relu en base).
 *  2. Modération préservée : la clause `do update` ne mentionne NI `masque`, NI
 *     `motif_masquage`, NI `mis_en_avant`. Une création retirée du site le reste
 *     à travers toutes les récoltes suivantes. Y ajouter `masque =
 *     excluded.masque` serait un défaut de sécurité.
 *  3. Aucune donnée inventée : ce qui n'a pas été mesuré n'est pas écrit. Les
 *     salons de dépôt sont aujourd'hui INACCESSIBLES au bot (« Missing Access »,
 *     code 50001) ; la tâche s'exécute alors sans rien écrire et le dit. Elle ne
 *     simule rien en attendant.
 *
 * Usage :
 *   bun packages/cron/src/tasks/campagnes-discord.ts [--campagne <slug>]
 *                                                    [--limite N] [--dry]
 */

import { sql } from "../lib/db.js";
import {
	telechargerPieceJointeDiscord,
	televerserObjet,
	urlSansSignature,
} from "../lib/storage-assets.js";

const PREFIXE = "[Campagnes Discord]";

/** Bucket public où les créations sont recopiées (même bucket que les visuels). */
const BUCKET = "assets";

/**
 * Taille maximale d'une image recopiée.
 *
 * Plus haut que les 8 Mio des visuels de sondage : une création de campagne est
 * un dessin en pleine résolution (l'affiche de remerciement d'`inazuma-rg` fait
 * 2400×3000). Discord plafonne de toute façon la pièce jointe d'un compte non
 * boosté à 25 Mio.
 */
const TAILLE_IMAGE_MAX = 16 * 1024 * 1024;

/**
 * Taille maximale d'une vidéo recopiée.
 *
 * C'est le plafond de pièce jointe d'un compte Discord non boosté : au-delà,
 * le fichier n'existe pas. Mesuré sur la seule vidéo reçue à ce jour
 * (`copy_7F99427F….mov`, karuminasan, IERG Day) : 1,29 Mo.
 */
const TAILLE_VIDEO_MAX = 25 * 1024 * 1024;

/**
 * Tolérance de dépôt APRÈS la clôture, sur le chemin « salon de dépôt ».
 *
 * Sept jours : le règlement invite explicitement à déposer le dessin dans le
 * salon après l'avoir publié sur les réseaux, et cinq participants d'IERG Day
 * l'ont fait entre H+1 et J+3. Ce délai ne déplace PAS la clôture (cf. l'encadré
 * en tête de fichier) ; il empêche seulement la fresque de perdre des dessins
 * réellement déposés.
 */
const DELAI_GRACE_DEPOT_MS = 7 * 24 * 60 * 60 * 1000;

/** Plafond de créations traitées par campagne et par run (surchargé par `--limite`). */
const MAX_CREATIONS_PAR_CAMPAGNE = 500;

/** Taille des lots d'écriture en base. */
const LOT_ECRITURE = 50;

/** Petite pause entre deux téléchargements : politesse envers le quota Discord. */
const PAUSE_TELECHARGEMENT_MS = 120;

/**
 * Extensions considérées comme des images quand Discord n'annonce pas de
 * `content_type` (le cas des pièces jointes les plus anciennes).
 */
const EXTENSIONS_IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

/** Même repli que ci-dessus, pour les vidéos. */
const EXTENSIONS_VIDEO = /\.(mp4|mov|m4v|webm|ogv)$/i;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsRecolteDiscord {
	/** Restreint la récolte à une seule campagne. */
	slug?: string;
	/** Plafond de créations retenues par campagne. */
	limite?: number;
	/** Simulation : lit tout, n'écrit ni en base ni dans le Storage. */
	dry?: boolean;
}

export interface StatsCampagneDiscord {
	slug: string;
	/** Messages examinés (tous salons suivis confondus). */
	examines: number;
	/** Messages retenus : rattachés à la campagne ET porteurs d'au moins une image. */
	retenus: number;
	/** Rattachements retenus par le hashtag écrit dans le message. */
	parHashtag: number;
	/** Rattachements retenus par appartenance au salon de dépôt. */
	parSalon: number;
	/** Images déjà ré-hébergées lors d'un run précédent (aucun téléchargement). */
	imagesDejaLa: number;
	/** Images recopiées dans le Storage pendant CE run. */
	imagesRehebergees: number;
	/** Images dont la recopie a échoué (retentée au prochain run). */
	imagesEchouees: number;
	/** Lignes écrites (insertions + mises à jour). */
	rattachements: number;
	/** Créations retenues dont au moins un média est une vidéo. */
	avecVideo: number;
	/**
	 * Créations retenues DÉPOSÉES APRÈS `fin_le`, dans le délai de grâce.
	 *
	 * Elles entrent dans la fresque et ne portent AUCUN ticket : le roster du
	 * tirage les écarte lui-même. Le compteur existe pour qu'elles ne passent
	 * jamais inaperçues dans le journal.
	 */
	horsDelaiTolere: number;
	/**
	 * Salons de dépôt déclarés dont aucun message n'a été récolté.
	 *
	 * Ce n'est PAS forcément un défaut d'accès : un salon sous veille, à jour et
	 * vide tombe ici aussi — c'est l'état normal d'une campagne qui vient
	 * d'ouvrir. `diagnostiquerSalons` tranche entre les trois cas au moment de
	 * l'écrire dans le journal.
	 */
	salonsInaccessibles: string[];
}

export interface StatsRecolteDiscord {
	success: boolean;
	campagnes: number;
	details: StatsCampagneDiscord[];
	totalRattachements: number;
	totalImages: number;
	dry: boolean;
	error?: string;
}

interface LigneCampagne {
	slug: string;
	titre: string;
	hashtags: string[] | null;
	hashtags_rattrapage: string[] | null;
	salons_depot: string[] | null;
	debut_le: Date | string | null;
	fin_le: Date | string | null;
}

interface LigneMessage {
	message_id: string;
	channel_id: string;
	salon_nom: string;
	salon_type: number;
	content: string;
	attachments: unknown;
	created_at: Date | string;
}

/** Un média ré-hébergé, tel qu'il est stocké dans `images` (jsonb). */
interface MediaReheberge {
	attachment_id: string;
	/**
	 * `image` ou `video`.
	 *
	 * Champ AJOUTÉ à un jsonb existant : les lignes récoltées avant le 26/8/2026
	 * ne le portent pas. Tout lecteur doit donc traiter son absence comme
	 * `image` — c'est ce que fait `imagesDiscord()` côté site.
	 */
	kind: "image" | "video";
	/** Chemin dans le bucket `assets`, ou `null` si la recopie a échoué. */
	chemin: string | null;
	nom: string;
	type_mime: string | null;
	largeur: number | null;
	hauteur: number | null;
	taille: number | null;
	/** URL Discord SANS sa signature — trace de provenance, jamais servie. */
	url_origine: string;
}

/** Pièce jointe affichable d'un message, avant recopie. */
interface PieceJointeMedia {
	id: string;
	kind: "image" | "video";
	nom: string;
	typeMime: string | null;
	largeur: number | null;
	hauteur: number | null;
	taille: number | null;
	url: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture défensive du jsonb
// ─────────────────────────────────────────────────────────────────────────────

function tableau(valeur: unknown): unknown[] {
	if (Array.isArray(valeur)) return valeur;
	// Selon le pilote, une colonne jsonb peut revenir déjà sérialisée.
	if (typeof valeur === "string") {
		try {
			const analyse: unknown = JSON.parse(valeur);
			return Array.isArray(analyse) ? analyse : [];
		} catch {
			return [];
		}
	}
	return [];
}

function chaine(valeur: unknown): string | null {
	return typeof valeur === "string" && valeur.trim().length > 0 ? valeur.trim() : null;
}

function entier(valeur: unknown): number | null {
	if (typeof valeur === "number" && Number.isFinite(valeur)) return Math.trunc(valeur);
	if (typeof valeur === "string" && /^\d+$/.test(valeur)) return Number.parseInt(valeur, 10);
	return null;
}

function versDate(valeur: Date | string | null | undefined): Date | null {
	if (!valeur) return null;
	const date = valeur instanceof Date ? valeur : new Date(valeur);
	return Number.isNaN(date.getTime()) ? null : date;
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sélection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Images d'un message, dans l'ordre où Discord les a rendues.
 *
 * On ne garde QUE les pièces jointes image : une fanfiction en `.pdf` ou un
 * `.mp4` est une participation légitime, mais la galerie de /iergday montre des
 * images — annoncer « 12 créations » puis rendre 8 vignettes vides serait pire
 * que de ne pas les compter. Le `content_type` fait foi ; l'extension ne sert
 * que pour les pièces jointes anciennes, que Discord n'a pas typées.
 */
export function extraireMedias(attachments: unknown): PieceJointeMedia[] {
	const medias: PieceJointeMedia[] = [];
	for (const brut of tableau(attachments)) {
		if (!brut || typeof brut !== "object") continue;
		const item = brut as Record<string, unknown>;
		const url = chaine(item.url) ?? chaine(item.proxy_url);
		const id = chaine(item.id);
		if (!url || !id) continue;
		const nom = chaine(item.filename) ?? "fichier";
		const typeMime = chaine(item.content_type);
		const kind = classerMedia(typeMime, nom);
		if (!kind) continue;
		medias.push({
			hauteur: entier(item.height),
			id,
			kind,
			largeur: entier(item.width),
			nom,
			taille: entier(item.size),
			typeMime,
			url,
		});
	}
	return medias;
}

/**
 * Image, vidéo, ou rien du tout.
 *
 * Le `content_type` annoncé par Discord fait foi ; l'extension ne sert que pour
 * les pièces jointes anciennes, que Discord n'a pas typées. Tout le reste
 * (`application/pdf`, archives, `.psd`) renvoie `null` et n'est pas récolté.
 */
export function classerMedia(typeMime: string | null, nom: string): "image" | "video" | null {
	if (typeMime) {
		if (typeMime.startsWith("image/")) return "image";
		if (typeMime.startsWith("video/")) return "video";
		return null;
	}
	if (EXTENSIONS_IMAGE.test(nom)) return "image";
	if (EXTENSIONS_VIDEO.test(nom)) return "video";
	return null;
}

/**
 * Le message contient-il l'un des hashtags de la campagne ?
 *
 * Comparaison en MINUSCULES des deux côtés : la base stocke `inazumarg`, le
 * message écrit `#inazumaRG`. On renvoie le hashtag NORMALISÉ (celui de la base),
 * pas la casse tapée par l'auteur : c'est `queries.ts` qui rétablit la casse
 * d'affichage de la campagne, et lui seul qui décide si le hashtag est
 * montrable — un hashtag de rattrapage (coquille d'une affiche) fait bien mordre
 * le message, mais n'est jamais affiché.
 */
export function trouverHashtag(contenu: string, hashtags: readonly string[]): string | null {
	const bas = (contenu || "").toLowerCase();
	for (const hashtag of hashtags) {
		if (bas.includes(`#${hashtag}`)) return hashtag;
	}
	return null;
}

/**
 * La date tombe-t-elle dans la fenêtre éditoriale de la campagne ?
 *
 * Une borne absente n'est pas une borne : une campagne sans `fin_le` accepte
 * tout ce qui suit son ouverture. Une campagne sans AUCUNE borne accepte tout —
 * c'est cohérent avec le reste (`etatCampagne()` la considère « en cours »),
 * et c'est sans risque : ce chemin ne s'active que pour un salon que la campagne
 * a explicitement déclaré comme étant le sien.
 */
export function dansFenetre(
	date: Date,
	debut: Date | null,
	fin: Date | null
): boolean {
	if (debut && date < debut) return false;
	if (fin && date > fin) return false;
	return true;
}

/**
 * Jusqu'à quand ce salon accepte-t-il un dépôt pour cette campagne ?
 *
 * `fin_le` + `DELAI_GRACE_DEPOT_MS`, mais JAMAIS au-delà de l'ouverture de la
 * campagne suivante qui déclare le même salon (moins une milliseconde, pour que
 * les deux fenêtres ne se touchent pas). Sans `fin_le`, il n'y a rien à
 * prolonger : la campagne accepte déjà tout, on renvoie `null` tel quel.
 */
export function borneDepot(
	fin: Date | null,
	salon: string,
	ouverturesParSalon: ReadonlyMap<string, readonly Date[]>
): Date | null {
	if (!fin) return null;
	const grace = new Date(fin.getTime() + DELAI_GRACE_DEPOT_MS);
	const suivante = (ouverturesParSalon.get(salon) ?? [])
		.filter((ouverture) => ouverture > fin)
		.sort((a, b) => a.getTime() - b.getTime())[0];
	if (suivante && suivante.getTime() - 1 < grace.getTime()) {
		return new Date(suivante.getTime() - 1);
	}
	return grace;
}

/**
 * Chemin déterministe du média dans le bucket `assets`.
 *
 * Groupé par campagne pour qu'une campagne se purge d'une seule commande. Le
 * couple (message, pièce jointe) est unique côté Discord : deux runs écrivent
 * donc au même endroit, et `x-upsert` fait le reste.
 */
export function cheminMedia(slug: string, messageId: string, media: PieceJointeMedia): string {
	const extension = (media.nom.split(".").pop() ?? "").toLowerCase();
	const attendue = media.kind === "video" ? EXTENSIONS_VIDEO : EXTENSIONS_IMAGE;
	const extensionSure = attendue.test(`.${extension}`) ? extension : "bin";
	return `campagnes/${slug}/discord/${messageId}-${media.id}.${extensionSure}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Récolte
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Récolte les créations Discord de toutes les campagnes (ou d'une seule).
 *
 * @param options `slug` pour n'en traiter qu'une, `limite` pour plafonner,
 *                `dry` pour ne rien écrire.
 */
export async function recolterCreationsDiscord(
	options: OptionsRecolteDiscord = {}
): Promise<StatsRecolteDiscord> {
	const { slug, limite = MAX_CREATIONS_PAR_CAMPAGNE, dry = false } = options;
	const details: StatsCampagneDiscord[] = [];

	try {
		/*
		 * ⚠ ON NE FILTRE PAS SUR `actif`, ET C'EST VOLONTAIRE.
		 * `x_campagnes.actif` veut dire « le cron interroge X pour cette campagne » :
		 * c'est un garde-fou de QUOTA X. Les cinq campagnes archivées sont
		 * `actif = false` — or ce sont précisément celles dont les créations vivent
		 * sur Discord. Les exclure ici viderait la tâche de son objet. La récolte
		 * Discord ne coûte aucun appel d'API par campagne : elle relit une archive
		 * déjà en base.
		 */
		const campagnes = (await sql`
			select slug, titre, hashtags, hashtags_rattrapage, salons_depot, debut_le, fin_le
			  from public.x_campagnes
			 where ${slug ?? null}::text is null or slug = ${slug ?? null}::text
			 order by principale desc, debut_le desc nulls last, slug
		`) as LigneCampagne[];

		if (campagnes.length === 0) {
			const quoi = slug ? `la campagne « ${slug} » est inconnue` : "aucune campagne en base";
			console.log(`${PREFIXE} Rien à récolter : ${quoi}.`);
			return { success: true, campagnes: 0, details: [], totalRattachements: 0, totalImages: 0, dry };
		}

		/*
		 * ⚠ LE SALON D'ANNONCES N'EST PAS UN SALON DE CRÉATIONS.
		 * `discord_channels.type = 5` est le type « salon d'annonces » de Discord —
		 * une donnée de Discord, pas un jugement de notre part. Mesuré le 12/8/2026 :
		 * les 9 messages archivés qui portent un hashtag de campagne sont TOUS dans
		 * `🚨〡annonces` (type 5), tous écrits par l'équipe, et ce sont les annonces
		 * DES campagnes elles-mêmes — leurs images sont déjà publiées comme
		 * `image_affiche` / `image_couverture`. Sans cette règle, les premières
		 * « créations » de la galerie seraient les propres affiches de la campagne.
		 * Un salon d'annonces explicitement déclaré comme salon de dépôt reste, lui,
		 * récolté : la déclaration prime sur l'heuristique.
		 */
		const salonsDepotDeclares = new Set(
			campagnes.flatMap((campagne) => campagne.salons_depot ?? [])
		);

		/*
		 * Toutes les OUVERTURES de campagne, salon par salon. C'est ce qui borne le
		 * délai de grâce : `⚡〡inatober-rg` est le salon de dépôt des éditions 2023,
		 * 2024 ET 2025 — la grâce de 2023 doit s'arrêter net à l'ouverture de 2024,
		 * sinon un dépôt tardif appartiendrait aux deux éditions à la fois. Les
		 * campagnes sans `debut_le` (iergday) ne bornent rien : on ne sait pas
		 * quand elles commencent, on n'invente pas une frontière.
		 */
		const ouverturesParSalon = new Map<string, Date[]>();
		for (const campagne of campagnes) {
			const ouverture = versDate(campagne.debut_le);
			if (!ouverture) continue;
			for (const salon of campagne.salons_depot ?? []) {
				const liste = ouverturesParSalon.get(salon) ?? [];
				liste.push(ouverture);
				ouverturesParSalon.set(salon, liste);
			}
		}

		const messages = (await sql`
			select m.message_id, m.channel_id, m.content, m.attachments, m.created_at,
			       c.name as salon_nom, c.type as salon_type
			  from public.discord_messages m
			  join public.discord_channels c on c.channel_id = m.channel_id
			 where c.suivi
			   and m.deleted_at is null
			   -- Un bot ne dépose pas de création : EasyPoll, les webhooks de relais
			   -- et les robots de modération portent des encarts illustrés qui
			   -- passeraient sinon pour des participations.
			   and not m.author_is_bot
			   and jsonb_array_length(m.attachments) > 0
			 order by m.created_at
		`) as LigneMessage[];

		console.log(
			`${PREFIXE} ${campagnes.length} campagne(s), ${messages.length} message(s) illustré(s) dans les salons suivis${dry ? " — MODE SIMULATION, aucune écriture" : ""}.`
		);

		for (const campagne of campagnes) {
			details.push(
				await recolterCampagne(
					campagne,
					messages,
					salonsDepotDeclares,
					ouverturesParSalon,
					limite,
					dry
				)
			);
		}

		const totalRattachements = details.reduce((somme, detail) => somme + detail.rattachements, 0);
		const totalImages = details.reduce((somme, detail) => somme + detail.imagesRehebergees, 0);
		return { success: true, campagnes: campagnes.length, details, totalRattachements, totalImages, dry };
	} catch (err) {
		console.error(`${PREFIXE} Échec global :`, message(err));
		return {
			success: false,
			campagnes: details.length,
			details,
			totalRattachements: details.reduce((somme, detail) => somme + detail.rattachements, 0),
			totalImages: details.reduce((somme, detail) => somme + detail.imagesRehebergees, 0),
			dry,
			error: message(err),
		};
	}
}

/**
 * Dit POURQUOI un salon de dépôt n'a rendu aucun message.
 *
 * L'ancien message unique — « le bot n'y a pas encore accès » — était faux dès
 * que la veille avait fait son travail : le salon `🍰〡iergday`, créé le jour
 * même de l'ouverture de la campagne, était sous veille, à jour, et VIDE. Le
 * diagnostic envoyait vérifier des permissions parfaitement en ordre au lieu de
 * dire la seule chose vraie : personne n'a encore rien déposé.
 */
async function diagnostiquerSalons(salons: readonly string[]): Promise<string[]> {
	// `jsonb_array_elements_text` et NON `= ANY($1::text[])` : Bun.SQL sérialise
	// un tableau JS en JSON, pas en littéral de tableau Postgres, et `ANY` échoue
	// alors sur « malformed array literal » (même piège que `marquerSupprimes`
	// dans `tasks/discord-messages.ts`, où il est déjà documenté).
	const etats = (await sql`
		select channel_id, name, suivi, backfill_complete, message_count
		  from public.discord_channels
		 where channel_id in (select jsonb_array_elements_text(${salons as string[]}))
	`) as Array<{
		channel_id: string;
		name: string;
		suivi: boolean;
		backfill_complete: boolean;
		message_count: number | null;
	}>;
	const parId = new Map(etats.map((etat) => [etat.channel_id, etat]));

	return salons.map((salon) => {
		const etat = parId.get(salon);
		if (!etat) {
			return `salon de dépôt ${salon} inconnu de la veille — il sera armé à la prochaine passe de « discord:messages ».`;
		}
		const nom = etat.name || salon;
		if (!etat.suivi) {
			return `salon de dépôt ${nom} (${salon}) déclaré mais PAS sous veille — « discord:messages » l'armera, ou le bot n'y a pas accès.`;
		}
		if (!etat.backfill_complete) {
			return `salon de dépôt ${nom} (${salon}) sous veille, historique en cours de remontée — rien à récolter avant la fin.`;
		}
		return `salon de dépôt ${nom} (${salon}) sous veille et à jour, mais VIDE : aucune création déposée à ce jour. Rien n'est inventé en attendant.`;
	});
}

/** Récolte une campagne : sélection, ré-hébergement des médias, écriture. */
async function recolterCampagne(
	campagne: LigneCampagne,
	messages: readonly LigneMessage[],
	salonsDepotDeclares: ReadonlySet<string>,
	ouverturesParSalon: ReadonlyMap<string, readonly Date[]>,
	limite: number,
	dry: boolean
): Promise<StatsCampagneDiscord> {
	const stats: StatsCampagneDiscord = {
		slug: campagne.slug,
		examines: 0,
		retenus: 0,
		parHashtag: 0,
		parSalon: 0,
		imagesDejaLa: 0,
		imagesRehebergees: 0,
		imagesEchouees: 0,
		rattachements: 0,
		avecVideo: 0,
		horsDelaiTolere: 0,
		salonsInaccessibles: [],
	};

	const hashtags = [...(campagne.hashtags ?? []), ...(campagne.hashtags_rattrapage ?? [])];
	const salonsDepot = new Set(campagne.salons_depot ?? []);
	const debut = versDate(campagne.debut_le);
	const fin = versDate(campagne.fin_le);

	// Salons déclarés dont AUCUN message n'est archivé : c'est le symptôme exact
	// du « Missing Access ». On le remonte tel quel plutôt que de le taire.
	const salonsVus = new Set(messages.map((ligne) => ligne.channel_id));
	stats.salonsInaccessibles = [...salonsDepot].filter((salon) => !salonsVus.has(salon));

	// Ce qui a DÉJÀ été ré-hébergé : relu une fois, pour ne retélécharger aucune
	// image d'un run précédent. C'est ce qui rend la tâche rejouable à coût nul.
	const dejaLa = new Map<string, MediaReheberge[]>();
	const existantes = (await sql`
		select message_id, images
		  from public.campagne_creations_discord
		 where campagne_slug = ${campagne.slug}
	`) as Array<{ message_id: string; images: unknown }>;
	for (const ligne of existantes) {
		dejaLa.set(ligne.message_id, tableau(ligne.images) as MediaReheberge[]);
	}

	const lignes: Array<{
		campagne_slug: string;
		message_id: string;
		hashtag_trouve: string | null;
		a_media: boolean;
		nb_images: number;
		images: MediaReheberge[];
		publie_le: Date;
		collecte_le: Date;
	}> = [];

	for (const ligne of messages) {
		if (lignes.length >= limite) break;
		stats.examines++;

		const publieLe = versDate(ligne.created_at);
		if (!publieLe) continue;

		// 1. Le hashtag l'emporte : il est explicite et sans ambiguïté de date.
		let hashtagTrouve = trouverHashtag(ligne.content, hashtags);
		let parSalon = false;
		let horsDelai = false;
		if (!hashtagTrouve) {
			// 2. Le salon de dépôt, BORNÉ par la fenêtre de la campagne (un même
			// salon a servi à trois éditions d'Inatober).
			if (!salonsDepot.has(ligne.channel_id)) continue;
			const finDepot = borneDepot(fin, ligne.channel_id, ouverturesParSalon);
			if (!dansFenetre(publieLe, debut, finDepot)) continue;
			parSalon = true;
			if (fin && publieLe > fin) horsDelai = true;
		} else if (ligne.salon_type === 5 && !salonsDepotDeclares.has(ligne.channel_id)) {
			// Salon d'annonces non déclaré comme dépôt : c'est l'annonce de la
			// campagne, pas une participation (cf. le commentaire de l'appelant).
			continue;
		}

		const medias = extraireMedias(ligne.attachments);
		if (medias.length === 0) continue;

		const rehebergees = await rehebergerMedias(
			campagne.slug,
			ligne,
			medias,
			dejaLa.get(ligne.message_id) ?? [],
			stats,
			dry
		);
		const servables = rehebergees.filter((media) => media.chemin !== null);

		/*
		 * UN DÉPÔT TARDIF QU'ON NE SAIT PAS MONTRER N'EST PAS ÉCRIT.
		 *
		 * Mesuré le 26/8/2026 en ouvrant le délai de grâce : 47 messages de 2023 et 2024 sont
		 * entrés dans les salons de dépôt d'`inazuma-rg` et `inazuma-rg-2` après leur clôture,
		 * tous avec une pièce jointe dont l'URL Discord a expiré et n'est plus re-signable. Ils
		 * donnaient 47 lignes `a_media = false` : invisibles sur la fresque, absentes du tirage,
		 * et retéléchargées EN VAIN à chaque passage. Une ligne qui ne peut rien montrer et ne
		 * peut rien porter n'est pas une trace, c'est du bruit.
		 *
		 * ⚠ La règle vaut UNIQUEMENT hors délai. Dans la fenêtre, une recopie en échec s'écrit
		 * quand même avec `a_media = false` : c'est ce qui permet au run suivant de la rattraper
		 * quand le Storage ou Discord a eu un hoquet, sans perdre la participation.
		 */
		if (horsDelai && servables.length === 0) {
			console.warn(
				`${PREFIXE} ${campagne.slug} : dépôt tardif ${ligne.message_id} ignoré — aucun de ses ` +
					`${medias.length} média(s) n'est récupérable (URL Discord expirée). Rien écrit.`
			);
			continue;
		}

		stats.retenus++;
		if (parSalon) stats.parSalon++;
		else stats.parHashtag++;
		// Compté sur TOUS les médias, pas seulement les servables : en simulation
		// aucun n'est recopié, et un compteur à zéro laisserait croire qu'aucune
		// vidéo n'a été vue.
		if (rehebergees.some((media) => media.kind === "video")) stats.avecVideo++;
		if (horsDelai) stats.horsDelaiTolere++;

		lignes.push({
			campagne_slug: campagne.slug,
			message_id: ligne.message_id,
			hashtag_trouve: hashtagTrouve,
			// `a_media` = « au moins un média SERVABLE », pas « le message porte une
			// pièce jointe » : une recopie encore en échec ne doit pas gonfler le
			// compteur d'une galerie qui ne pourra rien montrer. Le prochain run
			// rebascule la ligne à `true` tout seul.
			a_media: servables.length > 0,
			nb_images: servables.length,
			images: rehebergees,
			publie_le: publieLe,
			collecte_le: new Date(),
		});
	}

	if (stats.salonsInaccessibles.length > 0) {
		for (const ligne of await diagnostiquerSalons(stats.salonsInaccessibles)) {
			console.warn(`${PREFIXE} ${campagne.slug} : ${ligne}`);
		}
	}

	if (lignes.length === 0) {
		console.log(`${PREFIXE} ${campagne.slug} : aucune création Discord à ce jour. Rien écrit.`);
		return stats;
	}

	if (dry) {
		console.log(
			`${PREFIXE} ${campagne.slug} : SIMULATION — ${lignes.length} création(s) auraient été enregistrées.`
		);
		return stats;
	}

	for (let debutLot = 0; debutLot < lignes.length; debutLot += LOT_ECRITURE) {
		const lot = lignes.slice(debutLot, debutLot + LOT_ECRITURE);
		// ⚠⚠ NE JAMAIS ajouter `masque`, `motif_masquage` ni `mis_en_avant` à cette
		// clause `do update` : ce sont les décisions humaines de modération et de
		// mise en avant. Les y mettre ferait réapparaître sur le site, à la récolte
		// suivante, toute création qu'un modérateur vient de retirer.
		await sql`
			insert into public.campagne_creations_discord ${sql(
				lot,
				"campagne_slug",
				"message_id",
				"hashtag_trouve",
				"a_media",
				"nb_images",
				"images",
				"publie_le",
				"collecte_le"
			)}
			on conflict (campagne_slug, message_id) do update set
				hashtag_trouve = excluded.hashtag_trouve,
				a_media        = excluded.a_media,
				nb_images      = excluded.nb_images,
				images         = excluded.images,
				publie_le      = excluded.publie_le,
				collecte_le    = now()`;
		stats.rattachements += lot.length;
	}

	console.log(
		`${PREFIXE} ${campagne.slug} : ${stats.rattachements} rattachement(s) ` +
			`(${stats.parHashtag} par hashtag, ${stats.parSalon} par salon de dépôt), ` +
			`${stats.imagesRehebergees} média(s) recopié(s), ${stats.imagesDejaLa} déjà en stock` +
			`${stats.avecVideo > 0 ? `, ${stats.avecVideo} avec vidéo` : ""}` +
			`${stats.horsDelaiTolere > 0 ? `, ${stats.horsDelaiTolere} déposée(s) après la clôture (fresque oui, tirage non)` : ""}` +
			`${stats.imagesEchouees > 0 ? `, ${stats.imagesEchouees} en échec (retentée(s) au prochain run)` : ""}.`
	);

	return stats;
}

/**
 * Ré-héberge les images d'un message dans le bucket public `assets`.
 *
 * Une image déjà recopiée lors d'un run précédent est reprise TELLE QUELLE :
 * aucun appel réseau, aucune réécriture. C'est ce qui rend la tâche rejouable à
 * coût nul, y compris toutes les heures.
 */
async function rehebergerMedias(
	slug: string,
	ligne: LigneMessage,
	medias: readonly PieceJointeMedia[],
	deja: readonly MediaReheberge[],
	stats: StatsCampagneDiscord,
	dry: boolean
): Promise<MediaReheberge[]> {
	const parIdentifiant = new Map(deja.map((media) => [media.attachment_id, media]));
	const resultat: MediaReheberge[] = [];

	for (const media of medias) {
		const base: MediaReheberge = {
			attachment_id: media.id,
			chemin: null,
			hauteur: media.hauteur,
			kind: media.kind,
			largeur: media.largeur,
			nom: media.nom,
			taille: media.taille,
			type_mime: media.typeMime,
			url_origine: urlSansSignature(media.url),
		};

		const connue = parIdentifiant.get(media.id);
		if (connue?.chemin) {
			stats.imagesDejaLa++;
			// `kind` n'existait pas avant le 26/8/2026 : une ligne d'alors le rejoue
			// ici depuis le type MIME courant plutôt que de rester sans réponse.
			resultat.push({ ...base, chemin: connue.chemin });
			continue;
		}

		if (dry) {
			resultat.push(base);
			continue;
		}

		const chemin = cheminMedia(slug, ligne.message_id, media);
		const fichier = await telechargerPieceJointeDiscord(
			ligne.channel_id,
			media.url,
			media.kind === "video" ? TAILLE_VIDEO_MAX : TAILLE_IMAGE_MAX,
			media.typeMime,
			[`${media.kind}/`]
		);
		if (!fichier.ok) {
			stats.imagesEchouees++;
			console.warn(
				`${PREFIXE} ${slug} : ${media.kind} ${media.nom} du message ${ligne.message_id} non recopiée — ${fichier.motif}`
			);
			resultat.push(base);
			continue;
		}

		const envoi = await televerserObjet(BUCKET, chemin, fichier.octets, fichier.typeMime);
		if (!envoi.ok) {
			stats.imagesEchouees++;
			console.warn(
				`${PREFIXE} ${slug} : ${media.kind} ${media.nom} du message ${ligne.message_id} non téléversée — ${envoi.motif}`
			);
			resultat.push(base);
			continue;
		}

		stats.imagesRehebergees++;
		resultat.push({ ...base, chemin, type_mime: fichier.typeMime });
		await Bun.sleep(PAUSE_TELECHARGEMENT_MS);
	}

	return resultat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface en ligne de commande
// ─────────────────────────────────────────────────────────────────────────────

function lireOptions(argv: readonly string[]): OptionsRecolteDiscord {
	const valeur = (nom: string): string | undefined => {
		const position = argv.indexOf(nom);
		return position === -1 ? undefined : argv[position + 1];
	};
	const limiteBrute = Number(valeur("--limite"));
	return {
		slug: valeur("--campagne"),
		limite: Number.isFinite(limiteBrute) && limiteBrute > 0 ? limiteBrute : undefined,
		dry: argv.includes("--dry"),
	};
}

if (import.meta.main) {
	const argv = Bun.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(
			[
				"Récolte des créations Discord des campagnes vers public.campagne_creations_discord.",
				"",
				"  bun packages/cron/src/tasks/campagnes-discord.ts [options]",
				"",
				"  --campagne <slug>  ne traite que cette campagne (défaut : toutes)",
				"  --limite <n>       plafond de créations retenues par campagne (défaut : 500)",
				"  --dry              simulation : lit tout, n'écrit ni en base ni dans le Storage",
			].join("\n")
		);
		process.exit(0);
	}

	const resultat = await recolterCreationsDiscord(lireOptions(argv));

	console.log(`\n${PREFIXE} ── Résumé ──`);
	for (const detail of resultat.details) {
		console.log(
			`  ${detail.slug.padEnd(20)} retenus=${detail.retenus} hashtag=${detail.parHashtag} salon=${detail.parSalon} ` +
				`rattachements=${detail.rattachements} medias=${detail.imagesRehebergees}(+${detail.imagesDejaLa} en stock, ${detail.imagesEchouees} en échec) ` +
			`video=${detail.avecVideo} hors_delai=${detail.horsDelaiTolere}` +
				`${detail.salonsInaccessibles.length > 0 ? ` salons_sans_creation=${detail.salonsInaccessibles.join("/")}` : ""}`
		);
	}
	console.log(
		`  TOTAL campagnes=${resultat.campagnes} rattachements=${resultat.totalRattachements} images=${resultat.totalImages}${resultat.dry ? " (simulation)" : ""}`
	);
	if (resultat.error) console.error(`  ERREUR : ${resultat.error}`);
	process.exit(resultat.success ? 0 : 1);
}
