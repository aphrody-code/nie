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

if contains 'fn indexer(' crates/tools/nie-cli/src/icons_cmd.rs \
  && contains 'fn build_index(' crates/tools/nie-site/src/routes/screens.rs; then
  row icon_index_single_owner FAIL 'CLI indexer and site build_index are separate implementations'
else
  row icon_index_single_owner PASS 'no known CLI/site icon-index duplication found'
fi

if contains 'pub fn collect(' crates/tools/nie-cli/src/mode_index.rs \
  && contains 'fn collect(' crates/tools/nie-site/src/routes/screens.rs \
  && contains 'fn analyse_lua(' crates/tools/nie-cli/src/mode_index.rs \
  && contains 'fn analyse_script(' crates/tools/nie-site/src/routes/screens.rs; then
  row mode_analysis_single_owner FAIL 'CLI and site retain separate aggregation/analysis functions'
else
  row mode_analysis_single_owner PASS 'no known CLI/site mode-analysis duplication found'
fi

if contains 'fn t2b_value_to_json(' crates/engine/nie-explore/src/bridge.rs \
  && contains 'fn t2b_value_to_json(' apps/inacord/src-tauri/src/game_data.rs; then
  row t2b_json_single_owner FAIL 'nie-explore and Inacord define separate T2B value-to-JSON mappings'
else
  row t2b_json_single_owner PASS 'no known engine/Inacord T2B JSON mapping duplication found'
fi

if contains 'pub fn schema(' crates/tools/nie-site/src/routes/entites.rs \
  && contains 'pub fn analyser(' crates/tools/nie-site/src/routes/entites.rs \
  && contains 'pub fn page_lignes(' crates/tools/nie-site/src/routes/entites.rs \
  && contains 'pub fn facettes(' crates/tools/nie-site/src/routes/entites.rs; then
  row sqlite_query_library_owner FAIL 'generic SQLite schema/filter/page/facet engine is owned by an HTTP route module'
else
  row sqlite_query_library_owner PASS 'generic SQLite query policy is not route-owned'
fi

if contains 'function decoderGlb(buffer: ArrayBuffer)' apps/nie-web/src/pages/Models3D.tsx \
  && contains 'pub fn parse(data: &[u8])' crates/engine/nie-render3d/src/glb.rs; then
  row glb_decoder_single_owner FAIL 'Models3D.tsx parses GLB independently of nie-render3d::glb'
else
  row glb_decoder_single_owner PASS 'no divergent TypeScript/Rust GLB decoder pair found'
fi

if contains 'pub fn famille_au_magic(' crates/tools/nie-site/src/routes/geometrie.rs \
  && contains 'pub fn decoder(' crates/tools/nie-site/src/routes/geometrie.rs; then
  row geometry_dispatch_library_owner FAIL 'geometry classification and dispatch are owned by a site route module'
else
  row geometry_dispatch_library_owner PASS 'geometry dispatch is not route-owned'
fi

if contains 'pub fn region_url(' crates/tools/nie-site/src/routes/screens.rs \
  && contains 'pub fn atlas_url(' crates/tools/nie-site/src/routes/screens.rs \
  && contains 'fn candidate(' crates/tools/nie-site/src/routes/screens.rs; then
  row atlas_policy_library_owner FAIL 'atlas addressing and selection policy are owned by a site route module'
else
  row atlas_policy_library_owner PASS 'atlas policy is not route-owned'
fi

row audit_summary "$([[ $failures -eq 0 ]] && printf PASS || printf FAIL)" "$failures failed invariant(s)"

if $require_complete && [[ $failures -ne 0 ]]; then
  exit 1
fi
