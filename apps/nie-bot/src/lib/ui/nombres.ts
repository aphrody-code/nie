/**
 * Chiffres, durées et poids — la SEULE implémentation, pour les deux bots.
 *
 * ── POURQUOI ON CENTRALISE ─────────────────────────────────────────────────
 * Avant ce module, six fichiers formataient un nombre et quatre formataient un
 * poids d'octets : `formaterNombre` (trois versions, dont deux avec des règles
 * de décimales différentes), `nombreFr`, `entierLisible`, `formaterOctets`
 * (deux versions dont les valeurs d'absence divergeaient : `—` ici,
 * « taille inconnue » là). Le membre voyait donc « 12 Mo » sur une commande et
 * « 12,0 Mo » sur la suivante, pour le même fichier.
 *
 * Les fonctions de domaine restent en place (`cpk-format.octetsLisibles`,
 * `sondage-format.formaterNombre`, …) : elles délèguent désormais ici et ne
 * font plus que choisir la valeur d'absence, qui est la seule chose qui
 * différait légitimement.
 *
 * ── ESPACES INSÉCABLES ─────────────────────────────────────────────────────
 * `toLocaleString("fr-FR")` sépare les milliers par une espace insécable ÉTROITE
 * (U+202F). Elle s'affiche correctement dans Discord, mais tout test qui compare
 * à une espace ordinaire échoue — d'où `entierLisible`, qui groupe à la main
 * avec une espace ordinaire pour les surfaces dont les valeurs sont assertées.
 */
import { ABSENT } from "./theme";

/** Entier groupé à la française, avec l'espace fine insécable de la locale. */
export function formaterNombre(
	valeur: number | null | undefined,
	options: { decimales?: number; absent?: string } = {}
): string {
	if (typeof valeur !== "number" || !Number.isFinite(valeur)) {
		return options.absent ?? ABSENT;
	}
	return valeur.toLocaleString("fr-FR", { maximumFractionDigits: options.decimales ?? 0 });
}

/**
 * Entier groupé avec une espace ORDINAIRE.
 *
 * À utiliser partout où la valeur rendue est comparée dans un test : la locale
 * française pose une U+202F que personne ne tape au clavier.
 */
export function entierLisible(valeur: number | null | undefined, absent = ABSENT): string {
	if (typeof valeur !== "number" || !Number.isFinite(valeur)) {
		return absent;
	}
	const signe = valeur < 0 ? "-" : "";
	const chiffres = String(Math.abs(Math.trunc(valeur)));
	let rendu = "";
	for (let i = 0; i < chiffres.length; i++) {
		if (i > 0 && (chiffres.length - i) % 3 === 0) {
			rendu += " ";
		}
		rendu += chiffres[i];
	}
	return signe + rendu;
}

/**
 * Pourcentage à la française (« 25,8 % »).
 *
 * Deux appelants historiques divergeaient sur la seule chose qui devait
 * diverger : la valeur d'absence (`—` pour une donnée de jeu inconnue, `0 %`
 * pour un dépouillement de sondage sans voix). Elle est donc un paramètre, et
 * le reste — locale, virgule, espace insécable avant le signe — est commun.
 */
export function formaterPourcentage(
	valeur: number | null | undefined,
	options: { decimales?: number; absent?: string } = {}
): string {
	if (typeof valeur !== "number" || !Number.isFinite(valeur)) {
		return options.absent ?? ABSENT;
	}
	return `${valeur.toLocaleString("fr-FR", { maximumFractionDigits: options.decimales ?? 1 })} %`;
}

/**
 * Poids en unités binaires (Ko = 1024 octets, l'usage informatique et celui de
 * tous les relevés du dépôt). Une seule décimale sous 10, aucune au-delà : au
 * dixième de gigaoctet près, la précision supplémentaire n'aide personne.
 */
export function formaterOctets(octets: number | null | undefined, absent: string = ABSENT): string {
	if (typeof octets !== "number" || !Number.isFinite(octets) || octets < 0) {
		return absent;
	}
	const unites = ["o", "Ko", "Mo", "Go", "To"];
	let valeur = octets;
	let rang = 0;
	while (valeur >= 1024 && rang < unites.length - 1) {
		valeur /= 1024;
		rang += 1;
	}
	const rendu =
		rang === 0
			? String(Math.round(valeur))
			: valeur < 10
				? valeur.toFixed(1).replace(".", ",")
				: valeur.toFixed(0);
	return `${rendu} ${unites[rang]}`;
}

/**
 * Latence lisible. Au-delà de la seconde, les millisecondes ne disent plus rien
 * d'utile : on passe aux secondes avec une décimale.
 */
export function formaterLatence(ms: number | null | undefined): string {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
		return ABSENT;
	}
	return ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(1).replace(".", ",")} s`;
}

/** Durée d'exécution, jusqu'aux minutes. */
export function formaterDuree(ms: number | null | undefined): string {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
		return ABSENT;
	}
	if (ms < 1_000) {
		return `${Math.round(ms)} ms`;
	}
	if (ms < 60_000) {
		return `${(ms / 1_000).toFixed(1).replace(".", ",")} s`;
	}
	const minutes = Math.floor(ms / 60_000);
	const secondes = Math.round((ms % 60_000) / 1_000);
	return `${minutes} min ${secondes} s`;
}

/** Accord au pluriel. `pluriel(1, "membre")` → « membre », `pluriel(2, "membre")` → « membres ». */
export function pluriel(n: number, singulier: string, pluriel_?: string): string {
	return Math.abs(n) <= 1 ? singulier : (pluriel_ ?? `${singulier}s`);
}

/** `3 illustrations` — le décompte et son nom accordé, en une expression. */
export function compte(n: number, singulier: string, pluriel_?: string): string {
	return `${formaterNombre(n)} ${pluriel(n, singulier, pluriel_)}`;
}

/** Entier depuis une valeur d'origine inconnue (colonne SQL, JSON d'API). */
export function entier(valeur: unknown): number | null {
	if (typeof valeur === "number") {
		return Number.isFinite(valeur) ? Math.trunc(valeur) : null;
	}
	if (typeof valeur === "string" && valeur.trim().length > 0) {
		const nombre = Number(valeur);
		return Number.isFinite(nombre) ? Math.trunc(nombre) : null;
	}
	if (typeof valeur === "bigint") {
		return Number(valeur);
	}
	return null;
}

/** Décimal depuis une valeur d'origine inconnue (mêmes précautions qu'`entier`). */
export function decimal(valeur: unknown): number | null {
	if (typeof valeur === "number") {
		return Number.isFinite(valeur) ? valeur : null;
	}
	if (typeof valeur === "string" && valeur.trim().length > 0) {
		const nombre = Number(valeur);
		return Number.isFinite(nombre) ? nombre : null;
	}
	return null;
}
