/**
 * Les `custom_id` des composants — l'adressage interne du bot.
 *
 * ── UN BOUTON N'A PAS DE MÉMOIRE ───────────────────────────────────────────
 * Discord ne renvoie qu'une chaîne de cent caractères quand un membre clique.
 * Ni contexte, ni session : tout ce que le bot doit savoir pour construire
 * l'écran suivant doit tenir DANS cette chaîne. C'est pour cela qu'elle est
 * traitée comme une route — `wb/arc/4/1` — et non comme un nom d'action.
 *
 * ── ILLISIBLE N'EST PAS FATAL ──────────────────────────────────────────────
 * Un message posé par une version antérieure du bot reste cliquable pendant des
 * mois : ses routes peuvent ne plus exister. {@link lireRoute} rend donc `null`
 * au lieu de lever, et l'appelant répond « ce bouton date d'une version
 * précédente » plutôt que de laisser le membre devant un échec muet.
 *
 * Module PUR : aucune dépendance, aucun effet de bord.
 */

/** Préfixe de toutes les routes du bot. */
export const PREFIXE = "wb";

/** Le séparateur ne peut pas apparaître dans un segment (voir {@link route}). */
const SEPARATEUR = "/";

/** Limite dure d'un `custom_id` côté Discord. */
export const LONGUEUR_MAX = 100;

/** Actions adressables. Une valeur retirée d'ici cesse d'être cliquable. */
export const ACTIONS = [
	/** L'écran d'accueil. */
	"accueil",
	/** Un arc : `wb/arc/<saison>/<page>`. */
	"arc",
	/** Lecture : `wb/lire/<saison>/<episode>` (+ langue facultative). */
	"lire",
	/** Bascule « vu » : `wb/vu/<saison>/<episode>`. */
	"vu",
	/** Bascule « Ma liste » : `wb/liste/<saison>/<episode>`. */
	"liste",
	/** « Ma liste » : `wb/maliste`. */
	"maliste",
	/** Reprendre là où on s'est arrêté : `wb/reprendre`. */
	"reprendre",
	/** Un épisode au hasard : `wb/hasard`. */
	"hasard",
	/** Menu de sélection d'un épisode : `wb/choix/<saison>`. */
	"choix",
] as const;

export type Action = (typeof ACTIONS)[number];

const ACTIONS_CONNUES: ReadonlySet<string> = new Set(ACTIONS);

export interface Route {
	action: Action;
	/** Segments qui suivent l'action, tels quels. */
	arguments: string[];
}

/**
 * Fabrique une route. Les arguments sont convertis en texte et joints.
 *
 * Un argument qui contiendrait le séparateur casserait la lecture : il est
 * refusé ici, à l'écriture, plutôt que de produire une route silencieusement
 * fausse qu'on ne diagnostiquerait qu'au clic.
 */
export function route(action: Action, ...arguments_: readonly (string | number)[]): string {
	const segments = arguments_.map((argument) => String(argument));
	for (const segment of segments) {
		if (segment.includes(SEPARATEUR)) {
			throw new Error(`[wonderbot] segment de route invalide (« ${SEPARATEUR} » interdit) : ${segment}`);
		}
	}
	const identifiant = [PREFIXE, action, ...segments].join(SEPARATEUR);
	if (identifiant.length > LONGUEUR_MAX) {
		throw new Error(
			`[wonderbot] custom_id de ${identifiant.length} caractères, maximum ${LONGUEUR_MAX} : ${identifiant}`
		);
	}
	return identifiant;
}

/** Lit une route, `null` si elle n'est pas des nôtres ou plus reconnue. */
export function lireRoute(identifiant: string): Route | null {
	const segments = identifiant.split(SEPARATEUR);
	if (segments.length < 2 || segments[0] !== PREFIXE) return null;
	const action = segments[1]!;
	if (!ACTIONS_CONNUES.has(action)) return null;
	return { action: action as Action, arguments: segments.slice(2) };
}

/** Lit un entier positif à la position donnée, `null` s'il est absent ou faux. */
export function argumentEntier(route_: Route, rang: number): number | null {
	const brut = route_.arguments[rang];
	if (brut === undefined) return null;
	const valeur = Number.parseInt(brut, 10);
	return Number.isFinite(valeur) && valeur >= 0 ? valeur : null;
}

/** Lit une langue à la position donnée, `undefined` si absente ou inconnue. */
export function argumentLangue(route_: Route, rang: number): "vf" | "vostfr" | undefined {
	const brut = route_.arguments[rang];
	return brut === "vf" || brut === "vostfr" ? brut : undefined;
}
