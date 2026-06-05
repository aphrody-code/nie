//! nie-zukan — ingesteur de l'encyclopédie officielle Level-5 « Inagle »
//! (zukan.inazuma.jp) pour les 3 langues : JP (racine), FR (/fr/), EN (/en/).
//!
//! # Architecture
//!
//! - [`forge`] : encodage/décodage du paramètre `?q=` (bit-invert + base64url + urlencode)
//! - [`client`] : client HTTP poli (rate-limit, retry, cache disque)
//! - [`parser`] : parsers HTML → structs typées [`ZukanChara`], [`ZukanSkill`], [`ZukanItem`]
//! - [`pull`] : orchestration du pull complet (chara_list → IDs → chara_param + skills + items)
//! - [`cross`] : croisement avec le miroir SQLite inagle

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod client;
pub mod cross;
pub mod forge;
pub mod models;
pub mod parser;
pub mod pull;
