/**
 * Règles de jeu PURES (`src/game`) — formations réelles décodées, recalcul de
 * stats de membre, synergies d'élément, genre, cut-ins.
 *
 * Les formations proviennent de `data/formations-full.json` (coordonnées f32
 * byte-exactes décodées par niers) : les tests valident l'intégrité de ce jeu de
 * données embarqué, pas un échantillon inventé.
 */

import { describe, expect, test } from "bun:test";

import {
	BENCH_SLOTS,
	calculateElementSynergies,
	cutinHasAssets,
	FORMATIONS,
	GAME_FORMATIONS,
	getPositionMatchFactor,
	getSkillCutin,
	isFemaleGender,
	isMaleGender,
	normalizeGender,
	recalculateMemberStats,
	ROLE_COLORS,
	ROLE_LABELS,
	TEAM_EMBLEM_MAP,
	type Formation,
	type TeamMember,
} from "../src/game/index";

const formation = FORMATIONS[0] as Formation;

describe("formations — jeu de données embarqué", () => {
	test("83 formations réelles + les 8 legacy, ids uniques", () => {
		expect(GAME_FORMATIONS.length).toBe(83);
		expect(FORMATIONS.length).toBe(GAME_FORMATIONS.length + 8);
		// Les formations décodées du jeu sont préfixées `g_` (id = hash du dump).
		expect(GAME_FORMATIONS.every((f) => f.id.startsWith("g_"))).toBe(true);
		// Convention d'index du GK, par famille.
		expect(GAME_FORMATIONS.every((f) => f.positions.find((p) => p.role === "GK")?.index === 0)).toBe(true);
		expect(
			FORMATIONS.slice(0, 8).every((f) => f.positions.find((p) => p.role === "GK")?.index === 10),
		).toBe(true);
		// Les legacy restent en tête : l'index 0 est un id historiquement persisté.
		expect(FORMATIONS[0]?.id).toBe("diamond442");
		expect(new Set(FORMATIONS.map((f) => f.id)).size).toBe(FORMATIONS.length);
	});

	test("chaque formation a 11 positions dont exactement un GK", () => {
		for (const f of FORMATIONS) {
			expect(f.positions).toHaveLength(11);
			expect(f.name.length).toBeGreaterThan(0);
			expect(f.label.length).toBeGreaterThan(0);
			const gks = f.positions.filter((p) => p.role === "GK");
			expect(gks).toHaveLength(1);
			// Les 8 formations legacy placent le GK en index 10 ; les 83 formations
			// réelles décodées du jeu le placent en index 0 (ordre byte-exact du
			// dump). Les deux conventions coexistent — l'index n'est significatif
			// qu'à l'intérieur d'une formation.
			expect([0, 10]).toContain(gks[0]?.index);
			// Index 0..10 uniques.
			expect(new Set(f.positions.map((p) => p.index)).size).toBe(11);
			for (const p of f.positions) {
				expect(p.index).toBeGreaterThanOrEqual(0);
				expect(p.index).toBeLessThanOrEqual(10);
				expect(["FW", "MF", "DF", "GK"]).toContain(p.role);
				// Coordonnées en pourcentage du terrain portrait.
				expect(Number.isFinite(p.top)).toBe(true);
				expect(Number.isFinite(p.left)).toBe(true);
				expect(p.left).toBeGreaterThanOrEqual(-10);
				expect(p.left).toBeLessThanOrEqual(110);
			}
		}
	});

	test("constantes d'UI cohérentes avec les rôles", () => {
		expect(BENCH_SLOTS.reserves).toBeGreaterThan(0);
		for (const role of ["FW", "MF", "DF", "GK"]) {
			expect(ROLE_LABELS[role]).toBeString();
			expect(ROLE_COLORS[role]).toBeString();
		}
	});
});

describe("team-rules — getPositionMatchFactor", () => {
	test("poste identique = facteur plein", () => {
		expect(getPositionMatchFactor("GK", "field-10", formation)).toEqual({
			factor: 1.0,
			status: "match",
		});
	});

	test("MF est adjacent à FW et DF (0.85), et réciproquement", () => {
		const slotFW = formation.positions.find((p) => p.role === "FW")!.index;
		const slotMF = formation.positions.find((p) => p.role === "MF")!.index;
		const slotDF = formation.positions.find((p) => p.role === "DF")!.index;
		expect(getPositionMatchFactor("MF", `field-${slotFW}`, formation).status).toBe("adjacent");
		expect(getPositionMatchFactor("MF", `field-${slotFW}`, formation).factor).toBeCloseTo(0.85);
		expect(getPositionMatchFactor("MF", `field-${slotDF}`, formation).status).toBe("adjacent");
		expect(getPositionMatchFactor("FW", `field-${slotMF}`, formation).status).toBe("adjacent");
		expect(getPositionMatchFactor("DF", `field-${slotMF}`, formation).status).toBe("adjacent");
	});

	test("FW↔DF et GK hors de son slot = mismatch (0.65)", () => {
		const slotFW = formation.positions.find((p) => p.role === "FW")!.index;
		const slotDF = formation.positions.find((p) => p.role === "DF")!.index;
		const res = getPositionMatchFactor("GK", `field-${slotFW}`, formation);
		expect(res.status).toBe("mismatch");
		expect(res.factor).toBeCloseTo(0.65);
		// FW et DF ne sont PAS adjacents (seul MF fait le pont).
		expect(getPositionMatchFactor("FW", `field-${slotDF}`, formation).status).toBe("mismatch");
		expect(getPositionMatchFactor("DF", `field-${slotFW}`, formation).status).toBe("mismatch");
	});

	test("banc / manager / soutien ne subissent aucune pénalité", () => {
		for (const slot of ["reserve-1", "manager-0", "support-2"]) {
			expect(getPositionMatchFactor("GK", slot, formation)).toEqual({ factor: 1.0, status: "match" });
		}
	});

	test("entrée incomplète ou slot inconnu → aucun effet", () => {
		expect(getPositionMatchFactor("", "field-0", formation).status).toBe("none");
		expect(getPositionMatchFactor("FW", "", formation).status).toBe("none");
		expect(getPositionMatchFactor("FW", "field-99", formation).status).toBe("none");
	});
});

describe("team-rules — recalculateMemberStats", () => {
	/** Membre de test à stats plates : les facteurs sont directement lisibles. */
	function membre(position = "FW", element = "Fire"): TeamMember {
		return {
			element,
			position,
			stats: {
				agility: 100,
				control: 100,
				intelligence: 100,
				kick: 100,
				physical: 100,
				pressure: 100,
				technique: 100,
			},
		} as TeamMember;
	}

	test("le niveau 99 restitue les stats pleines, le niveau 1 en rend 20 %", () => {
		const lv99 = recalculateMemberStats(membre(), 99, "field-0", formation);
		expect(lv99.kick).toBe(100);
		expect(lv99.combatPower).toBe(700);
		const lv1 = recalculateMemberStats(membre(), 1, "field-0", formation);
		expect(lv1.kick).toBe(20);
		expect(lv1.combatPower).toBe(140);
	});

	test("un poste inadapté réduit les stats", () => {
		const bonPoste = recalculateMemberStats(membre("FW"), 99, "field-0", formation);
		const mauvaisPoste = recalculateMemberStats(membre("GK"), 99, "field-0", formation);
		expect(mauvaisPoste.kick).toBeLessThan(bonPoste.kick);
		expect(mauvaisPoste.kick).toBe(65);
	});

	test("élément dominant (+5 %) et harmonie (+3 %) se cumulent", () => {
		const base = recalculateMemberStats(membre(), 99, "field-0", formation);
		const dominant = recalculateMemberStats(membre(), 99, "field-0", formation, "Fire");
		const cumul = recalculateMemberStats(membre(), 99, "field-0", formation, "Fire", true);
		expect(dominant.kick).toBeGreaterThan(base.kick);
		expect(cumul.kick).toBeGreaterThan(dominant.kick);
		expect(cumul.kick).toBe(Math.round(100 * 1.05 * 1.03));
		// Un élément dominant différent n'apporte rien.
		expect(recalculateMemberStats(membre(), 99, "field-0", formation, "Wind").kick).toBe(base.kick);
	});

	test("un membre sans stats ne plante pas (tout à zéro)", () => {
		const vide = recalculateMemberStats({ element: "Fire", position: "FW" } as TeamMember, 99, "field-0", formation);
		expect(vide.combatPower).toBe(0);
	});

	test("combatPower = somme des 7 stats recalculées", () => {
		const res = recalculateMemberStats(membre(), 50, "field-0", formation);
		const somme =
			res.kick + res.control + res.technique + res.pressure + res.physical + res.agility + res.intelligence;
		expect(res.combatPower).toBe(somme);
	});
});

describe("team-rules — calculateElementSynergies", () => {
	/** Construit un effectif de terrain à élément unique. */
	function effectif(nb: number, element: string): Record<string, TeamMember> {
		const out: Record<string, TeamMember> = {};
		for (let i = 0; i < nb; i++) {
			out[`field-${i}`] = { element, position: "FW" } as TeamMember;
		}
		return out;
	}

	test("4 joueurs du même élément déclenchent l'élément dominant", () => {
		expect(calculateElementSynergies(effectif(3, "Fire"), formation).dominantElement).toBeNull();
		const res = calculateElementSynergies(effectif(4, "Fire"), formation);
		expect(res.dominantElement).toBe("Fire");
		expect(Array.isArray(res.links)).toBe(true);
	});

	test("les liens relient des slots réels de la formation", () => {
		const res = calculateElementSynergies(effectif(6, "Fire"), formation);
		for (const link of res.links) {
			expect(link.slotA).toStartWith("field-");
			expect(link.slotB).toStartWith("field-");
			expect(link.slotA).not.toBe(link.slotB);
			expect(link.element).toBe("Fire");
			expect(Number.isFinite(link.coordA.top)).toBe(true);
			expect(Number.isFinite(link.coordB.left)).toBe(true);
		}
	});

	test("un effectif vide n'a ni dominant ni harmonie", () => {
		const res = calculateElementSynergies({}, formation);
		expect(res.dominantElement).toBeNull();
		expect(res.hasHarmony).toBe(false);
		expect(res.links).toHaveLength(0);
	});

	test("les remplaçants ne comptent pas dans la synergie de terrain", () => {
		const bench: Record<string, TeamMember> = {};
		for (let i = 0; i < 6; i++) bench[`reserve-${i}`] = { element: "Fire", position: "FW" } as TeamMember;
		expect(calculateElementSynergies(bench, formation).dominantElement).toBeNull();
	});
});

describe("gender — normalisation du genre", () => {
	test("féminin : 1, 'F', 'Female', '1'", () => {
		for (const value of [1, "F", "f", "Female", "female", "1"]) {
			expect(isFemaleGender(value)).toBe(true);
			expect(normalizeGender(value)).toBe(1);
		}
	});

	test("masculin : 0, 'M', 'Male', '0'", () => {
		for (const value of [0, "M", "m", "Male", "male", "0"]) {
			expect(isMaleGender(value)).toBe(true);
			expect(isFemaleGender(value)).toBe(false);
			expect(normalizeGender(value)).toBe(0);
		}
	});

	test("valeur absente → masculin par défaut (jamais féminin par accident)", () => {
		for (const value of [null, undefined]) {
			expect(isFemaleGender(value)).toBe(false);
			expect(isMaleGender(value)).toBe(true);
			expect(normalizeGender(value)).toBe(0);
		}
	});

	test("valeur inconnue → ni masculin ni féminin, normalisée à 0", () => {
		expect(isFemaleGender("inconnu")).toBe(false);
		expect(isMaleGender("inconnu")).toBe(false);
		expect(normalizeGender("inconnu")).toBe(0);
	});
});

describe("skills-cutin + team-emblem-map — données embarquées", () => {
	test("getSkillCutin résout une technique réelle et rejette l'inconnu", () => {
		const cutin = getSkillCutin("whs01230");
		expect(cutin).not.toBeNull();
		expect(cutin?.cutin).toBeObject();
		expect(getSkillCutin("technique-inexistante")).toBeNull();
	});

	test("cutinHasAssets est faux sans identifiant d'événement", () => {
		expect(cutinHasAssets(null)).toBe(false);
		expect(cutinHasAssets(undefined)).toBe(false);
		expect(cutinHasAssets("")).toBe(false);
	});

	test("TEAM_EMBLEM_MAP est peuplé et sans valeur vide", () => {
		const entries = Object.entries(TEAM_EMBLEM_MAP);
		expect(entries.length).toBeGreaterThan(50);
		for (const [team, emblem] of entries) {
			expect(team.length).toBeGreaterThan(0);
			expect(emblem.length).toBeGreaterThan(0);
		}
	});
});
