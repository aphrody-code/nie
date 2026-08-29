//! `texte_grep` — cherche un libellé dans **toute la localisation** du jeu et rend son hash.
//!
//! Les tables de contenu ne stockent que des hash de texte (`nameTextId`, `titleTextId`,
//! `explanationTextId`…). Retrouver « à quoi correspond ce hash » est facile ; l'inverse — « quel
//! hash porte ce libellé » — demande de balayer les fichiers de localisation, ce que fait cet
//! outil. C'est le point d'entrée pour partir d'un nom vu en jeu et remonter à la donnée.
//!
//! Cherche dans toutes les langues demandées, insensible à la casse, sous-chaîne.
//!
//! Usage :
//! ```text
//! cargo run -p nie-cli --example texte_grep -- <motif> [--lang fr,ja,en] [--max 40]
//! ```

use std::collections::BTreeMap;

use nie_data::text::parse_text_file;
use nie_explore::bridge::t2b_to_json;
use nie_formats::cfgbin;
use nie_formats::vfs::{self, Vfs};

/// Charge les textes d'une langue, en gardant le fichier d'origine de chaque entrée.
fn charger(vfs: &Vfs, langue: &str) -> Vec<(u32, String, String)> {
    let prefixe = format!("data/common/text/{langue}/");
    let mut fichiers: Vec<String> = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .filter(|c| c.starts_with(&prefixe) && c.ends_with(".cfg.bin"))
        .collect();
    fichiers.sort();
    fichiers.dedup();

    let mut out = Vec::new();
    for f in &fichiers {
        let Ok(data) = vfs.read(f) else { continue };
        let Ok(cfg) = cfgbin::cfgbin_parse(&data) else { continue };
        let court = f.trim_start_matches(&prefixe).to_string();
        for (h, t) in parse_text_file(&t2b_to_json(&cfg)) {
            out.push((h.0, t, court.clone()));
        }
    }
    out
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut langues = vec![String::from("fr"), String::from("ja"), String::from("en")];
    let mut max = 40usize;
    if let Some(i) = args.iter().position(|a| a == "--lang") {
        langues = args
            .get(i + 1)
            .map(|s| s.split(',').map(str::to_string).collect())
            .unwrap_or(langues);
        args.drain(i..=i + 1);
    }
    if let Some(i) = args.iter().position(|a| a == "--max") {
        max = args.get(i + 1).and_then(|v| v.parse().ok()).unwrap_or(max);
        args.drain(i..=i + 1);
    }
    let Some(motif) = args.first().map(|s| s.to_lowercase()) else {
        eprintln!("usage: texte_grep <motif> [--lang fr,ja,en] [--max N]");
        std::process::exit(2);
    };

    let vfs = match vfs::open_game() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("VFS indisponible : {e}");
            std::process::exit(1);
        }
    };

    // hash → (langue → texte), pour montrer les traductions côte à côte.
    let mut trouves: BTreeMap<u32, (BTreeMap<String, String>, String)> = BTreeMap::new();
    let mut total = 0usize;
    for langue in &langues {
        let entrees = charger(&vfs, langue);
        total += entrees.len();
        for (h, t, fichier) in entrees {
            if t.to_lowercase().contains(&motif) {
                let e = trouves.entry(h).or_insert_with(|| (BTreeMap::new(), fichier));
                e.0.insert(langue.clone(), t);
            }
        }
    }

    println!(
        "{total} entrées balayées dans {} langue(s) — {} hash portant « {motif} »",
        langues.len(),
        trouves.len()
    );
    for (h, (par_langue, fichier)) in trouves.iter().take(max) {
        println!("\n0x{h:08X}  ({fichier})");
        for (l, t) in par_langue {
            println!("   {l:<8} {}", t.replace('\n', " / "));
        }
    }
    if trouves.len() > max {
        println!("\n… {} de plus", trouves.len() - max);
    }
}
