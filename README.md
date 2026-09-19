<h1 align="center">nie</h1>

<p align="center">
  <strong>A byte-exact reimplementation of <em>Inazuma Eleven: Victory Road</em> in pure Rust —<br>
  and a forge that rebuilds the original <code>nie.exe</code>, byte for byte, to prove it.</strong>
</p>

<p align="center">
  <a href="https://github.com/aphrody-code/nie/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/aphrody-code/nie/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="version" src="https://img.shields.io/badge/version-0.6.0-blue">
  <img alt="rust" src="https://img.shields.io/badge/rust-1.98.1--stable-orange">
  <img alt="edition" src="https://img.shields.io/badge/edition-2024-orange">
  <img alt="forge" src="https://img.shields.io/badge/forge-74.06%25%20of%20nie.exe-yellow">
  <img alt="license" src="https://img.shields.io/badge/license-RG--L5--VR--2026--001-red">
</p>

<p align="center">
  <strong>Desktop app</strong> (VFS explorer + Blender add-on):
  <a href="https://nie.aphrody.com">nie.aphrody.com</a>
</p>

## Table of contents

- [Overview](#overview)
- [Status](#status)
- [The reverse-engineering workflow](#the-reverse-engineering-workflow)
- [Quick start](#quick-start)
- [Repository layout](#repository-layout)
- [The five shipped surfaces](#the-five-shipped-surfaces)
- [Platform support](#platform-support)
- [Development](#development)
- [Reverse-engineering bridge](#reverse-engineering-bridge)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Legal](#legal)
- [License](#license)

## Overview

Two halves of one goal, and each keeps the other honest:

1. **The engine** — the game rewritten in Rust: file formats parsed natively, game data loaded,
   matches simulated, assets decoded. Runs native and headless; a WebAssembly surface exposes the
   verified parts to the browser. It is **not a playable game yet** — see
   [known limits](#known-limits-stated-plainly).
2. **The forge** — `crates/forge/` *generates* `nie.exe` from this repository and fails the build
   unless the output is byte-identical to the original. It measures, to the byte, how much of the
   binary the repo actually produces; the rest is copied from the reference, and labelled as such.

The forge is the judge. Until a byte is produced by code in this repo, what it contains is not
understood. That turns "we ported a lot" into a falsifiable number.

Reverse engineering is the **means**, not the end.

> The repository is named after its target, `nie.exe`. The CLI stays `niers` — `nie` alone would
> name the game's binary.

## Status

Every number below is measured by a command, never copied from a document. Regenerate them
yourself:

| What | Measured | Command |
| --- | --- | --- |
| Bytes of `nie.exe` produced by this repo | **74.061759 %** of the file · **92.447995 %** of `.text` | `nie-forge report` |
| Files in the VFS | **255,308** across **936** CPK, 5 loose | `niers vfs stats` |
| VFS files a decoder claims, by extension dispatch | **99.56 %** (254,187 / 255,308) | `niers format data/` |
| VFS files recognised by **magic alone** | **50.05 %** (127,778 / 255,308) | `data/re/20-vfs/metrics/format-coverage.json` |
| Functions classified in the binary | **92.65 %** (100,664 / 108,650) · 13,653 named | `niers coverage --db var/niers.sqlite` |
| Functions ported **and** proven byte-exact | **43** | `uv run scripts/validate_re.py` |
| Test suite | see the CI badge above | `cargo test --workspace` |

Byte-exactness is not a slogan. A format counts as ported when it parses its **entire real
corpus**; a data table when it is recomputed **bit for bit** against the game's own dump; a
function when it matches an oracle — Unicorn emulation of that exact function from the real
binary (`scripts/uemu.py`), or the forge itself. Anything that cannot be validated is marked
incomplete rather than done.

### Known limits, stated plainly

- **This does not play like the game.** What renders today is a placeholder 2D menu, not IEVR's
  UI. The real menu is not in the files: it is built at runtime by the C++ menu manager, which
  reads `*_menu_setting.cfg.bin`, creates each object, and drives Lua through `funcLuaMenuCommand`.
  Until that build loop is ported, no screen looks like the original. It is priority #1.
- **Match resolution is nominal.** Reverse engineering shows shoot/save is a table-driven
  evaluator, not an inline formula, so `GOAL_RATE_BASE` in `match_sim` has no binary grounding —
  and the code says so. See [`docs/modele-de-match.md`](docs/modele-de-match.md).

What *is* solid: the file formats, the game data, the ported primitives, and the forge. Those are
the numbers in the table above.

## The reverse-engineering workflow

Reverse engineering here is a **loop with a scoreboard**, not a browsing session. Everything the
repository knows about the binary — files, crates, documents and what they claim, the 19 GB
knowledge base, the forge units, the binaries, the tools — is indexed in one database, the
**atlas**, and what is still missing is ranked.

```bash
just atlas                  # build the index + its Redis mirror  (~3 min from cold)
niers atlas status          # one measured line
niers atlas search <term>   # docs + symbols + tools + files + crates, in one query
niers atlas gaps            # the road to 100 %, ranked by (target − current) × weight
niers atlas next            # the next task, as JSON
bash scripts/atlas-loop.sh  # one autonomous tick: measure → index → rank → one bounded act → re-measure
```

Measured on `vps-203bea89`, 2026-09-11 — **regenerate, never quote**:

| Surface | Indexed |
| --- | --- |
| Files of the RE/forge chain | 6,743 (1.05 GiB), with SHA-256, zone and git-tracked flag |
| Crates | 46, with LOC, tests, `unsafe`, `EXTERN:`/`todo!()` |
| Markdown documents | 1,063, and the **13,793 machine references** they claim |
| Knowledge base | 52 tables, 41,297,157 rows, **13,845 named functions** |
| Forge units | 215,688 — **105,266** lifted to assembly, **7** byte-exact through C |
| Runnable tools | 178 (`niers` subcommands, `just` recipes, scripts) |

The loop obeys three rules. A number enters the index only with the command that produced it
(`atlas_metric`). A gap exists only if its metric was really measured — an absent measurement
leaves **no row**, never a zero that would read as "not started". And one tick performs exactly
one bounded, reversible act inside the repository: no push, no deletion, no service, with a disk
guard and a timeout.

Full description: [`docs/ATLAS.md`](docs/ATLAS.md). How it drives the plan: [`PLAN.md`](PLAN.md).

## Quick start

You need a legally owned copy of the game. On a Steam install, the game directory **is** the
current directory — no configuration needed.

```bash
cargo build --release

./target/release/niers vfs stats                    # what's in the game archives
./target/release/niers vfs find c01000010           # locate a character's files
./target/release/niers decode <file|dir>            # any game format → JSON / PNG
./target/release/nie-game --capture out.png         # render real assets to an image
```

Elsewhere, point at the install with `NIE_GAME_DIR`. No machine path is ever compiled into a
binary: the root is resolved at runtime from `NIE_GAME_DIR`, then the working directory or an
ancestor holding `data/cpk_list.cfg.bin`, then the executable's own directory.

For a Linux Steam setup, see [`docs/STEAM-LINUX.md`](docs/STEAM-LINUX.md): it documents the
native `nie-steam` depot path, the private token environment, Proton/Wine preparation and the
asset-independent `nie-headless` check. `nie-steam` speaks Steam's protocol and writes a
Steam-compatible tree; it is not a controller for the graphical Steam client.

A fresh clone holds the code and nothing else: the game files come from Steam, and the data
seams (mirror, episodes, VFS inventory) live on the server. **[`LOCAL.md`](LOCAL.md)** sets a
Windows workstation up end to end — Steam detection, `NIE_GAME_DIR`, and 102 MB fetched from the
server — with one command: `pwsh -File scripts\ops\bootstrap-windows.ps1`.

### Visual GLB QA

`niers render` produces reviewable artifacts from an assembled GLB: a lossless PNG for a stable
reference view and a looping GIF turntable for silhouette, UV and texture checks. It keeps the
same camera framing across runs and bounds dimensions and frame count so an accidental command
cannot exhaust the workstation.

```bash
# A reproducible real-character probe: Shawn Froste's c02023290 model.
niers render glb-png c02023290.glb -o shawn.png --width 2048 --height 2048 \
  --gpu --backend dx12 --hardware-only
niers render glb-gif c02023290.glb -o shawn-turntable.gif --width 720 --height 720 \
  --frames 24 --fps 12 --gpu --backend dx12 --hardware-only
```

Without `--gpu`, the deterministic CPU renderer is used. `--gpu` creates one renderer for the
entire export, uses linear texture filtering and smooth shading, and composites the transparent
viewport over the same opaque QA background as CPU captures. `--hardware-only` turns a missing
real adapter into a clear failure instead of silently testing a software adapter. A PNG/GIF is a
visual inspection aid, **not** proof of pixel-perfect equivalence to an in-game screenshot:
compare against a capture made with the same camera and record the backend.

### Rebuilding the binary

```bash
just forge          # split → lift → cc → build → verify → report
```

`build` fails if `sha256(dist/nie.exe)` differs from the reference. Never "fix" that check — it is
the contract.

## Repository layout

Two maintained ecosystems live under one root, each with a role it owns
([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

| Tree | Language | Role |
| --- | --- | --- |
| `crates/` | Rust | The engine, the forge, and the **only** user-facing CLI |
| `packages/`, `apps/` | Bun/TS | The wiki and its library, the data pipeline, the cron daemon, the Discord bots, the MCP server, the desktop app |
| `supabase/migrations/` | SQL | The schema of the extracted game data — replayable, idempotent, verified against production |

`niers` is the single entry point and is implemented in Rust. Format, Steam, and modding
operations do not require a second toolkit.

Where a new file goes, and why, is [`docs/ORGANISATION.md`](docs/ORGANISATION.md); each tree
also carries its own README ([`crates/`](crates/README.md), [`packages/`](packages/README.md),
[`apps/`](apps/README.md), [`scripts/`](scripts/README.md)). Historical port provenance is
tracked in [`docs/IECODE-MIGRATION.md`](docs/IECODE-MIGRATION.md).

### Rust crates (48 directories, 46 compiled — `cargo metadata --no-deps`)

- **`crates/forge/`** (10) — `nie-pe` (byte-exact PE64 read/write), `nie-asm` (x86-64 encoder in the
  MSVC dialect), `nie-forge` (the loop and the measurement), plus the RE scaffolding: `nie-re`,
  `nie-dump`, `nie-index`, `nie-seed`, `nie-queue`, `nie-trace`, `aphrody-re`.
- **`crates/engine/`** (23) — `nie-formats` (38 parsers: CPK, cfg.bin, the G4* family, Criware
  audio, DXBC, collision, navmesh), `nie-data` (121 typed config families), `nie-core` (ported
  game logic), `nie-lua` (the game's real Lua 5.2 VM), `nie-game` (wgpu host), `nie-wasm`,
  `nie-save`, and others.
- **`crates/tools/`** (13) — `nie-cli` (the `niers` binary), `nie-mcp`, `nie-site`,
  `nie-model-serve`, `nie-wiki`, `nie-zukan`, `nie-steam`, `nie-editor`, `nie-bench`,
  `nie-tasks`, `nie-launcher`, `nie-computer-use`, `ievr-tools`.
- **`crates/archive/`** (2) — excluded from the build. Read-only RE reference, compiled by nobody.

### Everything Inazuma Eleven lives here

The work used to be spread across three repositories. The same character existed four times over
— a row in the wiki's database, files in the VFS, strings in the reversed binary, an episode in
the anime catalogue — and nothing joined those four existences.

They now sit under one root, with Rust as the owner of the VFS, wiki mirror, formats, and reverse
bindings:

```bash
niers wiki chara "Mark Evans" --json
niers vfs find "mark" --json
```

| Source | What it holds | Where it lives |
| --- | --- | --- |
| **VFS** | the game's files, decoded on demand | `nie.exe`/`nie-model-serve` |
| **wiki** | read-only mirror queries and joins | `nie-wiki` + `var/mirror.sqlite` |
| **reverse** | the reverse of `nie.exe` | `var/niers.sqlite` |

Every IEVR query is implemented in Rust and reads only the local VFS or its read-only mirror.
See [`PLAN.md`](PLAN.md) for the measured ownership and verification ledger.

## The five shipped surfaces

Each one is built, released and deployed **on its own**. `bun run surfaces list` prints this with
the crate counts derived live from `cargo metadata`:

| Surface | Artefact | Root crate | Release tag |
| --- | --- | --- | --- |
| `cli` | `niers` — VFS, formats, the atlas | `nie-cli` | `cli-v*` |
| `mcp` | `nie-mcp` — native Model Context Protocol server | `nie-mcp` | `mcp-v*` |
| `site` | `nie-site` + the WebAssembly module it serves | `nie-site`, `nie-wasm` | `site-v*` |
| `desktop` | Inacord, the Tauri application | `inacord` | `desktop-v*` |
| `model` | `nie-model-serve`, the asset server | `nie-model-serve` | `model-v*` |

```bash
bun run surfaces plan            # which surfaces your diff can have broken
bun run gate                     # clippy, scoped to exactly those
bun run surfaces build site      # then build / smoke / deploy, one surface at a time
```

They are **not** separate CI lanes, and that is measured rather than assumed: the five closures
overlap so much (36 of 47 workspace members; `cli` owns none) that a lane each costs 19 638
crate-compilations over the last 400 commits against 18 800 for a single `clippy --workspace`.
One job scoped to the *union* of the affected surfaces costs **10 026** — 46.7 % less — because
34.5 % of commits reach no surface at all. The reasoning is in
[`CONTRIBUTING.md`](CONTRIBUTING.md#the-gate) and the code in `scripts/surfaces.ts`.

## Platform support

The same binary serves a headless Linux server and a Windows workstation:

| | Linux server | Windows workstation |
| --- | --- | --- |
| Graphics backend | Vulkan — lavapipe when there is no hardware | **D3D12** first, Vulkan as fallback |
| Adapter | the only one, software | `HighPerformance` → the discrete GPU |

Backends are probed **one at a time, in order** — handing wgpu a combined mask lets it pick, and
its order is not ours. Override with `NIE_WGPU_BACKEND` (`dx12`, `vulkan`, `metal`, `gl`) or force
the software path with `NIE_WGPU_FORCE_FALLBACK=1`.

Verified on an RTX 4070: D3D12, Vulkan and the software rasteriser produce captures with the
**same SHA-256**. A pixel gate held on a GPU-less server therefore reproduces on a workstation.

## Development

```bash
cargo clippy -p <crate> --lib --tests    # must be 0 warnings before any commit
cargo test --workspace                   # takes several minutes
cargo deny check advisories bans licenses sources
uv run scripts/validate_re.py            # byte-exact regression suite vs the real binary

bun install && bun run build:ffi         # build libnie_ffi first — the Bun plugin preloads it
bun run typecheck && bun run test
```

Workspace lints deny `todo!`, `unimplemented!` and `dbg!`. Game crates are `#![forbid(unsafe_code)]`.
Python goes through `uv run`, never a bare `python`.

The workspace pins Rust 1.98.1 with Edition 2024 and resolver 3. Package metadata, dependencies
and lints are inherited from the root manifest, including the Inacord host. Dev and test builds
keep line-table backtraces but disable full debug and incremental caches to bound `target/` on
constrained hosts; `cargo build --profile debugging` is the explicit full-symbol path. The
release gate enforces `deny.toml`: yanked or vulnerable dependencies fail, licenses and sources
are allowlisted, and the one no-fix transitive RSA advisory carries a scoped rationale.

Browser WebAssembly uses the dedicated `wasm-release` profile (fat LTO, aborting panics and
stripped symbols). `bun run --cwd apps/nie-web build:wasm` pins the `wasm-bindgen` CLI to the
workspace crate, generates the `web` target in temporary storage, runs `wasm-opt -O3` with the
explicit Rust/browser feature set, validates and smoke-tests the resulting module, enforces a
6 MiB budget, then replaces the tracked glue and binary atomically. Direct Bun consumers need a
separate `nodejs` target; the browser/Vite artifact remains `web` with explicit initialization.

Tests backed by the game's JSON dumps resolve their corpus from `NIE_GAMEDATA_JSON` and **announce
on stderr when they skip** — a golden that silently does nothing is a false green.

### Releasing

Per surface, with a prefixed tag — `git tag cli-v0.6.1` builds and publishes the CLI alone. A
single repository-wide tag would force all five to be rebuilt together, which in practice means
never publishing: the site moves on 17.2 % of commits, the CLI on 0.5 %.

The whole-repository entrypoint still exists for a coordinated release (`bun run release:all`,
`lint → typecheck → tests → clippy → build → push → deploy → live validation`; production
mutation needs an explicit `--deploy`), and its inverse is `bun run sync:main`, a read-only dry
run by default that only ever fast-forwards. Both are documented, with their guarantees and their
limits, in [`CONTRIBUTING.md`](CONTRIBUTING.md#shipping).

**A tag deploys nothing.** Production goes through `scripts/deploy-target.ts`, by hand, with its
own lock, per-target deadlines and live health checks.

Further reading: [`PLAN.md`](PLAN.md) (the canonical active plan and gate ledger) ·
[`docs/FORGE.md`](docs/FORGE.md) (producing the binary) ·
[`docs/RE.md`](docs/RE.md) (the target and the loop) ·
[`docs/FORMATS.md`](docs/FORMATS.md) (file formats).

## Reverse-engineering bridge

The entry point is the atlas (`niers atlas search`, `niers atlas gaps`); under it, the canonical
local chain is `Ghidra → nie-re/nie-index → nie-trace → nie-computer-use`.
`nie-re` owns static PE/`.pdata`/RTTI/vtable/disassembly analysis and the SQLite knowledge base;
`nie-trace` owns bounded live process reads and scans; `nie-computer-use` is the read-only typed
orchestration boundary. The source-to-consumer parity matrix and migration decision live in
[`docs/re/PARITY-AUDIT-2026-09-07.md`](docs/re/PARITY-AUDIT-2026-09-07.md).

Current measured gates: `nie-re` 72 passed / 0 failed, `nie-trace` 43 passed / 0 failed, and
`nie-computer-use` 5 passed / 0 failed. These do not yet prove Windows live-memory, PE/SQLite,
Ghidra MCP handshake, or wrong-build rejection. Existing Rust implementations are retained;
only the orchestration boundary is scheduled for migration, with provenance and explicit limits.

## Roadmap

**The cap.** One site that exposes the repository's verified capabilities and one unified
Inacord suite, measured rather than claimed. Scope, priorities and completion gates live only in
[`PLAN.md`](PLAN.md); superseded roadmaps are retained under
[`docs/archive/plans/`](docs/archive/plans/2026-09-08/README.md).


**nie** (`nie.aphrody.com`) is the site, served by a `crates/tools/nie-site` crate — Axum
0.8, **100 % Rust**, bound to `127.0.0.1:8085` behind nginx and TLS. `aphrody.com` and `www.`
answer a `308` to it and hold nothing themselves; the name **Aphrody** stays with
[`aphrody-code/aphrody`](https://github.com/aphrody-code/aphrody), and only the character
keeps it here (`crates/engine/nie-aphrody`, the pet routes, the auras).

**Its home page is the game.** `/` mounts `crates/engine/nie-wasm` — the ported logic compiled
to WebAssembly, driven by the keyboard, drawn into a canvas. Be exact about what that is:
`nie-wasm` renders a **2D placeholder**, not the game's interface, because the real menu is
built at runtime by the C++ menu-manager driving Lua through `funcLuaMenuCommand`, a loop that
is not ported. What the page proves is that the ported logic runs in a browser; it does not
prove fidelity, and nothing in this repository should claim otherwise.

Browser startup has one gate only: a zero-asset loading surface polls `/api/v1/health` until the
content-backed VFS is non-empty, both read-only SQLite schemas have opened successfully, and the
bundle is available. It then enters the menu directly. Video, soundtrack, bitmap-font, WASM decode
and secondary-scene preloads are deliberately outside that critical path; media remains available
on demand in its catalogue.

The catalogues (`/textures`, `/modeles`, `/sons`, `/videos`, `/explorateur`) are still served
with their own metadata, reachable from `/menu`, and deliberately absent from the sitemap: the
site is **neither the wiki nor the file explorer** — the wiki is **Azalée**, the explorer is
**Inacord**. It hosts `apps/nie-web`, the same interface as **Inacord**, the desktop and mobile
app (formerly `nie-explorer`). Both address resources by their **VFS path**, exactly like the
game does: no translated slug ever identifies a file. Only reproducible results and Inazuma
Eleven content covered by the agreement below are published; no personal data and no secret,
ever — the origin does not even name itself, `/healthz` returning measured capabilities and
neither a service name nor a version. Deployment (vhosts and units) is versioned under
[`deploy/`](deploy/README.md). Decisions and versions: [`PLAN.md`](PLAN.md);
week plan: [`PLAN.md`](PLAN.md); build and security rules: [`AGENTS.md`](AGENTS.md).

## Contributing

Start with **[`CONTRIBUTING.md`](CONTRIBUTING.md)**: the gate, the scope rules, how to commit, and
how to ship a surface. [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) is two pages and worth the two
minutes.

Two things before you read either: the gate before any commit is `bun run gate` (scoped clippy,
0 warnings), and identifiers, URLs and documentation are in **English** — French is for prose
addressed to a human.

This repository is also worked on by **several agents at once** (Claude Code, Codex), and the
rules that make that possible are written down once, each in exactly one place:

| What | Where |
|---|---|
| The entry point every agent reads first, whatever its engine | [`AGENTS.md`](AGENTS.md) |
| Every rule about this repository — tools, gates, traps, data, forge, RE | [`CLAUDE.md`](CLAUDE.md) |
| The agent-to-agent wire protocol | [`docs/A2A-CODEX.md`](docs/A2A-CODEX.md) |

## Legal

This is **not** a redistributable open-source game. Read [`LICENSE`](LICENSE) before doing
anything with this repository.

Work is carried out under **Official Commercial Exploitation Agreement No. RG-L5-VR-2026-001**
(8 August 2026) between Rose Griffon (Level 5 France) and LEVEL-5 Inc., which grants exclusive
rights to reverse-engineer, port, and build mods and tooling for the game.

- **No game asset is distributed here.** `data/` and `var/` are gitignored. The CPK archives, the
  textures, the audio, the reference screenshots and `nie.exe` itself are © LEVEL-5 Inc. and stay
  on the machine of whoever owns the game.
- `forge/asm/*.s` is derived material — exact instruction sequences lifted from `nie.exe` — and is
  never committed. `just forge-lift` regenerates it in seconds from your own copy.
- Provenance of each tree, and what was dropped on import: [`PROVENANCE.md`](PROVENANCE.md).

## License

Governed by the agreement in [`LICENSE`](LICENSE), not by an OSI licence.

> [!WARNING]
> The crate manifests declare `license = "MIT"`, which **does not match** the agreement in
> `LICENSE`. The agreement governs. This discrepancy is tracked and needs resolving.

---

<p align="center">
  Built by Rose Griffon · <a href="https://github.com/aphrody-code/nie">github.com/aphrody-code/nie</a>
</p>
