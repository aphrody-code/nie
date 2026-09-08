import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let directory: string;
const reference = resolve("data/menu/main_menu_alt.png");
async function command(args: string[]) {
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
	]);
	return { stdout, stderr, code };
}
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "niers-visual-gate-"));
	const result = await command(["magick", reference, "-resize", "1920x1080", join(directory, "capture.png")]);
	if (result.code !== 0) throw Error(result.stderr);
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("an identical image without element evidence fails delivery", async () => {
	const output = join(directory, "missing-elements");
	const result = await command(["bun", "scripts/validation/gate-menu.ts", join(directory, "capture.png"), reference, output]);
	expect(result.code).toBe(1);
	const report = await Bun.file(join(output, "report.json")).json();
	expect(report.metrics.grayscaleSsim).toBeCloseTo(1, 10);
	expect(report.metrics.rgbMeanAbsoluteDeltaNormalized).toBe(0);
	expect(report.failures).toContain("nonempty measured element evidence required");
	expect(report.acceptancePassed).toBe(false);
}, 15000);

test("image-level success cannot certify complete screen acceptance", async () => {
	const elements = join(directory, "elements.json");
	await Bun.write(elements, JSON.stringify([{ id: "whole-client", reference: { x: 0, y: 0, w: 1920, h: 1080 }, candidate: { x: 0, y: 0, w: 1920, h: 1080 } }]));
	const output = join(directory, "measured");
	const result = await command(["bun", "scripts/validation/gate-menu.ts", join(directory, "capture.png"), reference, output, elements]);
	expect(result.code).toBe(0);
	const report = await Bun.file(join(output, "report.json")).json();
	expect(report.visualPassed).toBe(true);
	expect(report.acceptancePassed).toBe(false);
	expect(report.elements).toHaveLength(1);
}, 15000);

test("unknown references cannot self-certify", async () => {
	const result = await command(["bun", "scripts/validation/gate-menu.ts", join(directory, "capture.png"), join(directory, "capture.png"), join(directory, "unknown")]);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("absent from the frozen PC inventory");
});
