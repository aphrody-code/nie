#!/usr/bin/env bun
/** Capture actual browser states and provenance without treating them as fidelity passes.
 * Usage: bun scripts/validation/live-fidelity-audit.ts <origin> [output-directory]
 * Oracle matching and OS-window crops must be reviewed separately; attachments may show the site.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { hostname } from "node:os";
import { coverageFailures, type InventoryReference } from "./menu-acceptance";
import { menuCapturePlan, type CapturePlanRow } from "./menu-capture-plan";

const origin = process.argv[2];
if (!origin) throw new Error("Expected an origin");
const output = resolve(process.argv[3] ?? "var/outputs/fidelity-audit-20260908");
const session = `niers-fidelity-${process.pid}`;
const captures: Record<string, unknown>[] = [];
const flows: Record<string, unknown>[] = [];
const inputs: { at: string; command: string[] }[] = [];
const inventoryPath = new URL("../../data/menu/screen-inventory.json", import.meta.url);
const inventory = await Bun.file(inventoryPath).json() as { entries: InventoryReference[] };
const plan = menuCapturePlan(inventory.entries);
const rows = plan.map(row => ({ ...row, captured: false, failures: [...row.unresolved], evidence: null as string | null }));
const runFailures: string[] = [];
const startedAt = new Date().toISOString();
const digest = async (path: string | URL) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
const sourceScriptSha256 = await digest(import.meta.path);
const sourceCapturePlanSha256 = await digest(new URL("./menu-capture-plan.ts", import.meta.url));
const sourceInventorySha256 = await digest(inventoryPath);
async function sourceCommand(args: string[]): Promise<string> {
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [value, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${error}`);
	return value.trim();
}
const sourceRevision = await sourceCommand(["git", "rev-parse", "HEAD"]);
const sourceStatus = await sourceCommand(["git", "status", "--porcelain"]);

async function browser(...args: string[]): Promise<any> {
	if (args.some(arg => ["open", "press", "click", "set"].includes(arg))) inputs.push({ at: new Date().toISOString(), command: args });
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
		`({path:location.pathname,phase:document.querySelector('[data-opening-phase]')?.getAttribute('data-opening-phase')??null,menu:!!document.querySelector('[data-menu-target]'),avatarStage:document.querySelector('[data-avatar-stage]')?.getAttribute('data-avatar-stage')??null,locale:document.documentElement.lang,videos:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,readyState:v.readyState,paused:v.paused})),status:[...document.querySelectorAll('[role=status]')].map(e=>e.textContent)})`
	);
async function waitFor(source: string, timeout = 20000): Promise<void> {
	const start = Date.now();
	while (!(await evaluate(source))) {
		if (Date.now() - start > timeout) throw new Error(`Timed out: ${source}`);
		await Bun.sleep(80);
	}
}
async function capture(row: typeof rows[number]): Promise<void> {
	const name = `reference-${String(rows.indexOf(row) + 1).padStart(2, "0")}`;
	const before = await state();
	const path = resolve(output, `${name}.png`);
	await browser("screenshot", path);
	const after = await state();
	const sha256 = await digest(path);
	const provenance = await evaluate(
		`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};const images=[...document.images].map(e=>({src:e.currentSrc,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,rect:rect(e)}));const text=[...document.querySelectorAll('button,p,strong,small,h1,h2,span')].filter(e=>e.textContent.trim()&&rect(e).width>0&&rect(e).height>0).map(e=>({text:e.textContent.trim().slice(0,200),tag:e.tagName,fontFamily:getComputedStyle(e).fontFamily,fontSize:getComputedStyle(e).fontSize,rect:rect(e)}));const faces=[...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight,style:f.style}));const resources=performance.getEntriesByType('resource').filter(e=>/font|woff|ttf|otf|assets|wasm/i.test(e.name)).map(e=>({url:e.name,type:e.initiatorType,transferSize:e.transferSize}));const backgrounds=[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).backgroundImage!=='none').map(e=>({tag:e.tagName,class:e.className,backgroundImage:getComputedStyle(e).backgroundImage,rect:rect(e)}));return {images,text,faces,resources,backgrounds,canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,rect:rect(c),font:c.dataset.vfsFont,textReady:c.dataset.nativeTextReady,textError:c.dataset.nativeTextError,renderer:c.dataset.nativeRenderer,modelReady:c.dataset.modelReady})),svgCount:document.querySelectorAll('svg').length,viewport:[innerWidth,innerHeight]}})()`
	);
	captures.push({
		name,
		reference: row.reference.file,
		path, sha256,
		before,
		after,
		stableState: JSON.stringify(before) === JSON.stringify(after),
		provenance,
	});
	row.captured = true;
	row.evidence = path;
	if (JSON.stringify(before) !== JSON.stringify(after)) row.failures.push("Browser state changed during capture");
	const resourceFailures = await evaluate(`({brokenImages:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).length,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)})`);
	if (resourceFailures.brokenImages || resourceFailures.alerts.length) row.failures.push(`Resource failures: ${JSON.stringify(resourceFailures)}`);
	await Bun.write(resolve(output, "captures.json"), JSON.stringify(captures, null, 2) + "\n");
}

function matches(target: NonNullable<CapturePlanRow["target"]>): string {
	if (target.kind === "opening") return `!!document.querySelector('[data-opening-phase="${target.phase}"]')`;
	if (target.kind === "front") return `['/','/menu'].includes(location.pathname)&&!!document.querySelector('[data-menu-target]')`;
	return `location.pathname==='/avatar'&&!!document.querySelector('[data-avatar-stage="${target.stage}"]')`;
}
async function attempt(row: typeof rows[number], prepare?: () => Promise<void>): Promise<void> {
	try {
		if (!row.target) return;
		if (prepare) await prepare();
		await waitFor(matches(row.target), 12000);
		if (row.target.kind !== "opening") {
			try { await waitFor(`[...document.images].every(i=>i.complete&&i.naturalWidth>0)`, 12000); }
			catch { row.failures.push("Image resources did not become ready before capture"); }
			try { await waitFor(`document.querySelectorAll('canvas[data-vfs-font]').length>0&&[...document.querySelectorAll('canvas[data-vfs-font]')].every(c=>c.dataset.nativeTextReady==='true')`, 12000); }
			catch { row.failures.push("Native bitmap text did not become ready before capture"); }
			if (row.target.kind === "avatar") {
				try { await waitFor(`!!document.querySelector('canvas[data-native-renderer][data-model-ready="true"]')`, 12000); }
				catch { row.failures.push("Model renderer did not report readiness before capture"); }
			}
		}
		await capture(row);
		if (!(await evaluate(matches(row.target)))) row.failures.push("Requested state no longer matched after screenshot");
	} catch (error) { row.failures.push(`Capture failed: ${String(error)}`); }
}

await mkdir(output, { recursive: true });
let requests: any[] = [];
try {
	await browser("--headed", "--webgpu", "--args", "--no-sandbox", "open", origin);
	await browser("set", "viewport", "1920", "1080");
	await browser("set", "media", "light");
	await browser("open", origin);
	for (const phase of ["loading", "inazuma-eleven", "level5", "autosave", "start"]) {
		for (const row of rows.filter(row => row.target?.kind === "opening" && row.target.phase === phase)) {
			await attempt(row, phase === "start" ? async () => {
				if (await evaluate(`!!document.querySelector('[data-opening-phase="autosave"]')`)) await browser("press", "Enter");
			} : undefined);
		}
	}
	for (const row of rows.filter(row => row.target?.kind === "front")) {
		await attempt(row, async () => {
			if (await evaluate(`!!document.querySelector('[data-opening-phase="start"]')`)) await browser("press", "Enter");
			if (!(await evaluate(matches({ kind: "front" })))) {
				await browser("open", new URL("/menu", origin).href);
				flows.push({ action: "Direct front-menu entry; does not prove opening progression", after: await state() });
			}
		});
	}
	// Direct entry keeps avatar coverage independent of a broken opening or front-menu action.
	await browser("open", new URL("/avatar", origin).href);
	for (const stage of ["style", "body", "hair", "clothes", "stats", "name"]) {
		for (const row of rows.filter(row => row.target?.kind === "avatar" && row.target.stage === stage)) {
			await attempt(row, async () => {
				await waitFor(`!!document.querySelector('[data-avatar-control="stage-${stage}"]')`, 12000);
				await browser("click", `[data-avatar-control="stage-${stage}"]`);
			});
		}
	}
	if (await evaluate(`!!document.querySelector('[data-avatar-stage]')`)) {
		await browser("press", "Escape");
		flows.push({ action: "Escape from final reachable avatar stage", after: await state() });
	}
} catch (error) { runFailures.push(String(error)); }
finally {
	try { requests = (await browser("network", "requests")).requests ?? []; }
	catch (error) { runFailures.push(`Request evidence unavailable: ${String(error)}`); }
	try { await browser("close"); } catch (error) { runFailures.push(`Browser close failed: ${String(error)}`); }
	const coverage = coverageFailures(inventory.entries, rows.filter(row => row.captured).map(row => row.reference.file));
	const failedRequests = requests.filter(r => r.status >= 400 || r.failed || r.failureText)
		.map(r => ({ url: r.url, status: r.status, error: r.failureText }));
	const artifactIdentity: { status: string; reason: string } = { status: "unverified", reason: "Browser origin has not been tied to a frozen build artifact" };
	const passed = rows.length > 0 && rows.every(row => row.captured && row.failures.length === 0)
		&& coverage.length === 0 && runFailures.length === 0 && failedRequests.length === 0 && artifactIdentity.status === "verified";
	const report = {
		schemaVersion: 2, startedAt, measuredAt: new Date().toISOString(), origin,
		host: hostname(), command: process.argv, sourceRevision, sourceStatus,
		scriptSha256: sourceScriptSha256, capturePlanSha256: sourceCapturePlanSha256, inventorySha256: sourceInventorySha256,
		artifactIdentity,
		viewport: [1920, 1080], references: rows, captures, flows, inputs,
		requestCount: requests.length, failedRequests, coverageFailures: coverage, runFailures,
		passed,
		fidelityClaim: "none; capture coverage does not establish state identity, visual metrics or interaction completion",
	};
	await Bun.write(resolve(output, "browser-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({ output, references: rows.length, captured: rows.filter(row => row.captured).length,
		missing: coverage.length, failedRows: rows.filter(row => row.failures.length).length, runFailures, passed }));
	process.exitCode = passed ? 0 : 1;
}
