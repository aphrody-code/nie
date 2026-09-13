import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useWasmReadiness } from "./wasm-readiness";

const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

describe("retryable WASM readiness", () => {
	beforeEach(() => { reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true; });
	afterEach(() => { reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });

	test("a first rejection can be retried and then opens the ready state", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		let calls = 0;
		const load = async () => {
			calls += 1;
			if (calls === 1) throw new Error("temporary network failure");
		};
		function Harness() {
			const state = useWasmReadiness(true, load);
			return <button type="button" data-ready={state.ready} data-failed={state.failed} onClick={state.retry}>retry</button>;
		}
		try {
			await act(async () => root.render(<Harness />));
			expect(container.querySelector("button")?.dataset.failed).toBe("true");
			await act(async () => container.querySelector("button")?.click());
			expect(calls).toBe(2);
			expect(container.querySelector("button")?.dataset.ready).toBe("true");
			expect(container.querySelector("button")?.dataset.failed).toBe("false");
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});
});
