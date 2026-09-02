/**
 * Les vignettes d'épisode — une carte composée, à la manière d'un lecteur
 * vidéo : l'image, le badge, la barre de progression, le titre.
 *
 * ── POURQUOI COMPOSER UNE IMAGE PLUTÔT QUE POSER L'URL ─────────────────────
 * Discord sait afficher une image distante, mais rien de plus : il ne peut ni
 * y incruster un badge, ni y peindre la part déjà regardée, ni y accoler le
 * titre dans la même tuile. Or c'est précisément ce qui fait qu'une liste
 * d'épisodes se lit d'un coup d'œil. La carte est donc composée ici.
 *
 * ── LA MESURE DU TEXTE EST EXACTE, ET C'ÉTAIT LE VRAI DÉFAUT ───────────────
 * Une première version dessinait en SVG et devait DEVINER la largeur des
 * textes, faute de métriques : une table de chasses moyennes écrite à la main.
 * Elle se trompait de 14 % en moins sur les minuscules et les capitales — d'où
 * un badge qui sortait du cadre, « corrigé » en gonflant des constantes — et de
 * 66 % en trop sur les idéogrammes. Mesuré à 20 px : « aaaaaa » vaut 80,98 px
 * et non 69,6 ; « サッカー » vaut 48,01 px et non 80.
 *
 * `@napi-rs/canvas` donne `measureText`, donc la vraie largeur. Toute la classe
 * de bugs de débordement disparaît à la racine, au lieu d'être repoussée par
 * des marges de sécurité. Le rendu direct supprime au passage l'échappement
 * XML, dont un seul oubli suffisait à ne produire aucune image.
 *
 * ── LA MISE EN PAGE RESTE PURE ─────────────────────────────────────────────
 * Elle prend un {@link Mesureur} en paramètre : les tests lui en passent un
 * déterministe et vérifient les coupes au caractère près, sans canvas ni
 * police. Seul {@link rendreVignette} touche à l'image distante et au dessin.
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

/**
 * Piles de polices.
 *
 * `Droid Sans Fallback` couvre le japonais et le chinois — les titres
 * originaux du catalogue en sont pleins — et `DejaVu Sans` le latin étendu.
 * Les deux sont présentes sur le VPS ; l'ordre compte, la première qui possède
 * le caractère gagne.
 */
export const POLICES = {
	titre: `700 26px "DejaVu Sans", "Droid Sans Fallback", sans-serif`,
	sousTitre: `400 20px "DejaVu Sans", "Droid Sans Fallback", sans-serif`,
	badge: `700 20px "DejaVu Sans", "Droid Sans Fallback", sans-serif`,
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
 * Mesure la largeur d'un texte dans une police donnée.
 *
 * Injectée plutôt qu'importée : c'est ce qui garde la mise en page testable
 * sans canvas, et ce qui interdit qu'un calcul de coupe dépende en douce d'une
 * police chargée ailleurs.
 */
export type Mesureur = (texte: string, police: string) => number;

/**
 * Retire ce que les polices de la carte ne savent pas dessiner.
 *
 * ── UN CARACTÈRE ABSENT N'EST PAS INVISIBLE, IL EST LAID ───────────────────
 * Ni DejaVu Sans ni Droid Sans Fallback n'ont d'emoji : un drapeau posé dans un
 * sous-titre sort en rectangle vide — le « tofu » — qui attire l'œil plus
 * sûrement que l'information qu'il remplace. Les emoji sont donc RETIRÉS du
 * texte des cartes ; ils restent dans les messages Discord, où le client sait
 * les rendre.
 *
 * La plage 2190–2BFF (flèches, formes géométriques) compte autant que les
 * emoji modernes : « ▶️ » est un U+25B6 suivi d'un sélecteur de variante, et
 * retirer le seul sélecteur laisserait un « ▶ » tout aussi absent. Les
 * ponctuations françaises utiles (« » · — …) vivent toutes sous 2190.
 */
export function assainirTexte(texte: string): string {
	return texte
		.replace(
			/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{20E3}]/gu,
			""
		)
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
 * Le dépassement du nombre de lignes se termine par une ellipse — et il faut
 * SAVOIR qu'il reste du texte, compter les lignes ne suffit pas : quand on
 * s'arrête pile au maximum, rien ne distingue « ça tombait juste » de « il
 * restait huit mots », et la carte se lirait comme un titre complet.
 */
export function decouperLignes(
	texte: string,
	largeur: number,
	police: string,
	lignesMax: number,
	mesurer: Mesureur
): string[] {
	const mots = texte.split(/\s+/).filter((partie) => partie !== "");
	const lignes: string[] = [];
	let courante = "";
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
		if (mesurer(essai, police) <= largeur) {
			courante = essai;
			continue;
		}

		poser();
		if (lignes.length >= lignesMax) {
			tronque = true;
			break;
		}

		let reste = mot;
		while (mesurer(reste, police) > largeur && reste.length > 1) {
			let coupe = reste.length;
			while (coupe > 1 && mesurer(reste.slice(0, coupe), police) > largeur) coupe--;
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

/** Une zone rectangulaire de la carte. */
export interface Zone {
	x: number;
	y: number;
	largeur: number;
	hauteur: number;
}

/** Tout ce qu'il y a à dessiner, calculé sans rien dessiner. */
export interface PlanCarte {
	lignesTitre: string[];
	sousTitre: string;
	badge: { texte: string; zone: Zone } | null;
	pastilleVu: Zone | null;
	progression: { piste: Zone; remplie: Zone } | null;
}

/**
 * Calcule la carte — positions comprises — sans dessiner.
 *
 * ── C'EST ICI QUE VIVENT LES DÉFAUTS, DONC C'EST ICI QU'ON TESTE ───────────
 * Débordement, badge hors cadre, ellipse manquante : tout se voit sur ce plan,
 * et un test peut l'affirmer au pixel près. Le dessin, lui, ne fait plus que
 * suivre.
 */
export function planifierCarte(donnees: DonneesVignette, mesurer: Mesureur): PlanCarte {
	const { largeur, hauteurImage, marge } = CARTE;
	const utile = largeur - marge * 2;

	const lignesTitre = decouperLignes(
		assainirTexte(donnees.titre),
		utile,
		POLICES.titre,
		2,
		mesurer
	);
	const [sousTitre = ""] = decouperLignes(
		assainirTexte(donnees.sousTitre),
		utile,
		POLICES.sousTitre,
		1,
		mesurer
	);

	const part = bornerProgression(donnees.progression);
	const yBarre = hauteurImage - marge - 6;
	const progression =
		part > 0
			? {
					piste: { x: marge, y: yBarre, largeur: utile, hauteur: 6 },
					remplie: { x: marge, y: yBarre, largeur: Math.round(utile * part), hauteur: 6 },
				}
			: null;

	const texteBadge = assainirTexte(donnees.badge ?? "");
	let badge: PlanCarte["badge"] = null;
	if (texteBadge !== "") {
		// La largeur est MESURÉE, plus devinée : le badge ne peut plus sortir du
		// cadre, et il n'y a plus de marge de sécurité à régler à la main.
		const largeurBadge = Math.ceil(mesurer(texteBadge, POLICES.badge)) + 24;
		const hauteurBadge = 32;
		badge = {
			texte: texteBadge,
			zone: {
				x: Math.max(marge, largeur - marge - largeurBadge),
				y: hauteurImage - marge - hauteurBadge - (progression ? 12 : 0),
				largeur: Math.min(largeurBadge, utile),
				hauteur: hauteurBadge,
			},
		};
	}

	return {
		lignesTitre,
		sousTitre,
		badge,
		pastilleVu: donnees.vu ? { x: marge, y: marge, largeur: 52, hauteur: 30 } : null,
		progression,
	};
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

/** Le sous-ensemble de `@napi-rs/canvas` réellement utilisé. */
interface ModuleCanvas {
	createCanvas(largeur: number, hauteur: number): ToileCanvas;
	loadImage(source: Uint8Array | Buffer): Promise<ImageCanvas>;
}

interface ImageCanvas {
	width: number;
	height: number;
}

interface ContexteCanvas {
	font: string;
	fillStyle: string;
	textAlign: string;
	textBaseline: string;
	measureText(texte: string): { width: number };
	fillText(texte: string, x: number, y: number): void;
	fillRect(x: number, y: number, largeur: number, hauteur: number): void;
	drawImage(
		image: ImageCanvas,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
		dw: number,
		dh: number
	): void;
	beginPath(): void;
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
	closePath(): void;
	clip(): void;
	fill(): void;
	save(): void;
	restore(): void;
	createLinearGradient(x0: number, y0: number, x1: number, y1: number): DegradeCanvas;
}

interface DegradeCanvas {
	addColorStop(position: number, couleur: string): void;
}

interface ToileCanvas {
	getContext(type: "2d"): ContexteCanvas;
	toBuffer(format: string, qualite?: number): Buffer;
}

/** Le module canvas, chargé au premier besoin ; `null` s'il manque. */
let moduleCanvas: Promise<ModuleCanvas | null> | null = null;

async function chargerCanvas(): Promise<ModuleCanvas | null> {
	moduleCanvas ??= import("@napi-rs/canvas")
		.then((module) => module as unknown as ModuleCanvas)
		.catch(() => null);
	return moduleCanvas;
}

/** Trace un rectangle aux coins arrondis dans le chemin courant. */
function cheminArrondi(
	ctx: ContexteCanvas,
	x: number,
	y: number,
	largeur: number,
	hauteur: number,
	rayon: number
): void {
	const r = Math.max(0, Math.min(rayon, largeur / 2, hauteur / 2));
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + largeur - r, y);
	ctx.quadraticCurveTo(x + largeur, y, x + largeur, y + r);
	ctx.lineTo(x + largeur, y + hauteur - r);
	ctx.quadraticCurveTo(x + largeur, y + hauteur, x + largeur - r, y + hauteur);
	ctx.lineTo(x + r, y + hauteur);
	ctx.quadraticCurveTo(x, y + hauteur, x, y + hauteur - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

/**
 * Compose la carte et rend une image WebP.
 *
 * ── WEBP, PAS PNG ──────────────────────────────────────────────────────────
 * La carte est aux trois quarts une photographie : le PNG, sans perte, la
 * rendait en 577 Ko pour 640 pixels de large — mesuré. Le WebP tombe à
 * quelques dizaines de kilooctets sans dégrader le texte.
 *
 * Rend `null` — jamais une exception — quand le canvas manque, quand l'image
 * est injoignable ou illisible. Une vignette est un ornement : son échec ne
 * doit pas empêcher la réponse, seulement la priver d'image.
 */
export async function rendreVignette(
	donnees: DonneesVignette,
	options: { telecharger?: Telechargeur } = {}
): Promise<Buffer | null> {
	const canvas = await chargerCanvas();
	if (!canvas) return null;

	const telecharger = options.telecharger ?? TELECHARGEUR_PAR_DEFAUT;
	const { largeur, hauteurImage, rayon, marge } = CARTE;

	try {
		const toile = canvas.createCanvas(largeur, CARTE_HAUTEUR);
		const ctx = toile.getContext("2d");
		const mesurer: Mesureur = (texte, police) => {
			ctx.font = police;
			return ctx.measureText(texte).width;
		};
		const plan = planifierCarte(donnees, mesurer);

		ctx.fillStyle = COULEURS_CARTE.fond;
		ctx.fillRect(0, 0, largeur, CARTE_HAUTEUR);

		// ── L'IMAGE ────────────────────────────────────────────────────────
		if (donnees.image) {
			let octets: Uint8Array | null = null;
			for (const variante of variantesVignette(donnees.image)) {
				octets = await telecharger(variante);
				if (octets) break;
			}

			if (octets) {
				const image = await canvas.loadImage(octets);
				// Les bandes noires d'une source 4/3 sont retirées AVANT le
				// recadrage : sans cela elles survivent au « cover ».
				const zone = recadrerLetterbox(image.width, image.height) ?? {
					left: 0,
					top: 0,
					width: image.width,
					height: image.height,
				};

				// Recadrage « cover » : on remplit le cadre sans déformer.
				const echelle = Math.max(largeur / zone.width, hauteurImage / zone.height);
				const largeurSource = Math.min(zone.width, Math.round(largeur / echelle));
				const hauteurSource = Math.min(zone.height, Math.round(hauteurImage / echelle));

				ctx.save();
				cheminArrondi(ctx, 0, 0, largeur, hauteurImage, rayon);
				ctx.clip();
				ctx.drawImage(
					image,
					zone.left + Math.round((zone.width - largeurSource) / 2),
					zone.top + Math.round((zone.height - hauteurSource) / 2),
					largeurSource,
					hauteurSource,
					0,
					0,
					largeur,
					hauteurImage
				);
				ctx.restore();
			}
		}

		// Voile sombre en bas de l'image : sans lui, un badge blanc posé sur une
		// image claire devient illisible.
		const voile = ctx.createLinearGradient(0, hauteurImage - 110, 0, hauteurImage);
		voile.addColorStop(0, "rgba(0,0,0,0)");
		voile.addColorStop(1, "rgba(0,0,0,0.65)");
		ctx.fillStyle = voile as unknown as string;
		ctx.fillRect(0, hauteurImage - 110, largeur, 110);

		// ── LES SURCOUCHES ─────────────────────────────────────────────────
		if (plan.pastilleVu) {
			const z = plan.pastilleVu;
			ctx.fillStyle = COULEURS_CARTE.vu;
			cheminArrondi(ctx, z.x, z.y, z.largeur, z.hauteur, 6);
			ctx.fill();
			ctx.fillStyle = "#ffffff";
			ctx.font = POLICES.badge;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText("vu", z.x + z.largeur / 2, z.y + z.hauteur / 2);
		}

		if (plan.progression) {
			ctx.fillStyle = COULEURS_CARTE.pisteProgression;
			cheminArrondi(
				ctx,
				plan.progression.piste.x,
				plan.progression.piste.y,
				plan.progression.piste.largeur,
				plan.progression.piste.hauteur,
				3
			);
			ctx.fill();
			ctx.fillStyle = COULEURS_CARTE.progression;
			cheminArrondi(
				ctx,
				plan.progression.remplie.x,
				plan.progression.remplie.y,
				plan.progression.remplie.largeur,
				plan.progression.remplie.hauteur,
				3
			);
			ctx.fill();
		}

		if (plan.badge) {
			const z = plan.badge.zone;
			ctx.fillStyle = COULEURS_CARTE.badgeFond;
			cheminArrondi(ctx, z.x, z.y, z.largeur, z.hauteur, 6);
			ctx.fill();
			ctx.fillStyle = COULEURS_CARTE.badgeTexte;
			ctx.font = POLICES.badge;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(plan.badge.texte, z.x + z.largeur / 2, z.y + z.hauteur / 2);
		}

		// ── LE BANDEAU DE TEXTE ────────────────────────────────────────────
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillStyle = COULEURS_CARTE.titre;
		ctx.font = POLICES.titre;
		plan.lignesTitre.forEach((ligne, rang) => {
			ctx.fillText(ligne, marge, hauteurImage + 34 + rang * 32);
		});

		if (plan.sousTitre !== "") {
			ctx.fillStyle = COULEURS_CARTE.secondaire;
			ctx.font = POLICES.sousTitre;
			ctx.fillText(plan.sousTitre, marge, hauteurImage + 34 + plan.lignesTitre.length * 32 + 6);
		}

		return toile.toBuffer("image/webp", 88);
	} catch {
		return null;
	}
}

/** Nom de fichier d'une vignette — il s'affiche sous la pièce jointe. */
export function nomVignette(saison: number, episode: number): string {
	return `episode-s${String(saison).padStart(2, "0")}e${String(episode).padStart(2, "0")}.webp`;
}
