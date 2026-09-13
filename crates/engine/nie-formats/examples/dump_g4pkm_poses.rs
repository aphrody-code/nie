//! Dump every bone's world bind pose of a `.g4pkm`, optionally scored against a sprite size.
//!
//! ## Why this exists
//!
//! An object is placed by [`nie_formats::menu::place_on_canvas`], which keeps the placement pose
//! when it carries real geometry and otherwise looks for the leaf bone whose `world_bind_pose`
//! scale matches the sprite within ±30 % (`pick_best_pose`). When neither happens, the object has
//! no transform, and a screen whose objects are all unplaced composes to a fully transparent PNG
//! that answers 200 — measured over the five official modes: 42 screens of 51 draw, 9 do not, and
//! 8 of those 9 have every transform unresolved.
//!
//! This tool shows which bones exist and what they measure, so "no bone carries geometry" can be
//! told apart from "geometry is there and the matcher looked for the wrong size". On
//! `vroad01_71_vroad_tournament_notice` it showed the second: the bones measure 912×244, 912×196
//! and 84×84, which are EXACTLY the three regions of its atlas (`notice_base02`, `notice_base01`,
//! `icon_trophy01`), while the matcher was handed the atlas itself, 912×532.
//!
//! ```sh
//! niers vfs extract data/common/menu/75_vroad/vroad01/vroad01_71/vroad01_71.g4pkm --out /tmp/x
//! cargo run -p nie-formats --example dump_g4pkm_poses -- /tmp/x 912 532
//! ```

use nie_formats::g4pkm;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(path) = args.get(1) else {
        eprintln!("usage: dump_g4pkm_poses <file.g4pkm> [sprite_w sprite_h]");
        std::process::exit(2);
    };
    let data = std::fs::read(path).expect("lecture g4pkm");
    let layout = g4pkm::parse(&data).expect("layout g4pkm");
    let target: Option<(f32, f32)> = match (args.get(2), args.get(3)) {
        (Some(w), Some(h)) => Some((w.parse().expect("sprite_w"), h.parse().expect("sprite_h"))),
        _ => None,
    };
    println!("os={}", layout.bones.len());
    for (i, bone) in layout.bones.iter().enumerate() {
        let wp = bone.world_bind_pose;
        // Le ratio n'est imprimé que pour les os PORTEURS de géométrie : un locator identité
        // (scale ≤ 1) ne désigne aucune taille, et lui en calculer une invente un rapport.
        let note = match target {
            Some((tw, th)) if wp.scale_x > 1.0 && wp.scale_y > 1.0 => {
                format!("  ratio={:.3}x{:.3}", wp.scale_x / tw, wp.scale_y / th)
            }
            _ => String::new(),
        };
        let lp = bone.local_bind_pose;
        println!(
            "{i:3}: {:30} parent={:3} monde=({:9.2},{:<9.2}) local=({:8.2},{:<8.2}) scale={:8.2}x{:<8.2}{note}",
            bone.name, bone.parent_index, wp.x, wp.y, lp.x, lp.y, wp.scale_x, wp.scale_y
        );
    }
}
