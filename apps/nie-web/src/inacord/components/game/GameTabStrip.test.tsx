import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GameTabStrip } from "./GameTabStrip";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	container?.remove();
	root = null;
	container = null;
});

async function renderStrip(value = "textures") {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	const changes: string[] = [];
	await act(async () => root?.render(
		<GameTabStrip
			ariaLabel="Type de média"
			tabs={[
				{ id: "textures", label: "Textures", icon: <span>T</span> },
				{ id: "modeles", label: "Modèles", icon: <span>M</span> },
			]}
			value={value}
			onChange={(next) => changes.push(next)}
			previousKey={null}
			nextKey={null}
		/>,
	));
	return { changes, tabs: [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')] };
}

describe("GameTabStrip", () => {
	test("names the group for its actual screen", async () => {
		await renderStrip();
		expect(container?.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Type de média");
	});

	test("moves focus and selection together with arrow keys", async () => {
		const { changes, tabs } = await renderStrip();
		tabs[0]?.focus();
		await act(async () => tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
		expect(changes).toEqual(["modeles"]);
		expect(document.activeElement).toBe(tabs[1]);
	});
});
