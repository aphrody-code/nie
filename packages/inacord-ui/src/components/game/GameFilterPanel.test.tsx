import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GameFilterPanel } from "./GameFilterPanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeEach(() => {
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	container?.remove();
	root = null;
	container = null;
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

function Host() {
	const [open, setOpen] = useState(false);
	return <>
		<button type="button" onClick={() => setOpen(true)}>Ouvrir les filtres</button>
		{open ? <GameFilterPanel
			families={[{ id: "ext", label: "Extension", icon: <span>E</span>, options: [{ value: "g4tx", label: "G4TX" }] }]}
			value={{ ext: [] }}
			onConfirm={() => setOpen(false)}
			onClose={() => setOpen(false)}
		/> : null}
	</>;
}

const EDITABLE_FAMILIES = [
	{
		id: "primary",
		label: "Première famille",
		icon: <span>A</span>,
		options: [{ value: "alpha", label: "Alpha" }],
		extra: <><input aria-label="Filtre texte" defaultValue="alpha" /><input aria-label="Filtre nombre" type="number" defaultValue="12" /></>,
	},
	{
		id: "secondary",
		label: "Seconde famille",
		icon: <span>B</span>,
		options: [{ value: "beta", label: "Beta" }],
	},
] as const;

async function renderEditablePanel() {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => root?.render(
		<GameFilterPanel
			families={EDITABLE_FAMILIES}
			value={{ primary: [], secondary: [] }}
			onConfirm={() => undefined}
		/>,
	));
}

function activeFamily(): string | null | undefined {
	return container?.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("aria-label");
}

describe("GameFilterPanel focus contract", () => {
	test("returns focus to the control that opened the modal", async () => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		await act(async () => root?.render(<Host />));
		const opener = container.querySelector<HTMLButtonElement>("button");
		opener?.focus();
		await act(async () => opener?.click());
		expect(container.querySelector('[role="dialog"]')).not.toBeNull();
		expect(document.activeElement).not.toBe(opener);
		await act(async () => container?.querySelector<HTMLElement>('[role="dialog"]')?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
		));
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});

	test("leaves text-input arrows to the caret without changing family or option", async () => {
		await renderEditablePanel();
		const input = container!.querySelector<HTMLInputElement>('[aria-label="Filtre texte"]');
		expect(input).not.toBeNull();
		input!.focus();
		const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
		await act(async () => input!.dispatchEvent(event));

		expect(event.defaultPrevented).toBeFalse();
		expect(document.activeElement).toBe(input!);
		expect(activeFamily()).toBe("Première famille");
		expect(container?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBeTrue();
	});

	test("leaves number-input arrows to the native increment without moving the grid", async () => {
		await renderEditablePanel();
		const input = container!.querySelector<HTMLInputElement>('[aria-label="Filtre nombre"]');
		expect(input).not.toBeNull();
		input!.focus();
		const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
		await act(async () => input!.dispatchEvent(event));

		expect(event.defaultPrevented).toBeFalse();
		expect(document.activeElement).toBe(input!);
		expect(activeFamily()).toBe("Première famille");
		expect(container?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBeTrue();
	});
});
