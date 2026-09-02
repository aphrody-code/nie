/**
 * Noyau PUR du CDN Rose Griffon : normalisation des chemins d'asset, forge des
 * URLs de variante, validation des codes de modèle 3D, catégories de galerie et
 * état de pagination.
 *
 * ── POURQUOI CE FICHIER ────────────────────────────────────────────────────
 * `cdn.rosegriffon.fr` n'est pas un dossier de fichiers : c'est un décodeur. Les
 * textures du jeu vivent dans des archives CPK et sont décodées À LA DEMANDE
 * (`g4tx` → PNG), les modèles 3D sont ASSEMBLÉS à la volée (corps + visage +
 * uniforme). Une URL n'est donc « valide » que si elle respecte exactement la
 * grammaire que nginx et les deux services savent router. Tout est ici, testé,
 * et rien n'est deviné dans les commandes.
 *
 * ── CE QUI A ÉTÉ MESURÉ LE 13/8/2026 (et fonde chaque constante) ────────────
 * Largeurs servies — `GET http://127.0.0.1:8805/health` :
 *   {"ok":true,"cacheRoot":"/var/cache/cdn-variants","widths":[200,400,800,1600],"quality":78}
 * Surfaces acceptées par le service de variantes — `apps/cdn-variants/server.ts`
 * refuse tout ce qui ne commence pas par `dx11/` ou `g4tx/` (404), et nginx ne
 * route vers lui QUE ces deux `location` lorsqu'un `?w=` est présent.
 * Poids : `…/gallery_img2/img_story_ev01_main_0010.png` = **11 494 007 octets**
 * en PNG brut contre **97 882 octets** en `?w=1600&format=webp`, et 12 914 en
 * `?w=400`. D'où la règle absolue : un embed ne porte JAMAIS l'original.
 * `HEAD` : accepté sur une variante (200) mais **refusé par le décodeur live**
 * (405 sur `/dx11/…png` sans `?w=`) — on ne peut donc pas peser un original sans
 * le télécharger, et on ne le fait pas.
 */

import { formaterOctets as formaterOctetsUi } from "./ui/nombres";
import {
	MAX_CUSTOM_ID as MAX_CUSTOM_ID_UI,
	bornerPage as bornerPageUi,
	decoderEtat,
	encoderEtat,
	nombreDePages as nombreDePagesUi,
	pageDecodee,
} from "./ui/etat";

// ─── Variantes d'image ──────────────────────────────────────────────────────

/**
 * Largeurs déclinées par `cdn-variants.service`. Liste FERMÉE côté service
 * (anti-abus : toute autre valeur est ramenée à la plus proche) — la reproduire
 * ici évite de proposer à un membre une largeur qui sera silencieusement changée.
 */
export const LARGEURS_VARIANTE = [200, 400, 800, 1600] as const;

export type LargeurVariante = (typeof LARGEURS_VARIANTE)[number];

/** Largeur d'une vignette (celle que la galerie du wiki sert dans ses cartes). */
export const LARGEUR_VIGNETTE: LargeurVariante = 400;

/** Largeur d'une illustration plein cadre (celle du lightbox du wiki). */
export const LARGEUR_PLEINE: LargeurVariante = 1600;

/** Les deux seules surfaces que le service de variantes accepte en source. */
export const SURFACES_VARIANTE = ["dx11", "g4tx"] as const;

/**
 * Surfaces servies en direct par nginx, sans déclinaison possible.
 * `static/<app>/…` = miroir des `public/` et `.next/static` des deux apps Next.
 */
export const SURFACES_DIRECTES = ["static"] as const;

/** Extensions d'image que le décodeur et `sharp` savent produire ou relire. */
const EXTENSIONS_IMAGE = new Set(["png", "jpg", "jpeg", "webp", "avif", "gif"]);

/**
 * Identifiant d'un fichier téléversé par `POST /upload` : 16 hexadécimaux plus
 * l'extension, servi à la RACINE du domaine (`location ~* "^/[a-f0-9]{16}\.…"`).
 */
const UPLOAD_RACINE = /^[a-f0-9]{16}\.(png|jpg|jpeg|webp|gif|svg)$/;

/**
 * Asset de référence pour la sonde de bout en bout de `/cdn etat`.
 * Choisi parce qu'il est petit (6 650 octets en `?w=200`), stable et couvert par
 * le décodeur live : il prouve la chaîne nginx → variantes → décodeur, pas juste
 * qu'un port répond.
 */
export const ASSET_SONDE = "/dx11/menu/220_img/vsroute_map/grid_map00.png";

/** Résultat de la normalisation d'un chemin d'asset. */
export type ResolutionAsset =
	| {
			readonly ok: true;
			/** Chemin absolu prêt à concaténer à la base publique, `/dx11/…`. */
			readonly chemin: string;
			/** Premier segment du chemin (`dx11`, `g4tx`, `static`, `""` à la racine). */
			readonly surface: string;
			/** Extension finale, en minuscules, sans le point. */
			readonly extension: string;
			/** `true` si `?w=` est honoré sur cette surface. */
			readonly variante: boolean;
			/** `true` si la saisie était un chemin de l'index CPK (`data/dx11/…`). */
			readonly depuisCpk: boolean;
	  }
	| { readonly ok: false; readonly raison: string };

/** Hôte d'une base d'URL, en minuscules ; `""` si la base est illisible. */
function hoteDe(base: string): string {
	try {
		return new URL(base).host.toLowerCase();
	} catch {
		return "";
	}
}

/**
 * Normalise ce qu'un membre a tapé en un chemin d'asset servi par le CDN.
 *
 * Quatre formes sont acceptées, parce que ce sont les quatre qui circulent
 * réellement : l'URL publique complète (copiée depuis le wiki), le chemin CDN
 * (`/dx11/…`), le chemin de l'index CPK (`data/dx11/…`, celui que renvoie
 * `/api/cpk/search`) et l'identifiant d'un fichier téléversé.
 *
 * Le `.g4tx` est réécrit en `.png` : dans l'index CPK la texture s'appelle
 * `…/img_room_b10g001.g4tx`, mais le CDN ne sert que le résultat du décodage.
 * Sans cette réécriture, un membre qui colle un chemin d'index obtient un 404
 * alors que l'asset existe (vérifié : `/dx11/menu/220_img/stadium/
 * img_room_b10g001.png?w=800&format=webp` → 200, 112 042 octets).
 */
export function normaliserCheminAsset(saisie: string, baseCdn: string): ResolutionAsset {
	const brut = (saisie ?? "").trim();
	if (brut.length === 0) {
		return { ok: false, raison: "Chemin vide." };
	}
	if (brut.length > 300) {
		return { ok: false, raison: "Chemin trop long (300 caractères au maximum)." };
	}
	if (/\s/.test(brut)) {
		return { ok: false, raison: "Un chemin d'asset ne contient pas d'espace." };
	}

	let chemin = brut;
	let depuisCpk = false;

	if (/^https?:\/\//i.test(brut)) {
		let url: URL;
		try {
			url = new URL(brut);
		} catch {
			return { ok: false, raison: "URL illisible." };
		}
		const attendu = hoteDe(baseCdn);
		if (attendu.length > 0 && url.host.toLowerCase() !== attendu) {
			return {
				ok: false,
				raison: `Cette URL n'est pas servie par le CDN (hôte \`${url.host}\`, attendu \`${attendu}\`).`,
			};
		}
		chemin = url.pathname;
	}

	// On coupe une éventuelle query collée à un chemin nu : le `?w=` est reforgé.
	const coupure = chemin.search(/[?#]/);
	if (coupure >= 0) {
		chemin = chemin.slice(0, coupure);
	}

	let segments: string[];
	try {
		segments = chemin
			.split("/")
			.filter((s) => s.length > 0)
			.map(decodeSegment);
	} catch {
		return { ok: false, raison: "Chemin illisible (encodage invalide)." };
	}
	if (segments.some((s) => s === "." || s === "..")) {
		return { ok: false, raison: "Chemin invalide : `.` et `..` sont refusés." };
	}
	if (segments.length === 0) {
		return { ok: false, raison: "Chemin vide." };
	}

	// Forme de l'index CPK : `data/dx11/…`. Le CDN sert la même arborescence sans
	// le préfixe `data/`.
	if (segments[0] === "data" && segments.length > 1) {
		segments = segments.slice(1);
		depuisCpk = true;
	}

	const dernier = segments[segments.length - 1] ?? "";
	const point = dernier.lastIndexOf(".");
	if (point <= 0 || point === dernier.length - 1) {
		return {
			ok: false,
			raison: "Il manque l'extension du fichier (par exemple `.png`).",
		};
	}
	let extension = dernier.slice(point + 1).toLowerCase();

	const surface = segments.length > 1 ? (segments[0] as string) : "";
	const variante = (SURFACES_VARIANTE as readonly string[]).includes(surface);
	const directe = (SURFACES_DIRECTES as readonly string[]).includes(surface);
	const upload = surface === "" && UPLOAD_RACINE.test(dernier.toLowerCase());

	if (!variante && !directe && !upload) {
		return {
			ok: false,
			raison:
				"Surface inconnue du CDN. Formes acceptées : `dx11/…`, `g4tx/…`, " +
				"`data/dx11/…` (chemin de l'index CPK), `static/<app>/…` ou un identifiant " +
				"de téléversement (`<16 hexa>.png`).",
		};
	}

	// Le CDN ne sert jamais l'archive de texture elle-même, seulement le PNG décodé.
	if (variante && extension === "g4tx") {
		extension = "png";
		segments[segments.length - 1] = `${dernier.slice(0, point)}.png`;
	}

	if (!EXTENSIONS_IMAGE.has(extension) && !(upload && extension === "svg")) {
		return {
			ok: false,
			raison: `Extension \`.${extension}\` non servie en image — le CDN ne décline en WebP que des images (${[...EXTENSIONS_IMAGE].join(", ")}).`,
		};
	}

	return {
		ok: true,
		chemin: `/${segments.join("/")}`,
		surface,
		extension,
		variante,
		depuisCpk,
	};
}

/** Décode un segment d'URL, en laissant passer les `%` littéraux mal formés. */
function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/**
 * Ramène une largeur quelconque à la plus proche largeur servie.
 *
 * C'est exactement `snapWidth()` de `apps/cdn-variants/server.ts` : le service
 * fait déjà ce rapprochement, on le fait AVANT pour que l'URL affichée à un
 * membre soit celle qui sera réellement servie.
 */
export function largeurAutorisee(brut: number | null | undefined): LargeurVariante {
	if (typeof brut !== "number" || !Number.isFinite(brut)) {
		return LARGEUR_VIGNETTE;
	}
	let meilleure: LargeurVariante = LARGEURS_VARIANTE[0];
	let ecart = Math.abs(brut - meilleure);
	for (const largeur of LARGEURS_VARIANTE) {
		const candidat = Math.abs(brut - largeur);
		if (candidat < ecart) {
			meilleure = largeur;
			ecart = candidat;
		}
	}
	return meilleure;
}

/** URL directe d'un asset (source, sans déclinaison). */
export function urlAsset(baseCdn: string, chemin: string): string {
	return `${baseCdn.replace(/\/+$/, "")}${chemin.startsWith("/") ? chemin : `/${chemin}`}`;
}

/** URL de la variante WebP redimensionnée. */
export function urlVariante(baseCdn: string, chemin: string, largeur: LargeurVariante): string {
	return `${urlAsset(baseCdn, chemin)}?w=${largeur}&format=webp`;
}

// ─── Modèles 3D ─────────────────────────────────────────────────────────────

/**
 * Familles de codes assemblables par `nie-model-serve`, telles qu'observées dans
 * l'index CPK :
 *   - `c…`  personnages — `internalCode` du wiki, ex. `c01000010` (Mark Evans),
 *           assemblé corps + visage + uniforme (uniforme résolu par `crc32_std`) ;
 *   - `ka…` armures     — `data/common/chr/_armd/ka000101/…`  (281 dossiers) ;
 *   - `k…`  keshins     — `data/common/chr/_keshin/k000010/…` (370 dossiers).
 * L'ordre du test compte : `ka` avant `k`, sinon toute armure serait un keshin.
 */
export type FamilleModele = "personnage" | "armure" | "keshin";

export interface CodeModele {
	readonly code: string;
	readonly famille: FamilleModele;
}

/**
 * Valide et normalise un code de modèle.
 *
 * La contrainte n'est pas cosmétique : le code est injecté dans un chemin
 * (`/model-full/<code>.glb`). Le motif « lettres puis chiffres, rien d'autre »
 * rend toute traversée de chemin impossible par construction.
 *
 * Tous les modèles ne sont pas assemblables : `nie-model-serve` répond 404 avec
 * un message clair (mesuré : `c000000000` → « modèle c000000000 non disponible :
 * assemblage personnage c000000000 », `k000020` → 404 alors que `k000010` → 200,
 * 692 132 octets). La validation ici ne promet donc que la FORME, jamais
 * l'existence — c'est l'appel réel qui tranche.
 */
export function normaliserCodeModele(saisie: string): CodeModele | { readonly raison: string } {
	let code = (saisie ?? "").trim().toLowerCase();
	code = code.replace(/^.*\/model-full\//, "").replace(/^\/+/, "");
	code = code.replace(/\.glb$/, "");

	if (code.length === 0) {
		return { raison: "Code de modèle vide." };
	}
	if (!/^[a-z]{1,2}[0-9]{5,9}$/.test(code)) {
		return {
			raison:
				"Code invalide. Attendu : des lettres suivies de chiffres — " +
				"`c01000010` (personnage), `ka000101` (armure), `k000010` (keshin).",
		};
	}

	// `ka` AVANT `k`, sinon toute armure serait classée keshin.
	const famille: FamilleModele | null = code.startsWith("ka")
		? "armure"
		: code.startsWith("k")
			? "keshin"
			: code.startsWith("c")
				? "personnage"
				: null;

	if (famille === null) {
		return {
			raison:
				"Seuls les codes `c…` (personnages), `ka…` (armures) et `k…` (keshins) sont assemblés en 3D.",
		};
	}

	return { code, famille };
}

/** Libellé français d'une famille de modèle. */
export function libelleFamille(famille: FamilleModele): string {
	return famille === "armure" ? "Armure" : famille === "keshin" ? "Keshin" : "Personnage";
}

/** URL du modèle 3D complet (corps + visage + uniforme, assemblé en direct). */
export function urlModele(baseCdn: string, code: string): string {
	return `${baseCdn.replace(/\/+$/, "")}/model-full/${code}.glb`;
}

/**
 * Plafond de pièce jointe.
 *
 * Discord accepte 10 Mio par message sur un serveur non boosté. On s'arrête à
 * 8 Mio pour garder la marge du conteneur multipart : au-delà, l'envoi ENTIER
 * échoue (embed compris) et le membre n'obtient rien du tout. Le même plafond
 * est déjà retenu par `packages/cron/src/tasks/discord-polls.ts`.
 * Ordre de grandeur mesuré : `c01000010` = 459 968 octets, `k000010` = 692 132,
 * `ka000101` = 1 955 520 — la grande majorité passe en pièce jointe.
 */
export const LIMITE_PIECE_JOINTE_OCTETS = 8 * 1024 * 1024;

/**
 * Sélectionne la texture qui illustre le mieux un code de modèle, parmi les
 * fichiers réellement présents dans l'index CPK.
 *
 * On ne devine PAS le chemin par famille (il diffère : `_face/01_ie1/…` pour un
 * personnage, `_keshin/…` pour un keshin, `_armd/…` avec un suffixe `_10` pour
 * une armure). On classe les vraies entrées : d'abord celle dont le nom est
 * exactement le code, puis la plus courte — donc la texture principale plutôt
 * qu'une de ses déclinaisons numérotées.
 */
export function choisirTextureModele(
	code: string,
	fichiers: ReadonlyArray<{ path?: string | null; ext?: string | null; name?: string | null }>
): string | null {
	const candidats = fichiers
		.filter(
			(f) =>
				typeof f.path === "string" &&
				f.path.startsWith("data/dx11/") &&
				(f.ext ?? "").toLowerCase() === "g4tx"
		)
		.map((f) => f.path as string);

	if (candidats.length === 0) {
		return null;
	}

	const nomExact = `/${code}.g4tx`;
	const trie = candidats.toSorted((a, b) => {
		const exactA = a.endsWith(nomExact) ? 0 : 1;
		const exactB = b.endsWith(nomExact) ? 0 : 1;
		return exactA - exactB || a.length - b.length || a.localeCompare(b);
	});

	const choisi = trie[0];
	return typeof choisi === "string"
		? `/${choisi.slice("data/".length).replace(/\.g4tx$/i, ".png")}`
		: null;
}

// ─── Galerie ────────────────────────────────────────────────────────────────

/**
 * Catégories de `/api/gallery`, avec un libellé français.
 *
 * Les cinq premières viennent de la table `inagle_gallery` (le 2e jeton du
 * `img_path`) ; les six suivantes du manifeste des illustrations de menu, servies
 * en direct depuis les CPK. `menu` les réunit toutes.
 * Totaux relevés le 13/8/2026 sur `http://127.0.0.1:8807/api/gallery` : story
 * 242, chronicle 29, special 53, kizuna 2, other 34, gallery_img2 363, ev_pic 70,
 * stadium 202, vsroute_map 88, hlp 306, telop_waza 1341, menu 2370, sans
 * catégorie 360. Aucune n'est vide.
 */
export const CATEGORIES_GALERIE = [
	{ valeur: "story", libelle: "Histoire" },
	{ valeur: "chronicle", libelle: "Chroniques" },
	{ valeur: "special", libelle: "Spéciales" },
	{ valeur: "kizuna", libelle: "Liens" },
	{ valeur: "other", libelle: "Autres" },
	{ valeur: "gallery_img2", libelle: "Galerie du menu" },
	{ valeur: "ev_pic", libelle: "Événements" },
	{ valeur: "stadium", libelle: "Stades" },
	{ valeur: "vsroute_map", libelle: "Cartes de route" },
	{ valeur: "hlp", libelle: "Aide en jeu" },
	{ valeur: "telop_waza", libelle: "Télops de techniques" },
	{ valeur: "menu", libelle: "Tout le menu du jeu" },
] as const;

/** Libellé français d'une catégorie, ou la valeur brute si elle est inconnue. */
export function libelleCategorieGalerie(valeur: string | null | undefined): string {
	if (!valeur) {
		return "Toutes";
	}
	return CATEGORIES_GALERIE.find((c) => c.valeur === valeur)?.libelle ?? valeur;
}

/** Nombre d'illustrations par page de `/cdn galerie` (1 entête + 4 visuels ≤ 10 embeds). */
export const GALERIE_PAR_PAGE = 4;

/** Nombre total de pages pour un total d'éléments. */
export function nombreDePages(total: number, parPage: number): number {
	return nombreDePagesUi(total, parPage);
}

/**
 * Borne une page dans `[1, nombreDePages]`.
 *
 * Sans plafond, une page hors bornes renvoie une liste vide et le membre conclut
 * que la catégorie est vide alors qu'il a simplement dépassé la fin.
 */
export function bornerPage(page: number, total: number, parPage: number): number {
	return bornerPageUi(page, total, parPage);
}

/** Préfixe du `customId` des boutons de pagination de la galerie. */
export const PREFIXE_BOUTON_GALERIE = "cdng";

/** Longueur maximale d'un `customId` Discord. */
export const MAX_CUSTOM_ID = MAX_CUSTOM_ID_UI;

export interface EtatGalerie {
	page: number;
	categorie: string | null;
	recherche: string | null;
}

/**
 * Encode l'état de pagination DANS le `customId` du bouton.
 *
 * Tout l'état tient dans l'identifiant : aucune mémoire de processus à garder,
 * donc un redémarrage du bot ne laisse jamais de bouton mort. `null` quand la
 * limite de 100 caractères de Discord serait dépassée — l'appelant retire alors
 * les boutons plutôt que d'envoyer un composant qui sera refusé.
 */
export function encoderEtatGalerie(etat: EtatGalerie): string | null {
	return encoderEtat(PREFIXE_BOUTON_GALERIE, [
		Math.max(1, Math.trunc(etat.page)),
		etat.categorie,
		etat.recherche,
	]);
}

/** Décode un `customId` produit par `encoderEtatGalerie`. `null` si ce n'en est pas un. */
export function decoderEtatGalerie(customId: string): EtatGalerie | null {
	const champs = decoderEtat(PREFIXE_BOUTON_GALERIE, customId, 3);
	const page = pageDecodee(champs?.[0]);
	if (!champs || page === null) {
		return null;
	}
	return {
		page,
		categorie: champs[1] || null,
		recherche: champs[2] || null,
	};
}

// ─── Mise en forme ──────────────────────────────────────────────────────────

/**
 * Taille lisible, en base 1024 et en français (virgule décimale).
 *
 * Base 1024 parce que c'est celle de tous les relevés du dépôt (« 12 Mo » pour un
 * PNG de 11 494 007 octets) : changer de base rendrait les chiffres cités dans la
 * documentation incomparables avec ceux qu'affiche le bot.
 */
export function formaterOctets(octets: number | null | undefined): string {
	return formaterOctetsUi(octets, "taille inconnue");
}

/** `true` si le type MIME annoncé est bien celui d'une image. */
export function estTypeImage(typeMime: string | null | undefined): boolean {
	return typeof typeMime === "string" && typeMime.trim().toLowerCase().startsWith("image/");
}

/** `true` si le type MIME annoncé est bien celui d'un modèle glTF binaire. */
export function estTypeModele(typeMime: string | null | undefined): boolean {
	const propre = (typeMime ?? "").trim().toLowerCase();
	return propre.startsWith("model/gltf-binary") || propre.startsWith("model/gltf+json");
}

/** Santé de `rg-cdn.service` telle qu'il la renvoie sur `/health`. */
export interface SanteCdn {
	ok?: boolean;
	storage?: string;
	assetsManifest?: { bytes?: number; etag?: string } | null;
}

/** Santé de `cdn-variants.service` telle qu'il la renvoie sur `/health`. */
export interface SanteVariantes {
	ok?: boolean;
	cacheRoot?: string;
	widths?: number[];
	quality?: number;
}

/**
 * Lignes décrivant le CDN d'origine, à partir de SA charge de santé réelle
 * (`{"ok":true,"storage":"/var/www/cdn/images","assetsManifest":null}`).
 */
export function decrireSanteCdn(charge: SanteCdn | null | undefined): string[] {
	if (!charge) {
		return ["Sonde muette."];
	}
	const lignes = [`Stockage des téléversements : \`${charge.storage ?? "inconnu"}\``];
	lignes.push(
		charge.assetsManifest
			? `Manifeste d'assets : ${formaterOctets(charge.assetsManifest.bytes ?? 0)}`
			: "Manifeste d'assets : aucun (les assets du jeu passent par les CPK, pas par un manifeste)"
	);
	return lignes;
}

/**
 * Lignes décrivant le service de variantes, à partir de SA charge de santé réelle
 * (`{"ok":true,"cacheRoot":"/var/cache/cdn-variants","widths":[200,400,800,1600],"quality":78}`).
 */
export function decrireSanteVariantes(charge: SanteVariantes | null | undefined): string[] {
	if (!charge) {
		return ["Sonde muette."];
	}
	const largeurs = Array.isArray(charge.widths) && charge.widths.length > 0 ? charge.widths : null;
	return [
		`Largeurs servies : ${largeurs ? largeurs.map((l) => `\`${l}\``).join(" · ") : "non annoncées"}`,
		`Qualité WebP : ${typeof charge.quality === "number" ? charge.quality : "inconnue"}`,
		`Cache disque : \`${charge.cacheRoot ?? "inconnu"}\``,
	];
}

/**
 * Traduit l'en-tête `x-cache` du service de variantes (`HIT` / `MISS`).
 * Il dit si la variante était déjà sur disque ou si elle vient d'être décodée —
 * c'est la seule façon honnête de parler du cache sans inventer un compteur.
 */
export function libelleCache(entete: string | null | undefined): string {
	const propre = (entete ?? "").trim().toUpperCase();
	if (propre === "HIT") {
		return "déjà en cache";
	}
	if (propre === "MISS") {
		return "décodée à la demande";
	}
	return "cache non renseigné";
}

/**
 * Convertit un chemin de l'index CPK en chemin CDN, ou `null` s'il n'est pas
 * servi. Sert l'autocomplétion : elle ne propose que ce qui s'affichera.
 */
export function cheminCdnDepuisCpk(pathCpk: string | null | undefined): string | null {
	if (typeof pathCpk !== "string" || !pathCpk.startsWith("data/dx11/")) {
		return null;
	}
	const sansData = pathCpk.slice("data/".length);
	if (!/\.g4tx$/i.test(sansData)) {
		return null;
	}
	return `/${sansData.replace(/\.g4tx$/i, ".png")}`;
}
