import { describe, expect, it } from "vitest";
import {
	type CharacterGrowthParams,
	calculateSingleStat,
	calculateStats,
	calculateTotalPower,
	type GrowthTables,
	generateGrowthCurve,
	rarityToGrowthRank,
	type StatBlock,
} from "./stat-calculator.js";

describe("rarityToGrowthRank", () => {
	it("should map N rarity to rank 0", () => {
		expect(rarityToGrowthRank(0)).toBe(0);
	});

	it("should map R rarity to rank 2", () => {
		expect(rarityToGrowthRank(2)).toBe(2);
	});

	it("should map SR rarity to rank 3", () => {
		expect(rarityToGrowthRank(3)).toBe(3);
	});

	it("should map SSR rarity to rank 4", () => {
		expect(rarityToGrowthRank(4)).toBe(4);
	});

	it("should map UR rarity to rank 5", () => {
		expect(rarityToGrowthRank(5)).toBe(5);
	});

	it("should map LR rarity to rank 5 (uses UR stats)", () => {
		expect(rarityToGrowthRank(6)).toBe(5);
	});

	it("should map Legend rarity to rank 5", () => {
		expect(rarityToGrowthRank(7)).toBe(5);
	});

	it("should map BASARA rarity to rank 5", () => {
		expect(rarityToGrowthRank(20)).toBe(5);
	});
});

describe("calculateSingleStat", () => {
	it("should return stat1 for level < 1", () => {
		expect(calculateSingleStat(0, 10, 30, 50, 100)).toBe(10);
		expect(calculateSingleStat(-5, 10, 30, 50, 100)).toBe(10);
	});

	it("should return stat1 at level 1", () => {
		expect(calculateSingleStat(1, 10, 30, 50, 100)).toBe(10);
	});

	it("should return stat30 at level 30", () => {
		expect(calculateSingleStat(30, 10, 30, 50, 100)).toBe(30);
	});

	it("should return stat50 at level 50", () => {
		expect(calculateSingleStat(50, 10, 30, 50, 100)).toBe(50);
	});

	it("should return stat99 at level 99", () => {
		expect(calculateSingleStat(99, 10, 30, 50, 100)).toBe(100);
	});

	it("should return stat99 for level >= 99", () => {
		expect(calculateSingleStat(100, 10, 30, 50, 100)).toBe(100);
		expect(calculateSingleStat(150, 10, 30, 50, 100)).toBe(100);
	});

	it("should interpolate linearly between level 1 and 30", () => {
		// Level 15 is halfway between 1 and 30 (index-wise)
		// t = (15 - 1) / 29 ≈ 0.483
		const result = calculateSingleStat(15, 10, 30, 50, 100);
		expect(result).toBeGreaterThan(10);
		expect(result).toBeLessThan(30);
	});

	it("should interpolate linearly between level 30 and 50", () => {
		// Level 40 is halfway between 30 and 50
		const result = calculateSingleStat(40, 10, 30, 50, 100);
		expect(result).toBeGreaterThan(30);
		expect(result).toBeLessThan(50);
	});

	it("should interpolate linearly between level 50 and 99", () => {
		// Level 75 is roughly halfway between 50 and 99
		const result = calculateSingleStat(75, 10, 30, 50, 100);
		expect(result).toBeGreaterThan(50);
		expect(result).toBeLessThan(100);
	});
});

describe("calculateTotalPower", () => {
	it("should sum all stats", () => {
		const stats: StatBlock = {
			Kc: 10,
			Cr: 20,
			Tc: 30,
			Pr: 40,
			Ps: 50,
			Ag: 60,
			It: 70,
		};
		expect(calculateTotalPower(stats)).toBe(280);
	});

	it("should handle zero stats", () => {
		const stats: StatBlock = {
			Kc: 0,
			Cr: 0,
			Tc: 0,
			Pr: 0,
			Ps: 0,
			Ag: 0,
			It: 0,
		};
		expect(calculateTotalPower(stats)).toBe(0);
	});
});

describe("calculateStats", () => {
	const mockTables: GrowthTables = {
		lv1: [
			{
				mainPosition: 1,
				subPosition: 1,
				playStyle: 0,
				Kc_1: 10,
				Cr_1: 15,
				Tc_1: 12,
				Pr_1: 20,
				Ps_1: 18,
				Ag_1: 14,
				It_1: 16,
			},
		],
		lv30: [
			{
				mainPosition: 1,
				subPosition: 1,
				growthPattern: 0,
				charaRank: 5,
				Kc_30: 30,
				Cr_30: 35,
				Tc_30: 32,
				Pr_30: 40,
				Ps_30: 38,
				Ag_30: 34,
				It_30: 36,
			},
		],
		main: [
			{
				mainPosition: 1,
				growthPattern: 0,
				charaRank: 5,
				Kc_50: 50,
				Cr_50: 55,
				Tc_50: 52,
				Pr_50: 60,
				Ps_50: 58,
				Ag_50: 54,
				It_50: 56,
				Kc_99: 100,
				Cr_99: 105,
				Tc_99: 102,
				Pr_99: 110,
				Ps_99: 108,
				Ag_99: 104,
				It_99: 106,
			},
		],
	};

	const params: CharacterGrowthParams = {
		mainPosition: 1,
		subPosition: 1,
		growthPattern: 0,
		charaRank: 5,
		playStyle: 0,
	};

	it("should calculate stats at level 1", () => {
		const stats = calculateStats(mockTables, params, 1);
		expect(stats.Kc).toBe(10);
		expect(stats.Cr).toBe(15);
	});

	it("should calculate stats at level 99", () => {
		const stats = calculateStats(mockTables, params, 99);
		expect(stats.Kc).toBe(100);
		expect(stats.Pr).toBe(110);
	});

	it("should return default stats when growth data not found", () => {
		const invalidParams: CharacterGrowthParams = {
			mainPosition: 99, // Invalid position
			subPosition: 1,
			growthPattern: 0,
			charaRank: 5,
		};

		const stats = calculateStats(mockTables, invalidParams, 50);
		expect(stats.Kc).toBe(0);
		expect(stats.Cr).toBe(0);
		expect(stats.Tc).toBe(0);
	});
});

describe("generateGrowthCurve", () => {
	const mockTables: GrowthTables = {
		lv1: [
			{
				mainPosition: 1,
				subPosition: 1,
				playStyle: 0,
				Kc_1: 10,
				Cr_1: 10,
				Tc_1: 10,
				Pr_1: 10,
				Ps_1: 10,
				Ag_1: 10,
				It_1: 10,
			},
		],
		lv30: [
			{
				mainPosition: 1,
				subPosition: 1,
				growthPattern: 0,
				charaRank: 5,
				Kc_30: 30,
				Cr_30: 30,
				Tc_30: 30,
				Pr_30: 30,
				Ps_30: 30,
				Ag_30: 30,
				It_30: 30,
			},
		],
		main: [
			{
				mainPosition: 1,
				growthPattern: 0,
				charaRank: 5,
				Kc_50: 50,
				Cr_50: 50,
				Tc_50: 50,
				Pr_50: 50,
				Ps_50: 50,
				Ag_50: 50,
				It_50: 50,
				Kc_99: 100,
				Cr_99: 100,
				Tc_99: 100,
				Pr_99: 100,
				Ps_99: 100,
				Ag_99: 100,
				It_99: 100,
			},
		],
	};

	const params: CharacterGrowthParams = {
		mainPosition: 1,
		subPosition: 1,
		growthPattern: 0,
		charaRank: 5,
	};

	it("should generate curve from level 1 to 99 by default", () => {
		const curve = generateGrowthCurve(mockTables, params);
		expect(curve.length).toBe(99);
		expect(curve[0].level).toBe(1);
		expect(curve[98].level).toBe(99);
	});

	it("should generate curve for custom range", () => {
		const curve = generateGrowthCurve(mockTables, params, 10, 20);
		expect(curve.length).toBe(11);
		expect(curve[0].level).toBe(10);
		expect(curve[10].level).toBe(20);
	});

	it("should include total power for each level", () => {
		const curve = generateGrowthCurve(mockTables, params, 1, 1);
		expect(curve[0].total).toBe(70); // 7 stats * 10
	});

	it("should show progression in stats", () => {
		const curve = generateGrowthCurve(mockTables, params);
		// Level 1 total = 70, Level 99 total = 700
		expect(curve[0].total).toBeLessThan(curve[98].total);
	});
});
