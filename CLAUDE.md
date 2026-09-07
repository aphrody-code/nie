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

Target and starting point: [`docs/TARGET-ARCHITECTURE.md`](docs/TARGET-ARCHITECTURE.md). Read it
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

## What stays under the user's hand

The pre-approval covers reversible work. It does **not** silently extend to: deleting data,
force-pushing, rewriting shared history, rotating credentials, or changing what runs on a host
outside this repository's scope. `push` and `deploy` are done when the user asks for them, and
each one is reported with what actually changed.
