//! HTTP delivery for the complete profile owned by [`nie_app::complete_profile`].
//!
//! The mounted VFS is immutable for the process lifetime, so this route computes the portable
//! profile once on a blocking worker, caches its serialized value and attaches intermediary
//! cache policy to every response.

use std::sync::Arc;
use std::time::Instant;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use tokio::sync::OnceCell;

use crate::error::ErreurSite;
use crate::state::EtatSite;
use nie_app::complete_profile::build_complete_profile;

const CACHE_CONTROL: &str = "public, max-age=3600";

/// Process-lifetime cache: VFS content cannot change while `nie-site` is running.
static PROFILE_CACHE: OnceCell<Arc<serde_json::Value>> = OnceCell::const_new();

/// Serialized JSON with the route's intermediary cache policy.
pub struct CachedJson(Arc<serde_json::Value>);

impl IntoResponse for CachedJson {
    fn into_response(self) -> Response {
        let mut response = Json(&*self.0).into_response();
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(CACHE_CONTROL),
        );
        response
    }
}

/// `GET /api/v1/profile/complete`.
pub async fn complete(State(etat): State<EtatSite>) -> Result<CachedJson, ErreurSite> {
    if let Some(cached) = PROFILE_CACHE.get() {
        return Ok(CachedJson(cached.clone()));
    }
    let vfs = etat.vfs()?;
    let started = Instant::now();
    let value = tokio::task::spawn_blocking(move || {
        build_complete_profile(&vfs)
            .and_then(|profile| serde_json::to_value(profile).map_err(|error| error.to_string()))
    })
    .await?
    .map_err(ErreurSite::Indisponible)?;
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        "built /api/v1/profile/complete"
    );
    let value = Arc::new(value);
    let value = PROFILE_CACHE.get_or_init(|| async { value }).await.clone();
    Ok(CachedJson(value))
}
