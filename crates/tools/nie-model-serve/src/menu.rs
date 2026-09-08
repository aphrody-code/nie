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
//! GPU↔CPU de `nie-game`, cf. `ARCHITECTURE.md` Phase 1c). Ce module ne fait plus que (1)
//! désérialiser le layout JSON, (2) trier par `drawPriority`, (3) mapper chaque objet vers un
//! [`CompositeSprite`]. **Changement de comportement attendu** : la prod `/menu-render` passe
//! de l'ancien compositeur f64 local au compositeur f32 de référence (au près-arrondi
//! f64→f32). Les locators (scale ≈ 0) sont naturellement sautés (bbox vide).
//!
//! v1 = sprites uniquement (les objets `text` sont ignorés ; rendu texte = phase 2 avec
//! l'atlas de police).

use nie_formats::menu::{CompositeSprite, ScreenTransform, compose};
use serde::Deserialize;
use std::fmt;

/// Resource limits applied before allocating a canvas or retaining decoded sprite buffers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MenuRenderLimits {
    /// Maximum number of RGBA pixels in the output canvas.
    pub max_canvas_pixels: u64,
    /// Maximum number of objects accepted from one layout.
    pub max_objects: usize,
    /// Maximum number of decoded pixels accepted for one sprite.
    pub max_sprite_pixels: u64,
}

impl Default for MenuRenderLimits {
    fn default() -> Self {
        Self {
            max_canvas_pixels: 4096 * 4096,
            max_objects: 16_384,
            max_sprite_pixels: 4096 * 4096,
        }
    }
}

/// Failure returned by [`render_menu_with_limits`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MenuRenderError {
    /// The requested canvas exceeds the configured pixel budget.
    CanvasTooLarge {
        /// Requested width after the historical zero-to-one normalization.
        width: u32,
        /// Requested height after the historical zero-to-one normalization.
        height: u32,
        /// Configured pixel budget.
        max_pixels: u64,
    },
    /// The layout contains more objects than the configured budget.
    TooManyObjects {
        /// Number of objects in the layout.
        count: usize,
        /// Configured object budget.
        max: usize,
    },
    /// A decoded sprite exceeds the configured per-sprite pixel budget.
    SpriteTooLarge {
        /// Logical VFS path from the layout.
        logical_path: String,
        /// Decoded texture width.
        width: u32,
        /// Decoded texture height.
        height: u32,
        /// Configured pixel budget.
        max_pixels: u64,
    },
    /// The shared PNG encoder rejected the composed RGBA canvas.
    EncodeFailed,
}

impl fmt::Display for MenuRenderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CanvasTooLarge {
                width,
                height,
                max_pixels,
            } => write!(
                formatter,
                "menu canvas {width}x{height} exceeds {max_pixels} pixels"
            ),
            Self::TooManyObjects { count, max } => {
                write!(formatter, "menu layout has {count} objects; limit is {max}")
            }
            Self::SpriteTooLarge {
                logical_path,
                width,
                height,
                max_pixels,
            } => write!(
                formatter,
                "sprite {logical_path} is {width}x{height}; limit is {max_pixels} pixels"
            ),
            Self::EncodeFailed => formatter.write_str("menu PNG encoding failed"),
        }
    }
}

impl std::error::Error for MenuRenderError {}

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
    render_menu_with_limits(layout, &MenuRenderLimits::default(), &mut load_sprite).ok()
}

/// Renders one layout within explicit canvas, object and decoded-sprite budgets.
///
/// Invalid or missing sprite payloads retain the server's historical behavior and are skipped;
/// inputs that exceed a resource budget fail deterministically before composition.
pub fn render_menu_with_limits<F>(
    layout: &Layout,
    limits: &MenuRenderLimits,
    mut load_sprite: F,
) -> Result<Vec<u8>, MenuRenderError>
where
    F: FnMut(&str) -> Option<(u32, u32, Vec<u8>)>,
{
    let cw = layout.canvas.w.max(1);
    let ch = layout.canvas.h.max(1);
    let canvas_pixels = u64::from(cw) * u64::from(ch);
    let max_canvas_pixels = limits
        .max_canvas_pixels
        .min(u64::try_from(usize::MAX / 4).unwrap_or(u64::MAX));
    if canvas_pixels > max_canvas_pixels {
        return Err(MenuRenderError::CanvasTooLarge {
            width: cw,
            height: ch,
            max_pixels: max_canvas_pixels,
        });
    }
    if layout.objects.len() > limits.max_objects {
        return Err(MenuRenderError::TooManyObjects {
            count: layout.objects.len(),
            max: limits.max_objects,
        });
    }

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
        let sprite_pixels = u64::from(tw) * u64::from(th);
        let max_sprite_pixels = limits
            .max_sprite_pixels
            .min(u64::try_from(usize::MAX / 4).unwrap_or(u64::MAX));
        if sprite_pixels > max_sprite_pixels {
            return Err(MenuRenderError::SpriteTooLarge {
                logical_path: sp.logical_path.clone(),
                width: tw,
                height: th,
                max_pixels: max_sprite_pixels,
            });
        }
        let expected_rgba_len = usize::try_from(sprite_pixels)
            .ok()
            .and_then(|pixels| pixels.checked_mul(4));
        if tw == 0 || th == 0 || expected_rgba_len.is_none_or(|expected| rgba.len() < expected) {
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
        .map(|p| CompositeSprite::neutre(&p.rgba, p.tw, p.th, p.transform, p.anchor_x, p.anchor_y))
        .collect();

    let canvas = compose(cw, ch, &sprites);
    // PNG encodé via l'encodeur RGBA unique de nie-formats (même source que les routes /tex…).
    nie_formats::g4tx_decode::encode_rgba_to_png(&canvas, cw as usize, ch as usize)
        .ok_or(MenuRenderError::EncodeFailed)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn object(path: &str) -> Obj {
        Obj {
            draw_priority: 0,
            transform: Transform {
                x: 0.0,
                y: 0.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rot: 0.0,
                anchor_x: 0.0,
                anchor_y: 0.0,
            },
            sprite: Some(Sprite {
                logical_path: path.to_string(),
                w: 1.0,
                h: 1.0,
            }),
        }
    }

    #[test]
    fn bounded_renderer_encodes_a_small_layout() {
        let layout = Layout {
            canvas: Canvas { w: 1, h: 1 },
            objects: vec![object("mainmenu01/sample.g4tx")],
        };
        let png = render_menu_with_limits(&layout, &MenuRenderLimits::default(), |_| {
            Some((1, 1, vec![10, 20, 30, 255]))
        })
        .expect("one-pixel layout should render");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn canvas_budget_is_checked_before_loading_sprites() {
        let layout = Layout {
            canvas: Canvas { w: 3, h: 2 },
            objects: vec![object("mainmenu01/sample.g4tx")],
        };
        let mut loaded = false;
        let error = render_menu_with_limits(
            &layout,
            &MenuRenderLimits {
                max_canvas_pixels: 5,
                ..MenuRenderLimits::default()
            },
            |_| {
                loaded = true;
                None
            },
        )
        .expect_err("six canvas pixels exceed the five-pixel budget");
        assert_eq!(
            error,
            MenuRenderError::CanvasTooLarge {
                width: 3,
                height: 2,
                max_pixels: 5,
            }
        );
        assert!(!loaded);
    }

    #[test]
    fn object_and_sprite_budgets_are_enforced() {
        let many = Layout {
            canvas: Canvas { w: 1, h: 1 },
            objects: vec![object("a"), object("b")],
        };
        assert_eq!(
            render_menu_with_limits(
                &many,
                &MenuRenderLimits {
                    max_objects: 1,
                    ..MenuRenderLimits::default()
                },
                |_| None,
            ),
            Err(MenuRenderError::TooManyObjects { count: 2, max: 1 })
        );

        let one = Layout {
            canvas: Canvas { w: 1, h: 1 },
            objects: vec![object("mainmenu01/large.g4tx")],
        };
        assert_eq!(
            render_menu_with_limits(
                &one,
                &MenuRenderLimits {
                    max_sprite_pixels: 3,
                    ..MenuRenderLimits::default()
                },
                |_| Some((2, 2, vec![0; 16])),
            ),
            Err(MenuRenderError::SpriteTooLarge {
                logical_path: "mainmenu01/large.g4tx".to_string(),
                width: 2,
                height: 2,
                max_pixels: 3,
            })
        );
    }
}
