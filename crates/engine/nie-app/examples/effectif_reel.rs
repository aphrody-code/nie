//! Affiche l'effectif réel du jeu, tel que l'écran « Composition d'équipe » le montrera.
//!
//! ```text
//! cargo run -p nie-app --example effectif_reel
//! ```

fn main() -> Result<(), String> {
    let vfs = nie_formats::vfs::open_game().map_err(|e| format!("VFS : {e:?}"))?;
    println!(
        "VFS {} — {} fichiers",
        if vfs.is_dump() { "dump" } else { "packs" },
        vfs.asset_count()
    );

    let joueurs = nie_app::effectif::charger(&vfs, 20, "fr").map_err(|e| format!("{e:#}"))?;
    println!("\n{} joueurs chargés :\n", joueurs.len());
    for (i, j) in joueurs.iter().enumerate() {
        println!("  {:>2}. {}  [{}]", i + 1, j.ligne(), j.code);
    }
    let objets = nie_app::effectif::charger_objets(&vfs, 15, "fr").map_err(|e| format!("{e:#}"))?;
    println!("\n{} objets chargés :\n", objets.len());
    for (i, o) in objets.iter().enumerate() {
        println!("  {:>2}. {}", i + 1, o.ligne());
    }
    Ok(())
}
