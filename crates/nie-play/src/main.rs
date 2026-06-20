//! **nie-play** — le jeu *Inazuma Eleven: Victory Road* réimplémenté, intégré en UN binaire.
//!
//! Machine à états du jeu (Titre → Menu → Match → Histoire) qui CÂBLE les systèmes reversés :
//! - **Match** : `nie_core::match_sim::simulate_match` (FSM portée du C décompilé).
//! - **Texte/dialogues** : `nie_formats::font::LatinAtlas` (police RÉELLE du jeu, edge-scan).
//! - (les menus fidèles `mainmenu01` viendront du driver runtime D1.c ; ici front intégré minimal.)
//!
//! Headless : exécute un *playthrough* scripté et écrit chaque état en PNG (→ MP4 via ffmpeg).
//! C'est l'INTÉGRATION : un jeu navigable, pas des briques éparses.
//! Usage : `nie-play --font-cfg <font.cfg.bin> --font-g4tx <font.g4tx> --out <dir>`

mod character;

use anyhow::{Context, Result};
use clap::Parser;
use nie_core::match_sim::{simulate_match, TeamSetup};
use nie_core::stats::StatBlock;
use nie_formats::font::{self, LatinAtlas};
use nie_formats::{cfgbin, g4tx};

const W: usize = 1280;
const H: usize = 720;

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
}

/// Atlas de police chargé (octets + LatinAtlas + dims), pour le rendu de texte.
struct Font {
    atlas: Vec<u8>,
    la: LatinAtlas,
    aw: usize,
}

impl Font {
    fn load(cfg_path: &std::path::Path, g4tx_path: &std::path::Path) -> Result<Self> {
        let cfg = cfgbin::parse_t2b(&std::fs::read(cfg_path)?).map_err(|e| anyhow::anyhow!("cfg: {e:?}"))?;
        let metrics = font::parse_metrics(&cfg);
        let g4tx_bytes = std::fs::read(g4tx_path)?;
        let tx = g4tx::parse(&g4tx_bytes).map_err(|e| anyhow::anyhow!("g4tx: {e:?}"))?;
        let t = tx.textures.first().context("pas de texture police")?;
        let dds = &g4tx_bytes[t.data_offset..];
        let off = if dds.len() >= 88 && &dds[84..88] == b"DX10" { 148 } else { 128 };
        let atlas = dds[off..].to_vec();
        let (aw, ah) = (t.width as usize, t.height as usize);
        let la = LatinAtlas::from_atlas(&atlas, aw, ah, 946, metrics.dims.cell_height);
        Ok(Self { atlas, la, aw })
    }
}

/// Cadre de rendu RGBA + helpers.
struct Screen<'a> {
    buf: Vec<u8>,
    f: &'a Font,
}

impl<'a> Screen<'a> {
    fn new(f: &'a Font) -> Self {
        Self { buf: vec![0u8; W * H * 4], f }
    }
    /// Cadre initialisé depuis une frame RGBA existante (ex. rendu 3D du perso en toile de fond).
    fn from_base(f: &'a Font, base: &[u8]) -> Self {
        let mut buf = vec![0u8; W * H * 4];
        if base.len() == buf.len() {
            buf.copy_from_slice(base);
        }
        Self { buf, f }
    }
    fn gradient(&mut self, top: [u8; 3], bot: [u8; 3]) {
        for y in 0..H {
            let t = y as f32 / H as f32;
            let mix = |a: u8, b: u8| (f32::from(a) * (1.0 - t) + f32::from(b) * t) as u8;
            let c = [mix(top[0], bot[0]), mix(top[1], bot[1]), mix(top[2], bot[2]), 255];
            for x in 0..W {
                let o = (y * W + x) * 4;
                self.buf[o..o + 4].copy_from_slice(&c);
            }
        }
    }
    #[allow(clippy::needless_range_loop)] // blend RGBA : indices explicites (c[k] + buf[o+k]).
    fn rect(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, c: [u8; 4]) {
        let a = f32::from(c[3]) / 255.0;
        for y in y0.max(0)..y1.min(H as i32) {
            for x in x0.max(0)..x1.min(W as i32) {
                let o = (y as usize * W + x as usize) * 4;
                for k in 0..3 {
                    self.buf[o + k] = (f32::from(c[k]) * a + f32::from(self.buf[o + k]) * (1.0 - a)) as u8;
                }
                self.buf[o + 3] = 255;
            }
        }
    }
    fn text(&mut self, x: i32, y: i32, s: &str, color: [u8; 4]) {
        self.f.la.blit_line(&self.f.atlas, self.f.aw, &mut self.buf, W, x, y, s, color);
    }
    fn text_centered(&mut self, y: i32, s: &str, color: [u8; 4]) {
        let w = self.f.la.measure(s) as i32;
        self.text((W as i32 - w) / 2, y, s, color);
    }
    fn save(&self, path: &std::path::Path) -> Result<()> {
        let mut out = Vec::new();
        {
            let mut e = png::Encoder::new(std::io::Cursor::new(&mut out), W as u32, H as u32);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            e.write_header()?.write_image_data(&self.buf)?;
        }
        std::fs::write(path, &out)?;
        Ok(())
    }
}

/// État du jeu (la machine à états centrale).
#[derive(Debug, Clone)]
enum GameState {
    Title,
    MainMenu { sel: usize },
    Match { home: u8, away: u8 },
    Story { speaker: String, line: String },
}

const MENU: [&str; 4] = ["MATCH", "STORY MODE", "MY TEAM", "KIZUNA TOWN"];

/// Rend un état du jeu dans un cadre. `char_bg` = frame 3D du perso (toile de fond menu/histoire).
fn render<'a>(state: &GameState, f: &'a Font, char_bg: Option<&[u8]>) -> Screen<'a> {
    // Base : la toile de fond 3D du perso si dispo, sinon un dégradé.
    let mut s = match (state, char_bg) {
        (GameState::MainMenu { .. } | GameState::Story { .. }, Some(bg)) => Screen::from_base(f, bg),
        _ => Screen::new(f),
    };
    match state {
        GameState::Title => {
            s.gradient([24, 32, 64], [8, 10, 20]);
            s.text_centered(250, "INAZUMA ELEVEN", [235, 240, 255, 255]);
            s.text_centered(330, "VICTORY ROAD", [120, 200, 255, 255]);
            s.text_centered(560, "PRESS START", [200, 210, 230, 255]);
        }
        GameState::MainMenu { sel } => {
            if char_bg.is_none() {
                s.gradient([30, 40, 80], [14, 18, 34]);
            }
            s.rect(0, 0, W as i32, 70, [20, 60, 130, 255]);
            s.text(40, 16, "MAIN MENU", [220, 235, 255, 255]);
            // Panneau d'options à GAUCHE (le perso 3D occupe la droite).
            for (i, item) in MENU.iter().enumerate() {
                let y = 200 + i as i32 * 90;
                let hot = i == *sel;
                let bg = if hot { [60, 130, 220, 235] } else { [16, 22, 44, 210] };
                s.rect(70, y, 620, y + 70, bg);
                if hot {
                    s.rect(70, y, 76, y + 70, [120, 220, 255, 255]);
                }
                s.text(110, y + 16, item, [240, 245, 252, 255]);
            }
        }
        GameState::Match { home, away } => {
            s.gradient([18, 60, 30], [8, 24, 14]); // pelouse
            s.rect(0, 0, W as i32, 70, [20, 60, 130, 255]);
            s.text(40, 16, "MATCH RESULT", [220, 235, 255, 255]);
            s.text_centered(280, "RAIMON", [255, 240, 180, 255]);
            s.text_centered(380, &format!("{home}  -  {away}"), [255, 255, 255, 255]);
            s.text_centered(480, "ROYAL ACADEMY", [200, 210, 255, 255]);
            let verdict = if home > away { "RAIMON WINS!" } else if home < away { "DEFEAT..." } else { "DRAW" };
            s.text_centered(600, verdict, [120, 255, 160, 255]);
        }
        GameState::Story { speaker, line } => {
            if char_bg.is_none() {
                s.gradient([20, 26, 54], [8, 10, 22]);
            }
            // Boîte de dialogue (réutilise le pattern /story-scene).
            let (bx0, bx1) = (60i32, W as i32 - 60);
            let by1 = H as i32 - 40;
            let by0 = by1 - 150;
            s.rect(bx0, by0, bx1, by1, [10, 14, 28, 224]);
            s.rect(bx0, by0, bx1, by0 + 3, [90, 200, 255, 255]);
            s.rect(bx0 + 20, by0 - 40, bx0 + 280, by0 + 2, [30, 60, 110, 235]);
            s.text(bx0 + 36, by0 - 32, speaker, [200, 235, 255, 255]);
            s.text(bx0 + 40, by0 + 30, line, [240, 244, 250, 255]);
        }
    }
    s
}

fn team(name: &str, base: u16) -> TeamSetup {
    TeamSetup::new(
        name,
        StatBlock { kc: base, cr: base, tc: base, pr: base, ps: base, ag: base, it: base },
    )
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    std::fs::create_dir_all(&cli.out)?;
    let f = Font::load(&cli.font_cfg, &cli.font_g4tx).context("chargement police")?;

    // Toile de fond 3D du perso (optionnelle) : rendue UNE fois, réutilisée par menu/histoire.
    let char_bg: Option<Vec<u8>> = match (&cli.char_md, &cli.char_mg, &cli.char_sk, &cli.char_tex) {
        (Some(md), Some(mg), Some(sk), Some(tex)) => {
            let frame = character::render_character(
                &std::fs::read(md)?,
                &std::fs::read(mg)?,
                &std::fs::read(sk)?,
                &std::fs::read(tex)?,
                W as u32,
                H as u32,
                0.55,
                [30, 40, 80],
                [12, 16, 30],
            )
            .context("rendu perso 3D")?;
            println!("[nie-play] perso 3D rendu en toile de fond");
            Some(frame)
        }
        _ => None,
    };

    // Match RÉEL via la FSM portée (nie-core).
    let res = simulate_match(team("RAIMON", 120), team("ROYAL ACADEMY", 95), cli.seed);

    // Playthrough scripté : la machine à états traverse le jeu.
    let flow: Vec<(GameState, u32)> = vec![
        (GameState::Title, 30),
        (GameState::MainMenu { sel: 0 }, 20),
        (GameState::Match { home: res.home_score, away: res.away_score }, 40),
        (GameState::MainMenu { sel: 1 }, 20),
        (
            GameState::Story {
                speaker: "Endou Mamoru".into(),
                line: "Can anyone bring down Raimon's unshakable fortress?!".into(),
            },
            40,
        ),
        (GameState::MainMenu { sel: 3 }, 20),
    ];

    let mut frame = 0u32;
    for (state, dur) in &flow {
        println!("[nie-play] etat = {state:?}");
        let scr = render(state, &f, char_bg.as_deref());
        for _ in 0..*dur {
            scr.save(&cli.out.join(format!("f{frame:04}.png")))?;
            frame += 1;
        }
    }
    println!(
        "[nie-play] playthrough = {frame} frames → {} (match RAIMON {}-{} ROYAL via FSM nie-core)",
        cli.out.display(),
        res.home_score,
        res.away_score
    );
    Ok(())
}
