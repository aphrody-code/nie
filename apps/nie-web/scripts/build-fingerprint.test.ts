/**
 * Le bundle doit être empreinté d'une façon que `nie-site` RECONNAÎT.
 *
 * Les deux moitiés de cette règle vivent dans deux langages, et c'est exactement pourquoi elle
 * s'est cassée en silence : `nie_site::routes::static_files::empreinte` découpe un nom sur `-`
 * et `.`, tandis que rollup empreinte en base64url — un alphabet qui contient `-`. Rien ne
 * plante : le fichier est simplement servi `no-cache` au lieu d'`immutable`, et seul un en-tête
 * de réponse le dit. Mesuré le 2026-09-20 sur un bundle réel, 30 des 252 fichiers émis étaient
 * dans ce cas, point d'entrée compris.
 *
 * Le premier test tient la config ; le second interroge un vrai bundle quand il y en a un.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { createFrontendConfig } from "../vite.config";

/**
 * Réplique de `nie_site::routes::static_files::empreinte` (`crates/tools/nie-site`).
 *
 * Une duplication assumée : l'original est en Rust et ne s'appelle pas depuis Bun. Elle est
 * tenue honnête par les tests de l'original, qui portent les mêmes cas mesurés.
 */
function empreinte(nom: string): boolean {
	return nom
		.split(/[-.]/)
		.slice(1)
		.some((segment) => {
			if (segment.length < 8 || segment.length > 40) return false;
			if (/^[0-9a-fA-F]+$/.test(segment)) return true;
			if (!/^[0-9A-Za-z_]+$/.test(segment)) return false;
			return /[0-9]/.test(segment) || (/[A-Z]/.test(segment) && /[a-z]/.test(segment));
		});
}

test("la réplique de `empreinte` reproduit les cas mesurés", () => {
	// Si cette duplication dérive de l'original, le balayage ci-dessous mesure autre chose que
	// ce que le serveur fait. Ces cinq cas sont ceux du test Rust `base64url_a_deux_trous…`.
	expect(empreinte("Workspace-FpvT45-W.js")).toBe(false);
	expect(empreinte("index-QCGMVBRT.js")).toBe(false);
	expect(empreinte("objective-c-BDtDVThU.js")).toBe(true);
	expect(empreinte("index-4f3a9c1e.js")).toBe(true);
	expect(empreinte("index.html")).toBe(false);
});

test("le build du site empreinte en hexadécimal", () => {
	const config = createFrontendConfig({ command: "build", mode: "production" });
	const output = config.build?.rollupOptions?.output;
	expect(Array.isArray(output)).toBe(false);
	expect((output as { hashCharacters?: string } | undefined)?.hashCharacters).toBe("hex");
});

/**
 * Le vrai gage : les noms RÉELLEMENT émis, et non ce que la config promet.
 *
 * Les copies de `public/` sont exclues — elles portent un nom stable À DESSEIN, et les servir
 * `immutable` a déjà causé une panne (cf. `immuable` côté Rust). Le test ne juge donc que ce
 * que le bundler a émis lui-même.
 */
test("tout ce que le bundler émet est reconnu comme empreinté", () => {
	const appRoot = fileURLToPath(new URL("..", import.meta.url));
	const publics = new Set(
		(() => {
			const racine = join(appRoot, "public");
			try {
				return lister(racine).map((p) => relative(racine, p));
			} catch {
				return [];
			}
		})(),
	);
	const bundle = join(appRoot, process.env.NIERS_WEB_BUNDLE ?? "dist-build");
	let fichiers: string[];
	try {
		fichiers = lister(bundle).map((p) => relative(bundle, p));
	} catch {
		console.warn(`SKIP: aucun bundle en ${bundle} — bâtir avec \`bun run --filter nie-web build\``);
		return;
	}
	const emis = fichiers.filter(
		(p) =>
			p.startsWith("static/") &&
			!p.endsWith(".br") &&
			!p.endsWith(".zst") &&
			!publics.has(p),
	);
	expect(emis.length).toBeGreaterThan(0);
	const sans = emis.filter((p) => !empreinte(p.split("/").pop() as string));
	expect(sans).toEqual([]);
});

function lister(racine: string, accumulateur: string[] = []): string[] {
	for (const entree of readdirSync(racine)) {
		const chemin = join(racine, entree);
		if (statSync(chemin).isDirectory()) lister(chemin, accumulateur);
		else accumulateur.push(chemin);
	}
	return accumulateur;
}
