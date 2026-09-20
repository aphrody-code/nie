import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ExportMenu } from "./ExportMenu";
import type { ExportFormat } from "./contracts";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	container?.remove();
	root = null;
	container = null;
	environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function render(node: React.ReactElement) {
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => root!.render(node));
	return container;
}

const format = (patch: Partial<ExportFormat> = {}): ExportFormat => ({
	id: "png",
	label: "PNG (sans perte, référence)",
	extension: "png",
	fileName: "activity_note_001.png",
	available: true,
	lossless: true,
	raw: false,
	unavailableReason: null,
	...patch,
});

describe("ExportMenu", () => {
	test("interroge l’hôte au chemin demandé, une seule fois par ouverture", async () => {
		const asked: string[] = [];
		const dom = await render(
			<ExportMenu
				path="data/dx11/menu/220_img/activity_photo/activity_note_001.g4tx"
				listFormats={async (path) => { asked.push(path); return [format()]; }}
				download={async () => undefined}
			/>,
		);
		await act(async () => { dom.querySelector("button")!.click(); });
		expect(asked).toEqual(["data/dx11/menu/220_img/activity_photo/activity_note_001.g4tx"]);
		expect(dom.textContent).toContain("PNG (sans perte, référence)");
		expect(dom.textContent).toContain("activity_note_001.png");
	});

	test("affiche un format indisponible AVEC sa raison, au lieu de le cacher", async () => {
		const dom = await render(
			<ExportMenu
				path="data/movie/op.usm"
				listFormats={async () => [
					format({ id: "mp4", extension: "mp4", label: "MP4", available: false, unavailableReason: "Piste vidéo non décodable" }),
				]}
				download={async () => undefined}
			/>,
		);
		await act(async () => { dom.querySelector("button")!.click(); });
		expect(dom.textContent).toContain("MP4");
		expect(dom.textContent).toContain("Piste vidéo non décodable");
		expect(dom.querySelector<HTMLButtonElement>('[role="menuitem"]')!.disabled).toBe(true);
	});

	test("un hôte sans convertisseur le DIT, et n’ouvre pas un menu vide", async () => {
		const dom = await render(<ExportMenu path="data/dx11/x.g4tx" />);
		expect(dom.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
		expect(dom.textContent).toContain("Cet hôte ne publie pas de conversion");
		await act(async () => { dom.querySelector("button")!.click(); });
		expect(dom.querySelector('[role="menu"]')).toBeNull();
	});

	test("remet à l’hôte le format choisi pour ce chemin", async () => {
		const choisis: Array<[string, string]> = [];
		const dom = await render(
			<ExportMenu
				path="data/dx11/a.g4tx"
				listFormats={async () => [format({ id: "webp", extension: "webp", label: "WebP", fileName: "a.webp" })]}
				download={async (path, chosen) => { choisis.push([path, chosen.id]); }}
			/>,
		);
		await act(async () => { dom.querySelector("button")!.click(); });
		await act(async () => { dom.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click(); });
		expect(choisis).toEqual([["data/dx11/a.g4tx", "webp"]]);
	});
});
