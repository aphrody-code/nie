/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extraction des sondages du salon 🧐〡sondages.
 *
 * POURQUOI CETTE TÂCHE
 * Les sondages sont posés par le bot EasyPoll sous forme d'ENCART : le message
 * archivé dans `discord_messages` ne contient pas des données mais un bloc de
 * texte Markdown où question, choix et décomptes sont noyés. Impossible d'en
 * trier un, d'en comparer deux ou d'en tracer un graphique sans les extraire.
 * Cette tâche fait cette extraction, une fois, et la range dans `discord_polls`
 * / `discord_poll_options`.
 *
 * TROIS DIFFICULTÉS RÉELLES, ET CE QU'ON EN FAIT
 *
 * 1. TROIS ÈRES D'ÉCRITURE. EasyPoll a changé de format en cours de route :
 *    résultats `[32 • 42%]` puis `| 15.8% (21)`, nombre de choix écrit
 *    `:one:` puis `<:three:1263838178511425598>` puis `<:choices:…> 3`, et
 *    l'encart passé de l'anglais au français en 2026. Le parseur reconnaît
 *    TOUTES ces formes et, surtout, ne rejette JAMAIS un encart sur une ligne
 *    qu'il ne comprend pas : il l'accumule dans `avertissements`. Ces
 *    avertissements sont le canari d'une quatrième ère.
 *
 * 2. LES RÉSULTATS MASQUÉS. EasyPoll ne publie aucun décompte tant que le
 *    sondage tourne — la moitié du salon est dans ce cas. MAIS jusqu'en mai 2024
 *    on votait PAR RÉACTION sur le message du bot, et `discord_messages.reactions`
 *    les a archivées. `appliquerVotesDepuisReactions()` reconstitue donc ces
 *    décomptes, sous quatre garde-fous stricts (cf. la fonction), et le marque
 *    par `source = 'reactions'` pour que le site l'annonce comme une estimation.
 *
 * 3. LE VISUEL. Une question sur cinq renvoie à « l'image ci-dessus », qui
 *    n'appartient pas à l'encart mais au message humain voisin. Le lien est une
 *    déduction (±15 min, même salon, auteur humain) ; l'image est RECOPIÉE dans
 *    le bucket public `assets` parce que les URL Discord sont signées et
 *    expirent en moins de 24 h — republier l'URL d'origine, c'est publier une
 *    page qui casse le lendemain.
 *
 * VIE PRIVÉE — LIGNE ROUGE : la table des VOTES NOMINATIFS (qui a voté quoi)
 * n'est nommée nulle part dans ce fichier, pas même en commentaire, pour que le
 * contrôle `grep -c` reste une preuve et pas une approximation. Rattacher un
 * membre à une opinion est d'une autre nature que republier un décompte
 * agrégé : cette table reste sans policy de lecture, hors du temps réel, et
 * l'import n'y écrit rien. Le test de non-dérive vérifie l'absence du nom.
 *
 * CLI : `bun packages/cron/src/tasks/discord-polls.ts [--dry] [--limite N]
 *        [--salon ID] [--sans-discord] [--sans-visuels]`
 */

import { sql } from "../lib/db.js";
import { appelDiscordOuNull } from "../lib/discord-rest.js";
import { telechargerPieceJointeDiscord, televerserObjet } from "../lib/storage-assets.js";
import { DISCORD_TOKEN } from "../lib/discord.js";

const PREFIXE = "[Cron Sondages]";

// ─── CONSTANTES DU DOMAINE ───────────────────────────────────────────────────

/** Salon 🧐〡sondages du serveur Rose Griffon. */
export const SALON_SONDAGES = "1135716082972381234";

/**
 * Date de bascule d'EasyPoll des réactions vers les boutons.
 * Au-delà, une réaction sur un encart n'est plus un vote mais un commentaire
 * social — la prendre pour un décompte inventerait des chiffres.
 */
export const FIN_ERE_REACTIONS = new Date("2024-06-01T00:00:00Z");

/** Bucket public où les visuels sont recopiés. */
export const BUCKET_VISUELS = "assets";
/** Préfixe de chemin à l'intérieur du bucket. */
export const PREFIXE_VISUELS = "discord/sondages";

/**
 * Fenêtre de rattachement du visuel (±15 min).
 * Mesuré sur le corpus : tous les rattachements légitimes tiennent dans ±545 s.
 * Sans borne, « dernier message humain avec pièce jointe » colle la même image à
 * onze sondages distants de cinq mois.
 */
export const FENETRE_VISUEL_MS = 15 * 60 * 1000;

/** Taille maximale d'un visuel recopié (le plus gros mesuré : 5,2 Mo). */
const TAILLE_VISUEL_MAX = 8 * 1024 * 1024;

/** Pause entre deux appels d'enrichissement Discord (quota par route). */
const PAUSE_ENRICHISSEMENT_MS = 400;

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface OptionExtraite {
	/** Rang du choix dans le sondage, 0-indexé. C'est la CLÉ d'une option : un
	 *  même sondage peut porter quatre choix au libellé strictement identique. */
	position: number;
	/** Unicode brut (« 🥞 ») ou emoji personnalisé (« <:Hey2:1089…> »). */
	emoji: string | null;
	label: string;
	votes: number | null;
	/** Pourcentage TEL QUE PUBLIÉ par EasyPoll ; `null` quand il est masqué. */
	pourcentage: number | null;
}

export interface ReactionBrute {
	emoji: { id: string | null; name: string };
	count: number;
}

export interface MessageSondage {
	message_id: string;
	channel_id: string;
	guild_id: string;
	created_at: Date;
	content: string;
	reactions: ReactionBrute[];
	author_id: string;
	author_username: string | null;
	author_is_bot: boolean;
	type: number;
}

export interface SondageExtrait {
	poll_id: string;
	uuid: string | null;
	provider: "easypoll" | "discord";
	source: "embed" | "reactions";
	langue: "fr" | "en" | null;
	message_id: string;
	channel_id: string;
	guild_id: string;
	question: string;
	creator_id: string | null;
	creator_username: string | null;
	command: string | null;
	/** 0 = illimité. */
	max_choices: number;
	locked: boolean;
	ended: boolean;
	ends_at: Date | null;
	total_votes: number | null;
	total_voters: number | null;
	results_hidden: boolean;
	raw: unknown | null;
	created_at: Date;
	options: OptionExtraite[];
	/**
	 * ANOMALIES non bloquantes : ce que l'encart contenait et que la grammaire
	 * n'a pas su lire. C'est le canari d'une quatrième ère, donc ce canal doit
	 * rester VIDE en régime normal — mesuré le 13/8/2026 : 0 anomalie sur les 51
	 * sondages du salon. Tout ce qui est simplement *bon à savoir* va dans
	 * `notes`, sinon le canari serait rouge en permanence et n'avertirait plus de
	 * rien (c'était le cas avec la note de reconstitution : 25 entrées sur 51,
	 * alors que le journal n'en affiche que cinq).
	 */
	avertissements: string[];
	/** Informations de traitement, attendues et sans gravité. */
	notes: string[];
}

export interface VisuelRattache {
	message_id: string;
	attachment_id: string;
	/** URL Discord SIGNÉE : à usage immédiat, jamais stockée ni republiée. */
	url: string;
	content_type: string;
	width: number | null;
	height: number | null;
	alt: string | null;
	taille: number | null;
	/** Écart signé, en secondes, entre le message du visuel et l'encart. */
	ecart_s: number;
}

export interface PieceJointeBrute {
	id?: string;
	url?: string;
	proxy_url?: string;
	content_type?: string | null;
	filename?: string | null;
	description?: string | null;
	width?: number | null;
	height?: number | null;
	size?: number | null;
}

export interface EncartBrut {
	thumbnail?: { url?: string; width?: number | null; height?: number | null } | null;
	image?: { url?: string; width?: number | null; height?: number | null } | null;
}

export interface MessageHumainAvecMedia {
	message_id: string;
	created_at: Date;
	content: string;
	attachments: PieceJointeBrute[];
	embeds: EncartBrut[];
}

/** Objet de sortie facultatif : reçoit la raison d'un rejet de parsage. */
export interface JournalDeRejet {
	raison?: string;
}

// ─── GRAMMAIRE DE L'ENCART ───────────────────────────────────────────────────

type RoleSection = "question" | "choix" | "resultats" | "parametres";

/**
 * Lexique COMPLET des en-têtes de section. Il n'en existe aucun autre dans le
 * corpus : ni « Résultat actuel », ni « Current Result » — un sondage en cours
 * ne publie tout simplement rien.
 */
const EN_TETES: Record<string, { role: RoleSection; langue: "fr" | "en" | null }> = {
	Question: { role: "question", langue: null },
	Choices: { role: "choix", langue: "en" },
	Choix: { role: "choix", langue: "fr" },
	"Final Result": { role: "resultats", langue: "en" },
	"Résultat final": { role: "resultats", langue: "fr" },
	Settings: { role: "parametres", langue: "en" },
	"Paramètres": { role: "parametres", langue: "fr" },
};

/**
 * En-tête de section : SEUL sur sa ligne (`m` + `^…$`).
 * L'ancrage est indispensable — un libellé de choix qui contiendrait
 * « **Choices** » au fil du texte ne doit pas ouvrir une section.
 */
const RE_SECTIONS =
	/^\*\*(Question|Choices|Choix|Final Result|Résultat final|Settings|Paramètres)\*\*[ \t]*$/gm;

/** Pied d'encart : c'est LUI qui identifie un sondage, jamais l'id du bot. */
const RE_ID = /^(?:Poll ID:|ID du sondage :)\s*([0-9a-f]{6,})$/;

/**
 * Emoji de tête de ligne.
 *
 * Le `\S+?` PARESSEUX est indispensable : il agrège un drapeau à deux
 * indicateurs régionaux (🇮🇹), une teinte de peau (👍🏻) ou une séquence ZWJ
 * (🏄‍♂️) tout en s'arrêtant au premier espace — ce qui donne la bonne lecture
 * des sept libellés qui commencent EUX AUSSI par un emoji (« 🇯 🩷 rose » :
 * l'emoji de vote est 🇯, le libellé est « 🩷 rose »).
 *
 * Le séparateur est 1 à 4 espaces U+0020 : surtout PAS `\s`, qui avalerait un
 * saut de ligne et fusionnerait deux choix.
 */
const RE_EMOJI = /^(<a?:[a-zA-Z0-9_]+:\d+>|\S+?)[ ]+/u;

/** Résultat, ère 1 (2023-08 → 2024-12) : `🥸 ▓▓▓▓░░░░░░ [32 • 42%]`. */
const RE_RES_V1 = /\[(\d+)\s*•\s*(\d+)%\]$/u;
/** Résultat, ère 2 (depuis 2025-03) : `❄️ ▓▓░░░░░░░░ | 15.8% (21)`. */
const RE_RES_V2 = /\|\s*([\d.]+)%\s*\((\d+)\)$/u;

/** `77 users voted` — un nombre de VOTANTS, surtout pas de votes. */
const RE_TOT_V1 = /^(\d+)\s+users?\s+voted$/u;
/** `*128 votes from 77 users*` / `*120 votes de 67 utilisateurs*`. */
const RE_TOT_V2 = /^\*(\d+)\s+votes?\s+(?:from|de)\s+(\d+)\s+(?:users?|utilisateurs?)\*$/u;

/** Clôture : `<t:UNIX:R>` est un horodatage Discord relatif. */
const RE_FIN = /(?:Poll already ended|Sondage déjà terminé)\s*\(<t:(\d+):R>\)/u;
/** Choix illimités (`max_choices = 0`). */
const RE_ILLIM = /(?::infinity:|<a?:infinity:\d+>)\s*(?:Unlimited choices|Choix illimités)/iu;
/** Chiffre littéral : `<:choices:…> 3 allowed choices` / `3 choix autorisés`. */
const RE_CHOIX_N = /(?:^|>\s*)(\d+)\s+(?:allowed choices?|choix autorisés?)$/u;
/**
 * Mot-emoji : `:one: allowed choice` ET `<:three:1263838178511425598> allowed
 * choices`. La seconde forme est celle qui fait échouer un parseur naïf : le
 * nombre est dans le NOM de l'emoji, pas dans le texte de la ligne.
 */
const RE_CHOIX_MOT = /^(?::([a-z]+):|<a?:([a-z]+):\d+>)\s+(?:allowed choices?|choix autorisés?)$/u;
/** Verrouillage. */
const RE_VERROU = /(?:No other votes allowed|Aucun autre vote autorisé)/u;

const MOTS_NOMBRES: Record<string, number> = {
	zero: 0,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
};

/** Découpe la description en sections nommées, sans supposer leur ordre. */
function decouperSections(description: string): Map<RoleSection, string> {
	const sections = new Map<RoleSection, string>();
	const marqueurs: Array<{ role: RoleSection; debut: number; fin: number }> = [];

	RE_SECTIONS.lastIndex = 0;
	let trouve: RegExpExecArray | null = RE_SECTIONS.exec(description);
	while (trouve) {
		const entree = EN_TETES[trouve[1]!];
		if (entree) {
			marqueurs.push({
				role: entree.role,
				debut: trouve.index,
				fin: trouve.index + trouve[0].length,
			});
		}
		trouve = RE_SECTIONS.exec(description);
	}

	for (const [index, marqueur] of marqueurs.entries()) {
		const finContenu = marqueurs[index + 1]?.debut ?? description.length;
		const contenu = description
			.slice(marqueur.fin, finContenu)
			.replace(/^\n+/, "")
			.replace(/\n+$/, "");
		// Première occurrence gagnante : un encart n'a jamais deux fois la même
		// section, et si cela arrivait, la première est celle du bot.
		if (!sections.has(marqueur.role)) sections.set(marqueur.role, contenu);
	}

	return sections;
}

/** Langue déduite du lexique effectivement rencontré ; « en » par défaut. */
function deduireLangue(description: string): "fr" | "en" {
	RE_SECTIONS.lastIndex = 0;
	let trouve: RegExpExecArray | null = RE_SECTIONS.exec(description);
	while (trouve) {
		const entree = EN_TETES[trouve[1]!];
		if (entree?.langue) return entree.langue;
		trouve = RE_SECTIONS.exec(description);
	}
	return "en";
}

/** Lignes non vides d'une section. */
function lignesUtiles(section: string | undefined): string[] {
	if (!section) return [];
	return section.split("\n").filter((ligne) => ligne.trim().length > 0);
}

/** Sépare l'emoji de tête du reste de la ligne. */
function separerEmoji(ligne: string): { emoji: string | null; reste: string } {
	const trouve = RE_EMOJI.exec(ligne);
	if (!trouve) return { emoji: null, reste: ligne.trim() };
	return { emoji: trouve[1]!, reste: ligne.slice(trouve[0].length).trim() };
}

interface LigneResultat {
	emoji: string | null;
	votes: number;
	pourcentage: number;
}

/** Analyse la section « Paramètres » — trois informations, ordre indifférent. */
function analyserParametres(
	lignes: string[],
	avertissements: string[]
): { ended: boolean; ends_at: Date | null; locked: boolean; max_choices: number } {
	let ended = false;
	let ends_at: Date | null = null;
	let locked = false;
	let max_choices: number | null = null;

	for (const ligne of lignes) {
		const nettoyee = ligne.trim();
		let reconnue = false;

		const fin = RE_FIN.exec(nettoyee);
		if (fin) {
			ended = true;
			ends_at = new Date(Number(fin[1]) * 1000);
			reconnue = true;
		}

		if (RE_VERROU.test(nettoyee)) {
			locked = true;
			reconnue = true;
		}

		if (RE_ILLIM.test(nettoyee)) {
			max_choices = 0;
			reconnue = true;
		} else {
			const chiffre = RE_CHOIX_N.exec(nettoyee);
			if (chiffre) {
				max_choices = Number(chiffre[1]);
				reconnue = true;
			} else {
				const mot = RE_CHOIX_MOT.exec(nettoyee);
				const nom = mot?.[1] ?? mot?.[2];
				if (nom && nom in MOTS_NOMBRES) {
					max_choices = MOTS_NOMBRES[nom]!;
					reconnue = true;
				}
			}
		}

		if (!reconnue) {
			avertissements.push(`ligne de paramètre non reconnue: ${nettoyee.slice(0, 80)}`);
		}
	}

	if (max_choices === null) {
		// Jamais un rejet : un sondage sans nombre de choix lisible reste un
		// sondage. On retombe sur le cas le plus fréquent (choix unique).
		avertissements.push("nombre de choix autorisés introuvable");
		max_choices = 1;
	}

	return { ended, ends_at, locked, max_choices };
}

/** Analyse la section de résultats — classement par RECONNAISSANCE, pas par rang. */
function analyserResultats(
	lignes: string[],
	avertissements: string[]
): { resultats: LigneResultat[]; total_votes: number | null; total_voters: number | null } {
	const resultats: LigneResultat[] = [];
	let total_votes: number | null = null;
	let total_voters: number | null = null;

	for (const ligne of lignes) {
		const nettoyee = ligne.trim();

		const totalV2 = RE_TOT_V2.exec(nettoyee);
		if (totalV2) {
			total_votes = Number(totalV2[1]);
			total_voters = Number(totalV2[2]);
			continue;
		}

		const totalV1 = RE_TOT_V1.exec(nettoyee);
		if (totalV1) {
			// PIÈGE CENTRAL : « 77 users voted » compte des VOTANTS. Sur un sondage
			// multi-choix la somme des votes le dépasse largement (167 pour 97
			// votants sur `a453e8bb`). Confondre les deux fausse tous les
			// pourcentages, qui se calculent sur le nombre de VOTES.
			total_voters = Number(totalV1[1]);
			continue;
		}

		const v2 = RE_RES_V2.exec(nettoyee);
		if (v2) {
			resultats.push({
				emoji: separerEmoji(nettoyee).emoji,
				pourcentage: Number(v2[1]),
				votes: Number(v2[2]),
			});
			continue;
		}

		const v1 = RE_RES_V1.exec(nettoyee);
		if (v1) {
			resultats.push({
				emoji: separerEmoji(nettoyee).emoji,
				votes: Number(v1[1]),
				pourcentage: Number(v1[2]),
			});
			continue;
		}

		avertissements.push(`ligne résultat non reconnue: ${nettoyee.slice(0, 80)}`);
	}

	return { resultats, total_votes, total_voters };
}

/**
 * Analyse un encart EasyPoll. FONCTION PURE : ni horloge, ni réseau, ni base.
 *
 * Rend `null` — et seulement `null`, jamais une exception — quand l'entrée n'est
 * pas un encart de sondage exploitable ; `journal.raison` dit alors pourquoi,
 * pour que l'orchestrateur puisse compter les motifs plutôt que les taire.
 */
export function parseEasyPollEmbed(
	description: string | null | undefined,
	footerText: string | null | undefined,
	message: MessageSondage,
	journal?: JournalDeRejet
): SondageExtrait | null {
	const refuser = (raison: string): null => {
		if (journal) journal.raison = raison;
		return null;
	};

	if (!description || description.trim().length === 0) {
		return refuser("encart sans description");
	}

	const identifiant = RE_ID.exec((footerText ?? "").trim());
	if (!identifiant) return refuser("pied d'encart illisible");

	const d = description.replace(/\r\n/g, "\n");
	const sections = decouperSections(d);
	const langue = deduireLangue(d);
	const avertissements: string[] = [];

	const question = sections.get("question")?.trim();
	if (question === undefined) return refuser("section question absente");
	if (question.length === 0) return refuser("question vide");

	const lignesChoix = lignesUtiles(sections.get("choix"));
	if (lignesChoix.length === 0) return refuser("section choix absente");

	const options: OptionExtraite[] = lignesChoix.map((ligne, position) => {
		const { emoji, reste } = separerEmoji(ligne);
		if (!emoji) avertissements.push(`choix ${position} sans emoji`);
		if (reste.length === 0) avertissements.push(`libellé de choix vide en ${position}`);
		return { position, emoji, label: reste, votes: null, pourcentage: null };
	});

	const sectionResultats = sections.get("resultats");
	let results_hidden = true;
	let total_votes: number | null = null;
	let total_voters: number | null = null;

	if (sectionResultats !== undefined) {
		results_hidden = false;
		const analyse = analyserResultats(lignesUtiles(sectionResultats), avertissements);
		total_voters = analyse.total_voters;

		if (analyse.resultats.length !== options.length) {
			avertissements.push(
				`${analyse.resultats.length} ligne(s) de résultat pour ${options.length} choix`
			);
		}

		let somme = 0;
		for (const [rang, resultat] of analyse.resultats.entries()) {
			somme += resultat.votes;
			const option = options[rang];
			if (!option) continue;
			if (resultat.emoji && option.emoji && resultat.emoji !== option.emoji) {
				avertissements.push(`emoji résultat ≠ choix en ${rang}`);
			}
			option.votes = resultat.votes;
			option.pourcentage = resultat.pourcentage;
		}

		if (analyse.total_votes !== null) {
			total_votes = analyse.total_votes;
		} else {
			// Ère 1 : seul le nombre de votants est déclaré, le nombre de votes se
			// reconstitue par somme (et il la dépasse sur un sondage multi-choix).
			total_votes = somme;
			if (analyse.total_voters === null) {
				avertissements.push("aucune ligne de total reconnue");
			}
		}
	}

	const parametres = analyserParametres(lignesUtiles(sections.get("parametres")), avertissements);

	return {
		poll_id: identifiant[1]!,
		uuid: null,
		provider: "easypoll",
		source: "embed",
		langue,
		message_id: message.message_id,
		channel_id: message.channel_id,
		guild_id: message.guild_id,
		question,
		creator_id: null,
		creator_username: null,
		command: null,
		max_choices: parametres.max_choices,
		locked: parametres.locked,
		ended: parametres.ended,
		ends_at: parametres.ends_at,
		total_votes,
		total_voters,
		results_hidden,
		raw: null,
		created_at: message.created_at,
		options,
		avertissements,
		notes: [],
	};
}

// ─── SONDAGE NATIF DISCORD ───────────────────────────────────────────────────

interface PollNatif {
	question?: { text?: string | null } | null;
	answers?: Array<{
		answer_id?: number;
		poll_media?: { text?: string | null; emoji?: { id?: string | null; name?: string | null } | null } | null;
	}> | null;
	results?: { is_finalized?: boolean; answer_counts?: Array<{ id?: number; count?: number }> } | null;
	expiry?: string | null;
	allow_multiselect?: boolean;
}

/**
 * Analyse un sondage NATIF Discord (deux dans tout le salon). Pure.
 *
 * Piège vérifié en base : `results.answer_counts` arrive DANS LE DÉSORDRE
 * (l'identifiant 2 avant le 1) — l'appariement se fait par `answer_id`, jamais
 * par position, sinon les deux décomptes sont intervertis.
 */
export function parseSondageNatif(
	poll: unknown,
	message: MessageSondage,
	journal?: JournalDeRejet
): SondageExtrait | null {
	const refuser = (raison: string): null => {
		if (journal) journal.raison = raison;
		return null;
	};

	if (!poll || typeof poll !== "object") return refuser("sondage natif absent");
	const natif = poll as PollNatif;

	const question = natif.question?.text?.trim();
	if (!question) return refuser("sondage natif sans question");

	const reponses = [...(natif.answers ?? [])].sort(
		(a, b) => (a.answer_id ?? 0) - (b.answer_id ?? 0)
	);
	if (reponses.length === 0) return refuser("sondage natif sans choix");

	const decomptes = new Map<number, number>();
	for (const compte of natif.results?.answer_counts ?? []) {
		if (typeof compte.id === "number") decomptes.set(compte.id, compte.count ?? 0);
	}
	const results_hidden = !natif.results;

	const options: OptionExtraite[] = reponses.map((reponse, position) => {
		const emojiBrut = reponse.poll_media?.emoji ?? null;
		const emoji = emojiBrut?.id
			? `<:${emojiBrut.name ?? ""}:${emojiBrut.id}>`
			: (emojiBrut?.name ?? null);
		const votes = results_hidden ? null : (decomptes.get(reponse.answer_id ?? -1) ?? 0);
		return {
			position,
			emoji,
			label: reponse.poll_media?.text ?? "",
			votes,
			pourcentage: null,
		};
	});

	const total_votes = results_hidden
		? null
		: options.reduce((somme, option) => somme + (option.votes ?? 0), 0);

	// Pourcentages recalculés ici : Discord ne les publie pas.
	if (total_votes && total_votes > 0) {
		for (const option of options) {
			option.pourcentage = Math.round(((option.votes ?? 0) / total_votes) * 10000) / 100;
		}
	}

	return {
		poll_id: message.message_id,
		uuid: null,
		provider: "discord",
		source: "embed",
		// Pas d'encart, donc pas de lexique : la langue n'a rien à dire ici.
		langue: null,
		message_id: message.message_id,
		channel_id: message.channel_id,
		guild_id: message.guild_id,
		question,
		// Sur un sondage natif l'auteur du message EST le créateur (2/2 vérifiés) :
		// aucune déduction, donc aucun risque de fausse attribution.
		creator_id: message.author_id,
		creator_username: message.author_username,
		command: null,
		max_choices: natif.allow_multiselect ? 0 : 1,
		locked: false,
		ended: natif.results?.is_finalized === true,
		ends_at: natif.expiry ? new Date(natif.expiry) : null,
		total_votes,
		// Sans multi-choix, un votant = un vote ; avec, le nombre de votants est
		// inconnu et ne s'invente pas.
		total_voters: natif.allow_multiselect ? null : total_votes,
		results_hidden,
		raw: natif,
		created_at: message.created_at,
		options,
		avertissements: [],
		notes: [],
	};
}

// ─── RECONSTITUTION PAR LES RÉACTIONS ────────────────────────────────────────

/** Clé de comparaison d'une réaction, au même format que `option.emoji`. */
function cleReaction(reaction: ReactionBrute): string {
	return reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
}

/**
 * Reconstitue les décomptes depuis les réactions archivées.
 *
 * QUATRE GARDE-FOUS, chacun pour une raison mesurée :
 *  1. `results_hidden` — L'ENCART PRIME TOUJOURS. Quinze sondages à résultats
 *     publiés ont AUSSI des réactions parfaitement alignées : sans ce test on
 *     remplacerait quinze décomptes exacts par des estimations.
 *  2. `provider === "easypoll"` — un sondage natif n'a jamais voté par réaction.
 *  3. antériorité à `FIN_ERE_REACTIONS` — après mai 2024 les réactions sont
 *     sociales (un `<:RG_hurley_like:…>` ×9, un 💤 ×1 dans le corpus).
 *  4. égalité STRICTE des emoji (même longueur, même ordre, même valeur) — c'est
 *     la bretelle qui rejette toute réaction décorative.
 *
 * Rend le sondage INCHANGÉ si l'un des quatre refuse.
 */
export function appliquerVotesDepuisReactions(
	sondage: SondageExtrait,
	reactions: ReactionBrute[]
): SondageExtrait {
	if (!sondage.results_hidden) return sondage;
	if (sondage.provider !== "easypoll") return sondage;
	if (sondage.created_at.getTime() >= FIN_ERE_REACTIONS.getTime()) return sondage;
	if (reactions.length !== sondage.options.length || reactions.length === 0) return sondage;

	for (const [rang, reaction] of reactions.entries()) {
		if (cleReaction(reaction) !== sondage.options[rang]?.emoji) return sondage;
	}

	// `count - 1` : EasyPoll amorce chaque choix de sa propre réaction. Étalonné
	// sur les quinze sondages qui ont à la fois des résultats publiés et des
	// réactions alignées : exact sur 65 options / 70, écart borné à [-1, +2].
	const votes = reactions.map((reaction) => Math.max(reaction.count - 1, 0));
	const total = votes.reduce((somme, valeur) => somme + valeur, 0);

	return {
		...sondage,
		source: "reactions",
		// `results_hidden` RESTE vrai : c'est l'ENCART qui ne publie rien. C'est la
		// sémantique documentée par la migration, et la raison d'être de l'index
		// partiel `discord_polls_a_completer_idx`.
		results_hidden: true,
		total_votes: total,
		// Le nombre de votants distincts est inconnu : ne JAMAIS l'inventer.
		total_voters: null,
		options: sondage.options.map((option, rang) => ({
			...option,
			votes: votes[rang] ?? 0,
			pourcentage: total > 0 ? Math.round(((votes[rang] ?? 0) / total) * 10000) / 100 : 0,
		})),
		raw: {
			reconstitution: "reactions",
			reactions,
			note: "count - 1 (réaction d'amorçage du bot)",
		},
		// La reconstitution va dans `notes`, PAS dans `avertissements` : elle est
		// attendue et sans gravité, alors que les avertissements sont le canari
		// d'une ère d'encart inconnue. Mélangées, elle en noyait le signal — 25
		// entrées sur 51 sondages, pour un rapport censé rester vide.
		avertissements: sondage.avertissements,
		notes: [...sondage.notes, "décompte reconstitué depuis les réactions (± 1 vote)"],
	};
}

// ─── VISUEL RATTACHÉ ─────────────────────────────────────────────────────────

/** Médias exploitables d'un message humain, dans leur ordre d'apparition. */
function mediasDuMessage(
	message: MessageHumainAvecMedia
): Array<Omit<VisuelRattache, "message_id" | "ecart_s">> {
	const medias: Array<Omit<VisuelRattache, "message_id" | "ecart_s">> = [];

	for (const piece of message.attachments ?? []) {
		const type = piece.content_type ?? "";
		if (!type.startsWith("image/")) continue;
		if (!piece.url || !piece.id) continue;
		medias.push({
			attachment_id: piece.id,
			url: piece.url,
			content_type: type,
			width: piece.width ?? null,
			height: piece.height ?? null,
			alt: piece.description ?? null,
			taille: piece.size ?? null,
		});
	}

	// Repli sur la vignette d'un encart : un GIF Tenor partagé par lien n'est pas
	// une pièce jointe, mais c'est bien le visuel auquel la question renvoie.
	for (const [rang, encart] of (message.embeds ?? []).entries()) {
		const media = encart?.image ?? encart?.thumbnail;
		if (!media?.url) continue;
		medias.push({
			attachment_id: `embed-${rang}`,
			url: media.url,
			content_type: "image/*",
			width: media.width ?? null,
			height: media.height ?? null,
			alt: null,
			taille: null,
		});
	}

	return medias;
}

/**
 * Choisit le visuel d'un sondage parmi les messages humains du salon. Pure.
 *
 * Règle mesurée : même salon, auteur humain, ±15 min, le plus proche AVANT
 * (`created_at <= encart`) ; à défaut le plus proche après — quatre visuels sont
 * postés juste APRÈS l'encart (« le croquis montré n'est qu'à titre indicatif »).
 */
export function choisirVisuel(
	sondage: { created_at: Date },
	messagesHumains: MessageHumainAvecMedia[],
	fenetreMs: number = FENETRE_VISUEL_MS
): VisuelRattache | null {
	const instant = sondage.created_at.getTime();
	let avant: VisuelRattache | null = null;
	let avantMs = Number.POSITIVE_INFINITY;
	let apres: VisuelRattache | null = null;
	let apresMs = Number.POSITIVE_INFINITY;

	for (const message of messagesHumains) {
		const ecart = message.created_at.getTime() - instant;
		if (Math.abs(ecart) > fenetreMs) continue;

		const media = mediasDuMessage(message)[0];
		if (!media) continue;

		const candidat: VisuelRattache = {
			...media,
			message_id: message.message_id,
			ecart_s: Math.round(ecart / 1000),
		};

		// L'écart est comparé en MILLISECONDES : `ecart_s` est arrondi, et deux
		// candidats de la même seconde se départageraient alors au hasard.
		if (ecart <= 0) {
			if (Math.abs(ecart) < avantMs) {
				avant = candidat;
				avantMs = Math.abs(ecart);
			}
		} else if (ecart < apresMs) {
			apres = candidat;
			apresMs = ecart;
		}
	}

	return avant ?? apres;
}

/** Extension de fichier déduite du type MIME, à défaut du nom d'origine. */
function extensionDepuis(contentType: string, url: string): string {
	const table: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/jpg": "jpg",
		"image/gif": "gif",
		"image/webp": "webp",
		"image/avif": "avif",
	};
	const connue = table[contentType.toLowerCase().split(";")[0]!.trim()];
	if (connue) return connue;
	const nom = url.split("?")[0]!.split("/").pop() ?? "";
	const extension = nom.includes(".") ? nom.split(".").pop()! : "";
	return /^[a-z0-9]{2,5}$/i.test(extension) ? extension.toLowerCase() : "bin";
}

/** Chemin DÉTERMINISTE du visuel dans le bucket (donc idempotent). */
export function cheminVisuel(pollId: string, visuel: VisuelRattache): string {
	return `${PREFIXE_VISUELS}/${pollId}/${visuel.attachment_id}.${extensionDepuis(visuel.content_type, visuel.url)}`;
}

// ─── CHAPÔ ───────────────────────────────────────────────────────────────────

/**
 * Texte de présentation affichable de l'encart.
 *
 * Vingt-huit encarts portent un `content`, mais dix ne sont QU'un ping de rôle :
 * publier `<@&1136286992620064778>` sur le site n'aurait aucun sens. On retire
 * donc les mentions de rôle nues et on ne garde que ce qui reste.
 */
export function chapoUtilisable(content: string): string | null {
	const nettoye = (content ?? "").replace(/<@&\d+>/g, "").trim();
	return nettoye.length > 0 ? nettoye : null;
}

// ─── ORCHESTRATION ───────────────────────────────────────────────────────────

export interface OptionsImportSondages {
	/** Défaut : tous les salons `suivi = true`. */
	salonId?: string;
	/** N messages les plus récents examinés par salon. */
	limite?: number;
	/** Aucune écriture, ni Postgres, ni Storage. */
	dry?: boolean;
	/** Enrichissement `creator_*` / `command` / `uuid` par l'API Discord. */
	avecDiscord?: boolean;
	/** Recopie des visuels dans le bucket public. */
	avecVisuels?: boolean;
}

export interface StatsSalonSondages {
	channel_id: string;
	name: string;
	analyses: number;
	retenus: number;
	inseres: number;
	mis_a_jour: number;
	inchanges: number;
	ignores: number;
	raisons: Record<string, number>;
	avertissements: Array<{ poll_id: string; motifs: string[] }>;
	reconstitues_par_reactions: number;
	visuels_rattaches: number;
	visuels_televerses: number;
	visuels_echecs: number;
	createurs_enrichis: number;
	uuids_enrichis: number;
	error?: string;
}

export interface StatsSondages {
	salons: StatsSalonSondages[];
	retenus: number;
	inseres: number;
	mis_a_jour: number;
	inchanges: number;
	ignores: number;
	dry: boolean;
	durationMs: number;
}

interface LigneMessageCandidat {
	message_id: string;
	channel_id: string;
	guild_id: string;
	author_id: string;
	author_username: string | null;
	author_is_bot: boolean;
	type: number;
	content: string | null;
	created_at: string | Date;
	description: string | null;
	footer: string | null;
	reactions: ReactionBrute[] | null;
	poll: unknown;
}

interface LigneMessageMedia {
	message_id: string;
	created_at: string | Date;
	content: string | null;
	attachments: PieceJointeBrute[] | null;
	embeds: EncartBrut[] | null;
}

interface LigneSalon {
	channel_id: string;
	guild_id: string;
	name: string;
}

interface LigneExistante {
	poll_id: string;
	creator_id: string | null;
	uuid: string | null;
	command: string | null;
	visual_path: string | null;
}

/**
 * Métadonnées d'interaction : absentes de la BASE (les 22 colonnes de
 * `discord_messages` ne les archivent pas) mais toujours rendues par l'API.
 *
 * DEUX CHAMPS, PAS UN : Discord sert `interaction_metadata` sur les messages
 * récents et l'ancien champ `interaction` (déprécié mais bien vivant) sur les
 * plus vieux. Mesuré le 12/8/2026 sur les 49 encarts du salon : 20 en
 * `interaction_metadata`, 24 en `interaction`, 5 sans rien (exactement les cinq
 * messages de `type = 0`). Ne lire que le champ moderne ferait perdre plus de la
 * moitié des créateurs — et laisserait croire que l'information n'existe pas.
 */
interface InteractionApi {
	name?: string;
	user_id?: string;
	user?: { id?: string; username?: string } | string;
}

interface MessageApiDiscord {
	interaction_metadata?: InteractionApi | null;
	interaction?: InteractionApi | null;
	components?: unknown;
}

/** Parcourt récursivement les composants pour y trouver l'UUID EasyPoll. */
function extraireUuid(composants: unknown): string | null {
	if (!composants) return null;
	if (Array.isArray(composants)) {
		for (const enfant of composants) {
			const trouve = extraireUuid(enfant);
			if (trouve) return trouve;
		}
		return null;
	}
	if (typeof composants !== "object") return null;
	const noeud = composants as { custom_id?: unknown; components?: unknown };
	if (typeof noeud.custom_id === "string") {
		const trouve = /^polls\/([0-9a-f-]{36})\/participants$/.exec(noeud.custom_id);
		if (trouve) return trouve[1]!;
	}
	return extraireUuid(noeud.components);
}

/**
 * Recopie un visuel dans le bucket public `assets`.
 *
 * Le téléchargement (avec re-signature de l'URL périmée) et l'écriture dans le
 * Storage vivent dans `lib/storage-assets.ts` : la récolte des créations de
 * campagne fait exactement la même chose, et deux copies de ce traitement
 * finiraient par diverger sur la gestion d'une URL expirée.
 */
async function televerserVisuel(
	salonId: string,
	chemin: string,
	visuel: VisuelRattache
): Promise<{ ok: boolean; motif?: string }> {
	const fichier = await telechargerPieceJointeDiscord(
		salonId,
		visuel.url,
		TAILLE_VISUEL_MAX,
		visuel.content_type
	);
	if (!fichier.ok) return { ok: false, motif: fichier.motif };

	return televerserObjet(BUCKET_VISUELS, chemin, fichier.octets, fichier.typeMime);
}

/** Écrit un sondage et ses choix. Une transaction par sondage. */
async function enregistrerSondage(
	sondage: SondageExtrait,
	visuel: { message_id: string; attachment_id: string; chemin: string | null; width: number | null; height: number | null; alt: string | null } | null
): Promise<"insere" | "mis_a_jour" | "inchange"> {
	return sql.begin(async (tx) => {
		const lignes = await tx<Array<{ insere: boolean }>>`
			INSERT INTO discord_polls (
				poll_id, uuid, provider, source, message_id, channel_id, guild_id,
				question, language, creator_id, creator_username, command,
				max_choices, locked, ended, ends_at,
				total_votes, total_voters, results_hidden, raw,
				visual_message_id, visual_attachment_id, visual_path, visual_width, visual_height, visual_alt,
				created_at, updated_at
			) VALUES (
				${sondage.poll_id}, ${sondage.uuid}, ${sondage.provider}, ${sondage.source},
				${sondage.message_id}, ${sondage.channel_id}, ${sondage.guild_id},
				${sondage.question}, ${sondage.langue}, ${sondage.creator_id},
				${sondage.creator_username}, ${sondage.command},
				${sondage.max_choices}, ${sondage.locked}, ${sondage.ended},
				${sondage.ends_at ? sondage.ends_at.toISOString() : null},
				${sondage.total_votes}, ${sondage.total_voters}, ${sondage.results_hidden},
				${sondage.raw ?? null},
				${visuel?.message_id ?? null}, ${visuel?.attachment_id ?? null}, ${visuel?.chemin ?? null},
				${visuel?.width ?? null}, ${visuel?.height ?? null}, ${visuel?.alt ?? null},
				${sondage.created_at.toISOString()}, now()
			)
			ON CONFLICT (poll_id) DO UPDATE SET
				-- Champs d'ENRICHISSEMENT : COALESCE. Une passe sans jeton Discord ou
				-- sans recopie de visuel ne doit jamais effacer ce qu'une passe
				-- précédente avait trouvé.
				uuid                 = COALESCE(EXCLUDED.uuid,                 discord_polls.uuid),
				creator_id           = COALESCE(EXCLUDED.creator_id,           discord_polls.creator_id),
				creator_username     = COALESCE(EXCLUDED.creator_username,     discord_polls.creator_username),
				command              = COALESCE(EXCLUDED.command,              discord_polls.command),
				visual_message_id    = COALESCE(EXCLUDED.visual_message_id,    discord_polls.visual_message_id),
				visual_attachment_id = COALESCE(EXCLUDED.visual_attachment_id, discord_polls.visual_attachment_id),
				visual_path          = COALESCE(EXCLUDED.visual_path,          discord_polls.visual_path),
				visual_width         = COALESCE(EXCLUDED.visual_width,         discord_polls.visual_width),
				visual_height        = COALESCE(EXCLUDED.visual_height,        discord_polls.visual_height),
				visual_alt           = COALESCE(EXCLUDED.visual_alt,           discord_polls.visual_alt),
				-- Champs issus de l'ANALYSE : écrasés, l'encart fait foi.
				provider = EXCLUDED.provider, source = EXCLUDED.source, language = EXCLUDED.language,
				message_id = EXCLUDED.message_id, question = EXCLUDED.question,
				max_choices = EXCLUDED.max_choices, locked = EXCLUDED.locked, ended = EXCLUDED.ended,
				ends_at = EXCLUDED.ends_at, total_votes = EXCLUDED.total_votes,
				total_voters = EXCLUDED.total_voters, results_hidden = EXCLUDED.results_hidden,
				raw = EXCLUDED.raw, created_at = EXCLUDED.created_at,
				updated_at = now()
			-- Sans cette clause, chaque passe rejouerait une notification
			-- rg_realtime_notify() par ligne vers un flux SSE qui n'a rien à
			-- apprendre : c'est exactement le défaut qu'évite enregistrerMessage().
			WHERE  discord_polls.question       IS DISTINCT FROM EXCLUDED.question
			   OR  discord_polls.source         IS DISTINCT FROM EXCLUDED.source
			   OR  discord_polls.language       IS DISTINCT FROM EXCLUDED.language
			   OR  discord_polls.max_choices    IS DISTINCT FROM EXCLUDED.max_choices
			   OR  discord_polls.locked         IS DISTINCT FROM EXCLUDED.locked
			   OR  discord_polls.ended          IS DISTINCT FROM EXCLUDED.ended
			   OR  discord_polls.ends_at        IS DISTINCT FROM EXCLUDED.ends_at
			   OR  discord_polls.total_votes    IS DISTINCT FROM EXCLUDED.total_votes
			   OR  discord_polls.total_voters   IS DISTINCT FROM EXCLUDED.total_voters
			   OR  discord_polls.results_hidden IS DISTINCT FROM EXCLUDED.results_hidden
			   OR  discord_polls.raw            IS DISTINCT FROM EXCLUDED.raw
			   OR  discord_polls.message_id     IS DISTINCT FROM EXCLUDED.message_id
			   OR  discord_polls.created_at     IS DISTINCT FROM EXCLUDED.created_at
			   OR  discord_polls.uuid           IS DISTINCT FROM COALESCE(EXCLUDED.uuid,        discord_polls.uuid)
			   OR  discord_polls.creator_id     IS DISTINCT FROM COALESCE(EXCLUDED.creator_id,  discord_polls.creator_id)
			   OR  discord_polls.command        IS DISTINCT FROM COALESCE(EXCLUDED.command,     discord_polls.command)
			   OR  discord_polls.visual_path    IS DISTINCT FROM COALESCE(EXCLUDED.visual_path, discord_polls.visual_path)
			   OR  discord_polls.visual_message_id IS DISTINCT FROM COALESCE(EXCLUDED.visual_message_id, discord_polls.visual_message_id)
			RETURNING (xmax = 0) AS insere
		`;

		let etat: "insere" | "mis_a_jour" | "inchange" = "inchange";
		if (lignes[0]) etat = lignes[0].insere ? "insere" : "mis_a_jour";

		for (const option of sondage.options) {
			await tx`
				INSERT INTO discord_poll_options (poll_id, position, emoji, label, votes, percentage)
				VALUES (${sondage.poll_id}, ${option.position}, ${option.emoji}, ${option.label},
				        ${option.votes}, ${option.pourcentage})
				ON CONFLICT (poll_id, position) DO UPDATE SET
					emoji = EXCLUDED.emoji, label = EXCLUDED.label,
					votes = EXCLUDED.votes, percentage = EXCLUDED.percentage
				WHERE (discord_poll_options.emoji, discord_poll_options.label,
				       discord_poll_options.votes, discord_poll_options.percentage)
				   IS DISTINCT FROM (EXCLUDED.emoji, EXCLUDED.label,
				                     EXCLUDED.votes, EXCLUDED.percentage)
			`;
		}

		// Un sondage réanalysé peut rétrécir : on purge la queue plutôt que de
		// tout supprimer puis réinsérer, ce qui ferait clignoter la page.
		await tx`
			DELETE FROM discord_poll_options
			 WHERE poll_id = ${sondage.poll_id} AND position >= ${sondage.options.length}
		`;

		return etat;
	});
}

/** Convertit une valeur de colonne timestamptz en `Date`. */
function versDate(valeur: string | Date): Date {
	return valeur instanceof Date ? valeur : new Date(valeur);
}

/**
 * Import complet et idempotent des sondages des salons suivis.
 * Un salon en échec n'interrompt pas les autres ; `success: false` seulement
 * quand TOUS échouent.
 */
export async function runDiscordPollsImport(
	options: OptionsImportSondages = {}
): Promise<{ success: boolean; error?: string; stats?: StatsSondages }> {
	const debut = Date.now();
	const dry = options.dry === true;
	const avecDiscord = options.avecDiscord !== false && Boolean(DISCORD_TOKEN);
	const avecVisuels = options.avecVisuels !== false;
	const limite = options.limite && options.limite > 0 ? options.limite : 100000;

	console.info(`${PREFIXE} Import des sondages${dry ? " (à blanc)" : ""}...`);

	try {
		const salons = options.salonId
			? await sql<LigneSalon[]>`
					SELECT channel_id, guild_id, name FROM discord_channels
					 WHERE suivi AND channel_id = ${options.salonId}`
			: await sql<LigneSalon[]>`
					SELECT channel_id, guild_id, name FROM discord_channels
					 WHERE suivi ORDER BY position NULLS LAST, channel_id`;

		if (salons.length === 0) {
			console.warn(`${PREFIXE} Aucun salon suivi : rien à importer.`);
			return {
				success: true,
				stats: {
					salons: [],
					retenus: 0,
					inseres: 0,
					mis_a_jour: 0,
					inchanges: 0,
					ignores: 0,
					dry,
					durationMs: Date.now() - debut,
				},
			};
		}

		const rapport: StatsSalonSondages[] = [];

		for (const salon of salons) {
			const stats: StatsSalonSondages = {
				channel_id: salon.channel_id,
				name: salon.name,
				analyses: 0,
				retenus: 0,
				inseres: 0,
				mis_a_jour: 0,
				inchanges: 0,
				ignores: 0,
				raisons: {},
				avertissements: [],
				reconstitues_par_reactions: 0,
				visuels_rattaches: 0,
				visuels_televerses: 0,
				visuels_echecs: 0,
				createurs_enrichis: 0,
				uuids_enrichis: 0,
			};

			try {
				// Le filtre porte sur le PIED D'ENCART, jamais sur l'identifiant
				// applicatif du bot : un humain ne peut pas fabriquer un pied
				// d'encart, et un ré-hébergement d'EasyPoll ne casserait pas l'import.
				// `type <> 46` écarte les récapitulatifs POLL_RESULT, qui feraient
				// doublon avec les sondages natifs auxquels ils se réfèrent.
				const candidats = await sql<LigneMessageCandidat[]>`
					SELECT m.message_id, m.channel_id, m.guild_id, m.author_id, m.author_username,
					       m.author_is_bot, m.type, m.content, m.created_at,
					       m.embeds->0->>'description'    AS description,
					       m.embeds->0->'footer'->>'text' AS footer,
					       COALESCE(m.reactions, '[]'::jsonb) AS reactions,
					       m.poll
					  FROM discord_messages m
					 WHERE m.channel_id = ${salon.channel_id}
					   AND m.deleted_at IS NULL
					   AND m.type <> 46
					   AND (
					        (m.author_is_bot = true
					         AND m.embeds->0->'footer'->>'text' ~* '^(Poll ID:|ID du sondage :)')
					     OR m.poll IS NOT NULL
					   )
					 ORDER BY m.created_at DESC
					 LIMIT ${limite}
				`;

				const messagesMedia = await sql<LigneMessageMedia[]>`
					SELECT m.message_id, m.created_at, m.content, m.attachments, m.embeds
					  FROM discord_messages m
					 WHERE m.channel_id = ${salon.channel_id}
					   AND m.author_is_bot = false
					   AND m.deleted_at IS NULL
					 ORDER BY m.created_at
				`;

				const humains: MessageHumainAvecMedia[] = messagesMedia.map((ligne) => ({
					message_id: ligne.message_id,
					created_at: versDate(ligne.created_at),
					content: ligne.content ?? "",
					attachments: ligne.attachments ?? [],
					embeds: ligne.embeds ?? [],
				}));

				const existantes = await sql<LigneExistante[]>`
					SELECT poll_id, creator_id, uuid, command, visual_path
					  FROM discord_polls WHERE channel_id = ${salon.channel_id}
				`;
				const dejaEnBase = new Map(existantes.map((ligne) => [ligne.poll_id, ligne]));

				for (const ligne of candidats) {
					stats.analyses++;
					const message: MessageSondage = {
						message_id: ligne.message_id,
						channel_id: ligne.channel_id,
						guild_id: ligne.guild_id,
						created_at: versDate(ligne.created_at),
						content: ligne.content ?? "",
						reactions: ligne.reactions ?? [],
						author_id: ligne.author_id,
						author_username: ligne.author_username,
						author_is_bot: ligne.author_is_bot,
						type: ligne.type,
					};

					const journal: JournalDeRejet = {};
					let sondage = ligne.poll
						? parseSondageNatif(ligne.poll, message, journal)
						: parseEasyPollEmbed(ligne.description, ligne.footer, message, journal);

					if (!sondage) {
						stats.ignores++;
						const motif = journal.raison ?? "motif inconnu";
						stats.raisons[motif] = (stats.raisons[motif] ?? 0) + 1;
						console.warn(`${PREFIXE} ${ligne.message_id} ignoré : ${motif}.`);
						continue;
					}

					const avant = sondage.source;
					sondage = appliquerVotesDepuisReactions(sondage, message.reactions);
					if (sondage.source === "reactions" && avant !== "reactions") {
						stats.reconstitues_par_reactions++;
					}

					const existante = dejaEnBase.get(sondage.poll_id);

					// Enrichissement Discord : `interaction_metadata` n'existe pas en
					// base (22 colonnes, vérifié) mais l'API le rend encore. JAMAIS par
					// adjacence : évaluée contre l'API, l'adjacence produit une fausse
					// attribution d'opinion, ce qui n'est pas rattrapable sur une page
					// publique.
					// On ne rappelle QUE les lignes dont le créateur manque encore.
					// Chasser aussi les UUID manquants coûterait 45 appels par passe
					// pour rien : EasyPoll RETIRE le bouton « Participants » des vieux
					// encarts, l'UUID absent aujourd'hui ne réapparaîtra jamais. Le
					// `COALESCE` de l'upsert protège de toute façon ce qui est déjà là.
					if (avecDiscord && sondage.provider === "easypoll" && !existante?.creator_id) {
						const brut = await appelDiscordOuNull<MessageApiDiscord>(
							`/channels/${sondage.channel_id}/messages/${sondage.message_id}`
						);
						const meta = brut?.interaction_metadata ?? brut?.interaction;
						if (meta) {
							const utilisateur = typeof meta.user === "object" ? meta.user : null;
							sondage.creator_id = meta.user_id ?? utilisateur?.id ?? null;
							sondage.creator_username =
								(typeof meta.user === "string" ? meta.user : utilisateur?.username) ?? null;
							sondage.command = meta.name ?? null;
							if (sondage.creator_id) stats.createurs_enrichis++;
						}
						const uuid = extraireUuid(brut?.components);
						if (uuid) {
							sondage.uuid = uuid;
							stats.uuids_enrichis++;
						}
						// Politesse : sans cette pause Discord répond 429 sur presque
						// chaque appel (le seau de `GET /channels/…/messages/…` est
						// étroit). Le retry rattraperait, mais au prix d'une passe
						// deux fois plus longue et de journaux illisibles.
						await Bun.sleep(PAUSE_ENRICHISSEMENT_MS);
					}

					// Visuel : rattachement (pur) puis recopie (I/O).
					const visuel = choisirVisuel(sondage, humains);
					let visuelEcrit: Parameters<typeof enregistrerSondage>[1] = null;
					if (visuel) {
						stats.visuels_rattaches++;
						const chemin = cheminVisuel(sondage.poll_id, visuel);
						let cheminFinal: string | null = null;

						if (existante?.visual_path === chemin) {
							// Déjà recopié au même chemin déterministe : rien à refaire.
							cheminFinal = chemin;
						} else if (avecVisuels && !dry) {
							const envoi = await televerserVisuel(sondage.channel_id, chemin, visuel);
							if (envoi.ok) {
								cheminFinal = chemin;
								stats.visuels_televerses++;
							} else {
								stats.visuels_echecs++;
								sondage.avertissements.push(`visuel non recopié: ${envoi.motif ?? "?"}`);
							}
						}

						visuelEcrit = {
							message_id: visuel.message_id,
							attachment_id: visuel.attachment_id,
							// `visual_path` reste NULL en cas d'échec, mais le rattachement
							// est quand même écrit : la passe suivante retentera la recopie.
							chemin: cheminFinal,
							width: visuel.width,
							height: visuel.height,
							alt: visuel.alt,
						};
					}

					stats.retenus++;
					if (sondage.avertissements.length > 0) {
						stats.avertissements.push({
							poll_id: sondage.poll_id,
							motifs: sondage.avertissements,
						});
					}

					if (dry) continue;

					const etat = await enregistrerSondage(sondage, visuelEcrit);
					if (etat === "insere") stats.inseres++;
					else if (etat === "mis_a_jour") stats.mis_a_jour++;
					else stats.inchanges++;
				}

				console.info(
					`${PREFIXE} ${salon.name} : ${stats.retenus} retenu(s), ${stats.ignores} ignoré(s), ` +
						`${stats.reconstitues_par_reactions} reconstitué(s), ${stats.visuels_rattaches} visuel(s).`
				);
				if (stats.avertissements.length > 0) {
					console.warn(
						`${PREFIXE} ${salon.name} : ${stats.avertissements.length} sondage(s) avec avertissement — ` +
							stats.avertissements
								.slice(0, 5)
								.map((entree) => `${entree.poll_id}: ${entree.motifs.join(" / ")}`)
								.join(" | ")
					);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`${PREFIXE} Échec sur le salon ${salon.name} (${salon.channel_id}) :`, message);
				stats.error = message;
			}

			rapport.push(stats);
		}

		const stats: StatsSondages = {
			salons: rapport,
			retenus: rapport.reduce((somme, salon) => somme + salon.retenus, 0),
			inseres: rapport.reduce((somme, salon) => somme + salon.inseres, 0),
			mis_a_jour: rapport.reduce((somme, salon) => somme + salon.mis_a_jour, 0),
			inchanges: rapport.reduce((somme, salon) => somme + salon.inchanges, 0),
			ignores: rapport.reduce((somme, salon) => somme + salon.ignores, 0),
			dry,
			durationMs: Date.now() - debut,
		};

		const echecs = rapport.filter((salon) => salon.error);
		if (echecs.length === rapport.length) {
			return { success: false, error: echecs[0]?.error ?? "Tous les salons ont échoué.", stats };
		}
		return { success: true, stats };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`${PREFIXE} Erreur critique de l'import des sondages :`, err);
		return { success: false, error: message };
	}
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.main) {
	const args = Bun.argv.slice(2);
	const valeur = (nom: string): string | undefined => {
		const index = args.indexOf(nom);
		return index >= 0 ? args[index + 1] : undefined;
	};

	const resultat = await runDiscordPollsImport({
		dry: args.includes("--dry"),
		limite: Number(valeur("--limite")) || undefined,
		salonId: valeur("--salon"),
		avecDiscord: !args.includes("--sans-discord"),
		avecVisuels: !args.includes("--sans-visuels"),
	});

	console.info(`${PREFIXE} Résultat :`, JSON.stringify(resultat, null, 2));
	process.exit(resultat.success ? 0 : 1);
}
