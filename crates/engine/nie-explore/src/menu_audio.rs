//! Startup audio metadata from the game's ACB banks. No UI-event aliases are inferred.

pub use crate::native_audio::AudioCue;
use crate::native_audio::bank_cues;
use serde::Serialize;

/// Native bank containing the title music.
pub const TITLE_BANK: &str = "data/common/sound_asset/bgm_title.acb";
/// Native bank containing shared system sounds.
pub const SYSTEM_BANK: &str = "data/common/sound_asset/common.acb";
/// Native cue name for title music, independent of its AWB entry identifier.
pub const TITLE_CUE: &str = "bg00010";

const MAX_BANK_BYTES: usize = 8 * 1024 * 1024;

const COMMAND_OBJECTS: [&str; 4] = [
    "data/common/gamedata/menu/obj/title00_04_gamestart.objbin",
    "data/common/gamedata/menu/obj/title00_07_item_button.objbin",
    "data/common/gamedata/menu/obj/title02_11_avatar_banner.objbin",
    "data/common/gamedata/menu/obj/title02_10_my_team_banner.objbin",
];

/// Exact native object command resolved through a cue-name CRC, without semantic aliases.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCommand {
    pub object_path: String,
    pub command: String,
    pub bank: String,
    pub cue_name: String,
}

/// Shared startup catalogue. System cues retain their names without guessed event mappings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupAudio {
    pub schema_version: u32,
    pub title: AudioCue,
    pub system: Vec<AudioCue>,
    pub commands: Vec<AudioCommand>,
    pub unresolved: Vec<String>,
}

/// Decode metadata only; waveform banks are not loaded or decoded during catalogue creation.
/// Missing, duplicate or unresolvable title cues fail instead of selecting a different sound.
pub fn from_banks(title_acb: &[u8], system_acb: &[u8]) -> Result<StartupAudio, String> {
    let mut candidates = bank_cues(TITLE_BANK, title_acb)?
        .into_iter()
        .filter(|cue| cue.name == TITLE_CUE);
    let title = candidates.next().ok_or("Native title cue missing")?;
    if candidates.next().is_some() || title.awb_id.is_none() {
        return Err("Native title cue is ambiguous or has no resolved waveform".into());
    }
    let system = bank_cues(SYSTEM_BANK, system_acb)?;
    Ok(StartupAudio {
        schema_version: 1,
        title,
        system,
        commands: Vec::new(),
        unresolved: vec![
            "Object SoundCmd bindings require original native object bytes; cancellation and unlisted object commands remain unresolved.".into(),
            "Loop sample boundaries require waveform headers; ADX loop points and screen-to-music transition timing remain unresolved.".into(),
        ],
    })
}

/// Resolve only unambiguous native SoundCmd hashes from the supplied original object.
pub fn add_object_commands(
    manifest: &mut StartupAudio,
    object_path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let object = nie_formats::objbin::parse(bytes).map_err(|error| error.to_string())?;
    for component in object.components {
        let nie_formats::objbin::MenuComponent::SoundCmd(sound) = component else {
            continue;
        };
        for entry in sound.entries {
            let hash = u32::from_ne_bytes(entry.param.to_ne_bytes());
            let matches: Vec<_> = manifest.system.iter().filter(|cue| {
                nie_formats::cfgbin::crc32(cue.name.as_bytes()) == hash
            }).collect();
            if let [cue] = matches.as_slice() {
                if cue.awb_id.is_some() {
                    manifest.commands.push(AudioCommand {
                        object_path: object_path.to_owned(),
                        command: entry.command,
                        bank: cue.bank.clone(),
                        cue_name: cue.name.clone(),
                    });
                    continue;
                }
            }
            manifest.unresolved.push(format!(
                "Unresolved native SoundCmd: {object_path} {} parameter {hash}", entry.command
            ));
        }
    }
    Ok(())
}

/// Read the two native metadata banks with an indexed size bound before allocating their bytes.
pub fn startup(vfs: &nie_formats::vfs::Vfs) -> Result<StartupAudio, String> {
    let read = |path: &str| {
        let entry = vfs
            .find(path)
            .ok_or_else(|| format!("Startup audio bank unavailable: {path}"))?;
        if u64::from(entry.file_size) > MAX_BANK_BYTES as u64 {
            return Err(format!("Startup audio bank exceeds size limit: {path}"));
        }
        let bytes = vfs.read(path).map_err(|error| format!("{path}: {error}"))?;
        if bytes.len() > MAX_BANK_BYTES {
            return Err(format!("Startup audio bank exceeds size limit: {path}"));
        }
        Ok(bytes)
    };
    let title_bytes = read(TITLE_BANK)?;
    let system_bytes = read(SYSTEM_BANK)?;
    let mut manifest = from_banks(&title_bytes, &system_bytes)?;
    for (bank, bytes) in [(TITLE_BANK, &title_bytes), (SYSTEM_BANK, &system_bytes)] {
        let acb = nie_formats::cri_audio::acb_parse(bytes).map_err(|error| error.to_string())?;
        let embedded = if acb.embedded_awb.is_empty() {
            None
        } else {
            Some(nie_formats::cri_audio::Awb::parse(&acb.embedded_awb)
                .map_err(|error| error.to_string())?)
        };
        for cue in std::iter::once(&manifest.title).chain(manifest.system.iter()) {
            if cue.bank == bank && !cue.streaming
                && let Some(id) = cue.awb_id
                && embedded.as_ref().and_then(|awb| awb.index_of_id(id)).is_none()
            {
                return Err(format!("Native embedded waveform unavailable: {bank} {id}"));
            }
        }
    }
    // Streaming cues must address the external waveform bank even when the ACB also
    // embeds an AWB whose identifiers overlap. Preserve original resource paths.
    for cue in std::iter::once(&manifest.title).chain(manifest.system.iter()) {
        if cue.awb_id.is_some()
            && cue.streaming
            && (vfs.find(&cue.waveform_bank).is_none() || !vfs.is_readable(&cue.waveform_bank))
        {
            return Err(format!("Native waveform bank unavailable: {}", cue.waveform_bank));
        }
    }
    for path in COMMAND_OBJECTS {
        add_object_commands(&mut manifest, path, &read(path)?)?;
    }
    if manifest.title.looped {
        let waveform = if manifest.title.streaming {
            read(&manifest.title.waveform_bank)?
        } else {
            nie_formats::cri_audio::acb_parse(&title_bytes)
                .map_err(|error| error.to_string())?.embedded_awb
        };
        let id = manifest.title.awb_id.ok_or("Native title waveform is unresolved")?;
        manifest.title.loop_points = crate::native_audio::cue_loop_points(&waveform, id)?;
        if manifest.title.loop_points.is_none() {
            manifest.unresolved.push("Title music loop points are unavailable in the native waveform header.".into());
        }
    }
    Ok(manifest)
}
