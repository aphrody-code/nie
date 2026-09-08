import { describe, expect, it } from "bun:test";

import { neighboringEpisodes, nextUnwatchedEpisode } from "./episode-navigation.ts";

describe("shared episode navigation", () => {
	it("selects the lowest unwatched episode that exists in the catalogue", () => {
		expect(nextUnwatchedEpisode([8, 1, 3], new Set([1]))).toBe(3);
		expect(nextUnwatchedEpisode([1, 3], new Set([1, 3]))).toBeNull();
	});

	it("uses actual neighboring catalogue entries around present and removed episodes", () => {
		expect(neighboringEpisodes([1, 2, 5, 6], 2)).toEqual({ previous: 1, next: 5 });
		expect(neighboringEpisodes([1, 2, 5, 6], 4)).toEqual({ previous: 2, next: 5 });
	});
});
