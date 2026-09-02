/**
 * Les vignettes d'épisode — une carte composée, à la manière d'un lecteur
 * vidéo : l'image, le badge de durée, la barre de progression, le titre.
 *
 * ── POURQUOI COMPOSER UNE IMAGE PLUTÔT QUE POSER L'URL ─────────────────────
 * Discord sait afficher une image distante, mais rien de plus : il ne peut ni
 * y incruster la durée, ni y peindre la part déjà regardée, ni y accoler le
 * titre dans la même tuile. Or c'est précisément ce qui fait qu'une liste
 * d'épisodes se lit d'un coup d'œil. La carte est donc composée ici, et
 * envoyée comme pièce jointe.
 *
 * ── LA MISE EN PAGE EST PURE, LE RENDU NE L'EST PAS ────────────────────────
 * {@link svgCarte} rend une chaîne SVG : elle se teste au caractère près, sans
 * `sharp`, sans réseau et sans fichier. Seul {@link rendreVignette} touche à
 * l'image distante et au rastériseur. Le découpage n'est pas cosmétique — la
 * quasi-totalité des défauts d'une carte sont des défauts de MISE EN PAGE
 * (texte qui déborde, badge hors cadre, titre non échappé), et ceux-là se
 * prennent en test.
 *
 * ── SHARP EST FACULTATIF ───────────────────────────────────────────────────
 * Un bot qui ne fait que lister n'a pas à tirer un rastériseur natif. Le module
 * le charge à la demande, et son absence rend `null` : la commande retombe sur
 * l'affichage sans vignette au lieu d'échouer.
 */

/** Dimensions de la carte, en pixels. Deux fois la taille d'affichage. */
export const CARTE = {
	largeur: 640,
	/** Hauteur de la zone image — 16/9 exact. */
	hauteurImage: 360,
	/** Bandeau de texte sous l'image. */
	hauteurTexte: 116,
	/** Rayon des coins de l'image. */
	rayon: 16,
	marge: 16,
} as const;

export const CARTE_HAUTEUR = CARTE.hauteurImage + CARTE.hauteurTexte;

/** Palette de la carte — sombre, pour se fondre dans le thème de Discord. */
export const COULEURS_CARTE = {
	fond: "#0f1114",
	titre: "#f1f1f1",
	secondaire: "#aaaaaa",
	badgeFond: "rgba(0,0,0,0.8)",
	badgeTexte: "#ffffff",
	/** Rouge de la barre de progression. */
	progression: "#ff0033",
	pisteProgression: "rgba(255,255,255,0.28)",
	vu: "#3ba55d",
} as const;

export interface DonneesVignette {
	/** URL de l'image de fond. */
	image: string | null;
	titre: string;
	/** Ligne du dessous : arc, numéro, langues, date. */
	sousTitre: string;
	/** Badge en bas à droite — une durée, un code d'épisode. */
	badge?: string | null;
	/** Part déjà regardée, de 0 à 1. `0` n'affiche aucune barre. */
	progression?: number;
	/** Pastille « déjà vu » en haut à gauche. */
	vu?: boolean;
}

/**
 * Échappe le texte pour du XML.
 *
 * ── CE N'EST PAS UN DÉTAIL ─────────────────────────────────────────────────
 * Les titres viennent de sources externes et portent des apostrophes, des
 * guillemets et des esperluettes : « Duel au sommet contre les Little
 * Gigantes ». Une seule `&` non échappée rend le SVG invalide, et le
 * rastériseur ne produit RIEN — pas une carte dégradée, rien du tout.
 */
export function echapperXml(texte: string): string {
	return texte
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Largeur approchée d'un texte, en pixels.
 *
 * ── POURQUOI UNE APPROXIMATION ASSUMÉE ─────────────────────────────────────
 * Mesurer exactement demanderait de charger la police et son tableau de
 * chasses — une dépendance de plus pour un gain nul : la carte n'a besoin de
 * savoir que QUAND couper une ligne. Les chasses moyennes d'une police sans
 * empattement suffisent, à condition d'être prudentes : mieux vaut couper un
 * caractère trop tôt qu'un caractère trop tard, un débordement se voyant, une
 * ligne un peu courte non.
 */
export function largeurApprochee(texte: string, taille: number): number {
	let unites = 0;
	for (const caractere of texte) {
		const point = caractere.codePointAt(0) ?? 0;
		if (point > 0x2e80) unites += 1; // idéogrammes : chasse pleine
		else if (/[iIljt.,;:'!|[\]() ]/.test(caractere)) unites += 0.38;
		else if (/[MW@%&]/.test(caractere)) unites += 0.86;
		// Chiffres et capitales partagent une chasse large en DejaVu Sans Bold :
		// les sous-estimer faisait déborder le badge « S03E01 » hors du cadre.
		else if (/[A-Z0-9]/.test(caractere)) unites += 0.72;
		else unites += 0.58;
	}
	return unites * taille;
}

/**
 * Retire ce que la police de la carte ne sait pas dessiner.
 *
 * ── UN CARACTÈRE ABSENT N'EST PAS INVISIBLE, IL EST LAID ───────────────────
 * DejaVu Sans n'a pas d'emoji : un drapeau 🇫🇷 posé dans un sous-titre sort en
 * rectangle vide — le « tofu » — qui attire l'œil plus sûrement que
 * l'information qu'il remplace. Les emoji sont donc RETIRÉS du texte des
 * cartes ; ils restent dans les messages Discord, où le client sait les rendre.
 */
export function assainirTexte(texte: string): string {
	return texte
		// La plage 2190–2BFF (flèches, formes géométriques, symboles divers)
		// compte autant que les emoji modernes : « ▶️ » est un U+25B6 suivi d'un
		// sélecteur de variante, et retirer le seul sélecteur laissait un « ▶ »
		// que la police ne dessine pas davantage. Les ponctuations françaises
		// utiles (« » · — …) vivent toutes SOUS 2190 et ne sont pas touchées.
		.replace(
			/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{20E3}]/gu,
			""
		)
		// Retirer un emoji laisse un trou : « · 🇫🇷 VF » devient « ·  VF ». On
		// referme le trou et on fusionne deux séparateurs devenus voisins —
		// SANS toucher à l'espace qui précède un séparateur légitime, sous
		// peine d'écrire « Saison 3· E01· » au lieu de « Saison 3 · E01 ».
		.replace(/\s{2,}/g, " ")
		.replace(/·(\s*·)+/g, "·")
		.replace(/^[\s·]+|[\s·]+$/g, "")
		.trim();
}

/**
 * Coupe un texte en lignes tenant dans une largeur, sans casser les mots.
 *
 * Un mot plus long que la ligne entière est coupé de force : le laisser
 * déborder sortirait du cadre, ce qui est pire qu'une césure disgracieuse.
 * Le dépassement du nombre de lignes se termine par une ellipse.
 */
export function decouperLignes(
	texte: string,
	largeur: number,
	taille: number,
	lignesMax: number
): string[] {
	const mots = texte.split(/\s+/).filter((partie) => partie !== "");
	const lignes: string[] = [];
	let courante = "";
	/**
	 * Du texte est-il resté sur le carreau ?
	 *
	 * Compter les lignes ne suffit PAS : quand on s'arrête pile au nombre
	 * maximum, la ligne courante est vide et rien ne distingue « ça tombait
	 * juste » de « il restait huit mots ». Sans ce drapeau, une carte tronquée
	 * s'affichait sans ellipse et se lisait comme un titre complet.
	 */
	let tronque = false;

	const poser = () => {
		if (courante !== "") lignes.push(courante);
		courante = "";
	};

	for (const [rang, mot] of mots.entries()) {
		if (lignes.length >= lignesMax) {
			tronque = true;
			break;
		}

		const essai = courante === "" ? mot : `${courante} ${mot}`;
		if (largeurApprochee(essai, taille) <= largeur) {
			courante = essai;
			continue;
		}

		poser();
		if (lignes.length >= lignesMax) {
			// Ce mot-ci et tous les suivants n'entreront pas.
			tronque = true;
			break;
		}

		// Mot plus long que la ligne : on le coupe, caractère par caractère.
		let reste = mot;
		while (largeurApprochee(reste, taille) > largeur && reste.length > 1) {
			let coupe = reste.length;
			while (coupe > 1 && largeurApprochee(reste.slice(0, coupe), taille) > largeur) coupe--;
			lignes.push(reste.slice(0, coupe));
			reste = reste.slice(coupe);
			if (lignes.length >= lignesMax) {
				tronque = reste !== "" || rang < mots.length - 1;
				break;
			}
		}
		courante = lignes.length >= lignesMax ? "" : reste;
	}
	if (lignes.length < lignesMax) poser();
	else if (courante !== "") tronque = true;

	const retenues = lignes.slice(0, lignesMax);
	if ((tronque || lignes.length > lignesMax) && retenues.length > 0) {
		const derniere = retenues[retenues.length - 1] ?? "";
		retenues[retenues.length - 1] = `${derniere.replace(/[\s.]+$/, "").slice(0, -1)}…`;
	}
	return retenues;
}

/** Borne une progression dans [0, 1], en tolérant les valeurs aberrantes. */
export function bornerProgression(valeur: number | undefined): number {
	if (typeof valeur !== "number" || !Number.isFinite(valeur)) return 0;
	return Math.max(0, Math.min(1, valeur));
}

/**
 * La carte, en SVG.
 *
 * L'image de fond n'est PAS incluse ici : elle est composée par
 * {@link rendreVignette}, qui sait la redimensionner et la recadrer. Ce SVG
 * n'est que la surcouche — dégradé, badge, barre, texte — plus le fond du
 * bandeau. Séparer les deux évite d'avoir à encoder une image en base64 dans
 * une chaîne, ce qui multiplierait sa taille par quatre.
 */
export function svgCarte(donnees: DonneesVignette): string {
	const { largeur, hauteurImage, rayon, marge } = CARTE;
	const hauteur = CARTE_HAUTEUR;

	const tailleTitre = 26;
	const tailleSousTitre = 20;
	const lignesTitre = decouperLignes(
		assainirTexte(donnees.titre),
		largeur - marge * 2,
		tailleTitre,
		2
	);

	const progression = bornerProgression(donnees.progression);
	const largeurProgression = Math.round((largeur - marge * 2) * progression);

	const tailleBadge = 20;
	const badge = assainirTexte(donnees.badge ?? "");
	// Le badge ne peut pas dépasser le cadre : bornée à la moitié de la carte,
	// sa boîte reste dedans même si l'estimation de largeur se trompe.
	const largeurBadge = Math.min(
		Math.round(largeurApprochee(badge, tailleBadge) + 24),
		Math.round(largeur / 2)
	);
	const hauteurBadge = 32;

	const morceaux: string[] = [];

	// Bandeau de texte : le fond de la carte sous l'image.
	morceaux.push(
		`<rect x="0" y="${hauteurImage}" width="${largeur}" height="${hauteur - hauteurImage}" fill="${COULEURS_CARTE.fond}"/>`
	);

	// Voile sombre en bas de l'image : sans lui, un badge blanc posé sur une
	// image claire devient illisible.
	morceaux.push(
		`<defs><linearGradient id="voile" x1="0" y1="0" x2="0" y2="1">` +
			`<stop offset="0" stop-color="rgba(0,0,0,0)"/>` +
			`<stop offset="1" stop-color="rgba(0,0,0,0.65)"/>` +
			`</linearGradient></defs>` +
			`<rect x="0" y="${hauteurImage - 110}" width="${largeur}" height="110" fill="url(#voile)"/>`
	);

	if (badge !== "") {
		const x = largeur - marge - largeurBadge;
		const y = hauteurImage - marge - hauteurBadge - (progression > 0 ? 12 : 0);
		morceaux.push(
			`<rect x="${x}" y="${y}" width="${largeurBadge}" height="${hauteurBadge}" rx="6" fill="${COULEURS_CARTE.badgeFond}"/>`,
			`<text x="${x + largeurBadge / 2}" y="${y + hauteurBadge / 2}" fill="${COULEURS_CARTE.badgeTexte}" ` +
				`font-family="DejaVu Sans, sans-serif" font-size="${tailleBadge}" font-weight="700" ` +
				`text-anchor="middle" dominant-baseline="central">${echapperXml(badge)}</text>`
		);
	}

	if (donnees.vu) {
		morceaux.push(
			`<rect x="${marge}" y="${marge}" width="52" height="30" rx="6" fill="${COULEURS_CARTE.vu}"/>`,
			`<text x="${marge + 26}" y="${marge + 15}" fill="#ffffff" font-family="DejaVu Sans, sans-serif" ` +
				`font-size="${tailleBadge}" font-weight="700" text-anchor="middle" dominant-baseline="central">vu</text>`
		);
	}

	if (progression > 0) {
		const y = hauteurImage - marge - 6;
		morceaux.push(
			`<rect x="${marge}" y="${y}" width="${largeur - marge * 2}" height="6" rx="3" fill="${COULEURS_CARTE.pisteProgression}"/>`,
			`<rect x="${marge}" y="${y}" width="${largeurProgression}" height="6" rx="3" fill="${COULEURS_CARTE.progression}"/>`
		);
	}

	lignesTitre.forEach((ligne, rang) => {
		morceaux.push(
			`<text x="${marge}" y="${hauteurImage + 34 + rang * 32}" fill="${COULEURS_CARTE.titre}" ` +
				`font-family="DejaVu Sans, sans-serif" font-size="${tailleTitre}" font-weight="700" ` +
				`dominant-baseline="middle">${echapperXml(ligne)}</text>`
		);
	});

	const [sousTitre] = decouperLignes(
		assainirTexte(donnees.sousTitre),
		largeur - marge * 2,
		tailleSousTitre,
		1
	);
	if (sousTitre) {
		morceaux.push(
			`<text x="${marge}" y="${hauteurImage + 34 + lignesTitre.length * 32 + 6}" ` +
				`fill="${COULEURS_CARTE.secondaire}" font-family="DejaVu Sans, sans-serif" ` +
				`font-size="${tailleSousTitre}" dominant-baseline="middle">${echapperXml(sousTitre)}</text>`
		);
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}" ` +
		`viewBox="0 0 ${largeur} ${hauteur}">${morceaux.join("")}</svg>`
	);
}

/** Masque aux coins arrondis, appliqué à l'image de fond seule. */
export function svgMasqueImage(): string {
	const { largeur, hauteurImage, rayon } = CARTE;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteurImage}">` +
		`<rect width="${largeur}" height="${hauteurImage}" rx="${rayon}" ry="${rayon}" fill="#fff"/></svg>`
	);
}

/**
 * Variantes d'une vignette, de la meilleure à la plus sûre.
 *
 * ── `hqdefault` EST EN 4/3, ET C'EST UN PIÈGE ──────────────────────────────
 * La vignette « haute qualité » d'une vidéo fait 480×360 : elle contient
 * l'image en 16/9 ENTOURÉE de deux bandes noires. Recadrée telle quelle sur
 * une carte 16/9, elle garde ses bandes — mesuré sur la carte d'essai, où
 * l'image occupait 305 pixels de haut au lieu de 360.
 *
 * On demande donc d'abord les variantes réellement en 16/9 et plus larges que
 * la carte ; {@link recadrerLetterbox} rattrape le cas où seule la variante
 * 4/3 répond. Les URL non reconnues sont rendues telles quelles : aucune
 * plateforme n'est supposée.
 */
export function variantesVignette(url: string): string[] {
	const trouve = /^(https?:\/\/[^/]*(?:ytimg\.com|youtube\.com)\/vi\/[A-Za-z0-9_-]{11})\/[^/]+$/.exec(
		url
	);
	if (!trouve) return [url];
	const base = trouve[1]!;
	// `maxresdefault` n'existe pas pour toutes les vidéos, `hq720` souvent si ;
	// `hqdefault` répond toujours, d'où sa place en dernier recours.
	return [`${base}/maxresdefault.jpg`, `${base}/hq720.jpg`, `${base}/hqdefault.jpg`, url];
}

/**
 * Recadre une image 4/3 sur sa zone 16/9 centrée.
 *
 * Rend `null` quand l'image est déjà assez large — il n'y a alors rien à
 * retirer, et recadrer perdrait de l'image utile.
 */
export function recadrerLetterbox(
	largeur: number,
	hauteur: number
): { top: number; left: number; width: number; height: number } | null {
	if (largeur <= 0 || hauteur <= 0) return null;
	const cible = Math.round((largeur * 9) / 16);
	// Tolérance : une image déjà en 16/9 (ou plus large) n'a pas de bandes.
	if (hauteur - cible < 4) return null;
	return { left: 0, top: Math.round((hauteur - cible) / 2), width: largeur, height: cible };
}

/** Récupère les octets d'une image — injectable pour tester sans réseau. */
export type Telechargeur = (url: string) => Promise<Uint8Array | null>;

/**
 * Téléchargeur par défaut : borné dans le temps et en taille.
 *
 * Une vignette pèse quelques dizaines de kilooctets. Le plafond évite qu'une
 * URL mal résolue — une page HTML, un fichier de plusieurs mégaoctets — fasse
 * gonfler la mémoire du bot pour une image qui ne s'affichera pas.
 */
export const TELECHARGEUR_PAR_DEFAUT: Telechargeur = async (url) => {
	try {
		const reponse = await fetch(url, { signal: AbortSignal.timeout(6_000) });
		if (!reponse.ok) return null;
		const octets = new Uint8Array(await reponse.arrayBuffer());
		return octets.byteLength > 8_000_000 ? null : octets;
	} catch {
		return null;
	}
};

/** `sharp`, chargé au premier besoin ; `null` s'il n'est pas installé. */
let rasteriseur: Promise<unknown> | null = null;

async function chargerSharp(): Promise<((entree?: unknown) => never) | null> {
	rasteriseur ??= import("sharp")
		.then((module) => (module as { default: unknown }).default)
		.catch(() => null);
	return (await rasteriseur) as ((entree?: unknown) => never) | null;
}

/**
 * Compose la carte et rend un PNG.
 *
 * Rend `null` — jamais une exception — quand `sharp` manque, quand l'image est
 * injoignable ou illisible. Une vignette est un ornement : son échec ne doit
 * pas empêcher la réponse, seulement la priver d'image.
 */
export async function rendreVignette(
	donnees: DonneesVignette,
	options: { telecharger?: Telechargeur } = {}
): Promise<Buffer | null> {
	const sharp = await chargerSharp();
	if (!sharp) return null;

	const telecharger = options.telecharger ?? TELECHARGEUR_PAR_DEFAUT;

	try {
		// Les variantes sont essayées dans l'ordre : la première qui répond
		// gagne. Une seule requête dans le cas courant, où la meilleure existe.
		let fond: Uint8Array | null = null;
		if (donnees.image) {
			for (const variante of variantesVignette(donnees.image)) {
				fond = await telecharger(variante);
				if (fond) break;
			}
		}

		// L'image distante, débarrassée de ses bandes noires, recadrée en 16/9
		// puis arrondie. Sans image, un aplat sombre : une carte sans fond reste
		// lisible, une carte absente non.
		let image: Buffer | null = null;
		if (fond) {
			const source = sharp(Buffer.from(fond)) as never as SharpLike;
			const meta = await source.metadata();
			const decoupe = recadrerLetterbox(meta.width ?? 0, meta.height ?? 0);
			const prepare = decoupe ? source.extract(decoupe) : source;
			image = await prepare
				.resize(CARTE.largeur, CARTE.hauteurImage, { fit: "cover", position: "attention" })
				.composite([{ input: Buffer.from(svgMasqueImage()), blend: "dest-in" }])
				.png()
				.toBuffer();
		}

		const base = (sharp({
			create: {
				width: CARTE.largeur,
				height: CARTE_HAUTEUR,
				channels: 4,
				background: COULEURS_CARTE.fond,
			},
		}) as never as SharpLike).composite(
			[
				...(image ? [{ input: image, top: 0, left: 0 }] : []),
				{ input: Buffer.from(svgCarte(donnees)), top: 0, left: 0 },
			].filter(Boolean)
		);

		// ── WEBP, PAS PNG ──────────────────────────────────────────────────
		// La carte est aux trois quarts une PHOTOGRAPHIE : le PNG, sans perte,
		// la rendait en 577 Ko pour 640 pixels de large — mesuré. Le WebP tombe
		// à quelques dizaines de kilooctets sans dégrader le texte, et Discord
		// l'affiche nativement. La qualité est haute exprès : les aplats du
		// bandeau et les lettres blanches sur fond sombre sont ce qui souffre
		// le plus d'une compression agressive.
		return await base.webp({ quality: 88, effort: 4 }).toBuffer();
	} catch {
		return null;
	}
}

/** Le sous-ensemble de `sharp` réellement utilisé — évite un `any` diffus. */
interface SharpLike {
	resize(largeur: number, hauteur: number, options?: Record<string, unknown>): SharpLike;
	composite(couches: readonly Record<string, unknown>[]): SharpLike;
	extract(zone: { top: number; left: number; width: number; height: number }): SharpLike;
	metadata(): Promise<{ width?: number; height?: number }>;
	png(options?: Record<string, unknown>): SharpLike;
	webp(options?: Record<string, unknown>): SharpLike;
	toBuffer(): Promise<Buffer>;
}

/** Nom de fichier d'une vignette — il s'affiche sous la pièce jointe. */
export function nomVignette(saison: number, episode: number): string {
	return `episode-s${String(saison).padStart(2, "0")}e${String(episode).padStart(2, "0")}.webp`;
}
