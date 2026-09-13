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
import { splitLanguagePrefix } from "./routing";

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
 * L'URL porte le nom du jeu : `setting_menu`, le stem de son `_setting.cfg.bin`. La tuile porte
 * l'engrenage du jeu.
 */
export const SETTINGS = "setting_menu";

/**
 * L'éditeur d'avatar, alimenté par les tables `chara_edit` du VFS — et nommé comme elles :
 * `chara_edit_menu` est le stem de son `_setting.cfg.bin`, celui que portent ses scripts Lua.
 */
export const AVATAR = "chara_edit_menu";

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
 * leur fiche et le dialogue FILTRES. L'URL porte le nom de l'écran.
 */
export const BANK = "chara_bank_menu";

/**
 * La Galerie des succès — l'écran `gallery_menu` du jeu : les succès à 100 %, les images de la
 * galerie, les cinématiques et les musiques du profil complet.
 */
export const GALLERY = "gallery_menu";

/**
 * Le Marché — l'écran `shop_menu` du jeu : les 16 boutiques et tout leur stock, prix et
 * descriptions compris.
 */
export const SHOP = "shop_menu";

/**
 * Les modes de jeu — les onglets du menu principal, et ce dont chacun est fait.
 *
 * La page existait sur le wiki et en a été retirée pour être reprise ici : `nie` sait rendre les
 * écrans d'un mode (`/api/v1/menu/render/<ecran>`), ce qu'un wiki adossé à des JSON ne pouvait
 * pas faire. Le catalogue lui-même vient du serveur (`/api/v1/modes`) — aucun slug n'est écrit
 * ici, sinon la liste dériverait de celle qui fait autorité.
 */
export const MODES = "modes";

/** Published alias that enters the main menu at `/` without replaying startup. */
export const MENU = "menu";

/**
 * Les adresses qu'un écran servait AVANT de porter le nom que le jeu lui donne.
 *
 * Un écran du jeu s'appelle par le stem de son `_setting.cfg.bin` — c'est ce nom que portent ses
 * scripts Lua, ses `objbin`, ses calques et ses `cfg.bin`. L'URL le porte donc aussi : un slug
 * traduit (`avatar`, `bank`, `shop`) était un troisième nom pour la même chose, qui ne se
 * retrouvait dans aucun fichier du jeu et que rien ne pouvait vérifier.
 *
 * Les anciennes restent reconnues et mènent à la nouvelle, qui remplace l'entrée d'historique :
 * une adresse publiée ne se casse pas pour un renommage. `nie-site` fait la même chose côté
 * serveur (`routes::pages::Entree::heritage`), canonique compris.
 */
export const LEGACY_ROUTES: Readonly<Record<string, string>> = {
	settings: SETTINGS,
	avatar: AVATAR,
	bank: BANK,
	gallery: GALLERY,
	shop: SHOP,
};

/**
 * Les entrées dont le SOUS-CHEMIN appartient à la page.
 *
 * `/modes/victory-road` est la fiche d'un mode, pas une adresse inconnue : sans cette liste,
 * `requestedEntry` ne trouve pas `modes/victory-road` dans le catalogue des entrées et le site
 * affiche l'accueil, alors que le serveur, lui, sert la page — il décide sur le PREMIER segment
 * (`routes::pages::route_servie`). Les deux côtés doivent trancher pareil, sinon l'adresse
 * existe pour un moteur et pas pour un visiteur.
 *
 * Une entrée n'y figure que si sa page sait lire son sous-chemin. `/textures/x` n'en est pas :
 * le catalogue n'a pas de fiche par fichier, et prétendre le contraire rendrait une page vide.
 */
export const SECTIONS: readonly string[] = [MODES];

/**
 * La route complète quand un chemin tombe dans une section, sinon `null`.
 *
 * Le préfixe de langue est retiré d'abord : `/ja/modes/story` désigne la même fiche que
 * `/modes/story`, dans une autre langue.
 */
export function sectionEntry(pathname: string): string | null {
	const route = splitLanguagePrefix(pathname).route.replace(/^\//, "");
	const first = route.split("/")[0] ?? "";
	return first && route !== first && SECTIONS.includes(first) ? route : null;
}

/** La route canonique d'une adresse, héritée ou non. */
export function canonicalRoute(route: string): string {
	return LEGACY_ROUTES[route] ?? route;
}

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
	[MODES]: { label: "Modes", glyph: "livre" },
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
		MODES,
		...INACORD_VIEW_ROUTES,
		...ALIAS,
		...CATALOGS,
		...Object.keys(LEGACY_ROUTES),
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
	return [MEDIA, MODES, BANK, GALLERY, SHOP, AVATAR, EXPLORER, INACORD, SETTINGS].map((route) => ({
		route,
		label: entryLabel(route),
		glyph: PRESENTATION[route]?.glyph ?? "arbre",
	}));
}
