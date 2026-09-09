//! Host-independent Azalee rules.
//!
//! This module contains only deterministic values and algorithms. It knows
//! nothing about HTTP, Supabase, SQLite, or network caches. CLI and site
//! bindings may use it, but remain responsible for transport and persistence.
//!
//! The IEVR game rules in this namespace are real Rust implementations, not
//! HTTP/TypeScript facades. Romaji-to-kana transliteration, wiki queries, and
//! database projections are intentionally excluded: they require a
//! dictionary/codec or a host adapter.

pub mod article_series;
pub mod asset_mapping;
pub mod comments;
pub mod formations;
pub mod game_text;
pub mod gender;
pub mod item_categories;
pub mod personality;
pub mod reactions;
pub mod roster_identifiers;
pub mod roster_resolver;
pub mod search;
pub mod skills_cutin;
pub mod smart_search;
pub mod stats_interpolation;
pub mod team_code;
pub mod team_emblem_map;
pub mod team_rules;
pub mod team_types;
