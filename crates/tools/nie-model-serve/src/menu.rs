//! Compositeur serveur du menu IEVR : rend un layout (`{canvas, objects[]}`) en PNG.
//!
//! Remplace le renderer WebGPU navigateur (fragile : WebGPU absent/échoue silencieusement
//! → écran blanc) par un rendu **Rust déterministe**, identique pour tous, vérifiable hors
//! navigateur. La math du placement est portée FIDÈLEMENT depuis le vertex shader
//! `menu-render-webgpu/src/shaders.ts` :
//!
//! ```text
//! local      = (corner - anchor) * size * scale      // corner ∈ {0,1}², size = sprite px
//! rotated    = R(rot) * local
//! canvasPos  = pos + rotated                         // repère canvas px, origine haut-gauche
//! ```
//!
//! Projection ortho `canvas.w × canvas.h`. Les objets sont peints par `drawPriority`
//! croissant (painter's order, haute priorité au-dessus).
//!
//! Le **compositing 2D** (blit affine inverse + échantillonnage bilinéaire + blend « over »)
//! n'est plus implémenté ici : il est délégué au compositeur **f32 unique** du workspace
//! [`nie_formats::menu::compose`] (la référence pixel-perfect validée par la comparaison
//! GPU↔CPU de `nie-game`, cf. `DEDUP-PLAN.md` Phase 1c). Ce module ne fait plus que (1)
//! désérialiser le layout JSON, (2) trier par `drawPriority`, (3) mapper chaque objet vers un
//! [`CompositeSprite`]. **Changement de comportement attendu** : la prod `/menu-render` passe
//! de l'ancien compositeur f64 local au compositeur f32 de référence (au près-arrondi
//! f64→f32). Les locators (scale ≈ 0) sont naturellement sautés (bbox vide).
//!
//! v1 = sprites uniquement (les objets `text` sont ignorés ; rendu texte = phase 2 avec
//! l'atlas de police).

use nie_formats::menu::{CompositeSprite, ScreenTransform, compose};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Layout {
    pub canvas: Canvas,
    pub objects: Vec<Obj>,
}

#[derive(Deserialize)]
pub struct Canvas {
    pub w: u32,
    pub h: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Obj {
    #[serde(default)]
    pub draw_priority: i64,
    pub transform: Transform,
    #[serde(default)]
    pub sprite: Option<Sprite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    #[serde(default)]
    pub rot: f64,
    pub anchor_x: f64,
    pub anchor_y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sprite {
    pub logical_path: String,
    /// Taille du quad (px) = taille native de la texture telle qu'annoncée par le layout.
    pub w: f64,
    pub h: f64,
}

/// Rend le layout en PNG RGBA. `load_sprite(logical_path)` doit renvoyer `(tw, th, rgba8)`
/// (texture décodée) ou `None` si absente/indécodable (le sprite est alors sauté).
///
/// Le compositing est délégué à [`nie_formats::menu::compose`] (compositeur f32 unique). On
/// décode chaque sprite, on convertit son [`Transform`] (f64, layout) en [`ScreenTransform`]
/// (f32, nie-formats), puis on compose dans l'ordre `drawPriority` croissant.
pub fn render_menu<F>(layout: &Layout, mut load_sprite: F) -> Option<Vec<u8>>
where
    F: FnMut(&str) -> Option<(u32, u32, Vec<u8>)>,
{
    let cw = layout.canvas.w.max(1);
    let ch = layout.canvas.h.max(1);

    // Painter's order : drawPriority croissant, stable sur l'index source.
    let mut order: Vec<usize> = (0..layout.objects.len()).collect();
    order.sort_by(|&a, &b| {
        layout.objects[a]
            .draw_priority
            .cmp(&layout.objects[b].draw_priority)
            .then(a.cmp(&b))
    });

    // Décode + prépare chaque sprite visible. Les buffers RGBA sont conservés vivants (les
    // `CompositeSprite` empruntent leur slice le temps du compositing).
    let mut prepared: Vec<Prepared> = Vec::with_capacity(order.len());
    for &i in &order {
        let o = &layout.objects[i];
        let Some(sp) = &o.sprite else { continue };
        if sp.w <= 0.0 || sp.h <= 0.0 {
            continue;
        }
        let t = &o.transform;
        // Dégénéré (locator / aplati) → invisible. Garde portée sur l'échelle ORIGINALE (avant
        // la compensation quad/texture ci-dessous), identique à l'ancien blit f64.
        if t.scale_x.abs() < 1e-9 || t.scale_y.abs() < 1e-9 {
            continue;
        }
        let Some((tw, th, rgba)) = load_sprite(&sp.logical_path) else {
            continue;
        };
        if tw == 0 || th == 0 || rgba.len() < (tw as usize * th as usize * 4) {
            continue;
        }

        // Le layout exprime la taille du quad en « sprite px » (`sp.w`×`sp.h`), alors que la
        // texture décodée fait `tw`×`th` (sélecteur d'atlas → souvent ≠). Le compositeur f32
        // prend un sprite dont le quad EST la texture ; on reporte donc le ratio quad/texture
        // dans l'échelle : `scale' = scale · (quad/texture)`. C'est **algébriquement identique**
        // à l'ancien blit f64 (qui rééchantillonnait `u = (lx/qw)·tw`) : à `lx/qw == lx'/tw` la
        // bbox, le mapping inverse et l'échantillon texel coïncident — au près-arrondi f64→f32.
        let qx = sp.w as f32 / tw as f32;
        let qy = sp.h as f32 / th as f32;
        prepared.push(Prepared {
            rgba,
            tw,
            th,
            transform: ScreenTransform {
                x_px: t.x as f32,
                y_px: t.y as f32,
                scale_x: t.scale_x as f32 * qx,
                scale_y: t.scale_y as f32 * qy,
                rot: t.rot as f32,
            },
            anchor_x: t.anchor_x as f32,
            anchor_y: t.anchor_y as f32,
        });
    }

    let sprites: Vec<CompositeSprite> = prepared
        .iter()
        .map(|p| CompositeSprite {
            rgba: &p.rgba,
            width: p.tw,
            height: p.th,
            transform: p.transform,
            anchor_x: p.anchor_x,
            anchor_y: p.anchor_y,
        })
        .collect();

    let canvas = compose(cw, ch, &sprites);
    // PNG encodé via l'encodeur RGBA unique de nie-formats (même source que les routes /tex…).
    nie_formats::g4tx_decode::encode_rgba_to_png(&canvas, cw as usize, ch as usize)
}

/// Sprite décodé + transform écran prêt à composer. Détient son buffer RGBA (les
/// [`CompositeSprite`] passés à [`compose`] empruntent ce buffer).
struct Prepared {
    rgba: Vec<u8>,
    tw: u32,
    th: u32,
    transform: ScreenTransform,
    anchor_x: f32,
    anchor_y: f32,
}
