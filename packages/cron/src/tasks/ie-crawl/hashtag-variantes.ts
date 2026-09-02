/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ANTICIPER LES FAUTES DE FRAPPE SUR LE HASHTAG D'UNE CAMPAGNE.
 *
 * Un participant recopie le hashtag à la main, depuis une affiche, souvent sur
 * un téléphone. `#IERGDay` arrive donc aussi en `#IERGDAY`, `#IERG_Day`,
 * `#iergday2026`, `#IERGDya`, `#IERGDy` — et chacune de ces formes est une
 * création qui compte, perdue si la récolte exige la graphie exacte.
 *
 * ── DEUX MÉCANIQUES, PARCE QUE X NE SAIT PAS CHERCHER APPROXIMATIVEMENT ─────
 * L'index de X est EXACT : `#IERGDay` ne remonte jamais `#IERGDya`. Il n'existe
 * donc aucun moyen de rattraper une faute qu'on n'a pas explicitement demandée.
 * D'où la séparation :
 *
 *  1. `variantesRecherche()` — la liste BORNÉE des graphies qu'on demande à X.
 *     Elle est packée en une poignée de requêtes `OR` (cf. `requetesVariantes`),
 *     parce que chaque requête coûte des pages, et que les pages coûtent le
 *     quota de la campagne entière.
 *  2. `apparierHashtag()` — le filet local, appliqué à TOUT ce que X renvoie,
 *     quelle que soit la requête qui l'a ramené. Il tolère une faute de plus que
 *     ce qu'on a demandé : les produits « Top » et les citations remontent
 *     régulièrement des posts voisins qu'aucune de nos requêtes ne visait.
 *
 * ── POURQUOI PAS « TOUTES LES VARIANTES À DISTANCE 1 » ─────────────────────
 * Pour `iergday` (7 lettres), l'ensemble des substitutions/insertions/omissions
 * à distance 1 dépasse trois cents graphies. Les demander à X, c'est griller le
 * quota pour des chaînes que personne n'a jamais tapées. On demande donc les
 * fautes RÉELLES (celles que produit la copie manuelle), et on rattrape le reste
 * par appariement local.
 *
 * ⚠ CE MODULE EST PUR. Aucun accès réseau, aucune base : c'est ce qui permet de
 * le tester exhaustivement, et c'est lui qui décide ce qui entre dans la galerie
 * publique d'une campagne.
 */

/** Plafond de graphies demandées à X, par hashtag de campagne. */
const MAX_VARIANTES_RECHERCHE = 12;

/**
 * Longueur minimale pour tolérer une faute à l'appariement.
 *
 * En dessous, une distance de 1 rapproche des mots sans rapport (`#rg` et
 * `#rp`), et une campagne n'a de toute façon jamais un hashtag de trois
 * lettres.
 */
const LONGUEUR_MIN_APPROX = 6;

/** À partir de cette longueur, deux fautes restent plus probables qu'un homonyme. */
const LONGUEUR_MIN_DEUX_FAUTES = 12;

/**
 * Séparateurs qu'un participant intercale au milieu d'un hashtag composé, et
 * que X considère comme des caractères à part entière (`#IERG_Day` n'est PAS
 * `#IERGDay` pour son index).
 *
 * Le point et le tiret coupent le hashtag chez X (`#IERG-Day` est le hashtag
 * `#IERG` suivi du mot `Day`) : ils sont quand même reconnus à l'appariement,
 * parce que le post, lui, existe et parle bien de la campagne.
 */
const SEPARATEURS = ["_", "-", ".", "·", "'", "’", " "] as const;

/** Suffixes que les participants ajoutent d'eux-mêmes. */
const SUFFIXES = ["s", "2026", "26"] as const;

/**
 * Normalise un hashtag pour la COMPARAISON : minuscules, sans accent, sans
 * séparateur, sans croisillon.
 *
 * `#IERG_Day` et `#iergday` deviennent la même chaîne — c'est bien le même
 * hashtag pour un humain, et c'est la seule chose qui compte ici.
 */
export function normaliserHashtag(brut: string): string {
	return (brut || "")
		.replace(/^#+/, "")
		.normalize("NFD")
		// Retrait des diacritiques : `#Célébration` et `#Celebration` sont la même
		// intention. `\p{Diacritic}` couvre les accents combinants après NFD.
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

/**
 * Tous les hashtags écrits dans un texte, dans l'ordre d'apparition.
 *
 * La classe de caractères suit celle de X : lettres (Unicode, donc les hashtags
 * japonais comptent), chiffres et tiret bas. Un hashtag entièrement numérique
 * n'en est pas un chez X non plus — il est écarté.
 */
export function hashtagsDuTexte(texte: string): string[] {
	const trouves: string[] = [];
	for (const appariement of (texte || "").matchAll(/#([\p{L}\p{N}_]+)/gu)) {
		const brut = appariement[1] ?? "";
		if (brut && !/^\d+$/.test(brut)) {
			trouves.push(brut);
		}
	}
	return trouves;
}

/**
 * Distance de Damerau-Levenshtein (insertion, suppression, substitution,
 * TRANSPOSITION), arrêtée dès qu'elle dépasse `plafond`.
 *
 * La transposition est le point important : `#IERGDya` pour `#IERGDay` est LA
 * faute de frappe la plus fréquente au clavier, et une Levenshtein classique la
 * compte pour deux — c'est-à-dire hors de portée d'un seuil raisonnable.
 *
 * @returns la distance, ou `plafond + 1` dès qu'elle est certainement dépassée.
 */
export function distanceFaute(a: string, b: string, plafond: number): number {
	if (a === b) return 0;
	// Un écart de longueur supérieur au plafond ne peut pas être rattrapé : ni
	// insertion ni suppression ne comble plus d'un caractère à la fois.
	if (Math.abs(a.length - b.length) > plafond) return plafond + 1;

	const precedente = new Array<number>(b.length + 1);
	const courante = new Array<number>(b.length + 1);
	let avantPrecedente = new Array<number>(b.length + 1);

	for (let j = 0; j <= b.length; j++) precedente[j] = j;

	for (let i = 1; i <= a.length; i++) {
		courante[0] = i;
		let meilleureDeLaLigne = courante[0]!;
		for (let j = 1; j <= b.length; j++) {
			const cout = a[i - 1] === b[j - 1] ? 0 : 1;
			let valeur = Math.min(
				courante[j - 1]! + 1, // insertion
				precedente[j]! + 1, // suppression
				precedente[j - 1]! + cout // substitution
			);
			// Transposition : `ab` ↔ `ba` compte pour UNE faute.
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				valeur = Math.min(valeur, avantPrecedente[j - 2]! + 1);
			}
			courante[j] = valeur;
			if (valeur < meilleureDeLaLigne) meilleureDeLaLigne = valeur;
		}
		// Toute la ligne dépasse déjà le plafond : le reste ne peut que croître.
		if (meilleureDeLaLigne > plafond) return plafond + 1;
		avantPrecedente = precedente.slice();
		for (let j = 0; j <= b.length; j++) precedente[j] = courante[j]!;
	}

	const distance = precedente[b.length]!;
	return distance > plafond ? plafond + 1 : distance;
}

/** Nombre de fautes tolérées pour un hashtag de cette longueur. */
export function toleranceFautes(longueur: number): number {
	if (longueur >= LONGUEUR_MIN_DEUX_FAUTES) return 2;
	if (longueur >= LONGUEUR_MIN_APPROX) return 1;
	return 0;
}

/**
 * Les graphies à DEMANDER à X pour un hashtag, la forme exacte en tête.
 *
 * L'ordre est signifiant : les premières sont les plus probables, et la liste
 * est tronquée à `MAX_VARIANTES_RECHERCHE`. Ce qui tombe au-delà n'est pas
 * perdu pour autant — `apparierHashtag` le rattrape si X le renvoie par une
 * autre requête.
 *
 * Ne sont PAS produites : les substitutions de touches voisines (elles font
 * exploser la liste sans correspondre à une faute de copie), et les variantes
 * de casse (l'index de X est insensible à la casse).
 */
export function variantesRecherche(hashtag: string): string[] {
	const base = normaliserHashtag(hashtag);
	if (!base) return [];

	const variantes: string[] = [base];
	const ajouter = (candidate: string) => {
		const propre = candidate.replace(/[^\p{L}\p{N}_]/gu, "");
		if (propre && propre.toLowerCase() !== base && !variantes.includes(propre.toLowerCase())) {
			variantes.push(propre.toLowerCase());
		}
	};

	// 1. Séparateurs au point de composition. `#IERGDay` s'écrit très souvent
	//    `#IERG_Day` : c'est la faute la plus payante, et la seule que X puisse
	//    retrouver telle quelle (le tiret bas fait partie du hashtag chez lui).
	for (const position of pointsDeComposition(hashtag, base)) {
		for (const separateur of SEPARATEURS) {
			if (separateur === "_") {
				ajouter(`${base.slice(0, position)}_${base.slice(position)}`);
			}
		}
	}

	// 2. Suffixes ajoutés spontanément (pluriel, millésime).
	for (const suffixe of SUFFIXES) ajouter(base + suffixe);

	// 3. Transpositions de deux lettres adjacentes — la faute de frappe reine.
	for (let i = 0; i + 1 < base.length; i++) {
		ajouter(base.slice(0, i) + base[i + 1] + base[i] + base.slice(i + 2));
	}

	// 4. Lettre doublée (touche qui rebondit) et lettre avalée (touche ratée).
	for (let i = 0; i < base.length; i++) {
		ajouter(base.slice(0, i) + base[i] + base.slice(i));
		ajouter(base.slice(0, i) + base.slice(i + 1));
	}

	return variantes.slice(0, MAX_VARIANTES_RECHERCHE);
}

/**
 * Positions où un hashtag composé se coupe, déduites de sa graphie D'ORIGINE.
 *
 * `IERGDay` se coupe avant le `D` (passage majuscules → minuscule) ; `iergDay`
 * avant le `D` aussi (minuscule → majuscule). Sans la graphie d'origine — celle
 * de l'affiche, pas la normalisée — cette information est perdue et on ne sait
 * plus où un humain insérerait un tiret bas.
 */
function pointsDeComposition(origine: string, base: string): number[] {
	const brut = (origine || "").replace(/^#+/, "");
	const positions = new Set<number>();
	let indexNormalise = 0;
	for (let i = 0; i < brut.length; i++) {
		const c = brut[i]!;
		if (!/[a-z0-9]/i.test(c)) continue;
		const precedent = brut[i - 1];
		// Majuscule précédée d'une minuscule, ou majuscule suivie d'une minuscule
		// dans une série de majuscules (`IERGDay` → avant le `D`).
		if (
			indexNormalise > 0 &&
			/[A-Z]/.test(c) &&
			(/[a-z0-9]/.test(precedent ?? "") || /[a-z]/.test(brut[i + 1] ?? ""))
		) {
			positions.add(indexNormalise);
		}
		indexNormalise++;
	}
	// Repli : un hashtag écrit tout en minuscules ne dit rien de sa composition.
	if (positions.size === 0 && base.length >= 6) return [];
	return [...positions].filter((p) => p > 0 && p < base.length);
}

/** Ce qu'un post porte réellement, et à quel hashtag de campagne ça correspond. */
export interface Appariement {
	/** Le hashtag de la campagne (forme déclarée en base). */
	hashtag: string;
	/** Ce que le post écrit, tel quel — sans croisillon. */
	ecrit: string;
	/** Nombre de fautes : 0 = graphie exacte. */
	fautes: number;
}

/**
 * Le texte porte-t-il l'un des hashtags de la campagne, faute de frappe comprise ?
 *
 * L'appariement EXACT prime toujours : un post qui porte à la fois `#IERGDay` et
 * une variante approximative est rattaché au hashtag exact, sans quoi la
 * statistique « quel hashtag a mordu » deviendrait un tirage au sort.
 *
 * @param texte   le texte du post
 * @param hashtags les hashtags de la campagne (déclarés + rattrapage)
 */
export function apparierHashtag(
	texte: string,
	hashtags: readonly string[]
): Appariement | null {
	const ecrits = hashtagsDuTexte(texte);
	if (ecrits.length === 0 || hashtags.length === 0) return null;

	const cibles = hashtags
		.map((h) => ({ declare: h, normalise: normaliserHashtag(h) }))
		.filter((c) => c.normalise.length > 0);

	let meilleur: Appariement | null = null;

	for (const ecrit of ecrits) {
		const normalise = normaliserHashtag(ecrit);
		if (!normalise) continue;
		for (const cible of cibles) {
			if (normalise === cible.normalise) {
				// Rien ne battra un appariement exact : on sort tout de suite.
				return { hashtag: cible.declare, ecrit, fautes: 0 };
			}
			const tolerance = toleranceFautes(cible.normalise.length);
			if (tolerance === 0) continue;
			const distance = distanceFaute(normalise, cible.normalise, tolerance);
			if (distance <= tolerance && (meilleur === null || distance < meilleur.fautes)) {
				meilleur = { hashtag: cible.declare, ecrit, fautes: distance };
			}
		}
	}

	return meilleur;
}

/**
 * Empaquette des graphies en requêtes X, une poignée de `OR` plutôt qu'une
 * requête par graphie.
 *
 * X accepte les groupes `(#a OR #b OR #c)` et facture la PAGE, pas le terme :
 * une requête de douze graphies coûte le prix d'une seule. Le découpage n'existe
 * que pour la limite de longueur du champ de recherche.
 *
 * @param variantes graphies normalisées (sans croisillon)
 * @param suffixe   filtres à recoller à chaque requête (`-filter:replies since:…`)
 */
export function requetesVariantes(
	variantes: readonly string[],
	suffixe = "",
	longueurMax = 400
): string[] {
	const uniques = [...new Set(variantes.filter(Boolean))];
	if (uniques.length === 0) return [];

	const requetes: string[] = [];
	let lot: string[] = [];

	const vider = () => {
		if (lot.length === 0) return;
		const groupe = lot.length === 1 ? `#${lot[0]}` : `(${lot.map((v) => `#${v}`).join(" OR ")})`;
		requetes.push(suffixe ? `${groupe} ${suffixe}`.trim() : groupe);
		lot = [];
	};

	for (const variante of uniques) {
		const essai = [...lot, variante];
		const longueur =
			essai.reduce((n, v) => n + v.length + 5, 0) + suffixe.length + 2;
		if (lot.length > 0 && longueur > longueurMax) vider();
		lot.push(variante);
	}
	vider();

	return requetes;
}
