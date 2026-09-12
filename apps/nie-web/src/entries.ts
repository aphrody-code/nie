/**
 * Les entrées du site — une seule liste, pour tout l'écran.
 *
 * ## Pourquoi ce fichier existe
 *
 * Owns explicit host navigation routes and their presentation. Routing, the secondary shell,
 * and the reconstructed menu bind this catalogue to their navigation callbacks. These host
 * destinations do not claim to implement the native game's menu-command catalogue.
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
import { IDS_VUES } from "./desktop/lib/vues";

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
 * Inacord — the full workspace (explorer, editor, RE tools, mods, cinema, gallery, tools,
 * saves), merged into this site on 2026-09-12. It used to live on its own host; one origin now
 * serves the game, the catalogues and the workspace.
 */
export const INACORD = "inacord";

/** The download catalogue of the native Inacord builds (desktop, mobile, CLI, MCP, plugins). */
export const DOWNLOADS = "downloads";

/**
 * La Banque du joueur — l'écran `chara_bank_menu` du jeu : la liste des personnages possédés,
 * leur fiche et le dialogue FILTRES. Segment anglais, comme toute URL nouvelle.
 */
export const BANK = "bank";

/**
 * La Galerie des succès — l'écran `gallery_menu` du jeu : les succès à 100 %, les images de la
 * galerie, les cinématiques et les musiques du profil complet.
 */
export const GALLERY = "gallery";

/**
 * Le Marché — l'écran `shop_menu` du jeu : les 16 boutiques et tout leur stock, prix et
 * descriptions compris.
 */
export const SHOP = "shop";

/** Published alias that enters the main menu at `/` without replaying startup. */
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
	[BANK]: { label: "Banque", glyph: "livre" },
	[GALLERY]: { label: "Galerie", glyph: "image" },
	[SHOP]: { label: "Boutique", glyph: "cube" },
	[INACORD]: { label: "Inacord", glyph: "livre" },
	[DOWNLOADS]: { label: "Téléchargements", glyph: "cube" },
};

/** Le libellé d'une entrée, ou son nom brut si le site ne la connaît pas. */
export function entryLabel(route: string): string {
	return PRESENTATION[route]?.label ?? route;
}

/**
 * Routes recognized by the host, including compatibility aliases.
 *
 * `/recherche` et `/donnees` mènent à l'explorateur ; `/textures`, `/modeles`, `/sons` et
 * `/videos` mènent aux médias, sur leur vue. Aucune n'est une tuile, et toutes restent
 * servies : casser une adresse déjà publiée (`sitemap.xml` compris) pour changer un menu, ce
 * serait payer une décision d'affichage avec les liens des autres.
 */
export function recognizedRoutes(health: SiteHealth | null): string[] {
	return [
		MENU,
		...menuEntries(health).map((entry) => entry.route),
		DOWNLOADS,
		...INACORD_VIEW_ROUTES,
		...ALIAS,
		...CATALOGS,
	];
}

/**
 * The workspace views, addressable one by one: `/inacord/cinema` opens the Cinema view inside
 * the unified shell. `/inacord` alone stays valid and opens the explorer.
 *
 * The identifiers are NOT re-declared here — they come from the view registry
 * (`desktop/lib/vues.ts`), the single place that says what the workspace contains.
 */
export const INACORD_VIEW_ROUTES: readonly string[] = IDS_VUES.map((id) => `${INACORD}/${id}`);

/**
 * Implemented host destinations in their display order. Health is retained in the public
 * signature for existing consumers; it does not currently supply native action availability.
 */
export function menuEntries(_health: SiteHealth | null): MenuEntry[] {
	return [MEDIA, BANK, GALLERY, SHOP, AVATAR, EXPLORER, INACORD, SETTINGS].map((route) => ({
		route,
		label: entryLabel(route),
		glyph: PRESENTATION[route]?.glyph ?? "arbre",
	}));
}
