/** Compile the shared Wasm module away from React's main thread. */
const workerScope = globalThis as unknown as {
	onmessage: ((event: MessageEvent<{ url?: unknown }>) => void) | null;
	postMessage(message: { module?: WebAssembly.Module; error?: string }): void;
};

workerScope.onmessage = async (event) => {
	try {
		const url = event.data.url;
		if (typeof url !== "string" || !url.startsWith("/")) throw new Error("Invalid Wasm URL");
		const response = await fetch(url, { cache: "no-cache" });
		if (!response.ok) throw new Error(`Wasm response failed (${response.status})`);
		let module: WebAssembly.Module;
		if (typeof WebAssembly.compileStreaming === "function") {
			try {
				module = await WebAssembly.compileStreaming(response.clone());
			} catch {
				module = await WebAssembly.compile(await response.arrayBuffer());
			}
		} else {
			module = await WebAssembly.compile(await response.arrayBuffer());
		}
		workerScope.postMessage({ module });
	} catch (cause) {
		workerScope.postMessage({ error: cause instanceof Error ? cause.message : "Wasm compilation failed" });
	}
};

export {};
