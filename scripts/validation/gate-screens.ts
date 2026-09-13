#!/usr/bin/env bun
/**
 * Compare CHAQUE écran composé à la capture réelle du jeu, et rendre un tableau.
 *
 * ## Pourquoi ce balayage
 *
 * `gate-menu.ts` compare une capture à une référence, mais il prend le chemin en argument :
 * c'est un outil manuel. Les 38 captures de `data/menu/` n'étaient donc dans AUCUNE boucle de
 * vérification, et le 2026-09-13 un simple coup d'œil à un écran composé a révélé que tout le
 * texte des menus sortait en mojibake — un défaut qu'aucune porte du dépôt ne pouvait voir,
 * parce qu'elles vérifient toutes que deux implémentations s'accordent ou qu'une fonction
 * reproduit des octets, jamais que l'image est juste.
 *
 * ## Ce qui est comparé, et ce qui ne l'est pas
 *
 * Seules les paires `confidence: "documented_exact"` du manifeste : huit captures dont l'écran
 * canonique est établi et qui ne sont pas des sous-écrans. Les 22 `documented_family` montrent
 * un sous-écran (un panneau de filtres, par exemple) et les comparer au rendu de l'écran de base
 * mesurerait la différence entre deux choses différentes.
 *
 * Le SSIM n'est PAS une note de conformité : le compositeur ne dessine ni les personnages 3D ni
 * les fonds animés, donc un écran correct plafonne bas. Ce que ce garde-fou détecte est une
 * CHUTE — la régression visuelle qu'aucun test unitaire ne voit.
 *
 * Usage : NIE_SITE_BASE=http://127.0.0.1:18099 bun --bun scripts/validation/gate-screens.ts
 */
import { grayscaleSsim } from "./image-metrics";

const SITE = process.env.NIE_SITE_BASE ?? "http://127.0.0.1:8085";
const RACINE = new URL("../../", import.meta.url).pathname;

interface Entree {
	file: string;
	canonical_screen?: string;
	confidence?: string;
	visual_subscreen?: string | null;
}

/**
 * Décode un PNG en NIVEAUX DE GRIS via `magick`, seul décodeur déjà requis par `gate-menu.ts`.
 *
 * `grayscaleSsim` attend un octet par pixel : lui passer du RGBA échoue sur la longueur, ce qui
 * se lit comme « images de tailles différentes » alors que ce sont les CANAUX qui diffèrent.
 */
async function gris(chemin: string, largeur: number, hauteur: number): Promise<Uint8Array> {
	const proc = Bun.spawn(
		["magick", chemin, "-resize", `${largeur}x${hauteur}!`, "-colorspace", "Gray",
		 "-depth", "8", "GRAY:-"],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [octets, erreur, code] = await Promise.all([
		new Response(proc.stdout).arrayBuffer(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`magick ${chemin} : ${erreur}`);
	return new Uint8Array(octets);
}

async function main() {
	const manifeste = await Bun.file(`${RACINE}data/menu/manifest.json`).json();
	const paires: Entree[] = (manifeste.entries as Entree[]).filter(
		(e) => e.confidence === "documented_exact" && e.canonical_screen && !e.visual_subscreen,
	);
	if (paires.length === 0) throw new Error("aucune paire exacte dans le manifeste");

	const W = 1280;
	const H = 720;
	const reference = await Bun.file(`${RACINE}data/menu/screen-ssim-baseline.json`).json() as {
		tolerance: number;
		valeurs: Record<string, number>;
	};
	const lignes: { ecran: string; capture: string; ssim: string; attendu?: number }[] = [];
	let plancherAtteint = 0;

	for (const paire of paires) {
		const ecran = paire.canonical_screen!;
		const url = `${SITE}/api/v1/menu/render/${encodeURIComponent(ecran)}?locale=fr`;
		const reponse = await fetch(url).catch(() => null);
		if (!reponse?.ok) {
			lignes.push({ ecran, capture: paire.file, ssim: `HTTP ${reponse?.status ?? "?"}` });
			continue;
		}
		const rendu = `/tmp/gate-screens-${ecran}.png`;
		await Bun.write(rendu, await reponse.arrayBuffer());
		const [a, b] = await Promise.all([
			gris(rendu, W, H),
			gris(`${RACINE}data/menu/${paire.file}`, W, H),
		]);
		const score = grayscaleSsim(a, b, W, H);
		const cle = `${ecran}|${paire.file}`;
		const attendu = reference.valeurs[cle];
		lignes.push({ ecran, capture: paire.file, ssim: score.toFixed(4), attendu });
		if (attendu === undefined || score >= attendu - reference.tolerance) plancherAtteint += 1;
	}

	console.log("\n| écran | capture | SSIM | référence |");
	console.log("|---|---|---:|---:|");
	for (const l of lignes) {
		const ref = l.attendu === undefined ? "—" : l.attendu.toFixed(4);
		console.log(`| ${l.ecran} | ${l.capture} | ${l.ssim} | ${ref} |`);
	}
	const scores = lignes.map((l) => Number(l.ssim)).filter((n) => Number.isFinite(n));
	const moyenne = scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1);
	console.log(`\n${scores.length}/${paires.length} rendus | SSIM moyen ${moyenne.toFixed(4)} | ` +
		`${plancherAtteint} au niveau de leur référence (tolérance ${reference.tolerance})`);

	// Un PLANCHER, comme le différentiel Lua : ce relevé doit dire NON quand une régression fait
	// chuter un écran, sans exiger une conformité que le compositeur ne vise pas.
	if (scores.length < paires.length) {
		console.error(`RENDU MANQUANT : ${paires.length - scores.length} écran(s)`);
		process.exit(1);
	}
	if (plancherAtteint < scores.length) {
		console.error(`RÉGRESSION : ${scores.length - plancherAtteint} écran(s) sous leur référence`);
		process.exit(1);
	}
}

await main();
