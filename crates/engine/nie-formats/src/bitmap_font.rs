//! Bounded, host-neutral bitmap font loading and text rasterization from real VFS bytes.
use crate::{cfgbin, font, g4tx, g4tx_decode};

/// Decoded atlas and native glyph metrics, reusable across text runs.
pub struct BitmapFont {
    atlas_bgra: Vec<u8>,
    metrics: font::FontMetrics,
}

/// One transparent text run with native bearings and cell height.
#[derive(Debug)]
pub struct TextRaster {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl BitmapFont {
    /// Validate the font metadata and decode its DDS through the shared texture owner.
    pub fn from_bytes(config: &[u8], texture: &[u8]) -> Result<Self, String> {
        if config.len() > 4 * 1024 * 1024 || texture.len() > 128 * 1024 * 1024 {
            return Err("font input exceeds size limit".into());
        }
        let cfg = cfgbin::parse_t2b(config).map_err(|e| e.to_string())?;
        let metrics = font::parse_metrics(&cfg);
        if metrics.glyph_count() == 0 || metrics.dims.cell_height == 0 || metrics.dims.cell_height > 512 {
            return Err("invalid font metrics".into());
        }
        let parsed = g4tx::parse(texture).map_err(|e| e.to_string())?;
        let atlas = g4tx::select_main_texture(&parsed, "font").ok_or("missing font atlas")?;
        if atlas.width <= 0 || atlas.height <= 0 || i64::from(atlas.width) * i64::from(atlas.height) > 16 * 1024 * 1024 {
            return Err("font atlas exceeds dimensions limit".into());
        }
        let (width, height, mut pixels) = g4tx_decode::decode_texture_rgba(texture, atlas).ok_or("invalid font texture")?;
        if width != metrics.atlas_width || height != metrics.atlas_height || pixels.len() != width as usize * height as usize * 4 {
            return Err("font atlas and metrics dimensions disagree".into());
        }
        // The shared glyph blitter accepts the native BGRA channel order.
        for pixel in pixels.chunks_exact_mut(4) { pixel.swap(0, 2); }
        for glyph in metrics.glyphs.values() {
            if glyph.page > 3 || u32::from(glyph.x) + u32::from(glyph.width) > width || u32::from(glyph.y) + u32::from(metrics.dims.cell_height) > height {
                return Err("font glyph exceeds atlas bounds".into());
            }
        }
        Ok(Self { atlas_bgra: pixels, metrics })
    }

    /// Render one bounded line. Unknown characters fail explicitly instead of losing accents.
    pub fn render(&self, text: &str, color: [u8; 4]) -> Result<TextRaster, String> {
        if text.chars().count() > 512 { return Err("text exceeds glyph limit".into()); }
        let mut pen = 0i32;
        let mut left = 0i32;
        let mut right = 0i32;
        for ch in text.chars() {
            let glyph = self.metrics.glyph_char(ch).ok_or_else(|| format!("missing native glyph U+{:04X}", ch as u32))?;
            let start = pen + i32::from(glyph.bearing_x);
            left = left.min(start);
            right = right.max(start + i32::from(glyph.width));
            pen += i32::from(glyph.advance);
        }
        let width = (right.max(pen) - left).max(1) as u32;
        if width > 16384 { return Err("text exceeds raster width limit".into()); }
        let height = u32::from(self.metrics.dims.cell_height);
        let mut rgba = vec![0; width as usize * height as usize * 4];
        font::draw_text(&self.atlas_bgra, self.metrics.atlas_width, &self.metrics, text, &mut rgba, width * 4, -left, i32::from(self.metrics.dims.ascent), color);
        Ok(TextRaster { width, height, rgba })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::{FontDimensions, FontMetrics, GlyphMetric};

    fn synthetic_font() -> BitmapFont {
        let glyph = GlyphMetric { font: 0, base: 0, codepoint: 0xC3A9, x: 0, y: 0, width: 1, bearing_x: -1, advance: 2, page: 0 };
        BitmapFont { atlas_bgra: vec![0, 0, 211, 0], metrics: FontMetrics { atlas_width: 1, atlas_height: 1, dims: FontDimensions { cell_height: 1, ascent: 1, descent: 0 }, glyphs: [(glyph.codepoint, glyph)].into(), ..Default::default() } }
    }

    #[test]
    fn accented_text_keeps_negative_bearing_and_native_channel() {
        let raster = synthetic_font().render("éé", [4, 8, 12, 255]).unwrap();
        assert_eq!((raster.width, raster.height), (5, 1));
        assert_eq!(&raster.rgba[..4], &[4, 8, 12, 211]);
        assert_eq!(&raster.rgba[8..12], &[4, 8, 12, 211]);
        assert_eq!(&raster.rgba[4..8], &[0; 4]);
    }

    #[test]
    fn rejects_missing_glyphs_and_unbounded_text() {
        let font = synthetic_font();
        assert!(font.render("x", [255; 4]).unwrap_err().contains("U+0078"));
        assert!(font.render(&"é".repeat(513), [255; 4]).is_err());
        assert!(BitmapFont::from_bytes(b"invalid", b"invalid").is_err());
    }

    #[test]
    #[ignore = "requires private VFS font assets in NIE_FONT_FIXTURE_DIR"]
    fn native_loader_preserves_french_and_channel_masks() {
        let root = std::path::PathBuf::from(std::env::var_os("NIE_FONT_FIXTURE_DIR").expect("fixture directory"));
        let config = std::fs::read(root.join("font.cfg.bin")).unwrap();
        let texture = std::fs::read(root.join("font.g4tx")).unwrap();
        let font = BitmapFont::from_bytes(&config, &texture).unwrap();
        let a = font.render("A", [255; 4]).unwrap();
        assert_eq!((a.width, a.height), (39, 71));
        assert_eq!(a.rgba.chunks_exact(4).filter(|p| p[3] > 0).count(), 544);
        for text in ["Créer avatar", "Équipe", "éèêëàâçîïôùûüœŒ’…", "木語金"] {
            let raster = font.render(text, [255; 4]).unwrap();
            assert!(raster.rgba.chunks_exact(4).any(|p| p[3] > 0));
        }
    }
}
