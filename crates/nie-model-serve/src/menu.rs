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
//! croissant (painter's order, haute priorité au-dessus). Chaque sprite est blitté par
//! mapping affine inverse (gère scale non-uniforme + rotation + ancre) avec
//! échantillonnage bilinéaire et blend « over » alpha droit.
//!
//! v1 = sprites uniquement (les objets `text` sont ignorés ; rendu texte = phase 2 avec
//! l'atlas de police). Les locators (scale ≈ 0) sont naturellement sautés (bbox vide).

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
    /// Taille du quad (px) = taille native de la texture.
    pub w: f64,
    pub h: f64,
}

/// Rend le layout en PNG RGBA. `load_sprite(logical_path)` doit renvoyer `(tw, th, rgba8)`
/// (texture décodée) ou `None` si absente/indécodable (le sprite est alors sauté).
pub fn render_menu<F>(layout: &Layout, mut load_sprite: F) -> Option<Vec<u8>>
where
    F: FnMut(&str) -> Option<(u32, u32, Vec<u8>)>,
{
    let cw = layout.canvas.w.max(1) as i64;
    let ch = layout.canvas.h.max(1) as i64;
    let mut canvas = vec![0u8; (cw * ch * 4) as usize];

    // Painter's order : drawPriority croissant, stable sur l'index source.
    let mut order: Vec<usize> = (0..layout.objects.len()).collect();
    order.sort_by(|&a, &b| {
        layout.objects[a]
            .draw_priority
            .cmp(&layout.objects[b].draw_priority)
            .then(a.cmp(&b))
    });

    for &i in &order {
        let o = &layout.objects[i];
        let Some(sp) = &o.sprite else { continue };
        if sp.w <= 0.0 || sp.h <= 0.0 {
            continue;
        }
        let Some((tw, th, rgba)) = load_sprite(&sp.logical_path) else {
            continue;
        };
        if tw == 0 || th == 0 || rgba.len() < (tw as usize * th as usize * 4) {
            continue;
        }
        blit_sprite(&mut canvas, cw, ch, &o.transform, sp.w, sp.h, tw, th, &rgba);
    }

    encode_png(&canvas, cw as u32, ch as u32)
}

/// Blit affine d'un sprite sur le canvas, par mapping inverse + bilinéaire + blend over.
#[allow(clippy::too_many_arguments)]
fn blit_sprite(
    canvas: &mut [u8],
    cw: i64,
    ch: i64,
    t: &Transform,
    qw: f64,
    qh: f64,
    tw: u32,
    th: u32,
    rgba: &[u8],
) {
    // Degenerate (locator / aplati) → invisible.
    if t.scale_x.abs() < 1e-9 || t.scale_y.abs() < 1e-9 {
        return;
    }
    let (sin, cos) = t.rot.sin_cos();
    let ax = t.anchor_x * qw;
    let ay = t.anchor_y * qh;

    // Forward : local(px sprite) → canvas. v = local - anchor_px ; s = v*scale ; r = R*s ; +pos.
    let fwd = |lx: f64, ly: f64| -> (f64, f64) {
        let vx = (lx - ax) * t.scale_x;
        let vy = (ly - ay) * t.scale_y;
        (t.x + vx * cos - vy * sin, t.y + vx * sin + vy * cos)
    };

    // Bounding box écran depuis les 4 coins du quad.
    let corners = [fwd(0.0, 0.0), fwd(qw, 0.0), fwd(0.0, qh), fwd(qw, qh)];
    let min_x = corners.iter().map(|c| c.0).fold(f64::INFINITY, f64::min).floor() as i64;
    let max_x = corners.iter().map(|c| c.0).fold(f64::NEG_INFINITY, f64::max).ceil() as i64;
    let min_y = corners.iter().map(|c| c.1).fold(f64::INFINITY, f64::min).floor() as i64;
    let max_y = corners.iter().map(|c| c.1).fold(f64::NEG_INFINITY, f64::max).ceil() as i64;
    let x0 = min_x.max(0);
    let y0 = min_y.max(0);
    let x1 = max_x.min(cw);
    let y1 = max_y.min(ch);
    if x0 >= x1 || y0 >= y1 {
        return;
    }

    let inv_sx = 1.0 / t.scale_x;
    let inv_sy = 1.0 / t.scale_y;

    for py in y0..y1 {
        for px in x0..x1 {
            // Centre du pixel → local. Inverse de fwd : d=canvas-pos ; un-rot ; un-scale ; +anchor.
            let dx = (px as f64 + 0.5) - t.x;
            let dy = (py as f64 + 0.5) - t.y;
            let sx = dx * cos + dy * sin; // R^-1
            let sy = -dx * sin + dy * cos;
            let lx = sx * inv_sx + ax;
            let ly = sy * inv_sy + ay;
            if lx < 0.0 || ly < 0.0 || lx >= qw || ly >= qh {
                continue;
            }
            // Échantillon bilinéaire dans la texture (quad px → texel via ratio qw/tw).
            let u = (lx / qw) * tw as f64 - 0.5;
            let v = (ly / qh) * th as f64 - 0.5;
            let (sr, sg, sb, sa) = sample_bilinear(rgba, tw, th, u, v);
            if sa <= 0.0 {
                continue;
            }
            // Blend over alpha droit sur le canvas.
            let di = ((py * cw + px) * 4) as usize;
            let dr = canvas[di] as f64 / 255.0;
            let dg = canvas[di + 1] as f64 / 255.0;
            let db = canvas[di + 2] as f64 / 255.0;
            let da = canvas[di + 3] as f64 / 255.0;
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

/// Échantillon bilinéaire RGBA (0..1) avec clamp aux bords. `u`,`v` en coords texel.
fn sample_bilinear(rgba: &[u8], tw: u32, th: u32, u: f64, v: f64) -> (f64, f64, f64, f64) {
    let x0 = u.floor();
    let y0 = v.floor();
    let fx = u - x0;
    let fy = v - y0;
    let clampx = |x: f64| (x as i64).clamp(0, tw as i64 - 1) as usize;
    let clampy = |y: f64| (y as i64).clamp(0, th as i64 - 1) as usize;
    let x0c = clampx(x0);
    let x1c = clampx(x0 + 1.0);
    let y0c = clampy(y0);
    let y1c = clampy(y0 + 1.0);
    let texel = |xc: usize, yc: usize| -> (f64, f64, f64, f64) {
        let i = (yc * tw as usize + xc) * 4;
        (
            rgba[i] as f64 / 255.0,
            rgba[i + 1] as f64 / 255.0,
            rgba[i + 2] as f64 / 255.0,
            rgba[i + 3] as f64 / 255.0,
        )
    };
    let c00 = texel(x0c, y0c);
    let c10 = texel(x1c, y0c);
    let c01 = texel(x0c, y1c);
    let c11 = texel(x1c, y1c);
    let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
    let mix = |a: (f64, f64, f64, f64), b: (f64, f64, f64, f64), t: f64| {
        (
            lerp(a.0, b.0, t),
            lerp(a.1, b.1, t),
            lerp(a.2, b.2, t),
            lerp(a.3, b.3, t),
        )
    };
    let top = mix(c00, c10, fx);
    let bot = mix(c01, c11, fx);
    mix(top, bot, fy)
}

/// Encode un buffer RGBA brut en PNG.
fn encode_png(rgba: &[u8], w: u32, h: u32) -> Option<Vec<u8>> {
    let mut out: Vec<u8> = Vec::new();
    {
        let mut enc = png::Encoder::new(std::io::Cursor::new(&mut out), w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out)
}
