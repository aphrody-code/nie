//! `ChronicleTopCaravanConfig` — port Rust de
//! `chronicle_top/chronicle_top_caravan_config.cfg.bin.json` (Level-5 IEVR).
//!
//! ## Vérité terrain
//!
//! Dump réel :
//! `/home/ubuntu/niers/data/common/gamedata/chronicle_top/chronicle_top_caravan_config.cfg.bin.json`
//!
//! Une seule liste dans ce fichier :
//! - `m_chronicleTopCaravanInfoList` (`CHRONICLE_TOP_CARAVAN_INFO`) — 5 entrées.
//!
//! Chaque entrée décrit les paramètres d'animation (amplitude + rotation) d'un personnage de
//! la caravane affiché sur l'écran Chronicle Top. Les axes X, Y, Z sont paramétrés séparément
//! avec un max, un type d'easing, une période et une force.
//!
//! ## Exemple de valeurs réelles
//!
//! Entrée[0] (id=1, moveType=0) :
//! - `amplitudeMaxY = 0.5`, `amplitudeEasingTypeY = 1`, `amplitudePeriodTimeY = 2` — oscillation douce en Y.
//! - `rotationMaxZ = 5`, `rotationEasingTypeZ = 1`, `rotationPeriodTimeZ = 4` — légère rotation Z.
//!
//! Entrée[4] (id=5, moveType=1) :
//! - Combine amplitudes X+Y et rotations Y+Z — animation la plus complète du set.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::list_values;

// ─── ChronicleTopCaravanInfo ──────────────────────────────────────────────────

/// Paramètres d'animation d'un personnage de caravane (`CHRONICLE_TOP_CARAVAN_INFO`).
///
/// Les champs `amplitude_*` et `rotation_*` définissent des oscillations périodiques sur
/// les axes X, Y, Z. L'easing type 0 = linéaire, 1 = smooth (d'après les valeurs réelles).
///
/// Vérité terrain :
/// `chronicle_top_caravan_config.cfg.bin.json` — liste `m_chronicleTopCaravanInfoList`.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ChronicleTopCaravanInfo {
    /// `id` — identifiant de l'entrée (1-basé, 1 à 5 dans le dump réel).
    pub id: i64,
    /// `moveType` — type de mouvement (0 = statique hors Y/Z, 1 = mouvement combiné).
    pub move_type: i64,

    // ── Amplitude X ────────────────────────────────────────────────────────
    /// `amplitudeMaxX` — amplitude maximale sur l'axe X (unités monde).
    pub amplitude_max_x: f32,
    /// `amplitudeEasingTypeX` — type d'interpolation pour l'amplitude X (0=linéaire, 1=smooth).
    pub amplitude_easing_type_x: i64,
    /// `amplitudePeriodTimeX` — période de l'oscillation X en secondes.
    pub amplitude_period_time_x: f32,
    /// `amplitudeStrengthX` — force de l'oscillation X (facteur multiplicatif).
    pub amplitude_strength_x: f32,

    // ── Amplitude Y ────────────────────────────────────────────────────────
    /// `amplitudeMaxY` — amplitude maximale sur l'axe Y.
    pub amplitude_max_y: f32,
    /// `amplitudeEasingTypeY`.
    pub amplitude_easing_type_y: i64,
    /// `amplitudePeriodTimeY`.
    pub amplitude_period_time_y: f32,
    /// `amplitudeStrengthY`.
    pub amplitude_strength_y: f32,

    // ── Amplitude Z ────────────────────────────────────────────────────────
    /// `amplitudeMaxZ`.
    pub amplitude_max_z: f32,
    /// `amplitudeEasingTypeZ`.
    pub amplitude_easing_type_z: i64,
    /// `amplitudePeriodTimeZ`.
    pub amplitude_period_time_z: f32,
    /// `amplitudeStrengthZ`.
    pub amplitude_strength_z: f32,

    // ── Rotation X ─────────────────────────────────────────────────────────
    /// `rotationMaxX` — rotation maximale sur l'axe X (degrés).
    pub rotation_max_x: f32,
    /// `rotationEasingTypeX`.
    pub rotation_easing_type_x: i64,
    /// `rotationPeriodTimeX`.
    pub rotation_period_time_x: f32,
    /// `rotationStrengthX`.
    pub rotation_strength_x: f32,

    // ── Rotation Y ─────────────────────────────────────────────────────────
    /// `rotationMaxY`.
    pub rotation_max_y: f32,
    /// `rotationEasingTypeY`.
    pub rotation_easing_type_y: i64,
    /// `rotationPeriodTimeY`.
    pub rotation_period_time_y: f32,
    /// `rotationStrengthY`.
    pub rotation_strength_y: f32,

    // ── Rotation Z ─────────────────────────────────────────────────────────
    /// `rotationMaxZ`.
    pub rotation_max_z: f32,
    /// `rotationEasingTypeZ`.
    pub rotation_easing_type_z: i64,
    /// `rotationPeriodTimeZ`.
    pub rotation_period_time_z: f32,
    /// `rotationStrengthZ`.
    pub rotation_strength_z: f32,
}

impl ChronicleTopCaravanInfo {
    /// Parse une entrée de `m_chronicleTopCaravanInfoList`. `None` si `id` est absent.
    ///
    /// Tous les champs manquants prennent la valeur 0 / 0.0.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let id = v.get("id").and_then(Value::as_i64)?;
        Some(Self {
            id,
            move_type: v.get("moveType").and_then(Value::as_i64).unwrap_or(0),

            amplitude_max_x: f32_field(v, "amplitudeMaxX"),
            amplitude_easing_type_x: i64_field(v, "amplitudeEasingTypeX"),
            amplitude_period_time_x: f32_field(v, "amplitudePeriodTimeX"),
            amplitude_strength_x: f32_field(v, "amplitudeStrengthX"),

            amplitude_max_y: f32_field(v, "amplitudeMaxY"),
            amplitude_easing_type_y: i64_field(v, "amplitudeEasingTypeY"),
            amplitude_period_time_y: f32_field(v, "amplitudePeriodTimeY"),
            amplitude_strength_y: f32_field(v, "amplitudeStrengthY"),

            amplitude_max_z: f32_field(v, "amplitudeMaxZ"),
            amplitude_easing_type_z: i64_field(v, "amplitudeEasingTypeZ"),
            amplitude_period_time_z: f32_field(v, "amplitudePeriodTimeZ"),
            amplitude_strength_z: f32_field(v, "amplitudeStrengthZ"),

            rotation_max_x: f32_field(v, "rotationMaxX"),
            rotation_easing_type_x: i64_field(v, "rotationEasingTypeX"),
            rotation_period_time_x: f32_field(v, "rotationPeriodTimeX"),
            rotation_strength_x: f32_field(v, "rotationStrengthX"),

            rotation_max_y: f32_field(v, "rotationMaxY"),
            rotation_easing_type_y: i64_field(v, "rotationEasingTypeY"),
            rotation_period_time_y: f32_field(v, "rotationPeriodTimeY"),
            rotation_strength_y: f32_field(v, "rotationStrengthY"),

            rotation_max_z: f32_field(v, "rotationMaxZ"),
            rotation_easing_type_z: i64_field(v, "rotationEasingTypeZ"),
            rotation_period_time_z: f32_field(v, "rotationPeriodTimeZ"),
            rotation_strength_z: f32_field(v, "rotationStrengthZ"),
        })
    }
}

// ─── Helpers privés ───────────────────────────────────────────────────────────

#[inline]
fn f32_field(v: &Value, key: &str) -> f32 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0) as f32
}

#[inline]
fn i64_field(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}

// ─── ChronicleTopCaravanConfig ────────────────────────────────────────────────

/// Contenu complet de `chronicle_top_caravan_config.cfg.bin.json`.
///
/// Utiliser [`parse_chronicle_top_caravan_config`] pour construire depuis un JSON désérialisé.
///
/// Vérité terrain : 5 entrées dans le dump réel
/// (`chronicle_top_caravan_config.cfg.bin.json`, liste `m_chronicleTopCaravanInfoList`).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ChronicleTopCaravanConfig {
    /// Entrées `m_chronicleTopCaravanInfoList` — 5 dans le dump réel.
    pub caravans: Vec<ChronicleTopCaravanInfo>,
}

impl ChronicleTopCaravanConfig {
    /// Recherche une entrée par son `id`. `None` si absente.
    #[must_use]
    pub fn find_by_id(&self, id: i64) -> Option<&ChronicleTopCaravanInfo> {
        self.caravans.iter().find(|c| c.id == id)
    }
}

// ─── Parseur principal ────────────────────────────────────────────────────────

/// Parse un `chronicle_top_caravan_config.cfg.bin.json` (une seule liste).
///
/// Renvoie un [`ChronicleTopCaravanConfig`] avec toutes les entrées valides (`id` présent).
/// Les entrées sans `id` sont silencieusement ignorées.
///
/// Vérité terrain : 5 entrées dans le dump réel.
///
/// # Exemple
///
/// ```
/// use nie_data::chronicle_top::parse_chronicle_top_caravan_config;
/// use serde_json::json;
///
/// let root = json!({
///     "version": 100,
///     "lists": [{
///         "name": "m_chronicleTopCaravanInfoList",
///         "typeName": "CHRONICLE_TOP_CARAVAN_INFO",
///         "values": [{
///             "id": 1,
///             "moveType": 0,
///             "amplitudeMaxY": 0.5,
///             "amplitudeEasingTypeY": 1,
///             "amplitudePeriodTimeY": 2.0,
///             "amplitudeStrengthY": 0.0,
///             "amplitudeMaxX": 0.0,
///             "amplitudeEasingTypeX": 0,
///             "amplitudePeriodTimeX": 0.0,
///             "amplitudeStrengthX": 0.0,
///             "amplitudeMaxZ": 0.0,
///             "amplitudeEasingTypeZ": 0,
///             "amplitudePeriodTimeZ": 0.0,
///             "amplitudeStrengthZ": 0.0,
///             "rotationMaxX": 0.0,
///             "rotationEasingTypeX": 0,
///             "rotationPeriodTimeX": 0.0,
///             "rotationStrengthX": 0.0,
///             "rotationMaxY": 0.0,
///             "rotationEasingTypeY": 0,
///             "rotationPeriodTimeY": 0.0,
///             "rotationStrengthY": 0.0,
///             "rotationMaxZ": 5.0,
///             "rotationEasingTypeZ": 1,
///             "rotationPeriodTimeZ": 4.0,
///             "rotationStrengthZ": 0.0
///         }]
///     }]
/// });
/// let cfg = parse_chronicle_top_caravan_config(&root);
/// assert_eq!(cfg.caravans.len(), 1);
/// assert_eq!(cfg.caravans[0].id, 1);
/// assert_eq!(cfg.caravans[0].amplitude_max_y, 0.5_f32);
/// ```
#[must_use]
pub fn parse_chronicle_top_caravan_config(root: &Value) -> ChronicleTopCaravanConfig {
    let mut caravans = Vec::new();
    if let Some(values) = list_values(root, "m_chronicleTopCaravanInfoList") {
        for v in values {
            if let Some(info) = ChronicleTopCaravanInfo::from_value(v) {
                caravans.push(info);
            }
        }
    }
    ChronicleTopCaravanConfig { caravans }
}
