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

- Read the A2A channel continuously; publish progress there rather than assuming a peer knows.
- When Codex or Gemini leaves a diff, **validate it before adopting it**: `cargo check`, the
  narrow clippy gate, the relevant tests. Report counts, not exit codes.
- Commit on a peer's behalf only once it passes, and attribute it:
  `feat(inacord): [peer-agent] <scope>` with `Co-authored-by: <Agent>`.
- Rebase on `origin/main` before pushing — peers push to the same branch.

## Traps measured on this machine (2026-09-07)

- **A wasm build killed "low on memory" wants `CARGO_BUILD_JOBS=1`, not a weaker LTO.** Three
  `nie-viewer-web` builds died that way while `earlyoom`'s own journal never dropped below 41 %
  available and logged no kill — the guard is the agent harness, and the pressure is
  `nie-model-serve` at ~13 GiB RSS (a production service for `cdn.aphrody.com`; restarting it is
  host state, not this repository's). Measured 2026-09-12: `-j 1` builds `wgpu` + `naga` under
  the profile's own `lto = "fat"` in 2 min 28 s. Dropping to `thin` costs 367 bytes and buys
  nothing; dropping LTO entirely costs 297 736. Lower the job count, keep the profile.
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
