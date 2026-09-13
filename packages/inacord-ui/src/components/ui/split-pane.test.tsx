import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { SplitPane } from "./split-pane";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
	(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	localStorage.clear();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});

describe("SplitPane keyboard resizing", () => {
	test("exposes bounded state and persists arrow, Home and End changes", async () => {
		await act(async () => root.render(
			<SplitPane axis="x" side="end" defaultSize={300} min={200} max={400} storageKey="editor-inspector"
				panel={<div>Inspector</div>}><div>Viewport</div></SplitPane>,
		));
		const separator = host.querySelector<HTMLElement>('[role="separator"]')!;
		expect(separator.tabIndex).toBe(0);
		expect(separator.getAttribute("aria-orientation")).toBe("vertical");
		expect(separator.getAttribute("aria-valuemin")).toBe("200");
		expect(separator.getAttribute("aria-valuemax")).toBe("400");
		expect(separator.getAttribute("aria-valuenow")).toBe("300");

		await act(async () => separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
		expect(separator.getAttribute("aria-valuenow")).toBe("310");
		expect(localStorage.getItem("nie-explorer:split:editor-inspector")).toBe("310");
		await act(async () => separator.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
		expect(separator.getAttribute("aria-valuenow")).toBe("400");
		await act(async () => separator.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
		expect(separator.getAttribute("aria-valuenow")).toBe("200");
	});
});
