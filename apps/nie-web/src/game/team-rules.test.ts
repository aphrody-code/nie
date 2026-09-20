import { beforeAll, expect, test } from "bun:test";
import init, * as wasm from "../wasm/nie_wasm.js";
import { configureTeamRulesRuntime, getPositionMatchFactor, recalculateMemberStats, calculateElementSynergies, type PositionMatch } from "@niers/game/game/team-rules";
import type { Formation } from "@niers/game/game/formations";
import type { TeamMember } from "@niers/game/game/team-types";
import fixtures from "../../../../packages/nie-game/test/fixtures/team-rules.json";

beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL("../../public/static/game/nie_wasm_bg.wasm", import.meta.url)).arrayBuffer() });
  configureTeamRulesRuntime(wasm);
});

test("team rules preserve frozen browser results through actual WASM owners", () => {
  const formation = fixtures.formation as Formation;
  for (const fixture of fixtures.positions) {
    expect(getPositionMatchFactor(fixture.position, fixture.slot, formation)).toEqual(fixture.expected as PositionMatch);
  }
  for (const fixture of fixtures.stats) {
    expect(recalculateMemberStats(fixture.member as TeamMember, fixture.level, fixture.slot, formation, fixture.dominant, fixture.harmony)).toEqual(fixture.expected);
  }
  for (const fixture of fixtures.synergies) {
    expect(calculateElementSynergies(fixture.members as Record<string, TeamMember>, formation)).toEqual(fixture.expected);
  }
});

test("team rules reject malformed host data instead of returning plausible substitute stats", () => {
  expect(() => wasm.team_position_factor("MF", "field-0", "{}")).toThrow();
  expect(() => wasm.team_element_synergies("{}", "{}")).toThrow();
  expect(() => wasm.team_recalculate_stats("{}", NaN, "field-0", "{}", undefined, false)).toThrow();
});
