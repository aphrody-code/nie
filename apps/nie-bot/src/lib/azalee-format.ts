/**
 * Mise en forme des données de jeu d'Inazuma Eleven: Victory Road pour Discord.
 *
 * Module **PUR** : aucune base, aucun réseau, aucun objet Discord. Tout ce qui
 * transforme une valeur de l'API Azalée en texte ou en URL d'embed vit ici, et
 * y est testé seul (`azalee-format.test.ts`).
 *
 * ── POURQUOI CE MODULE EXISTE ──────────────────────────────────────────────
 * L'API Azalée sert des URL d'illustration forgées pour l'ancien dump sur
 * disque. Le dump `dx11/menu` a été archivé : le CDN décode désormais les CPK
 * EN DIRECT, et le décodeur ne connaît que le chemin RÉEL du fichier dans le
 * CPK. Trois écarts, tous MESURÉS le 13/8/2026 (curl sur cdn.rosegriffon.fr) :
 *
 *  1. NOM DOUBLÉ. `…/stadium/img_room_s90g001_img_room_s90g001.png` → **502**,
 *     `…/stadium/img_room_s90g001.png` → **200**. Idem télops de techniques,
 *     de tactiques, d'éveils et de changements de mode.
 *  2. PRÉFIXE `icon_chr/` ERRONÉ. L'API forge
 *     `…/menu/icon_chr/aura_fs/k000520_l_k000520_l00.png` → **404** ; le vrai
 *     chemin, lu dans l'index CPK, est
 *     `…/menu/200_icon/10_icon_chr/aura_fs/k000520_l.png` → **200** (63 Ko).
 *     Même correction pour `face/` : `200_icon/10_icon_chr/face/<code>_l.png`
 *     répond 200 sur 10 codes d'entraîneur et 8 codes de personnage tirés au
 *     hasard, là où la forme `icon_chr/face/<code>_l_<code>_1_l00.png` répond
 *     404 partout.
 *  3. SOUS-TEXTURES D'ATLAS NON SERVIES. Les icônes d'objet vivent dans un
 *     atlas (`200_icon/02_icon_item/icon_item05.g4tx`, servi en 200) ; la
 *     sous-texture d'un objet précis (`icon_item05_eq_ac0105301.png`) répond
 *     **404**. Aucune icône d'objet n'est donc affichable : on renvoie `null`
 *     plutôt qu'une image cassée dans l'embed.
 *
 * Un embed Discord n'a pas d'`onError` : une URL morte laisse un cadre vide et
 * un lien brisé. Le parti pris est donc « soit l'image est prouvée servie, soit
 * il n'y a pas d'image ».
 */
import { corrigerNomDouble } from "./azalee";
import {
	formaterNombre as formaterNombreUi,
	formaterPourcentage as formaterPourcentageUi,
} from "./ui/nombres";
import { joindre } from "./ui/texte";
import {
	normaliserLibelle,
	resoudreCategorieTechnique,
	resoudreElement,
	resoudrePosition,
} from "./ievr-labels";

/** Champ multilingue tel que servi par l'API (`names`, `descriptions`, …). */
export interface Multilingue {
	fr?: string | null;
	en?: string | null;
	ja?: string | null;
}

/** Les sept statistiques d'un joueur, telles que servies dans `stats.lv99`. */
export interface Statistiques {
	kick?: number | null;
	control?: number | null;
	technique?: number | null;
	pressure?: number | null;
	physical?: number | null;
	agility?: number | null;
	intelligence?: number | null;
}

// --- Texte -----------------------------------------------------------------

/** Réduit un champ multilingue à sa forme française, avec repli anglais puis japonais. */
export function texteFr(valeur: Multilingue | null | undefined, repli = "Inconnu"): string {
	for (const candidat of [valeur?.fr, valeur?.en, valeur?.ja]) {
		if (typeof candidat === "string" && candidat.trim().length > 0) {
			return candidat.trim();
		}
	}
	return repli;
}

/**
 * Retire le balisage interne du moteur resté dans les textes du jeu.
 *
 * Vu en base sur `inagle_passives.text_raw` : « ATT des tirs de l'équipe
 * `[CPASSIVE01]`+`<VALUE>` %`[C]` pendant 30 sec ». Ces balises colorent le
 * texte à l'écran du jeu ; dans un embed elles ne sont que du bruit.
 * `<VALUE>` est remplacé par la valeur réelle quand l'appelant la connaît, sinon
 * retiré — l'API expose déjà `description` avec la valeur substituée.
 */
export function nettoyerTexteJeu(texte: string | null | undefined, valeur?: number | null): string {
	if (typeof texte !== "string") {
		return "";
	}
	return texte
		.replaceAll(/\[C[A-Z0-9_]*\]/g, "")
		.replaceAll("<VALUE>", typeof valeur === "number" ? formaterNombre(valeur) : "")
		.replaceAll("\\n", "\n")
		.replaceAll(/[ \t]+/g, " ")
		.replaceAll(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Retire les annotations de lecture japonaises `[漢字/かんじ]` en gardant le kanji.
 *
 * Réel : `キャッチ[以外/いがい]でボール[奪還後/だっかんご]`. Sans nettoyage, le
 * japonais d'un embed est illisible.
 */
export function nettoyerRubis(texte: string | null | undefined): string {
	if (typeof texte !== "string") {
		return "";
	}
	return texte.replaceAll(/\[([^\][/]+)\/[^\][]*\]/g, "$1");
}

/**
 * Assemble `a · b · c` en ignorant les morceaux absents ou vides.
 *
 * @deprecated Réexport de `joindre` (`lib/ui`), gardé pour les appels existants.
 */
export { joindre };

/** Nombre au format français, sans décimale superflue. */
export function formaterNombre(valeur: number | null | undefined): string {
	return formaterNombreUi(valeur, { decimales: 2 });
}

/** Pourcentage au format français (`0.4972…` → `0,5 %` pour 3 chiffres significatifs). */
export function formaterPourcentage(valeur: number | null | undefined, decimales = 2): string {
	return formaterPourcentageUi(valeur, { decimales });
}

/** Libellés français des sept statistiques, dans l'ordre d'affichage du wiki. */
export const LIBELLES_STATS: ReadonlyArray<readonly [keyof Statistiques, string]> = [
	["kick", "Frappe"],
	["control", "Contrôle"],
	["technique", "Technique"],
	["pressure", "Pression"],
	["physical", "Physique"],
	["agility", "Agilité"],
	["intelligence", "Intelligence"],
];

/** Bloc `Frappe **133** · Contrôle **146** · …`, ou `null` si aucune valeur. */
export function ligneStats(stats: Statistiques | null | undefined): string | null {
	if (!stats) {
		return null;
	}
	const morceaux = LIBELLES_STATS.map(([clef, libelle]) =>
		typeof stats[clef] === "number" ? `${libelle} **${stats[clef]}**` : null
	);
	const ligne = joindre(morceaux);
	return ligne.length > 0 ? ligne : null;
}

/**
 * Regroupe des lignes en blocs qui tiennent dans la valeur d'un champ d'embed.
 *
 * Discord plafonne **durement** à 1024 caractères par valeur de champ et rejette
 * le message ENTIER au-delà. Une ligne seule trop longue est tronquée plutôt que
 * de faire échouer l'envoi.
 */
export function decouperEnChamps(
	lignes: readonly string[],
	options: { maxParChamp?: number; maxChamps?: number } = {}
): string[] {
	const maxParChamp = Math.max(1, options.maxParChamp ?? 1024);
	const maxChamps = Math.max(1, options.maxChamps ?? 25);
	const blocs: string[] = [];
	let courant = "";

	for (const ligneBrute of lignes) {
		if (blocs.length >= maxChamps) {
			break;
		}
		const ligne =
			ligneBrute.length > maxParChamp ? `${ligneBrute.slice(0, maxParChamp - 1)}…` : ligneBrute;
		if (courant.length === 0) {
			courant = ligne;
			continue;
		}
		if (courant.length + 1 + ligne.length <= maxParChamp) {
			courant = `${courant}\n${ligne}`;
			continue;
		}
		blocs.push(courant);
		courant = blocs.length >= maxChamps ? "" : ligne;
	}
	if (courant.length > 0 && blocs.length < maxChamps) {
		blocs.push(courant);
	}
	return blocs;
}

// --- Images ----------------------------------------------------------------

/** Hôte du CDN, seul à savoir décoder les CPK en direct et à servir les variantes. */
const HOTE_CDN = "cdn.rosegriffon.fr";

/**
 * Préfixes du CDN sur lesquels le service de variantes (`?w=…&format=webp`)
 * est branché par nginx. Ailleurs (portraits CloudFront, `/model-full/`,
 * `/images/`), poser `?w=` ne redimensionne rien et peut faire échouer la
 * requête : on s'en abstient.
 */
const PREFIXES_VARIANTES = ["/dx11/", "/g4tx/"];

/**
 * Chemins du CDN dont on a MESURÉ qu'ils ne servent rien d'affichable.
 *
 * `icon_chr/` sans le préfixe `200_icon/10_` : forme héritée du dump, 404 —
 * `corrigerCheminIconeChr` la répare quand elle en a la forme exacte ; ce qui
 * passe malgré tout est un cas non prévu, donc non servi.
 *
 * ⚠ `200_icon/02_icon_item/` N'EST PLUS mort. Les icônes d'objet sont bien des
 * textures d'un conteneur, mais le CDN sait désormais en extraire une seule
 * (`…/icon_item05.g4tx/eq_ac0100101.png`) : c'est cette forme que sert l'API.
 * Seule l'ancienne forme du dump, qui collait le nom du conteneur à celui de la
 * texture (`icon_item05_eq_ac0105301.png`), reste en 404 — voir `estFormeDump`.
 */
const PREFIXES_MORTS = ["/dx11/menu/icon_chr/"];

/**
 * Vrai pour un chemin au nommage du DUMP archivé : `<conteneur>_<texture>.png`.
 *
 * Le dump aplatissait chaque conteneur en un fichier par texture, en préfixant
 * le nom de la texture par celui du conteneur. Ce nommage n'existe dans AUCUN
 * des 250 800 chemins du CPK : il est mort par construction, et le décodage
 * live ne peut rien en faire.
 *
 * On le reconnaît à la répétition du même radical (`icon_item05_eq_…` n'en a
 * pas, mais `k000520_l_k000520_l00` oui) ou, sous `02_icon_item/`, à l'absence
 * du segment `.g4tx/` qui désigne une texture nommée.
 */
function estFormeDump(chemin: string): boolean {
	if (chemin.startsWith("/dx11/menu/200_icon/02_icon_item/") && !chemin.includes(".g4tx/")) {
		return true;
	}
	return /\/([A-Za-z0-9]+)_\1(?:_|\.)/.test(chemin);
}

/**
 * Répare le chemin d'une icône de personnage, d'aura ou d'esprit guerrier.
 *
 * `…/menu/icon_chr/<famille>/<code>_l_<code>[_N]_l00.png`
 *   → `…/menu/200_icon/10_icon_chr/<famille>/<code>_l.g4tx/<code>[_N]_l00.png`
 *
 * Les deux fautes de l'URL héritée sont corrigées d'un coup : le dossier
 * (`200_icon/10_` manquant) et le nommage du dump (conteneur collé à la texture).
 *
 * ⚠ On garde le NOM DE LA TEXTURE au lieu de retomber sur le fichier entier.
 * Un visage est un conteneur à DEUX textures (`_1_l00` = portrait, `_2_l00` =
 * seconde pose) : demander le fichier entier laisse le CDN choisir, et il rend
 * `_2_l00` (mesuré, md5 distincts). Pour les auras, conteneur mono-texture, les
 * deux formes rendent le même octet — la forme nommée est donc correcte partout.
 */
export function corrigerCheminIconeChr(chemin: string): string {
	if (!chemin.includes("/menu/icon_chr/")) {
		return chemin;
	}
	const repare = chemin.replace("/menu/icon_chr/", "/menu/200_icon/10_icon_chr/");
	return repare.replace(
		/\/([A-Za-z0-9]+)_l_(\1(?:_\d+)?_l\d+)(\.[A-Za-z0-9]+)$/,
		(_tout, base: string, texture: string, extension: string) =>
			`/${base}_l.g4tx/${texture}${extension}`
	);
}

/**
 * URL d'illustration réellement affichable dans un embed, ou `null`.
 *
 * Enchaîne : rejet du non-absolu (l'API renvoie `/ievr.webp` en repli), réparation
 * du dossier `icon_chr`, réparation du nom doublé, rejet des chemins prouvés
 * morts et de ce qui reste au nommage du dump, puis demande de variante WebP.
 *
 * `largeur` est indispensable sur les grandes illustrations : une planche
 * `gallery_img2` brute pèse jusqu'à 12 Mo, sa variante `w=400` ~13 Ko.
 */
export function imageJeu(
	url: string | null | undefined,
	largeur?: 200 | 400 | 800 | 1600
): string | null {
	if (typeof url !== "string") {
		return null;
	}
	const propre = url.trim();
	if (!propre.startsWith("http://") && !propre.startsWith("https://")) {
		return null;
	}
	let adresse: URL;
	try {
		adresse = new URL(propre);
	} catch {
		return null;
	}

	adresse.pathname = corrigerNomDouble(corrigerCheminIconeChr(adresse.pathname));

	if (
		adresse.hostname === HOTE_CDN &&
		(PREFIXES_MORTS.some((p) => adresse.pathname.startsWith(p)) || estFormeDump(adresse.pathname))
	) {
		return null;
	}
	if (
		largeur &&
		adresse.hostname === HOTE_CDN &&
		PREFIXES_VARIANTES.some((p) => adresse.pathname.startsWith(p))
	) {
		adresse.searchParams.set("w", String(largeur));
		adresse.searchParams.set("format", "webp");
	}
	return adresse.toString();
}

/**
 * Chemin dans l'index CPK correspondant à une image servie par le CDN.
 *
 * `https://cdn.rosegriffon.fr/dx11/menu/220_img/quest_img/story_img001_l01.png`
 *   → `data/dx11/menu/220_img/quest_img/story_img001_l01.g4tx`
 *
 * Sert de GARDE anti-404 : avant de poser dans un embed une URL qu'on a forgée
 * soi-même (portrait d'un code interne, illustration d'une quête), on demande à
 * `/api/cpk/file` si le fichier source existe vraiment. Renvoie `null` pour tout
 * ce qui ne vient pas du décodage CPK.
 */
export function cheminCpkDepuisUrl(url: string | null | undefined): string | null {
	if (typeof url !== "string") {
		return null;
	}
	let adresse: URL;
	try {
		adresse = new URL(url);
	} catch {
		return null;
	}
	if (adresse.hostname !== HOTE_CDN || !adresse.pathname.startsWith("/dx11/")) {
		return null;
	}
	const sansExtension = adresse.pathname.replace(/\.(png|webp|jpg|jpeg)$/i, "");
	if (sansExtension === adresse.pathname) {
		return null;
	}
	return `data${sansExtension}.g4tx`;
}

/**
 * Portrait 256×256 d'un personnage ou d'un membre de banc, depuis son code interne.
 *
 * `inagle_characters.image_url` est VIDE pour les personnages du jeu (mesuré :
 * `image: null` sur les 8 premières lignes de `/api/characters` et sur la fiche
 * de Mark Evans) et `inagle_coordinators.image` l'est pour les 102 entraîneurs.
 * Le visage existe pourtant : `200_icon/10_icon_chr/face/<code>_l.g4tx` est
 * présent dans l'index CPK et servi en 200 (18/18 codes essayés).
 *
 * Le suffixe de variante de statistiques (`_5000`, `_5100`…) n'existe pas côté
 * asset : seul le code de base porte un visage.
 */
export function urlVisage(codeInterne: string | null | undefined): string | null {
	if (typeof codeInterne !== "string") {
		return null;
	}
	const base = codeInterne.trim().replace(/_\d{4}$/, "");
	if (!/^[A-Za-z0-9]+$/.test(base) || base.length === 0) {
		return null;
	}
	return `https://${HOTE_CDN}/dx11/menu/200_icon/10_icon_chr/face/${base}_l.png`;
}

/**
 * Modèle 3D complet assemblé en direct depuis les CPK (corps + visage + uniforme).
 *
 * ⚠ SEULS les codes de personnage `c` + 8 chiffres sont servis. Mesuré le
 * 13/8/2026 sur `nie-model-serve` : 11/11 codes `c########` répondent 200
 * (345 à 480 Ko), tandis que `COORD_55` (entraîneur), `k000520`, `ka000520` et
 * `wkk00520` (esprit guerrier) répondent tous 404. La forme précédente
 * (`^[A-Za-z0-9]+$`) posait donc un lien mort dans l'embed dès qu'on l'appliquait
 * à autre chose qu'un joueur — et un embed Discord n'a pas d'`onError`.
 *
 * ⚠ SUFFIXE DE VARIANTE : la fiche détaillée d'un personnage sert des variantes
 * dont le code porte le numéro de jeu de paramètres (`c01000010_5000`, la
 * variante Mark Evans retenue par `/azalee perso`). Ce code-là répond **404** ;
 * seul le code de base répond 200. On le retire donc, exactement comme
 * `urlVisage` — sans quoi la fiche du personnage le plus consulté du wiki
 * affichait un lien de modèle 3D mort.
 *
 * Vérifié en base : les 5 130 personnages de `/api/characters` ont TOUS un
 * `internalCode` de la forme `c########` (1 000 lignes échantillonnées sur
 * 5 pages, une seule forme distincte). Le resserrage ne retire donc aucun
 * modèle réellement servi.
 */
export function urlModele3d(code: string | null | undefined): string | null {
	if (typeof code !== "string") {
		return null;
	}
	const base = code.trim().replace(/_\d{4}$/, "");
	if (!/^c\d{8}$/i.test(base)) {
		return null;
	}
	return `https://${HOTE_CDN}/model-full/${base}.glb`;
}

/**
 * Illustration d'une quête, forgée depuis le code d'image de `/api/quests`.
 *
 * L'API ne sert PAS d'URL pour les quêtes : `image` vaut un code nu
 * (`story_img001_l01`). Le fichier vit dans `220_img/quest_img/` — mesuré :
 * `data/dx11/menu/220_img/quest_img/story_img001_l01.g4tx` est présent dans
 * l'index CPK et `…/story_img001_l01.png?w=800&format=webp` répond 200
 * (27 338 octets). 45 des 182 quêtes n'ont pas de code : on renvoie `null`.
 */
export function urlIllustrationQuete(code: string | null | undefined): string | null {
	if (typeof code !== "string") {
		return null;
	}
	const propre = code.trim();
	if (!/^[A-Za-z0-9_]+$/.test(propre) || propre.length === 0) {
		return null;
	}
	return `https://${HOTE_CDN}/dx11/menu/220_img/quest_img/${propre}.png`;
}

// --- Familles d'auras ------------------------------------------------------

/**
 * Les cinq familles d'hyper-techniques, plus le fourre-tout `autres`.
 *
 * Les slugs sont ceux qu'attend `/api/auras/:type` (`viewMap` de
 * `wikiService.getAurasList`) ET ceux des pages du wiki (`/aura/<slug>`). Un
 * slug hors de cette liste renvoie `{"data":[],"total":0}` : c'est exactement le
 * cas mesuré avec `/api/auras/aura`, d'où la résolution stricte ci-dessous.
 */
export const TYPES_AURA = [
	{ slug: "esprits-guerriers", libelle: "Esprits guerriers" },
	{ slug: "totems", libelle: "Totems" },
	{ slug: "miximax", libelle: "Miximax" },
	{ slug: "eveil", libelle: "Éveils" },
	{ slug: "changement-mode", libelle: "Changements de mode" },
	{ slug: "autres", libelle: "Autres auras" },
] as const;

export type SlugAura = (typeof TYPES_AURA)[number]["slug"];

/** Libellé français d'une famille d'aura, ou le slug brut s'il est inconnu. */
export function libelleTypeAura(slug: string | null | undefined): string {
	return TYPES_AURA.find((t) => t.slug === slug)?.libelle ?? String(slug ?? "Aura");
}

/** Slug de famille valide, ou `null` — jamais une valeur qui ferait répondre du vide. */
export function resoudreTypeAura(saisie: string | null | undefined): SlugAura | null {
	if (typeof saisie !== "string") {
		return null;
	}
	const aiguille = normaliserLibelle(saisie);
	const parSlug = TYPES_AURA.find((t) => t.slug === aiguille);
	if (parSlug) {
		return parSlug.slug;
	}
	const parLibelle = TYPES_AURA.find((t) => normaliserLibelle(t.libelle) === aiguille);
	return parLibelle?.slug ?? null;
}

// --- Galerie ---------------------------------------------------------------

/**
 * Catégories d'illustration acceptées par `/api/gallery?category=…`.
 *
 * Les valeurs ET les libellés sont recopiés de `GALLERY_CATEGORIES`
 * (`packages/azalee/src/wiki/service.ts`), source canonique du wiki — ce module
 * ne peut pas l'importer, `service.ts` ouvrant `bun:sqlite`. Effectifs MESURÉS
 * le 13/8/2026 (`/api/gallery?category=<v>&limit=1`, champ `total`) : aucune
 * catégorie ne répond `{"data":[],"total":0}`.
 */
export const CATEGORIES_GALERIE = [
	{ valeur: "story", libelle: "Histoire", total: 242 },
	{ valeur: "chronicle", libelle: "Chroniques", total: 29 },
	{ valeur: "special", libelle: "Spéciales", total: 53 },
	{ valeur: "kizuna", libelle: "Liens", total: 2 },
	{ valeur: "other", libelle: "Autres", total: 34 },
	{ valeur: "gallery_img2", libelle: "Galerie", total: 363 },
	{ valeur: "ev_pic", libelle: "Événements", total: 70 },
	{ valeur: "stadium", libelle: "Stades", total: 202 },
	{ valeur: "vsroute_map", libelle: "Cartes route", total: 88 },
	{ valeur: "hlp", libelle: "Aide", total: 306 },
	{ valeur: "telop_waza", libelle: "Techniques", total: 1341 },
] as const;

/** Libellé français d'une catégorie d'illustration, ou la valeur brute. */
export function libelleCategorieGalerie(valeur: string | null | undefined): string {
	return (
		CATEGORIES_GALERIE.find((c) => c.valeur === valeur)?.libelle ?? String(valeur ?? "Illustration")
	);
}

/**
 * Catégorie d'illustration valide, ou `null`.
 *
 * Une catégorie inventée fait répondre `{"data":[],"total":0}` : on préfère
 * ignorer le filtre plutôt que rendre une liste vide sans explication.
 */
export function resoudreCategorieGalerie(saisie: string | null | undefined): string | null {
	if (typeof saisie !== "string") {
		return null;
	}
	const aiguille = normaliserLibelle(saisie);
	const trouvee = CATEGORIES_GALERIE.find(
		(c) => c.valeur === aiguille || normaliserLibelle(c.libelle) === aiguille
	);
	return trouvee?.valeur ?? null;
}

// --- Quêtes et succès ------------------------------------------------------

/** Libellé français du genre d'une quête (`kind` de `/api/quests` : 137 `main`, 45 `side`). */
export function libelleGenreQuete(kind: string | null | undefined): string {
	if (kind === "main") {
		return "Quête principale";
	}
	if (kind === "side") {
		return "Quête annexe";
	}
	return "Quête";
}

/**
 * Libellé français d'une catégorie de succès.
 *
 * Valeurs réelles de `/api/trophies` (228 lignes) : `trophy` 52, `activity` 176.
 */
export function libelleCategorieSucces(categorie: string | null | undefined): string {
	if (categorie === "trophy") {
		return "Trophée";
	}
	if (categorie === "activity") {
		return "Activité";
	}
	return String(categorie ?? "Succès");
}

// --- Coordinateurs ---------------------------------------------------------

/**
 * Libellé français du rôle de banc d'un coordinateur.
 *
 * ⚠ `/api/coordinators` sert le rôle en ANGLAIS dans `variants[].rarity`
 * (mesuré sur les 102 lignes : `Manager` 68, `Coordinator` 31, `Coach` 3), là où
 * `/api/coaches` le traduit déjà dans `roleFr`. Les trois libellés ci-dessous
 * sont ceux de `ROLE_FR` (`packages/azalee/src/wiki/coaches.ts`), source
 * canonique du wiki — ce module ne peut pas l'importer, `coaches.ts` ouvrant
 * `bun:sqlite`. « Coach » et « Manager » sont volontairement identiques en
 * français : c'est le choix du wiki, pas un oubli de traduction.
 */
export function libelleRoleCoordinateur(role: string | null | undefined): string | null {
	if (typeof role !== "string" || role.trim().length === 0) {
		return null;
	}
	const roles: Record<string, string> = {
		coach: "Coach",
		coordinator: "Coordinateur",
		manager: "Manager",
	};
	return roles[normaliserLibelle(role)] ?? role;
}

// --- Pagination ------------------------------------------------------------

/** Nombre de pages pour un total et une taille de page donnés (au moins 1). */
export function nombreDePages(total: number, parPage: number): number {
	if (!Number.isFinite(total) || total <= 0 || parPage <= 0) {
		return 1;
	}
	return Math.max(1, Math.ceil(total / parPage));
}

/** Ramène une page dans les bornes : une page hors limites ne doit pas répondre « vide ». */
export function bornerPage(page: number, total: number, parPage: number): number {
	const pages = nombreDePages(total, parPage);
	if (!Number.isFinite(page)) {
		return 1;
	}
	return Math.min(Math.max(1, Math.trunc(page)), pages);
}

/** Préfixe des boutons de pagination des listes de données de jeu. */
export const PREFIXE_BOUTON_AZALEE = "az";

/** Longueur maximale d'un `customId` de composant Discord. */
const MAX_CUSTOM_ID = 100;

/** État d'une liste paginée, entièrement porté par le `customId` du bouton. */
export interface EtatListeAzalee {
	/** Vue concernée (`galerie`, `drops`, `coordinateur`, …). */
	vue: string;
	/** Page demandée, 1-based. */
	page: number;
	/** Filtre principal de la vue (catégorie, famille, rôle…), ou `null`. */
	filtre: string | null;
	/** Texte de recherche libre, ou `null`. */
	recherche: string | null;
}

/** Retire le séparateur d'un fragment pour qu'il ne casse pas le décodage. */
function sansSeparateur(valeur: string | null | undefined): string {
	return typeof valeur === "string" ? valeur.replaceAll("|", " ").trim() : "";
}

/**
 * Encode l'état d'une liste dans un `customId`.
 *
 * Tout l'état tient dans l'identifiant : aucune mémoire de processus, donc un
 * redémarrage du bot ne laisse jamais de bouton mort. Renvoie `null` si
 * l'identifiant dépasse la limite Discord — l'appelant n'affiche alors pas de
 * bouton plutôt que d'envoyer un composant refusé.
 */
export function encoderEtatListe(etat: EtatListeAzalee): string | null {
	const identifiant = [
		PREFIXE_BOUTON_AZALEE,
		sansSeparateur(etat.vue),
		String(Math.max(1, Math.trunc(etat.page))),
		sansSeparateur(etat.filtre),
		sansSeparateur(etat.recherche),
	].join("|");
	return identifiant.length <= MAX_CUSTOM_ID ? identifiant : null;
}

/** Décode un `customId` produit par `encoderEtatListe`. `null` si ce n'en est pas un. */
export function decoderEtatListe(customId: string): EtatListeAzalee | null {
	const morceaux = customId.split("|");
	if (morceaux.length !== 5 || morceaux[0] !== PREFIXE_BOUTON_AZALEE) {
		return null;
	}
	const vue = morceaux[1] ?? "";
	const page = Number.parseInt(morceaux[2] ?? "", 10);
	if (vue.length === 0 || !Number.isFinite(page) || page < 1) {
		return null;
	}
	return {
		vue,
		page,
		filtre: morceaux[3] || null,
		recherche: morceaux[4] || null,
	};
}

// --- Divers ----------------------------------------------------------------

/**
 * Ordonne des propositions d'autocomplétion portant sur des OBJETS.
 *
 * Même règle que `suggerer` de `ievr-labels` (ce qui COMMENCE par la saisie
 * passe devant ce qui la contient seulement, 25 propositions au plus), mais sur
 * une liste d'objets dont l'étiquette est calculée — cas des équipes, des
 * stades ou des familles d'aura, qui ne sont pas de simples chaînes.
 * La normalisation est celle de `ievr-labels`, sans accent ni casse.
 */
export function classerPropositions<T>(
	valeurs: readonly T[],
	saisie: string | null | undefined,
	etiquette: (valeur: T) => string,
	max = 25
): T[] {
	const aiguille = normaliserLibelle(saisie ?? "");
	if (aiguille.length === 0) {
		return valeurs.slice(0, max);
	}
	const debuts: T[] = [];
	const milieux: T[] = [];
	for (const valeur of valeurs) {
		const normalisee = normaliserLibelle(etiquette(valeur));
		if (normalisee.startsWith(aiguille)) {
			debuts.push(valeur);
		} else if (normalisee.includes(aiguille)) {
			milieux.push(valeur);
		}
	}
	return [...debuts, ...milieux].slice(0, max);
}

// ─── Identité visuelle des fiches ───────────────────────────────────────────

/**
 * Couleur d'une fiche selon son élément.
 *
 * Le wiki colore chaque fiche par élément : c'est le repère le plus rapide dans
 * une liste, avant même de lire le titre. Un embed uniformément orange perd
 * cette information alors qu'elle est gratuite. Les teintes reprennent la
 * charte Rose Griffon (marine `#0c1730`, or `#d4af37`, brique `#a14b3f`,
 * Azalée `#F89C5A`) déclinée par élément, et non des couleurs inventées.
 */
export const COULEURS_ELEMENT: Readonly<Record<string, number>> = Object.freeze({
	Feu: 0xa1_4b_3f,
	Vent: 0x5b_8f_b9,
	Forêt: 0x4c_8b_5a,
	Montagne: 0xd4_af_37,
	Néant: 0x0c_17_30,
});

/** Couleur d'embed pour un élément, `null` si l'élément est inconnu. */
export function couleurElement(element: string | null | undefined): number | null {
	const canonique = resoudreElement(element);
	return canonique ? (COULEURS_ELEMENT[canonique] ?? null) : null;
}

/**
 * Émoji d'un élément.
 *
 * Émojis UNICODE, pas des émojis personnalisés du serveur : le bot Azalée doit
 * pouvoir afficher une fiche sur n'importe quel serveur, y compris un où il n'a
 * pas la permission « Utiliser des émojis externes ».
 */
export const EMOJIS_ELEMENT: Readonly<Record<string, string>> = Object.freeze({
	Feu: "🔥",
	Vent: "🌪️",
	Forêt: "🌳",
	Montagne: "⛰️",
	Néant: "✨",
});

export function emojiElement(element: string | null | undefined): string {
	const canonique = resoudreElement(element);
	return canonique ? (EMOJIS_ELEMENT[canonique] ?? "") : "";
}

/** Émoji d'une catégorie de technique (tir, dribble, défense, arrêt). */
export const EMOJIS_CATEGORIE: Readonly<Record<string, string>> = Object.freeze({
	Tir: "⚽",
	Dribble: "💨",
	Défense: "🛡️",
	Arrêt: "🧤",
});

export function emojiCategorie(categorie: string | null | undefined): string {
	const canonique = resoudreCategorieTechnique(categorie);
	return canonique ? (EMOJIS_CATEGORIE[canonique] ?? "") : "";
}

/** Émoji d'une position de joueur. */
export const EMOJIS_POSITION: Readonly<Record<string, string>> = Object.freeze({
	Gardien: "🧤",
	Défenseur: "🛡️",
	Milieu: "🎯",
	Attaquant: "⚽",
});

export function emojiPosition(position: string | null | undefined): string {
	const canonique = resoudrePosition(position);
	return canonique ? (EMOJIS_POSITION[canonique] ?? "") : "";
}

/**
 * Titre d'une fiche : émoji, nom, puis la mention discrète qui situe la fiche.
 *
 * Discord tronque un titre à 256 caractères ; on borne à 250 pour laisser la
 * place à l'ellipse. L'émoji n'est ajouté que s'il est connu — un titre qui
 * commence par une espace orpheline est pire que pas d'émoji du tout.
 */
export function titreFiche(nom: string, emoji?: string | null, mention?: string | null): string {
	const debut = emoji && emoji.length > 0 ? `${emoji} ${nom}` : nom;
	const complet = mention && mention.length > 0 ? `${debut} — ${mention}` : debut;
	return complet.length > 250 ? `${complet.slice(0, 249).trimEnd()}…` : complet;
}
