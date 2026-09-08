const read = (path: string) => Bun.file(path).text();
const cliOwners: Record<string, string> = {
  Format:"crates/engine/nie-formats/src/lib.rs", Decode:"crates/engine/nie-formats/src/lib.rs", Convert:"crates/engine/nie-formats/src/lib.rs", Img:"crates/engine/nie-formats/src/lib.rs", Textures:"crates/engine/nie-formats/src/lib.rs", Vfs:"crates/engine/nie-explore/src/lib.rs", Lua:"crates/engine/nie-lua/src/lib.rs", LuaRun:"crates/engine/nie-lua/src/lib.rs", LuaAudit:"crates/engine/nie-lua/src/lib.rs", Save:"crates/engine/nie-save/src/lib.rs", Wiki:"crates/tools/nie-wiki/src/lib.rs", Mode:"crates/engine/nie-explore/src/menu_mode_analysis.rs", Icons:"crates/engine/nie-explore/src/menu_icons.rs", Steam:"crates/tools/nie-steam/src/lib.rs", Viola:"crates/engine/nie-viola/src/lib.rs", Mod:"crates/engine/nie-viola/src/lib.rs", Render:"crates/engine/nie-render3d/src/lib.rs", Seed:"crates/forge/nie-seed/src/lib.rs", Queue:"crates/forge/nie-queue/src/lib.rs", Propagate:"crates/forge/nie-re/src/lib.rs", Rtti:"crates/forge/nie-re/src/lib.rs", Disasm:"crates/forge/nie-re/src/lib.rs", Strings:"crates/forge/nie-re/src/lib.rs", Coverage:"crates/forge/nie-re/src/lib.rs", Index:"crates/forge/nie-index/src/lib.rs"
};
const siteOwners: Record<string, string> = { api_v1:"crates/tools/nie-wiki/src/catalog.rs", formats:"crates/engine/nie-explore/src/lib.rs", inspect:"crates/engine/nie-formats/src/lib.rs", menu:"crates/engine/nie-formats/src/menu.rs", menu_runtime:"crates/engine/nie-lua/src/menu_runtime.rs", menu_audio:"crates/engine/nie-explore/src/menu_audio.rs", screens:"crates/engine/nie-explore/src/menu_mode_analysis.rs", lua:"crates/engine/nie-lua/src/lib.rs", wiki:"crates/tools/nie-wiki/src/lib.rs", save:"crates/engine/nie-save/src/lib.rs", zukan:"crates/tools/nie-zukan/src/lib.rs", motion:"crates/engine/nie-explore/src/motion.rs", spatial_preview:"crates/engine/nie-explore/src/spatial_preview.rs", growth:"crates/engine/nie-core/src/lib.rs", regles:"crates/engine/nie-core/src/lib.rs", team:"crates/engine/nie-core/src/lib.rs", donnees:"crates/engine/nie-data/src/lib.rs", passives:"crates/engine/nie-data/src/passives.rs", playstyles:"crates/engine/nie-data/src/playstyle.rs", conditions:"crates/engine/nie-data/src/unlock_condition.rs", text:"crates/engine/nie-data/src/text.rs", entites:"crates/tools/nie-wiki/src/entities.rs", aphrody:"crates/engine/nie-aphrody/src/lib.rs", modeles3d:"crates/engine/nie-render3d/src/lib.rs", native_export:"crates/engine/nie-explore/src/export.rs", related:"crates/engine/nie-explore/src/related.rs" };
const ownerNeedle = (owner: string) => owner.match(/\/(nie-[a-z0-9-]+)\//)?.[1].replaceAll("-", "_") ?? "";
const nativeOwner = (entry: string) => entry.startsWith("sqlite::") ? "crates/engine/nie-explore/src/database.rs" : entry.startsWith("game_data_") || entry === "resolve_avatar_composition" ? "crates/engine/nie-data/src/lib.rs" : entry.startsWith("aphrody_") ? "crates/engine/nie-aphrody/src/lib.rs" : entry.startsWith("viola::") ? "crates/engine/nie-viola/src/lib.rs" : entry.includes("save") ? "crates/engine/nie-save/src/lib.rs" : entry.includes("wiki") ? "crates/tools/nie-wiki/src/lib.rs" : entry.startsWith("vfs_") ? "crates/engine/nie-explore/src/lib.rs" : entry.includes("lua") ? "crates/engine/nie-lua/src/lib.rs" : entry.includes("texture") || entry.includes("pixel") || entry.includes("cpk") || entry.startsWith("encode_cfgbin") ? "crates/engine/nie-formats/src/lib.rs" : entry.includes("model") || entry.includes("glb") ? "crates/engine/nie-render3d/src/lib.rs" : "apps/inacord/src-tauri/src/lib.rs";
const mapping = (surface: string, entry: string, owner: string, classification: "portable"|"host_only"|"transport", rationale: string) => ({
  surface, entry, capability: entry.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase(),
  classification, owner, rationale
});

const cliSource = await read("crates/tools/nie-cli/src/main.rs");
const cliBlock = cliSource.match(/enum Cmd \{([\s\S]*?)\n\}/)?.[1] ?? "";
const cli = [...cliBlock.matchAll(/^    (?:#\[[^\n]+\]\n    )*([A-Z][A-Za-z0-9_]*)/gm)]
  .map(match => match[1]).filter(name => name !== "Mcp")
  .map(name => {
    const host = ["ComputerUse", "Mem", "PatchEac"].includes(name);
    return mapping("cli", name, cliOwners[name] ?? "crates/tools/nie-cli/src/main.rs", host ? "host_only" : "portable", host ? `${name} requires a local process, executable, or memory boundary.` : `${name} delegates portable domain work to its named library owner.`);
  });

const mcpSource = await read("crates/tools/nie-cli/src/mcp.rs");
const mcp = [...mcpSource.matchAll(/#\[tool\([\s\S]*?name = "([^"]+)"[\s\S]*?\)\]/g)]
  .map(match => mapping("mcp", match[1], "crates/tools/nie-cli/src/mcp.rs", "transport", `MCP tool ${match[1]} is an in-process transport adapter.`));

const tauriSource = await read("apps/inacord/src-tauri/src/lib.rs");
const registry = tauriSource.match(/collect_commands!\[([\s\S]*?)\n\s*\]\)/)?.[1] ?? "";
const inacord = registry.split(",").map(value => value.trim()).filter(value => /^[a-z_][a-z0-9_:]*$/.test(value))
  .map(name => {
    const leaf = name.split("::").at(-1) ?? name;
    const host = /^(live_|launch_|open_|re_|memory_|process_|default_|check_game_dir|preload_vfs|list_packs_dir|raw_cpk_extract|copy_disk|disk_file|set_titlebar|take_pending|describe_disk|read_disk|write_text|install_|blender_|clipboard_|trash_|export_mod|forge_|mcp_)/.test(leaf);
    const transport = /^(remote_)/.test(leaf);
    return mapping("inacord", name, nativeOwner(name), transport ? "transport" : host ? "host_only" : "portable", transport ? `${name} is a remote-service transport adapter.` : host ? `${name} requires native process, window, executable, or game-installation access.` : `${name} is an IPC adapter expected to delegate to the named portable owner.`);
  });

const siteSource = await read("crates/tools/nie-site/src/app.rs");
const getRoutes = [...siteSource.matchAll(/^\s*"(\/[^" ]+)"\s*=>\s*crate::routes::([a-z0-9_]+)::/gm)]
  .map(match => ({ path: match[1], module: match[2] }));
const posts = [...siteSource.matchAll(/\.route\(\s*CHEMINS_HORS_GET\[(\d+)\],\s*post\(crate::routes::([a-z0-9_]+)::/g)]
  .map(match => ({ path: getRoutes.find(route => route.path === [
    "/api/v1/regles/comparaison", "/api/v1/team/synergy", "/api/v1/save/roster", "/api/v1/inspect/compare", "/api/v1/inspect/plate", "/api/v1/menu/runtime/{screen}", "/api/v1/zukan/rank"
  ][Number(match[1])])?.path ?? `CHEMINS_HORS_GET[${match[1]}]`, module: match[2] }));
const site = [...getRoutes.map(route => ({...route, method:"GET"})), ...posts.map(route => ({...route, method:"POST"}))]
  .map(route => {
    const transport = /^(health|well_known|downloads|feed|assets|static_files|pages|vfs|couverture)$/.test(route.module) || route.path === "/api/v1/health";
    const owner = siteOwners[route.module] ?? `crates/tools/nie-site/src/routes/${route.module}.rs`;
    return { ...mapping("site", `${route.method} ${route.path}`, owner, transport ? "transport" : "portable", transport ? `${route.method} ${route.path} is HTTP delivery or service metadata.` : `${route.method} ${route.path} delegates portable work to the named library owner.`), ...(transport ? {} : { sourceEvidence: [`crates/tools/nie-site/src/routes/${route.module}.rs`, ownerNeedle(owner)] }) };
  });
site.push(mapping("site", "FALLBACK {*path}", "crates/tools/nie-site/src/routes/static_files.rs", "transport", "Static bundle fallback is HTTP transport."));

const inventory = { schema: "niers.public-entry-inventory/v1", generatedFrom: {
  cli: "Cmd", mcp: "#[tool(name)]", inacord: "tauri_specta::collect_commands!", site: "declarer_routes! + explicit post routes"
}, entries: [...cli, ...mcp, ...inacord, ...site] };
await Bun.write("scripts/validation/public-entry-inventory.json", `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({ cli: cli.length, mcp: mcp.length, inacord: inacord.length, site: site.length }));
