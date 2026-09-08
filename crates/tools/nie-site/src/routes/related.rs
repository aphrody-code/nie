//! Thin VFS relationship binding; public output contains logical game paths only.
use crate::{error::ErreurSite, state::EtatSite};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use std::sync::{Arc, OnceLock};

/// Optional localization parameters for related assets.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelatedQuery {
    /// Preferred locale code.
    pub locale: Option<String>,
}

/// Declared references can feed preloading; naming candidates are not dependency proof.
pub async fn related(
    State(state): State<EtatSite>,
    Path(raw): Path<String>,
    Query(query): Query<RelatedQuery>,
) -> Result<Json<nie_explore::related::Relationships>, ErreurSite> {
    let path = super::vfs::normaliser(&raw)?;
    let locale = query.locale.unwrap_or_else(|| "fr".to_owned());
    if !matches!(locale.as_str(), "fr" | "en" | "ja") {
        return Err(ErreurSite::Demande("Unsupported locale".into()));
    }
    if !state.index()?.contient(&path) {
        return Err(ErreurSite::Introuvable("VFS resource not found".into()));
    }
    static LIMIT: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let permit = Arc::clone(LIMIT.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2))))
        .try_acquire_owned()
        .map_err(|_| ErreurSite::Indisponible("Resource inspection capacity is busy".into()))?;
    let vfs = state.vfs()?;
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        nie_explore::related::inspect(&vfs, &path, &locale)
    })
    .await?
    .map_err(|error| {
        tracing::debug!(%error, "native resource relationship unavailable");
        ErreurSite::Demande("Resource relationship inspection unavailable".into())
    })?;
    Ok(Json(result))
}
