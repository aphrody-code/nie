//! Headless CLI game engine runtime (`niers play`).
//!
//! Executes the identical game loop across WASM, Win32, Linux, and CLI:
//! - State machine transitions (`Screen::Title`, `Screen::Menu`, `Screen::ModeSelect`, `Screen::Match`, `Screen::Story`)
//! - IEVR native command handling (`CMD_ENTER`, `CMD_BACK`, `CMD_FCS_MTX_*`)
//! - Deterministic physics and match simulation via `nie_runtime::World`
//! - Framebuffer rendering (1280x720) and optional image export (PPM/PNG)

use anyhow::{Context, Result};
use nie_app::flow::Screen;
use nie_app::render::{Font, H, W};
use std::path::{Path, PathBuf};

#[derive(Debug, clap::Args)]
pub struct PlayArgs {
    /// Initial screen to start on ("title", "menu", "modes", "match").
    #[arg(long, default_value = "menu")]
    pub screen: String,

    /// Number of frames to execute.
    #[arg(long, default_value_t = 60)]
    pub frames: u32,

    /// Simulated target frames-per-second (physics dt = 1.0 / fps).
    #[arg(long, default_value_t = 60.0)]
    pub fps: f64,

    /// Comma-separated or space-separated command sequence to dispatch.
    /// Supports: enter, back, up, down, left, right.
    #[arg(long)]
    pub cmd: Option<String>,

    /// Directly enter the 22-player match simulation.
    #[arg(long)]
    pub r#match: bool,

    /// Match simulation duration in seconds (overrides --frames if set).
    #[arg(long)]
    pub match_seconds: Option<f32>,

    /// Path to export the final rendered framebuffer (PPM format).
    #[arg(long)]
    pub out: Option<PathBuf>,

    /// Output machine-readable JSON status.
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct PlaySummary {
    pub initial_screen: String,
    pub final_screen: String,
    pub frames_executed: u32,
    pub simulated_time_seconds: f64,
    pub commands_applied: Vec<String>,
    pub match_score: Option<MatchScore>,
    pub frame_rendered: bool,
    pub out_path: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct MatchScore {
    pub home: u32,
    pub away: u32,
    pub ball_pos: [f32; 3],
}

pub fn run(args: PlayArgs) -> Result<()> {
    let dt = (1.0 / args.fps) as f32;
    let mut applied_cmds = Vec::new();

    let mut screen = if args.r#match {
        Screen::Match {
            world: nie_runtime::World::kickoff(),
        }
    } else {
        match args.screen.to_lowercase().as_str() {
            "title" => Screen::Title,
            "modes" => Screen::ModeSelect { sel: 0 },
            "match" => Screen::Match {
                world: nie_runtime::World::kickoff(),
            },
            _ => {
                // Default to main menu
                let mut s = Screen::Title;
                s.input("CMD_ENTER");
                applied_cmds.push("CMD_ENTER (boot->menu)".to_string());
                s
            }
        }
    };

    // Apply input commands if specified
    if let Some(cmd_str) = &args.cmd {
        for token in cmd_str.split([',', ' ', ';']) {
            let t = token.trim();
            if t.is_empty() {
                continue;
            }
            let lower = t.to_lowercase();
            let native_cmd = match lower.as_str() {
                "enter" | "ok" | "confirm" | "start" => "CMD_ENTER",
                "back" | "cancel" | "esc" => "CMD_BACK",
                "up" => "CMD_FCS_MTX_UP",
                "down" => "CMD_FCS_MTX_DOWN",
                "left" => "CMD_FCS_MTX_LEFT",
                "right" => "CMD_FCS_MTX_RIGHT",
                other => other,
            };
            screen.input(native_cmd);
            applied_cmds.push(native_cmd.to_string());
        }
    }

    // Determine frame count
    let total_frames = if let Some(sec) = args.match_seconds {
        (sec * args.fps as f32).round() as u32
    } else {
        args.frames
    };

    // Run game loop
    for _ in 0..total_frames {
        screen.update(dt);
    }

    // Inspect final state
    let (final_screen_name, match_score) = match &screen {
        Screen::Title => ("Title".to_string(), None),
        Screen::Menu { sel } => (format!("Menu(sel={sel})"), None),
        Screen::ModeSelect { sel } => (format!("ModeSelect(sel={sel})"), None),
        Screen::Match { world } => {
            let score = MatchScore {
                home: world.score[0],
                away: world.score[1],
                ball_pos: [world.ball.pos.x, world.ball.pos.y, world.ball.pos.z],
            };
            ("Match".to_string(), Some(score))
        }
        Screen::Story { idx, titre, .. } => (format!("Story(event={titre}, idx={idx})"), None),
        Screen::Info { title } => (format!("Info({title})"), None),
        Screen::Liste { titre, sel, .. } => (format!("Liste({titre}, sel={sel})"), None),
    };

    // Render frame if output requested or for render verification
    let mut frame_rendered = false;
    let mut out_path_str = None;

    if let Some(out_path) = &args.out {
        let font = Font::default();
        let frame = screen.render(&font);
        write_ppm(out_path, &frame)
            .with_context(|| format!("écriture du rendu vers {}", out_path.display()))?;
        frame_rendered = true;
        out_path_str = Some(out_path.display().to_string());
    }

    let summary = PlaySummary {
        initial_screen: args.screen,
        final_screen: final_screen_name.clone(),
        frames_executed: total_frames,
        simulated_time_seconds: f64::from(total_frames) * f64::from(dt),
        commands_applied: applied_cmds,
        match_score,
        frame_rendered,
        out_path: out_path_str,
    };

    if args.json {
        println!("{}", serde_json::to_string_pretty(&summary)?);
    } else {
        println!(
            "nie-play status=OK screen={} frames={} time={:.2}s out={}",
            final_screen_name,
            total_frames,
            summary.simulated_time_seconds,
            args.out
                .as_ref()
                .map_or("none", |p| p.to_str().unwrap_or("-"))
        );
        if let Some(score) = &summary.match_score {
            println!(
                "match score home={} away={} ball=[{:.1}, {:.1}, {:.1}]",
                score.home, score.away, score.ball_pos[0], score.ball_pos[1], score.ball_pos[2]
            );
        }
    }

    Ok(())
}

/// Simple Netpbm PPM writer (P6 binary) for native zero-dependency frame dump.
fn write_ppm(path: &Path, rgba: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut file = std::fs::File::create(path)?;
    // PPM header: P6 <width> <height> <max_val>
    writeln!(file, "P6\n{} {}\n255", W, H)?;
    let mut rgb = Vec::with_capacity(W * H * 3);
    for chunk in rgba.chunks_exact(4) {
        // RGBA -> RGB
        rgb.push(chunk[0]);
        rgb.push(chunk[1]);
        rgb.push(chunk[2]);
    }
    file.write_all(&rgb)?;
    file.flush()?;
    Ok(())
}
