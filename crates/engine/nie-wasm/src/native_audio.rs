//! Thin bindings for the shared native audio catalogue and exact waveform decoder.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

fn bank_json(bank: &str, bytes: &[u8]) -> Result<String, String> {
    let cues = nie_explore::native_audio::bank_cues(bank, bytes)?;
    serde_json::to_string(&serde_json::json!({ "bank": bank, "cues": cues }))
        .map_err(|error| error.to_string())
}

/// Inspect original ACB bytes without waveform conversion.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn audio_bank_json(bank: &str, bytes: &[u8]) -> Result<String, JsValue> {
    bank_json(bank, bytes).map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart using the same shared metadata implementation.
#[cfg(not(target_arch = "wasm32"))]
pub fn audio_bank_json(bank: &str, bytes: &[u8]) -> Result<String, String> {
    bank_json(bank, bytes)
}

/// Decode one exact AFS2 waveform ID from original AWB bytes.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn audio_cue_to_wav(bytes: &[u8], awb_id: u16) -> Result<Vec<u8>, JsValue> {
    nie_explore::native_audio::cue_to_wav(bytes, awb_id).map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart using the same shared waveform implementation.
#[cfg(not(target_arch = "wasm32"))]
pub fn audio_cue_to_wav(bytes: &[u8], awb_id: u16) -> Result<Vec<u8>, String> {
    nie_explore::native_audio::cue_to_wav(bytes, awb_id)
}

/// Decode a named cue from original ACB and, when streaming, external AWB bytes.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn audio_bank_cue_to_wav(
    acb_bytes: &[u8],
    external_awb_bytes: &[u8],
    cue_name: &str,
) -> Result<Vec<u8>, JsValue> {
    nie_explore::native_audio::bank_cue_to_wav(acb_bytes, external_awb_bytes, cue_name)
        .map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart with identical bank selection and waveform decoding.
#[cfg(not(target_arch = "wasm32"))]
pub fn audio_bank_cue_to_wav(
    acb_bytes: &[u8],
    external_awb_bytes: &[u8],
    cue_name: &str,
) -> Result<Vec<u8>, String> {
    nie_explore::native_audio::bank_cue_to_wav(acb_bytes, external_awb_bytes, cue_name)
}
