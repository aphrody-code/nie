import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { assertNePubliePas, publishedLink, resolveBuildOutDir } from "./out-dir";

/**
 * Ces tests visent la VRAIE disposition de la machine, pas une maquette.
 *
 * C'est délibéré : le défaut qu'ils ferment était une coïncidence de chemins — `dist -> dist-web`
 * alors que `dist-web` était aussi la sortie du build — et une maquette l'aurait reproduite
 * seulement si on l'avait déjà comprise. Interrogé sur le disque, le garde répond sur la
 * disposition qui existe réellement ici.
 *
 * Quand `dist` n'est pas un lien (checkout neuf, machine de développement), rien n'est publié et
 * l'invariant n'a pas d'objet : le test le DIT plutôt que de passer en silence.
 */
const lienPublie = (() => {
	try {
		return lstatSync(publishedLink).isSymbolicLink() ? realpathSync(publishedLink) : null;
	} catch {
		return null;
	}
})();

let temporaire: string | null = null;
afterEach(() => {
	if (temporaire) rmSync(temporaire, { recursive: true, force: true });
	temporaire = null;
	delete process.env.NIE_WEB_OUT_DIR;
	delete process.env.NIE_WEB_OUT_DIR;
});

test("un build ordinaire n'écrit jamais dans le bundle servi", () => {
	if (!lienPublie) {
		console.warn(`SKIP: ${publishedLink} n'est pas un lien symbolique — rien n'est publié ici`);
		return;
	}
	expect(resolveBuildOutDir()).not.toBe(lienPublie);
});

test("viser le bundle servi lève, au lieu de l'effacer", () => {
	if (!lienPublie) {
		console.warn(`SKIP: ${publishedLink} n'est pas un lien symbolique — rien n'est publié ici`);
		return;
	}
	// Les deux écritures du même inode : par le lien, et par sa cible résolue. Un garde qui ne
	// comparerait que les chaînes laisserait passer la première.
	expect(() => assertNePubliePas(publishedLink)).toThrow(/bundle SERVI/);
	expect(() => assertNePubliePas(lienPublie)).toThrow(/bundle SERVI/);
});

test("NIE_WEB_OUT_DIR ne contourne pas le garde", () => {
	if (!lienPublie) {
		console.warn(`SKIP: ${publishedLink} n'est pas un lien symbolique — rien n'est publié ici`);
		return;
	}
	process.env.NIE_WEB_OUT_DIR = lienPublie;
	expect(() => resolveBuildOutDir()).toThrow(/bundle SERVI/);
});

test("un répertoire quelconque passe, et `NIE_WEB_OUT_DIR` l'emporte", () => {
	const ailleurs = mkdtempSync(join(tmpdir(), "nie-out-dir-"));
	temporaire = ailleurs;
	expect(() => assertNePubliePas(ailleurs)).not.toThrow();
	process.env.NIE_WEB_OUT_DIR = ailleurs;
	expect(resolveBuildOutDir()).toBe(realpathSync(ailleurs));
});

/**
 * Un chemin qui n'existe PAS encore doit passer : c'est le cas normal du premier build, et un
 * garde qui lèverait là rendrait le dépôt inconstructible sur une machine neuve.
 */
test("un répertoire de sortie encore inexistant est accepté", () => {
	const inexistant = join(tmpdir(), `nie-out-dir-absent-${process.pid}`);
	expect(existsSync(inexistant)).toBe(false);
	expect(() => assertNePubliePas(inexistant)).not.toThrow();
});

/**
 * Le cas que la première version de ce garde CASSAIT, sur une disposition jetable.
 *
 * Sur un checkout ordinaire, `dist` est un vrai répertoire : le premier build le crée, et un
 * garde qui comparerait `realpath(dist)` à lui-même refuserait tous les suivants. Ce qui publie
 * n'est pas le nom `dist`, c'est le fait que ce soit un LIEN — `nie-site` sert à travers lui et
 * le déploiement le fait pivoter. Le test tient les deux moitiés côte à côte.
 */
test("un `dist` répertoire ordinaire ne publie rien, un `dist` lien publie", () => {
	const base = mkdtempSync(join(tmpdir(), "nie-out-dir-layout-"));
	temporaire = base;

	// 1. `dist` est un répertoire ordinaire : réécrire dedans est un build de développement.
	const ordinaire = join(base, "ordinaire");
	mkdirSync(ordinaire, { recursive: true });
	expect(() => assertNePubliePas(ordinaire, ordinaire)).not.toThrow();
	expect(resolveBuildOutDir(ordinaire)).toBe(ordinaire);

	// 2. `dist` est un lien vers un bundle : y écrire effacerait ce qui est servi.
	const bundle = join(base, "bundle");
	mkdirSync(bundle, { recursive: true });
	const lien = join(base, "dist");
	symlinkSync(bundle, lien);
	expect(() => assertNePubliePas(bundle, lien)).toThrow(/bundle SERVI/);
	expect(() => assertNePubliePas(lien, lien)).toThrow(/bundle SERVI/);
	expect(resolveBuildOutDir(lien)).not.toBe(bundle);
});

/** Un lien CASSÉ ne publie rien : faire échouer le build là-dessus n'aiderait personne. */
test("un lien de publication cassé n'empêche pas de bâtir", () => {
	const base = mkdtempSync(join(tmpdir(), "nie-out-dir-casse-"));
	temporaire = base;
	const lien = join(base, "dist");
	symlinkSync(join(base, "version-supprimee"), lien);
	expect(() => assertNePubliePas(join(base, "quelconque"), lien)).not.toThrow();
});
