/**
 * Ce que ce test protège : la carte est une MESURE, pas une table éditable.
 *
 * Il ne rejoue pas les requêtes HTTP — elles ont été faites une fois, entrée par entrée, et la
 * réponse est recopiée dans `fr`. Il vérifie les invariants qu'une retouche à la main casserait
 * silencieusement : un hash mal formé, une transformation de casse qui ne reproduit pas le
 * libellé, un libellé rangé des deux côtés à la fois.
 */
import { existsSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
	applyTransform,
	findUiText,
	UI_TEXT_MAP,
	UI_TEXT_VARIANTS,
	UI_TEXT_NOT_FOUND,
} from "./ui-text-map";

const HASH = /^0x[0-9a-f]{8}$/;

describe("UI_TEXT_MAP", () => {
	test("chaque entrée porte un hash de la forme que sert /api/v1/text", () => {
		for (const entry of [...UI_TEXT_MAP, ...UI_TEXT_VARIANTS]) {
			expect(entry.hash).toMatch(HASH);
			expect(entry.occurrences.some(o => o.hash === entry.hash && o.family === entry.family)).toBe(true);
			for (const occurrence of entry.occurrences) expect(occurrence.hash).toMatch(HASH);
		}
	});

	test("une correspondance exacte l'est vraiment — le jeu écrit le libellé au caractère près", () => {
		for (const entry of UI_TEXT_MAP) expect(entry.fr).toBe(entry.label);
	});

	test("chaque entrée nomme au moins un endroit qui écrit le libellé à la main", () => {
		for (const entry of [...UI_TEXT_MAP, ...UI_TEXT_VARIANTS]) {
			expect(entry.usedAt.length).toBeGreaterThan(0);
			for (const use of entry.usedAt) expect(use).toMatch(/^(apps|packages)\/.+:\d+$/);
		}
	});

	test("chaque endroit cité existe encore — sinon la carte a pourri", () => {
		// `usedAt` est le seul lien entre la carte et le code qu'elle décrit. Un composant
		// supprimé ou déplacé le rompt sans bruit, et la carte se met à décrire un dépôt qui
		// n'existe plus. 113 fichiers cités au dernier relevé ; le générateur les relit tous,
		// donc régénérer suffit à réparer. Les LIGNES, elles, ne sont pas vérifiées : elles
		// bougent à chaque édition et les exiger rendrait ce test faux en permanence.
		const racine = new URL("../../../../", import.meta.url).pathname;
		const manquants = new Set<string>();
		for (const entry of [...UI_TEXT_MAP, ...UI_TEXT_VARIANTS, ...UI_TEXT_NOT_FOUND]) {
			for (const use of entry.usedAt) {
				const chemin = use.slice(0, use.lastIndexOf(":"));
				if (!existsSync(racine + chemin)) manquants.add(chemin);
			}
		}
		expect([...manquants]).toEqual([]);
	});

	test("aucun libellé n'est rangé dans deux tables à la fois", () => {
		const vus = new Set<string>();
		for (const entry of [...UI_TEXT_MAP, ...UI_TEXT_VARIANTS, ...UI_TEXT_NOT_FOUND]) {
			expect(vus.has(entry.label)).toBe(false);
			vus.add(entry.label);
		}
	});
});

describe("UI_TEXT_VARIANTS", () => {
	test("la transformation déclarée redonne EXACTEMENT le libellé", () => {
		for (const entry of UI_TEXT_VARIANTS) {
			expect(applyTransform(entry.transform, entry.fr)).toBe(entry.label);
		}
	});

	test("une variante n'est jamais une égalité déguisée", () => {
		for (const entry of UI_TEXT_VARIANTS) expect(entry.fr).not.toBe(entry.label);
	});
});

describe("UI_TEXT_NOT_FOUND", () => {
	test("une quasi-correspondance est un VOISIN, jamais le libellé lui-même", () => {
		// Un homonyme fait exception par construction : le jeu écrit bien ce texte, mais dans une
		// famille de noms propres. C'est la famille qui le disqualifie, pas le texte.
		for (const miss of UI_TEXT_NOT_FOUND) {
			if (miss.closest === null || miss.homonymFamilies !== undefined) continue;
			expect(miss.closest).not.toBe(miss.label);
		}
	});

	test("un homonyme cite bien le texte du jeu, qui est identique au libellé", () => {
		for (const miss of UI_TEXT_NOT_FOUND) {
			if (miss.homonymFamilies === undefined) continue;
			expect(miss.closestFamily).not.toBeNull();
			expect(miss.homonymFamilies).toContain(miss.closestFamily as string);
		}
	});

	test("un voisin vient toujours avec l'adresse qui permet de le relire", () => {
		for (const miss of UI_TEXT_NOT_FOUND) {
			if (miss.closest === null) {
				expect(miss.closestFamily).toBeNull();
				expect(miss.closestHash).toBeNull();
				continue;
			}
			expect(miss.closestFamily).not.toBeNull();
			expect(miss.closestHash).toMatch(HASH);
		}
	});

	test("un homonyme nomme les familles de noms propres qui l'ont fait refuser", () => {
		const homonymes = UI_TEXT_NOT_FOUND.filter(miss => miss.homonymFamilies !== undefined);
		expect(homonymes.length).toBeGreaterThan(0);
		for (const miss of homonymes) expect(miss.homonymFamilies?.length).toBeGreaterThan(0);
	});
});

describe("findUiText", () => {
	test("retrouve une entrée des deux tables, et rien d'autre", () => {
		expect(findUiText(UI_TEXT_MAP[0].label)?.hash).toBe(UI_TEXT_MAP[0].hash);
		expect(findUiText(UI_TEXT_VARIANTS[0].label)?.hash).toBe(UI_TEXT_VARIANTS[0].hash);
		expect(findUiText("un libellé que personne n'écrit")).toBeUndefined();
	});
});
