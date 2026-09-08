//! Thin original-file USM bindings. Parsing, decryption, remuxing and audio decoding stay native.
//! Video-track output intentionally excludes audio; metadata exposes that split without claiming
//! synchronized movie playback. MPEG-2 remains inspectable/exportable, not mislabeled as MP4.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

use nie_explore::native_video::{audio_track, elementary_video, metadata, video_track};

/// Inspect original USM bytes without retaining full demuxed video frames.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn usm_metadata_json(original_name: &str, bytes: &[u8]) -> Result<String, JsValue> {
    metadata(original_name, bytes).map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart of the same metadata binding.
#[cfg(not(target_arch = "wasm32"))]
pub fn usm_metadata_json(original_name: &str, bytes: &[u8]) -> Result<String, String> {
    metadata(original_name, bytes)
}

/// Remux only the video track as its native codec's web container; inspect metadata for MIME
/// and use the explicit audio-track binding separately. This is not a silent movie substitute.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn usm_video_track_bytes(original_name: &str, bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    video_track(original_name, bytes).map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart of the same video-track binding.
#[cfg(not(target_arch = "wasm32"))]
pub fn usm_video_track_bytes(original_name: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    video_track(original_name, bytes)
}

/// Decode one explicit native USM audio channel to WAV, without selecting a default track.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn usm_audio_track_wav(original_name: &str, bytes: &[u8], channel: u8) -> Result<Vec<u8>, JsValue> {
    audio_track(original_name, bytes, channel).map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart of the same audio-track binding.
#[cfg(not(target_arch = "wasm32"))]
pub fn usm_audio_track_wav(original_name: &str, bytes: &[u8], channel: u8) -> Result<Vec<u8>, String> {
    audio_track(original_name, bytes, channel)
}

/// Export the original elementary video stream, including MPEG-2, without transcoding.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn usm_elementary_video_bytes(original_name: &str, bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    elementary_video(original_name, bytes).map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart of the same elementary-stream binding.
#[cfg(not(target_arch = "wasm32"))]
pub fn usm_elementary_video_bytes(original_name: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    elementary_video(original_name, bytes)
}
