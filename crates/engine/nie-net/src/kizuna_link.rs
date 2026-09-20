//! Kizuna Link character bond graph and Town social communication.
//!
//! Ported from reversed Level-5 symbols in `nie.exe`:
//! - `game::CMenuListViewKizunaLink` (0x1419feb58)
//! - `game::GDSKizunaLinkConfig` (0x1419cede8)
//! - `game::CGDDKizunalinkStatus` (0x1419d3b50)
//! - `fn_kizunaTransCharaId` (0x1401bab40)
//! - `game::KizunaTownChatMenu` (0x140305290)
//! - `game::KizunaTownChatPopoutNotification` (0x1403030a0)
//! - `game::KizunaTownVisitorNotificationLog` (0x1403033d0)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Kizuna bond link between two characters (`CMenuListViewKizunaLink`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KizunaLinkNode {
    /// Source character CRC32 ID.
    pub chara_id_a: u32,
    /// Destination character CRC32 ID.
    pub chara_id_b: u32,
    /// Link level (1 to 5 stars).
    pub link_level: u8,
    /// Accumulated bond points (0 to 1000).
    pub bond_points: u32,
    /// Link synergy title (e.g. `"Duo de Feu"`, `"Raimon Original Trio"`).
    pub synergy_title: String,
}

impl KizunaLinkNode {
    /// Calculates in-match synergy bonuses granted by this Kizuna link.
    #[must_use]
    pub fn calculate_stat_boost(&self) -> (u16, u16, u16) {
        // Boost format: (Kick boost %, TP reduction %, Tension gain rate %)
        match self.link_level {
            1 => (3, 2, 5),
            2 => (6, 5, 10),
            3 => (10, 8, 15),
            4 => (15, 12, 20),
            5 => (25, 20, 30),
            _ => (0, 0, 0),
        }
    }
}

/// Global Kizuna link config matching `GDSKizunaLinkConfig` (0x1419cede8).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GDSKizunaLinkConfig {
    /// Points earned per match played together.
    pub match_points: u32,
    /// Points earned per co-op pass or combo move in match.
    pub combo_points: u32,
    /// Points earned per interaction in Kizuna Town.
    pub town_interaction_points: u32,
    /// Max link level cap (default 5).
    pub max_link_level: u8,
}

impl Default for GDSKizunaLinkConfig {
    fn default() -> Self {
        Self {
            match_points: 50,
            combo_points: 25,
            town_interaction_points: 15,
            max_link_level: 5,
        }
    }
}

/// Kizuna Link status manager matching `CGDDKizunalinkStatus` (0x1419d3b50).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CGDDKizunalinkStatus {
    /// Active link edges between pairs of characters `(min_id, max_id)`.
    pub links: HashMap<(u32, u32), KizunaLinkNode>,
    /// Global config.
    pub config: GDSKizunaLinkConfig,
}

impl CGDDKizunalinkStatus {
    /// Creates a new Kizuna Link graph status.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Records an interaction between two characters, upgrading bond points and level.
    pub fn add_bond_points(&mut self, chara_a: u32, chara_b: u32, points: u32, title: &str) {
        let key = if chara_a < chara_b {
            (chara_a, chara_b)
        } else {
            (chara_b, chara_a)
        };

        let node = self.links.entry(key).or_insert_with(|| KizunaLinkNode {
            chara_id_a: key.0,
            chara_id_b: key.1,
            link_level: 1,
            bond_points: 0,
            synergy_title: title.to_string(),
        });

        node.bond_points += points;
        // Escalation: Level 1: 0-150, Level 2: 150-350, Level 3: 350-600, Level 4: 600-900, Level 5: 900+
        node.link_level = if node.bond_points >= 900 {
            5
        } else if node.bond_points >= 600 {
            4
        } else if node.bond_points >= 350 {
            3
        } else if node.bond_points >= 150 {
            2
        } else {
            1
        };
    }

    /// Translates a character ID or transfers bond inheritance (`fn_kizunaTransCharaId`, 0x1401bab40).
    #[must_use]
    pub fn transfer_kizuna_bond(&mut self, from_chara_id: u32, to_chara_id: u32) -> usize {
        let mut transferred = 0;
        let keys_to_update: Vec<((u32, u32), KizunaLinkNode)> = self
            .links
            .iter()
            .filter(|(k, _)| k.0 == from_chara_id || k.1 == from_chara_id)
            .map(|(k, v)| (*k, v.clone()))
            .collect();

        for (old_key, mut node) in keys_to_update {
            self.links.remove(&old_key);
            let other = if old_key.0 == from_chara_id {
                old_key.1
            } else {
                old_key.0
            };
            let new_key = if to_chara_id < other {
                (to_chara_id, other)
            } else {
                (other, to_chara_id)
            };
            node.chara_id_a = new_key.0;
            node.chara_id_b = new_key.1;
            self.links.insert(new_key, node);
            transferred += 1;
        }
        transferred
    }
}

/// Chat message in Kizuna Town (`KizunaTownChatMenu`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TownChatMessage {
    /// Message ID.
    pub id: u64,
    /// Sender peer ID.
    pub sender_id: String,
    /// Sender display name.
    pub sender_name: String,
    /// Content string.
    pub message: String,
    /// Timestamp (unix seconds).
    pub timestamp: u64,
    /// Whether this is a system announcement or player chat.
    pub is_system: bool,
}

/// Popout speech bubble over avatar head (`KizunaTownChatPopoutNotification`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatPopoutNotification {
    /// Target visitor peer ID.
    pub visitor_peer_id: String,
    /// Display text (truncated to 40 characters for popout).
    pub popout_text: String,
    /// Expiration time in seconds (e.g. 4.0s).
    pub duration_seconds: f32,
}

/// Visitor activity event log matching `KizunaTownVisitorNotificationLog`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisitorNotificationLogEntry {
    /// Event ID.
    pub event_id: u64,
    /// Event type: "join", "leave", "challenge_issued", "match_started".
    pub event_type: String,
    /// Player display name.
    pub player_name: String,
    /// Descriptive localized log message.
    pub text: String,
    /// Timestamp.
    pub timestamp: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kizuna_link_status_and_transfer() {
        let mut status = CGDDKizunalinkStatus::new();
        let endou_id = 0x1001;
        let gouenji_id = 0x1002;
        let kidou_id = 0x1003;

        status.add_bond_points(endou_id, gouenji_id, 200, "Fire & Lightning");
        let link = status.links.get(&(endou_id, gouenji_id)).unwrap();
        assert_eq!(link.link_level, 2);
        assert_eq!(link.calculate_stat_boost(), (6, 5, 10));

        // Transfer bonds from Gouenji to Kidou
        let count = status.transfer_kizuna_bond(gouenji_id, kidou_id);
        assert_eq!(count, 1);
        assert!(!status.links.contains_key(&(endou_id, gouenji_id)));
        assert!(status.links.contains_key(&(endou_id, kidou_id)));
    }

    #[test]
    fn test_popout_notification_creation() {
        let popout = ChatPopoutNotification {
            visitor_peer_id: "peer_44".into(),
            popout_text: "Let's play!".into(),
            duration_seconds: 4.0,
        };
        assert_eq!(popout.visitor_peer_id, "peer_44");
    }
}
