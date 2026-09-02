/**
 * Génère `packages/ui/src/tokens.ts` à partir de `packages/ui/src/styles.css`.
 *
 * Pourquoi ce sens (CSS → TS) et pas l'inverse :
 *   - `styles.css` est l'artefact réellement consommé en production. Tailwind v4
 *     lit `@theme inline` pour fabriquer les utilities, et les deux apps Next
 *     l'importent en tête de leur `globals.css`. Faire du CSS le consommateur
 *     d'un module TS imposerait une étape de build supplémentaire dans le
 *     pipeline CSS des deux apps — un risque de panne pour un bénéfice nul.
 *   - Le CSS reste donc la source unique de vérité, et le TS en est une
 *     projection vérifiable : `packages/ui/test/tokens.test.ts` rejoue cette
 *     extraction sur le CSS et compare au fichier committé. Toute dérive
 *     (couleur changée dans le CSS, `tokens.ts` pas régénéré) fait échouer le
 *     test — c'est la garantie qu'il n'existe pas de seconde saisie manuelle.
 *
 * Deux conversions sont indispensables pour les consommateurs hors navigateur :
 *   - `oklch()` → hexadécimal sRGB. Le backend Skia de `@aphrody-code/canvas`
 *     ne connaît pas `oklch` : il renvoie silencieusement `#000000`, ce qui
 *     donnerait des cartes Discord entièrement noires.
 *   - `var(--x)` → valeur résolue, en cascadant le bloc du thème puis `:root`.
 *
 * Usage : `bun packages/ui/scripts/generer-tokens.ts` (réécrit `src/tokens.ts`).
 */

// ─── Analyse CSS ───────────────────────────────────────────────────────────

export interface BlocCss {
	/** Liste de sélecteurs du bloc, ex. `[":root.theme-roy", ".theme-roy"]`. */
	selecteurs: string[];
	/** Déclarations `--nom` → valeur brute (sans `var()` résolu). */
	declarations: Map<string, string>;
}

/**
 * Découpe une feuille CSS en blocs de déclarations (les blocs qui contiennent
 * d'autres blocs — `@layer`, `@media` — sont traversés, pas retournés).
 * Volontairement minimaliste : la feuille est écrite à la main dans ce dépôt,
 * pas générée, et n'utilise ni chaînes contenant des accolades ni `@supports`.
 */
export function analyserBlocs(css: string): BlocCss[] {
	const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const blocs: BlocCss[] = [];
	// Pile des préludes ouverts, pour savoir si l'on est dans un `@layer`.
	let position = 0;
	let prelude = "";

	const lire = (depuis: number, dansKeyframes: boolean): void => {
		let i = depuis;
		let debutPrelude = i;
		while (i < sansCommentaires.length) {
			const c = sansCommentaires[i]!;
			if (c === "{") {
				prelude = sansCommentaires.slice(debutPrelude, i).trim();
				const corps = extraireCorps(sansCommentaires, i);
				if (corps === null) return;
				const contenu = sansCommentaires.slice(i + 1, corps);
				if (contenu.includes("{")) {
					// Bloc conteneur (`@layer base { … }`, `@keyframes … { from {} }`) :
					// on descend dedans en mémorisant si l'on entre dans une animation,
					// dont les étapes `from`/`to` ne sont pas des jeux de tokens.
					lire(i + 1, dansKeyframes || prelude.startsWith("@keyframes"));
				} else if (!dansKeyframes && prelude.length > 0) {
					blocs.push({
						selecteurs: prelude
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean),
						declarations: analyserDeclarations(contenu),
					});
				}
				i = corps + 1;
				debutPrelude = i;
				continue;
			}
			if (c === "}") return;
			i++;
		}
	};

	lire(position, false);
	position = 0;
	return blocs;
}

/** Index de l'accolade fermante correspondant à celle ouverte en `ouverture`. */
function extraireCorps(css: string, ouverture: number): number | null {
	let profondeur = 0;
	for (let i = ouverture; i < css.length; i++) {
		if (css[i] === "{") profondeur++;
		else if (css[i] === "}") {
			profondeur--;
			if (profondeur === 0) return i;
		}
	}
	return null;
}

function analyserDeclarations(corps: string): Map<string, string> {
	const sortie = new Map<string, string>();
	for (const brute of corps.split(";")) {
		const separateur = brute.indexOf(":");
		if (separateur === -1) continue;
		const nom = brute.slice(0, separateur).trim();
		if (!nom.startsWith("--")) continue;
		sortie.set(nom, brute.slice(separateur + 1).trim());
	}
	return sortie;
}

// ─── Couleurs ──────────────────────────────────────────────────────────────

/** Encodage gamma sRGB d'une composante linéaire (0-1). */
function versSrgb(canal: number): number {
	return canal <= 0.0031308 ? 12.92 * canal : 1.055 * canal ** (1 / 2.4) - 0.055;
}

function borner(v: number, min: number, max: number): number {
	return v < min ? min : v > max ? max : v;
}

function octet(canal: number): string {
	return Math.round(borner(canal, 0, 1) * 255)
		.toString(16)
		.padStart(2, "0");
}

/**
 * `oklch(L C H)` → `#rrggbb`. Conversion Oklab → sRGB linéaire → sRGB gamma
 * (matrices de Björn Ottosson). L accepte `0-1` ou un pourcentage.
 */
export function oklchVersHex(valeur: string): string | null {
	const correspondance = /^oklch\(\s*([^\s]+)\s+([^\s]+)\s+([^\s)]+)\s*\)$/i.exec(valeur.trim());
	if (!correspondance) return null;
	const [, brutL, brutC, brutH] = correspondance;
	const L = brutL!.endsWith("%") ? Number.parseFloat(brutL!) / 100 : Number.parseFloat(brutL!);
	const C = brutC!.endsWith("%") ? (Number.parseFloat(brutC!) / 100) * 0.4 : Number.parseFloat(brutC!);
	const H = Number.parseFloat(brutH!);
	if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) return null;

	const radians = (H * Math.PI) / 180;
	const a = C * Math.cos(radians);
	const b = C * Math.sin(radians);

	const lRacine = L + 0.3963377774 * a + 0.2158037573 * b;
	const mRacine = L - 0.1055613458 * a - 0.0638541728 * b;
	const sRacine = L - 0.0894841775 * a - 1.291485548 * b;

	const l = lRacine ** 3;
	const m = mRacine ** 3;
	const s = sRacine ** 3;

	const rouge = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const vert = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const bleu = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	return `#${octet(versSrgb(rouge))}${octet(versSrgb(vert))}${octet(versSrgb(bleu))}`;
}

/** Normalise une valeur de couleur CSS vers une forme que Canvas 2D comprend. */
export function normaliserCouleur(valeur: string): string {
	const hex = oklchVersHex(valeur);
	if (hex) return hex;
	return valeur.trim().toLowerCase();
}

// ─── Résolution des `var()` ────────────────────────────────────────────────

/**
 * Résout `var(--x)` en cascadant `local` (le bloc du thème) puis `base`
 * (`:root`). Les cycles sont coupés au bout de 12 sauts.
 */
export function resoudreVar(
	valeur: string,
	local: Map<string, string>,
	base: Map<string, string>
): string {
	let courante = valeur;
	for (let saut = 0; saut < 12; saut++) {
		const correspondance = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/.exec(courante.trim());
		if (!correspondance) return courante;
		const reference = correspondance[1]!;
		const secours = correspondance[2];
		const suivante = local.get(reference) ?? base.get(reference) ?? secours;
		if (suivante === undefined) return courante;
		courante = suivante;
	}
	return courante;
}

// ─── Extraction ────────────────────────────────────────────────────────────

export const NOMS_THEMES = [
	"theme-roy",
	"theme-gaelle",
	"theme-azalee-light",
	"theme-azalee-dark",
] as const;
export type NomTheme = (typeof NOMS_THEMES)[number];

export interface TokensExtraits {
	marque: Record<string, string>;
	marquesTierces: Record<string, string>;
	formes: Record<string, number>;
	themes: Record<NomTheme, { md3: Record<string, string>; shadcn: Record<string, string> }>;
}

const PREFIXE_MD3 = "--md-sys-color-";
const PREFIXE_MARQUE = "--rg-";
const PREFIXE_FORME = "--md-sys-shape-corner-";

/** `on-primary-container` → `onPrimaryContainer`. */
export function versCamel(nom: string): string {
	return nom.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Rôles shadcn exposés par thème (ceux que les 4 thèmes déclarent tous). */
const ROLES_SHADCN = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"destructive-foreground",
	"border",
	"input",
	"ring",
	"sidebar",
	"sidebar-foreground",
	"sidebar-primary",
	"sidebar-primary-foreground",
	"sidebar-accent",
	"sidebar-accent-foreground",
	"sidebar-border",
	"sidebar-ring",
] as const;

export function extraireTokens(css: string): TokensExtraits {
	const blocs = analyserBlocs(css);

	const racine = new Map<string, string>();
	for (const bloc of blocs) {
		if (!bloc.selecteurs.includes(":root")) continue;
		for (const [nom, valeur] of bloc.declarations) racine.set(nom, valeur);
	}

	const theme = new Map<string, string>();
	for (const bloc of blocs) {
		if (!bloc.selecteurs.some((s) => s.startsWith("@theme"))) continue;
		for (const [nom, valeur] of bloc.declarations) theme.set(nom, valeur);
	}

	const marque: Record<string, string> = {};
	for (const [nom, valeur] of racine) {
		if (!nom.startsWith(PREFIXE_MARQUE)) continue;
		marque[versCamel(nom.slice(PREFIXE_MARQUE.length))] = normaliserCouleur(
			resoudreVar(valeur, racine, racine)
		);
	}

	const marquesTierces: Record<string, string> = {};
	for (const nom of ["--color-discord", "--color-patreon", "--color-twitch"]) {
		const valeur = theme.get(nom);
		if (valeur) marquesTierces[versCamel(nom.slice("--color-".length))] = normaliserCouleur(valeur);
	}

	const formes: Record<string, number> = {};
	for (const [nom, valeur] of theme) {
		if (!nom.startsWith(PREFIXE_FORME)) continue;
		const nombre = Number.parseFloat(valeur);
		if (Number.isFinite(nombre)) formes[versCamel(nom.slice(PREFIXE_FORME.length))] = nombre;
	}

	const themes = {} as TokensExtraits["themes"];
	for (const nom of NOMS_THEMES) {
		const bloc = blocs.find((b) => b.selecteurs.includes(`.${nom}`));
		if (!bloc) throw new Error(`[tokens] thème « ${nom} » introuvable dans styles.css`);
		// Cascade réelle : `.theme-x` est posé sur <html>, donc `:root` s'applique
		// aussi et fournit les rôles que le thème ne redéclare pas (scrim, shadow…).
		const fusion = new Map<string, string>([...racine, ...bloc.declarations]);

		const md3: Record<string, string> = {};
		for (const [cle, valeur] of fusion) {
			if (!cle.startsWith(PREFIXE_MD3)) continue;
			md3[versCamel(cle.slice(PREFIXE_MD3.length))] = normaliserCouleur(
				resoudreVar(valeur, fusion, racine)
			);
		}

		const shadcn: Record<string, string> = {};
		for (const role of ROLES_SHADCN) {
			const valeur = fusion.get(`--${role}`);
			if (valeur === undefined) continue;
			shadcn[versCamel(role)] = normaliserCouleur(resoudreVar(valeur, fusion, racine));
		}

		themes[nom] = { md3, shadcn };
	}

	return { marque, marquesTierces, formes, themes };
}

// ─── Rendu du module TypeScript ────────────────────────────────────────────

function litteral(valeur: Record<string, string | number>, indentation: string): string {
	const lignes = Object.entries(valeur).map(([cle, v]) =>
		typeof v === "number" ? `${indentation}\t${cle}: ${v},` : `${indentation}\t${cle}: "${v}",`
	);
	return `{\n${lignes.join("\n")}\n${indentation}}`;
}

export function rendreModule(tokens: TokensExtraits): string {
	const themes = NOMS_THEMES.map(
		(nom) =>
			`\t"${nom}": {\n\t\tmd3: ${litteral(tokens.themes[nom].md3, "\t\t")},\n\t\tshadcn: ${litteral(
				tokens.themes[nom].shadcn,
				"\t\t"
			)},\n\t},`
	).join("\n");

	return `/* GÉNÉRÉ — ne pas éditer à la main.
 * Source : packages/ui/src/styles.css
 * Régénérer : bun packages/ui/scripts/generer-tokens.ts
 *
 * Projection TypeScript des tokens du design system, utilisable HORS navigateur
 * (rendu Canvas du bot Discord, scripts, tests). Module volontairement pur :
 * aucun import, aucune API Node — packages/ui doit rester bundlable côté
 * navigateur, exactement comme la racine de packages/azalee.
 *
 * Les couleurs déclarées en \`oklch()\` dans le CSS sont converties en
 * hexadécimal sRGB : le backend Skia de Canvas 2D ne sait pas les lire et
 * renvoie \`#000000\` sans prévenir.
 */

/** Les 4 thèmes unifiés, tels que posés en classe sur \`<html>\`. */
export const NOMS_THEMES = [
${NOMS_THEMES.map((n) => `\t"${n}",`).join("\n")}
] as const;

export type NomTheme = (typeof NOMS_THEMES)[number];

/** Rôles de couleur Material Design 3 résolus pour un thème donné. */
export type RolesMd3 = Readonly<Record<keyof (typeof THEMES)["theme-roy"]["md3"], string>>;

/** Rôles shadcn (pont MD3 → shadcn) résolus pour un thème donné. */
export type RolesShadcn = Readonly<Record<keyof (typeof THEMES)["theme-roy"]["shadcn"], string>>;

/** Couleurs de marque Rose Griffon — identiques dans les 4 thèmes. */
export const MARQUE = ${litteral(tokens.marque, "")} as const;

/** Couleurs imposées par des marques tierces (constantes, hors thème). */
export const MARQUES_TIERCES = ${litteral(tokens.marquesTierces, "")} as const;

/** Échelle de formes M3, en pixels. */
export const FORMES = ${litteral(tokens.formes, "")} as const;

/** Tokens résolus des 4 thèmes. */
export const THEMES = {
${themes}
} as const;

/** Renvoie les rôles MD3 d'un thème. */
export function md3(nom: NomTheme): RolesMd3 {
	return THEMES[nom].md3;
}

/** Renvoie les rôles shadcn d'un thème. */
export function shadcn(nom: NomTheme): RolesShadcn {
	return THEMES[nom].shadcn;
}
`;
}

if (import.meta.main) {
	const cheminCss = new URL("../src/styles.css", import.meta.url).pathname;
	const cheminSortie = new URL("../src/tokens.ts", import.meta.url).pathname;
	const css = await Bun.file(cheminCss).text();
	await Bun.write(cheminSortie, rendreModule(extraireTokens(css)));
	console.log(`tokens=ok source=${cheminCss} sortie=${cheminSortie}`);
}
