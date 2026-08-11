# Provenance des arbres

| Arbre | Langage | Emplacement | Origine |
|---|---|---|---|
| niers | Rust | `crates/`, `forge/` | ce dépôt |
| niers | TypeScript/Bun | `packages/`, `apps/` | ce dépôt |
| IECODE | C# .NET 10 | `csharp/`, `IECODE.sln` | `aphrody-code/iecode` |
| iecode | C++20 | `src/`, `third_party/`, `cmake/` | `aphrody-code/iecode`, répertoire `cli/`, commit `04c8391b` (2026-05-21) |

## Arbre C++

785 fichiers, 7,5 Mo — 348 `.cpp`, 282 `.h`, CMake + vcpkg, cibles natives et wasm. Code source
seul : aucun octet dérivé du jeu (ni `.bin`, ni asset, ni objet compilé).

Écarté à la copie : `cli/ffi/rust/iecode-sys/target/` — 182 fichiers de cache Cargo commités par
erreur en amont, régénérables, au-delà de la limite de longueur de chemin Windows.

## Points de contact avec la forge

- **`src/decomp/`** — `CMakeLists.txt` globe `functions/*.c` et les compile **en C**, avec un pont
  `bridge.cpp` vers l'API C++. C'est la voie B de la forge (`nie-forge cc`, MSVC 14.44
  `/O2 /GS- /Gy /Zl`) — cf. `docs/FORGE.md`.
- **`src/nie_rs/`** — pont Rust interne au toolkit (`stubs.rs`, `animation_play_anime.rs`,
  `animation_bone_blend.rs`, `vfs_path_resolver.rs`, `crilayla_decompress.rs`). Recoupement à faire
  avec `crates/engine/` (cf. `docs/PORTAGES.md`).

Le C décompilé lui-même n'est pas dans ce dépôt : `research/ghidra-export/decompiled/` du dépôt
iecode (60 fichiers, 597 Ko), non rapatrié.

## Licence

Assets et binaire du jeu © LEVEL-5, jamais versionnés. Développements couverts par l'accord
`public/ACCORD_COMMERCIAL_RG-L5-VR-2026-001.pdf`.
