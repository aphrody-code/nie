//! Vérifie le barème G4CM sur le corpus entier : aller-retour byte-exact, bornes, invariants.
//!
//! C'est la mesure qui tranche la dernière réserve du dossier caméra. Le désassemblage établit
//! que l'octet 6 d'un canal indexe une table de `f32` pointée par `r15` (`movss xmm2, [r15+r8*4]`
//! @ `0x1405AAF3B`), mais `r15` est chargé EN AMONT de la boucle : rien dans cette fenêtre ne
//! prouve qu'il s'agit du bloc `params`. Deux invariants le décident sur les données :
//!
//!   1. Un canal déjà en `f32` n'a pas besoin d'être mis à l'échelle, donc son `scale_index`
//!      doit désigner une entrée valant exactement **1.0**. Si la table était ailleurs, il n'y
//!      aurait aucune raison pour que ces indices tombent sur des 1.0.
//!   2. La déquantification `u16/65535 × échelle` est bornée par construction : toute valeur
//!      décodée doit rester dans **±échelle**. Une table fausse ferait déborder.
//!
//! Un troisième invariant, sans rapport avec le barème, surveille l'**alignement de la section
//! des temps** : une table de keyframes est croissante par nature. C'est ce contrôle qui a
//! révélé que `decode` alignait cette section sur `align` (16 octets) au lieu de `align * 4`
//! (64), la plaçant jusqu'à 48 octets trop tôt. La panne était muette — le fichier ressortait
//! byte-exact, et seuls les `time_index` étaient décalés.
//!
//! ```sh
//! cargo run -p nie-formats --release --example g4cm_scale_census -- var/tmp/allcams
//! ```

use nie_formats::g4cm::{self, Quant, Track};

fn main() {
    let racine = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage : g4cm_scale_census <repertoire>");
        std::process::exit(2);
    });

    let mut fichiers = Vec::new();
    collecter(std::path::Path::new(&racine), &mut fichiers);
    fichiers.sort();

    let (mut lus, mut illisibles, mut byte_exact, mut divergents) = (0u32, 0u32, 0u32, 0u32);
    // Invariant 1 : les canaux f32 désignent-ils une échelle de 1.0 ?
    let (mut f32_total, mut f32_echelle_un, mut f32_hors_table) = (0u32, 0u32, 0u32);
    // Invariant 2 : la déquantification reste-t-elle dans ±échelle ?
    let (mut quant_total, mut quant_bornes, mut quant_deborde) = (0u32, 0u32, 0u32);
    // Ce qui n'est pas résolu, par (mode, taille).
    let mut inconnus: Vec<((u8, u8), u32)> = Vec::new();
    let mut sans_echelle = 0u32;
    // Invariant 3 : les tables de temps sont-elles croissantes ? C'est ce que l'alignement de
    // la section décide, et une table décroissante s'interpole en silence.
    let (mut temps_total, mut temps_croissants) = (0u32, 0u32);
    let mut exemples = Vec::new();

    for chemin in &fichiers {
        let Ok(octets) = std::fs::read(chemin) else {
            illisibles += 1;
            continue;
        };
        let Ok(anim) = g4cm::decode(&octets) else {
            illisibles += 1;
            continue;
        };
        lus += 1;

        // La porte non négociable : le barème ne doit RIEN changer au ré-encodage.
        match g4cm::encode(&anim) {
            Ok(re) if re == octets => byte_exact += 1,
            _ => {
                divergents += 1;
                if exemples.len() < 5 {
                    exemples.push(format!("ré-encodage divergent : {}", chemin.display()));
                }
            }
        }

        let echelles = anim.scales();
        for canal in &anim.channels {
            let t = canal.times(&anim);
            if t.len() > 1 {
                temps_total += 1;
                if t.windows(2).all(|w| w[0] <= w[1]) {
                    temps_croissants += 1;
                }
            }
            let echelle = echelles.get(canal.scale_index as usize).copied();
            match canal.quant() {
                Quant::Float32 => {
                    f32_total += 1;
                    match echelle {
                        Some(e) if e == 1.0 => f32_echelle_un += 1,
                        Some(_) => {}
                        None => f32_hors_table += 1,
                    }
                }
                Quant::Unorm16 | Quant::Snorm16 => {
                    quant_total += 1;
                    let Some(e) = echelle else {
                        sans_echelle += 1;
                        continue;
                    };
                    match canal.decoded(&anim) {
                        Some(v) => {
                            let borne = e.abs() * (1.0 + 1e-6);
                            if v.iter().all(|x| x.abs() <= borne) {
                                quant_bornes += 1;
                            } else {
                                quant_deborde += 1;
                                if exemples.len() < 5 {
                                    let pire =
                                        v.iter().fold(0.0f32, |a, x| if x.abs() > a { x.abs() } else { a });
                                    exemples.push(format!(
                                        "{} canal {} : |max|={pire} > échelle={e}",
                                        chemin.display(),
                                        canal.kind.label()
                                    ));
                                }
                            }
                        }
                        None => sans_echelle += 1,
                    }
                }
                Quant::Inconnu { mode, size } => {
                    match inconnus.iter_mut().find(|(k, _)| *k == (mode, size)) {
                        Some((_, n)) => *n += 1,
                        None => inconnus.push(((mode, size), 1)),
                    }
                }
            }
            // Un canal f32 doit porter un flux f32 : sinon le couple (mode, taille) ment.
            debug_assert!(
                !matches!(canal.quant(), Quant::Float32) || matches!(canal.track, Track::F32(_))
            );
        }
    }

    inconnus.sort();
    let pct = |a: u32, b: u32| if b == 0 { 0.0 } else { f64::from(a) * 100.0 / f64::from(b) };

    println!("fichiers          {} vus, {lus} décodés, {illisibles} illisibles", fichiers.len());
    println!("RÉ-ENCODAGE       {byte_exact}/{lus} byte-exact, {divergents} divergents");
    println!();
    println!("INVARIANT 1 — un canal f32 désigne une échelle de 1.0");
    println!(
        "  {f32_echelle_un}/{f32_total} ({:.2} %), {f32_hors_table} hors table",
        pct(f32_echelle_un, f32_total)
    );
    println!();
    println!("INVARIANT 2 — la déquantification reste dans ±échelle");
    println!(
        "  {quant_bornes}/{quant_total} ({:.2} %), {quant_deborde} débordent, {sans_echelle} sans échelle",
        pct(quant_bornes, quant_total)
    );
    println!();
    println!("INVARIANT 3 — les tables de temps sont croissantes");
    println!(
        "  {temps_croissants}/{temps_total} ({:.2} %)",
        pct(temps_croissants, temps_total)
    );
    println!();
    println!("NON RÉSOLU — (mode, taille) sans décodeur prouvé");
    for ((mode, size), n) in &inconnus {
        println!("  mode={mode} taille={size} : {n} canaux");
    }
    for e in &exemples {
        println!("  ! {e}");
    }
}

fn collecter(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entrees) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entrees.flatten() {
        let p = e.path();
        if p.is_dir() {
            collecter(&p, out);
        } else if p.extension().is_some_and(|x| x == "g4cm") {
            out.push(p);
        }
    }
}
