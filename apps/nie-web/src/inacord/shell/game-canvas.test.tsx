import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { GameCanvas } from "./game-canvas";

let root: Root | null = null;
const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	document.body.replaceChildren();
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("GameCanvas responsive placement", () => {
	test("centers the native canvas before scaling so an oversized grid item cannot shift it", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () => {
			root?.render(<GameCanvas canvas={{ w: 1280, h: 720 }}><button type="button">A</button></GameCanvas>);
		});

		const zone = host.firstElementChild as HTMLDivElement;
		const canvas = zone.firstElementChild as HTMLDivElement;
		expect(zone.style.position).toBe("relative");
		expect(zone.style.overflow).toBe("hidden");
		expect(canvas.style.position).toBe("absolute");
		expect(canvas.style.left).toBe("50%");
		expect(canvas.style.top).toBe("50%");
		expect(canvas.style.transform).toStartWith("translate(-50%, -50%) scale(");
		expect(canvas.style.transformOrigin).toBe("center");
	});
});
