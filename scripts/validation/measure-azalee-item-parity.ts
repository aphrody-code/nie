/** Verify legacy Azalee and Rust CLI/MCP item parity on one enriched mirror. */
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

const database = resolve(option("--db") ?? process.env.NIE_WIKI_DB ?? "");
const dataRoot = resolve(option("--data-root") ?? process.env.DATA_ROOT ?? "data");
const rustBinary = resolve(option("--niers") ?? "target/debug/niers");
const mcpBinary = resolve(option("--mcp") ?? "target/debug/nie-mcp");
if (!option("--db") && !process.env.NIE_WIKI_DB) throw new Error("usage: --db <sqlite>");
for (const path of [database, rustBinary, mcpBinary]) {
	if (!existsSync(path)) throw new Error(`Required item parity input not found: ${path}`);
}

const root = resolve(import.meta.dir, "../..");
const probes = ["0x5F0F1EAC", "Guts Gear", "Boots", "definitely-no-item-match"];

async function run(command: string[], environment: Record<string, string> = {}): Promise<Json> {
	const child = Bun.spawn(command, {
		cwd: root,
		env: { ...Bun.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`Item command exited ${exitCode}: ${stderr.trim()}`);
	return JSON.parse(stdout) as Json;
}

async function runMcp(): Promise<Json[]> {
	const child = Bun.spawn([mcpBinary], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
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
			clientInfo: { name: "azalee-item-parity", version: "1" },
		},
	});
	await readResponse(1);
	send({ jsonrpc: "2.0", method: "notifications/initialized" });

	const outputs: Json[] = [];
	for (const [index, query] of probes.entries()) {
		const id = index + 2;
		send({
			jsonrpc: "2.0",
			id,
			method: "tools/call",
			params: {
				name: "cli_wiki",
				arguments: { args: ["item", query, "--db", database, "--json"] },
			},
		});
		// oxlint-disable-next-line eslint/no-await-in-loop -- calls follow initialization in protocol order
		const response = await readResponse(id);
		if (response.result?.structuredContent?.success !== true) throw new Error("MCP item call failed");
		outputs.push(JSON.parse(response.result.structuredContent.stdout ?? "null") as Json);
	}
	child.stdin.end();
	await child.exited;
	return outputs;
}

const mcpOutputs = await runMcp();
let differences = 0;
let returnedRecords = 0;
for (const [index, query] of probes.entries()) {
	// oxlint-disable-next-line eslint/no-await-in-loop -- bounded paired probes preserve source ordering
	const legacy = await run(
		["bun", "packages/azalee-tools/src/cli.ts", "item", query, "--json"],
		{ DATA_ROOT: dataRoot, SQLITE_DB_PATH: database },
	);
	// oxlint-disable-next-line eslint/no-await-in-loop -- compare each Rust output beside its legacy oracle
	const rust = await run([rustBinary, "wiki", "item", query, "--db", database, "--json"]);
	returnedRecords += Array.isArray(legacy) ? legacy.length : 1;
	if (!Bun.deepEquals(legacy, rust, true)) differences++;
	if (!Bun.deepEquals(legacy, mcpOutputs[index], true)) differences++;
}

console.log(`Azalee/Rust CLI/MCP item parity: ${differences === 0 ? "PASS" : "FAIL"}`);
console.log(`Branches checked: ${probes.length}`);
console.log(`Records compared: ${returnedRecords}`);
console.log(`Differing outputs: ${differences}`);
if (differences > 0) process.exit(1);
