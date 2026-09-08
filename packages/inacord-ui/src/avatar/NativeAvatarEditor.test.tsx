import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssetSourceProvider } from "../source";
import { NativeAvatarEditor, type NativeAvatarEditorProps, type AvatarStage } from "./NativeAvatarEditor";
import { INITIAL_AVATAR_STATE, type AvatarCatalog } from "./contract";
import type { NativeMenuScene } from "../shell/native-title-menu";
import { createStandardGamepadMenuSampler } from "../shell/menu-interaction";
import common from "../../../../crates/engine/nie-formats/src/menu_scenes/avatar-common.json";
import top from "../../../../crates/engine/nie-formats/src/menu_scenes/avatar-top.json";
import body from "../../../../crates/engine/nie-formats/src/menu_scenes/avatar-style.json";
import hair from "../../../../crates/engine/nie-formats/src/menu_scenes/avatar-hair.json";
import names from "../../../../crates/engine/nie-formats/src/menu_scenes/avatar-name.json";
import stats from "../../../../crates/engine/nie-formats/src/menu_scenes/avatar-stats.json";
if (typeof document === "undefined") GlobalRegistrator.register();
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const part = (id: string, itemNo: number, icone: string, gender = 0) => ({ id, itemNo, icone, gender, resource: id, modeles: [], modeles2: [] });
const catalog: AvatarCatalog = {
	categories: [
		{ faceSettingType: 1, parts: Array.from({ length: 12 }, (_, i) => part(`preset-${i}`, i + 1, `icon_ava_face01_${String(i + 1).padStart(3, "0")}`)) },
		{ faceSettingType: 17, parts: [part("male-body", 1, "icon_ava_body01_001", 1), part("female-body", 1, "icon_ava_body01_011", 2)] },
	], modelesDeBase: { morphologies: [], visages: [] },
};
const source = { urlTexture: (path: string) => `/native/${path}.png`, capacites: async () => ({}) } as never;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = null; container = null; });
async function mount(stage: AvatarStage, overlay: typeof top | typeof body | typeof hair | typeof stats | typeof names, extra: Partial<NativeAvatarEditorProps> = {}) {
	const scene = { ...overlay, layers: [...common.layers, ...overlay.layers], controls: [...common.controls, ...overlay.controls], texts: [...common.texts, ...overlay.texts], slots: [...common.slots, ...overlay.slots] } as NativeMenuScene;
	container = document.createElement("div"); document.body.append(container); root = createRoot(container);
	await act(async () => root?.render(<AssetSourceProvider source={source}><NativeAvatarEditor
		catalog={catalog} state={{ ...INITIAL_AVATAR_STATE }} stage={stage} scene={scene} model={<canvas data-live-model="true" />}
		onStateChange={() => {}} onStageChange={() => {}} onBack={() => {}} renderText={text => <span>{text}</span>}
		nameFields={{ name: "", nickname: "", uniformName: "", shirtNumber: "" }} onNameFieldsChange={() => {}} {...extra} />
	</AssetSourceProvider>));
	return container;
}
function button(id: string) { const button = container?.querySelector<HTMLButtonElement>(`button[data-avatar-control="${id}"]`); if (!button) throw Error(`Missing ${id}`); return button; }

describe("native avatar editor bindings", () => {
	test("retains held confirm and cancel edges in the host sampler across mounts", async () => {
		const sampler = createStandardGamepadMenuSampler();
		const pad = { index: 0, id: "transition", connected: true, mapping: "standard", axes: [0, 0], buttons: [{ pressed: true }, { pressed: false }] } as unknown as Gamepad;
		let frame: FrameRequestCallback = () => {};
		let activated = 0;
		let back = 0;
		const original = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
		Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
		const raf = spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { frame = callback; return 1; });
		const cancel = spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
		try {
			expect(sampler.sample([pad])).toEqual([{ type: "activate" }]);
			await mount("style", top, { gamepadSampler: sampler, onStageChange: () => activated++, onBack: () => back++ });
			await act(async () => frame(0));
			expect(activated).toBe(0);
			(pad.buttons[0] as { pressed: boolean }).pressed = false;
			await act(async () => frame(16));
			(pad.buttons[0] as { pressed: boolean }).pressed = true;
			await act(async () => frame(32));
			expect(activated).toBe(1);
			(pad.buttons[0] as { pressed: boolean }).pressed = false;
			(pad.buttons[1] as { pressed: boolean }).pressed = true;
			await act(async () => frame(48));
			expect(back).toBe(1);
			await act(async () => root?.unmount()); root = null;
			expect(sampler.sample([pad])).toEqual([]);
			(pad.buttons[1] as { pressed: boolean }).pressed = false;
			expect(sampler.sample([pad])).toEqual([]);
			(pad.buttons[1] as { pressed: boolean }).pressed = true;
			expect(sampler.sample([pad])).toEqual([{ type: "cancel" }]);
		} finally {
			if (root) { await act(async () => root?.unmount()); root = null; }
			raf.mockRestore(); cancel.mockRestore();
			if (original) Object.defineProperty(navigator, "getGamepads", original);
			else Reflect.deleteProperty(navigator, "getGamepads");
		}
	});
	test("renders the two real gender regions and emits gender state without restarting the route", async () => {
		const updates: unknown[] = []; const target = await mount("style", top, { onStateChange: state => updates.push(state) });
		expect(target.querySelectorAll('[data-native-region^="icon_ava_gender01_"]')).toHaveLength(2);
		expect(button("gender0").getAttribute("aria-pressed")).toBe("true");
		await act(async () => button("gender1").click());
		expect(updates).toHaveLength(1); expect(updates[0]).toMatchObject({ gender: 1, selections: {} });
		expect(target.querySelector('[data-live-model="true"]')).not.toBeNull();
		expect(target.innerHTML).not.toContain("avatar_edit_top.png");
	});
	test("maps next and each native header step to the stage callback", async () => {
		const stages: AvatarStage[] = []; let back = 0;
		await mount("style", top, { onStageChange: stage => stages.push(stage), onBack: () => back++ });
		await act(async () => button("next").click()); await act(async () => button("stage-hair").click()); await act(async () => button("back").click());
		expect(stages).toEqual(["body", "hair"]); expect(back).toBe(1);
	});
	test("filters native body choices by gender instead of constructing body resources", async () => {
		const target = await mount("body", body, { state: { ...INITIAL_AVATAR_STATE, gender: 1 } });
		expect(target.querySelector('[data-avatar-part="female-body"]')).not.toBeNull();
		expect(target.querySelector('[data-avatar-part="male-body"]')).toBeNull();
		expect(button("body-slot-1").disabled).toBe(true); expect(button("body-next").disabled).toBe(true);
	});
	test("pages real face presets and replaces the facial recipe while preserving the selected body", async () => {
		const updates: unknown[] = []; await mount("hair", hair, { state: { ...INITIAL_AVATAR_STATE, selections: { 4: "old-hair", 17: "male-body" } }, onStateChange: state => updates.push(state) });
		expect(container?.querySelectorAll('[data-avatar-part^="preset-"]')).toHaveLength(9);
		expect(button("parts-prev").disabled).toBe(true);
		await act(async () => button("parts-next").click());
		expect(container?.querySelectorAll('[data-avatar-part^="preset-"]')).toHaveLength(3);
		expect(button("parts-next").disabled).toBe(true);
		await act(async () => button("part-slot-0").click());
		expect(updates[0]).toMatchObject({ selections: { 1: "preset-9", 17: "male-body" } });
		expect((updates[0] as { selections: object }).selections).not.toHaveProperty("4");
	});
	test("keeps unimplemented native status actions disabled without importing captured statistics", async () => {
		await mount("stats", stats);
		for (const id of ["element-0", "stat-value-0", "category-1", "category-2"]) expect(button(id).disabled).toBe(true);
		expect(button("next").disabled).toBe(false);
		expect(container?.querySelectorAll('[data-avatar-part]')).toHaveLength(0);
	});
});

	describe("avatar field navigation", () => {
		test("leaves bubbling Escape available to external modal dialogs", async () => {
			let back = 0;
			await mount("name", names, { onBack: () => back++ });
			const input = container!.querySelector<HTMLInputElement>('[data-avatar-field="name"]')!;
			for (const kind of ["dialog", "alertdialog", "native"]) {
				const modal = document.createElement(kind === "native" ? "dialog" : "div");
				if (kind === "native") modal.setAttribute("open", "");
				else { modal.setAttribute("role", kind); modal.setAttribute("aria-modal", "true"); }
				document.body.append(modal);
				try {
					const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
					await act(async () => input.dispatchEvent(escape));
					expect(escape.defaultPrevented).toBe(false);
					expect(back).toBe(0);
				} finally { modal.remove(); }
			}
			await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
			expect(back).toBe(1);
		});
		test("moves keyboard focus into a name field and cancels from that field once", async () => {
			let back = 0;
			await mount("name", names, { onBack: () => back++, scene: {
				id: "avatar-name", canvas: { width: 1920, height: 1080 }, layers: [], controls: [
					{ id: "stage-name", label: "Name", rect: { x: 0, y: 0, w: 100, h: 50 } },
					{ id: "name", label: "Name field", rect: { x: 0, y: 100, w: 100, h: 50 } },
				],
			} });
			await act(async () => button("stage-name").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
			const input = container?.querySelector<HTMLInputElement>('[data-avatar-field="name"]');
			expect(document.activeElement).toBe(input);
			const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
			await act(async () => input?.dispatchEvent(escape));
			await act(async () => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", repeat: true, bubbles: true, cancelable: true })));
			expect(escape.defaultPrevented).toBe(true);
			expect(back).toBe(1);
		});
		test("adjusts focused height with gamepad rising edges and respects its upper bound", async () => {
			const updates: { height: number | null }[] = [];
			let frame: FrameRequestCallback = () => {};
			const pad = { index: 0, id: "test", connected: true, mapping: "standard", axes: [1, 0], buttons: [] } as unknown as Gamepad;
			const original = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
			Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
			const raf = spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { frame = callback; return 1; });
			const cancel = spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
			try {
				await mount("body", body, { state: { ...INITIAL_AVATAR_STATE, height: 14 }, onStateChange: state => updates.push(state) });
				const input = container?.querySelector<HTMLInputElement>('[data-avatar-control="height"]');
				await act(async () => input?.focus());
				await act(async () => frame(0));
				expect(updates).toHaveLength(0);
				(pad.axes as number[])[0] = -1;
				await act(async () => frame(16));
				expect(updates).toEqual([expect.objectContaining({ height: 13 })]);
				await act(async () => frame(32));
				expect(updates).toHaveLength(1);
				expect(document.activeElement).toBe(input);
				await act(async () => root?.unmount()); root = null;
			} finally {
				raf.mockRestore(); cancel.mockRestore();
				if (original) Object.defineProperty(navigator, "getGamepads", original);
				else Reflect.deleteProperty(navigator, "getGamepads");
			}
		});

		test("preserves text-field arrow keys for editing", async () => {
			await mount("name", names);
			const input = container?.querySelector<HTMLInputElement>('[data-avatar-field="name"]');
			await act(async () => input?.focus());
			const arrow = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
			await act(async () => input?.dispatchEvent(arrow));
			expect(document.activeElement).toBe(input);
			expect(arrow.defaultPrevented).toBe(false);
		});
	});
