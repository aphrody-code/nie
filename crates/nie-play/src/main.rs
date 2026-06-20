//! **nie-play** — front-end HEADLESS/GOLDEN du jeu niers.
//!
//! Mince client de [`nie_app`] : il fournit un Renderer CPU + un flow scripté, exécute la machine à
//! états du cœur ([`nie_app::GameState`]), et écrit le playthrough en PNG (→ MP4 via ffmpeg). Le
//! match vient de la vraie FSM `nie_core::simulate_match`. Le runner INTERACTIF (GPU, input temps-réel)
//! est `nie-game` — un autre front-end du même cœur (cf. `docs/UNIFICATION.md`).
//!
//! Usage : `nie-play --font-cfg <font.cfg.bin> --font-g4tx <font.g4tx> [--char-{md,mg,sk,tex} …] --out <dir>`

use anyhow::{Context, Result};
use clap::Parser;
use nie_app::render::CharAssets;
use nie_app::{demo_flow, CpuRenderer, Renderer, H, W};
use nie_core::match_sim::{simulate_match, TeamSetup};
use nie_core::stats::StatBlock;

#[derive(Parser)]
struct Cli {
    /// `font.cfg.bin` (métriques de police).
    #[arg(long)]
    font_cfg: std::path::PathBuf,
    /// `font.g4tx` (atlas de police).
    #[arg(long)]
    font_g4tx: std::path::PathBuf,
    /// Répertoire de sortie des frames.
    #[arg(long, default_value = "/tmp/nie-play")]
    out: std::path::PathBuf,
    /// Graine du match.
    #[arg(long, default_value = "12345")]
    seed: u64,
    /// Perso 3D affiché sur les écrans (optionnel) : mesh g4md.
    #[arg(long)]
    char_md: Option<std::path::PathBuf>,
    /// Perso 3D : géométrie g4mg.
    #[arg(long)]
    char_mg: Option<std::path::PathBuf>,
    /// Perso 3D : squelette g4sk.
    #[arg(long)]
    char_sk: Option<std::path::PathBuf>,
    /// Perso 3D : texture g4tx (BC7).
    #[arg(long)]
    char_tex: Option<std::path::PathBuf>,
    /// Équipe domicile depuis de VRAIS chara_param (`chara_param_*.cfg.bin.json`) au lieu de stats en dur.
    #[arg(long)]
    chara_param: Option<std::path::PathBuf>,
}

fn team(name: &str, base: u16) -> TeamSetup {
    TeamSetup::new(
        name,
        StatBlock { kc: base, cr: base, tc: base, pr: base, ps: base, ag: base, it: base },
    )
}

fn write_png(buf: &[u8], path: &std::path::Path) -> Result<()> {
    let mut out = Vec::new();
    {
        let mut e = png::Encoder::new(std::io::Cursor::new(&mut out), W as u32, H as u32);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        e.write_header()?.write_image_data(buf)?;
    }
    std::fs::write(path, &out)?;
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    std::fs::create_dir_all(&cli.out)?;

    // Équipe domicile : vrais chara_param si fournis (pont données Phase 2), sinon stats en dur.
    let home = match &cli.chara_param {
        Some(p) => {
            let t = nie_app::roster::team_from_chara_param_json("RAIMON", p, 11, 99)
                .context("chargement équipe depuis chara_param")?;
            println!("[nie-play] équipe RAIMON = 11 vrais chara_param (lv99) → stats réelles");
            t
        }
        None => team("RAIMON", 120),
    };
    // Match RÉEL via la FSM portée (nie-core).
    let res = simulate_match(home, team("ROYAL ACADEMY", 95), cli.seed);

    // Renderer CPU (police + perso 3D optionnel), fourni au cœur nie-app.
    let chr = match (&cli.char_md, &cli.char_mg, &cli.char_sk, &cli.char_tex) {
        (Some(md), Some(mg), Some(sk), Some(tex)) => Some(CharAssets { md, mg, sk, tex }),
        _ => None,
    };
    let renderer = CpuRenderer::new(&cli.font_cfg, &cli.font_g4tx, chr).context("init renderer")?;

    // Playthrough : la machine à états de nie-app, rendue par le front CPU.
    let flow = demo_flow(res.home_score, res.away_score);
    let mut frame = 0u32;
    for (state, dur) in &flow {
        println!("[nie-play] etat = {state:?}");
        match state {
            // Le match se JOUE : sim physique nie-runtime (best-effort, approximative — PAS la
            // boucle C++ byte-fidèle, cf. docs/UNIFICATION.md fracture #1) rendue frame par frame.
            nie_app::GameState::Match { .. } => {
                let mut world = nie_runtime::World::kickoff();
                for _ in 0..*dur {
                    world.step(1.0 / 30.0);
                    let fr = nie_runtime::render::render(&world, W as u32, H as u32);
                    write_png(&fr.px, &cli.out.join(format!("f{frame:04}.png")))?;
                    frame += 1;
                }
                println!("[nie-play]   match JOUÉ (nie-runtime, physique) score={:?}", world.score);
            }
            _ => {
                let buf = renderer.render(state);
                for _ in 0..*dur {
                    write_png(&buf, &cli.out.join(format!("f{frame:04}.png")))?;
                    frame += 1;
                }
            }
        }
    }
    println!(
        "[nie-play] playthrough = {frame} frames → {} (match RAIMON {}-{} ROYAL via FSM nie-core, coeur nie-app)",
        cli.out.display(),
        res.home_score,
        res.away_score
    );
    Ok(())
}
