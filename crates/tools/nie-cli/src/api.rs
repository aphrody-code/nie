//! Typed, read-only API facade for the Azalee game-data capabilities already
//! ported to the Rust wiki owner.
//!
//! This module is deliberately smaller than the Clap surface. It gives other
//! native callers a stable command type without making them construct terminal
//! arguments, while [`nie_wiki`] remains the sole owner of SQL, joins and
//! game-data policy.

use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use serde_json::Value;

/// Read-only game-data operations that have a corresponding Azalee API.
#[derive(Debug, Clone)]
pub enum WikiCommand {
    /// Return the joined character card for an exact mirror identifier.
    CharacterCard {
        /// Stable character parameter identifier.
        id: String,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
    },
    /// Search characters, skills, items, teams and the other wiki families.
    Search {
        /// Search text.
        query: String,
        /// Maximum number of results (1..=50).
        limit: usize,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
    },
    /// Return one item profile by its stable identifier.
    Item {
        /// Item identifier.
        id: String,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
    },
    /// Return one skill profile by its stable identifier.
    Skill {
        /// Skill identifier.
        id: String,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
    },
    /// Return one team profile by its stable identifier.
    Team {
        /// Team identifier.
        id: String,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
    },
    /// List aura-like IEVR entities from the read-only mirror.
    AuraList {
        /// Optional literal search text.
        query: Option<String>,
        /// Optional Azalée family slug.
        type_slug: Option<String>,
        /// One-based page.
        page: u32,
        /// Page size.
        limit: u32,
        /// Optional mirror path.
        database: Option<PathBuf>,
    },
    /// Resolve one aura-like IEVR entity.
    Aura {
        /// Mirror ID or asset code.
        id: String,
        /// Optional Azalée family slug.
        type_slug: Option<String>,
        /// Optional mirror path.
        database: Option<PathBuf>,
    },
    /// List historical and special IEVR tactics.
    TacticList {
        /// Optional literal search text.
        query: Option<String>,
        /// One-based page.
        page: u32,
        /// Page size.
        limit: u32,
        /// Optional mirror path.
        database: Option<PathBuf>,
    },
    /// Resolve one IEVR tactic.
    Tactic {
        /// Database ID, internal code or slug.
        id: String,
        /// Optional mirror path.
        database: Option<PathBuf>,
    },
    /// List IEVR passive skills.
    PassiveList {
        /// Optional literal search text.
        query: Option<String>,
        /// Optional category filter.
        category: Option<String>,
        /// Optional boost type filter.
        boost_type: Option<String>,
        /// One-based page.
        page: u32,
        /// Page size.
        limit: u32,
        /// Optional mirror path.
        database: Option<PathBuf>,
    },
    /// Resolve one IEVR passive skill.
    Passive {
        /// Database ID or embedded game identifier.
        id: String,
        /// Optional mirror path.
        database: Option<PathBuf>,
    },
    /// List global passive scaling rules.
    PassiveScaling {
        /// Optional mirror path.
        database: Option<PathBuf>,
    },
    /// Resolve a skill through the existing Azalee-compatible corpus lookup.
    SkillLookup {
        /// Skill name or identifier.
        query: String,
        /// Root containing the canonical skill corpora.
        data_root: PathBuf,
    },
    /// Resolve an item through the existing mirror lookup.
    ItemLookup {
        /// Item name or identifier.
        query: String,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
    },
    /// Resolve a team through the existing mirror and corpus lookup.
    TeamLookup {
        /// Team name or identifier.
        query: String,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
        /// Root containing the canonical team corpus.
        data_root: PathBuf,
    },
    /// Compare two characters using the ported comparison operation.
    Compare {
        /// First character query.
        chara1: String,
        /// Second character query.
        chara2: String,
        /// Interpolation level.
        level: u8,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
        /// Root containing the measured comparison corpora.
        data_root: PathBuf,
    },
    /// Generate a deterministic team using the ported team generator.
    RandomTeam {
        /// Explicit PRNG seed.
        seed: u64,
        /// Formation name.
        formation: String,
        /// Optional element filter.
        element: Option<String>,
        /// Optional playstyle filter.
        playstyle: Option<String>,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
    },
    /// List read-only team-builder entries from the mirror.
    TeamBuilderList {
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
    },
    /// Read one team-builder entry from the mirror.
    TeamBuilderEntry {
        /// Entry identifier or name.
        id: String,
        /// Optional mirror path; normal environment resolution is used when absent.
        database: Option<PathBuf>,
    },
}

/// Execute one already-ported read-only operation as its JSON value.
///
/// The function is an adapter only: all mirror access and domain joins remain
/// in [`nie_wiki::query`] and [`nie_wiki::cards`]. The returned value is useful
/// to a CLI, MCP or future native HTTP binding that does not need terminal text.
pub fn execute_wiki(command: WikiCommand) -> Result<Value> {
    use nie_wiki::{cards, mirror, query};

    match command {
        WikiCommand::CharacterCard { id, database } => {
            ensure_identifier(&id)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let card = cards::character(&connection, &id)
                .context("character card could not be read")?
                .ok_or_else(|| anyhow::anyhow!("character was not found"))?;
            Ok(serde_json::to_value(card)?)
        }
        WikiCommand::Search {
            query: text,
            limit,
            database,
        } => {
            ensure_query(&text)?;
            if !(1..=50).contains(&limit) {
                bail!("search limit must be between 1 and 50");
            }
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            Ok(serde_json::to_value(query::search_all(
                &connection,
                &text,
                limit,
            )?)?)
        }
        WikiCommand::Item { id, database } => {
            ensure_identifier(&id)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let item = query::get_item(&connection, &id)?
                .ok_or_else(|| anyhow::anyhow!("item was not found"))?;
            Ok(serde_json::to_value(item)?)
        }
        WikiCommand::Skill { id, database } => {
            ensure_identifier(&id)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let skill = query::get_skill(&connection, &id)?
                .ok_or_else(|| anyhow::anyhow!("skill was not found"))?;
            Ok(serde_json::to_value(skill)?)
        }
        WikiCommand::Team { id, database } => {
            ensure_identifier(&id)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let team = query::get_team(&connection, &id)?
                .ok_or_else(|| anyhow::anyhow!("team was not found"))?;
            Ok(serde_json::to_value(team)?)
        }
        WikiCommand::AuraList {
            query: text,
            type_slug,
            page,
            limit,
            database,
        } => {
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let page = nie_wiki::auras::list_auras(
                &connection,
                &nie_wiki::auras::AuraListRequest {
                    query: text,
                    type_slug,
                    page: Some(page),
                    limit: Some(limit),
                },
            )?;
            Ok(serde_json::to_value(page)?)
        }
        WikiCommand::Aura {
            id,
            type_slug,
            database,
        } => {
            ensure_identifier(&id)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let aura = nie_wiki::auras::get_aura(&connection, &id, type_slug.as_deref())?
                .ok_or_else(|| anyhow::anyhow!("aura was not found"))?;
            Ok(serde_json::to_value(aura)?)
        }
        WikiCommand::TacticList {
            query: text,
            page,
            limit,
            database,
        } => {
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let page = nie_wiki::tactics::list_tactics(
                &connection,
                &nie_wiki::tactics::TacticListRequest {
                    query: text,
                    page: Some(page),
                    limit: Some(limit),
                },
            )?;
            Ok(serde_json::to_value(page)?)
        }
        WikiCommand::Tactic { id, database } => {
            ensure_identifier(&id)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let tactic = nie_wiki::tactics::get_tactic(&connection, &id)?
                .ok_or_else(|| anyhow::anyhow!("tactic was not found"))?;
            Ok(serde_json::to_value(tactic)?)
        }
        WikiCommand::PassiveList {
            query: text,
            category,
            boost_type,
            page,
            limit,
            database,
        } => {
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let page = nie_wiki::passives::list_passives(
                &connection,
                &nie_wiki::passives::PassiveListRequest {
                    query: text,
                    category,
                    boost_type,
                    page: Some(page),
                    limit: Some(limit),
                },
            )?;
            Ok(serde_json::to_value(page)?)
        }
        WikiCommand::Passive { id, database } => {
            ensure_identifier(&id)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let passive = nie_wiki::passives::get_passive(&connection, &id)?
                .ok_or_else(|| anyhow::anyhow!("passive was not found"))?;
            Ok(serde_json::to_value(passive)?)
        }
        WikiCommand::PassiveScaling { database } => {
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            Ok(serde_json::to_value(
                nie_wiki::passives::list_passive_scaling(&connection)?,
            )?)
        }
        WikiCommand::SkillLookup {
            query: text,
            data_root,
        } => {
            ensure_query(&text)?;
            Ok(query::lookup_skill_legacy(&data_root, &text)?)
        }
        WikiCommand::ItemLookup {
            query: text,
            database,
        } => {
            ensure_query(&text)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            Ok(query::lookup_item_legacy(&connection, &text)?)
        }
        WikiCommand::TeamLookup {
            query: text,
            database,
            data_root,
        } => {
            ensure_query(&text)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            Ok(query::lookup_team_legacy(
                &connection,
                &data_root.join("all-gamedata/teams.json"),
                &text,
            )?)
        }
        WikiCommand::Compare {
            chara1,
            chara2,
            level,
            database,
            data_root,
        } => {
            ensure_query(&chara1)?;
            ensure_query(&chara2)?;
            if !(1..=99).contains(&level) {
                bail!("comparison level must be between 1 and 99");
            }
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            Ok(serde_json::to_value(query::compare_characters(
                &connection,
                &data_root,
                &chara1,
                &chara2,
                level,
            )?)?)
        }
        WikiCommand::RandomTeam {
            seed,
            formation,
            element,
            playstyle,
            database,
        } => {
            ensure_query(&formation)?;
            if formation.len() > 16 {
                bail!("random-team formation is too long");
            }
            for value in [&element, &playstyle].into_iter().flatten() {
                ensure_query(value)?;
            }
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            Ok(serde_json::to_value(query::random_team(
                &connection,
                &formation,
                element.as_deref(),
                playstyle.as_deref(),
                seed,
            )?)?)
        }
        WikiCommand::TeamBuilderList { database } => {
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            Ok(serde_json::to_value(query::team_build_list(&connection)?)?)
        }
        WikiCommand::TeamBuilderEntry { id, database } => {
            ensure_identifier(&id)?;
            let connection = mirror::open(database.as_deref())
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            Ok(serde_json::to_value(
                query::team_build_calc(&connection, &id)?
                    .ok_or_else(|| anyhow::anyhow!("team-builder entry was not found"))?,
            )?)
        }
    }
}

fn ensure_identifier(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        bail!("invalid wiki identifier");
    }
    Ok(())
}

fn ensure_query(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        bail!("invalid wiki search query");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unbounded_search_requests_before_opening_the_mirror() {
        let error = execute_wiki(WikiCommand::Search {
            query: "characters".to_owned(),
            limit: 51,
            database: Some("/does/not/exist.sqlite".into()),
        })
        .expect_err("the transport bound must be checked first");
        assert!(error.to_string().contains("between 1 and 50"));
    }

    #[test]
    fn rejects_control_characters_in_identifiers() {
        let error = execute_wiki(WikiCommand::CharacterCard {
            id: "c0100\n0010".to_owned(),
            database: Some("/does/not/exist.sqlite".into()),
        })
        .expect_err("control characters must not reach a mirror query");
        assert!(error.to_string().contains("invalid wiki identifier"));
    }
}
