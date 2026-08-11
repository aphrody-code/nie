# Architecture polyglotte

Quatre implémentations d'IEVR sous une racine. Ce document dit **qui fait quoi** et **par où les
arbres se parlent**. Le registre des portages en cours : [`PORTAGES.md`](PORTAGES.md).

## Les quatre arbres

| Arbre | Racine | Volume | Build |
|---|---|---|---|
| Rust — moteur + forge | `crates/`, `forge/` | 515 f. / 170 425 l | `cargo` |
| C++ — toolkit iecode | `src/` (+ `third_party/`, `cmake/`) | 620 f. / 101 030 l | `cmake` + vcpkg |
| C# — IECODE | `csharp/` | 233 f. / 48 411 l | `dotnet` (`IECODE.sln`) |
| TypeScript/Bun | `packages/`, `apps/` | 102 f. / 18 357 l | `bun` |

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

## Contraintes de structure

- `src/CMakeLists.txt` fait un `GLOB_RECURSE` sur tout `src/` pour `iecode_core` : les sous-arbres
  à target propre (`cli`, `tests`, `ffi`, `decomp`, `driver`, `include`) en sont exclus par
  `list(FILTER … EXCLUDE REGEX ".*/src/<nom>/.*")`. En ajouter un sans son filtre met plusieurs
  `main()` dans la lib.
- Bun ne charge **que** `nie_ffi` (Rust) : aucun `dlopen` de `iecode_ffi` côté TS. C'est délibéré —
  `bunfig.toml` précharge `nie-plugin`, donc tout natif joint à cette chaîne ferait échouer
  n'importe quelle commande `bun` du dépôt dès qu'il n'est pas construit, et la lib C++ exige
  vcpkg. Le C++ s'atteint depuis Rust (`iecode-sys`) ou par la CLI (`niers cpp`).
- vcpkg n'est pas installé sur la machine de dev : la chaîne C++ ne compile pas tant que
  `just cpp-bootstrap` n'a pas tourné. `just all-check` exclut donc le C++.
