//! Validation du décodage d'animation G4MT contre un vrai fichier (extrait d'un g4pk).
//! Usage : `cargo run -p nie-formats --example validate_g4mt -- <fichier.g4pk>`

use nie_formats::{g4mt, g4pk};

fn main() {
    let path = std::env::args().nth(1).expect("usage: validate_g4mt <fichier.g4pk>");
    let data = std::fs::read(&path).expect("lire");
    // Extrait le premier sous-fichier .g4mt de l'archive g4pk.
    let pk = g4pk::parse(&data).expect("parse g4pk");
    let f = pk.files.iter().find(|f| f.name.ends_with(".g4mt")).expect("pas de g4mt");
    let g4mt_data = &data[f.offset..f.offset + f.size];

    let anim = g4mt::parse_animation(g4mt_data).expect("parse_animation");
    println!("clip={:?} frames={} tracks={} canaux={}", anim.clip_name, anim.frame_count, anim.bone_indices.len(), anim.channels.len());

    let rot: Vec<_> = anim.channels.iter().filter(|c| c.is_rotation()).collect();
    let sca: Vec<_> = anim.channels.iter().filter(|c| !c.is_rotation()).collect();
    println!("canaux rotation (4-vec stride8)={} scalaires={}", rot.len(), sca.len());

    // Validation : les samples de rotation doivent être des quaternions UNITAIRES (|q|≈1).
    let mut unit = 0usize;
    let mut nonunit = 0usize;
    let mut worst = 0.0f32;
    for c in &rot {
        for s in &c.samples {
            let n = (s[0] * s[0] + s[1] * s[1] + s[2] * s[2] + s[3] * s[3]).sqrt();
            if (n - 1.0).abs() < 0.01 {
                unit += 1;
            } else {
                nonunit += 1;
                worst = worst.max((n - 1.0).abs());
            }
        }
    }
    println!("samples rotation : unitaires={unit} non-unitaires={nonunit} (1 canal 0902 non-unitaire attendu)");
    println!("nb samples/canal : {}", rot.first().map_or(0, |c| c.samples.len()));

    let ok = anim.frame_count == 60 && rot.len() >= 15 && unit > nonunit * 10;
    println!("{}", if ok { "VALIDÉ ✓" } else { "ÉCHEC ✗" });
    if !ok {
        std::process::exit(1);
    }
}
