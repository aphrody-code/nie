/**
 * **La synergie** — ce que ce paquet apporte et qu'aucun des quatre gisements ne porte seul.
 *
 * Chaque source sait répondre sur son domaine : la base extraite connaît les statistiques d'un
 * personnage, le VFS connaît ses fichiers, la base de reverse connaît le code qui les lit, le
 * cache IETV connaît l'épisode où il apparaît. Aucune ne connaît **le lien** — et c'est ce lien
 * qui manquait : le bot Discord répondait sur l'anime sans savoir que le jeu porte le même
 * personnage, le wiki servait des fiches sans savoir quelle cinématique les montre.
 *
 * Les jointures ci-dessous sont explicitement **attestées ou déclarées telles quelles** :
 *
 * * `internal_code` → chemins VFS : le code d'un personnage (`c01000010`) nomme ses modèles,
 *   ses textures et ses banques de voix. Jointure par préfixe, résolue par `/vfs/find` — le seul
 *   index complet des 255 308 entrées du jeu.
 * * `nom du film` → `inagle_events` : la table des événements porte l'`event_id` que le nom de
 *   fichier d'une cinématique reprend.
 * * nom du personnage → épisode : rapprochement **textuel**, donc annoncé comme tel
 *   (`confiance: "texte"`). Il n'existe aucune clé partagée entre le jeu et la série : deux
 *   univers de données distincts que seul le nom relie.
 * * chaîne → fonction : `func_str_ref` dit quelles fonctions de `nie.exe` citent une chaîne.
 *   C'est le pont le plus court entre une donnée et le code qui la lit.
 */
import * as anime from "./anime.ts";
import * as extrait from "./extrait.ts";
import * as jeu from "./jeu.ts";
import * as re from "./re.ts";

/**
 * Comment un rapprochement a été obtenu — jamais implicite.
 *
 * `cle` : une clé partagée par les deux gisements (code interne, identifiant d'événement).
 * `prefixe` : un chemin qui commence par un identifiant, attesté par l'index des fichiers.
 * `texte` : un rapprochement de noms. Utile, mais à ne jamais présenter comme un fait.
 */
export type Confiance = "cle" | "prefixe" | "texte";

/** Un rapprochement, avec ce sur quoi il repose. */
export interface Lien<T> {
	readonly valeur: T;
	readonly confiance: Confiance;
	/** Ce qui a servi de charnière — le code, l'identifiant ou le texte comparé. */
	readonly par: string;
}

/** Les fichiers du jeu qui appartiennent à une entité, rangés par rôle. */
export interface FichiersEntite {
	modeles: string[];
	textures: string[];
	sons: string[];
	autres: string[];
}

/**
 * Les fichiers du jeu qui portent un identifiant, demandés au VFS.
 *
 * `inagle_game_assets` ne convient pas ici : ses 40 471 lignes sont presque toutes des PNG de
 * menu (40 469 `png`, 2 `usm`) et n'indexent ni les modèles, ni les banques sonores. Le seul
 * index complet est celui du VFS — 255 308 entrées, interrogeable par `/vfs/find`. C'est donc
 * la seule jointure honnête, au prix d'un aller-retour réseau.
 */
export async function fichiersDe(identifiant: string, limite = 100): Promise<string[]> {
	try {
		const reponse = await fetch(jeu.urlRecherche(identifiant, { limite }), {
			signal: AbortSignal.timeout(8000),
		});
		if (!reponse.ok) {
			return [];
		}
		const corps = (await reponse.json()) as { files?: { path?: string }[] };
		return (corps.files ?? []).map((f) => f.path).filter((p): p is string => typeof p === "string");
	} catch {
		return [];
	}
}

/** Range des chemins VFS par ce qu'ils sont, d'après leur extension. */
function rangerFichiers(chemins: readonly string[]): FichiersEntite {
	const rangs: FichiersEntite = { autres: [], modeles: [], sons: [], textures: [] };
	for (const c of chemins) {
		const ext = c.slice(c.lastIndexOf(".") + 1).toLowerCase();
		if (ext === "g4mg" || ext === "g4mt" || ext === "g4sk" || ext === "g4md" || ext === "mbn") {
			rangs.modeles.push(c);
		} else if (ext === "g4tx" || ext === "png" || ext === "dds") {
			rangs.textures.push(c);
		} else if (ext === "acb" || ext === "awb" || ext === "hca") {
			rangs.sons.push(c);
		} else {
			rangs.autres.push(c);
		}
	}
	return rangs;
}

/** Tout ce que les quatre gisements savent d'un personnage. */
export interface FichePersonnage {
	fiche: extrait.Personnage;
	/** Les fichiers du jeu qui portent son code interne. */
	fichiers: Lien<FichiersEntite>;
	/** Les épisodes de la série où son nom apparaît — rapprochement textuel. */
	episodes: Lien<anime.Episode[]>;
	/** Les fonctions de `nie.exe` qui citent son code interne. */
	code: Lien<re.Fonction[]>;
	/** Les URL prêtes à l'emploi pour ses fichiers les plus utiles. */
	media: { modele: string | null; voix: string | null; portrait: string | null };
}

/**
 * Réunit un personnage à travers les quatre gisements.
 *
 * Le code interne est la charnière : il préfixe les chemins VFS et apparaît tel quel dans les
 * chaînes du binaire. Sans lui — quelques personnages du miroir n'en portent pas — seules la
 * fiche et le rapprochement textuel avec la série restent possibles ; c'est dit, pas masqué.
 */
export function personnage(slug: string): FichePersonnage | null {
	const fiche = extrait.personnage(slug);
	if (!fiche) {
		return null;
	}
	const code = fiche.internal_code?.split("_")[0] ?? null;
	const fichiers = rangerFichiers([]);
	const nom = fiche.name_fr ?? fiche.name_en ?? "";

	return {
		code: {
			confiance: "cle",
			par: code ?? "(aucun code interne)",
			valeur: code ? re.fonctionsCitant(code) : [],
		},
		episodes: {
			confiance: "texte",
			par: nom,
			valeur: nom ? anime.chercherEpisodes(nom, 10) : [],
		},
		fiche,
		fichiers: { confiance: "prefixe", par: code ?? "(aucun code interne)", valeur: fichiers },
		media: {
			modele: fichiers.modeles[0] ? jeu.urlFichier(fichiers.modeles[0]) : null,
			portrait: fichiers.textures[0] ? jeu.urlTexture(fichiers.textures[0]) : null,
			voix: fichiers.sons.find((s) => s.endsWith(".acb"))
				? jeu.urlBanqueSon(fichiers.sons.find((s) => s.endsWith(".acb")) as string)
				: null,
		},
	};
}

/**
 * La même fiche, complétée par les fichiers du jeu.
 *
 * Séparée de `personnage` parce qu'elle appelle le VFS : tout ce qui peut répondre hors ligne
 * doit pouvoir le faire sans payer un aller-retour réseau, et un serveur injoignable ne doit pas
 * faire disparaître la fiche — il ne fait disparaître que les fichiers.
 */
export async function personnageComplet(slug: string): Promise<FichePersonnage | null> {
	const base = personnage(slug);
	if (!base) {
		return null;
	}
	const code = base.fichiers.par;
	if (code.startsWith("(")) {
		return base;
	}
	const fichiers = rangerFichiers(await fichiersDe(code));
	const acb = fichiers.sons.find((s) => s.endsWith(".acb"));
	return {
		...base,
		fichiers: { confiance: "prefixe", par: code, valeur: fichiers },
		media: {
			modele: fichiers.modeles[0] ? jeu.urlFichier(fichiers.modeles[0]) : null,
			portrait: fichiers.textures[0] ? jeu.urlTexture(fichiers.textures[0]) : null,
			voix: acb ? jeu.urlBanqueSon(acb) : null,
		},
	};
}

/** Une cinématique, réunie à ce que la base sait de l'événement qu'elle joue. */
export interface FicheFilm {
	nom: string;
	video: string;
	bandeSon: string;
	/** L'événement du jeu de même identifiant, s'il existe. */
	evenement: Lien<Record<string, unknown> | null>;
	/** Les répliques sous-titrées de cet événement. */
	repliques: Lien<Record<string, unknown>[]>;
	/** Les fonctions qui citent le nom du film. */
	code: Lien<re.Fonction[]>;
}

/**
 * Réunit une cinématique à son événement.
 *
 * Le nom de fichier d'un film d'événement (`ev01_00050`) reprend l'`event_id` de la table des
 * événements : c'est une vraie clé, pas une ressemblance. Les écrans-titres et les logos n'en
 * ont pas — l'événement est alors `null`, ce qui est la bonne réponse et non un échec.
 */
export function film(nom: string): FicheFilm {
	const cheminCommun = `data/common/movie/${nom}.usm`;
	const evenement = extrait.ligne<Record<string, unknown>>(
		"SELECT * FROM inagle_events WHERE event_id = ? LIMIT 1",
		[nom],
	);
	return {
		bandeSon: jeu.urlBandeSon(cheminCommun),
		code: { confiance: "cle", par: nom, valeur: re.fonctionsCitant(nom) },
		evenement: { confiance: "cle", par: nom, valeur: evenement },
		nom,
		repliques: {
			confiance: "cle",
			par: nom,
			valeur: extrait.requete(
				"SELECT line_index, line_label, text_fr, text_en, text_ja, show_start, show_end FROM inagle_event_subtitles WHERE event_id = ? ORDER BY line_index",
				[nom],
			),
		},
		video: jeu.urlFilm(cheminCommun),
	};
}

/** Une technique, réunie à sa vidéo, son télop et son cue sonore. */
export interface FicheTechnique {
	fiche: extrait.Technique;
	/** Les vidéos de démonstration référencées par la base. */
	videos: Lien<Record<string, unknown>[]>;
	/** Le télop (bandeau de nom affiché au déclenchement), quand la technique en a un. */
	telop: Lien<Record<string, unknown> | null>;
	/** Les fonctions qui citent son code interne. */
	code: Lien<re.Fonction[]>;
}

/** Réunit une technique à travers les gisements qui la portent. */
export function technique(id: string): FicheTechnique | null {
	const fiche = extrait.technique(id);
	if (!fiche) {
		return null;
	}
	return {
		code: {
			confiance: "cle",
			par: fiche.internal_code ?? fiche.id,
			valeur: re.fonctionsCitant(fiche.internal_code ?? fiche.id),
		},
		fiche,
		telop: {
			confiance: "cle",
			par: fiche.id,
			valeur: extrait.ligne("SELECT * FROM inagle_telop_waza WHERE skill_id = ? LIMIT 1", [
				fiche.id,
			]),
		},
		videos: {
			confiance: "cle",
			par: fiche.id,
			valeur: extrait.requete(
				"SELECT position, label, video_url, poster_url, source FROM inagle_skill_videos WHERE skill_id = ? ORDER BY position",
				[fiche.id],
			),
		},
	};
}

/**
 * Recherche qui traverse les quatre gisements d'un seul appel.
 *
 * C'est la porte d'entrée : on tape un nom, et on reçoit ce que chaque gisement en sait, sans
 * avoir à savoir lequel interroger. Les gisements absents rendent une liste vide — jamais une
 * exception : une machine sans miroir doit continuer de répondre sur l'anime et le reverse.
 */
export interface Resultats {
	personnages: extrait.Personnage[];
	episodes: anime.Episode[];
	fonctions: re.Fonction[];
	fichiers: extrait.AssetJeu[];
}

/** Cherche `texte` partout à la fois. */
export function chercher(texte: string, limite = 10): Resultats {
	return {
		episodes: anime.chercherEpisodes(texte, limite),
		fichiers: extrait.assets(texte, limite),
		fonctions: re.fonctions(texte, limite),
		personnages: extrait.chercherPersonnages(texte, limite),
	};
}
