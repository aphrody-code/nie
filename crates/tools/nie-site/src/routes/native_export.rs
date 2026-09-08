//! Read-only VFS binding of the existing desktop export library.
use std::sync::{Arc, OnceLock};

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;

use crate::{error::ErreurSite, state::EtatSite};

const MAX_SOURCE_BYTES: usize = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;

fn limiter() -> &'static Arc<tokio::sync::Semaphore> {
    static LIMIT: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    LIMIT.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
}

/// Optional parameters controlling native asset export.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportQuery {
    /// Requested output format.
    pub format: Option<String>,
    /// Optional waveform identifier for audio containers.
    pub waveform_id: Option<u16>,
    /// Optional audio channel to export.
    pub audio_channel: Option<u8>,
}

fn availability(path: &str, format: &str) -> Option<&'static str> {
    if nie_explore::export::necessite_contexte(format) {
        Some("Use the assembled model resource for contextual GLB export")
    } else if path.to_ascii_lowercase().ends_with(".acb") && format == "wav" {
        Some("Select an exact named cue through the native audio resource")
    } else {
        None
    }
}

/// List the shared library's candidates, distinguishing contextual conversions.
pub async fn formats(
    State(state): State<EtatSite>,
    Path(raw): Path<String>,
) -> Result<Json<serde_json::Value>, ErreurSite> {
    let path = super::vfs::normaliser(&raw)?;
    if !state.index()?.contient(&path) {
        return Err(ErreurSite::Introuvable("VFS resource not found".into()));
    }
    let formats: Vec<_> = nie_explore::export::formats_pour(&path).into_iter().map(|format| {
        let reason = availability(&path, &format.id);
        let selection = if format.id == "wav" && path.to_ascii_lowercase().ends_with(".awb") {
            Some("waveformId")
        } else if format.id == "wav" && path.to_ascii_lowercase().ends_with(".usm") {
            Some("audioChannel")
        } else { None };
        json!({ "id": format.id, "extension": format.ext, "label": format.label,
            "raw": format.brut, "lossless": format.sans_perte, "available": reason.is_none(),
            "unavailableReason": reason, "requiredSelection": selection,
            "videoTrackOnly": path.to_ascii_lowercase().ends_with(".usm") && matches!(format.id.as_str(), "mp4" | "webm" | "h264" | "m2v"),
            "fileName": nie_explore::export::nom_propose(&path, &format.id) })
    }).collect();
    Ok(Json(
        json!({ "path": path, "formats": formats, "selectionBasis": "original-file-extension",
        "contentValidationRequired": true, "maximumSourceBytes": MAX_SOURCE_BYTES,
        "maximumOutputBytes": MAX_OUTPUT_BYTES }),
    ))
}

/// Produce a download in memory; conversion errors never return the original bytes as fallback.
pub async fn file(
    State(state): State<EtatSite>,
    Path(raw): Path<String>,
    Query(query): Query<ExportQuery>,
) -> Result<Response, ErreurSite> {
    let path = super::vfs::normaliser(&raw)?;
    let format = query.format.as_deref().unwrap_or("raw").to_owned();
    if !nie_explore::export::formats_pour(&path)
        .iter()
        .any(|candidate| candidate.id == format)
    {
        return Err(ErreurSite::Demande(
            "Unsupported export format for this resource".into(),
        ));
    }
    if let Some(reason) = availability(&path, &format) {
        return Err(ErreurSite::Demande(reason.into()));
    }
    let size = state
        .index()?
        .taille(&path)
        .ok_or_else(|| ErreurSite::Introuvable("VFS resource not found".into()))?;
    if size as usize > MAX_SOURCE_BYTES {
        return Err(ErreurSite::Demande(
            "Resource exceeds the bounded conversion size; original bytes remain on the VFS route"
                .into(),
        ));
    }
    let permit = Arc::clone(limiter())
        .try_acquire_owned()
        .map_err(|_| ErreurSite::Indisponible("Export capacity is busy".into()))?;
    let filename = nie_explore::export::nom_propose(&path, &format);
    let vfs = state.vfs()?;
    let output = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let bytes = vfs.read(&path).map_err(|error| error.to_string())?;
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err("Source exceeds conversion budget".to_owned());
        }
        let lower = path.to_ascii_lowercase();
        let output = if format == "wav" && lower.ends_with(".awb") {
            let id = query.waveform_id.ok_or("An exact waveformId is required")?;
            nie_explore::native_audio::cue_to_wav(&bytes, id)?
        } else if format == "wav" && lower.ends_with(".usm") {
            let channel = query
                .audio_channel
                .ok_or("An exact audioChannel is required")?;
            nie_explore::native_video::audio_track(&path, &bytes, channel)?
        } else if matches!(format.as_str(), "mp4" | "webm") && lower.ends_with(".usm") {
            let metadata: serde_json::Value =
                serde_json::from_str(&nie_explore::native_video::metadata(&path, &bytes)?)
                    .map_err(|error| error.to_string())?;
            let expected = if format == "mp4" {
                "video/mp4"
            } else {
                "video/webm"
            };
            if metadata["video"]["webMime"].as_str() != Some(expected) {
                return Err("Requested container does not match the native video codec".to_owned());
            }
            nie_explore::native_video::video_track(&path, &bytes)?
        } else {
            nie_explore::export::produire(&path, bytes, &format)?
        };
        if output.is_empty() || output.len() > MAX_OUTPUT_BYTES {
            return Err("Export output exceeds its size budget or is empty".to_owned());
        }
        Ok::<_, String>(output)
    })
    .await?
    .map_err(|error| {
        tracing::debug!(%error, "native export unavailable");
        ErreurSite::Demande("Native conversion unavailable for this resource or selection".into())
    })?;
    // The shared owner chooses the filename; header quoting removes control characters.
    let safe_name: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let disposition = HeaderValue::from_str(&format!("attachment; filename=\"{safe_name}\""))
        .map_err(|_| ErreurSite::Interne("Invalid export filename".into()))?;
    let mut response = output.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, disposition);
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
