import { beforeAll, expect, spyOn, test } from "bun:test";
import init, * as wasm from "../wasm/nie_wasm.js";
import { configureTeamGeneratorRuntime, filtrerVivier, genererEquipe, type Joueur } from "../desktop/lib/equipe";
import type { Formation } from "@nie/game/game/formations";
import fixtures from "../../../../packages/nie-game/test/fixtures/team-generator.json";

beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL("../../public/static/game/nie_wasm_bg.wasm", import.meta.url)).arrayBuffer() });
  configureTeamGeneratorRuntime(wasm);
});

test("the actual WASM filter preserves all frozen legacy cases and original record identity", () => {
  for (const fixture of fixtures.cases) {
    const actual = filtrerVivier(fixtures.roster, fixture.filters, fixture.minimum);
    expect(actual.retenus.map(player => player.id)).toEqual(fixture.expected.ids);
    expect(actual.ignores).toEqual(fixture.expected.ignored);
    for (const player of actual.retenus) expect(player).toBe(fixtures.roster.find(row => row.id === player.id)!);
  }
});

test("seeded WASM selection keeps role constraints, locks and stable results without JavaScript randomness", () => {
  const roster: Joueur[] = Array.from({ length: 4 }, (_, id) => ({ ...fixtures.roster[0]!, id: String(id), poste: "Attaquant" }));
  const formation: Formation = { id: "fixture", name: "Fixture", label: "fixture", positions: [
    { index: 0, role: "FW", top: 0, left: 0 }, { index: 1, role: "FW", top: 0, left: 20 },
    { index: 10, role: "GK", top: 90, left: 50 },
  ] };
  const filters = { element: null, genre: null, rarete: null, serie: null };
  const random = spyOn(Math, "random").mockImplementation(() => { throw new Error("JavaScript PRNG must not run"); });
  try {
    const team = genererEquipe(roster, formation, filters, {}, 5489);
    expect(Object.values(team).map(member => member.charaId)).toEqual(["3", "0"]);
    expect(genererEquipe(roster, formation, filters, {}, 5489)).toEqual(team);
    expect(genererEquipe(roster, formation, filters, {}, 0)).not.toEqual(team);
    expect(genererEquipe(roster, formation, filters, {}, 0xffff_ffff)).toEqual(genererEquipe(roster, formation, filters, {}, 0xffff_ffff));
    const locked = genererEquipe(roster, formation, filters, { "field-0": team["field-0"]! }, 5489);
    expect(locked["field-0"]).toBe(team["field-0"]!);
    expect(locked["field-1"]!.charaId).toBe("2");
    expect(team["field-10"]).toBeUndefined();
    expect(genererEquipe([], formation, filters, {}, 5489)).toEqual({});
    expect(random).not.toHaveBeenCalled();
  } finally { random.mockRestore(); }
  for (const seed of [-1, 1.5, NaN, 0x1_0000_0000]) expect(() => genererEquipe(roster, formation, filters, {}, seed)).toThrow(RangeError);
  expect(() => filtrerVivier(roster, filters, -1)).toThrow(RangeError);
});
