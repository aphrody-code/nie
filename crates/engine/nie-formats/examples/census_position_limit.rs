//! Census of the absolute position limit used by `ecarter_positions_aberrantes`.
//!
//! The filter was written against unfilled buffers (`FLT_MAX`, ±3.4e38) but states its
//! threshold as an absolute 100, which is an avatar's scale in metres. Map, effect, menu
//! and event geometry is authored in game units and legitimately reaches the thousands, so
//! the threshold silently empties those models. This example walks the VFS and reports, per
//! subtree, how many submeshes fall in each decade — the evidence the threshold must move on.
//!
//! Usage: `cargo run -p nie-formats --example census_position_limit`
//! (honours `NIE_GAME_DIR`; pass a subtree prefix to narrow the sweep).

use std::collections::BTreeMap;

use nie_formats::{g4md, g4mg, g4pk, vfs::Vfs};

/// Decade buckets: `<1e2`, `<1e3`, `<1e4`, `<1e5`, `<1e6`, and `>=1e6` or non-finite.
const LABELS: [&str; 6] = ["<1e2", "<1e3", "<1e4", "<1e5", "<1e6", ">=1e6"];

fn subtree(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').collect();
    parts.iter().take(3).copied().collect::<Vec<_>>().join("/")
}

fn main() {
    let filtre = std::env::args().nth(1).unwrap_or_default();
    let dir = std::env::var("NIE_GAME_DIR").expect("NIE_GAME_DIR");
    let mut vfs = Vfs::new();
    vfs.init(&dir).expect("monter le VFS");

    let modeles: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .filter(|p| p.ends_with(".g4mg") && p.contains(&filtre))
        .collect();
    eprintln!("{} g4mg", modeles.len());

    let mut par_arbre: BTreeMap<String, [usize; 6]> = BTreeMap::new();
    for g4mg_path in &modeles {
        let base = g4mg_path.trim_end_matches(".g4mg");
        let Ok(mg) = vfs.read(g4mg_path) else {
            continue;
        };
        let md_bytes = vfs.read(&format!("{base}.g4md")).ok().or_else(|| {
            let pkm = vfs.read(&format!("{base}.g4pkm")).ok()?;
            let pk = g4pk::parse(&pkm).ok()?;
            let f = pk.files.iter().find(|f| f.name.ends_with(".g4md"))?;
            pkm.get(f.offset..f.offset + f.size).map(<[u8]>::to_vec)
        });
        let Some(md_bytes) = md_bytes else { continue };
        let Ok(md) = g4md::parse(&md_bytes) else {
            continue;
        };
        let seaux = par_arbre.entry(subtree(g4mg_path)).or_default();
        for sg in g4mg::extract_geometry(&mg, &md) {
            let max = sg
                .positions
                .iter()
                .flat_map(|v| [v.x, v.y, v.z])
                .fold(0.0f32, |a, c| {
                    if c.is_finite() {
                        a.max(c.abs())
                    } else {
                        f32::INFINITY
                    }
                });
            let seau = match max {
                m if !m.is_finite() => 5,
                m if m < 1e2 => 0,
                m if m < 1e3 => 1,
                m if m < 1e4 => 2,
                m if m < 1e5 => 3,
                m if m < 1e6 => 4,
                _ => 5,
            };
            seaux[seau] += 1;
        }
    }

    println!(
        "{:<28}{}",
        "sous-arbre",
        LABELS.map(|l| format!("{l:>9}")).join("")
    );
    for (arbre, seaux) in &par_arbre {
        println!("{arbre:<28}{}", seaux.map(|n| format!("{n:>9}")).join(""));
    }
}
