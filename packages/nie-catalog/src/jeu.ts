/**
 * Le gisement **jeu** : les fichiers du jeu tels que `nie-model-serve` les décode à la volée.
 *
 * Rien n'est extrait ni copié ici — on ne fabrique que des URL. Le serveur fait le reste :
 * `.g4tx` → PNG, `.acb`/`.awb` → WAV, `.usm` → MP4/WebM, `.g4mg` → GLB.
 *
 * ## Ce module est la source unique des conventions d'URL
 *
 * Elles sont celles du serveur, pas les nôtres. Trois pièges, tous vérifiés dans
 * `crates/tools/nie-model-serve/src/main.rs` :
 *
 * 1. **`/tex/<chemin sans `.g4tx`>.png`** — garder l'extension donne un 400 « chemin invalide » ;
 * 2. **`/vfs/*` prend son chemin en query** (`?path=`), alors que toutes les autres routes le
 *    prennent en **segment** ;
 * 3. **le préfixe `data/` est optionnel** sur les routes à segment : le serveur le repose quand il
 *    manque (`if rest.starts_with("data/") { … } else { format!("data/{rest}") }`). Les deux
 *    formes sont donc valides, et un chemin déjà préfixé ne doit pas être tronqué.
 *
 * Un 404 vient presque toujours de l'URL, jamais du décodage — d'où ces constructeurs, plutôt
 * qu'une chaîne réécrite à chaque appel.
 *
 * ## Deux surfaces que le serveur n'implémente PAS
 *
 * `/dx11/…` et `/g4tx/…` n'existent pas dans `main.rs` : ce sont des `location` nginx
 * (`/etc/nginx/conf.d/cdn.rosegriffon.conf`). `/dx11/` sert le dump sur disque puis retombe sur
 * `@cpk_live`, qui réécrit `/dx11/<x>.png` → `/tex/dx11/<x>.png` ; `/g4tx/` passe par
 * `cdn-variants` (redimensionnement `?w=`, `format=webp`) puis réécrit vers `/tex/`. Elles ne
 * sont donc PAS interchangeables avec `/tex/` : `/dx11/` et `/g4tx/` savent redimensionner, pas
 * `/tex/`. C'est pourquoi elles vivent ici sous leur propre nom, et non comme un alias.
 *
 * ## Client-safe
 *
 * Ce module ne touche ni au disque ni à SQLite : il est importable depuis un composant
 * `"use client"`. Il n'importe volontairement **pas** `./sources.ts`, qui résout les trois autres
 * gisements par `node:fs` — ce seul import suffisait à interdire son usage dans un bundle
 * navigateur, et donc à le disqualifier comme point de convergence.
 */

/** La base HTTP retenue quand `NIE_CDN_URL` n'est pas posée. */
export const BASE_JEU_DEFAUT = "https://cdn.rosegriffon.fr";

/**
 * La base HTTP du serveur de décodage.
 *
 * `NIE_CDN_URL` la force ; une variable posée mais **vide** est ignorée (une chaîne vide n'est
 * pas une base, elle fabriquerait des URL relatives silencieusement fausses). Le `process`
 * est sondé avant d'être lu : dans un bundle navigateur il peut ne pas exister du tout.
 */
export function baseJeu(): string {
	const forcee =
		typeof process === "undefined" ? undefined : process.env["NIE_CDN_URL"]?.trim();
	return (forcee || BASE_JEU_DEFAUT).replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Les chemins, sans base.
//
// C'est la forme que réutilisent les surfaces qui portent DÉJÀ leur propre origine (le wiki
// Azalée sert `https://cdn.rosegriffon.fr` en dur, l'explorateur parle à `127.0.0.1:8790`) :
// elles concatènent leur base à ces chemins, et la convention reste écrite à un seul endroit.
// ---------------------------------------------------------------------------

/** Retire le suffixe `.g4tx`, quelle qu'en soit la casse. */
function sansG4tx(chemin: string): string {
	return chemin.replace(/\.g4tx$/i, "");
}

/** `/health` — la sonde de vie du serveur. */
export function cheminSante(): string {
	return "/health";
}

/** `/raw/<chemin>` — les octets bruts, décompressés et déchiffrés. */
export function cheminFichier(chemin: string): string {
	return `/raw/${chemin}`;
}

/** `/vfs/stat?path=<chemin>` — taille, rôle, formats d'export, description. */
export function cheminFiche(chemin: string): string {
	return `/vfs/stat?${new URLSearchParams({ path: chemin })}`;
}

/**
 * `/vfs/find?…` — recherche par sous-chaîne dans les chemins internes.
 *
 * L'ordre des paramètres est celui de l'implémentation historique (`limit` puis `q`, `ext` en
 * dernier) : une URL est une clé de cache, et en changer l'ordre invaliderait tout ce qui est
 * déjà en cache chez nginx comme chez les navigateurs.
 */
export function cheminRecherche(texte: string, ext?: string, limite = 100): string {
	const q = new URLSearchParams({ limit: String(limite), q: texte });
	if (ext) {
		q.set("ext", ext);
	}
	return `/vfs/find?${q}`;
}

/** `/vfs/ls?path=…&limit=…` — le listing d'un dossier. */
export function cheminListe(dossier: string, limite = 500): string {
	return `/vfs/ls?path=${encodeURIComponent(dossier)}&limit=${limite}`;
}

/** `/vfs/stats` — les compteurs globaux du VFS monté. */
export function cheminStatsVfs(): string {
	return "/vfs/stats";
}

/** `/tex/<chemin sans `.g4tx`>.png` — une texture décodée en PNG. */
export function cheminTexture(chemin: string): string {
	return `/tex/${sansG4tx(chemin)}.png`;
}

/**
 * `/tex/<conteneur>.g4tx/<nom>.png` — UNE texture nommée d'un conteneur G4TX.
 *
 * Un `.g4tx` porte jusqu'à 203 images : sans le nom, la route rend « la plus grande » et tout le
 * reste devient invisible. Le serveur ne se rabat jamais sur un défaut quand le nom est donné —
 * un nom inconnu répond 404, plutôt qu'une image arbitraire qui passerait pour la bonne.
 */
export function cheminTextureNommee(chemin: string, nom: string): string {
	return `/tex/${sansG4tx(chemin)}.g4tx/${nom}.png`;
}

/** `/tex-info/<chemin>.g4tx` — le catalogue des textures d'un conteneur. */
export function cheminCatalogueTextures(chemin: string): string {
	return `/tex-info/${sansG4tx(chemin)}.g4tx`;
}

/** `/video/<chemin>` — une cinématique remuxée dans un conteneur que le navigateur lit. */
export function cheminFilm(chemin: string): string {
	return `/video/${chemin}`;
}

/** `/video/<chemin>?track=audio` — la bande-son d'un film : elle vit à côté, pas dedans. */
export function cheminBandeSon(chemin: string): string {
	return `/video/${chemin}?track=audio`;
}

/** `/video/<chemin>?info=1` — la fiche détaillée d'un film, remux mesuré compris. */
export function cheminFicheFilm(chemin: string): string {
	return `/video/${chemin}?info=1`;
}

/** `/video/catalog.json` — l'inventaire complet des cinématiques. */
export function cheminCatalogueFilms(): string {
	return "/video/catalog.json";
}

/** `/audio-info/<chemin>` — le catalogue des cues d'une banque sonore. */
export function cheminBanqueSon(chemin: string): string {
	return `/audio-info/${chemin}`;
}

/**
 * `/audio/<chemin>` — une piste décodée en WAV PCM 16 bits.
 *
 * On adresse par `awbId` (le cue-id AFS2 publié par `/audio-info`) et non par rang : le rang
 * dépend de l'ordre du fichier, l'identifiant est stable. Sans lui, le serveur rend la piste la
 * plus volumineuse de la banque.
 */
export function cheminAudio(chemin: string, awbId?: number | null): string {
	const base = `/audio/${chemin}`;
	return awbId == null ? base : `${base}?id=${awbId}`;
}

/** `/cfg/<chemin>.json` — un `cfg.bin` décodé en RDBN/T2B générique. */
export function cheminCfg(chemin: string): string {
	return `/cfg/${chemin}.json`;
}

/** `/typed/<chemin>.json` — le même `cfg.bin`, décodé en structure de jeu typée `nie-data`. */
export function cheminTypee(chemin: string): string {
	return `/typed/${chemin}.json`;
}

/**
 * `/model-full/<code>.glb` — un personnage assemblé (corps + visage + uniforme).
 *
 * Les trois composants vivent dans trois arbres distincts du VFS ; c'est cette route qui les
 * réunit. Elle répond 404 pour ce qu'elle ne sait pas produire (un uniforme seul, un visage) —
 * on ne l'enferme donc pas derrière une liste écrite à la main.
 */
export function cheminModeleComplet(code: string): string {
	return `/model-full/${code}.glb`;
}

/**
 * `/model-chr/<sous-domaine>/<code>.glb` — un modèle non-personnage assemblé.
 *
 * Le sous-domaine s'écrit **sans** le tiret bas du dossier VFS : `waza`, pas `_waza`. L'écrire
 * autrement rend un 404 « sous-domaine chr non servable ».
 */
export function cheminModeleChr(sousDomaine: string, code: string): string {
	return `/model-chr/${sousDomaine}/${code}.glb`;
}

/** `/model-avatar/<pièces>.glb` — l'avatar composé des pièces choisies. */
export function cheminModeleAvatar(pieces: string): string {
	return `/model-avatar/${pieces}.glb`;
}

/** `/model-edit/<code>.glb` — une pièce de l'éditeur d'avatar. */
export function cheminModeleEdit(code: string): string {
	return `/model-edit/${code}.glb`;
}

/** `/model-map/<code>.glb` — une carte de jeu. */
export function cheminModeleCarte(code: string): string {
	return `/model-map/${code}.glb`;
}

/**
 * `/export/<chemin>?format=…` — un export nommé par le serveur.
 *
 * `id` désigne la **sous-entité** (une cue dans une banque, une texture dans un G4TX) : sans lui,
 * tous les exports d'un même conteneur se recouvriraient sous le nom du fichier source. Le
 * serveur pose le `Content-Disposition` ; c'est lui qui donne son vrai nom au fichier reçu — un
 * `<a download>` vers une origine tierce ne peut pas l'imposer.
 */
export function cheminExport(chemin: string, format: string, id?: string | number): string {
	const q = new URLSearchParams({ format });
	if (id !== undefined) {
		q.set("id", String(id));
	}
	return `/export/${chemin}?${q}`;
}

/** `/avatar/catalog.json` — le catalogue des parts d'avatar. */
export function cheminCatalogueAvatar(): string {
	return "/avatar/catalog.json";
}

/** `/avatar/layout/<écran>.json` — la mise en page d'un écran de l'éditeur d'avatar. */
export function cheminLayoutAvatar(ecran: string): string {
	return `/avatar/layout/${ecran}.json`;
}

/** `/avatar/icon/<nom>.png` — une vignette de part, décodée depuis son atlas. */
export function cheminIconeAvatar(nom: string): string {
	return `/avatar/icon/${nom}.png`;
}

/** `/ui/theme.json` — la palette `FONT_COLOR` du jeu et ses polices. */
export function cheminTheme(): string {
	return "/ui/theme.json";
}

/** `/icons/index.json` — l'index des icônes de menu. */
export function cheminIndexIcones(): string {
	return "/icons/index.json";
}

// ---------------------------------------------------------------------------
// Les URL absolues — un chemin, préfixé de [`baseJeu`].
// ---------------------------------------------------------------------------

/** Les octets bruts d'un fichier du VFS, décompressés et déchiffrés. */
export function urlFichier(chemin: string): string {
	return baseJeu() + cheminFichier(chemin);
}

/** Les métadonnées d'un fichier : taille, rôle, formats d'export disponibles. */
export function urlFiche(chemin: string): string {
	return baseJeu() + cheminFiche(chemin);
}

/** Recherche par sous-chaîne dans les 255 308 entrées du VFS. */
export function urlRecherche(texte: string, ext?: string, limite = 100): string {
	return baseJeu() + cheminRecherche(texte, ext, limite);
}

/** Le listing d'un dossier du VFS. */
export function urlListe(dossier: string, limite = 500): string {
	return baseJeu() + cheminListe(dossier, limite);
}

/** Une texture, décodée en PNG. Le `.g4tx` se retire — le garder donne un 400. */
export function urlTexture(chemin: string): string {
	return baseJeu() + cheminTexture(chemin);
}

/** Une texture nommée à l'intérieur d'un conteneur G4TX. */
export function urlTextureNommee(chemin: string, nom: string): string {
	return baseJeu() + cheminTextureNommee(chemin, nom);
}

/** Le catalogue des textures d'un conteneur G4TX. */
export function urlCatalogueTextures(chemin: string): string {
	return baseJeu() + cheminCatalogueTextures(chemin);
}

/** Une cinématique, remuxée dans un conteneur que le navigateur lit. */
export function urlFilm(chemin: string): string {
	return baseJeu() + cheminFilm(chemin);
}

/** La bande-son d'une cinématique — elle vit à côté du film, pas dedans. */
export function urlBandeSon(chemin: string): string {
	return baseJeu() + cheminBandeSon(chemin);
}

/** La fiche détaillée d'un film. */
export function urlFicheFilm(chemin: string): string {
	return baseJeu() + cheminFicheFilm(chemin);
}

/** Le catalogue complet des cinématiques, publié hors ligne par `niers video catalogue`. */
export function urlCatalogueFilms(): string {
	return baseJeu() + cheminCatalogueFilms();
}

/** Le catalogue des cues d'une banque sonore. */
export function urlBanqueSon(chemin: string): string {
	return baseJeu() + cheminBanqueSon(chemin);
}

/** Une piste audio décodée en WAV. */
export function urlAudio(chemin: string, awbId?: number | null): string {
	return baseJeu() + cheminAudio(chemin, awbId);
}

/** Un `cfg.bin` décodé en RDBN/T2B générique. */
export function urlCfg(chemin: string): string {
	return baseJeu() + cheminCfg(chemin);
}

/** Un `cfg.bin` décodé en structure de jeu typée. */
export function urlTypee(chemin: string): string {
	return baseJeu() + cheminTypee(chemin);
}

/** Un personnage assemblé, en GLB. */
export function urlModeleComplet(code: string): string {
	return baseJeu() + cheminModeleComplet(code);
}

/** Un modèle non-personnage assemblé, en GLB. */
export function urlModeleChr(sousDomaine: string, code: string): string {
	return baseJeu() + cheminModeleChr(sousDomaine, code);
}

/** Un export nommé. */
export function urlExport(chemin: string, format: string, id?: string | number): string {
	return baseJeu() + cheminExport(chemin, format, id);
}

/** Vrai si le serveur de décodage répond. Une seconde d'attente au plus : c'est une sonde. */
export async function jeuJoignable(delaiMs = 1000): Promise<boolean> {
	try {
		const reponse = await fetch(baseJeu() + cheminSante(), {
			signal: AbortSignal.timeout(delaiMs),
		});
		return reponse.ok;
	} catch {
		return false;
	}
}
