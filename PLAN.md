# NIERS — Reconstruct the game engine that produced `nie.exe`

## Product direction — two complementary delivery goals

The latest user direction preserves both supplied visual references as distinct goals:

1. **Inacord is the primary application UI.** Preserve its existing features, components,
   explorer, editor, navigation, inspectors and tools while converging browser and desktop
   adapters on their shared implementations. Redesign this functional surface with the game's
   real icons, colors, fonts and individually decoded artwork as its principal theme. Preserve
   resource names, slugs and VFS paths in the asset contracts so every themed element remains
   traceable. Do not replace the mature application with a reduced explorer or menu demo.
2. **The native game UI remains a separate reconstruction target.** Retain its layouts, scene
   contracts, Lua state, resource resolution and interactions for the shared backend, mod
   authoring and production of a new `nie.exe`. The main-menu reference remains a comparison
   oracle, never a full-screen runtime texture.

Both goals reuse the same format decoders, VFS, resource loaders and domain libraries. A theme
change must retain every existing application capability; a native-menu reconstruction must not
be reported as completion of the Inacord application. Missing resource mappings remain explicit
work items, not guessed icon substitutions. Perform interaction and visual validation after the
source implementation phase, as requested by the user.

## Active mission — 2026-09-08 rebaseline

The project mission is now the measured reconstruction of the engine that produced `nie.exe`,
not a collection of parallel viewers or a generic replacement engine. The exact executable forge
and the playable Rust runtime are two independent proof axes for the same engine:

- **binary provenance:** increase the fraction of `nie.exe` emitted from maintained repository
  sources while `dist/nie.exe` remains byte-identical to the 33,918,464-byte reference with
  SHA-256 `b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`;
- **functional reconstruction:** move observed formats, scene state, animation, rendering, Lua,
  input, audio and gameplay behavior into reusable Rust libraries shared by native, headless and
  WebAssembly hosts;
- **authoring:** turn the existing Inacord viewport and scene document into a persistent editor
  for those shared engine contracts rather than a second TypeScript engine;
- **interoperability:** add GLB/VRM and VTubing adapters only after their required engine
  primitives exist and can be validated independently.

The 38-screen delivery ledger below remains active evidence and debt. It is no longer a standalone
24-hour product target: each screen is now a functional engine fixture for menu/Lua/resource/input
reconstruction. Its OPEN rows cannot be silently dropped or treated as proof of engine parity.

### Definition of done

The mission is complete only when all of the following are simultaneously measured:

- the forge builds the target executable without reading the reference during `build`, its hash is
  exact, and 100% of bytes have repository-owned provenance; `semantic` matches never count as
  produced bytes;
- the maintained Rust engine can reproduce the observed game state transitions and render the
  required native assets through the same library contracts in native, headless and WebAssembly
  hosts;
- Inacord persists and reopens editable scenes without state loss and remains a thin client of the
  shared engine and asset libraries;
- every unsupported format, native behavior and reverse-engineering fact remains an explicit open
  ledger item with reproducible evidence.

### Continuous execution loop

Every iteration follows one auditable sequence:

1. Re-measure the current forge and functional baselines; never promote historical counts to
   current proof without rerunning them on the named host and revision.
2. Select the highest-yield concrete blocker from `nie-forge lift --top 0`, `nie-forge
   candidates --no-reloc`, the RE knowledge base, or a failing functional fixture.
3. Implement the capability in its single owning library and preserve compatibility facades.
4. Run narrow tests and clippy, then the applicable byte-exact build, native/Wasm equality,
   rendering, interaction or round-trip gate.
5. Obtain an independent adversarial audit, correct findings, commit the coherent batch, update
   this ledger with exact counts and continue to the next measured blocker.

### Workstreams and ownership

| Workstream | Existing owner to extend | Current baseline | Next acceptance gate |
|---|---|---|---|
| Exact PE production | `nie-pe`, `nie-asm`, `nie-forge`, `forge/asm` | Last replayed 2026-09-03: 74.0033% file provenance, 92.2595% `.text`; must be rerun | Fresh `split/lift/build/verify/report`, identical SHA-256, blocker totals recorded |
| Reverse-engineering knowledge | `nie-re`, `nie-index`, `nie-seed`, `nie-trace` | RTTI, vtables, functions and domain mapping exist | Every forge unit joined to evidence; false-code/data boundaries reduced without teaching impossible instructions |
| Formats and assets | `nie-formats`, `nie-data`, `nie-explore` | VFS/CPK, G4 families, textured/skinned GLB assembly and avatar composition are partial but real | Counted corpus with parse, dependency and export assertions; unresolved semantics explicit |
| Runtime and gameplay | `nie-core`, `nie-app`, `nie-runtime`, `nie-lua` | Deterministic match/menu fragments and Lua host exist; not a complete engine | Recorded state replay equality across headless/native/Wasm with real assets and inputs |
| Rendering and animation | `nie-render3d`, `nie-game`, `nie-camera` | CPU/wgpu renderers and cameras exist; renderer still lacks complete node/skin/morph/animation evaluation | Sampled pose/render fixtures at declared times, GPU budgets and native/Wasm scene equality |
| High-level editor | `nie-render3d::document`, `inacord-ui`, `apps/nie-web`, Tauri adapter | Multi-asset viewport, picking, outliner and session-only gizmos; scene v1 is limited | Versioned persistent scene, full hierarchy/TRS, undo/redo, save/reopen/export equality |
| VRM and VTubing | engine libraries first; dedicated tracking library only when shared contracts are stable | `three-vrm` dependency and transparent window capabilities exist, but no runtime VRM/VMC/tracking implementation | Licensed VRM 0/1 validation, deterministic VMC replay, measured retarget/render latency and OBS capture matrix |

### Ordered milestones

- [ ] **M0 — trustworthy fresh baseline:** preserve the current dirty migration, inventory its
  ownership, locate the user-provided reference and forge state, rerun forge measurements where
  available, and record host/revision/commands. Do not start an encoder change from the stale
  2026-09-03 ranking.
- [ ] **M1 — exact-code frontier:** reduce the freshly measured highest-mass genuine instruction
  and encoding blockers; separately improve false-code/data segmentation. Each batch must increase
  provenance, retain exact SHA-256 and add round-trip encoder tests.
- [ ] **M2 — canonical scene and animation:** migrate `SceneDocument` to stable identities,
  hierarchy and full TRS; evaluate node transforms, skins, morph targets and animation through one
  deterministic pose contract consumed by CPU/wgpu/WebGPU renderers.
- [ ] **M3 — reconstructed runtime:** connect observed Lua, resource lifecycle, input, audio,
  cameras, menu and gameplay state to that scene/animation core. Convert the 38 screen rows and
  gameplay captures into timestamped deterministic fixtures.
- [ ] **M4 — authoring:** persist editor projects, command transactions, undo/redo, prefabs,
  component inspection, animation timeline and edit/play isolation. No UI may own canonical engine
  state or implement a second decoder.
- [ ] **M5 — validated interchange:** provide semantic GLB export/reimport first, then VRM 0/1
  humanoid, expressions, look-at, spring bones, MToon metadata and licence preservation. A skinned
  GLB is not called VRM.
- [ ] **M6 — VTubing surface:** add normalized timestamped tracking frames, VMC/OSC transport,
  a separate OpenSeeFace UDP adapter, calibration/filtering/retargeting, record/replay and a
  dedicated Tauri output window. OBS alpha/chroma support is claimed only per tested OS/capture
  path.
- [ ] **M7 — closure:** 100% repository-owned byte provenance, complete required functional
  fixture matrix, distributable native/web engine hosts and editor, with no hidden unresolved
  reverse-engineering facts.

### Immediate iteration queue

1. Stabilize and attribute the in-progress Inacord/`nie-web` consolidation already present in the
   worktree; do not overwrite or duplicate it.
2. Re-establish a fresh forge baseline and regenerate the full blocker/candidate reports.
3. Choose the first implementation batch solely from those fresh counts, with an adversarial lane
   checking that apparent x86 instructions are not inline data.
4. Wire the format-neutral G4MT decode result into the canonical `nie-core` pose contract through
   an explicit runtime adapter, then prove one real fixture reaches a pose-driven renderer without
   inventing unresolved bones.
5. Extend the bind-pose GLB import slice to consume sampled `PoseFrame` values (CPU first), with a
   golden silhouette/vertex fixture before attempting GPU or Wasm parity.

### Engine loop ledger — 2026-09-08

#### M0 fresh forge baseline

Measured on `vps-203bea89` from the current dirty integration worktree. The target symlink resolves
to the user-owned Steam executable at `/home/ubuntu/.local/share/Steam/iecode/inazuma/nie.exe`;
its measured size is 33,918,464 bytes and SHA-256 is
`b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`.

- `nie-forge split --exe nie.exe`: 104,231 submitted boundaries, 69,398 retained, 34,833
  crossing boundaries rejected, 203 indeterminate, 1,335,889 inline-data bytes across 3,536
  units, 1,271,468 code bytes released, 215,688 total units, 56,533 function units, 1,673,867
  residual `.text` bytes, zero gaps and zero overlay.
- `nie-forge lift --exe nie.exe --top 0`: 107,912 bodies scanned, 105,230 lifted,
  22,512,913 assembled bytes, ratio 0.9751; 207 blocker causes, 2,013 units and 1,321,048 bytes
  remain. The leading fresh blockers are `encodage:add` (55 units/45,605 bytes), `extractps`
  (25/45,482), `vmovdqu` (38/45,150), and likely false-code `in` (41/44,973).
- `nie-forge report`: 73.825236% file provenance and 92.119725% `.text` provenance. These values
  supersede the 2026-09-03 percentages for current planning but do not imply a regression in
  source capability: the recovered boundary population and forge artifacts differ materially.
- `nie-forge build --exe nie.exe`: 209,340 repository-produced units, 25,040,386 bytes, zero
  rejected units; `dist/nie.exe` is 33,918,464 bytes and byte-identical with the target SHA-256.

M0 remains open until the current integration worktree is attributed and committed coherently,
but the forge itself is reproducible again. The first M1 batch is the freshly observed redundant
REX-prefix encoding family; its acceptance requires a post-change lift/report delta and the same
exact build hash, not only unit tests.

#### M1 redundant REX on register `mov` — implemented, awaiting coherent commit

The assembler now preserves an explicit null REX prefix through the non-breaking `MovRRRex` and
`MovRRmRex` variants. Text round-trips use canonical `mov.r` and `mov.d.r`; the lifter finds REX
after legacy prefixes such as `66` and restricts this preservation to the validated 32-bit low
register forms. Existing public `MovRR`/`MovRRm` signatures remain intact.

- `nie-asm`: 24 library tests and 1 doctest pass; strict library/test clippy passes.
- `nie-forge`: 34 library tests and 2 integration tests pass; strict library/binary/test clippy
  passes.
- Post-change lift: 105,231 bodies and 22,513,296 bytes, up **1 body / 383 bytes**; blockers fall
  from 2,013 units/1,321,048 bytes to **2,012 units/1,320,665 bytes**. The previous
  `encodage:mov` top blocker is absent from the top 20, but a full cause-specific zero count is not
  yet claimed.
- Post-change report: **73.826365%** file provenance and **92.121292%** `.text`, increases of
  0.001129 and 0.001567 percentage points respectively.
- Post-change build used the generated source in tmpfs because the workspace filesystem had only
  123 MiB free. It produced 209,341 units / 25,040,769 bytes, rejected zero units, and emitted a
  33,918,464-byte executable with the exact target SHA-256 `b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`.

Next exact-code target is selected from the fresh ranking: reclassify the boundary/data split
behind the apparent `encodage:add` blocker first; only then treat `extractps` as the next bounded
genuine-instruction candidate.

The adversarial check falsified that first target: the sample at `0x14003e85d` is the tail of a
RIP-relative `movaps` displacement (`0f 29 05 31 c9 26 02`) followed by `ret`, split by a stale
`CodeResidue` boundary. No `add` encoder change is justified. The next forge action is boundary
reclassification using `boundaries::valider`; only after that correction may `extractps` be treated
as a genuine instruction blocker.

#### M2 scene-document foundation — implemented library slice, integration still open

`nie-render3d::document` now adds a backward-compatible version 2 contract beside the unchanged v1
API: persisted identifiers, parent hierarchy, local full quaternion/TRS, inherited visibility,
bounded validation and JSON v1→v2 migration. V1 retains its 128-object limit; v2 permits at most
4,096 authoring objects. Initial migrated IDs are deterministic for an unchanged v1 sequence and
become persistent only after saving v2; they are not claimed stable across v1 reordering.

The document suite passes 17 tests and strict clippy with zero warnings. This slice does not yet
make the editor persistent: composition, atomic save/recovery, command history, frontend bindings
and parent-transform evaluation remain open M2/M4 work.

#### M2 pose/animation contract — implemented primitive, format binding still open

`nie-core::animation` now owns format-neutral `SkeletonId`, `BoneId`, `PoseFrame`, local bone
poses, keyframe tracks and deterministic clamp/loop sampling with translation/scale lerp and
quaternion nlerp. It deliberately does not claim G4MT/G4RA semantics: loaders must provide decoded
keyframes. Invalid times, transforms, quaternions and non-finite values fail closed.

`nie-runtime` re-exports the contract for compatibility, while `nie-render3d` depends on the
acyclic core owner. The core suite passes 300 tests and the runtime suite 6 tests; strict clippy
passes for both crates. The contract is not yet connected to G4MT/G4SK, skinned
`nie-render3d`, native/Wasm bindings or the editor timeline; those remain the next functional gates.

The G4MT loader now exposes a format-neutral `Motion::decode_clip` result (`DecodedMotionClip`,
tracks and keyframes): it resolves target-to-bone mappings supplied by the caller, preserves local
TRS, converts declared FPS to seconds, rejects additive clips/invalid mappings and omits unresolved
targets without inventing bones. The `nie-formats` gate passes 317 tests (one ignored) and strict
clippy. A runtime adapter and pose-driven renderer are still required before this becomes a
functional playback path.

The GLB loader now evaluates glTF node hierarchy transforms and bind-pose skinning (JOINTS/WEIGHTS
and inverse-bind matrices), while preserving the existing `Model`/`Primitive` API. Its focused
suite passes 19 tests and strict clippy. This is a measured bind-pose/import improvement, not yet
dynamic `PoseFrame` application: runtime pose upload, morph targets and GPU skinning remain open.

#### Gate finding — forge independence remains open

The current `nie-forge build` reproduces the exact SHA-256, but source inspection shows it still
loads the reference binary and copies every non-regenerated unit from it. This proves exact output
and measured replacement coverage, not independent production of all bytes. The 100% repository
provenance definition of done therefore remains open and must not be inferred from `identical=true`.

The avatar-editor fixture TypeScript diagnostics were corrected in
`packages/inacord-ui/src/avatar/NativeAvatarEditor.test.tsx`; the targeted package typecheck now
passes. Its targeted test run is 9/10: the remaining Escape-bubbling failure is a separate
pre-existing happy-dom/React event error (`getNodeFromInstance(null)`), so the editor integration
gate remains open.

---

## Preserved interface-delivery ledger

## Historical 38-screen execution context

This preserved workstream started on 2026-09-08 at 14:22 UTC
on `vps-203bea89`, from commit `2b7e814a9d773566f0cc0401ebf5e26100b1a0cd`.
The target is 2026-09-09 at 14:22 UTC: 24 consecutive hours, not an automatic pass.
Source: `hostname`, `date -u +%FT%TZ`, `git rev-parse HEAD`, measured on the execution host.

Historical user steering (2026-09-08) suspended intermediate tests during the bounded interface
rush. That exception is closed by the engine rebaseline above: every new batch again requires
incremental narrow verification before integration or commit.

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
explicit Tauri package gate (`cargo check -p inacord`) when that host changes. The desktop
package joins the root workspace; its platform requirements still need a dedicated gate.
Count tests/assertions; zero cases cannot pass.
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

## Azalee UI and tool migration inventory — 2026-09-08

## SQL, data and service boundary — 2026-09-08

`nie-sql` is the single Rust owner for database URL selection, portable read value/query
contracts and SQLite/PostgreSQL connections. The existing SQLx-compatible migration safety
facade remains in `nie-explore::database` until it is moved in a dedicated compatibility batch.
It is a library, not a server: Tauri, CLI, MCP, Axum and any future Wasm-compatible adapter call
its explicit contracts, while browser clients continue to use authenticated HTTP APIs. The selected
native PostgreSQL driver is the maintained `tokio-postgres` crate, which aligns with the workspace
Tokio runtime; SQLite remains `rusqlite`. No host may emulate a PostgreSQL connection through a
local SQLite file.

The existing responsibility tree remains deliberate:

| Concern | Canonical owner | Adapter / existing operational path |
| --- | --- | --- |
| Local editable desktop data and SQLx-compatible history | `nie-sql`, migrating the current `nie-explore::database` facade | Inacord Tauri keeps its `sqlite_*` command names until every caller moves. |
| Read-only game/reverse/catalogue mirror queries | `nie-sql` plus domain-specific `nie-wiki::entities` / `nie-catalog` owners | CLI, MCP, site and desktop inject their source path and never expose arbitrary database files. |
| PostgreSQL/Supabase domain API and browser authentication | existing `packages/db` and Azalee Supabase adapters | The Rust driver is for trusted native/server callers; it does not replace PostgREST, RLS or browser session handling. |
| Versioned cloud migrations | existing tracked Supabase migration directories and `packages/db` inspection contract | A migration is applied only through its documented deployment workflow; discovery never applies it implicitly. |
| Inagle data push and atomic SQLite mirror publication | existing `@rosegriffon/inagle` push plus `scripts/donnees/miroir-inagle.sh` | Cron preserves the established order: push, Zukan enrichment, then mirror publication. |
| PostgreSQL logical backup, restoration check and retention | existing `scripts/ops/sauvegarde.ts` / `rg-sauvegarde.timer` | Do not recreate the retired cron backup task; the verified seven-copy rotation remains the production path. |

The migration contract must reject duplicate versions, checksum drift, unfinished history and
unknown applied versions before executing new SQL. Backend-specific SQL stays explicit where
dialects differ; a migration never claims cross-database compatibility merely because its
version number matches. Connection strings and error reports must not expose credentials.
The SQLite registry and its SQLx-compatible migration history now live in
`nie-sql::sqlite_registry`; `nie-explore::database` is a compatibility `pub use`, so Inacord
retains its public `sqlite_*` command names while all writable local state reaches the shared
owner. The move preserved the eight existing registry/migration tests, which pass together with
strict `nie-sql` clippy. The Inacord Cargo check passes with one pre-existing warning in
`nie-render3d/glb.rs` outside this batch. `nie-sql::postgres_migrations` now provides an explicit
PostgreSQL manifest, validates ordering and SHA-384 checksums, refuses dirty/unknown/divergent
history, and records each transaction with the same `_sqlx_migrations` compatibility shape. It
never attaches write access to `PostgresReadOnly`. Its static planning and SQLite-adjacent suite
passes 10 tests with strict clippy; a disposable PostgreSQL server is still needed to prove the
runner against a live backend before this migration service is declared operational. Thin
trusted-server adapters must retain public command/API names. This decision preserves the existing
data push, backup, API and source tree instead of creating parallel mechanisms.

The read driver is implemented: SQLite uses an OS read-only handle; PostgreSQL uses parameterized
`tokio-postgres` queries, certificate-verifying Rustls with native roots by default, an explicit
trusted-local no-TLS constructor, and `default_transaction_read_only` in the server session.
Its portable values include null, boolean, integer, real, text, bytes and JSON text. The focused
`nie-sql` suite currently passes 5 tests and strict clippy; no live database claim follows from
these local gates. Moving the writable migration registry and proving a PostgreSQL migration
against a disposable server are still required before the SQL convergence row can close.

This is the concrete migration ledger for the request to absorb Azalee's tools, UI and components
into Inacord. It is an ownership decision, not a claim that every consumer has been rewired. The
inventory was measured from the tracked `apps/azalee/components/**/*.tsx` and `apps/azalee/app/**`
surface on this checkout: Azalee has 189 application source modules, including 45 dashboard
modules. `packages/inacord-ui/src/index.ts` records that 136 portable Azalee components had
already moved into the shared package. Migration means importing the shared owner from both hosts;
it does not mean copying a second version into the desktop adapter.

| Azalee component family and source paths | Inacord canonical owner / existing counterpart | Decision | Required migration boundary |
| --- | --- | --- | --- |
| Sprite, image and generic UI primitives: `components/ui/{CommonSpriteIcon,GameSpriteIcon,Icon,SafeImage,SpriteIcon,fade-in,pull-to-refresh,rarity-badge,search-bar,wiki-loading-skeleton}` | `packages/inacord-ui/src/components/ui` and `components/wiki/ui` | **Shared — migrated** | Preserve the Next compatibility provider at the host edge; sprite paths and localized VFS assets resolve through `asset-source`. |
| Reusable controls and layouts: dialogs, drawers, menus, form fields, tables, data grids, tabs, pagination, navigation rail, skeletons, charts and upload controls | `packages/inacord-ui/src/components/ui` | **Shared — owner is Inacord UI** | Replace Azalee-local imports with the package export as each page is migrated; retain browser-only upload/download adapters outside the component. |
| Wiki presentation cards already represented in the package: tactics, items, quests, passives, stadiums, stat curve/heptagon, experience curve, character-stat content and trigger, acquisition panel, media shell, model toolbar, gallery card, video actions/player and filters | `packages/inacord-ui/src/components/wiki/wiki` | **Shared — partially migrated** | `HowToObtain`, controlled `RarityFilterChips`, and the item/coach/tactic detail presentation cores are now shared. Use one visual component with injected data and navigation adapters. Complete the remaining card/detail callers before deleting an Azalee copy. |
| Wiki cards still Azalee-only: `Character*`, remaining `Skill*` views | `packages/inacord-ui/src/components/wiki/wiki` | **Migrate** | `MoveCard`, `CoachCard`, `TeamCard`, `TacticCard`, `ItemCard`, `QuestCard`, `DropsCard`, `CapsuleCard`/`CostumeCard`, `ShopCard`, `AuraCard`, `ElementIcon`, `FormSelector`, `MovesetList`, `OverrideSkillSection`, `GaijiGlyph` and `SkillDetailInfo` are already shared, with CDN/Next and VFS adapters retained by their hosts. Extract the remaining display props from Supabase queries; keep SQLite/Supabase/VFS joins in the relevant host/data library. Every entity view must show resolved native name plus immutable ID. |
| Wiki list/search controls: `GlobalSearch`, `CharacterSearchDialog`, `WikiSearchToolbar`, `SearchResult*`, `CharacterTable`, `BaseCharacterTable`, `TeamsListClient`, `AuraList` | `packages/inacord-ui/src/components/wiki/wiki` plus `components/ui/{command,data-grid,tree-rows}` | **Migrate** | `SearchResultHighlight`, `GlobalSearchDialog` and `CharacterSearchDialogSurface` are shared controlled views; each host injects fuzzy results, loading state and selection navigation. Share the remaining query-independent rows, filter state and result rendering. Azalee retains URL/SSR search parameters; Inacord supplies its desktop/router and local-index adapters. |
| Wiki filter families: `CharacterFilters`, `ItemFilterBar`, `PassiveFilters`, `PassivePlayerFilters`, `RarityFilterChips`, `SkillFilterBar`, `TeamFilter`, `QuestFilterBar` | `packages/inacord-ui/src/components/wiki/wiki/filters` | **Migrate / merge** | `FilterChipGroup`, `CharacterFilters`, `RarityFilterChips` and `TeamFilter` are shared controlled components; host facades supply Next/router or desktop/VFS state. Retain the existing shared item/passive/skill/quest filters and inject facet queries from the host. |
| 3D and model media: `CharacterModelViewer`, `InlineModelViewer`, `CharaCanvasCard`, `ChrModelGallery`, `KeshinModelGallery`, `CharaAssetsSection`, `MediaDownload` | `packages/inacord-ui/src/three/{ModelViewerSurface,Viewport3D}` and `components/wiki/wiki/{MediaShell,ModelToolbar}` | **Shared — migrate callers** | The package owns viewer lifecycle and editor presentation; VFS decoding, native renderer and download/file-dialog operations remain host adapters. |
| Gallery, texture and media browsing | `packages/inacord-ui/src/gallery` and desktop `GalleryView` adapter | **Shared — migrated** | Inacord owns categories, filters, bounded thumbnails and viewer behavior. Azalee's SQL/manifest inventory and the desktop VFS source remain adapters to the same contract. |
| Wiki home components: `AnimatedCounter`, `WikiCarousel`, `ToolsPreview`; home composition `LandingHero`, banners, sections and network content | `packages/inacord-ui/src/components/wiki/home` | **Split: shared components; Azalee composition host-only** | Keep reusable carousel/counter/tool-preview in the package. Marketing/editorial layout and remotely managed banner content remain Azalee-specific until Inacord needs the same content surface. |
| News reading widgets: `BackToTopButton`, `ContinueReading`, `PopularArticles`, `ReadingProgressBar`, `RelatedArticles`, `SeriesNavigation`, `TagCloud`, `TrendingArticles` | `packages/inacord-ui/src/components/wiki/news` | **Shared — migrated** | Supply article navigation, scroll and data through each host; no component may import Next or Supabase directly. |
| News community and publication controls: `ArticleCard`, `FeaturedHero`, `AdvancedFilters`, `CategoryChips`, comments, reactions, bookmarks, notifications, reading mode, push opt-in and author dashboard | `packages/inacord-ui/src/components/wiki/news` | **Migrate presentation; host-only services** | Move cards, rows and controlled controls into the package. Azalee retains authentication, notification delivery, analytics, server actions and public article routes; Inacord may mount the presentation against a local/wiki service. |
| News dashboard: list, selectable card/row, `BulkActionsBar`, `NewsEditor*`, crop dialog, metadata/publication/SEO/tag sidebars | `packages/inacord-ui/src/components/wiki/dashboard/news` plus a new `components/editorial` family | **Migrate** | The shared package owns editing/form presentation and validation model. Next Server Actions, scheduled publishing, image storage, SEO/OG generation and Supabase mutation stay in Azalee adapters. |
| General dashboard: `DashboardSidebar`, `DashboardMetricCard`, database element chart, audit tables, database editor, import forms, user/tweet/zukan review screens | `packages/inacord-ui/src/components/wiki/dashboard` and `components/ui/{dashboard-*,data-grid,chart}` | **Migrate presentation; split domain libraries first** | Reuse metric/chart/grid components immediately. Extract each portable database, audit and import model to a Rust/TypeScript library before an Inacord screen is added; privileged CRUD and cloud credentials remain host-only. |
| Rich-text editor: `components/blocks/editor-00/**` and `components/editor/**` including Lexical plugins, toolbar, image node and renderer | New `packages/inacord-ui/src/editorial` owner, with existing `components/editor` as source material | **Migrate** | Preserve the complete editor feature set through an injected upload, document-storage and navigation contract. Do not couple Lexical presentation to Next actions or Supabase storage. |
| Navigation and shell: `Shell`, `app-sidebar`, `AzaleeNavigationRail`, `MaterialBottomNav`, footer, skip link | `packages/inacord-ui/src/components/ui/{navigation-rail,navigation-bar}` and `shell/native-tool-surface` | **Merge** | Inacord owns adaptive navigation primitives and its game theme. Azalee remains responsible for public routes, footer/legal links, metadata and responsive browser shell. |
| Authentication, profile, account, 2FA and user preferences: `auth/*`, providers, `/login`, `/settings`, `/profil`, `/2fa` | Shared form primitives only; no current shared identity service owner | **Host-only** | Keep Better Auth/Supabase session, cookies, 2FA and account mutation in Azalee. Inacord uses its native profile/settings adapter and must not import web identity code. |
| Save upload and roster resolution: `SaveUploader`, `/api/save/resolve-roster` | Existing desktop `SaveView`, `nie-explore` and save decoders | **Migrate / converge** | The route is now a thin Request/Supabase adapter over the shared `packages/azalee` roster identifier contract, which canonicalizes unsigned IDs, preserves order, deduplicates and caps batches. Extract parsing and roster resolution itself into the Rust owner; mount one shared upload/progress presentation with browser file and Tauri file-dialog adapters. |
| Tactical tools and calculators | Desktop `ToolsView` with `ComparatorPanel`, `StatCalculator`, `RandomTeamPanel`, `ProgressionPanel`, `TranslatorPanel`, `ProbabilitesPanel`, `TeamBuilderPanel` | **Merge into Inacord** | Inacord is the canonical tool surface. Extract calculation/query policy from React panels so Azalee can reuse it only where a public web tool is explicitly retained. `RagAssistant` remains disabled: it has no active Azalee caller and must not be re-enabled by this migration. |
| VFS/CPK, Lua, RE, mods, audio, cinema, live-mod, raw data and editor screens | Desktop `ExplorerView`, `RawCpkView`, `LuaView`, `ReToolsView`, `ModsView`, `AudioBankPanel`, `CinemaView`, `EditorView`, `CfgbinViewer`, `PropertyEditor` and shared Rust owners | **Inacord-only tool surface** | Lua bytecode inspection, execution, globals and eval now live in `nie-lua`; generic VFS cfg.bin RDBN/T2B decoding now lives in `nie-explore`; Tauri retains only compatible DTO/IPC facades. These are already Inacord responsibilities. Azalee may link to public read-only data but does not become a second filesystem, reverse-engineering or mutation host. |
| Public content routes: entity pages, news/patch-note pages, static metadata, sitemap, robots, feeds, Open Graph images, legal/contact/charter/support/maintenance pages | Azalee Next App Router | **Host-only** | Keep server rendering, indexing, compliance and public publishing in Azalee. Shared cards/views are mounted there through `inacord-ui`; Inacord does not replicate a public website. |
| Azalee APIs and server actions: Supabase/GraphQL/RAG, articles, comments, newsletter, notifications, social/share tracking, cron, image upload, VRoid and administration | Rust data libraries where portable; otherwise Azalee server adapter | **Host-only until a portable domain owner exists** | Reaction validation/state aggregation and comment validation, stable reaction keys, reply aggregation, pinned ordering and cycle-safe tree mapping now belong to `inacord-ui`; reading-history request planning, mapping and statistics belong to `packages/azalee`. Their Next actions retain session, Supabase/Postgres transport and public API. No Next route or Server Action is copied to Tauri. First extract a library for every remaining portable rule; retain HTTP/auth/storage/cron code in Azalee. |
| Cross/mobile-external product, advertising and third-party integrations: `/cross`, `AdSenseGate`, Discord/Google Docs, analytics, Vercel/public deployment configuration | Azalee host | **Host-only** | These are product/service integrations, not Inacord UI capabilities. Do not import them into the desktop suite. |

### Ordered execution and deletion rule

1. Finish the existing partial wiki migration: filters, remaining entity cards/details, search and
   list rows, then update Azalee callers to use package imports.
2. Extract the rich-text/editorial and dashboard presentation families with typed host contracts;
   move portable state and validation into a library before adding desktop routes.
3. Converge save and tactical tools on existing Rust owners and the Inacord desktop presentation.
4. For every migrated family, prove both hosts consume the same export, retain a compatibility
   facade until all callers move, and only then remove the old Azalee implementation.

The completion condition is not a file-count reduction. It is one shared implementation for each
row marked **Shared**, **Migrate** or **Merge**, with feature-preserving host adapters and no
duplicate business logic. Rows marked **Host-only** are deliberate boundaries and remain so unless
a portable owner is first identified and tested.
