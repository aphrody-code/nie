//! `hash_ou` — dit **où** un hash 32 bits apparaît dans les tables du jeu.
//!
//! Complément de `texte_grep` : celui-ci part d'un libellé et rend un hash, celui-là part d'un
//! hash et rend la ou les lignes de table qui le portent — fichier, liste, index de ligne, champ,
//! et la ligne entière. C'est le chaînon qui relie « ce que le jeu affiche » à « la donnée qui le
//! produit ».
//!
//! Balaye toutes les tables RDBN de `data/common/gamedata/**`, y compris les champs `ShortTuple`
//! et `Rates` où un hash peut se cacher sur 32 bits.
//!
//! Usage :
//! ```text
//! cargo run -p nie-cli --example hash_ou -- 0x48590131 [--prefixe data/common/gamedata/] [--max 30]
//! ```

use nie_formats::cfgbin::{self, RdbnValue};
use nie_formats::vfs;

/// Rend une valeur RDBN de façon compacte.
fn court(v: &RdbnValue) -> String {
    match v {
        RdbnValue::Bool(b) => format!("{b}"),
        RdbnValue::Byte(b) => format!("{b}"),
        RdbnValue::Short(s) | RdbnValue::ActType(s) => format!("{s}"),
        RdbnValue::Int(i) | RdbnValue::Flag(i) => format!("{i}"),
        RdbnValue::Float(f) => format!("{f}"),
        RdbnValue::Hash(h) => format!("0x{h:08X}"),
        RdbnValue::Rates(r) | RdbnValue::Position(r) => format!("{r:?}"),
        RdbnValue::Condition(c) => format!("\"{c}\""),
        RdbnValue::ShortTuple(t) => format!("({},{})", t[0], t[1]),
        RdbnValue::Blob(b) => format!("<{}o>", b.len()),
        RdbnValue::Invalid => String::from("<invalide>"),
    }
}

/// `true` si la valeur porte exactement ce hash.
fn porte(v: &RdbnValue, cible: u32) -> bool {
    match v {
        RdbnValue::Hash(h) => *h == cible,
        RdbnValue::Int(i) | RdbnValue::Flag(i) => (*i as u32) == cible,
        _ => false,
    }
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut prefixe = String::from("data/common/gamedata/");
    let mut max = 30usize;
    if let Some(i) = args.iter().position(|a| a == "--prefixe") {
        prefixe = args.get(i + 1).cloned().unwrap_or(prefixe);
        args.drain(i..=i + 1);
    }
    if let Some(i) = args.iter().position(|a| a == "--max") {
        max = args.get(i + 1).and_then(|v| v.parse().ok()).unwrap_or(max);
        args.drain(i..=i + 1);
    }
    let Some(brut) = args.first() else {
        eprintln!("usage: hash_ou <0xHASH | décimal> [--prefixe <p>] [--max N]");
        std::process::exit(2);
    };
    let t = brut.trim();
    let Some(cible) = t
        .strip_prefix("0x")
        .or_else(|| t.strip_prefix("0X"))
        .and_then(|h| u32::from_str_radix(h, 16).ok())
        .or_else(|| t.parse::<u32>().ok())
    else {
        eprintln!("hash illisible : {brut}");
        std::process::exit(2);
    };

    let vfs = match vfs::open_game() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("VFS indisponible : {e}");
            std::process::exit(1);
        }
    };

    let mut fichiers: Vec<String> = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .filter(|c| c.starts_with(&prefixe) && c.ends_with(".cfg.bin") && !c.ends_with(".lua.bin"))
        .collect();
    fichiers.sort();
    fichiers.dedup();

    println!("cherche 0x{cible:08X} dans {} table(s)\n", fichiers.len());
    let mut trouves = 0usize;
    for chemin in &fichiers {
        let Ok(data) = vfs.read(chemin) else { continue };
        let Ok(rdbn) = cfgbin::parse(&data) else {
            // Pas un RDBN : c'est un T2B. Ses variables sont des `Int` **signés** ; un hash y
            // apparaît donc en négatif dès que le bit 31 est posé — on compare sur les 32 bits.
            let Ok(cfg) = cfgbin::cfgbin_parse(&data) else {
                continue;
            };
            let mut pile: Vec<(&cfgbin::CfgEntry, String)> =
                cfg.entries.iter().map(|e| (e, String::new())).collect();
            while let Some((noeud, chemin_noeud)) = pile.pop() {
                let ici = if chemin_noeud.is_empty() {
                    noeud.name.clone()
                } else {
                    format!("{chemin_noeud}/{}", noeud.name)
                };
                let idx: Vec<usize> = noeud
                    .variables
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| matches!(v, cfgbin::Value::Int(i) if (*i as u32) == cible))
                    .map(|(i, _)| i)
                    .collect();
                if !idx.is_empty() {
                    trouves += 1;
                    if trouves <= max {
                        let vals: Vec<String> = noeud
                            .variables
                            .iter()
                            .map(|v| match v {
                                cfgbin::Value::Int(i) => format!("{i}"),
                                cfgbin::Value::Float(f) => format!("{f}"),
                                cfgbin::Value::String(s) => format!("\"{s}\""),
                            })
                            .collect();
                        println!(
                            "{}  [T2B]\n  {ici} · variable(s) {:?}\n    {}\n",
                            chemin.trim_start_matches(&prefixe),
                            idx,
                            vals.join("  ")
                        );
                    }
                }
                for e in &noeud.children {
                    pile.push((e, ici.clone()));
                }
            }
            continue;
        };
        for liste in cfgbin::read_values(&rdbn, &data) {
            for (i, row) in liste.rows.iter().enumerate() {
                let champs: Vec<&String> = row
                    .fields
                    .iter()
                    .filter(|(_, v)| porte(v, cible))
                    .map(|(k, _)| k)
                    .collect();
                if champs.is_empty() {
                    continue;
                }
                trouves += 1;
                if trouves > max {
                    continue;
                }
                println!(
                    "{}\n  {} [{i}] · champ(s) {}",
                    chemin.trim_start_matches(&prefixe),
                    liste.name,
                    champs
                        .iter()
                        .map(|c| c.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                let corps: Vec<String> = row
                    .fields
                    .iter()
                    .map(|(k, v)| format!("{k}={}", court(v)))
                    .collect();
                println!("    {}\n", corps.join("  "));
            }
        }
    }
    println!("{trouves} ligne(s) portent 0x{cible:08X}");
    if trouves > max {
        println!("(affichage limité à {max})");
    }
}
