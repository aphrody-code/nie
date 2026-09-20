//! Rendu **de scène** en espace monde : une caméra look-at + une liste de triangles colorés
//! déjà placés dans le monde (terrain, joueurs, ballon, buts…). C'est la généralisation « scène »
//! du rastériseur mono-modèle de [`render`](crate::render) : au lieu de normaliser un objet centré,
//! on projette un monde entier sous une caméra arbitraire. Brique de base du **match 3D** et, à
//! terme, des **maps/scènes** du jeu. Z-buffer, éclairage Lambert deux-faces, fond dégradé.

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]

use std::collections::BTreeSet;

use crate::vecmath::{V3, cross, dot, normv, sub};

/// Caméra perspective look-at. `fov_y` en radians (champ vertical).
pub struct Camera {
    pub eye: V3,
    pub target: V3,
    pub up: V3,
    pub fov_y: f32,
}

/// Un triangle du monde, couleur plate (l'éclairage Lambert la module).
#[derive(Clone, Copy)]
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

/// Notre [`Mat4`] est **ligne-majeure** (`m[ligne][colonne]`), `glam` est colonne-majeure.
/// Ces deux conversions sont le seul endroit du dépôt où la transposition a lieu.
#[must_use]
pub(crate) fn vers_glam(m: &Mat4) -> glam::Mat4 {
    glam::Mat4::from_cols_array_2d(&[
        [m[0][0], m[1][0], m[2][0], m[3][0]],
        [m[0][1], m[1][1], m[2][1], m[3][1]],
        [m[0][2], m[1][2], m[2][2], m[3][2]],
        [m[0][3], m[1][3], m[2][3], m[3][3]],
    ])
}

/// L'inverse de [`vers_glam`].
#[must_use]
pub(crate) fn depuis_glam(g: &glam::Mat4) -> Mat4 {
    let c = g.to_cols_array_2d();
    [
        [c[0][0], c[1][0], c[2][0], c[3][0]],
        [c[0][1], c[1][1], c[2][1], c[3][1]],
        [c[0][2], c[1][2], c[2][2], c[3][2]],
        [c[0][3], c[1][3], c[2][3], c[3][3]],
    ]
}

/// Produit `a·b`.
///
/// Le calcul est délégué à `glam`, épinglé en **`scalar-math`** — SIMD désactivé, donc ordre des
/// opérations flottantes figé. Ce n'est pas gratuit : sur le chemin de fidélité, un réordonnancement
/// décale l'octet et donc le golden. L'équivalence est prouvée sur les BITS, pas à epsilon près
/// (`glam_en_scalar_math_multiplie_comme_nous_bit_pour_bit`, et sur cinquante compositions).
///
/// La signature garde des tableaux : `nie-app` et `nie-runtime` appellent ces fonctions, et leur
/// imposer un type de `glam` serait une migration bien plus large que la suppression d'une
/// arithmétique dupliquée.
#[must_use]
pub fn mat_mul(a: &Mat4, b: &Mat4) -> Mat4 {
    depuis_glam(&(vers_glam(a) * vers_glam(b)))
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
/// `two_sided` désactive le backface culling (nécessaire pour les coquilles d'environnement/maps).
pub struct Instance<'a> {
    pub model: &'a crate::glb::Model,
    pub transform: Mat4,
    pub two_sided: bool,
}

/// Un segment de droite en espace monde.
///
/// C'est la primitive qui manquait au rendu Rust pour qu'un éditeur 3D tienne sans second
/// rastériseur : **grille**, **fil de fer** et **contour de sélection** sont tous des segments.
/// Le viewport three.js de l'éditeur web les obtenait de `GridHelper`, d'un matériau
/// `wireframe` et d'un contour ; c'est la seule raison pour laquelle il survivait à côté de
/// `nie-render3d`.
#[derive(Clone, Copy, Debug)]
pub struct Segment {
    /// Première extrémité, en espace monde.
    pub a: V3,
    /// Seconde extrémité.
    pub b: V3,
    /// Couleur RGB.
    pub color: [u8; 3],
    /// Épaisseur en pixels écran (bornée à `1..=8` ; un trait de zéro pixel ne se voit pas, et
    /// au-delà de huit c'est un quadrilatère qu'il faut, pas un segment épaissi).
    pub width: u8,
    /// `true` : le segment est masqué par la géométrie devant lui — une grille de sol doit
    /// passer derrière les objets posés dessus.
    ///
    /// `false` : dessiné par-dessus tout. C'est ce que veut un contour de sélection, qui doit
    /// rester visible même quand l'objet sélectionné est derrière un autre — sans quoi
    /// sélectionner un objet caché ne montre rien et se lit comme un clic sans effet.
    pub depth_test: bool,
}

impl Segment {
    /// Un segment d'un pixel, testé en profondeur.
    #[must_use]
    pub fn new(a: V3, b: V3, color: [u8; 3]) -> Self {
        Self {
            a,
            b,
            color,
            width: 1,
            depth_test: true,
        }
    }

    /// Le même, dessiné par-dessus la géométrie.
    #[must_use]
    pub fn overlay(mut self) -> Self {
        self.depth_test = false;
        self
    }

    /// Le même, à l'épaisseur voulue.
    #[must_use]
    pub fn with_width(mut self, width: u8) -> Self {
        self.width = width;
        self
    }
}

/// Grille de sol centrée sur l'origine, dans le plan `y = height`.
///
/// `half_extent` est la demi-taille en unités monde, `step` l'écart entre deux lignes. Les deux
/// axes principaux (X et Z) reçoivent `axis_color` pour que l'orientation se lise sans repère
/// extérieur — c'est ce que fait `GridHelper` de three.js, et un éditeur sans axes colorés
/// oblige à deviner où est l'origine.
///
/// Rend un vecteur vide si `step` n'est pas fini ou n'est pas strictement positif : une grille
/// au pas nul demanderait une infinité de lignes.
#[must_use]
pub fn grid_segments(
    half_extent: f32,
    step: f32,
    height: f32,
    color: [u8; 3],
    axis_color: [u8; 3],
) -> Vec<Segment> {
    if !step.is_finite() || step <= 0.0 || !half_extent.is_finite() || half_extent <= 0.0 {
        return Vec::new();
    }
    let lignes = (half_extent / step) as i32;
    let mut out = Vec::with_capacity(((lignes * 2 + 1) * 2) as usize);
    for i in -lignes..=lignes {
        let d = i as f32 * step;
        let sur_axe = i == 0;
        let teinte = if sur_axe { axis_color } else { color };
        let epaisseur = if sur_axe { 2 } else { 1 };
        // Parallèle à Z (varie en x), puis parallèle à X (varie en z).
        out.push(
            Segment::new(
                [d, height, -half_extent],
                [d, height, half_extent],
                teinte,
            )
            .with_width(epaisseur),
        );
        out.push(
            Segment::new(
                [-half_extent, height, d],
                [half_extent, height, d],
                teinte,
            )
            .with_width(epaisseur),
        );
    }
    out
}

/// Arêtes d'un modèle, en fil de fer.
///
/// Chaque triangle donne trois arêtes ; les arêtes partagées entre deux triangles adjacents sont
/// **dédupliquées**, sans quoi un maillage fermé tracerait chaque arête intérieure deux fois —
/// deux fois le coût, et un trait deux fois plus opaque là où deux faces se rejoignent, ce qui
/// se lit comme un défaut d'éclairage.
///
/// La paire `(min, max)` d'indices sert de clé : une arête `a→b` et son opposée `b→a` sont la
/// même arête, et c'est exactement ainsi qu'elles apparaissent sur deux triangles voisins
/// correctement orientés.
///
/// `limit` borne le nombre de segments rendus. Un personnage du jeu porte plusieurs dizaines de
/// milliers de triangles : les tracer tous noie l'image et coûte un téléversement inutile. Passer
/// `usize::MAX` retire la borne.
#[must_use]
pub fn wireframe_segments(model: &crate::glb::Model, color: [u8; 3], limit: usize) -> Vec<Segment> {
    let mut vues: BTreeSet<(u32, u32)> = BTreeSet::new();
    let mut out = Vec::new();
    for prim in &model.primitives {
        for tri in prim.indices.chunks_exact(3) {
            for (x, y) in [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
                if out.len() >= limit {
                    return out;
                }
                let cle = if x <= y { (x, y) } else { (y, x) };
                if !vues.insert(cle) {
                    continue;
                }
                let (Some(a), Some(b)) = (
                    prim.positions.get(x as usize),
                    prim.positions.get(y as usize),
                ) else {
                    continue; // indice hors table : on saute plutôt que de paniquer au rendu
                };
                out.push(Segment::new(*a, *b, color));
            }
        }
        // Les indices sont locaux à chaque primitive : repartir d'un ensemble vide évite qu'une
        // arête de la primitive suivante soit prise pour un doublon de la précédente.
        vues.clear();
    }
    out
}

/// Arêtes d'une boîte alignée sur les axes — le contour de sélection d'un objet.
///
/// Les douze arêtes sont marquées en superposition ([`Segment::overlay`]) : une boîte de
/// sélection masquée par l'objet qu'elle entoure ne sélectionne rien de visible.
#[must_use]
pub fn box_segments(min: V3, max: V3, color: [u8; 3]) -> Vec<Segment> {
    let coin = |i: usize| -> V3 {
        [
            if i & 1 == 0 { min[0] } else { max[0] },
            if i & 2 == 0 { min[1] } else { max[1] },
            if i & 4 == 0 { min[2] } else { max[2] },
        ]
    };
    // Deux coins sont reliés si et seulement si leurs indices diffèrent d'un seul bit : c'est la
    // définition d'une arête d'hypercube, et elle donne exactement douze paires en dimension 3.
    let mut out = Vec::with_capacity(12);
    for i in 0..8usize {
        for bit in [1usize, 2, 4] {
            let j = i | bit;
            if j != i {
                out.push(Segment::new(coin(i), coin(j), color).overlay());
            }
        }
    }
    out
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
    render_scene_with_lines(flat, instances, &[], cam, w, h, bg_top, bg_bot)
}

/// Le même compositeur, plus une passe de **segments** (grille, fil de fer, sélection).
///
/// Les segments sont dessinés APRÈS la géométrie et partagent son z-buffer, mais ne l'écrivent
/// pas : deux traits qui se croisent ne se masquent donc pas l'un l'autre, et un contour de
/// sélection ne creuse pas de trou dans la profondeur pour ce qui serait dessiné ensuite.
///
/// [`render_scene`] délègue ici avec une tranche vide : aucun appelant existant ne change.
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn render_scene_with_lines(
    flat: &[Tri],
    instances: &[Instance],
    segments: &[Segment],
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
        let bg = [
            mix(bg_top[0], bg_bot[0]),
            mix(bg_top[1], bg_bot[1]),
            mix(bg_top[2], bg_bot[2]),
            255,
        ];
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            px[i..i + 4].copy_from_slice(&bg);
        }
    }
    let mut zbuf = vec![f32::INFINITY; (w * h) as usize];

    // Monde → espace caméra (x droite, y haut, z profondeur avant). Le clipping du plan proche
    // se fait ICI (avant la division perspective) : un grand triangle traversant la caméra est
    // découpé, pas rejeté — indispensable aux caméras rapprochées/intérieures (maps, cutscenes).
    let cam_space = |p: V3| -> [f32; 3] {
        let v = sub(p, cam.eye);
        [dot(v, r), dot(v, u), dot(v, f)]
    };
    let to_screen = |cs: [f32; 3]| -> (f32, f32, f32) {
        let sx = w as f32 * 0.5 + cs[0] / cs[2] * focal * scale;
        let sy = h as f32 * 0.5 - cs[1] / cs[2] * focal * scale;
        (sx, sy, cs[2])
    };
    let lambert = |wa: V3, wb: V3, wc: V3, lo: f32| -> f32 {
        let n = normv(cross(sub(wb, wa), sub(wc, wa)));
        lo + (1.0 - lo) * dot(n, light).abs()
    };

    // 1) Triangles plats (deux-faces : terrain vu de dessus).
    for tri in flat {
        let poly = clip_near(&[
            CVert::pos(cam_space(tri.p[0])),
            CVert::pos(cam_space(tri.p[1])),
            CVert::pos(cam_space(tri.p[2])),
        ]);
        if poly.len() < 3 {
            continue;
        }
        let shade = lambert(tri.p[0], tri.p[1], tri.p[2], 0.45);
        let col = [
            (f32::from(tri.color[0]) * shade) as u8,
            (f32::from(tri.color[1]) * shade) as u8,
            (f32::from(tri.color[2]) * shade) as u8,
            255u8,
        ];
        let s: Vec<_> = poly.iter().map(|v| to_screen(v.c)).collect();
        for i in 1..s.len() - 1 {
            fill(&mut px, &mut zbuf, w, h, s[0], s[i], s[i + 1], col);
        }
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
                let uv = if tex.is_some() && ia < prim.uv.len() && ic < prim.uv.len() {
                    [prim.uv[ia], prim.uv[ib], prim.uv[ic]]
                } else {
                    [[0.0, 0.0]; 3]
                };
                let poly = clip_near(&[
                    CVert {
                        c: cam_space(wa),
                        uv: uv[0],
                    },
                    CVert {
                        c: cam_space(wb),
                        uv: uv[1],
                    },
                    CVert {
                        c: cam_space(wc),
                        uv: uv[2],
                    },
                ]);
                if poly.len() < 3 {
                    continue;
                }
                let s: Vec<_> = poly.iter().map(|v| to_screen(v.c)).collect();
                // Backface culling (aire signée écran) sauf instances deux-faces (maps).
                //
                // glTF définit les faces AVANT en CCW ; l'écran a son Y vers le bas, donc cette
                // aire signée y est NÉGATIVE. Ce test gardait les positives : il écartait les
                // faces avant et dessinait l'intérieur des maillages. Mesuré le 2026-09-13 sur un
                // quad, `render::render` en peignait 1 200 pixels et `render_scene` zéro ; le quad
                // enroulé à l'envers donnait l'inverse. Le pipeline GPU ne cule rien
                // (`cull_mode: None`), donc rien ne pouvait arbitrer entre les deux.
                if !inst.two_sided
                    && (s[1].0 - s[0].0) * (s[2].1 - s[0].1) - (s[1].1 - s[0].1) * (s[2].0 - s[0].0)
                        >= 0.0
                {
                    continue;
                }
                let shade = lambert(wa, wb, wc, 0.35);
                let use_tex = if uv == [[0.0, 0.0]; 3] { None } else { tex };
                for i in 1..s.len() - 1 {
                    let uvs = [poly[0].uv, poly[i].uv, poly[i + 1].uv];
                    fill_tex(
                        &mut px,
                        &mut zbuf,
                        w,
                        h,
                        s[0],
                        s[i],
                        s[i + 1],
                        uvs,
                        use_tex,
                        shade,
                    );
                }
            }
        }
    }

    // 3) Segments, après la géométrie : ils lisent le z-buffer sans l'écrire.
    for seg in segments {
        let (mut ca, mut cb) = (cam_space(seg.a), cam_space(seg.b));
        // Clipping du plan proche, en paramétrique : un segment qui traverse la caméra est
        // raccourci, pas rejeté — une grille de sol traverse toujours le plan proche.
        let (da, db) = (ca[2] >= NEAR, cb[2] >= NEAR);
        if !da && !db {
            continue;
        }
        if !da {
            let t = (NEAR - ca[2]) / (cb[2] - ca[2]);
            ca = [
                ca[0] + (cb[0] - ca[0]) * t,
                ca[1] + (cb[1] - ca[1]) * t,
                NEAR,
            ];
        } else if !db {
            let t = (NEAR - cb[2]) / (ca[2] - cb[2]);
            cb = [
                cb[0] + (ca[0] - cb[0]) * t,
                cb[1] + (ca[1] - cb[1]) * t,
                NEAR,
            ];
        }
        trace_segment(&mut px, &zbuf, w, h, to_screen(ca), to_screen(cb), seg);
    }
    px
}

/// Trace un segment en espace écran, avec test de profondeur optionnel.
///
/// Échantillonnage par DDA sur l'axe dominant : un pixel par colonne (ou par ligne) garantit un
/// trait continu sans trou, ce qu'un pas fixe en `t` ne donne pas sur les segments obliques.
/// La profondeur est interpolée en `1/z`, comme pour les triangles — interpoler `z` linéairement
/// en écran placerait le trait devant ou derrière la géométrie selon l'angle de vue.
fn trace_segment(
    px: &mut [u8],
    zbuf: &[f32],
    w: u32,
    h: u32,
    a: (f32, f32, f32),
    b: (f32, f32, f32),
    seg: &Segment,
) {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let pas = dx.abs().max(dy.abs()).ceil().max(1.0);
    if !pas.is_finite() || pas > 1e6 {
        return; // segment dégénéré ou projeté à l'infini : rien de sensé à tracer.
    }
    let (inv_za, inv_zb) = (1.0 / a.2, 1.0 / b.2);
    let rayon = i32::from(seg.width.clamp(1, 8)) / 2;
    let n = pas as u32;
    for i in 0..=n {
        let t = f32::from(u16::try_from(i).unwrap_or(u16::MAX)) / pas;
        let sx = a.0 + dx * t;
        let sy = a.1 + dy * t;
        let inv_z = inv_za + (inv_zb - inv_za) * t;
        if inv_z <= 0.0 {
            continue;
        }
        let profondeur = 1.0 / inv_z;
        for oy in -rayon..=rayon {
            for ox in -rayon..=rayon {
                let x = sx as i32 + ox;
                let y = sy as i32 + oy;
                if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
                    continue;
                }
                let idx = (y as u32 * w + x as u32) as usize;
                if seg.depth_test && profondeur >= zbuf[idx] {
                    continue;
                }
                let o = idx * 4;
                px[o] = seg.color[0];
                px[o + 1] = seg.color[1];
                px[o + 2] = seg.color[2];
                px[o + 3] = 255;
            }
        }
    }
}

/// Sommet en espace caméra pour le clipping : position + attribut UV (interpolé aux intersections).
#[derive(Clone, Copy)]
struct CVert {
    c: [f32; 3],
    uv: [f32; 2],
}

impl CVert {
    fn pos(c: [f32; 3]) -> Self {
        Self { c, uv: [0.0, 0.0] }
    }
}

/// Distance du plan proche (espace caméra). En deçà, le sommet est derrière la caméra.
const NEAR: f32 = 0.05;

/// Découpe un polygone (triangle) contre le plan proche `z = NEAR` (Sutherland-Hodgman),
/// interpolant position ET UV aux intersections. Renvoie 0, 3 ou 4 sommets.
fn clip_near(poly: &[CVert]) -> Vec<CVert> {
    let n = poly.len();
    let mut out = Vec::with_capacity(n + 1);
    for i in 0..n {
        let s = poly[i];
        let e = poly[(i + 1) % n];
        let (sin, ein) = (s.c[2] >= NEAR, e.c[2] >= NEAR);
        if ein {
            if !sin {
                out.push(lerp_near(s, e));
            }
            out.push(e);
        } else if sin {
            out.push(lerp_near(s, e));
        }
    }
    out
}

/// Intersection de l'arête `s→e` avec le plan `z = NEAR`.
fn lerp_near(s: CVert, e: CVert) -> CVert {
    let t = (NEAR - s.c[2]) / (e.c[2] - s.c[2]);
    CVert {
        c: [
            s.c[0] + (e.c[0] - s.c[0]) * t,
            s.c[1] + (e.c[1] - s.c[1]) * t,
            NEAR,
        ],
        uv: [
            s.uv[0] + (e.uv[0] - s.uv[0]) * t,
            s.uv[1] + (e.uv[1] - s.uv[1]) * t,
        ],
    }
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

    /// Les deux rastériseurs CPU gardent la même face, celle que glTF appelle l'avant.
    ///
    /// Ils ont vécu avec des tests opposés sans que rien ne le signale : `render` écartait les
    /// aires signées positives, `render_scene` les négatives, et le pipeline GPU ne cule rien, si
    /// bien qu'aucune comparaison ne pouvait les départager. Seul `match3d` passe
    /// `two_sided: false`, donc seul lui montrait l'intérieur de ses maillages.
    #[test]
    fn les_deux_rasteriseurs_cpu_gardent_la_face_avant() {
        let quad = |indices: Vec<u32>| crate::glb::Model {
            primitives: vec![crate::glb::Primitive {
                positions: vec![
                    [-1.0, -1.0, 0.0],
                    [1.0, -1.0, 0.0],
                    [1.0, 1.0, 0.0],
                    [-1.0, 1.0, 0.0],
                ],
                normals: vec![[0.0, 0.0, 1.0]; 4],
                uv: Vec::new(),
                indices,
                texture: None,
            }],
            textures: Vec::new(),
        };
        let (w, h) = (64u32, 64u32);

        let peints_reference = |model: &crate::glb::Model| {
            let px = crate::render::render(model, 0.0, w, h);
            (0..h)
                .map(|y| {
                    let fond = crate::render::couleur_fond(y, h);
                    (0..w)
                        .filter(|x| {
                            let i = ((y * w + x) * 4) as usize;
                            px[i..i + 4] != fond
                        })
                        .count()
                })
                .sum::<usize>()
        };
        let peints_scene = |model: &crate::glb::Model| {
            let cam = Camera {
                eye: [0.0, 0.0, crate::render::DISTANCE_CAMERA],
                target: [0.0, 0.0, 0.0],
                up: [0.0, 1.0, 0.0],
                fov_y: 2.0 * (1.0 / crate::render::FOCALE).atan(),
            };
            let instance = Instance {
                model,
                transform: mat_identity(),
                two_sided: false,
            };
            let px = render_scene(&[], &[instance], &cam, w, h, [24, 28, 40], [50, 58, 74]);
            (0..h)
                .map(|y| {
                    let t = y as f32 / h as f32;
                    let mix = |a: u8, b: u8| (f32::from(a) * (1.0 - t) + f32::from(b) * t) as u8;
                    let fond = [mix(24, 50), mix(28, 58), mix(40, 74), 255u8];
                    (0..w)
                        .filter(|x| {
                            let i = ((y * w + x) * 4) as usize;
                            px[i..i + 4] != fond
                        })
                        .count()
                })
                .sum::<usize>()
        };

        let avant = quad(vec![0, 1, 2, 0, 2, 3]);
        let arriere = quad(vec![2, 1, 0, 3, 2, 0]);
        assert!(
            peints_reference(&avant) > 500,
            "la face avant doit être dessinée"
        );
        assert!(
            peints_scene(&avant) > 500,
            "la face avant doit être dessinée"
        );
        assert_eq!(
            peints_reference(&arriere),
            0,
            "la face arrière doit être écartée"
        );
        assert_eq!(
            peints_scene(&arriere),
            0,
            "la face arrière doit être écartée"
        );
    }

    #[test]
    fn rend_un_quad_au_sol() {
        // Un quad vert au sol (y=0), caméra au-dessus qui regarde l'origine.
        let g = [40u8, 160, 60];
        let tris = vec![
            Tri {
                p: [[-5.0, 0.0, -5.0], [5.0, 0.0, -5.0], [5.0, 0.0, 5.0]],
                color: g,
            },
            Tri {
                p: [[-5.0, 0.0, -5.0], [5.0, 0.0, 5.0], [-5.0, 0.0, 5.0]],
                color: g,
            },
        ];
        let cam = Camera {
            eye: [0.0, 12.0, -12.0],
            target: [0.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            fov_y: 0.9,
        };
        let buf = render_world(&tris, &cam, 128, 128, [20, 24, 40], [40, 48, 70]);
        let green = buf
            .chunks_exact(4)
            .filter(|p| p[1] > p[0] + 20 && p[1] > p[2] + 20)
            .count();
        assert!(
            green > 200,
            "le quad vert doit couvrir une bonne part de l'image ({green})"
        );
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
                // CCW vu de +z : la face AVANT au sens glTF. Ce test portait `0, 2, 1`, donc la
                // face ARRIÈRE, parce qu'il avait été écrit contre le test de culling inversé.
                indices: vec![0, 1, 2],
                texture: Some(0),
            }],
            textures: vec![Texture {
                width: 1,
                height: 1,
                rgba: vec![230, 40, 40, 255],
            }],
        };
        let cam = Camera {
            eye: [0.0, 0.6, 3.0],
            target: [0.0, 0.6, 0.0],
            up: [0.0, 1.0, 0.0],
            fov_y: 0.8,
        };
        let inst = [Instance {
            model: &model,
            transform: mat_identity(),
            two_sided: false,
        }];
        let buf = render_scene(&[], &inst, &cam, 96, 96, [20, 24, 40], [20, 24, 40]);
        let red = buf
            .chunks_exact(4)
            .filter(|p| p[0] > 90 && p[0] > p[1] + 40 && p[0] > p[2] + 40)
            .count();
        assert!(
            red > 30,
            "le triangle texturé rouge instancié doit apparaître ({red})"
        );
    }

    #[test]
    fn clippe_un_triangle_traversant_le_plan_proche() {
        // Caméra à l'origine regardant +z ; triangle dont un sommet est DERRIÈRE (z<0). Sans
        // clipping il serait rejeté entièrement ; avec clipping, sa partie visible se rend.
        let g = [60u8, 180, 90];
        let tris = vec![Tri {
            p: [[-2.0, -1.0, -1.0], [2.0, -1.0, 3.0], [0.0, 2.0, 3.0]],
            color: g,
        }];
        let cam = Camera {
            eye: [0.0, 0.0, 0.0],
            target: [0.0, 0.0, 1.0],
            up: [0.0, 1.0, 0.0],
            fov_y: 1.2,
        };
        let buf = render_world(&tris, &cam, 96, 96, [10, 10, 20], [10, 10, 20]);
        let lit = buf
            .chunks_exact(4)
            .filter(|p| p[1] > p[0] + 20 && p[1] > p[2] + 20)
            .count();
        assert!(
            lit > 80,
            "la partie visible du triangle traversant doit se rendre ({lit})"
        );
    }

    // ─── Segments : grille, fil de fer, sélection ────────────────────────────────────────

    /// Caméra qui regarde l'origine depuis le haut et l'avant — la vue d'un éditeur.
    fn cam_editeur() -> Camera {
        Camera {
            eye: [0.0, 6.0, 10.0],
            target: [0.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            fov_y: 0.9,
        }
    }

    fn compte_pixels(px: &[u8], couleur: [u8; 3]) -> usize {
        px.chunks_exact(4)
            .filter(|p| p[0] == couleur[0] && p[1] == couleur[1] && p[2] == couleur[2])
            .count()
    }

    /// Un segment seul se dessine, et c'est bien LUI qu'on voit : sans lui, rien de sa couleur.
    #[test]
    fn un_segment_se_dessine_dans_sa_couleur() {
        let rouge = [255, 0, 0];
        let seg = Segment::new([-3.0, 0.0, 0.0], [3.0, 0.0, 0.0], rouge);
        let avec = render_scene_with_lines(&[], &[], &[seg], &cam_editeur(), 160, 120, [10; 3], [20; 3]);
        let sans = render_scene_with_lines(&[], &[], &[], &cam_editeur(), 160, 120, [10; 3], [20; 3]);
        assert!(compte_pixels(&avec, rouge) > 20, "le segment doit couvrir des pixels");
        assert_eq!(compte_pixels(&sans, rouge), 0, "sans segment, aucun pixel rouge");
    }

    /// Un segment ÉPAIS couvre plus de pixels qu'un fin, sur la même géométrie.
    #[test]
    fn lepaisseur_change_la_couverture() {
        let vert = [0, 255, 0];
        let base = Segment::new([-3.0, 0.0, 0.0], [3.0, 0.0, 0.0], vert);
        let fin = render_scene_with_lines(&[], &[], &[base], &cam_editeur(), 160, 120, [10; 3], [20; 3]);
        let epais = render_scene_with_lines(
            &[],
            &[],
            &[base.with_width(5)],
            &cam_editeur(),
            160,
            120,
            [10; 3],
            [20; 3],
        );
        assert!(
            compte_pixels(&epais, vert) > compte_pixels(&fin, vert),
            "5 px doit couvrir plus que 1 px"
        );
    }

    /// Le test de profondeur MASQUE un segment derrière un mur ; `overlay` le laisse passer.
    ///
    /// C'est la distinction qui décide d'un éditeur utilisable : une grille de sol doit passer
    /// derrière les objets posés dessus, un contour de sélection doit rester visible même quand
    /// l'objet est caché — sinon sélectionner un objet masqué ne montre rien, ce qui se lit
    /// comme un clic sans effet.
    #[test]
    fn la_profondeur_masque_un_segment_mais_pas_une_superposition() {
        let bleu = [0, 0, 255];
        // Un mur opaque entre la caméra et le segment.
        let mur = [
            Tri {
                p: [[-4.0, -4.0, 4.0], [4.0, -4.0, 4.0], [4.0, 4.0, 4.0]],
                color: [200, 200, 200],
            },
            Tri {
                p: [[-4.0, -4.0, 4.0], [4.0, 4.0, 4.0], [-4.0, 4.0, 4.0]],
                color: [200, 200, 200],
            },
        ];
        let derriere = Segment::new([-2.0, 0.0, 0.0], [2.0, 0.0, 0.0], bleu);
        let cache = render_scene_with_lines(&mur, &[], &[derriere], &cam_editeur(), 160, 120, [10; 3], [20; 3]);
        let par_dessus = render_scene_with_lines(
            &mur,
            &[],
            &[derriere.overlay()],
            &cam_editeur(),
            160,
            120,
            [10; 3],
            [20; 3],
        );
        assert_eq!(compte_pixels(&cache, bleu), 0, "le mur doit masquer le segment");
        assert!(
            compte_pixels(&par_dessus, bleu) > 20,
            "`overlay` doit passer par-dessus le mur"
        );
    }

    /// La grille a le bon NOMBRE de lignes, et ses deux axes sont distincts du reste.
    ///
    /// Compter les segments attrape ce qu'une capture ne montre pas : une grille à qui il manque
    /// la ligne centrale, ou qui la compte deux fois, ressemble à une grille correcte.
    #[test]
    fn la_grille_compte_ses_lignes_et_distingue_ses_axes() {
        let gris = [60, 60, 60];
        let axe = [200, 40, 40];
        // demi-étendue 10, pas 2 → 5 lignes de chaque côté plus l'axe = 11 par direction.
        let g = grid_segments(10.0, 2.0, 0.0, gris, axe);
        assert_eq!(g.len(), 11 * 2, "11 lignes par direction, deux directions");
        assert_eq!(
            g.iter().filter(|s| s.color == axe).count(),
            2,
            "exactement deux axes : un par direction"
        );
        assert!(
            g.iter().filter(|s| s.color == axe).all(|s| s.width == 2),
            "les axes sont plus épais"
        );
        assert!(g.iter().all(|s| s.depth_test), "une grille de sol se masque");
    }

    /// Un pas nul ou non fini rend une grille VIDE au lieu d'en demander une infinité.
    #[test]
    fn une_grille_au_pas_absurde_est_vide() {
        for (extent, step) in [(10.0, 0.0), (10.0, -1.0), (10.0, f32::NAN), (0.0, 1.0), (f32::INFINITY, 1.0)] {
            assert!(
                grid_segments(extent, step, 0.0, [1; 3], [2; 3]).is_empty(),
                "étendue {extent}, pas {step}"
            );
        }
    }

    /// La boîte de sélection a DOUZE arêtes, toutes en superposition.
    ///
    /// Douze est le compte d'un parallélépipède ; treize signalerait une diagonale, onze une
    /// arête manquante — deux défauts qu'un rendu ne montre pas clairement.
    #[test]
    fn la_boite_de_selection_a_douze_aretes_toutes_par_dessus() {
        let b = box_segments([-1.0, -1.0, -1.0], [1.0, 1.0, 1.0], [0, 200, 255]);
        assert_eq!(b.len(), 12);
        assert!(b.iter().all(|s| !s.depth_test), "un contour reste visible");
        // Chaque arête relie deux coins distincts d'une seule coordonnée.
        for s in &b {
            let differences = (0..3).filter(|i| (s.a[*i] - s.b[*i]).abs() > 1e-6).count();
            assert_eq!(differences, 1, "une arête varie sur un seul axe : {s:?}");
        }
    }

    /// Un segment qui traverse le plan proche est RACCOURCI, pas rejeté.
    ///
    /// Une grille de sol passe toujours sous la caméra : la rejeter ferait disparaître la moitié
    /// de la grille dès qu'on s'approche du sol, ce qui se lit comme un défaut d'affichage.
    #[test]
    fn un_segment_traversant_le_plan_proche_est_raccourci() {
        let jaune = [255, 255, 0];
        let cam = Camera {
            eye: [0.0, 1.0, 0.0],
            target: [0.0, 1.0, -1.0],
            up: [0.0, 1.0, 0.0],
            fov_y: 1.2,
        };
        // De derrière la caméra jusque devant elle.
        let seg = Segment::new([0.0, 1.0, 5.0], [0.0, 1.0, -5.0], jaune);
        let px = render_scene_with_lines(&[], &[], &[seg], &cam, 160, 120, [10; 3], [20; 3]);
        assert!(
            compte_pixels(&px, jaune) > 0,
            "la partie devant la caméra doit se dessiner"
        );
    }

    /// `render_scene` sans segment rend EXACTEMENT ce qu'il rendait avant l'ajout.
    #[test]
    fn la_passe_de_segments_ne_change_rien_sans_segment() {
        let tri = [Tri {
            p: [[-2.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 2.0, 0.0]],
            color: [180, 120, 60],
        }];
        let avant = render_scene(&tri, &[], &cam_editeur(), 96, 72, [10; 3], [20; 3]);
        let apres = render_scene_with_lines(&tri, &[], &[], &cam_editeur(), 96, 72, [10; 3], [20; 3]);
        assert_eq!(avant, apres, "aucun pixel ne doit bouger");
    }

    /// La profondeur d'un segment est interpolée en `1/z`, pas en `z`.
    ///
    /// Un pas uniforme en espace ÉCRAN ne correspond pas à un pas uniforme en espace 3D : c'est
    /// `1/z` qui varie linéairement à l'écran, pas `z`. Interpoler `z` place donc le point où le
    /// segment passe derrière la géométrie au mauvais endroit — et l'erreur n'est pas subtile.
    ///
    /// Mesuré sur cette scène : un segment plongeant de la profondeur 3 à 37, coupé par un mur
    /// qui couvre tout le champ à la profondeur 12. En `1/z`, **117 pixels** restent visibles ;
    /// en `z` linéaire, **zéro** — le segment entier disparaît. Le mur couvre tout le champ à
    /// dessein : s'il n'en couvrait qu'une partie, l'occultation serait décidée par son étendue
    /// à l'écran et le test ne prouverait rien. Une première version de ce test faisait
    /// exactement cette erreur et rendait 160 pixels dans les deux cas.
    #[test]
    fn la_profondeur_dun_segment_sinterpole_en_inverse() {
        let jaune = [255, 255, 0];
        let cam = Camera {
            eye: [0.0, 0.0, 12.0],
            target: [0.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            fov_y: 1.0,
        };
        let seg = Segment::new([-5.0, 0.0, 9.0], [5.0, 0.0, -25.0], jaune);
        let mur = [
            Tri {
                p: [[-200.0, -200.0, 0.0], [200.0, -200.0, 0.0], [200.0, 200.0, 0.0]],
                color: [200, 200, 200],
            },
            Tri {
                p: [[-200.0, -200.0, 0.0], [200.0, 200.0, 0.0], [-200.0, 200.0, 0.0]],
                color: [200, 200, 200],
            },
        ];

        let avec_mur = render_scene_with_lines(&mur, &[], &[seg], &cam, 320, 240, [10; 3], [20; 3]);
        let sans_mur = render_scene_with_lines(&[], &[], &[seg], &cam, 320, 240, [10; 3], [20; 3]);
        let (visible, total) = (compte_pixels(&avec_mur, jaune), compte_pixels(&sans_mur, jaune));

        assert!(
            visible > 50,
            "la partie DEVANT le mur doit rester visible : {visible} pixels (0 = interpolation linéaire)"
        );
        assert!(
            visible < total,
            "la partie DERRIÈRE le mur doit être masquée : {visible} sur {total}"
        );
    }

    // ─── Équivalence avec glam ───────────────────────────────────────────────────────────

    /// Notre `mat_mul` et celui de `glam` en `scalar-math` donnent le MÊME octet.
    ///
    /// Le dépôt réécrit `mat_mul` **cinq fois** — `g4sk`, `gpu`, `scene`, `document`, `glb` — et
    /// dans deux conventions différentes (colonne-majeure côté format, ligne-majeure côté rendu).
    /// Cette divergence a déjà coûté une enquête : le pont entre les deux ne tient que par une
    /// transposition qu'aucun type n'impose. `glam` fournit un seul `Mat4`, donc une seule
    /// convention.
    ///
    /// L'admettre demande une preuve, pas une préférence : sur le chemin de fidélité, l'ordre des
    /// opérations flottantes décide de l'octet. `glam` est donc épinglé en **`scalar-math`**, qui
    /// désactive le SIMD, et ce test vérifie l'égalité **sur les bits** (`to_bits`), pas à
    /// epsilon près — deux matrices égales à 1e-7 ne produisent pas le même golden.
    ///
    /// `glam::Mat4` est colonne-majeure : `Mat4::from_cols_array_2d` prend `[[f32;4];4]` indexé
    /// `[colonne][ligne]`, alors que notre `Mat4` est `[ligne][colonne]`. La conversion transpose
    /// donc, et c'est exactement le piège que le type unique supprimerait.
    #[test]
    fn glam_en_scalar_math_multiplie_comme_nous_bit_pour_bit() {
        let vers_glam = |m: &Mat4| -> glam::Mat4 {
            // `[ligne][colonne]` → colonnes de glam.
            glam::Mat4::from_cols_array_2d(&[
                [m[0][0], m[1][0], m[2][0], m[3][0]],
                [m[0][1], m[1][1], m[2][1], m[3][1]],
                [m[0][2], m[1][2], m[2][2], m[3][2]],
                [m[0][3], m[1][3], m[2][3], m[3][3]],
            ])
        };

        // Des valeurs irrégulières : une matrice d'entiers ronds cacherait un écart d'arrondi.
        let a: Mat4 = [
            [0.317_5, -2.903_41, 11.0, 0.5],
            [3.284_77, 0.001_7, -7.25, -12.5],
            [-0.541_93, 1.772_06, 0.333_33, 4.0],
            [0.0, 0.0, 0.0, 1.0],
        ];
        let b: Mat4 = [
            [1.293_48, 0.638_92, -0.25, 3.5],
            [-0.812_67, 2.451_09, 0.125, -1.25],
            [0.926_14, -0.193_88, 1.884_52, 0.75],
            [0.0, 0.0, 0.0, 1.0],
        ];

        let notre = mat_mul(&a, &b);
        let leur = (vers_glam(&a) * vers_glam(&b)).to_cols_array_2d();
        for ligne in 0..4 {
            for colonne in 0..4 {
                assert_eq!(
                    notre[ligne][colonne].to_bits(),
                    leur[colonne][ligne].to_bits(),
                    "ligne {ligne} colonne {colonne} : {} contre {} (glam)",
                    notre[ligne][colonne],
                    leur[colonne][ligne]
                );
            }
        }
    }

    /// Et sur une vraie chaîne d'os du jeu, composée par cinquante produits successifs.
    ///
    /// Un seul produit peut coïncider par chance ; une composition profonde accumule l'écart.
    /// Cinquante est l'ordre de grandeur d'une hiérarchie réelle — `c11010010` porte 164 os.
    #[test]
    fn une_composition_profonde_reste_identique_a_glam() {
        let vers_glam = |m: &Mat4| -> glam::Mat4 {
            glam::Mat4::from_cols_array_2d(&[
                [m[0][0], m[1][0], m[2][0], m[3][0]],
                [m[0][1], m[1][1], m[2][1], m[3][1]],
                [m[0][2], m[1][2], m[2][2], m[3][2]],
                [m[0][3], m[1][3], m[2][3], m[3][3]],
            ])
        };

        let mut notre = mat_identity();
        let mut leur = glam::Mat4::IDENTITY;
        for i in 0..50 {
            let t = i as f32 * 0.137;
            let pas: Mat4 = [
                [t.cos(), -t.sin(), 0.0, t * 0.31],
                [t.sin(), t.cos(), 0.0, -t * 0.17],
                [0.0, 0.0, 1.0 + t * 0.011, t * 0.07],
                [0.0, 0.0, 0.0, 1.0],
            ];
            notre = mat_mul(&notre, &pas);
            leur *= vers_glam(&pas);
        }
        let leur = leur.to_cols_array_2d();
        for ligne in 0..4 {
            for colonne in 0..4 {
                assert_eq!(
                    notre[ligne][colonne].to_bits(),
                    leur[colonne][ligne].to_bits(),
                    "après 50 produits, ligne {ligne} colonne {colonne}"
                );
            }
        }
    }

    /// Le fil de fer DÉDUPLIQUE les arêtes partagées.
    ///
    /// Deux triangles adjacents partagent une arête ; la tracer deux fois coûte double et produit
    /// un trait plus opaque à chaque jointure, ce qui se lit comme un défaut d'éclairage plutôt
    /// que comme un doublon. Valeurs calculées à la main : un quad = 2 triangles = 5 arêtes
    /// distinctes (4 de bord + 1 diagonale), pas 6.
    #[test]
    fn le_fil_de_fer_deduplique_les_aretes_partagees() {
        let quad = crate::glb::Model {
            primitives: vec![crate::glb::Primitive {
                positions: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]],
                normals: Vec::new(),
                uv: Vec::new(),
                indices: vec![0, 1, 2, 0, 2, 3],
                texture: None,
            }],
            textures: Vec::new(),
        };
        let w = wireframe_segments(&quad, [200, 200, 200], usize::MAX);
        assert_eq!(w.len(), 5, "4 bords + 1 diagonale, la diagonale n'est PAS doublée");
    }

    /// La borne arrête le tracé — un personnage du jeu noierait l'image sans elle.
    #[test]
    fn le_fil_de_fer_respecte_sa_borne() {
        let quad = crate::glb::Model {
            primitives: vec![crate::glb::Primitive {
                positions: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]],
                normals: Vec::new(),
                uv: Vec::new(),
                indices: vec![0, 1, 2, 0, 2, 3],
                texture: None,
            }],
            textures: Vec::new(),
        };
        assert_eq!(wireframe_segments(&quad, [1; 3], 3).len(), 3);
        assert!(wireframe_segments(&quad, [1; 3], 0).is_empty());
    }

    /// Un indice hors table est SAUTÉ, pas propagé jusqu'au rendu.
    #[test]
    fn le_fil_de_fer_saute_un_indice_hors_table() {
        let casse = crate::glb::Model {
            primitives: vec![crate::glb::Primitive {
                positions: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
                normals: Vec::new(),
                uv: Vec::new(),
                indices: vec![0, 1, 9],
                texture: None,
            }],
            textures: Vec::new(),
        };
        // Seule l'arête 0→1 est traçable ; les deux qui touchent l'indice 9 sont sautées.
        assert_eq!(wireframe_segments(&casse, [1; 3], usize::MAX).len(), 1);
    }
}
