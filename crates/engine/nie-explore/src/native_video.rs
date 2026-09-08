//! Shared original-file USM metadata, remux and explicit track export.
use nie_formats::usm::{self, CodecVideo};

fn original_file_name(original_name: &str) -> Result<&str, String> {
    let name = usm::nom_fichier_de(original_name);
    if name.is_empty() {
        return Err("The original USM filename is required for native decryption".to_owned());
    }
    Ok(name)
}

pub fn metadata(original_name: &str, bytes: &[u8]) -> Result<String, String> {
    let name = original_file_name(original_name)?;
    let info = usm::inspecter(bytes, name).map_err(|error| error.to_string())?;
    let audio_tracks: Vec<_> = info
        .pistes
        .iter()
        .map(|track| {
            serde_json::json!({
                "channel": track.canal,
                "codec": track.codec.nom(),
                "sampleRate": track.frequence,
                "channels": track.canaux,
                "sampleCount": track.echantillons,
                "byteLength": track.taille,
                "durationSeconds": (track.frequence > 0).then(||
                    f64::from(track.echantillons) / f64::from(track.frequence)),
                "startOffsetSeconds": null,
            })
        })
        .collect();
    let unsupported = match info.codec {
        CodecVideo::Mpeg2 => Some("MPEG-2 has no portable browser decoder in this binding"),
        CodecVideo::Inconnu => Some("The native video codec is unresolved"),
        _ if info.entete.alpha != 0 => Some("The native alpha track is not preserved by the web remuxer"),
        _ => None,
    };
    serde_json::to_string(&serde_json::json!({
        "schemaVersion": 1,
        "originalName": original_name,
        "fileName": name,
        "containerName": info.nom,
        "sourceByteLength": bytes.len(),
        "decrypted": info.dechiffre,
        "video": {
            "codec": info.codec.nom(),
            "nativeCodecId": info.entete.mpeg_codec,
            "byteLength": info.octets_video,
            "frameCount": info.images,
            "declaredFrameCount": info.entete.total_images,
            "codedWidth": info.entete.largeur,
            "codedHeight": info.entete.hauteur,
            "displayWidth": info.entete.largeur_affichee,
            "displayHeight": info.entete.hauteur_affichee,
            "frameRateNumerator": info.entete.cadence_num,
            "frameRateDenominator": info.entete.cadence_den,
            "durationSeconds": info.duree(),
            "nativeAlphaType": info.entete.alpha,
            "elementaryExtension": info.codec.extension(),
            "webMime": info.codec.type_mime_web(),
            "webRemuxSupported": unsupported.is_none(),
            "unsupportedReason": unsupported,
        },
        "audioTracks": audio_tracks,
        "playback": {
            "webOutputContainsAudio": false,
            "separateAudioRequired": !info.pistes.is_empty(),
            "externalSoundtrackResolved": false,
            "perPacketTimestampsAvailable": false,
            "synchronizedPlaybackProvided": false,
            "timingSource": "Native declared frame rate and per-track sample counts; packet timestamps and audio start offsets are not exposed by the existing demuxer",
        },
    }))
    .map_err(|error| error.to_string())
}

fn demux(original_name: &str, bytes: &[u8]) -> Result<usm::Usm, String> {
    usm::demuxer_nomme(bytes, original_file_name(original_name)?)
        .map_err(|error| error.to_string())
}

pub fn video_track(original_name: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let movie = demux(original_name, bytes)?;
    match movie.codec {
        CodecVideo::Mpeg2 => return Err("MPEG-2 browser playback is unsupported; original elementary bytes remain available".to_owned()),
        CodecVideo::Inconnu => return Err("Cannot remux an unresolved native video codec".to_owned()),
        CodecVideo::H264 | CodecVideo::Vp9 => {}
    }
    if movie.entete.alpha != 0 {
        return Err("Cannot discard the native alpha track during web remuxing".to_owned());
    }
    // The shared method selects mp4::muxer_h264_avec or webm::muxer_vp9 and preserves
    // its native frame-rate/display-size decisions. No codec interpretation lives here.
    movie.en_conteneur_web().map(|container| container.octets)
        .map_err(|error| error.to_string())
}

pub fn audio_track(original_name: &str, bytes: &[u8], channel: u8) -> Result<Vec<u8>, String> {
    let movie = demux(original_name, bytes)?;
    let track = movie.pistes.iter().find(|track| track.canal == channel)
        .ok_or_else(|| format!("USM audio channel {channel} is absent"))?;
    // Exact channel selection: absence/unsupported audio never selects another soundtrack.
    nie_formats::cri_audio::decode_to_wav(&track.octets)
}

pub fn elementary_video(original_name: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let movie = demux(original_name, bytes)?;
    if movie.images.is_empty() {
        return Err("USM contains no elementary video frames".to_owned());
    }
    Ok(movie.flux_brut())
}

