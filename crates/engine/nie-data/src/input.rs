//! `input` — port Rust des 3 fichiers de configuration manette/DualSense d'IEVR (Level-5).
//!
//! ## Vérité terrain
//!
//! Trois dumps réels, tous au layout **`lists`** (objets à champs nommés) :
//!
//! - `adaptive_trigger_def_0.00.00.cfg.bin.json` — 2 listes : `m_ModeItemList`
//!   (7 × `MODE_ITEM_INFO`) + `m_InfoAdaptiveTriggerDataList`
//!   (3 × `INFO_ADAPTIVE_TRIGGER_DATA_CONFIG`).
//! - `haptic_feedback_def_0.00.00.cfg.bin.json` — 2 listes : `m_ModeItemList`
//!   (7 × `MODE_ITEM_INFO`, **identique** à l'adaptive trigger) +
//!   `m_InfoHapticFeedbackDataList` (3 × `INFO_HAPTIC_FEEDBACK_DATA_CONFIG`, +`resPath`).
//! - `vibration_def_0.00.09.cfg.bin.json` — 1 liste : `m_vibrationDefList`
//!   (63 × `VIBRATION_DEF_INFO`).
//!
//! Pas de parser inagle connu pour cette famille : les dumps `.cfg.bin.json` font foi.
//!
//! ## `MODE_ITEM_INFO` (partagé adaptive trigger + haptic feedback)
//!
//! 17 entiers décrivant un mode d'effet de gâchette adaptative (préfixes Sony DualSense) :
//! `fd_*` = Feedback, `wp_*` = Weapon, `vb_*` = Vibration, `mpfd_*`/`mpvb_*` = Multiple
//! Position Feedback/Vibration, `sl_*` = Slope. Le mode 0 est entièrement nul (mode « off »).
//!
//! ## Note sur `modeItemList`
//!
//! Les entrées de données (`INFO_ADAPTIVE_TRIGGER_DATA_CONFIG` /
//! `INFO_HAPTIC_FEEDBACK_DATA_CONFIG`) portent `modeItemList`, un tableau JSON de 2 entiers
//! indexant `m_ModeItemList` (gâchette gauche L2 / droite R2). Stocké en `Vec<i64>`.

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, field_str, list_values};
use crate::hash::HashId;

/// Lit un champ flottant d'un objet `values[]` (tolère `Int` comme `Float` côté JSON).
#[inline]
fn field_f32(v: &Value, key: &str) -> f32 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0) as f32
}

/// Lit un champ tableau d'entiers (`modeItemList`) en `Vec<i64>` (vide si absent).
fn field_i64_list(v: &Value, key: &str) -> Vec<i64> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default()
}

// ─── MODE_ITEM_INFO ─────────────────────────────────────────────────────────────

/// Un mode d'effet de gâchette adaptative (`MODE_ITEM_INFO`).
///
/// 17 entiers (préfixes Sony DualSense). Partagé à l'identique entre `adaptive_trigger_def`
/// et `haptic_feedback_def` (mêmes 7 valeurs dans les deux dumps).
///
/// Vérité terrain : `m_ModeItemList[0]` est entièrement nul (mode « off ») ;
/// `m_ModeItemList[1]` = `{fd_startPosition:2, fd_strength:2, wp_startPosition:2,
/// wp_endPosition:8, wp_strength:8, mpvb_amplitude:1, …}`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ModeItem {
    /// `fd_startPosition` — Feedback : position de départ.
    pub fd_start_position: i64,
    /// `fd_strength` — Feedback : force.
    pub fd_strength: i64,
    /// `wp_startPosition` — Weapon : position de départ.
    pub wp_start_position: i64,
    /// `wp_endPosition` — Weapon : position de fin.
    pub wp_end_position: i64,
    /// `wp_strength` — Weapon : force.
    pub wp_strength: i64,
    /// `vb_startPosition` — Vibration : position de départ.
    pub vb_start_position: i64,
    /// `vb_amplitude` — Vibration : amplitude.
    pub vb_amplitude: i64,
    /// `vb_frequency` — Vibration : fréquence.
    pub vb_frequency: i64,
    /// `mpfd_strength` — Multiple Position Feedback : force.
    pub mpfd_strength: i64,
    /// `sl_startPosition` — Slope : position de départ.
    pub sl_start_position: i64,
    /// `sl_endPosition` — Slope : position de fin.
    pub sl_end_position: i64,
    /// `sl_startStrength` — Slope : force de départ.
    pub sl_start_strength: i64,
    /// `sl_endStrength` — Slope : force de fin.
    pub sl_end_strength: i64,
    /// `mpvb_frequency` — Multiple Position Vibration : fréquence.
    pub mpvb_frequency: i64,
    /// `mpvb_amplitude` — Multiple Position Vibration : amplitude.
    pub mpvb_amplitude: i64,
    /// `triggerEffectMode` — mode d'effet de la gâchette (0 dans tout le dump).
    pub trigger_effect_mode: i64,
    /// `triggerType` — type de gâchette (0 dans tout le dump).
    pub trigger_type: i64,
}

impl ModeItem {
    /// Parse une entrée de `m_ModeItemList`.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        Some(Self {
            fd_start_position: field_i64(v, "fd_startPosition").unwrap_or(0),
            fd_strength: field_i64(v, "fd_strength").unwrap_or(0),
            wp_start_position: field_i64(v, "wp_startPosition").unwrap_or(0),
            wp_end_position: field_i64(v, "wp_endPosition").unwrap_or(0),
            wp_strength: field_i64(v, "wp_strength").unwrap_or(0),
            vb_start_position: field_i64(v, "vb_startPosition").unwrap_or(0),
            vb_amplitude: field_i64(v, "vb_amplitude").unwrap_or(0),
            vb_frequency: field_i64(v, "vb_frequency").unwrap_or(0),
            mpfd_strength: field_i64(v, "mpfd_strength").unwrap_or(0),
            sl_start_position: field_i64(v, "sl_startPosition").unwrap_or(0),
            sl_end_position: field_i64(v, "sl_endPosition").unwrap_or(0),
            sl_start_strength: field_i64(v, "sl_startStrength").unwrap_or(0),
            sl_end_strength: field_i64(v, "sl_endStrength").unwrap_or(0),
            mpvb_frequency: field_i64(v, "mpvb_frequency").unwrap_or(0),
            mpvb_amplitude: field_i64(v, "mpvb_amplitude").unwrap_or(0),
            trigger_effect_mode: field_i64(v, "triggerEffectMode").unwrap_or(0),
            trigger_type: field_i64(v, "triggerType").unwrap_or(0),
        })
    }
}

// ─── INFO_ADAPTIVE_TRIGGER_DATA_CONFIG ──────────────────────────────────────────

/// Une entrée de gâchette adaptative (`INFO_ADAPTIVE_TRIGGER_DATA_CONFIG`).
///
/// Vérité terrain : `m_InfoAdaptiveTriggerDataList[0]` =
/// `{id:"0xCC92A4CA", id_name:"feedback01", mask:3, modeItemList:[1,2]}`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AdaptiveTrigger {
    /// `id` — hash identifiant l'entrée (ex. `0xCC92A4CA`).
    pub id: HashId,
    /// `id_name` — nom symbolique (ex. `"feedback01"`).
    pub id_name: String,
    /// `mask` — masque de bits des gâchettes concernées (3 = L2|R2 dans le dump).
    pub mask: i64,
    /// `modeItemList` — index dans `m_ModeItemList` (2 entiers : L2, R2).
    pub mode_item_list: Vec<i64>,
}

impl AdaptiveTrigger {
    /// Parse une entrée de `m_InfoAdaptiveTriggerDataList`. `None` si `id` est nul.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let id = field_hash(v, "id");
        if id.is_zero() {
            return None;
        }
        Some(Self {
            id,
            id_name: field_str(v, "id_name").unwrap_or("").into(),
            mask: field_i64(v, "mask").unwrap_or(0),
            mode_item_list: field_i64_list(v, "modeItemList"),
        })
    }
}

// ─── INFO_HAPTIC_FEEDBACK_DATA_CONFIG ───────────────────────────────────────────

/// Une entrée de retour haptique (`INFO_HAPTIC_FEEDBACK_DATA_CONFIG`).
///
/// Identique à [`AdaptiveTrigger`] avec un champ `resPath` (chemin du WAV de vibration)
/// en plus.
///
/// Vérité terrain : `m_InfoHapticFeedbackDataList[0]` =
/// `{id:"0xCC92A4CA", id_name:"feedback01", mask:3, modeItemList:[1,2],
/// resPath:"#/debug/input/vibration/HandGun_Vibration.wav"}`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct HapticFeedback {
    /// `id` — hash identifiant l'entrée (ex. `0xCC92A4CA`).
    pub id: HashId,
    /// `id_name` — nom symbolique (ex. `"feedback01"`).
    pub id_name: String,
    /// `mask` — masque de bits des gâchettes concernées (3 dans le dump).
    pub mask: i64,
    /// `modeItemList` — index dans `m_ModeItemList` (2 entiers : L2, R2).
    pub mode_item_list: Vec<i64>,
    /// `resPath` — chemin du fichier WAV de vibration associé.
    pub res_path: String,
}

impl HapticFeedback {
    /// Parse une entrée de `m_InfoHapticFeedbackDataList`. `None` si `id` est nul.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let id = field_hash(v, "id");
        if id.is_zero() {
            return None;
        }
        Some(Self {
            id,
            id_name: field_str(v, "id_name").unwrap_or("").into(),
            mask: field_i64(v, "mask").unwrap_or(0),
            mode_item_list: field_i64_list(v, "modeItemList"),
            res_path: field_str(v, "resPath").unwrap_or("").into(),
        })
    }
}

// ─── VIBRATION_DEF_INFO ─────────────────────────────────────────────────────────

/// Une définition de vibration (`VIBRATION_DEF_INFO`).
///
/// `highFrequency`/`lowFrequency`/`priority` sont entiers ; les autres paramètres
/// (`amplitude*`, `powerParam`, `*Time`, `*Rate`, `holdMinLimitPower`) sont des flottants
/// (le JSON les écrit parfois en entier, ex. `smallRate: 1`).
///
/// Vérité terrain : `m_vibrationDefList[0]` =
/// `{vibrationId:"0x23DD8401", highFrequency:250, lowFrequency:50, amplitudeHigh:0.2,
/// amplitudeLow:0.1, powerParam:0.9, inTime:0.2, loopTime:0.1, outTime:0.1,
/// holdMinLimitPower:0.2, largeRate:0.07, smallRate:1, bLoopHold:false, priority:50,
/// wavPath:""}`.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Vibration {
    /// `vibrationId` — hash identifiant la vibration (ex. `0x23DD8401`).
    pub vibration_id: HashId,
    /// `highFrequency` — fréquence du moteur haute fréquence (Hz).
    pub high_frequency: i64,
    /// `lowFrequency` — fréquence du moteur basse fréquence (Hz).
    pub low_frequency: i64,
    /// `amplitudeHigh` — amplitude du moteur haute fréquence (0..1).
    pub amplitude_high: f32,
    /// `amplitudeLow` — amplitude du moteur basse fréquence (0..1).
    pub amplitude_low: f32,
    /// `powerParam` — paramètre de puissance global.
    pub power_param: f32,
    /// `inTime` — durée de montée (s).
    pub in_time: f32,
    /// `loopTime` — durée de boucle (s, 0 = pas de boucle).
    pub loop_time: f32,
    /// `outTime` — durée de descente (s).
    pub out_time: f32,
    /// `holdMinLimitPower` — puissance minimale maintenue.
    pub hold_min_limit_power: f32,
    /// `largeRate` — taux du moteur large.
    pub large_rate: f32,
    /// `smallRate` — taux du moteur small.
    pub small_rate: f32,
    /// `bLoopHold` — maintenir la boucle (false dans tout le dump).
    pub b_loop_hold: bool,
    /// `priority` — priorité de la vibration.
    pub priority: i64,
    /// `wavPath` — chemin du WAV (vide pour les vibrations procédurales).
    pub wav_path: String,
}

impl Vibration {
    /// Parse une entrée de `m_vibrationDefList`. `None` si `vibrationId` est nul.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let vibration_id = field_hash(v, "vibrationId");
        if vibration_id.is_zero() {
            return None;
        }
        Some(Self {
            vibration_id,
            high_frequency: field_i64(v, "highFrequency").unwrap_or(0),
            low_frequency: field_i64(v, "lowFrequency").unwrap_or(0),
            amplitude_high: field_f32(v, "amplitudeHigh"),
            amplitude_low: field_f32(v, "amplitudeLow"),
            power_param: field_f32(v, "powerParam"),
            in_time: field_f32(v, "inTime"),
            loop_time: field_f32(v, "loopTime"),
            out_time: field_f32(v, "outTime"),
            hold_min_limit_power: field_f32(v, "holdMinLimitPower"),
            large_rate: field_f32(v, "largeRate"),
            small_rate: field_f32(v, "smallRate"),
            b_loop_hold: v.get("bLoopHold").and_then(Value::as_bool).unwrap_or(false),
            priority: field_i64(v, "priority").unwrap_or(0),
            wav_path: field_str(v, "wavPath").unwrap_or("").into(),
        })
    }
}

// ─── Configs complètes ──────────────────────────────────────────────────────────

/// Contenu complet de `adaptive_trigger_def_*.cfg.bin.json`.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AdaptiveTriggerDef {
    /// `m_ModeItemList` — 7 modes d'effet de gâchette.
    pub mode_items: Vec<ModeItem>,
    /// `m_InfoAdaptiveTriggerDataList` — 3 entrées de gâchette adaptative.
    pub triggers: Vec<AdaptiveTrigger>,
}

impl AdaptiveTriggerDef {
    /// Recherche une entrée par son `id`. `None` si absente.
    #[must_use]
    pub fn find_by_id(&self, id: HashId) -> Option<&AdaptiveTrigger> {
        self.triggers.iter().find(|t| t.id == id)
    }
}

/// Contenu complet de `haptic_feedback_def_*.cfg.bin.json`.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct HapticFeedbackDef {
    /// `m_ModeItemList` — 7 modes d'effet (identiques à ceux de l'adaptive trigger).
    pub mode_items: Vec<ModeItem>,
    /// `m_InfoHapticFeedbackDataList` — 3 entrées de retour haptique.
    pub feedbacks: Vec<HapticFeedback>,
}

impl HapticFeedbackDef {
    /// Recherche une entrée par son `id`. `None` si absente.
    #[must_use]
    pub fn find_by_id(&self, id: HashId) -> Option<&HapticFeedback> {
        self.feedbacks.iter().find(|f| f.id == id)
    }
}

/// Contenu complet de `vibration_def_*.cfg.bin.json`.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct VibrationDef {
    /// `m_vibrationDefList` — 63 définitions de vibration.
    pub vibrations: Vec<Vibration>,
}

impl VibrationDef {
    /// Recherche une vibration par son `vibrationId`. `None` si absente.
    #[must_use]
    pub fn find_by_id(&self, id: HashId) -> Option<&Vibration> {
        self.vibrations.iter().find(|v| v.vibration_id == id)
    }
}

// ─── Parseurs principaux ────────────────────────────────────────────────────────

/// Parcourt une liste nommée du JSON et applique `f` à chaque entrée.
fn extract_list<T, F>(root: &Value, name: &str, f: F) -> Vec<T>
where
    F: Fn(&Value) -> Option<T>,
{
    let mut out = Vec::new();
    if let Some(values) = list_values(root, name) {
        for v in values {
            if let Some(item) = f(v) {
                out.push(item);
            }
        }
    }
    out
}

/// Parse un `adaptive_trigger_def_*.cfg.bin.json` complet (2 listes).
#[must_use]
pub fn parse_adaptive_trigger_def(root: &Value) -> AdaptiveTriggerDef {
    AdaptiveTriggerDef {
        mode_items: extract_list(root, "m_ModeItemList", ModeItem::from_value),
        triggers: extract_list(
            root,
            "m_InfoAdaptiveTriggerDataList",
            AdaptiveTrigger::from_value,
        ),
    }
}

/// Parse un `haptic_feedback_def_*.cfg.bin.json` complet (2 listes).
#[must_use]
pub fn parse_haptic_feedback_def(root: &Value) -> HapticFeedbackDef {
    HapticFeedbackDef {
        mode_items: extract_list(root, "m_ModeItemList", ModeItem::from_value),
        feedbacks: extract_list(
            root,
            "m_InfoHapticFeedbackDataList",
            HapticFeedback::from_value,
        ),
    }
}

/// Parse un `vibration_def_*.cfg.bin.json` complet (1 liste).
#[must_use]
pub fn parse_vibration_def(root: &Value) -> VibrationDef {
    VibrationDef {
        vibrations: extract_list(root, "m_vibrationDefList", Vibration::from_value),
    }
}
