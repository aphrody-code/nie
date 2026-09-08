# Shared core and product surfaces

Source audit: 2026-09-08. This document records source-level evidence only. It does not turn a
successful build, an HTTP response, or matching dependency names into behavioral parity.

## Current verdict

The requested invariant — "the site and its backend share all domain code with the CLI, Inacord,
and MCP" — is **not yet true**.

- The standalone MCP executable is a proven thin binding: `nie-mcp` depends on `nie-cli` and its
  `main` only calls `nie_cli::main_entry_with(["niers", "mcp"])`. MCP command parsing and dispatch
  therefore execute the CLI library in-process.
- The site, CLI, and Inacord depend on many of the same engine libraries. This proves shared owners
  for the capabilities listed below, but not that every capability is shared.
- `nie-site::routes::screens` still contains explicit ports of `nie-cli::icons_cmd::indexer` and
  `nie-cli::mode_index::{collect,analyse_lua}`. Both surfaces call common parsers underneath, but
  the aggregation and policy logic exists twice. This is a concrete counterexample to the global
  invariant.
- Comments in `nie-site::app` and `nie-site::routes::screens` still say that `nie-cli` has no
  library target. That rationale is stale: the current manifest declares `[lib]`. Importability
  alone is not the fix, however; these domain modules remain private and should move to a focused
  engine/tool library instead of making the HTTP service depend on the whole CLI adapter.
- Inacord is a Tauri adapter over several shared owners, but it also contains substantial host and
  orchestration code. Host-only operations are legitimate; domain transformations inside those
  commands still require capability-by-capability review before a global thin-binding claim.
- Four additional P0 counterexamples prevent a broad backend-sharing claim: Inacord duplicates the
  private T2B-value-to-JSON conversion from `nie-explore`; the site owns a generic SQLite schema,
  filtering, faceting, pagination, and row-conversion engine in `routes::entites`; `Models3D.tsx`
  implements a partial TypeScript GLB decoder alongside `nie-render3d::glb`; and the site owns
  format-family geometry dispatch plus atlas URL/index policy instead of calling focused owners.

Run `crates/tools/audit-shared-surfaces.sh` for a reproducible source audit. Its default mode emits
a tab-separated report and succeeds so it can be used for inventory. Pass `--require-complete` to
enforce the requested invariant; it intentionally fails while a known duplicated owner remains.

## Machine-verifiable capability matrix

| Capability | Canonical owner | CLI path | Site/backend path | Inacord path | MCP path | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| CLI parsing and dispatch | `nie-cli` library | `nie_cli::main_entry` | Not an HTTP owner | Not a desktop owner | `nie_cli::main_entry_with(["niers", "mcp"])` | MCP shared exactly |
| VFS open/read | `nie-formats::vfs` | `open_vfs`, `vfs_cmd` | `EtatSite::vfs`, VFS routes | Tauri commands call `nie_formats::vfs` | MCP dispatches the CLI path | Shared engine owner; adapters differ |
| Typed game data | `nie-data::typed` and family modules | Decode/data commands | `routes::donnees`, `routes::text`, family routes | `game_data` and Tauri commands | MCP dispatches CLI tools | Shared decoding owner |
| Lua decode/runtime | `nie-lua` | `lua_cmd`, `lua_run_cmd` | `routes::lua`, `routes::menu_runtime` | `lua_session`, `lua_tools` | MCP dispatches CLI tools | Shared VM/parser; policies differ by host |
| Native preview/export | `nie-explore` | VFS/video/export callers | `routes::native_export`, `motion`, `spatial_preview`, `menu_audio` | compatibility commands over `nie-explore` | MCP dispatches CLI tools | Shared owner for mapped operations |
| Wiki queries | `nie-wiki` | `wiki_cmd` | `routes::wiki`, catalogue routes | SQLite compatibility facade | MCP dispatches CLI tools | Shared query owner for mapped queries |
| Steam operations | `nie-steam` | `steam_cmd` | No equivalent public mutation route | `steam` Tauri adapter | MCP dispatches CLI tools | Shared where exposed; surface coverage differs |
| Icon index | No extracted library owner | `icons_cmd::indexer` | `routes::screens::build_index` | No complete equivalent proven | MCP dispatches CLI implementation | **Duplicated CLI/site domain logic** |
| Mode aggregation and Lua command analysis | `nie-explore::menu_modes` owns definitions only; no complete aggregation owner | `mode_index::{collect,analyse_lua}` | `routes::screens::{collect,analyse_script}` | No complete equivalent proven | MCP dispatches CLI implementation | **Duplicated CLI/site domain logic** |
| T2B-to-JSON conversion | `nie-explore::bridge` | Shared bridge for generic decode | Shared format/data decoders | `game_data::t2b_value_to_json` reproduces the private bridge helper | MCP dispatches CLI implementation | **Duplicated engine/Inacord mapping** |
| Generic SQLite catalogue/query engine | No extracted query library owner | No equivalent generic owner proven | `routes::entites::{schema,analyser,clause,page_lignes,facettes,lire_ligne}` | SQLite compatibility and feature-specific commands | MCP dispatches CLI tools | **Site-owned domain query policy** |
| GLB decoding for rendering | `nie-render3d::glb` | `render_cmd` calls Rust renderer | Rust render/model routes | Shared UI can use Rust/Wasm viewer, but `Models3D.tsx::decoderGlb` is a separate partial decoder | MCP dispatches CLI tools | **Divergent TypeScript decoder** |
| Geometry family dispatch | No extracted route-neutral catalogue/dispatch owner | `decode_cmd` and format libraries | `routes::geometrie::{famille_au_magic,decoder}` | Direct format-library calls | MCP dispatches CLI implementation | **Site-owned orchestration/policy** |
| Atlas addressing and selection policy | No extracted library owner | `icons_cmd::indexer` | `routes::screens::{candidate,region_url,atlas_url,build_index}` | No complete equivalent proven | MCP dispatches CLI implementation | **Site-owned and partly duplicated policy** |
| Desktop filesystem, process launch, tracing, updater, clipboard, MCP installation | Host/Tauri adapter by nature | Partial CLI equivalents where appropriate | Intentionally not public mutations | Tauri commands | MCP may expose bounded CLI operations | Not a parity requirement unless domain policy is embedded |

The table separates *implementation sharing* from *surface coverage*. A capability absent from one
surface does not create duplicate code, but it also cannot support a claim that every surface has
the same complete feature set.

This repository has one implementation owner per capability. Product surfaces are bindings, not
alternative homes for business logic.

## Dependency direction

```text
nie-formats / nie-lua / nie-data
             ↓
        nie-explore
             ↓
 asset-source + inacord-ui (portable contracts and presentation)
       ↓          ↓          ↓          ↓          ↓
   nie-site     nie-cli    nie-web   Inacord/mobile  MCP/API/future hosts
```

The core owns VFS listing, search, format decoding, asset identity, state transitions and
portable validation. Rust and TypeScript bindings translate transport concerns only. A host may
declare capabilities (for example disk writes or Blender) but must not silently reimplement a
missing operation or invent a successful result.

## Surface rules

- `nie-explore` is the owner for listing/search/preview/export contracts shared by site, CLI and
  Inacord. HTTP, Tauri, CLI and MCP handlers call it through thin adapters.
- `packages/asset-source` is the host-neutral resource contract. Web and desktop adapters provide
  bytes, URLs and capabilities; components never inspect Tauri, HTTP or filesystem globals.
- `packages/inacord-ui` owns portable Explorer presentation, tabs/history reducers, geometry and
  tokens. `apps/nie-web` and Inacord mount the same Explorer surface and supply only adapters.
- Mobile, MCP, API and future services must consume these same contracts. New surface-specific
  logic requires a capability or transport adapter, never a second domain implementation.
- Compatibility facades remain until every consumer has migrated; removal is a separate measured
  batch.

## Required proof

Every shared capability needs reducer/contract tests, one adapter test per host, and a rendered
interaction check. Explorer parity additionally requires same viewport, locale, theme, data state,
asset provenance, screenshot hash and per-region comparison. Passing HTTP requests or a typecheck
alone is not proof of visual or behavioral parity.

For the global source-sharing invariant, all of these gates are required:

1. `crates/tools/audit-shared-surfaces.sh --require-complete` exits zero.
2. Every domain row names one importable library owner and contains adapter tests for every exposed
   surface; CLI modules must not be treated as reusable owners merely because `nie-cli` has a lib
   target.
3. Cross-surface fixtures compare semantic results from CLI, HTTP, Tauri, and MCP adapters for the
   same inputs. DTO/transport differences must be normalized explicitly.
4. Host-only capabilities are enumerated and justified; they are not silently counted as shared or
   omitted from the claim.
5. The applicable Cargo, Bun, native, and Wasm gates pass with non-zero assertions. Runtime and UI
   equality remain separate from this source-sharing proof.

The next extraction should move icon indexing, atlas addressing, mode aggregation/analysis,
geometry dispatch, generic mirror queries, and T2B JSON mapping into focused library owners. The
TypeScript GLB path should consume the Rust/Wasm renderer contract instead of retaining a second
parser. Keep CLI, HTTP, and Tauri DTO compatibility facades and add equality fixtures before
deleting any implementation.

## Delivery order

1. Extract and test the core owner.
2. Keep CLI, site, desktop and WASM compatibility facades green.
3. Migrate the shared UI and state reducers.
4. Add mobile, MCP and API bindings over the same owner.
5. Run contract, interaction, cross-target and visual gates before committing a coherent batch.
