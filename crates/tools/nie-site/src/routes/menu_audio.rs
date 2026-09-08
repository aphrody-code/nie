//! Thin startup-audio metadata binding over the shared VFS catalogue.

use axum::{Json, extract::State};
use nie_explore::menu_audio::StartupAudio;
use std::sync::{Arc, OnceLock};

use crate::{error::ErreurSite, state::EtatSite};

/// Return native cue identities; missing banks produce a retryable resource error.
pub async fn startup(State(state): State<EtatSite>) -> Result<Json<StartupAudio>, ErreurSite> {
    let vfs = state.vfs()?;
    static LIMIT: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let permit = Arc::clone(LIMIT.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2))))
        .try_acquire_owned()
        .map_err(|_| ErreurSite::TropDeRequetes("Audio resources are busy".into()))?;
    let manifest = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        nie_explore::menu_audio::startup(&vfs)
    })
    .await
    .map_err(|error| {
        tracing::error!(%error, "startup audio metadata task failed");
        ErreurSite::Interne("Audio resources could not be loaded".into())
    })?
    .map_err(|error| {
        tracing::debug!(%error, "startup audio metadata unavailable");
        ErreurSite::Indisponible("Audio resources are unavailable".into())
    })?;
    Ok(Json(manifest))
}
