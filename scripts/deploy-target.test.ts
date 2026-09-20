/**
 * Le budget d'une cible doit couvrir ce que cette cible FAIT.
 *
 * `web` a porté une minute pendant toute sa vie, et il n'a jamais rien publié : mesuré le
 * 2026-09-20 sur cet hôte, son `typecheck` prend 21 s, son `vite build` 57 s et la
 * précompression de 480 fichiers plusieurs minutes. `run()` enveloppe chaque étape dans
 * `timeout <reste>s` : la cible mourait en exit 124 au milieu du build, bien avant la bascule
 * du lien. Rien ne le disait — `var/deployments/` n'existait simplement pas.
 *
 * Ces tests n'appellent JAMAIS le script avec un nom de cible : ils ne parlent qu'à `--list`,
 * qui sort avant de prendre le verrou. Déployer depuis une suite de tests publierait.
 */
import { existsSync } from "node:fs";
import { expect, test } from "bun:test";

const script = new URL("./deploy-target.ts", import.meta.url).pathname;

function lister(): string {
	const result = Bun.spawnSync(["bun", script, "--list"], { stderr: "pipe", stdout: "pipe" });
	expect(result.exitCode).toBe(0);
	return new TextDecoder().decode(result.stdout);
}

/** `  web             900s  Browser shell…` → 900 */
function budget(listing: string, cible: string): number {
	const ligne = listing.split("\n").find((l) => l.trim().startsWith(`${cible} `));
	expect(ligne, `aucune ligne pour la cible ${cible}`).toBeDefined();
	const secondes = /\s(\d+)s\s/u.exec(ligne as string)?.[1];
	expect(secondes, `la ligne de ${cible} n'annonce aucun budget : ${ligne}`).toBeDefined();
	return Number(secondes);
}

test("chaque cible annonce son budget", () => {
	const listing = lister();
	for (const cible of ["ffi", "cli", "mcp", "wasm", "web", "inacord", "model", "site", "cron"]) {
		expect(budget(listing, cible)).toBeGreaterThan(0);
	}
});

test("les cibles qui compilent ont un budget de compilation", () => {
	// `buildBinary` ignore son argument de paquet et bâtit les cinq crates du workspace à chaque
	// fois. Une minute ne couvre pas un `cargo build --release` à froid, et ces cinq cibles
	// mouraient donc en exit 124 comme `web`.
	const listing = lister();
	for (const cible of ["ffi", "cli", "mcp", "model", "site"]) {
		expect(budget(listing, cible)).toBeGreaterThanOrEqual(900);
	}
});

test("le budget de `web` couvre un build, pas seulement une bascule", () => {
	// 21 s + 57 s + précompression : une minute ne suffit pas, et la valeur exacte importe moins
	// que le fait qu'elle laisse la place aux trois étapes mesurées.
	expect(budget(lister(), "web")).toBeGreaterThanOrEqual(300);
});

/**
 * Le budget de build et la fenêtre de validation sont DEUX nombres, et les confondre est le
 * défaut que ce fichier ferme : une cible autorisée à bâtir quinze minutes ne doit pas pouvoir
 * servir quinze minutes d'un bundle cassé avant de revenir en arrière.
 */
test("la fenêtre de retour arrière est annoncée, et reste courte", () => {
	const listing = lister();
	const fenetre = /health check (\d+)s later/u.exec(listing)?.[1];
	expect(fenetre, `aucune fenêtre de validation annoncée :\n${listing}`).toBeDefined();
	expect(Number(fenetre)).toBeLessThanOrEqual(60);
	expect(Number(fenetre)).toBeLessThan(budget(listing, "web"));
});

/** Lister ne déploie pas : ni verrou, ni journal, ni répertoire de release. */
test("`--list` ne prend pas le verrou", () => {
	expect(existsSync("/tmp/niers-target-deploy.lock")).toBe(false);
	lister();
	expect(existsSync("/tmp/niers-target-deploy.lock")).toBe(false);
});
