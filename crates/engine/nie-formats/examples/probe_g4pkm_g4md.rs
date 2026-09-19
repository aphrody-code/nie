//! Sonde : un `.g4pkm` porte-t-il un sous-fichier G4MD, et que déclare-t-il ?
//!
//! Écrit pour mesurer la famille `chr/_waza/`, qui n'a AUCUN `.g4md` autonome — l'hypothèse
//! étant que le descripteur y vit à l'intérieur du `.g4pkm`.
use nie_formats::{g4md, g4pkm};

fn main() {
    let mut argv = std::env::args().skip(1);
    let chemin = argv.next().expect("usage: probe_g4pkm_g4md <fichier.g4pkm>");
    let octets = std::fs::read(&chemin).expect("lecture");
    println!("fichier   {chemin} ({} octets)", octets.len());
    match g4pkm::extract_g4md(&octets) {
        None => println!("g4md      ABSENT du container"),
        Some(md) => {
            println!("g4md      {} octets", md.len());
            match g4md::parse(md) {
                Err(e) => println!("parse     ECHEC : {e}"),
                Ok(m) => {
                    println!("materiaux {:?}", m.material_base_names);
                    println!("g4md      {m:#?}");
                }
            }
        }
    }
    match g4pkm::parse(&octets) {
        Err(e) => println!("layout    ECHEC : {e}"),
        Ok(l) => println!("os        {}", l.bones.len()),
    }
}
