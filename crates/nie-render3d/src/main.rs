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

/// Vrai (fini et de magnitude raisonnable) — filtre les sommets aberrants des submeshes de map
/// dont le layout vertex n'est pas encore RE (positions à ~1e33).
fn finite_ok(v: [f32; 3]) -> bool {
    v.iter().all(|c| c.is_finite() && c.abs() < 1.0e6)
}

/// Convertit le GLB en triangles plats colorés par hauteur (visualisation **map** : géométrie
/// d'environnement deux-faces, indépendante des textures/winding). Renvoie (tris, centre, étendue).
/// Ignore les triangles aberrants. Sert à rendre le **monde 3D** du jeu.
fn map_tris(models: &[glb::Model]) -> (Vec<scene::Tri>, [f32; 3], f32) {
    // bbox **robuste par percentiles** : certains submeshes (layout non-RE) ont des positions
    // aberrantes même < 1e6 ; on cadre sur le cœur (centile 1–99) de la distribution. Plusieurs
    // modèles = chunks d'un stage, déjà en coordonnées monde → simple union.
    let mut axes: [Vec<f32>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    for model in models {
        for p in &model.primitives {
            for v in &p.positions {
                if finite_ok(*v) {
                    for k in 0..3 {
                        axes[k].push(v[k]);
                    }
                }
            }
        }
    }
    let pct = |sorted: &[f32], q: f32| -> f32 {
        if sorted.is_empty() {
            return 0.0;
        }
        let i = ((sorted.len() - 1) as f32 * q) as usize;
        sorted[i]
    };
    let (mut lo, mut hi) = ([0.0f32; 3], [0.0f32; 3]);
    for k in 0..3 {
        axes[k].sort_by(|a, b| a.partial_cmp(b).unwrap());
        lo[k] = pct(&axes[k], 0.01);
        hi[k] = pct(&axes[k], 0.99);
    }
    let center = [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5];
    let extent = (0..3).map(|k| hi[k] - lo[k]).fold(0.0f32, f32::max).max(1.0);
    let (y0, y1) = (lo[1], hi[1].max(lo[1] + 1.0));
    // On ne garde que les triangles dont les 3 sommets sont dans ~1,5× la bbox robuste du centre
    // (élimine les triangles parasites qui relient un sommet valide à un sommet aberrant).
    let lim = extent * 1.5;
    let near_core = |v: [f32; 3]| (0..3).all(|k| (v[k] - center[k]).abs() <= lim);
    let mut tris = Vec::new();
    for model in models {
        for p in &model.primitives {
            for t in p.indices.chunks_exact(3) {
                let (ia, ib, ic) = (t[0] as usize, t[1] as usize, t[2] as usize);
                if ia.max(ib).max(ic) >= p.positions.len() {
                    continue;
                }
                let (a, b, c) = (p.positions[ia], p.positions[ib], p.positions[ic]);
                if !(near_core(a) && near_core(b) && near_core(c)) {
                    continue;
                }
                let yc = (((a[1] + b[1] + c[1]) / 3.0 - y0) / (y1 - y0)).clamp(0.0, 1.0);
                let col = [(70.0 + 95.0 * yc) as u8, (92.0 + 78.0 * yc) as u8, (72.0 + 58.0 * yc) as u8];
                tris.push(scene::Tri { p: [a, b, c], color: col });
            }
        }
    }
    (tris, center, extent)
}

/// Rend une map sous l'angle `angle` (caméra orbitale auto-cadrée sur la bbox).
fn render_map_frame(tris: &[scene::Tri], center: [f32; 3], extent: f32, angle: f32, w: u32, h: u32) -> Vec<u8> {
    let r = extent * 1.35;
    let cam = scene::Camera {
        eye: [center[0] + r * angle.sin(), center[1] + extent * 0.65, center[2] + r * angle.cos()],
        target: center,
        up: [0.0, 1.0, 0.0],
        fov_y: 0.72,
    };
    scene::render_world(tris, &cam, w, h, [120, 150, 210], [196, 210, 226])
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
    /// Fichier(s) GLB d'entrée (ex. /model-full/<code>.glb). Répétable : en mode --map, tous les
    /// GLB sont composés dans un même monde (les chunks de stage sont en coordonnées monde).
    #[arg(long, required = true)]
    glb: Vec<PathBuf>,
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
    /// Rend le GLB comme une **map/stage** : géométrie d'environnement deux-faces, caméra orbitale
    /// auto-cadrée, coloration par hauteur (robuste aux submeshes non-RE).
    #[arg(long)]
    map: bool,
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
    let mut models = Vec::with_capacity(cli.glb.len());
    for path in &cli.glb {
        let data = std::fs::read(path).with_context(|| format!("lire {}", path.display()))?;
        models.push(glb::parse(&data)?);
    }
    let model = &models[0];
    let tris: usize = models.iter().flat_map(|m| &m.primitives).map(|p| p.indices.len() / 3).sum();
    let verts: usize = models.iter().flat_map(|m| &m.primitives).map(|p| p.positions.len()).sum();
    let nprim: usize = models.iter().map(|m| m.primitives.len()).sum();
    println!("glb={} primitives={nprim} vertices={verts} triangles={tris}", cli.glb.len());

    // Mode map : pré-calcule la géométrie d'environnement une fois (tous les chunks composés).
    let map_data = if cli.map { Some(map_tris(&models)) } else { None };
    if let Some((tris, _, _)) = &map_data {
        println!("map_tris={} (après filtrage des submeshes aberrants)", tris.len());
    }

    let frame = |angle: f32| -> Vec<u8> {
        if let Some((tris, center, extent)) = &map_data {
            render_map_frame(tris, *center, *extent, angle, cli.width, cli.height)
        } else if cli.scene {
            render_scene_frame(model, angle, cli.width, cli.height)
        } else {
            render::render(model, angle, cli.width, cli.height)
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
