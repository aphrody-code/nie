/**
 * Client des routes REELLES de `crates/tools/nie-site` : chaque champ ci-dessous
 * est copie des structures Rust (`routes/api_v1.rs`, `routes/mod.rs`,
 * `index_vfs.rs`, `etat.rs`), aucune n'est devinee. Un chemin VFS cite de
 * memoire est presque toujours faux — c'est le serveur qui les enumere.
 *
 * Deux espaces, un seul principe (amendement A3) : le chemin VFS voyage EN
 * SEGMENT, verbatim, extension du jeu conservee. Jamais en query. Les vues
 * nommees ne designent pas des fichiers : ce sont des filtres enregistres.
 */

/** Une ressource du jeu, par son chemin VFS exact. */
export const urlFichier = (cheminVfs: string) => `/f/${cheminVfs}`;

/**
 * Le contenu d'un prefixe du VFS, filtres compris.
 *
 * Les filtres voyagent en QUERY parce que ce n'en sont pas des chemins ; le prefixe, lui, reste
 * en segment (amendement A3). Une valeur vide n'est pas envoyee : `/b?q=` est un `400` cote
 * serveur, et a raison de l'etre — ni « pas de filtre » ni « egal a la chaine vide » ne sont
 * devinables.
 */
export const urlDossier = (
	prefixe = "",
	filtres: {
		q?: string;
		ext?: string;
		tri?: string;
		ordre?: string;
		tailleMin?: number;
		tailleMax?: number;
		parPage?: number;
		page?: number;
	} = {}
) => {
	const base = prefixe ? `/b/${prefixe}` : "/b";
	const params = new URLSearchParams();
	if (filtres.q?.trim()) params.set("q", filtres.q.trim());
	if (filtres.ext?.trim()) params.set("ext", filtres.ext.trim().replace(/^\./, ""));
	if (filtres.tri?.trim()) params.set("tri", filtres.tri.trim());
	if (filtres.ordre?.trim()) params.set("ordre", filtres.ordre.trim());
	// `0` est une borne LEGITIME (il existe des fichiers de zero octet, mesure du 2026-09-06) :
	// tester la verite ferait disparaitre `taille_max=0` en silence.
	if (Number.isFinite(filtres.tailleMin)) params.set("taille_min", String(filtres.tailleMin));
	if (Number.isFinite(filtres.tailleMax)) params.set("taille_max", String(filtres.tailleMax));
	// Sans `per_page`, le serveur en rend 50 — et un dossier de 373 entrees se presentait comme
	// un dossier de 50, avec le bon total a cote. Le defaut ne se voyait pas a l'ecran.
	if (filtres.parPage) params.set("per_page", String(filtres.parPage));
	if (filtres.page && filtres.page > 1) params.set("page", String(filtres.page));
	const query = params.toString();
	return query ? `${base}?${query}` : base;
};

/** Les quatre filtres enregistres servis par `/api/v1/<vue>`. */
export type VueCatalogue = "textures" | "modeles" | "sons" | "videos";

/** Une page, telle que `Page<T>` la serialise. */
export interface Page<T> {
	elements: T[];
	page: number;
	per_page: number;
	total: number;
	pages: number;
}

/** Les filtres que `nie-site` confirme avoir réellement appliqués à une vue. */
export interface AppliedCatalogFilters {
	q: string | null;
	glob: string | null;
	glob_vide: boolean;
	prefixe: string | null;
	ext: string | null;
	ext_inconnue: boolean;
	cpk: string | null;
	cpk_inconnu: boolean;
	taille_min: number | null;
	taille_max: number | null;
	tri: "nom" | "taille";
	ordre: "asc" | "desc";
}

/** Une page catalogue HTTP, accompagnée de l'état de filtre confirmé par le serveur. */
export interface CatalogPage<T> extends Page<T> {
	filtres: AppliedCatalogFilters;
}

/** Une entree du VFS (`index_vfs::Fichier`). */
export interface Fichier {
	/** Chemin VFS verbatim — c'est aussi l'URL, sous `/f/`. */
	chemin: string;
	/** Nom de la feuille, extension du jeu conservee. */
	nom: string;
	taille: number;
	/**
	 * Le CPK d'origine, quand la route le rend.
	 *
	 * Optionnel parce que les routes ne le rendent pas toutes : `/api/v1/recherche` le publie
	 * depuis le 2026-09-06, `/b` non. Le declarer obligatoire ferait mentir le type sur la
	 * seconde ; l'omettre le ferait mentir sur la premiere.
	 */
	cpk?: string | null;
}

/** Ce que le serveur sait faire a l'instant de la mesure (`etat::Capacites`). */
export interface Capacites {
	/** `en_cours`, `pret` ou `absent` — l'index du VFS se monte en tache de fond. */
	vfs: "en_cours" | "pret" | "absent";
	vfs_entrees: number;
	vfs_dump: boolean;
	vfs_contenu: boolean;
	/** The read-only game-data mirror opened and its schema was read successfully. */
	gisement: boolean;
	/** The read-only episode database opened and its schema was read successfully. */
	anime: boolean;
	bundle: boolean;
}

/**
 * Corps de `/api/v1/health`.
 *
 * Ni `service` ni `version` : le serveur ne se nomme plus dans ses reponses publiques. La
 * sonde dit ce que l'instance PEUT faire (`capacites`), pas ce qu'elle EST — c'est la seule
 * chose dont l'interface se sert, et la seule qu'une origine publique ait a publier.
 */
export interface SanteApi {
	api: string;
	capacites: Capacites;
	/** Un resume par filtre ; `total` reste `null` tant que le VFS n'est pas pret. */
	vues: { nom: string; extensions: string[]; total: number | null }[];
}

async function lire<T>(url: string, signal?: AbortSignal): Promise<T> {
	const r = await fetch(url, { signal, headers: { accept: "application/json" } });
	if (!r.ok) throw new Error(`${url} a repondu ${r.status}`);
	return (await r.json()) as T;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 60;
const MAX_PER_PAGE = 200;
const MAX_U32 = 0xffff_ffff;

/** Les filtres et la pagination servis par `/api/v1/{vue}`. */
export interface CatalogOptions {
	/** Numéro de page, à partir de 1. */
	page?: number;
	/** Taille de page, bornée dans `1..=200`. */
	parPage?: number;
	/** Motif de recherche, comparé sans casse au chemin entier. */
	q?: string;
	/** Motif glob `nie-viola`, exclusions `!` et listes séparées par des virgules comprises. */
	glob?: string;
	/** Sous-arbre VFS, normalisé sans barre initiale et avec une barre finale. */
	prefixe?: string;
	/** Extension exacte, sans le point. */
	ext?: string;
	/** Nom exact du CPK d'origine. */
	cpk?: string;
	/** Taille minimale en octets, incluse. */
	tailleMin?: number;
	/** Taille maximale en octets, incluse. */
	tailleMax?: number;
	/** Critère de tri. */
	tri?: "nom" | "taille";
	/** Sens de tri. */
	ordre?: "asc" | "desc";
	signal?: AbortSignal;
}

/**
 * Un entier compatible avec les bornes `u32` de `nie-site`.
 *
 * Une valeur non finie est absente plutôt que sérialisée en `NaN`/`Infinity`, deux chaînes que
 * `serde` refuserait. Les décimales sont tronquées : une taille et un numéro de page comptent des
 * unités entières.
 */
function normalizeU32(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	return Math.trunc(Math.min(MAX_U32, Math.max(0, value)));
}

/** L'URL canonique d'une vue : mêmes valeurs logiques, même clé de cache. */
export function catalogueUrl(
	vue: VueCatalogue,
	{
		page,
		parPage,
		q,
		glob,
		prefixe,
		ext,
		cpk,
		tailleMin,
		tailleMax,
		tri,
		ordre,
	}: CatalogOptions = {}
): string {
	const normalizedPage = Math.max(DEFAULT_PAGE, normalizeU32(page) ?? DEFAULT_PAGE);
	const normalizedPerPage = Math.min(
		MAX_PER_PAGE,
		Math.max(1, normalizeU32(parPage) ?? DEFAULT_PER_PAGE)
	);
	// `q` est comparé sans casse au chemin ENTIER côté serveur : chercher `chr/` fonctionne
	// autant qu'un nom de fichier. `URLSearchParams` encode tout, ce qui compte ici : un chemin
	// du jeu contient des `/`, et un motif tapé par un humain peut contenir un `&`.
	const params = new URLSearchParams({
		page: String(normalizedPage),
		per_page: String(normalizedPerPage),
	});
	// Une valeur vide n'est PAS envoyée : `?ext=` est un 400 côté serveur, et il a raison — ni
	// « pas de filtre » ni « extension vide » ne sont devinables.
	const normalizedQuery = q?.trim().toLowerCase();
	const normalizedGlob = glob?.trim();
	const trimmedPrefix = prefixe?.trim();
	const normalizedPrefix = trimmedPrefix ? `${trimmedPrefix.replace(/^\/+|\/+$/g, "")}/` : "";
	const normalizedExtension = ext?.trim().replace(/^\.+/, "").toLowerCase();
	const normalizedCpk = cpk?.trim().toLowerCase();
	if (normalizedQuery) params.set("q", normalizedQuery);
	if (normalizedGlob) params.set("glob", normalizedGlob);
	if (normalizedPrefix) params.set("prefixe", normalizedPrefix);
	if (normalizedExtension) params.set("ext", normalizedExtension);
	if (normalizedCpk) params.set("cpk", normalizedCpk);
	let min = normalizeU32(tailleMin);
	let max = normalizeU32(tailleMax);
	// Le serveur remet lui aussi les bornes croisées dans l'ordre. Le faire avant le réseau évite
	// deux URL de cache pour exactement la même sélection.
	if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
	if (min !== undefined) params.set("taille_min", String(min));
	if (max !== undefined) params.set("taille_max", String(max));
	if (tri?.trim()) params.set("tri", tri.trim());
	if (ordre?.trim()) params.set("ordre", ordre.trim());
	return `/api/v1/${vue}?${params}`;
}

/** Une page d'un catalogue. `per_page` est borne a 200 par le serveur. */
export function catalogue(
	vue: VueCatalogue,
	options: CatalogOptions = {}
): Promise<CatalogPage<Fichier>> {
	return lire(catalogueUrl(vue, options), options.signal);
}

/** L'etat du serveur. */
export const sante = (signal?: AbortSignal) => lire<SanteApi>("/api/v1/health", signal);
