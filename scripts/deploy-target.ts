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

process.env["NO_PROXY"] = `${process.env["NO_PROXY"] || ""},aphrody.com,.aphrody.com,127.0.0.1,localhost`.replace(/^,/u, "");
process.env["no_proxy"] = process.env["NO_PROXY"];

/**
 * A target's own hard cap, when it does not declare one. It bounds the whole run so a hung step
 * cannot hold the lock forever; it is NOT the window the site spends in an unknown state — that
 * one is `validationWindowMs` below, and it stays short whatever the build costs.
 */
const defaultTimeoutMs = 60_000;

/**
 * How long a freshly published target may take to answer its health check before it is rolled
 * back. This is the only number a user experiences: past it, the previous bundle or binary comes
 * back. It is deliberately independent of the target's deadline — a target allowed ten minutes to
 * BUILD must still be reverted within seconds when the thing it published does not answer.
 */
const validationWindowMs = 30_000;

/**
 * Every target that calls `buildBinary` pays ONE `cargo build --release --locked` of the five
 * workspace crates — `buildBinary` ignores its `packageName` and always builds all of them, so
 * the artefacts it publishes are cut from a single LTO pass. Cold, that is minutes on this host,
 * and under the default minute those five targets died at exit 124 exactly as `web` did.
 *
 * This cap is a hang-breaker that releases the lock, not a pace for the build. What bounds the
 * outward-facing risk is `validationWindowMs`, which is unchanged: a service that does not answer
 * its health check is restored to its previous binary within 30 seconds, however long it built.
 */
const releaseBuildSeconds = 2_400;

/** Typecheck a Bun package, restart its unit, health-check it. No compilation, but not instant. */
const bunServiceSeconds = 180;

const runId = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const lockDirectory = "/tmp/nie-target-deploy.lock";
const logDirectory = `${repositoryRoot}/var/log/deploy-targets/${runId}`;

type Validator = (body: string) => void;
type Target = {
	description: string;
	deploy: (context: TargetContext) => Promise<void>;
	/** Hard cap for the whole target, in seconds. Omitted means `defaultTimeoutMs`. */
	seconds?: number;
};

type TargetContext = {
	commit: string;
	deadline: number;
	name: string;
	releaseDirectory: string;
	timeoutMs: number;
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
	if (remaining <= 0) {
		throw new Error(`${context.name} exceeded its ${context.timeoutMs / 1_000} second deadline.`);
	}
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
		throw new Error(`${context.name} exceeded its ${context.timeoutMs / 1_000} second deadline.`);
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
	// Bounded by the validation window, NOT by whatever is left of the deadline. A target with a
	// long build budget would otherwise poll a broken deployment for minutes before rolling back,
	// and those minutes are served to users.
	const limit = Math.min(context.deadline, Date.now() + validationWindowMs);
	let lastError = "no response";
	while (Date.now() < limit) {
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
	throw new Error(`${url} did not become ready within ${validationWindowMs / 1_000}s: ${lastError}`);
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

function validateSiteHealth(body: string): void {
	const value = requireJsonObject(body);
	if (value["api"] !== "v1") throw new Error("Site health does not report API v1.");
	const capabilities = value["capacites"];
	if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
		throw new Error("Site health has no capability object.");
	}
	const ready = capabilities as Record<string, unknown>;
	if (
		ready["bundle"] !== true ||
		ready["vfs"] !== "pret" ||
		ready["vfs_contenu"] !== true ||
		Number(ready["vfs_entrees"]) < 1_000
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
	requireBudget(context, validationWindowMs, `restart and validate ${unit}`);
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

let sharedReleaseBuildPromise: Promise<void> | undefined;

async function ensureSharedReleaseBuild(context: TargetContext): Promise<void> {
	if (!sharedReleaseBuildPromise) {
		sharedReleaseBuildPromise = (async () => {
			await run(context, [
				"cargo",
				"build",
				"--release",
				"--locked",
				"-p",
				"nie-cli",
				"-p",
				"nie-mcp",
				"-p",
				"nie-site",
				"-p",
				"nie-model-serve",
				"-p",
				"nie-ffi",
			]);
		})();
	}
	return sharedReleaseBuildPromise;
}

async function buildBinary(
	context: TargetContext,
	_packageName: string,
	binaryName: string
): Promise<string | undefined> {
	const liveBinary = `target/release/${binaryName}`;
	const rollback = `${context.releaseDirectory}/rollback/${binaryName}`;
	const hadLiveBinary = await Bun.file(liveBinary).exists();
	let rollbackHash: string | undefined;
	if (hadLiveBinary) {
		await mkdir(`${context.releaseDirectory}/rollback`, { recursive: true });
		await copyFile(liveBinary, rollback);
		await chmod(rollback, 0o755);
		rollbackHash = new Bun.CryptoHasher("sha256")
			.update(await Bun.file(rollback).arrayBuffer())
			.digest("hex");
	}
	try {
		await ensureSharedReleaseBuild(context);
		const artifact = `${context.releaseDirectory}/bin/${binaryName}`;
		await mkdir(`${context.releaseDirectory}/bin`, { recursive: true });
		await copyFile(liveBinary, artifact);
		await chmod(artifact, 0o755);
		return hadLiveBinary ? rollback : undefined;
	} catch (error) {
		if (hadLiveBinary) {
			const current = Bun.file(liveBinary);
			const currentHash = (await current.exists())
				? new Bun.CryptoHasher("sha256").update(await current.arrayBuffer()).digest("hex")
				: "";
			if (currentHash !== rollbackHash) await atomicCopy(rollback, liveBinary);
		}
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
		requireBudget(context, validationWindowMs, `restart and validate ${unit}`);
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
	// `vite build` COPIES `public/` into the bundle; it does not build these. The guard is
	// therefore the only thing between a deploy and a bundle missing a renderer. The second
	// module serves browsers without WebGPU: absent, they fall silently to the CPU rasteriser,
	// which works and is far slower — a degradation nothing else would report.
	for (const module of ["nie_wasm_bg.wasm", "nie_viewer_web_bg.wasm"]) {
		if (!(await Bun.file(`apps/nie-web/public/static/game/${module}`).exists())) {
			throw new Error(`The validated WebAssembly artifact ${module} is missing; deploy the wasm target first.`);
		}
	}
	await run(context, ["bun", "run", "--cwd", "apps/nie-web", "typecheck"]);
	// Run from `apps/nie-web`, NOT from the repository root. From the root, `bunx vite` resolves
	// no workspace dependency and fetches whatever version it likes — measured 2026-09-12:
	// vite 8.3.0 (rolldown) at the root against the pinned 6.4.3 in the app. A production bundle
	// must be built by the version the lockfile pins.
	//
	// The dash-in-fingerprint hazard this comment used to blame on rolldown is NOT rolldown's:
	// base64url is rollup's default alphabet too. Measured 2026-09-20 on a bundle built by the
	// pinned 6.4.3, 30 of its 252 emitted files carried a dash inside the hash and were served
	// `no-cache`. `vite.config.ts` now pins `hashCharacters: "hex"`, which is where the fix
	// belongs; pinning the version alone never addressed it.
	await run(
		context,
		["bunx", "vite", "build", "--outDir", bundle, "--emptyOutDir"],
		`${repositoryRoot}/apps/nie-web`,
	);
	await run(context, ["bun", "apps/nie-web/scripts/precompress.ts", bundle]);
	if (!(await Bun.file(`${bundle}/index.html`).exists())) {
		throw new Error("Web build did not produce index.html.");
	}
	requireBudget(context, validationWindowMs, "switch and validate the web bundle");
	const previous = await readlink("apps/nie-web/dist").catch(() => undefined);
	// A `dist` that is NOT a link is a developer's build output, not a publication pointer. It is
	// moved aside instead of deleted: a first deploy on such a checkout stays reversible, and the
	// rollback below has something to put back.
	const displaced = previous ? undefined : `apps/nie-web/dist.replaced-${runId}`;
	if (displaced) await rename("apps/nie-web/dist", displaced).catch(() => undefined);
	const next = "apps/nie-web/dist.deploy-next";
	await rm(next, { force: true });
	await symlink(bundle, next);
	await rename(next, "apps/nie-web/dist");
	try {
		await waitFor(context, "http://127.0.0.1:8085/api/v1/health", validateSiteHealth);
		await waitFor(context, "https://nie.aphrody.com/", (body) => {
			if (!body.includes("/static/") || !body.includes("id=\"racine\"")) {
				throw new Error("Public site shell is incomplete.");
			}
		});
	} catch (error) {
		// A rollback is only a rollback if it can name what to go back to. This branch used to call
		// `symlink(previous, …)` unconditionally: with no previous link it threw HERE, inside the
		// handler, masking the health-check failure that caused it and leaving the broken bundle
		// live and unreported. The type gate found it — the publisher was outside it until today.
		const rollback = "apps/nie-web/dist.deploy-rollback";
		await rm(rollback, { force: true });
		if (previous) {
			await symlink(previous, rollback);
			await rename(rollback, "apps/nie-web/dist");
		} else {
			await rm("apps/nie-web/dist", { force: true });
			if (displaced) await rename(displaced, "apps/nie-web/dist").catch(() => undefined);
		}
		throw error;
	}
}

async function deployInacordWeb(context: TargetContext): Promise<void> {
	// Inacord was merged into the site on 2026-09-12: the workspace is a route of the `web`
	// bundle (`/inacord`) and the catalogue is `/downloads`. This target only publishes and
	// validates the release channel those routes read.
	const catalog = "var/releases/inacord/public/catalog.json";
	const updateFeed = "var/releases/inacord/public/channels/stable/latest.json";
	for (const required of [catalog, updateFeed]) {
		if (!(await Bun.file(required).exists())) {
			throw new Error(`Inacord release channel is missing ${required}.`);
		}
	}
	requireBudget(context, validationWindowMs, "validate the Inacord workspace and download routes");
	await waitFor(context, "https://nie.aphrody.com/inacord", (body) => {
		if (!body.includes("id=\"racine\"")) {
			throw new Error("Public Inacord workspace shell is incomplete.");
		}
	});
	await waitFor(context, "https://nie.aphrody.com/downloads/catalog.json", (body) => {
		const value = requireJsonObject(body);
		const products = value["products"];
		if (!Array.isArray(products) || products.length < 6) {
			throw new Error("Inacord catalog has fewer than six products.");
		}
	});
	// Installed desktop clients still poll the legacy host directly; it must keep answering.
	await waitFor(context, "https://inacord.aphrody.com/downloads/channels/stable/latest.json", (body) => {
		const value = requireJsonObject(body);
		if (typeof value["version"] !== "string") {
			throw new Error("Legacy Inacord updater manifest has no version.");
		}
	});
}

async function deployWasm(context: TargetContext): Promise<void> {
	const artifact = "apps/nie-web/public/static/game/nie_wasm_bg.wasm";
	const file = Bun.file(artifact);
	if (!(await file.exists()) || file.size < 100_000 || file.size > 6 * 1024 * 1024) {
		throw new Error("WebAssembly output is absent or outside the 100 KiB to 6 MiB production bound.");
	}
	if (!WebAssembly.validate(await file.arrayBuffer())) {
		throw new Error("The staged WebAssembly artifact is invalid.");
	}
	assertDeadline(context);
}

async function publishNativeMcpAliases(): Promise<void> {
	const binary = `${repositoryRoot}/target/release/nie-mcp`;
	const binaryDirectory = "/home/ubuntu/.local/bin";
	await mkdir(binaryDirectory, { recursive: true });
	for (const name of ["nie-mcp", "nie-mcp"]) {
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
		seconds: releaseBuildSeconds,
		description: "Rust FFI library used by Bun compatibility adapters",
		deploy: async (context) => {
			await buildBinary(context, "nie-ffi", "libiecode.so");
			const symbols = await run(context, ["nm", "-D", "--defined-only", "target/release/libiecode.so"]);
			if (!symbols.includes("nie_wiki_json_out")) {
				throw new Error("Rust FFI library does not export nie_wiki_json_out.");
			}
		},
	},
	cli: {
		seconds: releaseBuildSeconds,
		description: "Native nie CLI and stdio MCP host",
		deploy: async (context) => {
			await buildBinary(context, "nie-cli", "nie");
			await run(context, ["target/release/nie", "--version"]);
			await run(context, ["target/release/nie", "mcp", "--help"]);
		},
	},
	mcp: {
		seconds: releaseBuildSeconds,
		description: "Standalone native Rust MCP stdio server",
		deploy: async (context) => {
			await buildBinary(context, "nie-mcp", "nie-mcp");
			await run(context, ["cargo", "test", "--locked", "-p", "nie-mcp", "--test", "stdio_smoke"]);
			await publishNativeMcpAliases();
		},
	},
	wasm: {
		description: "Validated prebuilt Rust WebAssembly module",
		deploy: deployWasm,
	},
	web: {
		description: "Browser shell built around the validated WebAssembly module",
		deploy: deployWeb,
		// This target BUILDS, and the default minute never covered it — which is why it had never
		// published anything here. Measured 2026-09-20 on this host: typecheck 21s, `vite build`
		// 57s, precompressing 480 files from 80 MiB to 14 MiB of Brotli several minutes. It died
		// on `timeout` mid-build, at exit 124, long before reaching the symlink swap.
		// The cap below exists to release the lock if a step hangs, not to pace the build; the
		// window in which the site can be wrong is `validationWindowMs`, and it is unchanged.
		seconds: 900,
	},
	inacord: {
		// Three public URLs, each with its own validation window.
		seconds: bunServiceSeconds,
		description: "Inacord release channel behind the site's /inacord and /downloads routes",
		deploy: deployInacordWeb,
	},
	model: {
		seconds: releaseBuildSeconds,
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
		seconds: releaseBuildSeconds,
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
};

const orderedTargets = [
	"ffi",
	"cli",
	"mcp",
	"wasm",
	"web",
	"inacord",
	"model",
	"site",
] as const;

function usage(): string {
	return `Usage: bun run deploy:target -- <target|--all|--list>\n\nEach target has an independent hard deadline, shown in seconds; whatever it publishes is\nrolled back if it has not answered its health check ${validationWindowMs / 1_000}s later.\n\n${orderedTargets
		.map((name) => {
			const target = targets[name] as Target;
			const seconds = target.seconds ?? defaultTimeoutMs / 1_000;
			return `  ${name.padEnd(14)} ${String(seconds).padStart(4)}s  ${target.description}`;
		})
		.join("\n")}`;
}

async function assertReleaseState(allowDirty = false): Promise<string> {
	if (capture(["git", "branch", "--show-current"]) !== "main") {
		throw new Error("Production deployment requires the main branch.");
	}
	if (!allowDirty) {
		const status = capture(["git", "status", "--porcelain", "--untracked-files=all"]);
		if (status) throw new Error("Production deployment requires a clean checkout.");
		const commit = capture(["git", "rev-parse", "HEAD"]);
		const remote = capture(["git", "rev-parse", "origin/main"]);
		if (commit !== remote) throw new Error("HEAD must equal origin/main before deployment.");
		return commit;
	}
	return capture(["git", "rev-parse", "HEAD"]);
}

async function deployTarget(name: string, commit: string): Promise<{ name: string; seconds: number }> {
	const target = targets[name];
	if (!target) throw new Error(`Unknown target: ${name}`);
	const startedAt = Date.now();
	const timeoutMs = target.seconds === undefined ? defaultTimeoutMs : target.seconds * 1_000;
	const context: TargetContext = {
		commit,
		deadline: startedAt + timeoutMs,
		name,
		releaseDirectory: `${repositoryRoot}/var/deployments/targeted/${commit}/${runId}/${name}`,
		timeoutMs,
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
				timeoutSeconds: timeoutMs / 1_000,
			},
			null,
			2
		)}\n`
	);
	process.stdout.write(`✓ ${name} deployed and validated in ${seconds.toFixed(1)}s\n`);
	return { name, seconds };
}

const requested = process.argv.slice(2);
const allowDirty = requested.includes("--allow-dirty") || process.env["ALLOW_DIRTY"] === "1";
const cleanRequested = requested.filter((arg) => arg !== "--allow-dirty");
if (cleanRequested.length !== 1 || cleanRequested[0] === "--help" || cleanRequested[0] === "-h") {
	process.stdout.write(`${usage()}\n`);
	process.exit(cleanRequested.length === 1 ? 0 : 2);
}
const argument = cleanRequested[0] as string;
if (argument === "--list") {
	process.stdout.write(`${usage()}\n`);
	process.exit(0);
}

await mkdir(logDirectory, { recursive: true });
try {
	await mkdir(lockDirectory);
} catch {
	throw new Error(`Another target deployment owns ${lockDirectory}.`);
}

const concurrencyTiers = [
	["ffi", "cli", "mcp"],
	["wasm"],
	["web", "inacord"],
	["model", "site"],
] as const;

try {
	const commit = await assertReleaseState(allowDirty);
	const selected: string[] =
		argument === "--all"
			? [...orderedTargets]
			: argument
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);

	for (const targetName of selected) {
		if (!targets[targetName]) {
			throw new Error(`Unknown target: ${targetName}`);
		}
	}

	const results: { name: string; seconds?: number; error?: string }[] = [];
	for (const tier of concurrencyTiers) {
		const tierTargets = tier.filter((name) => selected.includes(name));
		if (tierTargets.length === 0) continue;
		process.stdout.write(`\n=== Tier: [${tierTargets.join(", ")}] (concurrent) ===\n`);
		const tierResults = await Promise.allSettled(
			tierTargets.map((name) => deployTarget(name, commit))
		);
		for (let i = 0; i < tierTargets.length; i++) {
			const name = tierTargets[i]!;
			const res = tierResults[i]!;
			if (res.status === "fulfilled") {
				results.push(res.value);
			} else {
				const message = res.reason instanceof Error ? res.reason.message : String(res.reason);
				results.push({ error: message, name });
				process.stderr.write(`✗ ${name}: ${message}\n`);
			}
		}
	}
	const failures = results.filter((result) => result.error);
	process.stdout.write(`\n${results.length - failures.length}/${results.length} targets deployed.\n`);
	if (failures.length > 0) process.exitCode = 1;
} finally {
	await rm(lockDirectory, { recursive: true, force: true });
}
