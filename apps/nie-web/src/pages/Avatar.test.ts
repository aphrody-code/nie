import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { initSync, avatar_composition_json } from "../wasm/nie_wasm.js";
import { avatarModelUrl } from "@niers/inacord-ui/avatar/request";
import type { AvatarComposition } from "@niers/inacord-ui/avatar/contract";

const catalog = {
	categories: [
		{ faceSettingType: 17, parts: [
			{ id: "body-male", resource: "edit_body_male", modeles2: ["data/common/chr/_face/20_EDIT/_bodySK/sk_male/sk_male.g4sk"] },
			{ id: "body-female", resource: "edit_body_female", modeles2: ["data/common/chr/_face/20_EDIT/_bodySK/sk_female/sk_female.g4sk"] },
		] },
		{ faceSettingType: 9, parts: [{ id: "D64E1016", itemNo: 1 }] },
		{ faceSettingType: 4, parts: [
			{ id: "paired", modeles: ["data/common/chr/_face/20_EDIT/_hairF/front.g4md"], modeles2: ["data/common/chr/_face/20_EDIT/_hairB/back.g4md"] },
			{ id: "back-only", modeles2: ["data/common/chr/_face/20_EDIT/_hairB/selected.g4md"] },
		] },
		{ faceSettingType: 6, parts: [{ id: "eye", modeles: ["data/dx11/chr/_face/20_EDIT/_facetex/01_eye/eye.g4tx"] }] },
	],
	modelesDeBase: { morphologies: ["male", "female"], visages: [{ noseType: "nose_type_01", resources: ["male_nose", "female_nose"] }] },
};
const resolve = (state: unknown): AvatarComposition => JSON.parse(avatar_composition_json(JSON.stringify(catalog), JSON.stringify(state)));
beforeAll(() => initSync({ module: readFileSync(new URL("../../public/static/game/nie_wasm_bg.wasm", import.meta.url)) }));

describe("avatar host uses the actual compiled Rust resolver", () => {
	test("the selected secondary-only hair reaches the shared request with face texture", () => {
		const composition = resolve({ selections: { 4: "back-only" }, height: 7 });
		const url = avatarModelUrl(composition);
		expect(url).toContain("_bodySK/sk_male+_facebase/male_nose+_hairB/selected.glb");
		expect(url).toContain("face=01_eye%2Feye");
		expect(url).not.toContain("front");
		expect(url).toContain("taille=7");
	});
	test("gender uses matching skeleton, morphology and head instead of only changing a label", () => {
		const female = resolve({ gender: 1 });
		expect(female.morphology).toBe("female");
		expect(female.skeleton).toBe("sk_female");
		expect(female.pieces.find(piece => piece.directory === "_facebase")?.name).toBe("female_nose");
		expect(female.warnings.some(warning => warning.code === "unverified_default_part")).toBe(true);
	});
	test("invalid selections cannot turn into unrelated fallback models", () => {
		expect(() => resolve({ selections: { 4: "absent" } })).toThrow();
		expect(() => resolve({ height: 15 })).toThrow();
		expect(() => avatar_composition_json("{}", "{}")).toThrow();
	});
});
