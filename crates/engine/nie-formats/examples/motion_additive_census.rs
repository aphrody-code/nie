//! Recense les clips squelettiques ADDITIFS sous un préfixe du VFS.
//!
//! Raison d'être : [`crate::g4mt::Motion::sample_local_trs`] REFUSE un clip additif (il exige une
//! pose de base qu'il n'a pas). Toute chaîne de déformation bâtie dessus rend donc `None` sur un
//! corpus additif — silencieusement, du point de vue du compilateur. Cette mesure dit avant
//! d'écrire la chaîne si le corpus visé est exploitable, et à quelle proportion.
//!
//! ```sh
//! cargo run -p nie-formats --release --example motion_additive_census -- common/chr/_waza/
//! ```

use nie_formats::vfs::Vfs;

fn main() {
    let prefixe = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage : motion_additive_census <prefixe/vfs/> [limite]");
        std::process::exit(2);
    });
    let limite: usize = std::env::args()
        .nth(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(usize::MAX);

    let racine = nie_formats::vfs::resolve_game_dir();
    let mut vfs = Vfs::new();
    vfs.init(racine.join("data")).expect("init VFS");

    // Collecté d'abord : `vfs.read` emprunte `vfs`, et l'itérateur le tient déjà.
    let paquets: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p)
        .filter(|p| p.starts_with(&prefixe) && p.to_ascii_lowercase().ends_with(".g4pk"))
        .take(limite)
        .map(str::to_owned)
        .collect();

    let (mut clips, mut additifs, mut paquets_lus, mut illisibles) = (0u64, 0u64, 0u64, 0u64);
    let mut exemples: Vec<String> = Vec::new();

    for chemin in &paquets {
        let Ok(octets) = vfs.read(chemin) else {
            illisibles += 1;
            continue;
        };
        let Ok(pack) = nie_formats::g4pk::parse(&octets) else {
            illisibles += 1;
            continue;
        };
        paquets_lus += 1;
        for fichier in pack.files.iter().filter(|f| f.name.ends_with(".g4mt")) {
            let Some(data) = octets.get(fichier.offset..fichier.offset + fichier.size) else {
                continue;
            };
            let Some(motion) = nie_formats::g4mt::Motion::parse(data) else {
                continue;
            };
            for clip in &motion.clips {
                clips += 1;
                if clip.is_additive() {
                    additifs += 1;
                    if exemples.len() < 5 {
                        exemples.push(format!("{chemin}#{}:{}", fichier.name, clip.name));
                    }
                }
            }
        }
    }

    println!("prefixe        {prefixe}");
    println!(
        "paquets .g4pk  {} vus, {paquets_lus} lus, {illisibles} illisibles",
        paquets.len()
    );
    println!("clips          {clips}");
    println!(
        "ADDITIFS       {additifs} ({:.2} %)",
        if clips == 0 {
            0.0
        } else {
            additifs as f64 * 100.0 / clips as f64
        }
    );
    for e in &exemples {
        println!("  exemple additif : {e}");
    }
}
