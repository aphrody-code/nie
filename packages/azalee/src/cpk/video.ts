/**
 * Catalogue des cinématiques du jeu — la couche qui rend un film **regardable et décrit**.
 *
 * Un `.usm` n'est pas une vidéo : c'est un conteneur Sofdec2 où le codec vidéo et la bande-son
 * Criware sont entrelacés par blocs, qu'aucun navigateur n'ouvre. `nie-model-serve` en publie
 * l'inventaire complet sur `/video/catalog.json` (crate `nie_explore::cinema`, la MÊME fiche que
 * `niers video` et que l'explorateur desktop) et sert chaque film remuxé sur `/video/<chemin>`.
 *
 * Trois faits mesurés sur les 97 films, que toute interface doit prendre au sérieux :
 *
 * 1. **20 films sont en MPEG-2** (18 écrans-titres, 2 logos) : `lisibleNavigateur` est faux, et
 *    leur monter une balise `<video>` donne un lecteur noir. On propose le téléchargement.
 * 2. **95 films sur 97 sont muets dans leur conteneur.** Leur son vit dans `anime_stream`, que le
 *    serveur résout par le nom du film et sert à part en WAV (`?track=audio`) — d'où un `<audio>`
 *    séparé, à synchroniser avec la vidéo. 30 films en ont un, 65 n'en ont aucun.
 * 3. **La rubrique et la langue ne se devinent pas** : elles viennent des conventions de nommage
 *    du jeu (`nie_formats::usm`), pas d'une regex maison — il y a 15 rubriques, pas 4.
 *
 * ⚠ Module **client-safe** : `fetch` seul, ni `bun:sqlite` ni `node:fs`. Le libellé humain d'un
 * film exige le miroir SQLite et vit donc côté serveur (`apps/azalee/lib/cpk/media-names.ts`).
 */

import { exportUrl } from "./live";

const CDN_BASE = "https://cdn.rosegriffon.fr";

/** Une piste sonore portée par le conteneur du film lui-même — 2 films sur 97. */
export interface FilmPisteInterne {
	/** Numéro de canal déclaré par le conteneur. */
	canal: number;
	/** Codec de la piste (`hca`, `adx`…). */
	codec: string;
	/** Fréquence d'échantillonnage, en hertz. */
	frequence: number;
	/** Nombre de canaux. */
	canaux: number;
	/** Taille de la piste, en octets. */
	octets: number;
}

/** La bande-son d'un film qui n'en porte pas dans son conteneur. */
export interface FilmBandeSon {
	/** Nom de la cue dans `anime_stream`, ex. `ev01_00050_bgm`. */
	cue: string;
	/** Identifiant AFS2 de la forme d'onde. */
	awbId: number;
	/** Codec déclaré par la banque. */
	codec: string;
	/** Fréquence d'échantillonnage, en hertz. */
	frequence: number;
	/** Nombre de canaux. */
	canaux: number;
	/** Durée de la cue, en millisecondes — ce que le jeu joue. */
	dureeMs: number;
	/** Durée de la forme d'onde, en millisecondes — ce que le fichier contient. */
	dureeOndeMs: number;
	/** Vrai quand le `bgmName` du gamedata confirme la cue trouvée par son nom. */
	confirmeParHash: boolean;
}

/** Ce que les tables du jeu disent d'un film (`movie_playing_config`, `event_movie_config`). */
export interface FilmGamedata {
	/** Fichier de jeu d'où vient la ligne. */
	source: string;
	/** Identifiant du film, tel que le jeu le hache. */
	movieId?: string;
	/** Événement d'histoire qui déclenche le film. */
	eventId?: string;
	/** Menu depuis lequel le film est joué. */
	menuId?: string;
	/** Identifiant de la légende associée. */
	captionId?: string;
	/** « Nom de musique » — en réalité le CRC32 du nom du film. */
	bgmName?: string;
	/** Durée du fondu d'entrée, en secondes. */
	fedeInTime?: number;
	/** Durée du fondu de sortie, en secondes. */
	fedeOutTime?: number;
	/** Générique joué par-dessus le film, quand il y en a un. */
	staffrollDataName?: string;
	/** Chemin des textes de sous-titres, `<LG>` restant à substituer par la langue. */
	subtitleTextPath?: string;
	/** Chemin des réglages de sous-titres. */
	subtitleSettingPath?: string;
}

/** La fiche d'un film, telle que la publie `nie_explore::cinema`. */
export interface FilmDto {
	/** Chemin VFS complet du film. */
	chemin: string;
	/** Radical du fichier (`ev01_00050`) — la clé de tout : jointure, cue, libellé. */
	nom: string;
	/** Rubrique déduite du nom, convention du jeu (`Chapitre 01`, `Écrans-titres`…). */
	rubrique: string;
	/** Code de langue quand le nom en porte un, `null` sinon. */
	langue: string | null;
	/** Taille du conteneur `.usm`, en octets. */
	octets: number;
	/** Message d'erreur si le film n'a pas pu être lu. */
	erreur?: string;
	/** Codec vidéo constaté : `h264`, `mpeg2`, `vp9`. */
	codec: string;
	/** Vrai si un navigateur sait décoder ce codec — faux pour les 20 MPEG-2. */
	lisibleNavigateur: boolean;
	/** Largeur en pixels. */
	largeur: number;
	/** Hauteur en pixels. */
	hauteur: number;
	/** Nombre d'images réellement présentes dans le conteneur. */
	images: number;
	/** Nombre d'images que l'en-tête annonce. */
	totalImagesDeclare: number;
	/** Cadence en images par seconde, `null` si l'en-tête ne la déclare pas. */
	cadence: number | null;
	/** Durée en secondes. */
	duree: number | null;
	/** Total des octets vidéo, hors en-têtes de bloc et bourrage. */
	octetsVideo: number;
	/** Vrai si le conteneur était chiffré par l'enveloppe CRI. */
	dechiffre?: boolean;
	/** Nom du fichier tel que l'encodeur l'a inscrit. */
	nomOrigine?: string;
	/** Pistes sonores du conteneur — vide pour 95 films sur 97. */
	audio: FilmPisteInterne[];
	/** Bande-son externe résolue dans `anime_stream`, quand le conteneur est muet. */
	bandeSon?: FilmBandeSon;
	/** Nombre de blocs de sous-titres du conteneur. */
	sousTitres?: number;
	/** Type MIME du conteneur web produit par le remux (fiche détaillée seulement). */
	conteneur?: string;
	/** Taille du conteneur web produit, en octets. */
	conteneurOctets?: number;
	/** Nombre d'images-clés — ce sur quoi un lecteur peut se repositionner. */
	cles?: number;
	/** Part du fichier économisée par le remux, en pourcentage. */
	gainRemux?: number;
	/** Raison pour laquelle aucun conteneur web n'est possible. */
	remuxImpossible?: string;
	/** Ce que les tables du jeu disent du film. */
	gamedata?: FilmGamedata;
}

/** Une langue du jeu, code et nom. */
export interface LangueDto {
	/** Code tel qu'il apparaît dans les noms de fichiers (`JP`, `fr`…). */
	code: string;
	/** Nom en français. */
	nom: string;
}

/** Le catalogue complet des cinématiques. */
export interface CatalogueVideo {
	/** Les films, triés par chemin. */
	films: FilmDto[];
	/** Les rubriques présentes — de quoi bâtir un filtre sans le deviner. */
	rubriques: string[];
	/** Les neuf langues du jeu. */
	langues: LangueDto[];
	/** Empreinte du corpus servie par le serveur (nombre de films : volume total). */
	empreinte?: string;
}

/** URL du catalogue complet. */
export function videoCatalogUrl(): string {
	return `${CDN_BASE}/video/catalog.json`;
}

/** URL du flux vidéo remuxé d'un film (MP4 pour H.264, WebM pour VP9). */
export function videoUrl(path: string): string {
	return `${CDN_BASE}/video/${path}`;
}

/**
 * URL de la bande-son d'un film, en WAV.
 *
 * Vaut pour les deux provenances : la piste du conteneur quand il y en a une, la cue
 * d'`anime_stream` sinon. Répond 404 quand le film n'a aucune bande-son identifiable — ce qui
 * est le cas de 65 films, et se dit plutôt que de se combler par le son d'un autre.
 */
export function videoAudioUrl(path: string): string {
	return `${CDN_BASE}/video/${path}?track=audio`;
}

/** URL de la fiche détaillée d'un film (remux mesuré compris). */
export function videoInfoUrl(path: string): string {
	return `${CDN_BASE}/video/${path}?info=1`;
}

/**
 * URL de téléchargement d'un film, nommée par le serveur.
 *
 * Passe par `/export`, qui pose un `Content-Disposition` : un `<a download>` vers une origine
 * tierce ne peut PAS imposer le nom du fichier — l'attribut est ignoré cross-origin, et le
 * téléchargement arrivait sous le nom de l'URL, sans extension utile.
 */
export function videoDownloadUrl(path: string, format: string): string {
	return exportUrl(path, format);
}

/**
 * Le format de téléchargement qui correspond au codec du film.
 *
 * H.264 → MP4, VP9 → WebM, MPEG-2 → flux élémentaire `.m2v` (VLC et mpv le lisent ; aucun
 * navigateur ne le décode, et l'emballer en MP4 serait un mensonge).
 */
export function formatSortie(film: FilmDto): { id: string; ext: string; libelle: string } {
	switch (film.codec) {
		case "vp9":
			return { id: "webm", ext: "webm", libelle: "WebM" };
		case "mpeg2":
			return { id: "m2v", ext: "m2v", libelle: "MPEG-2" };
		default:
			return { id: "mp4", ext: "mp4", libelle: "MP4" };
	}
}

/** Vrai si le film a une bande-son, d'où qu'elle vienne. */
export function aDuSon(film: FilmDto): boolean {
	return film.audio.length > 0 || film.bandeSon != null;
}

/** Récupère le catalogue. Lève si le pont ne répond pas ou ne l'a pas encore construit. */
export async function fetchVideoCatalogue(): Promise<CatalogueVideo> {
	const res = await fetch(videoCatalogUrl(), { cache: "no-store" });
	if (!res.ok) throw new Error(`catalogue vidéo ${res.status}`);
	return (await res.json()) as CatalogueVideo;
}

/**
 * Variante tolérante : `null` au lieu d'une exception.
 *
 * Le serveur répond 503 tant que le catalogue n'est pas construit (il parcourt 3,7 Gio au
 * premier démarrage) : une page qui sait dégrader continue de rendre au lieu de casser.
 */
export async function fetchVideoCatalogueOrNull(): Promise<CatalogueVideo | null> {
	try {
		return await fetchVideoCatalogue();
	} catch {
		return null;
	}
}

/** Durée en `m:ss`, ou `h:mm:ss` au-delà de l'heure. `null` si la durée est inconnue. */
export function formatDuree(secondes: number | null | undefined): string | null {
	if (secondes == null || !Number.isFinite(secondes) || secondes <= 0) return null;
	const total = Math.round(secondes);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const deuxChiffres = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${deuxChiffres(m)}:${deuxChiffres(s)}` : `${m}:${deuxChiffres(s)}`;
}

/** Taille en unités binaires, telle qu'on l'annonce à côté d'un lien de téléchargement. */
export function formatOctets(octets: number): string {
	const mio = octets / 1024 ** 2;
	return mio >= 1024
		? `${(mio / 1024).toFixed(1).replace(".", ",")} Gio`
		: `${Math.round(mio)} Mio`;
}

/** Définition `1920×1080`, ou `null` si le conteneur ne la déclare pas. */
export function formatDefinition(film: FilmDto): string | null {
	return film.largeur > 0 && film.hauteur > 0 ? `${film.largeur}×${film.hauteur}` : null;
}

/**
 * Ordre d'affichage des rubriques : les chapitres dans l'ordre du jeu, le reste ensuite.
 *
 * Un tri alphabétique mettrait « Chronicle » entre deux chapitres et « Écrans-titres » en tête à
 * cause de son accent. L'ordre du récit est celui qui se lit.
 */
export function ordreRubrique(rubrique: string): number {
	const chapitre = /^Chapitre (\d+)$/.exec(rubrique);
	if (chapitre) return Number(chapitre[1]);
	if (rubrique === "Chronicle") return 900;
	if (rubrique === "Écrans-titres") return 901;
	return 902;
}
