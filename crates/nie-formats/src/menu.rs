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
}
