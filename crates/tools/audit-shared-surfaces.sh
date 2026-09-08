#!/usr/bin/env bash
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
require_complete=false
if [[ "${1:-}" == "--require-complete" ]]; then
  require_complete=true
elif [[ $# -ne 0 ]]; then
  echo "usage: $0 [--require-complete]" >&2
  exit 2
fi

cd "$repo_root"

failures=0
row() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3"
  if [[ "$2" == "FAIL" ]]; then
    failures=$((failures + 1))
  fi
}

contains() {
  rg -q --fixed-strings "$1" "$2"
}

printf 'claim\tstatus\tevidence\n'

if contains '[lib]' crates/tools/nie-cli/Cargo.toml; then
  row cli_importable PASS 'crates/tools/nie-cli/Cargo.toml declares [lib]'
else
  row cli_importable FAIL 'nie-cli has no importable library target'
fi

if contains 'nie-cli.workspace = true' crates/tools/nie-mcp/Cargo.toml \
  && contains 'nie_cli::main_entry_with(["niers", "mcp"])' crates/tools/nie-mcp/src/main.rs; then
  row mcp_thin_binding PASS 'nie-mcp depends on and directly enters nie-cli in-process'
else
  row mcp_thin_binding FAIL 'nie-mcp does not have the expected direct nie-cli binding'
fi

shared_manifest_deps=(nie-formats nie-explore nie-data nie-core nie-lua nie-save nie-steam nie-viola)
for crate in "${shared_manifest_deps[@]}"; do
  surfaces=()
  contains "$crate" crates/tools/nie-cli/Cargo.toml && surfaces+=(cli)
  contains "$crate" crates/tools/nie-site/Cargo.toml && surfaces+=(site)
  contains "$crate" apps/inacord/src-tauri/Cargo.toml && surfaces+=(inacord)
  if [[ ${#surfaces[@]} -ge 2 ]]; then
    row "shared_dependency:$crate" PASS "${surfaces[*]}"
  else
    row "shared_dependency:$crate" FAIL "found in: ${surfaces[*]:-none}"
  fi
done

if contains 'nie_explore::menu_icons' crates/tools/nie-cli/src/icons_cmd.rs \
  && contains 'build_icon_index(' crates/tools/nie-cli/src/icons_cmd.rs \
  && contains 'nie_explore::menu_icons' crates/tools/nie-site/src/routes/screens.rs \
  && contains 'build_icon_index(' crates/tools/nie-site/src/routes/screens.rs; then
  row icon_index_single_owner PASS 'CLI and site delegate icon discovery and indexing to nie-explore'
else
  row icon_index_single_owner FAIL 'CLI and site do not both delegate icon indexing to nie-explore'
fi

if contains 'menu_mode_analysis' crates/tools/nie-cli/src/mode_index.rs \
  && contains 'collect_mode' crates/tools/nie-cli/src/mode_index.rs \
  && contains 'analyze_mode_script' crates/tools/nie-cli/src/mode_index.rs \
  && contains 'menu_mode_analysis' crates/tools/nie-site/src/routes/screens.rs \
  && contains 'collect_shared_mode' crates/tools/nie-site/src/routes/screens.rs \
  && contains 'analyze_mode_script' crates/tools/nie-site/src/routes/screens.rs; then
  row mode_analysis_single_owner PASS 'CLI and site delegate mode aggregation and Lua analysis to nie-explore'
else
  row mode_analysis_single_owner FAIL 'CLI and site do not both delegate mode analysis to nie-explore'
fi

if contains 'fn t2b_value_to_json(' crates/engine/nie-explore/src/bridge.rs \
  && contains 'fn t2b_value_to_json(' apps/inacord/src-tauri/src/game_data.rs; then
  row t2b_json_single_owner FAIL 'nie-explore and Inacord define separate T2B value-to-JSON mappings'
else
  row t2b_json_single_owner PASS 'no known engine/Inacord T2B JSON mapping duplication found'
fi

if contains 'use nie_wiki::entities as shared;' crates/tools/nie-site/src/routes/entites.rs \
  && contains 'shared::analyser(table, brut)' crates/tools/nie-site/src/routes/entites.rs \
  && contains 'shared::page_lignes(c, table, demande)' crates/tools/nie-site/src/routes/entites.rs \
  && contains 'shared::facettes(c, table, demande)' crates/tools/nie-site/src/routes/entites.rs \
  && ! contains 'fn clause(' crates/tools/nie-site/src/routes/entites.rs \
  && ! contains 'fn clause_sauf(' crates/tools/nie-site/src/routes/entites.rs \
  && ! contains 'fn ligne_en_json(' crates/tools/nie-site/src/routes/entites.rs; then
  row sqlite_query_library_owner PASS 'site delegates schema, validated queries, pages and facets to nie-wiki'
else
  row sqlite_query_library_owner FAIL 'generic SQLite query policy is not fully delegated to nie-wiki'
fi

if contains 'function decoderGlb(buffer: ArrayBuffer)' apps/nie-web/src/pages/Models3D.tsx \
  && contains 'pub fn parse(data: &[u8])' crates/engine/nie-render3d/src/glb.rs; then
  row glb_decoder_single_owner FAIL 'Models3D.tsx parses GLB independently of nie-render3d::glb'
else
  row glb_decoder_single_owner PASS 'no divergent TypeScript/Rust GLB decoder pair found'
fi

if contains 'pub use nie_explore::geometry::' crates/tools/nie-site/src/routes/geometrie.rs \
  && contains 'pub fn famille_au_magic(' crates/engine/nie-explore/src/geometry.rs \
  && contains 'pub fn decoder(' crates/engine/nie-explore/src/geometry.rs; then
  row geometry_dispatch_library_owner PASS 'site delegates geometry classification and dispatch to nie-explore'
else
  row geometry_dispatch_library_owner FAIL 'geometry classification and dispatch are not fully delegated to nie-explore'
fi

if contains 'pub fn region_url(' crates/tools/nie-site/src/routes/screens.rs \
  && contains 'pub fn atlas_url(' crates/tools/nie-site/src/routes/screens.rs \
  && contains 'fn candidate(' crates/tools/nie-site/src/routes/screens.rs; then
  row atlas_policy_library_owner FAIL 'atlas addressing and selection policy are owned by a site route module'
else
  row atlas_policy_library_owner PASS 'atlas policy is not route-owned'
fi

if inventory_output="$(bun --bun scripts/validation/validate-shared-capabilities.ts 2>&1)"; then
  row exhaustive_registry PASS 'all authoritative CLI, MCP, Inacord and site entries have a classified owner and concrete delegation evidence'
else
  row exhaustive_registry FAIL 'public-entry inventory still contains unowned or unproved portable behavior'
  printf '%s\n' "$inventory_output" >&2
fi

row audit_summary "$([[ $failures -eq 0 ]] && printf PASS || printf FAIL)" "$failures failed invariant(s)"

if $require_complete && [[ $failures -ne 0 ]]; then
  exit 1
fi
