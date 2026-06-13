//! `nie-game` — hôte GUI natif wgpu, pilier D1/C4 pixel-perfect de niers.
//!
//! ## Modes d'exécution
//!
//! - `--capture <PNG>` : rendu hors-écran (pas de fenêtre, adaptateur logiciel accepté)
//!   → lecture du framebuffer GPU → écriture d'un fichier PNG. Format render-target :
//!   `Rgba8Unorm`, échantillonneur `Nearest`, sans conversion sRGB : le PNG capturé est
//!   pixelicellement fidèle aux octets RGBA8 décodés depuis le DDS d'origine.
//!
//! - `--window [--frames N]` : ouvre une fenêtre winit + surface wgpu, affiche la texture
//!   en temps réel, se ferme automatiquement après N trames (défaut 120).
//!
//! - `--list <N>` : liste les N premiers fichiers `.g4tx` du VFS (ou CPK scan) avec
//!   leurs dimensions. Utile pour découvrir les assets disponibles.
//!
//! ## Note VFS
//!
//! Le `vfs.init()` est tenté en premier. Sur l'installation Steam courante, le
//! `cpk_list.cfg.bin` utilise un format/chiffrement incompatible avec le parseur T2B de
//! `nie-formats::cfgbin` — ce qui provoque un panic dans les builds de débogage (overflow
//! détecté à `cfgbin.rs:693`). Dans ce cas, `catch_unwind` intercepte l'erreur et bascule
//! sur un scan CPK direct : chaque `.cpk` de `data/packs/` est parcouru via
//! `nie_formats::cpk::CpkReader` pour indexer les `.g4tx` sans passer par le VFS.
//!
//! Ce bug pré-existant dans `nie-formats` affecte tous les binaires du workspace
//! (nie-model-serve, nie-headless, etc.) avec la même installation.

#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use clap::Parser;
use tracing::{error, info, warn};

use nie_formats::g4tx;
use nie_formats::vfs::Vfs;

// ── CLI ──────────────────────────────────────────────────────────────────────

const GAME_DIR_DEFAUT: &str =
    "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road";

/// Hôte GUI natif wgpu — pilier D1/C4 pixel-perfect pour niers.
///
/// Monte le VFS CPK Steam, décode une texture `.g4tx` réelle en RGBA8, l'envoie
/// sur GPU via un pipeline wgpu plein écran.
#[derive(Parser, Debug)]
#[command(name = "nie-game", version, about, long_about = None)]
struct Cli {
    /// Répertoire racine du jeu (contient `data/cpk_list.cfg.bin`).
    #[arg(long, default_value = GAME_DIR_DEFAUT)]
    game_dir: PathBuf,

    /// Chemin interne VFS de la texture `.g4tx` à rendre.
    /// Si absent, sélection automatique de la plus grande texture DDS parmi les
    /// candidats `menu`, `title`, `boot`, `ui`, `logo`.
    #[arg(long)]
    g4tx: Option<String>,

    /// Mode rendu hors-écran : écrit le framebuffer en PNG au chemin indiqué.
    /// Format `Rgba8Unorm`, échantillonneur `Nearest`, sans sRGB.
    #[arg(long)]
    capture: Option<PathBuf>,

    /// Mode fenêtré : ouvre une fenêtre winit + surface wgpu.
    #[arg(long)]
    window: bool,

    /// Mode découverte : liste les N premiers `.g4tx` du VFS (avec dimensions).
    #[arg(long)]
    list: Option<usize>,

    /// Nombre de trames avant fermeture automatique (mode --window uniquement).
    #[arg(long, default_value = "120")]
    frames: u32,
}

// ── Point d'entrée ───────────────────────────────────────────────────────────

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    let n_modes = [cli.capture.is_some(), cli.window, cli.list.is_some()]
        .iter()
        .filter(|&&x| x)
        .count();
    if n_modes == 0 {
        bail!("préciser --capture <PNG>, --window ou --list <N>");
    }
    if n_modes > 1 {
        bail!("--capture, --window et --list sont mutuellement exclusifs");
    }

    if let Some(n) = cli.list {
        return cmd_list(&cli.game_dir, n);
    }

    let (vfs_path, width, height, rgba) = charger_texture(&cli.game_dir, cli.g4tx.as_deref())?;

    info!(
        "texture chargée : {vfs_path}  {width}x{height}  {} octets RGBA8",
        rgba.len()
    );

    if let Some(png_out) = cli.capture {
        return cmd_capture(&rgba, width, height, &png_out);
    }

    if cli.window {
        return cmd_window(&rgba, width, height, cli.frames);
    }

    unreachable!()
}

// ── Décodage DDS → RGBA8 ─────────────────────────────────────────────────────
// mirrors nie-wasm nw_decode_texture_rgba; hoist to nie-formats::g4tx later

/// Table de correspondance DXGI format → `image_dds::ImageFormat`.
fn dxgi_to_image_format(dxgi: u32) -> Option<image_dds::ImageFormat> {
    use image_dds::ImageFormat as F;
    match dxgi {
        71 => Some(F::BC1RgbaUnorm),
        72 => Some(F::BC1RgbaUnormSrgb),
        73 => Some(F::BC2RgbaUnorm),
        74 => Some(F::BC2RgbaUnormSrgb),
        77 => Some(F::BC3RgbaUnorm),
        78 => Some(F::BC3RgbaUnormSrgb),
        79 | 80 => Some(F::BC4RUnorm),
        83 | 84 => Some(F::BC5RgUnorm),
        95 => Some(F::BC6hRgbUfloat),
        96 => Some(F::BC6hRgbSfloat),
        98 => Some(F::BC7RgbaUnorm),
        99 => Some(F::BC7RgbaUnormSrgb),
        _ => None,
    }
}

/// Décode un `G4txTexture` (DDS DX10 embarqué) en `(largeur, hauteur, rgba8)`.
fn decode_texture_rgba(g4tx_data: &[u8], tex: &g4tx::G4txTexture) -> Option<(u32, u32, Vec<u8>)> {
    if !tex.is_dds {
        return None;
    }
    let offset = tex.data_offset;
    const DX10_DXGI_OFFSET: usize = 128; // magic(4)+DDS_HEADER(124)
    const PIXEL_OFFSET: usize = 148; // + DX10_EXT(20)
    if offset + PIXEL_OFFSET > g4tx_data.len() {
        return None;
    }
    let dds = &g4tx_data[offset..];
    if u32::from_le_bytes(dds[..4].try_into().ok()?) != 0x2053_4444 {
        return None;
    }
    let dxgi = u32::from_le_bytes(
        dds[DX10_DXGI_OFFSET..DX10_DXGI_OFFSET + 4]
            .try_into()
            .ok()?,
    );
    let fmt = dxgi_to_image_format(dxgi)?;
    let w = tex.width as u32;
    let h = tex.height as u32;
    if w == 0 || h == 0 {
        return None;
    }
    let surface = image_dds::Surface {
        width: w,
        height: h,
        depth: 1,
        layers: 1,
        mipmaps: 1,
        image_format: fmt,
        data: &dds[PIXEL_OFFSET..],
    };
    let rgba = surface.decode_rgba8().ok()?;
    Some((w, h, rgba.data))
}

// ── Source d'assets ──────────────────────────────────────────────────────────

/// Un asset `.g4tx` trouvé dans un CPK (scan direct, sans VFS).
#[derive(Debug, Clone)]
struct CpkAsset {
    /// Chemin interne VFS reconstitué (`directory/filename`).
    internal_path: String,
    /// Nom de base du fichier CPK (ex. `abc123.cpk`).
    cpk_basename: String,
}

/// Tente de monter le VFS (peut paniquer en mode debug sur cette installation Steam :
/// bug cfgbin.rs:693 overflow dans `parse_t2b`, intercepté par `catch_unwind`).
/// Retourne `Some(vfs)` si réussi, `None` sinon.
fn tenter_vfs(data_dir: &Path) -> Option<Vfs> {
    use std::panic::AssertUnwindSafe;
    let data_dir = data_dir.to_path_buf();

    match std::panic::catch_unwind(AssertUnwindSafe(move || {
        let mut vfs = Vfs::new();
        let result = vfs.init(&data_dir);
        (vfs, result)
    })) {
        Ok((vfs, Ok(()))) => {
            info!("VFS monté : {} assets", vfs.asset_count());
            Some(vfs)
        }
        Ok((_, Err(e))) => {
            warn!(
                "VFS init échoué (format cpk_list.cfg.bin incompatible : {e}), \
                 repli sur scan CPK direct"
            );
            None
        }
        Err(_) => {
            warn!(
                "VFS init panique intercepté (bug cfgbin.rs parse_t2b overflow, \
                 build debug) — repli sur scan CPK direct"
            );
            None
        }
    }
}

/// Scanne les CPK du répertoire `packs/` pour indexer les fichiers `.g4tx`.
///
/// Lit seulement les premiers 128 Kio de chaque CPK (suffisant pour le TOC),
/// Détermine si un chemin interne VFS mérite d'être promu en prioritaire (UI, menu…).
///
/// Utilise une vérification par SEGMENT de chemin (pas `contains`) pour éviter les
/// faux positifs : "mannequin" contient "ui" comme sous-chaîne mais n'est pas une
/// texture d'interface.
fn est_chemin_prioritaire(internal_path: &str) -> bool {
    internal_path.split('/').any(|seg| {
        let s = seg.to_ascii_lowercase();
        // Correspondance exacte
        matches!(s.as_str(), "menu" | "ui" | "title" | "boot" | "logo")
            // Préfixes avec séparateur : menu_01, ui_common, title_screen…
            || s.starts_with("menu_")
            || s.starts_with("ui_")
            || s.starts_with("title_")
            || s.starts_with("boot_")
            || s.starts_with("logo_")
            // Répertoires numériques de menu : 00_soccer, 01_title…
            || (s.len() > 3 && s[2..].starts_with("_menu"))
    })
}

/// ce qui permet de parcourir les 933 archives sans tout charger en RAM.
/// Retourne la liste de tous les `.g4tx` trouvés (priorité : chemins menu/ui/title/boot).
fn scanner_cpks_g4tx(game_dir: &Path) -> Result<Vec<CpkAsset>> {
    use nie_formats::cpk::CpkReader;

    let packs_dir = game_dir.join("data").join("packs");
    let mut cpk_fichiers: Vec<PathBuf> = std::fs::read_dir(&packs_dir)
        .with_context(|| format!("lecture packs/ : {}", packs_dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "cpk"))
        .collect();
    cpk_fichiers.sort();

    info!(
        "scan CPK direct : {} archives dans {}",
        cpk_fichiers.len(),
        packs_dir.display()
    );

    // Taille de lecture partielle : 128 Kio suffisent pour le header + TOC des CPK IEVR
    // (sondé : TOC à offset ~2048, taille ~1416 octets → total ~3.5 Kio seulement).
    const LECTURE_PARTIELLE: usize = 128 * 1024;

    let mut prioritaires: Vec<CpkAsset> = Vec::new();
    let mut generaux: Vec<CpkAsset> = Vec::new();
    let mut cpk_scanned = 0usize;

    for cpk_path in &cpk_fichiers {
        let basename = cpk_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        // Lecture partielle du CPK (header + TOC uniquement)
        let donnees = match lire_premiers_octets(cpk_path, LECTURE_PARTIELLE) {
            Ok(d) => d,
            Err(e) => {
                warn!("skip {basename}: {e}");
                continue;
            }
        };

        let reader = match CpkReader::new(&donnees, &basename) {
            Ok(r) => r,
            Err(_) => continue,
        };

        cpk_scanned += 1;
        for entry in &reader.entries {
            if !entry.filename.to_ascii_lowercase().ends_with(".g4tx") {
                continue;
            }
            let path = format!("{}/{}", entry.directory, entry.filename);
            let asset = CpkAsset {
                internal_path: path.clone(),
                cpk_basename: basename.clone(),
            };
            if est_chemin_prioritaire(&path) {
                prioritaires.push(asset);
            } else {
                generaux.push(asset);
            }
        }
    }

    info!(
        "scan terminé : {cpk_scanned} CPK parcourus, {} .g4tx trouvés",
        prioritaires.len() + generaux.len()
    );

    // Tri déterministe pour reproductibilité
    prioritaires.sort_by(|a, b| a.internal_path.cmp(&b.internal_path));
    generaux.sort_by(|a, b| a.internal_path.cmp(&b.internal_path));

    let mut tous = prioritaires;
    tous.extend(generaux);
    Ok(tous)
}

/// Lit les premiers `max_bytes` octets d'un fichier (ou tout le fichier si plus court).
fn lire_premiers_octets(path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut buf = vec![0u8; max_bytes];
    let lus = f
        .read(&mut buf)
        .with_context(|| format!("read {}", path.display()))?;
    buf.truncate(lus);
    Ok(buf)
}

/// Extrait les octets bruts d'un `.g4tx` depuis son CPK (lecture complète du CPK).
fn extraire_g4tx_depuis_cpk(game_dir: &Path, asset: &CpkAsset) -> Result<Vec<u8>> {
    use nie_formats::cpk::CpkReader;

    let cpk_path = game_dir
        .join("data")
        .join("packs")
        .join(&asset.cpk_basename);

    info!("lecture CPK complet : {}", asset.cpk_basename);
    let donnees = std::fs::read(&cpk_path)
        .with_context(|| format!("lecture CPK : {}", cpk_path.display()))?;

    let reader = CpkReader::new(&donnees, &asset.cpk_basename)
        .with_context(|| format!("parsing CPK : {}", asset.cpk_basename))?;

    // Trouver l'entrée par chemin interne
    let full_path = |e: &nie_formats::cpk::CpkEntry| format!("{}/{}", e.directory, e.filename);

    let entry = reader
        .entries
        .iter()
        .find(|e| full_path(e) == asset.internal_path)
        .or_else(|| {
            reader
                .entries
                .iter()
                .find(|e| full_path(e).eq_ignore_ascii_case(&asset.internal_path))
        })
        .ok_or_else(|| {
            anyhow::anyhow!(
                "{} non trouvé dans {}",
                asset.internal_path,
                asset.cpk_basename
            )
        })?;

    reader
        .extract(&donnees, entry)
        .with_context(|| format!("extraction {} depuis CPK", asset.internal_path))
}

// ── Chargement texture (VFS ou CPK scan) ────────────────────────────────────

/// Charge et décode une texture `.g4tx` en RGBA8.
/// Tente le VFS en premier ; si échoué (bug cfgbin ou format incompatible),
/// utilise le scan CPK direct.
/// Retourne `(chemin_vfs, largeur, hauteur, données_rgba8)`.
fn charger_texture(
    game_dir: &Path,
    g4tx_path: Option<&str>,
) -> Result<(String, u32, u32, Vec<u8>)> {
    let data_dir = game_dir.join("data");

    // ── Tentative VFS ────────────────────────────────────────────────────────
    if let Some(vfs) = tenter_vfs(&data_dir) {
        let chemin = if let Some(p) = g4tx_path {
            p.to_string()
        } else {
            auto_choisir_g4tx_vfs(&vfs).ok_or_else(|| anyhow::anyhow!("aucun .g4tx dans le VFS"))?
        };

        info!("lecture VFS : {chemin}");
        let donnees = vfs
            .read(&chemin)
            .with_context(|| format!("lecture VFS : {chemin}"))?;
        return decoder_g4tx_bytes(&donnees, &chemin);
    }

    // ── Repli scan CPK ───────────────────────────────────────────────────────
    let assets = scanner_cpks_g4tx(game_dir)?;

    let asset = if let Some(p) = g4tx_path {
        // Cherche par chemin exact ou sous-chemin
        assets
            .iter()
            .find(|a| a.internal_path == p || a.internal_path.ends_with(p))
            .cloned()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "chemin '{p}' non trouvé dans les CPK ({} assets)",
                    assets.len()
                )
            })?
    } else {
        assets
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("aucun .g4tx trouvé dans les CPK"))?
    };

    info!(
        "g4tx choisi : {} (CPK : {})",
        asset.internal_path, asset.cpk_basename
    );
    let donnees = extraire_g4tx_depuis_cpk(game_dir, &asset)?;
    decoder_g4tx_bytes(&donnees, &asset.internal_path)
}

/// Parse un buffer G4TX et décode la texture la plus grande en RGBA8.
fn decoder_g4tx_bytes(donnees: &[u8], chemin: &str) -> Result<(String, u32, u32, Vec<u8>)> {
    let parsed = g4tx::parse(donnees).with_context(|| format!("parsing G4TX : {chemin}"))?;

    let tex = parsed
        .textures
        .iter()
        .filter(|t| t.is_dds)
        .max_by_key(|t| (t.width as u64) * (t.height as u64))
        .ok_or_else(|| anyhow::anyhow!("aucune texture DDS dans {chemin}"))?;

    info!(
        "texture : \"{}\" id={} {}x{} DDS",
        tex.name, tex.id, tex.width, tex.height
    );

    let (w, h, rgba) = decode_texture_rgba(donnees, tex)
        .ok_or_else(|| anyhow::anyhow!("échec décodage DDS dans {chemin}"))?;

    Ok((chemin.to_string(), w, h, rgba))
}

/// Sélectionne automatiquement un chemin `.g4tx` prioritaire depuis le VFS.
fn auto_choisir_g4tx_vfs(vfs: &Vfs) -> Option<String> {
    let mut prioritaires: Vec<String> = Vec::new();
    let mut generaux: Vec<String> = Vec::new();

    for (path, _) in vfs.iter() {
        if !path.to_ascii_lowercase().ends_with(".g4tx") {
            continue;
        }
        if est_chemin_prioritaire(path) {
            prioritaires.push(path.to_string());
        } else {
            generaux.push(path.to_string());
        }
    }
    prioritaires.sort();
    generaux.sort();
    prioritaires.into_iter().chain(generaux).next()
}

// ── Mode liste ───────────────────────────────────────────────────────────────

/// Liste les N premiers fichiers `.g4tx` (VFS ou CPK scan) avec dimensions.
fn cmd_list(game_dir: &Path, n: usize) -> Result<()> {
    let data_dir = game_dir.join("data");

    // ── Tentative VFS ────────────────────────────────────────────────────────
    if let Some(vfs) = tenter_vfs(&data_dir) {
        let mut prioritaires: Vec<String> = Vec::new();
        let mut generaux: Vec<String> = Vec::new();
        for (path, _) in vfs.iter() {
            if !path.to_ascii_lowercase().ends_with(".g4tx") {
                continue;
            }
            if est_chemin_prioritaire(path) {
                prioritaires.push(path.to_string());
            } else {
                generaux.push(path.to_string());
            }
        }
        prioritaires.sort();
        generaux.sort();
        let chemins: Vec<String> = prioritaires.into_iter().chain(generaux).take(n).collect();

        println!(
            "=== {} fichiers .g4tx (VFS, sur {} demandés) ===",
            chemins.len(),
            n
        );
        for chemin in &chemins {
            match vfs.read(chemin) {
                Ok(d) => match g4tx::parse(&d) {
                    Ok(parsed) => {
                        let best = parsed
                            .textures
                            .iter()
                            .filter(|t| t.is_dds)
                            .max_by_key(|t| (t.width as u64) * (t.height as u64));
                        match best {
                            Some(t) => println!("{chemin}  {}x{}  DDS", t.width, t.height),
                            None => {
                                if let Some(t) = parsed.textures.first() {
                                    println!("{chemin}  {}x{}  non-DDS", t.width, t.height);
                                } else {
                                    println!("{chemin}  (aucune texture)");
                                }
                            }
                        }
                    }
                    Err(e) => println!("{chemin}  (parse erreur: {e})"),
                },
                Err(e) => println!("{chemin}  (lecture erreur: {e})"),
            }
        }
        return Ok(());
    }

    // ── Repli scan CPK ───────────────────────────────────────────────────────
    let assets = scanner_cpks_g4tx(game_dir)?;
    let selection: Vec<_> = assets.into_iter().take(n).collect();

    println!(
        "=== {} fichiers .g4tx (scan CPK direct, sur {} demandés) ===",
        selection.len(),
        n
    );

    for asset in &selection {
        // Extraction pour obtenir les dimensions
        match extraire_g4tx_depuis_cpk(game_dir, asset) {
            Ok(d) => match g4tx::parse(&d) {
                Ok(parsed) => {
                    let best = parsed
                        .textures
                        .iter()
                        .filter(|t| t.is_dds)
                        .max_by_key(|t| (t.width as u64) * (t.height as u64));
                    match best {
                        Some(t) => {
                            println!(
                                "{}  {}x{}  DDS  [{}]",
                                asset.internal_path, t.width, t.height, asset.cpk_basename
                            )
                        }
                        None => println!(
                            "{}  (non-DDS)  [{}]",
                            asset.internal_path, asset.cpk_basename
                        ),
                    }
                }
                Err(e) => println!(
                    "{}  (parse erreur: {e})  [{}]",
                    asset.internal_path, asset.cpk_basename
                ),
            },
            Err(e) => println!(
                "{}  (lecture erreur: {e})  [{}]",
                asset.internal_path, asset.cpk_basename
            ),
        }
    }

    Ok(())
}

// ── Infrastructure wgpu partagée ─────────────────────────────────────────────

/// Demande un adaptateur wgpu hors-écran (logiciel accepté).
fn demander_adaptateur_hors_ecran(instance: &wgpu::Instance) -> Result<wgpu::Adapter> {
    // Tentative 1 : matériel
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::None,
        compatible_surface: None,
        force_fallback_adapter: false,
    }));
    if let Some(a) = adapter {
        return Ok(a);
    }
    // Tentative 2 : rendu logiciel
    warn!("pas d'adaptateur matériel, tentative du rendu logiciel...");
    pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::None,
        compatible_surface: None,
        force_fallback_adapter: true,
    }))
    .ok_or_else(|| anyhow::anyhow!("aucun adaptateur wgpu (ni GPU ni logiciel)"))
}

/// Crée un `(Device, Queue)` depuis un adaptateur.
fn creer_device(adapter: &wgpu::Adapter) -> Result<(wgpu::Device, wgpu::Queue)> {
    pollster::block_on(adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: Some("nie-game"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_defaults(),
            memory_hints: wgpu::MemoryHints::default(),
        },
        None,
    ))
    .context("création device wgpu")
}

/// Crée le bind group layout (texture 2D + sampler).
fn creer_bgl(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("texture_bgl"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    })
}

/// Crée le pipeline de rendu plein écran pour le format de sortie donné.
fn creer_pipeline(
    device: &wgpu::Device,
    bgl: &wgpu::BindGroupLayout,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("fullscreen"),
        source: wgpu::ShaderSource::Wgsl(include_str!("fullscreen.wgsl").into()),
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("pipeline_layout"),
        bind_group_layouts: &[bgl],
        push_constant_ranges: &[],
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("fullscreen_pipeline"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: "vs_main",
            buffers: &[],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: "fs_main",
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        }),
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleList,
            strip_index_format: None,
            front_face: wgpu::FrontFace::Ccw,
            cull_mode: None,
            unclipped_depth: false,
            polygon_mode: wgpu::PolygonMode::Fill,
            conservative: false,
        },
        depth_stencil: None,
        multisample: wgpu::MultisampleState {
            count: 1,
            mask: !0,
            alpha_to_coverage_enabled: false,
        },
        multiview: None,
        cache: None,
    })
}

/// Charge les données RGBA8 dans une texture GPU et retourne texture + vue + sampler.
fn charger_gpu_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    rgba: &[u8],
    width: u32,
    height: u32,
) -> (wgpu::Texture, wgpu::TextureView, wgpu::Sampler) {
    let extent = wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("g4tx_source"),
        size: extent,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });

    queue.write_texture(
        texture.as_image_copy(),
        rgba,
        wgpu::ImageDataLayout {
            offset: 0,
            bytes_per_row: Some(4 * width),
            rows_per_image: Some(height),
        },
        extent,
    );

    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("nearest_sampler"),
        address_mode_u: wgpu::AddressMode::ClampToEdge,
        address_mode_v: wgpu::AddressMode::ClampToEdge,
        address_mode_w: wgpu::AddressMode::ClampToEdge,
        mag_filter: wgpu::FilterMode::Nearest,
        min_filter: wgpu::FilterMode::Nearest,
        mipmap_filter: wgpu::FilterMode::Nearest,
        ..Default::default()
    });

    (texture, view, sampler)
}

/// Crée le bind group (lie texture + sampler au bind group layout).
fn creer_bind_group(
    device: &wgpu::Device,
    bgl: &wgpu::BindGroupLayout,
    view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("texture_bind_group"),
        layout: bgl,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}

// ── Mode capture (hors-écran) ────────────────────────────────────────────────

/// Rendu hors-écran → PNG. Format `Rgba8Unorm`, échantillonneur `Nearest`, sans sRGB.
fn cmd_capture(rgba: &[u8], width: u32, height: u32, png_out: &Path) -> Result<()> {
    info!("mode capture hors-écran → {}", png_out.display());

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });

    let adapter = demander_adaptateur_hors_ecran(&instance)?;
    info!("adaptateur : {:?}", adapter.get_info());

    let (device, queue) = creer_device(&adapter)?;

    let bgl = creer_bgl(&device);
    let pipeline = creer_pipeline(&device, &bgl, wgpu::TextureFormat::Rgba8Unorm);
    let (_, view, sampler) = charger_gpu_texture(&device, &queue, rgba, width, height);
    let bind_group = creer_bind_group(&device, &bgl, &view, &sampler);

    // Render target hors-écran
    let extent = wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };
    let render_tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("render_target"),
        size: extent,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let render_view = render_tex.create_view(&wgpu::TextureViewDescriptor::default());

    // Rendu
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("capture_encoder"),
    });
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("capture_pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &render_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.draw(0..3, 0..1);
    }

    // Copie render target → buffer de lecture
    const ALIGN: u32 = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let bytes_per_row_padded = (4 * width).div_ceil(ALIGN) * ALIGN;
    let buf_size = (bytes_per_row_padded * height) as u64;

    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: buf_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    encoder.copy_texture_to_buffer(
        render_tex.as_image_copy(),
        wgpu::ImageCopyBuffer {
            buffer: &readback,
            layout: wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row_padded),
                rows_per_image: Some(height),
            },
        },
        extent,
    );

    queue.submit([encoder.finish()]);

    readback.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    device.poll(wgpu::Maintain::Wait).panic_on_timeout();

    let mapped = readback.slice(..).get_mapped_range();

    // Suppression du padding ligne par ligne
    let unpadded_bpr = (4 * width) as usize;
    let padded_bpr = bytes_per_row_padded as usize;
    let mut pixels: Vec<u8> = Vec::with_capacity(unpadded_bpr * height as usize);
    for row in 0..height as usize {
        pixels.extend_from_slice(&mapped[row * padded_bpr..row * padded_bpr + unpadded_bpr]);
    }
    drop(mapped);
    readback.unmap();

    // Encodage PNG
    let png_bytes = encoder_rgba_png(&pixels, width, height)?;

    std::fs::write(png_out, &png_bytes)
        .with_context(|| format!("écriture PNG : {}", png_out.display()))?;

    info!(
        "capture écrite : {}  {}x{}  {} octets",
        png_out.display(),
        width,
        height,
        png_bytes.len()
    );
    println!(
        "capture: {}  {}x{}  {} octets PNG",
        png_out.display(),
        width,
        height,
        png_bytes.len()
    );

    Ok(())
}

/// Encode un buffer RGBA8 brut en PNG.
fn encoder_rgba_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    let mut out: Vec<u8> = Vec::new();
    {
        let mut enc = png::Encoder::new(std::io::Cursor::new(&mut out), width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().context("en-tête PNG")?;
        wr.write_image_data(rgba).context("données PNG")?;
    }
    Ok(out)
}

// ── Mode fenêtré (winit 0.30 + wgpu 22) ─────────────────────────────────────

/// Ouvre une fenêtre winit et affiche la texture via wgpu.
fn cmd_window(rgba: &[u8], width: u32, height: u32, max_frames: u32) -> Result<()> {
    use winit::event_loop::EventLoop;

    info!(
        "mode fenêtré : {}x{} pendant {} trames",
        width, height, max_frames
    );

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });

    let event_loop = EventLoop::new().context("création EventLoop winit")?;
    event_loop.set_control_flow(winit::event_loop::ControlFlow::Poll);

    let mut app = AppFenetre {
        instance,
        rgba: rgba.to_vec(),
        tex_width: width,
        tex_height: height,
        max_frames,
        frames_rendues: 0,
        etat: None,
        erreur: None,
    };

    event_loop
        .run_app(&mut app)
        .context("boucle événements winit")?;

    if let Some(e) = app.erreur {
        error!("mode fenêtré terminé avec erreur : {e}");
        return Err(e);
    }

    info!("mode fenêtré terminé ({} trames)", app.frames_rendues);
    Ok(())
}

// ── Struct de l'application winit ────────────────────────────────────────────

/// État de rendu lié à la fenêtre (créé dans `resumed`).
struct EtatFenetre {
    fenetre: Arc<winit::window::Window>,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
}

impl EtatFenetre {
    fn redimensionner(&mut self, nouvelle_taille: winit::dpi::PhysicalSize<u32>) {
        if nouvelle_taille.width > 0 && nouvelle_taille.height > 0 {
            self.config.width = nouvelle_taille.width;
            self.config.height = nouvelle_taille.height;
            self.surface.configure(&self.device, &self.config);
        }
    }

    fn rendre(&mut self) -> Result<()> {
        let output = match self.surface.get_current_texture() {
            Ok(t) => t,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                self.surface
                    .get_current_texture()
                    .context("surface reconfigurée mais get_current_texture échoue")?
            }
            Err(e) => return Err(e.into()),
        };

        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("frame_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        output.present();
        Ok(())
    }
}

/// Application winit 0.30 (trait `ApplicationHandler`).
struct AppFenetre {
    instance: wgpu::Instance,
    rgba: Vec<u8>,
    tex_width: u32,
    tex_height: u32,
    max_frames: u32,
    frames_rendues: u32,
    etat: Option<EtatFenetre>,
    erreur: Option<anyhow::Error>,
}

impl winit::application::ApplicationHandler for AppFenetre {
    fn resumed(&mut self, event_loop: &winit::event_loop::ActiveEventLoop) {
        let attrs = winit::window::Window::default_attributes()
            .with_title("nie-game — IEVR texture viewer")
            .with_inner_size(winit::dpi::LogicalSize::new(
                self.tex_width,
                self.tex_height,
            ));

        let fenetre = match event_loop.create_window(attrs) {
            Ok(w) => Arc::new(w),
            Err(e) => {
                error!("création fenêtre : {e}");
                self.erreur = Some(anyhow::anyhow!("création fenêtre : {e}"));
                event_loop.exit();
                return;
            }
        };

        match self.creer_etat(Arc::clone(&fenetre)) {
            Ok(etat) => {
                self.etat = Some(etat);
            }
            Err(e) => {
                error!("initialisation wgpu fenêtré : {e}");
                self.erreur = Some(e);
                event_loop.exit();
            }
        }
    }

    fn window_event(
        &mut self,
        event_loop: &winit::event_loop::ActiveEventLoop,
        _window_id: winit::window::WindowId,
        event: winit::event::WindowEvent,
    ) {
        use winit::event::WindowEvent;
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(taille) => {
                if let Some(etat) = &mut self.etat {
                    etat.redimensionner(taille);
                }
            }
            WindowEvent::RedrawRequested => {
                if let Some(etat) = &mut self.etat {
                    match etat.rendre() {
                        Ok(()) => {
                            self.frames_rendues += 1;
                            if self.frames_rendues >= self.max_frames {
                                info!("auto-exit après {} trames", self.frames_rendues);
                                event_loop.exit();
                            }
                        }
                        Err(e) => {
                            error!("rendu : {e}");
                            self.erreur = Some(e);
                            event_loop.exit();
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &winit::event_loop::ActiveEventLoop) {
        if let Some(etat) = &self.etat {
            etat.fenetre.request_redraw();
        }
    }
}

impl AppFenetre {
    /// Crée l'état wgpu lié à la fenêtre (surface, device, pipeline, bind group).
    fn creer_etat(&self, fenetre: Arc<winit::window::Window>) -> Result<EtatFenetre> {
        let surface = self
            .instance
            .create_surface(Arc::clone(&fenetre))
            .context("création surface wgpu")?;

        let adapter =
            pollster::block_on(self.instance.request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::default(),
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            }))
            .ok_or_else(|| anyhow::anyhow!("aucun adaptateur wgpu compatible avec la surface"))?;

        info!("adaptateur fenêtré : {:?}", adapter.get_info());

        let (device, queue) = creer_device(&adapter)?;

        let caps = surface.get_capabilities(&adapter);
        let surface_format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .unwrap_or(caps.formats[0]);

        let taille = fenetre.inner_size();
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: taille.width.max(1),
            height: taille.height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let bgl = creer_bgl(&device);
        let pipeline = creer_pipeline(&device, &bgl, surface_format);
        let (_, view, sampler) =
            charger_gpu_texture(&device, &queue, &self.rgba, self.tex_width, self.tex_height);
        let bind_group = creer_bind_group(&device, &bgl, &view, &sampler);

        Ok(EtatFenetre {
            fenetre,
            surface,
            device,
            queue,
            config,
            pipeline,
            bind_group,
        })
    }
}
