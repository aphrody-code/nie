#!/usr/bin/env bun
/**
 * Synchronize verified inagle entries into `data/azalee/`.
 *
 * The legacy host adapter keeps these small verified entries as generated
 * repository data. The canonical source remains `packages/inagle`.
 *
 *     bun packages/azalee-tools/scripts/sync-inagle-entries.ts
 */

import path from "node:path";

const ENTRIES: Array<{ from: string; to: string }> = [
	{ from: "change_aura_skills.json", to: "change-aura-skills.json" },
];

const pkgRoot = path.resolve(import.meta.dir, "..");
const inagleEntries = path.resolve(pkgRoot, "../inagle/src/entries");

let changed = 0;
for (const entry of ENTRIES) {
	const src = Bun.file(path.join(inagleEntries, entry.from));
	if (!(await src.exists())) {
		console.error(`source absente: ${entry.from}`);
		process.exit(1);
	}
	const repoRoot = path.resolve(pkgRoot, "../..");
	const destPath = path.join(repoRoot, "data/azalee", entry.to);
	const before = await Bun.file(destPath)
		.text()
		.catch(() => "");
	const after = await src.text();
	if (before !== after) {
		await Bun.write(destPath, after);
		changed++;
	}
	console.log(`${entry.to} ${before === after ? "à jour" : "mis à jour"}`);
}
console.log(`entries=${ENTRIES.length} changed=${changed}`);
