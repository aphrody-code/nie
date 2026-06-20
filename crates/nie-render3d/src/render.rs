//! Rastériseur 3D CPU : projette un [`Model`](crate::glb::Model) en perspective et le remplit
//! triangle par triangle avec **z-buffer** et **éclairage Lambert** (matcap argile). Headless,
//! déterministe. Le rendu wgpu/3D texturé GPU est le pas suivant ; ici on prouve la 3D sur les
//! **vrais maillages CPK**.

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]

use crate::glb::Model;

type V3 = [f32; 3];

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn dot(a: V3, b: V3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn normv(a: V3) -> V3 {
    let l = dot(a, a).sqrt();
    if l > 1e-9 { [a[0] / l, a[1] / l, a[2] / l] } else { [0.0, 0.0, 1.0] }
}

/// Boîte englobante de toutes les primitives → (centre, rayon).
#[must_use]
pub fn bounds(model: &Model) -> (V3, f32) {
    let mut lo = [f32::MAX; 3];
    let mut hi = [f32::MIN; 3];
    for p in &model.primitives {
        for v in &p.positions {
            for k in 0..3 {
                lo[k] = lo[k].min(v[k]);
                hi[k] = hi[k].max(v[k]);
            }
        }
    }
    let c = [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5];
    let r = (0..3).map(|k| (hi[k] - lo[k]) * 0.5).fold(0.0_f32, f32::max).max(1e-3);
    (c, r)
}

/// Rotation autour de Y (turntable) puis léger tilt autour de X (vue plongeante douce).
fn orient(v: V3, cy: f32, sy: f32, cx: f32, sx: f32) -> V3 {
    // Y
    let x = v[0] * cy + v[2] * sy;
    let z = -v[0] * sy + v[2] * cy;
    let y = v[1];
    // X (tilt)
    let y2 = y * cx - z * sx;
    let z2 = y * sx + z * cx;
    [x, y2, z2]
}

/// Rend `model` vu sous l'angle `angle` (radians) en RGBA8 `w`×`h`.
#[must_use]
pub fn render(model: &Model, angle: f32, w: u32, h: u32) -> Vec<u8> {
    let (center, radius) = bounds(model);
    let inv = 1.0 / radius;
    let (cy, sy) = (angle.cos(), angle.sin());
    let tilt = 0.20_f32;
    let (cx, sx) = (tilt.cos(), tilt.sin());

    let cam_d = 3.1_f32; // distance caméra (sur +z), modèle normalisé ~[-1,1]
    let focal = 1.7_f32;
    let scale = w as f32 * 0.5;

    let light = normv([0.35, 0.75, 0.55]);
    let mut px = vec![0u8; (w * h * 4) as usize];
    // Fond : dégradé vertical sombre.
    for y in 0..h {
        let t = y as f32 / h as f32;
        let bg = [(24.0 + 26.0 * t) as u8, (28.0 + 30.0 * t) as u8, (40.0 + 34.0 * t) as u8, 255];
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            px[i..i + 4].copy_from_slice(&bg);
        }
    }
    let mut zbuf = vec![f32::INFINITY; (w * h) as usize];

    // Projette un sommet (centré/normalisé/orienté) → (sx_px, sy_px, depth) ou None si derrière.
    let project = |v: V3| -> Option<(f32, f32, f32)> {
        let n = [(v[0] - center[0]) * inv, (v[1] - center[1]) * inv, (v[2] - center[2]) * inv];
        let r = orient(n, cy, sy, cx, sx);
        let depth = cam_d - r[2]; // >0 = devant la caméra
        if depth <= 0.05 {
            return None;
        }
        let sxp = w as f32 * 0.5 + focal * r[0] / depth * scale;
        let syp = h as f32 * 0.5 - focal * r[1] / depth * scale;
        Some((sxp, syp, depth))
    };

    for prim in &model.primitives {
        for tri in prim.indices.chunks_exact(3) {
            let (ia, ib, ic) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
            if ia >= prim.positions.len() || ib >= prim.positions.len() || ic >= prim.positions.len()
            {
                continue;
            }
            let (wa, wb, wc) = (prim.positions[ia], prim.positions[ib], prim.positions[ic]);
            let (Some(a), Some(b), Some(c)) = (project(wa), project(wb), project(wc)) else {
                continue;
            };
            // Normale de face (espace monde centré/orienté) pour Lambert.
            let na = [(wa[0] - center[0]) * inv, (wa[1] - center[1]) * inv, (wa[2] - center[2]) * inv];
            let nb = [(wb[0] - center[0]) * inv, (wb[1] - center[1]) * inv, (wb[2] - center[2]) * inv];
            let nc = [(wc[0] - center[0]) * inv, (wc[1] - center[1]) * inv, (wc[2] - center[2]) * inv];
            let fn_ = normv(cross(
                sub(orient(nb, cy, sy, cx, sx), orient(na, cy, sy, cx, sx)),
                sub(orient(nc, cy, sy, cx, sx), orient(na, cy, sy, cx, sx)),
            ));
            let lambert = dot(fn_, light).abs();
            let shade = 0.25 + 0.75 * lambert;
            let base = [206.0, 198.0, 188.0]; // argile neutre (matcap)
            let col = [
                (base[0] * shade) as u8,
                (base[1] * shade) as u8,
                (base[2] * shade) as u8,
                255u8,
            ];
            fill_triangle(&mut px, &mut zbuf, w, h, a, b, c, col);
        }
    }
    px
}

/// Remplit un triangle écran (barycentrique) avec test/écriture z-buffer.
#[allow(clippy::too_many_arguments)]
fn fill_triangle(
    px: &mut [u8],
    zbuf: &mut [f32],
    w: u32,
    h: u32,
    a: (f32, f32, f32),
    b: (f32, f32, f32),
    c: (f32, f32, f32),
    col: [u8; 4],
) {
    let minx = a.0.min(b.0).min(c.0).floor().max(0.0) as i32;
    let maxx = a.0.max(b.0).max(c.0).ceil().min(w as f32 - 1.0) as i32;
    let miny = a.1.min(b.1).min(c.1).floor().max(0.0) as i32;
    let maxy = a.1.max(b.1).max(c.1).ceil().min(h as f32 - 1.0) as i32;
    let area = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
    if area.abs() < 1e-6 {
        return;
    }
    let inv_area = 1.0 / area;
    for y in miny..=maxy {
        for x in minx..=maxx {
            let fx = x as f32 + 0.5;
            let fy = y as f32 + 0.5;
            let w0 = ((b.0 - fx) * (c.1 - fy) - (b.1 - fy) * (c.0 - fx)) * inv_area;
            let w1 = ((c.0 - fx) * (a.1 - fy) - (c.1 - fy) * (a.0 - fx)) * inv_area;
            let w2 = 1.0 - w0 - w1;
            if w0 < 0.0 || w1 < 0.0 || w2 < 0.0 {
                continue;
            }
            let depth = w0 * a.2 + w1 * b.2 + w2 * c.2;
            let zi = (y as u32 * w + x as u32) as usize;
            if depth < zbuf[zi] {
                zbuf[zi] = depth;
                let i = zi * 4;
                px[i..i + 4].copy_from_slice(&col);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::glb::{Model, Primitive};

    fn tri_model() -> Model {
        Model {
            primitives: vec![Primitive {
                positions: vec![[-1.0, -1.0, 0.0], [1.0, -1.0, 0.0], [0.0, 1.0, 0.0]],
                normals: vec![[0.0, 0.0, 1.0]; 3],
                indices: vec![0, 1, 2],
            }],
        }
    }

    #[test]
    fn bounds_centre_et_rayon() {
        let (c, r) = bounds(&tri_model());
        assert!((c[0]).abs() < 1e-6 && (c[1]).abs() < 1e-6);
        assert!((r - 1.0).abs() < 1e-6);
    }

    #[test]
    fn render_produit_des_pixels_de_mesh() {
        let (w, h) = (128, 128);
        let buf = render(&tri_model(), 0.0, w, h);
        assert_eq!(buf.len(), (w * h * 4) as usize);
        // Au moins quelques pixels de mesh (argile ~100-200) au-dessus du fond sombre (<60).
        let lit = buf.chunks_exact(4).filter(|p| p[0] > 80 && p[1] > 80 && p[2] > 80).count();
        assert!(lit > 50, "le triangle doit produire des pixels de mesh ({lit})");
    }
}
