import { describe, expect, test } from "bun:test";
import formationsFull from "../src/data/formations-full.json";
import {
	BENCH_SLOTS,
	FORMATIONS,
	GAME_FORMATIONS,
	LEGACY_FORMATIONS,
	ROLE_COLORS,
	ROLE_LABELS,
	type Formation,
} from "../src/game/formations";

interface RawFormation {
	form_id: string;
	label: string;
	valid: boolean;
	positions: Array<{ position_no: number; role: string; start: { x: number; y: number } }>;
}

const RAW = (formationsFull as { formations: RawFormation[] }).formations;
const RAW_VALID = RAW.filter((formation) => formation.valid);
const ROLES = ["FW", "MF", "DF", "GK"] as const;

/** `DF-MF-FW`, the order in which football labels a formation. */
function lineup(formation: Formation): string {
	const count = (role: string) => formation.positions.filter((position) => position.role === role).length;
	return `${count("DF")}-${count("MF")}-${count("FW")}`;
}

describe("formations", () => {
	test("every formation fields eleven distinct slots with exactly one goalkeeper", () => {
		for (const formation of FORMATIONS) {
			expect(formation.positions).toHaveLength(11);
			const indices = formation.positions.map((position) => position.index).toSorted((a, b) => a - b);
			expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
			expect(formation.positions.filter((position) => position.role === "GK")).toHaveLength(1);
			for (const position of formation.positions) expect(ROLES).toContain(position.role);
		}
	});

	test("each label matches the roles actually placed on the pitch", () => {
		for (const formation of FORMATIONS) expect(lineup(formation)).toBe(formation.label);
	});

	test("ids are unique, and the legacy ids persisted in shared URLs come first", () => {
		const ids = FORMATIONS.map((formation) => formation.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(FORMATIONS.slice(0, LEGACY_FORMATIONS.length)).toEqual(LEGACY_FORMATIONS);
		expect(FORMATIONS.slice(LEGACY_FORMATIONS.length)).toEqual(GAME_FORMATIONS);
		expect(LEGACY_FORMATIONS.map((formation) => formation.id)).toEqual([
			"diamond442",
			"box442",
			"freedom352",
			"triangle433",
			"delta433",
			"balance451",
			"hexa361",
			"double541",
		]);
	});

	test("legacy formations keep the shared goalkeeper slot", () => {
		for (const formation of LEGACY_FORMATIONS) {
			expect(formation.positions.find((position) => position.role === "GK")).toEqual({
				index: 10,
				left: 40,
				role: "GK",
				top: 43,
			});
		}
	});
});

describe("game formations (formations-full.json)", () => {
	test("exactly the valid entries of the export are exposed, in order", () => {
		expect(RAW.length).toBe(115);
		expect(RAW_VALID.length).toBe(83);
		expect(GAME_FORMATIONS.map((formation) => formation.id)).toEqual(
			RAW_VALID.map((formation) => `g_${formation.form_id}`),
		);
	});

	test("valid entries carry only the four known roles, so none falls back to MF", () => {
		for (const formation of RAW_VALID) {
			for (const position of formation.positions) expect(ROLES).toContain(position.role as (typeof ROLES)[number]);
		}
	});

	test("variants of one label are numbered in export order", () => {
		const seen = new Map<string, number>();
		for (const formation of GAME_FORMATIONS) {
			const variant = (seen.get(formation.label) ?? 0) + 1;
			seen.set(formation.label, variant);
			expect(formation.name).toBe(`${formation.label} (jeu) #${variant}`);
		}
	});

	test("game coordinates map onto the portrait pitch and stay inside it", () => {
		for (const [f, formation] of GAME_FORMATIONS.entries()) {
			const raw = RAW_VALID[f]!;
			for (const [p, position] of formation.positions.entries()) {
				const start = raw.positions[p]!.start;
				expect(position.index).toBe(raw.positions[p]!.position_no);
				expect(position.top).toBeCloseTo(Math.max(1, Math.min(46, 43.75 * start.y + 2)), 10);
				expect(position.left).toBeCloseTo(Math.max(1, Math.min(80, 40 + start.x * 47)), 10);
				expect(position.top).toBeGreaterThanOrEqual(1);
				expect(position.top).toBeLessThanOrEqual(46);
				expect(position.left).toBeGreaterThanOrEqual(1);
				expect(position.left).toBeLessThanOrEqual(80);
			}
		}
	});

	test("the goalkeeper of the first export entry sits centred on its own goal line", () => {
		const keeper = GAME_FORMATIONS[0]!.positions.find((position) => position.role === "GK")!;
		// start = (0.0, 0.96f32): 43.75 × 0.9599999785 + 2 = 43.99999906.
		expect(keeper.left).toBe(40);
		expect(keeper.top).toBeCloseTo(44, 5);
	});
});

describe("role and bench tables", () => {
	test("every role has a colour and a label", () => {
		for (const role of ROLES) {
			expect(ROLE_COLORS[role]).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
			expect(ROLE_LABELS[role]?.length).toBe(3);
		}
	});

	test("bench slots match the zukan team sheet: 1 manager, 5 reserves, 3 supports", () => {
		expect(BENCH_SLOTS).toEqual({ manager: 1, reserves: 5, support: 3 });
	});
});
