import type { InventoryReference } from "./menu-acceptance";

export type CaptureTarget =
	| { kind: "opening"; phase: "loading" | "inazuma-eleven" | "level5" | "autosave" | "start" }
	| { kind: "front" }
	| { kind: "avatar"; stage: "style" | "body" | "hair" | "clothes" | "stats" | "name" };
export interface CapturePlanRow {
	reference: InventoryReference;
	target: CaptureTarget | null;
	unresolved: string[];
}
const opening: Record<string, Extract<CaptureTarget, { kind: "opening" }>["phase"]> = {
	loading01: "loading", movie_ie_15th: "inazuma-eleven", movie_l5logo: "level5",
	title_auto_save_info_menu: "autosave", title00: "start",
};
const avatar: Record<string, Extract<CaptureTarget, { kind: "avatar" }>["stage"]> = {
	avatar_edit_root: "style", chara_edit_style: "body", chara_edit_hair: "hair",
	chara_edit_clothes: "clothes", chara_edit_stats: "stats", chara_edit_name: "name",
};

/** Pair only known implemented surfaces. A similar catalogue or settings page is not the PC state. */
export function menuCapturePlan(references: readonly InventoryReference[]): CapturePlanRow[] {
	return references.map(reference => {
		let target: CaptureTarget | null = null;
		const phase = opening[reference.screen];
		if (phase && reference.visual_subscreen === null) target = { kind: "opening", phase };
		else if (reference.screen === "title_menu_2" && reference.visual_subscreen === null) target = { kind: "front" };
		else if (reference.screen === "kizuna_town_avatar_menu" && reference.visual_subscreen && avatar[reference.visual_subscreen]) {
			target = { kind: "avatar", stage: avatar[reference.visual_subscreen]! };
		}
		return { reference, target, unresolved: [
			...(target ? [] : ["No verified browser reproduction recipe for this native reference"]),
			"Frozen reference save/model state and animation timestamp are not established",
			"Complete reference element and dynamic-region inventory is not established",
		] };
	});
}
