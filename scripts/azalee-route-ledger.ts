/** Reproducible, read-only legacy contract inventory. No route is declared migrated by name. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Contract {
	kind: "page" | "headless_api" | "next_handler";
	path: string;
	source: string;
	classification: "game" | "editorial" | "author";
	owner: string;
	destination: string;
	status: "adapter_pending" | "retained_in_rg" | "native_only";
	proof: { test: string; intentionalOmissions: string[] } | null;
}

export function classify(path: string, kind: Contract["kind"]): Pick<Contract, "classification" | "owner" | "destination" | "status"> {
	if (["/_not-found", "/_global-error", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/favicon.ico"].includes(path)) {
		return { classification: "editorial", owner: "rg framework metadata", destination: `rg:${path}`, status: "retained_in_rg" };
	}
	if (/^\/(?:dashboard\/database|dashboard\/zukan-review|api\/cpk)(?:\/|$)/.test(path)
		|| /^\/tools\/niers(?:\/|$)/.test(path) || (kind === "headless_api" && ["/health", "/"].includes(path))) {
		return { classification: "author", owner: "Inacord native adapters", destination: "native capability boundary", status: "native_only" };
	}
	if (/^\/(?:dashboard|api\/(?:ops|admin|cron|llm|rag|articles))(?:\/|$)/.test(path)) {
		return { classification: "author", owner: "rg privileged adapters", destination: `rg:${path}`, status: "retained_in_rg" };
	}
	const gameHandler = ["/api/graphql", "/api/common", "/api/og/character"].includes(path)
		|| /^\/api\/(?:mode-tex|save)(?:\/|$)/.test(path)
		|| /^\/api\/vroid\/(?:image|models|vrm)(?:\/|$)/.test(path)
		|| /^\/(?:chara|skill|item|aura|passive|tactic)(?:\/[^/]+)?\/opengraph-image$/.test(path);
	if ((kind === "next_handler" && !gameHandler)
		|| /^\/(?:2fa|auth|login|profil|settings|news|patch-notes|legal|charte|contact|soutenir|maintenance)(?:\/|$)/.test(path)) {
		return { classification: "editorial", owner: "rg", destination: `rg:${path}`, status: "retained_in_rg" };
	}
	const family = path.replace(/^\/api\//, "/").split("/")[1] ?? "";
	const media = ["gallery", "textures", "sons", "videos", "modeles", "vroid"].includes(family);
	const runtime = ["", "demo", "mode", "avatar", "save"].includes(family) && kind === "page";
	return {
		classification: "game",
		owner: runtime ? "nie-game / nie-lua / nie-save" : media ? "nie-wiki / nie-formats" : "nie-wiki / nie-core",
		destination: kind === "page" ? `nie-web compatibility:${path}` : `nie-site compatibility:${path}`,
		status: "adapter_pending",
	};
}

/** Build outputs include generated metadata and error pages; never call them source pages. */
export function classifyBuildOutputs(routes: Record<string, string>) {
	return Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)).map(([source, path]) => {
		const kind = source.endsWith("/page") ? "page" : "next_handler";
		return { source, path, kind, ...classify(path, kind) };
	});
}

/** Captured-response tests prove compatibility, not complete UI/native migration. */
export function adapterProof(path: string): Contract["proof"] {
	const cases: Record<string, string> = {
		"/api/characters": "legacy_player_http_matches_captured_historical_json",
		"/api/coordinators": "legacy_player_http_matches_captured_historical_json",
		"/api/coaches": "legacy_coaches_http_matches_complete_historical_json",
		"/api/coaches/:id": "legacy_coaches_http_matches_complete_historical_json",
		"/api/teams": "legacy_teams_http_matches_complete_historical_json",
		"/api/teams/:id": "legacy_teams_http_matches_complete_historical_json",
		"/api/characters/:slug": "legacy_character_detail_http_matches_isolated_historical_json",
		"/api/skills": "legacy_equipment_http_matches_captured_historical_json",
		"/api/skills/:id": "legacy_equipment_http_matches_captured_historical_json",
		"/api/items": "legacy_equipment_http_matches_captured_historical_json",
		"/api/items/:id": "legacy_equipment_http_matches_captured_historical_json",
		"/api/gallery": "legacy_gallery_http_matches_captured_historical_json",
		"/api/cross/tables": "cross_legacy_and_canonical_routes_share_safe_library_projections",
		"/api/cross/stats": "cross_legacy_and_canonical_routes_share_safe_library_projections",
	};
	const test = cases[path];
	return test ? {
		test: `crates/tools/nie-site/tests/wiki_catalog.rs::${test}`,
		intentionalOmissions: path === "/api/cross/stats" ? ["source: private filesystem path is never public"] : [],
	} : null;
}

function pagePath(file: string): string {
	return "/" + file.replace(/^apps\/azalee\/app\//, "").replace(/\/(?:page|route)\.tsx?$/, "")
		.replace(/^(?:page|route)\.tsx?$/, "").split("/").filter(part => !/^\(.+\)$/.test(part)).join("/");
}

if (import.meta.main) {
	const sourceRoot = process.argv[2] ?? "/home/ubuntu/rg";
	const historicalRef = process.argv[3] ?? "d5659256";
	const git = (...args: string[]) => execFileSync("git", ["-C", sourceRoot, ...args], { encoding: "utf8" }).trim();
	const baseline = git("rev-parse", `${historicalRef}^{commit}`);
	// The source workspace can be migrated concurrently; inventory an immutable snapshot.
	const sourceRef = process.argv[5] ?? "93aea3ba8b703d8ca66ca8d3b98988edea3c97df";
	const current = git("rev-parse", `${sourceRef}^{commit}`);
	const files = (ref: string) => git("ls-tree", "-r", "--name-only", ref, "apps/azalee/app").split("\n");
	const historicalFiles = files(baseline);
	const currentFiles = files(current);
	const source = (ref: string, path: string) => git("show", `${ref}:${path}`);
	const records: Contract[] = [];
	for (const file of [...new Set([...historicalFiles, ...currentFiles])].sort()) {
		if (!/\/(?:page|route)\.tsx?$/.test(file)) continue;
		const kind = /\/page\.tsx?$/.test(file) ? "page" : "next_handler";
		const path = pagePath(file);
		records.push({ kind, path, source: file, ...classify(path, kind), proof: null });
	}
	const serverPath = "packages/azalee/src/server/serve.ts";
	for (const match of source(current, serverPath).matchAll(/^route\("([^"]*)"/gm)) {
		const path = "/" + match[1];
		const cross = ["/api/cross/tables", "/api/cross/stats"].includes(path);
		records.push({ kind: "headless_api", path, source: serverPath, ...classify(path, "headless_api"),
			...(cross ? { owner: "nie-wiki::cross", destination: path.replace("/api/cross/", "/api/v1/wiki/cross/") } : {}),
			proof: adapterProof(path),
		});
	}
	const buildDirectory = process.argv[6];
	const manifestFile = "app-path-routes-manifest.json";
	const buildBytes = buildDirectory ? readFileSync(join(buildDirectory, manifestFile)) : null;
	const deployedBuildInventory = buildBytes ? {
		source: join(buildDirectory!, manifestFile),
		sha256: createHash("sha256").update(buildBytes).digest("hex"),
		buildId: readFileSync(join(buildDirectory!, "BUILD_ID"), "utf8").trim(),
		sourceCommitVerified: false,
		contracts: classifyBuildOutputs(JSON.parse(buildBytes.toString()) as Record<string, string>),
		note: "Separate surviving build snapshot; it does not prove the 2026-09-05 120-output enumeration.",
	} : null;
	const report = {
		schemaVersion: 1,
		sourceRepository: "rg",
		baselineCommit: baseline,
		currentCommit: current,
		deployedBuildInventory,
		historicalBuildClaim: {
			count: 120,
			source: "docs/archive/plans/2026-09-08/PLAN-legacy-2026-09-05-to-08.md:671",
			measuredAt: "2026-09-05T07:05:00Z",
			enumeratedBuildArtifactAvailable: false,
			note: "Historical build count is not a source-page count; do not claim 120 identified pages.",
		},
		counts: {
			baselineSourcePages: historicalFiles.filter(file => /\/page\.tsx?$/.test(file)).length,
			currentSourcePages: currentFiles.filter(file => /\/page\.tsx?$/.test(file)).length,
			unionPages: records.filter(record => record.kind === "page").length,
			nextHandlers: records.filter(record => record.kind === "next_handler").length,
			headlessApis: records.filter(record => record.kind === "headless_api").length,
			provenMigrated: 0,
			contractsWithAdapterTests: records.filter(record => record.proof !== null).length,
		},
		contracts: records,
	};
	if (process.argv[4]) {
		await Bun.write(process.argv[4], JSON.stringify(report, null, 2) + "\n");
		console.log(JSON.stringify(report.counts));
	} else console.log(JSON.stringify(report, null, 2));
}
