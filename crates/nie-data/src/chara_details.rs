//! `chara_details` — type de personnalité + pronoms d'un personnage
//! (`character/chara_details_config_*.cfg.bin`, liste RDBN `m_charaDetailsList`).
//!
//! ## Vérité terrain (anti-hallucination)
//!
//! - Parser TS de référence : `packages/inagle/src/parsers/chara-details.ts`
//!   (`parseCharaDetails`) — **port 1:1**.
//! - Données : `data/common/gamedata/character/chara_details_config_0.00.00.00.cfg.bin`
//!   (VFS IEVR), format **RDBN** (`lists`). Liste `m_charaDetailsList`, type `CHARA_DETAILS`,
//!   **550 lignes** ; champs réels (probe live) :
//!   `chara_id` (Hash), `personality_type` (Int), `first_person` (Hash),
//!   `second_person_male` (Hash), `second_person_female` (Hash).
//!
//! Ligne 0 réelle : `chara_id=0x677ADF02, personality_type=1, first_person=0xF705095D,
//! second_person_male=0x00000000, second_person_female=0x00000000`.
//!
//! Les champs pronom (`first_person`/`second_person_*`) sont des **hash** résolus en texte par
//! une table séparée (non incluse ici, comme inagle) ; `0x00000000` = pas de pronom spécifique.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, list_values};
use crate::hash::HashId;

/// Détails de personnalité/pronoms d'un personnage (port de `ParsedCharaDetails`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaDetails {
    /// `chara_id` — identifiant du personnage (hash).
    pub chara_id: HashId,
    /// `personality_type` — type de personnalité.
    pub personality_type: i64,
    /// `first_person` — hash du pronom de 1ʳᵉ personne (`0x00000000` si aucun).
    pub first_person: HashId,
    /// `second_person_male` — hash du pronom de 2ᵉ personne (masculin).
    pub second_person_male: HashId,
    /// `second_person_female` — hash du pronom de 2ᵉ personne (féminin).
    pub second_person_female: HashId,
}

/// Parse la liste `m_charaDetailsList` d'un `chara_details_config_*.cfg.bin.json` désérialisé.
///
/// Port de `parseCharaDetails` : une entrée par ligne de la liste RDBN (aucun filtrage).
#[must_use]
pub fn parse_chara_details(root: &Value) -> Vec<CharaDetails> {
    let mut out = Vec::new();
    if let Some(values) = list_values(root, "m_charaDetailsList") {
        for v in values {
            out.push(CharaDetails {
                chara_id: field_hash(v, "chara_id"),
                personality_type: field_i64(v, "personality_type").unwrap_or(0),
                first_person: field_hash(v, "first_person"),
                second_person_male: field_hash(v, "second_person_male"),
                second_person_female: field_hash(v, "second_person_female"),
            });
        }
    }
    out
}

/// Recherche les détails d'un personnage par `chara_id` (port de l'accès `Map.get`).
#[must_use]
pub fn find_by_chara_id(details: &[CharaDetails], chara_id: HashId) -> Option<&CharaDetails> {
    details.iter().find(|d| d.chara_id == chara_id)
}
