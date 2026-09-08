---
name: niers-architecture
description: Apply the settled niers architecture: a complete Inacord application with a native game theme, a retained native game reconstruction target, and one shared library owner per capability across web, desktop, CLI, MCP and forge.
---

# niers architecture

`PLAN.md` is the sole execution plan and measured status ledger. This skill fixes architectural
choices; it does not certify that their implementation or reverse engineering is complete.
Use `niers-monorepo` for paths, dependency conventions and scoped commands.

## Two retained product goals

1. **Inacord is the primary application UI.** Preserve its mature components and all capabilities:
   explorer, editor, inspectors, search, data, saves, mods, Lua, media and tools. Converge web and
   desktop on this application rather than replacing it with a reduced explorer or menu demo.
   Redesign its presentation with the game's real icons, colors, fonts and individual VFS assets
   as the principal theme. Preserve existing interactions and alternate themes during migration.
2. **The native game UI remains a distinct reconstruction target.** Preserve native layouts,
   menus, animation, resource resolution and Lua/state contracts for backend behavior, mod
   authoring and production of a new `nie.exe`. Retain its reference ledger and native/Wasm
   evidence. Shared application completion and game reconstruction are separate acceptance axes.

The supplied Inacord explorer and game main-menu captures are visual references. Full-screen
captures must never become runtime screen textures. Neither reference authorizes fake gameplay,
substitute artwork or the removal of application features.

## One implementation per role

| Role | Existing owner to extend |
|---|---|
| Frontend source/build and host composition | `apps/nie-web`; `apps/inacord` retains Tauri packaging and compatibility facades |
| Native OS integration | `apps/inacord/src-tauri`, inside the root Rust workspace |
| General presentation primitives | `packages/ui` |
| Shared Inacord/game components and selection/navigation primitives | `packages/inacord-ui` |
| Asset loading, transport and capability contracts | `packages/asset-source` |
| Binary format decoding, including Level-5/Criware families | `nie-formats` |
| Typed game tables | `nie-data` |
| Resource inspection, media resolution and database sessions | `nie-explore` |
| Domain state and simulation | `nie-core`, `nie-runtime`, `nie-app` according to existing domain boundaries |
| Lua execution and observed native callbacks | `nie-lua` |
| Scene documents, models and rendering | `nie-render3d`, with existing `nie-game`, `nie-camera` and `nie-ui` consumers |
| Save/mod/Steam capabilities | `nie-save`, `nie-viola`, `nie-steam` |
| Wiki mirror and card/query APIs | `nie-wiki`; retain existing Azalee/inagle adapters until migrated |
| Zukan candidate ranking | `nie-zukan`; do not claim historical TypeScript pipelines migrated without proof |
| Executable forge and RE | Existing `nie-pe`, `nie-asm`, `nie-forge`, `nie-re`, `nie-index`, `nie-trace` owners |
| Bun FFI / file imports | `packages/nie` / `packages/nie-plugin` over `nie-ffi` |
| CLI, MCP, HTTP and Wasm | Thin bindings through existing `nie-cli`, `nie-mcp`, `nie-site` and `nie-wasm` |

A CLI, command handler or React component must not become a second home for domain algorithms.
Extract reusable logic into its existing library owner, preserve the original caller, then add
other bindings. Do not create another parser, navigation implementation or UI package without
first checking existing owners. Authentication, publishing and remote storage remain service
adapter roles; they are not another game engine.

## Native resources as the principal theme

- Display localized entity names alongside exact game/resource IDs for characters, skills,
  stadiums, keshins, items and story moments. Resolve media-folder labels from verified native
  text-CFG relations in the user's language. Backend VFS paths and database keys stay unchanged.
  Unsupported joins remain explicit; a hand-written category label is not native localization.
- The shared native-text contract addresses a label by the measured `(VFS locale, family, hash)`
  tuple and retains source-file provenance and hash ambiguity. Do not use a UI fallback string as
  a translated game label. The shell URL locales and game VFS locales are distinct: all measured
  VFS languages are selectable for game text without claiming a translated host route exists.
- `packages/inacord-ui/src/gallery` owns the shared gallery. Retain Inacord file/conversion/
  preview capabilities and Azalee data/filter/card capabilities through host adapters. Counts
  and pagination must use the same deduplicated resource inventory, not summed source totals.

- Keep source VFS path, native resource/region identity, filename and existing slug traceable in
  resource contracts. Preserve served routes and identifiers during migration.
- Reuse decoded spritesheets, bitmap-font rasterization, native media and measured palette data.
  A transformed mask or a character-derived palette must not be described as an exact original
  menu resource. Missing icon mappings remain explicit work, not guessed substitutions.
- Load resources on demand with shared caching; preload startup music, SFX, fonts and required
  assets through the existing loader. Keep navigation usable during loading and errors.
- Expose supported native formats as first-class resource types through common decoders and
  adapters. Conversion/export is an explicit optional operation, not a separate mandatory import
  pipeline. Browser codec or OS limitations require real adapters and honest capability results.

## Host convergence and migration boundaries

The application 3D editor has one presentation owner: `packages/inacord-ui/src/three/Viewport3D.tsx`.
Inacord editor and VFS/CPK previews delegate to it through compatibility adapters. Keep its
multi-asset scene, picking, outliner, statistics, TRS gizmos, grid, wireframe and camera controls.
`ModelViewerSurface` in the same directory owns gallery/detail preview lifecycle; its retained
model-viewer backend preserves local compressed-model decoders. Do not create another editor
or duplicate a preview lifecycle to add a host. The Rust reconstruction renderer remains a
distinct backend until its rendering and editing contracts reach measured parity.

The canonical frontend lives in `apps/nie-web`; the existing Inacord source is currently under
`src/desktop`. Extract its shell, view registry and inspectors into shared presentation with
injectable services. Native adapters retain filesystem, process and memory operations; web
adapters use the existing HTTP/Wasm owners. Preserve desktop features while web adapters are
implemented. Do not hide unavailable operations behind successful no-ops.

A common Vite entry and shared Explorer controls do not establish full application parity.
The reduced browser inspector and remaining desktop-specific services are migration work, not
an alternate final architecture. Likewise, wiki raw queries, legacy MCP facades and TypeScript
ranking remain compatibility boundaries until consumer migration is demonstrated.

Use one root Cargo workspace/lockfile and Bun catalog/lockfile. Dependency convergence preserves
consumer features and target conditions; it does not require one package for unrelated roles.
Historical IECODE material is provenance/reference, not a new runtime dependency; consult
`docs/IECODE-MIGRATION.md` before adding a parser or data family.

## Acceptance

Track application feature preservation, native theme provenance, native game reconstruction and
executable production separately. Require relevant interaction, decoding, round-trip, rendering
and native/Wasm gates with nonzero counts before completion claims. Compilation or an HTTP 200
is insufficient. Keep unsupported formats and unproven reverse-engineering behavior visible in
`PLAN.md`; the architectural decision never turns those gaps into completed work.
