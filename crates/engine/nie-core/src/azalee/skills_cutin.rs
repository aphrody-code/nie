//! IEVR hissatsu cut-in metadata and served-asset checks.
//!
//! The JSON files are generated from the game VFS. Parsing and lookup are
//! implemented here in Rust so callers do not import the Azalee TypeScript package.

use std::string::String;
use std::vec::Vec;

/// Localized name triplet used by a skill cut-in entry.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(
    any(feature = "serde", feature = "data"),
    derive(serde::Serialize, serde::Deserialize)
)]
pub struct LocalizedSkillName {
    /// French label.
    pub fr: String,
    /// English label.
    pub en: String,
    /// Japanese label.
    pub ja: String,
}

/// VFS assets associated with one hissatsu cut-in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(
    any(feature = "serde", feature = "data"),
    derive(serde::Serialize, serde::Deserialize)
)]
pub struct SkillCutin {
    /// Event identifier used by the model and effects paths.
    pub event_id_name: String,
    /// G4MG model path.
    pub model_g4mg: String,
    /// G4MD model path.
    pub model_g4md: String,
    /// G4TX texture path.
    pub texture_g4tx: String,
    /// Sound configuration path.
    pub sound_cfg: String,
    /// Effects directory.
    pub effects_dir: String,
    /// Language/path pairs for telop textures.
    pub telop_by_lang: Vec<Vec<String>>,
}

/// Skill identity and gameplay values enriched with optional cut-in assets.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(
    any(feature = "serde", feature = "data"),
    derive(serde::Serialize, serde::Deserialize)
)]
pub struct SkillCutinEntry {
    /// Internal skill code, such as `whs01230`.
    pub skill_id_str: String,
    /// Hexadecimal skill identifier.
    pub skill_id: String,
    /// Event identifier name.
    pub event_id_name: String,
    /// Raw element identifier.
    pub element: i64,
    /// Localized element label.
    pub element_name: LocalizedSkillName,
    /// Raw category identifier.
    pub category: i64,
    /// Localized category label.
    pub category_name: LocalizedSkillName,
    /// Minimum power.
    pub power_min: i64,
    /// Maximum power.
    pub power_max: i64,
    /// TP cost.
    pub consume_tp: i64,
    /// Foul rate.
    pub foul_rate: i64,
    /// Growth type.
    pub growth_type: i64,
    /// Recast time.
    pub recast_time: i64,
    /// Partner type.
    pub partner_type: i64,
    /// Optional cut-in assets.
    pub cutin: Option<SkillCutin>,
}

/// Parsed cut-in catalog with code and served-event lookup.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SkillCutinCatalog {
    /// Number declared by the generated source metadata.
    pub skill_count: usize,
    /// Number of entries that carry cut-in metadata.
    pub cutin_count: usize,
    /// All generated skill entries in source order.
    pub skills: Vec<SkillCutinEntry>,
    served_events: Vec<String>,
}

impl SkillCutinCatalog {
    /// Creates a catalog from already parsed entries and served event names.
    #[must_use]
    pub fn new(
        skill_count: usize,
        cutin_count: usize,
        skills: Vec<SkillCutinEntry>,
        served_events: Vec<String>,
    ) -> Self {
        Self {
            skill_count,
            cutin_count,
            skills,
            served_events,
        }
    }

    /// Finds an entry by its exact internal code.
    #[must_use]
    pub fn get_skill_cutin(&self, code: &str) -> Option<&SkillCutinEntry> {
        self.skills.iter().find(|skill| skill.skill_id_str == code)
    }

    /// Returns whether a model and texture are present for an event.
    #[must_use]
    pub fn cutin_has_assets(&self, event_id_name: Option<&str>) -> bool {
        event_id_name.is_some_and(|event| {
            !event.is_empty() && self.served_events.iter().any(|served| served == event)
        })
    }

    /// Returns the served event names in generated source order.
    #[must_use]
    pub fn served_events(&self) -> &[String] {
        &self.served_events
    }
}

#[cfg(feature = "data")]
mod embedded {
    use super::{SkillCutinCatalog, SkillCutinEntry};
    use std::string::String;
    use std::sync::OnceLock;
    use std::vec::Vec;

    const SKILLS_JSON: &str = include_str!("../../../../../data/azalee/skills-cutin.json");
    const SERVED_JSON: &str = include_str!("../../../../../data/azalee/skills-cutin-served.json");

    #[derive(serde::Deserialize)]
    struct SkillFile {
        meta: SkillMeta,
        skills: Vec<SkillCutinEntry>,
    }

    #[derive(serde::Deserialize)]
    struct SkillMeta {
        skill_count: usize,
        cutin_count: usize,
    }

    #[derive(serde::Deserialize)]
    struct ServedFile {
        events: Vec<String>,
    }

    /// Parses the two generated source files into the Rust catalog.
    pub fn from_json(skills_json: &str, served_json: &str) -> Result<SkillCutinCatalog, String> {
        let skills: SkillFile =
            serde_json::from_str(skills_json).map_err(|error| error.to_string())?;
        let served: ServedFile =
            serde_json::from_str(served_json).map_err(|error| error.to_string())?;
        Ok(SkillCutinCatalog::new(
            skills.meta.skill_count,
            skills.meta.cutin_count,
            skills.skills,
            served.events,
        ))
    }

    /// Loads the generated catalogs once for all Rust callers.
    pub fn load() -> &'static SkillCutinCatalog {
        static CATALOG: OnceLock<SkillCutinCatalog> = OnceLock::new();
        CATALOG.get_or_init(|| {
            from_json(SKILLS_JSON, SERVED_JSON).expect("embedded cut-in data is valid")
        })
    }
}

/// Parses generated cut-in files through Rust's typed data model.
#[cfg(feature = "data")]
pub use embedded::from_json as skill_cutin_catalog_from_json;

/// Returns the embedded cut-in catalog.
#[cfg(feature = "data")]
#[must_use]
pub fn skill_cutin_catalog() -> &'static SkillCutinCatalog {
    embedded::load()
}

/// Looks up a generated skill cut-in by internal code.
#[cfg(feature = "data")]
#[must_use]
pub fn get_skill_cutin(code: &str) -> Option<&'static SkillCutinEntry> {
    skill_cutin_catalog().get_skill_cutin(code)
}

/// Checks the generated VFS-serving manifest for one event.
#[cfg(feature = "data")]
#[must_use]
pub fn cutin_has_assets(event_id_name: Option<&str>) -> bool {
    skill_cutin_catalog().cutin_has_assets(event_id_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_is_exact_and_empty_events_are_not_served() {
        let skill = SkillCutinEntry {
            skill_id_str: "whs01230".into(),
            ..SkillCutinEntry::default()
        };
        let catalog = SkillCutinCatalog::new(1, 1, vec![skill], vec!["ev60_00010".into()]);
        assert!(catalog.get_skill_cutin("whs01230").is_some());
        assert!(catalog.get_skill_cutin("WHS01230").is_none());
        assert!(!catalog.cutin_has_assets(None));
        assert!(!catalog.cutin_has_assets(Some("")));
        assert!(catalog.cutin_has_assets(Some("ev60_00010")));
    }

    #[cfg(feature = "data")]
    #[test]
    fn embedded_catalog_matches_generated_counts_and_real_skill() {
        let catalog = skill_cutin_catalog();
        assert_eq!(catalog.skill_count, 1004);
        assert_eq!(catalog.cutin_count, 1004);
        assert_eq!(catalog.skills.len(), 1004);
        assert_eq!(catalog.served_events().len(), 142);
        assert!(get_skill_cutin("whs01230").is_some_and(|skill| skill.cutin.is_some()));
        assert!(cutin_has_assets(Some("ev60_00060")));
        assert!(!cutin_has_assets(Some("missing-event")));
    }
}
