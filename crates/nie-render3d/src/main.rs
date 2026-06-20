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
use nie_render3d::{glb, render, scene};

/// Boîte englobante (min,max) de toutes les positions du modèle.
fn aabb(model: &glb::Model) -> ([f32; 3], [f32; 3]) {
    let mut lo = [f32::MAX; 3];
    let mut hi = [f32::MIN; 3];
    for p in &model.primitives {
        for v in &p.positions {
            for k in 0..3 {
                lo[k] = lo[k].min(v[k]);
                hi[k] = hi[k].max(v[k]);
            }
        }
    }
    (lo, hi)
}

/// Sol herbeux rayé autour de l'origine (quads plats).
fn ground() -> Vec<scene::Tri> {
    let mut t = Vec::new();
    let r = 4.0f32;
    let stripes = 8;
    for i in 0..stripes {
        let z0 = -r + 2.0 * r * (i as f32) / stripes as f32;
        let z1 = -r + 2.0 * r * ((i + 1) as f32) / stripes as f32;
        let g = if i % 2 == 0 { [46u8, 150, 64] } else { [40u8, 134, 58] };
        t.push(scene::Tri { p: [[-r, 0.0, z0], [r, 0.0, z0], [r, 0.0, z1]], color: g });
        t.push(scene::Tri { p: [[-r, 0.0, z0], [r, 0.0, z1], [-r, 0.0, z1]], color: g });
    }
    t
}

/// Transform modèle→monde : centré en x/z, pieds à y=0, mis à l'échelle ~1,7 m, tourné de `angle`.
fn place(model: &glb::Model, angle: f32) -> scene::Mat4 {
    let (lo, hi) = aabb(model);
    let s = 1.7 / (hi[1] - lo[1]).max(1e-3);
    let (cx, cz) = ((lo[0] + hi[0]) * 0.5, (lo[2] + hi[2]) * 0.5);
    let m = scene::mat_mul(&scene::mat_scale(s), &scene::mat_translate([-cx, -lo[1], -cz]));
    scene::mat_mul(&scene::mat_rot_y(angle), &m)
}

/// Rend un modèle posé sur le sol via le compositeur de scène (caméra monde fixe).
fn render_scene_frame(model: &glb::Model, angle: f32, w: u32, h: u32) -> Vec<u8> {
    let cam = scene::Camera {
        eye: [0.0, 1.05, 3.3],
        target: [0.0, 0.95, 0.0],
        up: [0.0, 1.0, 0.0],
        fov_y: 0.72,
    };
    let inst = [scene::Instance { model, transform: place(model, angle) }];
    scene::render_scene(&ground(), &inst, &cam, w, h, [120, 150, 210], [58, 86, 140])
}

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
    /// Pose le modèle texturé sur un sol et le rend via le compositeur de scène (caméra monde).
    #[arg(long)]
    scene: bool,
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

    let frame = |angle: f32| -> Vec<u8> {
        if cli.scene {
            render_scene_frame(&model, angle, cli.width, cli.height)
        } else {
            render::render(&model, angle, cli.width, cli.height)
        }
    };

    if cli.frames <= 1 {
        let rgba = frame(0.6);
        std::fs::write(&cli.out, encode_png(&rgba, cli.width, cli.height)?)?;
        println!("png={}", cli.out.display());
        return Ok(());
    }

    let dir = std::env::temp_dir().join(format!("niers-r3d-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    for i in 0..cli.frames {
        let angle = std::f32::consts::TAU * (i as f32) / (cli.frames as f32);
        let rgba = frame(angle);
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
