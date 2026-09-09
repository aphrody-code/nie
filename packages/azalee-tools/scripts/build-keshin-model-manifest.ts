#!/usr/bin/env bun
/**
 * Generate `data/azalee/keshin-model-manifest.json`: the gate for complete
 * Keshin (`k<NNNNNN>`) and armour (`ka<NNNNNNNN>`) models present in the game CPK index.
 *
 * Source of truth is the local VFS index, not a database, Redis or an HTTP probe.
 * A code is kept only when its directory contains a `.g4md` descriptor, which
 * is the native input required by the Rust model assembler.
 *
 * Le viewer (`AuraDetail`, page `/keshin`) gate sur ce manifeste via
 * `getKeshinModelGlbUrl` / `getArmureModelGlbUrl` (src/lib/images/utils.ts).
 * Régénérer quand la couche serving gagne le support g4mg (les 92 keshin restants).
 *
 * Run : `bun scripts/build-keshin-model-manifest.ts`
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveDataFile } from "../src/config";

/** Shared generated artifacts rooted at `data/azalee`. */
const DATA_DIR = path.resolve(import.meta.dir, "../../../data/azalee");

function codesFromVfs(): { keshin: string[]; armd: string[] } {
	const indexPath = resolveDataFile("cpk-index.ndjson.gz");
	if (!indexPath) throw new Error("Missing data/azalee/cpk-index.ndjson.gz");
	const keshin = new Set<string>();
	const armd = new Set<string>();
	for (const line of gunzipSync(readFileSync(indexPath)).toString("utf8").split("\n")) {
		if (!line) continue;
		const [vfsPath] = JSON.parse(line) as [string, string];
		const k = vfsPath.match(/^data\/common\/chr\/_keshin\/(k\d+)\/[^/]+\.g4md$/);
		if (k?.[1]) keshin.add(k[1]);
		const a = vfsPath.match(/^data\/common\/chr\/_armd\/(ka\d+)\/[^/]+\.g4md$/);
		if (a?.[1]) armd.add(a[1]);
	}
	return { armd: [...armd].sort(), keshin: [...keshin].sort() };
}

const codes = codesFromVfs();
if (codes.keshin.length === 0 && codes.armd.length === 0) {
	console.error("Aucun code keshin/armd trouvé (ni Redis ni dump).");
	process.exit(1);
}

const manifest = { armures: codes.armd, keshin: codes.keshin };
const out = path.join(DATA_DIR, "keshin-model-manifest.json");
await Bun.write(out, JSON.stringify(manifest, null, 0));

console.log(`keshin descriptors: ${codes.keshin.length}`);
console.log(`armour descriptors: ${codes.armd.length}`);
console.log(`Written: ${out}`);
