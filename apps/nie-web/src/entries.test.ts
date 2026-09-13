import { describe, expect, test } from "bun:test";

import { MODES, SECTIONS, menuEntries, recognizedRoutes, sectionEntry } from "./entries";
import { readGameNavigation } from "./game/navigation";

describe("sections", () => {
	test("la fiche d'un mode est portée par l'entrée, pas par le catalogue", () => {
		// `/modes/victory_road` n'est PAS dans la liste des entrées — les slugs vivent côté
		// serveur. Sans `sectionEntry`, `requestedEntry` ne le trouve pas et le site affiche
		// l'accueil sur une adresse que `nie-site` sert : la page existerait pour un moteur et
		// pas pour un visiteur.
		expect(sectionEntry("/modes/victory_road")).toBe("modes/victory_road");
		expect(sectionEntry("/modes/story")).toBe("modes/story");
	});

	test("le préfixe de langue est retiré avant de lire la section", () => {
		// `/ja/modes/story` désigne la même fiche que `/modes/story`, dans une autre langue :
		// comparer sans retirer le préfixe donnerait la section « ja », qui n'existe pas.
		expect(sectionEntry("/ja/modes/story")).toBe("modes/story");
		expect(sectionEntry("/en/modes/victory_road")).toBe("modes/victory_road");
	});

	test("la liste elle-même n'est pas une section", () => {
		// `/modes` est une entrée ordinaire : c'est `requestedEntry` qui la reconnaît.
		expect(sectionEntry("/modes")).toBeNull();
		expect(sectionEntry("/")).toBeNull();
	});

	test("une entrée qui ne sait pas lire un sous-chemin n'en est pas une", () => {
		// Le catalogue des textures n'a pas de fiche par fichier. Traiter `/textures/x` en
		// section rendrait une page vide plutôt que l'accueil.
		expect(sectionEntry("/textures/x")).toBeNull();
		expect(sectionEntry("/inacord/cinema")).toBeNull();
		expect(SECTIONS).toEqual([MODES]);
	});
});

describe("les modes dans le catalogue de l'hôte", () => {
	test("la liste est une adresse reconnue et une tuile", () => {
		expect(recognizedRoutes(null)).toContain(MODES);
		expect(menuEntries(null).map((entry) => entry.route)).toContain(MODES);
	});

	test("arriver directement sur une fiche ouvre la fiche, pas l'accueil", () => {
		// Le cas qui casse en premier : un lien partagé, ou un moteur qui suit le plan du site.
		const navigation = readGameNavigation(
			recognizedRoutes(null),
			{ pathname: "/modes/victory_road" },
			null,
		);
		expect(navigation.view).toBe("modes/victory_road");
		expect(navigation.openingPhase).toBe("menu");
	});

	test("arriver sur la liste ouvre la liste", () => {
		const navigation = readGameNavigation(recognizedRoutes(null), { pathname: "/modes" }, null);
		expect(navigation.view).toBe(MODES);
	});
});
