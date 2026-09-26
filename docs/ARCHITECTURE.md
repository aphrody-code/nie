# Architecture

Une implémentation maintenue d'IEVR sous une racine. Ce document dit **qui fait quoi** et
**ce qu'il ne faut jamais fusionner**. Le détail de l'absorption historique est dans
[`IECODE-MIGRATION.md`](IECODE-MIGRATION.md).

## Les arbres maintenus

| Arbre | Racine | Volume | Build |
|---|---|---|---|
| Rust — moteur, forge et outils | `crates/`, `apps/inacord/src-tauri` | workspace Cargo | `cargo` |
| TypeScript/Bun | `packages/`, `apps/` | workspaces Bun | `bun` |

`just all-build` · `just all-test` · `just all-check` pilotent ces deux chaînes.

## Inacord boundary

Inacord Desktop is deliberately a visual, user-facing VFS explorer: it mounts/browses the game
filesystem and previews decoded resources. It is not the GUI owner for wiki/data queries, 3D
authoring, modding, reverse engineering, Lua, live memory or archive tooling. Those capabilities
remain in their existing Rust owners and are consumed through API, CLI, MCP, code and scripts;
read-only preview data may be rendered by the explorer without turning the GUI into an operator.
The desktop view registry therefore has one route: `inacord/explorer`.

## Doctrine — un rôle, un langage

| Langage | Rôles |
|---|---|
| **Rust** | la seule CLI, GUI, core lib, wasm, RE, byte-exact et runtime |
| **Bun/TS** | types, contrats WebView et UI |

Règles qui en découlent :

- `nie-formats::g4tx_decode` reste Rust : sans lui, wasm n'a pas d'images.
- Porter une capacité se justifie par la doctrine ou par une contrainte technique (byte-exact,
  wasm, dépendance native) — jamais par le goût du langage.

## La CLI unique

```bash
nie decode <src>    # fichier ou arborescence → JSON / PNG (rayon)
nie viola dump ...  # extraction VFS native
nie steam sync ...  # acquisition Steam native
```

Il n'existe plus de délégation vers un binaire C++, une assembly .NET, CMake ou vcpkg.

## Les crates Rust

**47 workspace members** (measured 2026-09-25: `ls -d crates/{forge,engine,tools}/*/` gives
9 forge + 25 engine + 12 tools = 46 crates, plus `apps/inacord/src-tauri`; `members` in the root
`Cargo.toml`), grouped by role below. The `tests` column is a SNAPSHOT, not an invariant: it dates
from 2026-09-08 (`nie-wasm` said 32 where 66 were real) and rows added since carry `—`. Read it as
an order of magnitude; the source is `cargo test -p <crate> --lib`. `crates/archive/*` (2 crates,
not among the 47) is **outside the workspace**: `nie-engine` is excluded explicitly
(`exclude = […]` in the root `Cargo.toml` — ~15 000 lines ported from decompiled C, 434
`// EXTERN:` markers, consumed by no live crate); `nie-rs` never appeared in `members` (its own
standalone `Cargo.lock`, originating in the external `iecode-re` tool, not a nie deliverable).
Both stay read-only porting references, never built by `cargo build --workspace`.

**Six portable crates live in the sibling `../iecode` repository**, not here, and are consumed
through path dependencies in the root `[workspace.dependencies]`: `iecode-re` (alias
`aphrody-re`), `iecode-sql` (`nie-sql`), `iecode-video` (`nie-video`), `iecode-emu` (`nie-emu`),
`iecode-geom` (`nie-geom`), `iecode-tasks` (`nie-tasks`). They were absorbed by iecode on
2026-09-22 (no source copy remains under `crates/`). The `../iecode/crates/*` path edges stay
until those crates are published to crates.io, which needs a `CARGO_REGISTRY_TOKEN` that is not
configured; removing the path edge before publication breaks the workspace build. The ledger is in
[`IECODE-MIGRATION.md`](IECODE-MIGRATION.md).

### `crates/forge/*` — produire le binaire (9)

| Crate | Rôle | Tests |
|---|---|---:|
| `nie-pe` | Lecture/écriture byte-exacte du PE64 + découpage du fichier en unités de forge | 24 |
| `nie-asm` | Encodeur x86-64 dialecte MSVC — réassemble les corps depuis `forge/asm/*.s` | 23 |
| `nie-forge` | Boucle `split`/`lift`/`cc`/`build`/`verify`/`report`, mesure la part produite | 33 |
| `nie-re` | RTTI MSVC, indexation goblin/iced-x86, propagation de labels sur le call-graph | 73 |
| `nie-index` | Base de connaissance SQLite (`var/nie.sqlite`) | 4 |
| `nie-seed` | Import du savoir fusionné (index Ghidra, RTTI, formats iecode, hash→nom inagle) | 24 |
| `nie-queue` | Frontière BFS dédupliquée (redis), workers parallèles sur fonctions non résolues | 0 |
| `nie-dump` | Lecture/scan AOB d'un minidump Windows de `nie.exe` | 6 |
| `nie-trace` | RE en direct : lecture de la mémoire d'un `nie.exe` en cours d'exécution | 93 |

### `crates/engine/*` — le moteur (25)

| Crate | Rôle | Tests |
|---|---|---:|
| `nie-formats` | Parsers Level-5 (CPK, cfg.bin, G4*, CriLayla, Criware), `no_std`-friendly | 386 |
| `nie-data` | Modèles de données du jeu (skills, auras, chara_param, items, growth) | 1445 |
| `nie-core` | Logique reversée (ballon, IA tactique, FSM de match, gardien, stats, CRand) | 311 |
| `nie-lua` | VM Lua 5.2 réelle (mlua, PUC-Rio 5.2.4 vendored) + analyse statique tree-sitter | 107 |
| `nie-camera` | Modèle et contrôleurs de caméra portés (`CCameraCtrl*`), codec G4CM, pilotage live | 33 |
| `nie-app` | Machine à états d'écran (`GameState`) + rendu abstrait (trait `Renderer`) | 17 |
| `nie-game` | Hôte GUI natif wgpu — rend les vrais assets | 24 |
| `nie-render3d` | Renderer 3D : charge un GLB réel et le rend en perspective | 17 |
| `nie-runtime` | Boucle intégrée monde + physique + rendu top-down → frames/MP4 | 6 |
| `nie-play` | Front headless/golden : rejoue `nie-app`, écrit PNG/MP4 déterministes | 0 |
| `nie-headless` | Front headless sans fenêtre, résumé JSON par format | 18 |
| `nie-save` | Déchiffrement, lecture et édition des saves (XOR clé CRC32) | 57 |
| `nie-explore` | Aperçu/description des entrées VFS par format | 41 |
| `nie-viola` | Modding Level-5 (dump/pack/merge/crypto Criware), périmètre outil « Viola » | 51 |
| `nie-ui` | Source unique typée des jetons de design du jeu (OKLCH, géométrie, mouvement) → CSS | 35 |
| `aphrody-identity` (aphrody-ui) | Runtime typé du pet « Codex Aphrody v2 » (atlas RGBA, animations, directions) | 56 |
| `nie-ffi` | Frontière C-ABI — **seul natif chargé côté TS** | 13 |
| `nie-wasm` | Bindings WebAssembly du savoir vérifié | 66 |
| `nie-lua-web` | La VRAIE VM Lua du jeu dans le navigateur — cible `wasm32-unknown-emscripten` | 0 |
| `nie-viewer-web` | Le viewer 3D seul, backend WebGL 2, chargé à la demande sans WebGPU | 0 |
| `nie-ocgen` | Génération 3D d'un personnage original depuis des références mesurées | 0 |
| `nie-render` | Rendering facade: 2D, CPU/GPU 3D, GUI and wasm | — |
| `nie-bevy` | Bevy integration: real G4TX/G4MD/G4MG become Bevy `Image`/`Mesh` assets through asset loaders | — |
| `nie-net` | Online mode: room lobby, matchmaking, deterministic rollback/lockstep synchronisation | — |
| `nie-pg` | VFS `cfg.bin` (RDBN, T2B) into PostgreSQL schema `nie`, binary `COPY`, no JSON step — see the data-ownership section below | — |

### `crates/tools/*` — outillage (12)

| Crate | Rôle | Tests |
|---|---|---:|
| `nie-cli` | Binaire `nie` — la seule CLI utilisateur, pilote aussi la boucle RE et la frontière redis | 24 |
| `nie-mcp` | Binding MCP Rust natif (`rmcp`) des commandes partagées de `nie` | 7 |
| `nie-site` | Serveur HTTP nie (Axum 0.8) : le jeu wasm en `/`, bundle `nie-web`, `/api/v1`, VFS `/f` `/b`, proxy `nie-model-serve` | 275 |
| `nie-model-serve` | Serveur HTTP live d'assemblage GLB IEVR (corps+face+uniforme depuis CPK, cache disque) | 13 |
| `ievr-tools` | Binding historique d'outils IEVR ; son inspecteur PE est fourni par `iecode-re` (`../iecode`) via ré-export compatible | 8 |
| `nie-launcher` | Native launcher, save editor and mod-package manager (`.utmod`, save coordination) | — |
| `nie-computer-use` | Capture et inspection locale bornée des images utilisées par les workflows d'observation | 6 |
| `nie-steam` | Acquisition Steam native (download/dump de dépôts IEVR), remplace SteamKit2 | 35 |
| `nie-zukan` | Ingesteur de l'encyclopédie officielle Level-5 Inagle (JP/FR/EN) | 53 |
| `nie-wiki` | Exploration game-data IEVR depuis le miroir SQLite (personnages, skills, items, équipes) | 0 |
| `nie-editor` | Éditeur 3D NIE natif, viewport GPU partagé DirectX 12/Vulkan/OpenGL | 1 |
| `nie-bench` | Banc de mesure des hot paths Rust et des contrats de format | 2 |

## Les ponts

| Pont | Sens | Point d'entrée |
|---|---|---|
| `packages/nie` | Rust → TS | `nie_ffi` via `bun:ffi` (préchargé par `bunfig.toml`) — **seul** natif chargé côté TS |
| `scripts/sync-gamedata.ts` | TS → Rust | `nie steam` puis `nie viola` |
| `packages/nie-bridge` | Rust ↔ TS | contrat WebSocket entre le serveur Rust `nie-mcp` et le client WebView Inacord |

`crates/archive/nie-rs` est du décompilé porté en Rust, hors workspace et compilé
par personne : matière de RE, pas un pont.

## Data ownership

- **The Rust site and wiki are the only IEVR data owners.** IEVR parsing, query rules, mirror
  access, API projections, CLI behaviour and native IPC belong to `nie-data`, `nie-formats`,
  `nie-core`, `nie-wiki`, `nie-site`, `nie-cli` and Inacord's Rust backend. Bun is limited to thin
  host bindings and non-IEVR integrations: it never queries the IEVR mirror directly and never
  calls a remote wiki. The deleted Azalée application, `packages/azalee`, `packages/azalee-tools`
  and the IEVR Inagle package are not compatibility targets (decision recorded 2026-09-09 in the
  archived plan).
- **`nie-pg` writes only PostgreSQL schema `nie`** (`nie.rdbn_list`, `nie.rdbn_value`,
  `nie.t2b_entry`, `nie.t2b_var`; binary `COPY`, no `jsonb`, incremental and transactional per
  file by SHA-256). Readers get exactly one grant, the role `nie_reader` (NOLOGIN, `USAGE` +
  `SELECT`), and the crate's integration test proves that role cannot write. rg's
  `public.inagle_*` tables, `public.inagle_cfgbin` included, are never touched from here; wiring
  Azalée is `GRANT nie_reader TO <azalee role>`, done with the owner on the production database.
  Measured 2026-09-23 against PostgreSQL 18: replaying 1 209 files rewrites nothing;
  `font_color.cfg.bin` gives 448 cells in 64 rows.
- **Trust the `vfs:` line, not `NIE_GAME_DIR`.** `open_game` silently falls back to this
  repository's `data/` when `NIE_GAME_DIR` points nowhere, so an import can succeed against the
  wrong tree. `nie-pg import` prints the VFS it actually opened; read that line before reading its
  counts.

## Fusions interdites

Quatre duplications sont **volontaires**. Les collapser corrompt le byte-exact en silence, avec
des tests qui restent verts.

1. **`crc32` vs `crc32_nie`** — deux fonctions distinctes. `crc32` (complément final : noms
   `cfg.bin`, clés de fichier CPK, type-id ECS, CRC de save) ≠ `crc32_nie` (accumulateur brut
   sans complément : model-id CPK, lookup g4tx). Les fusionner corrompt silencieusement l'un des
   deux chemins.
2. **`g4sk::mat_mul`** reste scalaire local, jamais glam/FMA : il est validé golden sur fixtures
   réelles (skinning), un réordonnancement f32 casse le golden.
3. **`StatBlock` de `nie-wiki`** (2 segments f64) diverge volontairement de celui de `nie-core`
   (3 segments f32) : le miroir SQLite n'a pas le palier lv30.
4. **Conventions d'axe vertical opposées** — `nie-core` traite `y` comme hauteur, `nie-runtime`
   traite `z` comme hauteur. `nie-geom::Vec3` unifie le *type* mais **pas** la sémantique : chaque
   crate garde sa convention dans son code. Ne jamais convertir implicitement d'un système vers
   l'autre — la similarité de layout ne vaut pas équivalence sémantique. Idem `Vec2` :
   `g4mg::{u,v}` (UV) ≠ `{x,y}` (terrain).

## Contraintes de structure

- Bun ne charge **que** `nie_ffi` (Rust). C'est délibéré : `bunfig.toml` précharge `nie-plugin`,
  donc tout natif joint à cette chaîne ferait échouer n'importe quelle commande `bun` du dépôt dès
  qu'il n'est pas construit.

## RE anchors

The knowledge base (`var/nie.sqlite`) tables that correspond to each architectural layer:

- `function` — 117 068 entries, the complete function inventory of `nie.exe`
- `rtti_class` and `rtti_base` — MSVC RTTI hierarchy (1 745 classes with inheritance)
- `xref` — call-graph edges, the backbone of the propagation in `nie-re`
- `coverage` — classification snapshots, the metric `nie rebuild` writes
- `pdata_func` — 55 351 `.pdata` entries, the authoritative function boundaries
- `hash_name` — CRC-32 ↔ string resolution, populated by `nie seed-ui`
- `symbol` — resolved symbols beyond Ghidra's initial export
- `anchor` — manually confirmed function↔name bindings
- `forge_unit` — binary subdivision for byte-exact production

The archive crate `nie-engine` (`crates/archive/nie-engine/src/cfgbin.rs`) carries 434
`// EXTERN:` markers referencing `FUN_140d862f0`, `FUN_1416709b0`, `FUN_14005b8b0`,
`FUN_140e33460`, `FUN_140e085b0`, `FUN_14047f670`, `FUN_140480430`, `FUN_140435320`,
`FUN_1404784a0`, `FUN_140435ae0`, `FUN_140452ac0`, `FUN_1415f4e20`, `FUN_14160a910`,
`FUN_141608cd0`, `FUN_14043b3c0` among others — these are the cfg.bin loader's external
dependencies, each pointing to a real function in the reference binary.

## Les couches, mesurées (2026-09-20)

Un diagramme de couches est une affirmation vérifiable. Celle-ci l'est désormais par une porte :

```sh
bun --bun scripts/validation/layers.ts          # vérifie, sort non-zéro sur régression
bun --bun scripts/validation/layers.ts --write  # réimprime la table depuis la mesure
```

Elle fige le rang **mesuré** — le plus long chemin de dépendances internes — et non un rang
voulu. Mesuré le 2026-09-20 : **50 crates, 9 rangs (N0..N8), aucune dépendance qui remonte.**

Re-measured 2026-09-25 (`bun scripts/validation/layers.ts`): **47 crates, 9 ranks (N0..N8)** —
the crates moved to `../iecode` left the graph, `nie-pg` and `nie-render` joined it — and the gate **fails with 3
problems**: `nie-pg` and `nie-render` carry no rank, and `ievr-tools` is declared N1 where the
measure gives N0. The ranked table lives in the script; `--write` regenerates it from the
measurement.

### Ce qu'une version antérieure du diagramme affirmait, et qui ne tenait pas

| Affirmé | Mesuré |
|---|---|
| 41 crates | **50**. Absents du diagramme : `aphrody-re`, `ievr-tools`, `aphrody-identity` (aphrody-ui), `nie-bevy`, `nie-computer-use`, `nie-dump`, `nie-queue`, `nie-tasks`, `nie-zukan` |
| 6 couches | **9 rangs** |
| couches étanches unidirectionnelles | la **fondation dépend vers le haut par défaut** : `nie-core → nie-data`, `nie-formats → nie-lua`, plus `nie-ffi → nie-wiki` et `nie-wasm → nie-model-serve`, toutes non optionnelles |
| `src-tauri` hors du workspace, table `[workspace]` vide, pour éviter le conflit `links = "sqlite3"` | `src-tauri` **est** membre (`Cargo.toml:18`) et n'a aucune table `[workspace]`. `cargo check -p inacord` sort **0** : le conflit ne se manifeste pas. Il est membre **non par défaut**, ce qui n'est pas la même chose qu'être dehors |

**Aucune de ces dépendances n'est un défaut.** `nie-formats` décode le bytecode Lua par
`nie-lua`, source unique du décodeur : c'est le bon choix. Ce qui était faux, c'est le **rang**
assigné à ces crates — la règle « extract before you bind » tient, c'est la carte qui ne
correspondait pas au terrain.

### Une exception, documentée plutôt que tue

Une **dev-dependency** peut remonter sans rien casser : elle rejoint le graphe des tests, pas
celui de la bibliothèque. `nie-lua` (N1) emprunte ainsi `nie-formats` (N2) pour lire de vrais
`.lua.bin` du jeu dans ses goldens ; inverser cette dépendance obligerait à dupliquer le VFS.
La porte laisse passer ce cas en le nommant.

Cargo interdit déjà les cycles dans le graphe de compilation : « aucune dépendance cyclique »
est vrai par construction et n'a pas besoin d'être testé.

### Ce qui reste invérifiable ici

Les **215 688 unités de forge** sont corroborées par quatre documents du dépôt
(`AGENTS.md`, le plan archivé
[`PLAN-2026-09-08-to-25.md`](archive/plans/2026-09-25/PLAN-2026-09-08-to-25.md) ×2, la skill
`re-workflow`) mais leur source vivante,
`var/forge/cover.json`, **est absente de cette machine** — `var/` ne porte que des artefacts
régénérables. Ce qui est présent, `data/forge/registry.json`, compte **34 entrées** et est ancré
sur `b1fa04ea365868e5…`, qui est bien le binaire cible. Le chiffre n'est donc ni confirmé ni
infirmé par la mesure : il est régénérable, pas consultable en l'état.
