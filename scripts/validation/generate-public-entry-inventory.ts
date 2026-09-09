const read = (path: string) => Bun.file(path).text();
const cliOwners: Record<string, string> = {
  Vn:"crates/engine/nie-explore/src/vn.rs",
  Rebuild:"crates/forge/nie-re/src/workflow.rs", Recover:"crates/forge/nie-re/src/workflow.rs", SeedUi:"crates/forge/nie-seed/src/ui_names.rs", MenuPredecode:"crates/engine/nie-explore/src/menu_predecode.rs", RefreshTypedJson:"crates/engine/nie-formats/src/cfgbin.rs", Locales:"crates/engine/nie-formats/src/locale.rs", Pdata:"crates/forge/nie-re/src/lib.rs", Video:"crates/engine/nie-explore/src/cinema.rs", UniformMap:"crates/engine/nie-explore/src/uniform_map.rs", Format:"crates/engine/nie-formats/src/lib.rs", Decode:"crates/engine/nie-formats/src/lib.rs", Convert:"crates/engine/nie-formats/src/lib.rs", Img:"crates/engine/nie-formats/src/lib.rs", Textures:"crates/engine/nie-formats/src/lib.rs", Vfs:"crates/engine/nie-explore/src/lib.rs", Lua:"crates/engine/nie-lua/src/lib.rs", LuaRun:"crates/engine/nie-lua/src/lib.rs", LuaAudit:"crates/engine/nie-lua/src/lib.rs", Save:"crates/engine/nie-save/src/lib.rs", Wiki:"crates/tools/nie-wiki/src/lib.rs", Mode:"crates/engine/nie-explore/src/menu_mode_analysis.rs", Icons:"crates/engine/nie-explore/src/menu_icons.rs", Avatar:"crates/engine/nie-data/src/avatar.rs", Steam:"crates/tools/nie-steam/src/lib.rs", Viola:"crates/engine/nie-viola/src/lib.rs", Mod:"crates/engine/nie-viola/src/lib.rs", Render:"crates/engine/nie-render3d/src/lib.rs", Seed:"crates/forge/nie-seed/src/lib.rs", Queue:"crates/forge/nie-queue/src/lib.rs", Propagate:"crates/forge/nie-re/src/lib.rs", Rtti:"crates/forge/nie-re/src/lib.rs", Disasm:"crates/forge/nie-re/src/lib.rs", Strings:"crates/forge/nie-re/src/lib.rs", Coverage:"crates/forge/nie-re/src/lib.rs", Index:"crates/forge/nie-index/src/lib.rs"
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
const siteOwners: Record<string, string> = { downloads:"crates/tools/nie-site/src/update_policy.rs", feed:"crates/tools/nie-wiki/src/episodes.rs", vfs:"crates/engine/nie-explore/src/vfs_policy.rs", couverture:"crates/tools/nie-site/src/couverture/mod.rs", api_v1:"crates/tools/nie-wiki/src/catalog.rs", episodes:"crates/tools/nie-wiki/src/episodes.rs", recherche:"crates/engine/nie-explore/src/search_query.rs", formats:"crates/engine/nie-explore/src/lib.rs", inspect:"crates/engine/nie-formats/src/lib.rs", menu:"crates/engine/nie-formats/src/menu.rs", menu_runtime:"crates/engine/nie-lua/src/menu_runtime.rs", menu_audio:"crates/engine/nie-explore/src/menu_audio.rs", screens:"crates/engine/nie-explore/src/menu_mode_analysis.rs", lua:"crates/engine/nie-lua/src/lib.rs", wiki:"crates/tools/nie-wiki/src/lib.rs", save:"crates/engine/nie-save/src/lib.rs", zukan:"crates/tools/nie-zukan/src/lib.rs", motion:"crates/engine/nie-explore/src/motion.rs", spatial_preview:"crates/engine/nie-explore/src/spatial_preview.rs", growth:"crates/engine/nie-core/src/lib.rs", regles:"crates/engine/nie-core/src/lib.rs", team:"crates/engine/nie-core/src/lib.rs", donnees:"crates/engine/nie-data/src/lib.rs", passives:"crates/engine/nie-data/src/passives.rs", playstyles:"crates/engine/nie-data/src/playstyle.rs", conditions:"crates/engine/nie-data/src/unlock_condition.rs", text:"crates/engine/nie-data/src/text.rs", entites:"crates/tools/nie-wiki/src/entities.rs", aphrody:"crates/engine/nie-aphrody/src/lib.rs", modeles3d:"crates/engine/nie-render3d/src/lib.rs", native_export:"crates/engine/nie-explore/src/export.rs", related:"crates/engine/nie-explore/src/related.rs" };
const ownerNeedle = (owner: string) => owner.match(/\/(nie-[a-z0-9-]+)\//)?.[1].replaceAll("-", "_") ?? "";
const nativeOwner = (entry: string) => entry.startsWith("sqlite::") ? "crates/engine/nie-explore/src/database.rs" : entry.startsWith("game_data_") || entry === "resolve_avatar_composition" ? "crates/engine/nie-data/src/lib.rs" : entry.startsWith("aphrody_") ? "crates/engine/nie-aphrody/src/lib.rs" : entry.startsWith("viola::") ? "crates/engine/nie-viola/src/lib.rs" : entry.includes("save") ? "crates/engine/nie-save/src/lib.rs" : entry.includes("wiki") ? "crates/tools/nie-wiki/src/lib.rs" : entry.startsWith("vfs_") ? "crates/engine/nie-explore/src/lib.rs" : entry.includes("lua") ? "crates/engine/nie-lua/src/lib.rs" : entry.startsWith("video_") || entry.includes("texture") || entry.includes("pixel") || entry.includes("cpk") || entry.startsWith("encode_cfgbin") ? "crates/engine/nie-formats/src/lib.rs" : entry.includes("model") || entry.includes("glb") ? "crates/engine/nie-render3d/src/lib.rs" : "apps/inacord/src-tauri/src/lib.rs";
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

const tauriSource = await read("apps/inacord/src-tauri/src/lib.rs");
const tauriPaths = await Array.fromAsync(new Bun.Glob("**/*.rs").scan({ cwd: "apps/inacord/src-tauri/src" }));
const tauriSources = new Map(await Promise.all(tauriPaths.map(async relative => {
  const path = `apps/inacord/src-tauri/src/${relative}`;
  return [path, await read(path)] as const;
})));
const cratePaths = await Array.fromAsync(new Bun.Glob("**/Cargo.toml").scan({ cwd: "crates" }));
const crateOwners = new Map<string, string>();
for (const relative of cratePaths) {
  const manifestPath = `crates/${relative}`;
  const manifest = await read(manifestPath);
  const name = manifest.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  if (name) crateOwners.set(name.replaceAll("-", "_"), manifestPath.replace(/Cargo\.toml$/, "src/lib.rs"));
}
type FunctionProof = { path: string; name: string; body: string };
const extractFunction = (path: string, source: string, name: string): FunctionProof | undefined => {
  const match = new RegExp(`(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${name}\\b`).exec(source);
  if (!match) return;
  const open = source.indexOf("{", match.index + match[0].length);
  if (open < 0) return;
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return { path, name, body: source.slice(match.index, index + 1) };
  }
};
const functionByName = (name: string, preferred?: string) => {
  if (preferred) {
    const path = `apps/inacord/src-tauri/src/${preferred}.rs`;
    const found = extractFunction(path, tauriSources.get(path) ?? "", name);
    if (found) return found;
  }
  for (const [path, source] of tauriSources) {
    const found = extractFunction(path, source, name);
    if (found) return found;
  }
};
const proveNativeDelegation = (entry: string) => {
  const parts = entry.split("::");
  const leaf = parts.at(-1)!;
  const root = functionByName(leaf, parts.length > 1 ? parts[0] : undefined);
  if (!root) return undefined;
  const queue = [{ function: root, chain: [[root.path, `fn ${root.name}`] as [string, string]] }];
  const visited = new Set<string>();
  const candidates: { owner: string; sourceEvidence: [string, string][]; terminal: string }[] = [];
  while (queue.length) {
    const { function: current, chain } = queue.shift()!;
    const key = `${current.path}:${current.name}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const match of current.body.matchAll(/\b(nie_[a-z0-9_]+)::([a-zA-Z0-9_:]+)/g)) {
      const owner = crateOwners.get(match[1]);
      if (owner) candidates.push({ owner, terminal: match[0], sourceEvidence: [...chain, [current.path, match[0]]] as [string, string][] });
    }
    for (const call of current.body.matchAll(/\b([a-z_][a-z0-9_]*)::([a-z_][a-z0-9_]*)\s*\(/g)) {
      const helper = functionByName(call[2], call[1]);
      if (helper && !visited.has(`${helper.path}:${helper.name}`)) {
        queue.push({
          function: helper,
          chain: [...chain, [current.path, call[0]], [helper.path, `fn ${helper.name}`]],
        });
      }
    }
    for (const call of current.body.matchAll(/(?<![:.])\b([a-z_][a-z0-9_]*)\s*\(/g)) {
      const helper = functionByName(call[1], current.path.match(/\/([^/]+)\.rs$/)?.[1]);
      if (helper && !visited.has(`${helper.path}:${helper.name}`)) {
        queue.push({
          function: helper,
          chain: [...chain, [current.path, `${helper.name}(`], [helper.path, `fn ${helper.name}`]],
        });
      }
    }
  }
  const expected = nativeOwner(entry);
  const preferred = candidates.find(candidate => candidate.owner === expected)
    ?? candidates.find(candidate => !candidate.terminal.startsWith("nie_formats::vfs::"));
  if (preferred) return preferred;
  return { owner: "apps/inacord/src-tauri/src/lib.rs", sourceEvidence: [[root.path, `fn ${root.name}`] as [string, string]] };
};
const registry = tauriSource.match(/collect_commands!\[([\s\S]*?)\n\s*\]\)/)?.[1] ?? "";
const explicitNativeProof: Record<string, { owner: string; sourceEvidence: [string, string][] }> = {
  "sqlite::sqlite_load": { owner: "crates/engine/nie-explore/src/database.rs", sourceEvidence: [["apps/inacord/src-tauri/src/sqlite.rs", "fn sqlite_load"], ["apps/inacord/src-tauri/src/sqlite.rs", "registry.load("]] },
  "sqlite::sqlite_select": { owner: "crates/engine/nie-explore/src/database.rs", sourceEvidence: [["apps/inacord/src-tauri/src/sqlite.rs", "fn sqlite_select"], ["apps/inacord/src-tauri/src/sqlite.rs", ".select("]] },
  "sqlite::sqlite_execute": { owner: "crates/engine/nie-explore/src/database.rs", sourceEvidence: [["apps/inacord/src-tauri/src/sqlite.rs", "fn sqlite_execute"], ["apps/inacord/src-tauri/src/sqlite.rs", "registry.execute("]] },
  "sqlite::sqlite_close": { owner: "crates/engine/nie-explore/src/database.rs", sourceEvidence: [["apps/inacord/src-tauri/src/sqlite.rs", "fn sqlite_close"], ["apps/inacord/src-tauri/src/sqlite.rs", "registry.close("]] },
  aphrody_pet_etat: { owner: "crates/engine/nie-aphrody/src/lib.rs", sourceEvidence: [["apps/inacord/src-tauri/src/lib.rs", "aphrody::pet_etat("], ["apps/inacord/src-tauri/src/aphrody.rs", "fn pet_etat"], ["apps/inacord/src-tauri/src/aphrody.rs", "Pet::bundled("]] },
  aphrody_pet_frame_png_b64: { owner: "crates/engine/nie-aphrody/src/lib.rs", sourceEvidence: [["apps/inacord/src-tauri/src/lib.rs", "aphrody::pet_frame_png_b64("], ["apps/inacord/src-tauri/src/aphrody.rs", "fn pet_frame_png_b64"], ["apps/inacord/src-tauri/src/aphrody.rs", "Pet::bundled("]] },
  aphrody_pixel_tokens_css: { owner: "crates/engine/nie-aphrody/src/lib.rs", sourceEvidence: [["apps/inacord/src-tauri/src/lib.rs", "aphrody::tokens_css_fichier("], ["apps/inacord/src-tauri/src/aphrody.rs", "fn tokens_css_fichier"], ["apps/inacord/src-tauri/src/aphrody.rs", "tokens_css("]] },
  aphrody_pixel_vectoriser: { owner: "crates/engine/nie-aphrody/src/lib.rs", sourceEvidence: [["apps/inacord/src-tauri/src/lib.rs", "aphrody::vectoriser_fichier("], ["apps/inacord/src-tauri/src/aphrody.rs", "fn vectoriser_fichier"], ["apps/inacord/src-tauri/src/aphrody.rs", "vectoriser("]] },
  raw_cpk_video_preview_b64: { owner: "crates/engine/nie-explore/src/cinema/browser_video.rs", sourceEvidence: [["apps/inacord/src-tauri/src/lib.rs", "video_mp4_b64_from_bytes("], ["apps/inacord/src-tauri/src/lib.rs", "video::mp4_depuis_usm("], ["apps/inacord/src-tauri/src/video.rs", "nie_explore::native_video::web_video_stream("]] },
  vfs_video_preview_b64: { owner: "crates/engine/nie-explore/src/cinema/browser_video.rs", sourceEvidence: [["apps/inacord/src-tauri/src/lib.rs", "fn vfs_video_preview_b64"], ["apps/inacord/src-tauri/src/lib.rs", "video::mp4_depuis_usm("], ["apps/inacord/src-tauri/src/video.rs", "nie_explore::native_video::web_video_stream("]] },
};
for (const method of ["exec", "attach", "broadcast", "eval", "set_global", "globals", "reload", "drain", "api_report"]) {
  explicitNativeProof[`lua_session_${method}`] = {
    owner: "crates/engine/nie-lua/src/session.rs",
    sourceEvidence: [
      ["apps/inacord/src-tauri/src/lib.rs", `session.${method}(`],
      ["apps/inacord/src-tauri/src/lua_session.rs", `fn ${method}`],
      ["apps/inacord/src-tauri/src/lua_session.rs", "fn handle"],
      ["apps/inacord/src-tauri/src/lua_session.rs", "nie_lua::session::LuaSession"],
    ],
  };
}
const inacord = registry.split(",").map(value => value.trim()).filter(value => /^[a-z_][a-z0-9_:]*$/.test(value))
  .map(name => {
    const leaf = name.split("::").at(-1) ?? name;
    const host = /^(live_|launch_|open_|re_|memory_|process_|default_|check_game_dir|preload_vfs|list_packs_dir|raw_cpk_extract|copy_disk|disk_file|set_titlebar|take_pending|describe_disk|read_disk|write_text|install_|blender_|clipboard_|trash_|export_mod|forge_|mcp_)/.test(leaf);
    const transport = /^(remote_|model_service_|raw_cpk_read_b64$|viola_cancel$|vfs_read_b64$|vfs_all_entries$|vfs_cache_|video_precharger$)/.test(leaf);
    const forcedHost = /^(save_bytes_b64|save_export|vfs_extract_to|vfs_write_b64|vfs_write_loose_override_b64)$/.test(leaf);
    const gameDataCall = name.startsWith("game_data_")
      ? functionByName(leaf)?.body.match(/game_data::(list_[a-z0-9_]+)\b/)?.[1]
      : undefined;
    const proof = explicitNativeProof[name] ?? (gameDataCall ? {
      owner: "crates/engine/nie-explore/src/game_data.rs",
      sourceEvidence: [
        ["apps/inacord/src-tauri/src/lib.rs", `game_data::${gameDataCall}`],
        ["apps/inacord/src-tauri/src/game_data.rs", `pub fn ${gameDataCall}`],
        ["apps/inacord/src-tauri/src/game_data.rs", "use nie_explore::game_data::"],
      ] as [string, string][],
    } : proveNativeDelegation(name));
    const classification = transport ? "transport" : host || forcedHost ? "host_only" : "portable";
    const mapped = mapping("inacord", name, proof?.owner ?? nativeOwner(name), classification, transport ? `${name} forwards bytes or lifecycle control through the IPC/HTTP boundary.` : host || forcedHost ? `${name} requires native process, window, executable, game-installation, or destination-filesystem access.` : `${name} delegates portable domain work through the evidenced call chain.`);
    return proof ? { ...mapped, sourceEvidence: proof.sourceEvidence } : mapped;
  });

const siteSource = await read("crates/tools/nie-site/src/app.rs");
const getRoutes = [...siteSource.matchAll(/^\s*"(\/[^" ]+)"\s*=>\s*crate::routes::([a-z0-9_]+)::/gm)]
  .map(match => ({ path: match[1], module: match[2] }));
const posts = [...siteSource.matchAll(/\.route\(\s*CHEMINS_HORS_GET\[(\d+)\],\s*post\(crate::routes::([a-z0-9_]+)::/g)]
  .map(match => ({ path: getRoutes.find(route => route.path === [
    "/api/v1/regles/comparaison", "/api/v1/team/synergy", "/api/v1/save/roster", "/api/v1/inspect/compare", "/api/v1/inspect/plate", "/api/v1/menu/runtime/{screen}", "/api/v1/zukan/rank", "/api/save/resolve-roster", "/api/v1/wiki/compare", "/api/v1/wiki/random-team"
  ][Number(match[1])])?.path ?? `CHEMINS_HORS_GET[${match[1]}]`, module: match[2] }));
const site = [...getRoutes.map(route => ({...route, method:"GET"})), ...posts.map(route => ({...route, method:"POST"}))]
  .map(route => {
    const transport = /^(health|well_known|downloads|feed|assets|static_files|pages|vfs|couverture)$/.test(route.module) || route.path === "/api/v1/health";
    const owner = siteOwners[route.module] ?? `crates/tools/nie-site/src/routes/${route.module}.rs`;
    return { ...mapping("site", `${route.method} ${route.path}`, owner, transport ? "transport" : "portable", transport ? `${route.method} ${route.path} is HTTP delivery or service metadata.` : `${route.method} ${route.path} delegates portable work to the named library owner.`), ...(transport ? {} : { sourceEvidence: [`crates/tools/nie-site/src/routes/${route.module}.rs`, ownerNeedle(owner)] }) };
  });
site.push(mapping("site", "FALLBACK {*path}", "crates/tools/nie-site/src/routes/static_files.rs", "transport", "Static bundle fallback is HTTP transport."));

const inventory = { schema: "niers.public-entry-inventory/v1", proofLevel: "source-delegation", proofLimitation: "Verified call-chain evidence does not prove the absence of residual portable logic in bindings; that requires semantic audit and review.", generatedFrom: {
  cli: "Cmd", mcp: "#[tool(name)]", inacord: "tauri_specta::collect_commands!", site: "declarer_routes! + explicit post routes"
}, entries: [...cli, ...mcp, ...inacord, ...site] };
await Bun.write("scripts/validation/public-entry-inventory.json", `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({ cli: cli.length, mcp: mcp.length, inacord: inacord.length, site: site.length }));
