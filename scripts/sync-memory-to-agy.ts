#!/usr/bin/env bun
/** Consolidate Codex, Claude and Antigravity memory without deleting source notes. */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(process.env.NIE_REPO_ROOT ?? join(import.meta.dir, ".."));
const home = homedir();
const sourceRoots = (process.env.NIE_MEMORY_SOURCES?.split(":") ?? [
	join(home, ".aphrody", "workspaces", "ie", "memory"),
	join(home, ".claude", "projects", "-home-ubuntu-nie", "memory"),
	join(repoRoot, ".agents", "rules"),
]).filter(Boolean);
const targetRoots = (process.env.NIE_MEMORY_TARGETS?.split(":") ?? [
	join(repoRoot, ".agents", "rules"),
	join(home, ".claude", "projects", "-home-ubuntu-nie", "memory"),
	join(home, ".aphrody", "workspaces", "ie", "memory"),
]).filter(Boolean);
const apply = Bun.argv.includes("--apply");

type Note = { source: string; name: string; content: string; digest: string };
const notes: Note[] = [];
const seen = new Set<string>();
for (const root of sourceRoots) {
	try {
		for (const entry of await readdir(root, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "MEMORY.md" || entry.name === "project-memory.md" || entry.name === "nie-workspace.md") continue;
			const source = join(root, entry.name);
			const content = (await readFile(source, "utf8")).trim();
			if (!content) continue;
			const digest = createHash("sha256").update(content).digest("hex");
			if (seen.has(digest)) continue;
			seen.add(digest);
			notes.push({ source, name: basename(entry.name), content, digest });
		}
	} catch { /* Optional host memory roots are allowed to be absent. */ }
}
notes.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
const document = [
	"# Unified NIE workspace memory",
	"",
	"> Canonical generated view for Codex, Claude Code and Antigravity. Source notes are preserved; identical notes are included once.",
	`> Generated: ${new Date().toISOString()} · unique notes: ${notes.length}`,
	"",
	...notes.flatMap((note) => [`## ${note.name}`, `<!-- source: ${note.source}; sha256: ${note.digest} -->`, "", note.content, "", "---", ""]),
].join("\n");

const output = join(repoRoot, ".agents", "rules", "project-memory.md");
if (apply) {
	for (const target of targetRoots) {
		await mkdir(target, { recursive: true });
		await writeFile(join(target, "nie-workspace.md"), document, "utf8");
	}
	await writeFile(output, document, "utf8");
}
console.log(`${apply ? "synced" : "would sync"} ${notes.length} unique memory notes to ${targetRoots.length} adapters`);
console.log(`canonical: ${output}`);
