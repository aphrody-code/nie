/** Read-only local candidate probe using an isolated Chromium DevTools target. */
export {};
const target = process.argv[2];
if (!target || !/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) throw new Error("A local candidate URL is required");
const targets = await fetch("http://127.0.0.1:19322/json/list").then(response => response.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
const page = targets.find(entry => entry.type === "page");
if (!page) throw new Error("Isolated browser page is unavailable");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("CDP connection failed")); });
let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
const errors: unknown[] = [];
socket.onmessage = event => {
	const message = JSON.parse(String(event.data));
	if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
	if (message.id) {
		const waiter = pending.get(message.id);
		pending.delete(message.id);
		if (waiter) clearTimeout(waiter.timer);
		if (message.error) waiter?.reject(new Error(message.error.message)); else waiter?.resolve(message.result);
	}
};
function command<Result = unknown>(method: string, params: object = {}): Promise<Result> {
	const id = ++sequence;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
		pending.set(id, { resolve: value => resolve(value as Result), reject, timer });
		socket.send(JSON.stringify({ id, method, params }));
	});
}
try {
	await command("Runtime.enable");
	await command("Page.enable");
	await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
	await command("Page.navigate", { url: target });
	let snapshot: { state: string; text: string } | null = null;
	for (let attempt = 0; attempt < 60; attempt++) {
		await Bun.sleep(500);
		const result = await command<{ result: { value?: string } }>("Runtime.evaluate", { expression: `JSON.stringify({url:location.href,title:document.title,state:document.readyState,text:document.body.innerText.slice(0,6000),canvases:document.querySelectorAll('canvas').length,links:document.querySelectorAll('a[href]').length,buttons:Array.from(document.querySelectorAll('button')).map(b=>b.innerText||b.getAttribute('aria-label')).slice(0,60)})`, returnByValue: true });
		snapshot = JSON.parse(result.result.value ?? "null");
		if (attempt >= 9 && snapshot?.state === "complete"
			&& !snapshot.text.includes("Préparation de l'écran")) break;
	}
	console.log(JSON.stringify({ snapshot, errors }, null, 2));
	if (process.argv[3]) {
		const screenshot = await command<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
		await Bun.write(process.argv[3], Buffer.from(screenshot.data, "base64"));
	}
} finally {
	for (const waiter of pending.values()) clearTimeout(waiter.timer);
	pending.clear();
	socket.close();
}
