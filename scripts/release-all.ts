#!/usr/bin/env bun
/* eslint-disable no-await-in-loop -- Release gates and remote mutations are deliberately ordered. */

import { createWriteStream } from "node:fs";
import {
	chmod,
	copyFile,
	mkdir,
	readlink,
	rename,
	rm,
	stat,
	symlink,
	appendFile,
} from "node:fs/promises";
import { once } from "node:events";

/** Fail-fast whole-repository release pipeline. Remote mutation requires --deploy. */
type StageName =
	| "lint"
	| "typecheck"
	| "tests"
	| "rust-clippy"
	| "build"
	| "release"
	| "deploy"
	| "live-validation";
type Command = { argv: string[]; cwd?: string; env?: Record<string, string> };
type Stage = { name: StageName; commands: Command[]; remote?: boolean };

const args = Bun.argv.slice(2);
const deployEnabled = args.includes("--deploy");
const dryRun = args.includes("--dry-run");
const valueOf = (prefix: string) =>
	args.find((arg) => arg.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
const from = valueOf("--from") as StageName | undefined;
const only = valueOf("--only") as StageName | undefined;
const commitMessage = valueOf("--message") ?? "chore(release): publish verified repository state";
const repositoryRoot = process.cwd();
const runId = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${process.pid}`;
const logDirectory = `${repositoryRoot}/var/log/releases/${runId}`;
const summaryLog = `${logDirectory}/summary.log`;
let releaseStage = "<STAGE>";
let candidateTree: string | undefined;
let initialIndexTree: string | undefined;
let releaseCommitted = false;
let activeStage: StageName | "preflight" = "preflight";
let activeStageIndex = 0;
let commandIndex = 0;

const stages: Stage[] = [
	{
		name: "lint",
		commands: [
			{ argv: ["bun", "run", "lint"] },
			{
				argv: [
					"bunx",
					"oxlint",
					"-c",
					".oxlintrc.json",
					"-A",
					"style",
					"-A",
					"pedantic",
					"-A",
					"restriction",
					"scripts/release-all.ts",
					"scripts/sync-main.ts",
					"scripts/sync-main.test.ts",
				],
			},
			{ argv: ["cargo", "fmt", "--all", "--check"] },
			{ argv: ["bun", "run", "docs:check"] },
			{ argv: ["bun", "run", "check:dependencies"] },
			{ argv: ["cargo", "deny", "check", "advisories", "bans", "licenses", "sources"] },
			{ argv: ["bun", "run", "generate:public-entry-inventory"] },
			{ argv: ["bun", "run", "validate:shared-capabilities"] },
			{ argv: ["bash", "crates/tools/audit-shared-surfaces.sh", "--require-complete"] },
			{ argv: ["git", "diff", "--check"] },
			{ argv: ["git", "diff", "--cached", "--check"] },
		],
	},
	{
		name: "typecheck",
		commands: [
			{ argv: ["bun", "run", "typecheck"] },
			{ argv: ["cargo", "check", "--workspace", "--tests", "--locked"] },
			{ argv: ["cargo", "check", "-p", "inacord", "--locked"] },
			{
				argv: [
					"cargo",
					"check",
					"-p",
					"nie-wasm",
					"--target",
					"wasm32-unknown-unknown",
					"--locked",
				],
			},
		],
	},
	{
		name: "tests",
		commands: [
			// Bun preloads the native bridge in integration tests. `cargo check` only
			// validates it and does not materialize the loadable cdylib after a clean.
			{ argv: ["cargo", "build", "-p", "nie-ffi", "--locked"] },
			{ argv: ["bun", "run", "test"] },
			{ argv: ["bun", "test", "scripts/sync-main.test.ts"] },
			// TypeScript tests consume the debug FFI built above. Once they pass,
			// reclaim those regenerable artifacts before Cargo compiles the full test graph;
			// otherwise the constrained release host can run out of disk mid-suite.
			{ argv: ["cargo", "clean", "--profile", "dev"] },
			// This live-VFS soundtrack coverage test is a separate, minutes-long data oracle.
			// It was measured in the release audit and is announced here rather than hanging
			// the deterministic repository suite without a bound.
			{
				argv: [
					"cargo",
					"test",
					"--workspace",
					"--tests",
					"--locked",
					"--",
					"--skip",
					"couverture_reelle_des_bandes_son",
				],
			},
		],
	},
	{
		name: "rust-clippy",
		commands: [
			{
				argv: [
					"cargo",
					"clippy",
					"--workspace",
					"--lib",
					"--bins",
					"--tests",
					"--locked",
					"--",
					"-D",
					"warnings",
				],
			},
			{
				argv: [
					"cargo",
					"clippy",
					"-p",
					"nie-wasm",
					"--target",
					"wasm32-unknown-unknown",
					"--locked",
					"--",
					"-D",
					"warnings",
				],
			},
		],
	},
	{
		name: "build",
		commands: [
			// Debug/test artifacts have already served every gate and consume tens of GiB on this
			// constrained host. Preserve live release binaries while reclaiming only generated
			// development-profile output before constructing the isolated release target.
			{ argv: ["cargo", "clean", "--profile", "dev"] },
			// Enumerate build owners so the site build can never follow the live dist symlink.
			{ argv: ["bun", "run", "--filter", "@rosegriffon/cron", "build"] },
			{ argv: ["bun", "run", "--cwd", "apps/inacord", "build"] },
			{
				argv: [
					"cargo",
					"build",
					"--release",
					"--locked",
					"-p",
					"nie-cli",
					"-p",
					"nie-site",
					"-p",
					"nie-model-serve",
				],
				env: { CARGO_TARGET_DIR: "<STAGE>/target" },
			},
			// The Bun bindings load the native FFI library from the checkout during the
			// TypeScript project build; keep that library in the canonical release target too.
			{ argv: ["cargo", "build", "--release", "--locked", "-p", "nie-ffi"] },
			{ argv: ["cargo", "check", "--locked", "-p", "inacord"] },
			{ argv: ["bun", "run", "--cwd", "apps/nie-web", "build:wasm"] },
			{ argv: ["bunx", "tsc", "-b", "apps/nie-web/tsconfig.json"] },
			{
				argv: [
					"bunx",
					"vite",
					"build",
					"apps/nie-web",
					"--outDir",
					"<STAGE>/bundle",
					"--emptyOutDir",
				],
			},
			{ argv: ["bun", "apps/nie-web/scripts/precompress.ts", "<STAGE>/bundle"] },
			{
				argv: ["bash", "scripts/e2e-site.sh", "--no-build", "--vfs=200"],
				env: {
					NIE_SITE_BINARY: "<STAGE>/target/release/nie-site",
					NIE_SITE_STATIC_DIR: "<STAGE>/bundle",
				},
			},
		],
	},
	{ name: "release", remote: true, commands: [{ argv: ["git", "push", "origin", "main"] }] },
	// This checked blue/green wrapper is the repository's deployment contract. It deploys
	// The maintained site from the already-built local artefact; other services require their own owners.
	{ name: "deploy", remote: true, commands: [] },
	{ name: "live-validation", remote: true, commands: [] },
];

const usage = `Usage: bun run release:all [--dry-run] [--deploy] [--message=<commit message>] [--from=<stage> | --only=<stage>]
Stages: ${stages.map((stage) => stage.name).join(", ")}
Default: run through build only. --deploy additionally pushes main, deploys, and validates live.
`;

if (args.includes("--help")) {
	process.stdout.write(usage);
	process.exit(0);
}
const unknown = args.filter(
	(arg) =>
		arg !== "--deploy" &&
		arg !== "--dry-run" &&
		!arg.startsWith("--from=") &&
		!arg.startsWith("--only=") &&
		!arg.startsWith("--message=")
);
if (unknown.length || (from && only)) {
	process.stderr.write(
		`${unknown.length ? `Unknown option(s): ${unknown.join(", ")}\n` : "--from and --only are mutually exclusive.\n"}${usage}`
	);
	process.exit(2);
}
const names = new Set(stages.map((stage) => stage.name));
if ((from && !names.has(from)) || (only && !names.has(only))) {
	process.stderr.write(`Unknown stage.\n${usage}`);
	process.exit(2);
}
if (
	!deployEnabled &&
	((only && stages.find((stage) => stage.name === only)?.remote) ||
		(from && stages.findIndex((stage) => stage.name === from) > 4))
) {
	throw new Error("Remote stages require explicit --deploy.");
}
if (deployEnabled && (from || only))
	throw new Error(
		"--deploy requires the complete immutable pipeline; --from/--only are local-only."
	);

const selected = stages.filter((stage, index) => {
	if (!deployEnabled && stage.remote) return false;
	if (only) return stage.name === only;
	if (from) return index >= stages.findIndex((candidate) => candidate.name === from);
	return true;
});
const quote = (part: string) => (/^[A-Za-z0-9_./:=@-]+$/.test(part) ? part : JSON.stringify(part));
const commandText = (command: Command) => command.argv.map(quote).join(" ");
const elapsed = (start: number) => `${((performance.now() - start) / 1000).toFixed(1)}s`;
const redact = (value: string) =>
	value.replace(
		/(authorization|token|secret|password|api[_-]?key)(\s*[:=]\s*)([^\s]+)/giu,
		"$1$2[REDACTED]"
	);

async function capture(argv: string[]): Promise<string> {
	commandIndex += 1;
	const logPath = `${logDirectory}/${String(activeStageIndex).padStart(2, "0")}-${stageSlug(activeStage)}-${String(commandIndex).padStart(2, "0")}-internal.log`;
	const process = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	await Bun.write(
		logPath,
		redact(`$ ${argv.map(quote).join(" ")}\n${stdout}${stderr}\n[exit ${code}]\n`)
	);
	await chmod(logPath, 0o600);
	if (code !== 0)
		throw new Error(`${argv.map(quote).join(" ")} failed (${code}); log: ${logPath}`);
	return stdout.trim();
}

async function requireReleaseState(): Promise<string> {
	const branch = await capture(["git", "branch", "--show-current"]);
	if (branch !== "main")
		throw new Error(`Release requires branch main, found ${branch || "detached HEAD"}.`);
	await capture(["git", "fetch", "origin", "main"]);
	const baseCommit = await capture(["git", "rev-parse", "HEAD"]);
	const ancestry = Bun.spawnSync(["git", "merge-base", "--is-ancestor", "origin/main", baseCommit]);
	if (ancestry.exitCode !== 0)
		throw new Error("Local main is behind or diverged from origin/main.");
	if (deployEnabled) {
		initialIndexTree = await capture(["git", "write-tree"]);
		await capture(["git", "add", "-A"]);
		candidateTree = await capture(["git", "write-tree"]);
		if (
			(await capture(["git", "diff", "--name-only"])) ||
			(await capture(["git", "ls-files", "--others", "--exclude-standard"]))
		) {
			throw new Error("Candidate changed while staging.");
		}
	} else {
		const dirty = await capture(["git", "status", "--porcelain", "--untracked-files=all"]);
		if (dirty) throw new Error("Local release verification requires a clean worktree.");
		candidateTree = await capture(["git", "rev-parse", "HEAD^{tree}"]);
	}
	return baseCommit;
}

async function commandExit(argv: string[]): Promise<number> {
	return Bun.spawnSync(argv, { stdout: "ignore", stderr: "ignore" }).exitCode;
}

async function preflightProduction(): Promise<void> {
	for (const command of ["bun", "cargo", "git", "curl", "sha256sum", "sudo", "systemctl"]) {
		if ((await commandExit(["sh", "-c", `command -v ${command}`])) !== 0)
			throw new Error(`Required command ${command} is unavailable.`);
	}
	const diskLine = (await capture(["df", "-Pk", repositoryRoot]))
		.trim()
		.split("\n")
		.at(-1)
		?.trim()
		.split(/\s+/u);
	const availableGiB = Number(diskLine?.[3] ?? 0) / 1024 / 1024;
	const minimumDiskGiB = Number(process.env.NIERS_RELEASE_MIN_DISK_GIB ?? 15);
	if (availableGiB < minimumDiskGiB)
		throw new Error(
			`Release needs ${minimumDiskGiB} GiB free; only ${availableGiB.toFixed(1)} GiB is available.`
		);
	const memory = await Bun.file("/proc/meminfo").text();
	const availableMemoryMiB = Number(memory.match(/^MemAvailable:\s+(\d+)/mu)?.[1] ?? 0) / 1024;
	const minimumMemoryMiB = Number(process.env.NIERS_RELEASE_MIN_MEMORY_MIB ?? 6144);
	if (availableMemoryMiB < minimumMemoryMiB)
		throw new Error(
			`Release needs ${minimumMemoryMiB} MiB available memory; only ${availableMemoryMiB.toFixed(0)} MiB is available.`
		);
	for (const [source, installed] of [
		["deploy/systemd/nie-site.service", "/etc/systemd/system/nie-site.service"],
		["deploy/systemd/nie-model-serve.service", "/etc/systemd/system/nie-model-serve.service"],
		["deploy/nginx/aphrody.com.conf", "/etc/nginx/conf.d/aphrody.com.conf"],
	] as const) {
		if ((await commandExit(["cmp", "-s", source, installed])) !== 0)
			throw new Error(`Installed production configuration drifts from ${source}.`);
	}
	await runCommand({ argv: ["sudo", "nginx", "-t"] });
	for (const unit of ["nie-model-serve.service", "nie-site.service"]) {
		if ((await commandExit(["systemctl", "is-active", "--quiet", unit])) !== 0)
			throw new Error(`${unit} is not active before deployment.`);
	}
	for (const lock of [
		"/home/ubuntu/rg-releases/website/deploy.lock",
	]) {
		if (await Bun.file(lock).exists()) throw new Error(`Another deployment owns ${lock}.`);
	}
	process.stdout.write(
		`    preflight: ${availableGiB.toFixed(1)} GiB disk, ${availableMemoryMiB.toFixed(0)} MiB memory, installed config exact\n`
	);
}

async function assertImmutable(commit: string): Promise<void> {
	const [current, unstaged, untracked] = await Promise.all([
		capture(["git", "rev-parse", "HEAD"]),
		capture(["git", "diff", "--name-only"]),
		capture(["git", "ls-files", "--others", "--exclude-standard"]),
	]);
	if (current !== commit || unstaged || untracked)
		throw new Error("Checkout changed during the release pipeline.");
	if (candidateTree && (await capture(["git", "write-tree"])) !== candidateTree)
		throw new Error("Staged release tree changed during the release pipeline.");
}

async function prepareReleaseArtifacts(): Promise<void> {
	await mkdir(`${releaseStage}/bin`, { recursive: true });
	for (const binary of ["niers", "nie-site", "nie-model-serve"]) {
		const source = `${releaseStage}/target/release/${binary}`;
		if (!(await Bun.file(source).exists())) throw new Error(`Missing release artifact ${source}`);
		await copyFile(source, `${releaseStage}/bin/${binary}`);
		await chmod(`${releaseStage}/bin/${binary}`, 0o755);
	}
	// A release retains exact deployable binaries, not a second multi-gigabyte Cargo cache.
	await rm(`${releaseStage}/target`, { recursive: true, force: true });
}

async function snapshotRollbackArtifacts(): Promise<void> {
	const rollback = `${releaseStage}/rollback`;
	await mkdir(rollback, { recursive: true });
	const serviceBinaries = [
		["nie-model-serve.service", "nie-model-serve"],
		["nie-site.service", "nie-site"],
	] as const;
	for (const [unit, binary] of serviceBinaries) {
		const pid = await capture(["systemctl", "show", unit, "-p", "MainPID", "--value"]);
		if (!pid || pid === "0")
			throw new Error(`${unit} has no running executable to preserve for rollback.`);
		await copyFile(`/proc/${pid}/exe`, `${rollback}/${binary}`);
		await chmod(`${rollback}/${binary}`, 0o755);
	}
	if (await Bun.file("target/release/niers").exists()) {
		await copyFile("target/release/niers", `${rollback}/niers`);
		await chmod(`${rollback}/niers`, 0o755);
	}
}

async function sha256(path: string): Promise<string> {
	return (await capture(["sha256sum", path])).split(/\s+/u)[0];
}

async function writeReleaseManifest(
	commit: string,
	summaries: { stage: StageName; seconds: string }[]
): Promise<void> {
	const paths = [
		"bin/niers",
		"bin/nie-site",
		"bin/nie-model-serve",
		"bundle/index.html",
		"bundle/static/game/nie_wasm_bg.wasm",
	];
	const artifacts = [];
	for (const path of paths) {
		const absolute = `${releaseStage}/${path}`;
		if (!(await Bun.file(absolute).exists()))
			throw new Error(`Missing release artifact ${absolute}`);
		artifacts.push({ path, bytes: (await stat(absolute)).size, sha256: await sha256(absolute) });
	}
	await Bun.write(
		`${releaseStage}/manifest.json`,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				commit,
				candidateTree,
				host: await capture(["hostname"]),
				createdAt: new Date().toISOString(),
				artifacts,
				gates: summaries,
				mcpTransport: "CLI stdio; public HTTP transport remains retired",
			},
			null,
			2
		)}\n`
	);
}

async function finishReleaseManifest(
	commit: string,
	state: "validated" | "failed",
	summaries: { stage: StageName; seconds: string }[],
	error?: unknown
): Promise<void> {
	const releasedPath = `${repositoryRoot}/var/releases/${commit}/manifest.json`;
	const stagedPath = `${releaseStage}/manifest.json`;
	const path = (await Bun.file(releasedPath).exists()) ? releasedPath : stagedPath;
	if (!(await Bun.file(path).exists())) return;
	const manifest = object(JSON.parse(await Bun.file(path).text()));
	manifest.state = state;
	manifest.completedAt = new Date().toISOString();
	manifest.gates = summaries;
	manifest.logs = logDirectory;
	if (error) manifest.failure = error instanceof Error ? error.message : String(error);
	await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected a JSON object.");
	return value as JsonObject;
};

async function fetchResponse(url: string, options: RequestInit = {}): Promise<Response> {
	const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);
	return response;
}

function validateSiteHealth(value: unknown): void {
	const root = object(value);
	if (root.api !== "v1") throw new Error("Site health API version is not v1.");
	const capabilities = object(root.capacites);
	if (
		capabilities.bundle !== true ||
		capabilities.vfs !== "pret" ||
		Number(capabilities.vfs_entrees) < 1_000 ||
		capabilities.vfs_contenu !== true ||
		capabilities.gisement !== true ||
		capabilities.anime !== true
	) {
		throw new Error("Site health lacks a ready bundle, content VFS, or warmed database.");
	}
	const views = root.vues;
	if (
		!Array.isArray(views) ||
		views.length < 4 ||
		views.some((entry) => Number(object(entry).total) < 1)
	) {
		throw new Error("Site health lacks populated texture/model/sound/video views.");
	}
}

async function validateLive(): Promise<void> {
	validateSiteHealth(await (await fetchResponse("https://nie.aphrody.com/api/v1/health")).json());
	const icons = object(await (await fetchResponse("https://nie.aphrody.com/api/v1/icons")).json());
	if (Number(icons.total_indexed) < 1 || Number(icons.atlases) < 1 || !Array.isArray(icons.results))
		throw new Error("Icon catalogue is empty or malformed.");
	const modes = object(await (await fetchResponse("https://nie.aphrody.com/api/v1/modes")).json());
	if (Number(modes.total_modes) < 1 || !Array.isArray(modes.results) || modes.results.length < 1)
		throw new Error("Mode catalogue is empty or malformed.");
	const home = await (await fetchResponse("https://nie.aphrody.com/")).text();
	const scriptPath = home.match(/src="(\/static\/[^"]+\.js)"/u)?.[1];
	if (!scriptPath) throw new Error("Public site shell has no JavaScript entrypoint.");
	const javascript = await fetchResponse(`https://nie.aphrody.com${scriptPath}`, {
		headers: { "accept-encoding": "br" },
	});
	if ((await javascript.arrayBuffer()).byteLength < 10_000)
		throw new Error("Public JavaScript entrypoint is unexpectedly small.");
	if (javascript.headers.get("content-encoding") !== "br")
		throw new Error("Public JavaScript entrypoint is not Brotli encoded.");
	const modelHealth = await (await fetchResponse("https://cdn.aphrody.com/health")).text();
	if (modelHealth.trim() !== "ok")
		throw new Error("Public model backend health payload is not ok.");
	process.stdout.write(
		`    ✓ site API/VFS, ${icons.total_indexed} icons, ${modes.total_modes} modes, Brotli bundle, and model backend\n`
	);
}

async function atomicCopy(source: string, destination: string): Promise<void> {
	const temporary = `${destination}.release-new`;
	await copyFile(source, temporary);
	await chmod(temporary, 0o755);
	await rename(temporary, destination);
}

async function waitFor(
	url: string,
	validate: (body: string) => void,
	timeoutMs = 120_000
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError = "no response";
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
			const body = await response.text();
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			validate(body);
			return;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			await Bun.sleep(500);
		}
	}
	throw new Error(`${url} did not become ready: ${lastError}`);
}

async function deployProduction(commit: string): Promise<void> {
	const release = `${repositoryRoot}/var/releases/${commit}`;
	if (await Bun.file(`${release}/manifest.json`).exists())
		throw new Error(`${release} already exists; refusing to overwrite an immutable release.`);
	const previousBundle = await readlink("apps/nie-web/dist").catch(() => "");
	if (!previousBundle)
		throw new Error(
			"apps/nie-web/dist is not a release symlink; refusing a non-atomic deployment."
		);
	const rollback = `${release}/rollback`;
	await rename(releaseStage, release);
	for (const binary of ["niers", "nie-site", "nie-model-serve"])
		if (!(await Bun.file(`${rollback}/${binary}`).exists()))
			throw new Error(`Rollback artifact ${binary} is missing.`);
	await Bun.write(`${release}/rollback.json`, `${JSON.stringify({ previousBundle }, null, 2)}\n`);
	const oldPids = new Map<string, string>();
	for (const unit of ["nie-model-serve.service", "nie-site.service"])
		oldPids.set(unit, await capture(["systemctl", "show", unit, "-p", "MainPID", "--value"]));
	try {
		const nextLink = "apps/nie-web/dist.release-next";
		await rm(nextLink, { force: true });
		await symlink(`${release}/bundle`, nextLink);
		await rename(nextLink, "apps/nie-web/dist");
		for (const binary of ["niers", "nie-site", "nie-model-serve"]) {
			await atomicCopy(`${release}/bin/${binary}`, `target/release/${binary}`);
			if ((await sha256(`${release}/bin/${binary}`)) !== (await sha256(`target/release/${binary}`)))
				throw new Error(`${binary} changed during atomic publication.`);
		}
		await runCommand({ argv: ["target/release/niers", "--version"] }, commit);
		await runCommand({ argv: ["target/release/niers", "mcp", "--help"] }, commit);
		await runCommand({ argv: ["sudo", "systemctl", "restart", "nie-model-serve.service"] }, commit);
		await waitFor("http://127.0.0.1:8790/health", (body) => {
			if (body.trim() !== "ok") throw new Error("model health payload is not ok");
		});
		await runCommand({ argv: ["sudo", "systemctl", "restart", "nie-site.service"] }, commit);
		await waitFor("http://127.0.0.1:8085/api/v1/health", (body) =>
			validateSiteHealth(JSON.parse(body))
		);
		for (const unit of ["nie-model-serve.service", "nie-site.service"]) {
			if ((await commandExit(["systemctl", "is-active", "--quiet", unit])) !== 0)
				throw new Error(`${unit} is inactive after restart.`);
			const newPid = await capture(["systemctl", "show", unit, "-p", "MainPID", "--value"]);
			if (!newPid || newPid === "0" || newPid === oldPids.get(unit))
				throw new Error(`${unit} did not start a new process.`);
			const binary = unit.startsWith("nie-model") ? "nie-model-serve" : "nie-site";
			if ((await sha256(`/proc/${newPid}/exe`)) !== (await sha256(`${release}/bin/${binary}`)))
				throw new Error(`${unit} is not running the released artifact.`);
		}
	} catch (error) {
		await rollbackProduction(commit);
		throw error;
	}
}

async function rollbackProduction(commit: string): Promise<void> {
	const release = `${repositoryRoot}/var/releases/${commit}`;
	const rollback = `${release}/rollback`;
	const rollbackState = object(JSON.parse(await Bun.file(`${release}/rollback.json`).text()));
	const previousBundle = String(rollbackState.previousBundle ?? "");
	if (!previousBundle) throw new Error("Rollback bundle target is missing.");
	const rollbackLink = "apps/nie-web/dist.release-rollback";
	await rm(rollbackLink, { force: true });
	await symlink(previousBundle, rollbackLink);
	await rename(rollbackLink, "apps/nie-web/dist");
	for (const binary of ["niers", "nie-site", "nie-model-serve"]) {
		if (await Bun.file(`${rollback}/${binary}`).exists())
			await atomicCopy(`${rollback}/${binary}`, `target/release/${binary}`);
	}
	await runCommand(
		{ argv: ["sudo", "systemctl", "restart", "nie-model-serve.service", "nie-site.service"] },
		commit
	);
	await waitFor("http://127.0.0.1:8790/health", (body) => {
		if (body.trim() !== "ok") throw new Error("rolled-back model health payload is not ok");
	});
	await waitFor("http://127.0.0.1:8085/api/v1/health", (body) =>
		validateSiteHealth(JSON.parse(body))
	);
}

const stageSlug = (stage: string) => stage.replaceAll("-", "_");

async function logSummary(line: string): Promise<void> {
	const rendered = `${new Date().toISOString()} ${line}\n`;
	process.stdout.write(rendered);
	await appendFile(summaryLog, rendered);
}

async function pipeToLog(
	stream: ReadableStream<Uint8Array>,
	terminal: NodeJS.WriteStream,
	log: ReturnType<typeof createWriteStream>
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	const write = (text: string) => {
		const rendered = redact(text);
		terminal.write(rendered);
		log.write(rendered);
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			pending += decoder.decode();
			if (pending) write(pending);
			return;
		}
		pending += decoder.decode(value, { stream: true });
		const finalNewline = pending.lastIndexOf("\n");
		if (finalNewline >= 0) {
			write(pending.slice(0, finalNewline + 1));
			pending = pending.slice(finalNewline + 1);
		}
	}
}

async function runCommand(command: Command, releaseCommit?: string): Promise<void> {
	const expanded = {
		...command,
		argv: command.argv.map((part) => part.replaceAll("<STAGE>", releaseStage)),
		env:
			command.env &&
			Object.fromEntries(
				Object.entries(command.env).map(([key, value]) => [
					key,
					value.replaceAll("<STAGE>", releaseStage),
				])
			),
	};
	commandIndex += 1;
	const logPath = `${logDirectory}/${String(activeStageIndex).padStart(2, "0")}-${stageSlug(activeStage)}-${String(commandIndex).padStart(2, "0")}.log`;
	const header = `$ ${commandText(expanded)}\n`;
	process.stdout.write(`    ${header}`);
	if (dryRun) {
		await Bun.write(logPath, `${header}[dry-run]\n`);
		await chmod(logPath, 0o600);
		return;
	}
	const log = createWriteStream(logPath, { flags: "w", mode: 0o600 });
	log.write(header);
	const child = Bun.spawn(expanded.argv, {
		cwd: expanded.cwd ?? repositoryRoot,
		env: {
			...process.env,
			...expanded.env,
			...(releaseCommit ? { NIERS_RELEASE_COMMIT: releaseCommit } : {}),
		},
		stdin: "inherit",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [, , code] = await Promise.all([
		pipeToLog(child.stdout, process.stdout, log),
		pipeToLog(child.stderr, process.stderr, log),
		child.exited,
	]);
	log.end();
	await once(log, "finish");
	if (code !== 0) throw new Error(`${commandText(expanded)} exited with ${code}; log: ${logPath}`);
}

const pipelineStart = performance.now();
const summaries: { stage: StageName; seconds: string }[] = [];
let releaseCommit: string | undefined;
const lockPath = "/tmp/niers-release-all.lock";
let failure: unknown;
try {
	await mkdir(logDirectory, { recursive: true });
	await Bun.write(
		summaryLog,
		`run=${runId}\nmode=${deployEnabled ? "deploy" : "local"}\ndryRun=${dryRun}\n`
	);
	await chmod(summaryLog, 0o600);
	if (!dryRun) {
		const lock = Bun.spawnSync(["mkdir", lockPath]);
		if (lock.exitCode !== 0) throw new Error(`Another release owns ${lockPath}`);
		releaseCommit = await requireReleaseState();
		releaseStage = `${repositoryRoot}/var/releases/${candidateTree ?? releaseCommit}.staging`;
		await rm(releaseStage, { recursive: true, force: true });
		await mkdir(releaseStage, { recursive: true });
		if (deployEnabled) {
			await preflightProduction();
			await snapshotRollbackArtifacts();
		}
	}
	for (const [stageIndex, stage] of selected.entries()) {
		activeStage = stage.name;
		activeStageIndex = stageIndex + 1;
		commandIndex = 0;
		const start = performance.now();
		await logSummary(`START ${stage.name}`);
		if (!dryRun && releaseCommit) await assertImmutable(releaseCommit);
		if (stage.name === "release" && !dryRun) {
			await capture(["git", "fetch", "origin", "main"]);
			const ancestry = Bun.spawnSync([
				"git",
				"merge-base",
				"--is-ancestor",
				"origin/main",
				releaseCommit!,
			]);
			if (ancestry.exitCode !== 0)
				throw new Error(
					"origin/main is not an ancestor of the tested commit; refusing a divergent push."
				);
			const staged = Bun.spawnSync(["git", "diff", "--cached", "--quiet"]);
			if (staged.exitCode !== 0)
				await runCommand({ argv: ["git", "commit", "-m", commitMessage] }, releaseCommit);
			releaseCommit = await capture(["git", "rev-parse", "HEAD"]);
			releaseCommitted = true;
			if (candidateTree && (await capture(["git", "rev-parse", "HEAD^{tree}"])) !== candidateTree)
				throw new Error("Committed tree differs from the tested candidate tree.");
			await writeReleaseManifest(releaseCommit, summaries);
		}
		if (stage.name === "deploy") {
			if (
				!dryRun &&
				(!releaseCommit || !(await Bun.file(`${releaseStage}/manifest.json`).exists()))
			)
				throw new Error("Missing immutable release manifest.");
			if (dryRun)
				process.stdout.write(
					`    atomically publish ${releaseStage}, binaries, site/model services, and CLI stdio MCP\n`
				);
			else await deployProduction(releaseCommit!);
		} else if (stage.name === "live-validation") {
			if (dryRun)
				process.stdout.write(
					"    validate JSON health, icons, modes, and site health payloads\n"
				);
			else {
				try {
					await validateLive();
				} catch (error) {
					await rollbackProduction(releaseCommit!);
					throw error;
				}
			}
		} else {
			for (const command of stage.commands) await runCommand(command, releaseCommit);
			if (stage.name === "build" && !dryRun) await prepareReleaseArtifacts();
		}
		if (stage.name === "release" && !dryRun) {
			const local = await capture(["git", "rev-parse", "HEAD"]);
			const remote = await capture(["git", "rev-parse", "origin/main"]);
			if (local !== releaseCommit || remote !== releaseCommit)
				throw new Error(
					`Exact-commit guard failed: expected ${releaseCommit}, local=${local}, origin/main=${remote}`
				);
		}
		if ((stage.name === "deploy" || stage.name === "live-validation") && !dryRun) {
			const current = await capture(["git", "rev-parse", "HEAD"]);
			if (!releaseCommit || current !== releaseCommit)
				throw new Error("Checkout changed after push; refusing non-exact deployment.");
		}
		if (!dryRun && releaseCommit) await assertImmutable(releaseCommit);
		const seconds = elapsed(start);
		summaries.push({ stage: stage.name, seconds });
		await logSummary(`PASS ${stage.name} ${seconds}`);
	}
} catch (error) {
	failure = error;
	process.stderr.write(
		`\n✗ release pipeline stopped: ${error instanceof Error ? error.message : String(error)}\nlogs: ${logDirectory}\n`
	);
	await appendFile(
		summaryLog,
		`${new Date().toISOString()} FAIL ${error instanceof Error ? error.message : String(error)}\n`
	).catch(() => undefined);
	if (deployEnabled && releaseCommit)
		await finishReleaseManifest(releaseCommit, "failed", summaries, error).catch(() => undefined);
} finally {
	if (deployEnabled && !releaseCommitted && initialIndexTree) {
		Bun.spawnSync(["git", "read-tree", initialIndexTree]);
	}
	if (!dryRun) Bun.spawnSync(["rmdir", lockPath]);
}

if (failure) {
	process.exitCode = 1;
} else {
	if (deployEnabled && releaseCommit)
		await finishReleaseManifest(releaseCommit, "validated", summaries);
	await logSummary(`COMPLETE ${elapsed(pipelineStart)} logs=${logDirectory}`);
	for (const summary of summaries)
		process.stdout.write(`  ${summary.stage.padEnd(16)} ${summary.seconds}\n`);
}
