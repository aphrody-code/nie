/**
 * Résolution des libellés de jeu IEVR vers leur forme FRANÇAISE canonique.
 *
 * ⚠ PIÈGE STRUCTUREL DE LA BASE, la raison d'être de ce module.
 * Dans `inagle_skills`, les colonnes de clés étrangères `category_id` et
 * `element_id` sont **entièrement à NULL**. Les seules valeurs exploitables sont
 * les colonnes TEXTE en français `category` (« Tir », « Défense », « Dribble »,
 * « Arrêt ») et `element` (« Feu », « Vent », « Forêt », « Montagne »,
 * « Néant », « Aucun »). Compté en base le 12/8/2026 :
 *
 *   category : Tir 433 · Arrêt 197 · Défense 192 · Dribble 180 · NULL 0
 *   element  : Vent 240 · Feu 237 · Forêt 233 · Montagne 227 · Néant 56 · Aucun 9
 *
 * Un filtre bâti sur l'identifiant ne renverrait donc JAMAIS rien. Toute
 * commande qui filtre passe par ce module, qui traduit ce que tape un membre
 * (français, anglais, japonais, code du jeu, avec ou sans accent, dans
 * n'importe quelle casse) vers l'étiquette française attendue par la base.
 * Voir `docs/wiki-filters.md`.
 *
 * Module PUR : aucune base, aucun réseau, aucun Discord. Testable seul.
 */
import { getItemCategoryLabel } from "@rosegriffon/azalee/game";

/** Éléments, dans l'ordre d'affichage du jeu. */
export const ELEMENTS_FR = ["Feu", "Vent", "Forêt", "Montagne", "Néant"] as const;
export type ElementFr = (typeof ELEMENTS_FR)[number];

/** Catégories de technique spéciale. */
export const CATEGORIES_TECHNIQUE_FR = ["Tir", "Dribble", "Défense", "Arrêt"] as const;
export type CategorieTechniqueFr = (typeof CATEGORIES_TECHNIQUE_FR)[number];

/** Postes de joueur. `Entraîneur` existe en base (10 lignes) mais n'est pas un poste jouable. */
export const POSITIONS_FR = ["Gardien", "Défenseur", "Milieu", "Attaquant"] as const;
export type PositionFr = (typeof POSITIONS_FR)[number];

/** Raretés, telles qu'écrites dans `inagle_characters.rarity_label`. */
export const RARETES_FR = ["Normal", "Expérimenté", "Héros", "BASARA"] as const;
export type RareteFr = (typeof RARETES_FR)[number];

/**
 * Minuscules sans accent ni espace superflu — la forme de comparaison.
 * « Forêt », « FORET » et « forêt » convergent donc vers la même clé.
 */
export function normaliserLibelle(valeur: string): string {
	return valeur
		.normalize("NFD")
		.replaceAll(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();
}

/** Construit une table de synonymes déjà normalisés. */
function tableSynonymes<T extends string>(entrees: Record<string, T>): Map<string, T> {
	const table = new Map<string, T>();
	for (const [clef, valeur] of Object.entries(entrees)) {
		table.set(normaliserLibelle(clef), valeur);
	}
	return table;
}

const SYNONYMES_ELEMENT = tableSynonymes<ElementFr>({
	// Français (valeurs réelles de la colonne `element`)
	Feu: "Feu",
	Vent: "Vent",
	Forêt: "Forêt",
	Montagne: "Montagne",
	Néant: "Néant",
	// `Aucun` est une seconde écriture du néant en base (9 lignes) : même sens.
	Aucun: "Néant",
	// Anglais (ce que renvoie l'API dans `elementName.en`)
	Fire: "Feu",
	Wind: "Vent",
	Forest: "Forêt",
	Mountain: "Montagne",
	Void: "Néant",
	None: "Néant",
	// Japonais (`elementName.ja`)
	火: "Feu",
	風: "Vent",
	林: "Forêt",
	山: "Montagne",
	無: "Néant",
});

const SYNONYMES_CATEGORIE = tableSynonymes<CategorieTechniqueFr>({
	Tir: "Tir",
	Dribble: "Dribble",
	Défense: "Défense",
	Arrêt: "Arrêt",
	Shoot: "Tir",
	Block: "Défense",
	Catch: "Arrêt",
	Save: "Arrêt",
	シュート: "Tir",
	ドリブル: "Dribble",
	ブロック: "Défense",
	キャッチ: "Arrêt",
});

const SYNONYMES_POSITION = tableSynonymes<PositionFr>({
	Gardien: "Gardien",
	Défenseur: "Défenseur",
	Milieu: "Milieu",
	Attaquant: "Attaquant",
	// Codes du jeu, seuls acceptés par `getCharactersList` avant traduction.
	GK: "Gardien",
	DF: "Défenseur",
	MF: "Milieu",
	FW: "Attaquant",
	Goalkeeper: "Gardien",
	Defender: "Défenseur",
	Midfielder: "Milieu",
	Forward: "Attaquant",
});

const SYNONYMES_RARETE = tableSynonymes<RareteFr>({
	Normal: "Normal",
	Expérimenté: "Expérimenté",
	Héros: "Héros",
	BASARA: "BASARA",
	Veteran: "Expérimenté",
	Hero: "Héros",
	Basara: "BASARA",
});

function resoudre<T extends string>(
	table: Map<string, T>,
	saisie: string | null | undefined
): T | null {
	if (!saisie) {
		return null;
	}
	return table.get(normaliserLibelle(saisie)) ?? null;
}

/** Élément canonique en français, ou `null` si la saisie n'en désigne aucun. */
export function resoudreElement(saisie: string | null | undefined): ElementFr | null {
	return resoudre(SYNONYMES_ELEMENT, saisie);
}

/** Catégorie de technique canonique en français. */
export function resoudreCategorieTechnique(
	saisie: string | null | undefined
): CategorieTechniqueFr | null {
	return resoudre(SYNONYMES_CATEGORIE, saisie);
}

/** Poste canonique en français. */
export function resoudrePosition(saisie: string | null | undefined): PositionFr | null {
	return resoudre(SYNONYMES_POSITION, saisie);
}

/** Rareté canonique en français. */
export function resoudreRarete(saisie: string | null | undefined): RareteFr | null {
	return resoudre(SYNONYMES_RARETE, saisie);
}

/**
 * Libellé FRANÇAIS d'une catégorie d'objet.
 *
 * L'API sert l'identifiant du jeu (`emblem`, `craft_obj`, `kizuna_link`…) : le
 * site affiche « Emblème », « Matériau », « Lien Kizuna » via la table de
 * `@rosegriffon/azalee/game`, et le bot doit dire la même chose — une UI
 * française n'affiche pas `craft_obj`. Les 16 catégories réellement présentes
 * (mesuré : 1 668 objets) sont toutes couvertes ; une catégorie inconnue est
 * renvoyée telle quelle plutôt que masquée.
 */
export function libelleCategorieObjet(categorie: string | null | undefined): string | null {
	return getItemCategoryLabel(categorie) ?? null;
}

/**
 * Icône d'élément servie par Azalée (`apps/azalee/public/spirit_type/`).
 *
 * Volontairement PAS le portrait du personnage : le dump `icon_chr/face/*` n'est
 * pas servi (404 mesuré le 12/8/2026, le décodeur CPK live était en cours de
 * démarrage) et la fiche du wiki affiche un modèle 3D `.glb`, que Discord ne
 * sait pas rendre. Ces quatre webp-là existent et sont stables.
 * Le néant n'a pas d'icône : la fonction renvoie `null`, l'appelant n'affiche rien.
 */
export function iconeElementUrl(element: string | null | undefined): string | null {
	const canonique = resoudreElement(element);
	const fichiers: Record<ElementFr, string | null> = {
		Feu: "fire",
		Vent: "wind",
		Forêt: "forest",
		Montagne: "mountain",
		Néant: null,
	};
	if (!canonique) {
		return null;
	}
	const fichier = fichiers[canonique];
	return fichier ? `https://azalee.rosegriffon.fr/spirit_type/${fichier}.webp` : null;
}

/**
 * Filtre une liste de valeurs pour l'autocomplétion Discord.
 *
 * Les entrées qui COMMENCENT par la saisie passent devant celles qui la
 * contiennent seulement : taper « for » propose « Forêt » avant « Renfort ».
 * Discord plafonne à 25 propositions.
 */
export function suggerer<T extends string>(
	valeurs: readonly T[],
	saisie: string | null | undefined,
	max = 25
): T[] {
	const aiguille = normaliserLibelle(saisie ?? "");
	if (aiguille.length === 0) {
		return valeurs.slice(0, max);
	}
	const debuts: T[] = [];
	const milieux: T[] = [];
	for (const valeur of valeurs) {
		const normalisee = normaliserLibelle(valeur);
		if (normalisee.startsWith(aiguille)) {
			debuts.push(valeur);
		} else if (normalisee.includes(aiguille)) {
			milieux.push(valeur);
		}
	}
	return [...debuts, ...milieux].slice(0, max);
}
