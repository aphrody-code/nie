//! `SoccerClubRoomConfig` — port Rust de `soccer_club_room_config.cfg.bin.json` (Level-5 IEVR).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `/home/ubuntu/niers/data/common/gamedata/chara_bank/soccer_club_room_config.cfg.bin.json`
//! - 1 liste dans ce fichier (`version = 100`) :
//!   - `m_soccerClubRoomCharaRestrictionInfoList` — 41 entrées
//!     `SOCCER_CLUB_ROOM_CHARA_RESTRICTION_INFO`, décrivant les restrictions de gestion
//!     (salle de club / banque de personnages, « chara bank ») applicables à certains
//!     personnages clés.
//!
//! ## Champs observés sur le dump réel
//!
//! | Champ                          | Type JSON  | Sémantique observée                                  |
//! |--------------------------------|------------|------------------------------------------------------|
//! | `character_id`                 | hex string | Identifiant hash 32 bits du personnage concerné      |
//! | `is_remove_club_disabled`      | bool       | Interdit de retirer le personnage du club            |
//! | `is_chara_bank_move_disabled`  | bool       | Interdit de déplacer le personnage vers/depuis la banque |
//! | `is_team_dock_change_disabled` | bool       | Interdit de changer l'affectation de dock d'équipe   |
//!
//! Observations sur le dump : `is_remove_club_disabled = true` pour les 41 entrées ;
//! `is_chara_bank_move_disabled = true` pour 10 entrées ; `is_team_dock_change_disabled = true`
//! pour une seule entrée (la première, `0x686BE87E`).
//!
//! ## Accesseur
//!
//! - [`SoccerClubRoomConfig::find_by_character`] — recherche par `character_id`.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_bool, field_hash, list_values};
use crate::hash::HashId;

// ─── CharaRestrictionInfo ───────────────────────────────────────────────────────

/// Entrée `SOCCER_CLUB_ROOM_CHARA_RESTRICTION_INFO` — restrictions de gestion d'un
/// personnage dans la salle de club / banque de personnages IEVR.
///
/// Vérité terrain : `soccer_club_room_config.cfg.bin.json`,
/// liste `m_soccerClubRoomCharaRestrictionInfoList`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaRestrictionInfo {
    /// `character_id` — identifiant hash du personnage (ex. `0x686BE87E`).
    ///
    /// Vérité terrain : `m_soccerClubRoomCharaRestrictionInfoList[0].character_id = "0x686BE87E"`.
    pub character_id: HashId,
    /// `is_remove_club_disabled` — si vrai, le personnage ne peut pas être retiré du club.
    ///
    /// Vrai pour les 41 entrées du dump réel.
    pub is_remove_club_disabled: bool,
    /// `is_chara_bank_move_disabled` — si vrai, le personnage ne peut pas être déplacé
    /// vers/depuis la banque de personnages.
    ///
    /// Vrai pour 10 entrées du dump réel.
    pub is_chara_bank_move_disabled: bool,
    /// `is_team_dock_change_disabled` — si vrai, l'affectation de dock d'équipe du
    /// personnage ne peut pas être changée.
    ///
    /// Vrai pour une seule entrée du dump réel (`0x686BE87E`).
    pub is_team_dock_change_disabled: bool,
}

impl CharaRestrictionInfo {
    /// Parse une entrée de `m_soccerClubRoomCharaRestrictionInfoList`.
    /// `None` si `character_id` est nul ou absent.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let character_id = field_hash(v, "character_id");
        if character_id.is_zero() {
            return None;
        }
        Some(Self {
            character_id,
            is_remove_club_disabled: field_bool(v, "is_remove_club_disabled").unwrap_or(false),
            is_chara_bank_move_disabled: field_bool(v, "is_chara_bank_move_disabled")
                .unwrap_or(false),
            is_team_dock_change_disabled: field_bool(v, "is_team_dock_change_disabled")
                .unwrap_or(false),
        })
    }
}

// ─── SoccerClubRoomConfig ───────────────────────────────────────────────────────

/// Contenu complet d'un `soccer_club_room_config.cfg.bin.json`.
///
/// Utiliser [`parse_soccer_club_room_config`] pour construire depuis un `serde_json::Value`.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SoccerClubRoomConfig {
    /// Restrictions de gestion (`m_soccerClubRoomCharaRestrictionInfoList`) ; 41 entrées
    /// dans le dump réel.
    pub restrictions: Vec<CharaRestrictionInfo>,
}

impl SoccerClubRoomConfig {
    /// Recherche une restriction par `character_id`. `None` si absente.
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_data::chara_bank::{CharaRestrictionInfo, SoccerClubRoomConfig};
    /// use nie_data::hash::HashId;
    ///
    /// let config = SoccerClubRoomConfig {
    ///     restrictions: vec![CharaRestrictionInfo {
    ///         character_id: HashId(0x686B_E87E),
    ///         is_remove_club_disabled: true,
    ///         is_chara_bank_move_disabled: true,
    ///         is_team_dock_change_disabled: true,
    ///     }],
    /// };
    /// assert!(config.find_by_character(HashId(0x686B_E87E)).is_some());
    /// assert!(config.find_by_character(HashId(0xDEAD_BEEF)).is_none());
    /// ```
    #[must_use]
    pub fn find_by_character(&self, character_id: HashId) -> Option<&CharaRestrictionInfo> {
        self.restrictions
            .iter()
            .find(|e| e.character_id == character_id)
    }
}

// ─── Parseur principal ──────────────────────────────────────────────────────────

/// Parse un `soccer_club_room_config.cfg.bin.json` complet (liste
/// `m_soccerClubRoomCharaRestrictionInfoList`).
///
/// Renvoie un [`SoccerClubRoomConfig`] avec toutes les entrées valides
/// (`character_id` non-nul). Les entrées invalides sont silencieusement ignorées.
///
/// Compte réel : `soccer_club_room_config.cfg.bin.json` → 41 entrées.
#[must_use]
pub fn parse_soccer_club_room_config(root: &Value) -> SoccerClubRoomConfig {
    let restrictions =
        if let Some(values) = list_values(root, "m_soccerClubRoomCharaRestrictionInfoList") {
            let mut out = Vec::new();
            for v in values {
                if let Some(info) = CharaRestrictionInfo::from_value(v) {
                    out.push(info);
                }
            }
            out
        } else {
            Vec::new()
        };
    SoccerClubRoomConfig { restrictions }
}
