//! Protocol wire definitions and Level-5 network compatibility structures.
//!
//! Mirrors Level-5 EOS attributes (`NET_VER_2_3_0`, `SESSION_TYPE_GAME`, `SESSION_TYPE_TOWN`,
//! `MODE_2V2`) and defines the deterministic lockstep/rollback packet format.

use nie_geom::Vec2;
use nie_runtime::Input as RuntimeInput;
use serde::{Deserialize, Serialize};

/// Canonical nie online protocol version identifier.
pub const NET_PROTOCOL_VERSION: &str = "NIE_NET_1.0.0";

/// Level-5 native binary compatibility protocol version string (extracted from nie.exe).
pub const LEVEL5_NET_VER_2_3_0: &str = "NET_VER_2_3_0";

/// Standard match simulation tick rate, re-exported from the engine that owns it.
///
/// It used to be declared here, which had the network dictating the game's cadence. The cost was
/// real: `nie-play` stepped at 1/30 while the authoritative server broadcast 60 Hz, and nothing
/// could notice. Re-exporting makes the drift impossible rather than unlikely — there is one
/// number, in [`nie_runtime`].
pub use nie_runtime::{TICK_DT, TICK_RATE_HZ};

/// Maximum number of past frames retained in the rollback history ring buffer.
pub const ROLLBACK_MAX_FRAMES: usize = 64;

/// Inacode room identifier (e.g. `INA-7X29`).
///
/// Corresponds to `CMenuListViewInacodeRoom` from nie.exe.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Inacode(pub String);

impl Inacode {
    /// Formats and validates a room code string into canonical `INA-XXXX` form.
    #[must_use]
    pub fn new(code: &str) -> Self {
        let cleaned = code.trim().to_uppercase();
        let formatted = if cleaned.starts_with("INA-") {
            cleaned
        } else if cleaned.starts_with("INA") && cleaned.len() > 3 {
            format!("INA-{}", &cleaned[3..])
        } else {
            format!("INA-{cleaned}")
        };
        Self(formatted)
    }

    /// Generates a pseudo-random room code from an arbitrary numeric seed.
    #[must_use]
    pub fn generate_from_seed(seed: u64) -> Self {
        const CHARSET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
        let mut s = seed;
        let mut chars = [0u8; 4];
        for b in &mut chars {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            *b = CHARSET[(s as usize) % CHARSET.len()];
        }
        Self(format!(
            "INA-{}",
            std::str::from_utf8(&chars).unwrap_or("7X29")
        ))
    }

    /// Returns the raw room code string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for Inacode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Game session mode matching Level-5 game attributes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SessionType {
    /// Football match simulation (11 vs 11 or 2 vs 2).
    #[default]
    Game,
    /// Kizuna Town multiplayer social hub (`SESSION_TYPE_TOWN`).
    Town,
}

/// Match mode categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum MatchMode {
    /// Casual exhibition match (`flag_enjoy_match`).
    #[default]
    Casual,
    /// Competitive ranked ladder match (`flag_rank_match`).
    Ranked,
    /// Private custom room (`flag_room_match`).
    PrivateRoom,
    /// 2 vs 2 co-op team match (`MODE_2V2`).
    Mode2v2,
}

/// Assigned player slot in an active match or room.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum PlayerSlot {
    /// Team 0 primary captain (Home team).
    #[default]
    Home,
    /// Team 1 primary captain (Away team).
    Away,
    /// Team 0 secondary co-op player (2v2 mode).
    Home2,
    /// Team 1 secondary co-op player (2v2 mode).
    Away2,
    /// Spectator observer.
    Spectator,
}

impl PlayerSlot {
    /// Returns the 0-indexed team ID (0 for Home, 1 for Away).
    #[must_use]
    pub fn team_index(self) -> Option<u8> {
        match self {
            Self::Home | Self::Home2 => Some(0),
            Self::Away | Self::Away2 => Some(1),
            Self::Spectator => None,
        }
    }
}

/// Atomic player input for a specific simulation tick.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct PlayerTickInput {
    /// Target simulation tick sequence number.
    pub tick: u64,
    /// Normalized stick/directional input X (-1.0 to 1.0).
    pub dx: f32,
    /// Normalized stick/directional input Y (-1.0 to 1.0).
    pub dy: f32,
    /// Commanded shoot or clearance action.
    pub shoot: bool,
    /// Commanded pass action.
    pub pass: bool,
    /// Commanded special move (waza) ID, if triggered this tick.
    pub skill_id: Option<u32>,
}

impl PlayerTickInput {
    /// Converts wire tick input into `nie_runtime::Input`.
    #[must_use]
    pub fn to_runtime_input(&self) -> RuntimeInput {
        RuntimeInput {
            dir: Vec2::new(self.dx, self.dy),
            shoot: self.shoot,
        }
    }

    /// Constructs a tick input from runtime input.
    #[must_use]
    pub fn from_runtime(tick: u64, input: RuntimeInput) -> Self {
        Self {
            tick,
            dx: input.dir.x,
            dy: input.dir.y,
            shoot: input.shoot,
            pass: false,
            skill_id: None,
        }
    }
}

/// Configuration options for creating an Inacode room.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomConfig {
    /// Human-readable room title.
    pub name: String,
    /// Match mode.
    pub mode: MatchMode,
    /// Session type.
    pub session_type: SessionType,
    /// Maximum number of allowed members (2 for 1v1, 4 for 2v2, up to 8 with spectators).
    pub max_members: u8,
    /// Optional access password.
    pub password: Option<String>,
    /// Selected stadium ID.
    pub stadium: String,
    /// Half-time duration in real seconds (default: 180s = 3 minutes).
    pub half_time_seconds: u32,
}

impl Default for RoomConfig {
    fn default() -> Self {
        Self {
            name: "Match Inazuma".to_string(),
            mode: MatchMode::Casual,
            session_type: SessionType::Game,
            max_members: 2,
            password: None,
            stadium: "raimon_field".to_string(),
            half_time_seconds: 180,
        }
    }
}

/// State of a connected player inside a room.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerInfo {
    /// Unique player session identifier.
    pub id: String,
    /// Display username.
    pub name: String,
    /// Assigned slot.
    pub slot: PlayerSlot,
    /// Ready status.
    pub ready: bool,
    /// Round-trip latency in milliseconds.
    pub ping_ms: u32,
    /// Competitive MMR / rank points.
    pub rank_points: u32,
}

/// Complete room summary snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomInfo {
    /// Inacode room identifier.
    pub inacode: Inacode,
    /// Room configuration.
    pub config: RoomConfig,
    /// Host player identifier.
    pub host_id: String,
    /// Connected room members.
    pub members: Vec<PlayerInfo>,
    /// Whether a match is currently running.
    pub in_match: bool,
}

/// Player avatar customization data matching `kizuna_town_avatar_menu`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KizunaAvatar {
    /// Avatar chosen name.
    pub name: String,
    /// Gender (0: Male, 1: Female).
    pub gender: u8,
    /// Face preset model ID.
    pub face_id: u32,
    /// Hair style model ID.
    pub hair_style: u32,
    /// RGB hair color.
    pub hair_color: [u8; 3],
    /// Skin tone index (0..8).
    pub skin_tone: u8,
    /// RGB eye color.
    pub eye_color: [u8; 3],
    /// Uniform / kit ID (`inagle_costumes`).
    pub kit_id: u32,
    /// Shoes ID (`inagle_items`).
    pub shoes_id: u32,
    /// Optional favorite character appearance override (e.g. "c01000010").
    pub favorite_chara_id: Option<String>,
    /// Preferred position (GK, DF, MF, FW).
    pub position: String,
    /// Elemental affinity (Fire, Wind, Earth, Wood, Void).
    pub element: String,
}

impl Default for KizunaAvatar {
    fn default() -> Self {
        Self {
            name: "Joueur".to_string(),
            gender: 0,
            face_id: 1,
            hair_style: 1,
            hair_color: [40, 40, 40],
            skin_tone: 1,
            eye_color: [20, 20, 20],
            kit_id: 1,
            shoes_id: 1,
            favorite_chara_id: None,
            position: "FW".to_string(),
            element: "Fire".to_string(),
        }
    }
}

/// Object placed in Kizuna Town (`kizuna_items`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlacedTownObject {
    /// Unique placed instance identifier.
    pub instance_id: String,
    /// Item ID from `kizuna_items` (trees, benches, monuments, pitches).
    pub item_id: u32,
    /// World position (X, Y, Z).
    pub position: [f32; 3],
    /// Yaw orientation in radians.
    pub yaw: f32,
}

/// Recruited character placed in Kizuna Town (`inagle_characters`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlacedTownCharacter {
    /// Placed character instance identifier.
    pub instance_id: String,
    /// Character ID from game data (e.g. "c01000010").
    pub chara_id: String,
    /// Character display name.
    pub name: String,
    /// World position (X, Y, Z).
    pub position: [f32; 3],
    /// Yaw orientation in radians.
    pub yaw: f32,
    /// Custom greeting text.
    pub greeting: String,
}

/// Ultimate Team summary for a player in the multiplayer universe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct UtSquadSummary {
    /// Team name.
    pub team_name: String,
    /// Team rating (e.g. 88).
    pub rating: u32,
    /// Team chemistry (0..100).
    pub chemistry: u32,
    /// Formation name (e.g. "4-3-3").
    pub formation: String,
    /// Captain display name.
    pub captain_name: String,
    /// Captain rarity (Común, Raro, Legendario, Ícono, Basara).
    pub captain_rarity: String,
    /// Star player names in the squad.
    #[serde(default)]
    pub star_players: Vec<String>,
}

/// Active player visiting a Kizuna Town instance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TownVisitor {
    /// Player network ID.
    pub player_id: String,
    /// Player display name.
    pub player_name: String,
    /// Customized avatar.
    pub avatar: KizunaAvatar,
    /// Optional Ultimate Team squad summary.
    #[serde(default)]
    pub ut_squad: Option<UtSquadSummary>,
    /// Current world position.
    pub position: [f32; 3],
    /// Current movement velocity.
    pub velocity: [f32; 3],
    /// Orientation yaw in radians.
    pub yaw: f32,
    /// Active stamp/emote ID if currently emoting.
    pub active_emote: Option<u32>,
}

/// Snapshot of a Kizuna Town state synchronized with visitors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KizunaTownSnapshot {
    /// Town owner player ID.
    pub owner_id: String,
    /// Town owner name.
    pub owner_name: String,
    /// Town display name.
    pub town_name: String,
    /// Placed decorations and buildings.
    pub objects: Vec<PlacedTownObject>,
    /// Placed recruited characters.
    pub characters: Vec<PlacedTownCharacter>,
    /// Connected visiting players in the town instance.
    pub visitors: Vec<TownVisitor>,
}

/// Wire protocol messages exchanged between clients and the nie-net server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum NetMessage {
    /// Initial client handshake request.
    Hello {
        client_version: String,
        player_name: String,
    },
    /// Server handshake response.
    Welcome {
        server_version: String,
        player_id: String,
    },
    /// Request to create a new room.
    CreateRoom { config: RoomConfig },
    /// Response after room creation.
    RoomCreated {
        inacode: Inacode,
        config: RoomConfig,
    },
    /// Request to join an existing room by Inacode.
    JoinRoom {
        inacode: Inacode,
        password: Option<String>,
    },
    /// Response after joining a room.
    RoomJoined {
        inacode: Inacode,
        slot: PlayerSlot,
        room: RoomInfo,
    },
    /// Broadcast room state update (member joined, left, ready change).
    RoomUpdate { room: RoomInfo },
    /// Request to leave current room.
    LeaveRoom,
    /// Notification that room was left or closed.
    RoomLeft { reason: String },
    /// Toggle player ready state.
    SetReady { ready: bool },
    /// Client enqueues for automatic matchmaking.
    QueueMatch { mode: MatchMode, rank_points: u32 },
    /// Client cancels active matchmaking queue.
    CancelQueue,
    /// Match countdown / start signal broadcast to room.
    MatchStart {
        match_id: String,
        seed: u64,
        home_player_id: String,
        away_player_id: String,
    },
    /// Client sends local player tick input.
    InputTick { tick: u64, input: PlayerTickInput },
    /// Server broadcasts synchronized inputs for a confirmed tick.
    TickSync {
        tick: u64,
        inputs: [PlayerTickInput; 2],
        state_hash: u32,
    },
    /// Alert emitted when client or server detects a state hash divergence.
    DesyncAlert {
        tick: u64,
        expected_hash: u32,
        actual_hash: u32,
    },
    /// State correction snapshot sent to resynchronize desynced clients.
    StateCorrection {
        tick: u64,
        ball_pos: [f32; 3],
        ball_vel: [f32; 3],
        score: [u32; 2],
    },
    /// Match concluded with final score.
    MatchEnd {
        final_score: [u32; 2],
        duration_ticks: u64,
    },
    /// Latency measurement ping.
    Ping { seq: u64, client_time_ms: u64 },
    /// Latency measurement pong.
    Pong {
        seq: u64,
        client_time_ms: u64,
        server_time_ms: u64,
    },
    // --- Kizuna Town & Avatar Protocols ---
    /// Updates player's custom avatar.
    UpdateAvatar { avatar: KizunaAvatar },
    /// Client requests to join a Kizuna Town (own town if town_owner_id is None).
    JoinKizunaTown { town_owner_id: Option<String> },
    /// Full snapshot of Kizuna Town synchronized upon entering.
    KizunaTownSnapshotSync { snapshot: KizunaTownSnapshot },
    /// Client sends local avatar movement in Kizuna Town.
    TownMove {
        position: [f32; 3],
        velocity: [f32; 3],
        yaw: f32,
    },
    /// Server broadcasts visitor movement update to all visitors in town.
    TownMoveSync {
        player_id: String,
        position: [f32; 3],
        velocity: [f32; 3],
        yaw: f32,
    },
    /// Client activates a social stamp / emote.
    TownEmote { stamp_id: u32 },
    /// Server broadcasts visitor emote to town.
    TownEmoteSync { player_id: String, stamp_id: u32 },
    /// Client sends a chat message in Kizuna Town.
    TownChat { message: String },
    /// Server broadcasts chat message in Kizuna Town.
    TownChatSync {
        player_id: String,
        sender_name: String,
        message: String,
    },
    /// Client places an object in their Kizuna Town.
    TownPlaceObject { object: PlacedTownObject },
    /// Server confirms object placement in Kizuna Town.
    TownObjectPlaced { instance_id: String },
    /// Client removes an object in their Kizuna Town.
    TownRemoveObject { instance_id: String },
    /// Client places a character in their Kizuna Town.
    TownPlaceCharacter { character: PlacedTownCharacter },
    /// Server confirms character placement in Kizuna Town.
    TownCharacterPlaced { instance_id: String },
    /// Client removes a character in their Kizuna Town.
    TownRemoveCharacter { instance_id: String },
    /// Direct match challenge to a visiting friend in Kizuna Town.
    TownChallenge {
        target_player_id: String,
        mode: MatchMode,
    },
    /// Notification of an incoming match challenge.
    TownChallengeReceived {
        from_player_id: String,
        from_player_name: String,
        mode: MatchMode,
    },
    /// Response to match challenge.
    TownChallengeResponse {
        from_player_id: String,
        accept: bool,
    },
    /// Updates player's Ultimate Team squad summary in the persistent hub.
    UpdateSquadSummary { squad: UtSquadSummary },
    /// Client requests to inspect another player's Ultimate Team squad in town.
    TownInspectSquad { target_player_id: String },
    /// Server answers with inspected player's Ultimate Team squad.
    TownSquadInspected {
        player_id: String,
        squad: Option<UtSquadSummary>,
    },
    // --- Ranked & Tournament Protocols (Achillea Core) ---
    /// Submits match scoreline with mutual verification.
    RankedSubmitScore {
        match_id: String,
        my_goals: u32,
        opponent_goals: u32,
    },
    /// Broadcast of score agreement, match finalization, and AP deltas.
    RankedMatchFinished {
        match_id: String,
        home_score: u32,
        away_score: u32,
        home_ap_delta: i32,
        away_ap_delta: i32,
        is_disputed: bool,
    },
    /// Tournament bracket progression update.
    TournamentBracketUpdate {
        tournament_id: String,
        current_round: u32,
        total_rounds: u32,
    },
    /// Generic protocol error.
    Error { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inacode_formatting_and_seed() {
        let c1 = Inacode::new("7x29");
        assert_eq!(c1.as_str(), "INA-7X29");

        let c2 = Inacode::new("INA-4421");
        assert_eq!(c2.as_str(), "INA-4421");

        let generated = Inacode::generate_from_seed(42);
        assert!(generated.as_str().starts_with("INA-"));
        assert_eq!(generated.as_str().len(), 8);
    }

    #[test]
    fn wire_messages_json_roundtrip() {
        let msg = NetMessage::MatchStart {
            match_id: "match_101".to_string(),
            seed: 123456789,
            home_player_id: "p_home".to_string(),
            away_player_id: "p_away".to_string(),
        };
        let serialized = serde_json::to_string(&msg).expect("serialization ok");
        let deserialized: NetMessage =
            serde_json::from_str(&serialized).expect("deserialization ok");
        assert_eq!(msg, deserialized);
    }
}
