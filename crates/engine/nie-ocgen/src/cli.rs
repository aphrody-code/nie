//! The command surface, kept in the library so every host runs the same code.
//!
//! `niers ocgen` and the standalone `nie-ocgen` binary are both a `clap` derive plus a call to
//! [`run`]. Nothing here decides anything the pipeline does not already decide; putting the logic
//! in the library is what stops a second implementation from drifting away from the first, which
//! this repository has already paid for on keeper, menu and match-sim.

use std::path::{Path, PathBuf};

use clap::Subcommand;

use crate::{Error, palette, recipe::Recipe, sources::EditorSources};

/// Sub-commands of `ocgen`.
#[derive(Subcommand, Debug)]
pub enum OcgenCmd {
    /// Lists the shipped morphologies: file stem, body type, and the traits their key encodes.
    Morphologies {
        /// Decoded game-data root.
        #[arg(long, default_value = "data")]
        data: PathBuf,
    },
    /// Surveys the colour slots of every shipped document — the evidence a binding is made on.
    Slots {
        /// Decoded game-data root.
        #[arg(long, default_value = "data")]
        data: PathBuf,
        /// Writes the survey as JSON instead of printing it.
        #[arg(short, long)]
        out: Option<PathBuf>,
    },
    /// Measures a recipe's probes on the character's sheets, without generating anything.
    Measure {
        /// Character slug under `data/oc/`.
        slug: String,
        /// Decoded game-data root.
        #[arg(long, default_value = "data")]
        data: PathBuf,
    },
    /// Encodes iecode `*.cfg.bin.json` documents into real `cfg.bin` T2B files.
    ///
    /// Nothing is written until the bytes have been read back and compared to the source, node for
    /// node. Works on any T2B iecode document, not only on a generated character: an OC's dialogue
    /// event is the same kind of file.
    Encode {
        /// Files or directories to encode; a directory is walked for `*.cfg.bin.json`.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Output directory; without it, each `.cfg.bin` is written next to its source.
        #[arg(short, long)]
        out: Option<PathBuf>,
    },
    /// Produces the portrait icon containers a recipe declares.
    ///
    /// The only core asset of an OC that no lock stands in front of: a `G4TX` carrying the two
    /// 256×256 sub-textures the reference icon was measured to hold.
    Icons {
        /// Character slug under `data/oc/`.
        slug: String,
        /// Decoded game-data root.
        #[arg(long, default_value = "data")]
        data: PathBuf,
        /// Output directory.
        #[arg(short, long, default_value = "var/ocgen/icons")]
        out: PathBuf,
    },
    /// Runs the whole chain and writes the generated document plus its run report.
    Run {
        /// Character slug under `data/oc/`.
        slug: String,
        /// Decoded game-data root.
        #[arg(long, default_value = "data")]
        data: PathBuf,
        /// Output directory for `<slug>.cfg.bin.json` and `<slug>-run.json`.
        #[arg(short, long, default_value = "var/ocgen")]
        out: PathBuf,
    },
}

/// Character directory for a slug.
fn oc_root(data: &Path, slug: &str) -> PathBuf {
    data.join("oc").join(slug)
}

/// Reads every recipe a character carries, sorted by file name.
///
/// One file per internal code: a character drawn across two eras is two characters as far as the
/// game is concerned, with different kits, a different build and their own document each. Reading
/// only `3d-recipe.json` would silently produce half of Astro Lor.
///
/// # Errors
///
/// Returns [`Error::Io`] when the directory holds no recipe, and [`Error::Format`] when one does
/// not decode or declares an internal code another already claimed.
fn read_recipes(data: &Path, slug: &str) -> Result<Vec<Recipe>, Error> {
    let dir = oc_root(data, slug).join("game");
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|error| Error::Io(format!("lecture {} : {error}", dir.display())))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("3d-recipe") && name.ends_with(".json"))
        })
        .collect();
    paths.sort();
    if paths.is_empty() {
        return Err(Error::Io(format!(
            "{} : aucun 3d-recipe*.json",
            dir.display()
        )));
    }

    let mut recipes = Vec::with_capacity(paths.len());
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for path in paths {
        let bytes = std::fs::read(&path)
            .map_err(|error| Error::Io(format!("lecture {} : {error}", path.display())))?;
        let recipe: Recipe = serde_json::from_slice(&bytes)
            .map_err(|error| Error::Format(format!("décodage {} : {error}", path.display())))?;
        if !seen.insert(recipe.internal_code.clone()) {
            return Err(Error::Format(format!(
                "{} : le code interne {} est déjà produit par une autre recette",
                path.display(),
                recipe.internal_code
            )));
        }
        recipes.push(recipe);
    }
    Ok(recipes)
}

/// One document to encode: where it is, and where it sits relative to the path the user named.
struct Source {
    /// Path on disk.
    path: PathBuf,
    /// Path relative to the argument it was found under, so `--out` can mirror the tree.
    relative: PathBuf,
}

/// Collects `*.cfg.bin.json` files from a path, walking it when it is a directory.
///
/// The relative path is kept, and that is not cosmetic: an OC's dialogue carries the same file
/// name under `fr/` and `en/`, so flattening the tree into one output directory makes the second
/// locale silently overwrite the first. It did, once.
fn collect_iecode(root: &Path, path: &Path, out: &mut Vec<Source>) -> Result<(), Error> {
    if path.is_file() {
        let relative = path.strip_prefix(root).map_or_else(
            |_| PathBuf::from(path.file_name().unwrap_or_default()),
            Path::to_path_buf,
        );
        out.push(Source {
            path: path.to_path_buf(),
            relative,
        });
        return Ok(());
    }
    if !path.is_dir() {
        return Err(Error::Io(format!(
            "{} : ni fichier ni dossier",
            path.display()
        )));
    }
    let mut entries: Vec<PathBuf> = std::fs::read_dir(path)
        .map_err(|error| Error::Io(format!("{} : {error}", path.display())))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect();
    entries.sort();
    for entry in entries {
        let is_iecode = entry
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".cfg.bin.json"));
        if entry.is_dir() || is_iecode {
            collect_iecode(root, &entry, out)?;
        }
    }
    Ok(())
}

/// Encodes one iecode document, refusing to write anything it cannot read back unchanged.
fn encode_one(source: &Source, out_dir: Option<&Path>) -> Result<(PathBuf, usize), Error> {
    let path = source.path.as_path();
    encode_to(path, target_path(source, out_dir)?)
}

/// Where one source's `.cfg.bin` goes.
fn target_path(source: &Source, out_dir: Option<&Path>) -> Result<PathBuf, Error> {
    let name = source
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_suffix(".json"))
        .ok_or_else(|| Error::Io(format!("{} : nom inattendu", source.path.display())))?;
    Ok(match out_dir {
        Some(dir) => dir.join(source.relative.with_file_name(name)),
        None => source.path.with_file_name(name),
    })
}

/// Encodes `source` to `target`, after reading the bytes back and comparing them to the source.
fn encode_to(source: &Path, target: PathBuf) -> Result<(PathBuf, usize), Error> {
    let raw = std::fs::read(source)
        .map_err(|error| Error::Io(format!("lecture {} : {error}", source.display())))?;
    let document: serde_json::Value = serde_json::from_slice(&raw)
        .map_err(|error| Error::Format(format!("{} : {error}", source.display())))?;

    let bytes = nie_formats::cfgbin::encode_iecode_t2b(&document)
        .map_err(|error| Error::Format(format!("{} : {error}", source.display())))?;
    let relu = nie_formats::cfgbin::t2b_to_iecode_json(&bytes).ok_or_else(|| {
        Error::Format(format!(
            "{} : le T2B produit ne se relit pas",
            source.display()
        ))
    })?;
    if relu != document {
        return Err(Error::Format(format!(
            "{} : le T2B produit ne rend pas le document de départ, rien n'est écrit",
            source.display()
        )));
    }

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| Error::Io(format!("création {} : {error}", parent.display())))?;
    }
    std::fs::write(&target, &bytes)
        .map_err(|error| Error::Io(format!("écriture {} : {error}", target.display())))?;
    Ok((target, bytes.len()))
}

/// Writes a value as pretty JSON.
fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<(), Error> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| Error::Format(format!("sérialisation {} : {error}", path.display())))?;
    std::fs::write(path, bytes)
        .map_err(|error| Error::Io(format!("écriture {} : {error}", path.display())))
}

/// Runs one sub-command.
///
/// # Errors
///
/// Propagates the first stage that fails, naming the path or the stage that caused it.
pub fn run(op: &OcgenCmd) -> Result<(), Error> {
    match op {
        OcgenCmd::Morphologies { data } => {
            let sources = EditorSources::load(data)?;
            println!(
                "catalogue chara_edit {} \u{2014} {} morphologies",
                sources.catalog_version,
                sources.morphologies.entries.len()
            );
            for entry in &sources.morphologies.entries {
                println!(
                    "  {:<52} {:<14} {:?}/{:?}/{}",
                    entry.stem,
                    entry.body_type,
                    entry.stature,
                    entry.build,
                    entry
                        .gender
                        .map_or_else(|| "\u{2014}".to_string(), |gender| format!("{gender:?}"))
                );
            }
            Ok(())
        }
        OcgenCmd::Slots { data, out } => {
            let sources = EditorSources::load(data)?;
            let survey = crate::recipe::survey_slots(&sources);
            match out {
                Some(path) => {
                    write_json(path, &survey)?;
                    println!(
                        "{} slots écrits dans {}",
                        survey.slots.len(),
                        path.display()
                    );
                }
                None => {
                    println!(
                        "{} documents inspectés, {} slots de couleur",
                        survey.documents,
                        survey.slots.len()
                    );
                    for slot in &survey.slots {
                        println!(
                            "  {:>12}  {:>3} lignes  {:>2} documents  {}",
                            slot.slot,
                            slot.rows,
                            slot.documents,
                            slot.colors.join(" ")
                        );
                    }
                }
            }
            Ok(())
        }
        OcgenCmd::Measure { slug, data } => {
            let recipes = read_recipes(data, slug)?;
            let references =
                crate::sources::ReferenceSet::load(&oc_root(data, slug).join("source"))?;
            let sheets = references.sheets();
            println!("{} planches décodées", sheets.len());
            for recipe in &recipes {
                println!(
                    "{} \u{2014} {} sondes",
                    recipe.internal_code,
                    recipe.probes.len()
                );
                for probe in &recipe.probes {
                    let sheet = sheets
                        .iter()
                        .copied()
                        .find(|sheet| sheet.name == probe.sheet)
                        .ok_or_else(|| {
                            Error::Palette(format!("planche \u{ab} {} \u{bb} absente", probe.sheet))
                        })?;
                    let swatch = palette::measure_one(probe, sheet, palette::Rejection::default())?;
                    println!(
                        "  {:<16} {}  groupe dominant {:>3} %, écart {:.4}, {} px retenus sur {}",
                        swatch.role,
                        swatch.hex,
                        (swatch.share * 100.0).round(),
                        swatch.spread,
                        swatch.kept,
                        swatch.sampled
                    );
                }
            }
            Ok(())
        }
        OcgenCmd::Encode { paths, out } => {
            let mut sources = Vec::new();
            for path in paths {
                collect_iecode(path, path, &mut sources)?;
            }
            // Two sources landing on one target would silently lose one of them.
            let mut targets: std::collections::BTreeMap<PathBuf, &Path> =
                std::collections::BTreeMap::new();
            for source in &sources {
                let target = target_path(source, out.as_deref())?;
                if let Some(previous) = targets.insert(target.clone(), source.path.as_path()) {
                    return Err(Error::Io(format!(
                        "{} et {} viseraient tous deux {} : rien n'est écrit",
                        previous.display(),
                        source.path.display(),
                        target.display()
                    )));
                }
            }
            if sources.is_empty() {
                return Err(Error::Io(
                    "aucun *.cfg.bin.json trouvé dans les chemins donnés".to_string(),
                ));
            }
            if let Some(dir) = out {
                std::fs::create_dir_all(dir)
                    .map_err(|error| Error::Io(format!("création {} : {error}", dir.display())))?;
            }
            let mut total = 0_usize;
            for source in &sources {
                let (target, bytes) = encode_one(source, out.as_deref())?;
                total += bytes;
                println!(
                    "  {} \u{2192} {} ({bytes} octets)",
                    source.path.display(),
                    target.display()
                );
            }
            println!(
                "{} document(s) encodés, {total} octets, tous relus à l'identique \
                 (le jeu n'a rien validé)",
                sources.len()
            );
            Ok(())
        }
        OcgenCmd::Icons { slug, data, out } => {
            let recipes = read_recipes(data, slug)?;
            let specs: Vec<&crate::icon::IconSpec> =
                recipes.iter().flat_map(|recipe| &recipe.icons).collect();
            if specs.is_empty() {
                return Err(Error::Io(format!(
                    "{slug} : aucune recette ne déclare d'icône"
                )));
            }
            let references =
                crate::sources::ReferenceSet::load(&oc_root(data, slug).join("source"))?;
            let sheets = references.sheets();
            std::fs::create_dir_all(out)
                .map_err(|error| Error::Io(format!("création {} : {error}", out.display())))?;

            for spec in specs.iter().copied() {
                let (bytes, report) = crate::icon::encode_icon(spec, &sheets)?;
                let path = out.join(format!("{}_l.g4tx", spec.internal_code));
                std::fs::write(&path, &bytes)
                    .map_err(|error| Error::Io(format!("écriture {} : {error}", path.display())))?;
                println!(
                    "  {} \u{2192} {} ({} octets, {} relues)",
                    report.vfs_path,
                    path.display(),
                    report.bytes,
                    report.textures.join(" + ")
                );
                // The container is decoded back to PNG so a human can look at what it holds; a
                // container that re-parses is not a container with the right pixels in it.
                for (name, png) in crate::icon::preview_png(&bytes)? {
                    let preview = out.join(format!("{name}.png"));
                    std::fs::write(&preview, &png).map_err(|error| {
                        Error::Io(format!("écriture {} : {error}", preview.display()))
                    })?;
                }
            }
            println!(
                "{} conteneur(s) écrits et reparsés, payload {} ; aucun n'a été chargé par le jeu",
                specs.len(),
                crate::icon::payload_format()
            );
            Ok(())
        }
        OcgenCmd::Run { slug, data, out } => {
            let recipes = read_recipes(data, slug)?;
            std::fs::create_dir_all(out)
                .map_err(|error| Error::Io(format!("création {} : {error}", out.display())))?;
            for recipe in &recipes {
                run_one(recipe, data, out)?;
            }
            println!(
                "{} variante(s) produites pour {slug} : {}",
                recipes.len(),
                recipes
                    .iter()
                    .map(|recipe| recipe.internal_code.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            Ok(())
        }
    }
}

/// Runs the chain for one internal code and writes its three artefacts.
fn run_one(recipe: &Recipe, data: &Path, out: &Path) -> Result<(), Error> {
    let code = recipe.internal_code.as_str();
    let (report, generated) = crate::run(data, &oc_root(data, &recipe.slug), recipe)?;

    let document_path = out.join(format!("{code}.cfg.bin.json"));
    write_json(&document_path, &generated.document.to_value())?;
    let report_path = out.join(format!("{code}-run.json"));
    write_json(&report_path, &report)?;

    // The binary is written only once it has been read back and compared: a `cfg.bin` that the
    // repository cannot re-decode into the same document has no business on disk.
    let bytes = generated.document.to_cfgbin()?;
    let relu = crate::param::CharaEditParam::from_cfgbin(&bytes)?;
    if relu != generated.document {
        return Err(Error::Format(format!(
            "{code} : le cfg.bin produit ne se relit pas à l'identique, rien n'est écrit"
        )));
    }
    let binary_path = out.join(format!("{code}.cfg.bin"));
    std::fs::write(&binary_path, &bytes)
        .map_err(|error| Error::Io(format!("écriture {} : {error}", binary_path.display())))?;

    println!("== {code} \u{2014} {}", recipe.name);
    println!("  morphologie de départ : {}", report.morphology_stem);
    println!("  body type             : {}", report.body_type);
    println!("  mesures               : {}", report.swatches.len());
    for swatch in &report.swatches {
        println!(
            "    {:<16} {}  groupe dominant {:>3} %, écart {:.4}",
            swatch.role,
            swatch.hex,
            (swatch.share * 100.0).round(),
            swatch.spread
        );
    }
    println!("  changements appliqués : {}", report.applied.len());
    println!("  avertissements        : {}", report.warnings.len());
    for warning in &report.warnings {
        println!(
            "    [{}] {} \u{2014} {}",
            warning.stage, warning.subject, warning.reason
        );
    }
    println!(
        "  ressources de modèle présentes dans ce checkout : {} / {}",
        report.plan.present,
        report.plan.requirements.len()
    );
    for gate in &report.plan.gates {
        println!("    verrou : {gate}");
    }
    println!(
        "  écrits : {} + {} ({} octets) + {}",
        document_path.display(),
        binary_path.display(),
        bytes.len(),
        report_path.display()
    );
    Ok(())
}
