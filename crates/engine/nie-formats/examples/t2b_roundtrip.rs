//! Mesure la fidélité de l'aller-retour `parse_t2b → encode_t2b` sur un `.cfg.bin` **en clair**.
//!
//! Sert à distinguer, dans un mod, ce qui vient d'une édition voulue de ce qui vient de
//! l'encodeur : si le réencodage à vide perd déjà des octets, un fichier de mod plus court que
//! son vanilla n'a pas forcément été « allégé » à dessein — il a simplement traversé l'encodeur.
//!
//! Avec `--out <fichier>`, écrit le réencodé : le comparer au fichier d'un mod isole l'édition
//! réelle du bruit de l'encodeur.
//!
//! Usage : `cargo run -p nie-formats --example t2b_roundtrip -- <fichier.cfg.bin>… [--out <f>]`

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut out_path = None;
    if let Some(i) = args.iter().position(|a| a == "--out") {
        out_path = args.get(i + 1).cloned();
        args.drain(i..=i + 1);
    }
    assert!(!args.is_empty(), "usage: t2b_roundtrip <fichier.cfg.bin>… [--out <f>]");
    for path in &args {
        let brut = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                println!("{path} : illisible ({e})");
                continue;
            }
        };
        match nie_formats::cfgbin::cfgbin_parse(&brut) {
            Err(e) => println!("{path} : parse impossible ({e:?})"),
            Ok(cfg) => {
                let re = nie_formats::cfgbin::encode_t2b(&cfg.entries);
                let delta = re.len() as i64 - brut.len() as i64;
                let diff = re.iter().zip(brut.iter()).filter(|(a, b)| a != b).count();
                println!(
                    "{}\n  {} o → {} o  (Δ {delta:+})  {}  {diff} octets différents",
                    path,
                    brut.len(),
                    re.len(),
                    if re == brut { "FIDÈLE" } else { "INFIDÈLE" }
                );
                if let Some(o) = &out_path {
                    std::fs::write(o, &re).expect("écriture du réencodé");
                    println!("  réencodé écrit dans {o}");
                }
            }
        }
    }
}
