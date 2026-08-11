# Architecture

Quatre implémentations d'IEVR sous une racine. Ce document dit **qui fait quoi**, **par où les
arbres se parlent**, et **ce qu'il ne faut jamais fusionner**.

## Les quatre arbres

| Arbre | Racine | Volume | Build |
|---|---|---|---|
| Rust — moteur + forge | `crates/`, `forge/` | 582 f. / 174 386 l | `cargo` |
| C++ — toolkit iecode | `src/` (+ `third_party/`, `cmake/`) | 595 f. / 88 622 l | `cmake` + vcpkg |
| C# — IECODE | `csharp/` | 230 f. / 46 922 l | `dotnet` (`IECODE.sln`) |
| TypeScript/Bun | `packages/`, `apps/` | 94 f. / 16 315 l | `bun` |

`just all-build` · `just all-test` · `just all-check` pilotent les quatre.

## Doctrine — un rôle, un langage

| Langage | Rôles |
|---|---|
| **C++** | C décompilé → jeu `nie` jouable ; libs sans équivalent (assimp, Bullet, driver kernel) |
| **C#** | dump, pack, memory, conversion de texture |
| **Rust** | la seule CLI, GUI, core lib, wasm, RE, byte-exact |
| **Bun/TS** | MCP, serveur web, types, API, UI |

Règles qui en découlent :

- La conversion de texture C++ est la moins bonne des trois : ne pas l'étendre. Elle ne subsiste
  que pour l'export WebP, qui n'existe nulle part ailleurs.
- Le driver mémoire reste C++ (`src/driver/iecode_memread`) : pilote kernel signé. Le client et
  l'outillage de dump vont en C#.
- `nie-formats::g4tx_decode` reste Rust : sans lui, wasm n'a pas d'images.
- Porter une capacité se justifie par la doctrine ou par une contrainte technique (byte-exact,
  wasm, dépendance native) — jamais par le goût du langage.

## La CLI unique

```bash
niers backends        # ce qui est construit, et où
niers cpp <args...>   # → build/<preset>/src/cli/iecode[.exe]
niers cs  <args...>   # → csharp/IECODE.CLI/bin/*/net10.0/iecode.dll
niers decode <src>    # fichier ou arborescence → JSON / PNG (rayon)
```

Les arguments passent tels quels (`--help` compris), le code de sortie du délégué est propagé.
Surcharges : `NIE_IECODE_EXE`, `NIE_IECODE_DLL`. Code : `crates/tools/nie-cli/src/delegate.rs`.

## Les crates Rust

Rangées par rôle. `crates/archive/*` est **hors du workspace** (`exclude` dans `Cargo.toml`) :
référence de portage en lecture seule, jamais compilée par `cargo build --workspace`.

### `crates/forge/*` — produire le binaire

| Crate | Rôle |
|---|---|
| `nie-pe` | Lecture/écriture byte-exacte du PE64 + découpage du fichier en unités de forge |
| `nie-asm` | Encodeur x86-64 dialecte MSVC — réassemble les corps depuis `forge/asm/*.s` |
| `nie-forge` | Boucle `split`/`lift`/`cc`/`build`/`verify`/`report`, mesure la part produite |
| `nie-re` | RTTI MSVC, indexation goblin/iced-x86, propagation de labels sur le call-graph |
| `nie-index` | Base de connaissance SQLite (`var/niers.sqlite`) |
| `nie-seed` | Import du savoir fusionné (index Ghidra, RTTI, formats iecode, hash→nom inagle) |
| `nie-queue` | Frontière BFS dédupliquée (redis) |
| `nie-trace` | RE en direct : lecture de la mémoire d'un `nie.exe` en cours d'exécution |

### `crates/engine/*` — le moteur

| Crate | Rôle |
|---|---|
| `nie-formats` | Parsers Level-5 (CPK, cfg.bin, G4*, CriLayla, Criware), `no_std`-friendly |
| `nie-data` | Modèles de données du jeu (skills, auras, chara_param, items, growth) |
| `nie-core` | Logique reversée (ballon, IA tactique, FSM de match, gardien, stats, CRand) |
| `nie-geom` | Types géométriques POD partagés — source unique `Vec2`/`Vec3` |
| `nie-lua` | VM Lua 5.2 réelle (mlua, PUC-Rio 5.2.4 vendored) + analyse statique tree-sitter |
| `nie-camera` | Modèle et contrôleurs de caméra portés (`CCameraCtrl*`) |
| `nie-app` | Machine à états d'écran (`GameState`) + rendu abstrait (trait `Renderer`) |
| `nie-game` | Hôte GUI natif wgpu — rend les vrais assets |
| `nie-render3d` | Renderer 3D : charge un GLB réel et le rend en perspective |
| `nie-runtime` | Boucle intégrée monde + physique + rendu top-down → frames/MP4 |
| `nie-play` / `nie-headless` | Fronts headless/golden, sans fenêtre |
| `nie-save` | Déchiffrement, lecture et édition des saves (XOR clé CRC32) |
| `nie-explore` | Aperçu/description des entrées VFS par format |
| `nie-ffi` | Frontière C-ABI — **seul natif chargé côté TS** |
| `nie-wasm` | Bindings WebAssembly du savoir vérifié |

### `crates/tools/*` — outillage

`nie-cli` (le binaire `niers`), `nie-wiki`, `nie-zukan`, `nie-steam`, `nie-model-serve`,
`nie-editor`, `nie-bench`, `nie-tasks`.

## Les ponts

| Pont | Sens | Point d'entrée |
|---|---|---|
| `nie-forge cc` | Rust → C | `src/decomp/functions/*.c`, annotés `/* @nie 0x… */` |
| `iecode export-knowledge` | C# → Rust | JSON → `crates/forge/nie-seed/src/format_catalog.rs` |
| `packages/nie` | Rust → TS | `nie_ffi` via `bun:ffi` (préchargé par `bunfig.toml`) — **seul** natif chargé côté TS |
| `src/ffi/rust/iecode-sys` | C++ → Rust | bindings bruts + wrappers RAII |
| `src/ffi/bindings.cpp` | C++ → Python | module nanobind `iecode.pyd` |
| `src/nie_rs/` | Rust → C++ | crate hors workspace appelée par le toolkit |
| `scripts/sync-gamedata.ts` | TS → C# | `dotnet` puis `iecode.dll` |
| `packages/nie-bridge` | TS ↔ TS | protocole `nie-mcp` ↔ `nie-explorer` |

Non ponté : C# ↔ natif (la couche `csharp/IECODE.Core/Native` est du SIMD .NET pur).

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

- `src/CMakeLists.txt` fait un `GLOB_RECURSE` sur tout `src/` pour `iecode_core` : les sous-arbres
  à target propre (`cli`, `tests`, `ffi`, `decomp`, `driver`, `include`) en sont exclus par
  `list(FILTER … EXCLUDE REGEX ".*/src/<nom>/.*")`. En ajouter un sans son filtre met plusieurs
  `main()` dans la lib.
- Bun ne charge **que** `nie_ffi` (Rust) : aucun `dlopen` de `iecode_ffi` côté TS. C'est délibéré —
  `bunfig.toml` précharge `nie-plugin`, donc tout natif joint à cette chaîne ferait échouer
  n'importe quelle commande `bun` du dépôt dès qu'il n'est pas construit, et la lib C++ exige
  vcpkg. Le C++ s'atteint depuis Rust (`iecode-sys`) ou par la CLI (`niers cpp`).
- vcpkg n'est pas installé par défaut : la chaîne C++ ne compile pas tant que `just cpp-bootstrap`
  n'a pas tourné. `just all-check` exclut donc le C++.
