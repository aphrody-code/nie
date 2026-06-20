//! **Inspecteur de l'atlas de police** (RE du pipeline texte / mode histoire).
//!
//! Usage : `cargo run -p nie-formats --example render_text -- <font.cfg.bin> <font.g4tx> <out.png>`
//!
//! ## État (2026-06-20)
//! - **Décodage de l'atlas : OK.** `font.g4tx` → 1 texture DDS `4096×2048` BGRA8 non compressé,
//!   pixels mip0 à l'offset `data_offset + 128` (en-tête DDS), 3 mips. L'alpha porte la couverture
//!   des glyphes (CJK denses en haut, Latin/chiffres/ponctuation plus bas).
//! - **Parse des métriques : OK** structurellement (`font::parse_metrics`) — 7469 glyphes, cell_h=71.
//! - **MAPPING glyphe→atlas : NON RÉSOLU.** Pour 'A' (cp=65) le record CHR est
//!   `[font=0, base=65, cp=65, 1157, 1, w=38, bearingX=1, adv=39, page=0]`. `parse_metrics` lit
//!   col[3]=x=1157, col[4]=y=1 — MAIS l'atlas en (1157, 1) contient du CJK, et **tous** les Latin
//!   ont col[4]=1 (donc col[4] n'est pas un Y pixel ni un simple index de rangée : la rangée 1 est
//!   aussi du CJK). Le Latin existe dans l'atlas (visible en bas du dump) mais ni à x=1157 ni à y=1.
//!   → X **et** Y passent par une indirection à décoder (table de coordonnées ? sémantique de
//!   colonnes différente du port iecode ?). À RE avant tout rendu de texte fidèle (pas de faux-FAIT).
//!
//! Ce binaire DUMP l'atlas (downscalé) pour la suite de la RE, et n'affirme PAS rendre du texte.

use nie_formats::{cfgbin, font, g4tx};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cfg_bytes = std::fs::read(&args[1]).expect("lire font.cfg.bin");
    let g4tx_bytes = std::fs::read(&args[2]).expect("lire font.g4tx");
    let out = args.get(3).map_or("/tmp/font_atlas_dump.png", String::as_str);

    // Métriques.
    let cfg = cfgbin::parse_t2b(&cfg_bytes).expect("parse font.cfg.bin (T2B)");
    let metrics = font::parse_metrics(&cfg);
    println!("glyphes={} cell_h={} ascent={}", metrics.glyph_count(), metrics.dims.cell_height, metrics.dims.ascent);
    for cp in [65u32, 66, 97] {
        if let Some(m) = metrics.glyph(cp) {
            println!("  cp={cp} ({:?}) x={} y={} w={} adv={} page={}", char::from_u32(cp), m.x, m.y, m.width, m.advance, m.page);
        }
    }

    // Atlas → DDS BGRA8 mip0.
    let tx = g4tx::parse(&g4tx_bytes).expect("parse g4tx");
    let t = &tx.textures[0];
    let dds = &g4tx_bytes[t.data_offset..t.data_offset + t.data_size];
    let px_off = if dds.len() >= 88 && &dds[84..88] == b"DX10" { 148 } else { 128 };
    let atlas = &dds[px_off..];
    let (aw, ah) = (t.width as usize, t.height as usize);
    println!("atlas {aw}×{ah} BGRA8 (dds@{} mip0@+{px_off})", t.data_offset);

    // Dump downscalé ×8 (alpha en gris) pour visualiser la structure CJK/Latin.
    let step = 8usize;
    let (dw, dh) = ((aw / step) as u32, (ah / step) as u32);
    let mut img = vec![0u8; (dw * dh * 4) as usize];
    let stride = aw * 4;
    for j in 0..dh as usize {
        for i in 0..dw as usize {
            let a = atlas.get((j * step) * stride + (i * step) * 4 + 3).copied().unwrap_or(0);
            let o = (j * dw as usize + i) * 4;
            img[o..o + 4].copy_from_slice(&[a, a, a, 255]);
        }
    }
    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(std::io::Cursor::new(&mut buf), dw, dh);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().unwrap().write_image_data(&img).unwrap();
    }
    std::fs::write(out, &buf).expect("écrire png");
    println!("atlas downscalé → {out} ({dw}×{dh})");
}
