/**
 * Les entrées du site — une seule liste, pour tout l'écran.
 *
 * ## Pourquoi ce fichier existe
 *
 * La liste vivait en double : une fois dans `App.tsx` (pour le routage), une fois dans
 * `MainMenu.tsx` (pour la rangée de tuiles), chacune avec son habillage. Les deux ont
 * dérivé — l'accueil affichait des comptes que la barre de navigation n'avait pas, et la barre
 * nommait « Catalogues » une liste qui contenait l'explorateur. Un seul endroit décide
 * désormais de ce que le site propose.
 *
 * ## Ce qui n'est PAS ici
 *
 * Aucun chiffre. Les totaux publiés par le serveur (54 203 textures, 255 308 entrées indexées)
 * décrivent l'index, pas ce qu'on peut faire du site : les afficher sur une tuile ajoute une
 * donnée d'inventaire là où l'on choisit une destination. Le jeu, lui, ne met aucun compte sur
 * les tuiles de son menu.
 */
import type { SanteApi as SiteHealth } from "@niers/asset-source";
import type { NomGlyphe as GlyphName } from "@niers/inacord-ui";

/**
 * L'explorateur — **la seule page**, décidé par l'utilisateur le 2026-09-06.
 *
 * Parcourir un dossier, chercher dans les 255 308 entrées et lire ce que le serveur sait d'un
 * asset étaient trois destinations de menu. C'est un seul geste : *où est ce fichier, et que
 * sait-on de lui*. La page a donc une barre de filtres, une liste, et un panneau de droite qui
 * parle du **dossier courant** ou de l'**asset sélectionné**.
 */
export const EXPLORER = "explorateur";

/**
 * Les deux URL héritées des écrans fusionnés.
 *
 * Elles restent **reconnues** — elles mènent à l'explorateur — sans être des entrées de menu :
 * casser une adresse déjà publiée (`sitemap.xml` compris) pour changer un menu, ce serait payer
 * une décision d'affichage avec les liens des autres.
 */
export const ALIAS = ["recherche", "donnees"] as const;

/**
 * Les catalogues que le serveur publie sous forme d'URL, dans son document d'accueil.
 *
 * Ce ne sont pas des noms devinés : `nie-site` sert `/textures`, `/modeles`, `/sons` et
 * `/videos` avec leurs métadonnées propres, et les liste dans le HTML rendu sans JavaScript.
 * Les garder ici permet d'afficher le menu complet avant que `/api/v1/health` ait répondu —
 * sans cette liste, l'accueil montrait une seule tuile pendant tout le chargement.
 */
export const CATALOGS = ["textures", "modeles", "sons", "videos"] as const;

/**
 * Les médias — **une seule page**, décidé par l'utilisateur le 2026-09-06.
 *
 * Quatre entrées de menu pour quatre filtres du même index faisaient quatre destinations là où
 * il n'y a qu'une question : *montre-moi ce que le jeu contient, de ce type-là*. La vue est
 * devenue un réglage de la page, au même titre que le tri, et les quatre URL y mènent toujours.
 */
export const MEDIA = "medias";

/**
 * Les Options — l'écran des réglages du jeu, avec les réglages d'Inacord dedans.
 *
 * Segment anglais (`/settings`), comme toute URL nouvelle. La tuile porte l'engrenage du jeu.
 */
export const SETTINGS = "settings";

/** L'éditeur d'avatar, alimenté par les tables `chara_edit` du VFS. */
export const AVATAR = "avatar";

/**
 * Le menu de navigation — les catalogues, l'explorateur, les Options.
 *
 * Il occupait la racine tant que le site était un catalogue. La racine sert le JEU depuis le
 * 2026-09-07 ; le menu a donc besoin d'une adresse à lui, sans quoi les quatre catalogues et
 * l'explorateur ne seraient plus atteignables que par URL directe. Segment anglais, comme toute
 * route nouvelle. Il n'entre PAS au plan du site : une page de liens vers des pages déjà
 * listées ne se référence pas deux fois.
 */
export const MENU = "menu";

/** Une entrée du menu : sa route, son libellé, son pictogramme. */
export interface MenuEntry {
	/** Le segment d'URL — c'est aussi l'identité de l'entrée. */
	route: string;
	label: string;
	glyph: GlyphName;
}

/**
 * Le seul habillage figé du site : un libellé et un pictogramme par entrée connue.
 *
 * Une vue que le serveur publierait sans figurer ici s'affiche sous SON nom, avec un
 * pictogramme neutre — jamais sous un libellé inventé.
 */
const PRESENTATION: Record<string, { label: string; glyph: GlyphName }> = {
	textures: { label: "Textures", glyph: "image" },
	modeles: { label: "Modèles", glyph: "cube" },
	sons: { label: "Sons", glyph: "onde" },
	videos: { label: "Vidéos", glyph: "film" },
	[MEDIA]: { label: "Médias", glyph: "image" },
	[EXPLORER]: { label: "Explorer", glyph: "arbre" },
	[SETTINGS]: { label: "Options", glyph: "engrenage" },
	[AVATAR]: { label: "Avatar", glyph: "ballon" },
};

/** Le libellé d'une entrée, ou son nom brut si le site ne la connaît pas. */
export function entryLabel(route: string): string {
	return PRESENTATION[route]?.label ?? route;
}

/**
 * Les routes que l'application reconnaît — le menu n'en montre que deux.
 *
 * `/recherche` et `/donnees` mènent à l'explorateur ; `/textures`, `/modeles`, `/sons` et
 * `/videos` mènent aux médias, sur leur vue. Aucune n'est une tuile, et toutes restent
 * servies : casser une adresse déjà publiée (`sitemap.xml` compris) pour changer un menu, ce
 * serait payer une décision d'affichage avec les liens des autres.
 */
export function recognizedRoutes(health: SiteHealth | null): string[] {
	return [MENU, ...menuEntries(health).map((entry) => entry.route), ...ALIAS, ...CATALOGS];
}

/**
 * Les entrées du menu : les médias, l'explorateur, puis les Options.
 *
 * L'ordre vient du serveur quand il a répondu — c'est lui qui décide de la place d'un
 * catalogue. L'explorateur ferme toujours la marche : il ne parcourt pas un catalogue mais
 * l'arborescence, et le serveur ne le publie pas comme une vue.
 */
export function menuEntries(_health: SiteHealth | null): MenuEntry[] {
	return [MEDIA, AVATAR, EXPLORER, SETTINGS].map((route) => ({
		route,
		label: entryLabel(route),
		glyph: PRESENTATION[route]?.glyph ?? "arbre",
	}));
}
