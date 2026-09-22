//! Binaire `nie-runtime` — exécute la boucle moteur nie (simulation + physique + rendu) et
//! produit une **vidéo MP4** (ou des frames PNG) d'un match déterministe. Headless.
//!
//! ```text
//! nie-runtime --frames 600 --fps 60 --out /tmp/nie-match.mp4
//! ```

#![forbid(unsafe_code)]
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use nie_runtime::render;
use nie_runtime::{HALF_LEN, HALF_WID, World};

/// Marge identique à celle du renderer (pour le calcul d'aspect auto).
const MARGIN: u32 = 28;

#[derive(Parser, Debug)]
#[command(about = "Moteur nie : simule + rend un match déterministe → MP4/PNG (headless)")]
struct Cli {
    /// Nombre de pas/frames à simuler.
    #[arg(long, default_value_t = 600)]
    frames: u32,
    /// Frames par seconde (pas de simulation = 1/fps).
    #[arg(long, default_value_t = 60)]
    fps: u32,
    /// Largeur de l'image (px).
    #[arg(long, default_value_t = 1024)]
    width: u32,
    /// Hauteur (px) ; 0 = auto pour garder l'aspect 105:68 du terrain.
    #[arg(long, default_value_t = 0)]
    height: u32,
    /// Fichier MP4 de sortie.
    #[arg(long, default_value = "/tmp/nie-match.mp4")]
    out: PathBuf,
    /// N'encode pas la vidéo : écrit seulement la dernière frame en PNG (à côté de `--out`).
    #[arg(long, default_value_t = false)]
    no_video: bool,
    /// Conserve les frames PNG intermédiaires (sinon supprimées après encodage).
    #[arg(long, default_value_t = false)]
    keep_frames: bool,
}

fn encode_png(frame: &render::Frame) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(std::io::Cursor::new(&mut out), frame.w, frame.h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().context("png header")?;
        wr.write_image_data(&frame.px).context("png data")?;
    }
    Ok(out)
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let fps = cli.fps.max(1);
    let width = cli.width.max(2 * MARGIN + 32);
    // Aspect terrain : hauteur déduite de la largeur si non fournie.
    let height = if cli.height == 0 {
        let inner_w = (width - 2 * MARGIN) as f32;
        let inner_h = inner_w * (2.0 * HALF_WID) / (2.0 * HALF_LEN);
        inner_h as u32 + 2 * MARGIN
    } else {
        cli.height
    };
    let dt = 1.0 / fps as f32;

    let dir = std::env::temp_dir().join(format!("nie-frames-{}", std::process::id()));
    let want_frames = !cli.no_video;
    if want_frames {
        std::fs::create_dir_all(&dir).context("créer le dossier de frames")?;
    }

    let mut world = World::kickoff();
    // La vidéo se construit EN MÊME TEMPS que la boucle, directement depuis les octets RGBA :
    // elle ne dépend plus du répertoire de PNG. Celui-ci reste écrit quand `want_frames` le
    // demande, parce que `--keep-frames` est une fonctionnalité et non un intermédiaire.
    let mut encodeur = if cli.no_video {
        None
    } else {
        Some(nie_video::ouvrir(
            &nie_video::Params {
                largeur: width,
                hauteur: height,
                fps,
                codec: nie_video::Codec::H264,
                crf: 18,
            },
            &cli.out,
        )?)
    };
    let mut last_png: Option<Vec<u8>> = None;
    for i in 0..cli.frames {
        world.step(dt);
        let frame = render::render(&world, width, height);
        if let Some(enc) = encodeur.as_mut() {
            enc.pousser_rgba(&frame.px)?;
        }
        let png = encode_png(&frame)?;
        if want_frames {
            std::fs::write(dir.join(format!("frame_{i:05}.png")), &png)
                .with_context(|| format!("écrire frame {i}"))?;
        }
        last_png = Some(png);
    }

    println!(
        "tick={} time={:.1}s score={}-{} ball=({:.1},{:.1},{:.2}) {width}x{height}",
        world.tick,
        world.time,
        world.score[0],
        world.score[1],
        world.ball.pos.x,
        world.ball.pos.y,
        world.ball.pos.z
    );

    if cli.no_video {
        if let Some(png) = last_png {
            let still = cli.out.with_extension("png");
            std::fs::write(&still, png).context("écrire la frame finale")?;
            println!("still={}", still.display());
        }
        return Ok(());
    }

    let sz = match encodeur {
        Some(enc) => enc.finir()?.octets,
        None => 0,
    };
    if !cli.keep_frames {
        let _ = std::fs::remove_dir_all(&dir);
    }
    println!("video={} ({} octets)", cli.out.display(), sz);
    Ok(())
}
