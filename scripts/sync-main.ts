#!/usr/bin/env bun
/* eslint-disable no-await-in-loop -- Artifact validation and atomic recovery are deliberately ordered. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type Relation = "equal" | "local-ahead" | "remote-ahead" | "diverged";

export function decideRelation(local: string, remote: string, localContainsRemote: boolean, remoteContainsLocal: boolean): Relation {
	if (local === remote) return "equal";
	if (localContainsRemote) return "local-ahead";
	if (remoteContainsLocal) return "remote-ahead";
	return "diverged";
}

export function allowedArtifactPath(path: string): boolean {
	if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return false;
	return /^(?:bin\/(?:niers|nie-site|nie-model-serve)|bundle\/[A-Za-z0-9._/-]+)$/u.test(path);
}

type Artifact = { path: string; sha256: string };
type Manifest = { commit: string; artifacts: Artifact[] };
type Result = { code: number; stdout: string; stderr: string };

const args = Bun.argv.slice(2);
const apply = args.includes("--apply");
const localOnly = args.includes("--local-only");
const unknown = args.filter((arg) => arg !== "--apply" && arg !== "--local-only");
if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(", ")}`);

const sshAlias = process.env.NIERS_VPS_ALIAS ?? "vps";
const remoteRepo = process.env.NIERS_VPS_REPO ?? "/home/ubuntu/niers";
if (!remoteRepo.startsWith("/") || remoteRepo.includes("\n") || remoteRepo.includes("\0")) throw new Error("NIERS_VPS_REPO must be an absolute path.");
if (!/^[A-Za-z0-9_.@-]+$/u.test(sshAlias)) throw new Error("NIERS_VPS_ALIAS contains unsafe characters.");

const runId = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const logDir = resolve("var/log/sync-main", runId);
await mkdir(logDir, { recursive: true });
let sequence = 0;

async function run(argv: string[], mutate = false): Promise<Result> {
	const label = String(++sequence).padStart(3, "0");
	const display = argv.map((part) => /^[A-Za-z0-9_./:@=-]+$/u.test(part) ? part : JSON.stringify(part)).join(" ");
	await writeFile(`${logDir}/${label}.command.txt`, `${mutate && !apply ? "DRY-RUN " : ""}${display}\n`);
	if (mutate && !apply) {
		await Promise.all([
			writeFile(`${logDir}/${label}.stdout.txt`, ""),
			writeFile(`${logDir}/${label}.stderr.txt`, ""),
			writeFile(`${logDir}/${label}.exit.txt`, "DRY-RUN\n"),
		]);
		process.stdout.write(`DRY-RUN ${display}\n`);
		return { code: 0, stdout: "", stderr: "" };
	}
	const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	await Promise.all([
		writeFile(`${logDir}/${label}.stdout.txt`, stdout),
		writeFile(`${logDir}/${label}.stderr.txt`, stderr),
		writeFile(`${logDir}/${label}.exit.txt`, `${code}\n`),
	]);
	if (code !== 0) throw new Error(`${argv[0]} failed with exit ${code}; see ${logDir}/${label}.stderr.txt`);
	return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

const git = (...parts: string[]) => run(["git", ...parts]);
const ssh = (script: string) => run(["ssh", "--", sshAlias, "bash", "-lc", script]);
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

async function isAncestor(older: string, newer: string): Promise<boolean> {
	const child = Bun.spawn(["git", "merge-base", "--is-ancestor", older, newer], { stdout: "ignore", stderr: "ignore" });
	return (await child.exited) === 0;
}

async function localRelation(local: string, remote: string): Promise<Relation> {
	return decideRelation(local, remote, await isAncestor(remote, local), await isAncestor(local, remote));
}

async function remoteHash(): Promise<string> {
	if (localOnly) return (await git("rev-parse", "HEAD")).stdout;
	return (await ssh(`cd ${quote(remoteRepo)} && git rev-parse main`)).stdout;
}

async function sha256(path: string): Promise<string | null> {
	try { return (await run(["sha256sum", "--", path])).stdout.split(/\s+/u)[0] ?? null; }
	catch { return null; }
}

async function remoteSha256(path: string): Promise<string | null> {
	if (localOnly) return sha256(path);
	try { return (await ssh(`sha256sum -- ${quote(path)}`)).stdout.split(/\s+/u)[0] ?? null; }
	catch { return null; }
}

async function readManifest(commit: string): Promise<Manifest> {
	const path = `var/releases/${commit}/manifest.json`;
	let raw: string;
	try { raw = await readFile(path, "utf8"); }
	catch {
		if (localOnly) throw new Error(`Missing ${path}`);
		raw = (await ssh(`cat -- ${quote(`${remoteRepo}/${path}`)}`)).stdout;
		if (apply) {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, `${raw}\n`);
		}
	}
	const manifest = JSON.parse(raw) as Manifest;
	if (manifest.commit !== commit || !Array.isArray(manifest.artifacts)) throw new Error(`Invalid same-commit manifest ${path}`);
	for (const artifact of manifest.artifacts) {
		if (!allowedArtifactPath(artifact.path) || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) throw new Error(`Unsafe artifact manifest entry: ${artifact.path}`);
	}
	return manifest;
}

async function commandExists(name: string): Promise<boolean> {
	const child = Bun.spawn(["bash", "-lc", `command -v ${name}`], { stdout: "ignore", stderr: "ignore" });
	return (await child.exited) === 0;
}

async function copyFromVps(remote: string, local: string, expected: string): Promise<void> {
	const temporary = `${local}.sync-main-${runId}`;
	await mkdir(dirname(local), { recursive: true });
	await run(await commandExists("vps-copy") ? ["vps-copy", remote, temporary] : ["scp", "--", `${sshAlias}:${remote}`, temporary], true);
	if (apply) {
		if (await sha256(temporary) !== expected) throw new Error(`Downloaded checksum mismatch for ${local}`);
		await rename(temporary, local);
	}
}

async function copyToVps(local: string, remote: string, expected: string): Promise<void> {
	const temporary = `${remote}.sync-main-${runId}`;
	if (await commandExists("vps-upload")) {
		await run(["vps-upload", local, temporary], true);
	} else {
		await run(["ssh", "--", sshAlias, "bash", "-lc", `mkdir -p -- ${quote(dirname(remote))}`], true);
		await run(["scp", "--", local, `${sshAlias}:${temporary}`], true);
	}
	if (apply) {
		if (await remoteSha256(temporary) !== expected) throw new Error(`Uploaded checksum mismatch for ${remote}`);
		await run(["ssh", "--", sshAlias, "mv", "--", temporary, remote], true);
	}
}

async function reconcileArtifacts(commit: string): Promise<void> {
	if (localOnly) return;
	const manifest = await readManifest(commit);
	for (const artifact of manifest.artifacts) {
		const local = resolve(`var/releases/${commit}`, artifact.path);
		const remote = `${remoteRepo}/var/releases/${commit}/${artifact.path}`;
		const [localHash, vpsHash] = await Promise.all([sha256(local), remoteSha256(remote)]);
		if (localHash === artifact.sha256 && vpsHash === artifact.sha256) continue;
		if (vpsHash === artifact.sha256 && localHash !== artifact.sha256) await copyFromVps(remote, local, artifact.sha256);
		else if (localHash === artifact.sha256 && vpsHash !== artifact.sha256) await copyToVps(local, remote, artifact.sha256);
		else throw new Error(`No verified same-commit source for ${artifact.path}`);
	}
}

async function main(): Promise<void> {
	const branch = (await git("branch", "--show-current")).stdout;
	if (branch !== "main") throw new Error(`Expected local main, found ${branch || "detached HEAD"}`);
	const dirty = (await git("status", "--porcelain", "--untracked-files=all")).stdout;
	if (dirty && apply) throw new Error("Working tree must be clean before applying source reconciliation.");
	if (dirty) process.stdout.write("DRY-RUN warning: working tree is dirty; --apply would refuse.\n");
	const local = (await git("rev-parse", "HEAD")).stdout;
	let origin = (await run(["git", "ls-remote", "origin", "refs/heads/main"])).stdout.split(/\s+/u)[0];
	if (!origin) throw new Error("origin/main was not returned by git ls-remote.");
	const vps = await remoteHash();
	process.stdout.write(`local=${local}\norigin=${origin}\nvps=${vps}\n`);

	if (apply) await run(["git", "fetch", "origin", "main"], true);
	const originKnown = apply || (await git("cat-file", "-e", `${origin}^{commit}`).then(() => true, () => false));
	if (!originKnown) throw new Error("origin/main commit is not local; rerun with --apply to fetch before ancestry decisions.");
	const localVsOrigin = await localRelation(local, origin);
	if (localVsOrigin === "diverged") throw new Error("local main and origin/main diverged.");
	if (localVsOrigin === "local-ahead") {
		await run(["git", "push", "origin", "main"], true);
		if (apply) {
			await run(["git", "fetch", "origin", "main"], true);
			origin = (await git("rev-parse", "origin/main")).stdout;
			if (origin !== local) throw new Error("origin/main does not equal the pushed local commit.");
		} else {
			origin = local;
		}
	}
	if (localVsOrigin === "remote-ahead") await run(["git", "merge", "--ff-only", "origin/main"], true);

	if (!localOnly && vps !== origin) {
		const vpsKnown = await git("cat-file", "-e", `${vps}^{commit}`).then(() => true, () => false);
		if (!vpsKnown) throw new Error("VPS commit is not available locally; apply mode must fetch it through origin before reconciliation.");
		const vpsVsOrigin = await localRelation(vps, origin);
		if (vpsVsOrigin === "local-ahead") throw new Error("VPS is ahead of origin/main; publish that commit to origin before syncing.");
		if (vpsVsOrigin === "diverged") throw new Error("VPS and origin/main diverged.");
	}

	const target = localVsOrigin === "local-ahead" ? local : origin;
	if (!localOnly && vps !== target) {
		const remoteDirty = (await ssh(`cd ${quote(remoteRepo)} && git status --porcelain --untracked-files=all`)).stdout;
		if (remoteDirty) throw new Error("VPS checkout must be clean before fast-forwarding.");
		await run(["ssh", "--", sshAlias, "bash", "-lc", `cd ${quote(remoteRepo)} && git fetch origin main && git merge --ff-only origin/main`], true);
	}
	await reconcileArtifacts(target);
	process.stdout.write(`${apply ? "Applied" : "Planned"} reconciliation for ${target}. Logs: ${logDir}\n`);
}

if (import.meta.main) {
	main().catch((error) => {
		process.stderr.write(`sync-main failed: ${error instanceof Error ? error.message : String(error)}\nLogs: ${logDir}\n`);
		process.exitCode = 1;
	});
}
