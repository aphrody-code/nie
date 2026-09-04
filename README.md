# nie

**A byte-exact reimplementation of _Inazuma Eleven: Victory Road_ in pure Rust — and a forge that
rebuilds the original `nie.exe`, byte for byte, to prove it.**

![version](https://img.shields.io/badge/version-0.5.2-blue)
![rust](https://img.shields.io/badge/rust-nightly--2026--05--17-orange)
![tests](https://img.shields.io/badge/tests-2%2C448%20passing-brightgreen)
![forge](https://img.shields.io/badge/forge-69.37%25%20of%20nie.exe-yellow)

📥 **Desktop app** (VFS explorer + Blender add-on): **<https://azalee.rosegriffon.fr/tools/niers>**

---

## What this is

Two halves of one goal, and each keeps the other honest:

1. **The engine** — the game rewritten in Rust: file formats parsed natively, game data loaded,
   matches simulated, assets decoded. Runs native and headless; a WebAssembly surface exposes the
   verified parts to the browser. It is **not a playable game yet** — see the limits below.
2. **The forge** — `crates/forge/` *generates* `nie.exe` from this repository and fails the build
   unless the output is byte-identical to the original. It measures, to the byte, how much of the
   binary the repo actually produces; the rest is copied from the reference, and labelled as such.

The forge is the judge. Until a byte is produced by code in this repo, what it contains is not
understood. That turns "we ported a lot" into a falsifiable number.

Reverse engineering is the **means**, not the end.

The repository is named after its target, `nie.exe`. The CLI stays `niers` — `nie` alone would
name the game's binary.

## Status

Every number below is measured by a command, never copied from a document. Regenerate them
yourself:

| What | Measured | Command |
|---|---|---|
| Bytes of `nie.exe` produced by this repo | **69.37 %** of the file · **90.36 %** of `.text` | `nie-forge report` |
| VFS files in a format we parse | **99.56 %** (254,187 / 255,308 across 936 CPK) | `niers vfs stats` |
| Functions classified in the binary | **92.65 %** (100,664 / 108,650) · 13,653 named | `niers coverage --db var/niers.sqlite` |
| Functions ported **and** proven byte-exact | **43** | `uv run scripts/validate_re.py` |
| Test suite | **2,448 passing** | `cargo test --workspace` |

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

### Rebuilding the binary

```bash
just forge          # split → lift → cc → build → verify → report
```

`build` fails if `sha256(dist/nie.exe)` differs from the reference. Never "fix" that check — it is
the contract.

## Repository layout

Four implementations live under one root, each with a role it owns
([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

| Tree | Language | Role |
|---|---|---|
| `crates/` | Rust | The engine, the forge, and the **only** user-facing CLI |
| `src/` | C++ | The `iecode` toolkit; decompiled C on its way to a playable `nie` |
| `csharp/` | C# | Dumping, packing, memory reading, texture conversion |
| `packages/`, `apps/` | Bun/TS | The wiki and its library, the data pipeline, the cron daemon, the Discord bots, the MCP server, the desktop app |
| `supabase/migrations/` | SQL | The schema of the extracted game data — replayable, idempotent, verified against production |

`niers` is the single entry point: `niers cpp …` and `niers cs …` delegate to the other two
toolchains, `niers backends` reports what is built and where.

### Everything Inazuma Eleven lives here

The work used to be spread across three repositories. The same character existed four times over
— a row in the wiki's database, files in the VFS, strings in the reversed binary, an episode in
the anime catalogue — and nothing joined those four existences.

They now sit under one root, and `@niers/catalog` is the joint:

```bash
bun --bun packages/nie-catalog/src/cli.ts etat
bun --bun packages/nie-catalog/src/cli.ts personnage mark-evans-0x06E25622
```

| Gisement | What it holds | Where it lives |
|---|---|---|
| **jeu** | the game's files, decoded on demand | `nie-model-serve` — `NIE_CDN_URL` |
| **extrait** | 66 `inagle_*` tables pulled from those files | `var/mirror.sqlite` |
| **re** | the reverse of `nie.exe` | `var/niers.sqlite` |
| **anime** | the series' episodes | `data/anime/episodes.db` |

Every join carries how it was obtained — a shared key, a path prefix, or a name match. That last
one matters: the game and the series share no key at all, so a name match is useful but is never
presented as a fact. See [`docs/FUSION.md`](docs/FUSION.md) and
[`packages/nie-catalog/README.md`](packages/nie-catalog/README.md).

### Rust crates (34 total, 32 compiled)

- **`crates/forge/`** (8) — `nie-pe` (byte-exact PE64 read/write), `nie-asm` (x86-64 encoder in the
  MSVC dialect), `nie-forge` (the loop and the measurement), plus the RE scaffolding: `nie-re`,
  `nie-index`, `nie-seed`, `nie-queue`, `nie-trace`.
- **`crates/engine/`** (16) — `nie-formats` (38 parsers: CPK, cfg.bin, the G4* family, Criware
  audio, DXBC, collision, navmesh), `nie-data` (121 typed config families), `nie-core` (ported
  game logic), `nie-lua` (the game's real Lua 5.2 VM), `nie-game` (wgpu host), `nie-wasm`,
  `nie-save`, and others.
- **`crates/tools/`** (8) — `nie-cli` (the `niers` binary), `nie-wiki`, `nie-zukan`, `nie-steam`,
  `nie-model-serve`, `nie-editor`, `nie-bench`, `nie-tasks`.
- **`crates/archive/`** (2) — excluded from the build. Read-only RE reference, compiled by nobody.

## Platform support

The same binary serves a headless Linux server and a Windows workstation:

| | Linux server | Windows workstation |
|---|---|---|
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
uv run scripts/validate_re.py            # byte-exact regression suite vs the real binary

bun install && bun run build:ffi         # build libnie_ffi first — the Bun plugin preloads it
bun run typecheck && bun run test
```

Workspace lints deny `todo!`, `unimplemented!` and `dbg!`. Game crates are `#![forbid(unsafe_code)]`.
Python goes through `uv run`, never a bare `python`.

Tests backed by the game's JSON dumps resolve their corpus from `NIE_GAMEDATA_JSON` and **announce
on stderr when they skip** — a golden that silently does nothing is a false green.

More: [`docs/PLAN.md`](docs/PLAN.md) (the plan, with numbers) ·
[`docs/FORGE.md`](docs/FORGE.md) (producing the binary) ·
[`docs/RE.md`](docs/RE.md) (the target and the loop) ·
[`docs/FORMATS.md`](docs/FORMATS.md) (file formats) ·
[`apps/nie-explorer/ROADMAP.md`](apps/nie-explorer/ROADMAP.md) (desktop app).

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

> **Note:** the crate manifests declare `license = "MIT"`, which does not match the agreement in
> `LICENSE`. The agreement governs. This discrepancy is tracked and needs resolving.

---

Built by Rose Griffon · <https://github.com/aphrody-code/nie>

## Future vitrine Rust

`nie.aphrody.com` est réservé à une vitrine Axum/Tokio 100 % Rust intégrée à ce
workspace. Elle présentera uniquement les résultats reproductibles et les
contenus Inazuma Eleven dont l'exploitation et la diffusion sont autorisées par
l'Accord Commercial Officiel N° RG-L5-VR-2026-001, y compris les assets prévus
par celui-ci. Aucune donnée personnelle ni aucun secret ne sera publié. Les
règles de construction et de sécurité sont définies dans [`AGENTS.md`](AGENTS.md).
