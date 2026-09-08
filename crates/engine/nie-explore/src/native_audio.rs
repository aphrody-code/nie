//! Portable native ACB metadata and exact AFS2 waveform playback.
use nie_formats::cri_audio::{self, AcbCue};
use serde::Serialize;

const MAX_BANK_BYTES: usize = 8 * 1024 * 1024;
const MAX_CUES: usize = 4096;

/// One cue's actual ACB metadata. `awbId` is the playback identifier, not `cueId`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCue {
    pub bank: String,
    pub waveform_bank: String,
    pub name: String,
    pub cue_id: u32,
    pub cue_index: u16,
    pub awb_id: Option<u16>,
    #[serde(rename = "loop")]
    pub looped: bool,
    pub streaming: bool,
    pub length_ms: u32,
    pub encode_type: Option<u8>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub num_samples: Option<u32>,
    /// Present only after inspecting the selected native waveform header.
    pub loop_points: Option<cri_audio::AudioLoopPoints>,
}

impl AudioCue {
    fn from_native(bank: &str, cue: AcbCue) -> Result<Self, String> {
        let waveform_bank = if cue.streaming {
            let stem = bank
                .strip_suffix(".acb")
                .ok_or("Streaming ACB requires its original .acb path")?;
            format!("{stem}.awb")
        } else {
            bank.to_owned()
        };
        Ok(Self {
            bank: bank.to_owned(),
            waveform_bank,
            name: cue.name,
            cue_id: cue.cue_id,
            cue_index: cue.cue_index,
            awb_id: cue.awb_id,
            looped: cue.looped,
            streaming: cue.streaming,
            length_ms: cue.length_ms,
            encode_type: cue.encode_type,
            sample_rate: cue.sample_rate,
            channels: cue.channels,
            num_samples: cue.num_samples,
            loop_points: None,
        })
    }
}

/// Read native cue metadata without selecting or converting any waveform.
pub fn bank_cues(bank: &str, bytes: &[u8]) -> Result<Vec<AudioCue>, String> {
    if bytes.is_empty() || bytes.len() > MAX_BANK_BYTES {
        return Err(format!("Invalid audio bank size: {bank}"));
    }
    let cues = cri_audio::acb_cues(bytes).map_err(|error| format!("{bank}: {error}"))?;
    if cues.is_empty() || cues.len() > MAX_CUES {
        return Err(format!("Invalid audio cue count: {bank}"));
    }
    cues.into_iter()
        .map(|cue| AudioCue::from_native(bank, cue))
        .collect()
}

/// Decode exactly the requested AFS2 waveform ID, never a neighboring entry.
/// Codec decoding and archive encryption subkeys remain owned by `nie-formats`.
pub fn cue_to_wav(bytes: &[u8], awb_id: u16) -> Result<Vec<u8>, String> {
    let awb = cri_audio::Awb::parse(bytes).map_err(|error| error.to_string())?;
    let index = awb
        .index_of_id(awb_id)
        .ok_or("Waveform ID is absent from the AWB")?;
    if awb
        .entries
        .iter()
        .filter(|entry| entry.cue_id == u32::from(awb_id))
        .count()
        != 1
    {
        return Err("Waveform ID is ambiguous in the AWB".into());
    }
    let payload = awb.entry_bytes(bytes, &awb.entries[index]);
    // The legacy decoder skips empty selected payloads and searches neighboring entries.
    // Reject these before invoking it, preserving its public compatibility behavior.
    if !cri_audio::is_hca(payload) && !cri_audio::is_adx(payload) {
        return Err("Requested waveform is neither supported HCA nor ADX".into());
    }
    cri_audio::decode_awb_entry(bytes, Some(index))
}

/// Inspect one exact HCA waveform's loop header. Unsupported codecs remain unresolved.
pub fn cue_loop_points(
    bytes: &[u8],
    awb_id: u16,
) -> Result<Option<cri_audio::AudioLoopPoints>, String> {
    let awb = cri_audio::Awb::parse(bytes).map_err(|error| error.to_string())?;
    let mut entries = awb
        .entries
        .iter()
        .filter(|entry| entry.cue_id == u32::from(awb_id));
    let entry = entries.next().ok_or("Waveform ID is absent from the AWB")?;
    if entries.next().is_some() {
        return Err("Waveform ID is ambiguous in the AWB".into());
    }
    let payload = awb.entry_bytes(bytes, entry);
    if cri_audio::is_hca(payload) {
        cri_audio::hca_loop_points(payload)
    } else {
        Ok(None)
    }
}

/// Play one exact named ACB cue using its native streaming/embedded selection.
/// External bytes must be supplied for streaming cues; an embedded bank cannot substitute.
pub fn bank_cue_to_wav(
    acb_bytes: &[u8],
    external_awb_bytes: &[u8],
    cue_name: &str,
) -> Result<Vec<u8>, String> {
    if acb_bytes.is_empty() || acb_bytes.len() > MAX_BANK_BYTES {
        return Err("Invalid audio bank size".into());
    }
    let cues = cri_audio::acb_cues(acb_bytes).map_err(|error| error.to_string())?;
    if cues.len() > MAX_CUES {
        return Err("Audio bank exceeds cue count limit".into());
    }
    let mut matching = cues.into_iter().filter(|cue| cue.name == cue_name);
    let cue = matching.next().ok_or("Named cue is absent from the ACB")?;
    if matching.next().is_some() {
        return Err("Named cue is ambiguous in the ACB".into());
    }
    let id = cue.awb_id.ok_or("Named cue has no resolved waveform ID")?;
    if cue.streaming {
        if external_awb_bytes.is_empty() {
            return Err("Streaming cue requires its external AWB bytes".into());
        }
        cue_to_wav(external_awb_bytes, id)
    } else {
        let bank = cri_audio::acb_parse(acb_bytes).map_err(|error| error.to_string())?;
        if bank.embedded_awb.is_empty() {
            return Err("Memory cue requires an embedded AWB".into());
        }
        cue_to_wav(&bank.embedded_awb, id)
    }
}
