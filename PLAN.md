# NIERS execution plan — native PC screen reconstruction

Rebased on 2026-09-08 from the PC screenshots and fresh live browser evidence. This is the
only active execution plan. The complete previous ledger, including its latest deployment
record, is retained in [pre-fidelity-rebase.md](docs/archive/plans/2026-09-08/pre-fidelity-rebase.md)
as historical evidence, not current instructions or proof of visual fidelity.

## Required outcome

Reconstruct the menu, website and WebAssembly runtime from the real PC game's VFS resources,
formats, configuration, Lua/native state and measured geometry. Compare the live result against
every corresponding reference in `data/menu`. Return must reach the previous screen or main
menu without restarting loading or the opening sequence.

Completion includes native icons, button sheets and states, backgrounds at their correct
resolution, game fonts, full navigation and synchronized native/Wasm state. A passing parser
suite, an attractive partial interface or successful HTTP requests cannot substitute for it.

## Corrected screen identity

The three attached images are website captures with browser chrome. The original PC screens
are in `data/menu`, as explicitly confirmed by the user.

| PC reference | Actual screen | Required source |
|---|---|---|
| `Capture d'écran 2026-09-08 124431.png` | Black loading, bottom-right football and French label | Loading regions, native font and motion |
| `Capture d'écran 2026-09-08 124446.png` | Franchise emblem on white | `data/common/movie/IE_15th.usm` |
| `Capture d'écran 2026-09-08 124451.png` | LEVEL5 symbol and wordmark | `data/common/movie/L5logo.usm` |
| `Capture d'écran 2026-09-08 124504.png` | Autosave notice and textured OK control | Current background, save symbol, localized text and button resources |
| `Capture d'écran 2026-09-08 124519.png` | START, field and two foreground characters | `title00_01_st` regions and final `title00_03_02` logo |
| `main_menu_alt.png` | Front selection menu, eight upper and three lower tiles | **`title02` and `title_menu_2_setting.cfg.bin`** |
| `options.png` | Original Options | Native settings state and layout |
| `avatar_edit_*.png` | Avatar creation steps | Native editor layout, model state and navigation |
| Remaining named PNGs | Individual game screens and filters | Pair by identity before implementation/scoring |

The previous plan incorrectly associated the front selection reference with `mainmenu01` and
`main_menu`. The public renderer used a `mainmenu90` background, a Switch 2 logo and four generic
website controls. Native `title02_10_my_team_banner`, `title02_11_avatar_banner`,
`title02_07_victory_counter` and `title00_07` match the actual reference. Prior in-game `main_menu`
work remains useful for its own screen; its gates do not establish front-menu fidelity.

New opening screenshots are 1922×1113 including Windows chrome. Their game client is
`x=1,y=32,w=1920,h=1080`. Record that crop explicitly. The 2560×1440 main-menu reference is
proportionally normalized to 1920×1080. Never distort game content or silently exclude mismatches.
Keep unmasked scores even when a second report excludes a capture-tool notification.

## Fresh live baseline

Measured on `vps-203bea89`, `/home/ubuntu/niers`, 2026-09-08, by
`scripts/validation/live-fidelity-audit.ts`. Exact procedures and outputs:
`var/outputs/fidelity-audit-20260908/{AUDIT.md,oracle-manifest.json,metric-summary.json,roi-metrics.json}`
and `live-settled-light/`. These are private comparison evidence, never runtime assets.

| Matched screen | Global grayscale SSIM | RGB mean absolute delta / 255 |
|---|---:|---:|
| Loading | 0.000245 | 237.950706 |
| Franchise emblem | 0.912269 | 25.938324 |
| LEVEL5 | 0.961737 | 5.674104 |
| Autosave | 0.867045 | 19.809831 |
| START | 0.619437 | 74.048838 |
| Front menu | 0.557843 | 70.643163 |

Blank surroundings inflate the logo scores: focal-region SSIM is 0.458809 for the franchise
and 0.643392 for LEVEL5. All screens fail fidelity. Sixty successful requests and no failures
prove availability only. No browser font faces loaded and opening text used `system-ui`.
Avatar's header Return reproduced `/` with phase `loading`; Escape did nothing. Autosave's
button was 68 pixels too low; its warning color/wrapping, background, spinner and typography
differed. START's native artwork was absent.

## Ownership

| Library/host | Responsibility |
|---|---|
| `nie-formats` | VFS, cfg.bin, OBJBIN, G4TX regions, G4PKM/G4SK, motion, bitmap fonts, portable scene data |
| `nie-lua` | Bounded Lua 5.2 execution, observed native inputs, lossless menu state and scene compiler |
| `nie-ui` | Measured visual evidence and geometry |
| `nie-explore` | Reusable host media/catalogue adapters |
| `nie-wasm` | Thin browser ABI over shared libraries |
| `packages/asset-source` | Host-neutral VFS bytes and decoded asset access |
| `packages/inacord-ui` | Shared scene presentation and input reducers |
| `apps/nie-web` | Browser lifecycle, route/history and input bindings |
| `nie-game`, `nie-site`, `nie-model-serve` | Native render and HTTP bindings |

One library owns each capability. No copied geometry per host, no TypeScript format reimplementation,
and no business logic in CLI/MCP/HTTP glue. Preserve compatibility facades until all consumers
migrate. Generic `nie-app` gameplay and `nie-aphrody` character state remain separate. Preserve
CRC and axis-convention differences. Screenshots are oracles only, never full-screen UI assets.

## Execution order

### 1. Complete the comparison corpus

- [x] Separate website captures from the five PC opening references.
- [x] Capture fresh live opening, front menu and Avatar; inspect requests, dimensions, fonts and Return.
- [x] Correct the front-menu source identity to `title02`.
- [x] Inventory every `data/menu` screen and map current cfg/Lua/objects, including missing pairings.
  `data/menu/screen-inventory.json` pairs all 38 captures (sha256, dimensions, opening client crop);
  `docs/game-data/menu-screen-inventory.md` records the reproduction commands and the two
  manifest corrections (`main_menu_alt` = `title02`, five opening captures added).
- [ ] Reproduce each state with fixed viewport, locale, input device and observed scene/save state.
- [ ] Retain hashes, reproducible candidate/live commands, global and per-element comparisons.

### 2. Repair navigation and state ownership

- [ ] Own the opening phase at the router/history boundary; subpage unmounts must not reset it.
- [ ] Cold `/` may start the opening; explicit Return and `/menu` enter the menu directly.
- [ ] Verify Return, Escape, browser Back/Forward, reload and direct entry on every secondary route.
- [ ] Keep Return reachable during VFS readiness/failure and catalogue loading.
- [ ] Preserve nested-dialog/consumed-key behavior, focus and held-input guards.

### 3. Rebuild opening from real resources

- [ ] Place loading's separate football and native French text on black at measured coordinates.
- [ ] Play the two original USM logos. Their MPEG-2 streams need bounded host browser conversion;
  preserve frame rate/dimensions and advance on actual media readiness/completion.
- [ ] Compose START from named field, character, effect and final-logo regions, native input glyphs
  and independent interactive controls. Do not use beta or Switch 2 variants.
- [ ] Resolve current autosave resources. The old `title_auto_save_info_menu_setting` references
  five absent OBJBIN files and exports zero objects here: it is a failed recipe, not an empty screen.
  Measured: **89 of 475** settings reference only absent OBJBIN files, **427** referenced names are
  absent from the entire VFS, and **1549** shipped `menu/obj/` files are referenced by no setting
  (`var/outputs/menu-inventory/objbin-reference-audit.json`). The stale layer list is corpus-wide,
  so autosave must be composed from runtime-created objects, not from this setting's layers.
- [ ] Render native bitmap fonts and localized text; verify French accents, bearings, spacing and wraps.
- [ ] Bind decoded animation targets and interpolation. G4RA structural equality alone is not playback.

### 4. Rebuild the front selection scene

- [ ] Export `title_menu_2_setting.cfg.bin`, current Lua and all runtime-created objects.
- [ ] Use all eleven `title00_07` native icons and textured bases, focus and shadow regions.
- [ ] Derive upper/lower order and action identity from config/Lua/text, not icon interpretation.
- [ ] Resolve region geometry from meshes/locators. Do not treat material top-left transforms as
  centered sprites or paint an entire atlas as one object.
- [ ] Compose logo, information band, avatar/team panels, counters and lower actions independently.
- [ ] Connect proven native actions to actual destinations. Never route story/play/save to unrelated
  website tools. Expose unresolved commands as unavailable; do not fabricate successful actions.
- [ ] Supply actual player/team/save state. Never copy statistics, versions or entitlements from a capture.
- [ ] Validate the same scene through native and actual generated WebAssembly paths.
- [ ] Compare object identity, visibility, transforms, text, focus and transitions; reject malformed data.

### 5. Reconstruct secondary interfaces and complete the flow

- [ ] Match Options rows, switches, selection and Return to `data/menu/options.png`.
- [ ] Reconstruct avatar style/name/stats/hair/clothes/top steps with native layout and live model
  composition. A preset catalogue or generic form does not satisfy avatar interface parity.
- [ ] Pair and reconstruct every remaining requested menu/filter screen.
- [ ] Exercise pointer hover/press/release/cancel, keyboard, touch and standard gamepad for every
  enabled action; verify focus, disabled states and multiple aspect ratios.

### 6. Verify and publish coherent batches

- [ ] Run narrow tests, clippy, typecheck, component tests and portable Wasm checks.
- [ ] Inspect the bundle for screenshot-backed screens, generic icons, substituted fonts, developer
  diagnostics and machine identity in reconstructed game surfaces.
- [ ] Traverse a staged browser candidate, inspect real payloads and non-zero interaction assertions.
- [ ] Record candidate-versus-PC differences even when all implementation tests pass.
- [ ] Commit/push only coherent complete source scopes, preserving concurrent and user changes.
- [ ] Deploy the exact pushed commit through the established service workflow; verify live responses,
  assets, interactions and screenshots; retain hashes and rollback evidence.

## Completion gates

The entire objective stays active until every requirement above is independently verified. Each
screen requires matched PC/candidate/live evidence, actual asset/state provenance, interaction
assertions and reproducible visual metrics. Geometry, native fonts and states must match at the
element level as well as globally. Explicitly list remaining differences and dynamic regions.
Do not lower success to an attractive partial menu or infer fidelity from blank-dominated SSIM.

Use the narrow gates appropriate to changed scopes and record counts:

```text
cargo test -p <changed-library> --lib
cargo clippy -p <changed-library> --lib --tests -- -D warnings
cargo clippy -p <changed-binary> --bins --tests -- -D warnings
cargo check -p <portable-library> --target wasm32-unknown-unknown
bun run typecheck                         # apps/nie-web
bun test apps/nie-web/src <changed-shared-tests>
git diff --check -- <owned-source-paths>
```

Format changed files only. No `cargo build --workspace --all-targets`. Zero tests is not a pass.
Preserve existing `data/menu` edits and copyrighted captures; keep game payloads, screenshots and
bulk measurements out of source commits and the public bundle. Private evidence stays in `var/`.

## Retained project obligations

Inacord unification, editor parity, shared ownership convergence, function-level RE and byte-exact
engine reconstruction remain project requirements. The archived ledger retains their evidence.
They do not displace this interface objective or authorize deleting consumers, adding dependencies
or changing deployment configuration.

## Current batch

Fresh live comparison is complete; every original-screen fidelity gate remains open. Parallel work
covers route/history repair, actual `title02` composition, original opening media and independent
visual audit. Append measured candidate results after running them; source edits are not deployments.
