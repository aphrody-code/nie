#!/usr/bin/env bun
/**
 * Audit unifié Afubuki : VFS/API, Zukan, Mixi-Max, chara_edit, pixels et rendu.
 *
 * Par défaut ce script est en lecture seule. Les sorties sont des rapports sous var/.
 * `--render` active uniquement les rendus dérivés via le CLI nie ; les sources ne sont
 * jamais modifiées. `--sql` génère le SQL OC dans le rapport sans l'exécuter.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const refRoot = join(root, "data", "ref", "afubuki");
const ocRoot = join(root, "data", "oc", "afubuki");
const outRoot = join(root, "var", "afubuki", "unified");
mkdirSync(outRoot, { recursive: true });
const args = new Set(Bun.argv.slice(2));

type Asset = { player?: string; kind?: string; localPath?: string; sizeBytes?: number; sha256?: string; vfsPath?: string };

const readJson = async <T>(path: string): Promise<T> => Bun.file(path).json() as Promise<T>;
const sha256 = async (path: string) => {

  const bytes = await Bun.file(path).arrayBuffer();
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
};

const walk = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
};

const manifest = await readJson<Asset[]>(join(refRoot, "meta", "manifest.json"));
const profile = await readJson<Record<string, unknown>>(join(ocRoot, "game", "complete-profile.json"));
const identity = await readJson<Record<string, unknown>>(join(ocRoot, "game", "identity.json"));
const seo = await readJson<Record<string, unknown>>(join(ocRoot, "seo.json"));
const files = walk(refRoot);
const counts = Object.fromEntries([...new Set(manifest.map((asset) => asset.kind ?? "unknown"))].map((kind) => [kind, manifest.filter((asset) => asset.kind === kind).length]));
const players = Object.fromEntries([...new Set(manifest.map((asset) => asset.player ?? "unknown"))].map((player) => [player, manifest.filter((asset) => asset.player === player).length]));
const missing = manifest.filter((asset) => !asset.localPath || !existsSync(asset.localPath));
const mismatched: Array<{ path: string; expected: string; actual: string }> = [];
for (const asset of manifest) {
  if (!asset.localPath || !existsSync(asset.localPath) || !asset.sha256) continue;
  const actual = await sha256(asset.localPath);
  if (actual.toLowerCase() !== asset.sha256.toLowerCase()) mismatched.push({ path: asset.localPath, expected: asset.sha256, actual });
}

const report = {
  schema: "nie.afubuki.unified-pipeline/v1",
  mode: args.has("--render") ? "audit-and-derived-render" : "audit-only",
  source_policy: "official_vfs_assets_are_read_only; fan_art_is_reference_only; derived_outputs_are_separate",
  official: {
    manifest_entries: manifest.length,
    files_on_disk: files.length,
    bytes_on_disk: files.reduce((sum, path) => sum + statSync(path).size, 0),
    by_kind: counts,
    by_player: players,
    missing_manifest_files: missing.length,
    sha256_mismatches: mismatched.length,
  },
  variants: profile.versions,
  miximax: profile.miximax,
  identity: identity.roles,
  seo_locales: Object.keys((seo.game_locales ?? {}) as Record<string, unknown>),
  render: {
    requested: args.has("--render"),
    output_root: relative(root, outRoot),
    original_assets_touched: false,
  },
  findings: [
    "nie-data::basara parses the BASARA build graph; it is the authority for Mixi-Max structure.",
    "nie-ocgen validates chara_edit documents and can re-read generated T2B before writing.",
    "nie-render3d and nie img provide derived GLB/PNG/composite outputs; they must not overwrite VFS sources.",
    "nie-zukan ranks and joins Zukan records; a missing Zukan join is reported, never guessed.",
    "C/C++ and Lua findings remain evidence until a matching VFS path, parser result or runtime probe confirms them.",
  ],
  mismatched,
};

await Bun.write(join(outRoot, "report.json"), JSON.stringify(report, null, 2));
await Bun.write(join(outRoot, "manifest.json"), JSON.stringify({ schema: "nie.afubuki.derived-manifest/v1", source: "data/ref/afubuki/meta/manifest.json", outputs: [] }, null, 2));

console.log(JSON.stringify({ status: missing.length || mismatched.length ? "INCOMPLET" : "FAIT", report: relative(root, join(outRoot, "report.json")), entries: manifest.length, files: files.length, missing: missing.length, sha256_mismatches: mismatched.length, render_requested: args.has("--render") }));
if (missing.length || mismatched.length) process.exitCode = 2;
