#!/usr/bin/env bun
/**
 * Export/import the portable workspace layer (docs, scripts, deployment source and manifests).
 * Game dumps, build output, caches, credentials and generated data are never transferred.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type Entry = { path: string; sha256: string; bytes: number };
type Manifest = { format: 1; root: string; created_at: string; entries: Entry[] };

const root = resolve(process.env.NIE_REPO_ROOT ?? join(import.meta.dir, ".."));
const args = Bun.argv.slice(2);
const command = args[0];
const value = (name: string, fallback?: string): string => {
	const index = args.indexOf(name);
	return index >= 0 && args[index + 1] ? args[index + 1]! : fallback ?? "";
};

const forbidden = [
	/^\.git(?:\/|$)/u,
	/^(?:target|var|node_modules|dist|build|data)(?:\/|$)/u,
	/(?:^|\/)(?:\.env|.*\.pem|.*\.key|.*\.p12)$/iu,
	/(?:^|\/)(?:dumps?|roms?|assets?)(?:\/|$)/iu,
];
const allowedRoots = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "PLAN.md", "docs", "scripts", "deploy", "Cargo.toml", "Cargo.lock", "package.json", "bun.lock", "justfile", "rust-toolchain.toml", "deny.toml", "vcpkg.json", "pyproject.toml", "uv.lock", "tsconfig.json"];

function safePath(path: string): boolean {
	return path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..")
		&& !forbidden.some((pattern) => pattern.test(path))
		&& allowedRoots.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

async function sha256(path: string): Promise<string> {
	const hash = createHash("sha256");
	hash.update(await readFile(path));
	return hash.digest("hex");
}

async function filesUnder(path: string): Promise<string[]> {
	try { await stat(join(root, path)); } catch { return []; }
	const info = await stat(join(root, path));
	if (info.isFile()) return [path];
	const output: string[] = [];
	for (const item of await readdir(join(root, path), { withFileTypes: true })) {
		const child = `${path}/${item.name}`;
		if (item.isDirectory()) output.push(...await filesUnder(child));
		else if (item.isFile() && safePath(child)) output.push(child);
	}
	return output;
}

async function exportWorkspace(): Promise<void> {
	const output = resolve(root, value("--output", "var/transfers/latest"));
	if (output === root) throw new Error("The export destination must not be the repository root.");
	const requested = args.filter((arg, index) => index > 0 && arg !== "--output" && args[index - 1] !== "--output");
	const paths = requested.length ? requested : allowedRoots;
	const all = [...new Set((await Promise.all(paths.map(filesUnder))).flat())].filter(safePath).sort();
	const entries: Entry[] = [];
	for (const path of all) {
		const source = join(root, path);
		const bytes = (await stat(source)).size;
		await mkdir(dirname(join(output, path)), { recursive: true });
		await writeFile(join(output, path), await readFile(source));
		entries.push({ path, bytes, sha256: await sha256(source) });
	}
	const manifest: Manifest = { format: 1, root: "portable-workspace", created_at: new Date().toISOString(), entries };
	await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`exported ${entries.length} files to ${output}`);
}

async function importWorkspace(): Promise<void> {
	const manifestPath = resolve(value("--manifest"));
	if (!manifestPath) throw new Error("Usage: import --manifest <path> [--root <repo>] [--dry-run]");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
	if (manifest.format !== 1 || manifest.root !== "portable-workspace") throw new Error("Unsupported transfer manifest");
	const sourceRoot = dirname(manifestPath);
	const destination = resolve(value("--root", root));
	const dryRun = args.includes("--dry-run");
	for (const entry of manifest.entries) {
		if (!safePath(entry.path)) throw new Error(`Unsafe manifest path: ${entry.path}`);
		const source = join(sourceRoot, entry.path);
		const destinationPath = join(destination, entry.path);
		if ((await stat(source)).size !== entry.bytes || await sha256(source) !== entry.sha256) throw new Error(`Hash/size mismatch: ${entry.path}`);
		console.log(`${dryRun ? "would import" : "importing"} ${entry.path}`);
		if (!dryRun) { await mkdir(dirname(destinationPath), { recursive: true }); await writeFile(destinationPath, await readFile(source)); }
	}
}

if (command === "export") await exportWorkspace();
else if (command === "import") await importWorkspace();
else throw new Error("Usage: bun scripts/workspace-transfer.ts <export|import> [options]");
