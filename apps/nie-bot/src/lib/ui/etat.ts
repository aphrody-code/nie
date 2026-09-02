/**
 * État d'une liste paginée — comptage des pages et grammaire du `customId`.
 *
 * Module PUR (aucun `discord.js`) : les modules de données s'en servent sans
 * tirer la bibliothèque Discord. Le dessin des boutons vit dans
 * `lib/ui/pagination.ts`, qui réexporte tout ce fichier.
 *
 * ── UN SEUL MODÈLE, ET IL EST SANS MÉMOIRE ─────────────────────────────────
 * Tout l'état d'une liste (page, filtres, recherche) tient dans l'identifiant
 * du bouton. Aucune carte en mémoire de processus : un redémarrage du service
 * ne laisse donc jamais de bouton mort, et deux membres peuvent parcourir la
 * même liste sans se voler leur position. C'est le modèle qu'avaient déjà
 * `/x`, `/azalee`, `/cpk`, `/cdn` et `/sondage` — chacun avec sa propre copie
 * du comptage, de l'encodage et du décodage.
 *
 * Grammaire unique :
 *
 *     <prefixe>|<champ>|<champ>|…
 *
 * `|` est le séparateur ; il est RETIRÉ des valeurs plutôt qu'échappé (une
 * valeur d'état est toujours reconstructible depuis la commande, jamais une
 * donnée irremplaçable).
 *
 * ── LA LIMITE DE 100 CARACTÈRES EST DURE ───────────────────────────────────
 * Un `customId` plus long fait REFUSER le message entier, embed compris.
 * `encoderEtat` renvoie donc `null` au lieu de tronquer : l'appelante n'affiche
 * alors aucun bouton. Des boutons qui changeraient silencieusement les critères
 * de recherche seraient pires que pas de boutons du tout.
 */
import { LIMITES } from "./theme";

/** Longueur maximale d'un `customId` de composant. */
export const MAX_CUSTOM_ID = LIMITES.identifiantComposant;

/** Séparateur des champs d'état. */
export const SEPARATEUR_ETAT = "|";

// ─── Comptage ───────────────────────────────────────────────────────────────

/** Nombre total de pages (jamais 0 : une liste vide a une page, qui dit « vide »). */
export function nombreDePages(total: number, parPage: number): number {
	if (!Number.isFinite(total) || total <= 0 || parPage <= 0) {
		return 1;
	}
	return Math.max(1, Math.ceil(total / parPage));
}

/**
 * Ramène un numéro de page dans `[1, nombreDePages]`.
 *
 * Sans ce plafond, une page hors bornes répond « aucun résultat » sur une liste
 * pleine — et côté SQL, `page:999999999` produit un `OFFSET` que Postgres refuse
 * en bigint : la commande échouerait au lieu de montrer la dernière page.
 */
export function bornerPage(page: number, total: number, parPage: number): number {
	const pages = nombreDePages(total, parPage);
	if (!Number.isFinite(page)) {
		return 1;
	}
	return Math.min(pages, Math.max(1, Math.trunc(page)));
}

/** Tranche d'une liste déjà entièrement chargée. */
export function tranche<T>(entrees: readonly T[], page: number, parPage: number): T[] {
	const sure = bornerPage(page, entrees.length, parPage);
	const debut = (sure - 1) * parPage;
	return entrees.slice(debut, debut + parPage);
}

// ─── État transporté par le `customId` ──────────────────────────────────────

/** Retire le séparateur d'un fragment pour qu'il ne casse pas le décodage. */
export function sansSeparateur(valeur: string | number | null | undefined): string {
	if (typeof valeur === "number") {
		return Number.isFinite(valeur) ? String(Math.trunc(valeur)) : "";
	}
	return typeof valeur === "string" ? valeur.replaceAll(SEPARATEUR_ETAT, " ").trim() : "";
}

/**
 * Encode un état de liste. `null` si l'identifiant dépasse la limite Discord.
 *
 * @param prefixe identifiant de la surface (`az`, `tw`, `cpkd`…). Il sert au
 *                routage : un gestionnaire de bouton ne doit répondre qu'aux
 *                identifiants de SA surface.
 */
export function encoderEtat(
	prefixe: string,
	champs: ReadonlyArray<string | number | null | undefined>
): string | null {
	const identifiant = [prefixe, ...champs.map(sansSeparateur)].join(SEPARATEUR_ETAT);
	return identifiant.length <= MAX_CUSTOM_ID ? identifiant : null;
}

/**
 * Décode un identifiant produit par `encoderEtat`.
 *
 * @returns les champs (sans le préfixe), ou `null` si l'identifiant n'appartient
 *          pas à cette surface ou n'a pas le bon nombre de champs — un état
 *          partiel produirait une page avec des filtres arbitraires.
 */
export function decoderEtat(
	prefixe: string,
	customId: string,
	nombreChamps: number
): string[] | null {
	const morceaux = customId.split(SEPARATEUR_ETAT);
	if (morceaux.length !== nombreChamps + 1 || morceaux[0] !== prefixe) {
		return null;
	}
	return morceaux.slice(1);
}

/** Vrai si l'identifiant appartient à cette surface. */
export function estEtatDe(prefixe: string, customId: string): boolean {
	return customId.startsWith(`${prefixe}${SEPARATEUR_ETAT}`);
}

/** Numéro de page décodé, ou `null` s'il est inexploitable. */
export function pageDecodee(brut: string | undefined): number | null {
	const page = Number.parseInt(brut ?? "", 10);
	return Number.isFinite(page) && page >= 1 ? page : null;
}
