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
- The public Web bundle contains no full-screen opening or main-menu capture. Startup and the
  partial main menu are built from components, individual VFS assets, and shared interaction
  reducers; the DOM explicitly reports partial runtime completeness.
- Episode navigation now belongs to the neutral `@aphrody/ietv-client` package. Wonderbot keeps a
  compatibility facade and Inacord no longer depends on the Discord bot package.
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
| `apps/nie-web` component tests | 83 passed, 0 failed, 288 assertions |
| IETV/Wonderbot navigation tests | 225 passed, 0 failed, 503 assertions |

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

## Active batch evidence — portable menu scene and shared input (2026-09-08)

Measured on host `vps-203bea89`, checkout `/home/ubuntu/niers`:

- `nie-lua` now owns portable `MenuState`, a versioned lossless `MenuScene`, and the existing
  object-hash merge compatibility projection previously embedded in `nie-game`. Native exports
  retain layer identity in `runtimeScenes`; `nie-wasm::menu_runtime_scene_json` uses the same
  library compiler. This does not resolve missing native transforms or execute Lua in Wasm.
- One shared standard-gamepad sampler retains held-button state across opening/menu transitions,
  handles analog navigation, disconnects and multiple controllers, and applies movement before
  simultaneous confirmation. Menu activation now respects removal/disable, unmount cleanup,
  reduced motion, and one pending callback. Host destinations consume the existing route
  catalogue; native command availability remains unresolved.
- `scripts/validation/image-metrics.ts` owns Gaussian SSIM for both menu and model comparisons.
  `gate-menu.ts` records dimensions, proportional normalization, RGB deltas and explicit dynamic
  exclusions. Reference images and generated reports stay outside the public bundle.
- Precompression accepts a staging directory; `scripts/e2e-site.sh --no-build` honors
  `NIE_SITE_STATIC_DIR` so release validation does not replace live assets.

| Command / source | Measured result |
|---|---|
| `cargo test -p nie-lua --lib` | 114 passed, 0 failed, 1 ignored |
| `cargo test -p nie-lua --no-default-features --lib` | 5 passed, 0 failed, 1 ignored |
| `cargo test -p nie-game --tests` | 23 passed, 0 failed, 2 ignored |
| `cargo test -p nie-wasm --lib` | 64 passed, 0 failed |
| Generated Wasm ABI versus native compiler | 8 scenes, 61 layers, 76 objects equal; 3 invalid states rejected |
| Scoped Lua/game/Wasm clippy and Lua/Wasm wasm32 checks | passed |
| `cargo fmt --all -- --check` | passed |
| `bun test apps/nie-web/src packages/inacord-ui/src/shell/menu-interaction.test.ts scripts/validation/image-metrics.test.ts` | 101 passed, 0 failed, 338 assertions |
| `bun run typecheck` in `apps/nie-web` | passed |
| `NIE_SITE_STATIC_DIR=/home/ubuntu/niers/var/releases/menu-batch/bundle scripts/e2e-site.sh --no-build` | 66 checks passed, 0 failed, 0 skipped; 255308 VFS entries |
| `var/outputs/menu-visual/baseline/report.json` | SSIM 0.5576746728; RGB mean absolute delta 70.78096/255; 99.5601% changed pixels |
| `bun scripts/validation/gate-menu-browser.ts http://127.0.0.1:18085 var/outputs/menu-visual/final-staged` | 17 passed, 0 failed; 151 requests, 0 failed; 2 VFS images; all 4 destinations |
| `var/outputs/menu-visual/final-staged/report.json` | SSIM 0.5576746727661485; RGB mean absolute delta 70.7809553433642/255; changed fraction 0.995600887345679 |

The reference is 2560×1440, normalized proportionally to the actual 1920×1080 browser viewport;
no dynamic region is excluded. This measured partial renderer does **not** satisfy the fidelity
completion gate. A real main-menu run still reports 14 unknown general commands and 3 absent
callbacks (78 requested, 75 dispatched and successful); menu-command unknown count is zero.
Local command-handler mappings and decompiled bodies exist for the 14 general commands and are
the next evidence source. Loading metadata names animation hashes but does not provide decoded
motion curves. Production publication and final browser results are recorded after validation.

### Public deployment and measured-canvas focus correction

`aa4df0325f36dfd2f1564c153f8fec8635f88ef1` was pushed to `main` and deployed to
`nie.aphrody.com` on 2026-09-08. The private release manifest under `var/releases/<commit>/`
records the binary/bundle hashes and rollback copies. Live health retained 255308 VFS entries,
936 CPKs and 40 extensions; legacy icon URLs returned 200. The first public traversal exposed
intermittent initial focus despite the staged gate passing. This was recorded as a failed gate.

The follow-up makes `GameCanvas` signal its first measured, visible layout and focuses the menu
only after that signal. The browser regression deliberately hides the canvas before mount and
reveals it later, proving focus follows actual measurement instead of a guessed animation frame.
On the same host/date, `bun test apps/nie-web/src packages/inacord-ui/src/shell/menu-interaction.test.ts`
passed 97 tests/332 assertions; Web typecheck passed. The isolated browser report at
`var/outputs/menu-visual/focus-staged/browser-report.json` records 18 passed, 0 failed, 114 requests
and zero failed requests. The game renderer remains visually partial.

### Observed native menu inputs and current scene-editor launch

The next coherent source batch adds four general-command getters whose byte loads and branches
are verified in the local binary: `0x1953DBC1`, `0xB314C568`, `0xEF7BC853`, `0xDD5C4CD4`.
`ObservedMenuNativeState` accepts optional unsigned bytes at the documented native offsets;
missing observations still enter unresolved telemetry. `nie-game --menu-native-state <JSON>`
requires runtime layout export and injects the validated state before callbacks. Sources:
`data/re/funclua-cmdid-handlers.json`, corresponding handler bodies in
`data/re/30-ghidra/exports/decompiled-c/nie.exe.c`, and binary SHA256
`b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`.
These offsets are not asserted to be save-file fields or given guessed product meanings.

On `/home/ubuntu/niers`, host `vps-203bea89`, 2026-09-08: Lua library tests passed 118 with
1 ignored; VM-free tests passed 7 with 1 ignored; game unit tests passed 8; Wasm library tests
passed 64. Lua/game clippy and portable Lua check passed. The explicitly executed
`menu_native_state` reference-VFS integration test passed: no input retains 14 unknown general
commands, whereas a **synthetic** observed-state branch reports 12, with 75/75 callbacks successful
in both runs. Different branches invoke different unknown commands; this is not a zero-unknown
claim. Actual observed native input capture remains outstanding.

Inacord's scene-editor binding now uses the existing GLB assembler and the current `--glb` CLI,
checks executable compatibility before decoding, and reports immediate process exit. Imports are
retained in application data so saved scene projects can resolve them. The previously installed
editor binary exposed the legacy CLI; the current release binary was rebuilt. Under Xvfb and
Vulkan llvmpipe, an actual local model import rendered 1 object, duplication rendered 2, and undo
restored 1. Captures/logs are in `var/validation/scene-editor-launch/`; they are not source assets.
The native UI saved a 344-byte version-1 project and reopened its existing GLB reference in a
fresh process. The generated Wasm for this batch also passes the actual 8-scene/61-layer/76-object
equality gate; its SHA256 is `ee16737e614aac220f6e63fc5c9dcfd242b6494e27e298a1a88157e4c6172af1`.
Tauri's 4 focused binding tests, independent Cargo check and Inacord TypeScript check passed.
The strict Tauri clippy initially found two pre-existing argument-count diagnostics in
`aphrody.rs` and `viola.rs`. Grouping private measurement options and documenting the existing
flattened IPC exception makes the strict gate pass without changing public IPC keys.

The focus correction `6b2375f618f8e402c84570b0fa73e0874d56178e` is deployed and validated:
`var/outputs/menu-visual/production-6b2375f/browser-report.json` records 18 successful checks,
150 requests and zero failures. Its visual report records SSIM 0.5578690454315838 and RGB mean
absolute delta 70.70361963091564/255, with no excluded regions. The private release manifest marks
the release validated and retains its rollback artifacts.

### Placement evidence and observed flag queries (2026-09-08)

`nie-formats::menu::PlacementSource` identifies attachment locators, selected G4PKM poses,
ancestor fallback heuristics, and unresolved placement. Native runtime exports retain observed
virtual header tabs but no longer invent a horizontal row or coordinates for them. Unknown
transforms are null; both native paint passes and the shared browser renderer exclude them.
Legacy numeric layouts remain readable. A centered asset pose is not labelled unresolved merely
because it is centered. Loading exports with no executed scripts now identify `static-assets`.

The already tracked Web metadata was regenerated from the same verified recipes, using the freshly
built `target/debug/nie-game` on `vps-203bea89` in `/home/ubuntu/niers`:

```text
--game-dir /home/ubuntu/niers --menu main_menu --from-setting --runtime --screen-name mainmenu01 --export-layout apps/nie-web/src/layouts/mainmenu01.layout.json
--game-dir /home/ubuntu/niers --menu loading01 --runtime --export-layout apps/nie-web/src/layouts/loading01.layout.json
```

The main menu retains 30 objects, 22 requested visible: 12 attachment-locator placements,
7 G4PKM poses, 2 explicitly heuristic ancestor fallbacks, and 9 unresolved virtual tabs. Loading
retains its single G4PKM pose. All 22 pre-existing non-null transforms across both files are
unchanged. The browser/native unresolved-visible counters agree (menu 9, loading 0); drawable
text drops from 19 to 10 because the 9 unresolved tabs no longer paint guessed positions.

Three additional binary-proven general flag getters accept observed category storage. Omitted
hashes mean unobserved lookup; explicit null means the native lookup found no descriptor. Missing
indexed values remain unresolved. Native category bounds, Boolean/Byte return types and
out-of-range-descriptor fallback to observed index zero are preserved. Input deserialization has
explicit resource bounds and rejects duplicate keys. No synthetic maps are supplied to baseline
runtime exports.

Measured gates for this batch: formats 302 tests passed; Lua 124 tests passed with 1 ignored;
portable Lua 11 passed with 1 ignored; native render gate 14 passed with 2 ignored; explicit
unresolved sprite/text paint regression 1 passed; Web/shared-input tests 99 passed with 344
assertions; Web typecheck passed. Scoped formats/game/Lua clippy and portable Lua checks passed.
Generated Wasm equals native state for 8 scenes, 61 layers and 76 objects; 3 invalid inputs are
rejected. Wasm SHA256: `313d1adaa823a6695b82adbb5316879b22f53d91685ad36541a74b2962bb223a`.
The renderer's native placement/fidelity completion gates remain unmet; provenance makes the
missing geometry measurable instead of replacing it with invented coordinates.

The staged browser gate passed 18 checks with 150 requests and zero failures. Compared with the
validated previous production capture, `var/outputs/menu-visual/placement-regression/report.json`
records SSIM 1, RGB delta 0 and zero changed pixels. Against the game reference, the renderer
remains at SSIM 0.5578690454315838. Reports and captures stay under `var/outputs/menu-visual/`.

### Published placement batch and exact Linux desktop artifact

On 2026-09-08, host `vps-203bea89`, pushed commit
`ef0602fed33d58c8384615a6fe86203c3fb646fd` passed 66 isolated and 66 public HTTP checks
with zero failures or skips. Production browser validation passed 18 checks, 151 requests and
zero failed requests. The downloaded public Wasm preserved 8 scenes, 61 layers and 76 objects;
3 invalid inputs were rejected. Public/staged captures are pixel-identical. Sources: private
`var/releases/ef0602fed33d58c8384615a6fe86203c3fb646fd/manifest.json`,
`var/outputs/placement-release/`, and `var/outputs/menu-visual/production-ef0602f/`.

The same frozen commit produced an unbundled Linux Inacord artifact using
`bunx tauri build --no-bundle` and `cargo build -p nie-editor --release`. The staged application
rendered 2 VFS root folders, installed its bundled mirror and launched the sibling native editor
through its UI. Hashes and exact-source provenance are recorded in
`var/releases/inacord-ef0602f/manifest.json`; captures are in
`var/validation/inacord-ef0602f/`. Xvfb required software rendering. Deep-link registration and
Windows/macOS installers remain unverified. Selected-asset handoff and persistent project reopen
were exercised separately with the earlier candidate, not relabelled as exact-release evidence.

### Shared editor object operations

The native editor now delegates duplication and removal to `EditorSession`, after completing
the pending interactive transform edit. Selection, capacity validation and undo/redo consequently
use the same library operations as Wasm. On the same host/date, the 6 portable library tests,
strict binary/test clippy and `wasm32-unknown-unknown` check passed. A real Xvfb traversal saved
13 scene states and verified selection, delete/undo/redo, typed-transform history and drag history.
Six actual Wasm states matched the native saved snapshots. Evidence:
`var/validation/editor-operations/{states,wasm-parity}.json` and
`var/releases/editor-operations-candidate/manifest.json`. This is a bounded object-operation
migration; the remaining editor capabilities in P3 are still outstanding.
