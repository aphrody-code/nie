/// <reference types="bun" />

/**
 * Tests des calculs PURS de la table d'expérience (`exp-table-shared.ts`).
 *
 * Le jeu d'essai reprend les VRAIES valeurs des cinq premiers niveaux de
 * `inagle_exp_table` (miroir SQLite) — 124, 130, 146, 165, 196 — plutôt qu'une
 * suite inventée : les cumuls attendus sont donc vérifiables contre la base.
 * (Repères réels de la table complète, mesurés en base : 100 lignes, niveaux
 * 1→100, cumul Lv1→Lv50 = 182 067, Lv1→Lv100 = 2 878 742.)
 */

import { describe, expect, test } from "bun:test";
import {
	buildExpCurve,
	buildExpTableData,
	clampLevel,
	cumulativeExpToLevel,
	expBetweenLevels,
	formatExp,
	levelFromExp,
	needExpForLevel,
} from "./exp-table-shared";

/** Cinq premiers paliers réels de `inagle_exp_table`. */
const REAL_HEAD = [
	{ level: 1, needExp: 124 },
	{ level: 2, needExp: 130 },
	{ level: 3, needExp: 146 },
	{ level: 4, needExp: 165 },
	{ level: 5, needExp: 196 },
];

const table = buildExpTableData(REAL_HEAD);

describe("buildExpTableData", () => {
	test("établit les bornes réelles et le cumul total", () => {
		expect(table.entries).toHaveLength(5);
		expect(table.minLevel).toBe(1);
		expect(table.maxLevel).toBe(5);
		// Le palier du niveau MAX (196) ne finance aucun passage : 124+130+146+165.
		expect(table.totalExp).toBe(565);
	});

	test("trie par niveau croissant quel que soit l'ordre d'entrée", () => {
		const shuffled = buildExpTableData([...REAL_HEAD].reverse());
		expect(shuffled.entries.map((e) => e.level)).toEqual([1, 2, 3, 4, 5]);
		expect(shuffled.totalExp).toBe(565);
	});

	test("écarte les doublons de niveau et les valeurs inutilisables", () => {
		const dirty = buildExpTableData([
			{ level: 1, needExp: 124 },
			{ level: 1, needExp: 99999 },
			{ level: 2, needExp: 130 },
			{ level: Number.NaN, needExp: 5 },
			{ level: 3, needExp: Number.NaN },
			{ level: -4, needExp: 10 },
		]);
		expect(dirty.entries).toEqual([
			{ level: 1, needExp: 124 },
			{ level: 2, needExp: 130 },
		]);
	});

	test("table vide : aucune valeur fabriquée", () => {
		const empty = buildExpTableData([]);
		expect(empty.entries).toHaveLength(0);
		expect(empty.totalExp).toBe(0);
		expect(empty.minLevel).toBe(0);
		expect(empty.maxLevel).toBe(0);
	});
});

describe("cumulativeExpToLevel", () => {
	test("cumule les paliers précédents, pas celui du niveau visé", () => {
		expect(cumulativeExpToLevel(table, 1)).toBe(0);
		expect(cumulativeExpToLevel(table, 2)).toBe(124);
		expect(cumulativeExpToLevel(table, 3)).toBe(254);
		expect(cumulativeExpToLevel(table, 4)).toBe(400);
		expect(cumulativeExpToLevel(table, 5)).toBe(565);
	});

	test("borne les niveaux hors table", () => {
		expect(cumulativeExpToLevel(table, 0)).toBe(0);
		expect(cumulativeExpToLevel(table, -50)).toBe(0);
		expect(cumulativeExpToLevel(table, 999)).toBe(table.totalExp);
	});
});

describe("expBetweenLevels", () => {
	test("somme les paliers de `from` à `to - 1`", () => {
		expect(expBetweenLevels(table, 2, 4)).toBe(276);
		expect(expBetweenLevels(table, 1, 5)).toBe(565);
		expect(expBetweenLevels(table, 4, 5)).toBe(165);
	});

	test("renvoie 0 quand l'arrivée n'est pas au-dessus du départ", () => {
		expect(expBetweenLevels(table, 3, 3)).toBe(0);
		expect(expBetweenLevels(table, 4, 2)).toBe(0);
	});

	test("borne les deux extrémités sur l'intervalle réel", () => {
		expect(expBetweenLevels(table, -10, 999)).toBe(565);
	});

	test("cumulativeExpToLevel est le cas particulier partant du niveau minimum", () => {
		for (const level of [1, 2, 3, 4, 5]) {
			expect(cumulativeExpToLevel(table, level)).toBe(expBetweenLevels(table, table.minLevel, level));
		}
	});
});

describe("needExpForLevel et clampLevel", () => {
	test("renvoie la valeur brute de la base", () => {
		expect(needExpForLevel(table, 1)).toBe(124);
		expect(needExpForLevel(table, 5)).toBe(196);
	});

	test("renvoie null hors table plutôt qu'une valeur par défaut", () => {
		expect(needExpForLevel(table, 6)).toBeNull();
		expect(needExpForLevel(table, 0)).toBeNull();
	});

	test("clampLevel ramène dans l'intervalle réel", () => {
		expect(clampLevel(table, 0)).toBe(1);
		expect(clampLevel(table, 3)).toBe(3);
		expect(clampLevel(table, 42)).toBe(5);
		expect(clampLevel(table, Number.NaN)).toBe(1);
	});
});

describe("levelFromExp", () => {
	test("aucune expérience : niveau minimum, palier entier restant", () => {
		const r = levelFromExp(table, 0);
		expect(r.level).toBe(1);
		expect(r.expIntoLevel).toBe(0);
		expect(r.expForNextLevel).toBe(124);
		expect(r.expToNextLevel).toBe(124);
		expect(r.progress).toBe(0);
		expect(r.capped).toBe(false);
	});

	test("un point avant le palier : toujours au niveau courant", () => {
		const r = levelFromExp(table, 123);
		expect(r.level).toBe(1);
		expect(r.expIntoLevel).toBe(123);
		expect(r.expToNextLevel).toBe(1);
	});

	test("pile au palier : niveau suivant, compteur remis à zéro", () => {
		const r = levelFromExp(table, 124);
		expect(r.level).toBe(2);
		expect(r.expIntoLevel).toBe(0);
		expect(r.expForNextLevel).toBe(130);
	});

	test("cumuls successifs", () => {
		expect(levelFromExp(table, 253).level).toBe(2);
		expect(levelFromExp(table, 254).level).toBe(3);
		expect(levelFromExp(table, 399).level).toBe(3);
		expect(levelFromExp(table, 400).level).toBe(4);
	});

	test("niveau maximum atteint : plus de palier suivant", () => {
		const r = levelFromExp(table, 565);
		expect(r.level).toBe(5);
		expect(r.capped).toBe(true);
		expect(r.expForNextLevel).toBeNull();
		expect(r.expToNextLevel).toBeNull();
		expect(r.progress).toBe(1);
		expect(r.overflow).toBe(0);
	});

	test("au-delà du cumul total : excédent isolé dans overflow", () => {
		const r = levelFromExp(table, 600);
		expect(r.level).toBe(5);
		expect(r.capped).toBe(true);
		expect(r.overflow).toBe(35);
	});

	test("entrées aberrantes traitées comme zéro", () => {
		for (const bad of [-100, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
			const r = levelFromExp(table, bad);
			expect(r.level).toBe(1);
			expect(r.expIntoLevel).toBe(0);
		}
	});

	test("réciproque exacte de cumulativeExpToLevel sur toute la table", () => {
		for (const entry of table.entries) {
			const cumul = cumulativeExpToLevel(table, entry.level);
			expect(levelFromExp(table, cumul).level).toBe(entry.level);
		}
	});

	test("table vide : pas de niveau inventé", () => {
		const r = levelFromExp(buildExpTableData([]), 5000);
		expect(r.level).toBe(0);
		expect(r.capped).toBe(true);
		expect(r.expForNextLevel).toBeNull();
	});
});

describe("buildExpCurve", () => {
	test("un point par niveau, cumul aligné sur cumulativeExpToLevel", () => {
		const curve = buildExpCurve(table);
		expect(curve).toHaveLength(5);
		for (const point of curve) {
			expect(point.cumulative).toBe(cumulativeExpToLevel(table, point.level));
			const brut = needExpForLevel(table, point.level);
			expect(brut).not.toBeNull();
			expect(point.needExp).toBe(brut as number);
		}
		expect(curve[curve.length - 1]?.cumulative).toBe(table.totalExp);
	});

	test("table vide : courbe vide", () => {
		expect(buildExpCurve(buildExpTableData([]))).toHaveLength(0);
	});
});

describe("formatExp", () => {
	test("sépare les milliers (espaces normalisées : Intl utilise des NBSP étroits)", () => {
		expect(formatExp(2878742).replace(/\s+/g, " ")).toBe("2 878 742");
		expect(formatExp(124)).toBe("124");
	});

	test("valeur non finie repliée sur 0", () => {
		expect(formatExp(Number.NaN)).toBe("0");
	});
});
