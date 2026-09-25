/**
 * `team-code.ts` owns no codec: encoding lives in Rust (`nie-core::azalee::team_code`, exposed by
 * `nie-wasm`), whose parity with these fixtures is proven by `nie-wasm/src/team_code.rs` and
 * `apps/nie-web/src/game/team-code.test.ts` against the real module. What this package DOES own
 * is the transport — the argument order and the JSON shapes handed to that owner — and the rule
 * that no JavaScript fallback answers when the host has installed no runtime. Both are checked
 * here with the frozen fixtures as payloads, through a runtime that records what it receives and
 * answers with the fixture's frozen result.
 */
import { describe, expect, test } from "bun:test";
import fixtures from "./fixtures/team-code.json";
import {
	base64ToUtf8,
	configureTeamCodeRuntime,
	decodeTeamCode,
	encodeTeamCode,
	utf8ToBase64,
	type TeamCodeRuntime,
} from "../src/game/team-code";

type Call = [name: keyof TeamCodeRuntime, ...args: string[]];

/** Answers from the frozen fixtures and records every call the adapter makes. */
function fixtureRuntime(calls: Call[]): TeamCodeRuntime {
	const bySlots = new Map(fixtures.roundTrips.map((fixture) => [`${fixture.formationId}\n${JSON.stringify(fixture.slots)}`, fixture.encoded]));
	const decoded = new Map<string, unknown>([
		...fixtures.roundTrips.map((fixture) => [fixture.encoded, { formationId: fixture.formationId, slots: fixture.slots }] as const),
		...fixtures.decodeOnly.map((fixture) => [fixture.encoded, fixture.decoded] as const),
	]);
	return {
		team_code_encode(formationId, slotsJson) {
			calls.push(["team_code_encode", formationId, slotsJson]);
			const encoded = bySlots.get(`${formationId}\n${slotsJson}`);
			if (encoded === undefined) throw new Error(`no frozen code for ${formationId} ${slotsJson}`);
			return encoded;
		},
		team_code_decode(encoded) {
			calls.push(["team_code_decode", encoded]);
			if (!decoded.has(encoded)) throw new Error(`invalid team code: ${encoded}`);
			return JSON.stringify(decoded.get(encoded));
		},
		team_code_utf8_to_base64(text) {
			calls.push(["team_code_utf8_to_base64", text]);
			return Buffer.from(text, "utf8").toString("base64");
		},
		team_code_base64_to_utf8(encoded) {
			calls.push(["team_code_base64_to_utf8", encoded]);
			return Buffer.from(encoded, "base64").toString("utf8");
		},
	};
}

describe("team code adapter", () => {
	// Runs first: module state starts with no runtime installed.
	test("without an installed runtime every entry point refuses instead of guessing", () => {
		expect(() => encodeTeamCode("diamond442", [])).toThrow("Team code runtime is not initialized");
		expect(() => decodeTeamCode("")).toThrow("Team code runtime is not initialized");
		expect(() => utf8ToBase64("x")).toThrow("Team code runtime is not initialized");
		expect(() => base64ToUtf8("eA==")).toThrow("Team code runtime is not initialized");
	});

	test("encode hands the owner the formation id and the ordered slot list as JSON", () => {
		const calls: Call[] = [];
		configureTeamCodeRuntime(fixtureRuntime(calls));
		for (const fixture of fixtures.roundTrips) {
			expect(encodeTeamCode(fixture.formationId, fixture.slots)).toBe(fixture.encoded);
		}
		expect(calls).toEqual(
			fixtures.roundTrips.map((fixture) => ["team_code_encode", fixture.formationId, JSON.stringify(fixture.slots)] as Call),
		);
		// The wire shape is an array of `{ slot, charaId }` objects, in the caller's order.
		const [, , slotsJson] = calls[0]!;
		expect(JSON.parse(slotsJson!)).toEqual([
			{ slot: "field-0", charaId: "円堂" },
			{ slot: "reserve-2", charaId: "c01001900" },
		]);
	});

	test("decode passes the code through verbatim and returns the owner's structure", () => {
		const calls: Call[] = [];
		configureTeamCodeRuntime(fixtureRuntime(calls));
		for (const fixture of fixtures.roundTrips) {
			expect(decodeTeamCode(fixture.encoded)).toEqual({ formationId: fixture.formationId, slots: fixture.slots });
		}
		for (const fixture of fixtures.decodeOnly) expect(decodeTeamCode(fixture.encoded)).toEqual(fixture.decoded);
		expect(calls.map(([, encoded]) => encoded)).toEqual([
			...fixtures.roundTrips.map((fixture) => fixture.encoded),
			...fixtures.decodeOnly.map((fixture) => fixture.encoded),
		]);
	});

	test("an owner error reaches the caller unchanged", () => {
		configureTeamCodeRuntime(fixtureRuntime([]));
		expect(() => decodeTeamCode("!")).toThrow("invalid team code: !");
	});

	test("base64 helpers are forwarded, not reimplemented", () => {
		const calls: Call[] = [];
		configureTeamCodeRuntime(fixtureRuntime(calls));
		expect(base64ToUtf8(utf8ToBase64("Pégase 円堂"))).toBe("Pégase 円堂");
		expect(calls.map(([name]) => name)).toEqual(["team_code_utf8_to_base64", "team_code_base64_to_utf8"]);
	});
});
