import { describe, expect, test } from "bun:test";

import {
	localeFromPrefix,
	pathForEntry,
	prefixForLocale,
	requestedEntry,
	splitLanguagePrefix,
} from "./routing";

const ENTREES = [
	"textures",
	"modeles",
	"sons",
	"videos",
	"explorateur",
	"avatar",
	"settings",
] as const;

describe("localeFromPrefix / prefixForLocale", () => {
	test("les trois langues, aller et retour", () => {
		expect(localeFromPrefix("")).toBe("fr");
		expect(localeFromPrefix("/en")).toBe("en");
		expect(localeFromPrefix("/ja")).toBe("ja");
		for (const locale of ["fr", "en", "ja"] as const) {
			expect(localeFromPrefix(prefixForLocale(locale))).toBe(locale);
		}
	});

	test("changer de langue depuis les Options est un chemin servi", () => {
		// C'est ce que la page `/settings` assigne quand « Appliquer » a changé la langue.
		expect(pathForEntry(prefixForLocale("ja"), "settings")).toBe("/ja/settings");
		expect(pathForEntry(prefixForLocale("fr"), "settings")).toBe("/settings");
		expect(splitLanguagePrefix("/ja/settings")).toEqual({
			prefix: "/ja",
			route: "/settings",
		});
	});
});

describe("splitLanguagePrefix", () => {
	test("le français n'a pas de préfixe", () => {
		expect(splitLanguagePrefix("/")).toEqual({ prefix: "", route: "/" });
		expect(splitLanguagePrefix("/textures")).toEqual({ prefix: "", route: "/textures" });
	});

	test("les deux autres langues sont un segment", () => {
		expect(splitLanguagePrefix("/en/textures")).toEqual({ prefix: "/en", route: "/textures" });
		expect(splitLanguagePrefix("/ja/sons")).toEqual({ prefix: "/ja", route: "/sons" });
		// La racine d'une langue, sans barre finale.
		expect(splitLanguagePrefix("/ja")).toEqual({ prefix: "/ja", route: "/" });
	});

	test("une route qui commence par les mêmes lettres n'est pas une langue", () => {
		// Comparer sur les caractères et non sur le segment enverrait `/enemy` en anglais avec
		// une route tronquée à `emy` — une page introuvable, sans message.
		expect(splitLanguagePrefix("/enemy")).toEqual({ prefix: "", route: "/enemy" });
		expect(splitLanguagePrefix("/january")).toEqual({ prefix: "", route: "/january" });
	});
});

describe("requestedEntry", () => {
	// Le seul champ lu est le chemin. Le type l'impose désormais : la compatibilité `?vue=`
	// a été retirée, et un test qui passerait encore une chaîne de requête ne compilerait pas.
	const location = (pathname: string) => ({ pathname });

	test("le chemin fait foi", () => {
		expect(requestedEntry(ENTREES, location("/textures"))).toBe("textures");
		expect(requestedEntry(ENTREES, location("/ja/videos"))).toBe("videos");
		expect(requestedEntry(ENTREES, location("/en/explorateur"))).toBe("explorateur");
		expect(requestedEntry(ENTREES, location("/settings"))).toBe("settings");
		expect(requestedEntry(ENTREES, location("/ja/settings"))).toBe("settings");
	});

	test("l'accueil ne désigne aucune entrée", () => {
		expect(requestedEntry(ENTREES, location("/"))).toBeNull();
		expect(requestedEntry(ENTREES, location("/ja"))).toBeNull();
	});

	test("une route inconnue ne désigne aucune entrée", () => {
		expect(requestedEntry(ENTREES, location("/inexistante"))).toBeNull();
	});

	test("la route annoncée par le serveur sert de repli", () => {
		// `data-route` est déjà séparé de sa langue par nie-site : il fait autorité quand le
		// chemin vu par le client a été réécrit en amont.
		expect(requestedEntry(ENTREES, location("/"), "/modeles")).toBe("modeles");
		// Mais il ne prime pas sur un chemin qui désigne déjà une entrée.
		expect(requestedEntry(ENTREES, location("/sons"), "/modeles")).toBe("sons");
	});
});

describe("pathForEntry", () => {
	test("compose le chemin canonique", () => {
		expect(pathForEntry("", "textures")).toBe("/textures");
		expect(pathForEntry("/ja", "textures")).toBe("/ja/textures");
		expect(pathForEntry("/en", "explorateur")).toBe("/en/explorateur");
	});

	test("aller et retour", () => {
		// Ce que l'on écrit dans l'URL doit être ce que l'on y relit.
		for (const prefix of ["", "/en", "/ja"]) {
			for (const entry of ENTREES) {
				const path = pathForEntry(prefix, entry);
				expect(splitLanguagePrefix(path).prefix).toBe(prefix);
				expect(requestedEntry(ENTREES, { pathname: path })).toBe(entry);
			}
		}
	});
});
