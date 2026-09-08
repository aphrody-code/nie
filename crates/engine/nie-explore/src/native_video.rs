//! Shared original-file USM metadata, remux and explicit track export.
#[cfg(feature = "host")]
use std::collections::HashMap;

use nie_formats::usm::{self, CodecVideo};
#[cfg(feature = "host")]
use nie_formats::vfs::Vfs;
#[cfg(feature = "host")]
use serde::{Deserialize, Serialize};

/// Portable VFS description of one audio track attached to a native movie.
///
/// This is deliberately independent from desktop IPC metadata: the CLI, HTTP
/// service and desktop host all consume the same VFS-derived facts.
#[cfg(feature = "host")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovieAudioTrack {
    pub channel: u8,
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub byte_length: u32,
    /// `container` or the resolved external cue name.
    pub source: String,
}

/// Portable metadata for a movie file indexed by the game VFS.
#[cfg(feature = "host")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovieInfo {
    pub path: String,
    pub name: String,
    pub section: String,
    pub locale: Option<String>,
    pub byte_length: u32,
    pub codec: Option<String>,
    pub browser_playable: Option<bool>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_count: Option<u32>,
    pub frame_rate: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub audio_tracks: Vec<MovieAudioTrack>,
    pub decrypted: Option<bool>,
    pub original_name: Option<String>,
    pub background_music: Option<String>,
    pub subtitle_path: Option<String>,
}

/// A cheap VFS movie catalogue. Detailed fields are populated on demand by
/// [`movie_info`], so listing the cinema never demuxes every USM.
#[cfg(feature = "host")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovieCatalog {
    pub movies: Vec<MovieInfo>,
    pub sections: Vec<String>,
}

#[cfg(feature = "host")]
fn quick_movie(path: &str, byte_length: u32) -> MovieInfo {
    let name = usm::radical_de(path);
    MovieInfo {
        path: path.to_owned(),
        name: name.to_owned(),
        section: usm::rubrique_de(name),
        locale: usm::langue_de(name).map(str::to_owned),
        byte_length,
        codec: None,
        browser_playable: None,
        width: None,
        height: None,
        frame_count: None,
        frame_rate: None,
        duration_seconds: None,
        audio_tracks: Vec::new(),
        decrypted: None,
        original_name: None,
        background_music: None,
        subtitle_path: None,
    }
}

#[cfg(feature = "host")]
fn game_movie_links(vfs: &Vfs) -> HashMap<String, (Option<String>, Option<String>)> {
    let mut links = HashMap::new();
    for path in vfs.iter().map(|(path, _)| path.to_owned()).filter(|path| {
        path.contains("gamedata/movie/movie_playing_config")
            || path.contains("gamedata/event/event_movie_config")
    }) {
        let Ok(bytes) = vfs.read(&path) else { continue };
        let Some(root) = nie_formats::cfgbin::rdbn_to_iecode_json(&bytes) else {
            continue;
        };
        let Some(lists) = root.get("lists").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for values in lists
            .iter()
            .filter_map(|list| list.get("values").and_then(serde_json::Value::as_array))
        {
            for row in values {
                let Some(movie_path) = row.get("moviePath").and_then(serde_json::Value::as_str)
                else {
                    continue;
                };
                if !movie_path.ends_with(".usm") {
                    continue;
                }
                let music = row.get("bgmName").map(|value| {
                    value
                        .as_str()
                        .map_or_else(|| value.to_string(), str::to_owned)
                });
                let subtitles = row
                    .get("subtitleTextPath")
                    .and_then(serde_json::Value::as_str)
                    .filter(|path| !path.is_empty() && *path != "0xFFFFFFFF")
                    .map(str::to_owned);
                links
                    .entry(movie_path.to_owned())
                    .or_insert((music, subtitles));
            }
        }
    }
    links
}

#[cfg(feature = "host")]
fn populate_movie_info(movie: &mut MovieInfo, info: &usm::Apercu) {
    movie.codec = Some(info.codec.nom().to_owned());
    movie.browser_playable = Some(info.codec.lisible_par_navigateur());
    movie.width = Some(info.entete.largeur_affichee.max(info.entete.largeur));
    movie.height = Some(info.entete.hauteur_affichee.max(info.entete.hauteur));
    movie.frame_count = Some(info.images);
    movie.frame_rate = info.entete.images_par_seconde();
    movie.duration_seconds = info.duree();
    movie.decrypted = Some(info.dechiffre);
    movie.original_name = info.nom.clone();
    movie.audio_tracks = info
        .pistes
        .iter()
        .map(|track| MovieAudioTrack {
            channel: track.canal,
            codec: track.codec.nom().to_owned(),
            sample_rate: track.frequence,
            channels: track.canaux,
            byte_length: track.taille as u32,
            source: "container".to_owned(),
        })
        .collect();
}

#[cfg(feature = "host")]
fn populate_external_audio(movie: &mut MovieInfo, vfs: &Vfs) {
    if !movie.audio_tracks.is_empty() {
        return;
    }
    let Some(track) =
        crate::soundtrack::piste_de_film(vfs, &movie.name, movie.duration_seconds, None)
    else {
        return;
    };
    movie.audio_tracks.push(MovieAudioTrack {
        channel: 0,
        codec: track.codec,
        sample_rate: track.frequence,
        channels: track.canaux,
        byte_length: 0,
        source: track.cue,
    });
}

/// Lists game movies from the mounted VFS without reading their USM payloads.
#[cfg(feature = "host")]
pub fn movie_catalog(vfs: &Vfs) -> MovieCatalog {
    let mut entries: Vec<_> = vfs
        .iter()
        .filter(|(path, _)| path.starts_with("data/common/movie") && path.ends_with(".usm"))
        .map(|(path, entry)| (path.to_owned(), entry.file_size))
        .collect();
    entries.sort_unstable_by(|left, right| left.0.cmp(&right.0));
    let links = game_movie_links(vfs);
    let movies = entries
        .into_iter()
        .map(|(path, byte_length)| {
            let mut movie = quick_movie(&path, byte_length);
            if let Some((music, subtitles)) = links.get(path.strip_prefix("data/").unwrap_or(&path))
            {
                movie.background_music = music.clone();
                movie.subtitle_path = subtitles.clone();
            }
            movie
        })
        .collect::<Vec<_>>();
    let mut sections = movies
        .iter()
        .map(|movie| movie.section.clone())
        .collect::<Vec<_>>();
    sections.sort_unstable();
    sections.dedup();
    MovieCatalog { movies, sections }
}

/// Inspects one VFS movie and resolves its container or external audio track.
#[cfg(feature = "host")]
pub fn movie_info(vfs: &Vfs, path: &str) -> Result<MovieInfo, String> {
    let bytes = vfs.read(path).map_err(|error| error.to_string())?;
    let info =
        usm::inspecter(&bytes, usm::nom_fichier_de(path)).map_err(|error| error.to_string())?;
    let mut movie = quick_movie(path, bytes.len() as u32);
    populate_movie_info(&mut movie, &info);
    populate_external_audio(&mut movie, vfs);
    Ok(movie)
}

/// Remuxes a browser-supported USM video without re-encoding.
pub fn web_video_stream(
    bytes: &[u8],
    original_name: &str,
) -> Result<(&'static str, Vec<u8>), String> {
    let movie = usm::demuxer_nomme(bytes, usm::nom_fichier_de(original_name))
        .map_err(|error| error.to_string())?;
    if movie.images.is_empty() {
        return Err("USM contains no video stream".to_owned());
    }
    if !movie.codec.lisible_par_navigateur() {
        return Err(format!(
            "Native codec {} has no browser decoder",
            movie.codec.nom()
        ));
    }
    movie
        .en_conteneur_web()
        .map(|container| (container.mime, container.octets))
        .map_err(|error| error.to_string())
}

/// Decodes the USM container audio, or the matching game soundtrack cue, to WAV.
#[cfg(feature = "host")]
pub fn movie_audio_wav(
    vfs: &Vfs,
    cache_dir: &std::path::Path,
    path: &str,
    bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let movie =
        usm::demuxer_nomme(bytes, usm::nom_fichier_de(path)).map_err(|error| error.to_string())?;
    if let Some(track) = movie.pistes.first() {
        return nie_formats::cri_audio::decode_to_wav(&track.octets);
    }
    let track = crate::soundtrack::piste_de_film(vfs, usm::radical_de(path), movie.duree(), None)
        .ok_or_else(|| {
        format!(
            "{} has no container or external soundtrack",
            usm::radical_de(path)
        )
    })?;
    crate::soundtrack::wav_de_la_cue(vfs, cache_dir, track.awb_id)
}

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
        _ if info.entete.alpha != 0 => {
            Some("The native alpha track is not preserved by the web remuxer")
        }
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
    usm::demuxer_nomme(bytes, original_file_name(original_name)?).map_err(|error| error.to_string())
}

pub fn video_track(original_name: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let movie = demux(original_name, bytes)?;
    match movie.codec {
        CodecVideo::Mpeg2 => return Err(
            "MPEG-2 browser playback is unsupported; original elementary bytes remain available"
                .to_owned(),
        ),
        CodecVideo::Inconnu => {
            return Err("Cannot remux an unresolved native video codec".to_owned());
        }
        CodecVideo::H264 | CodecVideo::Vp9 => {}
    }
    if movie.entete.alpha != 0 {
        return Err("Cannot discard the native alpha track during web remuxing".to_owned());
    }
    // The shared method selects mp4::muxer_h264_avec or webm::muxer_vp9 and preserves
    // its native frame-rate/display-size decisions. No codec interpretation lives here.
    movie
        .en_conteneur_web()
        .map(|container| container.octets)
        .map_err(|error| error.to_string())
}

pub fn audio_track(original_name: &str, bytes: &[u8], channel: u8) -> Result<Vec<u8>, String> {
    let movie = demux(original_name, bytes)?;
    let track = movie
        .pistes
        .iter()
        .find(|track| track.canal == channel)
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
