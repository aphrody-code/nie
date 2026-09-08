/** Verify legacy Azalee and Rust CLI/MCP skill parity across all skill families. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RpcResponse = { id?: number; result?: { structuredContent?: { success?: boolean; stdout?: string } } };

function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const dataRoot = resolve(option("--data-root") ?? process.env.DATA_ROOT ?? "data");
const rustBinary = resolve(option("--niers") ?? "target/debug/niers");
const mcpBinary = resolve(option("--mcp") ?? "target/debug/nie-mcp");
for (const path of [
	resolve(dataRoot, "all-gamedata/skills.json"),
	resolve(dataRoot, "all-gamedata/passives.json"),
	resolve(dataRoot, "all-gamedata/auras.json"),
	rustBinary,
	mcpBinary,
]) {
	if (!existsSync(path)) throw new Error(`Required skill parity input not found: ${path}`);
}

const root = resolve(import.meta.dir, "../..");
const probes = [
	"0x518BCA26",
	"whs00030",
	"Fire Tornado",
	"0x4574530C",
	"0xA17C3D72",
	"Boost chrono",
	"definitely-no-skill-match",
];

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
	if (exitCode !== 0) throw new Error(`Skill command exited ${exitCode}: ${stderr.trim()}`);
	return JSON.parse(stdout) as Json;
}

async function runMcp(): Promise<Json[]> {
	const child = Bun.spawn([mcpBinary], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	const read = async (id: number): Promise<RpcResponse> => {
		while (true) {
			const newline = buffered.indexOf("\n");
			if (newline >= 0) {
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				if (line.trim().length === 0) continue;
				const response = JSON.parse(line) as RpcResponse;
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
		params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "azalee-skill-parity", version: "1" } },
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
				arguments: { args: ["skill", query, "--data-root", dataRoot, "--json"] },
			},
		});
		// oxlint-disable-next-line eslint/no-await-in-loop -- calls follow initialization in order
		const response = await read(id);
		if (response.result?.structuredContent?.success !== true) throw new Error("MCP skill call failed");
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
	// oxlint-disable-next-line eslint/no-await-in-loop -- bounded pairs cover legacy family precedence
	const legacy = await run(
		["bun", "packages/azalee-tools/src/cli.ts", "skill", query, "--json"],
		{ DATA_ROOT: dataRoot },
	);
	// oxlint-disable-next-line eslint/no-await-in-loop -- compare each Rust output beside the oracle
	const rust = await run([rustBinary, "wiki", "skill", query, "--data-root", dataRoot, "--json"]);
	records += Array.isArray(legacy) ? legacy.length : 1;
	if (!Bun.deepEquals(legacy, rust, true)) differences++;
	if (!Bun.deepEquals(legacy, mcpOutputs[index], true)) differences++;
}

console.log(`Azalee/Rust CLI/MCP skill parity: ${differences === 0 ? "PASS" : "FAIL"}`);
console.log(`Branches checked: ${probes.length}`);
console.log(`Records compared: ${records}`);
console.log(`Differing outputs: ${differences}`);
if (differences > 0) process.exit(1);
