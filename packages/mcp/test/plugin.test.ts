/** Codex plugin contract for the NIERS source and checked-in mirror. */

import { describe, expect, test } from "bun:test";

const ROOT = `${import.meta.dir}/../../..`;
const PLUGIN = `${ROOT}/plugins/niers-plugin`;
const MIRROR = `${ROOT}/.agents/plugins/niers-plugin`;
const PLUGIN_NAME = "niers";
const MCP_SERVER = "niers-game";

const SKILLS = [
	"aphrody-pet",
	"assembler-modeles-textures",
	"bun-ffi",
	"computer-use-nie-ghidra",
	"creer-assets-3d",
	"formats-level5",
	"ievr-terminologie",
	"jouer-ievr",
	"napi-rs",
	"niers-architecture",
	"niers-autonome",
	"niers-monorepo",
	"peaufiner-rendu-3d",
	"pixel-perfect",
	"rs-to-ts",
	"rust-bun",
	"wasm-bun",
];

async function readJson<T>(path: string): Promise<T> {
	return (await Bun.file(path).json()) as T;
}

function frontmatter(markdown: string): string {
	return markdown.split("---")[1] ?? "";
}

function description(header: string): string | undefined {
	const scalar = /^description:\s*(.+)$/m.exec(header)?.[1]?.trim();
	if (scalar && scalar !== ">" && scalar !== "|" && scalar !== ">-" && scalar !== "|-") return scalar;
	const folded = /^description:\s*[>|][-+]?\s*\r?\n((?:[ \t]+.*\r?\n?)*)/m.exec(header)?.[1];
	return folded?.replaceAll(/\r?\n[ \t]*/g, " ").trim();
}

describe("Codex manifest", () => {
	test("uses the supported Codex manifest and component layout", async () => {
		const manifest = await readJson<{
			name: string;
			version: string;
			description: string;
			skills: string;
			mcpServers: string;
			author: { name: string };
			interface: {
				displayName: string;
				shortDescription: string;
				longDescription: string;
				developerName: string;
				category: string;
				capabilities: string[];
				defaultPrompt: string[];
			};
		}>(`${PLUGIN}/.codex-plugin/plugin.json`);

		expect(manifest.name).toBe(PLUGIN_NAME);
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/);
		expect(manifest.description.length).toBeGreaterThan(40);
		expect(manifest.author.name.length).toBeGreaterThan(0);
		expect(manifest.skills).toBe("./skills/");
		expect(manifest.mcpServers).toBe("./.mcp.json");
		expect(manifest.interface.displayName).toBe("NIERS");
		expect(manifest.interface.shortDescription.length).toBeGreaterThan(20);
		expect(manifest.interface.longDescription.length).toBeGreaterThan(40);
		expect(manifest.interface.developerName.length).toBeGreaterThan(0);
		expect(manifest.interface.category.length).toBeGreaterThan(0);
		expect(manifest.interface.capabilities.length).toBeGreaterThan(0);
		expect(manifest.interface.defaultPrompt).toHaveLength(3);

		const claude = await readJson<{
			$schema: string;
			name: string;
			version: string;
			skills: string;
			mcpServers: string;
		}>(`${PLUGIN}/.claude-plugin/plugin.json`);
		expect(claude.$schema).toBe("https://code.claude.com/schema/plugin.json");
		expect(claude.name).toBe(PLUGIN_NAME);
		expect(claude.version).toBe("0.2.0");
		expect(claude.skills).toBe("./skills");
		expect(claude.mcpServers).toBe("./.mcp.json");

		const agy = await readJson<{ name: string; version: string; description: string }>(`${PLUGIN}/plugin.json`);
		expect(agy.name).toBe(PLUGIN_NAME);
		expect(agy.version).toBe("0.2.0");
		expect(agy.description).toContain("Antigravity CLI (agy)");
	});

	test("keeps the checked-in runtime mirror on the same Codex contract", async () => {
		for (const path of [
			".codex-plugin/plugin.json",
			".claude-plugin/plugin.json",
			".mcp.json",
			"mcp_config.json",
			"plugin.json",
			"README.md",
		]) {
			expect(await Bun.file(`${MIRROR}/${path}`).text()).toBe(await Bun.file(`${PLUGIN}/${path}`).text());
		}
	});
});

describe("native MCP declaration", () => {
	test("starts the native Rust server without a machine-specific path", async () => {
		const config = await readJson<{
			mcpServers: Record<string, { type?: string; command?: string; args?: string[] }>;
		}>(`${PLUGIN}/.mcp.json`);
		const server = config.mcpServers[MCP_SERVER];
		expect(server).toBeDefined();
		expect(server!.type).toBe("stdio");
		expect(server!.command).toBe("cargo");
		expect(server!.args).toEqual(["run", "--release", "--quiet", "--package", "nie-mcp", "--"]);
		expect(await Bun.file(`${ROOT}/crates/tools/nie-mcp/Cargo.toml`).exists()).toBe(true);
		const raw = await Bun.file(`${PLUGIN}/.mcp.json`).text();
		expect(raw).not.toContain("/home/");
		expect(raw).not.toContain("C:\\");
		expect(await Bun.file(`${PLUGIN}/mcp_config.json`).text()).toBe(raw);
	});

	test("publishes the Claude marketplace adapter without reviving the Bun server", async () => {
		const marketplace = await readJson<{
			$schema: string;
			plugins: { name: string; source: string }[];
		}>(`${ROOT}/plugins/.claude-plugin/marketplace.json`);
		expect(marketplace.$schema).toBe("https://anthropic.com/claude-code/marketplace.schema.json");
		expect(marketplace.plugins.some((plugin) => plugin.name === PLUGIN_NAME && plugin.source === "./niers-plugin")).toBe(
			true,
		);
		const declarations = `${await Bun.file(`${PLUGIN}/.mcp.json`).text()}\n${await Bun.file(
			`${PLUGIN}/mcp_config.json`,
		).text()}`;
		expect(declarations).not.toContain("bun");
		expect(declarations).not.toContain("apps/nie-mcp");
	});
});

describe("skills", () => {
	test("ships exactly the declared Codex skills with valid frontmatter", async () => {
		const found: string[] = [];
		const glob = new Bun.Glob("*/SKILL.md");
		for await (const relative of glob.scan({ cwd: `${PLUGIN}/skills`, onlyFiles: true })) {
			found.push(relative.replaceAll("\\", "/").split("/")[0]!);
		}
		expect(found.toSorted()).toEqual([...SKILLS].toSorted());

		for (const name of SKILLS) {
			const source = await Bun.file(`${PLUGIN}/skills/${name}/SKILL.md`).text();
			const header = frontmatter(source);
			expect(source.startsWith("---\n") || source.startsWith("---\r\n")).toBe(true);
			expect(header).toContain(`name: ${name}`);
			expect(description(header)?.length).toBeGreaterThanOrEqual(40);
		}
	});

	test("does not pre-authorize shell or write access from skill metadata", async () => {
		const forbidden = ["Bash", "Write", "Edit", "shell_run", "repo_write", "repo_edit", "repo_delete", "repo_move"];
		for (const name of SKILLS) {
			const header = frontmatter(await Bun.file(`${PLUGIN}/skills/${name}/SKILL.md`).text());
			const declared = /^allowed-tools: *(.*)$/m.exec(header)?.[1] ?? "";
			for (const tool of forbidden) expect(declared).not.toContain(tool);
		}
	});
});
