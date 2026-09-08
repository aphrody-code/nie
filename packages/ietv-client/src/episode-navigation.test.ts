import { describe, expect, test } from "bun:test";

import { neighboringEpisodes, nextUnwatchedEpisode } from "./episode-navigation.ts";

describe("episode navigation", () => {
	test("selects the first unwatched catalogue episode", () => {
		expect(nextUnwatchedEpisode([8, 1, 3], new Set([1]))).toBe(3);
		expect(nextUnwatchedEpisode([1, 3], new Set([1, 3]))).toBeNull();
	});

	test("finds neighbors for present and missing episodes", () => {
		expect(neighboringEpisodes([1, 2, 5, 6], 2)).toEqual({ previous: 1, next: 5 });
		expect(neighboringEpisodes([1, 2, 5, 6], 4)).toEqual({ previous: 2, next: 5 });
	});
});
