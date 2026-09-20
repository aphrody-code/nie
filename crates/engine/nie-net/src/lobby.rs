//! Inacode room and lobby management hub.
//!
//! Handles room creation, Inacode assignment, member slot distribution (Home, Away, 2v2),
//! password verification, player ready states, and match launching.

use std::collections::HashMap;
use crate::protocol::{Inacode, MatchMode, PlayerInfo, PlayerSlot, RoomConfig, RoomInfo};

/// Errors occurring during lobby operations.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LobbyError {
    #[error("Room with Inacode {0} not found")]
    RoomNotFound(Inacode),
    #[error("Room {0} is already full (max {1} players)")]
    RoomFull(Inacode, u8),
    #[error("Invalid room password provided")]
    InvalidPassword,
    #[error("Player {0} is already in room {1}")]
    PlayerAlreadyInRoom(String, Inacode),
    #[error("Player {0} is not in any active room")]
    PlayerNotInRoom(String),
    #[error("Only the room host can start the match")]
    OnlyHostCanStart,
    #[error("Cannot start match: not all required players are ready")]
    PlayersNotReady,
    #[error("Cannot perform operation while match is running in room {0}")]
    MatchAlreadyRunning(Inacode),
}

/// Active room instance inside the lobby.
#[derive(Debug, Clone)]
pub struct Room {
    pub inacode: Inacode,
    pub config: RoomConfig,
    pub host_id: String,
    pub members: Vec<PlayerInfo>,
    pub in_match: bool,
    pub match_seed: u64,
}

impl Room {
    /// Returns the public DTO representation.
    #[must_use]
    pub fn to_info(&self) -> RoomInfo {
        RoomInfo {
            inacode: self.inacode.clone(),
            config: self.config.clone(),
            host_id: self.host_id.clone(),
            members: self.members.clone(),
            in_match: self.in_match,
        }
    }

    /// Checks if all player slots are marked ready.
    #[must_use]
    pub fn all_ready(&self) -> bool {
        if self.members.len() < 2 {
            return false;
        }
        self.members.iter().all(|m| m.ready)
    }

    /// Finds the next available player slot according to room configuration.
    #[must_use]
    pub fn next_available_slot(&self) -> PlayerSlot {
        let has_home = self.members.iter().any(|m| m.slot == PlayerSlot::Home);
        let has_away = self.members.iter().any(|m| m.slot == PlayerSlot::Away);
        let has_home2 = self.members.iter().any(|m| m.slot == PlayerSlot::Home2);
        let has_away2 = self.members.iter().any(|m| m.slot == PlayerSlot::Away2);

        if !has_home {
            PlayerSlot::Home
        } else if !has_away {
            PlayerSlot::Away
        } else if self.config.mode == MatchMode::Mode2v2 && !has_home2 {
            PlayerSlot::Home2
        } else if self.config.mode == MatchMode::Mode2v2 && !has_away2 {
            PlayerSlot::Away2
        } else {
            PlayerSlot::Spectator
        }
    }
}

/// Central in-memory lobby hub coordinating all active rooms and matchmaking queues.
#[derive(Debug, Default)]
pub struct LobbyHub {
    pub rooms: HashMap<Inacode, Room>,
    pub player_to_room: HashMap<String, Inacode>,
    seed_counter: u64,
}

impl LobbyHub {
    /// Creates a new lobby hub.
    #[must_use]
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
            player_to_room: HashMap::new(),
            seed_counter: 1000,
        }
    }

    /// Creates a new room with a generated Inacode, assigning the creator as Host (Home slot).
    pub fn create_room(
        &mut self,
        host_id: String,
        host_name: String,
        config: RoomConfig,
    ) -> Result<(Inacode, RoomInfo), LobbyError> {
        if let Some(existing) = self.player_to_room.get(&host_id) {
            return Err(LobbyError::PlayerAlreadyInRoom(host_id, existing.clone()));
        }

        self.seed_counter = self.seed_counter.wrapping_add(1);
        let inacode = Inacode::generate_from_seed(self.seed_counter);

        let host_member = PlayerInfo {
            id: host_id.clone(),
            name: host_name,
            slot: PlayerSlot::Home,
            ready: true, // Host is ready by default
            ping_ms: 0,
            rank_points: 1000,
        };

        let room = Room {
            inacode: inacode.clone(),
            config,
            host_id: host_id.clone(),
            members: vec![host_member],
            in_match: false,
            match_seed: self.seed_counter,
        };

        let info = room.to_info();
        self.rooms.insert(inacode.clone(), room);
        self.player_to_room.insert(host_id, inacode.clone());

        Ok((inacode, info))
    }

    /// Connects a player to an existing room using its Inacode.
    pub fn join_room(
        &mut self,
        inacode: &Inacode,
        player_id: String,
        player_name: String,
        password: Option<String>,
    ) -> Result<(PlayerSlot, RoomInfo), LobbyError> {
        if let Some(existing) = self.player_to_room.get(&player_id) {
            return Err(LobbyError::PlayerAlreadyInRoom(player_id, existing.clone()));
        }

        let room = self
            .rooms
            .get_mut(inacode)
            .ok_or_else(|| LobbyError::RoomNotFound(inacode.clone()))?;

        if room.in_match {
            return Err(LobbyError::MatchAlreadyRunning(inacode.clone()));
        }

        if room.members.len() >= room.config.max_members as usize {
            return Err(LobbyError::RoomFull(inacode.clone(), room.config.max_members));
        }

        if let Some(ref required_pw) = room.config.password
            && password.as_deref() != Some(required_pw.as_str())
        {
            return Err(LobbyError::InvalidPassword);
        }

        let slot = room.next_available_slot();
        let member = PlayerInfo {
            id: player_id.clone(),
            name: player_name,
            slot,
            ready: false,
            ping_ms: 0,
            rank_points: 1000,
        };

        room.members.push(member);
        self.player_to_room.insert(player_id, inacode.clone());

        let info = room.to_info();
        Ok((slot, info))
    }

    /// Disconnects a player from their current room.
    pub fn leave_room(&mut self, player_id: &str) -> Result<Option<Inacode>, LobbyError> {
        let inacode = self
            .player_to_room
            .remove(player_id)
            .ok_or_else(|| LobbyError::PlayerNotInRoom(player_id.to_string()))?;

        let should_remove = if let Some(room) = self.rooms.get_mut(&inacode) {
            room.members.retain(|m| m.id != player_id);
            if room.members.is_empty() {
                true
            } else if room.host_id == player_id {
                // Transfer host to first remaining player
                room.host_id = room.members[0].id.clone();
                false
            } else {
                false
            }
        } else {
            false
        };

        if should_remove {
            self.rooms.remove(&inacode);
            Ok(None)
        } else {
            Ok(Some(inacode))
        }
    }

    /// Toggles ready status for a player in their room.
    pub fn set_ready(&mut self, player_id: &str, ready: bool) -> Result<(Inacode, bool), LobbyError> {
        let inacode = self
            .player_to_room
            .get(player_id)
            .cloned()
            .ok_or_else(|| LobbyError::PlayerNotInRoom(player_id.to_string()))?;

        let room = self
            .rooms
            .get_mut(&inacode)
            .ok_or_else(|| LobbyError::RoomNotFound(inacode.clone()))?;

        if let Some(m) = room.members.iter_mut().find(|m| m.id == player_id) {
            m.ready = ready;
        }

        let all_ready = room.all_ready();
        Ok((inacode, all_ready))
    }

    /// Starts a match if the caller is host and all players are ready.
    pub fn start_match(
        &mut self,
        inacode: &Inacode,
        caller_id: &str,
    ) -> Result<(u64, String, String), LobbyError> {
        let room = self
            .rooms
            .get_mut(inacode)
            .ok_or_else(|| LobbyError::RoomNotFound(inacode.clone()))?;

        if room.host_id != caller_id {
            return Err(LobbyError::OnlyHostCanStart);
        }

        if !room.all_ready() {
            return Err(LobbyError::PlayersNotReady);
        }

        room.in_match = true;
        let home_id = room
            .members
            .iter()
            .find(|m| m.slot == PlayerSlot::Home)
            .map(|m| m.id.clone())
            .unwrap_or_default();

        let away_id = room
            .members
            .iter()
            .find(|m| m.slot == PlayerSlot::Away)
            .map(|m| m.id.clone())
            .unwrap_or_default();

        Ok((room.match_seed, home_id, away_id))
    }

    /// Returns a reference to a room by Inacode.
    #[must_use]
    pub fn get_room(&self, inacode: &Inacode) -> Option<&Room> {
        self.rooms.get(inacode)
    }

    /// Returns a mutable reference to a room by Inacode.
    pub fn get_room_mut(&mut self, inacode: &Inacode) -> Option<&mut Room> {
        self.rooms.get_mut(inacode)
    }

    /// Lists all publicly joinable rooms.
    #[must_use]
    pub fn list_public_rooms(&self) -> Vec<RoomInfo> {
        self.rooms
            .values()
            .filter(|r| !r.in_match && r.config.password.is_none())
            .map(Room::to_info)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lobby_room_lifecycle() {
        let mut hub = LobbyHub::new();

        // Host creates room
        let (inacode, info) = hub
            .create_room(
                "player_1".to_string(),
                "Mark Evans".to_string(),
                RoomConfig::default(),
            )
            .expect("room created ok");

        assert_eq!(info.members.len(), 1);
        assert_eq!(info.members[0].slot, PlayerSlot::Home);

        // Guest joins room
        let (slot, updated_info) = hub
            .join_room(&inacode, "player_2".to_string(), "Axel Blaze".to_string(), None)
            .expect("guest joined ok");

        assert_eq!(slot, PlayerSlot::Away);
        assert_eq!(updated_info.members.len(), 2);
        assert!(!updated_info.in_match);

        // Guest sets ready
        let (_, all_ready) = hub.set_ready("player_2", true).expect("ready ok");
        assert!(all_ready);

        // Host starts match
        let (seed, home, away) = hub.start_match(&inacode, "player_1").expect("match started");
        assert!(seed > 0);
        assert_eq!(home, "player_1");
        assert_eq!(away, "player_2");
    }
}
