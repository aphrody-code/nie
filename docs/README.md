# Documentation index

Every document under `docs/` is listed here, and a gate enforces it: `bun run docs:check` fails if
a file is added to this directory without an entry below. Measured 2026-09-19, **16 of 34
documents were missing** from the previous index — including `ARCHITECTURE.md`, which 22 other
files link to. An index that covers half the corpus is worse than no index, because it reads as
exhaustive.

The repository has one active execution plan: [`../PLAN.md`](../PLAN.md). Documents here provide
evidence and specifications; they do not define competing priorities. Superseded plans are
preserved in the dated [`archive/plans/`](archive/plans/2026-09-08/README.md).

## Start here

| Document | What it owns |
| --- | --- |
| [`../README.md`](../README.md) | What the project is, its measured status, the five shipped surfaces. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | The gate, commit and PR rules, and how to build/release/deploy one surface. |
| [`../PLAN.md`](../PLAN.md) | The only active roadmap and gate ledger. Architecture ownership, priorities, measured state. |
| [`../AGENTS.md`](../AGENTS.md) | Short operational instructions every agent reads first, whatever its engine. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Who does what under this root, and **what must never be merged**. |
| [`ORGANISATION.md`](ORGANISATION.md) | Where a new file goes, and why. Modelled on `openai/codex`. |

## Reverse engineering, the binary and its formats

| Document | What it owns |
| --- | --- |
| [`ATLAS.md`](ATLAS.md) | The single index of every RE surface (files, crates, docs, KB digest, forge, tools) and the loop that aims at 100 %. |
| [`RE.md`](RE.md) | The RE knowledge base, function anchoring, decompiled structures. |
| [`FORGE.md`](FORGE.md) | Producing `nie.exe` byte for byte, and the measurement that judges it. |
| [`FORMATS.md`](FORMATS.md) | CPK, RDBN, T2B, the G4\* family, Criware audio — the container specifications. |
| [`VFS.md`](VFS.md) | The virtual file system and its 255 342 indexed files. |
| [`CAMERA-G4CM.md`](CAMERA-G4CM.md) | The cutscene cameras: 1 215 `.g4cm` decoded, and what still blocks. |
| [`COMPUTER-USE-RE-TRACE.md`](COMPUTER-USE-RE-TRACE.md) | The read-only boundary, provenance, guardrails, and the `nie-re`/`nie-trace` migration decision. |
| [`RE-MIGRATION-MAP.md`](RE-MIGRATION-MAP.md) | Subsystem classification of nie.exe (117,068 functions) and roadmap for migration to Rust. |
| [`re/README.md`](re/README.md) | Canonical centre for RE data and the local → consumer → Rust → parity audit rule. |
| [`nie-rtti-classes.txt`](nie-rtti-classes.txt) | Raw RTTI class listing extracted from the binary. |
| [`dll-exports/`](dll-exports/) | Export tables of the DLLs the game loads. |

## Engine, rendering and the game's screens

| Document | What it owns |
| --- | --- |
| [`STACK.md`](STACK.md) | Engine runtime architecture, Lua 5.2 integration, the main loop. |
| [`DESIGN.md`](DESIGN.md) | Pixel-perfect rendering of the Start, Menu and HUD screens, measured on real captures. |
| [`DESIGN-UI.md`](DESIGN-UI.md) | The UI design system derived from those measurements. |
| [`GAME-SCREENS-PLAN.md`](GAME-SCREENS-PLAN.md) | Every wiki page and Inacord view reached from the main menu, drawn with the game's own layouts. |
| [`AVATAR.md`](AVATAR.md) | Full specification of the avatar editor (`chara_edit`). |
| [`modele-de-match.md`](modele-de-match.md) | Match simulation, and the shoot/save evaluator as actually reversed. |
| [`mainmenu01-visual-analysis.md`](mainmenu01-visual-analysis.md) | Measurements and visual analysis of the `mainmenu01` layer. |
| [`ui-convergence-visual-analysis.md`](ui-convergence-visual-analysis.md) | Where `nie-web` and Inacord agree visually, and where they do not. |
| [`RENDER-QA.md`](RENDER-QA.md) | Graphics backends per platform, visual QA of an assembled GLB, and why the three rasterisers must be compared on a non-square viewport. |
| [`BENCHMARKS.md`](BENCHMARKS.md) | Comparative performance measurements. |
| [`VIDEO-STACK.md`](VIDEO-STACK.md) | The video stack chosen across the Rust and Bun ecosystems, measured on this machine. |
| [`game-data/`](game-data/) | Extracted game-data references. |
| [`vfs/`](vfs/) | VFS inventories and per-mount notes. |
| [`architecture/`](architecture/) | Ownership and shared-surface contracts per application. |

## Applications, services and content

| Document | What it owns |
| --- | --- |
| [`SITE.md`](SITE.md) | What `nie.aphrody.com` is and is not: names, the placeholder home page, the one startup gate, the silent pagination clip. |
| [`MCP.md`](MCP.md) | The pure-Rust native MCP server (`rmcp`), its security model and its tests. |
| [`NIE-ET-CLI.md`](NIE-ET-CLI.md) | Architecture of `nie.exe` and complete operational manual of the `niers` CLI. |
| [`INSTALLATION.md`](INSTALLATION.md) | Installing the `niers` CLI from the `nie-cli` package. |
| [`STEAM-LINUX.md`](STEAM-LINUX.md) | Steam/Proton/SteamCMD setup for running `nie.exe` natively on Linux. |
| [`IEVR-SAVE-EDITOR-PORT.md`](IEVR-SAVE-EDITOR-PORT.md) | Reverse engineering and native Rust port of the Save Editor (v2.2.2, .NET 9): 33 memory hooks, 142 Spirit Cards, 1 299 Supertechniques. |
| [`IEVR-ULTIMATE-TEAM.md`](IEVR-ULTIMATE-TEAM.md) | Full native port of IEVR Ultimate Team: Supabase mirror (497 players, 69 teams, 8 packs), 663 assets (28 MB), pack simulator, 2D formation placement (9 canonical + dynamic algorithm A), AES-256-GCM, EAC bypass and MCP. |
| [`NIE-ONLINE-MODE.md`](NIE-ONLINE-MODE.md) | The reversed network subsystem of `nie.exe` (Level-5 / Epic Online Services) and the `nie-net` community multiplayer architecture. |
| [`esport/`](esport/) | Inazuma Eleven VR e-sport & competitive specification: 11 rank tiers, directional ELO, dynamic matchmaking, double validation, tournaments and clans. |
| [`ASTRO-LOR.md`](ASTRO-LOR.md) | Astro Lor, an **original** character: present in no CPK, produced entirely here. |
| [`EXPORT-APP.md`](EXPORT-APP.md) | The app-icon export tool: 30 000+ files to WebP + zstd in one archive. |
| [`BXC-NATIVE.md`](BXC-NATIVE.md) | Why the BXC browser engine stays consumed from npm while `ietv`/`zukan`/`wonderbot` stay here. |

## Operations and infrastructure

| Document | What it owns |
| --- | --- |
| [`HOSTS-AND-PORTS.md`](HOSTS-AND-PORTS.md) | **Measured** hosts, ports and DNS. Authoritative against any plan that says otherwise. |
| [`OVH.md`](OVH.md) | The three OVH accounts, their zones, records and procedures. Measured, not assumed. |
| [`legal/`](legal/) | The signed exploitation agreement and its annexes. |

## Agents and multi-engine work

| Document | What it owns |
| --- | --- |
| [`A2A-CODEX.md`](A2A-CODEX.md) | The agent-to-agent wire protocol. The rules about *not overwriting each other* live in `AGENTS.md` § 2. |
| [`WORKFLOW-UNIFIE.md`](WORKFLOW-UNIFIE.md) | Going from a human request to a reproducible proof, across nie/WinClean/niers/Ghidra. |

## History

| Document | What it owns |
| --- | --- |
| [`../PROVENANCE.md`](../PROVENANCE.md) | Per-tree provenance, and what was dropped on import. |
| [`IECODE-MIGRATION.md`](IECODE-MIGRATION.md) | The source-to-crate ledger of the C++ and C# toolkits, exported 2026-09-07. |
| [`ABSORPTION-IECODE.md`](ABSORPTION-IECODE.md) | The absorption gate, closed. `niers` is the maintained implementation. |
| [`archive/`](archive/) | Superseded plans, kept dated rather than deleted. |

## The two invariants

1. **No blind commit.** A gate is passed only when a command has run and returned an exact count
   — lines, links, bytes, exit code. Paste the output, not the intention.
2. **A deployed service is not done until it answers.** A live request on its port or domain has
   to certify the status; `systemctl is-active` does not.

## RE anchors

Knowledge base (`var/niers.sqlite`) tables:
- `function` — 117 068 functions of `nie.exe`
- `coverage` — binary coverage metrics
- `xref` — call-graph topology
- `pdata_func` — `.pdata` function boundaries
- `hash_name` — VFS CRC32 table
- `forge_unit` — unit compilation tracking
- `rtti_class` — RTTI MSVC hierarchy

Key binary addresses:
- `0x1404ecd60` — Mesh transform dispatch
- `0x1406d5840` — Main tick loop
