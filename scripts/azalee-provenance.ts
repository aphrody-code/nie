/** Inventory retained Azalee artifacts without copying game data or running legacy generators.
 * bun scripts/azalee-provenance.ts --source-root /path/to/rg --source-ref COMMIT [--write]
 * Default mode verifies the checked-in inventory; --write regenerates metadata only.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const sourceIndex = args.indexOf("--source-root");
if (sourceIndex < 0 || !args[sourceIndex + 1]) throw new Error("--source-root is required");
const sourceRoot = resolve(args[sourceIndex + 1]!);
const output = join(root, "data/azalee/provenance.json");
const refIndex = args.indexOf("--source-ref");
const recorded = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : undefined;
const sourceRef = refIndex >= 0 ? args[refIndex + 1] : recorded?.source_revision;
if (!sourceRef) throw new Error("--source-ref must identify the frozen source commit");
const revisionResult = spawnSync("git", ["rev-parse", "--verify", `${sourceRef}^{commit}`], { cwd: sourceRoot, encoding: "utf8" });
if (revisionResult.status !== 0) throw new Error("frozen source commit is unavailable");
const revision = revisionResult.stdout.trim();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function sourceBytes(path: string): Uint8Array {
  const result = spawnSync("git", ["show", `${revision}:${path}`], { cwd: sourceRoot, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`source artifact unavailable at frozen commit: ${path}`);
  return result.stdout;
}

function sourceReferences(name: string): string[] {
  const result = spawnSync("git", ["grep", "-l", "-F", "-e", name, revision, "--", "packages/azalee", "apps/azalee", "scripts"],
    { cwd: sourceRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 && result.status !== 1) throw new Error("frozen source reference scan failed");
  return result.stdout.trim().split("\n").filter(Boolean).map((path) => path.slice(revision.length + 1))
    .filter((path) => /\.(rs|ts|tsx|py|sh)$/.test(path)).sort();
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}

function references(repo: string, name: string, directories: string[]): string[] {
  const result = spawnSync("rg", ["-l", "-F", "--glob", "*.{rs,ts,tsx,py,sh}", "--", name,
    ...directories.filter((directory) => existsSync(join(repo, directory)))], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0 && result.status !== 1) throw new Error("artifact reference scan failed");
  return result.stdout.trim().split("\n").filter(Boolean).sort();
}

const sourceTree = spawnSync("git", ["ls-tree", "-r", "--name-only", revision, "--", "packages/azalee/src/data", "apps/azalee/data", "apps/website/data"],
  { cwd: sourceRoot, encoding: "utf8" });
if (sourceTree.status !== 0) throw new Error("frozen source tree is unavailable");
const sourceFiles = sourceTree.stdout.trim().split("\n").filter(Boolean);
const nativeGenerators: Record<string, { producer: string; command: string[] }> = {
  "passives-full.json": {
    producer: "crates/engine/nie-data/src/bin/export_passives.rs",
    command: ["cargo", "run", "-p", "nie-data", "--bin", "export_passives", "--features", "serde", "--", "--data", "<decoded-game-data>", "--out", "<candidate-output>"],
  },
  "skills-cutin.json": {
    producer: "crates/engine/nie-data/src/bin/export_skills.rs",
    command: ["cargo", "run", "-p", "nie-data", "--bin", "export_skills", "--features", "serde,std", "--", "--data", "<decoded-game-data>", "--out", "<candidate-output>"],
  },
};

const artifacts = files(join(root, "data/azalee")).filter((path) => path !== output).sort().map((path) => {
  const name = basename(path);
  const bytes = readFileSync(path);
  const sha256 = hash(bytes);
  const decoded = name.endsWith(".gz") ? gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 }) : bytes;
  const format = name.includes(".ndjson") ? "ndjson" : "json";
  const content = decoded.toString("utf8");
  const value = format === "json" ? JSON.parse(content) : undefined;
  const records = format === "ndjson"
    ? content.split("\n").filter((line) => { if (!line.trim()) return false; JSON.parse(line); return true; }).length
    : Array.isArray(value) ? value.length : Object.keys(value).length;
  if (records === 0) throw new Error(`empty artifact: ${relative(root, path)}`);
  const copies = sourceFiles.filter((candidate) => basename(candidate) === name).map((candidate) => ({
    path: candidate, sha256: hash(sourceBytes(candidate)),
  }));
  const localReferences = references(root, name, ["crates", "packages", "apps", "scripts"])
    .filter((reference) => reference !== "scripts/azalee-provenance.ts");
  const legacyReferences = sourceReferences(name);
  const generator = nativeGenerators[name];
  const legacyProducers = legacyReferences.filter((reference) => reference.includes("/scripts/") || reference.startsWith("scripts/"));
  return {
    path: relative(root, path), bytes: bytes.length, sha256, format, records,
    record_count_semantics: format === "ndjson" ? "lines" : Array.isArray(value) ? "array_entries" : "top_level_keys",
    provenance: { source_repository: "rg", copies, byte_identical_copy: copies.some((copy) => copy.sha256 === sha256) },
    producer: generator?.producer ?? null,
    producer_candidates: legacyProducers,
    consumers: { niers: localReferences, rg: legacyReferences.filter((reference) => !legacyProducers.includes(reference)) },
    regeneration: generator?.command ?? null,
    regeneration_status: generator ? "native_generator_requires_decoded_inputs" : "legacy_producer_requires_port_or_provenance_review",
    owner: "nie-wiki",
    retention: "retain_until_consumers_and_regeneration_are_verified",
  };
});
const manifest = {
  schema: "niers.azalee.provenance/v1",
  source_revision: revision,
  generator: `bun scripts/azalee-provenance.ts --source-root <rg-checkout> --source-ref ${revision} --write`,
  validation: "bun scripts/azalee-provenance.ts --source-root <rg-checkout>",
  artifacts,
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
if (args.includes("--write")) {
  await Bun.write(output, serialized);
} else if (!existsSync(output) || readFileSync(output, "utf8") !== serialized) {
  throw new Error("Azalee provenance inventory differs; inspect sources and regenerate metadata with --write");
}
console.log(JSON.stringify({ artifacts: artifacts.length, bytes: artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0),
  identical_sources: artifacts.filter((artifact) => artifact.provenance.byte_identical_copy).length,
  native_generators: artifacts.filter((artifact) => artifact.producer).length,
  unresolved_regeneration: artifacts.filter((artifact) => !artifact.producer).length }));
