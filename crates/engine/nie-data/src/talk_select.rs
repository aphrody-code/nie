//! `TalkSelectConfig` — port Rust de `system/talk_select_config.cfg_*.cfg.bin` (Level-5 IEVR).
//!
//! **Menus de choix de dialogue** : chaque entrée décrit un menu de sélection présenté pendant un
//! dialogue (texte, type, position initiale/annulation du curseur, perso éventuel). Famille
//! game-data **non couverte** ; **pas de parseur inagle** → port direct (champs nommés verbatim).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `data/common/gamedata/system/talk_select_config.cfg_1.01.41.00.cfg.bin.json`
//!   (format `lists`, file `version`). 1 liste `m_TalkSelectConfigList` = **9** `TALK_SELECT_CONFIG`.
//! - Champs : `id`, `textId`, `type`, `cursorInitPos`, `cursorCancelPos`, `specifyTalkCharaId`,
//!   `additionalDispMenuNameCrc`, `afterDecisionParam` (`[offset, count]`).

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, field_pair, list_values};
use crate::hash::HashId;

/// Entrée `TALK_SELECT_CONFIG` — un menu de choix de dialogue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TalkSelectConfig {
    /// `id` — hash identifiant le menu de choix.
    pub id: HashId,
    /// `textId` — hash du texte affiché.
    pub text_id: HashId,
    /// `type` — type de menu de choix.
    pub kind: i64,
    /// `cursorInitPos` — position initiale du curseur.
    pub cursor_init_pos: i64,
    /// `cursorCancelPos` — position du curseur sur annulation.
    pub cursor_cancel_pos: i64,
    /// `specifyTalkCharaId` — perso de dialogue imposé (`0` = aucun).
    pub specify_talk_chara_id: HashId,
    /// `additionalDispMenuNameCrc` — crc du nom de menu additionnel (`0` = aucun).
    pub additional_disp_menu_name_crc: HashId,
    /// `afterDecisionParam` — `[offset, count]` (paramètres après décision).
    pub after_decision_param: [i64; 2],
}

impl TalkSelectConfig {
    /// Parse une entrée. `None` si `id` est nul/absent.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let id = field_hash(v, "id");
        if id.is_zero() {
            return None;
        }
        Some(Self {
            id,
            text_id: field_hash(v, "textId"),
            kind: field_i64(v, "type").unwrap_or(0),
            cursor_init_pos: field_i64(v, "cursorInitPos").unwrap_or(0),
            cursor_cancel_pos: field_i64(v, "cursorCancelPos").unwrap_or(0),
            specify_talk_chara_id: field_hash(v, "specifyTalkCharaId"),
            additional_disp_menu_name_crc: field_hash(v, "additionalDispMenuNameCrc"),
            after_decision_param: field_pair(v, "afterDecisionParam").unwrap_or([0, 0]),
        })
    }
}

/// Contenu complet d'un `talk_select_config.cfg_*.cfg.bin`.
#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TalkSelectConfigList {
    /// `m_TalkSelectConfigList` — les menus de choix de dialogue.
    pub entries: Vec<TalkSelectConfig>,
}

impl TalkSelectConfigList {
    /// Recherche un menu par son `id`. `None` si absent.
    #[must_use]
    pub fn find_by_id(&self, id: HashId) -> Option<&TalkSelectConfig> {
        self.entries.iter().find(|e| e.id == id)
    }
}

/// Parse un `talk_select_config.cfg_*.cfg.bin.json`.
#[must_use]
pub fn parse_talk_select_config(root: &Value) -> TalkSelectConfigList {
    let mut entries = Vec::new();
    if let Some(values) = list_values(root, "m_TalkSelectConfigList") {
        for v in values {
            if let Some(e) = TalkSelectConfig::from_value(v) {
                entries.push(e);
            }
        }
    }
    TalkSelectConfigList { entries }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({
            "lists": [{ "name": "m_TalkSelectConfigList", "values": [
                { "id": "0x30B9C867", "textId": "0x01DE969B", "type": 1, "cursorInitPos": 0,
                  "cursorCancelPos": 1, "specifyTalkCharaId": "0x00000000",
                  "additionalDispMenuNameCrc": "0x00000000", "afterDecisionParam": [0, 0] },
                { "id": "0x82698DD5", "textId": "0xE33B14CE", "type": 6, "cursorInitPos": 0,
                  "cursorCancelPos": 4, "specifyTalkCharaId": "0x00000000",
                  "additionalDispMenuNameCrc": "0x00000000", "afterDecisionParam": [0, 0] }
            ]}]
        })
    }

    #[test]
    fn parse_et_valeurs() {
        let cfg = parse_talk_select_config(&fixture());
        assert_eq!(cfg.entries.len(), 2);
        let e = &cfg.entries[0];
        assert_eq!(e.id, HashId(0x30B9_C867));
        assert_eq!(e.text_id, HashId(0x01DE_969B));
        assert_eq!(e.kind, 1);
        assert_eq!(e.cursor_cancel_pos, 1);
        assert_eq!(e.specify_talk_chara_id, HashId::ZERO);
        assert_eq!(e.after_decision_param, [0, 0]);
        assert_eq!(cfg.entries[1].kind, 6);
        assert_eq!(cfg.entries[1].cursor_cancel_pos, 4);
    }

    #[test]
    fn find_by_id() {
        let cfg = parse_talk_select_config(&fixture());
        assert!(cfg.find_by_id(HashId(0x82698DD5)).is_some());
        assert!(cfg.find_by_id(HashId(0xDEADBEEF)).is_none());
    }
}
