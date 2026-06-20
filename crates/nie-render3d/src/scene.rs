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

/// Matrice 4×4 affine (row-major) modèle→monde.
pub type Mat4 = [[f32; 4]; 4];

/// Identité.
#[must_use]
pub fn mat_identity() -> Mat4 {
    let mut m = [[0.0f32; 4]; 4];
    for (i, row) in m.iter_mut().enumerate() {
        row[i] = 1.0;
    }
    m
}

/// Produit `a·b`.
#[must_use]
pub fn mat_mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut m = [[0.0f32; 4]; 4];
    for (i, row) in m.iter_mut().enumerate() {
        for (j, cell) in row.iter_mut().enumerate() {
            *cell = (0..4).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    m
}

/// Translation.
#[must_use]
pub fn mat_translate(t: V3) -> Mat4 {
    let mut m = mat_identity();
    m[0][3] = t[0];
    m[1][3] = t[1];
    m[2][3] = t[2];
    m
}

/// Échelle uniforme.
#[must_use]
pub fn mat_scale(s: f32) -> Mat4 {
    let mut m = mat_identity();
    m[0][0] = s;
    m[1][1] = s;
    m[2][2] = s;
    m
}

/// Rotation autour de Y (le « cap » d'un personnage).
#[must_use]
pub fn mat_rot_y(a: f32) -> Mat4 {
    let (c, s) = (a.cos(), a.sin());
    let mut m = mat_identity();
    m[0][0] = c;
    m[0][2] = s;
    m[2][0] = -s;
    m[2][2] = c;
    m
}

fn xform(m: &Mat4, p: V3) -> V3 {
    [
        m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
        m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
        m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3],
    ]
}

/// Une instance de modèle texturé placée dans le monde (modèle GLB + transform modèle→monde).
pub struct Instance<'a> {
    pub model: &'a crate::glb::Model,
    pub transform: Mat4,
}

/// Rendu de scène **plate uniquement** (triangles colorés). Conservé pour le match « boîtes ».
#[must_use]
pub fn render_world(
    tris: &[Tri],
    cam: &Camera,
    w: u32,
    h: u32,
    bg_top: [u8; 3],
    bg_bot: [u8; 3],
) -> Vec<u8> {
    render_scene(tris, &[], cam, w, h, bg_top, bg_bot)
}

/// Compositeur de scène **unifié** : triangles plats (terrain/lignes/buts) **et** instances de
/// modèles **texturés** (vrais personnages), partageant la même caméra et le même z-buffer.
/// Fond : dégradé vertical `bg_top`→`bg_bot`.
#[must_use]
pub fn render_scene(
    flat: &[Tri],
    instances: &[Instance],
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
    let lambert = |wa: V3, wb: V3, wc: V3, lo: f32| -> f32 {
        let n = normv(cross(sub(wb, wa), sub(wc, wa)));
        lo + (1.0 - lo) * dot(n, light).abs()
    };

    // 1) Triangles plats (deux-faces : terrain vu de dessus).
    for tri in flat {
        let (Some(a), Some(b), Some(c)) = (project(tri.p[0]), project(tri.p[1]), project(tri.p[2]))
        else {
            continue;
        };
        let shade = lambert(tri.p[0], tri.p[1], tri.p[2], 0.45);
        let col = [
            (f32::from(tri.color[0]) * shade) as u8,
            (f32::from(tri.color[1]) * shade) as u8,
            (f32::from(tri.color[2]) * shade) as u8,
            255u8,
        ];
        fill(&mut px, &mut zbuf, w, h, a, b, c, col);
    }

    // 2) Instances de modèles texturés (vrais personnages), transformées en espace monde.
    for inst in instances {
        for prim in &inst.model.primitives {
            let tex = prim.texture.and_then(|t| inst.model.textures.get(t));
            for tri in prim.indices.chunks_exact(3) {
                let (ia, ib, ic) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
                if ia.max(ib).max(ic) >= prim.positions.len() {
                    continue;
                }
                let wa = xform(&inst.transform, prim.positions[ia]);
                let wb = xform(&inst.transform, prim.positions[ib]);
                let wc = xform(&inst.transform, prim.positions[ic]);
                let (Some(a), Some(b), Some(c)) = (project(wa), project(wb), project(wc)) else {
                    continue;
                };
                // Backface culling (aire signée écran), comme le rendu mono-modèle.
                if (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0) <= 0.0 {
                    continue;
                }
                let shade = lambert(wa, wb, wc, 0.35);
                let uv = if tex.is_some() && ia < prim.uv.len() && ic < prim.uv.len() {
                    [prim.uv[ia], prim.uv[ib], prim.uv[ic]]
                } else {
                    [[0.0, 0.0]; 3]
                };
                let use_tex = if uv == [[0.0, 0.0]; 3] { None } else { tex };
                fill_tex(&mut px, &mut zbuf, w, h, a, b, c, uv, use_tex, shade);
            }
        }
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

/// Remplit un triangle texturé (UV perspective-correct, cutout alpha) — instances de personnages.
#[allow(clippy::too_many_arguments)]
fn fill_tex(
    px: &mut [u8],
    zbuf: &mut [f32],
    w: u32,
    h: u32,
    a: (f32, f32, f32),
    b: (f32, f32, f32),
    c: (f32, f32, f32),
    uv: [[f32; 2]; 3],
    tex: Option<&crate::glb::Texture>,
    shade: f32,
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
    let clay = [206.0 * shade, 198.0 * shade, 188.0 * shade];
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
            if depth >= zbuf[zi] {
                continue;
            }
            let col = if let Some(t) = tex {
                let invz = w0 / a.2 + w1 / b.2 + w2 / c.2;
                let u = (w0 * uv[0][0] / a.2 + w1 * uv[1][0] / b.2 + w2 * uv[2][0] / c.2) / invz;
                let v = (w0 * uv[0][1] / a.2 + w1 * uv[1][1] / b.2 + w2 * uv[2][1] / c.2) / invz;
                let s = crate::render::sample(t, u, v);
                if s[3] < 8 {
                    continue;
                }
                [
                    (f32::from(s[0]) * shade) as u8,
                    (f32::from(s[1]) * shade) as u8,
                    (f32::from(s[2]) * shade) as u8,
                    255,
                ]
            } else {
                [clay[0] as u8, clay[1] as u8, clay[2] as u8, 255]
            };
            zbuf[zi] = depth;
            let i = zi * 4;
            px[i..i + 4].copy_from_slice(&col);
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

    #[test]
    fn instance_texturee_dans_la_scene() {
        use crate::glb::{Model, Primitive, Texture};
        // Un triangle texturé rouge face caméra, instancié à l'origine (transform identité).
        let model = Model {
            primitives: vec![Primitive {
                positions: vec![[-0.6, 0.0, 0.0], [0.6, 0.0, 0.0], [0.0, 1.2, 0.0]],
                normals: vec![[0.0, 0.0, 1.0]; 3],
                uv: vec![[0.0, 1.0], [1.0, 1.0], [0.5, 0.0]],
                indices: vec![0, 2, 1], // front-facing (cf. backface culling)
                texture: Some(0),
            }],
            textures: vec![Texture { width: 1, height: 1, rgba: vec![230, 40, 40, 255] }],
        };
        let cam = Camera { eye: [0.0, 0.6, 3.0], target: [0.0, 0.6, 0.0], up: [0.0, 1.0, 0.0], fov_y: 0.8 };
        let inst = [Instance { model: &model, transform: mat_identity() }];
        let buf = render_scene(&[], &inst, &cam, 96, 96, [20, 24, 40], [20, 24, 40]);
        let red = buf.chunks_exact(4).filter(|p| p[0] > 90 && p[0] > p[1] + 40 && p[0] > p[2] + 40).count();
        assert!(red > 30, "le triangle texturé rouge instancié doit apparaître ({red})");
    }
}
