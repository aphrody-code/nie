import { expect, test } from "bun:test";
import { loadModelViewer } from "./model-viewer-loader";

test("partage l'échec, retire le script et autorise une reprise", async () => {
	const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	let current: (EventTarget & { remove(): void }) | null = null;
	let register!: () => void;
	let defined = false;
	const definition = new Promise<void>((resolve) => { register = resolve; });
	let created = 0;
	Object.defineProperty(globalThis, "window", { configurable: true, value: {
		customElements: { get: () => defined, whenDefined: () => definition },
	} });
	Object.defineProperty(globalThis, "document", { configurable: true, value: {
		querySelector: () => current,
		createElement: () => { created++; return Object.assign(new EventTarget(), { remove() { current = null; } }); },
		head: { appendChild: (script: typeof current) => { current = script; } },
	} });
	try {
		const first = loadModelViewer();
		expect(loadModelViewer()).toBe(first);
		const rejected = first.catch((error: Error) => error);
		current!.dispatchEvent(new Event("error"));
		expect(await rejected).toBeInstanceOf(Error);
		expect((await rejected as Error).message).toContain("Échec");
		expect(current).toBeNull();
		const retry = loadModelViewer();
		expect(retry).not.toBe(first);
		expect(created).toBe(2);
		defined = true;
		register();
		await retry;
		await loadModelViewer();
		expect(created).toBe(2);
	} finally {
		if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
		else Reflect.deleteProperty(globalThis, "window");
		if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
		else Reflect.deleteProperty(globalThis, "document");
	}
});
