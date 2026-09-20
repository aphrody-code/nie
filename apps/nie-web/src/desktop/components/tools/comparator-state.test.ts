import { describe, expect, test } from "bun:test";
import { comparisonFromSearch, comparisonSearch, comparisonShareText, parseComparisonShare } from "./comparator-state";

test("comparison URLs retain exact variants, legacy aliases and unrelated filters", () => {
	expect(comparisonFromSearch("?char1=byron&char2=mark&level=50")).toEqual({ left: "byron", right: "mark", level: 50 });
	const search = comparisonSearch("?char1=old&char2=old&tool=compare&q=Byron", "0x12B74634", "0x18FEC374", 99);
	expect(comparisonFromSearch(search)).toEqual({ left: "0x12B74634", right: "0x18FEC374", level: 99 });
	const params = new URLSearchParams(search);
	expect(params.has("char1")).toBe(false);
	expect(params.has("char2")).toBe(false);
	expect(params.get("q")).toBe("Byron");
	expect(params.get("tool")).toBe("compare");
	expect(comparisonFromSearch(comparisonSearch(search, null, null, 99))).toEqual({ left: null, right: null, level: 99 });
	expect(comparisonFromSearch("?left=%00&level=invalid")).toEqual({ left: null, right: null, level: 99 });
});

describe("comparison sharing", () => {
	test("serializes only stable identities and the bounded level", () => {
		expect(JSON.parse(comparisonShareText(
			{ id: "byron-basara", name: "Byron Love" },
			{ id: "mark", name: "Mark Evans" },
			120,
		))).toEqual({
			schema: "niers.compare.v1",
			left: { id: "byron-basara", name: "Byron Love" },
			right: { id: "mark", name: "Mark Evans" },
			level: 99,
		});
	});

	test("reopens exact variants and ignores untrusted computed data", () => {
		const shared = comparisonShareText({ id: "0x12B74634", name: "Byron" }, { id: "mark", name: "Mark" }, 50);
		const original = JSON.parse(shared);
		expect(parseComparisonShare(JSON.stringify({ ...original, stats: { total: 999999 } }))).toEqual(original);
		expect(parseComparisonShare(shared).left.id).toBe("0x12B74634");
	});

	test("rejects malformed, unbounded and unsupported payloads", () => {
		const valid = JSON.parse(comparisonShareText({ id: "left", name: "Left" }, { id: "right", name: "Right" }, 99));
		for (const payload of [null, [], {}, { ...valid, schema: "future" }, { ...valid, level: 100 },
			{ ...valid, level: 1.5 }, { ...valid, left: { id: "", name: "" } }, { ...valid, right: null }]) {
			expect(() => parseComparisonShare(JSON.stringify(payload))).toThrow();
		}
		expect(() => parseComparisonShare("x".repeat(8193))).toThrow();
		expect(() => parseComparisonShare("not json")).toThrow();
		expect(() => comparisonShareText(valid.left, valid.right, Number.NaN)).toThrow();
	});
});
