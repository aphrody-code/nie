/** Verify legacy Azalee and Rust `db --json` parity on one SQLite snapshot. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type McpResponse = {
	id?: number;
	result?: { structuredContent?: { success?: boolean; stdout?: string } };
};
type McpOutcome = { success: boolean; output: Json | null };

function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const database = option("--db") ?? process.env.NIE_WIKI_DB ?? process.env.SQLITE_DB_PATH;
const rustBinary = resolve(option("--niers") ?? "target/debug/niers");
const mcpBinary = resolve(option("--mcp") ?? "target/debug/nie-mcp");
if (!database) throw new Error("usage: --db <sqlite> [--niers <binary>]");
if (!existsSync(database)) throw new Error(`SQLite snapshot not found: ${database}`);
if (!existsSync(rustBinary)) throw new Error(`Rust CLI not found: ${rustBinary}`);
if (!existsSync(mcpBinary)) throw new Error(`Rust MCP server not found: ${mcpBinary}`);

async function run(command: string[], environment: Record<string, string> = {}): Promise<Json> {
	const child = Bun.spawn(command, {
		cwd: resolve(import.meta.dir, "../.."),
		env: { ...Bun.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`${command[0]} exited ${exitCode}: ${stderr.trim()}`);
	return JSON.parse(stdout) as Json;
}

const queries = [
	"SELECT COUNT(*) AS count FROM sqlite_master",
	"SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name LIMIT 5",
	"WITH sample(value) AS (VALUES (NULL), (7), ('text')) SELECT value FROM sample",
	"PRAGMA user_version",
];

async function runMcp(sqlStatements: string[]): Promise<McpOutcome[]> {
	const child = Bun.spawn([mcpBinary], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
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
			// oxlint-disable-next-line eslint/no-await-in-loop -- one reader owns the ordered protocol stream
			const chunk = await reader.read();
			if (chunk.done) throw new Error(`MCP stdout closed before response ${id}`);
			buffered += decoder.decode(chunk.value, { stream: true });
		}
	};
	const send = (message: object) => {
		child.stdin.write(`${JSON.stringify(message)}\n`);
		child.stdin.flush();
	};

	send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "azalee-db-parity", version: "1" },
			},
	});
	await readResponse(1);
	send({ jsonrpc: "2.0", method: "notifications/initialized" });

	const results: McpOutcome[] = [];
	for (const [index, sql] of sqlStatements.entries()) {
		send({
			jsonrpc: "2.0",
			id: index + 2,
			method: "tools/call",
			params: {
				name: "cli_wiki",
				arguments: { args: ["db", sql, "--json", "--db", resolve(database)] },
			},
		});
		// oxlint-disable-next-line eslint/no-await-in-loop -- JSON-RPC calls must follow initialization in order
		const response = await readResponse(index + 2);
		const success = response.result?.structuredContent?.success === true;
		results.push({
			success,
			output: success
				? (JSON.parse(response.result?.structuredContent?.stdout ?? "null") as Json)
				: null,
		});
	}
	child.stdin.end();
	const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
	if (exitCode !== 0) throw new Error(`MCP server exited ${exitCode}: ${stderr.trim()}`);
	return results;
}

const mutation = "WITH doomed AS (SELECT 1) DELETE FROM inagle_characters RETURNING id";
const mcpOutcomes = await runMcp([...queries, mutation]);
let differingQueries = 0;

for (const [index, sql] of queries.entries()) {
	// oxlint-disable-next-line eslint/no-await-in-loop -- bounded sequential probes avoid four heavyweight legacy loaders
	const legacy = await run(
		["bun", "packages/azalee-tools/src/cli.ts", "db", sql, "--sqlite", "--json"],
		{ SQLITE_DB_PATH: resolve(database) },
	);
	// oxlint-disable-next-line eslint/no-await-in-loop -- keep paired outputs adjacent to the legacy probe
	const rust = await run([
		rustBinary,
		"wiki",
		"db",
		sql,
		"--json",
		"--db",
		resolve(database),
	]);
	if (
		!Bun.deepEquals(legacy, rust, true) ||
		mcpOutcomes[index]?.success !== true ||
		!Bun.deepEquals(legacy, mcpOutcomes[index]?.output ?? null, true)
	) {
		differingQueries++;
	}
}

async function rejected(command: string[], environment: Record<string, string> = {}): Promise<boolean> {
	const child = Bun.spawn(command, {
		cwd: resolve(import.meta.dir, "../.."),
		env: { ...Bun.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) return true;
	try {
		const output = JSON.parse(stdout) as Record<string, unknown>;
		return typeof output.error === "string";
	} catch {
		return false;
	}
}

const rejectedMutations = [
	await rejected(
		["bun", "packages/azalee-tools/src/cli.ts", "db", mutation, "--sqlite", "--json"],
		{ SQLITE_DB_PATH: resolve(database) },
	),
	await rejected([rustBinary, "wiki", "db", mutation, "--json", "--db", resolve(database)]),
	mcpOutcomes.at(-1)?.success === false,
].filter(Boolean).length;

console.log(`Azalee/Rust CLI/MCP db parity: ${differingQueries === 0 ? "PASS" : "FAIL"}`);
console.log(`Queries checked: ${queries.length}`);
console.log(`Differing queries: ${differingQueries}`);
console.log(`Mutation rejections: ${rejectedMutations}/3`);
if (differingQueries > 0 || rejectedMutations !== 3) process.exit(1);
