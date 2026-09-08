//! Thin read-only bindings of the common wiki search and joined card owners.
use crate::{error::ErreurSite, state::EtatSite};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchQuery {
    pub q: String,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
pub struct SearchPage {
    pub results: Vec<nie_wiki::model::SearchResult>,
    pub count: usize,
    pub limit: usize,
}

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
    let results = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        data.lire(|connection| {
            nie_wiki::query::search_all(connection, &input.q, limit).map_err(unavailable)
        })
        .map_err(unavailable)
    })
    .await??;
    Ok(Json(SearchPage {
        count: results.len(),
        results,
        limit,
    }))
}

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
    let card = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        data.lire(|connection| nie_wiki::cards::character(connection, &id).map_err(unavailable))
            .map_err(unavailable)
    })
    .await??;
    card.map(Json)
        .ok_or_else(|| ErreurSite::Introuvable("Character not found".into()))
}
