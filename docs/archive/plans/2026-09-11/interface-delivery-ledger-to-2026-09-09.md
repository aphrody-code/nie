# Interface-delivery ledger — archived 2026-09-11

Moved out of [`PLAN.md`](../../../../PLAN.md) so the plan states the reverse-engineering
workflow rather than a closed UI-delivery sprint. Everything below is **historical evidence**
of the 38-screen interface delivery run on `vps-203bea89` (2026-09-08 → 2026-09-09): its OPEN
rows are still debt, none of its measurements proves anything about the current revision, and
no number here may be promoted to a current claim without being re-measured.

## Preserved interface-delivery ledger

## Historical 38-screen execution context

This preserved workstream started on 2026-09-08 at 14:22 UTC
on `vps-203bea89`, from commit `2b7e814a9d773566f0cc0401ebf5e26100b1a0cd`.
The target is 2026-09-09 at 14:22 UTC: 24 consecutive hours, not an automatic pass.
Source: `hostname`, `date -u +%FT%TZ`, `git rev-parse HEAD`, measured on the execution host.

Historical user steering (2026-09-08) suspended intermediate tests during the bounded interface
rush. That exception is closed by the engine rebaseline above: every new batch again requires
incremental narrow verification before integration or commit.

Additional user scope (2026-09-08), superseded for the browser critical path by the later
performance decision below: preload original title music, system effects and imminent screen
assets at startup; load other resources on demand. Wire existing Lua capabilities into
the site and native sprite sheets into shared presentation/CSS. All game/Criware formats must
ultimately be consumable through native shared decoders using their original VFS identities;
user-requested export conversion is separate from runtime decoding. Existing metadata-only or
partial parsers do not count as complete playback/rendering support. This is an added project
obligation, not evidence that every format is already supported.

Deliver all 38 PC reference states in `data/menu/screen-inventory.json`, including all six
avatar stages, with native resources, faithful presentation, working interface interactions
and shared native/WebAssembly behavior. No omitted references, placeholder substitutes,
fabricated game state, unrelated destinations, WIP commits or uncommitted task-owned work.
Compilation, HTTP availability and global image similarity alone never establish completion.

Full engine reconstruction, exhaustive reverse engineering, new mobile/product surfaces and
gameplay beyond these interfaces were outside that delivery window and are now governed by the
active mission and milestones above. Their absence must not be hidden behind fake successful
actions. Historical evidence remains
in [the previous ledger](docs/archive/plans/2026-09-08/pre-fidelity-rebase.md); it is not an
active plan or current proof.

## Ownership and reuse

Four concurrent lanes: shared Rust/resources, shared presentation, browser integration and
independent audit. Each lane claims exclusive file scope before edits. The browser integrator
owns `PLAN.md`, integration and commits. Audit never certifies its own implementation.

Reuse the existing navigation/history, opening state machine, avatar resolver/editor, native
scene descriptions, `nie-render3d`, shared Explorer, VFS decoders and bitmap fonts. Verify
existing capabilities before replacing them. Keep one library owner per capability:
`nie-formats`/`nie-lua`/`nie-data` for domain behavior, `nie-explore` for catalogue/media,
`asset-source` for host-neutral resources, `inacord-ui` for portable presentation and reducers.
Web, native, HTTP, CLI and MCP remain thin adapters. Preserve public routes, signatures and
compatibility facades until all consumers have migrated with evidence.
See [shared-core ownership](docs/architecture/shared-core-surfaces.md).

## Execution schedule

### H0–H2: establish trustworthy gates

- [ ] Build one acceptance row per inventory reference: identity, resource provenance,
  reproduction inputs, locale, viewport, save/model state, animation time, element regions,
  owner and evidence directory. Unknown observations remain explicit failing requirements.
- [ ] Replace obsolete four-button browser expectations with native action identities.
- [ ] Extend traversal and capture coverage to all 38 references and six avatar stages.
- [ ] Fail on missing captures/resources, unmatched states, empty assertions and visual errors.
- [ ] Extend existing native/Wasm scene, presentation and animation equality fixtures; do not
  build replacement decoders or parallel comparison engines.

### H2–H16: complete screen families in parallel

- [ ] Shared core: resolve current config/Lua/runtime-created objects, fonts/localization,
  geometry, actual player/avatar state and animation playback. Stale settings are not empty UI.
- [ ] Opening inspection surfaces: keep original USM logo, autosave and PC START resources
  available on demand, outside browser startup. The live loading path itself is zero-asset and
  advances directly to the menu only after measured VFS and database readiness.
- [ ] Front menu: `title02` / `title_menu_2_setting.cfg.bin`, eleven native actions, correct order,
  focus/labels/panels/counters and verified destinations. Do not reuse the in-game menu identity.
- [ ] Avatar: all six stages, native model composition, skeletons, materials, colors and stage
  continuity through existing resolver/renderer and shared web/Inacord presentation.
- [ ] Secondary screens: Options (`setting_menu`), controls (`keyconfig_setting_menu`), every
  inventory menu/filter/dialog. Implement shared rows/tabs/selection controls once.
- [ ] Browser: Return, Escape, Back/Forward, reload, direct entry, loading/failure navigation,
  pointer cancellation, keyboard focus, touch, gamepad and held-button guards.
- [ ] Audit each completed family: implement → verify → audit → correct → coherent commit.
  Record reproducible discrepancies and reassign available lanes to the critical path.

### H16–H22: integrate and validate

H16–H20: cross-screen integration and defect correction. H20–H22: full candidate matrix.
No scope trimming, new substitutes or lowered thresholds to fit the clock.

- [ ] 38/38 matched references, six avatar stages, no skipped rows or missing state provenance.
- [ ] Correct assets, text, visibility, focus, model composition and native action identities.
- [ ] Static element position/size errors ≤1 pixel at normalized 1920×1080.
- [ ] Global and static-region grayscale SSIM ≥0.99; RGB mean absolute error ≤2/255
  (equivalently ≤2 on raw 8-bit channels). These are prospective acceptance thresholds.
- [ ] Predeclare dynamic regions and compare at matched state/time; retain unmasked scores.
  No post-failure masks or threshold reductions. SSIM is not proof of pixel identity.
- [ ] Every enabled action tested with applicable inputs; every secondary route tested for
  Return/Escape/history/reload and readiness/failure behavior.
- [ ] Native/Wasm state equality against generated Wasm; rendered time samples for animation.
- [ ] No screenshot-backed screens, substituted native fonts/artwork, diagnostics or identity leaks.

Run narrow Cargo tests/clippy, portable Wasm checks and affected Bun tests/typechecks. Run the
explicit Tauri package gate (`cargo check -p inacord`) when that host changes. The desktop
package joins the root workspace; its platform requirements still need a dedicated gate.
Count tests/assertions; zero cases cannot pass.
No `cargo build --workspace --all-targets`; format changed files only. Each evidence record
includes command, host, timestamp, revision, artifact hash, expected and measured results.
Historical test counts must be rerun before becoming current proof.

### H22–H24: Git closure and authorized delivery

The sole whole-repository release orchestrator is `scripts/release-all.ts`, exposed as
`bun run release:all`. Its immutable phase order is `lint → typecheck → tests → Rust clippy →
build → release/push → deploy → live validation`. Default invocation verifies a clean checkout and
builds into an isolated staging directory only;
all publication and production mutation require explicit `--deploy`. That mode freezes and stages
the candidate tree on `main`, runs every gate/build against it, commits and pushes immediately
before deployment, and verifies the resulting commit equals `origin/main`. Artifact publication
is atomic and rollback-protected; meaningful live payloads and interactions close the pipeline.
This is a delivery mechanism, not a stronger proof level: record the exact gates, counts, host and
commit, and retain semantic review for residual adapter logic. Each command streams to a redacted
durable log under `var/log/releases/<run-id>/`, retained on failure. No build writes through the
live `apps/nie-web/dist` symlink; staged artifacts and rollback binaries stay under `var/releases/`.

The inverse operation is `bun run sync:main`: a dry run unless `--apply` is present. It reconciles
local `main`, `origin/main`, and the VPS by fast-forward only, refuses dirty or divergent source,
and never resets or force-pushes. It restores missing release artifacts in either direction only
from a same-commit manifest with a matching SHA-256, then atomically renames them into place. Every
command is retained under `var/log/sync-main/<run-id>/` for failure diagnosis.

The 2026-09-08 Cargo modernization pins stable Rust 1.98.1 while retaining the 1.97 MSRV, Edition
2024 and resolver 3. Inacord now inherits the workspace version, authors, edition, MSRV, license,
repository and lints instead of remaining the lone Edition 2021 package. Disk-bounded dev/test
profiles keep line-table backtraces, disable incremental caches and provide an explicit
`debugging` profile for full symbols. The release lint phase runs all four `cargo deny` checks.
Compatible lock fixes moved `h2` 0.4.15→0.4.19 (RUSTSEC-2026-0258) and yanked `chacha20`
0.10.1→0.10.2. The no-fix RSA timing advisory inherited through `steamroom` is explicitly scoped
to local Steam authentication in `deny.toml`; it remains dependency debt, not a resolved defect.

The same modernization makes the browser artifact a measured target rather than a side effect.
`nie-explore` host-only VFS modules are excluded from `wasm32-unknown-unknown`; the release
pipeline now checks and clippies that target explicitly. The `wasm-release` profile uses fat LTO,
aborting panics and stripped symbols. Its canonical Bun builder creates `web` glue in temporary
storage, optimizes with Binaryen against the explicit Rust feature set (including SIMD128),
validates and executes a generated-glue smoke test, rejects binaries above 6 MiB, and publishes
only after all checks pass. The first measured optimized module on 2026-09-08 was 3,902,874 bytes,
7% smaller than the post-bindgen input and below the budget.

Two formerly false-green Bun gates are now explicit: Inacord's package invokes
`bun run --cwd ../nie-web typecheck:desktop` so Bun executes the script rather than interpreting
the directory as a command, and `nie-web` tests preload the format plugin, Happy DOM globals and
the mirror test client before DOM suites run. A zero-case or environment-skipped invocation is
still not evidence; record the non-zero test/assertion totals produced by the release candidate.
Measured on the repository execution host on 2026-09-08: `bun run --cwd apps/inacord typecheck`
completed with zero diagnostics, and `bun run --cwd apps/nie-web test` executed 132 tests across
19 files with 689 `expect()` calls, zero failures and the configured DOM preloads visible in the
invoked command. These measurements describe the current worktree, not a committed or live build.

The cold workspace test also exposed cross-host and stale-corpus assumptions. Aphrody's byte-hashed
package descriptors now have explicit LF checkout attributes, so their documented SHA-256 values
match the Git blobs on Windows and Linux. The vibration decoder accepts JSON numbers such as
`250.0` only when they are finite exact integers and maps the decoded unsigned -1 resource-path
sentinel to absence. The shared field helpers now apply that exact-number rule to hashes and
offset/count pairs, while domain string fields normalize the same sentinel only where absence is
their contract. Measured corpus corrections cover notices (38 data/6 info and 47/18/3/9/10/13
post-notice rows), 113 scene archives, 104 soccer effects, 12 team-AI rows, five uniform lists
(1247/627/1075/540/388), 142 name plates, and the expanded route/trigger tables. The RPG status
parser accepts both nested and sibling parameter-list layouts. Focused suites through the final
alphabetical `nie-data` tests and strict `nie-data` clippy pass; the whole release gate must still
replay that result before publication.

The 2026-09-08 startup performance decision removes video, soundtrack, WASM decoding, bitmap-font
rendering and secondary-scene preloads from the browser loading path. That path renders a
zero-asset status surface and advances directly to the menu only when `/api/v1/health` reports a
non-empty content-backed VFS, a served bundle, and successful schema reads from both the main
mirror and episode SQLite database. Legacy logo/autosave/start phases remain demand-only
inspection surfaces and stale browser-history entries cannot restore them into startup.

- [ ] Correct remaining defects, commit all task-owned source/documentation through explicit paths.
- [ ] Verify committed source/artifact hashes against the tested candidate and update this ledger.
- [ ] Preserve the five pre-existing untracked opening captures and all unrelated user changes.
  Clean handoff means zero uncommitted task-owned work, never deleting user files.
- [ ] Distinguish committed, pushed and live-verified delivery. Push/deploy only within explicit
  publication authorization; deploy the exact pushed commit through the existing workflow,
  repeat live interaction/visual checks and retain rollback evidence.

The deadline never converts a failed gate into success. An unresolved in-scope failure means
the one-day target was missed; retain evidence and continue correction without declaring done.

## Reference and evidence rules

The five opening references include Windows chrome: crop `x=1,y=32,w=1920,h=1080` from
1922×1113. Normalize 2560×1440 references proportionally; never distort or silently crop.
Screenshots are comparison oracles only. Keep game payloads, captures and bulk measurements
private in `var/`, outside commits and public bundles.

Resource identities and stale-recipe evidence are recorded in
[the screen inventory notes](docs/game-data/menu-screen-inventory.md). The previous live
baseline at `var/outputs/fidelity-audit-20260908` failed every measured opening/front screen.
Its RGB deltas are raw 0–255 values, not normalized fractions. No historical score proves the
current candidate. Retain native fonts, axes and CRC conventions when migrating callers.

## Acceptance ledger

Inventory command: `bun -e 'const x=await Bun.file("data/menu/screen-inventory.json").json();
console.log(x.entries.map(e=>[e.file,e.screen,e.visual_subscreen].join(" | ")).join("\\n"))'`.
Measured 2026-09-08 on `vps-203bea89`: 38 entries. Every row starts OPEN until independent
visual, interaction, provenance and artifact evidence passes. Evidence belongs under
`var/outputs/interface-delivery/<reference-stem>/`; details must include locale, viewport,
inputs, scene/save/model state, time and measured element regions.

| Reference | Native identity / state | Owner | Acceptance |
|---|---|---|---|
| Capture d'écran 2026-09-08 124431.png | loading01 | shared resources + browser | OPEN |
| Capture d'écran 2026-09-08 124446.png | movie_ie_15th | shared resources + browser | OPEN |
| Capture d'écran 2026-09-08 124451.png | movie_l5logo | shared resources + browser | OPEN |
| Capture d'écran 2026-09-08 124504.png | title_auto_save_info_menu | shared resources + browser | OPEN |
| Capture d'écran 2026-09-08 124519.png | title00 | shared resources + browser | OPEN |
| avatar_edit_clothes.png | kizuna_town_avatar_menu / chara_edit_clothes | shared presentation | OPEN |
| avatar_edit_hair.png | kizuna_town_avatar_menu / chara_edit_hair | shared presentation | OPEN |
| avatar_edit_name.png | kizuna_town_avatar_menu / chara_edit_name | shared presentation | OPEN |
| avatar_edit_stats.png | kizuna_town_avatar_menu / chara_edit_stats | shared presentation | OPEN |
| avatar_edit_style.png | kizuna_town_avatar_menu / chara_edit_style | shared presentation | OPEN |
| avatar_edit_top.png | kizuna_town_avatar_menu / avatar_edit_root | shared presentation | OPEN |
| bank_character_detail.png | chara_bank_menu / character_detail | shared presentation + browser | OPEN |
| character_detail_hamano.png | chara_bank_menu / character_detail | shared presentation + browser | OPEN |
| chronicle_map.png | chronicle_mode_top_menu / chronicle_map | shared presentation + browser | OPEN |
| chronicle_mode.png | chronicle_mode_top_menu | shared presentation + browser | OPEN |
| chronicle_shop.png | shop_menu / chronicle_shop | shared presentation + browser | OPEN |
| controls.png | keyconfig_setting_menu / controller_settings | shared presentation + browser | OPEN |
| event_calendar.png | advent_calendar_menu | shared presentation + browser | OPEN |
| filters_appearance.png | chara_bank_menu / filter_appearance | shared presentation + browser | OPEN |
| filters_bonus.png | chara_bank_menu / filter_bonus | shared presentation + browser | OPEN |
| filters_elements.png | chara_bank_menu / filter_elements | shared presentation + browser | OPEN |
| filters_foot.png | chara_bank_menu / filter_foot | shared presentation + browser | OPEN |
| filters_position.png | chara_bank_menu / filter_position | shared presentation + browser | OPEN |
| filters_rarity.png | chara_bank_menu / filter_rarity | shared presentation + browser | OPEN |
| filters_team.png | chara_bank_menu / filter_team | shared presentation + browser | OPEN |
| filters_team_role.png | chara_bank_menu / filter_team_role | shared presentation + browser | OPEN |
| formation_presets.png | soccer_formation_menu / formation_preset_selector | shared presentation + browser | OPEN |
| formation_select.png | soccer_formation_menu | shared presentation + browser | OPEN |
| main_menu.png | main_menu | shared presentation + browser | OPEN |
| main_menu_alt.png | title_menu_2 | shared presentation + browser | OPEN |
| options.png | setting_menu | shared presentation + browser | OPEN |
| pause_controls.png | pause_menu | shared presentation + browser | OPEN |
| player_roster.png | chara_bank_menu / character_roster | shared presentation + browser | OPEN |
| player_skill_tree.png | ability_learning_board_menu | shared presentation + browser | OPEN |
| player_universe.png | players_universe_menu | shared presentation + browser | OPEN |
| shop.png | shop_menu | shared presentation + browser | OPEN |
| story_mode.png | story_mode_top_menu | shared presentation + browser | OPEN |
| trophy_gallery.png | gallery_menu | shared presentation + browser | OPEN |

## Measured batch ledger

Execution baseline inspected; no current fidelity acceptance claimed. Append measured batch
results here with commands, counts and commit references after verification.

### Shared loading and input batch — 2026-09-08

Measured on `vps-203bea89`, 14:25–14:31 UTC, against the execution-baseline worktree:

- Shared loading now uses the existing Rust scene ABI; browser geometry duplication removed.
  Scene metadata validation rejects unusable focus/masks, empty provenance and invalid colors.
- Avatar name/height focus and gamepad height adjustment are interactive; the persistent host
  sampler preserves held-button edges across menu/avatar mounts. Secondary and Explorer Escape
  honor editable fields, consumed events and modal dialogs before returning directly to menu.
- `cargo test -p nie-formats --lib --features serde`: 329 passed, 0 failed, 1 ignored.
  Focused presentation suite: 8 passed. Clippy (`--lib --tests --features serde -- -D warnings`)
  and portable wasm32 check pass. The ignored test is not evidence of a passing assertion.
- `bun apps/nie-web/scripts/build-wasm.ts` succeeds. Existing native presentation equality gate:
  10 distinct scenes, 6 real-font multilingual runs, 4 invalid inputs rejected. Three additional
  CLI negative fixtures (missing loading, duplicate scene, missing loading text) each exit 1.
  Wasm SHA256: `ae34d528dd1bffe505dd49439ccb56b8412342e202624611020b4b4f73db3847`.
- `bun run typecheck` in `apps/nie-web`: pass, zero diagnostics. Combined targeted Bun run:
  41 tests / 286 assertions / zero failures across opening, mounted navigation, secondary shell,
  Explorer, native menu, avatar, acceptance policy and image metrics.
- Candidate native-menu traversal: 57 checks pass, 2 fail (favicon 404 and 10 missing native
  destinations). Visual gate: global SSIM 0.804719379, raw RGB MAE 27.932512539/255; FAIL.
  Element coverage remains unmeasured. Private evidence: `var/outputs/interface-delivery/`.
- No screen is accepted from these engineering gates. Loading motion/localization provenance,
  secondary screen implementations, avatar native registration and visual/model parity remain open.

### Source implementation after the code-only steering — 2026-09-08

These entries describe source changes awaiting final gates. They do not replace the historical
counts above or accept any reference row.

- User-directed consolidation adds `apps/inacord/src-tauri` to the root Cargo workspace.
  Default members retain the headless crate selection; explicit workspace gates also include
  the desktop package. SQLite driver convergence and the unified lockfile are required before
  this source migration can pass. No dependency resolution or build is claimed yet.
- `apps/nie-web` owns frontend root mounting and Vite configuration for browser and desktop
  modes. Inacord package commands delegate to it; Tauri consumes `dist-desktop`, while the site
  retains `dist`. Desktop UI source moves under `apps/nie-web/src/desktop`; the original
  Inacord entrypoints remain thin compatibility facades. Existing desktop functionality
  remains in its host adapter during migration.
  A common build is not evidence that all desktop tools work over HTTP or that the game is
  complete. Shared Explorer reducers, navigation notifications and primitive facades are reused.

- Native sprite regions, focus variants and masks use the shared `NativeSprite`/scene-layer
  owner. [Sprite documentation](docs/game-data/native-ui-sprites.md) records source names and
  unresolved mappings. `options-row` is a reusable row template, not the complete PC Options
  screen; its host preference controls do not establish native game-setting behavior.
- Original ACB/AWB metadata, exact named-cue selection, embedded/streaming bank identity and
  HCA loop boundaries now have shared Rust owners and native/Wasm bindings. After the menu is
  visible, the audio owner loads title music and system cues; accepted native object commands
  select effects through decoded `SoundCmd` hashes. Complex synthesizer execution, unresolved
  command hashes and ADX loop boundaries remain explicit gaps. No generated artifact equality
  has been rerun for this code.
- Original G4TX resources are consumed through Rust/Wasm in the active Explorer inspector.
  The shared bounded loader supports demand priority, deduplication and preloading; native byte
  retention is bounded. Logo playback remains a demand-only inspection surface: it reuses desktop
  clock synchronization and requires both original video and soundtrack resources. Native packet
  offsets remain unverified.
- Lua replay is mounted through a shared bounded VFS session and thin site/browser adapters.
  Front-menu callbacks use native layer/item identities. Replay completeness is separate from
  engine, geometry, save-state and visual equivalence.
- [Desktop/site capability inventory](docs/architecture/desktop-site-capabilities.md) records
  existing owners and the added Criware metadata, optional export, growth interpolation,
  declared resource relationships and motion-inspection routes. Complete Azalee joined-data,
  service and desktop behavior parity is not claimed.
- Git observation: `9365ea7e` appeared during concurrent work (source: `git log`/`git status`
  on the execution host). The integrator and its agents did not create that commit. It also
  tracks the five opening captures that were untracked at execution start. Preserve the current
  history and user files; no publication of those captures is authorized by this task.
- Final work still includes rebuilding generated Wasm/bindings, verifying native/Wasm and
  desktop contracts, running the release matrix, correcting failures and committing the
  remaining task-owned changes. The 38-row acceptance ledger remains OPEN.

## Shared 3D presentation ownership — 2026-09-08

Decision: `packages/inacord-ui/src/three` owns application 3D presentation. The mature Inacord
`Viewport3D` is the canonical editor/scene viewport; existing editor and VFS/CPK preview callers
retain compatibility bindings with injected byte decoding. Multi-asset scenes, picking,
outliner/statistics, TRS gizmos, grid, wireframe, camera controls and GPU cleanup are retained.

Azalee gallery/detail viewers now delegate their duplicated custom-element lifecycle to
`ModelViewerSurface`, retaining visibility suspension, dialog/inline composition, downloads,
rotation/shadow settings and the existing host loader's local compressed-model decoders.
The optional, currently unmounted character renderer has moved to the same library owner with
its old import facade preserved. The native Rust avatar renderer remains the distinct game
reconstruction backend; this change does not claim renderer parity or completed animation playback.

Validation for this batch is recorded after the final scoped checks. No browser was launched.

Scoped 3D verification on 2026-09-08: shared UI and desktop TypeScript checks passed after
installing the moved Three dependency under its library owner. The independent
`bun test packages/inacord-ui/src/three/ModelViewerSurface.test.tsx` gate passed 6 tests with
31 assertions, covering stale loads, listener ordering, source changes, visibility teardown,
reopening and HTTP cancellation. The first Azalee check exposed its missing direct shared-UI
dependency; that dependency was added and the consumer check rerun. Visual/rendered parity is
not asserted by these lifecycle and type checks.

Final consumer checks for the shared 3D extraction: Azalee, shared UI and desktop TypeScript
checks all passed (three scoped commands). Dependency ownership passed 1,636 assertions over
31 Bun manifests, 395 Bun declarations, 42 Rust members and 445 Rust declarations. Counts were
measured with `bun run check:dependencies` in this checkout on 2026-09-08. The coherent source
batch includes its prerequisite frontend relocation, workspace/catalog convergence and SQLite
host adapter; remaining game reconstruction changes stay separate. Publication is not performed.

## Gallery convergence and localized resource identities — 2026-09-08

The shared gallery now combines Inacord's VFS categories, bounded thumbnails, full-resolution
viewer, adjacent-image cache, PNG export and explorer actions with the reused Azalee card and
controlled filter presentation. `apps/nie-web` mounts that same gallery through HTTP adapters
from the media catalogue, retaining the file listing and other media views. SQL metadata and
manifest resources in the legacy wiki service now form one deduplicated inventory for both
list pagination and category counts; semantic categories and native folders remain separate
facets. Existing cinema/profile/playback components remain intact; this does not certify full
cinema-host migration.

Names are display metadata, never rewritten VFS keys. The shared reactive resolver includes
source and locale in its cache identity, publishes completion to concurrent consumers and
permits remount retries after transient errors. Desktop explorer/details/properties and the
shared gallery display localized names with exact IDs. Browser explorer, catalogue and gallery
use `/api/v1/wiki/names`; original paths and file codes remain available. The Rust `nie-wiki`
owner joins exact internal/asset codes for characters, skills, items, teams, keshins and souls,
retains multiple matching identities and reports unresolved codes and unavailable families.
The requested language is preferred, followed by available mirror translations and the exact ID.

Remaining explicit localization work: no proven native text-CFG join currently supplies stadium
names, story-moment labels or every media-folder category. Existing hand-written category labels
must not be reported as native CFG localization. Complete these joins from actual resource/hash
relations before claiming the user's full naming matrix. No fabricated file-code inference,
player unlock state or native text hash has been introduced.

Scoped validation: collection union/filter/count tests passed 7 cases with 33 assertions;
shared name-resolver tests passed 8 cases with 37 assertions. Shared UI, desktop and Azalee
TypeScript checks passed; browser typechecking also passed after its adapter syntax correction.
The Rust gallery query passed 4 tests and name query passed 5 tests, including incomplete-schema
isolation and malformed-value errors. Native wiki clippy passed after the final correction;
site compilation passed with existing warnings, not a clean site clippy result. No browser or
publication was performed.

## Native text and game-data surface — 2026-09-08

The browser media surface now exposes a text explorer backed directly by the existing
`/api/v1/text` owner. It lists the measured families available in the selected game VFS language,
loads a selected family through the paginated native decoder, filters within that family, and
shows each rendered text with its hash and source VFS file. It therefore exercises the real
`data/common/text` corpus without adding a JavaScript copy, collapsing repeated hashes, or
claiming that every game-data relation is named.

`nie-data::text` currently documents 45 canonical text family names. The text API publishes
the actual discovered language/family corpus and keeps duplicate hash occurrences distinct.
Its narrow parser gate passed 14 tests. The browser TypeScript check passed after adding the
surface. Mapping every game-data table to a text-family/hash remains progressive work: new
relations must be established by the owning decoder and native schema, then made visible through
the shared resolver; they must not be guessed from filename prefixes.

`packages/inacord-ui` now owns the native-text contract. It resolves only an exact measured
`(gameLocale, family, hash)` reference through the VFS endpoint, keeps the source VFS file and
does not silently select among repeated hash occurrences. `gameLocale` is separate from the
three public page-route locales: it supports all VFS locale identifiers used by game resources
(`de`, `en`, `es`, `fr`, `it`, `ja`, `ko`, `pt`, `zh_hans`, `zh_hant`). Text availability remains
measured independently because a locale can have localized assets without a corresponding text
family. Browser names and
the shared gallery use that resource locale. The surrounding Inacord authoring shell still has
authored tool text; it must not be presented as native game localization until a proven VFS or
game-data text reference replaces it.

The same locale rule applies to non-text resources. The shared asset-source contract now exposes
the Rust VFS companion resolver for declared logical paths, including `<LG>` texture/font paths.
It returns the exact selected VFS path or `null`; client CSS and JavaScript do not construct a
locale directory or silently substitute a French asset. Existing fixed-path consumers remain
migration work until their native declaration is routed through this resolver.

## Cross-surface shared-code proof — 2026-09-08

The requested invariant is that portable domain behavior has one library owner consumed by the
site/backend, CLI, Inacord and MCP. Transport and OS integration remain explicit adapters; sharing
their Axum, Clap, MCP or Tauri plumbing would be neither meaningful nor safe. The first executable
source audit is `crates/tools/audit-shared-surfaces.sh`; its strict mode is the completion gate and
currently fails, so full convergence is not claimed.

The audit proves that the standalone `nie-mcp` executable enters the importable `nie-cli` library
in-process and that both surfaces share command parsing and dispatch. It also records shared engine
dependencies across the other hosts. Independent adversarial inspection found concrete remaining
violations: duplicated icon/mode aggregation between CLI and site, copied T2B conversion and joined
game-data policy in the Tauri host, a generic SQLite query engine owned by an HTTP route, a divergent
TypeScript GLB decoder, and geometry/atlas aggregation owned by site routes. Host-only filesystem,
process, clipboard, updater and mutation operations are separately classified and are not required
on the public site.

Acceptance requires a canonical capability manifest, one importable owner for every portable row,
thin adapter tests for each exposed surface, and normalized fixture equality across CLI, HTTP,
Tauri, MCP and Wasm where applicable. The strict audit must reach zero failed invariants and the
applicable non-zero Cargo/Bun/interaction gates must pass. The next extraction target is the copied
T2B conversion in `apps/inacord/src-tauri/src/game_data.rs`, followed by the route-owned SQLite
query engine and the browser GLB decoder.

The first extraction is complete: `nie-explore::bridge::t2b_value_to_json` is now the public
canonical scalar conversion, Inacord imports it directly, and the copied Tauri implementation is
deleted. Its String/Int/Float fixture passes one focused test; strict `nie-explore` clippy passes,
and `cargo check -p inacord --locked` passes with one pre-existing `nie-render3d` unused-import
warning. The executable audit improves from seven to six failed invariants. The full goal remains
open; the next owner extraction is the generic SQLite engine currently inside the HTTP route.

The generic SQLite catalogue/query engine is now owned by `nie-wiki::entities`; the site retains
Axum handlers, dataset selection, CSV rendering and error translation. Every execution remeasures
the selected table against the live connection and revalidates all interpolated identifiers. Raw
SQL clause builders are private and SQLite error display is sanitized. The owner passes 29 tests,
including five independent schema/query/facet/blob/injection/error fixtures; the site adapter
passes 33 tests with one real-mirror fixture ignored.

Menu icon discovery and indexing now has one `nie-explore::menu_icons` owner consumed by CLI and
site adapters. Texture and sub-region placeholder rules remain distinct to preserve the historical
`width <= 4` region exclusion. Two owner tests and one adapter test in each consumer pass. The
executable ownership audit now reports three failed invariants, down from six: mode analysis, the
browser TypeScript GLB decoder, and site-owned geometry dispatch. Strict completion therefore
remains open.

### Proof reset and exhaustive delegation ledger — 2026-09-08

The earlier green result based only on assigning an owner pathname was rejected: a thick adapter
could mention a library once and still pass. The generated ledger now enumerates every authoritative
entry point — 41 CLI commands, 19 MCP tools, 163 Tauri commands and 106 site method/routes — and
records one of three boundaries: portable behavior with a library owner, a native host operation,
or protocol/presentation transport. A capability deliberately absent from a surface is
`not-exposed`, never mislabeled `host-only`.

The measured 329-entry disposition is 222 portable, 56 host-only and 51 transport entries. Portable
Tauri entries carry a function-level call chain discovered from the registered handler through its
helpers to the `nie-*` owner; the validator checks every source/needle hop. The master
`audit-shared-surfaces.sh --require-complete` now invokes this exhaustive validator, so the old
heuristic audit cannot publish a standalone false green.

This convergence batch moved the remaining portable policy found by adversarial review:

- CLI `SeedUi`, `Avatar`, `MenuPredecode`, `Vn`, `Rebuild` and `Recover` now delegate respectively
  to `nie-seed`, `nie-data`, `nie-explore` and `nie-re`; Clap, VFS/file I/O, decoding and terminal
  rendering remain adapters.
- MCP VFS list/search/stat/cat/asset behavior is owned by `nie-explore::mcp_vfs`; RE reports are
  owned by `nie-wiki::query`. MCP retains bounded arguments and transport DTOs.
- Tauri VFS statistics/metadata and Lua script listing delegate to `nie-explore`; save-blob
  inspection delegates to `nie-save`. Native state, locks, base64 and IPC errors remain Tauri.
- Site updater selection, episode-feed query/date policy, VFS path/MIME policy and public coverage
  sanitization now have non-route owners; Axum, cache, Atom/HTML and response mapping remain HTTP.

The machine-readable proof level is deliberately named `source-delegation`. It proves registry
exhaustiveness, owner existence and concrete call-chain evidence; it is not a formal proof that no
portable statement remains in an adapter. That stronger conclusion always requires semantic review.
This batch received an independent adversarial review, including rejection of the premature green,
five thick Tauri adapters and seven thick MCP adapters before their extraction. Future changes must
keep both the generated ledger and that review boundary; a passing substring search alone is not an
architecture claim.

## Rust IEVR ownership and destructive cleanup — 2026-09-09
The legacy IEVR package graph is deleted. `apps/azalee`, `packages/azalee`,
`packages/azalee-tools`, and the Victory Road Inagle package are absent from the checkout and
Bun lockfile. `packages/inagle-cross` remains a separate Unity game schema with no Victory Road
dependency.

The native ownership path is:
`VFS / nie.exe / verified zukan` → `nie-formats` and `nie-data` → `nie-core` and
`nie-wiki` → `nie-cli`, `nie-site`, MCP, and Inacord Rust IPC.

MCP wiki tools call the Rust `nie-ffi` JSON boundary. The Rust site and CLI call `nie-wiki`
directly. The desktop UI uses native Tauri IPC for VFS and local mirror access; remote GraphQL,
remote CPK search, and remote roster resolution are removed. The mirror is read-only at runtime,
with no Supabase/PostgREST dependency in the IEVR path. `inagle_*` table names remain only as
the verified snapshot schema contract, not as a TypeScript package owner.

The desktop wiki boundary is native as well: Tauri `wiki_query` dispatches named operations into
`nie-wiki`, while the webview keeps only DTO contracts and localization. The former desktop
TypeScript SQL module and migration validator are deleted. Blender searches call `niers.exe`, and
menu predecode scans indexed VFS textures directly instead of requiring deleted Azalée layouts.
Dump presets are the English Rust-owned `wiki`, `assets`, and `full` choices.

The obsolete `@niers/catalog` Bun facade and the disconnected `apps/nie-bot` copy are also
deleted. VFS URL conventions moved to `@niers/asset-source`; the remaining Bun surface is a
transport/presentation adapter and no longer owns an `inagle_*` query or join.

Completion gates:
1. zero active imports or package references to the deleted IEVR packages;
2. no deleted application paths in deployment, installer, cron, or runtime code;
3. Rust wiki/site/FFI checks and Bun adapter checks pass;
4. root `data/` and `var/` remain intact and generated game dumps are not added.

Measured locally on 2026-09-09: MCP tests 98/98 passed with 737 assertions; the native FFI
round-trip passed 24 tests with 163102 assertions; `nie-wiki` passed 47 tests; `nie-site` passed
318 library tests and 25 route tests with 1 ignored integration test; `nie-viola` passed 51 tests;
`nie-ffi` build and strict clippy, `nie-cli` strict clippy, `nie-model-serve` check, Inacord check,
and the MCP, cron and web typechecks passed. No deployment or live-production validation was
performed.

## WebGPU and avatar lifecycle stabilization slice — 2026-09-09

The browser WebGPU owner now records device loss and uncaptured errors in one terminal viewer
fault, requests only adapter-supported limits, and explicitly destroys obsolete buffers, textures,
render targets and the device. Bind groups and pipelines remain RAII handles because wgpu 29 has
no explicit destruction operation for them. Camera uniforms use one retained buffer and a
`StagingBelt` in `write -> finish -> submit -> recall` order. Adjacent primitives sharing a texture
are merged without reordering and materialized one CPU batch at a time; this is draw batching, not
instanced rendering, and no performance improvement is claimed without a browser trace.

Web GLB input remains bounded at 64 MiB and now has a separate 128 MiB aggregate decoded-RGBA
budget checked from PNG headers before decoder and final texture allocations. Replacement models
release the previous GPU allocation before upload, reject unusable geometry, and keep the previous
presented canvas visible until the new HTTP response is validated, uploaded and rendered. The
shared Three.js compatibility viewport deduplicates disposal of geometry, material, texture,
skeleton bone texture and bitmap resources, clears render lists, and releases its WebGL context.

The browser compiles the immutable Wasm module in a one-shot module worker where policy permits,
with a tested main-thread fallback. This does not move WGSL pipeline creation or rendering off the
main thread; that requires an `OffscreenCanvas` worker ABI. The opening sequence no longer exposes
the `Reprendre` control: an autoplay-rejected opening retries on the next user gesture, while media
preview keeps an explicit local play control. The Rust avatar resolver and WebGPU model viewport
remain the active browser path, and model replacement preserves the user's camera.

Measured on host `vps-203bea89` at 2026-09-09T05:53:34Z: `nie-render3d` passed 30 library tests;
native and wasm32 strict clippy passed; the `nie-wasm` wasm32/WebGPU check passed; shared UI passed
64 tests with 316 assertions and its TypeScript check; browser tests passed 142 tests with 710
assertions and its TypeScript check. A production-mode Vite build transformed 2,068 modules and
emitted the dedicated 672-byte worker chunk. The canonical Wasm build published 4,000,663 bytes,
SHA-256 `ad51147b2047910086531854875c93dc640bb6605bad5e9959e30af7c5ee91fe`, after all Rust source
changes. Formatting and scoped whitespace checks passed.

The full stabilization objective remains open. Chrome 147 automation on this host exposes only
Google SwiftShader, so it cannot prove hardware VRAM behavior, sustained frame pacing or recovery
under injected hardware device loss. Required next evidence is the bounded stress matrix: 1,000
representative model swaps, 200 resizes, 100 mount/unmount cycles, a deterministic device-loss
recreation test, draw-call measurements, and p95 interaction latency on named GPU hardware.
Dynamic mipmaps, true repeated-geometry instancing, OffscreenCanvas/WGSL worker rendering,
complete asset dependency coverage, pose/animation controls, and an authenticated/version-guarded
native Live Bridge with a verified avatar memory schema are also not implemented. The current
Explorer bridge must not receive process-memory write commands.

## Independent production target pipeline — 2026-09-09

`bun run deploy:target -- <target>` is the only narrow production entrypoint. Builds are staged
before this boundary; the target pipeline validates and publishes them. Each target has an
independent hard deadline of 60 seconds and writes a commit-bound manifest under
`var/deployments/targeted/`, installs its tracked systemd unit when needed, restarts only its own
process, and requires a meaningful local or public health response. `--all` attempts every target
and reports all failures instead of hiding later targets behind the first failure.

The maintained targets are the Rust FFI, native CLI, standalone Rust stdio MCP, validated
WebAssembly module, browser shell, Rust model server, Rust site, cron, IEVR CDN variants,
realtime, and storage. Libraries
deploy through these
owners rather than being published as independent services. The former public Bun MCP unit is
deleted from the repository and remains masked on the host because the supported transport is
native Rust stdio. The editorial `rg-cdn` unit is not a target: its source and unit are owned by
the clean `/home/ubuntu/rg` checkout. The stale NIE copy is deleted and production must use the
external owner's working directory.
