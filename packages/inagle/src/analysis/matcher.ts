/**
 * Automated matcher between JSON game data and decompiled C source
 *
 * Finds correlations between:
 * - Hash IDs in JSON and constants in C
 * - String literals in C and text values in JSON
 * - Function names and config entry names
 */

import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

/**
 * Match result between JSON and C source
 */
export interface MatchResult {
	type: "hash" | "string" | "constant" | "function";
	jsonSource: string;
	jsonPath: string;
	jsonValue: string | number;
	cLine: number;
	cContext: string;
	confidence: number;
}

/**
 * Extracted data from JSON files
 */
export interface JsonData {
	file: string;
	hashIds: number[];
	strings: string[];
	entryNames: string[];
	constants: number[];
}

/**
 * Extracted data from C source
 */
export interface CSourceData {
	hexConstants: Map<string, number[]>; // hex string -> line numbers
	decConstants: Map<number, number[]>; // decimal value -> line numbers
	stringLiterals: Map<string, number[]>; // string -> line numbers
	functionNames: Map<string, number[]>; // function name -> line numbers
	identifiers: Map<string, number[]>; // identifier -> line numbers
}

/**
 * Stream-based C source analyzer for large files
 * Uses line-by-line reading to handle 100MB+ files
 */
export async function analyzeCSource(filePath: string): Promise<CSourceData> {
	const data: CSourceData = {
		hexConstants: new Map(),
		decConstants: new Map(),
		stringLiterals: new Map(),
		functionNames: new Map(),
		identifiers: new Map(),
	};

	const fileStream = createReadStream(filePath, { encoding: "utf8" });
	const rl = createInterface({
		input: fileStream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	let lineNum = 0;

	// Regex patterns
	const hexPattern = /0x[0-9a-fA-F]+/g;
	const decPattern = /\b(\d{5,10})\b/g; // 5-10 digit numbers (likely hash IDs)
	const stringPattern = /"([^"\\]|\\.)*"/g;
	const funcPattern =
		/^(?:void|int|uint|char|float|double|undefined\d*|longlong|ulonglong)\s+(\w+)\s*\(/;
	const identPattern = /\b([A-Z][A-Z0-9_]{3,})\b/g; // UPPERCASE_CONSTANTS

	for await (const line of rl) {
		lineNum++;

		// Extract hex constants
		for (const match of line.matchAll(hexPattern)) {
			const hex = match[0].toLowerCase();
			if (!data.hexConstants.has(hex)) {
				data.hexConstants.set(hex, []);
			}
			data.hexConstants.get(hex)?.push(lineNum);
		}

		// Extract large decimal constants (potential hash IDs)
		for (const match of line.matchAll(decPattern)) {
			const num = Number.parseInt(match[1], 10);
			if (num > 10000) {
				// Filter out small numbers
				if (!data.decConstants.has(num)) {
					data.decConstants.set(num, []);
				}
				data.decConstants.get(num)?.push(lineNum);
			}
		}

		// Extract string literals
		for (const match of line.matchAll(stringPattern)) {
			const str = match[0].slice(1, -1); // Remove quotes
			if (str.length > 2) {
				// Filter out tiny strings
				if (!data.stringLiterals.has(str)) {
					data.stringLiterals.set(str, []);
				}
				data.stringLiterals.get(str)?.push(lineNum);
			}
		}

		// Extract function definitions
		const funcMatch = funcPattern.exec(line);
		if (funcMatch) {
			const funcName = funcMatch[1];
			if (!data.functionNames.has(funcName)) {
				data.functionNames.set(funcName, []);
			}
			data.functionNames.get(funcName)?.push(lineNum);
		}

		// Extract uppercase identifiers (likely constants/enums)
		for (const match of line.matchAll(identPattern)) {
			const ident = match[1];
			if (!data.identifiers.has(ident)) {
				data.identifiers.set(ident, []);
			}
			data.identifiers.get(ident)?.push(lineNum);
		}
	}

	return data;
}

/**
 * Extract relevant data from a JSON file
 */
export async function analyzeJsonFile(filePath: string): Promise<JsonData> {
	const content = await readFile(filePath, "utf8");
	const json = JSON.parse(content);

	const data: JsonData = {
		file: filePath,
		hashIds: [],
		strings: [],
		entryNames: [],
		constants: [],
	};

	function traverse(obj: unknown, path = ""): void {
		if (obj === null || obj === undefined) return;

		if (typeof obj === "number") {
			// Check if it looks like a hash ID (large positive integer)
			if (Number.isInteger(obj) && obj > 100000) {
				data.hashIds.push(obj);
			}
			if (Number.isInteger(obj) && obj !== 0) {
				data.constants.push(obj);
			}
		} else if (typeof obj === "string") {
			if (obj.length > 1) {
				data.strings.push(obj);
			}
		} else if (Array.isArray(obj)) {
			for (let i = 0; i < obj.length; i++) {
				traverse(obj[i], `${path}[${i}]`);
			}
		} else if (typeof obj === "object") {
			for (const [key, value] of Object.entries(obj)) {
				// Collect entry names
				if (key === "Name" || key === "name" || key === "typeName") {
					if (typeof value === "string") {
						data.entryNames.push(value);
					}
				}
				// Collect hash IDs specifically
				if (key === "hashId" || key === "HashId" || key === "hash_id") {
					if (typeof value === "number") {
						data.hashIds.push(value);
					}
				}
				traverse(value, `${path}.${key}`);
			}
		}
	}

	traverse(json);

	// Dedupe
	data.hashIds = [...new Set(data.hashIds)];
	data.strings = [...new Set(data.strings)];
	data.entryNames = [...new Set(data.entryNames)];
	data.constants = [...new Set(data.constants)];

	return data;
}

/**
 * Recursively find all JSON files in a directory
 */
export async function findJsonFiles(dir: string, maxFiles = 1000): Promise<string[]> {
	const files: string[] = [];

	async function walk(currentDir: string): Promise<void> {
		if (files.length >= maxFiles) return;

		const entries = await readdir(currentDir, { withFileTypes: true });

		for (const entry of entries) {
			if (files.length >= maxFiles) break;

			const fullPath = join(currentDir, entry.name);

			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (entry.isFile() && entry.name.endsWith(".json")) {
				files.push(fullPath);
			}
		}
	}

	await walk(dir);
	return files;
}

/**
 * Find matches between JSON data and C source
 * Optimized to avoid O(n²) loops
 */
export function findMatches(jsonDataList: JsonData[], cData: CSourceData): MatchResult[] {
	const matches: MatchResult[] = [];

	// Pre-build normalized lookup maps for faster matching
	const normalizedFunctions = new Map<string, { name: string; lines: number[] }[]>();
	for (const [funcName, lines] of cData.functionNames) {
		const normalized = funcName.toLowerCase().replace(/[^a-z0-9]/g, "");
		if (normalized.length > 4) {
			if (!normalizedFunctions.has(normalized)) {
				normalizedFunctions.set(normalized, []);
			}
			normalizedFunctions.get(normalized)?.push({ name: funcName, lines });
		}
	}

	const normalizedIdentifiers = new Map<string, { name: string; lines: number[] }[]>();
	for (const [ident, lines] of cData.identifiers) {
		const normalized = ident.toLowerCase().replace(/[^a-z0-9]/g, "");
		if (normalized.length > 5) {
			if (!normalizedIdentifiers.has(normalized)) {
				normalizedIdentifiers.set(normalized, []);
			}
			normalizedIdentifiers.get(normalized)?.push({ name: ident, lines });
		}
	}

	for (const jsonData of jsonDataList) {
		// Match hash IDs (fast Map lookups)
		for (const hashId of jsonData.hashIds) {
			// Check hex format
			const hexStr = `0x${hashId.toString(16).padStart(8, "0")}`;
			const hexLines = cData.hexConstants.get(hexStr);
			if (hexLines && hexLines.length > 0) {
				matches.push({
					type: "hash",
					jsonSource: jsonData.file,
					jsonPath: "hashId",
					jsonValue: hashId,
					cLine: hexLines[0],
					cContext: hexStr,
					confidence: 0.9,
				});
			}

			// Check decimal format
			const decLines = cData.decConstants.get(hashId);
			if (decLines && decLines.length > 0) {
				matches.push({
					type: "hash",
					jsonSource: jsonData.file,
					jsonPath: "hashId",
					jsonValue: hashId,
					cLine: decLines[0],
					cContext: hashId.toString(),
					confidence: 0.7,
				});
			}
		}

		// Match entry names (using pre-built lookup maps)
		for (const entryName of jsonData.entryNames) {
			const normalized = entryName.toLowerCase().replace(/[^a-z0-9]/g, "");
			if (normalized.length <= 4) continue;

			// Exact match with functions
			const funcMatches = normalizedFunctions.get(normalized);
			if (funcMatches) {
				for (const fm of funcMatches) {
					matches.push({
						type: "function",
						jsonSource: jsonData.file,
						jsonPath: "entryName",
						jsonValue: entryName,
						cLine: fm.lines[0],
						cContext: fm.name,
						confidence: 0.7,
					});
				}
			}

			// Exact match with identifiers
			const identMatches = normalizedIdentifiers.get(normalized);
			if (identMatches) {
				for (const im of identMatches) {
					matches.push({
						type: "constant",
						jsonSource: jsonData.file,
						jsonPath: "entryName",
						jsonValue: entryName,
						cLine: im.lines[0],
						cContext: im.name,
						confidence: 0.8,
					});
				}
			}
		}

		// Match string literals (fast Map lookup)
		for (const str of jsonData.strings) {
			if (str.length < 4) continue;

			const lines = cData.stringLiterals.get(str);
			if (lines && lines.length > 0) {
				matches.push({
					type: "string",
					jsonSource: jsonData.file,
					jsonPath: "string",
					jsonValue: str,
					cLine: lines[0],
					cContext: `"${str}"`,
					confidence: 1.0,
				});
			}
		}
	}

	// Sort by confidence
	matches.sort((a, b) => b.confidence - a.confidence);

	return matches;
}

/**
 * Get a specific line from a large file
 */
export async function getLineFromFile(
	filePath: string,
	lineNumber: number,
	context = 2
): Promise<string> {
	const fileStream = createReadStream(filePath, { encoding: "utf8" });
	const rl = createInterface({
		input: fileStream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	const lines: string[] = [];
	let currentLine = 0;
	const startLine = Math.max(1, lineNumber - context);
	const endLine = lineNumber + context;

	for await (const line of rl) {
		currentLine++;
		if (currentLine >= startLine && currentLine <= endLine) {
			lines.push(`${currentLine}: ${line}`);
		}
		if (currentLine > endLine) {
			break;
		}
	}

	return lines.join("\n");
}

/**
 * Main workflow: analyze and find matches
 */
export async function runMatchWorkflow(options: {
	cSourcePath: string;
	jsonDir: string;
	maxJsonFiles?: number;
	onProgress?: (message: string) => void;
}): Promise<{
	cData: CSourceData;
	jsonDataList: JsonData[];
	matches: MatchResult[];
}> {
	const { cSourcePath, jsonDir, maxJsonFiles = 500, onProgress } = options;

	onProgress?.("Analyzing C source file...");
	const cData = await analyzeCSource(cSourcePath);
	onProgress?.(
		`Found ${cData.hexConstants.size} hex constants, ${cData.functionNames.size} functions`
	);

	onProgress?.("Finding JSON files...");
	const jsonFiles = await findJsonFiles(jsonDir, maxJsonFiles);
	onProgress?.(`Found ${jsonFiles.length} JSON files`);

	onProgress?.("Analyzing JSON files...");
	const jsonDataList: JsonData[] = [];
	let processed = 0;

	for (const file of jsonFiles) {
		try {
			const data = await analyzeJsonFile(file);
			jsonDataList.push(data);
			processed++;
			if (processed % 100 === 0) {
				onProgress?.(`Processed ${processed}/${jsonFiles.length} JSON files`);
			}
		} catch {
			// Skip invalid JSON files
		}
	}

	onProgress?.("Finding matches...");
	const matches = findMatches(jsonDataList, cData);
	onProgress?.(`Found ${matches.length} potential matches`);

	return { cData, jsonDataList, matches };
}
