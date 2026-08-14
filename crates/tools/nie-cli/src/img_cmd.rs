//! `niers img` — édition d'image en ligne de commande.
//!
//! Socle : [`image`], la bibliothèque de référence de l'écosystème Rust (décodeurs/encodeurs
//! PNG, JPEG, WebP, GIF, BMP, TIFF + opérations géométriques). Elle est déjà une dépendance du
//! crate pour le pré-décodage des sprites de menu ; l'exposer en commandes évite de sortir du
//! dépôt pour un recadrage ou une conversion.
//!
//! Ce qui n'est PAS pris : `imageproc` (dessin, filtres, vision) et `fast_image_resize`
//! (redimensionnement SIMD). Le premier ne sert pas l'édition simple, le second n'apporte de
//! gain qu'à un volume qu'on n'a pas ici — `image` redimensionne en Lanczos3, qui est le bon
//! filtre par défaut.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use image::imageops::FilterType;
use image::{GenericImageView, ImageReader};

/// Charge une image en devinant le format par le contenu, pas par l'extension.
fn load(src: &Path) -> Result<image::DynamicImage> {
    ImageReader::open(src)
        .with_context(|| format!("ouverture {}", src.display()))?
        .with_guessed_format()
        .with_context(|| format!("format indéterminé : {}", src.display()))?
        .decode()
        .with_context(|| format!("décodage {}", src.display()))
}

/// Enregistre en déduisant l'encodeur de l'extension de `dst`.
fn save(img: &image::DynamicImage, dst: &Path) -> Result<()> {
    if let Some(parent) = dst.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("création {}", parent.display()))?;
    }
    img.save(dst).with_context(|| format!("écriture {}", dst.display()))
}

/// Traduit le nom d'un filtre en [`FilterType`].
fn filter_of(name: &str) -> Result<FilterType> {
    Ok(match name.to_ascii_lowercase().as_str() {
        "nearest" => FilterType::Nearest,
        "triangle" => FilterType::Triangle,
        "catmullrom" | "catmull" => FilterType::CatmullRom,
        "gaussian" => FilterType::Gaussian,
        "lanczos3" | "lanczos" => FilterType::Lanczos3,
        other => bail!("filtre inconnu « {other} » (nearest|triangle|catmullrom|gaussian|lanczos3)"),
    })
}

/// `niers img info` — dimensions, format et couleur, sans rien réécrire.
pub fn info(src: &Path) -> Result<()> {
    let reader = ImageReader::open(src)
        .with_context(|| format!("ouverture {}", src.display()))?
        .with_guessed_format()
        .with_context(|| format!("format indéterminé : {}", src.display()))?;
    let format = reader.format();
    let img = reader.decode().with_context(|| format!("décodage {}", src.display()))?;
    let (w, h) = img.dimensions();
    let taille = std::fs::metadata(src).map(|m| m.len()).unwrap_or(0);
    println!("  fichier   {}", src.display());
    println!("  format    {}", format.map_or("inconnu", |f| f.extensions_str()[0]));
    println!("  dimensions {w}x{h}");
    println!("  couleur   {:?}", img.color());
    println!("  octets    {taille}");
    Ok(())
}

/// `niers img resize` — redimensionne, en préservant le ratio si une seule dimension est donnée.
pub fn resize(
    src: &Path,
    dst: &Path,
    width: Option<u32>,
    height: Option<u32>,
    filter: &str,
    exact: bool,
) -> Result<()> {
    let img = load(src)?;
    let (w0, h0) = img.dimensions();
    let (tw, th) = match (width, height) {
        (Some(w), Some(h)) => (w, h),
        // Une seule dimension : l'autre suit le ratio, en arrondissant au plus proche.
        (Some(w), None) => (w, ((u64::from(h0) * u64::from(w)) as f64 / f64::from(w0)).round() as u32),
        (None, Some(h)) => (((u64::from(w0) * u64::from(h)) as f64 / f64::from(h0)).round() as u32, h),
        (None, None) => bail!("préciser au moins --width ou --height"),
    };
    if tw == 0 || th == 0 {
        bail!("dimensions cibles nulles ({tw}x{th})");
    }
    let f = filter_of(filter)?;
    // `resize_exact` déforme ; `resize` inscrit dans la boîte en gardant le ratio.
    let out = if exact { img.resize_exact(tw, th, f) } else { img.resize(tw, th, f) };
    let (fw, fh) = out.dimensions();
    save(&out, dst)?;
    println!("resize {w0}x{h0} -> {fw}x{fh} ({filter}) -> {}", dst.display());
    Ok(())
}

/// `niers img crop` — recadre une région, en refusant de sortir de l'image.
pub fn crop(src: &Path, dst: &Path, x: u32, y: u32, w: u32, h: u32) -> Result<()> {
    let img = load(src)?;
    let (iw, ih) = img.dimensions();
    if x.saturating_add(w) > iw || y.saturating_add(h) > ih {
        bail!("région {x},{y} {w}x{h} hors de l'image {iw}x{ih}");
    }
    let out = img.crop_imm(x, y, w, h);
    save(&out, dst)?;
    println!("crop {iw}x{ih} @({x},{y}) {w}x{h} -> {}", dst.display());
    Ok(())
}

/// `niers img convert` — réencode vers le format déduit de l'extension de sortie.
pub fn convert(src: &Path, dst: &Path) -> Result<()> {
    let img = load(src)?;
    let (w, h) = img.dimensions();
    save(&img, dst)?;
    println!("convert {w}x{h} {} -> {}", src.display(), dst.display());
    Ok(())
}

/// `niers img composite` — superpose `overlay` sur `base` à la position donnée (alpha respecté).
///
/// C'est l'opération qui recompose un visuel du jeu séparé en calques : un fond et sa couche
/// de texte localisée vivent dans deux `.g4tx` distincts.
pub fn composite(base: &Path, overlay: &Path, dst: &Path, x: i64, y: i64) -> Result<()> {
    let mut bottom = load(base)?.to_rgba8();
    let top = load(overlay)?.to_rgba8();
    image::imageops::overlay(&mut bottom, &top, x, y);
    let out = image::DynamicImage::ImageRgba8(bottom);
    save(&out, dst)?;
    println!("composite {} + {} @({x},{y}) -> {}", base.display(), overlay.display(), dst.display());
    Ok(())
}

/// Sous-commandes de `niers img`, résolues depuis `main`.
pub enum Op {
    Info { src: PathBuf },
    Resize { src: PathBuf, out: PathBuf, width: Option<u32>, height: Option<u32>, filter: String, exact: bool },
    Crop { src: PathBuf, out: PathBuf, x: u32, y: u32, w: u32, h: u32 },
    Convert { src: PathBuf, out: PathBuf },
    Composite { base: PathBuf, overlay: PathBuf, out: PathBuf, x: i64, y: i64 },
}

/// Exécute une opération d'image.
pub fn run(op: &Op) -> Result<()> {
    match op {
        Op::Info { src } => info(src),
        Op::Resize { src, out, width, height, filter, exact } => {
            resize(src, out, *width, *height, filter, *exact)
        }
        Op::Crop { src, out, x, y, w, h } => crop(src, out, *x, *y, *w, *h),
        Op::Convert { src, out } => convert(src, out),
        Op::Composite { base, overlay, out, x, y } => composite(base, overlay, out, *x, *y),
    }
}
