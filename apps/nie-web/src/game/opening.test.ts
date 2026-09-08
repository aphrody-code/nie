import { describe, expect, test } from "bun:test";
import type { LayoutJeu as GameLayout } from "@niers/inacord-ui";
import { openingTitleLayout } from "../pages/Game";

const baseTransform = {
	x: 640,
	y: 360,
	anchorX: 0.5,
	anchorY: 0.5,
	scaleX: 1,
	scaleY: 1,
	rot: 0,
};

function object(name: string, width: number, height: number) {
	return {
		name,
		drawPriority: 200,
		visible: true,
		transform: baseTransform,
		sprite: { logicalPath: `data/${name}.g4tx`, w: width, h: height },
	};
}

describe("openingTitleLayout", () => {
	test("keeps the two VFS title layers and fits them into the 1280x720 canvas", () => {
		const layout: GameLayout = {
			screen: "title_menu",
			canvas: { w: 1280, h: 720 },
			objects: [
				object("title00_03_title_logo", 1600, 1200),
				object("title00_04_gamestart", 1920, 296),
				object("title00_09_unresolved_runtime_atlas", 5828, 6840),
			],
		};

		const result = openingTitleLayout(layout);

		expect(result.objects.map((entry) => entry.name)).toEqual([
			"title00_03_title_logo",
			"title00_04_gamestart",
		]);
		expect(result.objects[0]?.transform).toMatchObject({
			x: 640,
			y: 270,
			scaleX: 0.5,
			scaleY: 0.5,
		});
		expect(result.objects[1]?.transform).toMatchObject({
			x: 640,
			y: 630,
			scaleX: 2 / 3,
			scaleY: 2 / 3,
		});
	});
});
