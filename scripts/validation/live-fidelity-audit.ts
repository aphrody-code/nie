#!/usr/bin/env bun
/** Capture actual browser states and provenance without treating them as fidelity passes.
 * Usage: bun scripts/validation/live-fidelity-audit.ts <origin> [output-directory]
 * Oracle matching and OS-window crops must be reviewed separately; attachments may show the site.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.argv[2];
if (!origin) throw new Error("Expected an origin");
const output = resolve(process.argv[3] ?? "var/outputs/fidelity-audit-20260908");
const session = `niers-fidelity-${process.pid}`;
const captures: Record<string, unknown>[] = [];
const flows: Record<string, unknown>[] = [];

async function browser(...args: string[]): Promise<any> {
	const child = Bun.spawn(["agent-browser", "--session", session, "--json", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`agent-browser ${args[0]}: ${stderr || stdout}`);
	const result = JSON.parse(stdout);
	if (!result.success) throw new Error(JSON.stringify(result.error));
	return result.data;
}
const evaluate = async (source: string) => (await browser("eval", source)).result;
const state = () =>
	evaluate(
		`({path:location.pathname,phase:document.querySelector('[data-opening-phase]')?.getAttribute('data-opening-phase')??null,menu:!!document.querySelector('[data-menu-target]'),status:[...document.querySelectorAll('[role=status]')].map(e=>e.textContent)})`
	);
async function waitFor(source: string, timeout = 20000): Promise<void> {
	const start = Date.now();
	while (!(await evaluate(source))) {
		if (Date.now() - start > timeout) throw new Error(`Timed out: ${source}`);
		await Bun.sleep(80);
	}
}
async function capture(name: string): Promise<void> {
	await waitFor(
		`document.getAnimations().every(a=>a.effect?.getTiming().iterations===Infinity||a.playState==='finished'||a.playState==='idle')`
	);
	const before = await state();
	const path = resolve(output, `${name}.png`);
	await browser("screenshot", path);
	const after = await state();
	const provenance = await evaluate(
		`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};const images=[...document.images].map(e=>({src:e.currentSrc,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,rect:rect(e)}));const text=[...document.querySelectorAll('button,p,strong,small,h1,h2,span')].filter(e=>e.textContent.trim()&&rect(e).width>0&&rect(e).height>0).map(e=>({text:e.textContent.trim().slice(0,200),tag:e.tagName,fontFamily:getComputedStyle(e).fontFamily,fontSize:getComputedStyle(e).fontSize,rect:rect(e)}));const faces=[...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight,style:f.style}));const resources=performance.getEntriesByType('resource').filter(e=>/font|woff|ttf|otf|assets|wasm/i.test(e.name)).map(e=>({url:e.name,type:e.initiatorType,transferSize:e.transferSize}));const backgrounds=[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).backgroundImage!=='none').map(e=>({tag:e.tagName,class:e.className,backgroundImage:getComputedStyle(e).backgroundImage,rect:rect(e)}));return {images,text,faces,resources,backgrounds,svgCount:document.querySelectorAll('svg').length,viewport:[innerWidth,innerHeight]}})()`
	);
	captures.push({
		name,
		path,
		before,
		after,
		stableState: JSON.stringify(before) === JSON.stringify(after),
		provenance,
	});
	await Bun.write(resolve(output, "captures.json"), JSON.stringify(captures, null, 2) + "\n");
}

await mkdir(output, { recursive: true });
try {
	await browser("--args", "--no-sandbox", "open", origin);
	await browser("set", "viewport", "1920", "1080");
	await browser("set", "media", "light");
	// Reopen after viewport setup so the startup states use the required dimensions.
	await browser("open", origin);
	for (const phase of ["loading", "inazuma-eleven", "level5", "autosave"]) {
		await waitFor(`!!document.querySelector('[data-opening-phase="${phase}"]')`);
		await capture(phase);
	}
	await browser("press", "Enter");
	await waitFor(`!!document.querySelector('[data-opening-phase="start"]')`);
	await capture("start");
	await browser("press", "Enter");
	await waitFor(
		`!!document.querySelector('[data-menu-target]')&&[...document.images].every(i=>i.complete&&i.naturalWidth>0)`
	);
	await capture("main-menu");
	await browser("click", '[data-menu-target="avatar"] button');
	await waitFor(
		`location.pathname==='/avatar'&&document.images.length>10&&[...document.images].every(i=>i.complete&&i.naturalWidth>0)`
	);
	await capture("avatar");
	await browser("press", "Escape");
	flows.push({ action: "Escape from avatar", after: await state() });
	if (await evaluate(`location.pathname==='/avatar'`)) {
		await browser("click", "header > button");
		flows.push({ action: "Header home from avatar", after: await state() });
		await Bun.sleep(300);
		flows.push({ action: "Header home from avatar after 300 ms", after: await state() });
	}
	const requests = (await browser("network", "requests")).requests ?? [];
	await Bun.write(
		resolve(output, "browser-audit.json"),
		JSON.stringify(
			{
				schemaVersion: 1,
				measuredAt: new Date().toISOString(),
				origin,
				viewport: [1920, 1080],
				captures,
				flows,
				requestCount: requests.length,
				failedRequests: requests
					.filter((r: any) => r.status >= 400 || r.failed || r.failureText)
					.map((r: any) => ({ url: r.url, status: r.status, error: r.failureText })),
				fidelityClaim: "none; matched PC oracle comparisons are required",
			},
			null,
			2
		) + "\n"
	);
	console.log(
		JSON.stringify({
			output,
			captures: captures.map((c) => ({ name: c.name, stableState: c.stableState })),
			flows,
			requestCount: requests.length,
		})
	);
} finally {
	await browser("close");
}
