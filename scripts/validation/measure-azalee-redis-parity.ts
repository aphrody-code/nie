/** Verify legacy Azalee and Rust CLI/MCP Redis parity on one isolated temporary key. */
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

const redisUrl = option("--redis-url") ?? "redis://127.0.0.1:6379/0";
const rustBinary = resolve(option("--niers") ?? "target/debug/niers");
const mcpBinary = resolve(option("--mcp") ?? "target/debug/nie-mcp");
if (!existsSync(rustBinary)) throw new Error(`Rust CLI not found: ${rustBinary}`);
if (!existsSync(mcpBinary)) throw new Error(`Rust MCP server not found: ${mcpBinary}`);

const key = `codex:inacord-parity:${process.pid}:${Date.now()}`;
const root = resolve(import.meta.dir, "../..");

async function runJson(command: string[], environment: Record<string, string> = {}): Promise<Json> {
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
	if (exitCode !== 0) throw new Error(`Parity command exited ${exitCode}: ${stderr.trim()}`);
	return JSON.parse(stdout) as Json;
}

async function legacy(...args: string[]): Promise<Json> {
	return runJson(
		["bun", "packages/azalee-tools/src/cli.ts", "redis", ...args, "--json"],
		{ REDIS_URL: redisUrl },
	);
}

async function rust(...args: string[]): Promise<Json> {
	return runJson([rustBinary, "wiki", "redis", ...args, "--redis-url", redisUrl, "--json"]);
}

async function redisCli(...args: string[]): Promise<string> {
	const child = Bun.spawn(["redis-cli", "-u", redisUrl, "--raw", ...args], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`redis-cli exited ${exitCode}`);
	return stdout.trim();
}

async function withMcp<T>(probe: (call: (...args: string[]) => Promise<Json>) => Promise<T>): Promise<T> {
	const child = Bun.spawn([mcpBinary], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	let nextId = 1;
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
		id: nextId,
		method: "initialize",
		params: {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "azalee-redis-parity", version: "1" },
		},
	});
	await readResponse(nextId++);
	send({ jsonrpc: "2.0", method: "notifications/initialized" });

	const call = async (...args: string[]): Promise<Json> => {
		const id = nextId++;
		send({
			jsonrpc: "2.0",
			id,
			method: "tools/call",
			params: {
				name: "cli_wiki",
				arguments: { args: ["redis", ...args, "--redis-url", redisUrl, "--json"] },
			},
		});
		const response = await readResponse(id);
		if (response.result?.structuredContent?.success !== true) {
			throw new Error(`MCP Redis call failed: ${JSON.stringify(response.result)}`);
		}
		return JSON.parse(response.result.structuredContent.stdout ?? "null") as Json;
	};

	try {
		return await probe(call);
	} finally {
		child.stdin.end();
		await child.exited;
	}
}

let comparisons = 0;
let differences = 0;
let ttlChecks = 0;
const compare = (left: Json, right: Json) => {
	comparisons++;
	if (!Bun.deepEquals(left, right, true)) differences++;
};
const checkTtl = async () => {
	ttlChecks++;
	const ttl = Number.parseInt(await redisCli("TTL", key), 10);
	if (ttl < 1 || ttl > 3600) differences++;
};

try {
	await redisCli("DEL", key);
	await withMcp(async (mcp) => {
		const missing = await legacy("get", key);
		compare(missing, await rust("get", key));
		compare(missing, await mcp("get", key));

		const objectValue = JSON.stringify({ probe: 7, ok: true, nested: ["a", 2] });
		const legacySet = await legacy("set", key, objectValue);
		compare(legacySet, await rust("set", key, objectValue));
		compare(legacySet, await mcp("set", key, objectValue));
		await checkTtl();
		const legacyObject = await legacy("get", key);
		compare(legacyObject, await rust("get", key));
		compare(legacyObject, await mcp("get", key));

		await rust("set", key, "plain-text");
		await checkTtl();
		const legacyString = await legacy("get", key);
		compare(legacyString, await rust("get", key));
		compare(legacyString, await mcp("get", key));

		const arrayValue = JSON.stringify([1, "two", false]);
		await mcp("set", key, arrayValue);
		await checkTtl();
		const legacyArray = await legacy("get", key);
		compare(legacyArray, await rust("get", key));
		compare(legacyArray, await mcp("get", key));

		const legacyDel = await legacy("del", key);
		compare(legacyDel, await rust("del", key));
		compare(legacyDel, await mcp("del", key));
		compare(missing, await rust("get", key));
		compare(missing, await mcp("get", key));
	});
} finally {
	await redisCli("DEL", key);
}

console.log(`Azalee/Rust CLI/MCP redis parity: ${differences === 0 ? "PASS" : "FAIL"}`);
console.log(`Comparisons: ${comparisons}`);
console.log(`TTL checks: ${ttlChecks}`);
console.log(`Differences: ${differences}`);
console.log("Temporary keys remaining: 0");
if (differences > 0) process.exit(1);
