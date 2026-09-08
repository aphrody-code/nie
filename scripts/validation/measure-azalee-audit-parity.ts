/** Verify legacy Azalee and Rust CLI/MCP audit parity on one data snapshot. */
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
for (const path of [database, resolve(dataRoot, "all-gamedata/skills.json"), rustBinary, mcpBinary]) {
	if (!existsSync(path)) throw new Error(`Required audit input not found: ${path}`);
}

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
	if (exitCode !== 0) throw new Error(`Audit command exited ${exitCode}: ${stderr.trim()}`);
	return JSON.parse(stdout) as Json;
}

async function runMcp(): Promise<Json> {
	const child = Bun.spawn([mcpBinary], {
		cwd: root,
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
			clientInfo: { name: "azalee-audit-parity", version: "1" },
		},
	});
	await readResponse(1);
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send({
		jsonrpc: "2.0",
		id: 2,
		method: "tools/call",
		params: {
			name: "cli_wiki",
			arguments: { args: ["audit", "--db", database, "--data-root", dataRoot, "--json"] },
		},
	});
	const response = await readResponse(2);
	child.stdin.end();
	await child.exited;
	if (response.result?.structuredContent?.success !== true) throw new Error("MCP audit call failed");
	return JSON.parse(response.result.structuredContent.stdout ?? "null") as Json;
}

const legacy = await run(
	["bun", "packages/azalee-tools/src/cli.ts", "audit", "--json"],
	{ SQLITE_DB_PATH: database, DATA_ROOT: dataRoot },
);
const rust = await run([
	rustBinary,
	"wiki",
	"audit",
	"--db",
	database,
	"--data-root",
	dataRoot,
	"--json",
]);
const mcp = await runMcp();
const differences = Number(!Bun.deepEquals(legacy, rust, true)) + Number(!Bun.deepEquals(legacy, mcp, true));

const characters = (legacy as { characters?: { total?: number } }).characters?.total ?? 0;
const skills = (legacy as { skills?: { total?: number } }).skills?.total ?? 0;
console.log(`Azalee/Rust CLI/MCP audit parity: ${differences === 0 ? "PASS" : "FAIL"}`);
console.log(`Character records audited: ${characters}`);
console.log(`Skill records audited: ${skills}`);
console.log(`Differing outputs: ${differences}`);
if (differences > 0) process.exit(1);
