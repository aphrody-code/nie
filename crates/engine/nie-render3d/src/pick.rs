//! Ray picking against a composed [`Model`] — what a viewport needs to answer a click.
//!
//! A viewport that cannot say WHICH surface was clicked is a picture, not an editor. Until this
//! module existed, the only implementation of that answer in this repository was the browser's
//! three.js `Raycaster`, which meant the editing viewport could not run on this renderer and the
//! two could not be merged.
//!
//! ## The camera is the reference camera, not another one
//!
//! [`ray_for_pixel`] inverts EXACTLY the projection [`crate::render::render`] applies — same
//! `FOCALE`, same `DISTANCE_CAMERA`, same `TILT`, same `w * 0.5` scale on both axes. A picking ray
//! derived from its own copy of those constants selects a surface next to the one under the
//! cursor, and the error grows with the angle, so it reads as a flaky hit test rather than as two
//! cameras. `un_pixel_du_modele_touche_le_modele` pins the two together by rendering and picking
//! the same frame.
//!
//! ## Both faces count
//!
//! The CPU rasteriser culls back faces; the GPU path does not, because the game's meshes have
//! inconsistent winding (see the crate docs). Picking is therefore double-sided: an editor must
//! select what the user SEES, and on the GPU viewport that includes a back face.

use crate::glb::Model;
use crate::vecmath::{V3, cross, dot, sub};

/// A ray in world space. `direction` need not be normalised; distances are expressed in its units.
#[derive(Clone, Copy, Debug)]
pub struct Ray {
    pub origin: V3,
    pub direction: V3,
}

/// The surface a ray met.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    /// Index into [`Model::primitives`].
    pub primitive: usize,
    /// Rank of the triangle inside that primitive's index buffer.
    pub triangle: usize,
    /// Distance along [`Ray::direction`], in its units.
    pub distance: f32,
    /// World-space point of contact.
    pub point: V3,
}

/// Möller–Trumbore, double-sided, rejecting degenerate triangles and hits behind the origin.
///
/// Returns the distance along `ray.direction`.
#[must_use]
pub fn ray_triangle(ray: &Ray, a: V3, b: V3, c: V3) -> Option<f32> {
    let edge1 = sub(b, a);
    let edge2 = sub(c, a);
    let pvec = cross(ray.direction, edge2);
    let determinant = dot(edge1, pvec);
    // Parallel to the triangle's plane, or a triangle with no area: no single point of contact.
    if determinant.abs() < 1e-12 {
        return None;
    }
    let inverse = 1.0 / determinant;
    let tvec = sub(ray.origin, a);
    let u = dot(tvec, pvec) * inverse;
    if !(-1e-6..=1.0 + 1e-6).contains(&u) {
        return None;
    }
    let qvec = cross(tvec, edge1);
    let v = dot(ray.direction, qvec) * inverse;
    if v < -1e-6 || u + v > 1.0 + 1e-6 {
        return None;
    }
    let distance = dot(edge2, qvec) * inverse;
    (distance > 1e-6 && distance.is_finite()).then_some(distance)
}

/// The nearest surface of `model` the ray meets.
///
/// Triangles whose indices fall outside the primitive's vertex buffer are skipped, exactly as the
/// rasteriser skips them: a malformed GLB must not be pickable where it is not drawable.
#[must_use]
pub fn pick(model: &Model, ray: &Ray) -> Option<Hit> {
    let mut nearest: Option<Hit> = None;
    for (primitive_index, primitive) in model.primitives.iter().enumerate() {
        for (triangle, corners) in primitive.indices.chunks_exact(3).enumerate() {
            let (ia, ib, ic) = (
                corners[0] as usize,
                corners[1] as usize,
                corners[2] as usize,
            );
            let count = primitive.positions.len();
            if ia >= count || ib >= count || ic >= count {
                continue;
            }
            let (a, b, c) = (
                primitive.positions[ia],
                primitive.positions[ib],
                primitive.positions[ic],
            );
            let Some(distance) = ray_triangle(ray, a, b, c) else {
                continue;
            };
            if nearest.is_some_and(|hit| hit.distance <= distance) {
                continue;
            }
            nearest = Some(Hit {
                primitive: primitive_index,
                triangle,
                distance,
                point: [
                    ray.origin[0] + ray.direction[0] * distance,
                    ray.origin[1] + ray.direction[1] * distance,
                    ray.origin[2] + ray.direction[2] * distance,
                ],
            });
        }
    }
    nearest
}

/// Where an orbital camera sits and how it is oriented, in world space.
///
/// One definition, read by both the matrix that DRAWS the frame ([`crate::gpu`]) and the ray that
/// picks in it. They were written separately at first, and two orbital cameras agreeing on the
/// first frame is not evidence: a sign error on `right` only shows when the yaw leaves zero.
#[derive(Clone, Copy, Debug)]
pub struct OrbitalBasis {
    /// Camera position.
    pub eye: V3,
    /// Unit vector from the eye towards the target.
    pub forward: V3,
    /// Unit vector towards the right of the image.
    pub right: V3,
    /// Unit vector towards the top of the image.
    pub up: V3,
}

/// The basis of the orbital camera aiming at `center` from `distance` bounding radii away.
///
/// `yaw`, `pitch` and `distance` are the fields of the GPU path's `Camera`.
#[must_use]
pub fn orbital_basis(center: V3, radius: f32, yaw: f32, pitch: f32, distance: f32) -> OrbitalBasis {
    let radius = radius.max(1e-3);
    let span = distance * radius;
    let (cy, sy) = (yaw.cos(), yaw.sin());
    let (cp, sp) = (pitch.cos(), pitch.sin());
    let eye = [
        span.mul_add(cp * sy, center[0]),
        span.mul_add(sp, center[1]),
        span.mul_add(cp * cy, center[2]),
    ];
    let forward = crate::vecmath::normv(sub(center, eye));
    let right = crate::vecmath::normv(cross(forward, [0.0, 1.0, 0.0]));
    let up = cross(right, forward);
    OrbitalBasis {
        eye,
        forward,
        right,
        up,
    }
}

/// The world-space ray through pixel `(x, y)` for the ORBITAL camera the GPU path uses.
///
/// That path is the one every browser surface renders with, so it is the one a click must be
/// inverted against. It does not frame identically to [`ray_for_pixel`]: measured on
/// 2026-09-13, the CPU rasteriser scales both screen axes by `w * 0.5`, fixing its HORIZONTAL
/// half-angle at `atan(1 / FOCALE)`, while the GPU passes `fovy = 2 * atan(1 / FOCALE)` and fixes
/// its VERTICAL one. The two agree on a square viewport and nowhere else, so picking cannot share
/// one inversion between them.
#[must_use]
pub fn ray_for_pixel_orbital(basis: &OrbitalBasis, x: f32, y: f32, w: u32, h: u32) -> Ray {
    // A hidden canvas reports 0x0; a division by it would send NaN into every later comparison,
    // which reads as "nothing is pickable" rather than as a degenerate viewport.
    #[allow(clippy::cast_precision_loss)]
    let width = if w == 0 { 1.0 } else { w as f32 };
    #[allow(clippy::cast_precision_loss)]
    let height = if h == 0 { 1.0 } else { h as f32 };
    let aspect = width / height;
    // Normalised device coordinates, `y` upwards, from pixels with `y` downwards.
    let ndc_x = 2.0 * x / width - 1.0;
    let ndc_y = 1.0 - 2.0 * y / height;
    // The projection is `f = FOCALE` on the vertical axis and `f / aspect` on the horizontal one,
    // so a unit step of depth spans `aspect / FOCALE` across and `1 / FOCALE` up.
    let across = ndc_x * aspect / crate::render::FOCALE;
    let upwards = ndc_y / crate::render::FOCALE;
    let direction = std::array::from_fn(|k| {
        basis.right[k].mul_add(across, basis.up[k].mul_add(upwards, basis.forward[k]))
    });
    Ray {
        origin: basis.eye,
        direction,
    }
}

/// Undo [`crate::render`]'s orientation: inverse tilt about X, then inverse turntable about Y.
fn unorient(v: V3, cy: f32, sy: f32, cx: f32, sx: f32) -> V3 {
    // Inverse of the X tilt.
    let y = v[1] * cx + v[2] * sx;
    let z = -v[1] * sx + v[2] * cx;
    // Inverse of the Y turntable.
    let x = v[0] * cy - z * sy;
    let z = v[0] * sy + z * cy;
    [x, y, z]
}

/// The world-space ray through pixel `(x, y)` of a `w`×`h` image of `model` seen at `angle`.
///
/// `x` and `y` are in pixels, with `y` downwards, as they arrive from a pointer event.
#[must_use]
pub fn ray_for_pixel(model: &Model, angle: f32, x: f32, y: f32, w: u32, h: u32) -> Ray {
    let (center, radius) = crate::render::bounds(model);
    let (cy, sy) = (angle.cos(), angle.sin());
    let (cx, sx) = (crate::render::TILT.cos(), crate::render::TILT.sin());
    // The rasteriser scales BOTH axes by `w * 0.5`; reusing `h` here would skew every pick on a
    // non-square viewport, and only on a non-square one.
    #[allow(clippy::cast_precision_loss)]
    let scale = w as f32 * 0.5;
    #[allow(clippy::cast_precision_loss)]
    let (half_w, half_h) = (w as f32 * 0.5, h as f32 * 0.5);
    let u = (x - half_w) / (crate::render::FOCALE * scale);
    let v = (half_h - y) / (crate::render::FOCALE * scale);

    // In oriented, normalised space the camera sits on +z and looks down -z: a point at depth `t`
    // is `(u * t, v * t, DISTANCE_CAMERA - t)`, so the direction is `(u, v, -1)`.
    let origin = unorient([0.0, 0.0, crate::render::DISTANCE_CAMERA], cy, sy, cx, sx);
    let direction = unorient([u, v, -1.0], cy, sy, cx, sx);
    Ray {
        // Back to world units: the projection normalises by the bounding radius about the centre.
        origin: [
            origin[0] * radius + center[0],
            origin[1] * radius + center[1],
            origin[2] * radius + center[2],
        ],
        direction: [
            direction[0] * radius,
            direction[1] * radius,
            direction[2] * radius,
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::glb::{Model, Primitive};

    fn quad(z: f32, texture: Option<usize>) -> Primitive {
        Primitive {
            positions: vec![
                [-1.0, -1.0, z],
                [1.0, -1.0, z],
                [1.0, 1.0, z],
                [-1.0, 1.0, z],
            ],
            normals: vec![[0.0, 0.0, 1.0]; 4],
            uv: vec![[0.0, 0.0]; 4],
            indices: vec![0, 1, 2, 0, 2, 3],
            texture,
        }
    }

    #[test]
    fn un_rayon_traverse_le_triangle_a_la_bonne_distance() {
        let ray = Ray {
            origin: [0.0, 0.0, 5.0],
            direction: [0.0, 0.0, -1.0],
        };
        let distance = ray_triangle(&ray, [-1.0, -1.0, 0.0], [1.0, -1.0, 0.0], [1.0, 1.0, 0.0]);
        assert!((distance.unwrap() - 5.0).abs() < 1e-5);
    }

    #[test]
    fn un_rayon_a_cote_ne_touche_rien() {
        let ray = Ray {
            origin: [4.0, 4.0, 5.0],
            direction: [0.0, 0.0, -1.0],
        };
        assert!(ray_triangle(&ray, [-1.0, -1.0, 0.0], [1.0, -1.0, 0.0], [1.0, 1.0, 0.0]).is_none());
    }

    #[test]
    fn une_face_arriere_compte_aussi() {
        // Même triangle, parcouru dans l'autre sens : le rastériseur CPU l'écarterait, le
        // viewport GPU le dessine, donc la sélection doit l'atteindre.
        let ray = Ray {
            origin: [0.0, 0.0, 5.0],
            direction: [0.0, 0.0, -1.0],
        };
        assert!(ray_triangle(&ray, [1.0, 1.0, 0.0], [1.0, -1.0, 0.0], [-1.0, -1.0, 0.0]).is_some());
    }

    #[test]
    fn un_triangle_degenere_ne_touche_rien() {
        let ray = Ray {
            origin: [0.0, 0.0, 5.0],
            direction: [0.0, 0.0, -1.0],
        };
        assert!(ray_triangle(&ray, [0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]).is_none());
    }

    #[test]
    fn ce_qui_est_devant_gagne() {
        let model = Model {
            primitives: vec![quad(0.0, None), quad(2.0, None)],
            textures: vec![],
        };
        let ray = Ray {
            origin: [0.0, 0.0, 5.0],
            direction: [0.0, 0.0, -1.0],
        };
        let hit = pick(&model, &ray).unwrap();
        assert_eq!(hit.primitive, 1);
        assert!((hit.distance - 3.0).abs() < 1e-5);
        assert!((hit.point[2] - 2.0).abs() < 1e-5);
    }

    #[test]
    fn un_indice_hors_bornes_est_saute_comme_au_rendu() {
        let mut primitive = quad(0.0, None);
        primitive.indices = vec![0, 1, 99];
        let model = Model {
            primitives: vec![primitive],
            textures: vec![],
        };
        let ray = Ray {
            origin: [0.0, 0.0, 5.0],
            direction: [0.0, 0.0, -1.0],
        };
        assert!(pick(&model, &ray).is_none());
    }

    #[test]
    fn un_pixel_du_modele_touche_le_modele() {
        // Le verrou entre les deux : on RESTITUE l'image, on relève un pixel qui n'est pas du
        // fond, et le rayon de ce pixel doit toucher. Deux caméras qui divergent font échouer ce
        // test et rien d'autre.
        // Une feuille à DEUX faces : un quad seul disparaît dès qu'on passe derrière, puisque le
        // rastériseur écarte les faces arrière, et le test mesurerait alors une image vide.
        let mut back = quad(0.0, None);
        back.indices = vec![2, 1, 0, 3, 2, 0];
        let model = Model {
            primitives: vec![quad(0.0, None), back],
            textures: vec![],
        };
        let (w, h) = (64, 48);
        for angle in [0.0_f32, 0.7, -1.3, 2.9] {
            let pixels = crate::render::render(&model, angle, w, h);
            let mut touches = 0;
            let mut peints = 0;
            for y in 0..h {
                for x in 0..w {
                    let index = ((y * w + x) * 4) as usize;
                    let fond = crate::render::couleur_fond(y, h);
                    if pixels[index..index + 4] == fond {
                        continue;
                    }
                    peints += 1;
                    #[allow(clippy::cast_precision_loss)]
                    let ray = ray_for_pixel(&model, angle, x as f32 + 0.5, y as f32 + 0.5, w, h);
                    if pick(&model, &ray).is_some() {
                        touches += 1;
                    }
                }
            }
            assert!(peints > 50, "angle {angle} ne dessine presque rien : {peints}");
            // Le rastériseur écarte les faces arrière, la sélection non : tout pixel peint doit
            // être touchable. On tolère le liseré d'anticrénelage du bord.
            assert!(
                touches * 100 >= peints * 98,
                "angle {angle} : {touches} touches sur {peints} pixels peints"
            );
        }
    }

    #[test]
    fn la_base_orbitale_regarde_la_cible_avec_un_triedre_direct() {
        let basis = orbital_basis([0.0, 0.0, 0.0], 1.0, 0.0, 0.0, 3.0);
        assert!((basis.eye[2] - 3.0).abs() < 1e-5, "{:?}", basis.eye);
        assert!((basis.forward[2] + 1.0).abs() < 1e-5, "{:?}", basis.forward);
        assert!((basis.right[0] - 1.0).abs() < 1e-5, "{:?}", basis.right);
        assert!((basis.up[1] - 1.0).abs() < 1e-5, "{:?}", basis.up);
        // Trièdre orthonormé : `up` est exactement `right x forward`, pas une troisième mesure.
        let expected_up = cross(basis.right, basis.forward);
        for (measured, expected) in basis.up.iter().zip(expected_up) {
            assert!((measured - expected).abs() < 1e-5);
        }
    }

    #[test]
    fn le_pixel_central_vise_le_centre_du_modele() {
        let model = Model {
            primitives: vec![quad(0.0, None)],
            textures: vec![],
        };
        let (center, radius) = crate::render::bounds(&model);
        for (yaw, pitch) in [(0.0_f32, 0.0_f32), (1.1, 0.3), (-2.4, -0.5)] {
            let basis = orbital_basis(center, radius, yaw, pitch, 3.1);
            let ray = ray_for_pixel_orbital(&basis, 64.0, 24.0, 128, 48);
            let hit = pick(&model, &ray).expect("le centre vise le modèle");
            for k in 0..3 {
                assert!(
                    (hit.point[k] - center[k]).abs() < 1e-3,
                    "lacet {yaw} tangage {pitch} : {:?} loin de {center:?}",
                    hit.point
                );
            }
        }
    }

    /// Reprojette un point du monde vers le pixel, sous forme matricielle, pour refermer la boucle.
    fn project(basis: &OrbitalBasis, point: V3, w: u32, h: u32) -> (f32, f32) {
        #[allow(clippy::cast_precision_loss)]
        let (width, height) = (w as f32, h as f32);
        let aspect = width / height;
        let relative = sub(point, basis.eye);
        let depth = dot(relative, basis.forward);
        let ndc_x = crate::render::FOCALE / aspect * dot(relative, basis.right) / depth;
        let ndc_y = crate::render::FOCALE * dot(relative, basis.up) / depth;
        ((ndc_x + 1.0) * width * 0.5, (1.0 - ndc_y) * height * 0.5)
    }

    #[test]
    fn le_pixel_revient_sur_lui_meme_apres_un_aller_retour() {
        // Viewport NON carré, exprès : une erreur d'aspect est invisible en 1:1, et c'est
        // exactement l'écart mesuré entre les deux projections de ce dépôt.
        let (w, h) = (160u32, 90u32);
        let model = Model {
            primitives: vec![quad(0.0, None)],
            textures: vec![],
        };
        let (center, radius) = crate::render::bounds(&model);
        for (yaw, pitch) in [(0.0_f32, 0.0_f32), (0.6, 0.2), (-1.2, 0.4), (2.5, -0.3)] {
            let basis = orbital_basis(center, radius, yaw, pitch, 3.1);
            for (x, y) in [(80.0, 45.0), (70.0, 38.0), (95.0, 52.0)] {
                let ray = ray_for_pixel_orbital(&basis, x, y, w, h);
                let Some(hit) = pick(&model, &ray) else {
                    continue;
                };
                let (rx, ry) = project(&basis, hit.point, w, h);
                assert!(
                    (rx - x).abs() < 0.01 && (ry - y).abs() < 0.01,
                    "lacet {yaw} : ({x}, {y}) revient en ({rx}, {ry})"
                );
            }
        }
    }

    #[test]
    fn un_pixel_du_fond_ne_touche_rien() {
        let model = Model {
            primitives: vec![quad(0.0, None)],
            textures: vec![],
        };
        let ray = ray_for_pixel(&model, 0.0, 1.0, 1.0, 64, 48);
        assert!(pick(&model, &ray).is_none());
    }
}
