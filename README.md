# niers

**Réécriture intégrale d'*Inazuma Eleven: Victory Road* (IEVR, moteur Level-5 « Lives ») en Rust pur —
jouable en headless + WebAssembly, sans le binaire Windows ni le moteur propriétaire.**

niers n'est pas un outil d'analyse : c'est une **réimplémentation du jeu**. Le reverse-engineering de `nie.exe`
(boucle autonome RE ° auto-ML ° sqlite ° redis, **92,45 %** des fonctions réelles *classifiées* — un label de sous-système ML, pas un nom) est **le moyen** —
il résout la logique du binaire pour la **porter** en crates Rust. Les références de portage sont `iecode` (C#)
et `inagle` (TS) + le réel, validés byte-à-byte ; la cible est que niers fasse **tout** lui-même en Rust.

Plan maître : **`docs/PLAN.md`**. Architecture & boucle RE : `docs/ARCHITECTURE.md`. Avancement :
`docs/jeu-jouable-avancement.md`, `docs/assets-wasm-avancement.md`.

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
