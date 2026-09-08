/** Compare the legacy Azalee and Rust `compare --json` contracts on one SQLite snapshot. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type McpResponse = {
	id?: number;
	result?: { structuredContent?: { success?: boolean; stdout?: string } };
};

function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const database = option("--db") ?? process.env.NIE_WIKI_DB ?? process.env.SQLITE_DB_PATH;
const left = option("--left");
const right = option("--right");
const level = option("--level") ?? "99";
const rustBinary = resolve(option("--niers") ?? "target/debug/niers");
const mcpBinary = resolve(option("--mcp") ?? "target/debug/nie-mcp");
const dataRoot = resolve(option("--data-root") ?? process.env.DATA_ROOT ?? "data");
const skipMcp = Bun.argv.includes("--skip-mcp");
const single = Bun.argv.includes("--single");

if (!database || !left || !right) {
	throw new Error("usage: --db <sqlite> --left <character> --right <character> [--level 1-99]");
}
if (!existsSync(database)) throw new Error(`SQLite snapshot not found: ${database}`);
if (!existsSync(rustBinary)) throw new Error(`Rust CLI not found: ${rustBinary}`);
if (!skipMcp && !existsSync(mcpBinary)) throw new Error(`Rust MCP server not found: ${mcpBinary}`);

async function run(command: string[], environment: Record<string, string> = {}): Promise<Json> {
	const process = Bun.spawn(command, {
		cwd: resolve(import.meta.dir, "../.."),
		env: { ...Bun.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`${command[0]} exited ${exitCode}: ${stderr.trim()}`);
	}
	return JSON.parse(stdout) as Json;
}

async function runMcp(leftQuery: string, rightQuery: string, probeLevel: string): Promise<Json> {
	const child = Bun.spawn([mcpBinary], {
		cwd: resolve(import.meta.dir, "../.."),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	const readResponse = async (id: number): Promise<McpResponse> => {
		while (true) {
			const newline = buffered.indexOf("\n");
			if (newline >= 0) {
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				if (line.trim().length === 0) continue;
				const response = JSON.parse(line) as McpResponse;
				if (response.id === id) return response;
				continue;
			}
			// oxlint-disable-next-line eslint/no-await-in-loop -- one reader owns the protocol stream
			const chunk = await reader.read();
			if (chunk.done) throw new Error(`MCP stdout closed before response ${id}`);
			buffered += decoder.decode(chunk.value, { stream: true });
		}
	};
	const send = (message: object) => {
		child.stdin.write(`${JSON.stringify(message)}\n`);
		child.stdin.flush();
	};
	send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "azalee-compare-parity", version: "1" } } });
	await readResponse(1);
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cli_wiki", arguments: { args: ["compare", leftQuery, rightQuery, "--level", probeLevel, "--db", resolve(database), "--data-root", dataRoot, "--json"] } } });
	const response = await readResponse(2);
	child.stdin.end();
	await child.exited;
	if (response.result?.structuredContent?.success !== true) throw new Error(`MCP compare failed: ${JSON.stringify(response)}`);
	return JSON.parse(response.result.structuredContent.stdout ?? "null") as Json;
}

function differingPaths(a: Json, b: Json, path = "$", differences: string[] = []): string[] {
	if (Object.is(a, b)) return differences;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) differences.push(`${path}.length`);
		for (let index = 0; index < Math.min(a.length, b.length); index++) {
			differingPaths(a[index], b[index], `${path}[${index}]`, differences);
		}
		return differences;
	}
	if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
		const aRecord = a as Record<string, Json>;
		const bRecord = b as Record<string, Json>;
		for (const key of new Set([...Object.keys(aRecord), ...Object.keys(bRecord)])) {
			if (!(key in aRecord) || !(key in bRecord)) differences.push(`${path}.${key}`);
			else differingPaths(aRecord[key], bRecord[key], `${path}.${key}`, differences);
		}
		return differences;
	}
	differences.push(path);
	return differences;
}

const initialLegacy = await run(
	["bun", "packages/azalee-tools/src/cli.ts", "compare", left, right, "--level", level, "--json"],
	{ SQLITE_DB_PATH: resolve(database) },
);
const initial = initialLegacy as { chara1?: { id?: string }; chara2?: { id?: string } };
const scenarios = (single ? [level] : [
	...new Set(["1", level, "99"]),
]).map((probeLevel) => ({ left, right, level: probeLevel }));
if (!single && initial.chara1?.id && initial.chara2?.id) {
	scenarios.push({ left: initial.chara1.id, right: initial.chara2.id, level: "50" });
}

let differenceCount = 0;
let cliDifferenceCount = 0;
let mcpDifferenceCount = 0;
const differing = new Set<string>();
for (const scenario of scenarios) {
	// oxlint-disable-next-line eslint/no-await-in-loop -- each oracle run is intentionally isolated
	const legacy = await run(["bun", "packages/azalee-tools/src/cli.ts", "compare", scenario.left, scenario.right, "--level", scenario.level, "--json"], { SQLITE_DB_PATH: resolve(database) });
	// oxlint-disable-next-line eslint/no-await-in-loop -- each CLI run is intentionally isolated
	const rust = await run([rustBinary, "wiki", "compare", scenario.left, scenario.right, "--level", scenario.level, "--json", "--db", resolve(database), "--data-root", dataRoot]);
	const paths = differingPaths(legacy, rust);
	cliDifferenceCount += paths.length;
	if (!skipMcp) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- MCP must execute the same shared binding
		const mcp = await runMcp(scenario.left, scenario.right, scenario.level);
		const mcpPaths = differingPaths(legacy, mcp);
		mcpDifferenceCount += mcpPaths.length;
		paths.push(...mcpPaths);
	}
	for (const path of paths) {
		differing.add(path);
		differenceCount++;
	}
}

console.log(`Azalee/Rust CLI${skipMcp ? "" : "/MCP"} compare parity: ${differenceCount === 0 ? "PASS" : "FAIL"}`);
console.log(`Scenarios checked: ${scenarios.length}`);
console.log(`Surface comparisons: ${scenarios.length * (skipMcp ? 1 : 2)}`);
console.log(`Differing JSON paths: ${differenceCount}`);
console.log(`CLI differences: ${cliDifferenceCount}`);
console.log(`MCP differences: ${mcpDifferenceCount}`);
if (differenceCount > 0) {
	console.log([...differing].slice(0, 50).join("\n"));
	process.exit(1);
}
