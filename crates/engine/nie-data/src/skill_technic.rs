//! `SkillTechnicInfo` — port Rust d'une valeur `m_SkillTechnicInfoList` du
//! `skill_technic_config` (animations/formations de cinématique de technique IEVR).
//!
//! ## Vérité terrain
//!
//! - Type TS / port de référence : `packages/inagle/src/parsers/skill-technic-config.ts`
//!   (`parseContent`, l.44-66). Le port est une projection **List → struct 1:1** : pour chaque
//!   valeur de la liste `m_SkillTechnicInfoList`, on recopie ses champs tels quels.
//! - Données : `data/common/gamedata/skill/skill_technic_config_1.01.28.00.cfg.bin`
//!   (VFS du jeu, format RDBN), liste `m_SkillTechnicInfoList` = **6 valeurs**, type
//!   `SkillTechnicInfo`.
//!
//! ## Schéma réel (version VFS 1.01.28.00) vs doc inagle (1.01.34.00)
//!
//! Le commentaire d'en-tête d'inagle décrit une version **ultérieure** (1.01.34.00) à 14 entrées
//! et 9 champs (`loseType`, `shootCurveMidRate`, `shootCurveHeightRate`, `shootCurveAngle`…).
//! Ces champs **n'existent pas** dans le nœud 1.01.28.00 réellement monté par le VFS : le type
//! `SkillTechnicInfo` n'y expose que **5 champs**, dont les noms sont résolus depuis la table de
//! chaînes du fichier (vérité binaire) :
//!
//! | champ                  | type RDBN | rôle                                                  |
//! |------------------------|-----------|-------------------------------------------------------|
//! | `id`                   | Hash      | hash de la technique (jointure vers `skill_config`).  |
//! | `winSubMotionNameCrc`  | Hash      | CRC du nom de sous-animation jouée en réussite.       |
//! | `loseSubMotionNameCrc` | Hash      | CRC du nom de sous-animation jouée en échec.          |
//! | `formationType`        | Byte      | type de formation/placement des persos de la cinématique. |
//! | `formationCharaLen`    | Float     | nombre/longueur de personnages dans la formation.     |
//!
//! On porte donc **les champs réellement présents** dans le VFS (principe « contre le vrai
//! nœud »), pas le sur-ensemble documenté pour 1.01.34.00. La typo Level-5 `SubMotionNameCrc`
//! est préservée à l'identique.
//!
//! Première valeur vérifiée (dump réel) : `id = 0xA2123954`, `winSubMotionNameCrc = 0x00000000`,
//! `loseSubMotionNameCrc = 0x00000000`, `formationType = 0`, `formationCharaLen = 3.0`.

use alloc::collections::BTreeMap;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, list_values};
use crate::hash::HashId;

/// Une entrée `SkillTechnicInfo` du `skill_technic_config` (5 champs, version VFS 1.01.28.00).
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SkillTechnicInfo {
    /// `id` — hash de la technique (clé de jointure vers `skill_config`).
    pub id: HashId,
    /// `winSubMotionNameCrc` — CRC du nom de sous-animation jouée à la réussite (typo Level-5 conservée).
    pub win_sub_motion_name_crc: HashId,
    /// `loseSubMotionNameCrc` — CRC du nom de sous-animation jouée à l'échec.
    pub lose_sub_motion_name_crc: HashId,
    /// `formationType` — type de formation/placement des personnages de la cinématique (octet).
    pub formation_type: u8,
    /// `formationCharaLen` — nombre/longueur de personnages dans la formation (flottant).
    pub formation_chara_len: f32,
}

impl SkillTechnicInfo {
    /// Construit une entrée depuis une valeur `values[]` de `m_SkillTechnicInfoList` (objet JSON).
    ///
    /// Recopie directe des 5 champs (port 1:1 de `parseContent`, inagle l.51-61) : aucun filtre
    /// d'invalidité — inagle mappe toutes les valeurs de la liste. Les hash absents retombent sur
    /// [`HashId::ZERO`], les numériques absents sur `0`.
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        SkillTechnicInfo {
            id: field_hash(v, "id"),
            win_sub_motion_name_crc: field_hash(v, "winSubMotionNameCrc"),
            lose_sub_motion_name_crc: field_hash(v, "loseSubMotionNameCrc"),
            // Byte RDBN sérialisé en nombre JSON ; borné à u8 (les valeurs réelles ∈ [0,255]).
            formation_type: field_i64(v, "formationType").unwrap_or(0).clamp(0, 255) as u8,
            formation_chara_len: field_f32(v, "formationCharaLen"),
        }
    }
}

/// Lit un champ flottant d'un objet `values[]` (Float RDBN sérialisé en nombre JSON), `0.0` si absent.
#[must_use]
fn field_f32(v: &Value, key: &str) -> f32 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0) as f32
}

/// Parse toute la liste `m_SkillTechnicInfoList` d'un `skill_technic_config_*.cfg.bin.json`
/// déjà désérialisé. Port 1:1 de `parseContent` (inagle l.44-66) : itère les valeurs de la
/// liste nommée et les projette en [`SkillTechnicInfo`]. Liste absente → vecteur vide.
#[must_use]
pub fn parse_skill_technic_config(root: &Value) -> Vec<SkillTechnicInfo> {
    let mut out = Vec::new();
    if let Some(values) = list_values(root, "m_SkillTechnicInfoList") {
        for v in values {
            out.push(SkillTechnicInfo::from_value(v));
        }
    }
    out
}

/// Index `id → SkillTechnicInfo` (port de `bySkillId` / `buildSkillTechnicDatabase`, inagle
/// l.81-89). En cas de doublon d'`id`, la dernière entrée gagne (sémantique `Map.set`).
#[must_use]
pub fn build_by_id(list: &[SkillTechnicInfo]) -> BTreeMap<HashId, SkillTechnicInfo> {
    let mut map = BTreeMap::new();
    for info in list {
        map.insert(info.id, *info);
    }
    map
}
