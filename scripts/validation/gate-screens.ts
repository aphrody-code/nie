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
 * Toute entrée du manifeste qui nomme un écran canonique ET ne porte PAS de `visual_subscreen` :
 * la capture montre alors l'écran entier, qui est ce que le compositeur rend. Une capture à
 * `visual_subscreen` montre un panneau de filtres ou une fiche ouverte PAR-DESSUS l'écran de
 * base, et la comparer au rendu de la base mesurerait la différence entre deux choses.
 *
 * Le critère n'est volontairement PAS `confidence`. Cette colonne dit avec quelle certitude
 * l'écran a été identifié — pas si la capture montre un sous-écran. Filtrer sur
 * `documented_exact` écartait quatre écrans entiers (`gallery_menu`, `soccer_formation_menu`,
 * `camera_option_menu`, `pause_menu`) pour une raison sans rapport avec ce qui est mesuré, et
 * ce sont eux qui portaient les défauts : mesuré le 2026-09-19, `pause_menu` ne compose RIEN.
 *
 * Le SSIM n'est PAS une note de conformité : le compositeur ne dessine ni les personnages 3D ni
 * les fonds animés, donc un écran correct plafonne bas. Ce que ce garde-fou détecte est une
 * CHUTE — la régression visuelle qu'aucun test unitaire ne voit.
 *
 * ## Trois issues, trois messages
 *
 * Un écran qui répond 200 n'est pas un écran rendu : la route renvoie une toile 1280×720
 * entièrement transparente (5 209 octets) quand la composition ne dessine rien, et elle le dit
 * par `x-compose-drawn`. Confondre ce cas avec un SSIM bas fait accuser le rendu là où le
 * compositeur n'a rien placé, donc chaque issue porte son propre mot : `HTTP n`, `TOILE VIDE`,
 * ou une valeur.
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

interface Reference {
	tolerance: number;
	valeurs: Record<string, number>;
	toiles_vides?: string[];
}

/** Ce qu'une paire a donné : une mesure, ou la raison pour laquelle il n'y en a pas. */
type Issue =
	| { genre: "ssim"; score: number }
	| { genre: "vide"; objets: number }
	| { genre: "http"; statut: string };

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

/**
 * Refuse de mesurer quand le site ne monte pas le JEU.
 *
 * `nie-site` démarre et répond 200 avec le dépôt pour VFS — c'est ce que donne un
 * `NIE_GAME_DIR` laissé à la racine du dépôt : 156 873 entrées, **0 CPK**, et chaque écran
 * revient en toile vide. Mesuré le 2026-09-19, la porte annonçait alors « RÉGRESSION : 8 écrans »
 * avec un SSIM de 0,0006, c'est-à-dire qu'elle accusait le rendu d'un défaut d'environnement.
 * La valeur de production est dans `../aphrody-infra/systemd/nie-site.service`.
 */
async function exigerLeVfsDuJeu(): Promise<number> {
	const reponse = await fetch(`${SITE}/api/v1/health`).catch(() => null);
	if (!reponse?.ok) {
		console.error(`SITE INJOIGNABLE : ${SITE} (HTTP ${reponse?.status ?? "aucune réponse"})`);
		process.exit(2);
	}
	const sante = await reponse.json() as { capacites?: { vfs_cpks?: number } };
	const cpks = sante.capacites?.vfs_cpks ?? 0;
	if (cpks === 0) {
		console.error(
			`VFS DU JEU ABSENT : ${SITE} monte 0 CPK, donc chaque écran revient en toile vide et\n` +
			"aucune mesure n'a de sens. Ce n'est PAS une régression du rendu.\n" +
			"Relancer le site avec le dossier du jeu, comme le fait l'unité systemd :\n" +
			"  NIE_GAME_DIR=/home/ubuntu/.local/share/Steam/iecode/inazuma \\\n" +
			"  ./target/release/nie-site --listen 127.0.0.1:18099",
		);
		process.exit(2);
	}
	return cpks;
}

async function mesurer(ecran: string, fichier: string, largeur: number, hauteur: number): Promise<Issue> {
	const url = `${SITE}/api/v1/menu/render/${encodeURIComponent(ecran)}?locale=fr`;
	const reponse = await fetch(url).catch(() => null);
	if (!reponse?.ok) return { genre: "http", statut: String(reponse?.status ?? "?") };
	const objets = Number(reponse.headers.get("x-compose-drawn") ?? "0");
	const octets = await reponse.arrayBuffer();
	if (objets === 0) return { genre: "vide", objets };
	const rendu = `/tmp/gate-screens-${ecran}.png`;
	await Bun.write(rendu, octets);
	const [a, b] = await Promise.all([
		gris(rendu, largeur, hauteur),
		gris(`${RACINE}data/menu/${fichier}`, largeur, hauteur),
	]);
	return { genre: "ssim", score: grayscaleSsim(a, b, largeur, hauteur) };
}

async function main() {
	const cpks = await exigerLeVfsDuJeu();
	const manifeste = await Bun.file(`${RACINE}data/menu/manifest.json`).json();
	const paires: Entree[] = (manifeste.entries as Entree[]).filter(
		(e) => e.canonical_screen && !e.visual_subscreen,
	);
	if (paires.length === 0) throw new Error("aucune capture d'écran entier dans le manifeste");

	const W = 1280;
	const H = 720;
	const reference = await Bun.file(`${RACINE}data/menu/screen-ssim-baseline.json`).json() as Reference;
	const videsConnues = new Set(reference.toiles_vides ?? []);

	const lignes: { ecran: string; capture: string; etat: string; attendu?: number }[] = [];
	let plancherAtteint = 0;
	let videsInattendues = 0;
	let videsConnuesVues = 0;
	let indisponibles = 0;

	for (const paire of paires) {
		const ecran = paire.canonical_screen!;
		const cle = `${ecran}|${paire.file}`;
		const attendu = reference.valeurs[cle];
		const issue = await mesurer(ecran, paire.file, W, H);
		if (issue.genre === "http") {
			lignes.push({ ecran, capture: paire.file, etat: `HTTP ${issue.statut}`, attendu });
			indisponibles += 1;
			continue;
		}
		if (issue.genre === "vide") {
			const connue = videsConnues.has(cle);
			lignes.push({ ecran, capture: paire.file, etat: connue ? "TOILE VIDE (connue)" : "TOILE VIDE", attendu });
			if (connue) videsConnuesVues += 1;
			else videsInattendues += 1;
			continue;
		}
		lignes.push({ ecran, capture: paire.file, etat: issue.score.toFixed(4), attendu });
		if (attendu === undefined || issue.score >= attendu - reference.tolerance) plancherAtteint += 1;
	}

	const mesurees = lignes.filter((l) => Number.isFinite(Number(l.etat))).length;

	console.log(`\n${SITE} — VFS du jeu monté, ${cpks} CPK`);
	console.log("\n| écran | capture | SSIM | référence |");
	console.log("|---|---|---:|---:|");
	for (const l of lignes) {
		const ref = l.attendu === undefined ? "—" : l.attendu.toFixed(4);
		console.log(`| ${l.ecran} | ${l.capture} | ${l.etat} | ${ref} |`);
	}
	const scores = lignes.map((l) => Number(l.etat)).filter((n) => Number.isFinite(n));
	const moyenne = scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1);
	console.log(
		`\n${mesurees}/${paires.length} mesurés | SSIM moyen ${moyenne.toFixed(4)} | ` +
		`${plancherAtteint} au niveau de leur référence (tolérance ${reference.tolerance})` +
		(videsConnuesVues > 0 ? ` | ${videsConnuesVues} toile(s) vide(s) connue(s)` : ""),
	);

	// Un PLANCHER, comme le différentiel Lua : ce relevé doit dire NON quand une régression fait
	// chuter un écran, sans exiger une conformité que le compositeur ne vise pas. Une toile vide
	// DÉJÀ inscrite au fichier de référence est un défaut connu, pas une régression : elle est
	// nommée à chaque passage et n'arrête pas la porte, tandis qu'un écran qui devient vide le
	// fait immédiatement.
	let echec = false;
	if (indisponibles > 0) {
		console.error(`RENDU INDISPONIBLE : ${indisponibles} écran(s) ne répondent pas`);
		echec = true;
	}
	if (videsInattendues > 0) {
		console.error(`TOILE VIDE : ${videsInattendues} écran(s) ne composent plus rien`);
		echec = true;
	}
	if (plancherAtteint < mesurees) {
		console.error(`RÉGRESSION : ${mesurees - plancherAtteint} écran(s) sous leur référence`);
		echec = true;
	}
	if (echec) process.exit(1);
}

await main();
