import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SubmenuModal, AUTHENTIC_SUBMENUS } from "./SubmenuModal";

let root: Root | null;
let container: HTMLDivElement;

const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeEach(() => {
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	container.remove();
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("SubmenuModal", () => {
	test("renders authentic story mode submenu", () => {
		act(() => {
			root?.render(
				<SubmenuModal
					modeSlug="story_mode"
					onClose={() => {}}
				/>
			);
		});

		const dialog = container.querySelector("[role='dialog']");
		expect(dialog).not.toBeNull();
		expect(container.textContent).toContain("Mode Histoire");
		expect(container.textContent).toContain("Chapitre 1 : Un vent nouveau souffle");
		expect(container.textContent).toContain("Sélection des Chapitres");
		expect(container.textContent).toContain("Cinématiques & Événements MAPPA");
		expect(container.textContent).toContain("Lancer le Match");
	});

	test("contains all 8 authentic mode definitions in AUTHENTIC_SUBMENUS", () => {
		const expectedModes = [
			"story_mode",
			"chronicle_mode",
			"competition",
			"victory_road",
			"bb_stadium",
			"kizuna_town",
			"information",
			"title-item-10",
		];

		for (const mode of expectedModes) {
			const def = AUTHENTIC_SUBMENUS[mode];
			expect(def).toBeDefined();
			expect(def.items.length).toBeGreaterThanOrEqual(3);
			expect(def.title).toBeTruthy();
			expect(def.category).toBeTruthy();
			for (const item of def.items) {
				expect(item.title).toBeTruthy();
				expect(item.description).toBeTruthy();
			}
		}
	});

	test("calls onLaunchWasm when match launch item is clicked", () => {
		let launchedMode: string | null = null;
		act(() => {
			root?.render(
				<SubmenuModal
					modeSlug="competition"
					onClose={() => {}}
					onLaunchWasm={(mode) => {
						launchedMode = mode;
					}}
				/>
			);
		});

		const launchBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
			btn.textContent?.includes("Lancer le Match")
		);
		expect(launchBtn).toBeDefined();

		act(() => {
			launchBtn?.click();
		});

		expect(launchedMode as string | null).toBe("competition");
	});

	test("calls onExploreMode when explore item is clicked", () => {
		let exploredSlug: string | null = null;
		act(() => {
			root?.render(
				<SubmenuModal
					modeSlug="kizuna_town"
					onClose={() => {}}
					onExploreMode={(slug) => {
						exploredSlug = slug;
					}}
				/>
			);
		});

		const exploreBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
			btn.textContent?.includes("Explorer les Écrans VFS")
		);
		expect(exploreBtn).toBeDefined();

		act(() => {
			exploreBtn?.click();
		});

		expect(exploredSlug as string | null).toBe("kizuna_town");
	});

	test("calls onClose when Close button is clicked", () => {
		let closed = false;
		act(() => {
			root?.render(
				<SubmenuModal
					modeSlug="bb_stadium"
					onClose={() => {
						closed = true;
					}}
				/>
			);
		});

		const closeBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
			btn.getAttribute("aria-label")?.includes("Fermer") || btn.textContent?.includes("Retour")
		);
		expect(closeBtn).toBeDefined();

		act(() => {
			closeBtn?.click();
		});

		expect(closed).toBe(true);
	});

	test("closes on Escape key press", () => {
		let closed = false;
		act(() => {
			root?.render(
				<SubmenuModal
					modeSlug="victory_road"
					onClose={() => {
						closed = true;
					}}
				/>
			);
		});

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});

		expect(closed).toBe(true);
	});

	test("navigates items with ArrowDown and ArrowUp keys", () => {
		act(() => {
			root?.render(
				<SubmenuModal
					modeSlug="information"
					onClose={() => {}}
				/>
			);
		});

		const items = container.querySelectorAll(".inazuma-suboption-item");
		expect(items.length).toBeGreaterThan(1);
		expect(items[0].classList.contains("inazuma-suboption-item--selected")).toBe(true);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
		});

		const itemsAfterDown = container.querySelectorAll(".inazuma-suboption-item");
		expect(itemsAfterDown[1].classList.contains("inazuma-suboption-item--selected")).toBe(true);

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
		});

		const itemsAfterUp = container.querySelectorAll(".inazuma-suboption-item");
		expect(itemsAfterUp[0].classList.contains("inazuma-suboption-item--selected")).toBe(true);
	});

	test("renders fallback gracefully for unknown mode slug", () => {
		act(() => {
			root?.render(
				<SubmenuModal
					modeSlug="unknown_secret_mode"
					onClose={() => {}}
				/>
			);
		});

		const dialog = container.querySelector("[role='dialog']");
		expect(dialog).not.toBeNull();
		expect(container.textContent).toContain("unknown_secret_mode");
	});
});
