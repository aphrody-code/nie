//! Read-only candidate ranking using the existing native encyclopedia matcher.

use crate::error::ErreurSite;
use axum::Json;
use serde::Deserialize;
use serde_json::{Value, json};

static RANKING_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RankRequest {
    pub entry: Value,
    pub candidates: Value,
    pub max_results: u32,
}

pub async fn contract() -> Json<Value> {
    Json(json!({
        "input": {"entry": "official encyclopedia entry", "candidates": "candidate array", "maxResults": "integer"},
        "entryFields": ["name", "zukanHash", "position", "element", "stats", "game", "gender", "description"],
        "candidateFields": ["id", "nameEn", "nameFr", "nameJa", "position", "element", "gender", "rarityLabel", "series", "zukanHash", "stats", "descriptionEn"],
        "maxCandidates": nie_zukan::matching::MAX_MATCH_CANDIDATES,
        "maxResults": nie_zukan::matching::MAX_RANKED_RESULTS,
        "performsNetworkRequests": false,
        "writesMatches": false,
        "resultMeaning": "Ranked suggestions; scores do not establish a verified identity"
    }))
}

pub async fn rank(Json(request): Json<RankRequest>) -> Result<Json<Value>, ErreurSite> {
    let permit = RANKING_SLOTS
        .try_acquire()
        .map_err(|_| ErreurSite::Indisponible("Candidate ranking is busy".into()))?;
    let output = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        nie_zukan::api::rank_json(
            &request.entry.to_string(),
            &request.candidates.to_string(),
            request.max_results,
        )
    })
    .await
    .map_err(|error| {
        tracing::error!(%error, "candidate ranking task failed");
        ErreurSite::Interne("Candidates could not be ranked".into())
    })?
    .map_err(ErreurSite::Demande)?;
    let value = serde_json::from_str(&output).map_err(|error| {
        tracing::error!(%error, "candidate ranking response failed");
        ErreurSite::Interne("Candidates could not be ranked".into())
    })?;
    Ok(Json(value))
}
