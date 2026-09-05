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

use anyhow::{Context, Result, bail};
use image::imageops::FilterType;
use image::{GenericImageView, ImageReader};
use nie_formats::imgmetric::{self, Roi, RoiKind, ScoreRegion};

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
    img.save(dst)
        .with_context(|| format!("écriture {}", dst.display()))
}

/// Traduit le nom d'un filtre en [`FilterType`].
fn filter_of(name: &str) -> Result<FilterType> {
    Ok(match name.to_ascii_lowercase().as_str() {
        "nearest" => FilterType::Nearest,
        "triangle" => FilterType::Triangle,
        "catmullrom" | "catmull" => FilterType::CatmullRom,
        "gaussian" => FilterType::Gaussian,
        "lanczos3" | "lanczos" => FilterType::Lanczos3,
        other => {
            bail!("filtre inconnu « {other} » (nearest|triangle|catmullrom|gaussian|lanczos3)")
        }
    })
}

/// `niers img info` — dimensions, format et couleur, sans rien réécrire.
pub fn info(src: &Path) -> Result<()> {
    let reader = ImageReader::open(src)
        .with_context(|| format!("ouverture {}", src.display()))?
        .with_guessed_format()
        .with_context(|| format!("format indéterminé : {}", src.display()))?;
    let format = reader.format();
    let img = reader
        .decode()
        .with_context(|| format!("décodage {}", src.display()))?;
    let (w, h) = img.dimensions();
    let taille = std::fs::metadata(src).map(|m| m.len()).unwrap_or(0);
    println!("  fichier   {}", src.display());
    println!(
        "  format    {}",
        format.map_or("inconnu", |f| f.extensions_str()[0])
    );
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
        (Some(w), None) => (
            w,
            ((u64::from(h0) * u64::from(w)) as f64 / f64::from(w0)).round() as u32,
        ),
        (None, Some(h)) => (
            ((u64::from(w0) * u64::from(h)) as f64 / f64::from(h0)).round() as u32,
            h,
        ),
        (None, None) => bail!("préciser au moins --width ou --height"),
    };
    if tw == 0 || th == 0 {
        bail!("dimensions cibles nulles ({tw}x{th})");
    }
    let f = filter_of(filter)?;
    // `resize_exact` déforme ; `resize` inscrit dans la boîte en gardant le ratio.
    let out = if exact {
        img.resize_exact(tw, th, f)
    } else {
        img.resize(tw, th, f)
    };
    let (fw, fh) = out.dimensions();
    save(&out, dst)?;
    println!(
        "resize {w0}x{h0} -> {fw}x{fh} ({filter}) -> {}",
        dst.display()
    );
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
    println!(
        "composite {} + {} @({x},{y}) -> {}",
        base.display(),
        overlay.display(),
        dst.display()
    );
    Ok(())
}

/// Assemble plusieurs images en planche (sprite sheet) et écrit son manifeste.
///
/// Le manifeste est ce qui distingue une planche d'une image : sans les rectangles, la sortie
/// se regarde mais ne se réutilise pas. Il porte, pour chaque case, son nom (le nom du fichier
/// source, sans extension) et le rectangle **de l'image**, jamais celui de la cellule.
///
/// Aucune image n'est redimensionnée : les plus petites sont centrées dans leur cellule.
pub fn planche(
    srcs: &[PathBuf],
    dst: &Path,
    manifeste: Option<&Path>,
    colonnes: u32,
    marge: u32,
    gouttiere: u32,
    fond: [u8; 4],
) -> Result<()> {
    if srcs.is_empty() {
        anyhow::bail!("aucune image source");
    }

    let mut cases = Vec::with_capacity(srcs.len());
    for src in srcs {
        let img = load(src)?.to_rgba8();
        let (w, h) = img.dimensions();
        cases.push(nie_formats::image_out::CasePlanche {
            // Le nom du fichier fait le nom de la case : c'est ce que l'appelant reconnaîtra
            // dans le manifeste, et il l'a déjà choisi en nommant ses fichiers.
            nom: src.file_stem().map_or_else(
                || "sans-nom".to_string(),
                |s| s.to_string_lossy().into_owned(),
            ),
            largeur: w,
            hauteur: h,
            rgba: img.into_raw(),
        });
    }

    let colonnes = if colonnes == 0 {
        cases.len() as u32
    } else {
        colonnes
    };
    let p = nie_formats::image_out::composer_planche(&cases, colonnes, marge, gouttiere, fond);

    let img = image::RgbaImage::from_raw(p.largeur, p.hauteur, p.rgba)
        .context("planche composée incohérente (dimensions vs tampon)")?;
    save(&image::DynamicImage::ImageRgba8(img), dst)?;

    if let Some(chemin) = manifeste {
        let cases_json: Vec<serde_json::Value> = p
            .cases
            .iter()
            .zip(srcs)
            .map(|(r, src)| {
                serde_json::json!({
                    "nom": r.nom,
                    "source": src.to_string_lossy(),
                    "rect": { "x": r.x, "y": r.y, "w": r.w, "h": r.h },
                })
            })
            .collect();
        let doc = serde_json::json!({
            "planche": dst.file_name().map(|n| n.to_string_lossy().into_owned()),
            "largeur": p.largeur,
            "hauteur": p.hauteur,
            "colonnes": colonnes,
            "marge": marge,
            "gouttiere": gouttiere,
            "redimensionnement": "aucun",
            "cases": cases_json,
        });
        if let Some(parent) = chemin.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("création {}", parent.display()))?;
        }
        std::fs::write(chemin, serde_json::to_vec_pretty(&doc)?)
            .with_context(|| format!("écriture {}", chemin.display()))?;
    }

    println!(
        "planche {}x{} — {} case(s), {} colonne(s) -> {}{}",
        p.largeur,
        p.hauteur,
        p.cases.len(),
        colonnes,
        dst.display(),
        manifeste.map_or_else(String::new, |m| format!(" + {}", m.display()))
    );
    Ok(())
}

/// Lit une couleur `RRGGBB` ou `RRGGBBAA` hexadécimale.
///
/// Sans alpha, la couleur est opaque : un fond que l'appelant écrit à six chiffres est un fond
/// qu'il veut voir, pas un fond transparent.
pub fn couleur_hex(s: &str) -> Result<[u8; 4]> {
    let t = s.trim_start_matches('#');
    let lire = |i: usize| -> Result<u8> {
        u8::from_str_radix(&t[i..i + 2], 16).with_context(|| format!("couleur invalide : {s}"))
    };
    match t.len() {
        6 => Ok([lire(0)?, lire(2)?, lire(4)?, 255]),
        8 => Ok([lire(0)?, lire(2)?, lire(4)?, lire(6)?]),
        _ => anyhow::bail!("couleur attendue en RRGGBB ou RRGGBBAA, reçu : {s}"),
    }
}

/// Sous-commandes de `niers img`, résolues depuis `main`.
pub enum Op {
    Info {
        src: PathBuf,
    },
    Planche {
        srcs: Vec<PathBuf>,
        out: PathBuf,
        manifeste: Option<PathBuf>,
        colonnes: u32,
        marge: u32,
        gouttiere: u32,
        fond: String,
    },
    Resize {
        src: PathBuf,
        out: PathBuf,
        width: Option<u32>,
        height: Option<u32>,
        filter: String,
        exact: bool,
    },
    Crop {
        src: PathBuf,
        out: PathBuf,
        x: u32,
        y: u32,
        w: u32,
        h: u32,
    },
    Convert {
        src: PathBuf,
        out: PathBuf,
    },
    Composite {
        base: PathBuf,
        overlay: PathBuf,
        out: PathBuf,
        x: i64,
        y: i64,
    },
    Diff {
        rendu: PathBuf,
        reference: PathBuf,
        roi: Option<PathBuf>,
        out: Option<PathBuf>,
        downscale_ref: bool,
        amplification: u8,
    },
}

/// Exécute une opération d'image.
pub fn run(op: &Op) -> Result<()> {
    match op {
        Op::Info { src } => info(src),
        Op::Resize {
            src,
            out,
            width,
            height,
            filter,
            exact,
        } => resize(src, out, *width, *height, filter, *exact),
        Op::Crop {
            src,
            out,
            x,
            y,
            w,
            h,
        } => crop(src, out, *x, *y, *w, *h),
        Op::Convert { src, out } => convert(src, out),
        Op::Composite {
            base,
            overlay,
            out,
            x,
            y,
        } => composite(base, overlay, out, *x, *y),
        Op::Planche {
            srcs,
            out,
            manifeste,
            colonnes,
            marge,
            gouttiere,
            fond,
        } => planche(
            srcs,
            out,
            manifeste.as_deref(),
            *colonnes,
            *marge,
            *gouttiere,
            couleur_hex(fond)?,
        ),
        Op::Diff {
            rendu,
            reference,
            roi,
            out,
            downscale_ref,
            amplification,
        } => diff(
            rendu,
            reference,
            roi.as_deref(),
            out.as_deref(),
            *downscale_ref,
            *amplification,
        ),
    }
}

/// Lit un fichier de régions.
///
/// Forme : `[{"nom": "avatar3d", "rect": [x, y, w, h], "kind": "dynamique"}]`. `kind` vaut
/// `dynamique` (retirée de la mesure) ou `nommee` (mesurée à part, sans sortir du global).
fn charger_rois(chemin: &Path) -> Result<Vec<Roi>> {
    #[derive(serde::Deserialize)]
    struct Entree {
        nom: String,
        rect: [u32; 4],
        #[serde(default)]
        kind: Option<String>,
    }
    let txt =
        std::fs::read_to_string(chemin).with_context(|| format!("lecture {}", chemin.display()))?;
    let brut: Vec<Entree> =
        serde_json::from_str(&txt).with_context(|| format!("format {}", chemin.display()))?;
    brut.into_iter()
        .map(|e| {
            let kind = match e.kind.as_deref().unwrap_or("nommee") {
                "dynamique" => RoiKind::Dynamique,
                "nommee" | "nommée" => RoiKind::Nommee,
                autre => bail!(
                    "kind inconnu « {autre} » (dynamique|nommee) pour « {} »",
                    e.nom
                ),
            };
            Ok(Roi {
                nom: e.nom,
                rect: (e.rect[0], e.rect[1], e.rect[2], e.rect[3]),
                kind,
            })
        })
        .collect()
}

/// Une ligne de tableau pour un score.
fn ligne_score(s: &ScoreRegion) -> String {
    format!(
        "  {:<22} {:>10} px   T0 {:>6.2} %   ΔE≤1 {:>6.2} %   ΔE moy {:>6.2}   p99 {:>6.2}   SSIM {:>6.4}",
        s.nom, s.px, s.exact_pct, s.de1_pct, s.de_moyen, s.de_p99, s.ssim
    )
}

/// `niers img diff` — compare un rendu à une capture du vrai jeu.
///
/// La sortie est **par région** : un score global mélange toujours une zone juste et une zone
/// fausse, et ne dit pas laquelle. Les régions marquées `dynamique` (personnage 3D, particules,
/// curseur) sortent de la mesure, et la part de surface ainsi retirée est imprimée — un score dont
/// on ignore ce qu'il ne couvre pas ne vaut rien.
pub fn diff(
    rendu: &Path,
    reference: &Path,
    roi: Option<&Path>,
    out: Option<&Path>,
    downscale_ref: bool,
    amplification: u8,
) -> Result<()> {
    let a = load(rendu)?.to_rgba8();
    let b = load(reference)?.to_rgba8();
    let (aw, ah) = (a.width(), a.height());
    let (mut bw, mut bh) = (b.width(), b.height());
    let mut bpix = b.into_raw();

    if downscale_ref {
        let (nw, nh, px) = imgmetric::downscale_lineaire_2x(bw, bh, &bpix);
        bw = nw;
        bh = nh;
        bpix = px;
    }
    if (aw, ah) != (bw, bh) {
        let piste = if (bw, bh) == (aw * 2, ah * 2) {
            " — la référence fait exactement le double : `--downscale-ref` la ramène en lumière \
             linéaire, mais rendre nativement à sa taille mesure mieux"
        } else {
            ""
        };
        bail!("dimensions incompatibles : rendu {aw}×{ah}, référence {bw}×{bh}{piste}");
    }

    let rois = match roi {
        Some(p) => charger_rois(p)?,
        None => Vec::new(),
    };
    let rapport = imgmetric::comparer(aw, ah, &a, &bpix, &rois);

    println!(
        "{} vs {}  ({aw}×{ah})",
        rendu.display(),
        reference.display()
    );
    println!("{}", ligne_score(&rapport.global));
    for r in &rapport.regions {
        println!("{}", ligne_score(r));
    }
    println!(
        "  surface exclue (régions dynamiques) : {:.2} %   ·   rendu opaque sur {:.2} % des pixels mesurés",
        rapport.surface_exclue_pct, rapport.couverture_opaque_pct
    );
    if rapport.couverture_opaque_pct < 99.99 {
        println!(
            "  ATTENTION : le rendu laisse voir le canvas — une part du score porte sur du vide, pas sur des pixels."
        );
    }

    let Some(dir) = out else { return Ok(()) };
    std::fs::create_dir_all(dir).with_context(|| format!("création {}", dir.display()))?;

    let json = serde_json::json!({
        "rendu": rendu.display().to_string(),
        "reference": reference.display().to_string(),
        "largeur": aw,
        "hauteur": ah,
        "surfaceExcluePct": rapport.surface_exclue_pct,
        "couvertureOpaquePct": rapport.couverture_opaque_pct,
        "global": json_score(&rapport.global),
        "regions": rapport.regions.iter().map(json_score).collect::<Vec<_>>(),
    });
    std::fs::write(dir.join("rapport.json"), serde_json::to_vec_pretty(&json)?)?;

    let (hw, hh, heat) = imgmetric::heatmap_rgba(&rapport);
    ecrire_png(&dir.join("heatmap.png"), hw, hh, &heat)?;
    let delta = imgmetric::delta_rgba(aw, ah, &a, &bpix, &rois, amplification);
    ecrire_png(&dir.join("delta.png"), aw, ah, &delta)?;
    println!(
        "  écrits : {}/rapport.json · heatmap.png · delta.png",
        dir.display()
    );
    Ok(())
}

/// Sérialise un score.
fn json_score(s: &ScoreRegion) -> serde_json::Value {
    serde_json::json!({
        "nom": s.nom,
        "px": s.px,
        "exactPct": s.exact_pct,
        "de1Pct": s.de1_pct,
        "canal2Pct": s.canal2_pct,
        "deMoyen": s.de_moyen,
        "deP99": s.de_p99,
        "deMax": s.de_max,
        "ssim": s.ssim,
    })
}

/// Écrit un tampon RGBA8 en PNG.
fn ecrire_png(dst: &Path, w: u32, h: u32, rgba: &[u8]) -> Result<()> {
    let buf: image::RgbaImage = image::ImageBuffer::from_raw(w, h, rgba.to_vec())
        .ok_or_else(|| anyhow::anyhow!("tampon RGBA de mauvaise taille pour {w}×{h}"))?;
    image::DynamicImage::ImageRgba8(buf)
        .save(dst)
        .with_context(|| format!("écriture {}", dst.display()))
}
