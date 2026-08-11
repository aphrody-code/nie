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

## Doctrine de répartition (cible)

Décidée le 2026-08-11 par le propriétaire du projet. **Un rôle, un langage** — c'est la règle qui
tranche quand deux arbres savent faire la même chose.

| Langage | Rôles qui lui reviennent |
|---|---|
| **C++** (`src/`) | portage du **C décompilé** vers le **jeu `nie` jouable**, et **uniquement** cela — plus les rares bibliothèques qui **n'existent qu'en C++** |
| **C#** (`csharp/`) | **dump**, **pack**, **memory**, **conversion de texture** (et l'outillage de données qui les entoure) |
| **Rust** (`crates/`) | **CLI** (la seule), **GUI**, **core lib**, **wasm**, **reverse-engineering**, **conversion de texture** byte-exacte |
| **Bun/TS** (`packages/`, `apps/`) | **MCP**, **serveur web**, **types**, **API**, **UI** |

**La conversion de texture C++ est la moins bonne des trois** (constat du propriétaire, 2026-08-11) :
Rust et C# la dominent. `src/converters/texture_*` n'est donc **pas** une autorité, c'est un
héritage à retirer du chemin par défaut — il ne survit que tant qu'une fonction n'existe nulle part
ailleurs (aujourd'hui : l'export WebP). Le C++ ne se justifie plus que par deux raisons :
faire tourner le jeu, ou envelopper une bibliothèque sans équivalent (assimp, Bullet, le driver
kernel). Une dépendance C++ qui a un équivalent Rust ou C# n'est pas une raison de rester en C++.

Deux ajustements, parce que la doctrine littérale casserait des choses qui marchent :

1. **Le driver mémoire reste en C++.** `src/driver/iecode_memread` est un pilote kernel Windows
   (WDK, signature) : ni C# ni Rust ne peuvent l'assumer. C# prend le **client** et l'outillage de
   dump mémoire ; le driver et son ABI restent C++. `crates/forge/nie-trace` reste Rust car il
   sert la RE, qui est un rôle Rust.
2. **« CLI uniquement en Rust » se fait par absorption, pas par suppression.** `iecode` (C++,
   40 commandes) et `IECODE.CLI` (C#, 37 commandes) portent des fonctions que `niers` n'a pas :
   les supprimer d'un trait perdrait ~60 features. Cible : `niers` est la **seule CLI utilisateur**
   et délègue aux deux autres binaires tant que la fonction n'est pas portée ; chaque portage
   retire une délégation. L'écart est chiffré ci-dessous et se réduit commande par commande.

**Corollaire** : porter une capacité d'un arbre à l'autre se justifie par la doctrine ou par une
contrainte technique (byte-exact, wasm, dépendance native), jamais par le goût du langage.

## Écart à la doctrine (mesuré le 2026-08-11)

| Arbre | Conforme | Hors doctrine | Décision |
|---|---|---|---|
| C++ `src/decomp` | ✅ C décompilé → jeu jouable | — | garder, c'est le cœur du rôle C++ |
| C++ `src/converters/texture_*` | — | conversion de texture (la moins bonne des trois) | retirer du chemin par défaut ; ne survit que pour l'export WebP, à porter en Rust ou C# |
| C++ `src/render` (bgfx) | — | rendu hors jeu | ne garder que ce qui sert le jeu jouable ; la GUI est Rust |
| C++ `src/cli` (40 commandes) | — | CLI en C++ | **façade en place** (`niers cpp …`), absorption commande par commande |
| C++ `src/vfs`, `src/archive`, `src/compression`, `src/crypto`, `src/formats` | — | core lib en C++ | doublon de `nie-formats` : geler, ne plus étendre |
| C++ `src/gamedata`, `src/db`, `src/services`, `src/modding` | — | données/outils en C++ | candidats au portage C# (dump/pack) |
| C++ `src/engine`, `src/game`, `src/scripting` | — | moteur en C++ | déjà `OFF` par défaut dans CMake ; référence de portage |
| C# `Dump`, `Pack`, `Mem` | ✅ | — | garder, **cible d'accueil** |
| C# `Formats`, `Compression`, `Crypto`, `Converters` | — | core lib en C# | source du catalogue `export-knowledge` : garder en lecture, ne plus étendre |
| C# `Cdn`, `EOS`, `Steam`, `Pipeline`, `Search` | — | services | à arbitrer : web ⇒ Bun, données ⇒ C# |
| Rust `crates/engine`, `crates/forge`, `crates/tools/nie-cli` | ✅ core, wasm, RE, CLI | — | garder |
| Rust `crates/tools/nie-model-serve` | — | serveur web en Rust | → Bun (rôle « web server ») |
| Bun `apps/nie-mcp`, `apps/nie-explorer` (UI) | ✅ | — | garder |
| Bun `apps/nie-decode` | — | CLI en TS | **fait** : supprimée, remplacée par `niers decode` (rayon au lieu des Bun Workers) |

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
                            (bun:ffi, TS)            (niers decode = Rust direct)
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

## La CLI unique

```bash
niers backends        # cpp=absent|present, cs=…, rust=… — et le chemin de chaque binaire
niers cpp <args...>   # délègue au toolkit C++ `iecode`   (build/<preset>/src/cli/iecode.exe)
niers cs  <args...>   # délègue à `IECODE.CLI` .NET       (csharp/IECODE.CLI/bin/*/net10.0/iecode.dll)
```

Les arguments passent **tels quels** (y compris `--help`, que clap ne capte pas sur ces deux
sous-commandes) et le code de sortie du délégué est propagé sans traduction. Surcharges :
`NIE_IECODE_EXE`, `NIE_IECODE_DLL`. Implémentation : `crates/tools/nie-cli/src/delegate.rs`.

C'est le mécanisme qui rend « CLI uniquement en Rust » **atteignable sans perte** : l'utilisateur
n'a plus qu'un binaire à connaître, et chaque commande portée en Rust retire une délégation.

## Ce qu'il ne faut pas faire

1. **Ne pas étendre les CLI C++ et C#.** Elles sont derrière la façade `niers` et se vident au
   fil des portages ; toute commande nouvelle va en Rust. `apps/nie-mcp` expose la même surface
   aux agents.
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
