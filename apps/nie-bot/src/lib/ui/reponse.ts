/**
 * Réponses aux interactions — un seul pipeline pour les deux bots.
 *
 * ── LES QUATRE RÈGLES ──────────────────────────────────────────────────────
 *  1. DIFFÉRER D'ABORD. Discord n'accorde que trois secondes au premier accusé
 *     de réception ; toute commande qui touche Postgres, Redis ou une API
 *     interne les dépasse un jour ou l'autre. Différer coûte un aller-retour et
 *     rachète quinze minutes.
 *  2. PRIVÉ PAR DÉFAUT POUR L'EXPLOITATION, PUBLIC POUR LA COMMUNAUTÉ. Une
 *     réponse `/staff` ou `/administration` nomme des unités systemd, des ports
 *     en boucle locale, des identifiants internes : elle n'a rien à laisser
 *     dans l'historique d'un salon lu par deux mille personnes. Une fiche de
 *     jeu, elle, doit rester visible — c'est la moitié de son intérêt.
 *  3. UNE SEULE FORME D'ERREUR. Avant ce module, on comptait dans ce dépôt plus
 *     de deux cents réponses d'échec écrites à la main, en texte nu, avec trois
 *     icônes différentes et aucune couleur. Une panne ressemblait à un résultat.
 *  4. AUCUNE PILE D'APPELS DANS UN SALON. Le membre lit ce qu'il peut faire ; le
 *     détail technique va dans le journal du service.
 *
 * ── POURQUOI DES OBJETS DE CHARGE PLUTÔT QUE DES ENVOIS ────────────────────
 * `succes()`, `echec()`… rendent une CHARGE (`{ embeds, flags }`), pas un envoi.
 * L'appelante décide de `reply`, `editReply` ou `followUp` selon son état, et
 * peut composer (ajouter des composants, une pièce jointe). Les enveloppes
 * `repondre()` / `repondreEchec()` existent pour le cas courant.
 */
import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type EmbedBuilder,
	type InteractionEditReplyOptions,
	type InteractionReplyOptions,
	type MessageComponentInteraction,
	type RepliableInteraction,
} from "discord.js";

import { creerEmbed, pied, type OptionsEmbed, type OptionsPied } from "./embed";
import { ICONES } from "./theme";

// ─── Provenance ─────────────────────────────────────────────────────────────

/**
 * Chemin complet de la commande exécutée : `/agenda semaine`, `/staff web page`.
 *
 * Il part dans le pied de CHAQUE réponse. Sur un serveur de plus de deux mille
 * membres, la question qui suit une capture d'écran est toujours la même —
 * « t'as tapé quoi pour avoir ça ? » — et la réponse doit être dans l'image.
 */
export function cheminCommande(interaction: ChatInputCommandInteraction): string {
	const groupe = interaction.options.getSubcommandGroup(false);
	const sous = interaction.options.getSubcommand(false);
	return `/${[interaction.commandName, groupe, sous].filter(Boolean).join(" ")}`;
}

/**
 * Pied de page d'une réponse de commande : provenance, position, marque.
 *
 * À poser sur TOUT embed rendu par une commande. `pied()` (`lib/ui/embed.ts`)
 * reste utilisable directement quand aucune interaction n'est disponible —
 * annonces automatiques, messages postés par un service.
 */
export function piedDeCommande(
	embed: EmbedBuilder,
	interaction: ChatInputCommandInteraction,
	options: Omit<OptionsPied, "note"> & { note?: string | null } = {}
): EmbedBuilder {
	const note = options.note
		? `${options.note} · ${cheminCommande(interaction)}`
		: cheminCommande(interaction);
	return pied(embed, { ...options, note });
}

// ─── Différer ───────────────────────────────────────────────────────────────

/**
 * Diffère la réponse, une seule fois, sans jamais lever.
 *
 * Idempotente : une commande qui diffère puis appelle une garde qui diffère
 * aussi ne doit pas échouer sur `InteractionAlreadyReplied`.
 */
export async function differer(
	interaction: RepliableInteraction,
	options: { prive?: boolean } = {}
): Promise<void> {
	if (interaction.deferred || interaction.replied) {
		return;
	}
	await interaction.deferReply(options.prive ? { flags: MessageFlags.Ephemeral } : {});
}

/** Diffère en privé — la forme des surfaces d'exploitation. */
export async function differerEnPrive(interaction: RepliableInteraction): Promise<void> {
	await differer(interaction, { prive: true });
}

// ─── Charges normalisées ────────────────────────────────────────────────────

export interface OptionsMessage extends Omit<OptionsEmbed, "intention"> {
	/** Rendre la réponse visible du seul membre qui l'a demandée. */
	prive?: boolean;
	/** Note de provenance ajoutée au pied. */
	note?: string | null;
}

type Charge = InteractionReplyOptions & InteractionEditReplyOptions;

function charge(
	intention: OptionsEmbed["intention"],
	titre: string,
	description: string | undefined,
	options: OptionsMessage
): Charge {
	const embed = creerEmbed({ ...options, intention, titre, description });
	pied(embed, { note: options.note ?? null });
	return {
		embeds: [embed],
		...(options.prive ? { flags: MessageFlags.Ephemeral } : {}),
	} as Charge;
}

/** Une action a abouti. Le titre dit QUOI, la description dit l'effet observable. */
export function succes(titre: string, description?: string, options: OptionsMessage = {}): Charge {
	return charge("succes", titre, description, options);
}

/**
 * Une action a échoué.
 *
 * Le titre nomme ce qui a échoué, la description dit quoi faire — jamais une
 * trace d'appel. Privée par défaut : un échec n'appartient qu'à qui l'a
 * déclenché, et l'afficher publiquement invite quatre membres à le reproduire.
 */
export function echec(titre: string, description?: string, options: OptionsMessage = {}): Charge {
	return charge("echec", titre, description, { prive: true, ...options });
}

/** Un résultat partiel, une donnée périmée, une limite atteinte. */
export function attention(
	titre: string,
	description?: string,
	options: OptionsMessage = {}
): Charge {
	return charge("attention", titre, description, options);
}

/** Une information neutre : rappel de syntaxe, renvoi vers une autre commande. */
export function info(titre: string, description?: string, options: OptionsMessage = {}): Charge {
	return charge("info", titre, description, options);
}

/**
 * Aucun résultat — ce n'est ni un succès ni une panne.
 *
 * La description doit toujours dire la SUITE (élargir la recherche, retirer un
 * filtre) : « Aucun résultat » seul laisse le membre sans prochaine action.
 */
export function vide(titre: string, description?: string, options: OptionsMessage = {}): Charge {
	return charge("muet", `${ICONES.vide} ${titre}`, description, { icone: "", ...options });
}

/**
 * Accès refusé. Toujours privé, jamais détaillé : dire QUEL rôle manque à qui
 * n'en a aucun, c'est dessiner la carte de ce qu'il faut obtenir.
 */
export function refus(message: string): Charge {
	return charge("echec", "Accès refusé", message, { prive: true, icone: ICONES.interdit });
}

// ─── Envois ─────────────────────────────────────────────────────────────────

/**
 * Envoie une charge quel que soit l'état de l'interaction.
 *
 * `editReply` est le SEUL chemin possible après un `deferReply` — `reply()`
 * lèverait `InteractionAlreadyReplied` et la commande mourrait en laissant le
 * membre sur « réfléchit… » pour toujours.
 */
export async function repondre(interaction: RepliableInteraction, contenu: Charge): Promise<void> {
	if (interaction.deferred || interaction.replied) {
		// `flags` n'est pas modifiable après coup : une réponse déjà différée en
		// public ne peut plus devenir éphémère, et le passer ferait lever.
		const { flags: _ephemere, ...reste } = contenu;
		await interaction.editReply(reste as InteractionEditReplyOptions);
		return;
	}
	await interaction.reply(contenu as InteractionReplyOptions);
}

/** Raccourci du cas le plus fréquent : une panne rattrapée dans un `catch`. */
export async function repondreEchec(
	interaction: RepliableInteraction,
	titre: string,
	description?: string
): Promise<void> {
	await repondre(interaction, echec(titre, description));
}

// ─── Composants ─────────────────────────────────────────────────────────────

/**
 * Le membre qui clique est-il celui qui a lancé la commande ?
 *
 * Sans cette garde, n'importe qui peut faire tourner les pages de la liste d'un
 * autre — sur un serveur actif, c'est un message qui se dérobe sous les yeux de
 * son destinataire. Elle ne s'applique QU'aux surfaces personnelles : une liste
 * publique gagne à être parcourue par tout le monde, et le refuser produirait
 * autant de messages éphémères que de curieux.
 *
 * `message.interaction` est déprécié en discord.js 14.26 : c'est
 * `interactionMetadata` qui porte l'auteur de la commande d'origine.
 */
export function estAuteurDOrigine(interaction: MessageComponentInteraction): boolean {
	const origine = interaction.message.interactionMetadata?.user?.id;
	return origine === undefined || origine === interaction.user.id;
}

/** Refus standard opposé à un clic sur les composants d'un autre membre. */
export const REFUS_COMPOSANT =
	"Ces boutons appartiennent à la réponse d'un autre membre. Relance la commande pour avoir la tienne.";

/**
 * Applique la garde d'appartenance. `true` si le clic peut être traité.
 * Le refus part en éphémère : il ne doit pas encombrer le salon.
 */
export async function garderAuteur(interaction: MessageComponentInteraction): Promise<boolean> {
	if (estAuteurDOrigine(interaction)) {
		return true;
	}
	await interaction.reply(refus(REFUS_COMPOSANT) as InteractionReplyOptions);
	return false;
}
