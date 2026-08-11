# `cpp/` — provenance

Ce répertoire est le toolkit **C++20** d'IECODE, rapatrié dans niers.

| | |
|---|---|
| Source | `aphrody-code/iecode`, répertoire `cli/` (dépôt privé) |
| Commit | `04c8391b4e0ce1b169fe41079847cdb9ded38577` (2026-05-21) |
| Renommé | `cli/` → `cpp/` |
| Contenu | 785 fichiers, 7,5 Mo — 348 `.cpp`, 282 `.h`, CMake + vcpkg, cibles natives et wasm |
| Copié le | 2026-08-10 |

## Ce qui a été écarté à la copie

`cli/ffi/rust/iecode-sys/target/` — 182 fichiers, 7,15 Mo de cache de compilation Cargo
(`incremental/`, `dep-graph.bin`, `query-cache.bin`, `.o`, `.rlib`) commités par erreur en amont.
Ce sont des artefacts régénérables, sans valeur de source ; ils dépassaient de surcroît la limite de
longueur de chemin de Windows. Aucun fichier source n'a été omis : le compte 785 correspond
exactement à 967 − 182.

Aucun octet dérivé du jeu n'est présent ici (ni `.bin`, ni asset, ni objet compilé) — le répertoire
est du code source seul.

## Pourquoi c'est ici

Deux points de contact directs avec l'objectif de niers (produire `nie.exe` byte-identique,
cf. `docs/FORGE.md`) :

1. **`cpp/decomp/`** — l'échafaudage d'intégration de code décompilé : `CMakeLists.txt` fait un glob
   sur `functions/*.c` et compile ces fichiers **en C**, avec un pont `bridge.cpp` vers l'API C++.
   Le dossier `functions/` ne contient aujourd'hui qu'un `placeholder.c` : **l'infrastructure existe,
   la matière n'y est pas encore**. C'est exactement la voie du palier G3 de la forge, et elle
   monte bien plus haut que l'encodeur `nie-asm` sur les grosses fonctions.
2. **`cpp/src/nie_rs/`** — un pont Rust déjà présent côté iecode (dont `stubs.rs`,
   `animation_play_anime.rs`, `animation_bone_blend.rs`, `vfs_path_resolver.rs`,
   `crilayla_decompress.rs`) : recoupement à faire avec les crates de `crates/engine/`, qui couvrent
   déjà une partie de ces domaines en byte-exact.

Le C décompilé lui-même n'est **pas** dans ce répertoire : il vit dans
`research/ghidra-export/decompiled/` du dépôt iecode (60 fichiers, 597 Ko), non rapatrié ici.

## Statut

Copie **non intégrée** : `cpp/` n'est référencé ni par le workspace Cargo, ni par la CI, ni par le
`justfile`. Il ne se compile que par sa propre chaîne CMake/vcpkg. Rien dans niers n'en dépend.
