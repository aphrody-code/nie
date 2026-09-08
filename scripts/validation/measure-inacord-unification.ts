/** Verify the command-by-command migration ledger for legacy Azalee tools. */
import { fileURLToPath } from "node:url";

import { createAzaleeProgram } from "../../packages/azalee-tools/src/cli/program";

type Status = "open" | "partial" | "complete";
type ParityGate = {
	command: string;
	status: "passing" | "failing";
	lastDifferences: number | null;
};
type Target = {
	rustLibrary: string | null;
	cliBinding: string | null;
	secondarySurfaces: string[];
	parityGates: ParityGate[];
};
type LedgerEntry = {
	name: string;
	status: Status;
	target: Target | null;
	notes: string;
};
type Ledger = {
	schemaVersion: number;
	source: {
		package: string;
		program: string;
		expectedTopLevelCommands: number;
		compatibilityTest: string;
	};
	completionRequirements: string[];
	commands: LedgerEntry[];
};

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const ledgerPath = fileURLToPath(new URL("../../docs/inacord-unification.json", import.meta.url));
const ledger = (await Bun.file(ledgerPath).json()) as Ledger;

if (ledger.schemaVersion !== 1) throw new Error(`unsupported ledger schema ${ledger.schemaVersion}`);

const sourceCommands = createAzaleeProgram().commands.map((command) => command.name());
const ledgerNames = ledger.commands.map((entry) => entry.name);
const duplicates = ledgerNames.filter((name, index) => ledgerNames.indexOf(name) !== index);
const missing = sourceCommands.filter((name) => !ledgerNames.includes(name));
const stale = ledgerNames.filter((name) => !sourceCommands.includes(name));

if (sourceCommands.length !== ledger.source.expectedTopLevelCommands) {
	throw new Error(
		`source command count changed: expected ${ledger.source.expectedTopLevelCommands}, found ${sourceCommands.length}`,
	);
}
if (duplicates.length > 0 || missing.length > 0 || stale.length > 0) {
	throw new Error(
		`ledger mismatch: duplicates=[${duplicates}] missing=[${missing}] stale=[${stale}]`,
	);
}

function hasCompletionEvidence(entry: LedgerEntry): boolean {
	const target = entry.target;
	return (
		target !== null &&
		target.rustLibrary !== null &&
		target.rustLibrary.length > 0 &&
		target.cliBinding !== null &&
		target.cliBinding.length > 0 &&
		target.secondarySurfaces.length > 0 &&
		target.parityGates.length > 0 &&
		target.parityGates.every((gate) => gate.status === "passing" && gate.lastDifferences === 0)
	);
}

for (const entry of ledger.commands) {
	if (entry.notes.trim().length === 0) throw new Error(`${entry.name}: migration note is empty`);
	if (entry.status === "complete" && !hasCompletionEvidence(entry)) {
		throw new Error(`${entry.name}: complete without all four evidence fields`);
	}
	for (const gate of entry.target?.parityGates ?? []) {
		if (gate.command.trim().length === 0) throw new Error(`${entry.name}: empty parity command`);
		if (gate.status === "passing" && gate.lastDifferences !== 0) {
			throw new Error(`${entry.name}: passing parity gate must report zero differences`);
		}
	}
}

const counts = Object.fromEntries(
	(["open", "partial", "complete"] as const).map((status) => [
		status,
		ledger.commands.filter((entry) => entry.status === status).length,
	]),
) as Record<Status, number>;
const incomplete = ledger.commands.filter((entry) => entry.status !== "complete");
const report = {
	measuredAt: new Date().toISOString(),
	repositoryRoot: repositoryRoot.replaceAll("\\", "/").replace(/\/$/, ""),
	sourceCommandCount: sourceCommands.length,
	ledgerCommandCount: ledger.commands.length,
	counts,
	incomplete: incomplete.map((entry) => entry.name),
};

if (Bun.argv.includes("--json")) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(
		`Inacord unification: ${counts.complete}/${ledger.commands.length} complete, ` +
			`${counts.partial} partial, ${counts.open} open`,
	);
	console.log(`Source and ledger commands: ${sourceCommands.length}/${ledger.commands.length}`);
}

if (Bun.argv.includes("--check") && incomplete.length > 0) {
	console.error(`Incomplete commands: ${incomplete.map((entry) => entry.name).join(", ")}`);
	process.exit(1);
}
