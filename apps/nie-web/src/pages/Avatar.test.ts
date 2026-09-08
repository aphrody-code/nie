import { describe, expect, test } from "bun:test";
import { composeAvatarUrl } from "./Avatar";

const catalog = {
	source: "chara_parts.cfg.bin",
	categories: [
		{
			faceSettingType: 4,
			prefixe: "hair",
			parts: [
				{
					id: "hair-first",
					itemNo: 0,
					resource: "0xFFFFFFFF",
					modeles: ["data/model/20_EDIT/hair_first.g4md"],
				},
				{
					id: "hair-selected",
					itemNo: 1,
					resource: "0x12345678",
					modeles: ["data/model/20_EDIT/hair_selected.g4md"],
				},
			],
		},
	],
	modelesDeBase: { morphologies: ["c000101_edit"] },
};

describe("avatar assembly URL", () => {
	test("does not invent a composition from the first catalog entries", () => {
		expect(composeAvatarUrl(catalog, {}, 0, 7)).toBeNull();
	});

	test("contains only explicitly selected VFS model stems", () => {
		expect(composeAvatarUrl(catalog, { 4: "hair-selected" }, 0, 7)).toBe(
			"/assets/model-avatar/hair_selected.glb?morpho=c000101_edit&taille=7",
		);
	});

	test("does not invent a morphology when the catalog has none", () => {
		expect(
			composeAvatarUrl({ ...catalog, modelesDeBase: { morphologies: [] } }, { 4: "hair-selected" }, 0, 7),
		).toBeNull();
	});
});
