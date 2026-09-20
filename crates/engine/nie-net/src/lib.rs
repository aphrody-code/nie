//! **nie-net** — Inazuma Eleven Victory Road online multiplayer and networking engine.
//!
//! Reconstructs Level-5's online mode architecture (`nie.exe` EOS matchmaking, Inacode room
//! system, P2P packet exchange) and provides a 100% deterministic lockstep/rollback simulation
//! session for Native and WebAssembly targets.
//!
//! # Core Subsystems
//!
//! - [`protocol`]: Wire messages, Inacode format (`INA-XXXX`), Level-5 attribute definitions.
//! - [`session`]: `NetMatchSession` with 64-frame rollback buffer and automatic desync verification.
//! - [`lobby`]: `LobbyHub` managing room creation, player slots (Home, Away, 2v2), and readiness.
//! - [`matchmaker`]: Queueing and skill-based matchmaking.

pub mod kizuna;
pub mod lobby;
pub mod matchmaker;
pub mod protocol;
pub mod session;

#[cfg(feature = "transport")]
pub mod client;
#[cfg(feature = "transport")]
pub mod server;

#[cfg(feature = "transport")]
pub use client::NetClient;
#[cfg(feature = "transport")]
pub use server::{NetServer, ServerState};

pub use kizuna::{KizunaError, KizunaHub, KizunaTown};
pub use lobby::{LobbyError, LobbyHub, Room};
pub use matchmaker::{MatchFound, MatchmakingQueue, QueueTicket};
pub use protocol::{
    Inacode, KizunaAvatar, KizunaTownSnapshot, LEVEL5_NET_VER_2_3_0, MatchMode,
    NET_PROTOCOL_VERSION, NetMessage, PlacedTownCharacter, PlacedTownObject, PlayerInfo,
    PlayerSlot, PlayerTickInput, RoomConfig, RoomInfo, SessionType, TICK_DT, TICK_RATE_HZ,
    TownVisitor,
};
pub use session::{HistoryFrame, NetMatchSession, SessionError};
