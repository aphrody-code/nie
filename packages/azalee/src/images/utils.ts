/**
 * Utilitaires légers pour la génération d'URLs d'images de jeu.
 * Fonctionne côté client et serveur.
 *
 * ## Adressage : chemins CPK réels, plus jamais le nommage du dump
 *
 * Le dump PNG pré-extrait (`dx11/menu/**`) est parti en archive froide. Les
 * assets sont désormais décodés **live depuis les CPK** par `nie-model-serve`
 * derrière `cdn.rosegriffon.fr`. Ce service expose deux formes, et deux seulement :
 *
 * ```text
 * 1:1              https://cdn.rosegriffon.fr/dx11/menu/<chemin>.png
 *                  → data/dx11/menu/<chemin>.g4tx, texture principale
 * texture nommée   https://cdn.rosegriffon.fr/dx11/menu/<chemin>.g4tx/<texture>.png
 *                  → sélection par nom (conteneur multi-textures) ou rognage
 *                    du rectangle nommé (atlas spatial)
 * ```
 *
 * Le dump, lui, nommait ses fichiers `<basename_g4tx>_<nom_texture>.png` — un
 * nommage qui n'existe dans AUCUN chemin CPK. Toute URL de cette forme est un 404
 * garanti : elles ont toutes été retirées d'ici. Les manifestes servant de
 * garde-fous sont régénérés depuis `apps/azalee/data/cpk-index.ndjson.gz`
 * (250 800 chemins réels) et non plus depuis `inagle_game_assets`, dont les
 * 40 471 lignes `exists = 1` décrivent le dump disparu.
 */
import characterFaceManifest from "../data/character-face-manifest.json";
import characterModelManifest from "../data/character-model-manifest.json";
import chrModelManifest from "../data/chr-model-manifest.json";
import itemImageManifest from "../data/item-image-manifest.json";
import keshinModelManifest from "../data/keshin-model-manifest.json";
import menuAssetManifest from "../data/menu-asset-manifest.json";
import miximaxIconManifest from "../data/miximax-icon-manifest.json";

/**
 * Manifeste objets : `internal_code` → conteneur `.g4tx` + nom de texture réels
 * (cf. `scripts/build-item-image-manifest.ts`). Une valeur numérique désigne le
 * conteneur, la texture portant alors le nom de l'objet ; un couple
 * `[index, nom]` couvre les textures au nom différent du code (plaques `nm*`).
 *
 * Il remplace l'ancienne table de familles `internal_code` → `icon_item<NN>_` :
 * le dossier écrit en base est FAUX pour 522 objets sur 1300 (les `em*` vivent
 * dans `01_icon_emblem`, les `coa_animal_*` dans `22_icon_town`, les `ds*` dans
 * `20_icon_deco`, les `nm*` dans `25_icon_nameplate`).
 */
const ITEM_IMAGE_MANIFEST = itemImageManifest as unknown as {
	containers: string[];
	items: Record<string, number | [number, string]>;
};

/**
 * Garde-fous d'assets menu, générés depuis l'index CPK réel
 * (`scripts/build-menu-asset-manifest.ts`). Chaque famille liste les basenames
 * `.g4tx` qui existent VRAIMENT ; un code absent → placeholder, jamais une URL
 * forgée en 404.
 */
const MENU_ASSETS = menuAssetManifest as {
	emblems: string[];
	telop: { en: string[]; fr: string[] };
	aura: { armed: string[]; fs: string[]; mixi: string[]; soul: string[] };
	uniformsPersonal: string[];
};

const EMBLEM_NAMES = new Set(MENU_ASSETS.emblems);
const TELOP_FR = new Set(MENU_ASSETS.telop.fr);
const TELOP_EN = new Set(MENU_ASSETS.telop.en);
const AURA_FS_CODES = new Set(MENU_ASSETS.aura.fs);
const AURA_SOUL_CODES = new Set(MENU_ASSETS.aura.soul);
const AURA_MIXI_CODES = new Set(MENU_ASSETS.aura.mixi);

/**
 * Correspondance code Miximax (`icon_code` `c05028XXX` ou `asset_code` base `wmm00XXX`)
 * → code d'icône RÉEL des CPK (`ca/cn/cp/iau`). Généré par
 * `scripts/build-miximax-icon-manifest.ts` (cf. ce fichier pour la dérivation
 * `config.skillId2` → `inagle_chara_menu_resource` → fichier disque).
 *
 * `inagle_miximax.icon_code` vaut `c05028XXX` (dérivé du code perso) mais AUCUN fichier
 * `c05028XXX` n'existe : les 17 vrais conteneurs portent des codes
 * hétérogènes non dérivables par règle. Seules les entrées présentes ici ont un fichier
 * sur disque — un code absent → placeholder (le caller bascule sur telop/image_url), pas
 * un 404 forgé.
 */
const MIXIMAX_ICON_MANIFEST = miximaxIconManifest as Record<string, string>;

/**
 * Set EXHAUSTIF des codes de base `c<NNNNNNNN>` qui possèdent réellement un visage
 * variant-1. Vérifié contre l'index CPK : **5677/5677** ont bien un conteneur
 * `200_icon/10_icon_chr/face/<code>_l.g4tx` (le CPK en compte 5678, le surplus étant
 * `face_ban00`, non nominatif). Régénéré par `scripts/build-character-face-manifest.ts`.
 * Sert de gate à `getCharacterFaceUrl` : placeholder pour les persos sans visage.
 */
const CHARACTER_FACE_CODES = new Set(characterFaceManifest as string[]);

/**
 * Set EXHAUSTIF des basenames `c<NNNNNNNN>` (et autres) qui possèdent un modèle 3D GLB
 * réellement servi sur `cdn.rosegriffon.fr/model/<base>.glb`. Généré par
 * `iecode cdn export-glb` (g4mg+g4md → GLB) puis listé depuis le dossier servi par nginx.
 * 5502 personnages ont un modèle (intersection avec les faces). Sert de gate à
 * `getCharacterModelGlbUrl` pour ne monter le viewer 3D que quand le GLB existe (sinon
 * fallback image) — même garde-fou anti-404 que CHARACTER_FACE_CODES.
 */
const CHARACTER_MODEL_CODES = new Set(characterModelManifest as string[]);

/**
 * Gate des modèles 3D COMPLETS keshin (`k<NNNNNN>`) + armures (`ka<NNNNNN>NN`) réellement
 * servis live par `nie-model-serve` sur `cdn.rosegriffon.fr/model-full/<code>.glb`.
 * Vérité terrain = probe HTTP du vrai endpoint (cf. `scripts/build-keshin-model-manifest.ts`).
 *
 * Aujourd'hui : 5 keshin (ceux en `.g4md`) + 89 armures. Les ~92 keshin restants ne
 * sont qu'en `.g4mg` — pas encore assemblables côté serving → exclus du gate (pas de
 * bouton 3D mort). Régénérer le manifeste quand la couche serving gagne le support g4mg.
 */
const KESHIN_MODEL_CODES = new Set((keshinModelManifest as { keshin: string[] }).keshin);
const ARMURE_MODEL_CODES = new Set((keshinModelManifest as { armures: string[] }).armures);

/**
 * Set EXHAUSTIF des codes uniforme PERSONNELS `u<NNNNNNNN>` (8 chiffres) qui possèdent
 * un fichier `200_icon/10_icon_chr/uniform/u<8>_l.g4tx` dans les CPK. Généré depuis
 * l'index CPK (`menu-asset-manifest.json`) : **303 codes**, identiques au scan du dump
 * d'origine (`diff` = vide, 303/303) — l'allowlist était juste, seule l'URL était fausse.
 *
 * Le code uniforme dérive du code perso par swap de préfixe `c<8>` → `u<8>`. Le gate
 * reste POSITIF : ~5380 persos n'ont AUCUN uniforme personnel et renvoient une chaîne
 * vide (le caller affiche le portrait/placeholder), jamais un 404 forgé.
 *
 * ⚠ Ne PAS décomposer un `u<8>` en `u<6>_<NN>` : les uniformes personnels (303) et les
 * kits d'équipe (`u<6>_<NN>_<NN>_l`, 10910) sont deux namespaces DISJOINTS.
 */
const CHARACTER_UNIFORM_CODES = new Set<string>(MENU_ASSETS.uniformsPersonal);

// Constantes globales
export const CDN_URL = process.env.NEXT_PUBLIC_ASSET_URL || "https://azalee.rosegriffon.fr";
export const CDN_ASSETS = CDN_URL; // Alias pour compatibilité

/** Racine CDN du namespace menu — décodage live des CPK par `nie-model-serve`. */
const MENU_CDN_BASE = "https://cdn.rosegriffon.fr/dx11/menu";
export const MENU_BUCKET_URL = MENU_CDN_BASE;

/** Racine des icônes de personnage (visages, uniformes, auras, miximax, coachs). */
const ICON_CHR_BASE = "200_icon/10_icon_chr";

/**
 * URL d'un fichier menu **1:1** : `<chemin>.g4tx` → `<chemin>.png`. À réserver aux
 * conteneurs à texture unique (illustrations `220_img/**`, emblèmes) où la sélection
 * de la texture principale est sans ambiguïté.
 */
function menuFileUrl(relativePath: string): string {
	return `${MENU_CDN_BASE}/${relativePath}.png`;
}

/**
 * URL d'une **texture nommée** dans un conteneur : `<chemin>.g4tx/<texture>.png`.
 * Obligatoire dès qu'un conteneur porte plusieurs textures (visages `_1_l00`/`_2_l00`,
 * uniformes `_1`/`_2`, icônes d'objets) — sans le nom, le service retombe sur la plus
 * grande par aire et sert une image arbitraire.
 */
function menuTextureUrl(g4txPath: string, textureName: string): string {
	// Le chemin est accepté avec ou sans son extension (le manifeste objets la porte).
	const base = g4txPath.endsWith(".g4tx") ? g4txPath.slice(0, -".g4tx".length) : g4txPath;
	return `${MENU_CDN_BASE}/${base}.g4tx/${textureName}.png`;
}

// Prefixe Supabase Storage legacy stocke en DB (cf. inagle_skills.image_url
// — ~1010 lignes, 2026-04). Rewrite transparent vers le CDN local.
const LEGACY_STORAGE_PREFIX = "/storage/v1/object/public/menu/";

/**
 * Résout un `internal_code` d'objet vers son **couple (conteneur, texture)** réel,
 * ou `null` si l'objet n'a d'icône nulle part dans les CPK (367 codes sur 1667 —
 * trou de données du jeu, vérifié absent des 250 800 chemins indexés).
 *
 * La résolution vient du manifeste `item-image-manifest.json`, construit en
 * interrogeant l'index texture → conteneur. Elle remplace l'ancienne dérivation par
 * famille (`eq_ac` → `icon_item05_…`) qui supposait à la fois un nom de fichier de
 * dump et un dossier — tous deux faux.
 */
export function resolveItemIcon(
	internalCode: string
): { g4txPath: string; textureName: string } | null {
	const entry = ITEM_IMAGE_MANIFEST.items[internalCode];
	if (entry === undefined) {
		return null;
	}
	const [index, name] = typeof entry === "number" ? [entry, internalCode] : entry;
	const g4txPath = ITEM_IMAGE_MANIFEST.containers[index];
	return g4txPath ? { g4txPath, textureName: name } : null;
}

/**
 * URL CDN d'un emblème par son nom de fichier réel (`em010003`, `em0001_s`…).
 * Conteneur à texture unique → forme 1:1. `null` si le nom n'existe pas dans les
 * 542 emblèmes du CPK (gate anti-404).
 */
function emblemFileUrl(name: string): string | null {
	return EMBLEM_NAMES.has(name) ? menuFileUrl(`200_icon/01_icon_emblem/${name}`) : null;
}

/**
 * URL CDN d'un telop de technique. Le dossier `220_img/telop_waza/` n'a que deux
 * langues servies (`fr` 1243 fichiers, `en` 1247) : on privilégie `fr` puis on
 * retombe sur `en`. `null` si le code n'a aucun telop (144 techniques sur 1002).
 */
function telopUrl(code: string): string | null {
	if (TELOP_FR.has(code)) return menuFileUrl(`220_img/telop_waza/fr/${code}`);
	if (TELOP_EN.has(code)) return menuFileUrl(`220_img/telop_waza/en/${code}`);
	return null;
}

/** Dossiers d'icônes d'aura de `200_icon/10_icon_chr/` adressables par code. */
type AuraFolder = "aura_fs" | "aura_soul" | "aura_mixi";

/**
 * URL CDN d'une icône d'aura (`aura_fs`/`aura_soul`/`aura_mixi`). Le conteneur
 * `<base>_l.g4tx` porte une texture unique nommée `<base>_l00` : on l'adresse par son
 * nom (forme nommée) plutôt qu'en 1:1, pour ne dépendre d'aucune heuristique côté
 * service. `null` si le code n'existe pas (gate anti-404).
 */
const AURA_GATES: Record<AuraFolder, Set<string>> = {
	aura_fs: AURA_FS_CODES,
	aura_mixi: AURA_MIXI_CODES,
	aura_soul: AURA_SOUL_CODES,
};

function auraIconUrl(folder: AuraFolder, base: string): string | null {
	if (!AURA_GATES[folder].has(base)) return null;
	return menuTextureUrl(`${ICON_CHR_BASE}/${folder}/${base}_l`, `${base}_l00`);
}

/**
 * Réécrit un `image_url` legacy de la DB (chemins du bucket Supabase `menu/…webp`,
 * hérités du dump) vers le vrai chemin CPK. Rend `null` quand aucune correspondance
 * réelle n'existe : mieux vaut un placeholder qu'une URL forgée en 404.
 */
function mapLegacyMenuPath(menuPath: string): string | null {
	const chrMatch = menuPath.match(/^200_icon\/10_icon_chr\/([^/]+)\/([^/]+?)_l(?:_[^.]+)?\.webp$/);
	if (chrMatch) {
		const folder = chrMatch[1] as string;
		const base = chrMatch[2] as string;
		if (folder === "aura_fs" || folder === "aura_soul" || folder === "aura_mixi") {
			// Même contrainte que getAuraImageUrl : le jeu n'a que les icônes « famille »
			// (numéro multiple de 10). On arrondit (`k000721` → `k000720`), sinon les
			// formes évoluées (…721/…2025) n'ont aucun fichier.
			const auraBase = base.replace(/^([ka])(\d+)$/, (_m, p, n) => `${p}${auraFamilyBase(n)}`);
			return auraIconUrl(folder, auraBase);
		}
		if (folder === "face") {
			return CHARACTER_FACE_CODES.has(base) ? characterFaceUrl(base) : null;
		}
		if (folder === "uniform") {
			return CHARACTER_UNIFORM_CODES.has(base) ? uniformIconUrl(base) : null;
		}
		return null;
	}
	const emMatch = menuPath.match(/^200_icon\/01_icon_emblem\/(em[0-9a-z_]+)\.webp$/i);
	if (emMatch) {
		// Les `emblem_url` en `0x<CRC>.webp` (208/208 des équipes) ne correspondent à AUCUN
		// nom d'emblème : ce CRC est celui de l'identifiant d'équipe, pas d'un fichier
		// (0/208 présents dans emblem-crc-map). Ils tombent donc en `null` — trou de données
		// réel, pas un problème d'adressage.
		return emblemFileUrl(emMatch[1] as string);
	}
	// Plaques de nom : `inagle_nameplates.image_path` stocke le chemin SANS extension
	// (`200_icon/25_icon_nameplate/nm04201`). Le conteneur porte deux textures de même
	// taille (`_01`/`_02`) → forme nommée obligatoire, résolue par le manifeste.
	const plateMatch = menuPath.match(/^200_icon\/25_icon_nameplate\/([^/.]+)$/);
	if (plateMatch) {
		const ref = resolveItemIcon(plateMatch[1] as string);
		return ref ? menuTextureUrl(ref.g4txPath, ref.textureName) : null;
	}
	const itemMatch = menuPath.match(/^200_icon\/02_icon_item\/(.+)\.webp$/);
	if (itemMatch) {
		// Le dossier écrit en base est FAUX pour 40 % du catalogue : on passe par le
		// manifeste (conteneur + texture réels), jamais par le chemin stocké.
		const ref = resolveItemIcon(itemMatch[1] as string);
		return ref ? menuTextureUrl(ref.g4txPath, ref.textureName) : null;
	}
	const telopMatch = menuPath.match(/^220_img\/telop_waza\/[a-z_]+\/([^/]+)\.webp$/);
	if (telopMatch) {
		// Le nom stocké porte un suffixe de variante du dump (`whd00030_0`) et parfois le
		// doublage (`x_x`) : on revient au code nu avant de consulter le gate. Les formes
		// dérivées (`whd00390_or`, `whd00900_mm`) n'ont pas de telop propre mais réutilisent
		// celui de leur technique de base — d'où le second essai (65 lignes récupérées).
		const raw = telopMatch[1] as string;
		const dupMatch = raw.match(/^(.+)_\1$/);
		const code = dupMatch ? (dupMatch[1] as string) : raw.replace(/_0$/, "");
		return telopUrl(code) ?? telopUrl(code.replace(/_[a-z]+$/i, ""));
	}
	return null;
}

/**
 * Résout un path legacy déjà débarrassé de son préfixe (`200_icon/…webp`).
 *
 * Sans correspondance dans les CPK, on renvoie le **placeholder** : re-forger le
 * `.webp` du bucket disparu serait un 404 garanti. Le repli « chemin brut » n'est
 * conservé que pour les chemins qui désignent déjà un fichier CPK (`.png`) — tout
 * `.webp` non résolu est un vestige du dump.
 */
function mapStrippedMenuPath(stripped: string): string {
	const mapped = mapLegacyMenuPath(stripped);
	if (mapped) {
		return mapped;
	}
	// Seul un `.png` déjà correct peut passer tel quel : tout le reste (`.webp` du bucket
	// disparu, chemin de dossier, chemin sans extension non reconnu) serait un 404.
	if (!stripped.endsWith(".png")) {
		return PLACEHOLDERS.item;
	}
	return `${MENU_CDN_BASE}/${stripped}`;
}

/** Resolve a potentially relative asset path to a full URL. */
export function resolveAssetUrl(path: string | null | undefined): string | null {
	if (!path) {
		return null;
	}
	if (path.startsWith(LEGACY_STORAGE_PREFIX)) {
		return mapStrippedMenuPath(path.slice(LEGACY_STORAGE_PREFIX.length));
	}
	// Forme legacy DB raccourcie `/menu/200_icon/…​.webp` (sans le préfixe storage
	// complet) : c'est un chemin d'asset, pas une route locale. On retire `/menu/`
	// et on route vers le mapper legacy comme les autres webp — sinon le `startsWith("/")`
	// ci-dessous le renverrait tel quel vers une route azalee inexistante (404).
	// Cas réel : 42 keshins sans `asset_code` pointant vers les emblèmes em0001-em0004.
	if (path.startsWith("/menu/")) {
		return mapStrippedMenuPath(path.slice("/menu/".length));
	}
	if (path.startsWith("http") || path.startsWith("/")) {
		return path;
	}
	return mapStrippedMenuPath(path);
}

/**
 * URL d'une illustration de galerie (`inagle_gallery.img_path`).
 *
 * Vérité terrain (index CPK) : les illustrations vivent en
 * `dx11/menu/220_img/gallery_img2/<img_path>.g4tx` — 363 fichiers, conteneur à
 * texture unique portant le nom du fichier → forme 1:1. Les 360 `img_path` de
 * `inagle_gallery` sont tous présents (360/360).
 *
 * Renvoie `null` pour un `img_path` vide → le caller bascule sur le placeholder.
 */
export function getGalleryImageUrl(imgPath: string | undefined | null): string | null {
	if (!imgPath) {
		return null;
	}
	return menuFileUrl(`220_img/gallery_img2/${imgPath}`);
}

/**
 * Largeurs de variantes whitelistées côté CDN (`apps/cdn-variants`, :8805). Toute
 * autre largeur est « snappée » à la plus proche par le service, mais on s'aligne ici
 * pour ne demander que des tailles cachées (un seul fichier disque par largeur).
 */
export const GALLERY_VARIANT_WIDTHS = [200, 400, 800, 1600] as const;
export type GalleryVariantWidth = (typeof GALLERY_VARIANT_WIDTHS)[number];

/**
 * Décline une URL d'illustration CDN brute (`cdn.rosegriffon.fr/dx11/...png`,
 * potentiellement multi-Mo) en variante WebP redimensionnée servie par le service
 * `cdn-variants` (resize+webp q≈78, cache disque). nginx route les `/dx11|/g4tx` AVEC
 * `?w=` vers ce service ; SANS query le serving direct reste le PNG plein cadre.
 *
 * Ne réécrit QUE les URLs `/dx11/` ou `/g4tx/` raster (png/jpg). Tout autre host/chemin
 * (placeholder local, webp déjà léger, route relative) est renvoyé tel quel — la
 * fonction est donc idempotente et sûre à appliquer partout.
 *
 * `recadrerBandes` ajoute `&crop=bandes` : le service retire alors les deux
 * bandes noires horizontales dont le jeu entoure ses illustrations (letterbox).
 * Elles coûtent près d'un tiers de la hauteur d'une vignette — mesuré : 450 px
 * de haut dont 124 de bandes sur les scènes d'histoire — et se voient d'autant
 * plus qu'on affiche l'image dans un cadre à ratio fixe. Le service ne coupe
 * que ce qui est effectivement noir, et jamais plus de 35 % par côté : une
 * illustration sans bande ressort inchangée.
 */
export function galleryVariantUrl(
	url: string | null | undefined,
	width: GalleryVariantWidth,
	options: { recadrerBandes?: boolean } = {}
): string | null {
	if (!url) {
		return null;
	}
	// Seules les sources CDN dx11/g4tx ont un décodeur de variantes derrière nginx.
	// On match sur le chemin (host implicite ou explicite) pour rester robuste.
	if (!/\/(dx11|g4tx)\//.test(url)) {
		return url;
	}
	// Ne resize que des sources raster lourdes (png/jpg/jpeg). Un webp est déjà léger.
	if (!/\.(png|jpe?g)(\?|$)/i.test(url)) {
		return url;
	}
	// Si une query existe déjà (improbable ici), on évite de doubler `?`.
	const sep = url.includes("?") ? "&" : "?";
	const recadrage = options.recadrerBandes ? "&crop=bandes" : "";
	return `${url}${sep}w=${width}&format=webp${recadrage}`;
}

/**
 * URL du **portrait** d'un personnage (visage « large », variante 1).
 *
 * Chemin réel : `200_icon/10_icon_chr/face/<code>_l.g4tx`, conteneur à DEUX textures
 * (`<code>_1_l00` = portrait, `<code>_2_l00` = seconde pose). Il faut donc la forme
 * NOMMÉE : en 1:1 le service départage par aire, les deux textures font la même
 * taille, et il sert `_2_l00` — le mauvais portrait (md5 différents, mesuré).
 */
function characterFaceUrl(baseCode: string): string {
	return menuTextureUrl(`${ICON_CHR_BASE}/face/${baseCode}_l`, `${baseCode}_1_l00`);
}

/**
 * URL du portrait d'un personnage, gardée par `CHARACTER_FACE_CODES` (5677 codes,
 * 5677/5677 présents dans les CPK) : un code sans visage rend `PLACEHOLDERS.character`
 * au lieu d'une URL qui déclencherait un 404 silencieux côté `<Image onError>`.
 */
export function getCharacterFaceUrl(
	charaId: string | undefined | null,
	_unused?: string | null
): string {
	if (!charaId) {
		return PLACEHOLDERS.character;
	}
	// Strip _5000/_5100/etc. suffix — seuls les codes de base ont un visage.
	const baseCode = charaId.replace(/_\d{4}$/, "");
	if (!CHARACTER_FACE_CODES.has(baseCode)) {
		return PLACEHOLDERS.character;
	}
	return characterFaceUrl(baseCode);
}
// Alias pour compatibilité
export const getCharacterImageUrl = getCharacterFaceUrl;

/**
 * Dérive le code uniforme `u<8>` d'un code perso et le retourne UNIQUEMENT s'il a un
 * fichier réel (`CHARACTER_UNIFORM_CODES`, 303 codes). Sinon `null` → le caller ne
 * tente pas d'URL. Le code uniforme = code perso, préfixe `c` → `u`.
 */
function resolveUniformCode(charaId: string | undefined | null): string | null {
	if (!charaId) {
		return null;
	}
	// Strip suffixe de variante (_5000/_5100…) — seul le code de base a un uniforme.
	const baseCode = charaId.replace(/_\d{4}$/, "");
	const uniformCode = baseCode.startsWith("c") ? `u${baseCode.slice(1)}` : baseCode;
	return CHARACTER_UNIFORM_CODES.has(uniformCode) ? uniformCode : null;
}

/**
 * URL de l'icône d'un uniforme depuis son code de fichier (`u11010010`).
 *
 * Chemin réel : `200_icon/10_icon_chr/uniform/<code>_l.g4tx`, DEUX textures
 * (vérifié sur les 12483 fichiers du dossier, 12483/12483 conformes) :
 *   - `<code>_1` = le maillot (jamais vide, 0/12483 plats) → c'est celui qu'on sert ;
 *   - `<code>_2` = le MASQUE DE POSE DE L'EMBLÈME (vide dans 516/12483). Ce n'est
 *     PAS une vue de dos — d'où la suppression de `getCharacterUniformBackUrl`.
 *
 * La forme 1:1 est INTERDITE ici : les deux textures font 256×256, le départage par
 * aire sert `_2` (le masque), prouvé au pixel près.
 */
function uniformIconUrl(code: string): string {
	return menuTextureUrl(`${ICON_CHR_BASE}/uniform/${code}_l`, `${code}_1`);
}

/**
 * URL de l'uniforme PERSONNEL d'un personnage. Gate sur `CHARACTER_UNIFORM_CODES` :
 * chaîne vide si le perso n'en a pas (le caller affiche le portrait/placeholder).
 *
 * Couverture mesurée : 364/6062 persos (6,0 %). Les autres portent le kit de leur
 * équipe (`u<6>_<NN>_<NN>_l`, namespace DISJOINT résolu par le CRC de
 * `inagle_uniforms` → manifeste modèle) : ce chemin-là n'est pas encore câblé.
 */
export function getCharacterUniformUrl(charaId: string | undefined | null): string {
	const uniformCode = resolveUniformCode(charaId);
	if (!uniformCode) {
		return "";
	}
	return uniformIconUrl(uniformCode);
}

/**
 * URL du **telop** (bandeau du nom) d'une technique.
 *
 * Chemin réel : `220_img/telop_waza/<lang>/<code>.g4tx`, conteneur à texture unique
 * portant le nom du fichier → forme 1:1. Deux langues seulement sont livrées avec le
 * jeu (`fr` 1243, `en` 1247) : on privilégie `fr`, repli `en`.
 *
 * Couverture mesurée sur `inagle_skills` : 858 techniques ont un telop `fr`, 861 en
 * comptant le repli `en`, sur 1002. Les 141 restantes (`rh*`, `swap_skill_waza_*`,
 * placeholders) n'en ont AUCUN → placeholder, jamais une URL forgée.
 *
 * ⚠ L'ancienne allowlist codée en dur ne contenait que **16** codes : elle avait été
 * établie sur un dump partiel (310 PNG) et privait 842 techniques de leur bandeau.
 */
export function getSkillImageUrl(
	skillId: string | undefined | null,
	_unused?: string | null
): string {
	if (!skillId) {
		return "";
	}
	// Le code peut porter un suffixe de variante (`who00060_or`, `whd00900_mm`) qui
	// existe parfois comme fichier à part entière : on tente le code tel quel d'abord.
	return getSkillTelopUrl(skillId) ?? PLACEHOLDERS.skill;
}

/**
 * URL du telop d'une technique, ou `null` quand il n'en existe aucun — la même
 * résolution que `getSkillImageUrl`, mais **sans repli placeholder**.
 *
 * C'est la forme dont a besoin tout appelant qui veut décider s'il affiche
 * l'image ou rien du tout. La section cut-in, elle, forgeait son URL depuis
 * `skills-cutin.json`, qui annonce un telop dans neuf langues pour toutes les
 * techniques — y compris les 19 `rh*`, dont aucun fichier n'existe : mesuré,
 * `…/telop_waza/fr/rhd10010.png` et son équivalent `en` répondent 404.
 *
 * Le garde ne peut pas être `inagle_skills.has_telop` : cette colonne vaut 1 sur
 * les 1002 lignes, `rh*` comprises. Le seul garde qui discrimine est l'index des
 * fichiers réellement présents dans les CPK (`TELOP_FR`/`TELOP_EN`).
 */
export function getSkillTelopUrl(skillId: string | undefined | null): string | null {
	if (!skillId) {
		return null;
	}
	return telopUrl(skillId) ?? telopUrl(skillId.replace(/_[a-z]+$/i, ""));
}

/**
 * URL de l'icône d'un objet, à partir de son `internal_code` (`eq_ac0105001`,
 * `ke000033`, `em040022`…).
 *
 * Résolution par manifeste (conteneur `.g4tx` + nom de texture réels) : 1300 des 1667
 * codes de `inagle_items` sont couverts, répartis sur 5 dossiers dont 522 hors du
 * `02_icon_item` écrit en base. Repli emblème pour les `em*` non manifestés. Un id hex
 * (`0x002B6B38`) ne matche rien → placeholder, comportement voulu (l'icône vient alors
 * de `image_url` via `resolveAssetUrl`).
 */
export function getItemImageUrl(itemId: string): string {
	if (!itemId) {
		return "";
	}
	const ref = resolveItemIcon(itemId);
	if (ref) {
		return menuTextureUrl(ref.g4txPath, ref.textureName);
	}
	return emblemFileUrl(itemId) ?? PLACEHOLDERS.item;
}
// Alias
export const getItemIconUrl = getItemImageUrl;

/**
 * URL d'un emblème d'équipe.
 *
 * Chemin réel : `200_icon/01_icon_emblem/<nom>.g4tx`, conteneur à texture unique →
 * forme 1:1. Le nom vient de `emblem-crc-map.json` (`crc32_std(nom) → nom`, 542
 * emblèmes du CPK). Un identifiant numérique est complété en `em<4 chiffres>` (7
 * emblèmes seulement portent cette forme courte). Gate sur les noms réels : chaîne
 * vide si l'emblème n'existe pas, jamais une URL 404.
 */
export function getEmblemImageUrl(emblemId: string | number | undefined | null): string {
	if (!emblemId && emblemId !== 0) {
		return "";
	}
	const s = emblemId.toString();
	let emCode: string | null = null;
	if (s.startsWith("em")) {
		emCode = s;
	} else {
		const num = Number.parseInt(s, 10);
		if (!Number.isNaN(num) && num > 0) {
			emCode = `em${String(num).padStart(4, "0")}`;
		}
	}
	if (!emCode) {
		return "";
	}
	return emblemFileUrl(emCode) ?? "";
}
// Alias
export const getTeamEmblemUrl = getEmblemImageUrl;

/**
 * Helpers pour les icônes UI (Genre, Élément, Rareté, Catégorie)
 */

export function getGenderIconUrl(gender: number | string | undefined | null): string {
	if (gender === undefined || gender === null) {
		return "";
	}
	const g = gender.toString().toLowerCase();
	const isFemale = g === "1" || g === "2" || g === "f" || g === "female";
	return isFemale ? "/move/girl.webp" : "/move/boy.webp";
}

export function getSkillElementIconUrl(element: string | number): string {
	if (!element) {
		return "";
	}
	const el = element.toString().toLowerCase();
	const map: Record<string, string> = {
		"1": "fire",
		"2": "wind",
		"3": "forest",
		"4": "mountain",
		air: "wind",
		bois: "forest",
		earth: "mountain",
		feu: "fire",
		fire: "fire",
		forest: "forest",
		foret: "forest",
		forêt: "forest",
		montagne: "mountain",
		mountain: "mountain",
		vent: "wind",
		wind: "wind",
		wood: "forest",
	};
	const filename = map[el];
	if (!filename) {
		return "";
	}
	return `/spirit_type/${filename}.webp`;
}
// Parfois appelé getSkillIconUrl pour l'élément (contexte dépendant)
// Dans le doute, on alias vers l'élément si c'est utilisé pour des petites icônes
export const getSkillIconUrl = getSkillElementIconUrl;

export function getSkillCategoryIconUrl(category: string | number): string {
	if (!category) {
		return "";
	}
	const cat = category.toString().toLowerCase();
	const map: Record<string, string> = {
		"1": "tir",
		"2": "dribble",
		"3": "defense",
		"4": "gardien",
		arret: "gardien",
		arrêt: "gardien",
		block: "defense",
		catch: "gardien",
		def: "defense",
		defense: "defense",
		dribble: "dribble",
		défense: "defense",
		gardien: "gardien",
		gk: "gardien",
		keeper: "gardien",
		save: "gardien",
		shoot: "tir",
		shot: "tir",
		tir: "tir",
	};
	const filename = map[cat];
	if (!filename) {
		return "";
	}
	return `/move/${filename}.webp`;
}

export function getRarityIconUrl(rarity: string | number | undefined | null): string {
	if (rarity === undefined || rarity === null) {
		return "";
	}
	const r = rarity.toString().toLowerCase();
	const map: Record<string, string> = {
		"1": "normal.webp",
		"2": "experimente.webp",
		"20": "basara.webp",
		"3": "emerite.webp",
		"4": "heros.webp",
		"5": "legendaire.webp",
		basara: "basara.webp",
		legendaire: "legendaire.webp",
		légendaire: "legendaire.webp",
		n: "normal.webp",
		normal: "normal.webp",
		r: "experimente.webp",
		rare: "experimente.webp",
		sr: "emerite.webp",
		ssr: "heros.webp",
		super: "emerite.webp",
		ur: "legendaire.webp",
	};
	const file = map[r];
	if (!file) {
		return "";
	}
	return `/rarity/${file}`;
}

/**
 * Le miroir `zukan-assets-mirror` (modèles 3D 360° + vidéos de techniques) n'existe
 * NULLE PART en prod (azalee-1) : `{CDN_URL}/zukan-assets-mirror/...` renvoie 404, et
 * la source amont `zukan.inazuma.jp/3d/...` est elle aussi morte (404 vérifié 2026-06).
 * Tant que ce flag reste `false`, les résolveurs 3D/vidéo renvoient une chaîne vide /
 * un placeholder au lieu d'une URL 404, et le bouton 360° n'est pas monté dans l'UI
 * (cf. CharacterTable). Repasser à `true` uniquement quand un vrai miroir est en place.
 */
export const ZUKAN_3D_MIRROR_AVAILABLE = false;

/**
 * URL pour les vidéos de techniques.
 * Gaté sur `ZUKAN_3D_MIRROR_AVAILABLE` (azalee-1) : renvoie une chaîne vide tant que le
 * miroir est absent, ce qui évite un `<video src>` en 404.
 */
export function getSkillVideoUrl(skillId: string | undefined | null): string {
	if (!skillId || !ZUKAN_3D_MIRROR_AVAILABLE) {
		return "";
	}
	return `${CDN_URL}/zukan-assets-mirror/movies/${skillId}.mp4`;
}

/**
 * URL d'une Aura (Keshin, Soul, Armed…), décodée live depuis les CPK.
 *
 * Chemin réel : `200_icon/10_icon_chr/<dossier>/<base>_l.g4tx`, texture unique nommée
 * `<base>_l00` (vérifié sur les 331 conteneurs d'aura : 331/331 conformes).
 *   - Keshins (wks/wkk/wkd/wko/wkt) + Keshin-armé (wak/wao/wad) → `aura_fs/k<6>`
 *   - Souls   (wss/wso/wsd/wsk)                                 → `aura_soul/a<6>`
 */
/**
 * Extrait la partie numérique d'un asset_code keshin/soul/armed en retirant le
 * préfixe `w[ksad][a-z]` ET tout suffixe de variante.
 *
 * Les codes réels portent des suffixes de variante hétérogènes que le conteneur
 * CPK (base-only `<base>_l.g4tx`) ne reflète pas :
 *   - digits   : `was00290_1`
 *   - alpha-num : `was00240_b1`, `wad00650_h2`, `was00303_h1`
 *   - stage     : `wks02020_st0701`, `wks02060_st0901`
 * On ne garde donc que les chiffres qui suivent immédiatement le préfixe.
 * Cohérent avec db-1.
 */
function auraBaseNum(assetCode: string, prefix: RegExp): string | null {
	const m = assetCode.replace(prefix, "").match(/^\d+/);
	return m ? m[0] : null;
}

/**
 * Le jeu ne contient que les icônes d'aura « famille » : tous les conteneurs de
 * `aura_fs/`/`aura_soul/` portent un numéro **multiple de 10** (index CPK :
 * 98 + 56 fichiers, 0 numéro non-×10). Les formes évoluées / éveillées / armées
 * (…721, …651, …672, …2025) n'ont PAS d'icône propre : l'icône réutilisée est
 * celle de la famille. On arrondit donc le numéro à la dizaine inférieure, ce qui
 * garantit un fichier existant (sinon 404 garanti — c'était le cas de 25 keshins
 * de la plage 700-725/2025 dont l'`image_url` DB `.webp` est elle aussi morte).
 */
function auraFamilyBase(num: string): string {
	const n = Number.parseInt(num, 10);
	const family = Number.isFinite(n) ? Math.floor(n / 10) * 10 : 0;
	return String(family).padStart(6, "0");
}

export function getAuraImageUrl(assetCode: string | undefined | null, _subType?: string): string {
	if (!assetCode) {
		return "";
	}

	// Keshins : tous les `wk*` (wks/wkk/wkd/wko/wkt) + les variantes Keshin-armé
	// `wak/wao/wad` vivent dans `aura_fs/k{N}` ; seuls les Souls `ws*` vivent dans
	// `aura_soul/a{N}`. Couverture mesurée : 174/174 keshins et 56/56 souls dotés
	// d'un `asset_code` exploitable trouvent leur icône (gate `AURA_*_CODES`).
	if (assetCode.startsWith("wk") || /^wa[kod]/.test(assetCode)) {
		const num = auraBaseNum(assetCode, /^w[ka][a-z]/);
		if (num) {
			return auraIconUrl("aura_fs", `k${auraFamilyBase(num)}`) ?? "";
		}
	}
	// Souls `ws*` (wss/wso/wsd/wsk) → aura_soul/a{N} (cohérent sur tout le dossier).
	// MAIS les Soul-armé `was*` (Warrior Armed Spirit, 66 keshins) sont répartis sans
	// règle dérivable entre aura_fs/k{N} (12 codes) et aura_soul/a{N} (18 codes) : on
	// NE dérive donc PAS `was*` ici — on renvoie "" pour laisser `image_url` (DB,
	// chemin vérifié HTTP 200 par le backfill) faire foi. L'ancienne dérivation
	// `was*` → aura_soul produisait un 404 pour ~40% des formes armées (db-1).
	if (assetCode.startsWith("ws")) {
		const num = auraBaseNum(assetCode, /^ws[a-z]/);
		if (num) {
			return auraIconUrl("aura_soul", `a${auraFamilyBase(num)}`) ?? "";
		}
	}

	return "";
}

/**
 * URL d'une icône Miximax (visage personnage) du dossier `aura_mixi`.
 * Chemin réel : `<realIcon>_l.g4tx`, texture nommée `<realIcon>_l00`.
 *
 * L'argument est l'`icon_code` (`c05028XXX`) OU l'`asset_code` (`wmm00XXX[_variant]`) de
 * `inagle_miximax`. Aucun de ces deux codes n'est le nom de fichier réel : les 17 vrais
 * fichiers portent des codes hétérogènes (`ca0201`, `cn0221`, `cp1811`,
 * `iau0010a`…) NON dérivables par règle. On traduit donc via `MIXIMAX_ICON_MANIFEST`
 * (issu de `config.skillId2` → `inagle_chara_menu_resource`). Un code absent du manifeste
 * = pas de fichier dans les CPK → chaîne vide (le caller bascule sur telop/image_url ou
 * le placeholder), jamais un 404 forgé.
 */
export function getMiximaxIconUrl(iconCode: string | undefined | null): string {
	if (!iconCode) {
		return "";
	}
	// Normalise l'asset_code en retirant un éventuel suffixe de variante (`_h1`/`_b1`…).
	const key = iconCode.replace(/_[a-z0-9]+$/i, "");
	const realIcon = MIXIMAX_ICON_MANIFEST[iconCode] ?? MIXIMAX_ICON_MANIFEST[key];
	if (!realIcon) {
		return "";
	}
	return auraIconUrl("aura_mixi", realIcon) ?? "";
}

/**
 * Détecte un `image_url` DB de miximax issu de l'ANCIEN mapping naïf
 * `wmm00<NNN>` → `aura_mixi_c05028<NNN>.webp` (ou `aura_mixi_c<charId>.webp`). Ce path
 * pointe vers le telop d'un PERSONNAGE LÉGENDAIRE d'un autre set (c05028100 = Ryoma
 * Nishiki…), PAS vers le miximax `wmm` réel → bannière du mauvais perso. Ces lignes
 * restent en DB tant que le miroir n'a pas été repushé : on les rejette ici (au profit
 * de l'icône manifeste correcte) plutôt que d'afficher un faux nom. Cf. bug Arthur.
 */
function isStaleMiximaxTelopUrl(imageUrl: string | undefined | null): boolean {
	if (!imageUrl) {
		return false;
	}
	return /(?:^|\/)220_img\/telop_waza\/[a-z]+\/aura_mixi_c\d/.test(imageUrl);
}

/**
 * Résout l'icône d'un miximax à partir de son `icon_code`/`asset_code` (via le manifeste
 * des vrais conteneurs `aura_mixi`) en IGNORANT tout `image_url` DB issu de l'ancien
 * mapping naïf telop (`aura_mixi_c05028*` = bannière d'un autre perso). Retourne le
 * placeholder si aucun fichier réel n'existe — jamais le bandeau d'un perso étranger.
 *
 * Ordre : manifeste (icon_code puis asset_code) → image_url DB SI ce n'est PAS un telop
 * miximax périmé → placeholder. Sépare clairement l'ICÔNE (carrée, juste) du TELOP
 * (bandeau, supprimé pour les wmm car aucun n'est valide).
 */
export function getMiximaxImageUrl(
	iconCode: string | undefined | null,
	assetCode: string | undefined | null,
	dbImageUrl: string | undefined | null
): string {
	const fromIcon = getMiximaxIconUrl(iconCode);
	if (fromIcon) {
		return fromIcon;
	}
	const fromAsset = getMiximaxIconUrl(assetCode);
	if (fromAsset) {
		return fromAsset;
	}
	// L'image_url DB n'est utilisable QUE si ce n'est pas un telop miximax périmé.
	if (dbImageUrl && !isStaleMiximaxTelopUrl(dbImageUrl)) {
		const resolved = resolveAssetUrl(dbImageUrl);
		if (resolved) {
			return resolved;
		}
	}
	return PLACEHOLDERS.character;
}

/**
 * Résout l'URL telop (grande image) d'une aura à partir de son asset_code.
 * Le nom de fichier CPK utilise des préfixes différents de ceux stockés en DB.
 *
 * Mapping :
 * - Keshins (wks/wkk/wkd/wko/wkt):  wk*{N} -> k{N padded 6 digits} (telop k{N} == numéro keshin)
 * - Souls (wss/wso/wsd/wsk):         ws*{N} -> a{N padded 6 digits} (telop a{N} == numéro soul)
 * - Armed (was/wak/wad/wao):         wa*{N} -> a{N padded 6 digits}
 * - Mode changes: mode_change_{X} -> tel quel
 * - Aura wap: wap{N} -> aura_power_wap{N} (telop == asset_code propre)
 *
 * Miximax `wmm` : AUCUN telop (retourne null). L'ancien code dérivait `wmm00<NNN>` →
 * `aura_mixi_c05028<NNN>` (ou `aura_mixi_c<charId>` pour les codes longs). Or
 * `c05028<NNN>` est l'internal_code d'un PERSONNAGE LÉGENDAIRE d'un AUTRE set
 * (c05028100 = Ryoma Nishiki…), et les telops `aura_mixi_*` forment un set
 * FERMÉ tied à ces persos — ils ne correspondent PAS aux miximax `wmm` de Victory Road.
 * Conséquence : Arthur (wmm00100) affichait le bandeau de Ryoma (faux). Il n'existe
 * PAS de telop_waza valide pour un miximax `wmm` → on ne dérive plus rien (null) ;
 * l'icône miximax correcte vient du manifeste (`getMiximaxIconUrl`).
 */
export function resolveAuraTelopUrl(assetCode: string | undefined | null): string | null {
	if (!assetCode) {
		return null;
	}

	let bucketCode: string | null = null;

	if (assetCode.startsWith("wmm")) {
		// Miximax : pas de telop fiable (cf. note) — jamais de bandeau d'un autre perso.
		return null;
	}
	if (assetCode.startsWith("wk")) {
		// All Keshins: wks/wkk/wkd/wko/wkt -> k{N padded 6}
		// Strip variant suffix (_b1/_h2/_st0701/_1…) → base only (cf. auraBaseNum).
		const num = auraBaseNum(assetCode, /^wk[a-z]/);
		bucketCode = num ? `k${num.padStart(6, "0")}` : null;
	} else if (assetCode.startsWith("ws") || assetCode.startsWith("wa")) {
		// Souls (ws*) and Armed (wa*) -> a{N padded 6}
		// Except wap which has special mapping
		if (assetCode.startsWith("wap")) {
			bucketCode = `aura_power_${assetCode}`;
		} else {
			// Strip variant suffix (_b1/_h2/_st0701/_1…) → base only (cf. auraBaseNum).
			const num = auraBaseNum(assetCode, /^w[sa][a-z]/);
			bucketCode = num ? `a${num.padStart(6, "0")}` : null;
		}
	} else if (assetCode.startsWith("mode_change_")) {
		bucketCode = assetCode;
	} else if (assetCode.includes("awakening")) {
		// Awakenings : pas de telop dédié dans le jeu → placeholder `aura_power01`.
		bucketCode = "aura_power01";
	}

	if (!bucketCode) {
		return null;
	}

	// Forme 1:1 du contrat CPK : `220_img/telop_waza/<lang>/<code>.g4tx` → `<code>.png`.
	// Gate sur les fichiers réels (98 `k*`, 56 `a*`, 9 `mode_change_*`, 9 `aura_power*`
	// en `fr`) : un code sans telop rend `null` au lieu d'une URL 404.
	return telopUrl(bucketCode);
}

/**
 * URL pour les modèles 3D (360°).
 * Gaté sur `ZUKAN_3D_MIRROR_AVAILABLE` (azalee-1) : tant que le miroir est absent,
 * renvoie le placeholder `PLACEHOLDERS.character` au lieu d'une URL 404. Le bouton 360°
 * étant lui aussi gaté côté UI, ce résolveur n'est plus appelé pour produire une frame
 * en prod, mais le garde-fou évite tout 404 si quelqu'un l'invoque directement.
 */
export function getCharacterModel360Url(
	hash: string,
	frame: number,
	full: boolean = false
): string {
	if (!ZUKAN_3D_MIRROR_AVAILABLE) {
		return PLACEHOLDERS.character;
	}
	// Format Zukan: https://zukan.inazuma.jp/3d/{hash}/{type}/{frame}.webp
	// Notre miroir: /zukan-assets-mirror/3d/{hash}/{type}/{frame}.webp
	// Frame est souvent 0-7 ou 0-15
	const type = full ? "full" : "face";
	return `${CDN_URL}/zukan-assets-mirror/3d/${hash}/${type}/${frame}.webp`;
}

/**
 * Base nginx des modèles 3D GLB (alias → /home/.../inazuma/data/dx11/model/).
 * Servis par `iecode cdn export-glb` (g4mg+g4md → glTF binary) ; content-type
 * `model/gltf-binary`, cache immutable 1 an.
 */
const MODEL_GLB_BASE = "https://cdn.rosegriffon.fr/model";

/**
 * Résout l'URL du modèle 3D GLB d'un personnage à partir de son code interne
 * (`internalCode`/`charaParamId`, ex `c01000010`). Le basename du GLB = basename du
 * .g4mg `_face` = ce code. Gate sur `CHARACTER_MODEL_CODES` (manifeste des GLB
 * réellement exportés) : renvoie `null` si aucun modèle n'existe → le caller garde le
 * fallback image et ne monte pas le viewer 3D (évite tout 404).
 */
export function getCharacterModelGlbUrl(code: string | undefined | null): string | null {
	if (!code) {
		return null;
	}
	// Strip suffixe de variante éventuel (_5000/_5100…) — seul le code de base a un modèle.
	const base = code.replace(/_\d{4}$/, "");
	if (!CHARACTER_MODEL_CODES.has(base)) {
		return null;
	}
	return `${MODEL_GLB_BASE}/${base}.glb`;
}

/** Indique si un personnage possède un modèle 3D GLB servi (gate viewer). */
export function hasCharacterModelGlb(code: string | undefined | null): boolean {
	return getCharacterModelGlbUrl(code) !== null;
}

/**
 * Base nginx des modèles 3D COMPLETS assemblés live (corps+face+uniforme).
 * Servis par `nie-model-serve :8790` (assemble depuis les CPK à la volée, cache disque).
 */
const MODEL_FULL_GLB_BASE = "https://cdn.rosegriffon.fr/model-full";
// Version du pipeline d'assemblage 3D : les GLB sont servis `Cache-Control: immutable`
// (1 an) — sans cache-buster, un navigateur garde l'ancien modèle après une amélioration
// du pipeline. Bumper à CHAQUE évolution de l'assemblage. v3 = corps+visage+UNIFORME texturés.
const MODEL_FULL_VERSION = "5";

/**
 * Résout l'URL du modèle 3D COMPLET (corps+face+uniforme) d'un personnage.
 *
 * Utilise `/model-full/<code>.glb` (nie-model-serve, assemblage live depuis CPK).
 * Même gate que `getCharacterModelGlbUrl` : renvoie `null` si le code face n'existe pas
 * (évite les 404 sur des codes sans GLB face pré-converti).
 *
 * Fonctionne aussi pour les keshins (`k<N>`) et armures (`ka<N>`) mais sans gate
 * (le service renvoie 404 proprement si le code est inconnu).
 */
export function getCharacterModelFullGlbUrl(code: string | undefined | null): string | null {
	if (!code) {
		return null;
	}
	const base = code.replace(/_\d{4}$/, "");
	// Pour les personnages c*, on gate sur le manifeste face (évite les 404 assurés).
	if (base.startsWith("c") && !CHARACTER_MODEL_CODES.has(base)) {
		return null;
	}
	return `${MODEL_FULL_GLB_BASE}/${base}.glb?v=${MODEL_FULL_VERSION}`;
}

/**
 * Extrait le code modèle keshin (`k<NNNNNN>`) d'une entrée aura keshin. Le code vit dans
 * le chemin de l'icône (`200_icon/10_icon_chr/aura_fs/k<NNNNNN>_l_…`) ou la colonne `data`.
 * Renvoie `null` si aucun `k<6 chiffres>` n'est trouvé.
 */
export function extractKeshinModelCode(
	...sources: Array<string | null | undefined>
): string | null {
	for (const s of sources) {
		if (!s) continue;
		// `k` suivi d'exactement 6 chiffres, NON précédé d'un chiffre et NON suivi d'un
		// chiffre (un `_`/`/` après est OK : `aura_fs/k000010_l_…` doit matcher `k000010`).
		const m = s.match(/(?<![0-9])(k\d{6})(?![0-9])/);
		if (m?.[1]) return m[1];
	}
	return null;
}

/**
 * Résout l'URL du modèle 3D COMPLET d'un keshin (`k<NNNNNN>`), gardé sur le manifeste
 * des modèles réellement servis (`KESHIN_MODEL_CODES`). Renvoie `null` si non servi
 * (keshin `.g4mg`-seul pas encore assemblable) → pas de bouton 3D mort.
 */
export function getKeshinModelGlbUrl(code: string | undefined | null): string | null {
	if (!code) return null;
	const base = code.replace(/_\d+$/, "");
	if (!KESHIN_MODEL_CODES.has(base)) return null;
	return `${MODEL_FULL_GLB_BASE}/${base}.glb?v=${MODEL_FULL_VERSION}`;
}

/**
 * Résout l'URL du modèle 3D COMPLET d'une armure (`ka<NNNNNN>NN`), gardé sur le manifeste
 * des armures réellement servies (`ARMURE_MODEL_CODES`). Renvoie `null` si inconnue.
 */
export function getArmureModelGlbUrl(code: string | undefined | null): string | null {
	if (!code) return null;
	if (!ARMURE_MODEL_CODES.has(code)) return null;
	return `${MODEL_FULL_GLB_BASE}/${code}.glb?v=${MODEL_FULL_VERSION}`;
}

/** Liste triée des codes keshin servis (gate des fiches/galeries 3D). */
export function listServedKeshinCodes(): string[] {
	return [...KESHIN_MODEL_CODES].sort();
}

/** Liste triée des codes armure servis (gate de la galerie 3D armures). */
export function listServedArmureCodes(): string[] {
	return [...ARMURE_MODEL_CODES].sort();
}

/**
 * Base nginx des modèles 3D génériques des sous-domaines `common/chr/_<sub>/` (techniques
 * `waza`, objets `item`, animaux `animal`). Servis par `nie-model-serve :8790` via
 * `/model-chr/<sub>/<code>.glb` (maillage g4md+g4mg assemblé live, sans texture embarquée).
 */
const MODEL_CHR_GLB_BASE = "https://cdn.rosegriffon.fr/model-chr";

/** Sous-domaines chr exposés en galerie 3D (gate + libellés). Ordre = ordre d'affichage. */
export type ChrModelSub = "waza" | "item" | "animal";

const CHR_MODEL_CODES: Record<ChrModelSub, Set<string>> = {
	animal: new Set((chrModelManifest as { animal: string[] }).animal),
	item: new Set((chrModelManifest as { item: string[] }).item),
	waza: new Set((chrModelManifest as { waza: string[] }).waza),
};

/** Basename RÉEL du `.g4tx` de texture par code (relevé sur l'index CPK, cf. `getChrModelTextureUrl`). */
const CHR_MODEL_TEXTURES = (chrModelManifest as { textures?: Record<string, Record<string, string>> })
	.textures ?? {};

/**
 * Résout l'URL du modèle 3D générique d'un sous-domaine chr (`/model-chr/<sub>/<code>.glb`),
 * gardé sur le manifeste des codes réellement servis (gate anti-404). Renvoie `null` si le
 * code n'a pas de paire g4md+g4mg assemblable.
 */
export function getChrModelGlbUrl(sub: ChrModelSub, code: string | undefined | null): string | null {
	if (!code) return null;
	if (!CHR_MODEL_CODES[sub]?.has(code)) return null;
	return `${MODEL_CHR_GLB_BASE}/${sub}/${code}.glb?v=${MODEL_FULL_VERSION}`;
}

/** Liste triée des codes servis pour un sous-domaine chr (gate de la galerie 3D). */
export function listServedChrModelCodes(sub: ChrModelSub): string[] {
	return [...(CHR_MODEL_CODES[sub] ?? [])].sort();
}

/**
 * URL CDN de la **texture** (g4tx→png live) d'un modèle chr générique. Le maillage
 * `/model-chr/` n'embarque PAS la texture : on l'expose séparément (affichage + téléchargement).
 *
 * Le nom du fichier n'est PAS toujours celui du dossier — 11 objets n'existent qu'en
 * `<code>_10`/`_20` (variantes de niveau de détail) — et 27 objets n'ont aucune texture.
 * On passe donc par la carte `textures` du manifeste, relevée sur l'index CPK, au lieu de
 * forger `<code>/<code>.png` : ces 38 cas rendaient un 404. Couverture réelle : waza 272/272,
 * item 208/235, animal 2/2. `null` = pas de texture, l'appelant n'affiche pas d'image.
 *
 * Variantes redimensionnées via `?w=&format=webp` (cdn-variants).
 */
export function getChrModelTextureUrl(sub: ChrModelSub, code: string | undefined | null): string | null {
	if (!code || !CHR_MODEL_CODES[sub]?.has(code)) return null;
	const base = CHR_MODEL_TEXTURES[sub]?.[code];
	if (!base) return null;
	return `https://cdn.rosegriffon.fr/dx11/chr/_${sub}/${code}/${base}.png`;
}

/**
 * URL de fallback générique — pointe vers /ievr.webp qui existe en public/.
 * (Le dossier /images/placeholders/ n'a jamais été créé ; ces 3 paths
 * étaient des 404 silencieux dans les Image fallbacks de characters/skills/items.)
 */
export const PLACEHOLDERS = {
	character: "/ievr.webp",
	item: "/ievr.webp",
	skill: "/ievr.webp",
} as const;

/**
 * Image Optimization Helper
 * Uses Next.js optimization endpoint
 */
export function getOptimizedImageUrl(
	url: string | null | undefined,
	width = 640,
	quality = 80
): string {
	if (!url) {
		return "";
	}
	if (url.startsWith("data:")) {
		return url;
	}

	// Use Next.js image optimization endpoint
	return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${quality}`;
}
