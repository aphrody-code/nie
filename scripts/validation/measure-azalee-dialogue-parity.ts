/** Verify legacy Azalee and Rust CLI/MCP dialogue parity on one story corpus. */
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

const dataRoot = resolve(option("--data-root") ?? process.env.DATA_ROOT ?? "data");
const database = resolve(dataRoot, "all-gamedata/story_text_database.json");
const rustBinary = resolve(option("--niers") ?? "target/debug/niers");
const mcpBinary = resolve(option("--mcp") ?? "target/debug/nie-mcp");
if (!existsSync(database)) throw new Error(`Story corpus not found: ${database}`);
if (!existsSync(rustBinary)) throw new Error(`Rust CLI not found: ${rustBinary}`);
if (!existsSync(mcpBinary)) throw new Error(`Rust MCP server not found: ${mcpBinary}`);

const root = resolve(import.meta.dir, "../..");
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
	if (exitCode !== 0) throw new Error(`Dialogue command exited ${exitCode}: ${stderr.trim()}`);
	return JSON.parse(stdout) as Json;
}

const probes = [
	["victory", "--limit", "3"],
	["", "--speaker", "Chester Horse", "--limit", "2"],
	["", "--speaker", "0XD667272A", "--limit", "2"],
	["definitely-no-dialogue-match", "--limit", "4"],
];

async function runMcp(): Promise<Json[]> {
	const child = Bun.spawn([mcpBinary], {
		cwd: root,
		env: { ...Bun.env, DATA_ROOT: dataRoot },
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
			clientInfo: { name: "azalee-dialogue-parity", version: "1" },
		},
	});
	await readResponse(1);
	send({ jsonrpc: "2.0", method: "notifications/initialized" });

	const outputs: Json[] = [];
	for (const [index, args] of probes.entries()) {
		const id = index + 2;
		send({
			jsonrpc: "2.0",
			id,
			method: "tools/call",
			params: {
				name: "cli_wiki",
				arguments: { args: ["dialogue", ...args, "--data-root", dataRoot, "--json"] },
			},
		});
		// oxlint-disable-next-line eslint/no-await-in-loop -- calls follow initialization in protocol order
		const response = await readResponse(id);
		if (response.result?.structuredContent?.success !== true) {
			throw new Error(`MCP dialogue call failed for probe ${index + 1}: ${JSON.stringify(response.result)}`);
		}
		outputs.push(JSON.parse(response.result.structuredContent.stdout ?? "null") as Json);
	}
	child.stdin.end();
	const exitCode = await child.exited;
	if (exitCode !== 0) throw new Error(`MCP server exited ${exitCode}`);
	return outputs;
}

const mcpOutputs = await runMcp();
let differences = 0;
let records = 0;
for (const [index, args] of probes.entries()) {
	// oxlint-disable-next-line eslint/no-await-in-loop -- bounded probes keep each legacy/Rust pair adjacent
	const legacy = await run(
		["bun", "packages/azalee-tools/src/cli.ts", "dialogue", ...args, "--json"],
		{ DATA_ROOT: dataRoot },
	);
	// oxlint-disable-next-line eslint/no-await-in-loop -- paired output is compared before the next corpus load
	const rust = await run([rustBinary, "wiki", "dialogue", ...args, "--data-root", dataRoot, "--json"]);
	if (Array.isArray(legacy)) records += legacy.length;
	if (!Bun.deepEquals(legacy, rust, true)) differences++;
	if (!Bun.deepEquals(legacy, mcpOutputs[index], true)) differences++;
}

console.log(`Azalee/Rust CLI/MCP dialogue parity: ${differences === 0 ? "PASS" : "FAIL"}`);
console.log(`Probes checked: ${probes.length}`);
console.log(`Records compared: ${records}`);
console.log(`Differing outputs: ${differences}`);
if (differences > 0) process.exit(1);
