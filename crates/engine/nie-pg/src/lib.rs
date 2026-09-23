//! `nie-pg` — the IEVR VFS cfg.bin files in PostgreSQL (schema `nie`).
//!
//! Pipeline: VFS -> bytes -> [`decode`] (`nie-formats` binary parsers) -> binary `COPY`.
//! No JSON step. Imports are incremental (SHA-256 per file) and transactional per file:
//! an interruption leaves each file either absent or complete.
//!
//! Azalée boundary: nie writes only to schema `nie`; readers get the `nie_reader` role
//! (see `migrations/0001_nie_cfgbin.sql`).

pub mod decode;
pub mod store;

pub use decode::{Body, DecodeError, Decoded, decode};
pub use store::{ImportOutcome, migrate, store_file};

/// Embedded migrations, applied in order by [`migrate`].
pub const MIGRATIONS: &[(i32, &str)] = &[(1, include_str!("../migrations/0001_nie_cfgbin.sql"))];

/// True for a VFS path of a binary config file to import.
#[must_use]
pub fn is_cfgbin_path(path: &str) -> bool {
    path.ends_with(".cfg.bin")
}
