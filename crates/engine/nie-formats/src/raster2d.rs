//! **raster2d** — primitives 2D RGBA8 **pures** (rognage + redimensionnement nearest), source unique
//! du workspace (dédup Phase 2). `no_std` (alloc) : entier seul, zéro flottant.
//!
//! ⚠ **Le compositing alpha (`blend over`) n'est PAS ici** — c'est la **landmine #5** (`docs/ARCHITECTURE.md`) :
//! les blends du workspace divergent réellement (`nie-runtime` f32 tronqué vs `nie-game` entier arrondi
//! `+127`) et peuvent diverger **par contexte** comme le jeu réel (menu validé vs terrain/sprites). Les
//! unifier sans RE du compositeur du jeu serait un faux-FAIT. Seules les ops **byte-identiques** (crop/scale)
//! sont centralisées ici.

extern crate alloc;
use alloc::vec::Vec;
// Macro `vec!` du prélude std, absente en no_std (no-op en std via cfg).
#[cfg(not(feature = "std"))]
use alloc::vec;

/// Rogne un sous-rectangle RGBA8 de `full` (`full_w × full_h`).
///
/// `rect = (x, y, w, h)` en `i16` (origine top-left). Retourne `(w, h, pixels)` ou `None` si le rect
/// est dégénéré (`w ≤ 0`/`h ≤ 0`), à coordonnée négative, déborde de l'image, ou si `full` est trop court.
/// Pur (copie ligne par ligne), byte-identique à l'ancienne copie de `nie-game`.
#[must_use]
pub fn crop_rgba(
    full: &[u8],
    full_w: u32,
    full_h: u32,
    rect: (i16, i16, i16, i16),
) -> Option<(u32, u32, Vec<u8>)> {
    let (rx, ry, rw, rh) = rect;
    if rx < 0 || ry < 0 || rw <= 0 || rh <= 0 {
        return None;
    }
    let (x, y, w, h) = (rx as u32, ry as u32, rw as u32, rh as u32);
    if x.checked_add(w)? > full_w || y.checked_add(h)? > full_h {
        return None;
    }
    if full.len() < (full_w as usize) * (full_h as usize) * 4 {
        return None;
    }
    let stride = full_w as usize * 4;
    let row_bytes = w as usize * 4;
    let mut out = Vec::with_capacity(w as usize * h as usize * 4);
    for row in 0..h {
        let start = (y + row) as usize * stride + x as usize * 4;
        out.extend_from_slice(&full[start..start + row_bytes]);
    }
    Some((w, h, out))
}

/// Redimensionne `src` (RGBA8 `sw × sh`) en `dw × dh` par **plus-proche-voisin** (entier `x·sw/dw`).
///
/// Retourne un buffer vide (jamais de panique) si une dimension est nulle ou si `src` est trop court.
/// Pur, byte-identique à l'ancienne copie de `nie-game`.
#[must_use]
pub fn scale_nearest(src: &[u8], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<u8> {
    if [sw, sh, dw, dh].contains(&0) || src.len() < (sw as usize * sh as usize * 4) {
        return Vec::new();
    }
    let mut out = vec![0u8; dw as usize * dh as usize * 4];
    for y in 0..dh {
        let sy = y * sh / dh;
        for x in 0..dw {
            let sx = x * sw / dw;
            let s = (sy as usize * sw as usize + sx as usize) * 4;
            let d = (y as usize * dw as usize + x as usize) * 4;
            out[d..d + 4].copy_from_slice(&src[s..s + 4]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rampe RGBA `w×h` où le canal rouge = index linéaire du pixel (vert/bleu = 0, alpha = 255).
    fn ramp(w: u32, h: u32) -> Vec<u8> {
        let mut v = Vec::with_capacity((w * h * 4) as usize);
        for i in 0..(w * h) {
            v.extend_from_slice(&[i as u8, 0, 0, 255]);
        }
        v
    }

    #[test]
    fn crop_extrait_le_bon_sous_rect() {
        let full = ramp(4, 2); // ligne 0 : 0 1 2 3 ; ligne 1 : 4 5 6 7
        let (w, h, out) = crop_rgba(&full, 4, 2, (1, 0, 2, 2)).expect("crop valide");
        assert_eq!((w, h), (2, 2));
        let reds: Vec<u8> = out.chunks_exact(4).map(|p| p[0]).collect();
        assert_eq!(reds, [1, 2, 5, 6]);
    }

    #[test]
    fn crop_rejette_hors_bornes_et_degenere() {
        let full = ramp(4, 2);
        assert!(crop_rgba(&full, 4, 2, (3, 0, 2, 1)).is_none()); // déborde en largeur
        assert!(crop_rgba(&full, 4, 2, (0, 1, 1, 2)).is_none()); // déborde en hauteur
        assert!(crop_rgba(&full, 4, 2, (0, 0, 0, 1)).is_none()); // w ≤ 0
        assert!(crop_rgba(&full, 4, 2, (-1, 0, 2, 1)).is_none()); // coord négative
        assert!(crop_rgba(&full, 4, 2, (0, 0, 4, 2)).is_some()); // pleine surface
    }

    #[test]
    fn scale_double_et_reduit() {
        let src = vec![255, 0, 0, 255, 0, 255, 0, 255]; // 2×1 : rouge, vert
        let up = scale_nearest(&src, 2, 1, 4, 1); // → 4×1 : R R V V
        let reds: Vec<u8> = up.chunks_exact(4).map(|p| p[0]).collect();
        let greens: Vec<u8> = up.chunks_exact(4).map(|p| p[1]).collect();
        assert_eq!(reds, [255, 255, 0, 0]);
        assert_eq!(greens, [0, 0, 255, 255]);
        assert!(scale_nearest(&src, 2, 1, 0, 1).is_empty()); // dimension nulle → vide
    }
}
