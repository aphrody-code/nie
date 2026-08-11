# Architecture polyglotte — les quatre implémentations sous une racine

> État au 2026-08-11, après l'unification des dépôts `iecode` (C++), `IECODE` (C#) et `niers`
> (Rust + Bun). Ce document dit **qui fait autorité sur quoi**, **par où les arbres se parlent**,
> et **ce qu'il ne faut pas dupliquer**. Voir `PROVENANCE.md` pour l'origine de chaque arbre et
> `docs/DEDUP-PLAN.md` pour la déduplication *interne* au Rust.

## Les quatre arbres

| Arbre | Racine | Volume | Chaîne de build |
|---|---|---|---|
| **Rust** — moteur + forge | `crates/`, `forge/` | 515 fichiers, 170 425 lignes | `cargo` (workspace, 31 crates) |
| **C++20** — toolkit iecode | `src/` (+ `third_party/`, `cmake/`) | 620 fichiers, 101 030 lignes | `cmake` + vcpkg |
| **C# .NET 10** — IECODE | `csharp/` | 233 fichiers, 48 411 lignes | `dotnet` (`IECODE.sln`) |
| **TypeScript/Bun** | `packages/`, `apps/` | 102 fichiers, 18 357 lignes | `bun` (workspaces) |

Une commande pour les quatre : `just all-build`, `just all-test`, `just all-check`.

## Qui fait autorité

Le chevauchement fonctionnel est réel et **assumé** : les quatre arbres savent lire les formats
Level-5. Ce n'est pas de la duplication à supprimer, c'est **quatre points de vue** sur le même
binaire, et chacun a une raison d'exister que les autres n'ont pas.

| Domaine | Autorité | Pourquoi elle, et pas une autre |
|---|---|---|
| **Byte-exactitude** (forge, golden, `.pdata`/`.reloc`, encodeur x86-64) | **Rust** (`crates/forge`) | Le contrat du projet : `sha256(dist/nie.exe)` == référence. Rien d'autre ne le mesure. |
| **Logique de jeu reversée** (match, ball, keeper, tactics, save) | **Rust** (`crates/engine/nie-core`) | ~60 tests IEEE-754 golden ancrent l'ordre des opérations f32. |
| **Décodage de texture BCn** (BC7, DX10, FourCC) | **C++** (`src/converters`, DirectXTex) | DirectXTex est la référence Microsoft ; le Rust en a un portage (`g4tx_decode`) pour wasm. |
| **Import/export de modèles** (glTF, FBX, DAE) | **C++** (assimp, tinygltf) | Assimp couvre ~40 formats ; réécrire ça en Rust n'apporterait rien. |
| **Rendu temps réel natif** | **C++** (bgfx) et **Rust** (wgpu, `nie-game`) | Deux cibles distinctes : bgfx pour l'outillage, wgpu pour le moteur portable/wasm. |
| **Physique** | **C++** (Bullet) | Remplace PhysX 3.4 du jeu ; le Rust n'a que la physique de ballon reversée. |
| **Scripting Lua du jeu** | **C++** (sol2) et **Rust** (`nie-lua`) | sol2 exécute ; `nie-lua` reverse le *dispatch* des menus (byte-exact). |
| **Analyse binaire** (capstone, tree-sitter, rizin) | **C++** (`src/cli/commands/analyze`) | Écosystème natif complet ; le Rust utilise iced-x86 pour la forge seule. |
| **Lecture mémoire d'un process vivant** | **C++** (`src/driver/iecode_memread`, driver kernel) | Nécessite un driver signé — hors de portée des trois autres. |
| **Catalogue des formats** (magics, layouts de champs) | **C#** (`csharp/IECODE.Core/Formats`) | `iecode export-knowledge` en fait un JSON versionné que `nie-seed` **ingère** : c'est déjà la source amont du Rust. |
| **Pipelines de données / CDN / EOS / Steam** | **C#** (`Pipeline`, `Cdn`, `EOS`, `Steam`) | Le .NET a les SDK et le typage rapide ; ce sont des outils, pas du moteur. |
| **SIMD portable haut niveau** | **C#** (`csharp/IECODE.Core/Native`) | `System.Runtime.Intrinsics` (AVX2/SSE2/AES-NI) sans `unsafe` C++ ni `unsafe` Rust. |
| **Orchestration, MCP, UI** | **TypeScript/Bun** (`apps/nie-mcp`, `apps/nie-explorer`) | Bun Workers, FFI sans glue, Tauri ; c'est la couche qui *pilote* les trois autres. |

**Règle** : porter une capacité d'un arbre à l'autre se justifie par une **contrainte** (byte-exact,
wasm, absence de dépendance), pas par le goût du langage. Un troisième décodeur de texture qui
n'est ni byte-exact ni wasm-portable est une dette, pas une feature.

## Les ponts (ce qui existe réellement)

```
                    ┌──────────────────────────────────────────┐
                    │  nie.exe  (référence, © LEVEL-5)         │
                    └────────────────┬─────────────────────────┘
                                     │ mesure à l'octet
                    ┌────────────────▼─────────────────────────┐
   src/decomp/*.c ─►│  Rust — crates/forge (nie-pe, nie-asm)   │  voie B : MSVC 14.44
   (C, voie B)      │  produit dist/nie.exe                    │
                    └────────────────┬─────────────────────────┘
                                     │ nie_ffi.dll (C ABI)
   csharp/IECODE.CLI                 │                   src/ffi/ → iecode_ffi (C ABI)
   `export-knowledge` ──► JSON ──►  nie-seed             │
   (C# → Rust)                       │                   │
                                     ▼                   ▼
                            packages/nie  ────────►  apps/nie-mcp, apps/nie-explorer,
                            (bun:ffi, TS)            apps/nie-decode
```

| Pont | Sens | Point d'entrée |
|---|---|---|
| `nie-forge cc` | Rust → C (MSVC) | `src/decomp/functions/*.c`, annotés `/* @nie 0x… */` |
| `iecode export-knowledge` | C# → Rust | JSON `schema_version` → `crates/forge/nie-seed/src/format_catalog.rs` |
| `packages/nie` | Rust → TS | `nie_ffi.dll` via `bun:ffi` (préchargé par `bunfig.toml`) |
| `src/ffi/iecode.ts` | C++ → TS | `iecode_ffi` via `bun:ffi` |
| `src/ffi/rust/iecode-sys` | C++ → Rust | bindings bruts + wrappers RAII |
| `src/nie_rs/` | Rust → C++ | crate hors workspace, appelée depuis le toolkit |
| `scripts/sync-gamedata.ts` | TS → C# | `dotnet build` puis `iecode.dll` |
| `packages/nie-bridge` | TS ↔ TS | protocole de contrôle `nie-mcp` ↔ `nie-explorer` |

**Non ponté à ce jour** : C# ↔ natif (la couche `Native` est du SIMD .NET pur, aucun P/Invoke vers
`iecode_ffi` ou `nie_ffi`), et `src/nie_rs/` ↔ `crates/engine/` (recoupement à faire : les deux
couvrent crilayla, vfs, animation).

## Ce qu'il ne faut pas faire

1. **Ne pas fusionner les CLI.** `iecode` (C++, 40 commandes), `IECODE.CLI` (C#, 37 commandes) et
   `niers` (Rust) se recouvrent à ~60 %, mais chacune est le point d'entrée naturel de son arbre.
   Le point d'unification est `apps/nie-mcp`, qui les expose toutes trois à un agent.
2. **Ne pas « optimiser » le Rust byte-exact en appelant le C++.** Un décodeur plus rapide qui
   change l'ordre des opérations f32 casse les golden — cf. les landmines de `docs/DEDUP-PLAN.md`.
3. **Ne pas réimplémenter côté explorateur ce que la FFI expose déjà.** `nie-explorer` lie
   `nie-formats` en direct, `nie-mcp` passe par `packages/nie` : même couche Rust, deux accès.
4. **Ne pas ajouter un sous-arbre C++ à target propre sans son filtre** dans `src/CMakeLists.txt`
   (`GLOB_RECURSE` sur tout `src/` : il ramasserait ses `main()`).

## Chantiers ouverts

- **vcpkg absent de la machine de dev** → la chaîne C++ ne compile pas ici (`just cpp-bootstrap`
  l'installe dans `var/vcpkg`). Tant qu'elle n'est pas verte, `just all-check` exclut le C++.
- **`CMakeLists.app_export.txt`** référence `src/iecode_export_app.cpp`, qui n'existe pas (le
  fichier réel est `src/iecode_export_app_optimized.cpp`) — cible cassée, antérieure à la fusion.
- **P/Invoke C# → `nie_ffi`** : le chemin le plus court pour que l'outillage C# hérite du
  décodage byte-exact du Rust au lieu de sa propre copie.
- **`src/nie_rs/` vs `crates/engine/`** : deux portages Rust des mêmes formats, dont un hors
  workspace et non testé.
