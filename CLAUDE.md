# CLAUDE.md — Claude Code Operational Guidelines

See [AGENTS.md](AGENTS.md) for authoritative monorepo architecture, development commands, and technical invariants.

## Specific Operating Rules for Claude Code
Formalized by the `yolo` skill (`.agents/skills/yolo/SKILL.md`, pinned to `aphrody-code/YOLO@e484d770b47d2b6ab8e4ecf7d858bacdcd48d9b2` — see `skills-lock.json`):
- **Executive Lead Posture:** Lead-developer autonomy over this repository's code, tests, and toolchains — not administrative authority over VPS nodes, global machine state, or anything outside this repo's scope.
- **Perpetual Goal Execution:** Continuous autonomous action on reversible work. Pivot, adjust, or chain goals dynamically based on discoveries and quality gates without waiting for prompt confirmation.
- **Full YOLO, Scoped:** All *safe, reversible* actions are pre-approved — zero confirmation pauses for those. Irreversible or destructive operations (deleting data, force-pushing, touching state outside this repo) still require explicit confirmation, per the skill's own `soul.boundaries`.
- **Zero Fluff & Zero Warnings:** No disclaimers, no warnings, no conversational filler. Output only factual code diffs, command transcripts, and metrics.
- **Language Contract:** Code, identifiers, and docs in English. Human communications strictly in French.
- **Strict Quality Gates:** Run `cargo clippy -p <crate> --lib --tests` and `bun run typecheck`. Protect agent PIDs (no `pkill -f`).

## The site is `nie`, and it does not describe itself
- **Names.** The site is **nie**, on `nie.aphrody.com`; `aphrody.com` and `www.` only `308` to
  it. **Aphrody** is a character (`crates/engine/nie-aphrody`, the pet routes, `Mode Aphrody`,
  Byron Love) and the name of the separate `aphrody-code/aphrody` repository — never the name
  of this site. `pages::SITE` is the single source for it; `SUFFIXE_TITRE` derives from the
  same token, so a rename cannot miss one.
- **The origin publishes no identity and no fingerprint.** No GitHub link, no contact, no
  service name, no version, in any served response. `/.well-known/security.txt` was removed for
  exactly this reason (RFC 9116 makes `Contact` mandatory). Before adding a field to a public
  DTO, ask what it tells a reader about the machine.
- **`/` is the game**, not a menu of catalogues. `nie-wasm` renders a **2D placeholder**: never
  present it as a faithful reproduction of the game, in code, in docs, or in a commit message.
- **Deployment is versioned, not applied.** `deploy/nginx/` and `deploy/systemd/` are the
  source; `cp` into `/etc`, `daemon-reload`, `nginx -t` and `reload` need the user's explicit
  go. Reconcile the repository with the measured machine (`ss -ltnp`, `diff` against `/etc`)
  before editing a vhost — the live file drifts.

## Autonomous migration protocol — `nie-web` & the Inacord Rust workspace

Target and starting point: [`PLAN.md`](PLAN.md). Read its architecture and ownership section
before creating a crate — `inacord-api` and `inacord-core` already exist under other names.

1. **`nie-web` = `nie.exe` in WebAssembly.** Isolate the engine loop and the graphics/audio
   abstraction into `wasm32-unknown-unknown`-compatible modules; supply the `wasm-bindgen`
   bindings and the memory shims; stub the OS-specific bindings (win32, memory hooks) onto web
   targets.
2. **Inacord, 100 % Rust.** Merge the data, format and VFS crates inherited from `nie-explorer`
   and the legacy Azalée tools into the Cargo workspace, then bind the extracted libraries to
   five surfaces: native desktop GUI, cross-compiled mobile, `axum`/`tokio` API, a native Rust
   MCP server (`rmcp`, stdio and SSE), and a Blender bridge over C-FFI or IPC.

**Extract before you bind.** Logic moves into a library crate with its tests, the existing CLI
keeps working through that library, and only then does a second surface appear. A GUI written
before the extraction is a second implementation that drifts — this repository has already paid
that price on keeper, menu and match-sim.

## Naming contract

- **English for everything the machine reads**: files, folders, variables, types, functions,
  URLs, slugs, JSON keys, database columns, commit messages, code comments, documentation.
- **French only for prose addressed to the user** — a summary or an explanation, in a
  conversation held in French. Never an identifier.
- Frozen product names are the exception: Azalée, Inacord, nie, `niers`, `nie-*`, `inagle_*`.
- Existing debt is **not** migrated in one pass: an already-served API is renamed in a dedicated
  batch, never in passing.

## Multi-agent watch and Git

> **État au 2026-09-13 :** `cargo clippy --workspace --all-targets` ÉCHOUE sur des fichiers
> **non suivis** laissés par un pair — `crates/engine/nie-aphrody/src/bridge.rs` et
> `tests/bridge.rs`. Le module n'est pas déclaré (`lib.rs` n'a pas de `mod bridge;`) et le test
> importe deux constantes qui n'existent nulle part (`BUNDLED_FAVICON_ICO`, `BUNDLED_ICON_SVG`).
> Le gate passe avec `--exclude nie-aphrody`. Validé, non adopté : la règle ci-dessous dit de ne
> committer pour un pair qu'une fois que ça passe, et ça ne passe pas.

- Read the A2A channel continuously; publish progress there rather than assuming a peer knows.
- When Codex or Gemini leaves a diff, **validate it before adopting it**: `cargo check`, the
  narrow clippy gate, the relevant tests. Report counts, not exit codes.
- Commit on a peer's behalf only once it passes, and attribute it:
  `feat(inacord): [peer-agent] <scope>` with `Co-authored-by: <Agent>`.
- Rebase on `origin/main` before pushing — peers push to the same branch.

## Cross-host verification — the two gates no unit test replaces

Both need a local `nie-site` (never the production one) and both EXIT NON-ZERO on regression:

```sh
./target/release/nie-site --listen 127.0.0.1:18099 &
bun --bun scripts/validation/compare-menu-layout.ts --sweep 30
#   30 écrans | identiques 27 | hors arrondi 3 | divergents 0    (2026-09-13)

./target/release/nie-site --listen 127.0.0.1:8085 &
bun --bun crates/engine/nie-lua-web/scripts/differential.ts
#   10/14 identical, plancher 10 (NIE_DIFFERENTIAL_FLOOR)        (2026-09-13)
```

They compare the SAME Rust compiled for two targets, which is the only way to check that
`wasm32` and the native host agree. Between them they have already caught a stale published
module, a comparison that reported "different" on every call, and a 10/14 → 3/14 regression that
no test noticed. Stop the server by explicit PID afterwards; never `pkill -f`.

## Generated and prebuilt artefacts — how to check each one (audited 2026-09-13)

Two of these were STALE when audited, and both failed silently: a binary that answers an old
version, a WebAssembly module that ignores a field the caller reads. Neither is visible in a
diff, so the list exists to be re-run rather than remembered.

| Artefact | Verify | Regenerate |
| --- | --- | --- |
| `packages/inacord-ui/src/shell/game-screens.css` | `cargo run -p nie-ui --bin game_screens_css -- --verify` | same, `--write` |
| `packages/inacord-ui/src/shell/game-tokens.css` | `cargo test -p nie-aphrody` | `cargo run -p nie-aphrody --bin design` |
| `packages/inacord-ui/src/lib/ui-text-map.ts` | re-run the generator and `git diff` | `python3 scripts/validation/ui-text-map.py` |
| `apps/nie-web/public/static/game/nie_wasm_bg.wasm` | compare its mtime/size against `crates/engine/nie-wasm/` | `bun run --filter nie-web build:wasm` |
| `apps/nie-web/public/static/game/nie_viewer_web_bg.wasm` | same | `bun run --filter nie-web build:wasm-viewer` |
| `apps/nie-web/public/static/game/nie_lua_web.wasm` | `lua-runtime.test.ts` (directional) | emsdk recipe in `nie-lua-web/README.md` |
| `target/release/libnie_ffi.so` | `bun run --filter '@aphrody/nie' test` | `cargo build -p nie-ffi --release` |

Only the first three are outside the build chain by design; `nie-lua-web` is outside it because
it needs emsdk, which is exactly why it went stale.

**Two corrections measured 2026-09-13.** `bun run build:wasm` does not exist at the repository
root — the script lives in `apps/nie-web/package.json`, so it needs `--filter nie-web` or a direct
`bun --bun apps/nie-web/scripts/build-wasm.ts`. And the old "verify" column said `bun run build`,
which is **not a verification**: it chains `vite build`, and `apps/nie-web/dist` is a symlink into
`var/deployments/…`, so that command PUBLISHES to `nie.aphrody.com`. Checking an artefact must
never be done with a command that deploys. The wasm scripts themselves are safe — they write to
`public/`, which vite only copies at build time.

- **Every list route of `nie-site` paginates, and CLIPS in silence.** `PER_PAGE_DEFAUT = 50`,
  `PER_PAGE_MAX = 200` (`crates/tools/nie-site/src/config.rs`): asking for more returns 200
  without an error, and the response only says so through `pages`/`per_page`. Two consumers
  written on 2026-09-12 were already clipped — `menu_text` gave 200 lines of 2 755, and
  `/api/v1/lua/scripts?q=chara_edit` 50 scripts of 51, so an avatar-editor screen replayed
  without one of its own. A client MUST read `pages` and fetch the rest; a fixed `per_page` is a
  bug waiting for the corpus to grow. Ask a route what it returns before trusting a parameter.

- **The browser Lua VM has 32-bit integers, and the game keys everything by CRC-32.**
  `LUA_INTEGER` is `ptrdiff_t` (`vendor/lua-src/lua-5.2.4/luaconf.h:462`) — 4 bytes on
  `wasm32-unknown-emscripten`, 8 on `x86-64`. `LUA_NUMBER` stays `double`, so arithmetic agrees,
  but an id past `i32::MAX` (half of all CRC-32 values) cannot round-trip as a `lua_Integer`.
  Measured 2026-09-13: the same command logs `0x88154DF4` as a Lua string in the browser and
  `2283097588` as a number natively, and `CMD_SET_TEXT` branches on that type. Do not read an
  `n/14` differential gap as a logic bug before ruling this out.

## Traps measured on this machine (2026-09-07)

- **`bun test --root <dir>` sweeps `var/releases/`; the packages' own scripts do not.** A
  deployment snapshot under `var/` carries a full copy of the sources, so running bun from the
  repository root reports failures that belong to an old release. Use `bun run test` (which fans
  out to each package) or a package's own script from its directory: `apps/nie-web` gives
  189 pass / 0 fail where `--root apps/nie-web/src` gives 3 phantom failures.
- **A stale `target/release/libnie_ffi.so` fails `@aphrody/nie` as a version desync.** Its test
  asserts the FFI library reports the crate's version; on 2026-09-13 both manifests said 0.6.0
  and the `.so`, dated 11 September, answered 0.5.11. Nothing is desynchronised — the artefact is
  old. `cargo build -p nie-ffi --release` fixes it, and no version should be bumped to "fix" it.

- **`data/lua_scripts/` DIVERGES from the game's VFS — do not analyse it.** It is a flat dump,
  and its `main_menu_inc_3.00.01.00.lua.bin` is 13 362 bytes where the VFS carries 13 092
  (`niers vfs find`, measured 2026-09-12). The larger copy DEFINES five globals the real file
  does not, which is enough to turn "these are `nie.exe` functions" into "these are Lua". Scan
  `data/lua_dump/` or `data/re/40-derived/dumps/lua-vfs-all/`, both VFS-shaped, and report
  findings with FULL paths: two mounts carry the same basename with different bytes.

- **`grep -r` silently skips binary files; `find … -print0 | xargs -0 grep -l` does not.**
  Searching the `.lua.bin` corpus for `SetCtrlGuideTextCommon` returned 0 files with `grep -rl`
  and 48 with the `xargs` form (measured 2026-09-12), which turned "this name does not exist in
  the game" into a written conclusion that was wrong. On this repository's binary corpora
  (`.lua.bin`, `.cfg.bin`, `.objbin`), prefer `niers grep`/`rg -a`, or the `xargs` form.

- **A wasm build killed "low on memory" wants `CARGO_BUILD_JOBS=1`, not a weaker LTO.** Three
  `nie-viewer-web` builds died that way while `earlyoom`'s own journal never dropped below 41 %
  available and logged no kill — the guard is the agent harness, and the pressure is
  `nie-model-serve` at ~13 GiB RSS (a production service for `cdn.aphrody.com`; restarting it is
  host state, not this repository's). Measured 2026-09-12: `-j 1` builds `wgpu` + `naga` under
  the profile's own `lto = "fat"` in 2 min 28 s. Dropping to `thin` costs 367 bytes and buys
  nothing; dropping LTO entirely costs 297 736. Lower the job count, keep the profile.
- **That pressure is CONFIGURED, not accidental — 18 GiB of CPK cache on a 45 GiB box.** The two
  services declare their own LRU budgets in `deploy/systemd/`: `NIE_CPK_CACHE_BUDGET_GIB=12` for
  `nie-model-serve`, `=6` for `nie-site` (default in `nie_formats::vfs` is 16). Measured
  2026-09-13, both sit UNDER budget — 11.1 GiB and 3.6 GiB — so a build that dies has lost to a
  design decision, not to a leak. `nie-site` grew from 0.35 to 3.6 GiB in half an hour of
  cross-host gate traffic, which is the LRU filling exactly as intended; do not read that curve
  as a regression, and do not restart a production service over it. Budget `-j 1`, or run the
  heavy gate when neither cache is warm.
- **`wgpu/webgl` costs +2.24 MiB and blows the 6 MiB module budget** (4 518 833 → 6 865 774,
  measured 2026-09-12). Serving WebGL from a *separate* crate costs 2 855 742 bytes paid only by
  browsers without WebGPU — the pattern to reach for when a backend is needed by a minority path.
- **`/etc/nginx` and `/etc/systemd` DRIFT from `deploy/`.** `diff` against `/etc` and run
  `ss -ltnp` before editing a vhost — the installed file had been repointed `:8083` → `:8084`
  and had `bxc.` split into its own file, none of which the repository knew.
- **A host answering 200 is not free.** `cdn.aphrody.com` was serving `bxc-site` on `:8084`,
  not a dead port. The measured map is [`docs/HOSTS-AND-PORTS.md`](docs/HOSTS-AND-PORTS.md);
  it wins over any plan that says otherwise.
- **`nginx -t` on a repository file needs stand-in certificates** (the real ones are root-only).
  `syntax is ok` followed by `open() "/run/nginx.pid" failed` is the expected non-root outcome —
  the config was read and loaded. Recipe in [`deploy/README.md`](deploy/README.md).
- **Three OVH accounts live here** ([`docs/OVH.md`](docs/OVH.md), tool `scripts/ops/ovh.py`). `aphrody.com` is only reachable with the keys in
  `~/.bash_secrets`; `~/.ovh.conf` sees `rosegriffon.fr` alone and returns **404 on the zone**,
  not 403 — which reads as "this zone does not exist" and sends you to the registrar. The
  python `ovh` module is not installed; sign the request by hand.
- **`nie-site`'s `reqwest` only has TLS through the `rustls` feature** (`rustls-tls` does not
  exist in 0.13). Without it every HTTPS call fails as "unreachable", which looks like a network
  outage rather than a binary with no certificate authority.
- **Adding a route to `nie-site` breaks four counters**: the assertion in `app.rs`, the
  `instances` array size in `tests/routes.rs`, `declarees.len()`, and `vus`.
- **The Rust site is the only game/wiki deployment.** Verify the exact service checkout before
  editing; never edit a tree while its build is running.
- **`data/` has THREE text trees; surveying one and calling it the corpus is off by 400×.**
  `data/dx11/text`, `data/common/text` and `data/oc/astro-lor/game/text`. A first pass over
  `data/dx11/text` alone reported 46 `[C]`, 28 `[CR]`, 18 `[CG]` and concluded `[CTEAMPARAM01]`
  was invented. Over all of `data/`: **38 455 markup occurrences, 56 distinct named tokens**,
  led by `[CPASSIVE01]` (11 722), `[CG]` (2 545), `[CN]` (731), `[CR]` (606) — and
  `"[CTEAMPARAM01]Bonus d'équipe[C]"` sits in `data/common/text/fr/menu_text.cfg.bin.json`,
  exactly as an older comment claimed. Same shape as the `data/lua_scripts/` trap below: two
  mounts, one surveyed.
- **Game text carries markup: serving it raw is right, PAINTING it raw is a bug.** `[CR]`…`[C]`
  opens and closes a named colour; `[$gaiji_system02]` substitutes an icon. The retained token is
  what FOLLOWS the `C` (`[CR]` → `"R"`), and an empty name closes. One implementation only —
  `nie_formats::menu_layout::colour_spans` / `plain_label`, on the side that paints. The browser
  has none: `ui-text-map.test.ts` fails if a mapped UI string ever carries one. Gaiji is left
  alone on purpose — it names a glyph the game DRAWS, so stripping it would delete an icon
  rather than a style.
- **That token NAMES a colour: `fontColorId == crc32(name)` in `font_color.cfg.bin`.** Measured
  2026-09-13 over the full corpus: **54 of the 56 distinct tokens resolve in the 70-entry
  palette, covering 99 % of the 18 683 named occurrences.** Only `G2` and `R2` do not, and
  neither does `L` (which `nie.exe` carries as `[CL]`) — do not invent colours for those three.
  The same names keeping the marker's `C` — `CR`, `CG`, `CTEAMPARAM01` — resolve to nothing,
  which is how the parse convention was confirmed independently. `MenuFont.palette` carries it
  and all three hosts fill it (`nie-site`, `nie-game`, `nie-wasm`); an absent palette paints
  white, never a guessed hue.
- **The wiki does NOT need a markup decoder — the Rust exporters already emit a display form.**
  `export_passives.rs` writes both `text_raw` (the game's string, markup intact, 1 694 marked
  entries per locale) and `description` (markup removed AND `<VALUE>` interpolated AND `\n`
  unescaped). The components read `description`; `text_raw` appears in their TYPES and is never
  rendered. Verified 2026-09-13 by walking all 5 082 marked strings in `passives-full.json` to
  their paths — every one is under `player[].text_raw`. So "the browser has no decoder" is not a
  gap: raw is preserved for fidelity, display is derived in Rust at export time, and adding a
  TypeScript stripper would duplicate a pass that already runs. Check which FIELD a component
  reads before concluding the brackets reach a user.

- **The knowledge base's build differs from `dist/nie.exe` — but its CLASS addresses hold.**
  `var/niers.sqlite` is anchored on `nie_eacpatched.exe` (31 468 032 B, `4c2b91fb…`); the target
  is 33 918 464 B, `b1fa04ea…`. The blanket warning "do not cite its numbers" is too strong:
  measured 2026-09-13, 1 745 class names are common and **all 1 745 carry the same
  `vtable_vaddr`**, zero divergence (only `GDSGroupCaptureCustomConfig`, `PostEventState` and
  `UniformBlockDataNode` are KB-only). Coverage COUNTS remain unusable as target measurements;
  class and vtable addresses are usable. Re-extract onto the target in one command — insert a
  `binary` row, then `niers rtti --exe dist/nie.exe --db <new.sqlite>` (2 906 COLs, 1 745
  classes).
- **`rtti_class.vtable_vaddr` is the COL slot, not the methods.** It holds the Complete Object
  Locator pointer; methods start at `+8`. Reading from it yields an `.rdata` address where a
  method is expected, which reads as a corrupt table rather than an off-by-one. Use
  `scripts/re/vtable.py`, which resolves the class by SCANNING the binary you name — so a build
  mismatch surfaces as "not found" instead of as a wrong address. Slots repeating one address
  are default stubs, not methods: on `CMenuListView@lives` (7 real methods of the first 14),
  `0x14004D760` is `C2 00 00` (`ret`) and `0x14004D780` is `32 C0 C3` (`xor al,al; ret`).

- **The uemu oracle WORKS; the 49 old proofs are anchored on a build that is gone.** Measured
  2026-09-13: `nie.exe`, `nie_eacpatched.exe` and `dist/nie.exe` are all the SAME file
  (`b1fa04ea…`, 33 918 464 B), so `NIE_EXE` changes nothing — and the build the knowledge base
  and the validators were written against (`4c2b91fb…`, 31 468 032 B) is nowhere on this machine.
  Two proofs written that day pass (`just preuves listview` → 2 ✓, 44 cases). The sampled old
  ones fail with stale EXPECTATIONS, not emulator errors: `validate_ball_ctor` reads 0 where it
  wants `-9.8f`, `validate_bezier` returns `(0,0,0)`, `validate_category_lookup` reports 600
  mismatches with every branch at zero. Do not read "47/47 failing" as "do not write proofs".
  Also: `just preuves` with no pattern chains 49 validators that each map the 33 MB PE and gets
  OOM-killed — filter it, which likely explains part of the historical "timeouts".

- **One function, several `.pdata` entries — read only the first and you truncate the body.**
  MSVC splits a function into chunks whose ranges touch end-to-end, each with its own unwind
  info. Measured on `lives::CMenuListView`: `0x140542B80` is 87 bytes in its own entry and 580
  across three chunks, with ALL its arithmetic in the second; `0x140542080` is 118 bytes in its
  entry and **1 971 across seven**. Truncated, a scroll step reads as a stub and a method that
  writes a field reads as one that does not — that misread happened three times before the tool
  existed. `scripts/re/extent.py` chains chunks by adjacency (previous `end` == next `start`),
  which is checkable from the file alone. Use it before disassembling anything.

- **Never put a gate and a `git commit` in the same shell invocation.** Measured the hard way on
  2026-09-13: `cargo test … ; cargo clippy … ; git commit …` ran the gate, printed its failure,
  and committed anyway — the output arrives after the commit has already happened, so it reads as
  a report rather than a decision. The crate did not compile (`error: expected one of '!' or
  '::', found 'quatre'` — a scripted doc-block replacement had dropped a `/// ` prefix). Run the
  gate, READ it, then commit in a separate call. This repository has no commit hook
  (`.git/hooks` holds only samples and is untracked), so nothing catches it for you.

- **Run `bun run typecheck` after any structural deletion.** Removing an entry from
  `config/navigation.ts` by pattern left an orphan brace (`TS1136`) that no grep would show.

## Building on this Windows box (measured 2026-09-11)

This machine has **no MSVC**: `link.exe` is absent, so the pinned msvc host
toolchain cannot link anything - not even a build script. Five obstacles sit
between a clean checkout and `bun run build`, and each fails with an error that
names the wrong culprit.

- **No C toolchain at all.** Install mingw-w64 (`winget install
  BrechtSanders.WinLibs.POSIX.MSVCRT --scope user`); Rust's `x86_64-pc-windows-gnu`
  target wants the **MSVCRT** runtime, not UCRT. Then drive cargo with
  `cargo +1.98.1-x86_64-pc-windows-gnu --target x86_64-pc-windows-gnu`.
- **`link` from MSYS shadows MSVC's `link.exe` in the Bash tool.** The failure reads
  `link: extra operand ...rcgu.o` - that is GNU coreutils `link`, not a linker
  error. Run cargo from **PowerShell**, where the MSYS `link` is not on PATH.
- **`cargo install` builds the host half with the default toolchain.** Pass
  `RUSTUP_TOOLCHAIN=1.98.1-x86_64-pc-windows-gnu`. `apps/nie-web/scripts/build-wasm.ts`
  calls bare `cargo`, so this env var is the only way to steer it.
- **`wasm32-unknown-unknown` is installed on the msvc toolchain only.**
  `rustup target add wasm32-unknown-unknown --toolchain 1.98.1-x86_64-pc-windows-gnu`.
- **`wasm-opt` is mandatory and hard to obtain.** Absent from winget, and the
  `wasm-opt` crate wraps C++ that does not link under windows-gnu. Install binaryen
  from npm instead: `bun add -g binaryen`. Do **not** skip the step: the script
  validates the module and enforces a byte budget on the optimized output.
- `wasm-bindgen` CLI must match the workspace pin exactly (0.2.125 here); the build
  refuses a mismatch by design.

Measured end state: `bun run build` exits 0 and writes `apps/nie-web/dist/`
(`index-*.js` ~589 KB, `index-*.css` ~310 KB, 10 files precompressed to 708 KiB
with Brotli). **Building is not deploying** - see below.

## What stays under the user's hand

The pre-approval covers reversible work. It does **not** silently extend to: deleting data,
force-pushing, rewriting shared history, rotating credentials, or changing what runs on a host
outside this repository's scope. `push` and `deploy` are done when the user asks for them, and
each one is reported with what actually changed.
