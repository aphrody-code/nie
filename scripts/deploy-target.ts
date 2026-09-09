#!/usr/bin/env bun
/* eslint-disable no-await-in-loop -- Target health polling and deployments are deliberately ordered. */

import {
	chmod,
	copyFile,
	mkdir,
	readlink,
	rename,
	rm,
	symlink,
} from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const targetTimeoutMs = 60_000;
const runId = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const lockDirectory = "/tmp/niers-target-deploy.lock";
const logDirectory = `${repositoryRoot}/var/log/deploy-targets/${runId}`;

type Validator = (body: string) => void;
type Target = {
	description: string;
	deploy: (context: TargetContext) => Promise<void>;
};

type TargetContext = {
	commit: string;
	deadline: number;
	name: string;
	releaseDirectory: string;
};

process.chdir(repositoryRoot);

function output(value: Uint8Array | string): string {
	return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function capture(argv: string[]): string {
	const result = Bun.spawnSync(argv, { cwd: repositoryRoot, stderr: "pipe", stdout: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(`${argv.join(" ")} failed: ${output(result.stderr).trim()}`);
	}
	return output(result.stdout).trim();
}

function assertDeadline(context: TargetContext): number {
	const remaining = context.deadline - Date.now();
	if (remaining <= 0) throw new Error(`${context.name} exceeded its 60 second deadline.`);
	return remaining;
}

async function appendLog(context: TargetContext, text: string): Promise<void> {
	const path = `${logDirectory}/${context.name}.log`;
	const previous = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
	await Bun.write(path, `${previous}${text}`);
	await chmod(path, 0o600);
}

async function run(context: TargetContext, argv: string[], cwd = repositoryRoot): Promise<string> {
	const remainingSeconds = Math.max(0.1, assertDeadline(context) / 1_000).toFixed(3);
	const rendered = `$ ${argv.join(" ")}\n`;
	process.stdout.write(`    ${rendered}`);
	const child = Bun.spawn(
		[
			"timeout",
			"--foreground",
			"--signal=TERM",
			"--kill-after=2s",
			`${remainingSeconds}s`,
			...argv,
		],
		{ cwd, stderr: "pipe", stdout: "pipe" }
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	await appendLog(context, `${rendered}${stdout}${stderr}[exit ${exitCode}]\n`);
	if (stdout) process.stdout.write(stdout);
	if (stderr) process.stderr.write(stderr);
	if (exitCode === 124 || exitCode === 137) {
		throw new Error(`${context.name} exceeded its 60 second deadline.`);
	}
	if (exitCode !== 0) throw new Error(`${argv.join(" ")} failed with exit code ${exitCode}.`);
	assertDeadline(context);
	return stdout;
}

async function atomicCopy(source: string, destination: string): Promise<void> {
	const temporary = `${destination}.deploy-next-${runId}`;
	await copyFile(source, temporary);
	await chmod(temporary, 0o755);
	await rename(temporary, destination);
}

async function waitFor(
	context: TargetContext,
	url: string,
	validate: Validator
): Promise<void> {
	let lastError = "no response";
	while (Date.now() < context.deadline) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
			const body = await response.text();
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			validate(body);
			return;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			await Bun.sleep(250);
		}
	}
	throw new Error(`${url} did not become ready: ${lastError}`);
}

function requireBudget(context: TargetContext, milliseconds: number, action: string): void {
	if (context.deadline - Date.now() < milliseconds) {
		throw new Error(`${context.name} has insufficient time left to ${action} safely.`);
	}
}

function requireJsonObject(body: string): Record<string, unknown> {
	const value: unknown = JSON.parse(body);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Health response is not a JSON object.");
	}
	return value as Record<string, unknown>;
}

const healthyJson = (body: string) => {
	const value = requireJsonObject(body);
	if (value.ok !== true && value.status !== "healthy") {
		throw new Error("Health response does not report a ready service.");
	}
};

function validateSiteHealth(body: string): void {
	const value = requireJsonObject(body);
	if (value.api !== "v1") throw new Error("Site health does not report API v1.");
	const capabilities = value.capacites;
	if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
		throw new Error("Site health has no capability object.");
	}
	const ready = capabilities as Record<string, unknown>;
	if (
		ready.bundle !== true ||
		ready.vfs !== "pret" ||
		ready.vfs_contenu !== true ||
		Number(ready.vfs_entrees) < 1_000
	) {
		throw new Error("Site bundle or content-backed VFS is not ready.");
	}
}

async function installUnit(context: TargetContext, unit: string): Promise<void> {
	const source = `deploy/systemd/${unit}`;
	const installed = `/etc/systemd/system/${unit}`;
	const comparison = Bun.spawnSync(["cmp", "-s", source, installed]);
	if (comparison.exitCode === 0) return;
	await run(context, ["sudo", "install", "-m", "0644", source, installed]);
	await run(context, ["sudo", "systemctl", "daemon-reload"]);
}

async function restartUnit(
	context: TargetContext,
	unit: string,
	healthUrl: string,
	validate: Validator
): Promise<void> {
	requireBudget(context, 10_000, `restart and validate ${unit}`);
	await installUnit(context, unit);
	const oldPid = capture(["systemctl", "show", unit, "-p", "MainPID", "--value"]);
	await run(context, ["sudo", "systemctl", "restart", unit]);
	await waitFor(context, healthUrl, validate);
	await run(context, ["systemctl", "is-active", "--quiet", unit]);
	const newPid = capture(["systemctl", "show", unit, "-p", "MainPID", "--value"]);
	if (!newPid || newPid === "0" || newPid === oldPid) {
		throw new Error(`${unit} did not start a new process.`);
	}
}

async function buildBinary(
	context: TargetContext,
	packageName: string,
	binaryName: string
): Promise<string | undefined> {
	const liveBinary = `target/release/${binaryName}`;
	const rollback = `${context.releaseDirectory}/rollback/${binaryName}`;
	const hadLiveBinary = await Bun.file(liveBinary).exists();
	if (hadLiveBinary) {
		await mkdir(`${context.releaseDirectory}/rollback`, { recursive: true });
		await copyFile(liveBinary, rollback);
		await chmod(rollback, 0o755);
	}
	try {
		await run(context, ["cargo", "build", "--release", "--locked", "-p", packageName]);
		const artifact = `${context.releaseDirectory}/bin/${binaryName}`;
		await mkdir(`${context.releaseDirectory}/bin`, { recursive: true });
		await copyFile(liveBinary, artifact);
		await chmod(artifact, 0o755);
		await atomicCopy(artifact, liveBinary);
		return hadLiveBinary ? rollback : undefined;
	} catch (error) {
		if (hadLiveBinary) await atomicCopy(rollback, liveBinary);
		throw error;
	}
}

async function deployBinaryService(
	context: TargetContext,
	packageName: string,
	binaryName: string,
	unit: string,
	healthUrl: string,
	validate: Validator
): Promise<void> {
	const rollback = await buildBinary(context, packageName, binaryName);
	try {
		requireBudget(context, 10_000, `restart and validate ${unit}`);
	} catch (error) {
		if (rollback) await atomicCopy(rollback, `target/release/${binaryName}`);
		throw error;
	}
	try {
		await restartUnit(context, unit, healthUrl, validate);
	} catch (error) {
		if (rollback) {
			await atomicCopy(rollback, `target/release/${binaryName}`);
			await run(context, ["sudo", "systemctl", "restart", unit]);
		}
		throw error;
	}
}

async function deployWeb(context: TargetContext): Promise<void> {
	const bundle = `${context.releaseDirectory}/bundle`;
	await run(context, ["bun", "run", "--cwd", "apps/nie-web", "build:wasm"]);
	await run(context, ["bun", "run", "--cwd", "apps/nie-web", "typecheck"]);
	await run(context, [
		"bunx",
		"vite",
		"build",
		"apps/nie-web",
		"--outDir",
		bundle,
		"--emptyOutDir",
	]);
	await run(context, ["bun", "apps/nie-web/scripts/precompress.ts", bundle]);
	if (!(await Bun.file(`${bundle}/index.html`).exists())) {
		throw new Error("Web build did not produce index.html.");
	}
	requireBudget(context, 10_000, "switch and validate the web bundle");
	const previous = await readlink("apps/nie-web/dist");
	const next = "apps/nie-web/dist.deploy-next";
	await rm(next, { force: true });
	await symlink(bundle, next);
	await rename(next, "apps/nie-web/dist");
	try {
		await waitFor(context, "http://127.0.0.1:8085/api/v1/health", validateSiteHealth);
		await waitFor(context, "https://nie.aphrody.com/", (body) => {
			if (!body.includes("/static/") || !body.includes("<div id=\"root\"></div>")) {
				throw new Error("Public site shell is incomplete.");
			}
		});
	} catch (error) {
		const rollback = "apps/nie-web/dist.deploy-rollback";
		await rm(rollback, { force: true });
		await symlink(previous, rollback);
		await rename(rollback, "apps/nie-web/dist");
		throw error;
	}
}

async function deployBunService(
	context: TargetContext,
	typecheck: string[],
	unit: string,
	healthUrl: string
): Promise<void> {
	await run(context, typecheck);
	await restartUnit(context, unit, healthUrl, healthyJson);
}

async function publishNativeMcpAliases(): Promise<void> {
	const binary = `${repositoryRoot}/target/release/nie-mcp`;
	const binaryDirectory = "/home/ubuntu/.local/bin";
	await mkdir(binaryDirectory, { recursive: true });
	for (const name of ["nie-mcp", "niers-mcp"]) {
		const destination = `${binaryDirectory}/${name}`;
		await rm(destination, { force: true });
		await symlink(binary, destination);
		if ((await readlink(destination)) !== binary) {
			throw new Error(`${destination} does not resolve to the native Rust MCP binary.`);
		}
	}
}

const targets: Record<string, Target> = {
	ffi: {
		description: "Rust FFI library used by Bun compatibility adapters",
		deploy: async (context) => {
			await buildBinary(context, "nie-ffi", "libnie_ffi.so");
			const symbols = await run(context, ["nm", "-D", "target/release/libnie_ffi.so"]);
			if (!symbols.includes("nie_wiki_json_out")) {
				throw new Error("Rust FFI library does not export nie_wiki_json_out.");
			}
		},
	},
	cli: {
		description: "Native nie CLI and stdio MCP host",
		deploy: async (context) => {
			await buildBinary(context, "nie-cli", "niers");
			await run(context, ["target/release/niers", "--version"]);
			await run(context, ["target/release/niers", "mcp", "--help"]);
		},
	},
	mcp: {
		description: "Standalone native Rust MCP stdio server",
		deploy: async (context) => {
			await buildBinary(context, "nie-mcp", "nie-mcp");
			await run(context, ["cargo", "test", "--locked", "-p", "nie-mcp", "--test", "stdio_smoke"]);
			await publishNativeMcpAliases();
		},
	},
	web: {
		description: "nie WebAssembly browser bundle",
		deploy: deployWeb,
	},
	model: {
		description: "Rust model and VFS asset server",
		deploy: (context) =>
			deployBinaryService(
				context,
				"nie-model-serve",
				"nie-model-serve",
				"nie-model-serve.service",
				"http://127.0.0.1:8790/health",
				(body) => {
					if (body.trim() !== "ok") throw new Error("Model health response is not ok.");
				}
			),
	},
	site: {
		description: "Rust HTTP site and API host",
		deploy: (context) =>
			deployBinaryService(
				context,
				"nie-site",
				"nie-site",
				"nie-site.service",
				"http://127.0.0.1:8085/api/v1/health",
				validateSiteHealth
			),
	},
	cron: {
		description: "Bun scheduled-jobs daemon",
		deploy: (context) =>
			deployBunService(
				context,
				["bun", "run", "--cwd", "packages/cron", "typecheck"],
				"nie-cron.service",
				"http://127.0.0.1:3005/health"
			),
	},
	"cdn-variants": {
		description: "Bun on-demand IEVR image variants",
		deploy: (context) =>
			deployBunService(
				context,
				["bun", "run", "--cwd", "apps/cdn-variants", "typecheck"],
				"cdn-variants.service",
				"http://127.0.0.1:8805/health"
			),
	},
	realtime: {
		description: "Bun PostgreSQL realtime compatibility service",
		deploy: (context) =>
			deployBunService(
				context,
				["bun", "run", "--cwd", "apps/realtime", "typecheck"],
				"rg-realtime.service",
				"http://127.0.0.1:8812/health"
			),
	},
	storage: {
		description: "Bun local-files and PostgreSQL storage compatibility service",
		deploy: (context) =>
			deployBunService(
				context,
				["bun", "run", "--cwd", "apps/storage", "typecheck"],
				"rg-storage.service",
				"http://127.0.0.1:8810/health"
			),
	},
};

const orderedTargets = [
	"ffi",
	"cli",
	"mcp",
	"web",
	"model",
	"site",
	"cron",
	"cdn-variants",
	"realtime",
	"storage",
] as const;

function usage(): string {
	return `Usage: bun run deploy:target -- <target|--all|--list>\n\nEach target has an independent hard deadline of 60 seconds.\n\n${orderedTargets
		.map((name) => `  ${name.padEnd(14)} ${targets[name].description}`)
		.join("\n")}`;
}

async function assertReleaseState(): Promise<string> {
	if (capture(["git", "branch", "--show-current"]) !== "main") {
		throw new Error("Production deployment requires the main branch.");
	}
	const status = capture(["git", "status", "--porcelain", "--untracked-files=all"]);
	if (status) throw new Error("Production deployment requires a clean checkout.");
	const commit = capture(["git", "rev-parse", "HEAD"]);
	const remote = capture(["git", "rev-parse", "origin/main"]);
	if (commit !== remote) throw new Error("HEAD must equal origin/main before deployment.");
	return commit;
}

async function deployTarget(name: string, commit: string): Promise<{ name: string; seconds: number }> {
	const target = targets[name];
	if (!target) throw new Error(`Unknown target: ${name}`);
	const startedAt = Date.now();
	const context: TargetContext = {
		commit,
		deadline: startedAt + targetTimeoutMs,
		name,
		releaseDirectory: `${repositoryRoot}/var/deployments/targeted/${commit}/${runId}/${name}`,
	};
	await mkdir(context.releaseDirectory, { recursive: true });
	process.stdout.write(`\n→ ${name}: ${target.description}\n`);
	await target.deploy(context);
	const seconds = (Date.now() - startedAt) / 1_000;
	assertDeadline(context);
	await Bun.write(
		`${context.releaseDirectory}/manifest.json`,
		`${JSON.stringify(
			{
				commit,
				completedAt: new Date().toISOString(),
				host: capture(["hostname"]),
				seconds,
				target: name,
				timeoutSeconds: targetTimeoutMs / 1_000,
			},
			null,
			2
		)}\n`
	);
	process.stdout.write(`✓ ${name} deployed and validated in ${seconds.toFixed(1)}s\n`);
	return { name, seconds };
}

const requested = process.argv.slice(2);
if (requested.length !== 1 || requested[0] === "--help" || requested[0] === "-h") {
	process.stdout.write(`${usage()}\n`);
	process.exit(requested.length === 1 ? 0 : 2);
}
if (requested[0] === "--list") {
	process.stdout.write(`${usage()}\n`);
	process.exit(0);
}

await mkdir(logDirectory, { recursive: true });
try {
	await mkdir(lockDirectory);
} catch {
	throw new Error(`Another target deployment owns ${lockDirectory}.`);
}

try {
	const commit = await assertReleaseState();
	const selected = requested[0] === "--all" ? [...orderedTargets] : [requested[0]];
	const results: { name: string; seconds?: number; error?: string }[] = [];
	for (const name of selected) {
		try {
			results.push(await deployTarget(name, commit));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			results.push({ error: message, name });
			process.stderr.write(`✗ ${name}: ${message}\n`);
		}
	}
	const failures = results.filter((result) => result.error);
	process.stdout.write(`\n${results.length - failures.length}/${results.length} targets deployed.\n`);
	if (failures.length > 0) process.exitCode = 1;
} finally {
	await rm(lockDirectory, { recursive: true, force: true });
}
