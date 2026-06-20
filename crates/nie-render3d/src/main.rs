//! Binaire `nie-render3d` — charge un GLB (modèle réel reconstruit des CPK) et le rend en 3D :
//! PNG (vue fixe) ou MP4 turntable. Headless.
//!
//! ```text
//! nie-render3d --glb /tmp/c01000010.glb --frames 120 --out /tmp/chr.mp4
//! ```

#![forbid(unsafe_code)]
#![allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};
use clap::Parser;
use nie_render3d::{glb, render};

#[derive(Parser, Debug)]
#[command(about = "Rend un GLB réel (asset CPK) en 3D → PNG/MP4 turntable (headless)")]
struct Cli {
    /// Fichier GLB d'entrée (ex. produit par model-serve /model-full/<code>.glb).
    #[arg(long)]
    glb: PathBuf,
    /// Sortie : PNG si --frames 1, sinon MP4 turntable.
    #[arg(long, default_value = "/tmp/niers-model.png")]
    out: PathBuf,
    /// Nombre d'images (1 = vue fixe PNG ; >1 = tour complet → MP4).
    #[arg(long, default_value_t = 1)]
    frames: u32,
    #[arg(long, default_value_t = 30)]
    fps: u32,
    #[arg(long, default_value_t = 720)]
    width: u32,
    #[arg(long, default_value_t = 720)]
    height: u32,
}

fn encode_png(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(std::io::Cursor::new(&mut out), w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().context("png header")?;
        wr.write_image_data(rgba).context("png data")?;
    }
    Ok(out)
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let data = std::fs::read(&cli.glb).with_context(|| format!("lire {}", cli.glb.display()))?;
    let model = glb::parse(&data)?;
    let tris: usize = model.primitives.iter().map(|p| p.indices.len() / 3).sum();
    let verts: usize = model.primitives.iter().map(|p| p.positions.len()).sum();
    println!("glb={} primitives={} vertices={verts} triangles={tris}", cli.glb.display(), model.primitives.len());

    if cli.frames <= 1 {
        let rgba = render::render(&model, 0.6, cli.width, cli.height);
        std::fs::write(&cli.out, encode_png(&rgba, cli.width, cli.height)?)?;
        println!("png={}", cli.out.display());
        return Ok(());
    }

    let dir = std::env::temp_dir().join(format!("niers-r3d-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    for i in 0..cli.frames {
        let angle = std::f32::consts::TAU * (i as f32) / (cli.frames as f32);
        let rgba = render::render(&model, angle, cli.width, cli.height);
        std::fs::write(dir.join(format!("f_{i:04}.png")), encode_png(&rgba, cli.width, cli.height)?)?;
    }
    encode_video(&dir, cli.fps, &cli.out)?;
    let _ = std::fs::remove_dir_all(&dir);
    let sz = std::fs::metadata(&cli.out).map(|m| m.len()).unwrap_or(0);
    println!("video={} ({sz} octets)", cli.out.display());
    Ok(())
}

fn encode_video(dir: &Path, fps: u32, out: &Path) -> Result<()> {
    let status = Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-framerate", &fps.to_string(), "-i"])
        .arg(dir.join("f_%04d.png"))
        .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
        .arg(out)
        .status()
        .context("lancer ffmpeg")?;
    anyhow::ensure!(status.success(), "ffmpeg a échoué");
    Ok(())
}
