/**
 * `@niers/catalog` — la façade unique des données Inazuma Eleven du dépôt.
 *
 * Quatre gisements vivaient côte à côte sans se parler : les fichiers du jeu (servis par
 * `nie-model-serve`), les 68 tables `inagle_*` extraites de ces fichiers, la base de reverse de
 * `nie.exe`, et le catalogue d'épisodes de la série alimenté par le crawler IETV. Chacun avait
 * son client, son chemin en dur et sa façon de rater. Ce paquet est le point de jonction : une
 * résolution de sources commune, un accès en lecture seule à chaque gisement, et surtout les
 * **jointures** entre eux (`synergie`), que personne ne portait.
 *
 * @example
 * ```ts
 * import { catalogue } from "@niers/catalog";
 *
 * const etat = catalogue.etat();            // quels gisements répondent ici
 * const mark = catalogue.personnage("mark-evans");
 * console.log(mark?.fichiers.valeur.modeles.length, mark?.episodes.valeur.length);
 * ```
 */
import * as anime from "./anime.ts";
import * as extrait from "./extrait.ts";
import * as jeu from "./jeu.ts";
import * as re from "./re.ts";
import { sources } from "./sources.ts";
import * as synergie from "./synergie.ts";

export * as anime from "./anime.ts";
export * as extrait from "./extrait.ts";
export * as jeu from "./jeu.ts";
export * as re from "./re.ts";
export * as synergie from "./synergie.ts";
export { oublierSources, racineDepot, sources } from "./sources.ts";
export type { Source, Sources } from "./sources.ts";

/** L'état d'un gisement : joignable ou non, et ce qu'il porte. */
export interface EtatGisement {
	nom: "jeu" | "extrait" | "re" | "anime";
	disponible: boolean;
	emplacement: string | null;
	/** Une mesure du contenu, pour distinguer « présent » de « présent et peuplé ». */
	contenu: string;
}

/**
 * Ce que cette machine peut réellement répondre.
 *
 * Un gisement présent mais vide est un piège classique : la base s'ouvre, les requêtes
 * réussissent, et tout rend zéro ligne — indiscernable d'une vraie absence de données. On mesure
 * donc le contenu, pas seulement l'existence du fichier.
 */
export function etat(): EtatGisement[] {
	const s = sources();
	const tablesExtrait = extrait.tables();
	const cv = re.couverture();
	const ea = anime.etatAnime();
	return [
		{
			contenu: s.jeu.emplacement ?? "—",
			disponible: s.jeu.emplacement !== null,
			emplacement: s.jeu.emplacement,
			nom: "jeu",
		},
		{
			contenu: `${tablesExtrait.length} tables, ${tablesExtrait
				.reduce((t, x) => t + x.lignes, 0)
				.toLocaleString("fr")} lignes`,
			disponible: tablesExtrait.length > 0,
			emplacement: s.extrait.emplacement,
			nom: "extrait",
		},
		{
			contenu: cv
				? `${cv.total_funcs.toLocaleString("fr")} fonctions, ${cv.named.toLocaleString("fr")} nommées`
				: "aucune mesure de couverture",
			disponible: cv !== null,
			emplacement: s.re.emplacement,
			nom: "re",
		},
		{
			contenu: `${ea.episodes} épisodes, ${ea.saisons} saisons, ${ea.chaines} chaînes`,
			disponible: ea.episodes > 0,
			emplacement: s.anime.emplacement,
			nom: "anime",
		},
	];
}

/**
 * La façade. Un seul objet à importer, quel que soit le gisement visé.
 *
 * Les fonctions de jointure sont remontées au premier niveau parce que ce sont elles qu'on
 * cherche : `catalogue.personnage("mark-evans")` réunit les quatre sources, là où
 * `catalogue.extrait.personnage(...)` n'en interroge qu'une.
 */
export const catalogue = {
	anime,
	chercher: synergie.chercher,
	etat,
	extrait,
	film: synergie.film,
	jeu,
	personnage: synergie.personnage,
	re,
	sources,
	technique: synergie.technique,
} as const;
