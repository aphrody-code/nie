/** Verify legacy Azalee and seeded Rust random-team contracts against the same SQLite pools. */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

interface TeamPlayer { id: string; name: string; element: string | null }
interface TeamStaff { id: number; name: string; element: string | null; playstyle: string | null; buff: string | null }
interface TeamReport {
	formation: string;
	gk: TeamPlayer[];
	df: TeamPlayer[];
	mf: TeamPlayer[];
	fw: TeamPlayer[];
	coach: TeamStaff | null;
	managers: TeamStaff[];
}
interface Scenario {
	name: string;
	args: string[];
	formation: string;
	counts: [number, number, number];
	element?: string;
	playstyle?: string;
}
interface McpResponse { id?: number; result?: { structuredContent?: { success?: boolean; stdout?: string } } }

function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const database = resolve(option("--db") ?? process.env.NIE_WIKI_DB ?? "");
const rustBinary = resolve(option("--niers") ?? "target/debug/niers");
const mcpBinary = resolve(option("--mcp") ?? "target/debug/nie-mcp");
if (!option("--db") && !process.env.NIE_WIKI_DB) throw new Error("usage: --db <sqlite>");
for (const path of [database, rustBinary, mcpBinary]) {
	if (!existsSync(path)) throw new Error(`Required random-team input not found: ${path}`);
}

const root = resolve(import.meta.dir, "../..");
const scenarios: Scenario[] = [
	{ args: [], counts: [4, 4, 2], formation: "4-4-2", name: "default" },
	{ args: ["--formation", "3-6-1"], counts: [3, 6, 1], formation: "3-6-1", name: "formation" },
	{ args: ["--formation", "invalid"], counts: [4, 4, 2], formation: "4-4-2", name: "invalid fallback" },
	{ args: ["--element", "fire", "--playstyle", "bond"], counts: [4, 4, 2], element: "Feu", formation: "4-4-2", name: "aliases", playstyle: "Bond" },
	{ args: ["--element", "unknown", "--playstyle", "unknown"], counts: [4, 4, 2], formation: "4-4-2", name: "unknown filters" },
];

async function run(command: string[], environment: Record<string, string> = {}): Promise<TeamReport> {
	const child = Bun.spawn(command, { cwd: root, env: { ...Bun.env, ...environment }, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (exitCode !== 0) throw new Error(`random-team exited ${exitCode}: ${stderr.trim()}`);
	return JSON.parse(stdout) as TeamReport;
}

async function runMcp(args: string[]): Promise<TeamReport> {
	const child = Bun.spawn([mcpBinary], { cwd: root, stderr: "pipe", stdin: "pipe", stdout: "pipe" });
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
	send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "azalee-random-team-parity", version: "1" } } });
	await readResponse(1);
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cli_wiki", arguments: { args: ["random-team", "--db", database, ...args, "--json"] } } });
	const response = await readResponse(2);
	child.stdin.end();
	await child.exited;
	if (response.result?.structuredContent?.success !== true) throw new Error(`MCP random-team failed: ${JSON.stringify(response)}`);
	return JSON.parse(response.result.structuredContent.stdout ?? "null") as TeamReport;
}

const sqlite = new Database(database, { readonly: true });
const playerPositions = new Set(
	(sqlite.query("SELECT id, position FROM inagle_characters").all() as Array<{ id: string; position: string }>).map((row) => `${row.id}:${row.position}`),
);
const staffRoles = new Set(
	(sqlite.query("SELECT id, role FROM inagle_coordinators").all() as Array<{ id: number; role: string }>).map((row) => `${row.id}:${row.role}`),
);

function expectedPlayerIds(position: string, required: number, scenario: Scenario): Set<string> {
	const base = "SELECT id FROM inagle_characters WHERE position = ? AND stat_frappe IS NOT NULL AND zukan_hash IS NOT NULL";
	const select = (sql: string, params: string[]) => new Set(
		(sqlite.query(sql).all(...params) as Array<{ id: string }>).map((row) => row.id),
	);
	if (scenario.element || scenario.playstyle) {
		let sql = base;
		const params = [position];
		if (scenario.element) {
			sql += " AND element = ?";
			params.push(scenario.element);
		}
		if (scenario.playstyle) {
			sql += " AND json_extract(sheet_data, '$.playstyle') = ?";
			params.push(scenario.playstyle);
		}
		const filtered = select(sql, params);
		if (filtered.size >= required) return filtered;
	}
	if (scenario.playstyle && scenario.element) {
		const elementOnly = select(`${base} AND element = ?`, [position, scenario.element]);
		if (elementOnly.size >= required) return elementOnly;
	}
	return select(base, [position]);
}

function validate(team: TeamReport, scenario: Scenario): number {
	let failures = 0;
	const expectedRoot = ["coach", "df", "formation", "fw", "gk", "managers", "mf"];
	if (!Bun.deepEquals(Object.keys(team).sort(), expectedRoot, true)) failures++;
	if (team.formation !== scenario.formation) failures++;
	const lines: Array<[TeamPlayer[], string, number]> = [
		[team.gk, "Gardien", 1], [team.df, "Défenseur", scenario.counts[0]],
		[team.mf, "Milieu", scenario.counts[1]], [team.fw, "Attaquant", scenario.counts[2]],
	];
	for (const [players, position, count] of lines) {
		const expectedIds = expectedPlayerIds(position, count, scenario);
		if (players.length !== count || new Set(players.map((player) => player.id)).size !== count) failures++;
		for (const player of players) {
			if (!Bun.deepEquals(Object.keys(player).sort(), ["element", "id", "name"], true)) failures++;
			if (!playerPositions.has(`${player.id}:${position}`)) failures++;
			if (!expectedIds.has(player.id)) failures++;
		}
	}
	const staff = [team.coach, ...team.managers].filter((entry): entry is TeamStaff => entry !== null);
	if (team.coach === null || team.managers.length !== 3) failures++;
	for (const entry of staff) {
		if (!Bun.deepEquals(Object.keys(entry).sort(), ["buff", "element", "id", "name", "playstyle"], true)) failures++;
	}
	if (team.coach && !staffRoles.has(`${team.coach.id}:Coach`) && !staffRoles.has(`${team.coach.id}:Manager`)) failures++;
	for (const manager of team.managers) if (!staffRoles.has(`${manager.id}:Coordinator`)) failures++;
	return failures;
}

let contractFailures = 0;
let seededDifferences = 0;
for (const [index, scenario] of scenarios.entries()) {
	// oxlint-disable-next-line eslint/no-await-in-loop -- probes are intentionally isolated and ordered
	const legacy = await run(["bun", "packages/azalee-tools/src/cli.ts", "random-team", ...scenario.args, "--json"], { SQLITE_DB_PATH: database });
	const rustArgs = ["wiki", "random-team", "--seed", String(424242 + index), "--db", database, ...scenario.args, "--json"];
	// oxlint-disable-next-line eslint/no-await-in-loop -- probes are intentionally isolated and ordered
	const rust = await run([rustBinary, ...rustArgs]);
	// oxlint-disable-next-line eslint/no-await-in-loop -- MCP must observe the same built binding
	const mcp = await runMcp(["--seed", String(424242 + index), ...scenario.args]);
	contractFailures += validate(legacy, scenario) + validate(rust, scenario) + validate(mcp, scenario);
	seededDifferences += Number(!Bun.deepEquals(rust, mcp, true));
}
sqlite.close();

console.log(`Azalee/Rust CLI/MCP random-team parity: ${contractFailures + seededDifferences === 0 ? "PASS" : "FAIL"}`);
console.log(`Scenarios checked: ${scenarios.length}`);
console.log(`Contract checks: ${scenarios.length * 3}`);
console.log(`Contract failures: ${contractFailures}`);
console.log(`Seeded CLI/MCP differences: ${seededDifferences}`);
if (contractFailures + seededDifferences > 0) process.exit(1);
