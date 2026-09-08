# NIERS unified execution plan

Last consolidated: 2026-09-08. This is the repository's only active plan, priority list,
decision ledger, and completion gate. Historical plans are preserved under
[`docs/archive/plans/2026-09-08/`](docs/archive/plans/2026-09-08/README.md); they are evidence,
not instructions.

## Outcome

Build one maintainable Rust implementation of the Inazuma Eleven: Victory Road formats,
runtime, tools, and user surfaces:

1. `nie-web` becomes the browser/WebAssembly host of the reconstructed engine, targeting the
   behaviour and rendering of `nie.exe`.
2. Inacord becomes the unified desktop/mobile suite: VFS explorer, data editor, complete 3D
   editor, modding/live-editing environment, game runtime, CLI, API, MCP, and Blender bridge.
3. Every capability has one library owner. CLI, MCP, HTTP, desktop, mobile, and WebAssembly are
   bindings, never independent implementations.
4. Visual fidelity is measured against `data/menu` references, but no screen may be implemented
   as a full-screen reference image. Captures are test oracles only.

## Truth contract

- Use actual VFS paths, parsed `cfg.bin`, decoded Level-5 assets, Lua 5.2 callbacks, reversed
  native behaviour, and measured geometry. Unknown data stays unknown and observable.
- Do not invent player statistics, labels, versions, progress, success states, menu mappings,
  assets, or renderer coverage.
- A G4TX texture or atlas region is a valid runtime component. A screenshot standing in for an
  entire page is not.
- A menu is complete only when its rendered objects, state transitions, focus, hover, press,
  activation, cancellation, keyboard, pointer, touch, and standard-gamepad behaviour are tested.
- "Pixel-perfect" requires a reproducible screenshot comparison with the reference, including
  dimensions, SSIM/delta metrics, and an explicit list of excluded dynamic regions. HTTP 200,
  compilation, or visual resemblance is not proof.
- Public responses expose no machine identity, repository identity, service name, version, or
  secret. Product names are limited to nie, Inacord, Azalée, and the Aphrody character where the
  character is actually present.
- English is used for paths, identifiers, schemas, URLs, code comments, and agent-facing docs.
  French is reserved for user-facing prose.

## Architecture and ownership

The Cargo workspace contains 41 packages: 19 engine, 10 forge, and 12 tools. Measurement:

```text
cargo metadata --format-version 1 --no-deps
2026-09-08: .packages = 41; manifest parent counts = engine 19, forge 10, tools 12
```

| Owner | Responsibility | Bindings/consumers |
|---|---|---|
| `nie-formats` | CPK, cfg.bin, G4*, Criware, menu asset composition | engine, site, Wasm, Inacord |
| `nie-data` | typed game tables and domain data | engine, wiki, UI bindings |
| `nie-core` | reversed game rules, physics, AI, match state | runtime, app, Wasm |
| `nie-lua` | bounded Lua 5.2 VM, includes, typed menu callbacks and state | native menu runtime |
| `nie-ui` | measured game tokens, geometry, reference metadata | web and Inacord UI |
| `nie-app` | generic screen FSM and simulation state | native/headless/Wasm hosts |
| `nie-wasm` | browser ABI over portable Rust libraries | `apps/nie-web` |
| `nie-game` | native wgpu host and real-asset renderer | capture and fidelity gates |
| `aphrody-re` / forge crates | binary inspection and byte-exact reconstruction | CLI, MCP, Wasm where portable |
| `nie-index` | shared RE database path and query ownership | CLI and MCP |
| `nie-cli` | thin terminal binding | users and native MCP router |
| `nie-mcp` | native Rust `rmcp` binding | Codex/agents/Inacord |
| `nie-site` | Axum origin, VFS/assets/API and static bundle host | `nie.aphrody.com` |
| `packages/asset-source` | host-neutral asset-source contract | web and Inacord |
| `packages/inacord-ui` | shared responsive UI, game geometry and interaction model | web, desktop, mobile |

Boundaries that must not be collapsed merely because names are close:

- `nie-lua` executes native menu logic; `nie-ui` owns visual measurements; `nie-app` owns the
  generic FSM; `nie-wasm` owns the browser ABI; `nie-aphrody` owns the Aphrody pet runtime.
- `crc32` and `crc32_nie` have different finalisation semantics.
- `nie-core::StatBlock` and `nie-wiki::StatBlock` model different source curves.
- `nie-core` and `nie-runtime` use different vertical-axis conventions.
- Host-only filesystem, SQLite, Redis, process, and live-memory code does not enter Wasm merely to
  increase a dependency counter.

## Current measured state

### Verified and retained

- `nie-formats` owns the menu asset index/layout helpers; `nie-explore::menu_layout` is now a
  compatibility facade. The duplicate T2B-to-iecode conversion in `nie-game` uses
  `cfgbin::t2b_to_iecode_json`.
- `aphrody-re` owns the bounded PE inspector; `ievr-tools::pe` is a compatibility facade.
- `nie-explore::menu_modes` owns the menu-mode catalogue; the dead CLI presentation duplicate is
  removed.
- `nie-index` owns the configurable RE database fallback used by CLI/MCP.
- Wonderbot and Inacord share one browser-safe episode navigation implementation.
- `nie-app`/`nie-wasm` no longer draw the invented dark vertical main menu. The menu framebuffer
  is host-owned until the verified renderer supplies it.
- `nie-wasm::menu_static_layer_json` composes OBJBIN + G4PKM/G4SK + G4TX through
  `nie-formats::menu::assemble_object` with a versioned JSON contract.
- Inacord already contains lazy views, cancellable persistent VFS indexing, shared 3D viewport,
  G4MD/G4MG controls, avatar/menu pipelines, and a native Live Mod bridge. Git-history review did
  not identify a deleted UI worth restoring without reintroducing obsolete wiki/web coupling.

Latest relevant gates run from `/home/ubuntu/niers` on 2026-09-08:

| Gate | Result |
|---|---:|
| `cargo test -p nie-formats --lib` | 301 passed, 0 failed |
| `cargo test -p nie-game --tests` | 23 passed, 0 failed, 2 ignored |
| `cargo test -p nie-site` | 349 passed, 0 failed, 1 ignored |
| `cargo test --offline -p nie-wasm --lib` | 62 passed, 0 failed |
| `bun test packages/wonderbot/src` | 223 passed, 0 failed, 499 assertions |
| shared menu interaction tests | 5 passed, 0 failed, 20 assertions |

### Not yet complete

- The current main-menu renderer still lacks complete C++/Lua placement, dynamic player/team
  state, every atlas-region mapping, and parity for all native actions.
- Loading, title, autosave, START, and main-menu screens must be component/VFS driven; generated
  full-screen captures must not remain in the public bundle.
- The reconstructed engine is not byte-identical to `nie.exe`, and the Wasm game renderer remains
  incomplete beyond the verified layer APIs.
- Inacord mobile is not a native Rust deliverable yet; desktop still uses a Tauri/React host.
- Azalée-tools parity remains a compatibility migration, not permission to delete a working
  package.

## Execution order

### P0 — Remove screenshot-backed runtime screens

- Render loading from `loading01.layout.json` and VFS textures with its native animation state.
- Render title/START assets from individual G4TX resources and measured components.
- Render autosave text, icon, stripe, focus, and confirmation as components driven by the opening
  FSM.
- Render the main menu from versioned runtime layout objects and named atlas regions. Keep the
  reference PNG outside the public bundle and use it only in comparison gates.
- Ship no visible developer diagnostic inside a game screen. Missing runtime data is exposed in
  structured diagnostics and accessibility state, not disguised as game UI.

Completion gate:

```text
dist contains no opening/*.png or main-menu-reference.png
DOM contains no full-screen reference image
all visible menu image requests resolve to individual VFS G4TX/atlas resources
mouse, touch, keyboard and standard-gamepad tests pass
browser screenshot compared against data/menu/main_menu_alt.png with recorded metrics
```

### P1 — Complete the native menu state pipeline

- Resolve all main-menu `funcLuaCommand` and `funcLuaMenuCommand` IDs from the local binary or
  observed runtime; never assign semantics from hash shape or call frequency alone.
- Carry the real scene/save/player state into `nie-lua::MenuState`.
- Materialise every runtime-created object and map Lua mutations to renderer fields.
- Move the asset-agnostic compiler into a reusable engine library; keep `nie-game` a host.
- Feed the same versioned scene to native wgpu, Wasm, and Inacord.

Completion gate: zero unknown commands for the selected script, all requested existing callbacks
succeed, zero unresolved visible transforms, and native/Wasm object-state equality.

### P2 — Input, motion and navigation parity

- Use `@niers/inacord-ui/shell/menu-interaction` as the shared spatial-navigation reducer.
- Connect pointer hover/press/release, focus, keyboard, touch, and standard gamepad polling.
- Derive action availability and destinations from the runtime/menu catalogue, not a site-only
  hardcoded list.
- Reproduce entry, idle, selection, activation, cancellation, loading, and reduced-motion states.

Completion gate: deterministic reducer tests plus browser interaction tests for every enabled
action and focus transition.

### P3 — Inacord product unification

- Keep one reusable Rust library entry point for each explorer/editor/modding/live/game function.
- Make desktop, future mobile, CLI, API, MCP, and Blender bridge thin callers.
- Complete the 3D editor: scene tree, transforms, materials, UV, skeleton, animation, collision,
  import/export, undo/redo, and live write-through with explicit safety boundaries.
- Replace desktop-only assumptions with adaptive input/layout contracts before adding mobile.

Completion gate: cross-surface parity tests for each migrated capability; no business logic in a
binding's `main.rs`, React view, route handler, or MCP registration.

### P4 — Evidence-based convergence

- Use Cargo metadata, package manifests, import graphs, binaries/services, and tests to prove
  duplicate ownership.
- Move implementation first, retain a compatibility facade, migrate all consumers, then remove
  the facade in a dedicated breaking-change batch.
- Delete a crate/package only after proving no workspace, deployed-service, published-package,
  plugin, script, or external compatibility consumer remains.

### P5 — Engine and forge fidelity

- Continue function-level reconstruction and byte-exact PE gates.
- Validate portable engine behaviour on Linux, Windows MSVC, and wasm32 where the crate contract
  promises those targets.
- Keep native-only reverse/live-memory capabilities behind host bindings.

Completion gate: deterministic gameplay golden tests plus byte comparison for each reconstructed
binary unit; no global claim until the whole artifact matches.

### P6 — Production and documentation

- Build, test, commit, and push one coherent batch at a time.
- Deploy only the exact pushed commit through the canonical service; validate response bodies,
  asset counts, interaction flows, and visual metrics after restart.
- Update this file whenever a durable decision, measured state, or next action changes.
- Keep technical specifications in their focused documents; do not create another roadmap.

## Required gates before commit

Run the narrowest applicable subset and record counts in the commit body:

```text
cargo fmt --all -- --check
cargo clippy -p <library> --lib --tests -- -D warnings
cargo clippy -p <binary> --bins --tests -- -D warnings
cargo check -p <portable-crate> --target wasm32-unknown-unknown
cargo test -p <changed-crate>
bun run typecheck
bun test <changed-package-or-app>
git diff --check
```

For a public UI change, also require a real browser traversal at 1920×1080, intrinsic asset
dimension checks, failed-request count, keyboard/pointer/gamepad checks, and a saved visual-diff
report. A service being `active` or a page returning 200 is insufficient.

## Decision ledger

| Date | Decision | Reason |
|---|---|---|
| 2026-09-07 | `nie-web` targets the reconstructed `nie.exe` engine; Inacord targets one unified Rust suite | user direction |
| 2026-09-07 | CLI/API/MCP/GUI/mobile are bindings over library owners | prevents drift |
| 2026-09-08 | The dark vertical Wasm menu is removed | it was not derived from `data/menu` or native code |
| 2026-09-08 | Full-screen captures are test oracles only | a screenshot is not a renderer or interaction model |
| 2026-09-08 | Similar crates/packages are not merged without consumer and semantic proof | protects byte-exact and deployed contracts |
| 2026-09-08 | This file replaces every other roadmap/plan | one current priority and gate ledger |

## Archive and technical references

- Historical plans: [`docs/archive/plans/2026-09-08/README.md`](docs/archive/plans/2026-09-08/README.md)
- Measured architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Rendering evidence: [`docs/DESIGN.md`](docs/DESIGN.md)
- UI specification: [`docs/DESIGN-UI.md`](docs/DESIGN-UI.md)
- Main-menu measurements: [`docs/mainmenu01-visual-analysis.md`](docs/mainmenu01-visual-analysis.md)
- VFS and formats: [`docs/VFS.md`](docs/VFS.md), [`docs/FORMATS.md`](docs/FORMATS.md)
- MCP contract: [`docs/MCP.md`](docs/MCP.md)
- IECODE provenance: [`docs/IECODE-MIGRATION.md`](docs/IECODE-MIGRATION.md)
