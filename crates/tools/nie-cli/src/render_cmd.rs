//! Captures de contrôle visuel pour les GLB assemblés par NIE.
//!
//! Cette façade reste dans `niers` : un agent ou un humain peut ainsi demander une vue stable
//! ou une rotation complète sans connaître le binaire de rendu interne ni assembler ffmpeg.

use std::fs;
use std::fs::File;
use std::path::Path;

use anyhow::{Context, Result, ensure};
use image::codecs::gif::{GifEncoder, Repeat};
use image::{Delay, Frame, ImageBuffer, Rgba};
use nie_render3d::gpu::{Backend, Camera, GpuModel, GpuOptions, GpuRenderer};
use nie_render3d::{glb, render};

/// Côté maximal d'une capture : prévient un rendu accidentel de plusieurs centaines de Mio.
const MAX_SIDE: u32 = 4096;
/// Surface maximale d'une image, y compris lorsqu'une dimension reste inférieure à [`MAX_SIDE`].
const MAX_PIXELS: u64 = 16 * 1024 * 1024;
/// Garde-fou d'un GIF : la sortie est destinée à inspecter un tour, non à encoder une vidéo.
const MAX_GIF_FRAMES: u32 = 240;

fn verifier_dimensions(width: u32, height: u32) -> Result<()> {
    ensure!(
        width > 0 && height > 0,
        "la sortie doit avoir une largeur et une hauteur positives"
    );
    ensure!(
        width <= MAX_SIDE
            && height <= MAX_SIDE
            && u64::from(width) * u64::from(height) <= MAX_PIXELS,
        "dimensions {width}×{height} hors limite (maximum {MAX_SIDE}×{MAX_SIDE} et {MAX_PIXELS} pixels)"
    );
    Ok(())
}

fn charger(glb_path: &Path) -> Result<glb::Model> {
    let bytes =
        fs::read(glb_path).with_context(|| format!("lecture GLB {}", glb_path.display()))?;
    glb::parse(&bytes).with_context(|| format!("GLB invalide {}", glb_path.display()))
}

/// Rend un modèle CPU ou GPU en gardant le GPU vivant pendant toute la rotation.
enum Renderer<'a> {
    Cpu(&'a glb::Model),
    Gpu {
        renderer: GpuRenderer,
        model: GpuModel,
    },
}

impl<'a> Renderer<'a> {
    fn new(model: &'a glb::Model, gpu: bool, backend: &str, hardware_only: bool) -> Result<Self> {
        if !gpu {
            return Ok(Self::Cpu(model));
        }
        let backend = backend.parse::<Backend>().map_err(anyhow::Error::msg)?;
        let renderer = GpuRenderer::with_options(GpuOptions {
            backend,
            allow_software: !hardware_only,
        })?;
        let info = renderer.adapter_info();
        println!(
            "gpu backend={:?} adaptateur={:?} type={:?} pilote={:?}",
            info.backend, info.name, info.device_type, info.driver
        );
        let gpu_model = renderer.upload(model);
        Ok(Self::Gpu {
            renderer,
            model: gpu_model,
        })
    }

    fn frame(&mut self, angle: f32, width: u32, height: u32) -> Result<Vec<u8>> {
        match self {
            Self::Cpu(model) => Ok(render::render(model, angle, width, height)),
            Self::Gpu { renderer, model } => {
                let rgba = renderer.render(
                    model,
                    Camera {
                        yaw: -angle,
                        ..Default::default()
                    }
                    .clamped(),
                    width,
                    height,
                )?;
                Ok(composer_fond(&rgba, width, height))
            }
        }
    }
}

/// Rend les exports GPU lisibles avec le même fond opaque que les captures CPU.
fn composer_fond(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut resultat = Vec::with_capacity(rgba.len());
    for y in 0..height {
        let fond = render::couleur_fond(y, height);
        for x in 0..width {
            let i = ((y * width + x) * 4) as usize;
            let alpha = u16::from(rgba[i + 3]);
            for canal in 0..3 {
                let avant = u16::from(rgba[i + canal]);
                let arriere = u16::from(fond[canal]);
                resultat.push(((avant * alpha + arriere * (255 - alpha)) / 255) as u8);
            }
            resultat.push(255);
        }
    }
    resultat
}

fn encoder_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut out), width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().context("en-tête PNG")?;
        writer.write_image_data(rgba).context("pixels PNG")?;
    }
    Ok(out)
}

/// Rend un GLB sous une vue reproductible en PNG sans perte.
pub(crate) fn glb_png(
    glb_path: &Path,
    out: &Path,
    width: u32,
    height: u32,
    angle: f32,
    gpu: bool,
    backend: &str,
    hardware_only: bool,
) -> Result<()> {
    verifier_dimensions(width, height)?;
    ensure!(angle.is_finite(), "l'angle doit être un nombre fini");
    let model = charger(glb_path)?;
    let mut renderer = Renderer::new(&model, gpu, backend, hardware_only)?;
    let rgba = renderer.frame(angle, width, height)?;
    let png = encoder_png(&rgba, width, height)?;
    fs::write(out, png).with_context(|| format!("écriture PNG {}", out.display()))?;
    println!(
        "png={} source={} dimensions={}×{} angle={angle:.6} rendu={}",
        out.display(),
        glb_path.display(),
        width,
        height,
        if gpu { "gpu" } else { "cpu" }
    );
    Ok(())
}

/// Rend un tour complet en GIF animé, avec chaque angle espacé uniformément.
pub(crate) fn glb_gif(
    glb_path: &Path,
    out: &Path,
    width: u32,
    height: u32,
    frames: u32,
    fps: u32,
    gpu: bool,
    backend: &str,
    hardware_only: bool,
) -> Result<()> {
    verifier_dimensions(width, height)?;
    ensure!(frames >= 2, "un GIF turntable exige au moins 2 images");
    ensure!(
        frames <= MAX_GIF_FRAMES,
        "un GIF est limité à {MAX_GIF_FRAMES} images"
    );
    ensure!(
        fps > 0 && fps <= 120,
        "la cadence GIF doit être comprise entre 1 et 120 i/s"
    );

    let model = charger(glb_path)?;
    let mut renderer = Renderer::new(&model, gpu, backend, hardware_only)?;
    let file = File::create(out).with_context(|| format!("écriture GIF {}", out.display()))?;
    let mut encoder = GifEncoder::new(file);
    encoder.set_repeat(Repeat::Infinite).context("boucle GIF")?;
    let delay = Delay::from_numer_denom_ms(1000, fps);
    for index in 0..frames {
        let angle = std::f32::consts::TAU * index as f32 / frames as f32;
        let rgba = renderer.frame(angle, width, height)?;
        let buffer = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(width, height, rgba)
            .context("taille de frame GIF incohérente")?;
        encoder
            .encode_frame(Frame::from_parts(buffer, 0, 0, delay))
            .context("frame GIF")?;
    }
    println!(
        "gif={} source={} dimensions={}×{} frames={frames} fps={fps} rendu={}",
        out.display(),
        glb_path.display(),
        width,
        height,
        if gpu { "gpu" } else { "cpu" }
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dimensions_reject_an_unbounded_capture() {
        assert!(verifier_dimensions(1024, 1024).is_ok());
        assert!(verifier_dimensions(0, 720).is_err());
        assert!(verifier_dimensions(4097, 4096).is_err());
    }

    #[test]
    fn gif_encoder_writes_an_animated_gif_header() {
        let mut out = Vec::new();
        {
            let mut encoder = GifEncoder::new(&mut out);
            encoder.set_repeat(Repeat::Infinite).expect("boucle GIF");
            let buffer = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(2, 2, vec![255; 16])
                .expect("frame RGBA");
            encoder
                .encode_frame(Frame::from_parts(
                    buffer,
                    0,
                    0,
                    Delay::from_numer_denom_ms(1000, 12),
                ))
                .expect("frame GIF");
        }
        assert!(out.starts_with(b"GIF89a"));
    }
}
