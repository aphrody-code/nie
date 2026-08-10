//! Acquisition Steam native pour niers — download/dump des depots IEVR en Rust pur.
//!
//! Port de `IECODE.Core/Steam/` (C#, sur SteamKit2) vers Rust, sur la fondation
//! [`steamroom`] / [`steamroom_client`]. Couche specifique iecode portee ici ;
//! le protocole Steam (CM, auth, manifest, chunk, CDN) est fourni par steamroom.
//!
//! App ID IEVR = `2799860` (LEVEL5). `3593770` est un decoy (collision de nom).
//!
//! # Modules
//! - [`depot_resolver`] — sélection pure des depots (sans I/O), port fidèle de
//!   `SteamDepotResolver.cs`. Testable unitairement via des KV synthétiques.
//! - [`token_store`] — cache JSON refresh token + guard data par compte
//!   (`SteamTokenStore.cs`). Thread-safe, best-effort.
//! - [`options`] — structs d'options (`SteamDownloadOptions.cs`) + types auxiliaires.
//! - [`session`] — session authentifiée CM + PICS + clés depots (`Steam3Session.cs`).
//! - [`downloader`] — orchestration download (`SteamDepotDownloader.cs`).

/// App ID Steam d'Inazuma Eleven: Victory Road (LEVEL5).
pub const IEVR_STEAM_APP_ID: u32 = 2799860;

pub mod depot_resolver;
pub mod downloader;
pub mod options;
pub mod session;
pub mod token_store;
