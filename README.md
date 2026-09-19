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
  <a href="docs/NIE-ET-CLI.md">nie.exe & CLI Guide</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="PLAN.md">Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## Overview

Two halves of one goal, and each keeps the other honest.

- **The engine** (`crates/engine/*`): The game rewritten natively in pure Rust. File formats parsed without external dependencies, game data loaded bit for bit, match simulation, Lua 5.2 VM, and 3D rendering pipeline.
- **The forge** (`crates/forge/*`): Generates `nie.exe` directly from this repository, verified byte-for-byte against the original binary. If output hash differs from reference, the gate fails.

> Reverse engineering is the **means**, not the end. The repository is named after its target, `nie.exe`. The unified CLI binary is named **`niers`** (crate `crates/tools/nie-cli`).

---

## Status

Every number is measured by automated gates — never estimated.

| Metric | Measured Value | Verification Command |
| --- | --- | --- |
| Bytes of `nie.exe` produced by this repo | **74.06 %** of file · **92.45 %** of `.text` | `nie-forge report` |
| Files indexed in real VFS | **255 342** across 936 CPKs | `niers vfs stats` |
| VFS format recognition rate | **> 82.16 %** parsed structured (97.8% reachable) | `niers vfs formats` |
| Functions classified in binary | **117 068** (.pdata unwinds) | `niers coverage` |
| Functions proven byte-exact | **43** (Unicorn oracle & forge) | `uv run scripts/validate_re.py` |

---

## Quick Start & `niers` CLI

To explore and inspect game assets directly from your Steam / Proton installation without copying files:

```bash
# Build the unified CLI
cargo build --release -p nie-cli

# Point to your game installation (Linux/Steam or Windows)
export NIE_GAME_DIR="/home/ubuntu/.local/share/Steam/iecode/inazuma"

# VFS exploration: stats, locate files, inspect structured data
./target/release/niers vfs stats
./target/release/niers vfs find "menu_text"
./target/release/niers vfs cat data/common/text/fr/menu_text.cfg.bin

# Decode textures to PNG or inspect 3D models directly
./target/release/niers vfs cat data/dx11/menu/200_icon/10_icon_chr/face/c01001900_l.g4tx --png-out /tmp/aphrody.png
./target/release/niers vfs chara Byron

# Complete manual and command reference:
# See docs/NIE-ET-CLI.md
```

---

## The Five Shipped Surfaces

Each surface is built, tested, and deployed independently:

| Surface | Artifact | Target & Role |
| --- | --- | --- |
| `cli` | `niers` | Unified Rust CLI: VFS exploration, formats decoder, RE atlas. |
| `mcp` | `nie-mcp` | Native Model Context Protocol server for AI coding agents (`rmcp`). |
| `site` | `nie-site` | `nie.aphrody.com` server + client WebAssembly runtime (`nie-wasm`). |
| `desktop` | `inacord` | Cross-platform desktop application powered by Tauri v2. |
| `model` | `nie-model-serve` | 3D asset conversion and streaming server. |

Commands for surface validation:
```bash
bun run surfaces plan        # Detect affected surfaces for your git diff
bun run gate                 # Scoped Rust clippy and TypeScript typecheck
bun run surfaces build site  # Build specific surface
```

---

## Repository Structure

```
niers/
├── crates/
│   ├── engine/   (23) Pure Rust engine: formats (CPK/cfg.bin/G4*), data, Lua 5.2 VM, core simulation, wgpu
│   ├── forge/    (10) Binary reconstruction, PE64 assembler, RTTI extractor, forge pipeline
│   ├── tools/    (13) Unified CLI (niers), MCP server, web site, model serving, editor
│   └── archive/   (2) Reference read-only decompilation archives (excluded from workspace)
├── apps/              WebAssembly web shell (nie-web), desktop application (inacord)
├── packages/          Shared contracts, design system (inacord-ui), asset pipeline
└── docs/              Exhaustive documentation indexed and verified by `bun run docs:check`
```

---

## Key Documentation

All documentation is indexed and verified in [`docs/README.md`](docs/README.md).
- **[`docs/NIE-ET-CLI.md`](docs/NIE-ET-CLI.md)** : Comprehensive architecture guide for `nie.exe` and user manual for `niers` CLI.
- **[`docs/RE-MIGRATION-MAP.md`](docs/RE-MIGRATION-MAP.md)** : 117,068 functions classified across subsystems and Rust migration roadmap.
- **[`docs/FORMATS.md`](docs/FORMATS.md)** : Specifications for Level-5 (G4*, cfg.bin) and CriWare (CPK, USM, AWB) formats.
- **[`docs/VFS.md`](docs/VFS.md)** : Virtual File System layout (255k+ files, 936 CPKs).
- **[`PLAN.md`](PLAN.md)** : The single source of truth for repository roadmap, active tasks, and quality gates.

---

## Contributing & Quality Gates

Before committing, ensure all quality gates pass:
```bash
cargo clippy -p <crate> --lib --tests -- -D warnings
cargo check --workspace --tests
bun run typecheck
bun run docs:check
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for full instructions, branching model, and multi-agent coordination rules ([`AGENTS.md`](AGENTS.md)).

---

## Legal & Licensing

**This is not a redistributable open-source game.** Read [`LICENSE`](LICENSE): Official Commercial Exploitation Agreement **No. RG-L5-VR-2026-001** between Rose Griffon and LEVEL-5 Inc.
- **No copyrighted game asset is tracked or committed.** `data/` and `var/` are gitignored. Assets remain on the user's licensed Steam installation.
- Attribution details: [`NOTICE`](NOTICE) · Provenance ledger: [`PROVENANCE.md`](PROVENANCE.md).
