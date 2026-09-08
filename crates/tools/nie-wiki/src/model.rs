//! Modèles de données extraits du miroir SQLite pour l'exploration wiki.
//!
//! Ces structs correspondent aux données retournées par les requêtes sur les
//! tables `inagle_*` du SQLite, après fusion `data`/`sheet_data`.

use serde::{Deserialize, Serialize};

// ─── Élément / Catégorie ─────────────────────────────────────────────────────

/// Résolution de l'élément depuis la colonne texte FR (identique au TS).
///
/// La DB stocke le texte FR (ex: "Feu"), la colonne `element_id` est NULL.
/// Map identique à `elementMap` dans wiki-service.ts.
pub fn element_fr_to_en(fr: &str) -> String {
    match fr {
        "Feu" => "Feu/Fire".to_string(),
        "Vent" => "Vent/Wind".to_string(),
        "Forêt" => "Forêt/Forest".to_string(),
        "Montagne" => "Montagne/Mountain".to_string(),
        "Néant" | "Void" => "Néant/Void".to_string(),
        other => other.to_string(),
    }
}

/// Résolution de la catégorie de skill depuis le texte FR.
///
/// Map identique à `categoryMap` dans wiki-service.ts getSkill.
pub fn category_fr_to_en(fr: &str) -> String {
    match fr {
        "Tir" => "Tir/Shoot".to_string(),
        "Dribble" => "Dribble".to_string(),
        "Défense" => "Défense/Block".to_string(),
        "Arrêt" => "Arrêt/Keep".to_string(),
        other => other.to_string(),
    }
}

// ─── Personnage ──────────────────────────────────────────────────────────────

/// Résumé d'un personnage issu du miroir.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharaSummary {
    pub id: String,
    pub chara_id: String,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub element: Option<String>,
    pub position: Option<String>,
    pub rarity_label: Option<String>,
    pub internal_code: Option<String>,
    pub slug: Option<String>,
    pub base_slug: Option<String>,
}

/// Profil complet d'un personnage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharaProfile {
    pub id: String,
    pub chara_id: String,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub element: Option<String>,
    pub position: Option<String>,
    pub rarity_label: Option<String>,
    pub internal_code: Option<String>,
    pub slug: Option<String>,
    pub base_slug: Option<String>,
    pub description_fr: Option<String>,
    pub description_en: Option<String>,
    pub gender: Option<String>,
    pub team_name: Option<String>,
    pub series: Option<String>,
    pub zukan_hash: Option<String>,
    /// Stats at the four game curve breakpoints when present in `data`.
    pub stats_lv1: Option<StatBlock>,
    pub stats_lv30: Option<StatBlock>,
    pub stats_lv50: Option<StatBlock>,
    pub stats_lv99: Option<StatBlock>,
    /// Skills (skill_id + niveau d'apprentissage) depuis `data`.
    pub skills: Vec<SkillSlot>,
    /// Auras / Keshins / Souls / Miximax associés.
    pub auras: Vec<AuraSummary>,
    /// Données brutes fusionnées (JSON).
    pub merged: serde_json::Value,
}

/// Un slot de technique appris par un personnage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSlot {
    pub skill_id: String,
    pub learn_level: u32,
}

/// Bloc de stats interpolées.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct StatBlock {
    pub kick: u16,
    pub control: u16,
    pub technique: u16,
    pub physical: u16,
    pub pressure: u16,
    pub agility: u16,
    pub intelligence: u16,
}

impl StatBlock {
    pub fn total(self) -> u32 {
        u32::from(self.kick)
            + u32::from(self.control)
            + u32::from(self.technique)
            + u32::from(self.physical)
            + u32::from(self.pressure)
            + u32::from(self.agility)
            + u32::from(self.intelligence)
    }

    /// Interpole ce StatBlock vers `end` avec `t` ∈ [0, 1] (floor).
    pub fn lerp(self, end: StatBlock, t: f64) -> StatBlock {
        let lerp_u = |s: u16, e: u16| -> u16 {
            (f64::from(s) + (f64::from(e) - f64::from(s)) * t).floor() as u16
        };
        StatBlock {
            kick: lerp_u(self.kick, end.kick),
            control: lerp_u(self.control, end.control),
            technique: lerp_u(self.technique, end.technique),
            physical: lerp_u(self.physical, end.physical),
            pressure: lerp_u(self.pressure, end.pressure),
            agility: lerp_u(self.agility, end.agility),
            intelligence: lerp_u(self.intelligence, end.intelligence),
        }
    }

    /// Interprète un noeud JSON `{kick, control, technique, physical/physique, pressure, agility, intelligence}`.
    pub fn from_json(v: &serde_json::Value) -> Option<Self> {
        let obj = v.as_object()?;
        let get = |k: &str| -> u16 { obj.get(k).and_then(|x| x.as_u64()).unwrap_or(0) as u16 };
        // TS utilise "physical" comme clé, parfois "physique" (FR)
        let physical = get("physical").max(get("physique"));
        Some(StatBlock {
            kick: get("kick"),
            control: get("control"),
            technique: get("technique"),
            physical,
            pressure: get("pressure"),
            agility: get("agility"),
            intelligence: get("intelligence"),
        })
    }
}

/// Résumé d'une aura liée à un personnage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuraSummary {
    pub id: String,
    pub name: String,
    pub aura_type: String,
}

// ─── Skill ───────────────────────────────────────────────────────────────────

/// Profil d'une technique / compétence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillProfile {
    pub id: String,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    /// Catégorie résolue depuis le texte FR (category_id est NULL en DB).
    pub category: Option<String>,
    /// Élément résolu depuis le texte FR (element_id est NULL en DB).
    pub element: Option<String>,
    pub power_max: Option<i64>,
    pub power_min: Option<i64>,
    pub tp_cost: Option<i64>,
    pub description_fr: Option<String>,
    pub description_en: Option<String>,
    pub internal_code: Option<String>,
    pub is_hyper: bool,
    pub merged: serde_json::Value,
}

// ─── Item ────────────────────────────────────────────────────────────────────

/// Profil d'un objet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemProfile {
    pub id: String,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub category: Option<String>,
    pub rarity: Option<i64>,
    pub description_fr: Option<String>,
    pub internal_code: Option<String>,
    /// Prix (issu de sheet_data.price, pas la colonne price qui contient des sort IDs).
    pub price: Option<i64>,
    /// Boutiques (depuis shops ou sheet_data.shops).
    pub shops: Vec<String>,
    pub merged: serde_json::Value,
}

// ─── Team ────────────────────────────────────────────────────────────────────

/// Profil d'une équipe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamProfile {
    pub id: String,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub internal_code: Option<String>,
    pub series: Option<String>,
    pub region: Option<String>,
    /// Uniformes (kit IDs depuis data.kits).
    pub kits: Vec<String>,
    /// Saisons (depuis data.seasons).
    pub seasons: Vec<String>,
    pub merged: serde_json::Value,
}

// ─── Compare ─────────────────────────────────────────────────────────────────

/// Résultat d'une comparaison de deux personnages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareResult {
    pub level: u8,
    pub chara1: CharaCompareSlot,
    pub chara2: CharaCompareSlot,
}

/// Un slot de comparaison avec stats interpolées.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharaCompareSlot {
    pub id: String,
    #[serde(skip_serializing)]
    pub chara_id: String,
    pub name: String,
    pub position: Option<String>,
    pub element: Option<String>,
    pub rarity: Option<String>,
    pub stats: StatBlock,
    pub skills: Vec<CompareSkillSlot>,
}

/// Skill dans un slot de comparaison.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareSkillSlot {
    #[serde(rename = "learnLevel")]
    pub learn_level: u32,
    #[serde(rename = "id")]
    pub skill_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

// ─── Search ──────────────────────────────────────────────────────────────────

/// Un résultat de recherche multi-tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub entity_type: String,
    pub id: String,
    pub name: String,
    pub extra: Option<String>,
}

// ─── Status ──────────────────────────────────────────────────────────────────

/// Legacy-compatible local health report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusReport {
    pub sqlite: SqliteStatus,
    pub redis: RedisStatus,
    pub git: GitStatus,
    pub process: ProcessStatus,
    pub system: SystemStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteStatus {
    pub healthy: bool,
    pub path: String,
    pub file_size: String,
    pub tables: u64,
    pub character_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisStatus {
    pub healthy: bool,
    pub latency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Current repository position.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub commit: String,
    pub clean: bool,
}

/// Current process memory values in legacy display units.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryStatus {
    pub heap_used: String,
    pub rss: String,
}

/// Current process health values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessStatus {
    pub uptime: String,
    pub memory: ProcessMemoryStatus,
}

/// Host system values in legacy display units.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub total_memory: String,
    pub free_memory: String,
    pub platform: String,
    pub arch: String,
}

// ─── Audit ───────────────────────────────────────────────────────────────────

/// Legacy-compatible character and skill integrity audit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditReport {
    pub characters: CharacterAudit,
    pub skills: SkillAudit,
}

/// Character integrity counters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterAudit {
    pub total: u64,
    pub missing_name_fr_en: u64,
    pub missing_image: u64,
    pub missing_stats: u64,
}

/// Skill integrity counters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAudit {
    pub total: u64,
    pub missing_name_fr_en: u64,
}

// ─── Dialogue ────────────────────────────────────────────────────────────────

/// One narrative dialogue match.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueMatch {
    pub event_id: String,
    pub dialogue_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<DialogueText>,
}

/// Multilingual text for one narrative line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogueText {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub en: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ja: Option<String>,
}

// ─── RandomTeam ──────────────────────────────────────────────────────────────

/// Un joueur sélectionné pour une équipe aléatoire.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RandomTeamPlayer {
    pub id: String,
    pub name: String,
    pub element: Option<String>,
    #[serde(skip)]
    pub position: String,
}

/// Un coordinateur (coach/manager) sélectionné.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RandomTeamCoord {
    pub id: i64,
    pub name: String,
    pub element: Option<String>,
    pub playstyle: Option<String>,
    #[serde(skip)]
    pub role: String,
    pub buff: Option<String>,
}

/// L'équipe aléatoire complète.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RandomTeam {
    #[serde(skip)]
    pub seed: u64,
    pub formation: String,
    pub gk: Vec<RandomTeamPlayer>,
    pub df: Vec<RandomTeamPlayer>,
    pub mf: Vec<RandomTeamPlayer>,
    pub fw: Vec<RandomTeamPlayer>,
    pub coach: Option<RandomTeamCoord>,
    pub managers: Vec<RandomTeamCoord>,
}

// ─── TeamBuilder ─────────────────────────────────────────────────────────────

/// Un joueur dans le team-builder (lu depuis inagle_team_build).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamBuildEntry {
    pub id: String,
    pub name: String,
    pub slot: Option<String>,
    pub position: Option<String>,
    pub element: Option<String>,
    pub data: serde_json::Value,
}
