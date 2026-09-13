/**
 * Ce que ce test protège : la substitution n'affiche JAMAIS moins que ce qui était écrit.
 *
 * Le risque de ce module n'est pas de mal traduire — il ne traduit pas — mais de remplacer un
 * libellé par du vide, par une ligne ambiguë, ou par la mauvaise moitié d'un hash partagé. Les
 * cas ci-dessous sont exactement les trois portes de sortie du code.
 */
import { describe, expect, test } from "bun:test";

import { fetchGameText, gameText, mappedRefs, needsCatalogue, refKey } from "./game-text";
import { GAME_LOCALES } from "./settings";
import { UI_TEXT_MAP, UI_TEXT_VARIANTS } from "./ui-text-map";

const exemple = UI_TEXT_MAP[0];
const variante = UI_TEXT_VARIANTS[0];

describe("gameText", () => {
	test("rend le texte du jeu quand le lot a résolu la référence", () => {
		const catalogue = new Map([[refKey(exemple.family, exemple.hash), ["Back"]]]);
		expect(gameText(catalogue, exemple.label)).toBe("Back");
	});

	test("applique la transformation déclarée par une variante", () => {
		const catalogue = new Map([[refKey(variante.family, variante.hash), [variante.fr]]]);
		expect(gameText(catalogue, variante.label)).toBe(variante.label);
	});

	test("garde le libellé tant que le lot n'a pas répondu", () => {
		expect(gameText(undefined, exemple.label)).toBe(exemple.label);
	});

	test("garde le libellé quand la référence n'a rien rendu", () => {
		expect(gameText(new Map(), exemple.label)).toBe(exemple.label);
		const vide = new Map([[refKey(exemple.family, exemple.hash), []]]);
		expect(gameText(vide, exemple.label)).toBe(exemple.label);
	});

	test("garde le libellé quand le hash porte DEUX lignes différentes", () => {
		// Trancher reviendrait à deviner : sans mise en page native, rien ne désigne l'une.
		const ambigu = new Map([[refKey(exemple.family, exemple.hash), ["Back", "Return"]]]);
		expect(gameText(ambigu, exemple.label)).toBe(exemple.label);
	});

	test("accepte un hash rendu plusieurs fois avec le MÊME texte", () => {
		const doublon = new Map([[refKey(exemple.family, exemple.hash), ["Back", "Back"]]]);
		expect(gameText(doublon, exemple.label)).toBe("Back");
	});

	test("laisse intact un libellé que la carte ne connaît pas", () => {
		expect(gameText(new Map(), "un libellé que le jeu n'écrit pas")).toBe(
			"un libellé que le jeu n'écrit pas",
		);
	});
});

describe("mappedRefs", () => {
	test("ne demande jamais deux fois la même référence", () => {
		const refs = mappedRefs();
		const cles = new Set(refs.map(ref => refKey(ref.family, ref.hash)));
		expect(cles.size).toBe(refs.length);
	});

	test("tient dans le plafond de la route GraphQL", () => {
		// `MAX_REFS` vaut 512 dans `crates/tools/nie-site/src/routes/graphql.rs` ; dépasser ce
		// nombre ferait échouer le lot entier, donc l'écran repasserait au texte en dur.
		expect(mappedRefs().length).toBeLessThanOrEqual(512);
	});

	test("couvre chaque entrée de la carte", () => {
		const cles = new Set(mappedRefs().map(ref => refKey(ref.family, ref.hash)));
		for (const entry of [...UI_TEXT_MAP, ...UI_TEXT_VARIANTS]) {
			expect(cles.has(refKey(entry.family, entry.hash))).toBe(true);
		}
	});
});

describe("useGameTextCatalogue", () => {
	test("ne demande RIEN dans la langue où la carte a été mesurée", () => {
		// La carte ne retient que des libellés dont le français est identique au texte écrit
		// dans le composant : en français la requête n'afficherait aucune différence, et c'est
		// la langue par défaut du site.
		expect(needsCatalogue("fr")).toBe(false);
	});

	test("demande le catalogue dans toutes les autres langues du jeu", () => {
		for (const locale of GAME_LOCALES) {
			expect(needsCatalogue(locale)).toBe(locale !== "fr");
		}
	});
});

describe("fetchGameText", () => {
	test("envoie UNE requête et indexe la réponse par référence", async () => {
		const appels: { url: string; body: unknown }[] = [];
		const origine = globalThis.fetch;
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			appels.push({ url: String(url), body: JSON.parse(String(init?.body)) });
			return new Response(
				JSON.stringify({ data: { texts: [{ family: "menu_text", hash: "0X8ACE28FB", texts: ["Back"] }] } }),
				{ status: 200 },
			);
		}) as typeof fetch;
		try {
			const resolved = await fetchGameText("en", [{ family: "menu_text", hash: "0x8ace28fb" }]);
			expect(appels).toHaveLength(1);
			expect(appels[0].url).toBe("/api/v1/graphql");
			// La clé est insensible à la casse du hash : le serveur normalise, le client aussi.
			expect(resolved.get("menu_text/0x8ace28fb")).toEqual(["Back"]);
		} finally {
			globalThis.fetch = origine;
		}
	});

	test("une réponse en erreur remonte, pour que l'appelant retombe sur le texte en dur", () => {
		const origine = globalThis.fetch;
		globalThis.fetch = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
		try {
			expect(fetchGameText("en", [])).rejects.toThrow("503");
		} finally {
			globalThis.fetch = origine;
		}
	});
});
