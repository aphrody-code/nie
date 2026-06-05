//! `nie-wiki` — exploration game-data IEVR depuis le miroir SQLite.
//!
//! Porte le comportement des commandes `chara`, `skill`, `item`, `team`,
//! `compare`, `search`, `db`, `random-team`, `team-builder`, `status`,
//! `redis`, `audit` et `dialogue` de l'azalee CLI TypeScript vers Rust pur,
//! en lisant le même miroir SQLite (`supabase-*.sqlite`).
//!
//! ## Pièges reproductibles depuis le TS
//!
//! - `inagle_skills.category_id` / `element_id` sont NULL → résolution via colonnes texte FR.
//! - Fusion `data` + `sheet_data` (sheet_data prioritaire si présent).
//! - Vues `*_clean` inexistantes → émulées par `GROUP BY name_fr` côté query.
//! - `sanitizeFilter` : on ne strip pas les underscores (les IDs d'auras en contiennent).
//! - `random-team` : PRNG explicitement seédé (SmallRng::seed_from_u64) — interdit RNG implicite.
//! - `db [sql]` : refuse les writes (SELECT/PRAGMA/EXPLAIN/WITH uniquement).
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

pub mod mirror;
pub mod model;
pub mod query;
pub mod render;
