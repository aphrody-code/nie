# niers

**Réécriture intégrale d'*Inazuma Eleven: Victory Road* (IEVR, moteur Level-5 « Lives ») en Rust pur —
jouable en headless + WebAssembly, sans le binaire Windows ni le moteur propriétaire.**

Ce repo contient aussi des outils servant au dev de mods , d'edition de textures , modeles , de lecture memoire , de conversttion de fichier c'est un veritable moteur de jeu et IDE tout en un créé par Rose Griffon en accord avec LEVEL 5 (`LICENSE`)
## Crates

Le jeu (la fin) :

- `nie-formats` — lecture pure-Rust des conteneurs Level-5/Criware (CPK/@UTF/CRILAYLA, g4tx/g4md/g4mg/g4sk/g4pk, cfg.bin RDBN, nxtch).
- `nie-data` — modèles `no_std` des données du jeu (port inagle : chara_param, skill, item, aura, passive, growth, exp).
- `nie-core` — logique de jeu reversée (FSM de match, effets de commande, action-ctrl, stats, skills, auras) — 126 tests.
- `nie-headless` — runner natif headless (sans moteur Windows).
- `nie-wasm` — bindings wasm-bindgen, cible `wasm32-unknown-unknown` / web.

L'échafaudage (le moyen) :

- `nie-index` — base de connaissance sqlite (schéma + ingest/query, table `coverage`).
- `nie-seed` — ingestion du corpus (index Ghidra `nie.exe` + RTTI + formats iecode + hash→nom inagle).
- `nie-re` — moteur RE : RTTI MSVC, refondation `.pdata`, désassemblage iced-x86 (arêtes d'appel), propagation auto-ML.
- `nie-queue` — frontière BFS redis (workers parallèles).
- `nie-cli` — binaire `niers` (seed / rtti / rebuild / disasm / propagate / coverage / queue / textures).

## Build

Toolchain : `nightly-2026-05-17` (présente sous `~/.rustup/toolchains`, rustup absent → invoquer son cargo
directement). Wasm via la toolchain `nightly` (seule avec la std `wasm32`).

```
cargo build --workspace
cargo test --workspace
niers seed --db var/niers.sqlite --json refs/iecode-re/research/nie-index.json --exe nie_eacpatched.exe
niers rebuild --db var/niers.sqlite --exe nie_eacpatched.exe   # refonde sur .pdata (vérité terrain)
niers coverage --db var/niers.sqlite
```
