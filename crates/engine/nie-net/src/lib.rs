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

pub mod clans;
pub mod competitive;
pub mod friends;
pub mod kizuna;
pub mod kizuna_link;
pub mod lobby;
pub mod match_record;
pub mod matchmaker;
pub mod protocol;
pub mod ranked;
pub mod rooms;
pub mod session;
pub mod state_machine;
pub mod tournament;

#[cfg(feature = "transport")]
pub mod client;
#[cfg(feature = "transport")]
pub mod server;

#[cfg(feature = "transport")]
pub use client::NetClient;
#[cfg(feature = "transport")]
pub use server::{NetServer, ServerState};

pub use clans::{Clan, ClanMember, ClanMemberRole, ClanRegistry};
pub use competitive::{
    CompetitiveLadder, DEFAULT_BASE_RATING, DEFAULT_K_FACTOR, EloMatchResult,
    PlayerCompetitiveProfile, RankTier, TierEloFactors, compute_match_elo, expected_score,
    progressive_elo_delta, tier_elo_factors,
};
pub use friends::{FriendGameInvite, PersonaState, SteamFriend, SteamFriends018};
pub use kizuna::{KizunaError, KizunaHub, KizunaTown};
pub use kizuna_link::{
    CGDDKizunalinkStatus, ChatPopoutNotification, GDSKizunaLinkConfig, KizunaLinkNode,
    TownChatMessage, VisitorNotificationLogEntry,
};
pub use lobby::{LobbyError, LobbyHub, Room};
pub use match_record::{GDSSoccerRankmatchConfig, MatchRecordAggregate, SoccerMatchRecord};
pub use matchmaker::{MatchFound, MatchmakingQueue, QueueTicket};
pub use protocol::{
    Inacode, KizunaAvatar, KizunaTownSnapshot, LEVEL5_NET_VER_2_3_0, MatchMode,
    NET_PROTOCOL_VERSION, NetMessage, PlacedTownCharacter, PlacedTownObject, PlayerInfo,
    PlayerSlot, PlayerTickInput, RoomConfig, RoomInfo, SessionType, TICK_DT, TICK_RATE_HZ,
    TownVisitor, UtSquadSummary,
};
pub use ranked::{
    CHALLENGE_CODE_ALPHABET, CHALLENGE_CODE_LEN, CHALLENGE_TTL_SECS, Challenge, ChallengeStore,
    MatchEvent, MatchRoomStatus, PlayerMatchState, QueueCandidate, RankedChatMessage,
    RankedEventType, RankedMatchRoom, RankedTelemetry, ScoreInput, ScoreOutcome, TeamSide,
    clamp_score, elo_window, resolve_scores, scores_agree, select_queue_pair,
};
pub use rooms::{
    GDSInacodeConfig, GDSSoccerClubRoomConfig, InacodeComment, InacodeRoomEntry,
    NetworkBlockUserRegistry, NetworkRoomTown, RoomStatus, TownMember,
};
pub use session::{HistoryFrame, NetMatchSession, SessionError};
pub use state_machine::{
    GameNetQuickMatchmakeStateMachine, GameNetRankMatchmakeStateMachine,
    GameNetTournamentStateMachine, MatchmakeState, NetState, RematchJudge, SessionState,
    TournamentStage,
};
pub use tournament::{
    CircuitPointsTable, ScoreReportPolicy, Tournament, TournamentFormat, TournamentMatch,
    TournamentParticipant, TournamentStatus, circuit_points_for_rank, circuit_size_weight,
    dense_rank_to_tier,
};
