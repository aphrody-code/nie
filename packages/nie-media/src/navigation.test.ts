import { describe, expect, test } from "bun:test";
import { neighboringEpisodes, nextUnwatchedEpisode } from "./navigation.ts";

describe("neighboringEpisodes", () => {
	test("finds the closest available episode on each side, whatever the input order", () => {
		expect(neighboringEpisodes([5, 1, 3, 9, 7], 5)).toEqual({ previous: 3, next: 7 });
	});

	test("works when the current episode is itself missing from the list (a gap)", () => {
		expect(neighboringEpisodes([1, 2, 4, 5], 3)).toEqual({ previous: 2, next: 4 });
	});

	test("has no previous at the first episode and no next at the last", () => {
		expect(neighboringEpisodes([1, 2, 3], 1)).toEqual({ previous: null, next: 2 });
		expect(neighboringEpisodes([1, 2, 3], 3)).toEqual({ previous: 2, next: null });
		expect(neighboringEpisodes([], 1)).toEqual({ previous: null, next: null });
	});

	test("ignores duplicates and non-finite numbers", () => {
		expect(neighboringEpisodes([2, 2, Number.NaN, Number.POSITIVE_INFINITY, 4, 4], 3)).toEqual({ previous: 2, next: 4 });
	});

	test("does not reorder the caller's array", () => {
		const available = [3, 1, 2];
		neighboringEpisodes(available, 2);
		expect(available).toEqual([3, 1, 2]);
	});
});

describe("nextUnwatchedEpisode", () => {
	test("returns the first unwatched episode after the current one", () => {
		expect(nextUnwatchedEpisode([4, 1, 2, 3], new Set([2, 3]), 1)).toBe(4);
	});

	test("starts from the beginning by default", () => {
		expect(nextUnwatchedEpisode([3, 1, 2], new Set([1]))).toBe(2);
	});

	test("returns null once everything after the current episode is watched", () => {
		expect(nextUnwatchedEpisode([1, 2, 3], new Set([2, 3]), 1)).toBeNull();
		expect(nextUnwatchedEpisode([], new Set())).toBeNull();
	});
});
