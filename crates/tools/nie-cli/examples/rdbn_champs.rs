//! `rdbn_champs` — cherche un **nom de champ** dans toutes les tables RDBN du VFS.
//!
//! Les tables du jeu sont nommées par concept, pas par contenu : savoir *où* vit une donnée
//! (le niveau d'une équipe, un taux de drop, un identifiant d'équipe) demande de balayer les
//! champs, pas les noms de fichiers. Cet outil fait ce balayage et rend, pour chaque liste
//! touchée, le fichier, le type RDBN, le nombre de lignes et un échantillon de valeurs.
//!
//! Usage :
//! ```text
//! cargo run -p nie-cli --example rdbn_champs -- <motif> [--prefixe data/common/gamedata/] [--ech 3]
//! ```
//! Le motif est cherché en **sous-chaîne, insensible à la casse**, dans le nom du champ.

use nie_formats::cfgbin::{self, RdbnValue};
use nie_formats::vfs;

/// Rend une valeur RDBN de façon compacte pour l'échantillon.
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

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut prefixe = String::from("data/common/gamedata/");
    let mut ech = 3usize;
    if let Some(i) = args.iter().position(|a| a == "--prefixe") {
        prefixe = args.get(i + 1).cloned().unwrap_or(prefixe);
        args.drain(i..=i + 1);
    }
    if let Some(i) = args.iter().position(|a| a == "--ech") {
        ech = args.get(i + 1).and_then(|v| v.parse().ok()).unwrap_or(ech);
        args.drain(i..=i + 1);
    }
    let Some(motif) = args.first().map(|s| s.to_lowercase()) else {
        eprintln!("usage: rdbn_champs <motif> [--prefixe <p>] [--ech <n>]");
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

    let mut touches = 0usize;
    for chemin in &fichiers {
        let Ok(data) = vfs.read(chemin) else { continue };
        let Ok(rdbn) = cfgbin::parse(&data) else { continue };
        for liste in cfgbin::read_values(&rdbn, &data) {
            let Some(premiere) = liste.rows.first() else { continue };
            let cibles: Vec<&String> = premiere
                .fields
                .iter()
                .map(|(k, _)| k)
                .filter(|k| k.to_lowercase().contains(&motif))
                .collect();
            if cibles.is_empty() {
                continue;
            }
            touches += 1;
            println!(
                "{}\n  {} ({}) — {} ligne(s)",
                chemin.trim_start_matches(&prefixe),
                liste.name,
                liste.type_name,
                liste.rows.len()
            );
            for c in cibles {
                let vals: Vec<String> = liste
                    .rows
                    .iter()
                    .take(ech)
                    .filter_map(|r| r.fields.iter().find(|(k, _)| k == c).map(|(_, v)| court(v)))
                    .collect();
                println!("    {c} = [{}]", vals.join(", "));
            }
        }
    }
    println!("\n{touches} liste(s) portant un champ « {motif} » sur {} fichiers", fichiers.len());
}
