/**
 * Extract CRC32 → function name mappings from decompiled Lua scripts
 *
 * The game uses CRC32 hashes to identify commands passed to funcLuaCommand()
 * This script extracts those mappings from the include files which define
 * named wrapper functions.
 */

/* eslint-disable no-console */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const LUA_UNLUAC_DIR = "C:/iecode/dump/data/lua-unluac";
const OUTPUT_PATH = "C:/iecode/dump/data/lua-command-mapping.json";

interface CommandMapping {
	crc32: number;
	crc32Hex: string;
	functionName: string;
	file: string;
	context?: string;
}

/**
 * Parse a Lua file to extract function → CRC32 mappings
 *
 * Pattern recognition:
 * 1. Named function assignment: `FunctionName = L0_1`
 * 2. CRC32 assignment before funcLuaCommand call: `L2_2 = 2215888030`
 */
function extractMappings(content: string, filename: string): CommandMapping[] {
	const mappings: CommandMapping[] = [];
	const lines = content.split("\n");

	// Track the current function name being defined
	let currentFunctionName: string | null = null;
	let inFunction = false;

	// Collect CRC32s found in the current function
	const currentCrc32s: { crc: number; line: number }[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detect function start
		if (line.match(/^function\s+L\d+_\d+/)) {
			inFunction = true;
			currentCrc32s.length = 0;
		}

		// Detect function end by looking for named assignment
		// Pattern: `FunctionName = L0_1`
		const funcAssign = line.match(/^(\w+)\s*=\s*L\d+_\d+\s*$/);
		if (funcAssign && !line.includes("function") && !line.includes("local")) {
			currentFunctionName = funcAssign[1];

			// All CRC32s collected belong to this function
			for (const { crc } of currentCrc32s) {
				mappings.push({
					crc32: crc,
					crc32Hex: `0x${(crc >>> 0).toString(16).toUpperCase().padStart(8, "0")}`,
					functionName: currentFunctionName,
					file: filename,
				});
			}

			currentCrc32s.length = 0;
			inFunction = false;
		}

		// Detect CRC32 assignment in function body
		// Pattern: `L2_2 = 2215888030` (large numbers are likely CRC32)
		if (inFunction) {
			const crcMatch = line.match(/L\d+_\d+\s*=\s*(\d{8,10})\s*$/);
			if (crcMatch) {
				const num = Number.parseInt(crcMatch[1], 10);
				// CRC32 hashes are typically > 1M and < 4.3B (uint32)
				if (num > 1_000_000 && num <= 4_294_967_295) {
					currentCrc32s.push({ crc: num, line: i });
				}
			}
		}
	}

	return mappings;
}

/**
 * Recursively scan directory for Lua files
 */
async function* walkDir(dir: string): AsyncGenerator<string> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkDir(fullPath);
		} else if (entry.name.endsWith(".lua")) {
			yield fullPath;
		}
	}
}

async function main() {
	console.log("🔍 Extracting Lua command mappings...\n");

	const allMappings: CommandMapping[] = [];
	let fileCount = 0;

	// Focus on include files first (they have the function definitions)
	const includeDir = join(LUA_UNLUAC_DIR, "common/script/lua/include");

	for await (const filePath of walkDir(includeDir)) {
		const content = await readFile(filePath, "utf-8");
		const filename = basename(filePath);
		const mappings = extractMappings(content, filename);
		allMappings.push(...mappings);
		fileCount++;

		if (mappings.length > 0) {
			console.log(`  📄 ${filename}: ${mappings.length} mappings`);
		}
	}

	// Build unique command map
	const uniqueCommands = new Map<number, string[]>();
	for (const m of allMappings) {
		let funcs = uniqueCommands.get(m.crc32);
		if (!funcs) {
			funcs = [];
			uniqueCommands.set(m.crc32, funcs);
		}
		if (!funcs.includes(m.functionName)) {
			funcs.push(m.functionName);
		}
	}

	// Create output object
	const output = {
		generatedAt: new Date().toISOString(),
		stats: {
			totalFiles: fileCount,
			totalMappings: allMappings.length,
			uniqueCrc32Count: uniqueCommands.size,
		},
		// Convert to a simple lookup object
		commandLookup: Object.fromEntries(
			[...uniqueCommands.entries()]
				.sort((a, b) => a[0] - b[0])
				.map(([crc, funcs]) => [
					`0x${(crc >>> 0).toString(16).toUpperCase().padStart(8, "0")}`,
					funcs.length === 1 ? funcs[0] : funcs,
				])
		),
		// Full mappings with file info
		allMappings: allMappings.map((m) => ({
			crc32Hex: m.crc32Hex,
			function: m.functionName,
			file: m.file,
		})),
	};

	await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));

	console.log("\n📊 Summary:");
	console.log(`   Files scanned: ${fileCount}`);
	console.log(`   Total mappings: ${allMappings.length}`);
	console.log(`   Unique CRC32s: ${uniqueCommands.size}`);
	console.log(`\n✅ Output saved to: ${OUTPUT_PATH}`);

	// Print some interesting findings
	console.log("\n🎮 Sample Command Mappings:");
	const samples = [...uniqueCommands.entries()].slice(0, 20);
	for (const [crc, funcs] of samples) {
		const hex = `0x${(crc >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
		console.log(`   ${hex}: ${funcs.join(", ")}`);
	}
}

main().catch(console.error);
