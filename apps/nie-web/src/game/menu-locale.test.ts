import { describe, expect, test } from "bun:test";
import type { NativeMenuScene } from "@nie/inacord-ui/shell/native-title-menu";

import scene from "../../../../crates/engine/nie-formats/src/menu_scenes/avatar-common.json";
import { localizeMenuSceneAssets } from "./menu-locale";

describe("menu VFS locale packs", () => {
	test("uses the requested translated pack and the unsuffixed Japanese source pack", () => {
		const source = scene as NativeMenuScene;
		const french = source.layers.map(layer => layer.assetPath).filter(path => path.includes("/fr/"));
		expect(french).toHaveLength(3);
		const english = localizeMenuSceneAssets(source, "en").layers.map(layer => layer.assetPath);
		expect(english.filter(path => path.includes("/en/"))).toHaveLength(3);
		expect(english.some(path => path.includes("/fr/"))).toBeFalse();
		const japanese = localizeMenuSceneAssets(source, "ja").layers.map(layer => layer.assetPath);
		expect(japanese.some(path => path.includes("/fr/") || path.includes("/ja/"))).toBeFalse();
	});
});
