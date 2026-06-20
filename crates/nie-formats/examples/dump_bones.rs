//! Dump la hiérarchie d'os d'un `.g4sk` (index, nom, parent) — pour identifier les os à poser.
//! `cargo run -p nie-formats --example dump_bones -- <fichier.g4sk>`

use nie_formats::g4sk;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let data = std::fs::read(&args[1]).expect("lecture g4sk");
    let header = g4sk::parse_header(&data).expect("header g4sk");
    let bones = g4sk::parse_hierarchy(&data, &header);
    println!("os={}", bones.bones.len());
    for b in &bones.bones {
        println!("{:3}: {:30} parent={}", b.index, b.name, b.parent_index);
    }
}
