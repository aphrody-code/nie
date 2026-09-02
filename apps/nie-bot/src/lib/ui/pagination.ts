/**
 * Pagination — état porté par le `customId`, boutons identiques partout.
 *
 * ── UN SEUL MODÈLE, ET IL EST SANS MÉMOIRE ─────────────────────────────────
 * Tout l'état d'une liste (page, filtres, recherche) tient dans l'identifiant
 * du bouton. Aucune carte en mémoire de processus : un redémarrage du service
 * ne laisse donc jamais de bouton mort, et deux membres peuvent parcourir la
 * même liste sans se voler leur position. C'est le modèle qu'avaient déjà
 * `/x`, `/azalee`, `/cpk`, `/cdn` et `/sondage` — chacun avec sa propre copie
 * du dessin des boutons. Quatre copies, quatre occasions de diverger : `/cdn`
 * affichait « Précédent / Suivant », `/azalee` intercalait un repère « 3 / 17 »,
 * `/x` ne montrait rien du tout au-delà de la première page.
 *
 * Ce fichier ne garde que le DESSIN. Le comptage des pages et la grammaire du
 * `customId` vivent dans `lib/ui/etat.ts`, module pur qu'il réexporte en entier
 * — une commande n'a donc qu'un seul import à écrire.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { LIMITES } from "./theme";
import { borner } from "./texte";
export * from "./etat";

// ─── Boutons ────────────────────────────────────────────────────────────────

/**
 * Seuil au-delà duquel les sauts « première / dernière » apparaissent.
 *
 * En dessous, deux clics suffisent à traverser la liste et deux boutons de plus
 * ne feraient qu'encombrer la rangée sur mobile.
 */
const SEUIL_SAUTS = 5;

export interface OptionsPagination {
	/** Préfixe de la surface, pour l'identifiant du repère (jamais cliquable). */
	prefixe: string;
	page: number;
	pages: number;
	/**
	 * Fabrique l'identifiant d'une page donnée. Renvoyer `null` (état trop long)
	 * fait disparaître TOUTE la rangée : mieux vaut pas de boutons que des
	 * boutons qui perdent les filtres.
	 */
	identifiant: (page: number) => string | null;
	/** Bouton de lien optionnel, posé à droite (« Ouvrir sur le site »). */
	lien?: { libelle: string; url: string; emoji?: string } | null;
}

/**
 * Rangée de pagination normalisée.
 *
 *     ⏮  ◀  « 3 / 17 »  ▶  ⏭
 *
 * Le repère central n'est jamais cliquable : sur mobile le pied de l'embed est
 * tronqué, et sans lui on ignore où l'on se trouve dans dix-sept pages.
 * Discord n'accepte que cinq composants par rangée — le bouton de lien part
 * donc dans une seconde rangée quand les sauts sont présents.
 */
export function rangeePagination(
	options: OptionsPagination
): Array<ActionRowBuilder<ButtonBuilder>> {
	const { prefixe, page, pages } = options;
	if (pages <= 1) {
		return options.lien ? [rangeeLien(options.lien)] : [];
	}

	const idPrecedent = options.identifiant(Math.max(1, page - 1));
	const idSuivant = options.identifiant(Math.min(pages, page + 1));
	if (!idPrecedent || !idSuivant) {
		return options.lien ? [rangeeLien(options.lien)] : [];
	}

	// ⚠ DEUX BOUTONS D'UNE MÊME RANGÉE NE PEUVENT PAS PARTAGER UN `customId`.
	// Discord refuse alors le message ENTIER (400 `Invalid Form Body`,
	// `COMPONENT_CUSTOM_ID_DUPLICATED`) — embed compris. Le membre ne voit rien,
	// pas même une erreur partielle.
	//
	// Or l'identifiant EST l'état : « aller à la page 1 » et « page précédente »
	// produisent la même chaîne dès que la page précédente EST la page 1. La
	// collision arrivait donc sur quatre pages sur N — 1, 2, N-1 et N — c'est-à-dire
	// y compris la toute première, celle que tout le monde voit. Constaté le
	// 13/8/2026 sur `/x liste`, et vrai de la même façon sur `/azalee`, `/cpk`,
	// `/cdn` et `/sondage`, qui partagent cette rangée.
	//
	// Le saut est RETIRÉ quand il fait doublon, jamais renommé : à ce moment-là il
	// n'apporte rien (la flèche voisine mène déjà au même endroit), et lui donner
	// un identifiant inerte laisserait un bouton qui ment sur ce qu'il fait.
	const avecSauts = pages > SEUIL_SAUTS;
	const idPremierBrut = avecSauts ? options.identifiant(1) : null;
	const idDernierBrut = avecSauts ? options.identifiant(pages) : null;
	const idPremier = idPremierBrut === idPrecedent ? null : idPremierBrut;
	const idDernier = idDernierBrut === idSuivant ? null : idDernierBrut;

	const boutons: ButtonBuilder[] = [];
	if (idPremier) {
		boutons.push(
			new ButtonBuilder()
				.setCustomId(idPremier)
				.setEmoji("⏮️")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page <= 1)
		);
	}
	boutons.push(
		new ButtonBuilder()
			.setCustomId(idPrecedent)
			.setEmoji("◀️")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page <= 1),
		new ButtonBuilder()
			.setCustomId(`${prefixe}-repere`)
			.setLabel(borner(`${page} / ${pages}`, LIMITES.libelleBouton))
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(true),
		new ButtonBuilder()
			.setCustomId(idSuivant)
			.setEmoji("▶️")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page >= pages)
	);
	if (idDernier) {
		boutons.push(
			new ButtonBuilder()
				.setCustomId(idDernier)
				.setEmoji("⏭️")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page >= pages)
		);
	}

	const rangees = [new ActionRowBuilder<ButtonBuilder>().addComponents(...boutons)];
	if (options.lien) {
		if (boutons.length < LIMITES.composantsParRangee) {
			rangees[0]!.addComponents(boutonLien(options.lien));
		} else {
			rangees.push(rangeeLien(options.lien));
		}
	}
	return rangees;
}

export interface OptionsLien {
	libelle: string;
	url: string;
	emoji?: string;
}

/**
 * Bouton de lien.
 *
 * Un bouton de style `Link` n'a PAS de `customId` et ne déclenche aucune
 * interaction : c'est le seul composant qui survit intact à un redémarrage du
 * bot, d'où son emploi systématique pour « ouvrir sur le site ».
 */
export function boutonLien(options: OptionsLien): ButtonBuilder {
	const bouton = new ButtonBuilder()
		.setStyle(ButtonStyle.Link)
		.setURL(options.url)
		.setLabel(borner(options.libelle, LIMITES.libelleBouton));
	if (options.emoji) {
		bouton.setEmoji(options.emoji);
	}
	return bouton;
}

function rangeeLien(options: OptionsLien): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(boutonLien(options));
}

/** Retire tous les boutons d'un message (fin de vie d'une confirmation, expiration). */
export const SANS_COMPOSANTS: ReadonlyArray<never> = Object.freeze([]);
