import { beforeAll, describe, expect, test } from "bun:test";
import * as codec from "@nie/game/game/team-code";
import fixtures from "../../../../packages/nie-game/test/fixtures/team-code.json";
import init, * as wasm from "../wasm/nie_wasm.js";

describe("team sharing Rust/WASM/browser parity", () => {
  beforeAll(async () => {
    await init({ module_or_path: await Bun.file(new URL("../../public/static/game/nie_wasm_bg.wasm", import.meta.url)).arrayBuffer() });
    codec.configureTeamCodeRuntime(wasm);
  });

  test("frozen UTF-8 codes preserve formation, slot order and player identities", () => {
    for (const fixture of fixtures.roundTrips) {
      expect(codec.encodeTeamCode(fixture.formationId, fixture.slots)).toBe(fixture.encoded);
      expect(codec.decodeTeamCode(fixture.encoded)).toEqual({ formationId: fixture.formationId, slots: fixture.slots });
    }
  });

  test("malformed segments recover exactly and invalid base64 fails", () => {
    for (const fixture of fixtures.decodeOnly) expect(codec.decodeTeamCode(fixture.encoded)).toEqual(fixture.decoded);
    expect(() => codec.decodeTeamCode("!")).toThrow();
    expect(codec.base64ToUtf8("/w==")).toBe("�");
    expect(codec.base64ToUtf8("77u/Zg==")).toBe("f");
    expect(() => codec.base64ToUtf8("Z\vg==")).toThrow();
    expect(codec.base64ToUtf8(codec.utf8ToBase64("Pégase 円堂"))).toBe("Pégase 円堂");
  });
});
