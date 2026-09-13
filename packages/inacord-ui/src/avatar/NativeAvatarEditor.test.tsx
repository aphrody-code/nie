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
const part = (id: string, itemNo: number, icone: string, gender = 0, resource = id) => ({ id, itemNo, icone, gender, resource, modeles: [], modeles2: [] });
const catalog: AvatarCatalog = {
		categories: [
			{ faceSettingType: 1, parts: Array.from({ length: 12 }, (_, i) => part(`preset-${i}`, i + 1, `icon_ava_face01_${String(i + 1).padStart(3, "0")}`)) },
			{ faceSettingType: 3, parts: [part("skin", 1, "icon_ava_face01_001")], couleurs: ["skin-a", "skin-b"] },
			{ faceSettingType: 4, parts: [part("hair-a", 1, "icon_ava_face04_001"), part("hair-b", 2, "icon_ava_face04_002")], couleurs: ["hair-a", "hair-b"] },
			{ faceSettingType: 6, parts: [part("eyes", 1, "icon_ava_face06_001")], couleurs: ["eye-a", "eye-b"] },
			{ faceSettingType: 17, parts: [
				part("male-body", 1, "icon_ava_body01_001", 1, "edit_body_male"),
				part("female-body", 1, "icon_ava_body01_011", 2, "edit_body_female"),
				part("unsupported-female-body", 2, "icon_ava_body01_012", 2, "edit_body_smallfemale"),
			] },
		],
		couleursRgb: {
			"skin-a": { rgb: "F2C6B8", alpha: 1 }, "skin-b": { rgb: "8A5A44", alpha: 1 },
			"hair-a": { rgb: "221811", alpha: 1 }, "hair-b": { rgb: "55AAEE", alpha: 1 },
			"eye-a": { rgb: "553B3B", alpha: 1 }, "eye-b": { rgb: "22CC88", alpha: 1 },
		},
		personnalites: [
			{ type: 0, presentation: 0, texte: "none", libelle: "Sans" },
			{ type: 1, presentation: 2, texte: "energy", libelle: "Énergique" },
		],
		voix: [
			{ banque: "male-a", genre: 1, personnalite: 1, ton: 0, itemNo: 0 },
			{ banque: "female-a", genre: 2, personnalite: 1, ton: 0, itemNo: 0 },
		],
		panneaux: [{ nom: "chara_edit_parts_menu_status", libelles: [
			...(["Vent", "Forêt", "Feu", "Montagne", "Brèche", "Contre", "Lien", "Tension", "Jeu violent", "Justice"].map((libelle, index) => ({ hash: String(index), libelle, gaiji: [] }))),
		] }],
		modelesDeBase: { morphologies: ["male", "female"], visages: [] },
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
			{...extra} />
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
		test("filters native body choices by gender and emits an explicit morphology recipe", async () => {
			const updates: unknown[] = [];
			const target = await mount("body", body, { state: { ...INITIAL_AVATAR_STATE, gender: 1 }, onStateChange: state => updates.push(state) });
			expect(target.querySelector('[data-avatar-part="female-body"]')).not.toBeNull();
			expect(target.querySelector('[data-avatar-part="male-body"]')).toBeNull();
			expect(target.querySelector('[data-avatar-part="unsupported-female-body"]')).toBeNull();
			expect(target.querySelector('[data-avatar-control="body-slot-1"]')).toBeNull();
			expect(target.querySelector('[data-avatar-control="body-next"]')).toBeNull();
			await act(async () => button("body-slot-0").click());
			expect(updates).toEqual([expect.objectContaining({ selections: { 17: "female-body" } })]);
	});
	test("pages real face presets and replaces the facial recipe while preserving the selected body", async () => {
		const updates: unknown[] = []; await mount("hair", hair, { state: { ...INITIAL_AVATAR_STATE, selections: { 4: "old-hair", 17: "male-body" } }, onStateChange: state => updates.push(state) });
		expect(container?.querySelectorAll('[data-avatar-part^="preset-"]')).toHaveLength(9);
			expect(container?.querySelector('[data-avatar-control="parts-prev"]')).toBeNull();
			await act(async () => button("parts-next").click());
			expect(container?.querySelectorAll('[data-avatar-part^="preset-"]')).toHaveLength(3);
			expect(container?.querySelector('[data-avatar-control="parts-next"]')).toBeNull();
		await act(async () => button("part-slot-0").click());
		expect(updates[0]).toMatchObject({ selections: { 1: "preset-9", 17: "male-body" } });
		expect((updates[0] as { selections: object }).selections).not.toHaveProperty("4");
	});
		test("binds supported skin, hair and iris palettes to Rust AvatarState indices", async () => {
			const updates: Array<typeof INITIAL_AVATAR_STATE> = [];
			await mount("hair", hair, { onStateChange: state => updates.push(state) });
			await act(async () => button("category-2").click());
			expect(container?.querySelectorAll("[data-avatar-color]")).toHaveLength(2);
			await act(async () => button("part-slot-1").click());
			expect(updates.at(-1)).toMatchObject({ paletteSelections: { 3: 1 } });

			await act(async () => button("category-3").click());
			await act(async () => button("part-slot-1").click());
			expect(updates.at(-1)).toMatchObject({ selections: { 4: "hair-b" } });
			await act(async () => container?.querySelector<HTMLButtonElement>('[aria-label="Affichage de la personnalisation"] button:last-child')?.click());
			await act(async () => button("part-slot-1").click());
			expect(updates.at(-1)).toMatchObject({ paletteSelections: { 4: 1 } });

			await act(async () => button("category-4").click());
			await act(async () => button("part-slot-1").click());
			expect(updates.at(-1)).toMatchObject({ paletteSelections: { 6: 1 } });
		});
		test("hides unsupported face shape and marks clothes unavailable without an active no-op", async () => {
			const updates: unknown[] = [];
			await mount("hair", hair, { onStateChange: state => updates.push(state) });
			expect(button("stage-clothes").disabled).toBe(true);
			expect(button("stage-clothes").getAttribute("aria-label")).toContain("indisponible");
			expect(container?.textContent).toContain("Indisponible");
			expect(container?.querySelector('[data-avatar-control="category-1"]')).toBeNull();
			expect(container?.textContent).not.toContain("Forme de visage");
			await act(async () => button("stage-clothes").click());
			expect(updates).toHaveLength(0);
		});
		test("writes every visible stats selection into the Rust-owned profile", async () => {
			const updates: Array<typeof INITIAL_AVATAR_STATE> = [];
			await mount("stats", stats, { onStateChange: state => updates.push(state) });
			await act(async () => button("element-2").click());
			await act(async () => button("stat-value-0").click());
			await act(async () => button("stat-value-1").click());
			await act(async () => button("stat-value-2").click());
			expect(updates.map(update => update.profile)).toEqual(expect.arrayContaining([
				expect.objectContaining({ element: 2 }),
				expect.objectContaining({ mainPosition: 1 }),
				expect.objectContaining({ subPosition: 1 }),
				expect.objectContaining({ buildType: 0 }),
			]));
			for (const [field, value] of [
				["kick", "279"], ["control", "42"], ["technique", "43"],
				["pressure", "44"], ["physical", "45"], ["agility", "46"],
				["intelligence", "47"],
			] as const) {
				const input = container!.querySelector<HTMLInputElement>(`[data-avatar-stat="${field}"]`)!;
				Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
				await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
			}
			expect(updates.map(update => update.profile)).toEqual(expect.arrayContaining([
				expect.objectContaining({ kick: 279 }), expect.objectContaining({ control: 42 }),
				expect.objectContaining({ technique: 43 }), expect.objectContaining({ pressure: 44 }),
				expect.objectContaining({ physical: 45 }), expect.objectContaining({ agility: 46 }),
				expect.objectContaining({ intelligence: 47 }),
			]));

			await act(async () => button("category-1").click());
			const personality = container!.querySelector<HTMLSelectElement>('select[aria-label="Personnalité"]')!;
			personality.value = "1";
			await act(async () => personality.dispatchEvent(new Event("change", { bubbles: true })));
			expect(updates.at(-1)?.profile.personality).toBe(1);

			await act(async () => button("category-2").click());
			const voice = container!.querySelector<HTMLSelectElement>('select[aria-label="Voix"]')!;
			voice.value = "0";
			await act(async () => voice.dispatchEvent(new Event("change", { bubbles: true })));
			expect(updates.at(-1)?.profile.voice).toBe(0);
		});
		test("writes name fields as validated profile values instead of local presentation state", async () => {
			const updates: Array<typeof INITIAL_AVATAR_STATE> = [];
			await mount("name", names, { onStateChange: state => updates.push(state) });
			for (const [field, value] of [["name", "Ari"], ["nickname", "Ace"], ["uniformName", "NIE"], ["shirtNumber", "42"]] as const) {
				const input = container!.querySelector<HTMLInputElement>(`[data-avatar-field="${field}"]`)!;
				Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
				await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
				await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
			}
			expect(updates.map(update => update.profile)).toEqual(expect.arrayContaining([
				expect.objectContaining({ name: "Ari" }), expect.objectContaining({ nickname: "Ace" }),
				expect.objectContaining({ uniformName: "NIE" }), expect.objectContaining({ shirtNumber: 42 }),
			]));
		});
	});

		describe("avatar field navigation", () => {
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
				const input = container!.querySelector<HTMLInputElement>('[data-avatar-control="height"]');
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
		});
