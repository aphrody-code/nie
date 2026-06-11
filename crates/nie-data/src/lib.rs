//! `nie-data` — modèles de données de jeu IEVR (Inazuma Eleven: Victory Road) portés
//! en Rust pur, `no_std + alloc` (donc `wasm32`-compatible sans std).
//!
//! ## Vérité terrain (anti-hallucination)
//!
//! Chaque structure, offset et valeur golden de ce crate est ancré sur le pipeline TS
//! de production `@rose-griffon/inagle` (`/home/ubuntu/rg/packages/inagle/src`) et sur
//! les vrais dumps `*.cfg.bin.json` d'IEVR (`/home/ubuntu/niers/data/common/gamedata`). Aucune
//! valeur n'est inventée : les modules citent leur fichier-source TS et le dump réel.
//!
//! ## Modules
//!
//! - [`hash`] — identifiants hash 32 bits Level-5 (parse/format hex `0xXXXXXXXX`, signé→non-signé).
//! - [`cfgbin`] — vues minimales sur le JSON `cfg.bin.json` (noeuds/variables) pour le parse.
//! - [`skill`] — `SkillInfo` + enums, port de `m_skillInfoList` (skill_config) + jointure skill_text.
//! - [`chara_param`] — `CharaParam`, port du noeud `CHARA_PARAM_INFO_*` (chara_param.cfg.bin).
//! - [`aura`] — `AuraCmd`, port du noeud `AURA_CMD_INFO_*` (aura_skill_config) + résolution hissatsu.
//! - [`item`] — `ItemInfo` + `ItemCategory`, port des noeuds `ITEM_*_INFO_*` (item_config).
//! - [`growth`] — tables de croissance + `calculate_stats` (interpolation Lv1→99).
//! - [`exp`] — `chara_exp_table_config` (XP/niveau + multiplicateurs de rareté).
//! - [`passive`] — `PassiveSkillInfo` + classification scope/boost (passive_skill_config).
//!
//! ## `no_std`
//!
//! Tout le crate est `#![no_std]` + `extern crate alloc`. Aucune dépendance `std` :
//! `serde_json` est compilé en `default-features = false, features = ["alloc"]`. Compatible
//! `wasm32-unknown-unknown` sans shim.
#![no_std]
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

extern crate alloc;

pub mod ai;
pub mod aura;
pub mod boost_grp;
pub mod cfgbin;
pub mod chara_param;
pub mod chronicle_top;
pub mod command;
pub mod dictionary;
pub mod dungeon;
pub mod exp;
pub mod fast_travel;
pub mod formation;
pub mod friendmap;
pub mod growth;
pub mod hash;
pub mod item;
pub mod light;
pub mod mission;
pub mod party;
pub mod passive;
pub mod passives;
pub mod phase;
pub mod record;
pub mod rpg_battle;
pub mod skill;
pub mod soccer;
pub mod weather;

pub use hash::HashId;
