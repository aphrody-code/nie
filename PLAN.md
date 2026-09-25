# NIE — canonical plan

This is the canonical plan of the repository: the only file that says what is left to do. It
was rewritten on **2026-09-25** from a line-by-line triage of the previous plan (every item
classified DONE / OPEN / OBSOLETE / KNOWLEDGE against the tree, with evidence) and from the
audits of the whole `nie` surface:

- [`docs/reports/crates-audit-2026-09-25.md`](docs/reports/crates-audit-2026-09-25.md) — 48 crates;
- [`docs/reports/bun-apps-packages-audit-2026-09-25.md`](docs/reports/bun-apps-packages-audit-2026-09-25.md) — 2 apps, 8 packages;
- the service, port and endpoint inventory, which is private and lives in `../aphrody-infra`.

The previous plan and the game-screens plan are archived in
[`docs/archive/plans/2026-09-25/`](docs/archive/plans/2026-09-25/README.md). Measured facts that
lived only there were moved to the documents that own them (`docs/FORGE.md`, `docs/re/`,
`docs/game-data/`, crate READMEs); this file holds tasks, decisions and ownership, not history.

## Rules of this plan

1. **Only open work lives here.** A finished item is ticked in the commit that finishes it, then
   removed at the next consolidation; its evidence belongs to the commit and to `CHANGELOG.md`.
2. **Every item has an acceptance check** — a command or a measurable result. "Done" means that
   check was run and read, never that the code was written.
3. **No number without its command, date and host.** Two hosts matter: the Windows workstation
   (no `nie.exe`, no knowledge base, no Python) and the Linux VPS (target binary, KB, services).
   Items marked **[VPS]** can only be measured there.
4. **Extract before you bind** (CLAUDE.md): logic moves into a library crate with its tests
   before a second surface (CLI, wasm, GUI, HTTP) appears.
5. **Never stay blocked.** A blocker is fixed at its source — loader, config, catalog, test — in
   the same pass; it is not written here as a reason to stop.

## Mission

Reconstruct the engine that produced `nie.exe`:

- **Provenance** — the forge rebuilds `nie.exe` byte for byte from code this repository owns.
- **Functional reconstruction** — the same Rust runs native, headless and in `wasm32`, and the
  cross-host gates prove they agree.
- **Inacord** — the desktop is the visual VFS explorer and preview; every other capability stays
  headless (CLI, MCP, HTTP, wasm).
- **Interop** — formats, saves, models and data round-trip through documented, tested libraries.

**Definition of done:** 100 % provenance (forge levels G4–G6), native/headless/wasm parity on
every served screen, Inacord persistence and packaging green, and this plan empty.

## Architecture and ownership

Read this before creating a crate or a package: most "new" components already exist under
another name.

### Layers

| Layer | Path | Owns |
| --- | --- | --- |
| engine | `crates/engine/*` (25) | formats, game data, gameplay logic, Lua VM, rendering, UI tokens, FFI, wasm bindings |
| forge | `crates/forge/*` (9) | byte-exact PE (`nie-pe`), x86-64 encoder (`nie-asm`), rebuild and coverage (`nie-forge`), RE engine (`nie-re`, `nie-index`, `nie-seed`, `nie-queue`, `nie-dump`, `nie-trace`) |
| tools | `crates/tools/*` (12) | `nie-cli` (the only user CLI), `nie-mcp`, `nie-site`, `nie-model-serve`, `nie-wiki`, `nie-steam`, `nie-zukan`, `nie-launcher`, `nie-editor`, `nie-bench`, `nie-computer-use`, `ievr-tools` |
| archive | `crates/archive/*` | read-only porting reference, outside the workspace (`nie-engine` excluded, `nie-rs` orphan) |
| apps | `apps/nie-web`, `apps/inacord` | `nie-web` is the single frontend (browser and desktop); `inacord` is Tauri packaging of it (`src-tauri` is a workspace member) |
| packages | `packages/*` | TypeScript contracts and UI: `asset-source`, `inacord-ui`, `nie` (Bun FFI over `nie-ffi`), `nie-bridge`, `nie-game`, `nie-media`, plus the `nie-plugin` test/loader preload and `config` |
| infra | `../aphrody-infra` | units, vhosts, ports, topology, deploy plane — never re-declared here |

### Target component → what already implements it

| Target name | Implemented today by | Gap |
| --- | --- | --- |
| `nie-web` (wasm32 game) | `crates/engine/nie-wasm` (`WasmGame`) mounted by `apps/nie-web` | the public entry still loads React after bootstrap |
| `inacord-core` / `inacord-data` | the engine crates — `nie-core`, `nie-data`, `nie-formats`, `nie-explore`, `nie-save`, `nie-lua`, … | duplicated modules (see P2 structure) |
| `inacord-api` | `crates/tools/nie-site` (axum 0.8) and `crates/tools/nie-model-serve` | model-serve has no router |
| `inacord-mcp` | `crates/tools/nie-mcp` → `nie mcp` in `nie-cli` (stdio) | — |
| `inacord-gui` | none native: `apps/inacord` is Tauri over `nie-web` | by decision (explorer only) |
| `inacord-mobile` | none | not scheduled |
| `inacord-blender` | `plugins/nie-blender` + `crates/engine/nie-ffi` | not joined |
| game data store | `crates/engine/nie-pg` → PostgreSQL schema `nie` | readers still use JSON |

### Ownership rules

- A CLI is a binding, never a home; the same holds for wasm exports, Tauri commands and routes.
- The Rust site and wiki crates are the only IEVR data owners; Bun code is a thin binding and
  never queries the mirror or a remote wiki.
- `nie-pg` writes only schema `nie`; readers get the `nie_reader` role; rg's `public.inagle_*`
  is never touched.
- The origin publishes no identity, version or fingerprint (CLAUDE.md).
- Private topology (ports, routes, units, hosts) is documented in `../aphrody-infra` only; this
  repository is public.

## P0 — safety, security, broken production

- [x] **Close every unauthenticated path to raw VFS bytes.** (2026-09-25: nginx aphrody-infra `31db1fc` live; code gate in this commit — `/vfs/` stays host-only at nginx until rg SSR forwards the token) The bearer gate on `/f` and `/b`
      (`raw_gate.rs`) is not the only door: the derived-asset proxy and the CDN vhosts reach the
      same data. Fix in code (one shared token check used by `nie-site` and `nie-model-serve`,
      allowlist in `nie-site`'s asset proxy) and in the aphrody-infra vhosts, then deploy both.
      *Accept:* the listing and raw routes answer 404 without the token on every public host,
      derived assets still answer 200, `cargo test -p nie-site -p nie-model-serve` green.
- [x] **Inacord auto-update downloads.** (fixed 2026-09-25, aphrody-infra `31db1fc`: installer URL → 200) The updater feed answers, but the installer URL it
      advertises returns 404 (measured 2026-09-25). *Accept:* `curl -sI` on the URL in
      `latest.json` → 200 and the signature/tamper tests of `scripts/release-inacord.ts` pass.
- [x] **No test may write outside the repository.** (`5a5edbbf`) `nie-save/tests/apply_astro_lor.rs` copies
      into the live Steam `userdata` directory whenever `var/save_work` exists. *Accept:*
      `cargo test -p nie-save` writes only under a temp dir or `var/`; `rg 'Program Files'
      crates/` is empty; the live install is an explicit, env-gated opt-in.
- [x] **Bun must run without the native library.** (fixed 2026-09-25, `d3ec50c2`) The `bunfig.toml` preload makes every `bun`
      command die when `iecode.dll`/`libiecode.so` is absent. *Accept:* on a clean checkout with
      no library, `bun run typecheck`, `bun run docs:check` and the non-native tests pass; a
      native call without the library fails with an explicit message.
- [x] **The `nie-game` MCP server starts on Windows and Linux.** (`5a5edbbf`, `e03ca1a0`; Linux PATH install unverified) It timed out at 30 s on the
      workstation. *Accept:* the configured command answers `initialize` + `tools/list` over
      stdio in under 10 s on both hosts.
- [ ] **Move the browser off `/f` and `/b`.** `menu-composer.ts`, `menu-layout.ts`,
      `lua-runtime.ts`, `native-font.ts`, `inacord-web/shims/core.ts` and `EditorView.tsx` still
      read raw paths, and the preloaded VFS is empty (`public/static/game/vfs/manifest.json`
      has `"archives": []`). Publish the `.nievfs` split archives at deploy time
      (`NIE_VFS_BUNDLE_DIR` in `deploy-target`, `stage-vfs.ts` wired, fix the duplicated `??` at
      `apps/nie-web/vite.config.ts:54`) or switch consumers to decoded `/api` routes.
      *Accept:* with `NIE_RAW_VFS_TOKEN` unset, `just cross-host 30` and `just ecrans` pass and a
      browser session makes 0 requests to `/f/` or `/b/`.
- [ ] **Public Lua execution is sandboxed.** `POST /api/v1/lua/execute` and `/lua/eval` run
      client-supplied Lua. *Accept:* a test proves no `io`, `os`, `package`, `debug`, `load` of
      bytecode or unbounded loop escapes (instruction and memory limits enforced).
- [x] **No fingerprint in public responses.** (feed version and health uptime removed in this commit) Drop the crate version from `/feed.atom` and
      `uptime` from `/api/health`; review `/api/v1/health` and `/readyz` capability detail.
      *Accept:* `rg VERSION crates/tools/nie-site/src/routes` finds no public serialisation.
- [ ] **Desktop least privilege.** `tauri.conf.json` has `csp: null` and `capabilities/default.json`
      grants recursive write on home, desktop, documents and the exe directory. *Accept:* a CSP is
      set and fs scopes cover only the directories the commands use; the built app still opens,
      explores and exports.

## P1 — correctness gates and the product

### Forge and RE

- [ ] **[VPS] Re-measure the forge** on the current revision (`scripts/atlas-loop.sh --no-act`,
      `nie-forge lift/report/build`) and record it in `docs/FORGE.md`. *Accept:* `identical=true`
      and the table carries date, host and commit.
- [ ] **[VPS] Reclassify the false-code residue** at `0x14003e85d` (`boundaries::valider`) and
      validate the suspected `in`/`out`/`sti` false code. *Accept:* those residues leave the
      blocker list; provenance ≥ 74.061759 % with the same SHA-256.
- [ ] **`vpaddw` VEX.256** in `nie-asm` + lifter mapping (sample `0x140727ebb`). *Accept:*
      round-trip test, lift delta ≥ 4 units / 33 130 B, `identical=true`.
- [ ] **[VPS] Re-anchor the knowledge base** on the `b1fa04ea…` target (`just re-seed && just
      re-rebuild`). *Accept:* `re.anchoring` moves off 43 % and is stored in `atlas_metric`.

### Rendering and screens

- [ ] **Real-font gate.** `real_glyph_blitter_a` expects 544 lit pixels, the last run drew 536.
      *Accept:* `cargo test -p nie-formats --features textures real_glyph_blitter_a` and the
      `--ignored native_font_french_fixture` test pass with the fixtures present.
- [ ] **`just ecrans` green**: every pair renders (no 504 on shop, players_universe, ability)
      and no screen falls below `data/menu/screen-ssim-baseline.json`.
- [ ] **Gallery list ring drawn.** Turn `renderActivated` (`nie-game/src/main.rs`) into real
      compositing through `menu::list_view_ring_slots`, and port Lua command `0x37EC8B39`.
      *Accept:* Gallery SSIM > 0.3326 in `just ecrans`, 0 unknown commands in its replay.
- [ ] **`ListScroll` in PlayerBank** through a `nie-wasm` binding of `nie_core::list_view`,
      replacing `listPage`/`stepCursor`. *Accept:* nie-web tests + typecheck green, chara_bank SSIM
      ≥ baseline. Needs the CharaBank slot-56 override and the `mLockFocusIdx` writer.
- [ ] **Game screens `story_mode_top_menu`, `chronicle_mode_top_menu`, `soccer_formation_menu`**
      following the screen contract (screen file + `entries.ts` + `Game.tsx` binding + `pages.rs`
      page in four languages + the four route counters). *Accept:* each renders in `just ecrans`.
- [ ] **Public entry without React**: render `main_menu` from the staged `.nievfs` with
      `nie_game`/`nie_ui`. *Accept:* `/` loads without `host-mount` and the
      `public-entry-bundle` gate passes.
- [ ] **Re-measure `title_menu_2`** now that its script resolves. *Accept:*
      `/api/v1/menu/render/title_menu_2` reports `x-compose-drawn` > 0 with an SSIM against the
      capture; retire `inacord-ui/shell/menu-screen.tsx` if it wins.

### Lua in the browser

- [ ] **Rebuild `nie_lua_web.wasm`** (emsdk) with the readiness export, `wasm-opt` and a byte
      budget. *Accept:* `grep -a -c nie_lua_web_readiness_json` ≥ 1, the budget is enforced by the
      build, the differential stays ≥ 10/14.
- [ ] **Menu host coverage** from `nie-lua/tests/menu_host_gap.rs`, starting with
      `SetCtrlGuideTextCommon`. *Accept:* complete screens > 19 of 93.
- [ ] **Locale passthrough** in `lua-runtime.ts` (today hardcoded `"fr"`). *Accept:*
      `lua-runtime.test.ts` covers `fr`, `en`, `ja`, `es`.

### Data

- [ ] **Full `nie-pg import`** from the complete game copy (936/936 CPKs, 71 100 cfg.bin present,
      measured 2026-09-25). *Accept:* 0 format failures; a second run rewrites 0 files.
- [ ] **Move `nie-data` readers to `nie.*` queries**, one family at a time. *Accept:* golden tests
      pass and the 601 `cfg.bin.json` references go down per family.
- [ ] **Server-side joins for shop, gallery and roster** in `nie-site` (today `shop.ts` joins three
      responses). *Accept:* `cargo test -p nie-site` green with the four route counters updated,
      `Shop.tsx` makes one fetch.

### Animation, editor, avatar

- [ ] **Animation playback path**: `g4mt::animation_clip` → sample → `glb::apply_pose_cpu` in one
      host. *Accept:* a real-asset golden vertex hash at three times, equal on native and wasm.
- [ ] **Editor persistence**: wire `WasmEditorSession` (0 TypeScript consumers today) into
      `EditorView` with atomic save and UI undo/redo. *Accept:* save → reopen → `project_json`
      byte-equal in a test.
- [ ] **Chara Edit CLI lot**: `nie avatar import|validate|export` through
      `nie_data::avatar_reference`. *Accept:* CLI and wasm give byte-identical JSON and GLB.

### Release

- [ ] **Cut 1.0.0 for real**: manifests say 1.0.0 but there is no `v1.0.0` tag or release (latest
      published is `v0.5.11`). *Accept:* `git ls-remote --tags origin v1.0.0` and
      `gh release view v1.0.0` succeed, and `CHANGELOG.md`'s link resolves.
- [ ] **License coherence**: `packages/nie` and `packages/nie-bridge` declare MIT while `LICENSE`
      is the commercial agreement. *Accept:* every manifest's license matches the decision.
- [ ] **Retarget `scripts/audit-and-fix-nie.ts`** to the loopback shell (the public host answers
      404 at `/`). *Accept:* exits 0 against a local `nie-site` with no hard-coded public host.

## P2 — structure and debt (from the 2026-09-25 audits)

### One owner per behaviour

- [ ] Growth / exp / skill / aura / menu_setting exist in both `nie-core` and `nie-data`: one owner.
- [ ] G4CM is implemented in `nie-camera` and `nie-formats`: one codec.
- [ ] Format detection exists in `nie-headless`, `nie-ffi` (`nie_detect`) and `nie-explore`: one.
- [ ] `pdata` parsing exists in `nie-re` and `nie-pe`: `nie-re` uses `nie-pe`.
- [ ] Team codes and rules exist in `nie-wasm::team_*` and `@nie/game`: move the logic to
      `nie-core`, keep both as bindings.
- [ ] `nie-viewer-web` and `nie-wasm/src/web_viewer.rs`: separate modules by design (size), one
      shared code path.
- [ ] Translator fuzzy scoring (`traduction.ts`) moves to a Rust owner with parity fixtures.
      *Accept for the whole block:* each duplicate removed with its tests kept green.

### Crate and file shape

- [ ] `nie-wasm` depends on ~30 internal crates (forge, trace, steam, bench, editor…): keep only
      what exported bindings reach. *Accept:* `cargo tree -p nie-wasm` shrinks, module size stays
      under the 6 MiB budget.
- [ ] `nie-model-serve` hand-matches ~30 paths: move it to the axum router `nie-site` uses.
- [ ] Split oversized files: `nie-game/src/main.rs` (5 219 lines), `apps/inacord/src-tauri/src/lib.rs`
      (5 733, 134 commands), `nie-ffi/src/lib.rs` (~2 000), `nie-cli/src/mcp.rs` (1 233), and the
      nie-web components over 800 lines (`CinemaView`, `ExplorerView`, `PlayerBank`, `EditorView`,
      `VideoPlayer`, `Catalog`, `Models3D`).
- [ ] `nie-render` (161 lines) — merge into `nie-render3d` or give it a consumer; `nie-bevy` — wire
      a consumer or mark it parked in its README.
- [ ] Delete `crates/archive/nie-rs` (orphan, 62 Ghidra stub files, 75 TODO markers); map
      `crates/archive/nie-engine`'s overlap with live crates before porting anything from it.
- [ ] Move the misplaced dependencies in `apps/inacord/src-tauri/Cargo.toml` (every `nie-*`,
      tokio, zip, trash, uuid, async-trait sit in the desktop `cfg` block).

### Tests where there are none

- [ ] `nie-launcher` (9 tests / 10.3 k lines), `nie-cli` (41 / 20.5 k), `nie-pg` (4), and 0 in
      `nie-play`, `nie-render`, `nie-viewer-web`, `nie-media`, `nie-game`.
- [ ] Separate test from production `unwrap()` in `nie-wiki` (269) and `nie-site` (210); replace
      the production ones with errors.

### Frontend cleanup

- [ ] Remove unreachable modules: `ReForgeView.tsx`, `SettingsView.tsx`, `MemoireCard.tsx`,
      `TranslatorPanel.tsx`, `tool-navigation.ts`, `comparator-state.ts`, `equipe.ts`,
      `game/team-*.ts` (test-only), and the stale comment in `UnifiedShell.tsx`. *Accept:* 0
      importers, typecheck and tests green.
- [ ] `nie-media`: make it the real media owner (move `sources.ts`/`cinema.ts` logic, delete the
      `episode-navigation.ts` facade) or fold it into another package.
- [ ] `apps/inacord/public`: drop the files duplicated from `nie-web/public` and the service
      worker + web manifest a Tauri shell does not need.
- [ ] `inacord-ui` `exports`: remove the `./shell/*` entries that duplicate explicit ones.

### Rendering and game depth

- [ ] Morph targets and GPU skinning in `nie-render3d`. *Accept:* CPU and GPU skinned silhouettes
      agree on a non-square viewport.
- [ ] Clothes categories 19–21 change the assembled GLB. *Accept:* the editor test asserts a
      different GLB hash.
- [ ] Animated list scroll (slot 9 easing, slot 56 `0x140542080`) with a uemu validator.
- [ ] Find the writer of `mLockFocusIdx` (`+0x198`) or parse it into `ListViewParams`.
- [ ] Game screens `players_universe_menu`, `ability_learning_board_menu`; items, drops, capsule
      rates; stadium, coach, aura and quest views inside screens.
- [ ] Chara/system/kizuna Lua hosts; the remaining 4/14 differential (32-bit `lua_Integer`);
      reverse the game's global dispatcher.
- [ ] Convert the 38 archived screen rows into deterministic fixtures (milestone M3).
- [ ] GLB semantic export/reimport, then VRM (M5); VTubing (M6).
- [ ] Forge levels G4/G5: build without reading the reference, toward 100 % provenance.

### Data and provenance

- [ ] Retire `data/azalee/*.json` (22 files) once their readers query SQL; restore a runnable
      provenance validator for the remaining artefacts (the old script was deleted).
- [ ] Promote the Cross candidate; recover the raw 85 267-row enumeration and the 19 unresolved
      dependency names; identify the 98th film; reconcile staff IDs with legacy character IDs.
- [ ] Generator: age filter and per-position relaxation warning, with a native fixture.
- [ ] Build a caller ledger with response fixtures before removing any public compatibility route.
- [ ] Colour provenance audit of wiki illustrations and element/stat colours.
- [ ] Wire `../iecode/crates/pipeline` (`PipelineManifest::validate`) into `nie` with round-trip
      tests; publish the iecode crates and drop the `../iecode` path dependencies (needs
      `CARGO_REGISTRY_TOKEN`).

### Cross-repository (owner outside this repository)

- [ ] **aphrody-infra** — declare every nie route and port the vhosts actually use; one health path
      for `nie-site`; explicit loopback bind for `nie-model-serve`; a pruning job for
      `var/model-cache`; remove retired units still in `systemd/`.
- [ ] **rg** — Azalée reads `nie.*` views through `nie_reader`; retire rg's cfg.bin importer;
      retire the Azalée pages the game screens replace.
- [ ] **[VPS] Linux Steam** — depot sync, then `scripts/nie-wine-setup.sh`. *Accept:* Proton's
      `files/bin/wine` exists and the VFS check passes.

## Decisions recorded 2026-09-25

- **Azalée parity tooling is retired, not restored.** The route ledger, candidate gate, provenance
  script and tool panels removed in `8bf226b2` stay removed: Azalée lives in `rg`, and the Rust
  crates are the data owners. Recoverable from `fcdc0ea4` if a provenance need appears.
- **One plan.** `docs/GAME-SCREENS-PLAN.md` is archived; its remaining screens are items above.
- **Private topology stays private.** Ports, vhost routes and endpoint inventories are recorded in
  `../aphrody-infra`, never in this public repository.
- **Inacord scope.** The desktop exposes the VFS explorer only; wiki, RE, modding, Lua, live memory
  and 3D authoring stay headless.
