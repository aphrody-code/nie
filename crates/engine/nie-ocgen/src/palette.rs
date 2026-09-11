//! Measured palette — what the reference sheets actually contain, not what a description says.
//!
//! A swatch is only ever produced from pixels: an image, a declared rectangle, and the dominant
//! cluster inside it. Clustering runs in **Oklab**, where Euclidean distance tracks perceived
//! difference, so a shaded and a lit sample of the same jacket land in one cluster instead of two.
//!
//! Two things are deliberately not done here. Roles are never guessed from a cluster: the caller
//! declares which rectangle is the hair and which is the jersey, because only a human eye knows
//! what a character-design sheet shows. And the paper the drawing sits on is rejected by an
//! explicit lightness/chroma test, reported as a share, never silently dropped — a probe that
//! rejects 98 % of its pixels landed on the margin, and the report has to say so.

use serde::{Deserialize, Serialize};

use crate::Error;

/// A rectangle in normalised image coordinates, `0.0..=1.0`, origin top-left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    /// Left edge.
    pub x: f32,
    /// Top edge.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
}

impl Rect {
    /// Converts to pixel bounds `(x0, y0, x1, y1)`, clamped to the image and never empty.
    #[must_use]
    pub fn to_pixels(self, width: u32, height: u32) -> (u32, u32, u32, u32) {
        let clamp = |value: f32, max: u32| -> u32 {
            let scaled = (value.clamp(0.0, 1.0) * max as f32).round();
            (scaled as u32).min(max)
        };
        let x0 = clamp(self.x, width);
        let y0 = clamp(self.y, height);
        let x1 = clamp(self.x + self.w, width).max(x0 + 1).min(width);
        let y1 = clamp(self.y + self.h, height).max(y0 + 1).min(height);
        (x0, y0, x1, y1)
    }
}

/// A named region to measure on a named reference sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Probe {
    /// Palette role this region feeds (`hair`, `skin`, `iris`, `jersey_primary`...).
    pub role: String,
    /// Sheet file name, relative to the reference directory.
    pub sheet: String,
    /// Region measured on that sheet.
    pub rect: Rect,
}

/// One measured colour, with everything needed to re-measure it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Swatch {
    /// Role the probe declared.
    pub role: String,
    /// Sheet the pixels came from.
    pub sheet: String,
    /// Region measured.
    pub rect: Rect,
    /// Dominant cluster centre, sRGB 8-bit.
    pub rgb: [u8; 3],
    /// Same colour as `#rrggbb`.
    pub hex: String,
    /// Cluster centre in Oklab, `[L, a, b]`.
    pub oklab: [f32; 3],
    /// Background colour rejected for this sheet, as `#rrggbb` — what the measurement excluded.
    pub background: String,
    /// Pixels inspected inside the region.
    pub sampled: u32,
    /// Pixels kept after background rejection.
    pub kept: u32,
    /// Share of the kept pixels that fell in the dominant cluster, `0.0..=1.0`.
    pub share: f32,
    /// Mean Oklab distance from the cluster centre — how tight the measurement is.
    pub spread: f32,
}

/// How a probe decides a pixel is not part of the drawing.
///
/// The first version of this used a generic "light and unsaturated is paper" threshold, and it was
/// wrong on the first character it met: Astro Lor's pale hair is as light and as unsaturated as the
/// paper it is drawn on, so the threshold ate the hair and the probe returned the ink outline.
/// A threshold that describes paper in general cannot separate paper from a pale cream; only the
/// paper of *this sheet* can. So the background is **measured on the sheet's own margin** and
/// rejection becomes a small distance around that measured colour.
///
/// Ink is a different problem and is left mostly alone: an outline and a near-black jersey sleeve
/// sit within hundredths of each other in lightness, so anything aggressive enough to drop the
/// outline also drops the sleeve. Only near-pure black is rejected; a stray outline crossing a
/// probe shows up as a lower `share` instead, which is what the report is for.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rejection {
    /// Measured background in Oklab. `None` asks [`measure_one`] to measure it off the margin.
    pub background: Option<[f32; 3]>,
    /// Oklab radius around the background inside which a pixel counts as paper.
    pub background_radius: f32,
    /// Below this lightness a pixel is a pure ink outline, not a surface colour.
    pub ink_lightness: f32,
}

impl Default for Rejection {
    fn default() -> Self {
        Self {
            background: None,
            // Measured on the two astro-lor sheets: the paper sits at Oklab L 0.93 with a chroma
            // of 0.004, the palest hair at L 0.94 with a chroma of 0.02 — 0.017 apart. A radius of
            // 0.010 keeps them on opposite sides while still absorbing the paper's own JPEG noise.
            background_radius: 0.010,
            ink_lightness: 0.08,
        }
    }
}

/// Number of clusters used per probe.
const CLUSTERS: usize = 4;
/// Fixed-point iterations; the centres stop moving well before this on a single-garment region.
const ITERATIONS: usize = 24;
/// Target sample count per probe — larger regions are strided down to roughly this many pixels.
const TARGET_SAMPLES: u32 = 30_000;

/// sRGB 8-bit to linear.
fn linearize(channel: u8) -> f32 {
    let value = f32::from(channel) / 255.0;
    match value <= 0.040_45 {
        true => value / 12.92,
        false => ((value + 0.055) / 1.055).powf(2.4),
    }
}

/// Linear to sRGB 8-bit.
fn encode(value: f32) -> u8 {
    let clamped = value.clamp(0.0, 1.0);
    let srgb = match clamped <= 0.003_130_8 {
        true => clamped * 12.92,
        false => 1.055 * clamped.powf(1.0 / 2.4) - 0.055,
    };
    (srgb * 255.0).round().clamp(0.0, 255.0) as u8
}

/// sRGB 8-bit to Oklab (Björn Ottosson's matrices).
#[must_use]
pub fn oklab(rgb: [u8; 3]) -> [f32; 3] {
    let r = linearize(rgb[0]);
    let g = linearize(rgb[1]);
    let b = linearize(rgb[2]);
    let l = (0.412_221_46 * r + 0.536_332_5 * g + 0.051_445_995 * b).cbrt();
    let m = (0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b).cbrt();
    let s = (0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_5 * b).cbrt();
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

/// Oklab back to sRGB 8-bit.
#[must_use]
pub fn from_oklab(lab: [f32; 3]) -> [u8; 3] {
    let l = (lab[0] + 0.396_337_78 * lab[1] + 0.215_803_76 * lab[2]).powi(3);
    let m = (lab[0] - 0.105_561_346 * lab[1] - 0.063_854_17 * lab[2]).powi(3);
    let s = (lab[0] - 0.089_484_18 * lab[1] - 1.291_485_5 * lab[2]).powi(3);
    [
        encode(4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s),
        encode(-1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s),
        encode(-0.004_196_086 * l - 0.703_418_6 * m + 1.707_614_7 * s),
    ]
}

/// Chroma of an Oklab colour.
#[must_use]
pub fn chroma(lab: [f32; 3]) -> f32 {
    lab[1].hypot(lab[2])
}

/// Squared Oklab distance.
fn distance2(a: [f32; 3], b: [f32; 3]) -> f32 {
    let (dl, da, db) = (a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    dl.mul_add(dl, da.mul_add(da, db * db))
}

/// A decoded reference sheet.
pub struct Sheet {
    /// File name the probe refers to.
    pub name: String,
    /// Pixel width.
    pub width: u32,
    /// Pixel height.
    pub height: u32,
    /// Row-major RGB triples, `width * height * 3` bytes.
    pub rgb: Vec<u8>,
}

impl Sheet {
    /// Decodes an image file into a sheet.
    ///
    /// The extension is not trusted: two of the recorded comic pages arrived as `.jpg` carrying
    /// WebP bytes, so the format is guessed from the content.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Image`] when the bytes are not a supported image.
    pub fn decode(name: &str, bytes: &[u8]) -> Result<Self, Error> {
        let decoded = image::load_from_memory(bytes)
            .map_err(|error| Error::Image(format!("{name}: {error}")))?
            .to_rgb8();
        Ok(Self {
            name: name.to_string(),
            width: decoded.width(),
            height: decoded.height(),
            rgb: decoded.into_raw(),
        })
    }

    /// Measures the sheet's own background from its margin.
    ///
    /// The four corner patches of a character-design sheet are paper and nothing else. Taking the
    /// dominant cluster of those pixels — rather than their mean — keeps a signature or a stray
    /// mark in one corner from dragging the measured paper colour off.
    #[must_use]
    pub fn background(&self) -> [f32; 3] {
        let patch = (self.width.min(self.height) / 40).max(4);
        let mut samples = Vec::new();
        for (ox, oy) in [
            (0, 0),
            (self.width.saturating_sub(patch), 0),
            (0, self.height.saturating_sub(patch)),
            (
                self.width.saturating_sub(patch),
                self.height.saturating_sub(patch),
            ),
        ] {
            let mut y = oy;
            while y < (oy + patch).min(self.height) {
                let mut x = ox;
                while x < (ox + patch).min(self.width) {
                    if let Some(rgb) = self.pixel(x, y) {
                        samples.push(oklab(rgb));
                    }
                    x += 2;
                }
                y += 2;
            }
        }
        match samples.is_empty() {
            true => [1.0, 0.0, 0.0],
            false => dominant_cluster(&samples).0,
        }
    }

    /// Pixel at `(x, y)`; `None` outside the image.
    #[must_use]
    pub fn pixel(&self, x: u32, y: u32) -> Option<[u8; 3]> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let offset = ((y as usize) * (self.width as usize) + (x as usize)) * 3;
        let slice = self.rgb.get(offset..offset + 3)?;
        Some([slice[0], slice[1], slice[2]])
    }
}

/// Deterministic 32-bit LCG — k-means++ needs a random draw, the pipeline needs the same one twice.
struct Lcg(u32);

impl Lcg {
    /// Next value in `0.0..1.0`.
    fn next_unit(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (self.0 >> 8) as f32 / 16_777_216.0
    }
}

/// Runs one probe against its sheet.
///
/// # Errors
///
/// Returns [`Error::Palette`] when the sheet is missing, or when the region holds no pixel that
/// survives background rejection — a probe on the paper margin must fail loudly, not return white.
pub fn measure(probe: &Probe, sheets: &[Sheet], rejection: Rejection) -> Result<Swatch, Error> {
    let sheet = sheets
        .iter()
        .find(|sheet| sheet.name == probe.sheet)
        .ok_or_else(|| Error::Palette(format!("planche \u{ab} {} \u{bb} absente", probe.sheet)))?;
    measure_one(probe, sheet, rejection)
}

/// Runs one probe against one already-selected sheet.
///
/// # Errors
///
/// Returns [`Error::Palette`] when the region holds no pixel that survives background rejection.
pub fn measure_one(probe: &Probe, sheet: &Sheet, rejection: Rejection) -> Result<Swatch, Error> {
    let background = rejection.background.unwrap_or_else(|| sheet.background());
    let radius2 = rejection.background_radius * rejection.background_radius;
    let (x0, y0, x1, y1) = probe.rect.to_pixels(sheet.width, sheet.height);
    let area = u64::from(x1 - x0) * u64::from(y1 - y0);
    let stride = (area / u64::from(TARGET_SAMPLES)).max(1).isqrt().max(1) as u32;

    let mut samples: Vec<[f32; 3]> = Vec::new();
    let mut sampled = 0_u32;
    let mut y = y0;
    while y < y1 {
        let mut x = x0;
        while x < x1 {
            if let Some(rgb) = sheet.pixel(x, y) {
                sampled += 1;
                let lab = oklab(rgb);
                let is_paper = distance2(lab, background) <= radius2;
                if !is_paper && lab[0] > rejection.ink_lightness {
                    samples.push(lab);
                }
            }
            x += stride;
        }
        y += stride;
    }

    if samples.is_empty() {
        let paper = from_oklab(background);
        return Err(Error::Palette(format!(
            "{} / {} : {sampled} pixels inspectés, aucun ne survit au rejet de fond \
             (fond mesuré #{:02x}{:02x}{:02x})",
            probe.sheet, probe.role, paper[0], paper[1], paper[2]
        )));
    }

    let (center, share, spread) = dominant_cluster(&samples);
    let rgb = from_oklab(center);
    Ok(Swatch {
        role: probe.role.clone(),
        sheet: probe.sheet.clone(),
        rect: probe.rect,
        rgb,
        hex: format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2]),
        oklab: center,
        background: format!(
            "#{:02x}{:02x}{:02x}",
            from_oklab(background)[0],
            from_oklab(background)[1],
            from_oklab(background)[2]
        ),
        sampled,
        kept: samples.len() as u32,
        share,
        spread,
    })
}

/// k-means in Oklab; returns the largest cluster's centre, its share and its mean radius.
fn dominant_cluster(samples: &[[f32; 3]]) -> ([f32; 3], f32, f32) {
    let k = CLUSTERS.min(samples.len());
    let mut centers = seed_centers(samples, k);
    let mut assignment = vec![0_usize; samples.len()];

    for _ in 0..ITERATIONS {
        let mut moved = false;
        for (index, sample) in samples.iter().enumerate() {
            let mut best = 0;
            let mut best_distance = f32::INFINITY;
            for (slot, center) in centers.iter().enumerate() {
                let distance = distance2(*sample, *center);
                if distance < best_distance {
                    best_distance = distance;
                    best = slot;
                }
            }
            if assignment[index] != best {
                assignment[index] = best;
                moved = true;
            }
        }
        let mut sums = vec![[0.0_f64; 3]; k];
        let mut counts = vec![0_u32; k];
        for (index, sample) in samples.iter().enumerate() {
            let slot = assignment[index];
            counts[slot] += 1;
            for axis in 0..3 {
                sums[slot][axis] += f64::from(sample[axis]);
            }
        }
        for slot in 0..k {
            if counts[slot] == 0 {
                continue;
            }
            for axis in 0..3 {
                centers[slot][axis] = (sums[slot][axis] / f64::from(counts[slot])) as f32;
            }
        }
        if !moved {
            break;
        }
    }

    let mut counts = vec![0_u32; k];
    for slot in &assignment {
        counts[*slot] += 1;
    }
    let best = counts
        .iter()
        .enumerate()
        .max_by_key(|(index, count)| (**count, std::cmp::Reverse(*index)))
        .map_or(0, |(index, _)| index);
    let center = centers[best];
    let members: Vec<[f32; 3]> = samples
        .iter()
        .zip(&assignment)
        .filter(|(_, slot)| **slot == best)
        .map(|(sample, _)| *sample)
        .collect();
    let spread = match members.is_empty() {
        true => 0.0,
        false => {
            members
                .iter()
                .map(|sample| distance2(*sample, center).sqrt())
                .sum::<f32>()
                / members.len() as f32
        }
    };
    let share = members.len() as f32 / samples.len() as f32;
    (center, share, spread)
}

/// k-means++ seeding with a fixed stream, so the same pixels always give the same centres.
fn seed_centers(samples: &[[f32; 3]], k: usize) -> Vec<[f32; 3]> {
    let mut rng = Lcg(0x9E37_79B9);
    let mut centers = vec![samples[0]];
    while centers.len() < k {
        let weights: Vec<f32> = samples
            .iter()
            .map(|sample| {
                centers
                    .iter()
                    .map(|center| distance2(*sample, *center))
                    .fold(f32::INFINITY, f32::min)
            })
            .collect();
        let total: f32 = weights.iter().sum();
        if total <= f32::EPSILON {
            break;
        }
        let mut target = rng.next_unit() * total;
        let mut chosen = weights.len() - 1;
        for (index, weight) in weights.iter().enumerate() {
            target -= *weight;
            if target <= 0.0 {
                chosen = index;
                break;
            }
        }
        centers.push(samples[chosen]);
    }
    centers
}
