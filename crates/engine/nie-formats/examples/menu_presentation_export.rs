//! Native side of the portable menu/font equality gate. Private font bytes are caller-owned.
use nie_formats::{bitmap_font::BitmapFont, menu_presentation};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("expected private font fixture directory")?,
    );
    let font = BitmapFont::from_bytes(
        &std::fs::read(root.join("font.cfg.bin"))?,
        &std::fs::read(root.join("font.g4tx"))?,
    )?;
    let scenes: Vec<serde_json::Value> = [
        "loading",
        "start",
        "title-menu",
        "autosave",
        "options-row",
        "avatar-top",
        "avatar-style",
        "avatar-hair",
        "avatar-clothes",
        "avatar-stats",
        "avatar-name",
    ]
    .iter()
    .map(|id| menu_presentation::scene_json(id).map(|json| serde_json::from_str(&json).unwrap()))
    .collect::<Result<_, _>>()?;
    let texts: Vec<serde_json::Value> = ["A", "CHARGEMENT EN COURS…", "Créer avatar", "Équipe", "éèêëàâçîïôùûüœŒ’…", "木語金", "Certains maillots ne\ncorrespondent pas aux styles d'habits."].iter().map(|text| {
        let frame = font.render(text, [34, 68, 102, 255]).unwrap();
        let checksum = nie_formats::cfgbin::crc32(&frame.rgba);
        serde_json::json!({"text": text,"width": frame.width,"height": frame.height,"rgbaCrc32": checksum})
    }).collect();
    println!(
        "{}",
        serde_json::json!({"schemaVersion":1,"scenes":scenes,"texts":texts})
    );
    Ok(())
}
