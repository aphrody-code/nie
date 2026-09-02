/**
 * Le gisement **jeu** : les fichiers du jeu tels que `nie-model-serve` les décode à la volée.
 *
 * Rien n'est extrait ni copié ici — on ne fabrique que des URL. Le serveur fait le reste :
 * `.g4tx` → PNG, `.acb`/`.awb` → WAV, `.usm` → MP4/WebM, `.g4mg` → GLB. Les conventions d'URL
 * sont celles du serveur, pas les nôtres : `/tex/<chemin sans .g4tx>.png`, `/vfs/*` prend son
 * chemin en **query**, `/export` et `/audio-info` le prennent en **segment**. Un 404 vient
 * presque toujours de l'URL, jamais du décodage — d'où ces constructeurs, plutôt qu'une chaîne
 * réécrite à chaque appel.
 */
import { sources } from "./sources.ts";

/** La base HTTP du serveur de décodage. */
export function baseJeu(): string {
	return sources().jeu.emplacement ?? "https://cdn.rosegriffon.fr";
}

/** Les octets bruts d'un fichier du VFS, décompressés et déchiffrés. */
export function urlFichier(chemin: string): string {
	return `${baseJeu()}/raw/${chemin}`;
}

/** Les métadonnées d'un fichier : taille, rôle, formats d'export disponibles. */
export function urlFiche(chemin: string): string {
	return `${baseJeu()}/vfs/stat?path=${encodeURIComponent(chemin)}`;
}

/** Recherche par sous-chaîne dans les 255 308 entrées du VFS. */
export function urlRecherche(texte: string, ext?: string, limite = 100): string {
	const q = new URLSearchParams({ limit: String(limite), q: texte });
	if (ext) {
		q.set("ext", ext);
	}
	return `${baseJeu()}/vfs/find?${q}`;
}

/** Le listing d'un dossier du VFS. */
export function urlListe(dossier: string, limite = 500): string {
	return `${baseJeu()}/vfs/ls?path=${encodeURIComponent(dossier)}&limit=${limite}`;
}

/** Une texture, décodée en PNG. Le `.g4tx` se retire — le garder donne un 404. */
export function urlTexture(chemin: string): string {
	return `${baseJeu()}/tex/${chemin.replace(/\.g4tx$/i, "")}.png`;
}

/** Une cinématique, remuxée dans un conteneur que le navigateur lit. */
export function urlFilm(chemin: string): string {
	return `${baseJeu()}/video/${chemin}`;
}

/** La bande-son d'une cinématique — elle vit à côté du film, pas dedans. */
export function urlBandeSon(chemin: string): string {
	return `${baseJeu()}/video/${chemin}?track=audio`;
}

/** Le catalogue complet des cinématiques, publié hors ligne par `niers video catalogue`. */
export function urlCatalogueFilms(): string {
	return `${baseJeu()}/video/catalog.json`;
}

/** Le catalogue des cues d'une banque sonore. */
export function urlBanqueSon(chemin: string): string {
	return `${baseJeu()}/audio-info/${chemin}`;
}

/**
 * Un export nommé.
 *
 * `id` désigne la **sous-entité** (une cue dans une banque, une texture dans un G4TX) : sans lui,
 * tous les exports d'un même conteneur se recouvriraient sous le nom du fichier source. Le
 * serveur pose le `Content-Disposition` ; c'est lui qui donne son vrai nom au fichier reçu.
 */
export function urlExport(chemin: string, format: string, id?: string | number): string {
	const q = new URLSearchParams({ format });
	if (id !== undefined) {
		q.set("id", String(id));
	}
	return `${baseJeu()}/export/${chemin}?${q}`;
}

/** Vrai si le serveur de décodage répond. Une seconde d'attente au plus : c'est une sonde. */
export async function jeuJoignable(delaiMs = 1000): Promise<boolean> {
	try {
		const reponse = await fetch(`${baseJeu()}/health`, {
			signal: AbortSignal.timeout(delaiMs),
		});
		return reponse.ok;
	} catch {
		return false;
	}
}
