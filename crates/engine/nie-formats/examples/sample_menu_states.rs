//! Sample every motion clip of a menu package on the bones it animates, at its first and last
//! frame, next to the bone's bind pose.
//!
//! Written to test one hypothesis before building on it: that a menu parks a widget off-stage in
//! its BIND pose (`_pos_base01` at x = 1920 on `vroad01_71`) and that a state's clip is what
//! brings it on screen. If the entry clip's last frame puts those bones back at x = 0, the rest
//! position of a widget is animation data the compositor has not been reading.
//!
//! ```sh
//! cargo run -p nie-formats --example sample_menu_states -- /tmp/g4x/vroad01_71.g4pkm
//! ```

use nie_formats::{cfgbin::crc32, g4mt, g4pk, g4pkm, g4ra, g4sk::LocalTrs};

const STATE_NAMES: &[&str] = &[
    "Default", "Open", "Deactive", "Focus", "Active", "in", "loop", "out", "title", "offset01",
    "plate01",
];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: sample_menu_states <file.g4pkm>")?;
    let bytes = std::fs::read(path)?;
    let layout = g4pkm::parse(&bytes)?;
    let names: Vec<&str> = layout.bones.iter().map(|b| b.name.as_str()).collect();
    let pack = g4pk::parse(&bytes)?;
    for file in &pack.files {
        println!("file\t{}\t{} B", file.name, file.size);
    }
    let sub = |extension: &str| {
        pack.files
            .iter()
            .find(|f| f.name.ends_with(extension))
            .and_then(|f| bytes.get(f.offset..f.offset + f.size))
    };
    let data = sub(".g4mt").ok_or("no .g4mt in the package")?;
    let motion = g4mt::Motion::parse(data).ok_or("unreadable motion")?;
    let targets = g4mt::resolve_targets(&motion.target_hashes, &names);
    println!(
        "targets\t{}\tresolved to bones\t{}",
        targets.len(),
        targets.iter().flatten().count()
    );

    let name_of = |hash: u32| -> String {
        STATE_NAMES
            .iter()
            .find(|n| crc32(n.as_bytes()) == hash)
            .map(|n| (*n).to_owned())
            .or_else(|| {
                motion
                    .clips
                    .iter()
                    .find(|c| c.crc32 == hash)
                    .map(|c| c.name.clone())
            })
            .or_else(|| {
                names
                    .iter()
                    .find(|n| crc32(n.as_bytes()) == hash)
                    .map(|n| format!("bone:{n}"))
            })
            .unwrap_or_else(|| format!("{hash:08x}"))
    };
    if let Some(ra) = sub(".g4ra") {
        match g4ra::parse(ra) {
            Ok(reference) => {
                let states: Vec<String> =
                    reference.state_hashes.iter().map(|h| name_of(*h)).collect();
                println!("g4ra states\t{states:?}");
                for binding in &reference.skeletal_bindings {
                    println!(
                        "g4ra skeletal\tgroup {}\trow {}\ttarget {}\tstate {}\tclip {}",
                        binding.group_index,
                        binding.row_index,
                        name_of(binding.target_hash),
                        name_of(binding.state_hash),
                        name_of(binding.clip_hash),
                    );
                }
            }
            Err(error) => println!("g4ra\tunreadable: {error}"),
        }
    }

    for clip in &motion.clips {
        println!(
            "clip\t{}\tframes {}..{}\tfps {}\tadditive {}",
            clip.name,
            clip.start_frame,
            clip.end_frame,
            clip.fps,
            clip.is_additive()
        );
        // Motion targets do not name bones on menu packages (0 of 8 resolve on `vroad01_71`):
        // the G4RA row names the bone, the clip carries the channels. So sample every target the
        // clip declares, from a zero rest, and read the channels' own values.
        for target in motion.target_indices(clip) {
            // A sentinel rest: a component still reading 12345 has no channel in this clip, so
            // the clip leaves the bind value alone there instead of writing zero.
            let rest = LocalTrs {
                scale: [12345.0; 3],
                quat: [0.0, 0.0, 0.0, 1.0],
                translation: [12345.0; 3],
            };
            let sample =
                |frame: u16| motion.sample_local_trs(data, clip, target, f32::from(frame), rest);
            let hash = motion
                .target_hashes
                .get(usize::from(target))
                .copied()
                .unwrap_or(0);
            match (sample(clip.start_frame), sample(clip.end_frame)) {
                (Some(first), Some(last)) => println!(
                    "  target {target} ({}) | first t {:?} s {:?} | last t {:?} s {:?}",
                    name_of(hash),
                    first.translation,
                    first.scale,
                    last.translation,
                    last.scale,
                ),
                _ => println!("  target {target} ({}) | not sampled", name_of(hash)),
            }
        }
    }
    Ok(())
}
