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
const expected = await Bun.file(new URL("../../crates/engine/nie-formats/src/menu_scenes/title-menu.json", import.meta.url)).json();
const destinations: Record<string, string> = { settings: "/settings", avatar: "/avatar" };
const selector = (id: string) => '[data-menu-target="' + id + '"] button';
try {
	await browser("--headed", "--webgpu", "--args", "--no-sandbox", "open", origin);
	await browser("set", "viewport", "1920", "1080");
	await browser("open", new URL("/menu", origin).href);
	await waitFor('!!document.querySelector("[data-menu-target]")');
	const controls = await evaluate('Array.from(document.querySelectorAll("[data-menu-target]")).map(e=>({id:e.dataset.menuTarget,hash:e.dataset.nativeAction??null,host:e.dataset.hostAction??null,disabled:e.querySelector("button").disabled}))');
	check("native controls match the compiled inventory in order", JSON.stringify(controls.map((c:any)=>c.id)), JSON.stringify(expected.controls.map((c:any)=>c.id)));
	check("eleven native tiles and avatar banner", controls.length, 12);
	for (const item of expected.controls) {
		const actual = controls.find((c:any)=>c.id===item.id);
		check(item.id + " native action hash", actual?.hash, item.nativeActionHash == null ? null : String(item.nativeActionHash));
		check(item.id + " host binding", actual?.host, item.hostActionId ?? null);
		check(item.id + " enabled only with real host destination", actual?.disabled, !Object.hasOwn(destinations, item.hostActionId ?? ""));
	}
	const enabled = expected.controls.filter((c:any)=>Object.hasOwn(destinations,c.hostActionId ?? ""));
	check("nonzero implemented native actions", enabled.length > 0, true);
	await waitFor('document.querySelector(".runtime-main-menu__asset-state")?.dataset.state !== "loading"');
	check("all visible native resources loaded", await evaluate('document.querySelector(".runtime-main-menu__asset-state")?.dataset.state'), "ready");
	for (const [index, item] of enabled.entries()) {
		await browser("open", new URL("/menu", origin).href);
		await waitFor('!!document.querySelector("[data-menu-target]")');
		await browser("hover", selector(item.id));
		await waitFor('document.activeElement?.closest("[data-menu-target]")?.dataset.menuTarget === ' + JSON.stringify(item.id));
		check(item.id + " hover updates keyboard focus", await focus(), item.id);
		const point=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector(item.id))+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
		await browser("mouse", "move", String(Math.round(point.x)), String(Math.round(point.y)));
		await browser("mouse", "down");
		check(item.id + " pointer pressed state", await evaluate('document.querySelector('+JSON.stringify(selector(item.id))+').dataset.state'), "pressed");
		await browser("mouse", "move", "1", "1");
		await browser("mouse", "up");
		check(item.id + " outside release cancels activation", await phase(), "menu");
		check(item.id + " pressed state cleared", await evaluate('document.querySelectorAll("[data-menu-target] button[data-state=pressed]").length'), 0);
		if (index === 0) await touch(selector(item.id)); else await browser("click", selector(item.id));
		await waitFor('location.pathname === '+JSON.stringify(destinations[item.hostActionId]));
		check(item.id + " correct native destination", await evaluate("location.pathname"), destinations[item.hostActionId]);
		await browser("press", "Escape");
		await waitFor('!!document.querySelector("[data-menu-target]")');
		check(item.id + " Escape returns without opening replay", await phase(), "menu");
		await browser("back");
		await waitFor('location.pathname === '+JSON.stringify(destinations[item.hostActionId]));
		check(item.id + " history restores destination", await evaluate("location.pathname"), destinations[item.hostActionId]);
		await browser("forward");
		await waitFor('!!document.querySelector("[data-menu-target]")');
		check(item.id + " history returns directly to menu", await phase(), "menu");
	}

	const avatar = enabled.find((item:any)=>item.hostActionId === "avatar");
	if (avatar) {
		await browser("open", new URL("/menu", origin).href);
		await waitFor('!!document.querySelector("[data-menu-target]")');
		await browser("hover", selector(avatar.id));
		await waitFor('document.activeElement?.closest("[data-menu-target]")?.dataset.menuTarget === '+JSON.stringify(avatar.id));
		await evaluate('window.__menuPad={mapping:"standard",connected:true,index:0,id:"delivery",buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0]};Object.defineProperty(navigator,"getGamepads",{configurable:true,value:()=>[window.__menuPad]});true');
		await evaluate('window.__menuPad.buttons[0]={pressed:true,value:1};true');
		await waitFor('document.querySelector("[data-avatar-stage]")?.dataset.avatarStage === "style"');
		await Bun.sleep(250);
		check("held gamepad confirm enters avatar only once",await evaluate('document.querySelector("[data-avatar-stage]")?.dataset.avatarStage'),"style");
		await evaluate('window.__menuPad.buttons[0]={pressed:false,value:0};true');
		await Bun.sleep(100);
		await evaluate('window.__menuPad.buttons[1]={pressed:true,value:1};true');
		await waitFor('!!document.querySelector("[data-menu-target]")');
		await Bun.sleep(250);
		check("held gamepad cancel returns once without reaching START",await phase(),"menu");
		await evaluate('window.__menuPad.buttons[1]={pressed:false,value:0};true');
	}
	await waitFor('document.querySelector(".runtime-main-menu__asset-state")?.dataset.state === "ready"');
	await browser("screenshot", resolve(output, "capture.png"));
	const requests = (await browser("network", "requests")).requests ?? [];
	const failedRequests = requests.filter((r:any)=>r.status>=400||r.failed||r.failureText).map((r:any)=>({url:r.url,status:r.status,error:r.failureText}));
	check("nonzero requests", requests.length > 0, true);
	check("no failed requests", failedRequests.length, 0);
	const unbound = expected.controls.filter((c:any)=>!Object.hasOwn(destinations,c.hostActionId ?? "")).map((c:any)=>c.id);
	// A correct disabled state is not a completed native action.
	check("all in-scope native destinations implemented", unbound.length, 0);
	const report={schemaVersion:2,measuredAt:new Date().toISOString(),origin,viewport:[1920,1080],checks,
		passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,
		controls,unboundNativeActions:unbound,requests:requests.length,failedRequests,
		fidelityClaim:"none; complete corpus visual and state evidence required"};
	await Bun.write(resolve(output,"browser-report.json"),JSON.stringify(report,null,2)+"\n");
	console.log(JSON.stringify({passed:report.passed,failed:report.failed,unboundNativeActions:unbound,output},null,2));
	if(report.failed) process.exitCode=1;
} catch(error) {
	await Bun.write(resolve(output,"browser-report.json"),JSON.stringify({schemaVersion:2,measuredAt:new Date().toISOString(),origin,checks,fatal:String(error)},null,2)+"\n");
	throw error;
} finally { await browser("close"); }
