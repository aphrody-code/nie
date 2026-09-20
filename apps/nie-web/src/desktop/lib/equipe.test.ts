import { beforeAll, expect, test } from "bun:test";
import init, { calculate_stats } from "../../wasm/nie_wasm.js";
import { versJoueurDepuisJeu } from "./equipe";

beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL("../../../public/static/game/nie_wasm_bg.wasm", import.meta.url)).arrayBuffer() });
});

test("game roster maps Rust Pr to physical and Ps to pressure at asymmetric growth levels", () => {
  // Frozen rg 93aea3ba packages/azalee/src/wiki/chara-stats.ts maps Ps->pressure, Pr->physical.
  // Parameters of Byron BASARA 0x12B74634: MF/FW, growth 0, rarity 20, style 0.
  for (const [level, physical, pressure] of [[30, 98, 92], [50, 130, 132], [99, 210, 211]]) {
    const { stats } = JSON.parse(calculate_stats(3, 2, 0, 20, 0, level!));
    const player = versJoueurDepuisJeu({ chara_param_id: "0x12B74634", name: "Byron", main_position: "MF",
      element: "Forest", series: null, internal_code: "", gender: 1, stats });
    expect(player.stats.physical).toBe(physical);
    expect(player.stats.pressure).toBe(pressure);
    expect(Object.values(player.stats).reduce((sum, value) => sum + value, 0)).toBe(
      JSON.parse(calculate_stats(3, 2, 0, 20, 0, level!)).total,
    );
  }
});

test("missing game stats retain the existing zero fallback without exchanging other fields", () => {
  const player = versJoueurDepuisJeu({ chara_param_id: "synthetic", name: "Synthetic", main_position: "MF",
    element: "Forest", series: null, internal_code: "", gender: null,
    stats: { kc: 1, cr: 2, tc: 3, pr: null, ps: 5, ag: 6, it: 7 } });
  expect(player.stats).toEqual({ kick: 1, control: 2, technique: 3, physical: 0, pressure: 5, agility: 6, intelligence: 7 });
});
