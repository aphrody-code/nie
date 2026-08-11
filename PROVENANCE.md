# Provenance des arbres fusionnés à la racine

Le dépôt réunit **quatre implémentations d'*Inazuma Eleven: Victory Road***, rangées sous une
racine unique depuis le 2026-08-11. Ce fichier dit d'où vient chaque arbre, ce qui a été écarté à
la copie, et jusqu'où il est intégré.

| Arbre | Langage | Emplacement | Origine |
|---|---|---|---|
| niers | Rust | `crates/`, `forge/` | ce dépôt (racine historique, `3f3e4a9`) |
| niers | TypeScript/Bun | `packages/`, `apps/` | ce dépôt |
| IECODE | C# .NET 10 | `csharp/`, `IECODE.sln` | `aphrody-code/iecode` — importé par `f40cdd3` |
| iecode | C++20 | `src/` (dont `src/include`, `src/cli`, `src/ffi`, `src/decomp`, `src/driver`, `src/tests`) + `third_party/`, `cmake/` | `aphrody-code/iecode`, répertoire `cli/` |

## C++ — le toolkit iecode

| | |
|---|---|
| Source | `aphrody-code/iecode`, répertoire `cli/` (dépôt privé) |
| Commit | `04c8391b4e0ce1b169fe41079847cdb9ded38577` (2026-05-21) |
| Contenu | 785 fichiers, 7,5 Mo — 348 `.cpp`, 282 `.h`, CMake + vcpkg, cibles natives et wasm |
| Copié le | 2026-08-10, dans `cpp/` |
| Remonté | 2026-08-11, `cpp/*` → racine (`a64c13b`) — plus aucun chemin `cpp/…` n'est valide |
| Regroupé | 2026-08-11, tout le C++ sous `src/` : `include/ cli/ ffi/ decomp/ driver/ tests/` → `src/…` |

### Ce qui a été écarté à la copie

`cli/ffi/rust/iecode-sys/target/` — 182 fichiers, 7,15 Mo de cache de compilation Cargo
(`incremental/`, `dep-graph.bin`, `query-cache.bin`, `.o`, `.rlib`) commités par erreur en amont.
Ce sont des artefacts régénérables, sans valeur de source ; ils dépassaient de surcroît la limite de
longueur de chemin de Windows. Aucun fichier source n'a été omis : le compte 785 correspond
exactement à 967 − 182.

Aucun octet dérivé du jeu n'est présent dans cet arbre (ni `.bin`, ni asset, ni objet compilé) —
c'est du code source seul.

### Ce que la remontée à la racine a réparé

Le déplacement `cpp/* → ./` a été fait sur disque avant d'être pris par git. Vérification au hash
des 758 fichiers suivis : **756 identiques, 0 disparu**, 2 divergents (`.gitignore`, `CLAUDE.md`)
dont le contenu a été **fusionné** dans les fichiers racine plutôt qu'écrasé. Trois pertes
silencieuses préexistantes ont été corrigées au passage (cf. `a64c13b`) : les 13 `CMakeLists.txt`
mangés par la règle `*.txt`, `PROVENANCE.md`/`APP_EXPORT_README.md` mangés par `*.md`, et les
règles `crates/*/…` devenues sans cible après le rangement des crates par rôle.

## Points de contact avec la forge

1. **`src/decomp/`** — l'échafaudage d'intégration de code décompilé : `CMakeLists.txt` fait un glob
   sur `functions/*.c` et compile ces fichiers **en C**, avec un pont `bridge.cpp` vers l'API C++.
   C'est la **voie B** de la forge (`nie-forge cc`, MSVC 14.44 `/O2 /GS- /Gy /Zl`), celle qui monte
   le plus haut sur les grosses fonctions — cf. `docs/FORGE.md`.
2. **`src/nie_rs/`** — un pont Rust déjà présent côté iecode (dont `stubs.rs`,
   `animation_play_anime.rs`, `animation_bone_blend.rs`, `vfs_path_resolver.rs`,
   `crilayla_decompress.rs`) : recoupement à faire avec les crates de `crates/engine/`, qui couvrent
   déjà une partie de ces domaines en byte-exact.

Le C décompilé lui-même n'est **pas** dans ce dépôt : il vit dans
`research/ghidra-export/decompiled/` du dépôt iecode (60 fichiers, 597 Ko), non rapatrié.

## Statut d'intégration

- **Chaînes de build** : quatre, orchestrées par le `justfile` (`just all-build`, `just all-test`) —
  Cargo, CMake/vcpkg, `dotnet`, Bun. Aucune ne dépend d'une autre au moment de compiler.
- **Ponts effectifs** : `nie-forge cc` compile `src/decomp/functions/*.c` (Rust → C++) ;
  `packages/nie` expose les deux bibliothèques natives à TypeScript (`nie_ffi` Rust,
  `iecode_ffi` C++) ; `scripts/sync-gamedata.ts` appelle `IECODE.CLI` (Bun → C#).
- **Non ponté à ce jour** : C# ↔ natif (la couche `csharp/IECODE.Core/Native` est du SIMD .NET
  pur, pas du P/Invoke) et `src/nie_rs/` ↔ `crates/engine/`.

Carte détaillée de qui fait autorité sur quoi : `docs/ARCHITECTURE-POLYGLOTTE.md`.
