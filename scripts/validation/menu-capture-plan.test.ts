import { describe, expect, test } from "bun:test";
import inventory from "../../data/menu/screen-inventory.json";
import { menuCapturePlan } from "./menu-capture-plan";
import { coverageFailures } from "./menu-acceptance";

describe("native reference capture plan", () => {
	test("retains every reference and makes unsupported reproduction explicit", () => {
		const rows = menuCapturePlan(inventory.entries);
		expect(rows).toHaveLength(38);
		expect(rows.filter(row => row.target)).toHaveLength(12);
		expect(rows.filter(row => !row.target)).toHaveLength(26);
		expect(rows.every(row => row.unresolved.length > 0)).toBe(true);
		expect(coverageFailures(inventory.entries, rows.filter(row => row.target).map(row => row.reference.file))).toHaveLength(26);
	});
	test("pairs all six avatar stages without confusing style with the root", () => {
		const rows = menuCapturePlan(inventory.entries);
		const stages = rows.filter(row => row.target?.kind === "avatar").map(row => row.target?.kind === "avatar" ? row.target.stage : null);
		expect(new Set(stages)).toEqual(new Set(["style", "body", "hair", "clothes", "stats", "name"]));
		expect(rows.find(row => row.reference.file === "avatar_edit_style.png")?.target).toEqual({ kind: "avatar", stage: "body" });
		expect(rows.find(row => row.reference.file === "main_menu.png")?.target).toBeNull();
	});
	test("does not pair unknown subscreens by a shared native menu family", () => {
		const reference = { ...inventory.entries[0]!, screen: "kizuna_town_avatar_menu", visual_subscreen: "unknown" };
		expect(menuCapturePlan([reference])[0]?.target).toBeNull();
	});
});
