//! Native motion clip inspection extracted from the desktop VFS adapter.
use nie_formats::vfs::Vfs;

#[derive(Debug, serde::Serialize)]
pub struct MotionClip {
    pub archive: String,
    pub motion_file: String,
    pub name: String,
    pub crc32: f64,
    pub start_frame: f64,
    pub end_frame: f64,
    pub frame_count: f64,
    pub fps: f64,
    pub additive: bool,
    pub target_count: f64,
}

#[derive(Debug, serde::Serialize)]
pub struct MotionClips {
    pub archives: Vec<String>,
    pub clips: Vec<MotionClip>,
    pub notice: Option<String>,
}

pub fn clips(vfs: &Vfs, path: &str) -> Result<MotionClips, String> {
        let (dir_prefix, base) = path.rsplit_once('/').map_or(("", path), |(dir, base)| (&path[..dir.len() + 1], base));
        let stem = base.rsplit_once('.').map_or(base, |(stem, _)| stem);

        let archives: Vec<String> = if base.to_ascii_lowercase().ends_with(".g4pk") {
            vec![path.to_owned()]
        } else {
            let mut hits: Vec<String> = vfs
                .iter()
                .filter_map(|(p, _)| p.strip_prefix(dir_prefix).map(|rest| (p, rest)))
                .filter(|(_, rest)| !rest.contains('/'))
                .filter(|(_, rest)| {
                    let lower = rest.to_ascii_lowercase();
                    let Some(name) = lower.strip_suffix(".g4pk") else {
                        return false;
                    };
                    let stem_lower = stem.to_ascii_lowercase();
                    name == stem_lower
                        || name
                            .strip_prefix(&stem_lower)
                            .is_some_and(|s| s.starts_with('_'))
                })
                .map(|(p, _)| p.to_string())
                .collect();
            hits.sort();
            hits
        };

        if archives.is_empty() {
            return Ok(MotionClips {
                archives,
                clips: Vec::new(),
                notice: Some(format!("No native motion archive for {stem} in {dir_prefix}")),
            });
        }

        let mut clips = Vec::new();
        let mut skipped: Vec<String> = Vec::new();
        if archives.len() > 256 {
            return Err("Motion archive family exceeds inspection count limit".into());
        }
        let mut remaining_bytes = 128_u64 * 1024 * 1024;
        for archive in &archives {
            let size = vfs.find(archive).map(|entry| u64::from(entry.file_size));
            let Some(size) = size.filter(|size| *size <= remaining_bytes && *size <= 32 * 1024 * 1024) else {
                skipped.push(format!("{archive} (missing or exceeds inspection byte budget)"));
                continue;
            };
            remaining_bytes -= size;
            let data = match vfs.read(archive) {
                Ok(d) => d,
                Err(_) => {
                    skipped.push(format!("{archive} (resource read failed)"));
                    continue;
                }
            };
            if data.len() as u64 > size {
                skipped.push(format!("{archive} (resource exceeds indexed size)"));
                continue;
            }
            let pk = match nie_formats::g4pk::parse(&data) {
                Ok(pk) => pk,
                Err(_) => {
                    skipped.push(format!("{archive} (invalid G4PK)"));
                    continue;
                }
            };
            let mut found_motion = false;
            for file in pk
                .files
                .iter()
                .filter(|f| f.name.to_ascii_lowercase().ends_with(".g4mt"))
            {
                found_motion = true;
                let Some(bytes) = file.offset.checked_add(file.size).and_then(|end| data.get(file.offset..end)) else {
                    skipped.push(format!("{archive}/{} (entry outside archive)", file.name));
                    continue;
                };
                let Some(motion) = nie_formats::g4mt::Motion::parse(bytes) else {
                    skipped.push(format!("{archive}/{} (invalid G4MT)", file.name));
                    continue;
                };
                for clip in &motion.clips {
                    if clips.len() >= 65_536 {
                        return Err("Motion clip count exceeds inspection limit".into());
                    }
                    clips.push(MotionClip {
                        archive: archive.clone(),
                        motion_file: file.name.clone(),
                        name: clip.name.clone(),
                        crc32: f64::from(clip.crc32),
                        start_frame: f64::from(clip.start_frame),
                        end_frame: f64::from(clip.end_frame),
                        frame_count: f64::from(clip.frame_count()),
                        fps: f64::from(clip.fps),
                        additive: clip.is_additive(),
                        target_count: f64::from(u32::try_from(motion.target_indices(clip).len()).map_err(|_| "Motion target count exceeds supported range")?),
                    });
                }
            }
            if !found_motion {
                skipped.push(format!("{archive} (no G4MT entry)"));
            }
        }

        let notice = if skipped.is_empty() {
            None
        } else if clips.is_empty() {
            Some(format!("No readable clip: {}", skipped.join(" ; ")))
        } else {
            Some(format!(
                "{} archive(s) skipped: {}",
                skipped.len(),
                skipped.join(" ; ")
            ))
        };
        Ok(MotionClips {
            archives,
            clips,
            notice,
        })
}
