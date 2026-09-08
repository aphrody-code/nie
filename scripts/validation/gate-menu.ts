#!/usr/bin/env bun
/** Compare an actual menu viewport with its reference. Outputs stay outside the public bundle.
 * Usage: bun scripts/validation/gate-menu.ts <capture.png> [reference.png] [output-directory]
 * A measured report is not a fidelity pass: partial renders are expected to differ.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { grayscaleSsim } from "./image-metrics";

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
	const [captureDimensions, referenceDimensions] = await Promise.all([dimensions(capture), dimensions(reference)]);
	const [width, height] = captureDimensions;
	if (width !== 1920 || height !== 1080) throw new Error(`Expected 1920x1080 viewport capture; received ${width}x${height}`);
	if (referenceDimensions.length !== 2 || referenceDimensions[0]! / referenceDimensions[1]! !== width / height) {
		throw new Error("Reference must have the same aspect ratio; no cropping or distortion is permitted");
	}
	await mkdir(output, { recursive: true });
	const normalizedReference = resolve(output, "reference-normalized.png");
	await command(["magick", reference, "-resize", `${width}x${height}`, normalizedReference]);
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
	const report = {
		schemaVersion: 1,
		measuredAt: new Date().toISOString(),
		capture: resolve(capture), reference, captureSha256, referenceSha256, captureDimensions, referenceDimensions,
		normalization: "Reference resized proportionally to 1920x1080 using ImageMagick default resampling; alpha flattened on white; no crop",
		excludedDynamicRegions: [],
		pixelCount: width * height,
		metrics: {
			grayscaleSsim: grayscaleSsim(grayA, grayB, width, height),
			rgbMeanAbsoluteDelta: absoluteDelta / a.length,
			rgbRootMeanSquaredDelta: Math.sqrt(squaredDelta / a.length),
			changedPixels,
			changedPixelFraction: changedPixels / (width * height),
		},
		fidelityClaim: "none; measurement only, no acceptance threshold configured",
	};
	await command(["magick", capture, normalizedReference, "-compose", "difference", "-composite", resolve(output, "difference.png")]);
	await Bun.write(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) await main();
