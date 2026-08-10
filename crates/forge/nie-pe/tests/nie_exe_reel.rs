//! Gate G0 de la forge, sur le **vrai** `nie.exe`.
//!
//! Ces tests ne valent que sur le binaire réel : ils prouvent que le modèle
//! d'image et le découpage en unités reproduisent le fichier **au byte près**.
//! Si `nie.exe` est absent (checkout sans le jeu), ils s'auto-ignorent — le
//! binaire est © LEVEL-5 et n'est jamais commité.

use nie_pe::{Cover, PeImage, UnitKind, checksum, diff, sha256_hex};
use std::path::PathBuf;

/// Localise `nie.exe` : `NIE_EXE`, puis `NIE_GAME_DIR/nie.exe`, puis la racine du repo.
fn locate() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("NIE_EXE") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(d) = std::env::var("NIE_GAME_DIR") {
        let p = PathBuf::from(d).join("nie.exe");
        if p.is_file() {
            return Some(p);
        }
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .parent()?
        .join("nie.exe");
    root.is_file().then_some(root)
}

fn load() -> Option<PeImage> {
    let p = locate()?;
    let bytes = std::fs::read(p).ok()?;
    Some(PeImage::parse(bytes).expect("nie.exe doit parser"))
}

#[test]
fn entetes_reemis_byte_exact() {
    let Some(img) = load() else {
        eprintln!("nie.exe absent — test ignoré");
        return;
    };
    assert_eq!(img.coff.machine, 0x8664);
    assert_eq!(img.opt.image_base, 0x1_4000_0000);
    assert_eq!(img.sections.len(), 9);

    let emitted = img.emit_headers();
    let original = &img.bytes[..img.headers_end()];
    let d = diff::compare(original, &emitted, 8);
    assert!(
        d.is_identical(),
        "en-têtes ré-émis divergents : {} octets, plages {:?}",
        d.bytes_differing,
        d.ranges
    );
}

#[test]
fn decoupage_total_et_reassemblage_byte_exact() {
    let Some(img) = load() else {
        eprintln!("nie.exe absent — test ignoré");
        return;
    };
    let cover = Cover::split(&img).expect("découpage");
    cover.validate().expect("recouvrement total");

    assert_eq!(cover.total_len, img.bytes.len());
    assert_eq!(
        cover.units.iter().map(|u| u.len).sum::<usize>(),
        img.bytes.len(),
        "somme des unités != taille du fichier"
    );
    assert!(
        cover.count_by_kind(UnitKind::Function) > 40_000,
        "trop peu de fonctions .pdata : {}",
        cover.count_by_kind(UnitKind::Function)
    );

    let rebuilt = cover
        .assemble(|u| Some(img.bytes[u.range()].to_vec()))
        .expect("assemblage");
    assert_eq!(
        sha256_hex(&rebuilt),
        cover.sha256,
        "le fichier régénéré diverge de l'original"
    );
}

#[test]
fn checksum_du_fichier_original_est_reproductible() {
    let Some(img) = load() else {
        eprintln!("nie.exe absent — test ignoré");
        return;
    };
    // `nie.exe` porte CheckSum=0 : la forge doit produire cette même valeur nulle,
    // donc ne jamais « corriger » le champ. On vérifie simplement que le calcul
    // est déterministe et que la valeur stockée reste 0.
    assert_eq!(img.opt.checksum, 0);
    let off = checksum::field_offset(&img);
    let a = checksum::compute(&img.bytes, off);
    let b = checksum::compute(&img.bytes, off);
    assert_eq!(a, b);
}
