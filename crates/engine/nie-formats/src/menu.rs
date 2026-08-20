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
/// Port de `ReadBoneTransformAsync` + `PickBestPoseForSprite` (`MenuLayoutExporter.cs:213-247`) :
/// 1. la pose de placement vient de [`crate::g4pkm_motion::motion_final_pose`] (bone de placement
///    `pos_scl`/`base` + **fallback d'ancêtre** si hors-écran) — c'est la correction du « canvas
///    quasi vide » : sans elle la bind pose hors-écran sortait les widgets du canvas ;
/// 2. si cette pose a déjà une géométrie réelle (scale > 1), on l'utilise ; sinon (locator
///    identité) on cherche le bone feuille dont la scale colle aux dimensions du sprite (±30 %).
#[must_use]
pub fn place_on_canvas(layout: &G4pkmLayout, sprite_w: u32, sprite_h: u32) -> ScreenTransform {
    // `has_open_motion=false` : le drapeau n'est qu'une annotation, il ne change pas la pose
    // (conforme iecode `G4pkmMotion.cs:79-82`).
    let placement = crate::g4pkm_motion::motion_final_pose(layout, false).pose;
    let pose = pick_best_pose(layout, placement, sprite_w, sprite_h);
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

/// Taille, en pixels de l'espace de référence, que l'os de placement **désigne**.
///
/// Observation vérifiée sur l'éditeur d'avatar : l'os ne donne pas seulement une échelle, il donne
/// la taille de l'image à afficher — et cette taille est celle de la **région**, pas de l'atlas.
/// Pour `avatar01_00_avatar_edit_bg`, l'os mesure 2640×1080, ce qui est exactement le rectangle de
/// `bg01`, alors que l'atlas porteur fait 2640×1364 (il contient en plus une bande de
/// pictogrammes). Recoupé sur `avatar01_10_edit_window` : os 788×804 = `edit_win_base01`, atlas
/// 788×1092.
///
/// C'est donc une règle de sélection **pilotée par les fichiers**, pas une heuristique : elle dit
/// quelle sous-texture un objet veut, sans rien mesurer sur une capture. Rend `None` quand l'os est
/// un locator identité (pas de géométrie), cas où la position vient du driver et non des fichiers.
/// La pose est celle que [`place_on_canvas`] utilise réellement — donc **après** [`pick_best_pose`].
/// La pose de placement brute est le plus souvent un locator identité : mesurée seule, elle ne
/// désigne rien (vérifié : les 13 layers de `chara_edit_menu` rendent tous une pose sans
/// géométrie). C'est l'os retenu pour le sprite qui porte la taille.
#[must_use]
pub fn taille_designee(layout: &G4pkmLayout, sprite_w: u32, sprite_h: u32) -> Option<(f32, f32)> {
    let placement = crate::g4pkm_motion::motion_final_pose(layout, false).pose;
    let pose = pick_best_pose(layout, placement, sprite_w, sprite_h);
    (pose.scale_x > 1.0 && pose.scale_y > 1.0).then_some((pose.scale_x, pose.scale_y))
}

/// Raffine une pose de placement pour un sprite donné (port de `PickBestPoseForSprite`).
///
/// `base` est la pose de placement déjà résolue (issue de [`crate::g4pkm_motion::motion_final_pose`],
/// fallback d'ancêtre compris). Si elle a déjà une géométrie réelle (scale > 1), on la garde ;
/// sinon (locator identité) on cherche le bone feuille dont la scale colle aux dimensions du
/// sprite (±30 %).
fn pick_best_pose(
    layout: &G4pkmLayout,
    base: Transform2D,
    sprite_w: u32,
    sprite_h: u32,
) -> Transform2D {
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
    let canvas = alloc::vec![0u8; (canvas_w as usize) * (canvas_h as usize) * 4];
    compose_over(canvas, canvas_w, canvas_h, sprites)
}

/// Comme [`compose`], mais blitte les sprites par-dessus un canvas RGBA8 **déjà peint** (de
/// dimensions `canvas_w × canvas_h`). Permet de poser un fond opaque (dégradé pastel du
/// main_menu) avant le compositing, au lieu d'un canvas transparent (= noir en luma → marges
/// noires qui plombent la SSIM vs la capture réelle pastel). Le canvas est consommé et rendu.
#[must_use]
pub fn compose_over(
    mut canvas: Vec<u8>,
    canvas_w: u32,
    canvas_h: u32,
    sprites: &[CompositeSprite],
) -> Vec<u8> {
    debug_assert_eq!(canvas.len(), (canvas_w as usize) * (canvas_h as usize) * 4);
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

// ── Points d'attache (`CMenuAttachLocator`) ──────────────────────────────────────────────────

/// Un emplacement déclaré par un `CMenuAttachLocator` : « pose l'objet `target_hash` ici ».
#[derive(Debug, Clone, PartialEq)]
pub struct AttachSlot {
    /// Nom de l'os d'attache dans le squelette du locator (ex. `_atc_recipe_title03`).
    pub bone: String,
    /// CRC-32 du nom de l'objet de menu à placer à cet emplacement.
    pub target_hash: u32,
    /// Rang de l'emplacement dans sa série (0, 1, 2… — les items d'une même liste).
    pub index: u32,
    /// Pose **locale** de l'os d'attache — qui est déjà absolue, cf. [`AttachSlot::to_css`].
    pub pose: Transform2D,
}

impl AttachSlot {
    /// Position de l'emplacement en pixels du canvas 1280×720 (origine haut-gauche).
    ///
    /// Deux écarts avec [`Transform2D::to_css_1280x720`], tous deux mesurés sur les squelettes
    /// de menu réels, pas supposés :
    ///
    /// 1. **On lit `local_bind_pose`, pas `world_bind_pose`.** Dans ces squelettes, le local est
    ///    déjà exprimé en absolu : `_pos_guide01` porte `local = monde = (1757, -658)`, et son
    ///    enfant `_atc_guide01`, de local identique, ressort à `monde = (3514, -1316)` — soit
    ///    exactement le double. La composition parentale rajoute donc un décalage déjà compris
    ///    dans le local ; utiliser le monde envoie les widgets à deux fois leur distance, hors
    ///    canvas.
    /// 2. **L'origine est en haut-gauche et Y descend**, au lieu du repère centré de
    ///    `to_css_1280x720`. Avec cette convention `_atc_guide01..03` (x constant 1757, y
    ///    -658/-782/-906) tombent à x≈1171, y≈438/521/604 : trois guides de boutons empilés en
    ///    bas à droite, ce qu'ils sont. Le repère centré les aurait envoyés à x≈1811, hors écran.
    #[must_use]
    pub fn to_css(&self) -> (f32, f32) {
        (self.pose.x * (CANVAS_W / REF_W), -self.pose.y * (CANVAS_H / REF_H))
    }
}

/// Emplacements déclarés par les `CMenuAttachLocator` d'un objet de menu.
///
/// ## Le mécanisme
///
/// Un objet porteur d'un `CMenuAttachLocator` ne se dessine pas lui-même : il **déclare où vont
/// les autres**. Son composant porte une liste plate d'entiers, groupés par quatre :
///
/// | position | contenu | résolution mesurée sur le corpus (5 350 quadruplets, 917 locators) |
/// |---|---|---|
/// | 0 | CRC-32 d'un nom d'os (souvent la variante sans `_` du slot 1) | 20 % |
/// | 1 | **CRC-32 du nom de l'os d'attache**, dans le squelette **du locator lui-même** | **92,07 %** |
/// | 2 | **CRC-32 du nom de l'objet de menu à y placer** | **83,31 %** |
/// | 3 | index séquentiel de l'emplacement (0, 1, 2…) | — |
///
/// Le slot 1 se lit dans le squelette **du porteur**, pas dans celui de l'objet cible : l'hypothèse
/// inverse ne résout que 3,78 % des cas et sortait des poses toutes à l'origine. C'est ce qui rend
/// la position réelle des widgets accessible — elle était déjà dans les fichiers, derrière cette
/// indirection, là où le compositeur retombait sur le centre du canvas.
///
/// Un même `target_hash` revient une fois **par emplacement** (une fenêtre de recettes déclare dix
/// `_atc_recipe_title01..10`) : ce sont des instances répétées du même objet, pas un doublon à
/// dédupliquer.
///
/// ## Résolution locale
///
/// Les hashes se résolvent contre les noms d'os de `layout` — le squelette du locator — sans
/// dictionnaire externe : on hache les noms qu'on a déjà. Un os absent est simplement ignoré
/// (aucun emplacement produit) plutôt que rabattu sur une position par défaut, pour qu'un trou
/// reste visible au lieu de se déguiser en placement.
#[must_use]
pub fn attach_slots(obj: &MenuObject, layout: &G4pkmLayout) -> Vec<AttachSlot> {
    let mut par_hash: alloc::collections::BTreeMap<u32, (&str, Transform2D)> =
        alloc::collections::BTreeMap::new();
    for bone in &layout.bones {
        // `local_bind_pose` : dans ces squelettes il est déjà absolu — cf. [`AttachSlot::to_css`],
        // qui documente la mesure. Prendre le monde doublerait la distance.
        par_hash
            .entry(crate::cfgbin::crc32(bone.name.as_bytes()))
            .or_insert((bone.name.as_str(), bone.local_bind_pose));
    }

    let mut out = Vec::new();
    for c in &obj.components {
        let MenuComponent::AttachLocator(a) = c else { continue };
        for quad in a.null_layer_hashes.chunks_exact(4) {
            if let Some((nom, pose)) = par_hash.get(&quad[1]) {
                out.push(AttachSlot {
                    bone: String::from(*nom),
                    target_hash: quad[2],
                    index: quad[3],
                    pose: *pose,
                });
            }
        }
    }
    out
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

    /// Cas réel `avatar01_00_avatar_edit_bg` : l'atlas fait 2640×1364, l'os retenu 2640×1080 —
    /// exactement le rectangle de la région `bg01`. L'os désigne donc l'image voulue, pas
    /// seulement une échelle. Un squelette sans géométrie ne désigne rien : la position vient
    /// alors du driver, pas des fichiers, et il ne faut surtout pas inventer une région.
    #[test]
    fn taille_designee_rend_la_region_visee() {
        let l = layout(alloc::vec![bone("_bg", tf(0.0, 0.0, 2640.0, 1080.0))]);
        let t = taille_designee(&l, 2640, 1364).expect("os avec géométrie");
        assert!((t.0 - 2640.0).abs() < 0.5 && (t.1 - 1080.0).abs() < 0.5, "{t:?}");

        let locator = layout(alloc::vec![bone("_atc", tf(10.0, 20.0, 1.0, 1.0))]);
        assert!(taille_designee(&locator, 2640, 1364).is_none());
    }

    /// Un `CMenuAttachLocator` rend un emplacement **par quadruplet**, résolu sur le squelette
    /// du porteur : trois os `_atc_*` → trois positions distinctes, chacune portant l'objet cible
    /// et son rang. Le slot 0 (ici volontairement différent) ne doit pas être confondu avec la
    /// clé de résolution, qui est le slot 1.
    #[test]
    fn attach_slots_resolve_bones_of_the_locator_itself() {
        use crate::objbin::AttachLocatorComponent;
        let sk = layout(alloc::vec![
            bone("_atc_item01", tf(1757.0, -658.0, 1.0, 1.0)),
            bone("_atc_item02", tf(1757.0, -782.0, 1.0, 1.0)),
            bone("_absent_du_locator", tf(9.0, 9.0, 1.0, 1.0)),
        ]);
        let cible = crate::cfgbin::crc32(b"vroad01_53_tournament_plate_small");
        let obj = MenuObject {
            name: String::from("vroad01_01_list_locator_attach"),
            engine_type: String::from("gmdMenuObj"),
            g4pkm_path: None,
            g4tx_path: None,
            components: alloc::vec![MenuComponent::AttachLocator(AttachLocatorComponent {
                type_name: String::from("CMenuAttachLocator"),
                null_layer_hashes: alloc::vec![
                    0xDEAD_BEEF, crate::cfgbin::crc32(b"_atc_item01"), cible, 0,
                    0xDEAD_BEEF, crate::cfgbin::crc32(b"_atc_item02"), cible, 1,
                    // Os inconnu du squelette : aucun emplacement, surtout pas un repli.
                    0xDEAD_BEEF, crate::cfgbin::crc32(b"_jamais_declare"), cible, 2,
                ],
            })],
        };

        let slots = attach_slots(&obj, &sk);
        assert_eq!(slots.len(), 2, "l'os absent ne doit produire aucun emplacement");
        assert_eq!(slots[0].bone, "_atc_item01");
        assert_eq!(slots[0].target_hash, cible);
        assert_eq!(slots[0].index, 0);
        assert_eq!(slots[1].bone, "_atc_item02");
        assert_eq!(slots[1].index, 1);

        // Conversion écran : origine haut-gauche, Y descendant. Deux guides empilés à la même
        // abscisse, dans le canvas — c'est ce que le repère centré rendait faux (x≈1811).
        let (x0, y0) = slots[0].to_css();
        let (x1, y1) = slots[1].to_css();
        assert!((x0 - 1757.0 * 1280.0 / 1920.0).abs() < 0.5, "x0={x0}");
        assert!((x0 - x1).abs() < f32::EPSILON, "même colonne");
        assert!(x0 < CANVAS_W && y0 < CANVAS_H, "dans le canvas : ({x0}, {y0})");
        assert!(y1 > y0, "index croissant = plus bas à l'écran");
    }

    /// Bout-en-bout sur le vrai jeu : `option02_02.g4pkm` (bone nvidia plein écran
    /// 1920×1080) → l'objet positionné est centré et remplit le canvas.
    #[test]
    fn real_option02_02_fullscreen_object() {
        let dir = crate::vfs::resolve_game_dir().to_string_lossy().into_owned();
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
