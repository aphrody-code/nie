#!/usr/bin/env bun
/** Compare an actual menu viewport with its reference. Outputs stay outside the public bundle.
 * Usage: bun scripts/validation/gate-menu.ts <capture.png> [reference.png] [output-directory] [elements.json]
 * Missing element evidence and visual mismatches fail the delivery gate.
 */
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { hostname } from "node:os";
import { grayscaleSsim } from "./image-metrics";
import { geometryFailures, MENU_ACCEPTANCE, validRect, visualFailures, type InventoryReference, type MeasuredRect } from "./menu-acceptance";

interface ElementEvidence {
	id: string;
	reference: MeasuredRect;
	candidate: MeasuredRect;
}

async function command(args: string[]): Promise<Uint8Array> {
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [output, error, code] = await Promise.all([
		new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited,
	]);
	if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${error}`);
	return new Uint8Array(output);
}

async function dimensions(path: string): Promise<number[]> {
	return new TextDecoder().decode(await command(["magick", "identify", "-format", "%w %h", path]))
		.trim().split(/\s+/u).map(Number);
}

async function main(): Promise<void> {
	const capture = process.argv[2];
	if (!capture) throw new Error("Usage: gate-menu.ts <capture.png> [reference.png] [output-directory]");
	const reference = resolve(process.argv[3] ?? "data/menu/main_menu_alt.png");
	const output = resolve(process.argv[4] ?? "var/outputs/menu-visual");
	const inventory = await Bun.file(new URL("../../data/menu/screen-inventory.json", import.meta.url)).json() as { entries: InventoryReference[] };
	const entry = inventory.entries.find((item) => item.file === basename(reference));
	if (!entry) throw new Error("Reference is absent from the frozen PC inventory");
	const crop = entry?.client_crop;
	const [captureDimensions, referenceDimensions] = await Promise.all([dimensions(capture), dimensions(reference)]);
	const [width, height] = captureDimensions;
	if (width !== 1920 || height !== 1080) throw new Error(`Expected 1920x1080 viewport capture; received ${width}x${height}`);
	const referenceWidth = crop?.w ?? referenceDimensions[0]!;
	const referenceHeight = crop?.h ?? referenceDimensions[1]!;
	if (crop && !validRect(crop, referenceDimensions[0], referenceDimensions[1])) throw new Error("Invalid recorded client crop");
	if (referenceDimensions.length !== 2 || referenceWidth / referenceHeight !== width / height) {
		throw new Error("Reference must have the same aspect ratio; no cropping or distortion is permitted");
	}
	await mkdir(output, { recursive: true });
	const normalizedReference = resolve(output, "reference-normalized.png");
	await command(["magick", reference, ...(crop ? ["-crop", `${crop.w}x${crop.h}+${crop.x}+${crop.y}`, "+repage"] : []), "-resize", `${width}x${height}`, normalizedReference]);
	const raw = (path: string, gray: boolean) => command([
		"magick", path, "-background", "white", "-alpha", "remove", "-alpha", "off",
		"-colorspace", gray ? "Gray" : "sRGB", "-depth", "8", gray ? "gray:-" : "rgb:-",
	]);
	const [a, b, grayA, grayB] = await Promise.all([
		raw(capture, false), raw(normalizedReference, false), raw(capture, true), raw(normalizedReference, true),
	]);
	if (a.length !== width * height * 3 || b.length !== a.length) throw new Error("Unexpected RGB byte count");
	let absoluteDelta = 0;
	let squaredDelta = 0;
	let changedPixels = 0;
	for (let i = 0; i < a.length; i += 3) {
		let changed = false;
		for (let channel = 0; channel < 3; channel++) {
			const delta = Math.abs(a[i + channel]! - b[i + channel]!);
			absoluteDelta += delta;
			squaredDelta += delta * delta;
			changed ||= delta !== 0;
		}
		if (changed) changedPixels++;
	}
	const digest = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
	const [captureSha256, referenceSha256] = await Promise.all([digest(capture), digest(reference)]);
	const metrics = {
		grayscaleSsim: grayscaleSsim(grayA, grayB, width, height),
		rgbMeanAbsoluteDelta: absoluteDelta / a.length,
		rgbMeanAbsoluteDeltaNormalized: absoluteDelta / a.length / 255,
		rgbRootMeanSquaredDelta: Math.sqrt(squaredDelta / a.length),
		changedPixels,
		changedPixelFraction: changedPixels / (width * height),
	};
	const failures = visualFailures(metrics);
	if (entry && entry.sha256 !== referenceSha256) failures.push("reference hash differs from the frozen inventory");
	const elements = process.argv[5] ? await Bun.file(process.argv[5]).json() as ElementEvidence[] : [];
	if (!Array.isArray(elements) || !elements.length) failures.push("nonempty measured element evidence required");
	const elementReports = [];
	const ids = new Set<string>();
	for (const element of Array.isArray(elements) ? elements : []) {
		if (!element || typeof element.id !== "string" || !element.id || ids.has(element.id)) {
			failures.push("element identities must be nonempty and unique");
			continue;
		}
		ids.add(element.id);
		const errors = geometryFailures(element.reference, element.candidate);
		if (!validRect(element.reference)) { failures.push(`${element.id}: invalid region`); continue; }
		// Compare at the reference position so displacement is not normalized away.
		const r = element.reference;
		const x = Math.floor(r.x), y = Math.floor(r.y), w = Math.ceil(r.x + r.w) - x, h = Math.ceil(r.y + r.h) - y;
		const ga = new Uint8Array(w * h), gb = new Uint8Array(w * h);
		let delta = 0;
		for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
			const index = (y + row) * width + x + col;
			ga[row * w + col] = grayA[index]!;
			gb[row * w + col] = grayB[index]!;
			for (let c = 0; c < 3; c++) delta += Math.abs(a[index * 3 + c]! - b[index * 3 + c]!);
		}
		const measured = { grayscaleSsim: grayscaleSsim(ga, gb, w, h), rgbMeanAbsoluteDelta: delta / (w * h * 3) };
		errors.push(...visualFailures(measured));
		failures.push(...errors.map((error) => `${element.id}: ${error}`));
		elementReports.push({ ...element, metrics: measured, failures: errors });
	}
	const report = {
		schemaVersion: 2,
		measuredAt: new Date().toISOString(),
		host: hostname(),
		command: ["bun", ...process.argv.slice(1)],
		sourceRevision: new TextDecoder().decode(await command(["git", "rev-parse", "HEAD"])).trim(),
		sourceDirty: (await command(["git", "diff", "--name-only", "HEAD"])).length > 0,
		candidateArtifactVerification: "Image hashes only; capture provenance must independently identify the running build",
		capture: resolve(capture), reference, captureSha256, referenceSha256, captureDimensions, referenceDimensions,
		normalization: "Recorded PC client crop only; proportional resize to 1920x1080; ImageMagick default resampling; alpha flattened on white",
		clientCrop: crop ?? null,
		excludedDynamicRegions: [],
		pixelCount: width * height,
		metrics,
		thresholds: MENU_ACCEPTANCE,
		elements: elementReports,
		failures,
		visualPassed: failures.length === 0,
		// Element lists are measurements supplied by the caller, not proof that every native
		// object has been identified. Only the corpus gate may certify complete coverage.
		acceptancePassed: false,
		fidelityClaim: "visual gate only; state provenance, complete element coverage and interaction evidence also required",
	};
	await command(["magick", capture, normalizedReference, "-compose", "difference", "-composite", resolve(output, "difference.png")]);
	await Bun.write(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report, null, 2));
	if (failures.length) process.exitCode = 1;
}

if (import.meta.main) await main();
