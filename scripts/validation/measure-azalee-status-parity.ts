/** Verify legacy Azalee and Rust CLI/MCP status parity while ignoring volatile measurements. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type RecordJson = { [key: string]: unknown };
type McpResponse = {
	id?: number;
	result?: { structuredContent?: { success?: boolean; stdout?: string } };
};

function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const database = resolve(option("--db") ?? process.env.NIE_WIKI_DB ?? "");
const redisUrl = option("--redis-url") ?? "redis://127.0.0.1:6379/0";
const rustBinary = resolve(option("--niers") ?? "target/debug/niers");
const mcpBinary = resolve(option("--mcp") ?? "target/debug/nie-mcp");
if (!option("--db") && !process.env.NIE_WIKI_DB) throw new Error("usage: --db <sqlite>");
for (const path of [database, rustBinary, mcpBinary]) {
	if (!existsSync(path)) throw new Error(`Required status input not found: ${path}`);
}

const root = resolve(import.meta.dir, "../..");
async function run(command: string[], environment: Record<string, string> = {}): Promise<RecordJson> {
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
	if (exitCode !== 0) throw new Error(`Status command exited ${exitCode}: ${stderr.trim()}`);
	return JSON.parse(stdout) as RecordJson;
}

async function runMcp(): Promise<RecordJson> {
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
	send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "azalee-status-parity", version: "1" } } });
	await readResponse(1);
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cli_wiki", arguments: { args: ["status", "--db", database, "--redis-url", redisUrl, "--json"] } } });
	const response = await readResponse(2);
	child.stdin.end();
	await child.exited;
	if (response.result?.structuredContent?.success !== true) {
		throw new Error(`MCP status call failed: ${JSON.stringify(response)}`);
	}
	return JSON.parse(response.result.structuredContent.stdout ?? "null") as RecordJson;
}

function validate(report: RecordJson): void {
	const strings = [
		(report.sqlite as RecordJson).fileSize,
		(report.redis as RecordJson).latency,
		((report.process as RecordJson).memory as RecordJson).heapUsed,
		((report.process as RecordJson).memory as RecordJson).rss,
		(report.process as RecordJson).uptime,
		(report.system as RecordJson).totalMemory,
		(report.system as RecordJson).freeMemory,
	];
	for (const value of strings) {
		if (typeof value !== "string" || !/^\d+(?:\.\d+)?(?:ms|s| MB| GB)$/.test(value)) {
			throw new Error(`Invalid volatile status measurement: ${String(value)}`);
		}
	}
}

function normalized(report: RecordJson): RecordJson {
	const copy = structuredClone(report);
	(copy.redis as RecordJson).latency = "<latency>";
	(copy.process as RecordJson).uptime = "<uptime>";
	const memory = (copy.process as RecordJson).memory as RecordJson;
	memory.heapUsed = "<heap>";
	memory.rss = "<rss>";
	(copy.system as RecordJson).freeMemory = "<free>";
	return copy;
}

const keyTtlBefore = await runRedisCli("TTL", "niers:status:ping");
const legacy = await run(["bun", "packages/azalee-tools/src/cli.ts", "status", "--json"], { SQLITE_DB_PATH: database, REDIS_URL: redisUrl });
const rust = await run([rustBinary, "wiki", "status", "--db", database, "--redis-url", redisUrl, "--json"]);
const mcp = await runMcp();
const keyTtlAfter = await runRedisCli("TTL", "niers:status:ping");
for (const report of [legacy, rust, mcp]) validate(report);
const expected = normalized(legacy);
const differences = Number(!Bun.deepEquals(expected, normalized(rust), true)) + Number(!Bun.deepEquals(expected, normalized(mcp), true));
const redisMutations = Number(keyTtlBefore !== keyTtlAfter);

console.log(`Azalee/Rust CLI/MCP status parity: ${differences + redisMutations === 0 ? "PASS" : "FAIL"}`);
console.log("Status surfaces checked: 3");
console.log(`Differing normalized outputs: ${differences}`);
console.log(`Redis mutations: ${redisMutations}`);
if (differences + redisMutations > 0) process.exit(1);

async function runRedisCli(...args: string[]): Promise<string> {
	const child = Bun.spawn(["redis-cli", "-u", redisUrl, "--raw", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (exitCode !== 0) throw new Error(`redis-cli exited ${exitCode}: ${stderr.trim()}`);
	return stdout.trim();
}
