//! Kizuna Town multiplayer social hub and avatar management.
//!
//! Recreates the Level-5 `kizuna_town` mode (<https://www.inazuma.jp/victory-road/fr/kizuna/>):
//! - Avatar Customization (`kizuna_town_avatar_menu` / Avatar Makeup)
//! - Kizuna Town Hub World (`kizunaTown`): placed decorations, recruited characters
//! - Friends & Social Interaction (`friends`): town visits, emotes, stamps, chat, and direct 1v1 match challenges.

use std::collections::HashMap;
use thiserror::Error;

use crate::protocol::{
    KizunaTownSnapshot, PlacedTownCharacter, PlacedTownObject, TownVisitor,
};

/// Errors possible in Kizuna Town operations.
#[derive(Debug, Error)]
pub enum KizunaError {
    /// Target town was not found.
    #[error("Town not found: {0}")]
    TownNotFound(String),
    /// Visitor was not found in town.
    #[error("Visitor not in town: {0}")]
    VisitorNotFound(String),
}

/// An active Kizuna Town instance.
#[derive(Debug, Clone)]
pub struct KizunaTown {
    /// Town owner player ID.
    pub owner_id: String,
    /// Town owner username.
    pub owner_name: String,
    /// Display town name.
    pub town_name: String,
    /// Placed decorations and buildings (`kizuna_items`).
    pub objects: HashMap<String, PlacedTownObject>,
    /// Placed recruited characters (`inagle_characters`).
    pub characters: HashMap<String, PlacedTownCharacter>,
    /// Current visiting players in this town instance.
    pub visitors: HashMap<String, TownVisitor>,
}

impl KizunaTown {
    /// Creates a new town with default layout.
    #[must_use]
    pub fn new(owner_id: String, owner_name: String, town_name: String) -> Self {
        Self {
            owner_id,
            owner_name,
            town_name,
            objects: HashMap::new(),
            characters: HashMap::new(),
            visitors: HashMap::new(),
        }
    }

    /// Adds or updates a visitor in town.
    pub fn add_visitor(&mut self, visitor: TownVisitor) {
        self.visitors.insert(visitor.player_id.clone(), visitor);
    }

    /// Removes a visitor from town.
    pub fn remove_visitor(&mut self, player_id: &str) -> Option<TownVisitor> {
        self.visitors.remove(player_id)
    }

    /// Updates visitor position, velocity, and yaw orientation.
    pub fn update_visitor_transform(
        &mut self,
        player_id: &str,
        position: [f32; 3],
        velocity: [f32; 3],
        yaw: f32,
    ) -> bool {
        if let Some(v) = self.visitors.get_mut(player_id) {
            v.position = position;
            v.velocity = velocity;
            v.yaw = yaw;
            true
        } else {
            false
        }
    }

    /// Sets or clears the active stamp/emote for a visitor.
    pub fn set_visitor_emote(&mut self, player_id: &str, stamp_id: Option<u32>) -> bool {
        if let Some(v) = self.visitors.get_mut(player_id) {
            v.active_emote = stamp_id;
            true
        } else {
            false
        }
    }

    /// Places a town decoration / building.
    pub fn place_object(&mut self, obj: PlacedTownObject) {
        self.objects.insert(obj.instance_id.clone(), obj);
    }

    /// Removes a placed object by instance ID.
    pub fn remove_object(&mut self, instance_id: &str) -> Option<PlacedTownObject> {
        self.objects.remove(instance_id)
    }

    /// Places a recruited character in town.
    pub fn place_character(&mut self, chara: PlacedTownCharacter) {
        self.characters.insert(chara.instance_id.clone(), chara);
    }

    /// Removes a placed character by instance ID.
    pub fn remove_character(&mut self, instance_id: &str) -> Option<PlacedTownCharacter> {
        self.characters.remove(instance_id)
    }

    /// Creates a complete synchronized snapshot of the town.
    #[must_use]
    pub fn snapshot(&self) -> KizunaTownSnapshot {
        KizunaTownSnapshot {
            owner_id: self.owner_id.clone(),
            owner_name: self.owner_name.clone(),
            town_name: self.town_name.clone(),
            objects: self.objects.values().cloned().collect(),
            characters: self.characters.values().cloned().collect(),
            visitors: self.visitors.values().cloned().collect(),
        }
    }
}

/// Global Kizuna Town Hub managing all player towns and visitor instances.
#[derive(Debug, Default)]
pub struct KizunaHub {
    /// Active towns keyed by owner player ID.
    pub towns: HashMap<String, KizunaTown>,
    /// Maps visiting player ID to the town owner ID they are currently located in.
    pub player_towns: HashMap<String, String>,
}

impl KizunaHub {
    /// Creates an empty Kizuna Hub.
    #[must_use]
    pub fn new() -> Self {
        Self {
            towns: HashMap::new(),
            player_towns: HashMap::new(),
        }
    }

    /// Returns mutable reference to a player's town, creating it if not present.
    pub fn get_or_create_town(&mut self, owner_id: &str, owner_name: &str) -> &mut KizunaTown {
        self.towns.entry(owner_id.to_string()).or_insert_with(|| {
            let town_name = format!("Ville de {owner_name}");
            KizunaTown::new(owner_id.to_string(), owner_name.to_string(), town_name)
        })
    }

    /// Adds a player as a visitor into a specific town.
    pub fn join_town(&mut self, town_owner_id: &str, visitor: TownVisitor) -> KizunaTownSnapshot {
        let player_id = visitor.player_id.clone();
        self.player_towns.insert(player_id, town_owner_id.to_string());
        let town = self.get_or_create_town(town_owner_id, &visitor.player_name);
        town.add_visitor(visitor);
        town.snapshot()
    }

    /// Removes a player from whatever town they are currently visiting.
    pub fn leave_town(&mut self, player_id: &str) -> Option<(String, TownVisitor)> {
        if let Some(town_owner_id) = self.player_towns.remove(player_id)
            && let Some(town) = self.towns.get_mut(&town_owner_id)
            && let Some(visitor) = town.remove_visitor(player_id)
        {
            Some((town_owner_id, visitor))
        } else {
            None
        }
    }

    /// Returns the owner ID of the town the player is currently in.
    #[must_use]
    pub fn current_town_of(&self, player_id: &str) -> Option<&str> {
        self.player_towns.get(player_id).map(|s| s.as_str())
    }

    /// Returns reference to a specific town.
    #[must_use]
    pub fn get_town(&self, town_owner_id: &str) -> Option<&KizunaTown> {
        self.towns.get(town_owner_id)
    }

    /// Returns mutable reference to a specific town.
    pub fn get_town_mut(&mut self, town_owner_id: &str) -> Option<&mut KizunaTown> {
        self.towns.get_mut(town_owner_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::KizunaAvatar;

    #[test]
    fn test_kizuna_town_visitor_and_object_lifecycle() {
        let mut hub = KizunaHub::new();

        let visitor1 = TownVisitor {
            player_id: "p_endou".to_string(),
            player_name: "Endou".to_string(),
            avatar: KizunaAvatar::default(),
            ut_squad: None,
            position: [0.0, 0.0, 0.0],
            velocity: [0.0, 0.0, 0.0],
            yaw: 0.0,
            active_emote: None,
        };

        // Join Endou's town
        let snap1 = hub.join_town("p_endou", visitor1);
        assert_eq!(snap1.owner_id, "p_endou");
        assert_eq!(snap1.visitors.len(), 1);

        // Gouenji visits Endou's town
        let visitor2 = TownVisitor {
            player_id: "p_gouenji".to_string(),
            player_name: "Gouenji".to_string(),
            avatar: KizunaAvatar {
                name: "Gouenji".to_string(),
                ..Default::default()
            },
            ut_squad: None,
            position: [5.0, 0.0, 10.0],
            velocity: [1.0, 0.0, 0.0],
            yaw: 1.57,
            active_emote: Some(101), // Fire emote stamp
        };

        let snap2 = hub.join_town("p_endou", visitor2);
        assert_eq!(snap2.visitors.len(), 2);

        // Place a stadium pitch object in town
        let pitch_obj = PlacedTownObject {
            instance_id: "obj_pitch_01".to_string(),
            item_id: 2001,
            position: [0.0, 0.0, 0.0],
            yaw: 0.0,
        };

        let town = hub.get_town_mut("p_endou").unwrap();
        town.place_object(pitch_obj);
        assert_eq!(town.objects.len(), 1);

        // Update Gouenji's movement
        let moved = town.update_visitor_transform("p_gouenji", [6.0, 0.0, 10.0], [0.0, 0.0, 0.0], 1.57);
        assert!(moved);

        // Gouenji leaves
        let left = hub.leave_town("p_gouenji");
        assert!(left.is_some());
        let (town_id, v) = left.unwrap();
        assert_eq!(town_id, "p_endou");
        assert_eq!(v.player_id, "p_gouenji");

        let town = hub.get_town("p_endou").unwrap();
        assert_eq!(town.visitors.len(), 1);
    }
}
