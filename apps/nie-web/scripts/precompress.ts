/**
 * Precompress the bundle as `.br` and `.zst` after the build.
 *
 * `nie-site` serves these variants directly (`routes/static_files.rs`): it negotiates
 * `Accept-Encoding`, serves the adjacent file when present, and never recompresses on demand.
 *
 * Build-time compression performs the expensive work once at maximum quality rather than once
 * per request at the lowest quality compatible with response latency.
 *
 * Write a variant only when it is smaller than the original.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants, zstdCompressSync } from "node:zlib";
import { isPrecompressionTarget } from "./precompression-targets";
import { assertNePubliePas, resolveBuildOutDir } from "./out-dir";
import { assertPublicEntryBundle } from "./public-entry-bundle";

// Une version en préparation est compressée AVANT de remplacer le bundle servi — c'est pourquoi
// le déploiement passe ici le chemin de sa version, et pourquoi ce chemin est vérifié : ce script
// réécrit des fichiers en place, et `apps/nie-web/dist` en argument atteindrait la production.
// `resolveBuildOutDir` porte la même vérification pour le cas par défaut.
const DIST = process.argv[2] ? resolve(process.argv[2]) : resolveBuildOutDir();
if (process.argv[2]) assertNePubliePas(DIST);

// Source maps are the emitted per-chunk module manifests. Check them before compression so each
// canonical build proves that the public readiness path stayed outside the React host.
assertPublicEntryBundle(DIST);

function filesIn(dir: string, accumulator: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) filesIn(path, accumulator);
		else if (isPrecompressionTarget(path)) {
			accumulator.push(path);
		}
	}
	return accumulator;
}

let writtenCount = 0;
let originalBytes = 0;
let brotliBytes = 0;

for (const file of filesIn(DIST)) {
	const raw = readFileSync(file);
	// Below about 1 KiB, compression headers and negotiation offset the size reduction.
	if (raw.length < 1024) continue;
	originalBytes += raw.length;

	const brotli = brotliCompressSync(raw, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
			[constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
		},
	});
	if (brotli.length < raw.length) {
		writeFileSync(`${file}.br`, brotli);
		writtenCount++;
		brotliBytes += brotli.length;
	} else {
		brotliBytes += raw.length;
	}

	const zstd = zstdCompressSync(raw);
	if (zstd.length < raw.length) {
		writeFileSync(`${file}.zst`, zstd);
		writtenCount++;
	}
}

const kibibytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
console.log(
	`precompression: ${writtenCount} files written · ${kibibytes(originalBytes)} -> ${kibibytes(brotliBytes)} with Brotli`
);
