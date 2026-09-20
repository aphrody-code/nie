import { afterEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api, type StatBlock } from "../../lib/api";
import { wikiDb } from "../../lib/wikiDb";
import type { Joueur } from "../../lib/equipe";
import { ComparatorPanel } from "./ComparatorPanel";
import * as thumbnails from "@niers/inacord-ui/lib/thumbs";

let root: Root | undefined;
let container: HTMLDivElement;
const restores: Array<() => void> = [];
afterEach(async () => {
	if (root) await act(async () => root!.unmount());
	container?.remove();
	for (const restore of restores.splice(0)) restore();
});

test("exact variants stay selectable and pending or failed data never become empty game results", async () => {
	const originalUrl = window.location.href;
	restores.push(() => window.history.replaceState(null, "", originalUrl));
	window.history.replaceState(null, "", "/inacord/tools?tool=compare");
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	restores.push(() => { environment.IS_REACT_ACT_ENVIRONMENT = previous; });
	const thumbnail = spyOn(thumbnails, "useThumbnail").mockReturnValue({ ref: { current: null }, src: null, supporte: false });
	restores.push(() => thumbnail.mockRestore());
	const stats: StatBlock = { kc: 238, cr: 258, tc: 250, pr: 210, ps: 211, ag: 195, it: 230, total: 1592 };
	const roster: Joueur[] = ["Normal", "BASARA"].map((rarete, index) => ({
		id: `variant_${index}`, nom: "Byron", rarete, codeRarete: index, code: null,
		poste: "Milieu", element: "Forêt", serie: null, genre: "M",
		stats: { kick: 0, control: 0, technique: 0, pressure: 0, physical: 0, agility: 0, intelligence: 0 },
	}));
	let resolveStats!: (value: StatBlock) => void;
	const pending = new Promise<StatBlock>(resolve => { resolveStats = resolve; });
	const growth = spyOn(api, "gameDataCalculateStats").mockImplementation(() => pending);
	const skills = spyOn(wikiDb, "characterSkills").mockRejectedValue(new Error("unavailable"));
	restores.push(() => growth.mockRestore(), () => skills.mockRestore());
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => root!.render(<ComparatorPanel roster={roster} />));
	await act(async () => {
		container.querySelectorAll<HTMLButtonElement>('[aria-label="Byron · BASARA · variant_1"]')[0]!.click();
	});
	await act(async () => {
		container.querySelectorAll<HTMLButtonElement>('[aria-label="Byron · Normal · variant_0"]')[1]!.click();
	});
	expect(container.textContent).toContain("Calcul des statistiques");
	expect(container.textContent).not.toContain("0 vs 0");
	await act(async () => resolveStats(stats));
	expect(container.textContent).toContain("1592 vs 1592");
	const pressure = [...container.querySelectorAll("span")].find(element => element.textContent === "Pression");
	expect(pressure?.parentElement?.textContent).toContain("211vs211");
	expect(container.querySelector('[role="alert"]')?.textContent).toContain("techniques sont indisponibles");
	expect(container.textContent).not.toContain("Aucune technique");
	skills.mockResolvedValue([{ id: "god_knows", name_fr: "God Knows", name_en: null, category: null, element: null, power_max: 85, tp_cost: null, is_hyper: null }]);
	await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
	expect(container.querySelector('[role="alert"]')).toBeNull();
	expect(container.textContent).toContain("God Knows");
	expect(growth.mock.calls.some(call => call[0] === "variant_1" && call[2] === 1)).toBe(true);
});
