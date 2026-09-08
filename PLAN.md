# NIERS — Complete interface delivery in 24 hours

## Outcome and execution clock

This is the sole active execution plan. Execution started on 2026-09-08 at 14:22 UTC
on `vps-203bea89`, from commit `2b7e814a9d773566f0cc0401ebf5e26100b1a0cd`.
The target is 2026-09-09 at 14:22 UTC: 24 consecutive hours, not an automatic pass.
Source: `hostname`, `date -u +%FT%TZ`, `git rev-parse HEAD`, measured on the execution host.

User steering (2026-09-08): focus on implementation now. Suspend intermediate tests, browser
launches and capture runs; perform validation at the end. This overrides the per-family gate
schedule below without changing completion thresholds or authorizing unverified success claims.

Additional user scope (2026-09-08): preload original title music, system effects and imminent
screen assets at startup; load other resources on demand. Wire existing Lua capabilities into
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
gameplay beyond these interfaces remain project obligations outside this delivery window.
Their absence must not be hidden behind fake successful actions. Historical evidence remains
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
- [ ] Opening: separate loading ball/text; original USM logo media with actual readiness/end;
  current autosave resources; PC START artwork, final localized logo and interactive controls.
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
independent Tauri gate when that host changes. Count tests/assertions; zero cases cannot pass.
No `cargo build --workspace --all-targets`; format changed files only. Each evidence record
includes command, host, timestamp, revision, artifact hash, expected and measured results.
Historical test counts must be rerun before becoming current proof.

### H22–H24: Git closure and authorized delivery

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

- Native sprite regions, focus variants and masks use the shared `NativeSprite`/scene-layer
  owner. [Sprite documentation](docs/game-data/native-ui-sprites.md) records source names and
  unresolved mappings. `options-row` is a reusable row template, not the complete PC Options
  screen; its host preference controls do not establish native game-setting behavior.
- Original ACB/AWB metadata, exact named-cue selection, embedded/streaming bank identity and
  HCA loop boundaries now have shared Rust owners and native/Wasm bindings. Startup loads title
  music and system cues; accepted native object commands select effects through decoded
  `SoundCmd` hashes. Complex synthesizer execution, unresolved command hashes and ADX loop
  boundaries remain explicit gaps. No generated artifact equality has been rerun for this code.
- Original G4TX resources are consumed through Rust/Wasm in the active Explorer inspector.
  The shared bounded loader supports demand priority, deduplication and preloading; native byte
  retention is bounded. Logo playback reuses desktop clock synchronization and requires both
  original video and soundtrack resources. Native packet offsets remain unverified.
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
