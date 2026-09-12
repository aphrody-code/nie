/**
 * La Galerie des succès — les quatre familles de l'écran `gallery_menu`, en fonctions pures.
 *
 * ## Ce qui vient du jeu
 *
 * Rien n'est écrit à la main ici : les entrées sont celles que `nie-site` sert sur
 * `/api/v1/game-data/{trophies,gallery,movies,musics}` (347, 360, 219, 108 lignes mesurées le
 * 2026-09-12), et l'état « débloqué » vient de `/api/v1/profile/complete`, dont les compteurs
 * `{total, unlocked}` valent `347/347`, `360/360`, `219/219` et `108/108` — le profil complet
 * du plan. Quand le profil ne répond pas, le repli typé considère tout débloqué et le déclare
 * (`origin: "game-data"`), parce que c'est exactement ce que l'écran doit montrer.
 *
 * ## Ce que la donnée NE porte PAS
 *
 * - Les musiques n'ont **pas** de nom (`name` vaut `null` sur les 108 lignes) ni de chemin VFS :
 *   seulement `entry_id`, `music_id`, `track_no` et `has_path`. L'écran ne peut donc pas les
 *   jouer, et n'invente pas de titre — il montre le numéro de piste et l'identifiant.
 * - Les images de la galerie portent `img_path` / `thumb_path`, qui sont des **noms logiques**
 *   (`img_story_ev01_main_0010`), pas des chemins VFS résolus. Aucune vignette n'est donc
 *   fabriquée à partir d'eux.
 * - Les films, eux, portent un vrai chemin (`common/movie/ev90_00100.usm`) : c'est celui que
 *   `NativeMoviePlayer` sait lire, et le seul média réellement branché de cet écran.
 */
import { fold } from "./list-page";

/** Un succès, tel que `/api/v1/game-data/trophies` le sert. */
export interface TrophyRow {
	trophy_id: string;
	code: string;
	name: string | null;
	description: string | null;
	category: number | null;
	story_episode: number | null;
	unlock_kind: string | null;
}

/** Une image de la galerie, telle que `/api/v1/game-data/gallery` la sert. */
export interface GalleryRow {
	gallery_id: string;
	img_path: string | null;
	thumb_path: string | null;
	story_episode: number | null;
	need_token_num: number | null;
	unlock_kind: string | null;
}

/** Une cinématique, telle que `/api/v1/game-data/movies` la sert. */
export interface MovieRow {
	movie_id: string;
	movie_path: string | null;
	has_subtitles: boolean | null;
	staffroll_data_name: string | null;
}

/** Une piste, telle que `/api/v1/game-data/musics` la sert. */
export interface MusicRow {
	entry_id: string;
	music_id: string;
	name: string | null;
	track_no: number | null;
	sort_index: number | null;
	has_path: boolean | null;
}

/** Les quatre familles servies par l'API, dans l'ordre de l'écran. */
export type GalleryFamilyId = "trophies" | "gallery" | "movies" | "musics";

/** Les compteurs `{total, unlocked}` que `/api/v1/profile/complete` publie par famille. */
export interface GalleryProgress {
	total: number;
	unlocked: number;
}

/** Une entrée de la grille, quelle que soit sa famille. */
export interface GalleryItem {
	/** L'identifiant du jeu (`trophy_id`, `gallery_id`, `movie_id`, `entry_id`). */
	id: string;
	/** Ce que la donnée nomme ; jamais un titre inventé. */
	label: string;
	/** La ligne secondaire : description, épisode, chemin — vide quand la donnée n'en a pas. */
	detail: string;
	/** Débloqué par le profil complet. */
	unlocked: boolean;
	/** Le chemin VFS d'une cinématique lisible, `null` partout ailleurs. */
	moviePath: string | null;
}

/** Une famille et ses entrées, avec sa progression. */
export interface GalleryCollection {
	id: GalleryFamilyId;
	label: string;
	items: readonly GalleryItem[];
	progress: GalleryProgress;
	/** `"profile"` quand le profil a répondu, `"game-data"` quand c'est le repli typé. */
	origin: "profile" | "game-data";
}

/**
 * Les libellés des quatre onglets.
 *
 * « Galerie des succès » est le titre relevé sur `data/menu/trophy_gallery.png`, et « GALERIE »
 * y est le compteur du bandeau (`0/360`). Les quatre libellés ci-dessous nomment les familles
 * de l'API telles que l'écran les sépare ; ils sont dessinés par l'hôte, pas par le layout,
 * qui ne porte aucun objet texte (7 objets, 0 `text`).
 */
export const GALLERY_FAMILIES: readonly { id: GalleryFamilyId; label: string }[] = [
	{ id: "trophies", label: "Succès" },
	{ id: "gallery", label: "Galerie" },
	{ id: "movies", label: "Films" },
	{ id: "musics", label: "Musiques" },
];

/** Le titre de l'écran, relevé sur `data/menu/trophy_gallery.png`. */
export const GALLERY_TITLE = "Galerie des succès";

/** Les données brutes des quatre routes `game-data`. */
export interface GalleryData {
	trophies: readonly TrophyRow[];
	gallery: readonly GalleryRow[];
	movies: readonly MovieRow[];
	musics: readonly MusicRow[];
}

/** Les compteurs du profil, quand il répond. */
export type GalleryProfile = Partial<Record<GalleryFamilyId, GalleryProgress>>;

function trophyItem(row: TrophyRow, unlocked: boolean): GalleryItem {
	const episode = row.story_episode === null ? "" : `Épisode ${row.story_episode}`;
	const kind = row.unlock_kind ?? "";
	return {
		id: row.trophy_id,
		label: row.name ?? row.code,
		detail: [row.description ?? "", episode, kind].filter(Boolean).join(" · "),
		unlocked,
		moviePath: null,
	};
}

function galleryItem(row: GalleryRow, unlocked: boolean): GalleryItem {
	const episode = row.story_episode === null ? "" : `Épisode ${row.story_episode}`;
	return {
		id: row.gallery_id,
		label: row.img_path ?? row.gallery_id,
		detail: [episode, row.unlock_kind ?? ""].filter(Boolean).join(" · "),
		unlocked,
		moviePath: null,
	};
}

function movieItem(row: MovieRow, unlocked: boolean): GalleryItem {
	const path = row.movie_path;
	const file = path ? (path.split("/").pop() ?? path) : row.movie_id;
	return {
		id: row.movie_id,
		label: file,
		detail: [path ?? "", row.has_subtitles ? "sous-titrée" : "", row.staffroll_data_name ?? ""]
			.filter(Boolean).join(" · "),
		unlocked,
		moviePath: path,
	};
}

function musicItem(row: MusicRow, unlocked: boolean): GalleryItem {
	return {
		// La donnée ne nomme aucune piste : le numéro de piste et l'identifiant sont tout ce
		// qu'elle porte, et c'est donc tout ce qui s'affiche.
		id: row.entry_id,
		label: row.name ?? (row.track_no === null ? row.entry_id : `Piste ${row.track_no}`),
		detail: [row.music_id, row.has_path ? "" : "sans piste"].filter(Boolean).join(" · "),
		unlocked,
		moviePath: null,
	};
}

/**
 * Les quatre collections de l'écran, dans l'ordre des onglets.
 *
 * `profile` fournit `{total, unlocked}` par famille ; sans lui, tout est débloqué (profil
 * complet du plan) et l'origine retenue est `"game-data"` sur chaque collection.
 */
export function galleryCollections(data: GalleryData, profile: GalleryProfile | null): GalleryCollection[] {
	function build<T>(
		id: GalleryFamilyId,
		rows: readonly T[],
		make: (row: T, unlocked: boolean) => GalleryItem,
	): GalleryCollection {
		const measured = profile?.[id] ?? null;
		const unlockedCount = measured ? measured.unlocked : rows.length;
		return {
			id,
			label: GALLERY_FAMILIES.find((family) => family.id === id)?.label ?? id,
			items: rows.map((row, index) => make(row, index < unlockedCount)),
			progress: { total: measured?.total ?? rows.length, unlocked: unlockedCount },
			origin: measured ? "profile" : "game-data",
		};
	}
	return [
		build("trophies", data.trophies, trophyItem),
		build("gallery", data.gallery, galleryItem),
		build("movies", data.movies, movieItem),
		build("musics", data.musics, musicItem),
	];
}

/** La progression cumulée des quatre familles — le compteur du bandeau de l'écran. */
export function galleryTotals(collections: readonly GalleryCollection[]): GalleryProgress {
	return collections.reduce<GalleryProgress>(
		(sum, collection) => ({
			total: sum.total + collection.progress.total,
			unlocked: sum.unlocked + collection.progress.unlocked,
		}),
		{ total: 0, unlocked: 0 },
	);
}

/** Les entrées retenues par la recherche (touche `X`), sur le libellé et le détail. */
export function filterGallery(items: readonly GalleryItem[], search: string): GalleryItem[] {
	const needle = fold(search);
	if (needle === "") return [...items];
	return items.filter((item) => fold(item.label).includes(needle) || fold(item.detail).includes(needle));
}
