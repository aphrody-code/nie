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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, zstdCompressSync } from "node:zlib";

// `URL.pathname` returns `/C:/Users/...` on Windows. `fileURLToPath` is portable.
const DIST = fileURLToPath(new URL("../dist", import.meta.url));

/** Extensions that normally benefit from compression. Images are already compressed. */
const TARGET_EXTENSIONS = [".js", ".css", ".html", ".json", ".svg", ".map", ".txt"];

function filesIn(dir: string, accumulator: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) filesIn(path, accumulator);
		else if (TARGET_EXTENSIONS.some((extension) => path.endsWith(extension))) {
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
