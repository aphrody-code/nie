/**
 * Le contrat d'URL du gisement **jeu**, confronté au serveur qui le sert.
 *
 * Deux vérifications, et aucune relecture :
 *
 * 1. **chaque route existe vraiment** — on lit `crates/tools/nie-model-serve/src/main.rs` et on
 *    exige d'y trouver la branche de routage correspondante. Une convention d'URL écrite de
 *    mémoire est une convention fausse ; celle-ci se casse le jour où le serveur change ;
 * 2. **la forme produite est exactement celle attendue** — chaînes littérales, pas regex, parce
 *    qu'une URL est une clé de cache et qu'un caractère de différence est un 404.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as jeu from "./jeu.ts";
import { racineDepot } from "./sources.ts";

const SERVEUR = readFileSync(
	join(racineDepot(), "crates", "tools", "nie-model-serve", "src", "main.rs"),
	"utf8",
);

/** Les branches de routage du serveur, telles qu'il les écrit. */
function routeImplementee(route: string): boolean {
	return (
		SERVEUR.includes(`strip_prefix("${route}/")`) ||
		SERVEUR.includes(`strip_prefix("${route}")`) ||
		SERVEUR.includes(`path == "${route}"`)
	);
}

describe("les routes annoncées existent dans nie-model-serve", () => {
	// Une entrée par route que ce module sait construire. Ajouter un constructeur sans ajouter sa
	// route ici laisserait passer une URL que personne ne sert.
	const routes = [
		"/health",
		"/raw",
		"/vfs",
		"/tex",
		"/tex-info",
		"/video",
		"/video/catalog.json",
		"/audio",
		"/audio-info",
		"/cfg",
		"/typed",
		"/export",
		"/model-full",
		"/model-chr",
		"/model-avatar",
		"/model-edit",
		"/model-map",
		"/avatar/catalog.json",
		"/avatar/layout",
		"/avatar/icon",
		"/ui/theme.json",
		"/icons/index.json",
	];

	for (const route of routes) {
		test(route, () => {
			expect(routeImplementee(route)).toBe(true);
		});
	}

	test("`/dx11` et `/g4tx` ne sont PAS des routes du serveur", () => {
		// Elles n'existent que dans nginx (alias disque + `cdn-variants`, puis réécriture vers
		// `/tex/`). Les traiter comme des alias de `/tex/` ferait perdre le redimensionnement
		// `?w=&format=webp`, que `/tex/` ne sait pas faire.
		expect(routeImplementee("/dx11")).toBe(false);
		expect(routeImplementee("/g4tx")).toBe(false);
	});
});

describe("la forme des URL", () => {
	const B = jeu.baseJeu();

	test("le `.g4tx` se retire pour `/tex`, quelle qu'en soit la casse", () => {
		expect(jeu.cheminTexture("data/dx11/chr/x.g4tx")).toBe("/tex/data/dx11/chr/x.png");
		expect(jeu.cheminTexture("data/dx11/chr/x.G4TX")).toBe("/tex/data/dx11/chr/x.png");
		expect(jeu.cheminTexture("data/dx11/chr/x")).toBe("/tex/data/dx11/chr/x.png");
	});

	test("une texture nommée garde le `.g4tx` du conteneur", () => {
		expect(jeu.cheminTextureNommee("dx11/menu/icon_item01.g4tx", "icon_a")).toBe(
			"/tex/dx11/menu/icon_item01.g4tx/icon_a.png",
		);
	});

	test("`/vfs/*` prend son chemin en query, jamais en segment", () => {
		expect(jeu.cheminFiche("data/a b/c.bin")).toBe("/vfs/stat?path=data%2Fa+b%2Fc.bin");
		expect(jeu.cheminListe("data/dx11/menu")).toBe("/vfs/ls?path=data%2Fdx11%2Fmenu&limit=500");
		expect(jeu.cheminRecherche("mark", "g4tx", 20)).toBe("/vfs/find?limit=20&q=mark&ext=g4tx");
		expect(jeu.cheminRecherche("mark")).toBe("/vfs/find?limit=100&q=mark");
	});

	test("`/export` porte le format en query et l'identifiant de sous-entité avec", () => {
		expect(jeu.cheminExport("data/common/a.acb", "wav")).toBe(
			"/export/data/common/a.acb?format=wav",
		);
		expect(jeu.cheminExport("data/common/a.acb", "wav", 12)).toBe(
			"/export/data/common/a.acb?format=wav&id=12",
		);
	});

	test("`/audio` n'ajoute `?id=` que lorsqu'un cue est visé", () => {
		expect(jeu.cheminAudio("data/x.acb")).toBe("/audio/data/x.acb");
		expect(jeu.cheminAudio("data/x.acb", 0)).toBe("/audio/data/x.acb?id=0");
		expect(jeu.cheminAudio("data/x.acb", null)).toBe("/audio/data/x.acb");
	});

	test("une URL absolue est sa base suivie de son chemin", () => {
		expect(jeu.urlFichier("data/a.bin")).toBe(`${B}/raw/data/a.bin`);
		expect(jeu.urlFilm("common/movie/ev01_00050.usm")).toBe(
			`${B}/video/common/movie/ev01_00050.usm`,
		);
		expect(jeu.urlBandeSon("common/movie/ev01_00050.usm")).toBe(
			`${B}/video/common/movie/ev01_00050.usm?track=audio`,
		);
		expect(jeu.urlCatalogueFilms()).toBe(`${B}/video/catalog.json`);
		expect(jeu.urlModeleComplet("c01000010")).toBe(`${B}/model-full/c01000010.glb`);
		expect(jeu.urlModeleChr("waza", "ev60_00340")).toBe(`${B}/model-chr/waza/ev60_00340.glb`);
	});

	test("la base ne garde pas de slash final", () => {
		expect(B.endsWith("/")).toBe(false);
	});
});
