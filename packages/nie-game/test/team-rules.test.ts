/**
 * Like `team-code.ts`, `team-rules.ts` computes nothing: position factors, stat recalculation and
 * element synergies belong to Rust (`nie-core::azalee::team_rules`, exposed by `nie-wasm`), whose
 * results against these fixtures are proven by `nie-wasm/src/team_rules.rs` and
 * `apps/nie-web/src/game/team-rules.test.ts`. This package owns the conversions made on the way
 * in — `Object.entries` for members, `null` → `undefined` for the dominant element, a strict
 * boolean for harmony — and a shape mismatch there would reach the Rust owner as malformed JSON
 * rather than as a type error. The runtime below checks every payload against the fixture input
 * it came from and answers with the fixture's frozen result.
 */
import { describe, expect, test } from "bun:test";
import fixtures from "./fixtures/team-rules.json";
import {
	calculateElementSynergies,
	configureTeamRulesRuntime,
	getPositionMatchFactor,
	recalculateMemberStats,
	type PositionMatch,
	type TeamRulesRuntime,
} from "../src/game/team-rules";
import type { Formation } from "../src/game/formations";
import type { TeamMember } from "../src/game/team-types";

const formation = fixtures.formation as Formation;

describe("team rules adapter", () => {
	// Runs first: module state starts with no runtime installed.
	test("without an installed runtime every rule refuses instead of returning plausible numbers", () => {
		const member = fixtures.stats[0]!.member as TeamMember;
		expect(() => getPositionMatchFactor("MF", "field-0", formation)).toThrow("Team rules runtime is not initialized");
		expect(() => recalculateMemberStats(member, 99, "field-0", formation)).toThrow("Team rules runtime is not initialized");
		expect(() => calculateElementSynergies({}, formation)).toThrow("Team rules runtime is not initialized");
	});

	test("position factors: slot and position verbatim, formation as JSON", () => {
		const seen: Array<[string, string]> = [];
		configureTeamRulesRuntime({
			team_position_factor(position, slot, formationJson) {
				expect(JSON.parse(formationJson)).toEqual(fixtures.formation);
				seen.push([position, slot]);
				const fixture = fixtures.positions.find((entry) => entry.position === position && entry.slot === slot)!;
				return JSON.stringify(fixture.expected);
			},
		} as TeamRulesRuntime);
		for (const fixture of fixtures.positions) {
			expect(getPositionMatchFactor(fixture.position, fixture.slot, formation)).toEqual(fixture.expected as PositionMatch);
		}
		// Malformed slots ("field--0", "field- 0", "") are the owner's to judge: none is filtered here.
		expect(seen).toEqual(fixtures.positions.map((fixture) => [fixture.position, fixture.slot]));
	});

	test("stat recalculation: null dominant element travels as undefined, harmony as a boolean", () => {
		const received: unknown[][] = [];
		configureTeamRulesRuntime({
			team_recalculate_stats(memberJson, level, slot, formationJson, dominant, harmony) {
				received.push([JSON.parse(memberJson), level, slot, JSON.parse(formationJson), dominant, harmony]);
				const fixture = fixtures.stats[received.length - 1]!;
				return JSON.stringify(fixture.expected);
			},
		} as TeamRulesRuntime);
		for (const fixture of fixtures.stats) {
			expect(
				recalculateMemberStats(fixture.member as TeamMember, fixture.level, fixture.slot, formation, fixture.dominant, fixture.harmony),
			).toEqual(fixture.expected);
		}
		expect(received).toEqual(
			fixtures.stats.map((fixture) => [
				fixture.member,
				fixture.level,
				fixture.slot,
				fixtures.formation,
				fixture.dominant ?? undefined,
				fixture.harmony,
			]),
		);
		// The fixture covers both conversions: an explicit `null` and an empty string, which must
		// NOT be collapsed into "no element".
		expect(fixtures.stats.some((fixture) => fixture.dominant === null)).toBe(true);
		expect(received.some((call) => call[4] === "")).toBe(true);
	});

	test("omitted harmony is sent as false, never as undefined", () => {
		let harmonySent: unknown = "unset";
		configureTeamRulesRuntime({
			team_recalculate_stats(_member, _level, _slot, _formation, _dominant, harmony) {
				harmonySent = harmony;
				return JSON.stringify(fixtures.stats[0]!.expected);
			},
		} as TeamRulesRuntime);
		recalculateMemberStats(fixtures.stats[0]!.member as TeamMember, 99, "reserve-0", formation);
		expect(harmonySent).toBe(false);
	});

	test("element synergies: members travel as [slot, member] pairs in insertion order", () => {
		const received: unknown[] = [];
		configureTeamRulesRuntime({
			team_element_synergies(membersJson, formationJson) {
				expect(JSON.parse(formationJson)).toEqual(fixtures.formation);
				received.push(JSON.parse(membersJson));
				return JSON.stringify(fixtures.synergies[received.length - 1]!.expected);
			},
		} as TeamRulesRuntime);
		for (const fixture of fixtures.synergies) {
			expect(calculateElementSynergies(fixture.members as Record<string, TeamMember>, formation)).toEqual(fixture.expected);
		}
		expect(received).toEqual(fixtures.synergies.map((fixture) => Object.entries(fixture.members)));
		expect((received[0] as Array<[string, unknown]>).map(([slot]) => slot)).toEqual([
			"field-0",
			"field-1",
			"field-2",
			"field-10",
			"reserve-0",
		]);
	});
});
