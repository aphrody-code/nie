/**
 * Texte — bornage, échappement, assemblage, horodatage natif.
 *
 * Module PUR : aucun `discord.js`, aucune E/S. C'est ce qui permet aux modules
 * de données (`azalee-format`, `cpk-format`, `sondage-format`…) de s'appuyer
 * dessus sans tirer la bibliothèque Discord dans leurs tests.
 *
 * Toutes ces fonctions existaient en trois à cinq exemplaires dans ce dépôt —
 * `truncate`, `borner`, `couper`, `tronquer` pour la seule troncature, avec des
 * ellipses et des règles d'espaces différentes. Une seule reste.
 */
import { LIMITES, SEPARATEUR } from "./theme";

/**
 * Coupe un texte sans jamais dépasser la limite, ellipse comprise.
 *
 * L'ellipse est UN caractère (`…`, U+2026), pas trois points : trois points
 * consomment trois caractères du budget et se confondent avec une ponctuation
 * volontaire en fin de phrase.
 */
export function borner(texte: string | null | undefined, limite: number): string {
	if (typeof texte !== "string" || texte.length === 0) {
		return "";
	}
	if (texte.length <= limite) {
		return texte;
	}
	return `${texte.slice(0, Math.max(0, limite - 1)).trimEnd()}…`;
}

/**
 * Neutralise le Markdown d'un texte venu de l'extérieur (titre d'article, post
 * X, nom de fichier extrait du jeu).
 *
 * Sans ça, un `**` ou un `](` bien placé réécrit la mise en forme de l'embed —
 * voire fabrique un lien vers n'importe où sous un libellé anodin.
 */
export function echapper(texte: string | null | undefined): string {
	if (typeof texte !== "string") {
		return "";
	}
	return texte.replace(/([\\*_~`|[\]()>#-])/g, "\\$1");
}

/** Assemble `a · b · c` en ignorant les morceaux absents ou vides. */
export function joindre(
	morceaux: ReadonlyArray<string | null | undefined>,
	separateur = SEPARATEUR
): string {
	return morceaux
		.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
		.join(separateur);
}

/** `**Clé** valeur` — la forme des lignes de détail, partout la même. */
export function cle(libelle: string, valeur: string | number | null | undefined): string {
	const texte =
		typeof valeur === "number" ? valeur.toLocaleString("fr-FR") : (valeur ?? "").toString().trim();
	return texte.length === 0 ? "" : `**${libelle}** ${texte}`;
}

/** Liste à puces Markdown, chaque entrée bornée pour tenir dans un champ. */
export function puces(entrees: ReadonlyArray<string | null | undefined>, limite = 120): string {
	return entrees
		.filter((e): e is string => typeof e === "string" && e.trim().length > 0)
		.map((entree) => `- ${borner(entree, limite)}`)
		.join("\n");
}

/** Liste numérotée — pour un classement, où le rang porte du sens. */
export function rangs(entrees: ReadonlyArray<string>, depart = 1, limite = 120): string {
	return entrees.map((entree, i) => `**${depart + i}.** ${borner(entree, limite)}`).join("\n");
}

// ─── Horodatage natif ───────────────────────────────────────────────────────

/**
 * Horodatage relatif natif de Discord (`<t:…:R>`), recalculé côté client.
 *
 * Écrire « il y a 3 minutes » en dur donne une phrase fausse dès la relecture :
 * un embed reste affiché des heures dans un salon actif.
 */
export function ilYA(valeur: Date | string | number | null | undefined): string {
	const secondes = enSecondes(valeur);
	return secondes === null ? "—" : `<t:${secondes}:R>`;
}

/** Horodatage absolu natif (dans le fuseau du lecteur, pas dans le nôtre). */
export function leJour(valeur: Date | string | number | null | undefined, style = "f"): string {
	const secondes = enSecondes(valeur);
	return secondes === null ? "—" : `<t:${secondes}:${style}>`;
}

function enSecondes(valeur: Date | string | number | null | undefined): number | null {
	if (valeur === null || valeur === undefined || valeur === "") {
		return null;
	}
	const instant = valeur instanceof Date ? valeur : new Date(valeur);
	const ms = instant.getTime();
	return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Découpe un texte en valeurs de champ, sur les sauts de ligne.
 *
 * Couper au milieu d'un mot produit des lignes illisibles ; couper au milieu
 * d'un lien Markdown produit un embed refusé.
 */
export function decouper(
	texte: string,
	limite: number = LIMITES.valeurChamp,
	maxChamps = 5
): string[] {
	const morceaux: string[] = [];
	let courant = "";
	for (const ligne of texte.split("\n")) {
		const borne = ligne.length > limite ? borner(ligne, limite) : ligne;
		const candidat = courant.length === 0 ? borne : `${courant}\n${borne}`;
		if (candidat.length > limite) {
			if (courant.length > 0) {
				morceaux.push(courant);
			}
			courant = borne;
			if (morceaux.length >= maxChamps) {
				return morceaux.slice(0, maxChamps);
			}
		} else {
			courant = candidat;
		}
	}
	if (courant.length > 0) {
		morceaux.push(courant);
	}
	return morceaux.slice(0, maxChamps);
}
