//! Assemblage de layout de menu : combine `objbin` (l'objet) + `g4pkm` (les transforms 2D)
//! + dimensions `g4tx` (le sprite) en objets positionnés sur le canvas écran 1280×720.
//!
//! Port du cœur de `IECODE.Core/Cdn/MenuLayoutExporter.cs` (`ReadBoneTransformAsync` +
//! `PickBestPoseForSprite` + `BuildObjectAsync`), sans la couche I/O ni la résolution de
//! texte/locale (laissée à l'appelant). Le résultat est **correct par construction** : les
//! positions sont les poses g4pkm déjà validées byte-exact (cf. `g4pkm.rs`), converties en
//! pixels écran.
//!
//! ## Portée
//!
//! Cible les éléments de menu **statiques** : leur position visible EST la bind pose du
//! squelette g4pkm. Les éléments **animés** (glissement d'entrée) ont une bind pose
//! hors-écran ; leur position finale dépend des keyframes runtime (absentes des fichiers,
//! cf. `g4pkm.rs` caveat) — non couverts ici.
//!
//! Compatible `no_std + alloc`.

extern crate alloc;
use alloc::string::String;

use crate::g4pkm::{G4pkmLayout, Transform2D};
use crate::objbin::{MenuComponent, MenuObject};

/// Largeur/hauteur du canvas écran de référence (espace CSS, origine en haut-gauche).
const CANVAS_W: f32 = 1280.0;
const CANVAS_H: f32 = 720.0;
/// Espace-écran de référence du jeu (les scales g4pkm y sont exprimées).
const REF_W: f32 = 1920.0;
const REF_H: f32 = 1080.0;
/// Tolérance de correspondance scale-bone ↔ dimensions-sprite (`PickBestPoseForSprite`).
const SCALE_MATCH_TOL: f32 = 0.30;

/// Transform écran final d'un objet-menu : position en pixels CSS sur le canvas 1280×720
/// (origine haut-gauche), facteur d'échelle appliqué au sprite, rotation en radians.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScreenTransform {
    /// Position X du pivot en pixels CSS (0 = bord gauche, 1280 = bord droit).
    pub x_px: f32,
    /// Position Y du pivot en pixels CSS (0 = bord haut, 720 = bord bas).
    pub y_px: f32,
    /// Facteur d'échelle horizontal appliqué au sprite (1.0 = taille native).
    pub scale_x: f32,
    /// Facteur d'échelle vertical appliqué au sprite.
    pub scale_y: f32,
    /// Rotation en radians (sens trigonométrique).
    pub rot: f32,
}

/// Sélectionne la meilleure pose monde du squelette pour un sprite de dimensions données,
/// puis la convertit en [`ScreenTransform`] (pixels canvas 1280×720).
///
/// Port de `ReadBoneTransformAsync` + `PickBestPoseForSprite` : si le bone de placement a
/// déjà une géométrie réelle (scale > 1), on l'utilise ; sinon (locator identité) on cherche
/// le bone feuille dont la scale colle aux dimensions du sprite (±30 %).
#[must_use]
pub fn place_on_canvas(layout: &G4pkmLayout, sprite_w: u32, sprite_h: u32) -> ScreenTransform {
    let pose = pick_best_pose(layout, sprite_w, sprite_h);
    let (x_px, y_px) = pose.to_css_1280x720();

    // scale = (taille géométrie en px réf) × (ratio canvas/réf) / taille native du sprite.
    // Si la pose n'a pas de géométrie réelle (≤ 1), on affiche le sprite à sa taille native.
    let scale_x = if pose.scale_x > 1.0 && sprite_w > 0 {
        pose.scale_x * (CANVAS_W / REF_W) / sprite_w as f32
    } else {
        1.0
    };
    let scale_y = if pose.scale_y > 1.0 && sprite_h > 0 {
        pose.scale_y * (CANVAS_H / REF_H) / sprite_h as f32
    } else {
        1.0
    };

    ScreenTransform { x_px, y_px, scale_x, scale_y, rot: pose.rot }
}

/// Choisit la pose de placement (port de `PickBestPoseForSprite`).
fn pick_best_pose(layout: &G4pkmLayout, sprite_w: u32, sprite_h: u32) -> Transform2D {
    // Pose de base : premier bone à géométrie réelle (scale > 1), sinon le premier bone,
    // sinon identité.
    let base = layout
        .bones
        .iter()
        .map(|b| b.world_bind_pose)
        .find(|p| p.scale_x > 1.0)
        .or_else(|| layout.bones.first().map(|b| b.world_bind_pose))
        .unwrap_or(Transform2D::ZERO);

    // Si la base a déjà une géométrie réelle (ou pas de sprite à matcher), on la garde.
    if base.scale_x > 1.0 || sprite_w == 0 || sprite_h == 0 {
        return base;
    }

    // Sinon : chercher le bone feuille dont (scale_x, scale_y) colle au sprite (±30 %).
    let (tw, th) = (sprite_w as f32, sprite_h as f32);
    let mut best: Option<Transform2D> = None;
    let mut best_score = f32::MAX;

    for bone in &layout.bones {
        let wp = bone.world_bind_pose;
        if wp.scale_x <= 1.0 || wp.scale_y <= 1.0 {
            continue;
        }
        let ratio_x = wp.scale_x / tw;
        let ratio_y = wp.scale_y / th;
        if !(1.0 - SCALE_MATCH_TOL..=1.0 + SCALE_MATCH_TOL).contains(&ratio_x)
            || !(1.0 - SCALE_MATCH_TOL..=1.0 + SCALE_MATCH_TOL).contains(&ratio_y)
        {
            continue;
        }
        let score = (1.0 - ratio_x).abs() + (1.0 - ratio_y).abs();
        if score < best_score {
            best_score = score;
            best = Some(wp);
        }
    }

    best.unwrap_or(base)
}

/// Objet-menu positionné : nom + texture logique + z-order + transform écran.
#[derive(Debug, Clone)]
pub struct PositionedMenuObject {
    /// Nom de l'objet (`OBJ_BGN`).
    pub name: String,
    /// Chemin logique de la texture principale (`.g4tx`, peut contenir `<LG>`).
    pub g4tx_path: Option<String>,
    /// Priorité de dessin (z-order croissant = au-dessus).
    pub draw_priority: i32,
    /// Transform écran final (pixels canvas 1280×720).
    pub transform: ScreenTransform,
}

/// Assemble un objet-menu positionné depuis son objet [`MenuObject`] (objbin), son squelette
/// [`G4pkmLayout`] (g4pkm) et les dimensions natives de son sprite (g4tx).
///
/// Le z-order vient du `CMenuRenderComponent` (`m_drawPriority`) ; la position vient du
/// squelette g4pkm. L'appelant trie ensuite par `draw_priority` croissant pour l'ordre de
/// dessin (back-to-front).
#[must_use]
pub fn assemble_object(
    obj: &MenuObject,
    layout: &G4pkmLayout,
    sprite_w: u32,
    sprite_h: u32,
) -> PositionedMenuObject {
    let draw_priority = obj
        .components
        .iter()
        .find_map(|c| match c {
            MenuComponent::Render(r) => Some(r.draw_priority),
            _ => None,
        })
        .unwrap_or(0);

    PositionedMenuObject {
        name: obj.name.clone(),
        g4tx_path: obj.g4tx_path.clone(),
        draw_priority,
        transform: place_on_canvas(layout, sprite_w, sprite_h),
    }
}

// ── Compositeur CPU (blit affine + bilinéaire + blend « over ») ───────────────

/// Sprite à composer : pixels RGBA8 (`width`×`height`), transform écran, ancre normalisée.
pub struct CompositeSprite<'a> {
    /// Pixels RGBA8 du sprite, `width * height * 4` octets.
    pub rgba: &'a [u8],
    /// Largeur native du sprite en pixels.
    pub width: u32,
    /// Hauteur native du sprite en pixels.
    pub height: u32,
    /// Transform écran (issu de [`place_on_canvas`]).
    pub transform: ScreenTransform,
    /// Ancre X normalisée (0=gauche, 0.5=centre, 1=droite).
    pub anchor_x: f32,
    /// Ancre Y normalisée (0=haut, 0.5=centre, 1=bas).
    pub anchor_y: f32,
}

/// Compose une liste de sprites positionnés sur un canvas RGBA8 transparent.
///
/// Les sprites sont dessinés dans l'ordre de la slice (back-to-front : trier par
/// `draw_priority` croissant en amont). Chaque sprite est blitté par mapping affine inverse,
/// échantillonnage bilinéaire et blend « over » (alpha droit).
/// Port en f32 de `nie-model-serve/src/menu.rs` (`blit_sprite`/`sample_bilinear`).
#[must_use]
pub fn compose(canvas_w: u32, canvas_h: u32, sprites: &[CompositeSprite]) -> Vec<u8> {
    let mut canvas = alloc::vec![0u8; (canvas_w as usize) * (canvas_h as usize) * 4];
    for s in sprites {
        blit_sprite(&mut canvas, canvas_w as i64, canvas_h as i64, s);
    }
    canvas
}

fn blit_sprite(canvas: &mut [u8], cw: i64, ch: i64, s: &CompositeSprite) {
    let t = &s.transform;
    if t.scale_x.abs() < 1e-9 || t.scale_y.abs() < 1e-9 || s.width == 0 || s.height == 0 {
        return; // dégénéré → invisible
    }
    let (qw, qh) = (s.width as f32, s.height as f32);
    let (sin, cos) = (t.rot.sin(), t.rot.cos());
    let ax = s.anchor_x * qw;
    let ay = s.anchor_y * qh;

    // Forward : local(px sprite) → canvas (v = local−anchor ; s = v·scale ; r = R·s ; +pos).
    let fwd = |lx: f32, ly: f32| -> (f32, f32) {
        let vx = (lx - ax) * t.scale_x;
        let vy = (ly - ay) * t.scale_y;
        (t.x_px + vx * cos - vy * sin, t.y_px + vx * sin + vy * cos)
    };
    let corners = [fwd(0.0, 0.0), fwd(qw, 0.0), fwd(0.0, qh), fwd(qw, qh)];
    let min_x = corners.iter().map(|c| c.0).fold(f32::INFINITY, f32::min).floor() as i64;
    let max_x = corners.iter().map(|c| c.0).fold(f32::NEG_INFINITY, f32::max).ceil() as i64;
    let min_y = corners.iter().map(|c| c.1).fold(f32::INFINITY, f32::min).floor() as i64;
    let max_y = corners.iter().map(|c| c.1).fold(f32::NEG_INFINITY, f32::max).ceil() as i64;
    let (x0, y0) = (min_x.max(0), min_y.max(0));
    let (x1, y1) = (max_x.min(cw), max_y.min(ch));
    if x0 >= x1 || y0 >= y1 {
        return;
    }
    let (inv_sx, inv_sy) = (1.0 / t.scale_x, 1.0 / t.scale_y);

    for py in y0..y1 {
        for px in x0..x1 {
            let dx = (px as f32 + 0.5) - t.x_px;
            let dy = (py as f32 + 0.5) - t.y_px;
            let lx = (dx * cos + dy * sin) * inv_sx + ax; // R^-1 puis un-scale
            let ly = (-dx * sin + dy * cos) * inv_sy + ay;
            if lx < 0.0 || ly < 0.0 || lx >= qw || ly >= qh {
                continue;
            }
            let u = (lx / qw) * s.width as f32 - 0.5;
            let v = (ly / qh) * s.height as f32 - 0.5;
            let (sr, sg, sb, sa) = sample_bilinear(s.rgba, s.width, s.height, u, v);
            if sa <= 0.0 {
                continue;
            }
            let di = ((py * cw + px) * 4) as usize;
            let dr = f32::from(canvas[di]) / 255.0;
            let dg = f32::from(canvas[di + 1]) / 255.0;
            let db = f32::from(canvas[di + 2]) / 255.0;
            let da = f32::from(canvas[di + 3]) / 255.0;
            let oa = sa + da * (1.0 - sa);
            if oa <= 0.0 {
                continue;
            }
            let or = (sr * sa + dr * da * (1.0 - sa)) / oa;
            let og = (sg * sa + dg * da * (1.0 - sa)) / oa;
            let ob = (sb * sa + db * da * (1.0 - sa)) / oa;
            canvas[di] = (or * 255.0).round().clamp(0.0, 255.0) as u8;
            canvas[di + 1] = (og * 255.0).round().clamp(0.0, 255.0) as u8;
            canvas[di + 2] = (ob * 255.0).round().clamp(0.0, 255.0) as u8;
            canvas[di + 3] = (oa * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
}

/// Échantillon bilinéaire RGBA (0..1) avec clamp aux bords ; `u`,`v` en coords texel.
fn sample_bilinear(rgba: &[u8], tw: u32, th: u32, u: f32, v: f32) -> (f32, f32, f32, f32) {
    let (x0, y0) = (u.floor(), v.floor());
    let (fx, fy) = (u - x0, v - y0);
    let cx = |x: f32| (x as i64).clamp(0, tw as i64 - 1) as usize;
    let cy = |y: f32| (y as i64).clamp(0, th as i64 - 1) as usize;
    let texel = |xc: usize, yc: usize| -> (f32, f32, f32, f32) {
        let i = (yc * tw as usize + xc) * 4;
        (
            f32::from(rgba[i]) / 255.0,
            f32::from(rgba[i + 1]) / 255.0,
            f32::from(rgba[i + 2]) / 255.0,
            f32::from(rgba[i + 3]) / 255.0,
        )
    };
    let (x0c, x1c) = (cx(x0), cx(x0 + 1.0));
    let (y0c, y1c) = (cy(y0), cy(y0 + 1.0));
    let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;
    let mix = |a: (f32, f32, f32, f32), b: (f32, f32, f32, f32), t: f32| {
        (lerp(a.0, b.0, t), lerp(a.1, b.1, t), lerp(a.2, b.2, t), lerp(a.3, b.3, t))
    };
    let top = mix(texel(x0c, y0c), texel(x1c, y0c), fx);
    let bot = mix(texel(x0c, y1c), texel(x1c, y1c), fx);
    mix(top, bot, fy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::g4pkm::G4pkmBone;
    use alloc::collections::BTreeMap;
    use alloc::vec::Vec;

    fn bone(name: &str, t: Transform2D) -> G4pkmBone {
        G4pkmBone {
            index: 0,
            name: String::from(name),
            parent_index: -1,
            local_bind_pose: t,
            world_bind_pose: t,
        }
    }

    /// Construit un layout synthétique (la map nom→pose n'est pas requise par
    /// `pick_best_pose`, qui itère `bones` directement).
    fn layout(bones: Vec<G4pkmBone>) -> G4pkmLayout {
        G4pkmLayout { bones, world_pose_by_name: BTreeMap::new() }
    }

    fn tf(x: f32, y: f32, sx: f32, sy: f32) -> Transform2D {
        Transform2D { x, y, scale_x: sx, scale_y: sy, rot: 0.0, anchor_x: 0.5, anchor_y: 0.5 }
    }

    /// Un bone plein écran (0,0,1920,1080) → centre canvas (640,360) et scale = ratio
    /// canvas/réf rapporté à un sprite 1920×1080 = 1280/1920 ≈ 0.667.
    #[test]
    fn place_fullscreen_bone_centers_and_fills() {
        let layout = layout(alloc::vec![bone("_bg", tf(0.0, 0.0, 1920.0, 1080.0))]);
        let st = place_on_canvas(&layout, 1920, 1080);
        assert!((st.x_px - 640.0).abs() < 0.5, "x={}", st.x_px);
        assert!((st.y_px - 360.0).abs() < 0.5, "y={}", st.y_px);
        assert!((st.scale_x - 1280.0 / 1920.0).abs() < 1e-4, "sx={}", st.scale_x);
        assert!((st.scale_y - 720.0 / 1080.0).abs() < 1e-4, "sy={}", st.scale_y);
    }

    /// Bone décalé : `win00_04/_cursor01` (tx=-40, ty=40) → CSS (640 - 40·2/3, 360 - 40·2/3).
    #[test]
    fn place_offset_bone_maps_to_css() {
        let layout = layout(alloc::vec![bone("_cursor01", tf(-40.0, 40.0, 80.0, 80.0))]);
        let st = place_on_canvas(&layout, 80, 80);
        let expect_x = 640.0 + (-40.0) * (1280.0 / 1920.0);
        let expect_y = 360.0 - 40.0 * (720.0 / 1080.0);
        assert!((st.x_px - expect_x).abs() < 0.5, "x={} exp={}", st.x_px, expect_x);
        assert!((st.y_px - expect_y).abs() < 0.5, "y={} exp={}", st.y_px, expect_y);
    }

    /// Bone de placement identité (locator) + bone feuille à la taille du sprite → la scale
    /// vient du bone feuille (`PickBestPoseForSprite`), pas du locator dégénéré.
    #[test]
    fn pick_leaf_bone_when_placement_is_locator() {
        let layout = layout(alloc::vec![
            bone("_root", tf(100.0, 50.0, 1.0, 1.0)),        // locator (scale 1)
            bone("_gtxt", tf(100.0, 50.0, 776.0, 120.0)),    // géométrie réelle
        ]);
        // base = premier scale>1 = le bone _gtxt → utilisé directement.
        let st = place_on_canvas(&layout, 776, 120);
        assert!((st.scale_x - 776.0 * (1280.0 / 1920.0) / 776.0).abs() < 1e-4);
    }

    /// Bout-en-bout sur le vrai jeu : `option02_02.g4pkm` (bone nvidia plein écran
    /// 1920×1080) → l'objet positionné est centré et remplit le canvas.
    #[test]
    fn real_option02_02_fullscreen_object() {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"
                .to_string()
        });
        let data = std::path::Path::new(&dir).join("data");
        if !data.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip real_option02_02_fullscreen_object : jeu absent");
            return;
        }
        let mut vfs = crate::vfs::Vfs::new();
        if vfs.init(&data).is_err() {
            eprintln!("skip : vfs.init KO");
            return;
        }
        let Some(g4pkm_path) = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .find(|p| p.ends_with("option02_02.g4pkm"))
        else {
            eprintln!("skip : option02_02.g4pkm introuvable");
            return;
        };
        let bytes = vfs.read(&g4pkm_path).expect("read g4pkm");
        let layout = crate::g4pkm::parse(&bytes).expect("parse g4pkm");

        // Sprite plein écran 1920×1080 (calibration du licence dummy).
        let st = place_on_canvas(&layout, 1920, 1080);
        eprintln!(
            "option02_02 placé : ({:.1}, {:.1}) scale ({:.3}, {:.3})",
            st.x_px, st.y_px, st.scale_x, st.scale_y
        );
        assert!((st.x_px - 640.0).abs() < 1.0, "x={}", st.x_px);
        assert!((st.y_px - 360.0).abs() < 1.0, "y={}", st.y_px);
        assert!((st.scale_x - 1280.0 / 1920.0).abs() < 1e-3, "sx={}", st.scale_x);
    }

    // ── Compositeur CPU ─────────────────────────────────────────────────────

    fn at(canvas: &[u8], w: usize, x: usize, y: usize) -> (u8, u8, u8, u8) {
        let i = (y * w + x) * 4;
        (canvas[i], canvas[i + 1], canvas[i + 2], canvas[i + 3])
    }

    /// Un sprite 4×4 rouge opaque, ancre centre, posé au centre d'un canvas 8×8 (scale 1,
    /// pas de rotation) → couvre [2,6)² ; le centre est rouge, le coin est transparent.
    #[test]
    fn compose_blits_opaque_sprite_at_position() {
        let rgba = alloc::vec![255u8, 0, 0, 255].repeat(16); // 4×4 rouge opaque
        let sprite = CompositeSprite {
            rgba: &rgba,
            width: 4,
            height: 4,
            transform: ScreenTransform { x_px: 4.0, y_px: 4.0, scale_x: 1.0, scale_y: 1.0, rot: 0.0 },
            anchor_x: 0.5,
            anchor_y: 0.5,
        };
        let canvas = compose(8, 8, &[sprite]);
        assert_eq!(at(&canvas, 8, 4, 4), (255, 0, 0, 255), "centre rouge");
        assert_eq!(at(&canvas, 8, 2, 2), (255, 0, 0, 255), "coin sprite rouge");
        assert_eq!(at(&canvas, 8, 0, 0), (0, 0, 0, 0), "hors sprite transparent");
        assert_eq!(at(&canvas, 8, 7, 7), (0, 0, 0, 0), "hors sprite transparent");
    }

    /// Z-order : le 2e sprite (bleu) est dessiné PAR-DESSUS le 1er (rouge) → bleu gagne.
    #[test]
    fn compose_respects_z_order() {
        let red = alloc::vec![255u8, 0, 0, 255].repeat(16);
        let blue = alloc::vec![0u8, 0, 255, 255].repeat(16);
        let mk = |rgba: &[u8]| -> ScreenTransform {
            let _ = rgba;
            ScreenTransform { x_px: 4.0, y_px: 4.0, scale_x: 1.0, scale_y: 1.0, rot: 0.0 }
        };
        let sprites = alloc::vec![
            CompositeSprite { rgba: &red, width: 4, height: 4, transform: mk(&red), anchor_x: 0.5, anchor_y: 0.5 },
            CompositeSprite { rgba: &blue, width: 4, height: 4, transform: mk(&blue), anchor_x: 0.5, anchor_y: 0.5 },
        ];
        let canvas = compose(8, 8, &sprites);
        assert_eq!(at(&canvas, 8, 4, 4), (0, 0, 255, 255), "le dernier dessiné (bleu) gagne");
    }
}
