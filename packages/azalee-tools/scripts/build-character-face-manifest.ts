#!/usr/bin/env bun
/**
 * Generate `data/azalee/character-face-manifest.json`: base character codes
 * that have a real face container in the game CPK index.
 *
 * `getCharacterFaceUrl` construit toujours l'URL `icon_chr/face/{base}_l_{base}_1_l00.png`
 * (variant 1). Sans gate, tout perso sans face dans le dump déclenche un 404 silencieux
 * remplacé par le placeholder côté <Image onError> — ce qui masque le problème et
 * gaspille une requête. Ce manifest permet à `getCharacterFaceUrl` de renvoyer
 * directement `PLACEHOLDERS.character` quand le code est absent (azalee-3, plan §3 #10).
 *
 * Source: `data/azalee/cpk-index.ndjson.gz`, produced from the mounted game VFS.
 *
 * Run : `bun scripts/build-character-face-manifest.ts`
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveDataFile } from "../src/config";

/** Shared generated artifacts rooted at `data/azalee`. */
const DATA_DIR = path.resolve(import.meta.dir, "../../../data/azalee");

const indexPath = resolveDataFile("cpk-index.ndjson.gz");
if (!indexPath) {
	console.error("Missing data/azalee/cpk-index.ndjson.gz");
	process.exit(1);
}

const bases = new Set<string>();

for (const line of gunzipSync(readFileSync(indexPath)).toString("utf8").split("\n")) {
	if (!line) continue;
	const [vfsPath] = JSON.parse(line) as [string, string];
	const match = vfsPath.match(
		/^data\/dx11\/menu\/200_icon\/10_icon_chr\/face\/(.+)_l\.g4tx$/,
	);
	if (match?.[1]) bases.add(match[1]);
}

const sorted = [...bases].sort();
const out = path.join(DATA_DIR, "character-face-manifest.json");
await Bun.write(out, JSON.stringify(sorted, null, 0));

console.log(`Face base codes with variant-1: ${sorted.length}`);
console.log(`Written: ${out}`);
