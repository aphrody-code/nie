//! Level-5 Network Rooms, Member Towns, and Inacode Configuration.
//!
//! Reconstructed from reversed Level-5 symbols in `nie.exe`:
//! - `game::CMenuListViewNetworkRoom` (0x141a0ab98)
//! - `game::CMenuListViewNetworkRoomMemberTown` (0x141a0b0e0)
//! - `game::CMenuListViewNetworkRoomTown` (0x141a0b5e0)
//! - `game::CMenuListViewNetworkBlockUser` (0x141a0a6c8)
//! - `game::CMenuListViewInacodeRoom` (0x1419fae20)
//! - `game::CMenuListViewInacodeComment` (0x1419fab80)
//! - `game::GDSInacodeConfig` (0x1419cd8e8)
//! - `game::GDSSoccerClubRoomConfig` (0x1419ccda0)

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::protocol::{Inacode, MatchMode, PlayerSlot};

/// Room status flags matching Level-5 room directory listings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum RoomStatus {
    /// Room is open and accepting new members (`flag_room_recruiting`).
    #[default]
    Recruiting,
    /// Room has started match or event (`flag_room_in_match`).
    InMatch,
    /// Room reached max capacity (`flag_room_full`).
    Full,
    /// Room closed by host (`flag_room_closed`).
    Closed,
}

/// A member present in a Town instance (`CMenuListViewNetworkRoomMemberTown`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TownMember {
    /// Unique peer ID.
    pub peer_id: String,
    /// Player display name.
    pub display_name: String,
    /// Selected avatar ID or hairstyle ID.
    pub avatar_id: u32,
    /// Role in town room.
    pub is_host: bool,
    /// Connection timestamp (unix seconds).
    pub connected_at: u64,
    /// Assigned player slot if transitioning to match.
    pub slot: Option<PlayerSlot>,
    /// Team rating for display in member inspection card.
    pub squad_rating: u32,
}

/// A public or private Town room instance (`CMenuListViewNetworkRoomTown`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkRoomTown {
    /// Room identifier or Inacode.
    pub room_id: String,
    /// Room name (e.g. `"Tokio Central Hub"`, `"Raimon Clubroom"`).
    pub room_name: String,
    /// Maximum capacity (default 32 for towns, 8 for clubrooms).
    pub max_capacity: usize,
    /// Whether this is the persistent Tokio public hub.
    pub is_public_hub: bool,
    /// Optional password or Inacode requirement.
    pub inacode: Option<Inacode>,
    /// Currently connected town members keyed by peer_id.
    pub members: HashMap<String, TownMember>,
    /// Creation timestamp (unix seconds).
    pub created_at: u64,
}

impl NetworkRoomTown {
    /// Creates a new town room instance.
    #[must_use]
    pub fn new(
        room_id: String,
        room_name: String,
        is_public_hub: bool,
        max_capacity: usize,
    ) -> Self {
        Self {
            room_id,
            room_name,
            max_capacity,
            is_public_hub,
            inacode: None,
            members: HashMap::new(),
            created_at: 0,
        }
    }

    /// Adds a member if capacity allows.
    pub fn join(&mut self, member: TownMember) -> Result<(), &'static str> {
        if self.members.len() >= self.max_capacity {
            return Err("Town room is at maximum capacity");
        }
        self.members.insert(member.peer_id.clone(), member);
        Ok(())
    }

    /// Removes a member by peer ID.
    pub fn leave(&mut self, peer_id: &str) -> Option<TownMember> {
        self.members.remove(peer_id)
    }

    /// Returns the number of currently active members.
    #[must_use]
    pub fn member_count(&self) -> usize {
        self.members.len()
    }
}

/// Inacode room directory entry (`CMenuListViewInacodeRoom`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InacodeRoomEntry {
    /// 8-character Inacode (`INA-XXXX`).
    pub inacode: Inacode,
    /// Host player name.
    pub host_name: String,
    /// Match mode.
    pub match_mode: MatchMode,
    /// Selected comment badge (`CMenuListViewInacodeComment`).
    pub comment_id: u32,
    /// Password protected flag.
    pub has_password: bool,
    /// Current member count.
    pub current_players: u8,
    /// Maximum player capacity (2 for 1v1, 4 for 2v2).
    pub max_players: u8,
    /// Status.
    pub status: RoomStatus,
}

/// Pre-canned Inacode greeting / comment badges matching Level-5 table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InacodeComment {
    /// Comment ID (1..=12).
    pub id: u32,
    /// French text display.
    pub text_fr: String,
    /// English text display.
    pub text_en: String,
    /// Japanese text display.
    pub text_ja: String,
}

impl InacodeComment {
    /// Returns the canonical list of 8 Level-5 Inacode comments.
    #[must_use]
    pub fn defaults() -> Vec<Self> {
        vec![
            Self {
                id: 1,
                text_fr: "Jouons un match amical !".into(),
                text_en: "Let's play a friendly match!".into(),
                text_ja: "親善試合をしよう！".into(),
            },
            Self {
                id: 2,
                text_fr: "Débutants bienvenus !".into(),
                text_en: "Beginners welcome!".into(),
                text_ja: "初心者歓迎！".into(),
            },
            Self {
                id: 3,
                text_fr: "Entraînement Victory Road".into(),
                text_en: "Victory Road training".into(),
                text_ja: "ヴィクトリーロード特訓！".into(),
            },
            Self {
                id: 4,
                text_fr: "Test de nouvelle équipe".into(),
                text_en: "Testing a new squad".into(),
                text_ja: "新チームお試し中".into(),
            },
            Self {
                id: 5,
                text_fr: "Match compétitif sans pitié !".into(),
                text_en: "Serious competitive match!".into(),
                text_ja: "本気のガチ対戦！".into(),
            },
            Self {
                id: 6,
                text_fr: "Défiez mes supertactiques !".into(),
                text_en: "Challenge my super tactics!".into(),
                text_ja: "必殺タクティクス勝負！".into(),
            },
            Self {
                id: 7,
                text_fr: "Match en 2 contre 2".into(),
                text_en: "2 vs 2 Co-op Match".into(),
                text_ja: "2対2 協力対戦！".into(),
            },
            Self {
                id: 8,
                text_fr: "Recherche de rivaux Kizuna".into(),
                text_en: "Looking for Kizuna rivals".into(),
                text_ja: "キズナライバル募集中".into(),
            },
        ]
    }
}

/// User blocklist registry matching `CMenuListViewNetworkBlockUser`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetworkBlockUserRegistry {
    /// Set of blocked peer IDs.
    pub blocked_ids: HashSet<String>,
}

impl NetworkBlockUserRegistry {
    /// Creates an empty block registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a peer to the block list.
    pub fn block(&mut self, peer_id: String) {
        self.blocked_ids.insert(peer_id);
    }

    /// Removes a peer from the block list.
    pub fn unblock(&mut self, peer_id: &str) -> bool {
        self.blocked_ids.remove(peer_id)
    }

    /// Returns true if the peer is blocked.
    #[must_use]
    pub fn is_blocked(&self, peer_id: &str) -> bool {
        self.blocked_ids.contains(peer_id)
    }
}

/// Global Inacode room configuration matching `GDSInacodeConfig` (0x1419cd8e8).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GDSInacodeConfig {
    /// Timeout in seconds before an empty room is automatically closed (default 300s).
    pub room_idle_timeout_seconds: u32,
    /// Maximum password length for private rooms (default 4 digits).
    pub max_password_length: u8,
    /// Maximum reconnect retry window in seconds (default 30s).
    pub reconnect_grace_period_sec: u32,
    /// Maximum simultaneous active rooms per player (default 1).
    pub max_rooms_per_host: u8,
}

impl Default for GDSInacodeConfig {
    fn default() -> Self {
        Self {
            room_idle_timeout_seconds: 300,
            max_password_length: 4,
            reconnect_grace_period_sec: 30,
            max_rooms_per_host: 1,
        }
    }
}

/// Soccer clubroom settings matching `GDSSoccerClubRoomConfig` (0x1419ccda0).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GDSSoccerClubRoomConfig {
    /// Clubroom theme ID (e.g. Raimon, Teikoku, Zeus, Outei Tsukinomiya).
    pub theme_id: u32,
    /// Maximum club members present at once (default 16).
    pub max_members: u8,
    /// Whether trophies and badges are displayed on club walls.
    pub show_trophy_case: bool,
    /// Custom welcome bulletin message.
    pub bulletin_message: String,
}

impl Default for GDSSoccerClubRoomConfig {
    fn default() -> Self {
        Self {
            theme_id: 1, // Raimon Clubroom
            max_members: 16,
            show_trophy_case: true,
            bulletin_message: "Bienvenue au Club de Football de Raimon !".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_town_room_member_lifecycle() {
        let mut room = NetworkRoomTown::new("town_01".into(), "Tokio Central".into(), true, 4);
        assert_eq!(room.member_count(), 0);

        let m1 = TownMember {
            peer_id: "p1".into(),
            display_name: "Mark Evans".into(),
            avatar_id: 1,
            is_host: true,
            connected_at: 1000,
            slot: None,
            squad_rating: 92,
        };
        room.join(m1).unwrap();
        assert_eq!(room.member_count(), 1);

        let removed = room.leave("p1");
        assert!(removed.is_some());
        assert_eq!(room.member_count(), 0);
    }

    #[test]
    fn test_block_user_registry() {
        let mut reg = NetworkBlockUserRegistry::new();
        reg.block("bad_player_66".into());
        assert!(reg.is_blocked("bad_player_66"));
        assert!(!reg.is_blocked("friendly_player_7"));

        reg.unblock("bad_player_66");
        assert!(!reg.is_blocked("bad_player_66"));
    }

    #[test]
    fn test_inacode_comments() {
        let comments = InacodeComment::defaults();
        assert_eq!(comments.len(), 8);
        assert!(comments[0].text_fr.contains("amical"));
    }
}
