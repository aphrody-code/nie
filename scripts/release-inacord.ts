#!/usr/bin/env bun
/* eslint-disable no-await-in-loop -- Publication validates and copies a bounded ordered set. */

/**
 * Build the public, same-origin Inacord download channel.
 *
 * Public clients use this same-origin channel rather than coupling updates to a forge. This
 * publisher imports the last signed desktop release, packages the current Linux CLI/MCP and
 * plugins, verifies signatures and archive contents, then atomically points `public` at an
 * immutable commit directory.
 */

import {
	chmod,
	copyFile,
	appendFile,
	lstat,
	mkdir,
	readFile,
	readlink,
	rename,
	rm,
	stat,
	symlink,
} from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const releaseRoot = resolve(root, "var/releases/inacord");
const live = resolve(releaseRoot, "public");
const desktopTag = process.env.INACORD_DESKTOP_TAG || "v0.5.9";
const origin = "https://inacord.aphrody.com";

type Product = {
	id: string;
	kind: "desktop" | "cli" | "mobile" | "mcp" | "plugin" | "web";
	name: string;
	description: string;
	status: "available" | "requires-native-host";
	version: string;
	platform: string;
	url: string;
	size?: number;
	sha256?: string;
	signatureUrl?: string;
};

function run(argv: string[], cwd = root): string {
	const result = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		const detail = new TextDecoder().decode(result.stderr).trim();
		throw new Error(`${argv.join(" ")} failed${detail ? `: ${detail}` : ""}`);
	}
	return new TextDecoder().decode(result.stdout).trim();
}

function runExit(argv: string[], cwd = root): number {
	return Bun.spawnSync(argv, { cwd, stdout: "ignore", stderr: "ignore" }).exitCode;
}

function assertSafeArchive(entries: string[], archive: string): void {
	const unsafe = entries.find((entry) =>
		entry.startsWith("/") ||
		entry.includes("../") ||
		/(^|\/)(\.env(?:\.|$)|data|var|\.git)(\/|$)/u.test(entry) ||
		/\.(?:pem|key|p12|pfx|map)$/iu.test(entry) ||
		entry.includes("/home/"),
	);
	if (unsafe) throw new Error(`${archive} contains forbidden entry ${unsafe}`);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function renderHomepage(products: Product[]): string {
	const links = products.map((product) => {
		const meta = [product.platform, `v${product.version}`, product.size ? `${(product.size / 1_048_576).toFixed(1)} MiB` : ""]
			.filter(Boolean)
			.map(escapeHtml)
			.join(" · ");
		const action = product.url
			? `<a class="download" href="${escapeHtml(product.url)}">Télécharger</a>`
			: '<span class="unavailable">Bientôt disponible</span>';
		return `<li><div><strong>${escapeHtml(product.name)}</strong><small>${meta}</small><p>${escapeHtml(product.description)}</p></div>${action}</li>`;
	}).join("");
	return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inacord — téléchargements</title><meta name="description" content="Téléchargez Inacord Desktop, CLI, MCP et plugins.">
<meta name="theme-color" content="#071018"><link rel="manifest" href="/manifest.webmanifest">
<style>*{box-sizing:border-box}body{margin:0;background:#071018;color:#eaf5ff;font:15px/1.45 system-ui,sans-serif}main{width:min(860px,calc(100% - 32px));margin:auto;padding:56px 0 80px}header{display:flex;gap:24px;align-items:center;justify-content:space-between;margin-bottom:36px}h1{font-size:clamp(36px,8vw,68px);line-height:1;margin:0}h2{margin:42px 0 12px}p{color:#a9bdca;margin:.35rem 0}.actions{display:flex;gap:10px;flex-wrap:wrap}a{color:#6fe4ff}a.primary,.download{background:#6fe4ff;color:#041014;text-decoration:none;font-weight:750;border-radius:999px;padding:11px 17px}.ghost{border:1px solid #35505f;border-radius:999px;padding:10px 16px;text-decoration:none}ul{list-style:none;padding:0;margin:0;border-top:1px solid #263d49}li{display:flex;gap:20px;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid #263d49}small{display:block;color:#78a0b2;margin-top:3px}.download{white-space:nowrap;padding:8px 13px}.unavailable{color:#78909b;font-size:13px}code{background:#10232d;border-radius:6px;padding:2px 6px}section.quick{border:1px solid #263d49;border-radius:16px;padding:20px;margin-top:42px}.quick p{margin:.8rem 0}@media(max-width:620px){main{padding-top:32px}header,li{align-items:flex-start;flex-direction:column}.download{width:100%;text-align:center}}</style></head>
<body><main><header><div><h1>Inacord</h1><p>Desktop, CLI, MCP, mobile web et plugins — un seul endroit.</p></div><nav class="actions"><a class="primary" href="/app">Ouvrir l’app</a><a class="ghost" href="#quickstart">Docs rapides</a></nav></header>
<ul>${links}</ul>
<section class="quick" id="quickstart"><h2>Docs rapides</h2><p><strong>Desktop</strong> — lancez l’installateur Windows. Les mises à jour signées arrivent automatiquement par le canal stable.</p><p><strong>CLI</strong> — extrayez l’archive puis installez avec <code>install -m 0755 niers ~/.local/bin/niers</code>.</p><p><strong>MCP</strong> — placez <code>nie-mcp</code> sur votre <code>PATH</code>, puis configurez-le comme serveur stdio avec la commande <code>nie-mcp</code>.</p><p><strong>Plugins</strong> — importez l’archive Blender ou le plugin agent depuis leur gestionnaire respectif.</p><p><strong>Mobile</strong> — ouvrez <a href="/app">l’app web</a> puis utilisez « Ajouter à l’écran d’accueil ».</p></section>
</main></body></html>\n`;
}

async function sha256(path: string): Promise<string> {
	return new Bun.CryptoHasher("sha256")
		.update(await Bun.file(path).arrayBuffer())
		.digest("hex");
}

async function fileProduct(
	base: Omit<Product, "size" | "sha256">,
	path: string,
): Promise<Product> {
	const info = await stat(path);
	if (!info.isFile() || info.size === 0) throw new Error(`${path} is not a non-empty file`);
	return { ...base, size: info.size, sha256: await sha256(path) };
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await Bun.write(path, `${JSON.stringify(value, null, "\t")}\n`);
	await chmod(path, 0o644);
}

async function main(): Promise<void> {
	const status = run(["git", "status", "--porcelain", "--untracked-files=all"]);
	if (status) throw new Error("Inacord publication requires a clean checkout");
	if (run(["git", "branch", "--show-current"]) !== "main") {
		throw new Error("Inacord publication requires the main branch");
	}
	const commit = run(["git", "rev-parse", "HEAD"]);
	const remote = run(["git", "rev-parse", "origin/main"]);
	if (commit !== remote) throw new Error("HEAD must equal origin/main before publication");
	const next = resolve(releaseRoot, `${commit}.next`);
	const release = resolve(releaseRoot, commit);
	if (await lstat(release).catch(() => null)) {
		throw new Error(`Immutable Inacord release already exists: ${release}`);
	}

	const packageManifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
		version: string;
	};
	const version = packageManifest.version;
	if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("Invalid workspace version");
	const desktopVersion = desktopTag.replace(/^v/u, "");
	const blenderManifest = await readFile(
		resolve(root, "plugins/niers-blender/blender_manifest.toml"),
		"utf8",
	);
	const blenderVersion = /^version\s*=\s*"([^"]+)"/mu.exec(blenderManifest)?.[1];
	if (!blenderVersion) throw new Error("Blender plugin version is missing");

	await rm(next, { recursive: true, force: true });
	await mkdir(resolve(next, "files/desktop/windows-x86_64"), { recursive: true });
	await mkdir(resolve(next, "files/cli/linux-x86_64"), { recursive: true });
	await mkdir(resolve(next, "files/mcp/linux-x86_64"), { recursive: true });
	await mkdir(resolve(next, "files/plugins"), { recursive: true });
	await mkdir(resolve(next, "channels/stable"), { recursive: true });

	const desktopStage = resolve(releaseRoot, `desktop-${desktopTag}`);
	await rm(desktopStage, { recursive: true, force: true });
	await mkdir(desktopStage, { recursive: true });
	run(
		[
			"gh",
			"release",
			"download",
			desktopTag,
			"--repo",
			"aphrody-code/nie",
			"--pattern",
			"*x64*",
			"--dir",
			desktopStage,
		],
		root,
	);
	const desktopAssets = Array.from(new Bun.Glob("*").scanSync(desktopStage));
	const nsisName = desktopAssets.find((name) => name.endsWith("-setup.exe"));
	const msiName = desktopAssets.find((name) => name.endsWith(".msi"));
	if (!nsisName || !msiName) throw new Error(`${desktopTag} has no Windows installer pair`);
	for (const name of [nsisName, `${nsisName}.sig`, msiName, `${msiName}.sig`]) {
		if (!desktopAssets.includes(name)) throw new Error(`${desktopTag} is missing ${name}`);
		await copyFile(
			resolve(desktopStage, name),
			resolve(next, "files/desktop/windows-x86_64", name),
		);
	}

	for (const binary of ["niers", "nie-mcp"]) {
		const path = resolve(root, "target/release", binary);
		const info = await stat(path).catch(() => null);
		if (!info?.isFile()) throw new Error(`Missing release binary: ${path}`);
	}
	const cliArchive = resolve(next, "files/cli/linux-x86_64", `niers-${version}-linux-x86_64.tar.gz`);
	const mcpArchive = resolve(next, "files/mcp/linux-x86_64", `nie-mcp-${version}-linux-x86_64.tar.gz`);
	const archiveStage = resolve(releaseRoot, "archive-stage");
	await rm(archiveStage, { recursive: true, force: true });
	await mkdir(resolve(archiveStage, "cli"), { recursive: true });
	await mkdir(resolve(archiveStage, "mcp"), { recursive: true });
	await copyFile(resolve(root, "target/release/niers"), resolve(archiveStage, "cli/niers"));
	await copyFile(resolve(root, "target/release/nie-mcp"), resolve(archiveStage, "mcp/nie-mcp"));
	await chmod(resolve(archiveStage, "cli/niers"), 0o755);
	await chmod(resolve(archiveStage, "mcp/nie-mcp"), 0o755);
	run(["tar", "-czf", cliArchive, "-C", resolve(archiveStage, "cli"), "niers"]);
	run(["tar", "-czf", mcpArchive, "-C", resolve(archiveStage, "mcp"), "nie-mcp"]);

	const blenderArchive = resolve(next, "files/plugins", `niers-blender-${blenderVersion}.zip`);
	const agentArchive = resolve(next, "files/plugins", `niers-agent-plugin-${version}.zip`);
	run(["zip", "-qr", blenderArchive, "niers-blender", "-x", "*/__pycache__/*", "*.pyc"], resolve(root, "plugins"));
	run(["zip", "-qr", agentArchive, "niers-plugin"], resolve(root, "plugins"));

	const nsisPath = resolve(next, "files/desktop/windows-x86_64", nsisName);
	const msiPath = resolve(next, "files/desktop/windows-x86_64", msiName);
	const nsisSignature = (
		await readFile(resolve(next, "files/desktop/windows-x86_64", `${nsisName}.sig`), "utf8")
	).trim();
	if (!nsisSignature) throw new Error("Desktop updater signature is empty");
	const tauriConfig = JSON.parse(
		await readFile(resolve(root, "apps/inacord/src-tauri/tauri.conf.json"), "utf8"),
	) as { plugins: { updater: { pubkey: string } } };
	const publicKeyFile = Buffer.from(tauriConfig.plugins.updater.pubkey, "base64").toString("utf8");
	const publicKey = publicKeyFile.split("\n").find((line) => line.startsWith("RW"));
	if (!publicKey) throw new Error("Tauri updater public key is invalid");
	if (runExit(["minisign", "-Vm", nsisPath, "-x", `${nsisPath}.sig`, "-P", publicKey]) !== 0) {
		throw new Error("Desktop updater signature verification failed");
	}
	const tamperedInstaller = resolve(releaseRoot, "tampered-installer.exe");
	await copyFile(nsisPath, tamperedInstaller);
	await appendFile(tamperedInstaller, new Uint8Array([0]));
	if (runExit(["minisign", "-Vm", tamperedInstaller, "-x", `${nsisPath}.sig`, "-P", publicKey]) === 0) {
		throw new Error("Tampered desktop installer unexpectedly passed signature verification");
	}
	await rm(tamperedInstaller, { force: true });

	const products: Product[] = [
		await fileProduct(
			{
				id: "desktop-windows-installer",
				kind: "desktop",
				name: "Inacord for Windows",
				description: "Signed Windows installer with automatic updates.",
				status: "available",
				version: desktopVersion,
				platform: "Windows x86_64",
				url: `/downloads/files/desktop/windows-x86_64/${nsisName}`,
				signatureUrl: `/downloads/files/desktop/windows-x86_64/${nsisName}.sig`,
			},
			nsisPath,
		),
		await fileProduct(
			{
				id: "desktop-windows-msi",
				kind: "desktop",
				name: "Inacord MSI",
				description: "Signed Windows MSI package for managed installation.",
				status: "available",
				version: desktopVersion,
				platform: "Windows x86_64",
				url: `/downloads/files/desktop/windows-x86_64/${msiName}`,
				signatureUrl: `/downloads/files/desktop/windows-x86_64/${msiName}.sig`,
			},
			msiPath,
		),
		await fileProduct(
			{
				id: "cli-linux",
				kind: "cli",
				name: "niers CLI",
				description: "Native command-line tools for Linux.",
				status: "available",
				version,
				platform: "Linux x86_64",
				url: `/downloads/files/cli/linux-x86_64/${basename(cliArchive)}`,
			},
			cliArchive,
		),
		await fileProduct(
			{
				id: "mcp-linux",
				kind: "mcp",
				name: "Inacord MCP",
				description: "Native stdio MCP server for Linux clients.",
				status: "available",
				version,
				platform: "Linux x86_64",
				url: `/downloads/files/mcp/linux-x86_64/${basename(mcpArchive)}`,
			},
			mcpArchive,
		),
		await fileProduct(
			{
				id: "plugin-blender",
				kind: "plugin",
				name: "Blender plugin",
				description: "Import, inspect and round-trip supported Level-5 assets in Blender.",
				status: "available",
				version: blenderVersion,
				platform: "Blender",
				url: `/downloads/files/plugins/${basename(blenderArchive)}`,
			},
			blenderArchive,
		),
		await fileProduct(
			{
				id: "plugin-agent",
				kind: "plugin",
				name: "Agent plugin",
				description: "Inacord skills and MCP configuration for compatible coding agents.",
				status: "available",
				version,
				platform: "Codex / Claude Code",
				url: `/downloads/files/plugins/${basename(agentArchive)}`,
			},
			agentArchive,
		),
		{
			id: "mobile-web",
			kind: "mobile",
			name: "Inacord Mobile Web",
			description: "Installable web application; native device and filesystem tools remain desktop-only.",
			status: "available",
			version,
			platform: "Android / iOS browser",
			url: "/app",
		},
		{
			id: "web-workspace",
			kind: "web",
			name: "Inacord Web",
			description: "The complete Inacord workspace connected to the read-only production backend.",
			status: "available",
			version,
			platform: "Modern browser",
			url: "/app",
		},
	];

	const publishedAt = new Date().toISOString();
	await writeJson(resolve(next, "catalog.json"), {
		schemaVersion: 1,
		channel: "stable",
		publishedAt,
		products,
	});
	await Bun.write(resolve(next, "index.html"), renderHomepage(products));
	await chmod(resolve(next, "index.html"), 0o644);
	await writeJson(resolve(next, "channels/stable/latest.json"), {
		version: desktopVersion,
		notes: "Stable signed Inacord desktop release.",
		pub_date: publishedAt,
		platforms: {
			"windows-x86_64": {
				signature: nsisSignature,
				url: `${origin}/downloads/files/desktop/windows-x86_64/${nsisName}`,
			},
		},
	});
	await writeJson(resolve(next, "manifest.json"), {
		commit,
		desktopSignatureVerified: true,
		tamperTestRejected: true,
		publishedAt,
		products: products.map(({ id, size, sha256: digest, url }) => ({
			id,
			size,
			sha256: digest,
			url,
		})),
		schemaVersion: 1,
	});

	for (const product of products) {
		if (!product.size) continue;
		const path = resolve(next, product.url.replace(/^\/downloads\//u, ""));
		if ((await stat(path)).size !== product.size) throw new Error(`${product.id} size drift`);
		if ((await sha256(path)) !== product.sha256) throw new Error(`${product.id} hash drift`);
	}
	assertSafeArchive(run(["tar", "-tzf", cliArchive]).split("\n"), basename(cliArchive));
	assertSafeArchive(run(["tar", "-tzf", mcpArchive]).split("\n"), basename(mcpArchive));
	assertSafeArchive(run(["unzip", "-Z1", blenderArchive]).split("\n"), basename(blenderArchive));
	assertSafeArchive(run(["unzip", "-Z1", agentArchive]).split("\n"), basename(agentArchive));

	await rename(next, release);
	let previousRelease: string | null = null;
	const liveState = await lstat(live).catch(() => null);
	if (liveState?.isSymbolicLink()) previousRelease = await readlink(live);
	if (liveState && !liveState.isSymbolicLink()) {
		const legacy = resolve(releaseRoot, `legacy-${Date.now()}`);
		await rename(live, legacy);
		previousRelease = basename(legacy);
	}
	const nextLink = resolve(releaseRoot, "public-next");
	await rm(nextLink, { force: true });
	await symlink(commit, nextLink);
	await rename(nextLink, live);
	await writeJson(resolve(release, "rollback.json"), { previousRelease });
	await rm(desktopStage, { recursive: true, force: true });
	await rm(archiveStage, { recursive: true, force: true });
	process.stdout.write(
		`Published ${products.length} Inacord products for ${commit} (${desktopTag} desktop, ${version} tools; signature verified).\n`,
	);
}

await main();
