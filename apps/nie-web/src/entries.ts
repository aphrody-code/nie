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
import type { SanteApi as SiteHealth } from "@nie/asset-source";
import type { NomGlyphe as GlyphName } from "@nie/inacord-ui";
import { IDS_VUES } from "./desktop/lib/vues";
import { splitLanguagePrefix } from "./routing";

/** The VFS explorer, backed by the path-oriented VFS API. */
export const EXPLORER = "explorateur";

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

/** The single canonical landing of the media catalogue. `/medias` is read-only compatibility. */
export const MEDIA_LANDING = CATALOGS[0];

/**
 * Les Options — l'écran public des réglages portables du jeu.
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
 * Inacord — the explicit authoring workspace (RE, mods, Lua, raw CPK and native-only tools).
 * It shares the frontend/library owners with public views, but is not advertised to readers.
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
 * Internal mode-analysis route. Native mode tiles belong to the game/WASM flow and must never
 * send a player to this diagnostic page.
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
	"mode-kizuna_town": MODES,
	"mode-information": MODES,
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
	/** Player-facing emphasis inside the host-owned menu extension. */
	priority?: "primary" | "secondary";
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
	story_mode: { label: "Mode Histoire", glyph: "ballon" },
	chronicle_mode: { label: "Mode Chronique", glyph: "livre" },
	competition: { label: "Mode Compétition", glyph: "ballon" },
	victory_road: { label: "Victory Road", glyph: "ballon" },
	bb_stadium: { label: "Stade BB", glyph: "ballon" },
};

/** Le libellé d'une entrée, ou son nom brut si le site ne la connaît pas. */
export function entryLabel(route: string): string {
	return PRESENTATION[route]?.label ?? route;
}

/**
 * Routes recognized by the host, including compatibility inputs.
 *
 * `/textures`, `/modeles`, `/sons` and `/videos` are canonical catalogue views; `/medias` remains
 * a compatibility input that redirects to one of them. Wiki/data and reverse-engineering
 * queries have no GUI route; their API/CLI/MCP owners remain available.
 */
export function recognizedRoutes(health: SiteHealth | null): string[] {
	return [
		MENU,
		// Compatibility input, deliberately not in LEGACY_ROUTES: Catalog must read `?vue=`
		// before replacing this retired container with the selected canonical catalogue.
		MEDIA,
		...menuEntries(health).map((entry) => entry.route),
		DOWNLOADS,
		MODES,
		INACORD,
		...INACORD_VIEW_ROUTES,
		...CATALOGS,
		...Object.keys(LEGACY_ROUTES),
	];
}

/**
 * The workspace view, addressable as `/inacord/explorer`. `/inacord` alone stays valid and opens
 * the same explorer.
 *
 * The identifiers are NOT re-declared here — they come from the view registry
 * (`desktop/lib/vues.ts`), the single place that says what the workspace contains.
 *
 * `IDS_VUES` is the registry's own derived list, so no headless capability becomes an accidental
 * desktop route.
 */
export const INACORD_VIEW_ROUTES: readonly string[] = IDS_VUES.map((id) => `${INACORD}/${id}`);

/**
 * Implemented host destinations in their display order. Health is retained in the public
 * signature for existing consumers; it does not currently supply native action availability.
 */
export function menuEntries(_health: SiteHealth | null): MenuEntry[] {
	return [
		{ route: MEDIA_LANDING, label: entryLabel(MEDIA), glyph: PRESENTATION[MEDIA]!.glyph },
		...[AVATAR, EXPLORER, BANK, GALLERY, SHOP, SETTINGS].map((route) => ({
			route,
			label: entryLabel(route),
			glyph: PRESENTATION[route]?.glyph ?? "arbre",
			priority: route === EXPLORER || route === GALLERY ? "primary" as const : "secondary" as const,
		})),
	];
}

/**
 * Les adresses que DEUX pages servaient, et l'unique page qui les sert désormais.
 *
 * `inacord/gallery` et `gallery_menu` rendaient tous les deux une galerie, mais pas la même :
 * l'espace de travail montrait le VFS (17 085 `.g4tx` sous `data/dx11/menu/220_img/`, catégories
 * découvertes par `ls`), l'écran du jeu montrait `gallery_config` (360 lignes). Le second se
 * présentait comme « la Galerie » tout en n'en portant que 2 %, et le premier n'était annoncé
 * nulle part. Un visiteur n'avait aucun moyen de savoir laquelle des deux il regardait.
 *
 * Une seule survit, avec sa vraie source : l'écran du jeu, qui ouvre la galerie complète sur
 * `?display=gallery`. L'ancienne adresse y mène en REMPLAÇANT l'historique — elle a été publiée,
 * elle ne se casse pas, mais elle ne doit pas non plus laisser deux états concurrents vivre.
 */
export const MERGED_ROUTES: Readonly<Record<string, { route: string; search: string }>> = {
	[`${INACORD}/gallery`]: { route: GALLERY, search: "?display=gallery" },
};
