//! Acquisition Steam native pour niers — download/dump des depots IEVR en Rust pur.
//!
//! Port de `IECODE.Core/Steam/` (C#, sur SteamKit2) vers Rust, sur la fondation
//! [`steamroom`] / [`steamroom_client`]. Couche specifique iecode portee ici ;
//! le protocole Steam (CM, auth, manifest, chunk, CDN) est fourni par steamroom.
//!
//! App ID IEVR = `2799860` (LEVEL5). `3593770` est un decoy (collision de nom).

/// App ID Steam d'Inazuma Eleven: Victory Road (LEVEL5).
pub const IEVR_STEAM_APP_ID: u32 = 2799860;
