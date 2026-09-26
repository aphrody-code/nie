const read = (path: string) => Bun.file(path).text();
const cliOwners: Record<string, string> = {
  Net:"crates/engine/nie-net/src/lib.rs",
  Launcher:"crates/tools/nie-launcher/src/lib.rs",
  Live:"crates/tools/nie-launcher/src/lib.rs",
  Vn:"crates/engine/nie-explore/src/vn.rs",
  Rebuild:"crates/forge/nie-re/src/workflow.rs", Recover:"crates/forge/nie-re/src/workflow.rs", SeedUi:"crates/forge/nie-seed/src/ui_names.rs", MenuPredecode:"crates/engine/nie-explore/src/menu_predecode.rs", RefreshTypedJson:"crates/engine/nie-formats/src/cfgbin.rs", Locales:"crates/engine/nie-formats/src/locale.rs", Pdata:"crates/forge/nie-re/src/lib.rs", Video:"crates/engine/nie-explore/src/cinema.rs", UniformMap:"crates/engine/nie-explore/src/uniform_map.rs", Format:"crates/engine/nie-formats/src/lib.rs", Decode:"crates/engine/nie-formats/src/lib.rs", Convert:"crates/engine/nie-formats/src/lib.rs", Img:"crates/engine/nie-formats/src/lib.rs", Textures:"crates/engine/nie-formats/src/lib.rs", Vfs:"crates/engine/nie-explore/src/lib.rs", Lua:"crates/engine/nie-lua/src/lib.rs", LuaRun:"crates/engine/nie-lua/src/lib.rs", LuaAudit:"crates/engine/nie-lua/src/lib.rs", Save:"crates/engine/nie-save/src/lib.rs", Wiki:"crates/tools/nie-wiki/src/lib.rs", Mode:"crates/engine/nie-explore/src/menu_mode_analysis.rs", Icons:"crates/engine/nie-explore/src/menu_icons.rs", Avatar:"crates/engine/nie-data/src/avatar.rs", Steam:"crates/tools/nie-steam/src/lib.rs", Viola:"crates/engine/nie-viola/src/lib.rs", Mod:"crates/engine/nie-viola/src/lib.rs", Render:"crates/engine/nie-render3d/src/lib.rs", Seed:"crates/forge/nie-seed/src/lib.rs", Queue:"crates/forge/nie-queue/src/lib.rs", Propagate:"crates/forge/nie-re/src/lib.rs", Rtti:"crates/forge/nie-re/src/lib.rs", Disasm:"crates/forge/nie-re/src/lib.rs", Strings:"crates/forge/nie-re/src/lib.rs", Coverage:"crates/forge/nie-re/src/lib.rs", Index:"crates/forge/nie-index/src/lib.rs", Play:"crates/engine/nie-app/src/flow.rs", Ocgen:"crates/engine/nie-ocgen/src/cli.rs", Atlas:"crates/forge/nie-index/src/atlas.rs"
};
const cliHostRationale: Record<string, string> = { Info:"Info inventories the locally installed game and filesystem metadata.", Find:"Find searches host filesystem paths outside the mounted VFS abstraction.", Grep:"Grep searches host file contents through native filesystem walkers.", ComputerUse:"ComputerUse controls a local executable or Ghidra process boundary.", Mem:"Mem reads or modifies an identified local game process.", PatchEac:"PatchEac patches a local executable on disk." };
const cliEvidence: Record<string, [string, string]> = {
  SeedUi: ["crates/tools/nie-cli/src/main.rs", "seed_ui::run("],
  MenuPredecode: ["crates/tools/nie-cli/src/menu_predecode.rs", "let plan = plan(priority_paths,"],
  Avatar: ["crates/tools/nie-cli/src/avatar_cmd.rs", "category_resource_prefix(cfg,"],
  Rebuild: ["crates/tools/nie-cli/src/main.rs", "nie_re::workflow::rebuild("],
  Recover: ["crates/tools/nie-cli/src/main.rs", "nie_re::workflow::recover_with_observer("],
  Vn: ["crates/tools/nie-cli/src/vn_cmd.rs", "casting_entries("],
};
const siteOwners: Record<string, string> = { downloads:"crates/tools/nie-site/src/update_policy.rs", feed:"crates/tools/nie-wiki/src/episodes.rs", vfs:"crates/engine/nie-explore/src/vfs_policy.rs", couverture:"crates/tools/nie-site/src/couverture/mod.rs", api_v1:"crates/tools/nie-wiki/src/catalog.rs", episodes:"crates/tools/nie-wiki/src/episodes.rs", recherche:"crates/engine/nie-explore/src/search_query.rs", formats:"crates/engine/nie-explore/src/lib.rs", inspect:"crates/engine/nie-formats/src/lib.rs", menu:"crates/engine/nie-formats/src/menu.rs", menu_runtime:"crates/engine/nie-lua/src/menu_runtime.rs", menu_audio:"crates/engine/nie-explore/src/menu_audio.rs", screens:"crates/engine/nie-explore/src/menu_mode_analysis.rs", lua:"crates/engine/nie-lua/src/lib.rs", wiki:"crates/tools/nie-wiki/src/lib.rs", save:"crates/engine/nie-save/src/lib.rs", zukan:"crates/tools/nie-zukan/src/lib.rs", motion:"crates/engine/nie-explore/src/motion.rs", spatial_preview:"crates/engine/nie-explore/src/spatial_preview.rs", growth:"crates/engine/nie-core/src/lib.rs", regles:"crates/engine/nie-core/src/lib.rs", team:"crates/engine/nie-core/src/lib.rs", donnees:"crates/engine/nie-data/src/lib.rs", passives:"crates/engine/nie-data/src/passives.rs", playstyles:"crates/engine/nie-data/src/playstyle.rs", conditions:"crates/engine/nie-data/src/unlock_condition.rs", text:"crates/engine/nie-data/src/text.rs", entites:"crates/tools/nie-wiki/src/entities.rs", aphrody:"crates/tools/nie-site/src/routes/aphrody.rs", modeles3d:"crates/engine/nie-render3d/src/lib.rs", native_export:"crates/engine/nie-explore/src/export.rs", related:"crates/engine/nie-explore/src/related.rs", game_data:"crates/engine/nie-app/src/game_data.rs", profile:"crates/engine/nie-app/src/complete_profile.rs", kizuna:"crates/engine/nie-data/src/craft.rs", ut:"crates/tools/nie-launcher/src/lib.rs", online:"crates/engine/nie-net/src/lib.rs" };
const ownerNeedle = (owner: string) => owner.match(/\/(nie-[a-z0-9-]+)\//)?.[1].replaceAll("-", "_") ?? "";
const mapping = (surface: string, entry: string, owner: string, classification: "portable"|"host_only"|"transport", rationale: string) => ({
  surface, entry, capability: entry.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase(),
  classification, owner, rationale
});

const cliSource = await read("crates/tools/nie-cli/src/main.rs");
const cliModulePaths = await Array.fromAsync(new Bun.Glob("*.rs").scan({ cwd: "crates/tools/nie-cli/src" }));
const cliAdapterSources = [
  "crates/tools/nie-cli/src/main.rs",
  ...cliModulePaths.map(path => `crates/tools/nie-cli/src/${path}`),
];
const cliAdapterText = new Map(await Promise.all(cliAdapterSources.map(async path => [path, await read(path)] as const)));
const cliBlock = cliSource.match(/enum Cmd \{([\s\S]*?)\n\}/)?.[1] ?? "";
const cli = [...cliBlock.matchAll(/^    (?:#\[[^\n]+\]\n    )*([A-Z][A-Za-z0-9_]*)/gm)]
  .map(match => match[1]).filter(name => name !== "Mcp")
  .map(name => {
    const host = name in cliHostRationale;
    const owner = cliOwners[name] ?? "crates/tools/nie-cli/src/main.rs";
    if (host) return mapping("cli", name, owner, "host_only", cliHostRationale[name]);
    const inferredNeedle = `${ownerNeedle(owner)}::`;
    const evidence = cliEvidence[name] ?? [cliAdapterSources.find(path => cliAdapterText.get(path)?.includes(inferredNeedle)) ?? "", inferredNeedle];
    return { ...mapping("cli", name, owner, "portable", `${name} delegates portable domain work to its named library owner.`), sourceEvidence: evidence };
  });

const mcpSource = await read("crates/tools/nie-cli/src/mcp.rs");
const mcpOwners: Record<string, [string, string]> = {
  vfs_list: ["crates/engine/nie-explore/src/mcp_vfs.rs", "nie_explore::mcp_vfs::list("], vfs_search: ["crates/engine/nie-explore/src/mcp_vfs.rs", "nie_explore::mcp_vfs::search("], vfs_stat: ["crates/engine/nie-explore/src/mcp_vfs.rs", "nie_explore::mcp_vfs::stat("], vfs_cat: ["crates/engine/nie-explore/src/mcp_vfs.rs", "nie_explore::mcp_vfs::cat("], asset_get: ["crates/engine/nie-explore/src/mcp_vfs.rs", "nie_explore::mcp_vfs::asset("], re_function: ["crates/tools/nie-wiki/src/query.rs", "nie_wiki::query::re_function_report("], re_coverage: ["crates/tools/nie-wiki/src/query.rs", "nie_wiki::query::re_coverage_report("]
};
const mcp = [...mcpSource.matchAll(/#\[tool\([\s\S]*?name = "([^"]+)"[\s\S]*?\)\]/g)]
  .map(match => { const evidence = mcpOwners[match[1]]; return { ...mapping("mcp", match[1], evidence?.[0] ?? "crates/tools/nie-cli/src/mcp.rs", "transport", `MCP tool ${match[1]} is an in-process transport adapter.`), ...(evidence ? { sourceEvidence: ["crates/tools/nie-cli/src/mcp.rs", evidence[1]] } : {}) }; });

const siteSource = await read("crates/tools/nie-site/src/app.rs");
const postPaths = [...(siteSource.match(/pub const CHEMINS_HORS_GET[\s\S]*?=\s*&\[([\s\S]*?)\];/)?.[1].matchAll(/"([^"]+)"/g) ?? [])]
  .map(match => match[1]);
const getRoutes = [...siteSource.matchAll(/^\s*"(\/[^" ]+)"\s*=>\s*crate::routes::([a-z0-9_]+)::/gm)]
  .map(match => ({ path: match[1], module: match[2] }));
const posts = [...siteSource.matchAll(/\.route\(\s*CHEMINS_HORS_GET\[(\d+)\],\s*post\(crate::routes::([a-z0-9_]+)::/g)]
  .map(match => ({ path: postPaths[Number(match[1])] ?? `CHEMINS_HORS_GET[${match[1]}]`, module: match[2] }));
const site = [...getRoutes.map(route => ({...route, method:"GET"})), ...posts.map(route => ({...route, method:"POST"}))]
  .map(route => {
    const transport = /^(health|well_known|downloads|feed|assets|static_files|pages|vfs|couverture|graphql|openapi)$/.test(route.module) || route.path === "/api/v1/health";
    const owner = siteOwners[route.module] ?? `crates/tools/nie-site/src/routes/${route.module}.rs`;
    return { ...mapping("site", `${route.method} ${route.path}`, owner, transport ? "transport" : "portable", transport ? `${route.method} ${route.path} is HTTP delivery or service metadata.` : `${route.method} ${route.path} delegates portable work to the named library owner.`), ...(transport ? {} : { sourceEvidence: [`crates/tools/nie-site/src/routes/${route.module}.rs`, ownerNeedle(owner)] }) };
  });
site.push(mapping("site", "FALLBACK {*path}", "crates/tools/nie-site/src/routes/static_files.rs", "transport", "Static bundle fallback is HTTP transport."));

const inventory = { schema: "nie.public-entry-inventory/v1", proofLevel: "source-delegation", proofLimitation: "Verified call-chain evidence does not prove the absence of residual portable logic in bindings; that requires semantic audit and review.", generatedFrom: {
  cli: "Cmd", mcp: "#[tool(name)]", site: "declarer_routes! + explicit post routes"
}, entries: [...cli, ...mcp, ...site] };
await Bun.write("scripts/validation/public-entry-inventory.json", `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({ cli: cli.length, mcp: mcp.length, site: site.length }));
