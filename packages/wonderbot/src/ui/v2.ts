/**
 * Composants « V2 » de Discord — de quoi bâtir une vraie interface, pas un
 * bloc de texte coloré.
 *
 * ── POURQUOI PAS DES EMBEDS ────────────────────────────────────────────────
 * Un embed est un panneau figé : un titre, une description, des champs alignés
 * deux par deux, une seule image. On n'y compose rien. Les composants V2
 * donnent des CONTENEURS qu'on emboîte — une section porte son texte ET une
 * vignette à droite, une galerie porte jusqu'à dix images, un séparateur
 * respire. C'est ce qui permet une grille d'épisodes avec sa jaquette, une
 * rangée par arc, une fiche avec son bouton de lecture à côté du résumé.
 *
 * ── LE PRIX À PAYER, ET IL EST ENTIER ──────────────────────────────────────
 * Un message qui porte le drapeau {@link DRAPEAU_V2} ne peut plus avoir NI
 * `content` NI `embeds` : Discord refuse le message entier. Or le lecteur vidéo
 * intégré de Discord ne se déclenche QUE sur une URL nue posée dans `content`.
 *
 * Les deux ne cohabitent donc pas, et ce n'est pas contournable : c'est la
 * frontière que l'écran de lecture respecte en restant en V1 (URL nue + fiche +
 * boutons), tandis que tous les écrans de NAVIGATION passent en V2. Chacun
 * prend la forme qui sert son travail.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Rien ici n'importe discord.js : ces fonctions rendent le JSON que l'API
 * attend, que discord.js accepte tel quel dans `components`. Toute la mise en
 * page se teste donc sans jeton et sans passerelle.
 */

import { bornerTexte } from "./format.ts";

/**
 * Drapeau de message activant les composants V2 (`1 << 15`).
 *
 * Recopié plutôt qu'importé de discord.js, comme les types d'options de
 * commande : ce module doit rester chargeable sans la bibliothèque.
 */
export const DRAPEAU_V2 = 32_768;

/** Types de composants de l'API Discord (v10). */
export const TYPE_COMPOSANT = {
	rangee: 1,
	bouton: 2,
	selectChaine: 3,
	section: 9,
	texte: 10,
	vignette: 11,
	galerie: 12,
	separateur: 14,
	conteneur: 17,
} as const;

/** Styles de bouton de l'API Discord. */
export const STYLE_BOUTON = {
	primaire: 1,
	secondaire: 2,
	succes: 3,
	danger: 4,
	lien: 5,
} as const;

export type StyleBouton = (typeof STYLE_BOUTON)[keyof typeof STYLE_BOUTON];

/**
 * Limites dures des messages V2.
 *
 * Elles ne sont PAS celles des embeds : le budget de texte tombe à 4 000
 * caractères pour tout le message, et le nombre de composants est plafonné en
 * plus. Les dépasser fait refuser le message entier.
 */
export const LIMITES_V2 = {
	/** Somme de tous les `TextDisplay` d'un message. */
	texteTotal: 4000,
	/** Composants de premier niveau. */
	racines: 10,
	/** Composants au total, imbrication comprise. */
	total: 40,
	/** Images d'une galerie. */
	imagesGalerie: 10,
	/** Blocs de texte dans une section. */
	textesSection: 3,
	/** Boutons d'une rangée. */
	boutonsRangee: 5,
} as const;

export interface ComposantTexte {
	type: 10;
	content: string;
}

export interface ComposantVignette {
	type: 11;
	media: { url: string };
	description?: string;
	spoiler?: boolean;
}

export interface ComposantBouton {
	type: 2;
	style: StyleBouton;
	label?: string;
	emoji?: { name: string };
	custom_id?: string;
	url?: string;
	disabled?: boolean;
}

export interface ComposantSection {
	type: 9;
	components: ComposantTexte[];
	accessory: ComposantVignette | ComposantBouton;
}

export interface ComposantGalerie {
	type: 12;
	items: { media: { url: string }; description?: string }[];
}

export interface ComposantSeparateur {
	type: 14;
	divider?: boolean;
	spacing?: 1 | 2;
}

export interface ComposantRangee {
	type: 1;
	components: ComposantBouton[];
}

export interface ComposantConteneur {
	type: 17;
	accent_color?: number;
	spoiler?: boolean;
	components: ComposantV2[];
}

export type ComposantV2 =
	| ComposantTexte
	| ComposantSection
	| ComposantGalerie
	| ComposantSeparateur
	| ComposantRangee
	| ComposantRangeeSelect
	| ComposantConteneur;

/** Bloc de texte Markdown. */
export function texte(contenu: string): ComposantTexte {
	return { type: TYPE_COMPOSANT.texte, content: contenu };
}

/** Vignette d'accessoire — l'image à droite d'une section. */
export function vignette(url: string, description?: string): ComposantVignette {
	return {
		type: TYPE_COMPOSANT.vignette,
		media: { url },
		...(description ? { description: bornerTexte(description, 256) } : {}),
	};
}

/**
 * Section : du texte, et UN accessoire à sa droite.
 *
 * L'accessoire est ce qui rend la ligne cliquable ou illustrée — c'est la
 * brique d'une « carte » d'épisode. Au-delà de trois blocs de texte, Discord
 * refuse la section : on tronque plutôt que de faire échouer le message.
 */
export function section(
	textes: readonly string[],
	accessoire: ComposantVignette | ComposantBouton
): ComposantSection {
	return {
		type: TYPE_COMPOSANT.section,
		components: textes.slice(0, LIMITES_V2.textesSection).map(texte),
		accessory: accessoire,
	};
}

/**
 * Galerie d'images — la « rangée de jaquettes » d'un service de lecture.
 *
 * Les entrées sans URL sont écartées : Discord refuse un média vide, et une
 * source sur deux ne donne pas de vignette.
 */
export function galerie(
	images: readonly { url: string | null; description?: string }[]
): ComposantGalerie | null {
	const items = images
		.filter((image): image is { url: string; description?: string } =>
			typeof image.url === "string" && image.url.trim() !== ""
		)
		.slice(0, LIMITES_V2.imagesGalerie)
		.map((image) => ({
			media: { url: image.url },
			...(image.description ? { description: bornerTexte(image.description, 256) } : {}),
		}));
	return items.length === 0 ? null : { type: TYPE_COMPOSANT.galerie, items };
}

/** Trait de séparation. `divider` false = simple respiration. */
export function separateur(options: { trait?: boolean; large?: boolean } = {}): ComposantSeparateur {
	return {
		type: TYPE_COMPOSANT.separateur,
		divider: options.trait ?? true,
		spacing: options.large ? 2 : 1,
	};
}

/** Bouton d'action, identifié par son `custom_id`. */
export function bouton(options: {
	id: string;
	libelle?: string;
	emoji?: string;
	style?: StyleBouton;
	desactive?: boolean;
}): ComposantBouton {
	return {
		type: TYPE_COMPOSANT.bouton,
		style: options.style ?? STYLE_BOUTON.secondaire,
		custom_id: options.id,
		...(options.libelle ? { label: bornerTexte(options.libelle, 80) } : {}),
		...(options.emoji ? { emoji: { name: options.emoji } } : {}),
		...(options.desactive ? { disabled: true } : {}),
	};
}

/**
 * Bouton-lien. Il n'a PAS de `custom_id` — Discord refuse les deux ensemble —
 * et ne déclenche aucune interaction : il ouvre l'URL.
 */
export function boutonLien(url: string, libelle: string, emoji?: string): ComposantBouton {
	return {
		type: TYPE_COMPOSANT.bouton,
		style: STYLE_BOUTON.lien,
		url,
		label: bornerTexte(libelle, 80),
		...(emoji ? { emoji: { name: emoji } } : {}),
	};
}

/** Rangée de boutons — cinq au plus, le surplus est écarté. */
export function rangee(boutons: readonly ComposantBouton[]): ComposantRangee {
	return {
		type: TYPE_COMPOSANT.rangee,
		components: boutons.slice(0, LIMITES_V2.boutonsRangee),
	};
}

export interface OptionSelect {
	label: string;
	value: string;
	description?: string;
	emoji?: { name: string };
	default?: boolean;
}

export interface ComposantSelect {
	type: 3;
	custom_id: string;
	placeholder?: string;
	options: OptionSelect[];
}

export interface ComposantRangeeSelect {
	type: 1;
	components: [ComposantSelect];
}

/**
 * Rangée portant un menu déroulant.
 *
 * Un menu occupe une rangée à lui seul — Discord refuse qu'il partage sa
 * rangée avec un bouton. Vingt-cinq options au plus, au-delà c'est à
 * l'appelant de paginer.
 */
export function rangeeSelect(options: {
	id: string;
	invite?: string;
	choix: readonly OptionSelect[];
}): ComposantRangeeSelect | null {
	const choix = options.choix.slice(0, 25).map((choixUnique) => ({
		...choixUnique,
		label: bornerTexte(choixUnique.label, 100),
		...(choixUnique.description
			? { description: bornerTexte(choixUnique.description, 100) }
			: {}),
	}));
	if (choix.length === 0) return null;
	return {
		type: TYPE_COMPOSANT.rangee,
		components: [
			{
				type: TYPE_COMPOSANT.selectChaine,
				custom_id: options.id,
				...(options.invite ? { placeholder: bornerTexte(options.invite, 150) } : {}),
				options: choix,
			},
		],
	};
}

/** Conteneur : le « panneau » coloré qui groupe une section d'écran. */
export function conteneur(
	enfants: readonly (ComposantV2 | null)[],
	couleur?: number
): ComposantConteneur {
	return {
		type: TYPE_COMPOSANT.conteneur,
		...(couleur !== undefined ? { accent_color: couleur } : {}),
		components: enfants.filter((enfant): enfant is ComposantV2 => enfant !== null),
	};
}

/** Somme des textes d'un arbre de composants, telle que Discord la compte. */
export function tailleTexte(composants: readonly ComposantV2[]): number {
	let total = 0;
	for (const composant of composants) {
		if (composant.type === TYPE_COMPOSANT.texte) total += composant.content.length;
		else if (composant.type === TYPE_COMPOSANT.section) {
			total += tailleTexte(composant.components);
		} else if (composant.type === TYPE_COMPOSANT.conteneur) {
			total += tailleTexte(composant.components);
		}
	}
	return total;
}

/** Nombre de composants d'un arbre, imbrication comprise. */
export function compterComposants(composants: readonly ComposantV2[]): number {
	let total = 0;
	for (const composant of composants) {
		total += 1;
		if (composant.type === TYPE_COMPOSANT.section) {
			total += composant.components.length + 1;
		} else if (composant.type === TYPE_COMPOSANT.conteneur) {
			total += compterComposants(composant.components);
		} else if (composant.type === TYPE_COMPOSANT.rangee) {
			total += composant.components.length;
		} else if (composant.type === TYPE_COMPOSANT.galerie) {
			total += composant.items.length;
		}
	}
	return total;
}

/** Un message V2 prêt à poser — ni `content` ni `embeds`, par construction. */
export interface MessageV2 {
	flags: number;
	components: ComposantV2[];
}

/**
 * Ferme un écran V2 en vérifiant ses budgets.
 *
 * ── ON ÉCARTE PAR LA FIN, ON NE LAISSE PAS DISCORD REFUSER ─────────────────
 * Dépasser 4 000 caractères ou 40 composants ne tronque pas le message : il est
 * REFUSÉ, et le membre voit « L'application n'a pas répondu ». On retire donc
 * les derniers blocs jusqu'à rentrer dans le budget — un écran incomplet et
 * affiché vaut mieux qu'un écran juste et invisible.
 */
export function ecran(composants: readonly (ComposantV2 | null)[]): MessageV2 {
	const retenus = composants.filter((c): c is ComposantV2 => c !== null);

	while (
		retenus.length > 0 &&
		(retenus.length > LIMITES_V2.racines ||
			tailleTexte(retenus) > LIMITES_V2.texteTotal ||
			compterComposants(retenus) > LIMITES_V2.total)
	) {
		retenus.pop();
	}

	return { flags: DRAPEAU_V2, components: retenus };
}
