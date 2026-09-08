#!/usr/bin/env bun
/** Real Chromium traversal through the opening and menu, using an isolated agent-browser session.
 * Usage: bun scripts/validation/gate-menu-browser.ts <origin> [output-directory]
 * Uses synthetic standard-gamepad state; pointer and keyboard use browser input commands.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.argv[2];
if (!origin) throw new Error("Usage: gate-menu-browser.ts <origin> [output-directory]");
const output = resolve(process.argv[3] ?? "var/outputs/menu-browser");
const session = `niers-menu-gate-${process.pid}`;
const checks: { name: string; passed: boolean; actual: unknown }[] = [];

async function browser(...args: string[]): Promise<any> {
	const child = Bun.spawn(["agent-browser", "--session", session, "--json", ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(`agent-browser ${args[0]}: ${stderr || stdout}`);
	const result = JSON.parse(stdout);
	if (!result.success) throw new Error(JSON.stringify(result.error));
	return result.data;
}
const evaluate = async (source: string) => (await browser("eval", source)).result;
const check = (name: string, actual: unknown, expected: unknown) => checks.push({ name, passed: actual === expected, actual });
async function waitFor(source: string, timeout = 15000): Promise<void> {
	const start = Date.now();
	while (!(await evaluate(source))) {
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${source}`);
		await Bun.sleep(100);
	}
}
const phase = () => evaluate('document.querySelector("[data-opening-phase]")?.getAttribute("data-opening-phase") ?? (document.querySelector("[data-menu-target]") ? "menu" : "other")');
const focus = () => evaluate('document.activeElement?.closest("[data-menu-target]")?.getAttribute("data-menu-target") ?? null');
async function enterMenu(): Promise<void> {
	await browser("open", origin!);
	await waitFor('!!document.querySelector("[data-opening-phase=autosave]")');
	await browser("press", "Enter");
	await waitFor('!!document.querySelector("[data-opening-phase=start]")');
	await browser("press", "Enter");
	await waitFor('!!document.querySelector("[data-menu-target]")');
	await Bun.sleep(300);
}


async function touch(selector: string): Promise<void> {
	const { cdpUrl } = await browser("get", "cdp-url");
	const endpoint = new URL(cdpUrl);
	const pages = await (await fetch(`http://${endpoint.host}/json/list`)).json() as { type: string; url: string; webSocketDebuggerUrl: string }[];
	const page = pages.find(p => p.type === "page" && p.url.startsWith(origin!));
	if (!page) throw new Error("Browser page CDP endpoint missing");
	const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise<void>((done, fail) => {socket.addEventListener("open", () => done(), {once:true});socket.addEventListener("error", () => fail(new Error("CDP connection failed")), {once:true});});
	let id = 0;
	const send = (params: object) => new Promise<void>((done, fail) => {
		const requestId=++id;
		const timeout=setTimeout(()=>{socket.removeEventListener("message",receive);fail(new Error("Touch input timed out"));},5000);
		const receive=(event: MessageEvent) => {const message=JSON.parse(String(event.data));if(message.id!==requestId)return;clearTimeout(timeout);socket.removeEventListener("message",receive);message.error?fail(new Error(JSON.stringify(message.error))):done();};
		socket.addEventListener("message",receive);
		socket.send(JSON.stringify({id:requestId,method:"Input.dispatchTouchEvent",params}));
	});
	try {
		await send({type:"touchStart",touchPoints:[{x:point.x,y:point.y,id:0}]});
		await send({type:"touchEnd",touchPoints:[]});
	} finally {socket.close();}
}

await mkdir(output, { recursive: true });
try {
	await browser("--args", "--no-sandbox", "open", origin);
	await browser("set", "viewport", "1920", "1080");
	await waitFor('!!document.querySelector("[data-opening-phase=autosave]")');
	await evaluate('window.__menuDelayStyle=document.createElement("style");window.__menuDelayStyle.textContent=".runtime-main-menu{display:none!important}";document.head.append(window.__menuDelayStyle);true');
	await evaluate(`window.__menuPad={mapping:"standard",connected:true,index:0,buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0]};Object.defineProperty(navigator,"getGamepads",{configurable:true,value:()=>[window.__menuPad]});true`);
	await evaluate("window.__menuPad.buttons[0]={pressed:true,value:1};true");
	await waitFor('!!document.querySelector("[data-opening-phase=start]")');
	await Bun.sleep(400);
	check("held gamepad A advances autosave only once", await phase(), "start");
	await evaluate("window.__menuPad.buttons[0]={pressed:false,value:0};true");
	await Bun.sleep(100);
	await evaluate("window.__menuPad.buttons[0]={pressed:true,value:1};true");
	await waitFor('!!document.querySelector("[data-menu-target]")');
	await Bun.sleep(400);
	check("held gamepad A does not activate a menu destination", await phase(), "menu");
	await evaluate("window.__menuPad.buttons[0]={pressed:false,value:0};true");
	await Bun.sleep(100);
	check("unmeasured hidden canvas does not force focus", await focus(), null);
	await evaluate("window.__menuDelayStyle.remove();true");
	await waitFor('document.activeElement?.closest("[data-menu-target]")?.getAttribute("data-menu-target") === "media"',2000);
	check("initial menu focus after canvas measurement", await focus(), "media");
	await browser("press", "ArrowRight");
	await waitFor('document.activeElement?.closest("[data-menu-target]")?.getAttribute("data-menu-target") === "avatar"', 2000);
	check("keyboard right focus", await focus(), "avatar");
	await evaluate("window.__menuPad.axes=[1,0];true");
	await waitFor('document.activeElement?.closest("[data-menu-target]")?.getAttribute("data-menu-target") === "explorer"', 2000);
	check("gamepad analog right focus", await focus(), "explorer");
	await evaluate("window.__menuPad.axes=[0,0];true");
	await browser("hover", '[data-menu-target="settings"] button');
	await waitFor('document.activeElement?.closest("[data-menu-target]")?.getAttribute("data-menu-target") === "settings"', 2000);
	check("pointer hover synchronizes focus", await focus(), "settings");
	const pointer = await evaluate('(()=>{const r=document.querySelector("[data-menu-target=settings] button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
	await browser("mouse", "move", String(Math.round(pointer.x)), String(Math.round(pointer.y)));
	await browser("mouse", "down");
	check("pointer down marks pressed tile", await evaluate('document.querySelectorAll(".runtime-main-menu__tile--pressed").length'), 1);
	await browser("mouse", "move", "1", "1");
	await browser("mouse", "up");
	check("pointer release outside clears pressed state", await evaluate('document.querySelectorAll(".runtime-main-menu__tile--pressed").length'), 0);
	await browser("press", "Escape");
	check("keyboard cancel returns to START", await phase(), "start");
	await browser("press", "Enter");
	await waitFor('!!document.querySelector("[data-menu-target]")');
	await waitFor('Array.from(document.images).every(i=>i.complete && i.naturalWidth>0)');
	await Bun.sleep(500);
	const images = await evaluate('Array.from(document.images).map(i=>({src:i.currentSrc,width:i.naturalWidth,height:i.naturalHeight,renderedWidth:i.getBoundingClientRect().width,renderedHeight:i.getBoundingClientRect().height}))');
	check("nonzero visible image count", images.filter((i: any) => i.renderedWidth > 0 && i.renderedHeight > 0).length > 0, true);
	check("images use individual VFS texture responses", images.every((i: any) => new URL(i.src).pathname.startsWith("/assets/tex/")), true);
	check("no reference capture in DOM", await evaluate('Array.from(document.images).some(i=>/main-menu-reference|main_menu_alt|opening\\/.*\\.png/.test(i.currentSrc))'), false);
	await browser("screenshot", resolve(output, "capture.png"));
	const destinations: Record<string, string> = {};
	const expectedDestinations: Record<string, string> = { media: "/medias", avatar: "/avatar", explorer: "/explorateur", settings: "/settings" };
	for (const id of ["media", "avatar", "explorer", "settings"]) {
		if (id !== "media") await enterMenu();
		if (id === "media") await touch(`[data-menu-target="${id}"] button`);
		else await browser("click", `[data-menu-target="${id}"] button`);
		await waitFor('!document.querySelector("[data-menu-target]")');
		destinations[id] = await evaluate("location.pathname");
		check(`${id} opens its destination`, destinations[id], expectedDestinations[id]);
	}
	const requests = (await browser("network", "requests")).requests ?? [];
	const failedRequests = requests.filter((r: any) => r.status >= 400 || r.failed || r.failureText).map((r: any) => ({url:r.url,status:r.status,error:r.failureText}));
	check("no failed requests during traversal", failedRequests.length, 0);
	const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), origin, viewport: [1920,1080], gamepad: "synthetic standard mapping via navigator.getGamepads", touch: "Chromium Input.dispatchTouchEvent for media destination", checks, passed: checks.filter(c=>c.passed).length, failed: checks.filter(c=>!c.passed).length, images, destinations, requestCount: requests.length, failedRequests };
	await Bun.write(resolve(output, "browser-report.json"), `${JSON.stringify(report,null,2)}\n`);
	console.log(JSON.stringify(report,null,2));
	if (report.failed) process.exitCode=1;
} catch (error) {
	await Bun.write(resolve(output, "browser-report.json"), `${JSON.stringify({schemaVersion:1, measuredAt:new Date().toISOString(), origin, checks, fatal:String(error)},null,2)}\n`);
	throw error;
} finally {
	await browser("close");
}
