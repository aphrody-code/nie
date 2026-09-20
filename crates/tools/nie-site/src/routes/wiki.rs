//! Thin read-only bindings of the common wiki search and joined card owners.
use crate::{error::ErreurSite, state::EtatSite};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
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

/// Browser tools use the same read-only roster operation as the native host.
pub async fn roster(State(state): State<EtatSite>) -> Result<Json<serde_json::Value>, ErreurSite> {
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Roster capacity busy"))?;
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::desktop::execute(connection, "load_roster", &serde_json::json!({}))
    })
    .await?;
    Ok(Json(value))
}

/// Public staff projection shared with the native host; no arbitrary query surface.
pub async fn staff(State(state): State<EtatSite>) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), |connection| {
        nie_wiki::desktop::execute(connection, "load_staff", &serde_json::json!({}))
    })
    .await?;
    Ok(Json(value))
}

/// Public, fixed-operation skill projection; arbitrary desktop queries stay native.
pub async fn character_skills(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid character ID".into()));
    }
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        if nie_wiki::query::get_character(connection, &id)?.is_none() {
            return Ok(None);
        }
        nie_wiki::desktop::execute(
            connection,
            "character_skills",
            &serde_json::json!({"id":id}),
        )
        .map(Some)
    })
    .await?;
    value
        .map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Character not found".into()))
}

/// Cross table metadata retained from the measured extraction schema.
pub async fn cross_tables(
    State(state): State<EtatSite>,
    Query(input): Query<SearchOnlyQuery>,
) -> Result<Json<Vec<nie_wiki::cross::TableSummary>>, ErreurSite> {
    let rows = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::cross::tables(connection, input.q.as_deref())
    })
    .await?;
    Ok(Json(rows))
}

/// Public Cross measurements without the extraction machine's source paths.
pub async fn cross_stats(
    State(state): State<EtatSite>,
) -> Result<Json<nie_wiki::cross::CatalogStats>, ErreurSite> {
    let stats = read_wiki(Arc::clone(&state.gisement), nie_wiki::cross::stats).await?;
    Ok(Json(stats))
}

/// Bounded search of imported Addressables objects, retaining typed GUID variants.
pub async fn cross_catalog(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::cross::CatalogQuery>,
) -> Result<Json<nie_wiki::cross::CatalogPage>, ErreurSite> {
    if input.q.as_deref().is_some_and(|q| q.len() > 512)
        || input
            .kind
            .as_deref()
            .is_some_and(|kind| !matches!(kind, "asset" | "bundle" | "cri"))
    {
        return Err(ErreurSite::Demande("Invalid Cross catalogue filter".into()));
    }
    let page = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::cross::search(connection, &input)
    })
    .await?;
    Ok(Json(page))
}

/// Historical player-list envelope backed by the shared Rust catalogue and DTO owner.
pub async fn legacy_characters(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::legacy::CharacterListRequest>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    if input
        .q
        .as_deref()
        .is_some_and(|query| query.len() > 256 || query.chars().any(char::is_control))
    {
        return Err(ErreurSite::Demande("Invalid character query".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Catalogue capacity busy"))?;
    let page = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::legacy::characters(connection, &input)
    })
    .await?;
    Ok(Json(page))
}

/// Historical character detail resolution: base slug, variant slug, then exact row ID.
pub async fn legacy_character(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Response, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid character ID".into()));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Character capacity busy"))?;
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::legacy::character(connection, &id)
    })
    .await?;
    Ok(legacy_detail_response(value, "personnage"))
}

fn legacy_detail_response(value: Option<serde_json::Value>, resource: &str) -> Response {
    match value {
        Some(value) => Json(value).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error":format!("{resource} introuvable")})),
        )
            .into_response(),
    }
}

/// Historical complete shop summaries with joined category counts.
pub async fn legacy_shops(
    State(state): State<EtatSite>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(
        Arc::clone(&state.gisement),
        nie_wiki::legacy_locations::shops,
    )
    .await?;
    Ok(Json(value))
}

/// Historical shop IDs use decimal-prefix parsing in the shared compatibility owner.
pub async fn legacy_shop(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Response, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_locations::shop(connection, &id)
    })
    .await?;
    Ok(legacy_detail_response(value, "boutique"))
}

/// Historical stadium search covers only its code and display title.
pub async fn legacy_stadiums(
    State(state): State<EtatSite>,
    Query(input): Query<SearchOnlyQuery>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_locations::stadiums(connection, input.q.as_deref())
    })
    .await?;
    Ok(Json(value))
}

/// Preserve the historical exact stadium identifier and not-found JSON.
pub async fn legacy_stadium(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Response, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_locations::stadium(connection, &id)
    })
    .await?;
    Ok(legacy_detail_response(value, "stade"))
}

/// Historical complete team list, with source-verified French name ordering.
pub async fn legacy_teams(
    State(state): State<EtatSite>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), nie_wiki::legacy_teams::list).await?;
    Ok(Json(value))
}

/// Historical exact team identity, including native emblem, kit and roster references.
pub async fn legacy_team(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Response, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_teams::detail(connection, &id)
    })
    .await?;
    Ok(legacy_detail_response(value, "équipe"))
}

/// Historical coach list with spreadsheet cleanup and passive/portrait joins.
pub async fn legacy_coaches(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::legacy_entities::CoachRequest>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_entities::coaches(connection, &input)
    })
    .await?;
    Ok(Json(value))
}

/// Preserve decimal-prefix coach IDs and the historical not-found envelope.
pub async fn legacy_coach(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Response, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_entities::coach(connection, &id)
    })
    .await?;
    Ok(legacy_detail_response(value, "coach"))
}

/// Historical staff list, including its published Zukan references and card shape.
pub async fn legacy_coordinators(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::legacy::CharacterListRequest>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let page = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy::coordinators(connection, &input)
    })
    .await?;
    Ok(Json(page))
}

/// Historical equipment contracts delegate selection and projection to the mirror owner.
pub async fn legacy_skills(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::legacy_equipment::ListRequest>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    input
        .validate()
        .map_err(|error| ErreurSite::Demande(error.to_string()))?;
    read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_equipment::skills(connection, &input)
    })
    .await
    .map(Json)
}

/// Preserve the historical paginated item list, including special tactics.
pub async fn legacy_items(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::legacy_equipment::ListRequest>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    input
        .validate()
        .map_err(|error| ErreurSite::Demande(error.to_string()))?;
    read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_equipment::items(connection, &input)
    })
    .await
    .map(Json)
}

/// Preserve historical skill lookup aliases and the complete public detail DTO.
pub async fn legacy_skill(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Response, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid skill ID".into()));
    }
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_equipment::skill(connection, &id)
    })
    .await?;
    Ok(legacy_detail_response(value, "technique"))
}

/// Preserve exact item-ID lookup and its native enrichment fallbacks.
pub async fn legacy_item(
    State(state): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Response, ErreurSite> {
    if !valid_query(&id) {
        return Err(ErreurSite::Demande("Invalid item ID".into()));
    }
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::legacy_equipment::item(connection, &id)
    })
    .await?;
    Ok(legacy_detail_response(value, "objet"))
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
    // The byte bound is DERIVED, not written down. `25_799` sat here as a bare literal: it is
    // 200 codes of 128 bytes plus their 199 commas, a computation recorded nowhere, which would
    // have gone stale in silence the day either bound moved. Both now come from the validator
    // that actually enforces them.
    const MAX_CODES_BYTES: usize = nie_wiki::names::MAX_CODES * nie_wiki::names::MAX_CODE_LEN
        + (nie_wiki::names::MAX_CODES - 1);
    if input.codes.len() > MAX_CODES_BYTES {
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

/// Query parameters for localized label to native resource-code lookup.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NameSearchQuery {
    /// Visible localized label or native identity fragment.
    pub q: String,
    /// Requested game locale.
    pub locale: String,
    /// Optional maximum number of matching identities.
    pub limit: Option<usize>,
}

/// Search visible game names while retaining the original VFS identity.
pub async fn search_names(
    State(state): State<EtatSite>,
    Query(input): Query<NameSearchQuery>,
) -> Result<Json<nie_wiki::names::NameSearchPage>, ErreurSite> {
    let limit = input.limit.unwrap_or(30);
    if !valid_query(&input.q) || !(1..=50).contains(&limit) {
        return Err(ErreurSite::Demande(
            "Require a nonempty query up to 128 bytes and limit 1..50".into(),
        ));
    }
    nie_wiki::names::validate(&[], &input.locale)
        .map_err(|message| ErreurSite::Demande(message.into()))?;
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Name search capacity busy"))?;
    let data = Arc::clone(&state.gisement);
    let page = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        data.lire(|connection| {
            nie_wiki::names::search(connection, &input.q, &input.locale, limit).map_err(unavailable)
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

/// Preserve the historical gallery envelope and its selection/menu category split.
pub async fn legacy_gallery(
    State(state): State<EtatSite>,
    Query(input): Query<nie_wiki::legacy_gallery::GalleryRequest>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    input
        .validate()
        .map_err(|error| ErreurSite::Demande(error.to_string()))?;
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| unavailable("Gallery capacity busy"))?;
    read_wiki(Arc::clone(&state.gisement), move |connection| {
        let _permit = permit;
        nie_wiki::legacy_gallery::list(connection, &input)
    })
    .await
    .map(Json)
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
    Query(input): Query<nie_wiki::query::CoachFilters>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let value = read_wiki(Arc::clone(&state.gisement), move |connection| {
        nie_wiki::query::query_coaches(connection, &input)
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
