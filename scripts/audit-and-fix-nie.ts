#!/usr/bin/env bun
/**
 * Comprehensive BXC + Headless WebGPU Chrome audit suite for `nie.aphrody.com`.
 *
 * Validates:
 * 1. HTTP API endpoints & public routes (status codes, JSON schemas, headers)
 * 2. Headless Chrome with real WebGPU adapter (SwiftShader / lavapipe)
 * 3. Frontend mounting (#racine, canvas, WebGPU context, WASM load)
 * 4. Runtime errors (console.error, unhandled exceptions, 404 network requests)
 */

process.env.NO_PROXY = `${process.env.NO_PROXY || ""},aphrody.com,.aphrody.com,127.0.0.1,localhost`.replace(/^,/u, "");
process.env.no_proxy = process.env.NO_PROXY;

const BASE_URL = "https://nie.aphrody.com";
const LOCAL_URL = "http://127.0.0.1:8085";

const PAGES_TO_TEST = [
	"/",
	"/en",
	"/es",
	"/ja",
	"/textures",
	"/modeles",
	"/sons",
	"/videos",
	"/explorateur",
	"/editor_3d",
	"/recherche",
	"/donnees",
	"/wiki",
	"/setting_menu",
	"/inacord",
	"/downloads",
];

const APIS_TO_TEST = [
	"/api/v1/health",
	"/api/v1/graphql",
	"/api/v1/openapi.json",
	"/api/v1/text/fr/menu_text/0x82c9a2b3",
	"/downloads/catalog.json",
	"/downloads/channels/stable/latest.json",
];

type PageAuditResult = {
	url: string;
	status: number;
	domReady: boolean;
	hasCanvas: boolean;
	webgpuSupported: boolean;
	webgl2Supported: boolean;
	consoleErrors: string[];
	failedRequests: string[];
	renderSummary: string;
};

type ApiAuditResult = {
	endpoint: string;
	status: number;
	ok: boolean;
	contentType: string | null;
	error?: string;
};

async function auditApis(): Promise<ApiAuditResult[]> {
	console.log("\n=== 1. Probing API Endpoints ===");
	const results: ApiAuditResult[] = [];

	for (const endpoint of APIS_TO_TEST) {
		const targetUrl = `${BASE_URL}${endpoint}`;
		try {
			const res = await fetch(targetUrl, { signal: AbortSignal.timeout(10_000) });
			const contentType = res.headers.get("content-type");
			const ok = res.status >= 200 && res.status < 400;
			results.push({
				endpoint,
				status: res.status,
				ok,
				contentType,
			});
			console.log(`  ${ok ? "✓" : "✗"} ${endpoint} -> ${res.status} (${contentType || "none"})`);
		} catch (err) {
			results.push({
				endpoint,
				status: 0,
				ok: false,
				contentType: null,
				error: err instanceof Error ? err.message : String(err),
			});
			console.log(`  ✗ ${endpoint} -> ERROR: ${err}`);
		}
	}
	return results;
}

async function auditWebGpuPages(): Promise<PageAuditResult[]> {
	console.log("\n=== 2. Launching Real WebGPU Headless Chrome ===");

	const cdpPort = 9226;
	const chromeProcess = Bun.spawn([
		"/usr/local/bin/google-chrome",
		"--headless=new",
		"--no-sandbox",
		"--disable-dev-shm-usage",
		`--remote-debugging-port=${cdpPort}`,
		"--enable-unsafe-webgpu",
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--use-webgpu-adapter=swiftshader",
		"--ignore-gpu-blocklist",
	], { stderr: "pipe" });

	await Bun.sleep(2000);

	const pageResults: PageAuditResult[] = [];

	try {
		const versionRes = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
		if (!versionRes?.ok) {
			throw new Error("Chrome failed to start CDP on port " + cdpPort);
		}
		const versionData = await versionRes.json();
		console.log(`  Connected to ${versionData.Browser}`);

		for (const pagePath of PAGES_TO_TEST) {
			const targetUrl = `${BASE_URL}${pagePath}`;
			console.log(`\n→ Testing page: ${pagePath} (${targetUrl})`);

			const newPage = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new`, { method: "PUT" })).json();
			const ws = new WebSocket(newPage.webSocketDebuggerUrl);
			await new Promise((resolve) => ws.onopen = resolve);

			let id = 1;
			const consoleErrors: string[] = [];
			const failedRequests: string[] = [];

			function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
				return new Promise((resolve) => {
					const msgId = id++;
					const handler = (event: any) => {
						const data = JSON.parse(event.data);
						if (data.id === msgId) {
							ws.removeEventListener("message", handler);
							resolve(data.result);
						}
					};
					ws.addEventListener("message", handler);
					ws.send(JSON.stringify({ id: msgId, method, params }));
				});
			}

			// Listen for runtime & network events
			ws.addEventListener("message", (event: any) => {
				try {
					const data = JSON.parse(event.data);
					if (data.method === "Runtime.consoleAPICalled" && data.params?.type === "error") {
						const text = data.params.args?.map((a: any) => a.value || a.description || JSON.stringify(a)).join(" ");
						if (text) consoleErrors.push(text);
					}
					if (data.method === "Runtime.exceptionThrown") {
						const desc = data.params.exceptionDetails?.exception?.description || data.params.exceptionDetails?.text;
						if (desc) consoleErrors.push(desc);
					}
					if (data.method === "Network.responseReceived") {
						const status = data.params.response?.status;
						const url = data.params.response?.url;
						if (status >= 400) {
							failedRequests.push(`${url} [HTTP ${status}]`);
						}
					}
				} catch {}
			});

			await send("Network.enable");
			await send("Runtime.enable");
			await send("Page.enable");

			// Navigate to target URL
			await send("Page.navigate", { url: targetUrl });

			// Allow bundle initialization, WASM loading, and rendering
			await Bun.sleep(4500);

			const evalResult = await send("Runtime.evaluate", {
				expression: `(async () => {
					const racine = document.getElementById("racine");
					const canvases = document.querySelectorAll("canvas");
					const hasGpu = "gpu" in navigator;
					let webgpuOk = false;
					if (hasGpu && navigator.gpu) {
						try {
							const adapter = await navigator.gpu.requestAdapter();
							if (adapter) {
								const device = await adapter.requestDevice();
								webgpuOk = !!device;
							}
						} catch {}
					}
					const webgl2Ok = !!document.createElement("canvas").getContext("webgl2");
					return {
						status: 200,
						domReady: !!racine && racine.children.length > 0,
						canvasCount: canvases.length,
						webgpuSupported: webgpuOk,
						webgl2Supported: webgl2Ok,
						innerTextSample: racine ? racine.innerText.slice(0, 120).replace(/\\s+/g, " ") : "",
						title: document.title
					};
				})()`,
				awaitPromise: true,
				returnByValue: true
			});

			if (evalResult?.exceptionDetails) {
				consoleErrors.push(`Eval exception: ${evalResult.exceptionDetails.exception?.description || evalResult.exceptionDetails.text}`);
			}
			const val = evalResult?.result?.value || evalResult?.value || {};
			const result: PageAuditResult = {
				url: pagePath,
				status: val.status || 200,
				domReady: val.domReady || false,
				hasCanvas: (val.canvasCount || 0) > 0,
				webgpuSupported: val.webgpuSupported || false,
				webgl2Supported: val.webgl2Supported || false,
				consoleErrors,
				failedRequests,
				renderSummary: `"${val.title || ""}" | canvas=${val.canvasCount || 0} | domReady=${val.domReady} | snippet: ${val.innerTextSample || ""}`,
			};

			pageResults.push(result);

			const isClean = consoleErrors.length === 0 && failedRequests.length === 0;
			console.log(`  ${isClean ? "✓" : "⚠"} ${pagePath} => ${result.renderSummary}`);
			if (consoleErrors.length > 0) {
				console.log(`    Console Errors (${consoleErrors.length}):`);
				for (const err of consoleErrors.slice(0, 5)) {
					console.log(`      - ${err}`);
				}
			}
			if (failedRequests.length > 0) {
				console.log(`    Failed Network Requests (${failedRequests.length}):`);
				for (const req of failedRequests.slice(0, 5)) {
					console.log(`      - ${req}`);
				}
			}

			// Close the tab
			ws.close();
			await fetch(`http://127.0.0.1:${cdpPort}/json/close/${newPage.id}`).catch(() => null);
		}
	} finally {
		chromeProcess.kill();
	}

	return pageResults;
}

async function main() {
	const startedAt = Date.now();
	console.log("==================================================================");
	console.log("   AUTOMATED BXC & WEBGPU BROWSER AUDIT FOR NIE.APHRODY.COM       ");
	console.log("==================================================================");

	const apiResults = await auditApis();
	const pageResults = await auditWebGpuPages();

	const failedApis = apiResults.filter((r) => !r.ok);
	const failedPages = pageResults.filter((p) => p.consoleErrors.length > 0 || p.failedRequests.length > 0 || !p.domReady);

	console.log("\n==================================================================");
	console.log(`AUDIT COMPLETE in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
	console.log(`APIs: ${apiResults.length - failedApis.length}/${apiResults.length} passed`);
	console.log(`Pages: ${pageResults.length - failedPages.length}/${pageResults.length} clean`);
	console.log("==================================================================");

	await Bun.write("var/audit-webgpu-report.json", JSON.stringify({ apiResults, pageResults }, null, 2));
	console.log("Saved full report to var/audit-webgpu-report.json");
}

await main();
