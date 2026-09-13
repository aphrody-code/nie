//! Dump every bone's LOCAL and WORLD bind pose side by side, with its parent.
//!
//! ## Why both
//!
//! A bone that sits off-screen in world space is not necessarily misplaced: a menu parks what it
//! does not show yet outside the frame, and the offset lives in its ANCESTORS. Measured on
//! `vroad01_71_vroad_tournament_notice`, the chain `_pos_base01` -> `_pos_slide01` ->
//! `_pos_offset01` adds exactly one screen width (1920) at each step, so its plates rest at
//! x = 7 054 in a space that ends at 960. Only the two columns together say that.
//!
//! It also shows why composing a world pose THROUGH a geometry bone explodes: a geometry bone
//! stores its region's SIZE in `scale`, so a child of `_text_title01` (scale 720) lands at
//! x = 1 046 163. A single world column reads as corrupt data; both columns name the cause.
//!
//! ```sh
//! niers vfs extract data/common/menu/75_vroad/vroad01/vroad01_71/vroad01_71.g4pkm --out /tmp/x
//! cargo run -p nie-formats --example dump_local_world -- /tmp/x
//! ```

use nie_formats::g4pkm;

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: dump_local_world <file.g4pkm>");
        std::process::exit(2);
    };
    let data = std::fs::read(&path).expect("lecture g4pkm");
    let layout = g4pkm::parse(&data).expect("layout g4pkm");
    println!(
        "{:<30} {:>4} | {:>9} {:>9} {:>7} {:>7} | {:>9} {:>9} {:>7} {:>7}",
        "os", "pere", "loc.x", "loc.y", "loc.sx", "loc.sy", "mnd.x", "mnd.y", "mnd.sx", "mnd.sy"
    );
    for (index, bone) in layout.bones.iter().enumerate() {
        let (local, world) = (bone.local_bind_pose, bone.world_bind_pose);
        println!(
            "{:<30} {:>4} | {:>9.1} {:>9.1} {:>7.3} {:>7.3} | {:>9.1} {:>9.1} {:>7.3} {:>7.3}",
            format!("{index}:{}", bone.name),
            bone.parent_index,
            local.x,
            local.y,
            local.scale_x,
            local.scale_y,
            world.x,
            world.y,
            world.scale_x,
            world.scale_y,
        );
    }
}
