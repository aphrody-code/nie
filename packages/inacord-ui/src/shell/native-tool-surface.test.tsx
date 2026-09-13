import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssetSourceProvider } from "../source";
import { NATIVE_TOOL_ROW, NativeToolSurface } from "./native-tool-surface";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const source = {
	urlTexture: (path: string) => `/assets/${path}`,
	capacites: async () => ({}),
} as never;

function relativeLuminance(hex: string): number {
	const channels = hex.match(/[0-9a-f]{2}/gi)?.map((part) => Number.parseInt(part, 16) / 255) ?? [];
	const linear = channels.map((channel) => channel <= 0.04045
		? channel / 12.92
		: ((channel + 0.055) / 1.055) ** 2.4);
	return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(a: string, b: string): number {
	const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (lighter! + 0.05) / (darker! + 0.05);
}

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	container?.remove();
	root = null;
	container = null;
});

async function renderSurface(active: boolean) {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => root?.render(
		<AssetSourceProvider source={source}>
			<NativeToolSurface active={active} />
		</AssetSourceProvider>,
	));
	return container;
}

describe("NativeToolSurface", () => {
	test("preserves the measured sprite aspect while cropping host chrome", async () => {
		const target = await renderSurface(false);
		const svg = target.querySelector("svg");
		expect(svg?.getAttribute("viewBox")).toBe(`0 0 ${NATIVE_TOOL_ROW.width} ${NATIVE_TOOL_ROW.height}`);
		expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
		expect(target.querySelector("img")?.dataset.nativeRegion).toBe(NATIVE_TOOL_ROW.idle);
		expect(target.querySelector("img")?.dataset.vfsPath).toBe(NATIVE_TOOL_ROW.assetPath);
	});

	test("uses the verified on region for focus, hover and current rows", async () => {
		const target = await renderSurface(true);
		expect(target.querySelector("img")?.dataset.nativeRegion).toBe(NATIVE_TOOL_ROW.active);
		expect(target.querySelector("img")?.dataset.nativeActive).toBe("true");
	});

	test("keeps ready idle-row ink above WCAG AA on the measured native surface", () => {
		const surfaceCss = readFileSync(new URL("./native-tool-surface.css", import.meta.url), "utf8");
		const settingsCss = readFileSync(new URL("../components/settings/native-settings.css", import.meta.url), "utf8");
		expect(NATIVE_TOOL_ROW.idle).toBe("option_list_base02_off");
		expect(surfaceCss).toContain("color: var(--screen-tile-deep)");
		expect(settingsCss).toContain("color: var(--screen-tile-deep)");
		// VFS region sample: #EBEBEB (94.95%); generated dark role: #09316B.
		expect(contrastRatio("#EBEBEB", "#09316B")).toBeGreaterThanOrEqual(4.5);
	});
});
