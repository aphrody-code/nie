/** Verify legacy Azalee and Rust CLI/MCP team parity on one enriched snapshot. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Response = { id?: number; result?: { structuredContent?: { success?: boolean; stdout?: string } } };

function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const database = resolve(option("--db") ?? process.env.NIE_WIKI_DB ?? "");
const dataRoot = resolve(option("--data-root") ?? process.env.DATA_ROOT ?? "data");
const rustBinary = resolve(option("--niers") ?? "target/debug/niers");
const mcpBinary = resolve(option("--mcp") ?? "target/debug/nie-mcp");
if (!option("--db") && !process.env.NIE_WIKI_DB) throw new Error("usage: --db <sqlite>");
for (const path of [database, resolve(dataRoot, "all-gamedata/teams.json"), rustBinary, mcpBinary]) {
	if (!existsSync(path)) throw new Error(`Required team parity input not found: ${path}`);
}

const root = resolve(import.meta.dir, "../..");
const probes = ["0x4DC11E01", "Occulte", "Raimon", "definitely-no-team-match"];

async function run(command: string[], environment: Record<string, string> = {}): Promise<Json> {
	const child = Bun.spawn(command, {
		cwd: root,
		env: { ...Bun.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new globalThis.Response(child.stdout).text(),
		new globalThis.Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`Team command exited ${exitCode}: ${stderr.trim()}`);
	return JSON.parse(stdout) as Json;
}

async function runMcp(): Promise<Json[]> {
	const child = Bun.spawn([mcpBinary], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	const read = async (id: number): Promise<Response> => {
		while (true) {
			const newline = buffered.indexOf("\n");
			if (newline >= 0) {
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				if (line.trim().length === 0) continue;
				const response = JSON.parse(line) as Response;
				if (response.id === id) return response;
				continue;
			}
			// oxlint-disable-next-line eslint/no-await-in-loop -- one reader owns the ordered stream
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
		params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "azalee-team-parity", version: "1" } },
	});
	await read(1);
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
				arguments: { args: ["team", query, "--db", database, "--data-root", dataRoot, "--json"] },
			},
		});
		// oxlint-disable-next-line eslint/no-await-in-loop -- calls follow initialization in order
		const response = await read(id);
		if (response.result?.structuredContent?.success !== true) throw new Error("MCP team call failed");
		outputs.push(JSON.parse(response.result.structuredContent.stdout ?? "null") as Json);
	}
	child.stdin.end();
	await child.exited;
	return outputs;
}

const mcpOutputs = await runMcp();
let differences = 0;
let records = 0;
for (const [index, query] of probes.entries()) {
	// oxlint-disable-next-line eslint/no-await-in-loop -- bounded pairs preserve canonical ordering
	const legacy = await run(
		["bun", "packages/azalee-tools/src/cli.ts", "team", query, "--json"],
		{ DATA_ROOT: dataRoot, SQLITE_DB_PATH: database },
	);
	// oxlint-disable-next-line eslint/no-await-in-loop -- compare each Rust output beside the oracle
	const rust = await run([
		rustBinary, "wiki", "team", query, "--db", database, "--data-root", dataRoot, "--json",
	]);
	records += Array.isArray(legacy) ? legacy.length : 1;
	if (!Bun.deepEquals(legacy, rust, true)) differences++;
	if (!Bun.deepEquals(legacy, mcpOutputs[index], true)) differences++;
}

console.log(`Azalee/Rust CLI/MCP team parity: ${differences === 0 ? "PASS" : "FAIL"}`);
console.log(`Branches checked: ${probes.length}`);
console.log(`Records compared: ${records}`);
console.log(`Differing outputs: ${differences}`);
if (differences > 0) process.exit(1);
