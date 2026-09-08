//! Thin camera and navigation previews over the portable desktop projection owner.

use axum::{Json, extract::{Path, State}};
use nie_explore::spatial_preview::{CameraPreview, NavigationPreview};
use crate::{error::ErreurSite, state::EtatSite};

static INSPECTION_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
const MAX_BYTES: u64 = 32 * 1024 * 1024;

async fn project<T: Send + 'static>(
    state: EtatSite,
    path: String,
    decode: fn(&[u8]) -> Result<T, String>,
) -> Result<Json<T>, ErreurSite> {
    if !path.starts_with("data/") || path.len() > 1024 || path.contains('\\')
        || path.split('/').any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(ErreurSite::Demande("Require an original data/ resource path".into()));
    }
    let vfs = state.vfs()?;
    let entry = vfs.find(&path).ok_or_else(|| ErreurSite::Introuvable("Preview resource is unavailable".into()))?;
    if u64::from(entry.file_size) > MAX_BYTES {
        return Err(ErreurSite::Demande("Preview resource exceeds size limit".into()));
    }
    let permit = INSPECTION_SLOTS.try_acquire().map_err(|_| ErreurSite::Indisponible("Preview inspection is busy".into()))?;
    let report = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let bytes = vfs.read(&path).map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Preview resource exceeds size limit".to_owned());
        }
        decode(&bytes)
    }).await.map_err(|error| {
        tracing::error!(%error, "spatial preview task failed");
        ErreurSite::Interne("Preview could not be loaded".into())
    })?.map_err(|error| {
        tracing::debug!(%error, "spatial preview unavailable");
        ErreurSite::Indisponible("Native preview could not be decoded".into())
    })?;
    Ok(Json(report))
}

pub async fn camera(State(state): State<EtatSite>, Path(path): Path<String>) -> Result<Json<CameraPreview>, ErreurSite> {
    project(state, path, nie_explore::spatial_preview::camera).await
}

pub async fn navmesh(State(state): State<EtatSite>, Path(path): Path<String>) -> Result<Json<NavigationPreview>, ErreurSite> {
    project(state, path, nie_explore::spatial_preview::navmesh).await
}
