<h1 align="center">nie</h1>

<p align="center">
  <strong>A byte-exact reimplementation of <em>Inazuma Eleven: Victory Road</em> in pure Rust —<br>
  and a forge that rebuilds the original <code>nie.exe</code>, byte for byte, to prove it.</strong>
</p>

<p align="center">
  <a href="https://github.com/aphrody-code/nie/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/aphrody-code/nie/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="version" src="https://img.shields.io/badge/version-0.6.0-blue">
  <img alt="rust" src="https://img.shields.io/badge/rust-1.98.1--stable-orange">
  <img alt="forge" src="https://img.shields.io/badge/forge-74.06%25%20of%20nie.exe-yellow">
  <img alt="license" src="https://img.shields.io/badge/license-RG--L5--VR--2026--001-red">
</p>

<p align="center">
  <a href="https://nie.aphrody.com">nie.aphrody.com</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="PLAN.md">Roadmap</a>
</p>

---

Two halves of one goal, and each keeps the other honest.

**The engine** — the game rewritten in Rust: file formats parsed natively, game data loaded,
matches simulated, assets decoded. Runs native and headless; a WebAssembly surface exposes the
verified parts to the browser.

**The forge** — `crates/forge/` *generates* `nie.exe` from this repository and fails the build
unless the output is byte-identical to the original. Until a byte is produced by code in this
repo, what it contains is not understood. That turns "we ported a lot" into a falsifiable number.

> Reverse engineering is the **means**, not the end. The repository is named after its target,
> `nie.exe`; the CLI stays `niers`, because `nie` alone would name the game's binary.

## Status

Every number is produced by a command. Regenerate them — never quote them.

| What | Measured | Command |
| --- | --- | --- |
| Bytes of `nie.exe` produced by this repo | **74.06 %** of the file · **92.45 %** of `.text` | `nie-forge report` |
| Files in the VFS | **255 308** across 936 CPK | `niers vfs stats` |
| VFS files a decoder claims | **99.56 %** (254 187 / 255 308) | `niers format data/` |
| Functions classified in the binary | **92.65 %** (100 664 / 108 650) | `niers coverage` |
| Functions ported **and** proven byte-exact | **43** | `uv run scripts/validate_re.py` |

A format counts as ported when it parses its **entire real corpus**; a data table when it is
recomputed **bit for bit** against the game's own dump; a function when it matches an oracle —
Unicorn emulation of that exact function, or the forge itself.

### Known limits, stated plainly

- **This does not play like the game.** What renders today is a placeholder 2D menu. The real menu
  is built at runtime by the C++ menu manager driving Lua through `funcLuaMenuCommand`, and that
  loop is not ported. Priority #1 — see [`docs/SITE.md`](docs/SITE.md).
- **Match resolution is nominal.** Shoot/save is a table-driven evaluator, not an inline formula,
  so `GOAL_RATE_BASE` has no binary grounding — see [`docs/modele-de-match.md`](docs/modele-de-match.md).

What *is* solid: the file formats, the game data, the ported primitives, and the forge.

## Quick start

You need a legally owned copy of the game. On a Steam install, the game directory **is** the
current directory.

```bash
cargo build --release -p nie-cli

./target/release/niers vfs stats            # what's in the game archives
./target/release/niers vfs find c01000010   # locate a character's files
./target/release/niers decode <file|dir>    # any game format → JSON / PNG
```

Elsewhere, point at the install with `NIE_GAME_DIR`; no machine path is ever compiled into a
binary. Linux/Steam setup: [`docs/STEAM-LINUX.md`](docs/STEAM-LINUX.md). A Windows workstation
end to end: [`LOCAL.md`](LOCAL.md).

```bash
just forge    # split → lift → cc → build → verify → report
```

`forge build` fails if `sha256(dist/nie.exe)` differs from the reference. Never "fix" that check —
it is the contract.

## The five shipped surfaces

Each is built, released and deployed on its own. `bun run surfaces list` prints this with crate
counts derived live from `cargo metadata`.

| Surface | Artefact | Release tag |
| --- | --- | --- |
| `cli` | `niers` — VFS, formats, the atlas | `cli-v*` |
| `mcp` | `nie-mcp` — native Model Context Protocol server | `mcp-v*` |
| `site` | `nie-site` + the WebAssembly module it serves | `site-v*` |
| `desktop` | Inacord, the Tauri application | `desktop-v*` |
| `model` | `nie-model-serve`, the asset server | `model-v*` |

```bash
bun run surfaces plan        # which surfaces your diff can have broken
bun run gate                 # clippy, scoped to exactly those
bun run surfaces build site  # then build / smoke / deploy, one at a time
```

They are **not** separate CI lanes, and that is measured: the five closures overlap so much that
a lane each would cost *more* than the monolith. One job scoped to the union costs 46.7 % less.
The numbers are in [`CONTRIBUTING.md`](CONTRIBUTING.md#the-gate).

## Repository layout

| Tree | Language | Role |
| --- | --- | --- |
| `crates/forge/` (10) | Rust | Producing the binary, and the reverse that feeds it |
| `crates/engine/` (23) | Rust | The engine: 38 format parsers, game data, Lua VM, rendering |
| `crates/tools/` (13) | Rust | CLI, MCP, site, model server, wiki, editor |
| `apps/`, `packages/` | Bun/TS | Browser shell, desktop app, data pipeline, bots |
| `crates/archive/` (2) | Rust | Read-only port reference, compiled by nobody |

Where a new file goes: [`docs/ORGANISATION.md`](docs/ORGANISATION.md). Who owns what:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## The reverse-engineering loop

A loop with a scoreboard, not a browsing session. Files, crates, documents, the knowledge base,
the forge units and the tools are indexed in one database — the **atlas** — and what is missing
is ranked.

```bash
just atlas                  # build the index          (~3 min from cold)
niers atlas search <term>   # docs + symbols + tools + files + crates, in one query
niers atlas gaps            # the road to 100 %, ranked by (target − current) × weight
niers atlas next            # the next task, as JSON
```

A number enters the index only with the command that produced it. A gap exists only if its metric
was really measured — an absent measurement leaves **no row**, never a zero that would read as
"not started". Full description: [`docs/ATLAS.md`](docs/ATLAS.md).

## Documentation

[`docs/README.md`](docs/README.md) indexes every document under `docs/`, and a gate fails if one
is added without an entry. The active plan and gate ledger is [`PLAN.md`](PLAN.md) — the only roadmap.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md): the gate, the scope rules, how to commit, how to ship a
surface. Then [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security issues go through
[`SECURITY.md`](SECURITY.md), never a public issue.

This repository is also worked on by several agents at once; their rules live in
[`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md).

## Legal

**This is not a redistributable open-source project.** Read [`LICENSE`](LICENSE) first: it is
Official Commercial Exploitation Agreement **No. RG-L5-VR-2026-001** (8 August 2026) between Rose
Griffon (Level 5 France) and LEVEL-5 Inc., granting exclusive rights to reverse-engineer, port and
build mods and tooling for the game. It is not an OSI licence, and the crate manifests say so —
`license-file = "LICENSE"`, `publish = false`.

- **No game asset is distributed here.** `data/` and `var/` are gitignored. The CPK archives, the
  textures, the audio and `nie.exe` itself are © LEVEL-5 Inc. and stay on the machine of whoever
  owns the game.
- `forge/asm/*.s` is derived material — instruction sequences lifted from `nie.exe` — and is never
  committed. `just forge-lift` regenerates it from your own copy.
- Per-tree provenance: [`PROVENANCE.md`](PROVENANCE.md) · attribution: [`NOTICE`](NOTICE).

---

<p align="center">
  Built by Rose Griffon · <a href="https://github.com/aphrody-code/nie">github.com/aphrody-code/nie</a>
</p>
