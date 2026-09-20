//! SteamFriends018 interface emulation and Level-5 friend social subsystem.
//!
//! Directly ports `fn_SteamFriends018` (0x1404ebcf0) and Level-5 friend invitation
//! and rich presence integration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Persona presence state matching Steamworks API `EPersonaState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum PersonaState {
    /// Friend is offline.
    #[default]
    Offline,
    /// Friend is online in Steam.
    Online,
    /// Friend is busy.
    Busy,
    /// Friend is away.
    Away,
    /// Friend is playing Inazuma Eleven: Victory Road.
    InGame,
    /// Friend is exploring Kizuna Town.
    InKizunaTown,
    /// Friend is in an active football match.
    InMatch,
}

/// A friend entry matching `SteamFriends018` friend properties.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamFriend {
    /// 64-bit Steam ID or network unique account identifier.
    pub steam_id: u64,
    /// Friend display name / persona name.
    pub persona_name: String,
    /// Current activity status.
    pub state: PersonaState,
    /// Currently active Inacode if hosting or waiting in a room.
    pub current_inacode: Option<String>,
    /// Rich presence key-value pairs (e.g. `"status" => "Final Tournament - Match 3"`).
    pub rich_presence: HashMap<String, String>,
    /// Squad team rating if published.
    pub squad_rating: Option<u32>,
}

impl SteamFriend {
    /// Creates a friend record with basic identification.
    #[must_use]
    pub fn new(steam_id: u64, persona_name: String, state: PersonaState) -> Self {
        Self {
            steam_id,
            persona_name,
            state,
            current_inacode: None,
            rich_presence: HashMap::new(),
            squad_rating: None,
        }
    }

    /// Sets rich presence key-value.
    #[must_use]
    pub fn with_presence(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.rich_presence.insert(key.into(), value.into());
        self
    }

    /// Sets active Inacode room.
    #[must_use]
    pub fn with_inacode(mut self, inacode: impl Into<String>) -> Self {
        self.current_inacode = Some(inacode.into());
        self
    }
}

/// A pending friend game invitation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendGameInvite {
    /// Invitation ID.
    pub invite_id: String,
    /// Sender Steam ID.
    pub from_steam_id: u64,
    /// Sender name.
    pub from_name: String,
    /// Target Inacode or Town instance to join.
    pub destination_inacode: String,
    /// Match mode or social invite.
    pub invite_type: String,
    /// Unix timestamp when created.
    pub timestamp: u64,
}

/// Social and friend manager implementing `SteamFriends018` behaviors.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SteamFriends018 {
    /// Local player Steam ID.
    pub local_steam_id: u64,
    /// Local persona name.
    pub local_persona_name: String,
    /// Friends directory keyed by Steam ID.
    pub friends: HashMap<u64, SteamFriend>,
    /// Pending invites received by the local player.
    pub incoming_invites: Vec<FriendGameInvite>,
    /// Local rich presence dictionary.
    pub local_rich_presence: HashMap<String, String>,
}

impl SteamFriends018 {
    /// Creates a friend manager for the local player.
    #[must_use]
    pub fn new(local_steam_id: u64, local_persona_name: String) -> Self {
        Self {
            local_steam_id,
            local_persona_name,
            friends: HashMap::new(),
            incoming_invites: Vec::new(),
            local_rich_presence: HashMap::new(),
        }
    }

    /// Adds or updates a friend.
    pub fn add_or_update_friend(&mut self, friend: SteamFriend) {
        self.friends.insert(friend.steam_id, friend);
    }

    /// Removes a friend by Steam ID.
    pub fn remove_friend(&mut self, steam_id: u64) -> Option<SteamFriend> {
        self.friends.remove(&steam_id)
    }

    /// Sets a rich presence key-value pair for the local player.
    pub fn set_rich_presence(&mut self, key: &str, value: &str) {
        self.local_rich_presence
            .insert(key.to_string(), value.to_string());
    }

    /// Clears local rich presence.
    pub fn clear_rich_presence(&mut self) {
        self.local_rich_presence.clear();
    }

    /// Dispatches a game invitation to a friend.
    #[must_use]
    pub fn create_invite(
        &self,
        target_steam_id: u64,
        destination_inacode: String,
        invite_type: String,
    ) -> Option<FriendGameInvite> {
        if self.friends.contains_key(&target_steam_id) {
            Some(FriendGameInvite {
                invite_id: format!("inv_{}_{}", self.local_steam_id, target_steam_id),
                from_steam_id: self.local_steam_id,
                from_name: self.local_persona_name.clone(),
                destination_inacode,
                invite_type,
                timestamp: 0,
            })
        } else {
            None
        }
    }

    /// Receives an incoming invite.
    pub fn receive_invite(&mut self, invite: FriendGameInvite) {
        self.incoming_invites.push(invite);
    }

    /// Accepts an incoming invite by ID, returning the target Inacode.
    pub fn accept_invite(&mut self, invite_id: &str) -> Option<String> {
        if let Some(pos) = self
            .incoming_invites
            .iter()
            .position(|i| i.invite_id == invite_id)
        {
            let invite = self.incoming_invites.remove(pos);
            Some(invite.destination_inacode)
        } else {
            None
        }
    }

    /// Returns list of currently online or in-game friends.
    #[must_use]
    pub fn get_online_friends(&self) -> Vec<&SteamFriend> {
        self.friends
            .values()
            .filter(|f| !matches!(f.state, PersonaState::Offline))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_steam_friends_presence_and_invites() {
        let mut sf = SteamFriends018::new(76561198000000001, "Axel Blaze".into());
        sf.set_rich_presence("status", "Exploring Kizuna Town");
        assert_eq!(
            sf.local_rich_presence.get("status").unwrap(),
            "Exploring Kizuna Town"
        );

        let friend = SteamFriend {
            steam_id: 76561198000000002,
            persona_name: "Jude Sharp".into(),
            state: PersonaState::InGame,
            current_inacode: Some("INA-3K99".into()),
            rich_presence: HashMap::new(),
            squad_rating: Some(94),
        };
        sf.add_or_update_friend(friend);

        let online = sf.get_online_friends();
        assert_eq!(online.len(), 1);
        assert_eq!(online[0].persona_name, "Jude Sharp");

        let invite = sf.create_invite(76561198000000002, "INA-7777".into(), "1v1 Match".into());
        assert!(invite.is_some());

        sf.receive_invite(invite.unwrap());
        assert_eq!(sf.incoming_invites.len(), 1);

        let joined_code = sf.accept_invite("inv_76561198000000001_76561198000000002");
        assert_eq!(joined_code.as_deref(), Some("INA-7777"));
        assert_eq!(sf.incoming_invites.len(), 0);
    }
}
