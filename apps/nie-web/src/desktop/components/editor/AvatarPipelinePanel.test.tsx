import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AvatarCatalog, AvatarComposition } from "@niers/inacord-ui/avatar/contract";
import { api } from "@/lib/api";
import { AvatarPipelinePanel } from "./AvatarPipelinePanel";

const catalog: AvatarCatalog = {
	categories: [{ faceSettingType: 4, parts: [{ id: "hair", itemNo: 1, resource: "hair", modeles: [], modeles2: [] }] }],
	modelesDeBase: { morphologies: ["male", "female"], visages: [] },
};
const composition: AvatarComposition = {
	pieces: [{ directory: "_bodySK", name: "native_skeleton" }, { directory: "_facebase", name: "native_face" }],
	faceLayers: ["00_face/skin", "01_eye/eye"], morphology: "female", morphologyIndex: 1,
	skeleton: "native_skeleton", height: null, skinColor: null, irisColor: null, hairColor: null, warnings: [],
};
let root: Root;
let container: HTMLDivElement;
let delivered: string[];
let catalogSpy: ReturnType<typeof spyOn<typeof api, "modelServiceAvatarCatalog">>;
let resolveSpy: ReturnType<typeof spyOn<typeof api, "resolveAvatarComposition">>;
let modelSpy: ReturnType<typeof spyOn<typeof api, "modelServiceAvatarGlbB64">>;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousEnvironment: boolean | undefined;

beforeEach(() => {
	previousEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	delivered = [];
	catalogSpy = spyOn(api, "modelServiceAvatarCatalog").mockResolvedValue(catalog);
	resolveSpy = spyOn(api, "resolveAvatarComposition").mockResolvedValue(composition);
	modelSpy = spyOn(api, "modelServiceAvatarGlbB64").mockResolvedValue("resolved-glb");
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	catalogSpy.mockRestore(); resolveSpy.mockRestore(); modelSpy.mockRestore();
	environment.IS_REACT_ACT_ENVIRONMENT = previousEnvironment;
});
async function mount() {
	await act(async () => root.render(<AvatarPipelinePanel baseUrl="https://example.invalid" onGlb={(glb) => delivered.push(glb)} />));
}
async function build() {
	await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
}

test("desktop selections invoke shared Rust resolution before requesting its assembled model", async () => {
	await mount();
	await act(async () => {
		const morphology = container.querySelector<HTMLSelectElement>("select")!;
		morphology.value = "1";
		morphology.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await build();
	expect(resolveSpy).toHaveBeenCalledTimes(1);
	expect(resolveSpy.mock.calls[0]?.[1]).toMatchObject({ morphology: 1, gender: 1, selections: {} });
	const path = modelSpy.mock.calls[0]?.[1];
	expect(path).toContain("model-avatar/_bodySK/native_skeleton+_facebase/native_face.glb");
	const url = new URL(path!, "https://example.invalid/");
	expect(url.searchParams.get("morpho")).toBe("female");
	expect(url.searchParams.get("face")).toBe("00_face/skin,01_eye/eye");
	expect(delivered).toEqual(["resolved-glb"]);
});

test("invalid native selections do not fall back to a locally invented model request", async () => {
	resolveSpy.mockRejectedValue(new Error("Invalid avatar selection"));
	await mount(); await build();
	expect(modelSpy).not.toHaveBeenCalled();
	expect(delivered).toEqual([]);
	expect(container.textContent).toContain("Invalid avatar selection");
});

test("leaving the editor while native resolution is pending prevents stale model delivery", async () => {
	let finish!: (value: AvatarComposition) => void;
	resolveSpy.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
	await mount(); await build();
	await act(async () => root.unmount());
	await act(async () => finish(composition));
	expect(modelSpy).not.toHaveBeenCalled();
	expect(delivered).toEqual([]);
});
