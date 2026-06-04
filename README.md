# niers

Reverse-engineering + réimplémentation **Rust headless + wasm** d'*Inazuma Eleven: Victory Road*
(IEVR, moteur Level-5 « Lives »), piloté par une boucle RE autonome (RE ° auto-ML ° sqlite ° redis)
qui ingère le savoir déjà fusionné (index Ghidra des 60 183 fonctions de `nie.exe`, iecode, inagle)
et le pousse vers 100 % de couverture, puis le porte en crates Rust pures.

Voir `docs/ARCHITECTURE.md`. Conventions alignées sur l'écosystème aphrody (nightly-2026-05-17,
edition 2024, lints RFC 3389, RE pur-Rust goblin+iced-x86).

## Crates

- `nie-index` — base de connaissance sqlite (schéma + ingest/query).
- `nie-seed` — ingestion du corpus Ghidra (nie-index.json) + iecode/inagle.
- `nie-re` — moteur RE : RTTI MSVC, indexer goblin/iced, propagation de labels.
- `nie-queue` — frontière BFS redis (workers parallèles).
- `nie-formats` — parsers Level-5/Criware portés en Rust.
- `nie-cli` — binaire `niers` (seed / coverage / queue / propagate).

## Build

Toolchain : `nightly-2026-05-17` (présente sous `~/.rustup/toolchains`, rustup absent →
invoquer son cargo directement). Wasm via la toolchain `nightly` (seule avec la std wasm32).

```
cargo build --workspace
cargo test --workspace
niers seed --db var/niers.sqlite --json refs/iecode-re/research/nie-index.json --exe nie_eacpatched.exe
niers coverage --db var/niers.sqlite
```
