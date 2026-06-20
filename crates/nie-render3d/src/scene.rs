//! Rendu **de scène** en espace monde : une caméra look-at + une liste de triangles colorés
//! déjà placés dans le monde (terrain, joueurs, ballon, buts…). C'est la généralisation « scène »
//! du rastériseur mono-modèle de [`render`](crate::render) : au lieu de normaliser un objet centré,
//! on projette un monde entier sous une caméra arbitraire. Brique de base du **match 3D** et, à
//! terme, des **maps/scènes** du jeu. Z-buffer, éclairage Lambert deux-faces, fond dégradé.

#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_precision_loss)]

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

/// Caméra perspective look-at. `fov_y` en radians (champ vertical).
pub struct Camera {
    pub eye: V3,
    pub target: V3,
    pub up: V3,
    pub fov_y: f32,
}

/// Un triangle du monde, couleur plate (l'éclairage Lambert la module).
pub struct Tri {
    pub p: [V3; 3],
    pub color: [u8; 3],
}

/// Projette le monde `tris` sous la caméra `cam` → RGBA8 `w`×`h`. Fond : dégradé vertical
/// (`bg_top` en haut → `bg_bot` en bas).
#[must_use]
pub fn render_world(
    tris: &[Tri],
    cam: &Camera,
    w: u32,
    h: u32,
    bg_top: [u8; 3],
    bg_bot: [u8; 3],
) -> Vec<u8> {
    // Base caméra (repère main droite : f avant, r droite, u haut).
    let f = normv(sub(cam.target, cam.eye));
    let r = normv(cross(f, cam.up));
    let u = cross(r, f);
    let focal = 1.0 / (cam.fov_y * 0.5).tan();
    let scale = h as f32 * 0.5;
    let light = normv([0.3, 0.85, 0.4]);

    let mut px = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        let t = y as f32 / h as f32;
        let mix = |a: u8, b: u8| (f32::from(a) * (1.0 - t) + f32::from(b) * t) as u8;
        let bg = [mix(bg_top[0], bg_bot[0]), mix(bg_top[1], bg_bot[1]), mix(bg_top[2], bg_bot[2]), 255];
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            px[i..i + 4].copy_from_slice(&bg);
        }
    }
    let mut zbuf = vec![f32::INFINITY; (w * h) as usize];

    // Monde → écran : translate par -eye, projette sur la base caméra, perspective.
    let project = |p: V3| -> Option<(f32, f32, f32)> {
        let v = sub(p, cam.eye);
        let zc = dot(v, f); // profondeur le long de l'axe avant
        if zc <= 0.05 {
            return None;
        }
        let xc = dot(v, r);
        let yc = dot(v, u);
        let sx = w as f32 * 0.5 + xc / zc * focal * scale;
        let sy = h as f32 * 0.5 - yc / zc * focal * scale;
        Some((sx, sy, zc))
    };

    for tri in tris {
        let (Some(a), Some(b), Some(c)) = (project(tri.p[0]), project(tri.p[1]), project(tri.p[2]))
        else {
            continue; // un sommet derrière le plan proche → on saute (suffisant pour une caméra haute)
        };
        let n = normv(cross(sub(tri.p[1], tri.p[0]), sub(tri.p[2], tri.p[0])));
        let shade = 0.45 + 0.55 * dot(n, light).abs(); // deux-faces (terrain vu de dessus)
        let col = [
            (f32::from(tri.color[0]) * shade) as u8,
            (f32::from(tri.color[1]) * shade) as u8,
            (f32::from(tri.color[2]) * shade) as u8,
            255u8,
        ];
        fill(&mut px, &mut zbuf, w, h, a, b, c, col);
    }
    px
}

/// Remplit un triangle écran (barycentrique) avec z-buffer (profondeur caméra interpolée).
#[allow(clippy::too_many_arguments)]
fn fill(
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

    #[test]
    fn rend_un_quad_au_sol() {
        // Un quad vert au sol (y=0), caméra au-dessus qui regarde l'origine.
        let g = [40u8, 160, 60];
        let tris = vec![
            Tri { p: [[-5.0, 0.0, -5.0], [5.0, 0.0, -5.0], [5.0, 0.0, 5.0]], color: g },
            Tri { p: [[-5.0, 0.0, -5.0], [5.0, 0.0, 5.0], [-5.0, 0.0, 5.0]], color: g },
        ];
        let cam = Camera { eye: [0.0, 12.0, -12.0], target: [0.0, 0.0, 0.0], up: [0.0, 1.0, 0.0], fov_y: 0.9 };
        let buf = render_world(&tris, &cam, 128, 128, [20, 24, 40], [40, 48, 70]);
        let green = buf.chunks_exact(4).filter(|p| p[1] > p[0] + 20 && p[1] > p[2] + 20).count();
        assert!(green > 200, "le quad vert doit couvrir une bonne part de l'image ({green})");
    }
}
