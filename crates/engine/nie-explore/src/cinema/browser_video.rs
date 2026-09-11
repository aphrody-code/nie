//! Browser video containers: portable remux where possible, bounded host encoding for MPEG-2.

use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use nie_formats::usm::{self, CodecVideo, Usm};

const MAX_USM_BYTES: usize = 512 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_777_216;
const MAX_FRAMES: usize = 36_000;
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
static ENCODER_SLOT: Mutex<()> = Mutex::new(());

/// A video-only browser container. Soundtrack decoding remains a separate library capability.
pub struct BrowserVideo {
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

struct EncoderOptions {
    executable: OsString,
    timeout: Duration,
    max_output_bytes: u64,
}

impl Default for EncoderOptions {
    fn default() -> Self {
        Self {
            executable: OsString::from("ffmpeg"),
            timeout: Duration::from_secs(120),
            max_output_bytes: 128 * 1024 * 1024,
        }
    }
}

/// Produce a browser container from the original USM bytes and original filename.
///
/// H.264 and VP9 use the existing lossless format muxers. MPEG-2 uses the installed FFmpeg
/// encoder with the frame rate declared by USM, unchanged pixel dimensions, and no scale filter.
/// MPEG-2 encoding permits one process at a time, two codec threads, 120 seconds, and 128 MiB of
/// output. Input and decoded dimensions are bounded before starting the process. No shell or
/// media URL is accepted by the encoder; temporary files are removed on every return path.
///
/// # Errors
///
/// Invalid USM data, missing frame-rate metadata, an occupied encoder, missing FFmpeg, excessive
/// resource use, or a failed encoder are reported explicitly. No placeholder video is generated.
pub fn browser_video_container(bytes: &[u8], filename: &str) -> Result<BrowserVideo, String> {
    if bytes.len() > MAX_USM_BYTES {
        return Err("USM exceeds the 512 MiB browser conversion limit".into());
    }
    let preview = usm::inspecter(bytes, filename).map_err(|error| error.to_string())?;
    let _encoder_slot = if preview.codec == CodecVideo::Mpeg2 {
        Some(
            ENCODER_SLOT
                .try_lock()
                .map_err(|_| "MPEG-2 encoder is busy; retry when the current film finishes")?,
        )
    } else {
        None
    };
    let video = usm::demuxer_nomme(bytes, filename).map_err(|error| error.to_string())?;
    if video.codec == CodecVideo::Mpeg2 {
        return transcode_mpeg2(&video, &EncoderOptions::default());
    }
    let container = video
        .en_conteneur_web()
        .map_err(|error| error.to_string())?;
    Ok(BrowserVideo {
        mime: container.mime,
        bytes: container.octets,
    })
}

fn transcode_mpeg2(video: &Usm, options: &EncoderOptions) -> Result<BrowserVideo, String> {
    if video.codec != CodecVideo::Mpeg2 || video.images.is_empty() {
        return Err("MPEG-2 encoding requires a non-empty MPEG-2 video track".into());
    }
    let (numerator, denominator) = video
        .cadence()
        .ok_or("MPEG-2 video has no declared frame rate")?;
    let pixels = u64::from(video.entete.largeur) * u64::from(video.entete.hauteur);
    if pixels == 0 || pixels > MAX_PIXELS || video.images.len() > MAX_FRAMES {
        return Err("MPEG-2 dimensions or frame count exceed the browser conversion limit".into());
    }
    let bytes = video.images.iter().try_fold(0_usize, |total, frame| {
        total
            .checked_add(frame.len())
            .filter(|size| *size <= MAX_USM_BYTES)
    });
    if bytes.is_none() {
        return Err("MPEG-2 track exceeds the browser conversion limit".into());
    }

    let temporary = TemporaryVideo::create()?;
    let input = temporary.path.join("input.m2v");
    let output = temporary.path.join("output.mp4");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&input)
        .map_err(|error| format!("Cannot create MPEG-2 input: {error}"))?;
    for frame in &video.images {
        file.write_all(frame)
            .map_err(|error| format!("Cannot write MPEG-2 input: {error}"))?;
    }
    drop(file);

    // Sofdec's elementary stream can be misdetected as MPEG-1 with the wrong frame rate.
    // Codec identity and cadence therefore come from VIDEO_HDRINFO, not FFmpeg heuristics.
    let mut command = Command::new(&options.executable);
    command
        .args(["-nostdin", "-hide_banner", "-loglevel", "error"])
        .args(["-max_alloc", "67108864", "-threads", "2"])
        .args(["-max_pixels", &MAX_PIXELS.to_string()])
        .args([
            "-protocol_whitelist",
            "file",
            "-f",
            "mpegvideo",
            "-c:v",
            "mpeg2video",
        ])
        .args(["-r", &format!("{numerator}/{denominator}"), "-i"])
        .arg(&input)
        .args(["-map", "0:v:0", "-an", "-c:v", "libx264", "-threads", "2"])
        .args(["-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p"])
        .args(["-fps_mode", "passthrough", "-movflags", "+faststart"])
        .args([
            "-fs",
            &options.max_output_bytes.saturating_add(1).to_string(),
        ])
        .args(["-f", "mp4", "-n"])
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    run_encoder(&mut command, &output, options)?;
    let bytes = read_bounded(&output, options.max_output_bytes)?;
    if bytes.len() < 32 || bytes.get(4..8) != Some(b"ftyp") {
        return Err("MPEG-2 encoder did not produce an MP4 container".into());
    }
    Ok(BrowserVideo {
        mime: "video/mp4",
        bytes,
    })
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(limit.saturating_add(1)).read_to_end(&mut bytes))
        .map_err(|error| format!("Cannot read encoded video: {error}"))?;
    if bytes.len() as u64 > limit {
        return Err("Encoded video exceeds the output size limit".into());
    }
    Ok(bytes)
}

fn run_encoder(
    command: &mut Command,
    output: &Path,
    options: &EncoderOptions,
) -> Result<(), String> {
    let mut process = EncoderProcess(
        command
            .spawn()
            .map_err(|error| format!("Cannot start MPEG-2 encoder: {error}"))?,
    );
    let start = Instant::now();
    loop {
        if fs::metadata(output).is_ok_and(|metadata| metadata.len() > options.max_output_bytes) {
            return Err("Encoded video exceeds the output size limit".into());
        }
        if let Some(status) = process
            .0
            .try_wait()
            .map_err(|error| format!("Cannot wait for MPEG-2 encoder: {error}"))?
        {
            return if status.success() {
                Ok(())
            } else {
                Err(format!("MPEG-2 encoder failed ({status})"))
            };
        }
        if start.elapsed() >= options.timeout {
            return Err("MPEG-2 encoder exceeded its time limit".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Kill and reap only the process started here, including timeout and failed-output paths.
struct EncoderProcess(Child);

impl Drop for EncoderProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct TemporaryVideo {
    path: PathBuf,
}

impl TemporaryVideo {
    fn create() -> Result<Self, String> {
        for _ in 0..32 {
            let id = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("nie-video-{}-{id}", std::process::id()));
            #[allow(unused_mut)]
            let mut directory = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                directory.mode(0o700);
            }
            match directory.create(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!("Cannot create video temporary directory: {error}"));
                }
            }
        }
        Err("Cannot reserve a video temporary directory".into())
    }
}

impl Drop for TemporaryVideo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nie_formats::usm::EnteteVideo;

    fn track() -> Usm {
        Usm {
            nom: None,
            entete: EnteteVideo {
                largeur: 16,
                hauteur: 16,
                cadence_num: 30,
                cadence_den: 1,
                ..EnteteVideo::default()
            },
            codec: CodecVideo::Mpeg2,
            images: vec![vec![0, 0, 1, 0xb3]],
            pistes: Vec::new(),
            sous_titres: Vec::new(),
            dechiffre: false,
            octets_video: 4,
            entetes: Vec::new(),
        }
    }

    #[test]
    fn rejects_missing_cadence_instead_of_guessing_a_frame_rate() {
        let mut video = track();
        video.entete.cadence_num = 0;
        let error = transcode_mpeg2(&video, &EncoderOptions::default())
            .err()
            .unwrap();
        assert!(error.contains("no declared frame rate"), "{error}");
    }

    #[test]
    fn rejects_empty_tracks_and_excessive_decoded_dimensions_before_starting_ffmpeg() {
        let mut video = track();
        video.images.clear();
        assert!(transcode_mpeg2(&video, &EncoderOptions::default()).is_err());
        let mut video = track();
        video.entete.largeur = u32::MAX;
        assert!(
            transcode_mpeg2(&video, &EncoderOptions::default())
                .err()
                .unwrap()
                .contains("dimensions")
        );
    }

    #[test]
    fn missing_encoder_is_an_error_and_temporary_files_are_scoped() {
        let options = EncoderOptions {
            executable: OsString::from("/missing/nie-video-test-encoder"),
            ..EncoderOptions::default()
        };
        assert!(
            transcode_mpeg2(&track(), &options)
                .err()
                .unwrap()
                .contains("Cannot start")
        );
        let temporary = TemporaryVideo::create().unwrap();
        let path = temporary.path.clone();
        fs::write(path.join("test"), b"test").unwrap();
        drop(temporary);
        assert!(!path.exists());
    }

    #[test]
    fn output_reader_never_accepts_more_than_its_byte_budget() {
        let temporary = TemporaryVideo::create().unwrap();
        let path = temporary.path.join("test");
        fs::write(&path, [0_u8; 32]).unwrap();
        assert!(read_bounded(&path, 31).is_err());
        assert_eq!(read_bounded(&path, 32).unwrap().len(), 32);
    }

    #[cfg(unix)]
    #[test]
    fn stalled_encoder_is_killed_and_reaped_within_its_deadline() {
        let temporary = TemporaryVideo::create().unwrap();
        let options = EncoderOptions {
            timeout: Duration::from_millis(30),
            ..EncoderOptions::default()
        };
        let mut command = Command::new("sleep");
        command
            .arg("10")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let start = Instant::now();
        let error =
            run_encoder(&mut command, &temporary.path.join("missing.mp4"), &options).unwrap_err();
        assert!(error.contains("time limit"), "{error}");
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn encoder_output_overflow_terminates_the_process() {
        let temporary = TemporaryVideo::create().unwrap();
        let output = temporary.path.join("oversize.mp4");
        fs::write(&output, [0_u8; 32]).unwrap();
        let options = EncoderOptions {
            max_output_bytes: 31,
            ..EncoderOptions::default()
        };
        let mut command = Command::new("sleep");
        command
            .arg("10")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let error = run_encoder(&mut command, &output, &options).unwrap_err();
        assert!(error.contains("output size limit"), "{error}");
    }

    #[test]
    #[ignore = "Requires the local game VFS, FFmpeg with libx264, and ffprobe"]
    fn native_opening_videos_keep_their_dimensions_frame_rate_and_frame_count() {
        let game_root =
            std::env::var_os("NIE_GAME_DIR").expect("Set NIE_GAME_DIR to the game root");
        let mut vfs = nie_formats::vfs::Vfs::new();
        vfs.init(Path::new(&game_root).join("data"))
            .expect("Mount the actual game VFS");
        let temporary = TemporaryVideo::create().unwrap();
        for filename in ["IE_15th.usm", "L5logo.usm"] {
            let bytes = vfs.read(&format!("data/common/movie/{filename}")).unwrap();
            let source = usm::inspecter(&bytes, filename).unwrap();
            assert_eq!(source.codec, CodecVideo::Mpeg2);
            let output = browser_video_container(&bytes, filename).unwrap();
            assert_eq!(output.mime, "video/mp4");
            let path = temporary.path.join(format!("{filename}.mp4"));
            fs::write(&path, &output.bytes).unwrap();
            let probe = Command::new("ffprobe")
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=codec_name,width,height,avg_frame_rate,nb_frames",
                    "-of",
                    "json",
                ])
                .arg(&path)
                .output()
                .unwrap();
            assert!(probe.status.success());
            let probe: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
            let video = &probe["streams"][0];
            assert_eq!(video["codec_name"], "h264");
            assert_eq!(video["width"], source.entete.largeur);
            assert_eq!(video["height"], source.entete.hauteur);
            assert_eq!(video["nb_frames"], source.images.to_string());
            let rate: Vec<u64> = video["avg_frame_rate"]
                .as_str()
                .unwrap()
                .split('/')
                .map(|part| part.parse().unwrap())
                .collect();
            let (numerator, denominator) = source.entete.cadence().unwrap();
            assert_eq!(
                rate[0] * u64::from(denominator),
                rate[1] * u64::from(numerator)
            );
            println!(
                "{filename}: {} bytes, {}x{}, {}/{} fps, {} frames",
                output.bytes.len(),
                source.entete.largeur,
                source.entete.hauteur,
                numerator,
                denominator,
                source.images
            );
        }
    }
}
