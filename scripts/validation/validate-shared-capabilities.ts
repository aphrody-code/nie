import manifest from "./shared-capabilities.json";
import inventory from "./public-entry-inventory.json";

type Surface = { kind: "adapter" | "not-exposed"; rationale?: string; evidence?: [string, string][] };
const failures: string[] = [];
if (inventory.proofLevel !== "source-delegation") failures.push("inventory: missing explicit source-delegation proof level");
const text = async (path: string) => Bun.file(path).text();

for (const capability of manifest.capabilities) {
  if (!(await Bun.file(capability.owner).exists())) failures.push(`${capability.id}: missing owner ${capability.owner}`);
  if (!capability.proofTests.length) failures.push(`${capability.id}: no proof tests`);
  for (const name of manifest.surfaces) {
    const surface = capability.surfaces[name as keyof typeof capability.surfaces] as Surface | undefined;
    if (!surface) { failures.push(`${capability.id}/${name}: missing disposition`); continue; }
    if (surface.kind === "not-exposed") {
      if (!surface.rationale?.trim()) failures.push(`${capability.id}/${name}: not-exposed without rationale`);
      continue;
    }
    if (!surface.evidence?.length) { failures.push(`${capability.id}/${name}: adapter without evidence`); continue; }
    for (const [path, needle] of surface.evidence) {
      if (!(await Bun.file(path).exists())) failures.push(`${capability.id}/${name}: missing evidence file ${path}`);
      else if (!(await text(path)).includes(needle)) failures.push(`${capability.id}/${name}: ${path} lacks ${JSON.stringify(needle)}`);
    }
  }
}

const cli = await text(manifest.registries.cli);
const site = await text(manifest.registries.site);
const tauri = await text(manifest.registries.inacord);
const mcp = await text(manifest.registries.mcp);
const cliBlock = cli.match(/enum Cmd \{([\s\S]*?)\n\}/)?.[1] ?? "";
const cliCommands = [...cliBlock.matchAll(/^    (?:#\[[^\n]+\]\n    )*([A-Z][A-Za-z0-9_]*)/gm)].map(match => match[1]);
const siteRoutes = [...site.matchAll(/^\s*"(\/[^" ]+)"\s*=>/gm)].map(match => match[1]);
const tauriCommands = [...tauri.matchAll(/#\[tauri::command\][\s\S]{0,120}?\n(?:pub )?(?:async )?fn ([a-z][a-z0-9_]*)/g)].map(match => match[1]);
const registered = tauri.match(/collect_commands!\[([\s\S]*?)\n\s*\]\)/)?.[1] ?? "";
for (const command of tauriCommands) if (!registered.includes(command)) failures.push(`inacord registry omits #[tauri::command] ${command}`);
if (!mcp.includes('nie_cli::main_entry_with(["niers", "mcp"])')) failures.push("MCP is not an in-process CLI adapter");
if (!cliCommands.length) failures.push("CLI registry parsed zero commands");
if (!siteRoutes.length || new Set(siteRoutes).size !== siteRoutes.length) failures.push("site route registry is empty or duplicated");
if (!tauriCommands.length) failures.push("Inacord registry parsed zero commands");

const bySurface = (surface: string) => inventory.entries.filter(entry => entry.surface === surface);
const expectedCounts = { cli: 41, mcp: 19, inacord: 160, site: 140 };
for (const [surface, expected] of Object.entries(expectedCounts)) {
  const entries = bySurface(surface);
  if (entries.length !== expected) failures.push(`${surface}: mapped ${entries.length}, expected ${expected} authoritative entries`);
  if (new Set(entries.map(entry => entry.entry)).size !== entries.length) failures.push(`${surface}: duplicate mapped entries`);
  for (const entry of entries) {
    if (!entry.capability || !entry.owner || !entry.rationale) failures.push(`${surface}/${entry.entry}: incomplete mapping`);
    if (!(await Bun.file(entry.owner).exists())) failures.push(`${surface}/${entry.entry}: missing owner ${entry.owner}`);
    if (!["portable", "host_only", "transport"].includes(entry.classification)) failures.push(`${surface}/${entry.entry}: invalid classification`);
    const bindingOwner = entry.owner.startsWith("crates/tools/nie-cli/") || entry.owner.startsWith("crates/tools/nie-site/src/routes/") || entry.owner.startsWith("apps/inacord/src-tauri/");
    if (entry.classification === "portable" && bindingOwner) failures.push(`${surface}/${entry.entry}: portable capability is still owned by binding ${entry.owner}`);
    if (entry.classification === "portable" && !bindingOwner) {
      if (!("sourceEvidence" in entry)) {
        failures.push(`${surface}/${entry.entry}: portable binding has no concrete delegation evidence`);
      } else {
        const rawEvidence = entry.sourceEvidence as [string, string] | [string, string][];
        const evidence = typeof rawEvidence[0] === "string" ? [rawEvidence as [string, string]] : rawEvidence as [string, string][];
        if (!evidence.length) failures.push(`${surface}/${entry.entry}: source does not prove delegation to ${entry.owner}`);
        for (const [source, needle] of evidence) {
          if (!source || !needle || !(await Bun.file(source).exists()) || !(await text(source)).includes(needle)) failures.push(`${surface}/${entry.entry}: source does not prove delegation to ${entry.owner}`);
        }
      }
    }
    if (entry.classification === "host_only") {
      const allowed = surface === "cli" ? /^(ComputerUse|Info|Find|Grep|Mem|PatchEac)$/ : surface === "inacord" && /(^|::)(live_|launch_|open_|re_|memory_|process_|default_|check_game_dir|preload_vfs|list_packs_dir|raw_cpk_extract|copy_disk|disk_file|set_titlebar|take_pending|describe_disk|read_disk|write_text|save_bytes_b64|save_export|vfs_extract_to|vfs_write_b64|vfs_write_loose_override_b64|install_|blender_|clipboard_|trash_|export_mod|forge_|mcp_)/.test(entry.entry);
      if (!allowed) failures.push(`${surface}/${entry.entry}: host_only is not an allowlisted OS/process operation`);
      if (/Local command binding|Native filesystem, process, database/.test(entry.rationale)) failures.push(`${surface}/${entry.entry}: generic host_only rationale`);
    }
  }
}

const authoritative = {
  cli: cliCommands.filter(name => name !== "Mcp"),
  mcp: [...(await text("crates/tools/nie-cli/src/mcp.rs")).matchAll(/#\[tool\([\s\S]*?name = "([^"]+)"[\s\S]*?\)\]/g)].map(match => match[1]),
  inacord: registered.split(",").map(value => value.trim()).filter(value => /^[a-z_][a-z0-9_:]*$/.test(value)),
  site: [
    ...[...site.matchAll(/^\s*"(\/[^" ]+)"\s*=>/gm)].map(match => `GET ${match[1]}`),
    ...[...site.match(/pub const CHEMINS_HORS_GET[\s\S]*?= \&\[([\s\S]*?)\];/)?.[1].matchAll(/"([^"]+)"/g) ?? []].map(match => `POST ${match[1]}`),
    "FALLBACK {*path}",
  ],
};
for (const [surface, entries] of Object.entries(authoritative)) {
  const mapped = new Set(bySurface(surface).map(entry => entry.entry));
  for (const entry of entries) if (!mapped.has(entry)) failures.push(`${surface}: unmapped authoritative entry ${entry}`);
  for (const entry of mapped) if (!entries.includes(entry)) failures.push(`${surface}: stale non-registry mapping ${entry}`);
}

console.log(JSON.stringify({ schema: manifest.schema, proofLevel: inventory.proofLevel, proofWarning: inventory.proofLimitation, capabilities: manifest.capabilities.length, registries: { cliCommands: authoritative.cli.length, mcpTools: authoritative.mcp.length, siteMethodRoutes: authoritative.site.length, tauriEntries: authoritative.inacord.length }, failures }, null, 2));
if (failures.length) process.exit(1);
