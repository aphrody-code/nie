//! `nie-engine` — Portage RE des sous-systèmes moteur de `nie.exe`
//!
//! Ce crate porte en Rust idiomatique les sous-systèmes bas-niveau du moteur
//! Level-5 Lives, extraits du pseudo-C Ghidra de `nie.exe` (Inazuma Eleven:
//! Victory Road). Chaque module cite sa source exacte et documente les
//! incertitudes de reconstruction.
//!
//! # Modules
//!
//! - [`app`] — point d'entrée PE (`entry`, `0x140985524`) et initialisation config
//!   applicative (`app_config_init`, `0x140ae76b0`, chemin `app_config_5.00.24.00.cfg.bin`)
//! - [`audio`] — CRI Atom Ex (initialisation pipeline audio) + CRI Mana (lecteur
//!   vidéo/audio Sofdec2/USM)
//! - [`cpk`] — Scanner CPK (`data/packs/*.cpk`), chargeur `cpk_list.cfg.bin`,
//!   vérification magic CRILAYLA (portage de `FUN_14157c660`, `FUN_14157cf50`,
//!   `FUN_14066371c`)
//! - [`g4`] — sous-système de ressources G4 (cycle de vie G4MD/G4RA/G4SK, cache
//!   de textures G4TX, initialisation des slots G4PK)
//! - [`animation`] — `lives::gmdCAnimation` : constructeur/destructeur, blend
//!   osseux bone-to-bone, PlayAnime types 0/1/2 avec recherche G4MT
//! - [`network`] — EOS Lobby (init/cleanup/create/modify) + pont Lua réseau
//!   `funcLuaMenuNetworkCommand` (portage de `FUN_141142fa0`, `FUN_1411430e0`,
//!   `FUN_1411431b0`, `FUN_141148d80`, `FUN_141141660`, `FUN_141088380`)
//! - [`menu`] — `lives::CMenuRender` (init/render 0x44C slots), dispatch de liste
//!   d'habiletés (`FUN_140f57fc0` hash 0x7d5ab4f6/0xad4a27a6/0xf9334531),
//!   commandes Lua menu (`funcLuaMenuCommand`, apply_motion, simple)
//! - [`render`] — Pipeline de rendu D3D11/DXGI : init device (`FUN_14045ab10`),
//!   quad plein-écran (`FUN_14045b980`), swap-chain HDR (`FUN_14045c780`),
//!   création texture DDS (`FUN_140459be0`), formats DXGI (`FUN_140459110/210`),
//!   tile-light compute shaders (`FUN_1411b8650`), pipeline init (`FUN_140ef27c0`),
//!   création/reflection shader (`FUN_140475180`)
//!
//! # Conventions de portage
//!
//! - `#![forbid(unsafe_code)]` — aucun `unsafe` dans ce crate
//! - Les champs `undefined8`/`param_N` Ghidra sont reconstruits sémantiquement
//! - Les adresses binaires (`0x140xxxxxx`) sont documentées en commentaire source
//! - Les incertitudes RE sont signalées `// RE incertain: …`

#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![allow(clippy::pedantic)]

pub mod animation;
pub mod app;
pub mod audio;
pub mod cfgbin;
pub mod cpk;
pub mod g4;
pub mod menu;
pub mod network;
pub mod render;
pub mod scripting;
