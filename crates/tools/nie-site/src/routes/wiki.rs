//! Thin read-only bindings of the common wiki search and joined card owners.
use crate::{error::ErreurSite, state::EtatSite};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Arc, OnceLock},
};

fn limiter() -> &'static Arc<tokio::sync::Semaphore> {
    static LIMIT: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    LIMIT.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
}
fn valid_query(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}
fn unavailable(error: impl std::fmt::Display) -> ErreurSite {
    tracing::debug!(%error, "wiki resource unavailable");
    ErreurSite::Indisponible("Wiki resource unavailable".into())
}

async fn read_wiki<T, F>(data: Arc<crate::dataset::Gisement>, operation: F) -> Result<T, ErreurSite>
where
    T: Send + 'static,
    F: FnOnce(&rusqlite::Connection) -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        data.lire(|connection| operation(connection).map_err(unavailable))
            .map_err(unavailable)
    })
    .await?
}

fn data_root() -> PathBuf {
    std::env::var_os("DATA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("data"))
}

/// Bounded exact resource code batch with a requested game locale.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NamesQuery {
    /// Comma-separated original resource codes, at most 200.
    pub codes: String,
    /// Requested game locale; mirror translations currently cover fr/en/ja.
    pub locale: String,
}

/// Resolve names through the shared mirror owner without changing native resource IDs.
pub async fn names(
    State(state): State<EtatSite>,
    Query(input): Query<NamesQuery>,
) -> Result<Json<nie_wiki::names::NamePage>, ErreurSite> {
    if input.codes.len() > 25_799 {
        return Err(ErreurSite::Demande(
            "Resource code batch is too large".into(),
        ));
    }
    let codes: Vec<String> = if input.codes.is_empty() {
        Vec::new()
    } else {
        input.codes.split(',').map(str::to_owned).collect()
    };
    nie_wiki::names::validate(&codes, &input.locale)
        .map_err(|message| ErreurSite::Demande(message.into()))?;
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Name resolution capacity busy"))?;
    let data = Arc::clone(&state.gisement);
    let page = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        data.lire(|connection| {
            nie_wiki::names::resolve(connection, &codes, &input.locale).map_err(unavailable)
        })
        .map_err(unavailable)
    })
    .await??;
    Ok(Json(page))
}

/// Enrich original gallery resources from the same mirror used by wiki search.
pub async fn gallery(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::gallery::GalleryRequest>,
) -> Result<Json<nie_wiki::gallery::GalleryPage>, ErreurSite> {
    input
        .validate()
        .map_err(|message| ErreurSite::Demande(message.into()))?;
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Gallery capacity busy"))?;
    let data = Arc::clone(&state.gisement);
    let page = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        data.lire(|connection| nie_wiki::gallery::query(connection, &input).map_err(unavailable))
            .map_err(unavailable)
    })
    .await??;
    Ok(Json(page))
}

/// Query parameters for full-text wiki search.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchQuery {
    /// Search text.
    pub q: String,
    /// Optional maximum number of results.
    pub limit: Option<usize>,
}

/// One bounded page of wiki search results.
#[derive(Serialize)]
pub struct SearchPage {
    /// Matching wiki records.
    pub results: Vec<nie_wiki::model::SearchResult>,
    /// Number of returned records.
    pub count: usize,
    /// Effective result limit.
    pub limit: usize,
}

/// Search the read-only wiki mirror.
pub async fn search(
    State(state): State<EtatSite>,
    Query(input): Query<SearchQuery>,
) -> Result<Json<SearchPage>, ErreurSite> {
    let limit = input.limit.unwrap_or(30);
    if !valid_query(&input.q) || !(1..=50).contains(&limit) {
        return Err(ErreurSite::Demande(
            "Require a nonempty query up to 128 bytes and limit 1..50".into(),
        ));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Search capacity busy"))?;
    let data = Arc::clone(&state.gisement);
    let results = read_wiki(data, move |connection| {
        let _permit = permit;
        nie_wiki::query::search_all(connection, &input.q, limit)
    })
    .await?;
    Ok(Json(SearchPage {
        count: results.len(),
        results,
        limit,
    }))
}

/// Return one character card by its stable identifier.
pub async fn character(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<nie_wiki::cards::CharacterCard>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid character ID".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Card capacity busy"))?;
    let data = Arc::clone(&state.gisement);
    let card = read_wiki(data, move |connection| {
        let _permit = permit;
        nie_wiki::cards::character(connection, &id)
    })
    .await?;
    card.map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Character not found".into()))
}

/// Return one skill profile by its exact mirror identifier or internal code.
pub async fn skill(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<nie_wiki::model::SkillProfile>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid skill ID".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Skill capacity busy"))?;
    let profile = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::query::get_skill(connection, &id)
    })
    .await?;
    profile
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Skill not found".into()))
}

/// Return one item profile by its exact mirror identifier or internal code.
pub async fn item(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<nie_wiki::model::ItemProfile>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid item ID".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Item capacity busy"))?;
    let profile = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::query::get_item(connection, &id)
    })
    .await?;
    profile
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Item not found".into()))
}

/// Return one team profile by its exact mirror identifier or internal code.
pub async fn team(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<nie_wiki::model::TeamProfile>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid team ID".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Team capacity busy"))?;
    let profile = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::query::get_team(connection, &id)
    })
    .await?;
    profile
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Team not found".into()))
}

/// Body accepted by `POST /api/v1/wiki/compare`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompareRequest {
    /// First character query.
    pub chara1: String,
    /// Second character query.
    pub chara2: String,
    /// Interpolation level, defaulting to the game's cap.
    #[serde(default = "default_compare_level")]
    pub level: u8,
}

fn default_compare_level() -> u8 {
    99
}

/// GET contract for the concrete compare operation.
pub async fn compare_contract() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "method": "POST",
        "path": "/api/v1/wiki/compare",
        "body": ["chara1", "chara2", "level"],
        "engine": "nie_wiki::query::compare_characters"
    }))
}

/// Compare two characters through the existing Rust comparison owner.
pub async fn compare(
    State(state): State<EtatSite>,
    Json(input): Json<CompareRequest>,
) -> Result<Json<nie_wiki::model::CompareResult>, ErreurSite> {
    if !valid_query(&input.chara1)
        || !valid_query(&input.chara2)
        || !(1..=99).contains(&input.level)
    {
        return Err(ErreurSite::Demande(
            "Require two character queries and level 1..99".into(),
        ));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Compare capacity busy"))?;
    let root = data_root();
    let chara1 = input.chara1;
    let chara2 = input.chara2;
    let level = input.level;
    let result = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::query::compare_characters(connection, &root, &chara1, &chara2, level)
    })
    .await?;
    Ok(Json(result))
}

/// Body accepted by `POST /api/v1/wiki/random-team`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RandomTeamRequest {
    /// Formation name such as `4-4-2`.
    #[serde(default = "default_formation")]
    pub formation: String,
    /// Optional element filter.
    #[serde(default)]
    pub element: Option<String>,
    /// Optional playstyle filter.
    #[serde(default)]
    pub playstyle: Option<String>,
    /// Explicit seed for deterministic results.
    #[serde(default)]
    pub seed: u64,
}

fn default_formation() -> String {
    "4-4-2".into()
}

/// GET contract for the concrete random-team operation.
pub async fn random_team_contract() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "method": "POST",
        "path": "/api/v1/wiki/random-team",
        "body": ["formation", "element", "playstyle", "seed"],
        "engine": "nie_wiki::query::random_team"
    }))
}

/// Generate a deterministic team through the existing Rust team generator.
pub async fn random_team(
    State(state): State<EtatSite>,
    Json(input): Json<RandomTeamRequest>,
) -> Result<Json<nie_wiki::model::RandomTeam>, ErreurSite> {
    let valid_optional = |value: &Option<String>| value.as_deref().is_none_or(valid_query);
    if !valid_query(&input.formation)
        || input.formation.len() > 16
        || !valid_optional(&input.element)
        || !valid_optional(&input.playstyle)
    {
        return Err(ErreurSite::Demande("Invalid random-team filters".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Random-team capacity busy"))?;
    let result = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::query::random_team(
            connection,
            &input.formation,
            input.element.as_deref(),
            input.playstyle.as_deref(),
            input.seed,
        )
    })
    .await?;
    Ok(Json(result))
}

/// List the read-only team-builder entries in the mirror.
pub async fn team_builder(
    State(state): State<EtatSite>,
) -> Result<Json<Vec<nie_wiki::model::TeamBuildEntry>>, ErreurSite> {
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Team-builder capacity busy"))?;
    let entries = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::query::team_build_list(connection)
    })
    .await?;
    Ok(Json(entries))
}

/// Return one read-only team-builder entry by ID or name.
pub async fn team_builder_entry(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<nie_wiki::model::TeamBuildEntry>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid team-builder ID".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Team-builder capacity busy"))?;
    let entry = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::query::team_build_calc(connection, &id)
    })
    .await?;
    entry
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Team-builder entry not found".into()))
}

/// List mirror-backed auras, Keshins, Souls, Miximax and awakenings.
pub async fn auras(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::auras::AuraListRequest>,
) -> Result<Json<nie_wiki::auras::AuraPage>, ErreurSite> {
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Aura capacity busy"))?;
    let page = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::auras::list_auras(connection, &input)
    })
    .await?;
    Ok(Json(page))
}

/// Query parameters selecting one aura family for a detail lookup.
#[derive(Debug, Deserialize, Default)]
pub struct AuraTypeQuery {
    /// Azalée category slug (`esprits-guerriers`, `totems`, `miximax`, ...).
    pub type_slug: Option<String>,
}

/// Resolve one aura-like row by ID or asset code.
pub async fn aura(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
    Query(input): Query<AuraTypeQuery>,
) -> Result<Json<nie_wiki::auras::AuraRecord>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid aura ID".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Aura capacity busy"))?;
    let result = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::auras::get_aura(connection, &id, input.type_slug.as_deref())
    })
    .await?;
    result
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Aura not found".into()))
}

/// List mirror-backed historical and special tactics.
pub async fn tactics(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::tactics::TacticListRequest>,
) -> Result<Json<nie_wiki::tactics::TacticPage>, ErreurSite> {
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Tactic capacity busy"))?;
    let page = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::tactics::list_tactics(connection, &input)
    })
    .await?;
    Ok(Json(page))
}

/// Resolve one tactic by database ID, internal code or slug.
pub async fn tactic(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<nie_wiki::tactics::TacticRecord>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid tactic ID".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Tactic capacity busy"))?;
    let result = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::tactics::get_tactic(connection, &id)
    })
    .await?;
    result
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Tactic not found".into()))
}

/// List mirror-backed passive skills with bounded filters.
pub async fn passives(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::passives::PassiveListRequest>,
) -> Result<Json<nie_wiki::passives::PassivePage>, ErreurSite> {
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Passive capacity busy"))?;
    let page = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::passives::list_passives(connection, &input)
    })
    .await?;
    Ok(Json(page))
}

/// Resolve one passive by database ID or embedded game identifier.
pub async fn passive(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<nie_wiki::passives::PassiveDetail>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid passive ID".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Passive capacity busy"))?;
    let result = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::passives::get_passive(connection, &id)
    })
    .await?;
    result
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Passive not found".into()))
}

/// List global passive scaling rules.
pub async fn passive_scaling(
    State(state): State<EtatSite>,
) -> Result<Json<Vec<nie_wiki::passives::PassiveScaling>>, ErreurSite> {
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Passive capacity busy"))?;
    let rules = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::passives::list_passive_scaling(connection)
    })
    .await?;
    Ok(Json(rules))
}

/// List the remaining mirror-backed IEVR sections formerly served by Azalee's wiki service.
pub async fn quests(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::auxiliary::QuestRequest>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::list_quests(connection, &input)
    })
    .await?;
    Ok(Json(value))
}

/// Return one quest projection by its stable mirror identifier.
pub async fn quest(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid quest ID".into()));
    }
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::get_quest(connection, &id)
    })
    .await?;
    value
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Quest not found".into()))
}

/// List all mirror-backed shop projections, optionally limited to one shop.
pub async fn shops(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::auxiliary::ShopRequest>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::list_shops(connection, &input)
    })
    .await?;
    Ok(Json(value))
}

/// Return one shop projection by numeric shop identifier.
pub async fn shop(
    State(state): State<EtatSite>,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::get_shop(connection, id)
    })
    .await?;
    value
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Shop not found".into()))
}

/// List capsule prize rows decoded from the mirror's raw variables.
pub async fn capsules(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::auxiliary::CapsuleRequest>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::list_capsules(connection, &input)
    })
    .await?;
    Ok(Json(value))
}

/// Return one capsule prize row by identifier.
pub async fn capsule(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid capsule ID".into()));
    }
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::get_capsule(connection, &id)
    })
    .await?;
    value
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Capsule not found".into()))
}

/// List costume model references without pretending hashes are image paths.
pub async fn costumes(
    State(state): State<EtatSite>,
    Query(input): Query<PaginationQuery>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let page = input.page.unwrap_or(1).max(1);
    let limit = input.limit.unwrap_or(48).clamp(1, 200);
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::list_costumes(connection, page, limit)
    })
    .await?;
    Ok(Json(value))
}

/// Pagination shared by bounded native wiki lists.
#[derive(Debug, Deserialize, Default)]
pub struct PaginationQuery {
    /// One-based page number.
    pub page: Option<u32>,
    /// Maximum rows per page.
    pub limit: Option<u32>,
}

/// Search native stadium metadata.
pub async fn stadiums(
    State(state): State<EtatSite>,
    Query(input): Query<SearchOnlyQuery>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::list_stadiums(connection, input.q.as_deref())
    })
    .await?;
    Ok(Json(value))
}

/// Return one stadium metadata row.
pub async fn stadium(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid stadium ID".into()));
    }
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::get_stadium(connection, &id)
    })
    .await?;
    value
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Stadium not found".into()))
}

/// Optional text filter for a native wiki collection.
#[derive(Debug, Deserialize, Default)]
pub struct SearchOnlyQuery {
    /// Case-insensitive search text.
    pub q: Option<String>,
}

/// Search native trophy and activity metadata.
pub async fn trophies(
    State(state): State<EtatSite>,
    Query(input): Query<TrophyQuery>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::list_trophies(
            connection,
            input.q.as_deref(),
            input.category.as_deref(),
        )
    })
    .await?;
    Ok(Json(value))
}

/// Filters for the native trophy collection.
#[derive(Debug, Deserialize, Default)]
pub struct TrophyQuery {
    /// Case-insensitive search text.
    pub q: Option<String>,
    /// `trophy` or `activity`.
    pub category: Option<String>,
}

/// Return one trophy or activity row.
pub async fn trophy(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid trophy ID".into()));
    }
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let values = nie_wiki::auxiliary::list_trophies(connection, None, None)?;
        Ok(values["trophies"].as_array().and_then(|rows| {
            rows.iter()
                .find(|row| {
                    row["id"]
                        .as_str()
                        .is_some_and(|value| value.eq_ignore_ascii_case(&id))
                })
                .cloned()
        }))
    })
    .await?;
    value
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Trophy not found".into()))
}

/// Search native coordinator, manager and coach rows.
pub async fn coaches(
    State(state): State<EtatSite>,
    Query(input): Query<SearchOnlyQuery>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::auxiliary::list_coaches(connection, input.q.as_deref())
    })
    .await?;
    Ok(Json(value))
}

/// Return one native coach row by numeric identifier.
pub async fn coach(
    State(state): State<EtatSite>,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let rows = nie_wiki::auxiliary::list_coaches(connection, None)?;
        Ok(rows
            .as_array()
            .and_then(|rows| rows.iter().find(|row| row["id"] == id))
            .cloned())
    })
    .await?;
    value
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Coach not found".into()))
}

/// Return the mirror's bean/drop rows without adding undocumented rewards.
pub async fn drops(State(state): State<EtatSite>) -> Result<Json<serde_json::Value>, ErreurSite> {
    Ok(Json(
        read_wiki(Arc::clone(&state.gisement), |connection| {
            nie_wiki::auxiliary::list_drops(connection)
        })
        .await?,
    ))
}

/// Return constellation rows used by the native invocation wiki section.
pub async fn invocations(
    State(state): State<EtatSite>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    Ok(Json(
        read_wiki(Arc::clone(&state.gisement), |connection| {
            nie_wiki::auxiliary::list_invocations(connection)
        })
        .await?,
    ))
}
