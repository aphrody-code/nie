import { describe, expect, test } from "bun:test";

import { shouldUseGlobalSearch } from "./Explorer";

const base = {
	partout: true,
	q: "",
	ext: "",
	glob: "",
	cpk: "",
	minMo: "",
	maxMo: "",
};

describe("Explorer indexed-search scope", () => {
	for (const field of ["q", "ext", "glob", "cpk"] as const) {
		test(`keeps everywhere scope for ${field}-only filters`, () => {
			expect(shouldUseGlobalSearch({ ...base, [field]: "value" })).toBe(true);
		});
	}

	for (const field of ["minMo", "maxMo"] as const) {
		test(`keeps everywhere scope for valid ${field}-only filters`, () => {
			expect(shouldUseGlobalSearch({ ...base, [field]: "0" })).toBe(true);
			expect(shouldUseGlobalSearch({ ...base, [field]: "1,5" })).toBe(true);
		});

		test(`does not launch an unfiltered search for invalid ${field} input`, () => {
			expect(shouldUseGlobalSearch({ ...base, [field]: "value" })).toBe(false);
			expect(shouldUseGlobalSearch({ ...base, [field]: "-" })).toBe(false);
		});
	}

	test("does not use indexed search without an active filter", () => {
		expect(shouldUseGlobalSearch(base)).toBe(false);
	});

	test("does not use indexed search when everywhere scope is disabled", () => {
		expect(shouldUseGlobalSearch({ ...base, partout: false, ext: "g4tx" })).toBe(false);
	});
});
