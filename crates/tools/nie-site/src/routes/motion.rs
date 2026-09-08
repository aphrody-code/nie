//! Read-only native motion metadata, using the same owner as desktop inspection.

use axum::{Json, extract::{Path, State}};
use nie_explore::motion::MotionClips;
use crate::{error::ErreurSite, state::EtatSite};

static INSPECTION_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

pub async fn clips(
    State(state): State<EtatSite>,
    Path(path): Path<String>,
) -> Result<Json<MotionClips>, ErreurSite> {
    if !path.starts_with("data/") || path.len() > 1024 || path.contains('\\')
        || path.split('/').any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(ErreurSite::Demande("Require an original data/ resource path".into()));
    }
    let vfs = state.vfs()?;
    if vfs.find(&path).is_none() {
        return Err(ErreurSite::Introuvable("Motion source is unavailable".into()));
    }
    let permit = INSPECTION_SLOTS.try_acquire().map_err(|_| {
        ErreurSite::Indisponible("Motion inspection is busy".into())
    })?;
    let report = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        nie_explore::motion::clips(&vfs, &path)
    })
        .await
        .map_err(|error| {
            tracing::error!(%error, "motion inspection task failed");
            ErreurSite::Interne("Motion resources could not be inspected".into())
        })?
        .map_err(|error| {
            tracing::debug!(%error, "motion inspection unavailable");
            ErreurSite::Indisponible("Motion resources are unavailable".into())
        })?;
    Ok(Json(report))
}
