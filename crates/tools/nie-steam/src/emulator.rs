//! Steamworks Native API Emulator for `nie.exe`.
//!
//! Provides in-process emulation of Steamworks APIs so `nie.exe` can execute
//! completely decoupled from the real Steam client, while bridging multiplayer
//! and friends to `nie-net`.
//!
//! Ports:
//! - `fn_SteamFriends018` (0x1404ebcf0)
//! - `SteamAPI_Init` / `SteamAPI_Shutdown`
//! - `SteamAPI_RestartAppIfNecessary`
//! - `SteamUser()` / `SteamFriends()` / `SteamMatchmaking()` / `SteamNetworkingSockets()`

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::IEVR_STEAM_APP_ID;

// Re-export converged types from nie-net
pub use nie_net::friends::{FriendGameInvite, PersonaState, SteamFriend, SteamFriends018};
pub use nie_net::rooms::InacodeRoomEntry;

/// Alias for backwards compatibility with previous emulator callers.
pub type FriendRecord = SteamFriend;

/// Virtual Steam ID format (64-bit).
pub const DEFAULT_LOCAL_STEAM_ID: u64 = 76561198027998600;

/// Simulated lobby record for `ISteamMatchmaking`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamLobbyRecord {
    /// Lobby ID.
    pub lobby_id: u64,
    /// Host Steam ID.
    pub owner_steam_id: u64,
    /// Lobby metadata key-values.
    pub metadata: HashMap<String, String>,
    /// Member Steam IDs.
    pub members: Vec<u64>,
    /// Member limit (default 2 for 1v1, 4 for 2v2).
    pub member_limit: usize,
}

impl SteamLobbyRecord {
    /// Bridges this lobby to an Inacode room entry for Level-5 network discovery.
    #[must_use]
    pub fn to_inacode_room(&self) -> InacodeRoomEntry {
        InacodeRoomEntry {
            inacode: nie_net::protocol::Inacode(format!(
                "INA-{:04X}",
                (self.lobby_id & 0xFFFF) as u16
            )),
            host_name: self
                .metadata
                .get("name")
                .cloned()
                .unwrap_or_else(|| format!("Host_{}", self.owner_steam_id)),
            match_mode: nie_net::protocol::MatchMode::Ranked,
            comment_id: 1,
            has_password: self.metadata.contains_key("password"),
            current_players: self.members.len().min(255) as u8,
            max_players: self.member_limit.min(255) as u8,
            status: nie_net::rooms::RoomStatus::Recruiting,
        }
    }
}

/// In-process Steam API emulator state.
#[derive(Debug, Clone)]
pub struct SteamEmulatorState {
    /// App ID (defaults to 2799860).
    pub app_id: u32,
    /// Local user Steam ID.
    pub local_steam_id: u64,
    /// Local user persona name.
    pub persona_name: String,
    /// Whether SteamAPI_Init was called.
    pub initialized: bool,
    /// Rich presence map for local user.
    pub local_rich_presence: HashMap<String, String>,
    /// Friends list.
    pub friends: HashMap<u64, FriendRecord>,
    /// Lobbies list.
    pub lobbies: HashMap<u64, SteamLobbyRecord>,
    /// Next lobby ID seed.
    pub next_lobby_id: u64,
    /// User stats & achievements dictionary.
    pub stats: HashMap<String, i32>,
    /// Unlocked achievements set.
    pub achievements: HashMap<String, bool>,
}

impl Default for SteamEmulatorState {
    fn default() -> Self {
        let mut friends = HashMap::new();
        // Seed default canonical Level-5 AI / friend avatars
        friends.insert(
            76561198000000001,
            SteamFriend::new(
                76561198000000001,
                "Mark Evans (Mamoru)".into(),
                PersonaState::Online,
            )
            .with_presence("status", "Kizuna Town Training"),
        );
        friends.insert(
            76561198000000002,
            SteamFriend::new(
                76561198000000002,
                "Axel Blaze (Gouenji)".into(),
                PersonaState::Online,
            )
            .with_presence("status", "Victory Road Match"),
        );
        friends.insert(
            76561198000000003,
            SteamFriend::new(
                76561198000000003,
                "Jude Sharp (Kidou)".into(),
                PersonaState::Online,
            )
            .with_presence("status", "Analyzing Tactics"),
        );

        Self {
            app_id: IEVR_STEAM_APP_ID,
            local_steam_id: DEFAULT_LOCAL_STEAM_ID,
            persona_name: "Afubuki".into(),
            initialized: false,
            local_rich_presence: HashMap::new(),
            friends,
            lobbies: HashMap::new(),
            next_lobby_id: 109775241033287000,
            stats: HashMap::new(),
            achievements: HashMap::new(),
        }
    }
}

impl SteamEmulatorState {
    /// Bridges the emulator state to a converged `SteamFriends018` instance.
    #[must_use]
    pub fn to_friends018(&self) -> SteamFriends018 {
        SteamFriends018 {
            local_steam_id: self.local_steam_id,
            local_persona_name: self.persona_name.clone(),
            friends: self.friends.clone(),
            incoming_invites: Vec::new(),
            local_rich_presence: self.local_rich_presence.clone(),
        }
    }
}

/// Global emulator handle.
#[derive(Debug, Clone, Default)]
pub struct SteamApiEmulator {
    state: Arc<RwLock<SteamEmulatorState>>,
}

impl SteamApiEmulator {
    /// Creates a new emulator instance with default configuration.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Emulates `SteamAPI_Init()`.
    pub fn init(&self) -> bool {
        let mut st = self.state.write().unwrap();
        st.initialized = true;
        true
    }

    /// Emulates `SteamAPI_Shutdown()`.
    pub fn shutdown(&self) {
        let mut st = self.state.write().unwrap();
        st.initialized = false;
    }

    /// Emulates `SteamAPI_RestartAppIfNecessary(app_id)` -> false (no restart required).
    #[must_use]
    pub fn restart_app_if_necessary(&self, _app_id: u32) -> bool {
        false
    }

    /// Returns local user Steam ID (`SteamUser()->GetSteamID()`).
    #[must_use]
    pub fn get_steam_id(&self) -> u64 {
        self.state.read().unwrap().local_steam_id
    }

    /// Returns local persona name (`SteamFriends()->GetPersonaName()`).
    #[must_use]
    pub fn get_persona_name(&self) -> String {
        self.state.read().unwrap().persona_name.clone()
    }

    /// Sets local persona name (`SteamFriends()->SetPersonaName()`).
    pub fn set_persona_name(&self, name: &str) {
        let mut st = self.state.write().unwrap();
        st.persona_name = name.to_string();
    }

    /// Emulates `SteamFriends018::GetFriendCount()`.
    #[must_use]
    pub fn get_friend_count(&self) -> usize {
        self.state.read().unwrap().friends.len()
    }

    /// Emulates `SteamFriends018::GetFriendByIndex()`.
    #[must_use]
    pub fn get_friend_by_index(&self, index: usize) -> Option<u64> {
        let st = self.state.read().unwrap();
        st.friends.keys().nth(index).copied()
    }

    /// Emulates `SteamFriends018::GetFriendPersonaName()`.
    #[must_use]
    pub fn get_friend_persona_name(&self, friend_id: u64) -> Option<String> {
        let st = self.state.read().unwrap();
        st.friends.get(&friend_id).map(|f| f.persona_name.clone())
    }

    /// Emulates `SteamFriends018::SetRichPresence()`.
    pub fn set_rich_presence(&self, key: &str, value: &str) -> bool {
        let mut st = self.state.write().unwrap();
        st.local_rich_presence
            .insert(key.to_string(), value.to_string());
        true
    }

    /// Emulates `SteamFriends018::ClearRichPresence()`.
    pub fn clear_rich_presence(&self) {
        let mut st = self.state.write().unwrap();
        st.local_rich_presence.clear();
    }

    /// Obtains a converged `SteamFriends018` social interface snapshot.
    #[must_use]
    pub fn friends_interface(&self) -> SteamFriends018 {
        self.state.read().unwrap().to_friends018()
    }

    /// Returns active lobbies converted to Level-5 `InacodeRoomEntry` discovery records.
    #[must_use]
    pub fn get_inacode_rooms(&self) -> Vec<InacodeRoomEntry> {
        let st = self.state.read().unwrap();
        st.lobbies.values().map(|l| l.to_inacode_room()).collect()
    }

    /// Emulates `SteamMatchmaking::CreateLobby()`.
    pub fn create_lobby(&self, max_members: usize) -> u64 {
        let mut st = self.state.write().unwrap();
        let lobby_id = st.next_lobby_id;
        st.next_lobby_id += 1;
        let owner = st.local_steam_id;

        let record = SteamLobbyRecord {
            lobby_id,
            owner_steam_id: owner,
            metadata: HashMap::new(),
            members: vec![owner],
            member_limit: max_members,
        };
        st.lobbies.insert(lobby_id, record);
        lobby_id
    }

    /// Emulates `SteamMatchmaking::SetLobbyData()`.
    pub fn set_lobby_data(&self, lobby_id: u64, key: &str, value: &str) -> bool {
        let mut st = self.state.write().unwrap();
        if let Some(lobby) = st.lobbies.get_mut(&lobby_id) {
            lobby.metadata.insert(key.to_string(), value.to_string());
            true
        } else {
            false
        }
    }

    /// Emulates `SteamMatchmaking::GetLobbyData()`.
    #[must_use]
    pub fn get_lobby_data(&self, lobby_id: u64, key: &str) -> Option<String> {
        let st = self.state.read().unwrap();
        st.lobbies.get(&lobby_id)?.metadata.get(key).cloned()
    }

    /// Sets an achievement (`SteamUserStats()->SetAchievement()`).
    pub fn set_achievement(&self, name: &str) {
        let mut st = self.state.write().unwrap();
        st.achievements.insert(name.to_string(), true);
    }

    /// Checks if an achievement is unlocked (`SteamUserStats()->GetAchievement()`).
    #[must_use]
    pub fn get_achievement(&self, name: &str) -> bool {
        let st = self.state.read().unwrap();
        st.achievements.get(name).copied().unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_steam_emulator_lifecycle() {
        let emu = SteamApiEmulator::new();
        assert!(!emu.restart_app_if_necessary(IEVR_STEAM_APP_ID));
        assert!(emu.init());
        assert_eq!(emu.get_steam_id(), DEFAULT_LOCAL_STEAM_ID);

        emu.set_persona_name("Afubuki");
        assert_eq!(emu.get_persona_name(), "Afubuki");

        assert_eq!(emu.get_friend_count(), 3);
        let f0 = emu.get_friend_by_index(0).unwrap();
        assert!(emu.get_friend_persona_name(f0).is_some());

        emu.set_rich_presence("status", "Rank Match - Final");
        let lobby_id = emu.create_lobby(2);
        assert!(emu.set_lobby_data(lobby_id, "inacode", "INA-8888"));
        assert_eq!(
            emu.get_lobby_data(lobby_id, "inacode").as_deref(),
            Some("INA-8888")
        );

        emu.set_achievement("ACH_FIRST_VICTORY");
        assert!(emu.get_achievement("ACH_FIRST_VICTORY"));
        assert!(!emu.get_achievement("ACH_100_GOALS"));

        emu.shutdown();
    }
}
